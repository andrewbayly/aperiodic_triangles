'use strict';
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { torusFeasible } = require('./solver.js');
const { extractPatchRecord } = require('./classify.js');

const { tasks, candidates, workerId, budget, perAttemptTimeoutMs, outputDir } = workerData;

const periodicPath = path.join(outputDir, `resolved_periodic_w${workerId}.jsonl`);
const allResultsPath = path.join(outputDir, `all_results_w${workerId}.jsonl`);
const checkpointPath = path.join(outputDir, `checkpoint_w${workerId}.json`);

const doneKeys = [];
function checkpoint() {
  fs.writeFileSync(checkpointPath, JSON.stringify({ done: doneKeys }));
}

let confirmedPeriodic = 0;
// track which candidateIdx values have already been confirmed periodic in
// THIS worker's run, so we don't keep re-testing a candidate's other sizes
// once it's resolved (a genuine, if modest, efficiency gain given several
// tasks can share the same candidateIdx).
const resolvedCandidates = new Set();

for (let i = 0; i < tasks.length; i++) {
  const { candidateIdx, P, Q } = tasks[i];
  const key = `${candidateIdx}_${P}_${Q}`;

  if (resolvedCandidates.has(candidateIdx)) {
    doneKeys.push(key);
    parentPort.postMessage({ type: 'progress', done: i + 1 });
    continue;
  }

  const record = candidates[candidateIdx];
  const result = torusFeasible(record.tiles, record.reflectableFlags, P, Q, { budget, timeoutMs: perAttemptTimeoutMs });

  fs.appendFileSync(allResultsPath, JSON.stringify({ candidateIdx, tiles: record.tiles, P, Q, result: result.result }) + '\n');

  if (result.result === true) {
    const patch = extractPatchRecord(record.tiles, record.reflectableFlags, result, P, Q);
    fs.appendFileSync(periodicPath, JSON.stringify({ candidateIdx, n: record.n, reflectableFlags: record.reflectableFlags, tiles: record.tiles, patch, resolvedAtSize: `${P}x${Q}` }) + '\n');
    confirmedPeriodic++;
    resolvedCandidates.add(candidateIdx);
  }

  doneKeys.push(key);
  checkpoint();
  parentPort.postMessage({ type: 'progress', done: i + 1 });
}

checkpoint();
parentPort.postMessage({ type: 'done', confirmedPeriodic });
