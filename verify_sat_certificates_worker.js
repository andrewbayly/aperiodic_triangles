'use strict';
// For each gathered SAT patch-infeasibility record, rebuild the EXACT SAME
// CNF trySatPatch() (full_resolve_worker.js) found UNSAT for -- same
// generatePlacements/viablePlacements/hexPatchGraph/buildCnf call at the
// record's own stored radius, no need to re-search radii, since
// infeasibility at any single patch size is already an unconditional proof
// of non-existence (see classify.js's PATCH_BATTERY comment for the same
// argument at the classify() stage). This time, ask CaDiCaL for a DRAT
// proof instead of just a verdict, then check that proof with drat-trim.
//
// A record with radius 0 means viablePlacements() already returned empty
// (no placement survives arc-consistency at all) -- trySatPatch() resolved
// that case WITHOUT ever building a CNF, so there's no SAT instance to
// prove UNSAT about. Recorded as verified-by-construction, no proof file.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { workerData, parentPort } = require('worker_threads');
const { hexPatchGraph, generatePlacements, viablePlacements, buildCnf, writeDimacs, runCadical, verifyDrat } = require('./js_sat_bridge.js');

const { chunkPath, outputDir, workerId, cadicalBin, dratTrimBin } = workerData;

const verifiedPath = path.join(outputDir, `verified_w${workerId}.jsonl`);
const failedPath = path.join(outputDir, `failed_w${workerId}.jsonl`);
const checkpointPath = path.join(outputDir, `checkpoint_w${workerId}.json`);
const proofsDir = path.join(outputDir, 'proofs', `w${workerId}`);
fs.mkdirSync(proofsDir, { recursive: true });
const scratchCnf = path.join(outputDir, `scratch_w${workerId}.cnf`);

let resumeFromLine = 0;
let counts = { verified: 0, failed: 0 };
if (fs.existsSync(checkpointPath)) {
  try {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (typeof cp.linesCompleted === 'number') { resumeFromLine = cp.linesCompleted; counts = cp.counts; }
  } catch (e) { /* corrupt checkpoint, start over */ }
}

let bufVerified = [], bufFailed = [];
function flushBuffers() {
  if (bufVerified.length) { fs.appendFileSync(verifiedPath, bufVerified.join('')); bufVerified = []; }
  if (bufFailed.length) { fs.appendFileSync(failedPath, bufFailed.join('')); bufFailed = []; }
}
function checkpoint(linesCompleted, done) {
  flushBuffers();
  fs.writeFileSync(checkpointPath, JSON.stringify({ linesCompleted, counts, done: !!done }));
}

(async () => {
  let lineNum = 0, recordsDone = 0;
  const startTime = Date.now();
  let lastCheckpointTime = Date.now();

  if (fs.existsSync(chunkPath)) {
    const rl = readline.createInterface({ input: fs.createReadStream(chunkPath, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      lineNum++;
      if (lineNum <= resumeFromLine) continue;

      const rec = JSON.parse(line);
      const { tiles, reflectableFlags: flags, radius } = rec;

      if (radius === 0) {
        bufVerified.push(JSON.stringify({ ...rec, status: 'trivially-unsat', proofPath: null }) + '\n');
        counts.verified++;
      } else {
        const raw = generatePlacements(tiles, flags);
        const V = viablePlacements(raw);
        const { nU, nD, edges } = hexPatchGraph(radius);
        const { numVars, clauses } = buildCnf(V, nU, nD, edges);
        writeDimacs(numVars, clauses, scratchCnf);
        const proofPath = path.join(proofsDir, `proof_${lineNum}.drat`);
        const res = runCadical(cadicalBin, scratchCnf, { proofPath });

        if (res.status !== 'UNSAT') {
          bufFailed.push(JSON.stringify({ ...rec, error: `cadical reported ${res.status}, expected UNSAT`, numVars, numClauses: clauses.length }) + '\n');
          counts.failed++;
        } else {
          const v = verifyDrat(dratTrimBin, scratchCnf, proofPath);
          if (!v.verified) {
            bufFailed.push(JSON.stringify({ ...rec, error: 'drat-trim did not verify the proof', numVars, numClauses: clauses.length, proofPath }) + '\n');
            counts.failed++;
          } else {
            bufVerified.push(JSON.stringify({ ...rec, status: 'verified', numVars, numClauses: clauses.length, proofPath }) + '\n');
            counts.verified++;
          }
        }
      }

      recordsDone++;
      if (Date.now() - lastCheckpointTime > 10000) {
        lastCheckpointTime = Date.now();
        checkpoint(lineNum, false);
        parentPort.postMessage({ type: 'progress', workerId, lineNum, recordsDone, counts, elapsedMs: Date.now() - startTime });
      }
    }
  }
  checkpoint(lineNum, true);
  parentPort.postMessage({ type: 'done', workerId, lineNum, recordsDone, counts, elapsedMs: Date.now() - startTime });
})();
