'use strict';
// ============================================================================
// Vertex-star (corner-digraph) filter -- a necessary condition beyond simple
// edge-matching, ported from the external report's corner.py.
//
// Every internal vertex of the triangular lattice is surrounded by exactly
// 6 triangles. Going around the vertex, each pair of angularly-adjacent
// triangles shares an edge -- a "corner". If (alpha,beta) is a corner (the
// label presented on one side, and the label presented going into the next
// triangle), a valid tiling needs the vertex to close up after exactly 6
// steps. This builds the directed graph of corner-transitions and keeps
// only corners that lie on some length-6 closed walk; anything that can
// never appear in a consistent vertex neighbourhood is provably unusable in
// any tiling, even if ordinary single-edge matching doesn't see it.
//
// This does NOT need up vs down distinguished: the model guarantees the
// same set of (p0,p1,p2) presented-label triples is achievable at both, so
// generating placements at "up" slots for every (tile, orientation) already
// covers every triple that could ever appear anywhere.
// ============================================================================
const { rho, L } = require('./lattice.js');

function corners(p) {
  // p = [p0,p1,p2]; corner i is (label at next slot, label at this slot)
  return [0, 1, 2].map(i => [p[(i + 1) % 3], p[i]]);
}

function generatePlacements(tiles, reflectableFlags) {
  const out = [];
  tiles.forEach((mu, t) => {
    const group = reflectableFlags[t] ? [0, 1, 2, 3, 4, 5] : [0, 2, 4];
    for (const g of group) {
      out.push({ tile: t, g, labels: [L(mu, g, 0, 0), L(mu, g, 1, 0), L(mu, g, 2, 0)] });
    }
  });
  return out;
}

// Boolean matrix power via repeated squaring-free multiplication (n is tiny: <=~30).
function matmulBool(X, Y, n) {
  const res = Array.from({ length: n }, () => new Uint8Array(n));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      if (!X[i][k]) continue;
      const Yk = Y[k];
      const Ri = res[i];
      for (let j = 0; j < n; j++) if (Yk[j]) Ri[j] = 1;
    }
  }
  return res;
}

// Given the current set of surviving placements' label-triples, return the
// set of corners (as 'a,b' strings) that lie on a length-6 closed walk.
function cornerOkSet(labelTriples) {
  const cornerList = [];
  const seenCorner = new Set();
  for (const p of labelTriples) {
    for (const [a, b] of corners(p)) {
      const k = a + ',' + b;
      if (!seenCorner.has(k)) { seenCorner.add(k); cornerList.push([a, b]); }
    }
  }
  const labelSet = new Set();
  for (const [a, b] of cornerList) { labelSet.add(a); labelSet.add(rho(b)); }
  const labs = [...labelSet].sort((x, y) => x - y);
  const idx = new Map(labs.map((l, i) => [l, i]));
  const n = labs.length;
  if (n === 0) return new Set();
  const A = Array.from({ length: n }, () => new Uint8Array(n));
  for (const [a, b] of cornerList) A[idx.get(a)][idx.get(rho(b))] = 1;
  let R = A; // length-1 walk
  for (let step = 2; step <= 5; step++) R = matmulBool(R, A, n); // R = length-5 walk reachability
  const ok = new Set();
  for (const [a, b] of cornerList) {
    const i = idx.get(a), j = idx.get(rho(b));
    if (R[j][i]) ok.add(a + ',' + b);
  }
  return ok;
}

// Iteratively prune placements: an edge-viability pass (a placement survives
// only if every one of its edges has SOME match among currently-surviving
// placements, from any tile/orientation) interleaved with the corner filter,
// until a fixed point. Returns { nonTiler: bool, survivingPlacements }.
function vertexStarPrune(tiles, reflectableFlags) {
  let placements = generatePlacements(tiles, reflectableFlags);

  while (true) {
    const n0 = placements.length;
    if (n0 === 0) return { nonTiler: true, survivingPlacements: [] };

    // Edge-viability: every label used by a surviving placement must have
    // rho(label) presented by SOME surviving placement (any slot, any tile).
    const achievable = new Set();
    for (const p of placements) for (const l of p.labels) achievable.add(l);
    placements = placements.filter(p => p.labels.every(l => achievable.has(rho(l))));
    if (placements.length === 0) return { nonTiler: true, survivingPlacements: [] };

    // Corner / vertex-star filter.
    const ok = cornerOkSet(placements.map(p => p.labels));
    placements = placements.filter(p => corners(p.labels).every(([a, b]) => ok.has(a + ',' + b)));
    if (placements.length === 0) return { nonTiler: true, survivingPlacements: [] };

    if (placements.length === n0) return { nonTiler: false, survivingPlacements: placements };
  }
}

module.exports = { vertexStarPrune, generatePlacements, corners, cornerOkSet };

// ============================================================================
// Self-test
// ============================================================================
if (require.main === module) {
  const { pack } = require('./lattice.js');
  const ap = pack(0, 0, 0, 0), aq = pack(0, 0, 0, 1);
  const Ba = pack(1, 0, 0, 2), Bb = pack(1, 0, 1, 2);

  console.log('=== Report\'s n=2 example: T1=(ap,ap,ap), T2=(aq,Ba,Bb), both chiral ===');
  console.log('    conservation law holds (x2=3x1) but claimed non-tiler via the 4-cycle ap->aq->Bb->Ba->ap');
  const r1 = vertexStarPrune([[ap, ap, ap], [aq, Ba, Bb]], [false, false]);
  console.log('  result (expect nonTiler=true):', r1.nonTiler);

  console.log('=== Sanity: our own verified n=1 periodic examples must NOT be flagged ===');
  const fs = require('fs');
  if (fs.existsSync('bench/n1/periodic_w0.jsonl')) {
    const lines = fs.readFileSync('bench/n1/periodic_w0.jsonl', 'utf8').trim().split('\n');
    let falsePositives = 0;
    for (const line of lines) {
      const rec = JSON.parse(line);
      const r = vertexStarPrune(rec.tiles, rec.reflectableFlags);
      if (r.nonTiler) { falsePositives++; console.log('  FALSE POSITIVE on', JSON.stringify(rec.tiles)); }
    }
    console.log(`  ${lines.length} known-periodic n=1 shapes checked, false positives: ${falsePositives} (expect 0)`);
  }

  console.log('=== Sanity: mixed-chirality counterexample (genuinely periodic) must NOT be flagged ===');
  const r2 = vertexStarPrune([[0, 323, 323], [160, 323, 323]], [true, false]);
  console.log('  result (expect nonTiler=false):', r2.nonTiler);
}
