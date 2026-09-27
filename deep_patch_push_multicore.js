'use strict';
// ============================================================================
// Multi-core deep patch push, parallelized by (TILESET, SIZE) PAIR rather
// than by tileset -- with only a handful of tilesets left, assigning whole
// tilesets to workers (each trying sizes sequentially) wastes most of the
// available cores. This distributes every (tileset, size) attempt as its
// own independent task.
//
// Unlike the torus case, patch sizes have no clean algebraic pre-filter
// (an open boundary can absorb some p/q imbalance, so the ratio constraint
// only becomes binding asymptotically, not via strict divisibility) -- so
// this simply tries a size range with a large budget, same mechanism as
// deep_patch_push.js, just re-parallelized for few-tileset efficiency.
//
// Per-node cost was measured to drop sharply with patch size (9.6M/s at
// 32 positions down to 0.85M/s at 288 positions), so time per attempt
// grows much faster than linearly with size -- see the conversation for
// concrete estimates before choosing --budget and --max-size.
// ============================================================================
const { Worker } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    input: null, output: './deep_patch_multicore_output', workers: os.cpus().length,
    minSize: null, maxSize: 12, budget: 1_000_000_000, perAttemptTimeoutMs: 30 * 60_000,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input') opts.input = args[++i];
    else if (a === '--output') opts.output = args[++i];
    else if (a === '--workers') opts.workers = parseInt(args[++i], 10);
    else if (a === '--min-size') opts.minSize = parseInt(args[++i], 10);
    else if (a === '--max-size') opts.maxSize = parseInt(args[++i], 10);
    else if (a === '--budget') opts.budget = parseInt(args[++i], 10);
    else if (a === '--per-attempt-timeout-min') opts.perAttemptTimeoutMs = parseInt(args[++i], 10) * 60_000;
    else if (a === '--help') { printHelp(); process.exit(0); }
  }
  if (!opts.input) { console.error('--input is required: a candidates .jsonl file'); process.exit(1); }
  return opts;
}

function printHelp() {
  console.log(`
Multi-core deep patch push, parallelized by (tileset, size) pair.

Usage: node deep_patch_push_multicore.js --input <candidates.jsonl> [options]

Options:
  --input <path>                  Candidates .jsonl file (required)
  --output <dir>                  Output directory
  --workers <int>                 Worker threads (default: CPU count)
  --min-size <int>                First size to try (default: each
                                   tileset's own knownFeasibleAt/patchFeasibleAt + 1)
  --max-size <int>                Largest patch dimension WxW (default: 12)
  --budget <int>                  Backtracking node budget per attempt
                                   (default: 1,000,000,000)
  --per-attempt-timeout-min <int> Wall-clock cap per attempt in minutes
                                   (default: 30)

Resuming: rerun the same command with the same --output.

Output (in --output), one set per worker:
  confirmed_non_tiler_w<id>.jsonl  a size proved infeasible -- genuine non-tiler
  all_results_w<id>.jsonl          every (tileset, size) attempt's result
  checkpoint_w<id>.json            resumability state
`);
}

function parseKnownSize(record) {
  const str = record.patchFeasibleAt || record.knownFeasibleAt;
  if (!str) return 3;
  const m = /^(\d+)x(\d+)$/.exec(str);
  return m ? parseInt(m[1], 10) : 3;
}

function main() {
  const opts = parseArgs();
  fs.mkdirSync(opts.output, { recursive: true });

  const records = fs.readFileSync(opts.input, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.log(`Loaded ${records.length} tilesets`);

  const tasks = [];
  records.forEach((record, tilesetIdx) => {
    const knownSize = parseKnownSize(record);
    const firstSize = opts.minSize || (knownSize + 1);
    for (let size = firstSize; size <= opts.maxSize; size++) tasks.push({ tilesetIdx, size });
  });
  // smallest (cheapest) first
  tasks.sort((a, b) => a.size - b.size);
  console.log(`Total (tileset, size) attempts: ${tasks.length}`);
  console.log(`Budget: ${opts.budget.toLocaleString()} nodes/attempt, timeout ${opts.perAttemptTimeoutMs / 60000}min/attempt`);
  console.log(`Output directory: ${path.resolve(opts.output)}\n`);

  const doneKeys = new Set();
  if (fs.existsSync(opts.output)) {
    for (const fname of fs.readdirSync(opts.output)) {
      if (!/^checkpoint_w\d+\.json$/.test(fname)) continue;
      try {
        const cp = JSON.parse(fs.readFileSync(path.join(opts.output, fname), 'utf8'));
        for (const k of (cp.done || [])) doneKeys.add(k);
      } catch (e) { /* corrupt, ignore */ }
    }
  }
  const taskKey = (t) => `${t.tilesetIdx}_${t.size}`;
  const remaining = tasks.filter(t => !doneKeys.has(taskKey(t)));
  console.log(`${tasks.length - remaining.length} already completed (resuming), ${remaining.length} remaining\n`);

  if (remaining.length === 0) { console.log('Nothing left to do.'); return; }

  const numWorkers = Math.min(opts.workers, remaining.length);
  const chunkSize = Math.ceil(remaining.length / numWorkers);
  const chunks = [];
  for (let i = 0; i < remaining.length; i += chunkSize) chunks.push(remaining.slice(i, i + chunkSize));

  let finished = 0;
  const startTime = Date.now();
  const progress = chunks.map(c => ({ done: 0, total: c.length, current: null }));

  chunks.forEach((chunk, workerId) => {
    const w = new Worker(path.join(__dirname, 'deep_patch_push_multicore_worker.js'), {
      workerData: { tasks: chunk, records, workerId, budget: opts.budget, perAttemptTimeoutMs: opts.perAttemptTimeoutMs, outputDir: opts.output },
    });
    w.on('message', (msg) => {
      if (msg.type === 'progress') progress[workerId].done = msg.done;
      if (msg.type === 'attempt') progress[workerId].current = `T${msg.tilesetIdx}@${msg.size}x${msg.size}`;
      if (msg.type === 'done') {
        finished++;
        console.log(`Worker ${workerId} finished its chunk.`);
        if (finished === chunks.length) {
          console.log(`\nAll workers finished in ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes.`);
          process.exit(0);
        }
      }
    });
    w.on('error', (err) => console.error(`Worker ${workerId} error:`, err));
  });

  setInterval(() => {
    const doneCount = progress.reduce((s, p) => s + p.done, 0);
    const total = progress.reduce((s, p) => s + p.total, 0);
    const active = progress.map((p, i) => p.current ? `w${i}:${p.current}` : null).filter(Boolean).join(' ');
    console.log(`[${((Date.now() - startTime) / 1000 / 60).toFixed(1)}min] ${doneCount}/${total} attempts done${active ? ' | running: ' + active : ''}`);
  }, 15_000);
}

main();
