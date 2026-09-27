'use strict';
// Validation for sheared_solver.js. Run: node test_sheared_solver.js [trials]
const { pack } = require('./lattice.js');
const { torusFeasible } = require('./solver.js');
const { shearedTorusFeasible } = require('./sheared_torus.js');
const S = require('./sheared_solver.js');

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(parseInt(process.argv[3] || '20260925', 10));
function ri(n) { return Math.floor(rand() * n); }
const SUB = [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 2], [1, 1, 2], [2, 2, 0], [2, 2, 1], [3, 2, 2]];
function randomTileset(n, maxFlavor) {
  const tiles = [];
  for (let t = 0; t < n; t++) {
    const mu = [];
    for (let j = 0; j < 3; j++) { const [cl, pt, pr] = SUB[ri(9)]; mu.push(pack(cl, cl === 3 ? 0 : ri(maxFlavor), pt, pr)); }
    tiles.push(mu);
  }
  return tiles;
}
function randomFlags(n, mode) {
  if (mode === 'all') return new Array(n).fill(true);
  return Array.from({ length: n }, () => rand() < 0.5);
}

const trials = parseInt(process.argv[2] || '150', 10);
let fail = 0;
function check(cond, msg) { if (!cond) { fail++; console.log('  FAIL:', msg); } }

// ---- Test 0: HNF round-trips and orbit enumeration sanity ----
console.log('=== Test 0: lattice utilities ===');
for (let N = 1; N <= 24; N++) {
  for (const lat of S.hnfOfIndex(N)) {
    const back = S.hnfFromGenerators([lat.P, 0], [lat.s, lat.Q]);
    check(S.latKey(back) === S.latKey(lat), `HNF roundtrip ${S.latKey(lat)}`);
    // R^6 = identity on lattices; R^3 = identity too (since -I preserves lattices)
    let cur = lat; for (let k = 0; k < 3; k++) cur = S.transformLattice(cur, S.rot);
    check(S.latKey(cur) === S.latKey(lat), `R^3 identity ${S.latKey(lat)}`);
    // transform preserves index
    check(S.transformLattice(lat, S.rot).N === N && S.transformLattice(lat, S.mir).N === N, 'index preserved');
  }
  const sigma = S.hnfOfIndex(N).length;
  const repsC = S.latticeOrbitReps(N, N, false), repsD = S.latticeOrbitReps(N, N, true);
  const sumC = repsC.reduce((s, r) => s + r.orbitSize, 0), sumD = repsD.reduce((s, r) => s + r.orbitSize, 0);
  check(sumC === sigma && sumD === sigma, `orbit sizes partition index ${N}`);
}
const r13 = S.latticeOrbitReps(13, 13, false);
console.log(`  index 13: ${S.hnfOfIndex(13).length} lattices -> ${r13.length} C6-orbits: ${r13.map(r => S.latKey(r) + '(x' + r.orbitSize + ')').join(' ')}`);
let tot = 0, totC = 0, totD = 0;
for (let N = 1; N <= 40; N++) { tot += S.hnfOfIndex(N).length; totC += S.latticeOrbitReps(N, N, false).length; totD += S.latticeOrbitReps(N, N, true).length; }
console.log(`  index<=40: ${tot} lattices, ${totC} C6-orbit reps, ${totD} D6-orbit reps`);

// ---- Test 1: the reported index-13 example ----
console.log('=== Test 1: index-13 example (expect feasible exactly at s in {7,8,10}) ===');
{
  const tiles = [[pack(0, 0, 0, 0), pack(0, 0, 0, 0), pack(3, 0, 2, 2)], [pack(0, 0, 0, 0), pack(0, 0, 0, 1), pack(0, 0, 1, 1)], [pack(0, 0, 0, 1), pack(0, 0, 1, 0), pack(3, 0, 2, 2)]];
  const flags = [true, false, false];
  const ct = S.compileTileset(tiles, flags);
  const feas = [];
  for (let sh = 0; sh < 13; sh++) {
    const r = S.searchLattice(ct, { P: 13, s: sh, Q: 1 }, { budget: 5_000_000 });
    if (r.result === true) {
      feas.push(sh);
      const { map } = S.solutionToDomain(ct, { P: 13, s: sh, Q: 1 }, r.solution);
      const v = S.verifyPeriodicSolution(tiles, flags, { P: 13, s: sh, Q: 1 }, map);
      check(v.ok, `verify s=${sh}: ${v.why}`);
    }
    check(r.result !== 'unknown', `s=${sh} unknown`);
  }
  const r1 = S.searchLattice(ct, { P: 1, s: 0, Q: 13 }, { budget: 5_000_000 });
  console.log(`  feasible shears: [${feas}], (P=1,Q=13): ${r1.result}`);
  check(JSON.stringify(feas) === '[7,8,10]' && r1.result === false, 'index-13 pattern');
}

// ---- Test 2: agreement with the reference solvers on random tilesets ----
console.log(`=== Test 2: agreement with sheared_torus.js reference (all HNF lattices, index<=7), ${trials} tilesets ===`);
let agree = 0, feasCount = 0, compared = 0, refUnknown = 0;
for (let t = 0; t < trials; t++) {
  const n = 1 + ri(3);
  const tiles = randomTileset(n, 1 + ri(2));
  const flags = randomFlags(n, rand() < 0.5 ? 'all' : 'mixed');
  const ct = S.compileTileset(tiles, flags);
  for (let N = 1; N <= 7; N++) for (const lat of S.hnfOfIndex(N)) {
    const mine = S.searchLattice(ct, lat, { budget: 3_000_000 });
    const ref = shearedTorusFeasible(tiles, flags, lat.P, lat.Q, lat.s, { budget: 3_000_000 });
    if (ref.result === 'unknown') { refUnknown++; continue; }
    compared++;
    if (mine.result === ref.result) agree++;
    else check(false, `disagree tiles=${JSON.stringify(tiles)} flags=${flags} lat=${S.latKey(lat)} mine=${mine.result} ref=${ref.result}`);
    if (mine.result === true) {
      feasCount++;
      const { map } = S.solutionToDomain(ct, lat, mine.solution);
      const v = S.verifyPeriodicSolution(tiles, flags, lat, map);
      check(v.ok, `independent verify failed ${S.latKey(lat)}: ${v.why}`);
    }
    if (lat.s === 0) {
      const old = torusFeasible(tiles, flags, lat.P, lat.Q, { budget: 3_000_000 });
      if (old.result !== 'unknown') check(old.result === mine.result, `disagree with torusFeasible at ${S.latKey(lat)}`);
    }
  }
}
console.log(`  compared ${compared} (tileset,lattice) pairs: ${agree} agree, ${feasCount} feasible (all independently verified), ref-unknown skipped: ${refUnknown}`);

// ---- Test 3: symmetry invariance (rotation always; mirror when all reflectable) ----
console.log(`=== Test 3: feasibility invariant under lattice rotation (all) and mirror (all-reflectable) ===`);
let rotPairs = 0, mirPairs = 0, feasSeen = 0;
for (let t = 0; t < trials; t++) {
  const n = 1 + ri(3);
  const tiles = randomTileset(n, 1 + ri(2));
  const allRefl = rand() < 0.5;
  const flags = randomFlags(n, allRefl ? 'all' : 'mixed');
  const ct = S.compileTileset(tiles, flags);
  for (let N = 1; N <= 12; N++) for (const lat of S.hnfOfIndex(N)) {
    const a = S.searchLattice(ct, lat, { budget: 3_000_000 }).result;
    if (a === 'unknown') continue;
    if (a === true) feasSeen++;
    const rl = S.transformLattice(lat, S.rot);
    const b = S.searchLattice(ct, rl, { budget: 3_000_000 }).result;
    if (b !== 'unknown') { rotPairs++; check(a === b, `rotation non-invariance ${JSON.stringify(tiles)} ${flags} ${S.latKey(lat)} -> ${S.latKey(rl)}: ${a} vs ${b}`); }
    if (flags.every(x => x)) {
      const ml = S.transformLattice(lat, S.mir);
      const c = S.searchLattice(ct, ml, { budget: 3_000_000 }).result;
      if (c !== 'unknown') { mirPairs++; check(a === c, `mirror non-invariance ${JSON.stringify(tiles)} ${S.latKey(lat)} -> ${S.latKey(ml)}: ${a} vs ${c}`); }
    }
  }
}
console.log(`  rotation pairs checked: ${rotPairs}, mirror pairs checked: ${mirPairs}, feasible instances among them: ${feasSeen}`);

console.log(fail === 0 ? '\nALL TESTS PASSED' : `\n${fail} FAILURES`);
