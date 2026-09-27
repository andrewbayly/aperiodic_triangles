'use strict';
const { L, bowtie } = require('./lattice.js');
const { placementGroup } = require('./alphabet.js');

// ============================================================================
// A reflectable tile's reflected orientations (g=1,3,5) are only genuinely
// USEFUL if they present labels the tile's rotation-only orientations
// (g=0,2,4) cannot already reproduce. If EVERY reflected orientation's
// presentation exactly matches some rotation's presentation, the tile is
// "self-mirror-symmetric": including the reflected states doubles the
// solver's per-tile branching factor for zero actual gain (see
// conversation -- discovered by direct inspection of two real stubborn
// tilesets, both of which have exactly this property on every tile).
//
// IMPORTANT: this is a stronger condition than "sigma is a no-op on every
// edge" (i.e. every edge is class C/D) -- that's necessary but NOT
// sufficient. A tile with three genuinely distinct class-C/D edges has no
// redundancy at all despite satisfying that weaker test; verified directly
// by comparing actual per-position presentations, not by any shortcut on
// class alone.
function isReflectionRedundant(mu) {
  for (const gRefl of [1, 3, 5]) {
    const reflPresentation = [0, 1, 2].map(j => L(mu, gRefl, j, 0));
    let matched = false;
    for (const gRot of [0, 2, 4]) {
      const rotPresentation = [0, 1, 2].map(j => L(mu, gRot, j, 0));
      if (reflPresentation[0] === rotPresentation[0] && reflPresentation[1] === rotPresentation[1] && reflPresentation[2] === rotPresentation[2]) { matched = true; break; }
    }
    if (!matched) return false;
  }
  return true;
}

// ============================================================================
// State encoding: a "state" is an index into the states[] array built by
// buildStates(). NS <= 18 (n=3, all reflectable), so a 32-bit integer bitmask
// over states is always sufficient -- this is the same representation style
// used throughout the hexagon solvers (adj[d][g] bitmasks), which is
// dramatically faster than allocating a Uint8Array per call.
// ============================================================================
function buildStates(tiles, reflectableFlags) {
  const states = [];
  for (let t = 0; t < tiles.length; t++) {
    const effectivelyReflectable = reflectableFlags[t] && !isReflectionRedundant(tiles[t]);
    for (const g of placementGroup(effectivelyReflectable)) states.push({ tileIndex: t, g });
  }
  return states;
}

// Precompute, for each edge e and each "up-role" state, the bitmask of
// "down-role" states it's compatible with (and vice versa via a second table).
// This replaces the per-DFS-node O(NS) compatibility loop with an O(1) mask lookup.
function buildAdjBitmasks(tiles, states) {
  const NS = states.length;
  const labelCache = states.map(({ tileIndex, g }) => {
    const mu = tiles[tileIndex];
    return [0, 1].map(slot => [0, 1, 2].map(edge => L(mu, g, edge, slot)));
  });
  const upToDown = [0, 1, 2].map(() => new Array(NS).fill(0));
  const downToUp = [0, 1, 2].map(() => new Array(NS).fill(0));
  for (let e = 0; e < 3; e++) {
    for (let u = 0; u < NS; u++) {
      for (let d = 0; d < NS; d++) {
        const labelUp = labelCache[u][0][e];
        const labelDown = labelCache[d][1][e];
        if (bowtie(labelUp, labelDown)) {
          upToDown[e][u] |= (1 << d);
          downToUp[e][d] |= (1 << u);
        }
      }
    }
  }
  return { upToDown, downToUp, NS };
}

function popcount32(x) {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

const UP_OFFSETS = [[0, 0], [1, 0], [0, 1]];
const DOWN_OFFSETS = [[0, 0], [-1, 0], [0, -1]];
const FULL_MASK_FOR = (NS) => (NS >= 32 ? 0xFFFFFFFF : (1 << NS) - 1);

// ---------- Patch feasibility (open boundary, W x H x {up,down}) ----------
function patchFeasible(tiles, reflectableFlags, W, H, opts = {}) {
  const budget = opts.budget || 2_000_000;
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : null;
  const states = buildStates(tiles, reflectableFlags);
  const { upToDown, downToUp, NS } = buildAdjBitmasks(tiles, states);
  const FULL = FULL_MASK_FOR(NS);
  const idx = (a, b, s) => (a * H + b) * 2 + s;
  const inPatch = (a, b) => a >= 0 && a < W && b >= 0 && b < H;
  const N = W * H * 2;
  const assigned = new Int16Array(N).fill(-1);

  const neighborsOf = new Array(N);
  for (let a = 0; a < W; a++) for (let b = 0; b < H; b++) for (let s = 0; s < 2; s++) {
    const list = [];
    const offsets = s === 0 ? UP_OFFSETS : DOWN_OFFSETS;
    for (let e = 0; e < 3; e++) {
      const [da, db] = offsets[e];
      const na = a + da, nb = b + db, ns = 1 - s;
      if (inPatch(na, nb)) list.push([idx(na, nb, ns), e, s === 0]);
    }
    neighborsOf[idx(a, b, s)] = list;
  }

  function candidateMask(pos) {
    let mask = FULL;
    for (const [nIdx, e, isUpRole] of neighborsOf[pos]) {
      const nVal = assigned[nIdx];
      if (nVal === -1) continue;
      mask &= isUpRole ? downToUp[e][nVal] : upToDown[e][nVal];
      if (mask === 0) return 0;
    }
    return mask;
  }

  let nodes = 0, bailed = false;
  function dfs() {
    if (bailed) return false;
    nodes++;
    if (nodes > budget) { bailed = true; return false; }
    if (deadline && (nodes & 0xFFF) === 0 && Date.now() > deadline) { bailed = true; return false; }
    let bestPos = -1, bestMask = 0, bestCount = NS + 1;
    for (let a = 0; a < W; a++) for (let b = 0; b < H; b++) for (let s = 0; s < 2; s++) {
      const pos = idx(a, b, s);
      if (assigned[pos] !== -1) continue;
      const mask = candidateMask(pos);
      if (mask === 0) return false;
      const count = popcount32(mask);
      if (count < bestCount) { bestCount = count; bestPos = pos; bestMask = mask; if (count === 1) break; }
    }
    if (bestPos === -1) return true;
    let mask = bestMask;
    while (mask) {
      const bit = mask & (-mask);
      const st = Math.log2(bit) | 0;
      assigned[bestPos] = st;
      if (dfs()) return true;
      assigned[bestPos] = -1;
      mask &= mask - 1;
      if (bailed) return false;
    }
    return false;
  }
  const ok = dfs();
  if (bailed) return { result: 'unknown' };
  return { result: ok, solution: ok ? Array.from(assigned) : null, states, W, H };
}

// ---------- Torus feasibility (wraparound, P x Q x {up,down}) ----------
function torusFeasible(tiles, reflectableFlags, P, Q, opts = {}) {
  const budget = opts.budget || 500_000;
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : null;
  const states = buildStates(tiles, reflectableFlags);
  const { upToDown, downToUp, NS } = buildAdjBitmasks(tiles, states);
  const FULL = FULL_MASK_FOR(NS);
  const idx = (a, b, s) => (((a % P + P) % P) * Q + ((b % Q + Q) % Q)) * 2 + s;
  const N = P * Q * 2;
  const assigned = new Int16Array(N).fill(-1);

  const neighborsOf = new Array(N);
  for (let a = 0; a < P; a++) for (let b = 0; b < Q; b++) for (let s = 0; s < 2; s++) {
    const list = [];
    const offsets = s === 0 ? UP_OFFSETS : DOWN_OFFSETS;
    for (let e = 0; e < 3; e++) {
      const [da, db] = offsets[e];
      const ns = 1 - s;
      const nIdx = idx(a + da, b + db, ns);
      if (nIdx !== idx(a, b, s)) list.push([nIdx, e, s === 0]);
    }
    neighborsOf[idx(a, b, s)] = list;
  }

  function candidateMask(pos) {
    let mask = FULL;
    for (const [nIdx, e, isUpRole] of neighborsOf[pos]) {
      const nVal = assigned[nIdx];
      if (nVal === -1) continue;
      mask &= isUpRole ? downToUp[e][nVal] : upToDown[e][nVal];
      if (mask === 0) return 0;
    }
    return mask;
  }

  let nodes = 0, bailed = false;
  function dfs() {
    if (bailed) return false;
    nodes++;
    if (nodes > budget) { bailed = true; return false; }
    if (deadline && (nodes & 0xFFF) === 0 && Date.now() > deadline) { bailed = true; return false; }
    let bestPos = -1, bestMask = 0, bestCount = NS + 1;
    for (let pos = 0; pos < N; pos++) {
      if (assigned[pos] !== -1) continue;
      const mask = candidateMask(pos);
      if (mask === 0) return false;
      const count = popcount32(mask);
      if (count < bestCount) { bestCount = count; bestPos = pos; bestMask = mask; if (count === 1) break; }
    }
    if (bestPos === -1) return true;
    let mask = bestMask;
    while (mask) {
      const bit = mask & (-mask);
      const st = Math.log2(bit) | 0;
      assigned[bestPos] = st;
      if (dfs()) return true;
      assigned[bestPos] = -1;
      mask &= mask - 1;
      if (bailed) return false;
    }
    return false;
  }
  const ok = dfs();
  if (bailed) return { result: 'unknown' };
  return { result: ok, solution: ok ? Array.from(assigned) : null, states, P, Q };
}

module.exports = { patchFeasible, torusFeasible, buildStates, buildAdjBitmasks, isReflectionRedundant };

// ============================================================================
// Self-test (same cases as before, must still pass) + benchmark
// ============================================================================
if (require.main === module) {
  const { pack } = require('./lattice.js');

  console.log('=== Sanity 1: all-flat triangle (every edge self-matches) ===');
  const allFlat = [[pack(3, 0, 2, 2), pack(3, 0, 2, 2), pack(3, 0, 2, 2)]];
  console.log('  3x3 patch feasible (expect true):', patchFeasible(allFlat, [true], 3, 3).result);
  console.log('  2x2 torus feasible (expect true):', torusFeasible(allFlat, [true], 2, 2).result);

  console.log('=== Sanity 2: a tile with an edge that cannot match anything ===');
  const stuck = [[pack(0, 5, 0, 0), pack(3, 0, 2, 2), pack(3, 0, 2, 2)]];
  console.log('  2x2 patch feasible (expect false):', patchFeasible(stuck, [true], 2, 2).result);

  console.log('=== Benchmark: classify 5000 canonical n=2 shapes ===');
  const { enumerateCanonical } = require('./alphabet.js');
  const { classify } = require('./classify.js');
  const start = Date.now();
  let count = 0;
  for (const tiles of enumerateCanonical(2)) {
    classify(tiles, [true, true]);
    count++;
    if (count >= 5000) break;
  }
  const elapsed = (Date.now() - start) / 1000;
  console.log(`  ${count} shapes in ${elapsed.toFixed(2)}s = ${(count / elapsed).toFixed(0)}/s (single thread)`);
}
