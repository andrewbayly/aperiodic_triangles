# Triangle Aperiodicity Solver

Multi-core Node.js solver for classifying edge-marked-triangle tilesets as
**periodic**, **non-tiler**, or **aperiodic-candidate**, for n = 1, 2, or 3
prototiles, with independent per-tile chirality (reflectable / non-reflectable).

**One command does everything.** Running `main.js` classifies every shape
using the full pipeline below -- unmatchable-edge check, conservation-law
check, a multi-size patch battery, and a multi-size torus battery -- so the
"aperiodic-candidate" bucket it produces is the true, final candidate set.
No separate follow-up rechecking is required for correctness.

## Requirements
Node.js 16+. One external dependency, `javascript-lp-solver` (used only for
the conservation-law check's linear-programming feasibility test):
```
npm install
```

## Usage
```
node main.js --n 1
node main.js --n 2 --workers 8
node main.js --n 3 --reflectable 1,1,0 --workers 8 --output ./triangle_n3_mixed
```

Run `node main.js --help` for all options. Use the number of *performance*
cores your machine actually has, not the total logical core count reported
by the OS -- see "Choosing --workers" below.

**Resuming:** if interrupted, rerun the *exact same command* (same `--output`
directory). Each worker reads its own checkpoint and resumes from exactly
where it left off. The checkpoint is only ever written *after* a synchronous
flush of the corresponding output data to disk, so an interruption (crash,
kill, power loss) can never silently lose already-completed results.

## The classification pipeline (all inside `classify.js`)

Applied to every canonical labeling, in increasing order of cost, each step
either proves the answer outright or hands off to the next:

1. **Unmatchable edge** (instant, pure set logic). Does every edge have some
   possible complementary match anywhere in the tileset, under some
   achievable placement, accounting for tiles that may simply go unused?
   If not, the tileset is provably non-tileable. Uses iterative pruning
   (remove any tile with a dead edge given the *current* surviving set,
   repeat until stable) -- an earlier, simpler version that required every
   tile's every edge to match was too strict and produced false positives;
   this version was validated with zero false positives against known
   periodic shapes.

2. **Conservation law** (instant, linear programming; user-devised). In any
   valid tiling, every "p"-paired edge of a given (class, flavor,
   partnership) type must be adjacent to exactly one "q"-paired edge of the
   *same* type -- so across a whole tiling, the total count of p-edges of
   that type must equal the total count of q-edges. This gives one linear
   equation per non-self-matching notch type (classes A and C; classes B
   and D are always self-matching via pairing "r" and contribute no
   equation). The system always has the trivial all-zero solution; if
   that's the *only* non-negative solution, no valid tiling can exist.
   Checked via linear programming (maximize the sum of tile-orientation
   counts subject to the equations and non-negativity; a positive optimum
   means a nontrivial solution exists). Validated with zero false positives
   against 1,751 known-periodic shapes, and caught 65% of what a
   patch-only check would have called "candidate" in a live test --
   essentially free given how cheap it is to check.

3. **Patch battery** (cheap to moderate; sizes 3x3 up to 8x8). Patch
   infeasibility at *any* size is an unconditional proof of non-existence
   (the same Lemma 3.2 argument throughout this whole project) -- a bigger
   open-boundary patch has strictly more internal constraints, so
   feasibility at a smaller size does not carry over to a larger one. This
   was found, via direct testing, to resolve the large majority of what
   otherwise looked like aperiodic-candidates when only 3x3 was checked
   (in one real n=2 run: 266 apparent candidates dropped to 42 genuine ones
   after this check alone).

4. **Torus battery** (moderate; sizes up to 6x6, ~35 sizes). Torus
   feasibility at any size is an unconditional proof a *periodic* tiling
   exists (Lemma 3.3) -- the torus assignment extends to the whole plane by
   repetition.

5. If nothing above resolves it: `aperiodic-candidate`. **This is not a
   proof of aperiodicity** -- only that no periodic tiling was found within
   the sizes checked, and that the tileset survived every non-existence
   check available. Genuine aperiodicity needs a structural argument, the
   way the hexagon paper's Section 3 eventually required for its hardest
   cases.

## Choosing --workers

Use your machine's **performance core count**, not the OS-reported logical
core count -- these can differ substantially (e.g., Apple Silicon splits
cores into performance and efficiency tiers, and oversubscribing with
efficiency-core-inclusive counts can make total throughput *worse* than
using fewer workers). On macOS:
```
sysctl -n hw.perflevel0.physicalcpu   # performance cores -- use this number
sysctl -n hw.ncpu                     # total logical cores -- do NOT use this
```
If in doubt, benchmark: try a few `--workers` values for ~15 seconds each on
n=2 and use whichever gives the highest aggregate rate.

## How canonical enumeration works: orderly generation

Rather than enumerating every raw labeling and filtering out
symmetry-equivalent duplicates, the solver directly constructs one
representative per equivalence class under the full symmetry group
(per-tile edge relabeling x tile permutation). For n=3 this is the
difference between roughly 57 days and a few hours of compute for the
enumeration+classification stage alone.

This was validated by an exact bijection test against a slow, independently
correct brute-force method: for n=1 and n=2, orderly generation produces
exactly the same number of orbits as exhaustive enumeration-then-dedup,
with zero duplicates and zero missing (n=1: 276/276; n=2: 126,649/126,649).

## Output format

Written per-worker to avoid write contention; merge with `cat *_w*.jsonl > merged.jsonl`
if you want single files.

- `periodic_w<id>.jsonl` -- one JSON object per line, including the
  fundamental domain and period vectors of an actual valid periodic tiling:
  ```json
  {"n": 1, "reflectableFlags": [true], "tiles": [[...packed labels...]],
   "patch": {"periodVectors": [[3,0],[0,3]], "fundamentalDomainSize": {"P":3,"Q":3},
             "domain": [{"a":0,"b":0,"slot":"up","tile":0,"orientation":0}, ...]}}
  ```
  `domain` lists every up/down position in the fundamental domain with which
  tile and which orientation (0-5: even=rotation, odd=reflection) occupies
  it. Repeating this pattern with the given period vectors tiles the plane.

- `non_tiler_w<id>.jsonl` -- the tileset plus *why* it's provably
  non-tileable:
  ```json
  {"n": 1, "reflectableFlags": [true], "tiles": [[...]],
   "reason": "unmatchable-edge" | "conservation-law" | "patch-infeasible",
   "atSize": "5x5"}
  ```

- `aperiodic_candidates_w<id>.jsonl` -- the true, final candidates (survived
  every check above):
  ```json
  {"n": ..., "reflectableFlags": [...], "tiles": [...],
   "status": "aperiodic-candidate", "patchFeasibleAt": "8x8",
   "torusChecked": [[1,1],[2,1],...], "torusUnresolved": [[5,5]]}
  ```
  `torusUnresolved` lists any torus sizes that hit the backtracking budget
  without resolving (rare, but possible for hard instances).

- `checkpoint_w<id>.json` -- resumability state; safe to inspect, don't edit.

## Visualizing a tileset: `render_tilesets.js`

```
node render_tilesets.js --input ./output/aperiodic_candidates_w0.jsonl --count 5 --size 5
```

Writes `tileset_visualization.html` -- open it in a browser. Solves an
actual valid patch and draws it geometrically: each edge is labeled
Class+Flavor+Partnership+Pairing (e.g. "A0ap"), positioned near its own
edge's midpoint; a dashed line explicitly connects the two labels that
share a real edge (since several triangles meet at each lattice vertex
without all sharing edges with each other, two labels can sit near each
other without being a true pair). Matching edges share a line color and
should show opposite pairing letters (p/q), or both "r" for self-matching.
The circled "T0"/"T1" at each triangle's center shows which prototile
occupies it.

If `--size` comes back infeasible ("unknown" or no solution), try a smaller
size -- 3x3 is always feasible for anything not classified `non-tiler`.

## Pushing a final candidate set even further: `recheck_candidates.js`

Optional, not required for correctness (see above) -- the main pipeline's
candidates are already the true final set. Only useful if you want to push
a small, already-final candidate set through a much deeper torus sweep than
the default battery (up to 6x6):

```
node recheck_candidates.js --input ./output/aperiodic_candidates_w0.jsonl --workers 8 --max-size 16
```

Note from testing: escalating the backtracking *budget* on the same sizes
showed poor returns (a 25x increase resolved nothing in one test), while
checking *more sizes* was far more effective. `--max-size` controls how far
the size sweep goes; `--torus-budget` controls the per-size budget.

## Label encoding

Packed integer per edge: `cl | (fl << 2) | (pt << 5) | (pr << 7)`, where
`cl`: 0=A, 1=B, 2=C, 3=D; `fl`: flavor (jointly canonicalized across all
tiles); `pt`: 0=a, 1=b, 2=c; `pr`: 0=p, 1=q, 2=r.

## Files

- `lattice.js` -- core geometry: the up/down triangular lattice, D_3/C_3
  placement, label presentation. Self-test (`node lattice.js`).
- `alphabet.js` -- the original (non-orderly) canonical enumeration; kept
  for its exact `canonicalCount` formula and as ground truth in validation.
- `canonicalize_subtype.js`, `orderly.js`, `canonicalize.js` -- orderly
  generation (Level 1 subtype canonicalization, Level 2 + combined
  generator, and the slow ground-truth canonicalizer used only for
  validation).
- `solver.js` -- patch/torus feasibility (bitmask-based MRV backtracking).
  Cross-validated against independent brute-force search.
- `check_unmatchable.js` -- the unmatchable-edge pre-check.
- `conservation_check.js` -- the conservation-law pre-check (uses
  `javascript-lp-solver`).
- `classify.js` -- the full classification pipeline (all steps above).
- `worker.js` / `main.js` -- multi-core orchestration and CLI, using
  synchronous-flush-then-checkpoint for crash-safe resumability.
- `render_tilesets.js` -- geometric visualization with cross-referenced
  edge matching.
- `recheck_candidates.js` / `recheck_worker.js` -- optional deeper-torus
  follow-up for an already-final candidate set.

## Expected scale

| n | Raw subtype patterns (Level 1 scan size) | Canonical shapes (exact for n=1,2; estimated for n=3) |
|---|---|---|
| 1 | 729 | 276 |
| 2 | 531,441 | 126,649 |
| 3 | 387,420,489 | ~83,000,000 (estimated) |

With the full pipeline (including the patch and torus batteries), expect
roughly 1,100-1,300 shapes/sec/worker-equivalent based on measured n=1/n=2
rates; scale accordingly for n=3 and your core count. n=1 and n=2 finish in
well under a minute with a handful of workers; n=3 is the long-running case
this tool's multi-core design and resumability are for.

## Sheared-lattice (arbitrary-period) torus follow-up

The classify pipeline's torus battery only checks *axis-aligned* tori up to
6x6 (lattices generated by (a,0),(0,b), a,b<=6). A tileset can be periodic
only on a *sheared* lattice -- e.g. generators (13,0),(7,1) -- that no
axis-aligned check up to any size would find. These tools do a systematic,
symmetry-reduced sweep over *all* lattices (in Hermite Normal Form) up to a
given index, axis-aligned or not.

- `sheared_solver.js` -- lattice utilities (HNF reduction/normalization,
  rotation/mirror action on lattices, orbit enumeration under C_6/D_6),
  cached per-lattice torus graphs, `compileTileset`, `searchLattice`
  (MAC arc-consistency + MRV backtracking with a root-level
  translation-symmetry cut), and an independent `verifyPeriodicSolution`
  that unfolds any found solution over an explicit region using
  `lattice.js` primitives only (no shared state with the solver) as a
  soundness cross-check.
- `test_sheared_solver.js` -- self-test: HNF/orbit sanity, the (13,0),(7,1)
  example, agreement with the old axis-aligned `sheared_torus.js` reference
  battery, rotation/mirror invariance. `node test_sheared_solver.js [seed] [n]`.
- `sheared_torus_multicore.js` / `sheared_torus_multicore_worker.js` --
  resumable multi-core sweep over a candidate JSONL (same schema the main
  pipeline produces). Sweeps orbit representatives of lattices by
  increasing index, stops at the first feasible lattice per candidate,
  independently re-verifies every solution found. Options: `--input`,
  `--output` (dir, default `./sheared_output`), `--workers`, `--max-index`
  (default 40), `--budget` (search-node cap per lattice, default 2,000,000),
  `--lattice-timeout-sec` (60), `--candidate-timeout-min` (20),
  `--no-symmetry` (disable the orbit reduction / translation cut, for
  debugging), `--retry-unknown`, `--limit`. Writes one line per candidate
  per worker to `results_w<id>.jsonl` under the output dir. Safe to
  interrupt and rerun with the same command; raising `--max-index` resumes
  unresolved candidates from where they left off rather than restarting.
- `sheared_results.js` -- loads and merges the per-worker result files
  (best/most-recent record per candidate).
- `summarize_sheared.js` -- `node summarize_sheared.js <candidates.jsonl>
  <output-dir>` -- reports resolved-periodic / still-unresolved counts, a
  histogram of the resolving lattice index, and how many resolving lattices
  were already inside the old 6x6 axis-aligned battery (should be ~0, since
  that ground was already covered); writes `resolved_periodic_sheared.jsonl`
  and `still_candidates_after_sheared.jsonl` in the original candidate
  schema, plus `not_yet_processed.jsonl` for anything not yet swept.

  Benchmark on 17 real n=3 aperiodic-candidates (freshly generated from the
  actual classify pipeline, not synthetic): all 17 resolved to
  `--max-index 40` in **0.4 sec total, single worker, default budget** --
  6/17 turned out periodic (3 needed a genuinely sheared lattice; the other
  3 were axis-aligned but wider than the old 6x6 battery's reach), 11/17
  fully refuted up to index 40 with zero budget/timeout unknowns. This is a
  small sample and not a guaranteed bound on worst-case cost, but suggests
  the 17,524-item n=3 residual is cheap to sweep this way; recommend
  deduping first (below) since the group used in enumeration misses two
  more symmetries (see next section) and the residual is likely to collapse
  substantially.

  Typical workflow once the residual file is available:
  ```
  node canonical_full.js --dedupe still_candidates_after_torus_recheck.jsonl residual
  node sheared_torus_multicore.js --input residual_unique.jsonl --output sheared_output --workers <N> --limit 200   # trial run
  node sheared_torus_multicore.js --input residual_unique.jsonl --output sheared_output --workers <N>               # full run
  node summarize_sheared.js residual_unique.jsonl sheared_output
  ```

## Two more exact symmetries, and a full canonicalizer (`canonical_full.js`)

Two symmetries are not quotiented out by `orderly.js`'s enumeration group,
so numerically distinct "canonical shapes" can still be classification-
equivalent copies of each other:

1. **Per-flavor σ-flip**: independently swapping the `a`/`b` (partnership)
   labels within one flavor class across all tiles. (This is the symmetry
   the external report attributes its lower n=1/n=2 counts to.)
2. **Per-(class,flavor) ρ-flip**: independently swapping the `p`/`q`
   (chirality-partner) labels within one (class, flavor) pair across all
   tiles. Not previously documented; found and verified this session
   (`bench/flip_invariance.js`: 27,600 lattice pairs identical, 3,980/3,980
   solutions transfer verbatim under the flip, 400/400 patch-feasibility
   pairs agree).

Both commute with all placements and preserve edge-matching, so they're
exact symmetries of the classification, on top of the D_3^n x S_n x
(flavor relabeling) group `orderly.js` already quotients by.

`canonical_full.js` implements the full group (chirality-correct: only
permutes tiles with equal reflectability, applies per-tile reflection only
where reflectable, plus a global mirror of the remaining chiral tiles) x
flavor renumbering x greedy per-flavor σ/ρ normalization.
`node canonical_full.js --test` self-checks; `node canonical_full.js
--dedupe <in.jsonl> <prefix>` writes `<prefix>_unique.jsonl` (one line per
orbit, first-seen representative) and `<prefix>_orbits.jsonl` (parallel
file: `repIdx`/`memberIdx` are 0-based line numbers into the *original*
input file).

Orbit counts found this session (all-reflectable):

| n | current (`orderly.js`) | + σ only | + ρ only | full group (+σ, +ρ) |
|---|---|---|---|---|
| 1 | 276 | 138 | 104 | 61 |
| 2 | 126,649 | 27,859 | (not run) | 5,734 |

The report's external n=2 figure (123,892) is much closer to our current
126,649 than to either flip-adjusted count, so its claimed explanation
(per-flavor σ alone) does not actually reproduce it -- the discrepancy is
still open. The report's n=1 figure (138) matches the σ-only count exactly.

## Known bug: unmatchable-edge pre-check is unsound for mixed chirality

`check_unmatchable.js` (used inside `classify.js`'s fast-reject stage)
only checks each tile's *unreflected* edge orientation. For a **chiral**
tile (non-reflectable) next to a **reflectable** tile that needs to be
placed in its reflected state to match, this incorrectly prunes a matching
edge as unmatchable, misclassifying a periodic tileset as `non-tiler`.

Concrete counterexample: tiles `[[0,323,323],[160,323,323]]` with
`reflectableFlags: [true, false]` -- `classify.js` returns `non-tiler`
(rejected at the unmatchable-edge stage), but an explicit tiling exists
(period-1 torus, up-tile 0 in its reflected orientation, down-tile 1
unreflected), verified independently. `orderly.js`'s canonicalization has
a related issue for mixed-flag tilesets (it lets `S_n` permute tiles
across different `reflectableFlags`, and doesn't independently reflect
>=2 chiral tiles). **All-reflectable and all-chiral runs are unaffected**;
this only matters if any classification run used a mixed
`reflectableFlags` pattern (worth confirming before trusting mixed-flag
results, if any exist in the ~82.2M n=3 figure).

## Fixed: `check_unmatchable.js` mixed-chirality soundness bug

The bug flagged earlier this session is fixed. Root cause: the check only
tested whether a tile's *raw* (unreflected) labels had matches; a
reflectable tile that only works in its *reflected* orientation (e.g. next
to a chiral neighbour) was wrongly declared dead. Fixed by accepting a tile
as alive if *either* its raw or its sigma'd label set is fully matchable.

**This cannot have affected any all-reflectable production run** (n=1's 31/245,
n=2's 126,649, the n=3 82.2M figures, or the 17,524 residual): for an
all-reflectable tileset the achievable-label pool is always closed under
sigma, and sigma/rho commute, so the old raw-only check and the new
raw-or-reflected check are provably identical in that case (confirmed both
by this algebraic argument and by re-running n=1's full 276-shape
classification with the fix: still exactly 31 periodic / 245 non-tiler).
The bug only had teeth for mixed or all-chiral `reflectableFlags` patterns,
which no production run used. Fixed version at `check_unmatchable.js`;
`node check_unmatchable.js` re-runs its self-tests including a regression
test for the exact counterexample.

## Cross-checked against the external report (`triangle_aperiodicity_report.md`)

- **n=1 "31 vs 30" and "245 vs 246" are not a real disagreement.** Applying
  the report's own Theorem 1 directly to our data reproduces our 31/245
  exactly (0 mismatches, `bench/theorem1_check.js`). The reported "30" is
  their combined chiral-universe (14) + reflectable-universe (16) count from
  138 sigma-orbits classified twice; restricting our own sigma-orbits to the
  matching split gives exactly 16 periodic (reflectable) and 14 (chiral),
  case breakdown i=20/ii=8/iii=2 combined -- an exact match to their Part II
  numbers, confirmed independently with our own solver in chiral mode too
  (`bench/n1_theorem1_orbits.js`, `bench/n1_chiral_check.js`).
- **n=2 "123,892 vs 126,649" is a mismatched-universe comparison, not a bug.**
  Their `enum.c` enumerates all 2^n reflectable-flag patterns combined into
  one count; filtering their own output to the all-reflectable-only subset
  gives exactly 27,859 -- an exact match to our per-flavor-sigma-flip count.
  Both independently confirm the same true number for the universe we
  actually compute.
- **Their n=3 index-13 rigidity example is confirmed.** `sheared_solver.js`
  independently finds all three claimed periodic solutions (shears 7, 8, 10
  on a (13,0)/(s,1) lattice), each independently verified, with tile-usage
  counts matching their claimed frequencies.
- Their reported "likely pipeline issue" (axis-aligned-only torus search
  missing oblique periods) is exactly what this session's sheared-lattice
  tools were built to fix -- see results below.

## Sheared-lattice sweep of the real 17,524-item n=3 residual

Run this session on `still_candidates_after_torus_recheck.jsonl`:

1. Deduped under the full symmetry group (sigma-flip + rho-flip):
   17,524 -> **1,191 distinct orbits**.
2. Swept all 1,191 to lattice index 80 (single core, ~1 minute total):
   **352 orbits resolved periodic**, independently verified -- expanding
   back through orbit membership, **5,911 of the original 17,524 raw
   tilesets (34%)** are periodic on some sheared or wide-axis lattice the
   old 6x6 axis-aligned battery never checked.
3. **839 orbits (11,613 raw tilesets) remain unresolved**, cleanly swept to
   index 80 (818 of them) or 120 (21 of them) with zero budget/timeout
   unknowns -- genuine absence of any small-index periodic tiling, not a
   search-budget artifact.

Result files (both at the 1,191-orbit level and expanded back to the
original 17,524-item granularity) are in `n3_residual_results/`. These 839
orbits are the actual candidates worth further attention (deeper sweep,
patch refutation, or the report's suggested rigidity/window-determinism
technique).
