'use strict';
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { classify } = require('./classify.js');
const { hasDuplicateTile, sameUpToRotation } = require('./duplicate_tile_check.js');

const { candidates, workerId, patchBudget, torusBudget, outputDir } = workerData;

const resolvedDupPath = path.join(outputDir, `resolved_via_duplicate_w${workerId}.jsonl`);
const resolvedReclassifyPath = path.join(outputDir, `resolved_via_reclassify_w${workerId}.jsonl`);
const stillCandidatePath = path.join(outputDir, `still_candidate_w${workerId}.jsonl`);
const checkpointPath = path.join(outputDir, `checkpoint_w${workerId}.json`);

// Resumability: skip candidates already processed by this worker in a
// prior run. Since a candidate's position in `candidates` is stable for a
// given input file + worker split, we track how many this worker has
// completed and resume from there.
let startIdx = 0;
if (fs.existsSync(checkpointPath)) {
  try {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (typeof cp.completedCount === 'number') startIdx = cp.completedCount;
  } catch (e) { /* corrupt checkpoint, start over */ }
}

function reduceTileset(tiles, reflectableFlags) {
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (sameUpToRotation(tiles[i], tiles[j])) {
        const dropIdx = (reflectableFlags[i] !== reflectableFlags[j])
          ? (reflectableFlags[i] ? j : i)
          : j;
        return { tiles: tiles.filter((_, k) => k !== dropIdx), reflectableFlags: reflectableFlags.filter((_, k) => k !== dropIdx) };
      }
    }
  }
  return null;
}

let dupResolved = 0, reclassified = 0, stillStuck = 0;
let lastCheckpointTime = Date.now();

function checkpoint(completedCount) {
  fs.writeFileSync(checkpointPath, JSON.stringify({ completedCount }));
}

for (let i = startIdx; i < candidates.length; i++) {
  const { n, reflectableFlags, tiles } = candidates[i];

  if (hasDuplicateTile(tiles, reflectableFlags)) {
    const reduced = reduceTileset(tiles, reflectableFlags);
    const reducedResult = classify(reduced.tiles, reduced.reflectableFlags, { patchBudget, torusBudget });
    dupResolved++;
    fs.appendFileSync(resolvedDupPath, JSON.stringify({ n, reflectableFlags, tiles, resolvedStatus: reducedResult.status, viaReducedTileset: reduced }) + '\n');
  } else {
    const result = classify(tiles, reflectableFlags, { patchBudget, torusBudget });
    if (result.status === 'periodic' || result.status === 'non-tiler') {
      reclassified++;
      fs.appendFileSync(resolvedReclassifyPath, JSON.stringify({ n, reflectableFlags, tiles, ...result }) + '\n');
    } else {
      stillStuck++;
      fs.appendFileSync(stillCandidatePath, JSON.stringify({ n, reflectableFlags, tiles, ...result }) + '\n');
    }
  }

  if (Date.now() - lastCheckpointTime > 5000 || i === candidates.length - 1) {
    lastCheckpointTime = Date.now();
    checkpoint(i + 1);
    parentPort.postMessage({ type: 'progress', done: i + 1 - startIdx + startIdx });
  }
}

parentPort.postMessage({ type: 'done', dupResolved, reclassified, stillStuck });
