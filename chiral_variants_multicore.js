'use strict';
// Generate all distinct chiral/mixed variants of a list of all-reflectable
// periodic parents (one line per parent, {tiles,...}), bucketed by
// resulting reflectable-tile-count (0, 1, or 2). Relies on the proven fact
// that distinct parents (already deduped under the all-reflectable group)
// can never collide into the same variant, so no cross-parent dedup is
// needed -- each parent's ≤7 variants are deduped against each other only.
//
// Usage:
//   node split_lines_roundrobin.js all_n3_periodic_parents.jsonl 8 chunks/parent
//   node chiral_variants_multicore.js --chunk-prefix chunks/parent --workers 8 --output variant_output
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

function parseArgs() {
  const args = process.argv.slice(2);
  const o = { chunkPrefix: null, workers: 8, output: './variant_output' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--chunk-prefix') o.chunkPrefix = args[++i];
    else if (a === '--workers') o.workers = parseInt(args[++i], 10);
    else if (a === '--output') o.output = args[++i];
  }
  if (!o.chunkPrefix) { console.error('--chunk-prefix is required (see split_lines_roundrobin.js)'); process.exit(1); }
  return o;
}

const opts = parseArgs();
fs.mkdirSync(opts.output, { recursive: true });

let done = 0;
const totals = { 0: 0, 1: 0, 2: 0 };
const t0 = Date.now();

for (let w = 0; w < opts.workers; w++) {
  const chunkPath = `${opts.chunkPrefix}_${w}.jsonl`;
  const worker = new Worker(path.join(__dirname, 'chiral_variants_worker.js'), {
    workerData: { chunkPath, outputDir: opts.output, workerId: w },
  });
  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      const el = (Date.now() - t0) / 1000;
      console.log(`[${el.toFixed(0)}s] worker ${msg.workerId}: ${msg.parentsProcessed} parents -> buckets ${JSON.stringify(msg.counts)}`);
    } else if (msg.type === 'done') {
      console.log(`worker ${msg.workerId} FINISHED: ${msg.parentsProcessed} parents -> ${JSON.stringify(msg.counts)}`);
      for (const k of [0, 1, 2]) totals[k] += msg.counts[k];
      done++;
      if (done === opts.workers) {
        const el = (Date.now() - t0) / 1000;
        console.log(`\nAll ${opts.workers} workers done in ${el.toFixed(1)}s.`);
        console.log('Totals: 0-reflectable(all-chiral)=', totals[0], ' 1-reflectable=', totals[1], ' 2-reflectable=', totals[2]);
        console.log(`Next: cat ${opts.output}/bucket0_w*.jsonl > ${opts.output}/bucket0_all.jsonl  (and similarly for bucket1, bucket2)`);
      }
    }
  });
  worker.on('error', (err) => { console.error('worker', w, 'error:', err); process.exit(1); });
}
