'use strict';
// End-to-end resolution pipeline for a bucket of chiral/mixed n=3 tilesets:
// for each record, cascades through fast classify() -> sheared-lattice
// periodicity sweep -> vertex-star filter -> SAT patch-infeasibility, and
// writes exactly one of periodic / non-tiler / still-unresolved, tagged
// with which stage resolved it. Resumable via per-worker checkpoints.
//
// REQUIRES a compiled CaDiCaL binary (stage 4). Build once:
//   git clone --depth 1 https://github.com/arminbiere/cadical.git
//   cd cadical && ./configure && make -j4
//   (binary ends up at cadical/build/cadical)
//
// Usage:
//   node split_lines_roundrobin.js bucket0_all.jsonl 8 chunks/bucket0
//   node full_resolve_multicore.js --chunk-prefix chunks/bucket0 --workers 8 \
//       --output resolve_output/bucket0 --default-flags false,false,false \
//       --cadical-bin /path/to/cadical/build/cadical
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

function parseArgs() {
  const args = process.argv.slice(2);
  const o = {
    chunkPrefix: null, workers: 8, output: './resolve_output', defaultFlags: null,
    patchBudget: 2_000_000, torusBudget: 300_000,
    shearedMaxIndex: 40, shearedBudget: 300_000,
    satMaxRadius: 25, cadicalBin: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--chunk-prefix') o.chunkPrefix = args[++i];
    else if (a === '--workers') o.workers = parseInt(args[++i], 10);
    else if (a === '--output') o.output = args[++i];
    else if (a === '--default-flags') o.defaultFlags = args[++i].split(',').map(s => s.trim() === 'true');
    else if (a === '--patch-budget') o.patchBudget = parseInt(args[++i], 10);
    else if (a === '--torus-budget') o.torusBudget = parseInt(args[++i], 10);
    else if (a === '--sheared-max-index') o.shearedMaxIndex = parseInt(args[++i], 10);
    else if (a === '--sheared-budget') o.shearedBudget = parseInt(args[++i], 10);
    else if (a === '--sat-max-radius') o.satMaxRadius = parseInt(args[++i], 10);
    else if (a === '--cadical-bin') o.cadicalBin = args[++i];
  }
  if (!o.chunkPrefix) { console.error('--chunk-prefix is required'); process.exit(1); }
  if (!o.cadicalBin || !fs.existsSync(o.cadicalBin)) {
    console.error(`ERROR: --cadical-bin must point to a compiled CaDiCaL binary (got: ${o.cadicalBin})`);
    console.error('Build it with: git clone --depth 1 https://github.com/arminbiere/cadical.git && cd cadical && ./configure && make -j4');
    process.exit(1);
  }
  return o;
}

const opts = parseArgs();
fs.mkdirSync(opts.output, { recursive: true });

let done = 0;
const totals = { periodic: 0, nonTiler: 0, unresolved: 0 };
const stageTotals = { fastPeriodic: 0, fastNonTiler: 0, shearedPeriodic: 0, vertexStarNonTiler: 0, satNonTiler: 0 };
const t0 = Date.now();

for (let w = 0; w < opts.workers; w++) {
  const chunkPath = `${opts.chunkPrefix}_${w}.jsonl`;
  const worker = new Worker(path.join(__dirname, 'full_resolve_worker.js'), {
    workerData: {
      chunkPath, outputDir: opts.output, workerId: w, defaultReflectableFlags: opts.defaultFlags,
      patchBudget: opts.patchBudget, torusBudget: opts.torusBudget,
      shearedMaxIndex: opts.shearedMaxIndex, shearedBudget: opts.shearedBudget,
      satMaxRadius: opts.satMaxRadius, cadicalBin: opts.cadicalBin,
    },
  });
  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      const el = msg.elapsedMs / 1000;
      console.log(`[${el.toFixed(0)}s] worker ${msg.workerId}: ${msg.shapesDone} done (line ${msg.lineNum}) -> ${JSON.stringify(msg.counts)} | stages: ${JSON.stringify(msg.stageCounts)}`);
    } else if (msg.type === 'done') {
      console.log(`worker ${msg.workerId} FINISHED: ${msg.shapesDone} done -> ${JSON.stringify(msg.counts)}`);
      for (const k of ['periodic', 'nonTiler', 'unresolved']) totals[k] += msg.counts[k];
      for (const k of Object.keys(stageTotals)) stageTotals[k] += msg.stageCounts[k];
      done++;
      if (done === opts.workers) {
        const el = (Date.now() - t0) / 1000;
        console.log(`\nAll ${opts.workers} workers done in ${el.toFixed(1)}s.`);
        console.log('Totals:', JSON.stringify(totals));
        console.log('By stage:', JSON.stringify(stageTotals));
      }
    }
  });
  worker.on('error', (err) => { console.error('worker', w, 'error:', err); process.exit(1); });
}
