'use strict';
const { Worker } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { n: 1, reflectable: null, workers: os.cpus().length, output: './output', progressEvery: 1000, patchBudget: 2_000_000, torusBudget: 300_000 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--n') opts.n = parseInt(args[++i], 10);
    else if (a === '--reflectable') opts.reflectable = args[++i].split(',').map(x => x.trim() === '1' || x.trim().toLowerCase() === 'true');
    else if (a === '--workers') opts.workers = parseInt(args[++i], 10);
    else if (a === '--output') opts.output = args[++i];
    else if (a === '--progress-every') opts.progressEvery = parseInt(args[++i], 10);
    else if (a === '--patch-budget') opts.patchBudget = parseInt(args[++i], 10);
    else if (a === '--torus-budget') opts.torusBudget = parseInt(args[++i], 10);
    else if (a === '--help') { printHelp(); process.exit(0); }
  }
  if (!opts.reflectable) opts.reflectable = new Array(opts.n).fill(true);
  if (opts.reflectable.length !== opts.n) {
    console.error(`--reflectable must have exactly ${opts.n} entries (comma-separated 0/1), got ${opts.reflectable.length}`);
    process.exit(1);
  }
  return opts;
}

function printHelp() {
  console.log(`
Triangle aperiodicity solver

Usage: node main.js --n <1|2|3> [options]

Options:
  --n <int>              Number of prototiles (1, 2, or 3)
  --reflectable <list>   Comma-separated 1/0 per tile, e.g. "1,1,0" for tile 3
                         restricted to rotations only. Default: all reflectable.
  --workers <int>        Number of worker threads (default: number of CPU cores)
  --output <dir>         Output directory (default: ./output)
  --progress-every <int> Checkpoint/report frequency, per worker (default: 1000)
  --patch-budget <int>   Backtracking node budget for patch feasibility (default: 2,000,000)
  --torus-budget <int>   Backtracking node budget per torus size (default: 300,000)

Output files (one set per worker, in --output):
  periodic_w<id>.jsonl              tileset + periodic patch (fundamental domain + period vectors)
  non_tiler_w<id>.jsonl             tileset only (no valid tiling exists)
  aperiodic_candidates_w<id>.jsonl  tileset + which checks it survived (needs follow-up)
  skipped_duplicate_w<id>.jsonl     n>=2 tilesets with a duplicate tile -- provably
                                    equivalent to a smaller already-resolved tileset
                                    (see README), not counted toward periodic/non-tiler/
                                    candidate totals
  checkpoint_w<id>.json             resumability state; rerun the same command to resume
  .lock                             held for the lifetime of one running instance --
                                    prevents a second instance from being started
                                    against the same --output directory concurrently
                                    (confirmed 2026-09-27: two overlapping instances
                                    racing on the same checkpoint/output files can
                                    silently discard already-computed results)

Examples:
  node main.js --n 1
  node main.js --n 3 --reflectable 1,1,0 --workers 16 --output ./triangle_n3_mixed
`);
}

function checkForCloudSync(outputPath) {
  const resolved = path.resolve(outputPath);
  const patterns = [
    { re: /Mobile Documents\/com~apple~CloudDocs/, name: 'iCloud Drive' },
    { re: /Dropbox/, name: 'Dropbox' },
    { re: /Google Drive/, name: 'Google Drive' },
    { re: /OneDrive/, name: 'OneDrive' },
  ];
  for (const { re, name } of patterns) {
    if (re.test(resolved)) {
      console.warn(`\n*** WARNING: output directory appears to be inside ${name} (${resolved}) ***`);
      console.warn('*** Cloud-synced folders can severely slow down frequent small file writes.  ***');
      console.warn('*** Strongly recommend using a local, non-synced directory instead.           ***\n');
      return true;
    }
  }
  return false;
}

// --- Lock file: refuse to start a second instance against the same output
// directory while one is already running. Added 2026-09-27 after confirming
// that an interrupted-but-not-actually-killed instance (Ctrl-C failed to
// propagate for an unexplained reason) can race with a freshly-launched one
// on the same checkpoint/output files, causing already-computed results to
// be silently lost (a resumed n=3 all-reflectable run came up short by
// 251,721 shapes relative to the confirmed historical total). This is a
// blunt guard, not a fix for the root cause of the Ctrl-C issue -- see the
// explicit SIGINT/SIGTERM handling below, which is the actual fix for that.
function acquireLock(outputDir) {
  const lockPath = path.join(outputDir, '.lock');
  if (fs.existsSync(lockPath)) {
    let lock = null;
    let stale = false;
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      try {
        process.kill(lock.pid, 0); // throws if no such process
      } catch (e) {
        stale = true;
      }
    } catch (e) {
      stale = true; // corrupt lock file -- treat as stale rather than blocking forever
    }
    if (!stale) {
      console.error(`ERROR: ${lockPath} exists and PID ${lock.pid} (started ${lock.startedAt}) appears to still be running.`);
      console.error('Another instance of main.js is already processing this output directory.');
      console.error('Running two instances against the same directory concurrently can silently');
      console.error('corrupt checkpoints and discard already-computed results.');
      console.error(`If you are certain nothing is actually running (e.g. it crashed without`);
      console.error(`cleaning up), delete ${lockPath} and re-run.`);
      process.exit(1);
    }
    console.warn(`WARNING: found a stale lock file at ${lockPath} (PID ${lock && lock.pid} is not running) -- proceeding.`);
  }
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return lockPath;
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch (e) { /* already gone, fine */ }
}

function main() {
  const opts = parseArgs();
  fs.mkdirSync(opts.output, { recursive: true });
  checkForCloudSync(opts.output);

  const lockPath = acquireLock(path.resolve(opts.output));
  process.on('exit', () => releaseLock(lockPath));

  const totalSubtypeSpace = 9 ** (3 * opts.n);
  console.log(`Triangle solver: n=${opts.n}, reflectable=[${opts.reflectable}], workers=${opts.workers}`);
  console.log(`Subtype patterns to scan (Level 1): ${totalSubtypeSpace.toLocaleString()}`);
  console.log(`(Canonical shapes ultimately classified will be far fewer -- orderly generation skips non-canonical patterns entirely rather than enumerating and filtering them.)`);
  console.log(`Output directory: ${path.resolve(opts.output)}`);
  console.log('');

  const workers = [];
  const progress = new Array(opts.workers).fill(null).map(() => ({ codesScanned: 0, totalCodesForWorker: 0, shapesDone: 0, counts: { periodic: 0, nonTiler: 0, candidate: 0, skipped: 0 }, done: false }));
  const startTime = Date.now();

  function printProgress() {
    const totalScanned = progress.reduce((s, p) => s + p.codesScanned, 0);
    const totalShapes = progress.reduce((s, p) => s + p.shapesDone, 0);
    const totals = progress.reduce((acc, p) => ({
      periodic: acc.periodic + p.counts.periodic,
      nonTiler: acc.nonTiler + p.counts.nonTiler,
      candidate: acc.candidate + p.counts.candidate,
      skipped: acc.skipped + (p.counts.skipped || 0),
    }), { periodic: 0, nonTiler: 0, candidate: 0, skipped: 0 });
    const elapsed = (Date.now() - startTime) / 1000;
    const aggregateRate = totalScanned / elapsed;
    const perWorkerRate = aggregateRate / opts.workers;
    const pctDone = (100 * totalScanned / totalSubtypeSpace).toFixed(4);
    console.log(`[${elapsed.toFixed(0)}s] ~${pctDone}% of subtype scan | shapes classified=${totalShapes.toLocaleString()} periodic=${totals.periodic} non-tiler=${totals.nonTiler} candidates=${totals.candidate} skipped(duplicate-tile)=${totals.skipped} | scan rate=${aggregateRate.toFixed(0)}/s aggregate (${perWorkerRate.toFixed(0)}/s/worker)`);
  }

  let finishedCount = 0;
  for (let workerId = 0; workerId < opts.workers; workerId++) {
    const w = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: {
        n: opts.n,
        reflectableFlags: opts.reflectable,
        workerId,
        numWorkers: opts.workers,
        outputDir: path.resolve(opts.output),
        patchBudget: opts.patchBudget,
        torusBudget: opts.torusBudget,
        progressEvery: opts.progressEvery,
      },
    });
    w.on('message', (msg) => {
      progress[msg.workerId] = { codesScanned: msg.codesScanned, totalCodesForWorker: msg.totalCodesForWorker, shapesDone: msg.shapesDone, counts: msg.counts, done: !!msg.done };
      if (msg.done) {
        finishedCount++;
        console.log(`Worker ${msg.workerId} finished: ${JSON.stringify(msg.counts)}`);
        if (finishedCount === opts.workers) {
          printProgress();
          console.log('\nAll workers finished.');
          process.exit(0);
        }
      }
    });
    w.on('error', (err) => { console.error(`Worker ${workerId} error:`, err); });
    workers.push(w);
  }

  const interval = setInterval(printProgress, 10_000);
  process.on('exit', () => clearInterval(interval));

  // Explicit SIGINT/SIGTERM handling. Added 2026-09-27: on 2026-09-27 a
  // Ctrl-C sent to a running `main.js` process failed to stop it (required
  // `kill -9` instead), for a reason never conclusively identified -- no
  // handler existed anywhere in this file or worker.js, so Node's default
  // behavior (immediate exit on SIGINT) should have applied and didn't.
  // Rather than leave that unexplained for an unattended multi-day run,
  // this makes shutdown explicit and no longer dependent on default
  // behavior: actively terminate every worker thread, then exit, which
  // also triggers the 'exit' handlers above (lock release, interval clear).
  function shutdown(signal) {
    console.log(`\nReceived ${signal}, terminating ${workers.length} worker(s) and shutting down...`);
    for (const w of workers) {
      try { w.terminate(); } catch (e) { /* already gone, fine */ }
    }
    process.exit(130);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
