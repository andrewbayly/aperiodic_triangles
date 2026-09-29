'use strict';
// Batch DRAT-proof generation + drat-trim verification for every SAT
// patch-infeasibility non-tiler certificate. See gather_sat_certificates.js
// for how the input file (one record per sat-patch-resolved tileset) is
// produced, and verify_sat_certificates_worker.js for how each record is
// checked. Same worker-threads/checkpoint/resumability shape as
// full_resolve_multicore.js.
//
// REQUIRES compiled CaDiCaL and drat-trim binaries. Build once:
//   CaDiCaL:    git clone --depth 1 https://github.com/arminbiere/cadical.git
//               cd cadical && ./configure && make -j4
//   drat-trim:  git clone --depth 1 https://github.com/marijnheule/drat-trim.git
//               cd drat-trim && make
//
// Usage:
//   node gather_sat_certificates.js working/09_certificates/sat_patch_records.jsonl
//   node split_lines_roundrobin.js working/09_certificates/sat_patch_records.jsonl 8 \
//       working/09_certificates/chunks/c
//   node verify_sat_certificates_multicore.js --chunk-prefix working/09_certificates/chunks/c \
//       --workers 8 --output working/09_certificates/verify_output \
//       --cadical-bin /path/to/cadical/build/cadical \
//       --drat-trim-bin /path/to/drat-trim/drat-trim
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

function parseArgs() {
  const args = process.argv.slice(2);
  const o = { chunkPrefix: null, workers: 8, output: './verify_output', cadicalBin: null, dratTrimBin: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--chunk-prefix') o.chunkPrefix = args[++i];
    else if (a === '--workers') o.workers = parseInt(args[++i], 10);
    else if (a === '--output') o.output = args[++i];
    else if (a === '--cadical-bin') o.cadicalBin = args[++i];
    else if (a === '--drat-trim-bin') o.dratTrimBin = args[++i];
  }
  if (!o.chunkPrefix) { console.error('--chunk-prefix is required'); process.exit(1); }
  if (!o.cadicalBin || !fs.existsSync(o.cadicalBin)) {
    console.error(`ERROR: --cadical-bin must point to a compiled CaDiCaL binary (got: ${o.cadicalBin})`);
    process.exit(1);
  }
  if (!o.dratTrimBin || !fs.existsSync(o.dratTrimBin)) {
    console.error(`ERROR: --drat-trim-bin must point to a compiled drat-trim binary (got: ${o.dratTrimBin})`);
    console.error('Build it with: git clone --depth 1 https://github.com/marijnheule/drat-trim.git && cd drat-trim && make');
    process.exit(1);
  }
  return o;
}

const opts = parseArgs();
fs.mkdirSync(opts.output, { recursive: true });

let done = 0;
const totals = { verified: 0, failed: 0 };
const t0 = Date.now();

// If there are fewer chunk files than --workers (e.g. very few sat-patch
// records total), only spin up workers for chunks that actually exist.
let numWorkers = 0;
for (let w = 0; w < opts.workers; w++) {
  if (fs.existsSync(`${opts.chunkPrefix}_${w}.jsonl`)) numWorkers++;
}
if (numWorkers === 0) {
  console.log('No chunk files found -- nothing to verify.');
  process.exit(0);
}

for (let w = 0; w < opts.workers; w++) {
  const chunkPath = `${opts.chunkPrefix}_${w}.jsonl`;
  if (!fs.existsSync(chunkPath)) continue;
  const worker = new Worker(path.join(__dirname, 'verify_sat_certificates_worker.js'), {
    workerData: { chunkPath, outputDir: opts.output, workerId: w, cadicalBin: opts.cadicalBin, dratTrimBin: opts.dratTrimBin },
  });
  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      console.log(`[${(msg.elapsedMs / 1000).toFixed(0)}s] worker ${msg.workerId}: ${msg.recordsDone} done (line ${msg.lineNum}) -> ${JSON.stringify(msg.counts)}`);
    } else if (msg.type === 'done') {
      console.log(`worker ${msg.workerId} FINISHED: ${msg.recordsDone} done -> ${JSON.stringify(msg.counts)}`);
      for (const k of ['verified', 'failed']) totals[k] += msg.counts[k];
      done++;
      if (done === numWorkers) {
        console.log(`\nAll ${numWorkers} workers done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
        console.log('Totals:', JSON.stringify(totals));
      }
    }
  });
  worker.on('error', (err) => { console.error('worker', w, 'error:', err); process.exit(1); });
}
