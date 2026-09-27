'use strict';
// ============================================================================
// Necessary-condition pre-check: for a tileset to admit ANY valid infinite
// tiling, there must be a NONEMPTY subset of tiles that could conceivably
// be used together -- every edge of every tile in that subset must have
// SOME possible match within the subset (a tile with even one dead edge
// can never be placed anywhere, since placing it exposes all 3 of its
// edges). This is found by iterative pruning: remove any tile with an
// unmatchable edge given the CURRENT surviving set, repeat until stable.
// If every tile gets pruned away, the tileset is provably non-tileable.
//
// IMPORTANT CORRECTION (see conversation): an earlier version of this check
// required ALL tiles' edges to be mutually matchable, which is too strict
// for n>=2 -- a multi-tile tileset can be genuinely valid even if one tile
// is simply never used, so long as the REMAINING tile(s) can self-tile.
// Verified concretely: a tileset with one unmatchable-edge tile plus one
// fully self-matching tile is genuinely torus-feasible (periodic) using
// only the good tile -- the original all-or-nothing check wrongly flagged
// it, which was traced to a ~14,000-shape drop in the n=2 periodic count
// (18,819 -> 4,870) before this fix.
// ============================================================================
const { rho, sigma } = require('./lattice.js');

function hasUnmatchableEdge(tiles, reflectableFlags) {
  let alive = tiles.map((_, i) => i);

  while (alive.length > 0) {
    // achievable labels using only the currently-alive tiles
    const achievable = new Set();
    for (const t of alive) {
      for (const label of tiles[t]) {
        achievable.add(label);
        if (reflectableFlags[t]) achievable.add(sigma(label));
      }
    }
    // A tile is dead only if NO orientation of it has all-matchable edges.
    // For a chiral tile, only the raw (unreflected) presentation is ever
    // placed. For a reflectable tile, EITHER the raw presentation OR the
    // sigma'd (reflected) presentation may be the one actually used in a
    // tiling -- checking only the raw labels wrongly kills a reflectable
    // tile that only works in its reflected orientation (e.g. next to a
    // chiral neighbour whose labels only match the mirrored form).
    let deadTile = null;
    for (const t of alive) {
      const rawOk = tiles[t].every(label => achievable.has(rho(label)));
      const reflOk = reflectableFlags[t] && tiles[t].every(label => achievable.has(rho(sigma(label))));
      if (!rawOk && !reflOk) { deadTile = t; break; }
    }
    if (deadTile === null) return { unmatchable: false, survivingTiles: alive };
    alive = alive.filter(t => t !== deadTile);
  }
  return { unmatchable: true, label: null }; // every tile got pruned away
}

module.exports = { hasUnmatchableEdge };

// ============================================================================
// Self-test: the original example (genuinely non-tileable, n=1-equivalent
// single problem tile), the corrected counterexample (n=2, one bad tile +
// one self-sufficient tile -- must NOT be flagged), and a genuinely
// unmatchable n=2 case (both tiles mutually dependent on a missing match).
// ============================================================================
if (require.main === module) {
  const { pack } = require('./lattice.js');

  console.log('=== Case 1: pair that is genuinely non-tileable, but not via this cheap check ===');
  // Both tiles here are non-tilers (confirmed independently by classify.js's
  // full patch/torus search), but neither has a *multiset-level* unmatchable
  // edge on its own, so this pre-check correctly defers to the slower,
  // always-sound stages rather than claiming a false certificate here. This
  // check is a necessary-but-not-sufficient pre-filter: "false" means "not
  // provably dead by this cheap test", not "definitely tiles".
  const tile0 = [pack(0, 0, 0, 0), pack(0, 0, 0, 0), pack(0, 1, 0, 0)];
  const tile1 = [pack(0, 0, 0, 0), pack(0, 0, 0, 1), pack(0, 0, 0, 1)];
  console.log('  result (expect unmatchable=false; classify.js correctly finds non-tiler downstream):', hasUnmatchableEdge([tile0, tile1], [true, true]));

  console.log('=== Case 2: bad tile + self-sufficient tile -- must NOT be flagged ===');
  const badTile = [pack(0, 1, 0, 0), pack(3, 0, 2, 2), pack(3, 0, 2, 2)];
  const goodTile = [pack(1, 0, 0, 2), pack(1, 0, 1, 2), pack(3, 0, 2, 2)];
  console.log('  result (expect unmatchable=false, since goodTile alone suffices):', hasUnmatchableEdge([badTile, goodTile], [true, true]));

  console.log('=== Case 3: single tile (n=1) with one dead edge -- must STILL be unmatchable ===');
  // For n=1 there is no "subset" option: the one tile is either used (and
  // ALL its edges get exposed) or not used at all, which isn't a tileset.
  // Edges 1,2 matching each other does not save edge 0.
  const t0 = [pack(0, 1, 0, 0), pack(0, 0, 0, 0), pack(0, 0, 0, 1)]; // A1ap (dead), A0ap, A0aq (mutually fine)
  console.log('  result for t0 alone (expect unmatchable=true, edge 0 still has no match):', hasUnmatchableEdge([t0], [true]));

  console.log('=== Case 4: mixed-chirality soundness regression -- reflectable tile only');
  console.log('    works in its REFLECTED orientation next to a chiral neighbour (must NOT be flagged) ===');
  // [0,323,323] reflectable + [160,323,323] chiral: genuinely periodic at
  // index 1 (up tile 0 reflected, down tile 1 unreflected), independently
  // verified via sheared_solver.js's verifyPeriodicSolution. The pre-fix
  // version of this check only ever tested a tile's RAW (unreflected)
  // labels, so it wrongly declared tile 0 dead here (its raw labels have no
  // match; only its reflected labels do) and misclassified this whole
  // tileset as non-tiler.
  console.log('  result (expect unmatchable=false):', hasUnmatchableEdge([[0, 323, 323], [160, 323, 323]], [true, false]));

  const fs = require('fs');
  const inputPath = process.argv[2];
  if (inputPath) {
    const lines = fs.readFileSync(inputPath, 'utf8').split('\n').filter(l => l.trim());
    let unmatchableCount = 0;
    for (const line of lines) {
      const rec = JSON.parse(line);
      const check = hasUnmatchableEdge(rec.tiles, rec.reflectableFlags);
      if (check.unmatchable) unmatchableCount++;
    }
    console.log(`\n=== Scan of ${inputPath} ===`);
    console.log(`  total records: ${lines.length}`);
    console.log(`  provably non-tileable (every tile prunes away): ${unmatchableCount}`);
    console.log(`  genuinely need patch/torus reasoning: ${lines.length - unmatchableCount}`);
  }
}
