'use strict';
// ============================================================================
// Targeted torus recheck: rather than sweeping a uniform size range across
// all candidates (expensive at n=3 scale -- 17,708 candidates), this only
// re-checks each candidate's OWN specific torusUnresolved sizes, recorded
// during the original run. Motivation (see conversation): 27.4% of n=3
// candidates have an EMPTY torusUnresolved list (the full battery up to
// 6x6 was already fully conclusive -- definitively not periodic at any
// tested size, not just budget-exhausted), and the average unresolved-list
// length across the rest is only 3.86 -- meaning most candidates have just
// a handful of specific small sizes (all <=6x6, the battery's ceiling)
// left ambiguous, not a broad one. Total real tasks (~68,354) is far
// smaller than any uniform sweep would require.
//
// A resolved "true" here means genuinely periodic (this candidate is
// actually resolved -- promote it out of the candidate pool entirely). A
// resolved "false" is not new information (torus infeasibility at one
// size says nothing about tileability -- see patch vs torus distinction
// from earlier in the investigation) but is still recorded for completeness.
// ============================================================================
const { Worker } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: null, output: './torus_recheck_output', workers: os.cpus().length, budget: 1_000_000, perAttemptTimeoutMs: 60_000 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input') opts.input = args[++i];
    else if (a === '--output') opts.output = args[++i];
    else if (a === '--workers') opts.workers = parseInt(args[++i], 10);
    else if (a === '--budget') opts.budget = parseInt(args[++i], 10);
    else if (a === '--per-attempt-timeout-sec') opts.perAttemptTimeoutMs = parseInt(args[++i], 10) * 1000;
    else if (a === '--help') { printHelp(); process.exit(0); }
  }
  if (!opts.input) { console.error('--input is required'); process.exit(1); }
  return opts;
}

function printHelp() {
  console.log(`
Targeted torus recheck: only each candidate's own unresolved sizes.

Usage: node recheck_torus_unresolved_multicore.js --input <candidates.jsonl> [options]

Options:
  --input <path>                Candidates .jsonl file (required) -- must
                                 have a torusUnresolved field per record
                                 (the standard aperiodic-candidate format)
  --output <dir>                 Output directory
  --workers <int>                Worker threads (default: CPU count)
  --budget <int>                 Torus budget per attempt (default: 1,000,000
                                 -- 3.3x the main pipeline's default 300,000)
  --per-attempt-timeout-sec <int> Wall-clock cap per attempt (default: 60)

Resuming: rerun the identical command with the same --output.

Output (in --output), one set per worker:
  resolved_periodic_w<id>.jsonl   candidates confirmed genuinely periodic --
                                  promote these OUT of the candidate pool.
                                  NOTE: if a candidate's several unresolved
                                  sizes happen to be split across different
                                  workers, it may appear more than once here
                                  (each worker resolves it independently,
                                  unaware of the others) -- deduplicate by
                                  candidateIdx when merging, though this
                                  never affects correctness, only tidiness.
  all_results_w<id>.jsonl         every (candidate, size) attempt's result
  checkpoint_w<id>.json           resumability state
`);
}

function main() {
  const opts = parseArgs();
  fs.mkdirSync(opts.output, { recursive: true });

  const candidates = fs.readFileSync(opts.input, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.log(`Loaded ${candidates.length} candidates`);

  // Build the task list: one task per (candidateIdx, [P,Q]) pair from each
  // candidate's OWN torusUnresolved list. Candidates with an empty list
  // contribute nothing -- they're already fully resolved on the torus side.
  const tasks = [];
  let emptyCount = 0;
  candidates.forEach((c, idx) => {
    const unresolved = c.torusUnresolved || [];
    if (unresolved.length === 0) { emptyCount++; return; }
    for (const [P, Q] of unresolved) tasks.push({ candidateIdx: idx, P, Q });
  });
  console.log(`${emptyCount} candidates already fully resolved on torus side (empty torusUnresolved) -- skipped`);
  console.log(`${tasks.length} (candidate, size) recheck tasks from the remaining ${candidates.length - emptyCount} candidates`);
  console.log(`Budget: ${opts.budget.toLocaleString()} nodes/attempt, timeout ${opts.perAttemptTimeoutMs / 1000}s/attempt`);
  console.log(`Output directory: ${path.resolve(opts.output)}\n`);

  if (tasks.length === 0) { console.log('Nothing to recheck.'); return; }

  // resumability: per-worker checkpoint files
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
  const taskKey = (t) => `${t.candidateIdx}_${t.P}_${t.Q}`;
  const remaining = tasks.filter(t => !doneKeys.has(taskKey(t)));
  console.log(`${tasks.length - remaining.length} already completed (resuming), ${remaining.length} remaining\n`);

  if (remaining.length === 0) { console.log('Nothing left to do.'); return; }

  const numWorkers = Math.min(opts.workers, remaining.length);
  const chunkSize = Math.ceil(remaining.length / numWorkers);
  const chunks = [];
  for (let i = 0; i < remaining.length; i += chunkSize) chunks.push(remaining.slice(i, i + chunkSize));

  let finished = 0;
  const startTime = Date.now();
  const progress = chunks.map(c => ({ done: 0, total: c.length }));

  chunks.forEach((chunk, workerId) => {
    const w = new Worker(path.join(__dirname, 'recheck_torus_unresolved_multicore_worker.js'), {
      workerData: { tasks: chunk, candidates, workerId, budget: opts.budget, perAttemptTimeoutMs: opts.perAttemptTimeoutMs, outputDir: opts.output },
    });
    w.on('message', (msg) => {
      if (msg.type === 'progress') progress[workerId].done = msg.done;
      if (msg.type === 'done') {
        finished++;
        console.log(`Worker ${workerId} finished: ${msg.confirmedPeriodic} confirmed periodic`);
        if (finished === chunks.length) {
          console.log(`\nAll workers finished in ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes.`);
          process.exit(0);
        }
      }
    });
    w.on('error', (err) => console.error(`Worker ${workerId} error:`, err));
  });

  setInterval(() => {
    const done = progress.reduce((s, p) => s + p.done, 0);
    const total = progress.reduce((s, p) => s + p.total, 0);
    console.log(`[${((Date.now() - startTime) / 1000 / 60).toFixed(1)}min] ${done}/${total} attempts done`);
  }, 15_000);
}

main();
