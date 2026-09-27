'use strict';
// ============================================================================
// Linear conservation-law check (user-devised): in any valid tiling, every
// "p"-paired edge of a given (class, flavor, partnership) type must be
// adjacent to exactly one "q"-paired edge of the SAME type (matching
// requires identical class+flavor+partnership, opposite pairing) -- so
// across the whole tiling (or any large patch), the total count of p-edges
// of that type must equal the total count of q-edges of that type. This
// gives one linear equation per non-self-matching notch type (classes A
// and C, where pairing is genuinely p or q). Self-matching types (B, D;
// pairing always r) contribute no equation -- an r-edge matches another
// r-edge of the same type with no p/q asymmetry to balance.
//
// Variables: one per (tile, reflection-state) pair that's actually
// achievable -- rotation never changes which edges a tile contributes
// (only repositions them), so only reflection state matters, giving one
// variable for a chiral tile and two (unreflected, reflected) for a
// reflectable one.
//
// The system Ax=0, x>=0 always has the trivial solution x=0. If that's the
// ONLY non-negative solution, no valid tiling can exist (any real tiling
// of a large patch would give a nontrivial non-negative count vector) --
// this is checked via linear programming: maximize sum(x) subject to
// Ax=0, 0<=x<=1; a positive optimum proves a nontrivial solution exists,
// zero proves the tileset is non-tileable by this argument.
// ============================================================================
const solver = require('javascript-lp-solver');
const { rho, sigma } = require('./lattice.js');

function getCl(l) { return l & 0b11; }
function getFl(l) { return (l >> 2) & 0b111; }
function getPt(l) { return (l >> 5) & 0b11; }
function getPr(l) { return (l >> 7) & 0b11; }

// Build the list of (tileIndex, reflected) variables and, for each, its
// multiset of 3 edge labels (after applying sigma if reflected).
function buildVariables(tiles, reflectableFlags) {
  const vars = [];
  for (let t = 0; t < tiles.length; t++) {
    vars.push({ tileIndex: t, reflected: false, labels: tiles[t].slice() });
    if (reflectableFlags[t]) {
      vars.push({ tileIndex: t, reflected: true, labels: tiles[t].map(sigma) });
    }
  }
  return vars;
}

// Returns { unmatchable: true } if the ONLY non-negative solution to the
// conservation equations is the trivial all-zero vector (proving the
// tileset cannot admit any valid tiling), or { unmatchable: false } if a
// nontrivial solution exists (inconclusive -- does not prove tileability,
// only that this particular check doesn't rule it out).
function checkConservationLaw(tiles, reflectableFlags) {
  const vars = buildVariables(tiles, reflectableFlags);
  if (vars.length === 0) return { unmatchable: true };

  // group by (class, flavor, partnership) for classes A(0), C(2) only
  const noteTypeKey = (cl, fl, pt) => `${cl}_${fl}_${pt}`;
  const equationTypes = new Set();
  for (const v of vars) {
    for (const label of v.labels) {
      const cl = getCl(label);
      if (cl === 0 || cl === 2) equationTypes.add(noteTypeKey(cl, getFl(label), getPt(label)));
    }
  }

  if (equationTypes.size === 0) {
    // no non-self-matching edges at all -- every edge is B/D (self-matching),
    // which always admits x=1 for any single variable (an all-r tile can
    // always self-tile in isolation), so this check never rules it out.
    return { unmatchable: false };
  }

  // Build the LP model for javascript-lp-solver: variables x_0..x_{n-1},
  // one constraint per equation type (equality to 0), objective maximize
  // sum(x), each variable bounded in [0,1] to keep the LP bounded.
  const model = {
    optimize: 'total',
    opType: 'max',
    constraints: {},
    variables: {},
  };
  for (const key of equationTypes) model.constraints[key] = { equal: 0 };

  vars.forEach((v, i) => {
    const varName = `x${i}`;
    const coeffs = { total: 1 };
    for (const key of equationTypes) coeffs[key] = 0;
    for (const label of v.labels) {
      const cl = getCl(label);
      if (cl !== 0 && cl !== 2) continue;
      const key = noteTypeKey(cl, getFl(label), getPt(label));
      const pr = getPr(label);
      if (pr === 0) coeffs[key] += 1;      // pairing p: +1
      else if (pr === 1) coeffs[key] -= 1; // pairing q: -1
      // pr===2 (r) can't happen for class A/C, but guard anyway
    }
    model.variables[varName] = coeffs;
    model.constraints[`ub_${varName}`] = { max: 1 };
  });
  // upper bounds need per-variable coefficients too
  vars.forEach((v, i) => {
    const varName = `x${i}`;
    model.variables[varName][`ub_${varName}`] = 1;
  });

  const result = solver.Solve(model);
  const objective = result.feasible ? (result.result || 0) : 0;
  const unmatchable = !result.feasible || objective < 1e-7;
  return { unmatchable, objective, numVars: vars.length, numEquations: equationTypes.size };
}

module.exports = { checkConservationLaw, buildVariables };

// ============================================================================
// Self-test: hand-verifiable cases before trusting this on real data.
// ============================================================================
if (require.main === module) {
  const { pack } = require('./lattice.js');

  console.log('=== Case 1: single tile, one edge has a flavor used nowhere else (non-tiler) ===');
  // A0ap, A0ap, A1ap -- flavor 1 (A1ap) appears only once, always pairing=p,
  // never balanced by any A1aq -- equation for (A,1,a): coefficient is
  // +1 for this variable (one p, zero q of that type), must equal 0,
  // forcing x=0. Should be unmatchable.
  const t1 = [[pack(0,0,0,0), pack(0,0,0,0), pack(0,1,0,0)]];
  console.log(checkConservationLaw(t1, [true]));

  console.log('=== Case 2: single tile, all self-consistent (should NOT be flagged) ===');
  // A0ap, A0aq, D-flat -- p and q both present for flavor 0, balanced.
  const t2 = [[pack(0,0,0,0), pack(0,0,0,1), pack(3,0,2,2)]];
  console.log(checkConservationLaw(t2, [true]));

  console.log('=== Case 3: reflectable tile balancing ONLY via its own reflection ===');
  // A0ap, A0ap, D-flat: unreflected gives 2p+0q for (A,0,a) -- imbalanced
  // alone. Reflected: sigma flips partnership a->b, giving (A,0,b) type
  // with 2p+0q -- ALSO imbalanced (different partnership bucket). So this
  // should be flagged unmatchable even though reflection is allowed,
  // since reflection changes partnership, not pairing, and can never turn
  // a p into a q.
  const t3 = [[pack(0,0,0,0), pack(0,0,0,0), pack(3,0,2,2)]];
  console.log(checkConservationLaw(t3, [true]));

  console.log('=== Case 4: two tiles, cross-tile balance only (should NOT be flagged) ===');
  // tile0: A0ap, D, D. tile1: A0aq, D, D -- p and q balance ACROSS tiles.
  const t4 = [[pack(0,0,0,0), pack(3,0,2,2), pack(3,0,2,2)], [pack(0,0,0,1), pack(3,0,2,2), pack(3,0,2,2)]];
  console.log(checkConservationLaw(t4, [true, true]));

  console.log('=== Case 5: all self-matching (B/D only) -- never flagged ===');
  const t5 = [[pack(3,0,2,2), pack(3,0,2,2), pack(3,0,2,2)]];
  console.log(checkConservationLaw(t5, [true]));
}
