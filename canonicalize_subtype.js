'use strict';
// ============================================================================
// Level 1 of orderly generation: canonicalize SUBTYPE patterns (class+pt+pr
// per edge, flavor stripped out) under the full D_3^n x S_n group. This
// operates on a space 241x smaller than the full labeling space (for n=3),
// since flavor partitioning is what causes the combinatorial explosion, not
// the underlying subtype pattern.
//
// subtypeSigma: how a subtype code transforms under a REFLECTED tile
// relabeling (rotations never change subtype content, only position).
// Class A/B have pt in {a,b} and sigma toggles it; class C/D have pt=c
// fixed, so sigma is the identity on them.
// ============================================================================
const { SUBTYPES } = require('./alphabet.js');

// SUBTYPES = [[cl,pt,pr], ...], index 0..8. Build subtypeSigma as an index permutation.
function buildSubtypeSigma() {
  const map = new Array(SUBTYPES.length);
  for (let i = 0; i < SUBTYPES.length; i++) {
    const [cl, pt, pr] = SUBTYPES[i];
    let newPt = pt;
    if (cl === 0 || cl === 1) newPt = pt === 0 ? 1 : 0; // A or B: toggle a<->b
    // C, D: pt already 2 (c), unchanged
    const target = SUBTYPES.findIndex(([c2, p2, r2]) => c2 === cl && p2 === newPt && r2 === pr);
    map[i] = target;
  }
  return map;
}
const SUBTYPE_SIGMA = buildSubtypeSigma();

// All 6 D_3 relabelings of one tile's 3-position subtype array [s0,s1,s2].
// Mirrors L_g's rotation/reflection formula exactly, operating on subtype
// codes instead of full packed labels.
function subtypeTileRelabelings(subtypes3) {
  const out = new Array(18); // 6 rows of 3
  for (let g = 0; g < 6; g++) {
    const k = g >> 1, flip = g & 1;
    for (let j = 0; j < 3; j++) {
      if (!flip) {
        out[g * 3 + j] = subtypes3[((j - k) % 3 + 3) % 3];
      } else {
        out[g * 3 + j] = SUBTYPE_SIGMA[subtypes3[((k - j) % 3 + 3) % 3]];
      }
    }
  }
  return out;
}

const PERMUTATIONS = {
  1: [[0]],
  2: [[0, 1], [1, 0]],
  3: [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]],
};

function compareArrays(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}

// Fast canonicality CHECK only (no stabilizer computation) -- minimal
// allocation, used for the bulk filtering pass over the full raw space.
function findCanonicalSubtypeFast(flatSubtypes, n) {
  const perms = PERMUTATIONS[n];
  const tiles = []; for (let t = 0; t < n; t++) tiles.push(flatSubtypes.slice(t * 3, t * 3 + 3));
  const relabelings = tiles.map(subtypeTileRelabelings);

  let best = flatSubtypes; // start assuming input might already be canonical
  const totalG = Math.pow(6, n);
  const candidate = new Array(3 * n);

  for (const perm of perms) {
    for (let gCode = 0; gCode < totalG; gCode++) {
      let rem = gCode;
      for (let pos = 0; pos < n; pos++) {
        const origIdx = perm[pos];
        const g = rem % 6; rem = (rem / 6) | 0;
        const row = relabelings[origIdx];
        candidate[pos * 3 + 0] = row[g * 3 + 0];
        candidate[pos * 3 + 1] = row[g * 3 + 1];
        candidate[pos * 3 + 2] = row[g * 3 + 2];
      }
      if (compareArrays(candidate, best) < 0) best = candidate.slice();
    }
  }
  return best;
}

function isCanonicalSubtypeFast(flatSubtypes, n) {
  const c = findCanonicalSubtypeFast(flatSubtypes, n);
  return compareArrays(flatSubtypes, c) === 0;
}

// Canonicalize a flat subtype array (length 3n) under the full group.
// Also returns the STABILIZER: every group element (as [perm, gCombo]) that
// maps the canonical form back to itself exactly -- needed for Level 2.
// (Slower, full version -- only call this on shapes already known canonical.)
function canonicalizeSubtype(flatSubtypes, n) {
  const perms = PERMUTATIONS[n];
  const tiles = []; for (let t = 0; t < n; t++) tiles.push(flatSubtypes.slice(t * 3, t * 3 + 3));
  const relabelings = tiles.map(subtypeTileRelabelings);

  let best = null;
  const allCandidates = []; // [{key: array, perm, gCombo}]
  const totalG = Math.pow(6, n);
  const candidate = new Array(3 * n);

  for (const perm of perms) {
    for (let gCode = 0; gCode < totalG; gCode++) {
      let rem = gCode;
      const gCombo = new Array(n);
      for (let pos = 0; pos < n; pos++) {
        const origIdx = perm[pos];
        const g = rem % 6; rem = (rem / 6) | 0;
        gCombo[pos] = g;
        const row = relabelings[origIdx];
        candidate[pos * 3 + 0] = row[g * 3 + 0];
        candidate[pos * 3 + 1] = row[g * 3 + 1];
        candidate[pos * 3 + 2] = row[g * 3 + 2];
      }
      const key = candidate.slice();
      allCandidates.push({ key, perm: perm.slice(), gCombo });
      if (best === null || compareArrays(key, best) < 0) best = key;
    }
  }
  const stabilizer = allCandidates.filter(c => compareArrays(c.key, best) === 0);
  return { canonical: best, stabilizer };
}

function isCanonicalSubtype(flatSubtypes, n) {
  const { canonical } = canonicalizeSubtype(flatSubtypes, n);
  return compareArrays(flatSubtypes, canonical) === 0;
}

module.exports = { canonicalizeSubtype, isCanonicalSubtype, findCanonicalSubtypeFast, isCanonicalSubtypeFast, subtypeTileRelabelings, SUBTYPE_SIGMA, compareArrays, PERMUTATIONS };

// ============================================================================
// Self-test + benchmark
// ============================================================================
if (require.main === module) {
  console.log('=== subtypeSigma sanity (should be an involution) ===');
  let involutionOk = true;
  for (let i = 0; i < SUBTYPES.length; i++) {
    if (SUBTYPE_SIGMA[SUBTYPE_SIGMA[i]] !== i) { involutionOk = false; console.log(`  FAIL at ${i}`); }
  }
  console.log('  is involution:', involutionOk);
  console.log('  mapping:', SUBTYPE_SIGMA);

  console.log('=== Test: idempotency ===');
  let idOk = true;
  for (let trial = 0; trial < 200; trial++) {
    const n = 3;
    const flat = Array.from({ length: 3 * n }, () => Math.floor(Math.random() * 9));
    const { canonical: c1 } = canonicalizeSubtype(flat, n);
    const { canonical: c2 } = canonicalizeSubtype(c1, n);
    if (compareArrays(c1, c2) !== 0) { idOk = false; console.log('  NOT IDEMPOTENT', flat); }
  }
  console.log('  idempotent over 200 random trials:', idOk);

  console.log('=== Cross-check: fast version agrees with slow version ===');
  let agreeOk = true;
  for (let trial = 0; trial < 500; trial++) {
    const n = 3;
    const flat = Array.from({ length: 3 * n }, () => Math.floor(Math.random() * 9));
    const slow = isCanonicalSubtype(flat, n);
    const fast = isCanonicalSubtypeFast(flat, n);
    if (slow !== fast) { agreeOk = false; console.log('  DISAGREE on', flat, 'slow:', slow, 'fast:', fast); }
  }
  console.log('  fast/slow agree over 500 random trials:', agreeOk);

  console.log('=== Benchmark: FAST subtype-pattern canonicality check, n=3 ===');
  const start = Date.now();
  let count = 0;
  const totalSubtypePatterns = 9 ** 9;
  for (let i = 0; i < 50000; i++) {
    let code = Math.floor(Math.random() * totalSubtypePatterns);
    const flat = new Array(9);
    for (let j = 0; j < 9; j++) { flat[j] = code % 9; code = (code / 9) | 0; }
    isCanonicalSubtypeFast(flat, 3);
    count++;
  }
  const elapsed = (Date.now() - start) / 1000;
  console.log(`  ${count} checks in ${elapsed.toFixed(2)}s = ${(count / elapsed).toFixed(0)}/s`);
  console.log(`  full subtype-space (387,420,489) time estimate: ${(387420489 / (count / elapsed) / 60).toFixed(1)} minutes`);
}
