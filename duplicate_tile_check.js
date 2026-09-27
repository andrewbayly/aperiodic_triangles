'use strict';
// ============================================================================
// Duplicate-tile detection (user-devised): if two tiles in an n-tile set are
// identical (same edge pattern, up to rotation, and the same reflectability
// flag), the tileset is provably equivalent -- for tiling purposes -- to the
// smaller tileset with the duplicate removed. Any valid tiling using both
// copies can be relabeled to use only one (they are indistinguishable), and
// vice versa (freely substitute either copy for the other), so the two
// tilesets always classify identically.
//
// Since n=2 has been fully, exhaustively resolved with ZERO
// aperiodic-candidates (every one of the 126,649 canonical n=2 shapes is
// definitively periodic or non-tiler), any n=3 tileset with a duplicate
// tile is mathematically guaranteed to be periodic or non-tiler too -- it
// can never be a genuine aperiodic-candidate. Detecting and skipping these
// avoids wasting the full (larger, n=3-sized) patch/torus battery on a
// tileset that provides no new information beyond what the n=2 run already
// established, and that -- because it still carries the full n=3 state
// space (3 tiles' worth of orientations, even though 2 behave identically)
// -- can take disproportionately long to search relative to what it's
// actually worth.
// ============================================================================

// Are two tiles' edge patterns the same up to rotation? (3 possible
// rotations to check for a triangle -- cheap regardless of tile size.)
function sameUpToRotation(muA, muB) {
  const m = muA.length;
  if (muB.length !== m) return false;
  for (let shift = 0; shift < m; shift++) {
    let match = true;
    for (let i = 0; i < m; i++) {
      if (muA[i] !== muB[(i + shift) % m]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

// Returns true if ANY two tiles in the set are duplicates in the sense
// that makes the tileset reducible to a smaller one: same edge pattern up
// to rotation, REGARDLESS of reflectability. This includes the mixed case
// -- one reflectable, one non-reflectable, same pattern -- because the
// non-reflectable tile's achievable placements (3 rotations of its
// pattern) are then a strict SUBSET of the reflectable tile's (6
// orientations: those same 3 rotations, plus 3 more from reflection).
// Anywhere the non-reflectable tile could be placed, the reflectable one
// could be placed identically instead, so it contributes nothing the
// tileset didn't already have -- exactly as reducible as the same-pattern,
// same-reflectability case.
function hasDuplicateTile(tiles, reflectableFlags) {
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (sameUpToRotation(tiles[i], tiles[j])) return true;
    }
  }
  return false;
}

module.exports = { hasDuplicateTile, sameUpToRotation };

// ============================================================================
// Self-test
// ============================================================================
if (require.main === module) {
  console.log('=== Case 1: the exact example from the conversation (expect true) ===');
  const ex = [[0, 0, 289], [128, 128, 128], [128, 128, 128]];
  console.log(hasDuplicateTile(ex, [true, true, true]));

  console.log('=== Case 2: same edge pattern, but rotated (expect true -- still a duplicate) ===');
  const rotated = [[1, 2, 3], [2, 3, 1], [9, 9, 9]]; // tile1 = tile0 rotated by 1
  console.log(hasDuplicateTile(rotated, [true, true, true]));

  console.log('=== Case 3: same edge pattern, different reflectability (expect true -- the non-reflectable one is redundant since its placements are a strict subset of the reflectable one\'s) ===');
  const diffReflect = [[1, 2, 3], [1, 2, 3], [9, 9, 9]];
  console.log(hasDuplicateTile(diffReflect, [true, false, true]));

  console.log('=== Case 4: three genuinely distinct tiles (expect false) ===');
  const distinct = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
  console.log(hasDuplicateTile(distinct, [true, true, true]));

  console.log('=== Case 5: n=2, no duplicates (expect false) ===');
  console.log(hasDuplicateTile([[1, 2, 3], [4, 5, 6]], [true, true]));
}
