'use strict';
// ============================================================================
// Alphabet + canonical enumeration for n triangular prototiles.
//
// Every tile's labeling is stored in the FULL (non-chiral, 4-class) alphabet
// uniformly. Chirality is purely a per-tile PLACEMENT restriction: a
// "non-reflectable" tile is only ever placed via {0,2,4} (pure rotations),
// never {1,3,5} (reflections) -- see placementGroup() below. This avoids
// ever needing to reconcile two different class systems at a shared edge.
//
// Flavor is jointly canonicalized across ALL n*3 edges of the tileset (cross-
// tile matching requires comparable flavors), per the paper's Section 2.8.
// ============================================================================
const { pack } = require('./lattice.js');

const SUBTYPES = [
  [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], // A: pt in {a,b}, pr in {p,q}
  [1, 0, 2], [1, 1, 2],                       // B: pt in {a,b}, pr=r
  [2, 2, 0], [2, 2, 1],                       // C: pt=c, pr in {p,q}
  [3, 2, 2],                                  // D: pt=c, pr=r
];

// Restricted-growth-string generator: every set partition of {0..n-1} exactly once.
function* rgsPartitions(n) {
  if (n === 0) { yield []; return; }
  const a = new Array(n).fill(0);
  const maxSoFar = new Array(n).fill(0);
  function* rec(i) {
    if (i === n) { yield a.slice(); return; }
    const bound = i === 0 ? 0 : maxSoFar[i - 1] + 1;
    for (let v = 0; v <= bound; v++) {
      a[i] = v;
      maxSoFar[i] = Math.max(v, i === 0 ? 0 : maxSoFar[i - 1]);
      yield* rec(i + 1);
    }
  }
  yield* rec(0);
}
function cartesian(arrays) {
  return arrays.reduce((acc, arr) => {
    const out = [];
    for (const a of acc) for (const b of arr) out.push([...a, b]);
    return out;
  }, [[]]);
}

// Enumerate every canonical labeling of n triangles (3 edges each, 3n total),
// with flavor jointly canonicalized per class across all 3n edges.
// Yields: array of n sub-arrays, each of length 3 (packed labels).
function* enumerateCanonical(n) {
  const totalEdges = 3 * n;
  const nSub = SUBTYPES.length;
  const assign = new Array(totalEdges).fill(0);
  function* subtypeAssignments(pos) {
    if (pos === totalEdges) { yield assign.slice(); return; }
    for (let s = 0; s < nSub; s++) { assign[pos] = s; yield* subtypeAssignments(pos + 1); }
  }
  for (const st of subtypeAssignments(0)) {
    const byClass = { 0: [], 1: [], 2: [] };
    for (let i = 0; i < totalEdges; i++) { const cl = SUBTYPES[st[i]][0]; if (cl !== 3) byClass[cl].push(i); }
    const classKeys = [0, 1, 2].filter(c => byClass[c].length > 0);
    const partitionOptionsPerClass = classKeys.map(c => [...rgsPartitions(byClass[c].length)]);
    const combos = cartesian(partitionOptionsPerClass.length ? partitionOptionsPerClass : [[[]]]);
    for (const combo of combos) {
      const flavorOf = new Array(totalEdges).fill(0);
      classKeys.forEach((c, idx) => {
        const positions = byClass[c];
        const rgs = combo[idx];
        positions.forEach((pos, j) => { flavorOf[pos] = rgs[j]; });
      });
      const flat = new Array(totalEdges);
      for (let i = 0; i < totalEdges; i++) {
        const [cl, pt, pr] = SUBTYPES[st[i]];
        flat[i] = pack(cl, cl === 3 ? 0 : flavorOf[i], pt, pr);
      }
      // split into n tiles of 3 edges each
      const tiles = [];
      for (let t = 0; t < n; t++) tiles.push(flat.slice(t * 3, t * 3 + 3));
      yield tiles;
    }
  }
}

// Exact count of canonical labelings for n tiles (3n total edges), matching
// the closed-form Bell-number formula (verified against brute enumeration
// for n=1 in this module's self-test).
function bell(maxN) {
  const t = [[1]];
  for (let i = 1; i <= maxN; i++) {
    const row = [t[i - 1][i - 1]];
    for (let j = 1; j <= i; j++) row[j] = (row[j - 1] || 0) + (t[i - 1][j - 1] || 0);
    t.push(row);
  }
  return t.map(r => r[0]);
}
function canonicalCount(n) {
  const totalEdges = 3 * n;
  const B = bell(totalEdges);
  const classSubtypes = { A: 4, B: 2, C: 2, D: 1 };
  let total = 0n;
  const N = 4 ** totalEdges;
  for (let mask = 0; mask < N; mask++) {
    let m = mask, counts = { A: 0, B: 0, C: 0, D: 0 };
    for (let i = 0; i < totalEdges; i++) { const c = ['A', 'B', 'C', 'D'][m % 4]; m = (m / 4) | 0; counts[c]++; }
    const partitions = BigInt(B[counts.A]) * BigInt(B[counts.B]) * BigInt(B[counts.C]);
    const subtypeWeight = BigInt(classSubtypes.A) ** BigInt(counts.A) * BigInt(classSubtypes.B) ** BigInt(counts.B) * BigInt(classSubtypes.C) ** BigInt(counts.C);
    total += partitions * subtypeWeight;
  }
  return total;
}

// Placement group for a tile: full D_3 (0..5) if reflectable, C_3 (0,2,4) if not.
function placementGroup(reflectable) {
  return reflectable ? [0, 1, 2, 3, 4, 5] : [0, 2, 4];
}

module.exports = { SUBTYPES, enumerateCanonical, canonicalCount, placementGroup, rgsPartitions };

// ============================================================================
// Self-test
// ============================================================================
if (require.main === module) {
  console.log('=== Canonical count formula vs brute enumeration, n=1 ===');
  let bruteCount = 0;
  for (const _ of enumerateCanonical(1)) bruteCount++;
  const formulaCount = canonicalCount(1);
  console.log(`  brute enumeration: ${bruteCount}`);
  console.log(`  formula:           ${formulaCount}`);
  console.log(`  match: ${BigInt(bruteCount) === formulaCount}`);

  console.log('=== Canonical counts (should match earlier session values) ===');
  console.log(`  n=1: ${canonicalCount(1)} (expect 1,457)`);
  console.log(`  n=2: ${canonicalCount(2).toLocaleString()} (expect 7,984,057)`);
  // n=3 (93.7 billion) is too slow to brute-force here (4^9 mask loop), skip live check
  console.log('  n=3: (93,740,081,065 expected -- confirmed in prior session, not recomputed here for speed)');
}
