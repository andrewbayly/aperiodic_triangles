'use strict';
// ============================================================================
// Multi-core version of reprocess_candidates.js. The single-threaded version
// turned out far slower than expected -- candidates are, by definition, the
// hardest shapes in the whole dataset (each one already survived the FULL
// original battery, ~6 patch sizes + ~35 torus sizes, without resolving),
// so reprocessing 17,822 of them sequentially, even with the faster solver,
// was projected at ~14 hours. This parallelizes across workers and adds
// resumability, since even divided across 8 cores this could still take a
// meaningful amount of time if a real fraction of candidates are genuinely
// hard for the search to resolve either way.
// ============================================================================
const { Worker } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: null, output: './reprocessed_output', workers: os.cpus().length, patchBudget: 2_000_000, torusBudget: 300_000 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input') opts.input = args[++i];
    else if (a === '--output') opts.output = args[++i];
    else if (a === '--workers') opts.workers = parseInt(args[++i], 10);
    else if (a === '--patch-budget') opts.patchBudget = parseInt(args[++i], 10);
    else if (a === '--torus-budget') opts.torusBudget = parseInt(args[++i], 10);
    else if (a === '--help') { printHelp(); process.exit(0); }
  }
  if (!opts.input) { console.error('--input is required: an aperiodic_candidates .jsonl file (or merged file)'); process.exit(1); }
  return opts;
}

function printHelp() {
  console.log(`
Multi-core reprocessing of existing candidates through the updated pipeline.

Usage: node reprocess_candidates_multicore.js --input <candidates.jsonl> [options]

Options:
  --input <path>         Candidates .jsonl file (required)
  --output <dir>          Output directory (default: ./reprocessed_output)
  --workers <int>         Worker threads (default: CPU count -- use your
                          performance core count)
  --patch-budget <int>    Patch budget for re-classification (default: 2,000,000)
  --torus-budget <int>    Torus budget for re-classification (default: 300,000)

Resuming: rerun the identical command with the same --output; already-
processed candidates are skipped via per-worker checkpoint files.

Output (in --output), one set per worker:
  resolved_via_duplicate_w<id>.jsonl   duplicate-tile candidates, resolved
                                       by classifying the reduced tileset
  resolved_via_reclassify_w<id>.jsonl  candidates that now resolve with the
                                       updated solver
  still_candidate_w<id>.jsonl          genuinely still unresolved
  checkpoint_w<id>.json                resumability state
`);
}

function main() {
  const opts = parseArgs();
  fs.mkdirSync(opts.output, { recursive: true });

  const candidates = fs.readFileSync(opts.input, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.log(`Loaded ${candidates.length} candidates`);
  console.log(`Workers: ${opts.workers}, patch-budget: ${opts.patchBudget.toLocaleString()}, torus-budget: ${opts.torusBudget.toLocaleString()}`);
  console.log(`Output directory: ${path.resolve(opts.output)}\n`);

  const numWorkers = Math.min(opts.workers, candidates.length);
  const chunkSize = Math.ceil(candidates.length / numWorkers);
  const chunks = [];
  for (let i = 0; i < candidates.length; i += chunkSize) chunks.push(candidates.slice(i, i + chunkSize));

  let finished = 0;
  const startTime = Date.now();
  const progress = chunks.map(c => ({ done: 0, total: c.length }));

  chunks.forEach((chunk, workerId) => {
    const w = new Worker(path.join(__dirname, 'reprocess_candidates_multicore_worker.js'), {
      workerData: { candidates: chunk, workerId, patchBudget: opts.patchBudget, torusBudget: opts.torusBudget, outputDir: opts.output },
    });
    w.on('message', (msg) => {
      if (msg.type === 'progress') progress[workerId].done = msg.done;
      if (msg.type === 'done') {
        finished++;
        console.log(`Worker ${workerId} finished: dup-resolved=${msg.dupResolved}, reclassified=${msg.reclassified}, still stuck=${msg.stillStuck}`);
        if (finished === chunks.length) {
          const totals = { dupResolved: 0, reclassified: 0, stillStuck: 0 };
          // re-read final per-worker counts isn't tracked here across
          // closures; instead sum from files at the end below.
          summarizeAndExit(opts.output, chunks.length, startTime);
        }
      }
    });
    w.on('error', (err) => console.error(`Worker ${workerId} error:`, err));
  });

  setInterval(() => {
    const done = progress.reduce((s, p) => s + p.done, 0);
    const total = progress.reduce((s, p) => s + p.total, 0);
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[${elapsed.toFixed(0)}s] ${done}/${total} candidates processed`);
  }, 10_000);
}

function summarizeAndExit(outputDir, numWorkers, startTime) {
  let dupResolved = 0, reclassified = 0, stillStuck = 0;
  for (let w = 0; w < numWorkers; w++) {
    dupResolved += countLines(path.join(outputDir, `resolved_via_duplicate_w${w}.jsonl`));
    reclassified += countLines(path.join(outputDir, `resolved_via_reclassify_w${w}.jsonl`));
    stillStuck += countLines(path.join(outputDir, `still_candidate_w${w}.jsonl`));
  }
  console.log(`\nAll workers finished in ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes.`);
  console.log(`  Resolved via duplicate-tile reduction: ${dupResolved}`);
  console.log(`  Resolved via reclassification (updated solver): ${reclassified}`);
  console.log(`  Genuinely still candidates: ${stillStuck}`);
  console.log(`  TOTAL still needing further work: ${stillStuck}`);
  process.exit(0);
}

function countLines(p) {
  if (!fs.existsSync(p)) return 0;
  return fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).length;
}

main();
