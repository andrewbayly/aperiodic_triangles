'use strict';
const { patchFeasible, torusFeasible } = require('./solver.js');
const { hasUnmatchableEdge } = require('./check_unmatchable.js');
const { checkConservationLaw } = require('./conservation_check.js');
const { hasDuplicateTile } = require('./duplicate_tile_check.js');

// Torus sizes to check, in increasing order of cost.
const TORUS_BATTERY = [
  [1, 1], [2, 1], [1, 2], [2, 2],
  [3, 1], [1, 3], [3, 2], [2, 3], [3, 3],
  [4, 1], [1, 4], [4, 2], [2, 4], [4, 3], [3, 4], [4, 4],
  [5, 1], [1, 5], [5, 2], [2, 5], [5, 3], [3, 5], [5, 4], [4, 5], [5, 5],
  [6, 1], [1, 6], [6, 2], [2, 6], [6, 3], [3, 6], [6, 4], [4, 6], [6, 5], [5, 6], [6, 6],
];

// Patch sizes to check, increasing. Patch infeasibility at ANY size is an
// unconditional proof of non-existence (Lemma 3.2's argument), regardless
// of what smaller sizes showed -- a bigger open-boundary patch has
// strictly more internal constraints, so feasibility does not carry over
// from small to large. This was found (via the conversation's visual
// inspection detour) to resolve the large majority of what otherwise
// looked like aperiodic-candidates when only 3x3 was checked.
const PATCH_BATTERY = [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]];

function classify(tiles, reflectableFlags, opts = {}) {
  const patchBudget = opts.patchBudget || 2_000_000;
  const torusBudget = opts.torusBudget || 300_000;

  // 0. Duplicate tile (user-devised): if two tiles are identical (up to
  // rotation, same reflectability), this tileset is provably equivalent to
  // the smaller tileset with the duplicate removed -- since n=2 has been
  // fully resolved with ZERO aperiodic-candidates, any n=3 set with a
  // duplicate tile can never be a genuine candidate, and running the full
  // (larger) n=3 patch/torus battery on it wastes disproportionate time
  // for no new information. Skipped rather than classified as periodic or
  // non-tiler here, since determining WHICH of those it is would require
  // looking up (or re-running) the equivalent smaller tileset -- the
  // answer already exists in the n=2 (or n=1) results.
  if (tiles.length > 1 && hasDuplicateTile(tiles, reflectableFlags)) {
    return { status: 'skipped', reason: 'duplicate-tile' };
  }

  // Cheapest checks first, in increasing order of cost. Both of the first
  // two are pure combinatorics/linear-algebra -- no search at all -- and
  // both were validated to produce zero false positives against known
  // periodic shapes before being trusted here.

  // 1. Unmatchable edge: does every edge have SOME possible complement
  // anywhere in the tileset (accounting for tiles that may simply go
  // unused)? If not, provably non-tileable.
  if (hasUnmatchableEdge(tiles, reflectableFlags).unmatchable) {
    return { status: 'non-tiler', reason: 'unmatchable-edge' };
  }

  // 2. Conservation law (user-devised): in any valid tiling, the total
  // count of "p"-paired edges of a given (class,flavor,partnership) type
  // must equal the total count of "q"-paired edges of that type. If the
  // only non-negative solution to this linear system is all-zero, no
  // valid tiling can exist.
  if (checkConservationLaw(tiles, reflectableFlags).unmatchable) {
    return { status: 'non-tiler', reason: 'conservation-law' };
  }

  // 3. Patch battery: increasing open-boundary sizes. Any infeasible size
  // is a rigorous, unconditional proof of non-existence.
  let largestFeasibleSize = null;
  for (const [W, H] of PATCH_BATTERY) {
    const patchResult = patchFeasible(tiles, reflectableFlags, W, H, { budget: patchBudget });
    if (patchResult.result === false) {
      return { status: 'non-tiler', reason: 'patch-infeasible', atSize: `${W}x${H}` };
    }
    if (patchResult.result === true) largestFeasibleSize = `${W}x${H}`;
    // 'unknown' (budget exceeded): inconclusive at this size, continue
  }

  // 4. Torus battery: increasing wraparound sizes. Any feasible size is a
  // rigorous, unconditional proof a periodic tiling exists.
  let unresolved = [];
  for (const [P, Q] of TORUS_BATTERY) {
    const t = torusFeasible(tiles, reflectableFlags, P, Q, { budget: torusBudget });
    if (t.result === true) {
      return { status: 'periodic', patch: extractPatchRecord(tiles, reflectableFlags, t, P, Q) };
    }
    if (t.result === 'unknown') unresolved.push([P, Q]);
  }

  return { status: 'aperiodic-candidate', patchFeasibleAt: largestFeasibleSize, torusChecked: TORUS_BATTERY, torusUnresolved: unresolved };
}

function extractPatchRecord(tiles, reflectableFlags, torusResult, P, Q) {
  const { solution, states } = torusResult;
  const domain = [];
  for (let a = 0; a < P; a++) {
    for (let b = 0; b < Q; b++) {
      for (let s = 0; s < 2; s++) {
        const idx = (a * Q + b) * 2 + s;
        const st = solution[idx];
        const { tileIndex, g } = states[st];
        domain.push({ a, b, slot: s === 0 ? 'up' : 'down', tile: tileIndex, orientation: g });
      }
    }
  }
  return {
    periodVectors: [[P, 0], [0, Q]],
    fundamentalDomainSize: { P, Q },
    domain,
  };
}

module.exports = { classify, TORUS_BATTERY, PATCH_BATTERY, extractPatchRecord };

if (require.main === module) {
  const { pack } = require('./lattice.js');
  console.log('=== Classify: all-flat triangle (should be periodic) ===');
  const allFlat = [[pack(3, 0, 2, 2), pack(3, 0, 2, 2), pack(3, 0, 2, 2)]];
  console.log(JSON.stringify(classify(allFlat, [true]), null, 2).slice(0, 300));
  console.log('=== Classify: stuck tile (should be non-tiler) ===');
  const stuck = [[pack(0, 5, 0, 0), pack(3, 0, 2, 2), pack(3, 0, 2, 2)]];
  console.log(classify(stuck, [true]));
  console.log('=== Classify: real example, feasible at 3x3 but infeasible at 4x4 ===');
  const largePatchNonTiler = [[66,70,323],[66,194,198]];
  console.log(classify(largePatchNonTiler, [true, true]));
}
