'use strict';
// ============================================================================
// Summarize a sheared_torus_multicore.js run.
// Usage: node summarize_sheared.js <candidates.jsonl> <sheared-output-dir>
// Writes into <sheared-output-dir>:
//   resolved_periodic_sheared.jsonl       merged periodic results (one per candidate)
//   still_candidates_after_sheared.jsonl  ORIGINAL input lines of candidates that were
//                                         processed and remain unresolved -- same format
//                                         as the input, so every other tool accepts it
//   not_yet_processed.jsonl               original lines not processed yet (if any)
// ============================================================================
const fs = require('fs');
const path = require('path');
const { loadResults } = require('./sheared_results.js');
const SS = require('./sheared_solver.js');

const [inputPath, dir] = process.argv.slice(2);
if (!inputPath || !dir) { console.error('Usage: node summarize_sheared.js <candidates.jsonl> <sheared-output-dir>'); process.exit(1); }

const lines = fs.readFileSync(inputPath, 'utf8').split('\n').filter(l => l.trim());
const best = loadResults(dir);

const periodic = [], still = [], notYet = [];
const byIndex = {}, byShape = {};
let alreadyAxisCoverable = 0, stillWithUnknown = 0, stillTimedOut = 0;
const sweptHist = {};
lines.forEach((line, idx) => {
  const r = best.get(idx);
  if (!r) { notYet.push(line); return; }
  if (r.status === 'periodic') {
    periodic.push(JSON.stringify(r));
    const { P, s, Q, N } = r.lattice;
    byIndex[N] = (byIndex[N] || 0) + 1;
    const shape = s === 0 ? 'axis-aligned' : 'sheared';
    byShape[shape] = (byShape[shape] || 0) + 1;
    // Would the old 6x6 battery have contained this lattice? (Lambda contains
    // (P,0) and (0, Q*P/gcd(P,s)).) If so, the old run must have hit its
    // budget there -- worth knowing.
    // (Checked over the lattice's whole symmetry orbit.)
    const g = (x, y) => { while (y) [x, y] = [y, x % y]; return x; };
    const cov = (l) => l.P <= 6 && (l.Q * l.P) / g(l.P, l.s || l.P) <= 6;
    let orbit = [r.lattice], cur = r.lattice;
    for (let k = 0; k < 2; k++) { cur = SS.transformLattice(cur, SS.rot); orbit.push(cur); }
    if (r.reflectableFlags.every(Boolean)) orbit = orbit.concat(orbit.map(l => SS.transformLattice(l, SS.mir)));
    if (orbit.some(cov)) alreadyAxisCoverable++;
  } else {
    still.push(line);
    if (r.unknown && r.unknown.length) stillWithUnknown++;
    if (r.timedOut) stillTimedOut++;
    sweptHist[r.sweptUpTo] = (sweptHist[r.sweptUpTo] || 0) + 1;
  }
});

fs.writeFileSync(path.join(dir, 'resolved_periodic_sheared.jsonl'), periodic.join('\n') + (periodic.length ? '\n' : ''));
fs.writeFileSync(path.join(dir, 'still_candidates_after_sheared.jsonl'), still.join('\n') + (still.length ? '\n' : ''));
if (notYet.length) fs.writeFileSync(path.join(dir, 'not_yet_processed.jsonl'), notYet.join('\n') + '\n');

console.log(`Input candidates:            ${lines.length}`);
console.log(`Processed:                   ${lines.length - notYet.length}`);
console.log(`  resolved PERIODIC:         ${periodic.length}  (every one independently verified)`);
console.log(`  still unresolved:          ${still.length}`);
console.log(`    ...with some budget/timeout-unknown lattice: ${stillWithUnknown}`);
console.log(`    ...candidate-timeout before max index:      ${stillTimedOut}`);
console.log(`Not yet processed:           ${notYet.length}`);
if (periodic.length) {
  console.log(`\nResolving (minimal found) lattice index N: ${Object.keys(byIndex).sort((a, b) => a - b).map(k => `${k}:${byIndex[k]}`).join('  ')}`);
  console.log(`Lattice shape: ${JSON.stringify(byShape)}`);
  console.log(`Resolving lattice was inside the old 6x6 axis battery (old run hit budget there): ${alreadyAxisCoverable}`);
}
if (still.length) console.log(`\nUnresolved, swept-up-to index: ${Object.keys(sweptHist).sort((a, b) => a - b).map(k => `${k}:${sweptHist[k]}`).join('  ')}`);
console.log(`\nWrote: resolved_periodic_sheared.jsonl, still_candidates_after_sheared.jsonl${notYet.length ? ', not_yet_processed.jsonl' : ''} in ${path.resolve(dir)}`);
