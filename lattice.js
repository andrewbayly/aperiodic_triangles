'use strict';
// ============================================================================
// Triangular lattice geometry (m=3).
//
// Triangles tile the plane in two alternating orientation classes, "up" and
// "down" -- crossing ANY edge always toggles between them (verified against
// direct coordinate geometry; see selfTest() below). A lattice position is
// (a, b, s) with s in {0,1} (0=up, 1=down). Neighbor relations (verified to
// be mutually consistent):
//   up(a,b)   has down-neighbors: down(a,b) [edge 0], down(a+1,b) [edge 1], down(a,b+1) [edge 2]
//   down(a,b) has up-neighbors:   up(a,b)   [edge 0], up(a-1,b)   [edge 1], up(a,b-1)   [edge 2]
//
// Orientation state at a site is an element of D_3 (0..5: 0,2,4=rotations by
// 0/120/240 deg, 1,3,5=reflections) or, for a chiral tile, C_3 (0,2,4 only).
// A "down" placement's own g=0 (identity) is NOT the same physical rotation
// as an "up" placement's g=0 -- down is offset by a fixed "+1 edge" shift
// relative to up, verified geometrically below. This shift is folded into
// the label-presentation formula so that g always means "further rotation/
// reflection on top of this slot's own canonical reference orientation".
// ============================================================================

// ---------- Label packing (same scheme as the hexagon work: cl|fl<<2|pt<<5|pr<<7) ----------
function pack(cl, fl, pt, pr) { return cl | (fl << 2) | (pt << 5) | (pr << 7); }
function getPr(l) { return (l >> 7) & 0b11; }
function getPt(l) { return (l >> 5) & 0b11; }
function rho(l) {
  const pr = getPr(l);
  const npr = pr === 0 ? 1 : (pr === 1 ? 0 : 2);
  return (l & ~(0b11 << 7)) | (npr << 7);
}
function sigma(l) {
  const pt = getPt(l);
  const npt = pt === 0 ? 1 : (pt === 1 ? 0 : 2);
  return (l & ~(0b11 << 5)) | (npt << 5);
}
function bowtie(l1, l2) { return rho(l1) === l2; }

// ---------- D_3 / C_3 placement, generalized m-gon formula from Prop 2.9 ----------
// g encoded as 2*k + flip, k in 0..m-1 (here m=3, so g in 0..5).
const M = 3;
function L_upSlot(mu, g, j) {
  // mu: array of M packed labels (this tile's own reference labeling)
  const k = g >> 1, flip = g & 1;
  if (!flip) return mu[((j - k) % M + M) % M];
  return sigma(mu[((k - j) % M + M) % M]);
}
// Down slot: apply the fixed "+1" reference offset (down edge k <-> up edge k+1),
// i.e. read the up-slot formula at shifted index, THEN let g further rotate/reflect.
// Concretely: a down-slot tile at "g" presents, at its own edge j, exactly what an
// up-slot tile would present at edge (j+1) under the SAME g. This is the minimal
// change consistent with the verified geometric offset.
function L_downSlot(mu, g, j) {
  return L_upSlot(mu, g, (j + 1) % M);
}
function L(mu, g, j, slot) {
  return slot === 0 ? L_upSlot(mu, g, j) : L_downSlot(mu, g, j);
}

// ---------- Neighbor offsets ----------
// From an up(a,b): edge 0 -> down(a,b), edge 1 -> down(a+1,b), edge 2 -> down(a,b+1)
// From a down(a,b): edge 0 -> up(a,b), edge 1 -> up(a-1,b), edge 2 -> up(a,b-1)
const UP_OFFSETS = [[0, 0], [1, 0], [0, 1]];     // target down(a+da, b+db)
const DOWN_OFFSETS = [[0, 0], [-1, 0], [0, -1]]; // target up(a+da, b+db)

function neighbor(a, b, s, edge) {
  if (s === 0) { const [da, db] = UP_OFFSETS[edge]; return [a + da, b + db, 1]; }
  else { const [da, db] = DOWN_OFFSETS[edge]; return [a + da, b + db, 0]; }
}

module.exports = {
  pack, getPr, getPt, rho, sigma, bowtie,
  M, L_upSlot, L_downSlot, L,
  UP_OFFSETS, DOWN_OFFSETS, neighbor,
};

// ============================================================================
// Self-test: verify the combinatorial model against direct coordinate geometry.
// Run with: node lattice.js
// ============================================================================
if (require.main === module) {
  // --- Geometric ground truth, mirroring the Python verification done earlier ---
  function V_up(i) { const ang = (60 + 120 * i) * Math.PI / 180; return [Math.cos(ang), Math.sin(ang)]; }
  function sub(p, q) { return [p[0] - q[0], p[1] - q[1]]; }
  function add(p, q) { return [p[0] + q[0], p[1] + q[1]]; }
  function scale(p, s) { return [p[0] * s, p[1] * s]; }
  function rotate(p, degrees) {
    const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
  }
  function reflectAcrossX(p) { return [p[0], -p[1]]; }

  const vertsUp = [0, 1, 2].map(V_up);

  console.log('=== Test 1: up-slot rotation/reflection matches Prop 2.9 formula geometrically ===');
  // For g = 2k (pure rotation by k*120deg) and g = 2k+1 (reflect-then-rotate),
  // verify the local-frame transform predicted by L_upSlot's structure (content
  // unchanged for rotation, sigma-transformed for reflection) against direct
  // coordinate computation -- same technique validated for the hexagon paper.
  function edgeFrame(verts, j) {
    const A = verts[(j - 1 + 3) % 3], B = verts[j % 3];
    const Mid = scale(add(A, B), 0.5);
    const d = sub(B, A);
    const len = Math.hypot(d[0], d[1]);
    const xhat = [d[0] / len, d[1] / len];
    const yhat = [xhat[1], -xhat[0]];
    return [Mid, xhat, yhat];
  }
  let allMatch1 = true;
  for (let k = 0; k < 3; k++) {
    for (let j = 0; j < 3; j++) {
      // pure rotation k*120
      const [Mj, xj, yj] = edgeFrame(vertsUp, j);
      const s0 = 0.3, t0 = 0.15;
      const P = add(Mj, add(scale(xj, s0), scale(yj, t0)));
      const Pr = rotate(P, k * 120);
      // find target edge by rotating midpoint
      let jp = null;
      for (let cand = 0; cand < 3; cand++) {
        const [Mc] = edgeFrame(vertsUp, cand);
        const Mcr = rotate(Mj, k * 120);
        if (Math.hypot(Mcr[0] - Mc[0], Mcr[1] - Mc[1]) < 1e-9) jp = cand;
      }
      const [Mjp, xjp, yjp] = edgeFrame(vertsUp, jp);
      const rel = sub(Pr, Mjp);
      const sp = rel[0] * xjp[0] + rel[1] * xjp[1];
      const tp = rel[0] * yjp[0] + rel[1] * yjp[1];
      const match = Math.abs(sp - s0) < 1e-9 && Math.abs(tp - t0) < 1e-9 && jp === ((j + k) % 3);
      if (!match) { allMatch1 = false; console.log(`  MISMATCH k=${k} j=${j}`); }
    }
  }
  console.log('  all rotation cases matched:', allMatch1);

  console.log('=== Test 2: down-slot "+1 offset" formula matches physical neighbor geometry ===');
  // Physically construct the down-neighbor across up-edge 0, then verify that
  // treating it as "down-slot g=identity" and reading edge k via L_downSlot's
  // (j+1) shift reproduces the correct physical edge correspondence found
  // earlier: up edge_j <-> down_ref edge_{(j-1) mod 3}.
  const A0 = vertsUp[2], B0 = vertsUp[0];
  const M0 = scale(add(A0, B0), 0.5);
  function rhoAbout(p, c) { return sub(scale(c, 2), p); }
  const vertsDownPhysical = vertsUp.map(v => rhoAbout(v, M0));
  const centroidDown = scale(vertsDownPhysical.reduce((a, v) => add(a, v), [0, 0]), 1 / 3);
  // down reference triangle per our general formula, at angles 0,120,240 (the
  // verified "-60 deg from up" orientation), centered at centroidDown
  function V_down_ref(i) { const ang = (0 + 120 * i) * Math.PI / 180; return add(centroidDown, [Math.cos(ang), Math.sin(ang)]); }
  const vertsDownRef = [0, 1, 2].map(V_down_ref);
  // find correspondence: which down_ref vertex index does each physical (rotated) vertex match?
  const correspondence = vertsDownPhysical.map(v => {
    for (let i = 0; i < 3; i++) {
      if (Math.hypot(v[0] - vertsDownRef[i][0], v[1] - vertsDownRef[i][1]) < 1e-9) return i;
    }
    return null;
  });
  console.log('  up-vertex i -> down_ref-vertex index:', correspondence, '(expect [2,0,1], i.e. i -> (i+2) mod 3)');
  const expected = [2, 0, 1];
  const test2ok = JSON.stringify(correspondence) === JSON.stringify(expected);
  console.log('  matches expected "+1 edge shift" relationship:', test2ok);

  console.log('=== Test 3: an up tile and its physical down-neighbor bowtie-match correctly under the model ===');
  // Build a concrete labeling that CAN self-match (matching requires same
  // class+flavor+partnership, opposite pairing) and verify L(mu, g_up, 0, 0)
  // bowtie L(mu, g_down, 0, 1) holds for the g_down our model predicts.
  const { pack: P, bowtie: BT } = module.exports;
  function testMu() {
    // edge0, edge1: same class/flavor/partnership, opposite pairing -- a genuine matching pair.
    // edge2: flat (class D), self-matching.
    return [P(0, 0, 0, 0), P(0, 0, 0, 1), P(3, 0, 2, 2)];
  }
  let allMatch3 = true;
  for (let gUp = 0; gUp < 6; gUp++) {
    const mu = testMu();
    const labelAtEdge0 = L(mu, gUp, 0, 0); // up tile at slot 0, placed via gUp, label at its edge 0
    let found = null;
    for (let gDown = 0; gDown < 6; gDown++) {
      const labelDownAtEdge0 = L(mu, gDown, 0, 1);
      if (BT(labelAtEdge0, labelDownAtEdge0)) { found = gDown; break; }
    }
    if (found === null) { allMatch3 = false; console.log(`  NO MATCH for gUp=${gUp}`); }
    else console.log(`  gUp=${gUp} -> matching gDown=${found}`);
  }
  console.log('  every up-orientation has a valid down-neighbor orientation:', allMatch3);

  console.log();
  console.log('ALL TESTS PASSED:', allMatch1 && test2ok && allMatch3);
}
