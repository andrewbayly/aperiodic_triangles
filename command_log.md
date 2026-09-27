# Command log: triangle aperiodicity investigation

| Step | Command | Duration | Result |
|---|---|---|---|
| n=1 | `node main.js --n 1` | 0s (<1 min) | 276 shapes: 31 periodic, 245 non-tiler, **0 candidates** |
| n=2 | `node main.js --n 2 --workers 8 --patch-budget 200000000` | 2186s (~36.4 min) | 126,649 shapes: 18,819 periodic, 107,830 non-tiler, **0 candidates** |
| n=3 | `node main.js --n 3 --workers 8` | 85894s (~23.9 hours) | 82,203,532 shapes: 13,738,893 periodic, 68,446,817 non-tiler, **17,822 candidates** |
| reprocess (merge) | `cat ./output/aperiodic_candidates_w*.jsonl > all_candidates.jsonl` | — | 17,822 lines confirmed |
| reprocess (attempt 1, killed) | `node reprocess_candidates.js --input all_candidates.jsonl` | killed (~14hr projected, single-threaded) | superseded — too slow, no multicore |
| reprocess (attempt 2) | `node reprocess_candidates_multicore.js --input all_candidates.jsonl --workers 8` | 7098s (118.3 min) | dup-resolved 114, reclassified 0, **17,708 still candidate** |
| torus recheck (merge) | `cat ./reprocessed_output/still_candidate_w*.jsonl > still_candidates_after_reprocess.jsonl` | — | 17,708 lines confirmed |
| stage-1 patch push (killed) | `node deep_patch_push_multicore.js --input still_candidates_after_reprocess.jsonl --workers 8 --min-size 9 --max-size 10 --budget 2000000` | killed at 16.5% (5838/35416 tasks) | 0 false results in what completed — abandoned in favor of a faster diagnostic |
| diagnostic sample (prep) | `head -200 still_candidates_after_reprocess.jsonl > sample_200.jsonl` | — | 200-shape sample |
| diagnostic sample (run) | `node deep_patch_push_multicore.js --input sample_200.jsonl --workers 8 --min-size 9 --max-size 9 --budget 100000000` | 1782s (29.7 min) | 0 non-tilers found even at 50x budget — patch-size escalation judged low-leverage at n=3 scale |
| divisor distribution check | (inline `node -e` script; conservation-law LP per candidate) | — | Highly heterogeneous: 24 distinct divisors (2–60), no dominant value like n=2's single divisor-5 case — ratio-based size targeting judged low-leverage here |
| torusUnresolved distribution check | (inline `node -e` script) | — | Average 3.86 unresolved sizes/candidate; 27.4% (4,848) have an empty list (fully conclusive on torus side already) |
| torus recheck | `node recheck_torus_unresolved_multicore.js --input still_candidates_after_reprocess.jsonl --workers 8` | 1824s (30.4 min) | **184 confirmed genuinely periodic** |
| torus recheck (remainder) | `node compute_remaining_after_torus_recheck.js still_candidates_after_reprocess.jsonl <recheck-output-dir> still_candidates_after_torus_recheck.jsonl` | — | **17,524 candidates remaining** |

## Not included above (not shell commands on the project)

- A separate, fresh-chat task (high-effort Opus) was commissioned to attempt a geometric proof that n≤3 admits no genuine aperiodicity, using the n=1/n=2 "zero candidates" result as motivating evidence. It returned a substantial report, code, and data — see `triangle_aperiodicity_report.md` / `triangle_tilings.zip` and the separate transition document for the findings and their verification status.
- Independent verification of one of that report's key claims (the sheared-torus gap) was done directly, not as a project command — see `sheared_torus.js` and the transition document.

## Session: sheared-lattice tooling, report cross-check, residual sweep

New tools built this session: `sheared_solver.js` (arbitrary-period-lattice
solver: HNF lattice enumeration, symmetry-reduced orbit search, independent
verifier), `sheared_torus_multicore.js` / `_worker.js` (resumable multicore
sweep, same pattern as the other `*_multicore.js` tools, but over *all*
period lattices by increasing index rather than axis-aligned squares),
`canonical_full.js` (dedup/canonicalize under the full symmetry group,
including two per-flavor label-flip symmetries — see below).

| Step | Command | Duration | Result |
|---|---|---|---|
| self-test | `node test_sheared_solver.js 600 99` | <1s | all pass: HNF/orbit sanity, index-13 example, agreement with `sheared_torus.js` reference, rotation/mirror invariance |
| symmetry discovery check | `node bench/flip_invariance.js` | — | confirmed a second exact symmetry beyond the report's per-flavor σ-flip: per-(class,flavor) **ρ-flip** (27,600 lattice pairs identical, 3,980/3,980 solutions transfer, 400/400 patch pairs agree) |
| full-group self-test | `node canonical_full.js --test` | — | n=1: 276 (base) / 138 (+σ) / 104 (+ρ) / 61 (full) — all OK |
| **dedup the residual** | `node canonical_full.js --dedupe still_candidates_after_torus_recheck.jsonl residual` | 49.9s | **17,524 → 1,191 distinct orbits** under the full group; orbit sizes 1–128 |
| sheared sweep, stage 1 | `node sheared_torus_multicore.js --input residual_unique.jsonl --output residual_sweep --workers 1 --max-index 60 --budget 2000000` | ~31s | 352/1,191 orbits resolved periodic (all independently verified); 839 unresolved, 0 budget/timeout-unknowns |
| sheared sweep, stage 2 (deepen unresolved) | `node sheared_torus_multicore.js --input residual_unique.jsonl --output residual_sweep --workers 1 --max-index 80 --budget 2000000 --lattice-timeout-sec 30` | ~42s | resumed automatically from stage 1's checkpoint; 0 new periodic found; 818/839 confirmed cleanly swept to index 80 |
| sheared sweep, stage 3 (killed) | `node sheared_torus_multicore.js --input residual_unique.jsonl --output residual_sweep --workers 1 --max-index 120 --budget 2000000 --lattice-timeout-sec 90` | killed (sandbox exec-time limit; 1 CPU only in this environment) | partial progress checkpointed: 21/839 orbits reached index 120 before the kill (0 new periodic among them); the other 818 remain at index 80 — safe to resume later with the same command |
| summarize | `node summarize_sheared.js residual_unique.jsonl residual_sweep` | — | final: **352 orbits periodic, 839 orbits still unresolved** (818 swept to 80, 21 swept to 120) |
| expand orbits back to raw granularity | inline `node -e` script, using `residual_orbits.jsonl`'s `memberIdx` lists | — | **5,911 of the original 17,524 raw tilesets periodic**; **11,613 raw tilesets still unresolved** — written to `resolved_periodic_raw_5911.jsonl` / `still_unresolved_raw_11613.jsonl` |
| bugfix | edited `check_unmatchable.js` (mixed-chirality soundness bug: a reflectable tile that only works in its *reflected* orientation was wrongly pruned) | — | fixed; proved algebraically + confirmed by re-running n=1 (still exactly 31/245) that this **cannot have changed any existing all-reflectable result** (n=1, n=2, the n=3 82.2M, or the residual itself) — the bug only had teeth for mixed/all-chiral `reflectableFlags`, never used in production |

## Not included above (not shell commands on the project)

- Cross-checked the external report's own claims against our data directly (not pipeline commands): applied its Theorem 1 to our full n=1 classification (`bench/theorem1_check.js`, 0 mismatches against our 31/245), reproduced its combined chiral+reflectable 30/276 split exactly on our σ-orbits (`bench/n1_theorem1_orbits.js`, `bench/n1_chiral_check.js`), compiled its `enum.c` and filtered its own output to the all-reflectable-only subset to resolve the n=2 123,892-vs-126,649 comparison (matches our σ-flip count of 27,859 exactly), and reproduced its n=3 index-13 rigidity example with `sheared_solver.js` (all three claimed shears found and verified, matching tile-usage frequencies). Net result: **no actual disagreement found anywhere with the report's own numbers** once compared on a matched basis — see the chat transcript for the full derivation of each.

## Current state as of this log

**781 orbits (`still_unresolved_unique_781.jsonl`)** are the live working set — down from 839, after the vertex-star filter refuted 58 more as provably non-tiler (see below). This is now the correct file to point further work at. `residual_orbits.jsonl` still maps every orbit back to its raw-tileset membership in the original 17,524-line file for on-demand raw-granularity lookups.

**Compute note:** this session's sheared-sweep runs above used `--workers 1` because the sandbox only had 1 CPU. Going forward, anything with meaningfully long expected runtime should move to the 8-worker machine instead, matching how the original n=1/n=2/n=3 runs and the multicore reprocessing steps were logged in this file.

Candidate next levers, not yet executed: push the index sweep deeper (queued for the 8-worker machine, see row below); independently re-implement the per-(class,flavor) ρ-flip symmetry as a second check (it's currently confirmed only by this session's own empirical tests + an algebraic argument, not by a second independent implementation the way σ-flip now is via the report's `enum.c`); try the report's window/rigidity-determinism technique on individual stubborn cases to prove "every tiling is periodic" outright.

## Session: vertex-star filter, queued deep sweep

New tool this session: `vertex_star_check.js` -- a JS port of the report's
`corner.py` vertex-star (corner-digraph) necessary condition: a placement
can only appear in a valid tiling if it lies on a length-6 closed walk in
the corner-transition graph, which is a strictly stronger local check than
simple edge-matching. Validated before trusting it on the real data:
correctly flags the report's own hand-derived n=2 4-cycle non-tiler
example, and has **zero false positives** against all 31 known-periodic
n=1 shapes and all 352 known-periodic n=3 residual orbits found this
session.

| Step | Command | Duration | Result |
|---|---|---|---|
| self-test | `node vertex_star_check.js` | <1s | report's n=2 non-tiler example correctly flagged; 0 false positives on 31 known-periodic n=1 shapes |
| regression check | inline `node -e` script against `resolved_periodic_unique_352.jsonl` | <1s | 0 false positives on all 352 known-periodic n=3 orbits |
| **run on the 839** | inline `node -e` script calling `vertexStarPrune` over `still_unresolved_unique_839.jsonl` | 142ms | **58/839 orbits refuted as provably non-tiler** (852 raw tilesets); 781 orbits remain |

**Queued for the 8-worker machine (not yet run):** deeper sheared-lattice
index sweep on the new 781-orbit frontier. Suggested command (adjust
`--max-index` upward as time allows -- 60→80 found 0 new hits on the
previous 839, so this is a "run it far since it's cheap on real hardware"
step rather than one with a specific target in mind):

```
node sheared_torus_multicore.js --input still_unresolved_unique_781.jsonl --output sweep_781 --workers 8 --max-index 300 --budget 5000000 --lattice-timeout-sec 120
node summarize_sheared.js still_unresolved_unique_781.jsonl sweep_781
```
