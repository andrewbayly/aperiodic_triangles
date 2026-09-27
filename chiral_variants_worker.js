'use strict';
const fs = require('fs');
const readline = require('readline');
const { parentPort, workerData } = require('worker_threads');
const { canonicalFull } = require('./canonical_full.js');

const { chunkPath, outputDir, workerId } = workerData;

// All 7 nonempty subsets of {0,1,2} to mark chiral, as flag arrays.
const VARIANT_FLAGS = [
  [false, true, true], [true, false, true], [true, true, false],
  [false, false, true], [false, true, false], [true, false, false],
  [false, false, false],
];

(async () => {
  const outs = { 0: fs.createWriteStream(`${outputDir}/bucket0_w${workerId}.jsonl`),
                 1: fs.createWriteStream(`${outputDir}/bucket1_w${workerId}.jsonl`),
                 2: fs.createWriteStream(`${outputDir}/bucket2_w${workerId}.jsonl`) };
  const counts = { 0: 0, 1: 0, 2: 0 };
  let parentsProcessed = 0;

  if (fs.existsSync(chunkPath)) {
    const rl = readline.createInterface({ input: fs.createReadStream(chunkPath, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const { tiles } = JSON.parse(line);
      const seenKeys = new Set(); // within-THIS-parent dedup only (≤7 items)
      for (const flags of VARIANT_FLAGS) {
        const { key, tiles: canonTiles, reflectableFlags: canonFlags } = canonicalFull(tiles, flags, { sigma: true, rho: true });
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const nRefl = canonFlags.filter(Boolean).length;
        const ok = outs[nRefl].write(JSON.stringify({ tiles: canonTiles, reflectableFlags: canonFlags }) + '\n');
        counts[nRefl]++;
        if (!ok) await new Promise(res => outs[nRefl].once('drain', res));
      }
      parentsProcessed++;
      if (parentsProcessed % 200_000 === 0) parentPort.postMessage({ type: 'progress', workerId, parentsProcessed, counts });
    }
  }
  await Promise.all(Object.values(outs).map(o => new Promise(res => o.end(res))));
  parentPort.postMessage({ type: 'done', workerId, parentsProcessed, counts });
})();
