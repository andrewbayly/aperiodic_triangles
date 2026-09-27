'use strict';
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { patchFeasible } = require('./solver.js');

const { tasks, records, workerId, budget, perAttemptTimeoutMs, outputDir } = workerData;

const confirmedPath = path.join(outputDir, `confirmed_non_tiler_w${workerId}.jsonl`);
const allResultsPath = path.join(outputDir, `all_results_w${workerId}.jsonl`);
const checkpointPath = path.join(outputDir, `checkpoint_w${workerId}.json`);

const doneKeys = [];
function checkpoint() {
  fs.writeFileSync(checkpointPath, JSON.stringify({ done: doneKeys }));
}

for (let i = 0; i < tasks.length; i++) {
  const { tilesetIdx, size } = tasks[i];
  const record = records[tilesetIdx];
  parentPort.postMessage({ type: 'attempt', workerId, tilesetIdx, size });

  const start = Date.now();
  const result = patchFeasible(record.tiles, record.reflectableFlags, size, size, { budget, timeoutMs: perAttemptTimeoutMs });
  const elapsedMs = Date.now() - start;

  fs.appendFileSync(allResultsPath, JSON.stringify({ tilesetIdx, tiles: record.tiles, size, result: result.result, elapsedMs }) + '\n');

  if (result.result === false) {
    fs.appendFileSync(confirmedPath, JSON.stringify({ tilesetIdx, n: record.n, reflectableFlags: record.reflectableFlags, tiles: record.tiles, infeasibleAtSize: `${size}x${size}` }) + '\n');
  }

  doneKeys.push(`${tilesetIdx}_${size}`);
  checkpoint();
  parentPort.postMessage({ type: 'progress', done: i + 1 });
}

parentPort.postMessage({ type: 'done' });
