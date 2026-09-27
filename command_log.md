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

## Session: vertex-star filter

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

Then queued (and subsequently run on the 8-worker machine): a deeper
sheared-lattice index sweep on the 781-orbit frontier --

```
node sheared_torus_multicore.js --input still_unresolved_unique_781.jsonl --output sweep_781 --workers 8 --max-index 300 --budget 5000000 --lattice-timeout-sec 120
node summarize_sheared.js still_unresolved_unique_781.jsonl sweep_781
```

Result: 775/781 cleanly swept to index 300 with 0 new periodic found; 6
candidates (730, 728, 771, 486, 345, 15) got stuck (either repeated
per-lattice timeouts, or the per-candidate time cap) -- see the next
session for how these were resolved.

## Session: SAT-based resolution of the lattice-sweep stragglers, and the full patch-infeasibility sweep

Six candidates (730, 728, 771, 486, 345, 15) got stuck in the JS lattice
sweep -- either hitting per-lattice timeouts repeatedly, or the overall
20-minute (then 120-minute) per-candidate timeout without finishing.
Rather than keep raising JS timeouts, routed them through the external
report's own SAT-based tooling (`python-sat` + their `core.py`/`solve.py`,
which already supports arbitrary sheared tori and open hexagonal patches).

| Step | Command | Duration | Result |
|---|---|---|---|
| setup | `pip3 install python-sat --break-system-packages` (or a venv, if the system Python is externally-managed) | — | installed |
| export the 6 stuck candidates' full unknown-lattice lists | `node export_unknowns.js sweep_781 unknowns_export.json` | — | 6 candidates, 2,084 combined unknown lattices |
| **SAT-resolve those 2,084 lattices** | `python3 sat_resolve.py unknowns_export.json triangle_tilings/src --workers 8 --out sat_results.json` | 6.9 min | **all 2,084 resolved: every one infeasible.** All 6 candidates now have zero remaining unknowns within their previously-swept range |
| diagnostic: is patch infeasibility viable too? | (inline test, `hex_patch` + `sat_assign` on the 3 hardest candidates: 730, 728/771/15) | seconds | **candidates 15, 728, 771 are non-tilers** -- infeasible open hex patch at radius 5/10/10 respectively (0.06s-10.9s). Explains why the lattice sweep could never finish: no periodic tiling was ever going to be found because no tiling of any kind exists |
| **full hex-patch SAT sweep of all 781** | `python3 sat_patch_sweep.py still_unresolved_unique_781.jsonl triangle_tilings/src --max-radius 20 --workers 8 --out patch_results.json` | ~24s (single-threaded in testing; faster on 8 workers) | **all 781/781 are non-tilers**, radius mostly 2-10, every one found in well under a second |
| independent re-verification (different engine, not SAT) | inline script using `verify_hex_cp.js` -- from-scratch forward-checking + MRV CSP solver, no shared code with `core.py`/`solve.py`/pysat | 11.3s for all 781 | **0 mismatches, 0 timeouts** -- every one of the 781 SAT non-tiler certificates independently confirmed |

## FINAL RESULT: the entire 17,524-item n=3 residual is now fully classified

| Category | Orbits (of 1,191) | Raw tilesets (of 17,524) | Method |
|---|---|---|---|
| Periodic | 352 | 5,911 | sheared-lattice sweep, independently verified |
| Non-tiler | 58 | 852 | vertex-star (corner-digraph) filter |
| Non-tiler | 781 | 10,761 | hex-patch infeasibility via SAT, independently re-confirmed by a separate CP-based solver |
| **Total** | **1,191** | **17,524** | **100% resolved, 0 remaining** |

Combined with n=3's already-settled 13,738,893 periodic + 68,446,817
non-tiler from the original run, **all 82,203,532 n=3 tilesets are now
classified periodic or non-tiler; zero aperiodicity candidates remain.**
This matches n=1 (0/276) and n=2 (0/126,649) exactly. The specific
computational question the external report's proof attempt was answering
("is any n<=3 tileset genuinely aperiodic?") is now closed for n=3 the
same way it already was for n=1 and n=2: no, none of them are -- this is
an exhaustive computational result, not a general proof for all n, which
remains the open question the report's own `n3_aperiodicity_proof_prompt.md`
was written to pursue.

**Tools added this session:** `export_unknowns.js`, `sat_resolve.py`,
`export_remaining_range.js`, `sat_patch_sweep.py`, `pysat_smoketest.py`,
`verify_hex_cp.js` (independent from-scratch verifier), `find_stuck.js`.

## MILESTONE: n=3 fully resolved across ALL reflectable patterns — minimality established

Following the 352/839 all-reflectable residual resolution above, the
remaining three reflectable-tile-count patterns for n=3 (2, 1, and 0
reflectable tiles out of 3) were generated and classified using two
theorems discovered this session:

1. **One-way non-tileability**: if an all-reflectable tileset P is a
   non-tiler, then any variant Q of P with some tiles made non-reflectable
   (a strict subset of P's placement options) is automatically also a
   non-tiler. Only the all-reflectable *periodic* parents needed their
   chiral/mixed variants generated and separately checked.
2. **No cross-parent collision**: distinct all-reflectable periodic
   parents cannot produce canonically-equal chiral/mixed variants, so
   per-parent variant generation (dedupe only within each parent's 7
   nonempty chiral-subset variants) is sufficient — no expensive global
   cross-parent dedup pass is required. Proved via the subgroup-implies-
   coarser-equivalence argument (H⊆G, H-equivalent ⟹ G-equivalent).

**Pipeline:** `gather_periodic_parents.js` merged all periodic all-
reflectable parents (13,739,429 total) → `chiral_variants_multicore.js`
generated the 7 nonempty chiral-subset variants per parent, canonicalized
via `canonical_full.js` (σ-flip + ρ-flip), bucketed by reflectable-tile-
count into bucket0 (all-chiral)/bucket1/bucket2 → each bucket run through
`full_resolve_multicore.js` (4-stage: fast classify → sheared-lattice →
vertex-star → SAT patch-infeasibility), 8 workers on the user's Mac.

**Results:**

| Reflectable tiles | Periodic | Non-tiler | Total | Unresolved | Runtime |
|---|---|---|---|---|---|
| 3 (all-reflectable) | 13,744,988 | 68,458,430 | 82,203,418 | 0 | (prior session) |
| 2 | 35,873,556 | 4,511,423 | 40,384,979 | 0 | 52,029.8s (~14h27m) |
| 1 | 32,012,320 | 8,479,036 | 40,491,356 | 0 | 21,117.9s (~5h52m) |
| 0 (all-chiral) | 9,717,438 | 4,021,991 | 13,739,429 | 0 | 3,731.6s (~1h2m) |
| **Total** | **91,348,302** | **85,470,880** | **176,819,182** | **0** | |

Every arithmetic check (periodic+nonTiler=total per bucket, stage-sum
cross-check) matched exactly. Candidate rate held steady around 0.2-0.3%
across all buckets, with ~94.5% of raw candidates resolved almost
instantly by the sheared-lattice sweep and the rest cleared by vertex-star
pruning or SAT patch-infeasibility (independently re-verified against a
from-scratch CP solver with 0 mismatches).

**Conclusion:** combined with n=1 (both reflectable patterns, 0
candidates) and n=2 (all 3 reflectable patterns, 0 candidates) resolved
earlier this session, **every n≤3 tileset, under every possible
reflectable/chiral configuration, is either periodic or a non-tiler.
There is no genuinely aperiodic tileset for any n≤3, full stop — no
reflectableFlags carve-out remains.** Combined with the user's existing
n=4 all-reflectable aperiodic witness, this establishes n=4 as the
smallest possible size for a genuinely aperiodic edge-matching triangle
tileset: the minimality half of the paper's central claim is now fully
and computationally established.
