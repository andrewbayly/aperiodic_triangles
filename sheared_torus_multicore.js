'use strict';
// ============================================================================
// Multi-core SHEARED torus sweep over an aperiodic-candidate file.
//
// Why: the main pipeline's torus battery only ever tested axis-aligned
// period lattices (P,0),(0,Q) with P,Q <= 6. A tiling whose period lattice is
// sheared -- e.g. (13,0),(7,1), index 13 -- needs a 13x13 axis-aligned torus
// to be seen that way. This tool instead enumerates EVERY period lattice
// (Hermite normal form (P,0),(s,Q), 0 <= s < P) up to --max-index, reduced to
// one representative per orbit of the lattice's point group (60-degree
// rotations always; mirrors too when every tile is reflectable -- both
// validated empirically on 128K lattice pairs, see test_sheared_solver.js),
// in increasing index order, stopping at the first feasible one. Every
// "periodic" result is re-verified by an independent unfolding checker
// before being written.
//
// Coverage note: every lattice of index N contains N*Z^2, so all lattices of
// index <= 6 were already implicitly covered by the old 6x6 battery; the new
// ground is index 7 and up. Small indices are re-tested anyway (they are
// cheap) as a cross-check of the earlier results.
//
// Dispatch is dynamic (a worker pulls the next candidate when free), since
// per-candidate cost varies enormously.
//
// Resuming: rerun the same command (same --output). A candidate is done iff
// its result line is in some results_w*.jsonl. Raising --max-index on a
// rerun re-queues unresolved candidates starting at their previous
// sweptUpTo+1 (their earlier unknown lattices are NOT retried; use
// --retry-unknown for that -- it restarts those candidates from index 1).
// ============================================================================
const { Worker } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { loadResults } = require('./sheared_results.js');

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    input: null, output: './sheared_output', workers: Math.max(1, os.cpus().length),
    maxIndex: 40, budget: 2_000_000, latticeTimeoutSec: 60, candidateTimeoutMin: 20,
    useSymmetry: true, retryUnknown: false, limit: 0,
  };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--input') o.input = a[++i];
    else if (k === '--output') o.output = a[++i];
    else if (k === '--workers') o.workers = parseInt(a[++i], 10);
    else if (k === '--max-index') o.maxIndex = parseInt(a[++i], 10);
    else if (k === '--budget') o.budget = parseInt(a[++i], 10);
    else if (k === '--lattice-timeout-sec') o.latticeTimeoutSec = parseFloat(a[++i]);
    else if (k === '--candidate-timeout-min') o.candidateTimeoutMin = parseFloat(a[++i]);
    else if (k === '--no-symmetry') o.useSymmetry = false;
    else if (k === '--retry-unknown') o.retryUnknown = true;
    else if (k === '--limit') o.limit = parseInt(a[++i], 10);
    else if (k === '--help') { printHelp(); process.exit(0); }
    else { console.error(`Unknown option ${k}`); process.exit(1); }
  }
  if (!o.input) { console.error('--input is required (see --help)'); process.exit(1); }
  return o;
}

function printHelp() {
  console.log(`
Sheared-torus sweep: tests every period lattice up to a given index.

Usage: node sheared_torus_multicore.js --input <candidates.jsonl> [options]

Options:
  --input <path>                 Candidate .jsonl (standard candidate format:
                                 one {n, reflectableFlags, tiles, ...} per line)
  --output <dir>                 Output directory (default ./sheared_output)
  --workers <int>                Worker threads -- use your PERFORMANCE core count
  --max-index <int>              Largest lattice index N = P*Q (default 40)
  --budget <int>                 Search-node budget per lattice (default 2,000,000)
  --lattice-timeout-sec <num>    Wall-clock cap per lattice (default 60)
  --candidate-timeout-min <num>  Wall-clock cap per candidate (default 20)
  --no-symmetry                  Test every HNF lattice, not one per orbit
                                 (about 3-6x slower; for cross-checking only)
  --retry-unknown                On resume, restart unresolved candidates that
                                 had any budget/timeout 'unknown' lattice
  --limit <int>                  Only process the first <int> candidates (trial runs)

Output (in --output):
  results_w<id>.jsonl   one line per candidate: status "periodic" (with the
                        lattice, period vectors, verified fundamental domain)
                        or "unresolved" (sweptUpTo, refuted count, and every
                        lattice that hit the budget/timeout, as [P,s,Q])
Then run:  node summarize_sheared.js <candidates.jsonl> <output-dir>
`);
}

function main() {
  const o = parseArgs();
  fs.mkdirSync(o.output, { recursive: true });
  let candidates = fs.readFileSync(o.input, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  if (o.limit > 0) candidates = candidates.slice(0, o.limit);
  const prior = loadResults(o.output);

  const queue = [];
  let skippedResolved = 0, skippedDone = 0;
  candidates.forEach((rec, idx) => {
    const p = prior.get(idx);
    if (!p) { queue.push({ candidateIdx: idx, record: rec, startIndex: 1 }); return; }
    if (p.status === 'periodic') { skippedResolved++; return; }
    if (o.retryUnknown && p.unknown && p.unknown.length) { queue.push({ candidateIdx: idx, record: rec, startIndex: 1 }); return; }
    if ((p.sweptUpTo || 0) < o.maxIndex) { queue.push({ candidateIdx: idx, record: rec, startIndex: (p.sweptUpTo || 0) + 1 }); return; }
    skippedDone++;
  });

  console.log(`Loaded ${candidates.length} candidates from ${o.input}`);
  console.log(`Already resolved periodic: ${skippedResolved}; already swept to --max-index: ${skippedDone}; queued: ${queue.length}`);
  console.log(`max-index=${o.maxIndex} budget=${o.budget.toLocaleString()}/lattice lattice-timeout=${o.latticeTimeoutSec}s candidate-timeout=${o.candidateTimeoutMin}min symmetry=${o.useSymmetry} workers=${o.workers}`);
  console.log(`Output: ${path.resolve(o.output)}\n`);
  if (queue.length === 0) { console.log('Nothing to do.'); return; }

  const numWorkers = Math.min(o.workers, queue.length);
  let next = 0, done = 0, resolved = 0, withUnknown = 0, active = numWorkers;
  const hist = {};
  const t0 = Date.now();
  const report = () => {
    const el = (Date.now() - t0) / 1000;
    const rate = done / Math.max(el, 1e-9);
    const eta = rate > 0 ? (queue.length - done) / rate : Infinity;
    const h = Object.keys(hist).sort((x, y) => x - y).map(k => `${k}:${hist[k]}`).join(' ');
    console.log(`[${(el / 60).toFixed(1)}min] ${done}/${queue.length} done | periodic found: ${resolved} | unresolved w/ budget-unknowns: ${withUnknown} | ${(rate * 60).toFixed(1)}/min | ETA ${isFinite(eta) ? (eta / 3600).toFixed(2) + 'h' : '?'}${h ? ' | hits by index ' + h : ''}`);
  };
  const timer = setInterval(report, 30_000);

  for (let w = 0; w < numWorkers; w++) {
    const worker = new Worker(path.join(__dirname, 'sheared_torus_multicore_worker.js'), {
      workerData: {
        workerId: w, outputDir: path.resolve(o.output), maxIndex: o.maxIndex, budget: o.budget,
        latticeTimeoutMs: o.latticeTimeoutSec * 1000, candidateTimeoutMs: o.candidateTimeoutMin * 60_000,
        useSymmetry: o.useSymmetry,
      },
    });
    worker.on('message', (m) => {
      if (m.type === 'result') {
        done++;
        if (m.status === 'periodic') { resolved++; hist[m.N] = (hist[m.N] || 0) + 1; }
        else if (m.unknownCount > 0) withUnknown++;
      } else if (m.type === 'ready') {
        if (next < queue.length) worker.postMessage({ type: 'task', ...queue[next++] });
        else {
          worker.postMessage({ type: 'stop' });
          if (--active === 0) {
            clearInterval(timer); report();
            console.log(`\nAll done in ${((Date.now() - t0) / 60000).toFixed(1)} min. Next: node summarize_sheared.js ${o.input} ${o.output}`);
          }
        }
      }
    });
    worker.on('error', (err) => { console.error(`Worker ${w} error:`, err); });
  }
}

main();
