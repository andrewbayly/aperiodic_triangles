'use strict';
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { findCanonicalSubtypeFast, compareArrays } = require('./canonicalize_subtype.js');
const { computeStabilizer, enumerateFlavoredForSubtype } = require('./orderly.js');
const { classify } = require('./classify.js');

const { n, reflectableFlags, workerId, numWorkers, outputDir, patchBudget, torusBudget, progressEvery } = workerData;

const periodicPath = path.join(outputDir, `periodic_w${workerId}.jsonl`);
const nonTilerPath = path.join(outputDir, `non_tiler_w${workerId}.jsonl`);
const candidatesPath = path.join(outputDir, `aperiodic_candidates_w${workerId}.jsonl`);
const skippedPath = path.join(outputDir, `skipped_duplicate_w${workerId}.jsonl`);
const checkpointPath = path.join(outputDir, `checkpoint_w${workerId}.json`);

// This worker owns subtype codes {workerId, workerId+numWorkers,
// workerId+2*numWorkers, ...} -- STRIDED (interleaved) partitioning, NOT
// contiguous ranges. This matters because canonical-pattern density varies
// wildly and unevenly across contiguous regions of the raw subtype-code
// space (empirically verified for n=3: some large regions are almost
// entirely empty of canonical patterns while others are 1000x+ denser),
// which would make contiguous-range partitioning severely imbalanced --
// some workers finishing almost immediately while others carry nearly all
// the real classification work. Striding was verified to average out this
// variation almost perfectly (max deviation 0.7% across worker groups when
// tested against the actual dense regions), since local density does not
// correlate with (code mod numWorkers).
const totalSubtypeSpace = 9 ** (3 * n);
const totalCodesForWorker = Math.ceil(Math.max(0, totalSubtypeSpace - workerId) / numWorkers);

let resumeFromCode = workerId; // first code this worker owns
if (fs.existsSync(checkpointPath)) {
  try {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (typeof cp.lastCompletedCode === 'number') resumeFromCode = cp.lastCompletedCode + numWorkers;
  } catch (e) { /* corrupt checkpoint, start over */ }
}

function tilesetRecord(tiles) { return { n, reflectableFlags, tiles }; }

let counts = { periodic: 0, nonTiler: 0, candidate: 0, skipped: 0 };
let shapesDone = 0;
const startTime = Date.now();
let lastCheckpointTime = Date.now();

// Buffer lines in memory; flush with a SYNCHRONOUS append before writing the
// checkpoint, so the checkpoint can never claim more progress is durable on
// disk than actually is. Sync I/O costs some throughput but is the only way
// to guarantee no silent data loss if the process is killed mid-run --
// correctness matters far more than speed for an unsupervised multi-hour job.
let bufPeriodic = [], bufNonTiler = [], bufCandidates = [], bufSkipped = [];

function flushBuffers() {
  if (bufPeriodic.length) { fs.appendFileSync(periodicPath, bufPeriodic.join('')); bufPeriodic = []; }
  if (bufNonTiler.length) { fs.appendFileSync(nonTilerPath, bufNonTiler.join('')); bufNonTiler = []; }
  if (bufCandidates.length) { fs.appendFileSync(candidatesPath, bufCandidates.join('')); bufCandidates = []; }
  if (bufSkipped.length) { fs.appendFileSync(skippedPath, bufSkipped.join('')); bufSkipped = []; }
}

function checkpoint(finalCode, done) {
  flushBuffers(); // MUST happen before the checkpoint write, and be synchronous
  fs.writeFileSync(checkpointPath, JSON.stringify({ lastCompletedCode: finalCode, shapesDone, counts, done: !!done }));
}

let ranAnyIterations = false;
for (let code = resumeFromCode; code < totalSubtypeSpace; code += numWorkers) {
  ranAnyIterations = true;
  let c = code;
  const flat = new Array(3 * n);
  for (let j = 0; j < 3 * n; j++) { flat[j] = c % 9; c = (c / 9) | 0; }

  const canonicalSubtype = findCanonicalSubtypeFast(flat, n);
  if (compareArrays(flat, canonicalSubtype) === 0) {
    const stabilizer = computeStabilizer(canonicalSubtype, n);
    for (const tiles of enumerateFlavoredForSubtype(canonicalSubtype, n, stabilizer)) {
      const result = classify(tiles, reflectableFlags, { patchBudget, torusBudget });
      const record = tilesetRecord(tiles);
      if (result.status === 'periodic') { counts.periodic++; bufPeriodic.push(JSON.stringify({ ...record, patch: result.patch }) + '\n'); }
      else if (result.status === 'non-tiler') { counts.nonTiler++; bufNonTiler.push(JSON.stringify(record) + '\n'); }
      else if (result.status === 'skipped') { counts.skipped++; bufSkipped.push(JSON.stringify({ ...record, ...result }) + '\n'); }
      else { counts.candidate++; bufCandidates.push(JSON.stringify({ ...record, ...result }) + '\n'); }
      shapesDone++;
    }
  }

  const isLastCode = code + numWorkers >= totalSubtypeSpace;
  if (Date.now() - lastCheckpointTime > 5000 || isLastCode) {
    lastCheckpointTime = Date.now();
    checkpoint(code, isLastCode);
    const codesScanned = Math.floor((code - workerId) / numWorkers) + 1;
    parentPort.postMessage({
      workerId, counts, shapesDone,
      codesScanned, totalCodesForWorker,
      elapsedMs: Date.now() - startTime,
      done: isLastCode,
    });
  }
}

// Two edge cases where the main loop above never executes even once, both
// of which MUST still send a final checkpoint/postMessage or main.js hangs
// forever waiting for a 'done' message from this worker that will never
// arrive:
//   1. totalCodesForWorker === 0 (workerId >= totalSubtypeSpace -- only
//      possible if numWorkers exceeds the total space; practically never
//      for n=1..3, handled for robustness). No checkpoint file could exist
//      yet in this case, so one is written here.
//   2. resumeFromCode >= totalSubtypeSpace on entry: this worker had
//      ALREADY finished every code assigned to it in an earlier invocation
//      (its checkpoint already says done, or its lastCompletedCode was
//      already its final one), and this run only exists because some
//      OTHER worker hadn't finished yet. Found 2026-09-28: previously this
//      case had NO fallback at all -- if every worker happened to already
//      be done when main.js was re-launched (e.g. a run killed at exactly
///     the wrong moment after all workers finished internally but before
//      main.js registered all 8 'done' messages), EVERY worker would hit
//      this silently and main.js would wait forever for messages that were
//      never going to come. The existing checkpoint file is already
//      correct in this case, so nothing new needs to be persisted --
//      only the postMessage was missing.
if (!ranAnyIterations) {
  if (totalCodesForWorker === 0) {
    checkpoint(workerId - numWorkers, true);
  }
  parentPort.postMessage({ workerId, counts, shapesDone, codesScanned: totalCodesForWorker, totalCodesForWorker, elapsedMs: Date.now() - startTime, done: true });
}
