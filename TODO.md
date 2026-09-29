# TODO: streamlining toward the minimality paper

## ✅ MINIMALITY CLAIM FULLY ESTABLISHED (n≤3, all reflectable/chiral patterns)

Every n=1, n=2, and n=3 tileset, under every possible reflectable/chiral
configuration, is now classified periodic or non-tiler — 0 aperiodicity
candidates remain anywhere. Combined with the existing n=4 all-reflectable
aperiodic witness, n=4 is established as the smallest possible genuinely
aperiodic edge-matching triangle tileset. See `command_log.md`'s final
MILESTONE section for the full n=3 all-patterns results table
(91,348,302 periodic / 85,470,880 non-tiler / 176,819,182 total / 0
unresolved). What remains below is packaging and certificate rigor for
the paper, not open mathematical/computational questions.

## 🚨 Blocking — reflectableFlags coverage (RESOLVED for n=1, n=2, and n=3 — all patterns)

- [x] **n=1: fully resolved for both patterns.** Chiral: 14 periodic/124
      non-tiler/0 candidates. Reflectable: 31/245/0. Confirmed via the
      report's own Theorem 1 this session.
- [x] **n=2: fully resolved for all 3 patterns** (0, 1, or 2 reflectable
      tiles out of 2 — confirmed distinct reflectable-tile-*count* is the
      right thing to enumerate, not all 2^n raw flag assignments, since
      flag-vectors related by tile permutation are the same physical
      campaign; verified `canonical_full.js` and `enum.c` both correctly
      permute each tile's flag along with the tile). Used `enum.c`'s
      existing all-flag-patterns raw enumeration (already correct for the
      permutation-with-flag issue; just needed ρ-flip added via
      `canonical_full.js`, and bucketing by reflectable-tile-count):
      | Pattern | Orbits (σ+ρ) | Periodic | Non-tiler | Candidates found | Candidates after resolution |
      |---|---|---|---|---|---|
      | 0 reflectable | 8,330 | 1,957 | 6,312 | 61 | **0** |
      | 1 reflectable | 10,833 | 3,168 | 7,601 | 64 | **0** |
      | 2 reflectable | 5,734 | (already known) | | 0 | 0 |
      The 125 new candidates were fully resolved this session: 92 via
      vertex-star, 3 via SAT patch-infeasibility, **30 turned out periodic
      on a sheared lattice** — the same pattern that drove the whole n=3
      investigation, now confirmed to recur at n=2 too.
- [x] **n=3: all 4 patterns fully resolved.** Solved via two theorems
      (one-way non-tileability: an all-reflectable non-tiler's
      chiral/mixed variants are automatically also non-tilers; no
      cross-parent collision: distinct all-reflectable periodic parents
      can't produce canonically-equal chiral/mixed variants, proved via
      subgroup-implies-coarser-equivalence). This collapsed the brute-force
      `enum.c` approach (abandoned as intractable single-threaded) into a
      tractable generate-variants-from-periodic-parents pipeline:
      `gather_periodic_parents.js` → `chiral_variants_multicore.js` →
      `full_resolve_multicore.js` (4-stage: classify → sheared-lattice →
      vertex-star → SAT patch-infeasibility), 8 workers on the user's Mac.
      | Reflectable tiles | Periodic | Non-tiler | Total | Unresolved |
      |---|---|---|---|---|
      | 3 (all-reflectable) | 13,744,988 | 68,458,430 | 82,203,418 | 0 |
      | 2 | 35,873,556 | 4,511,423 | 40,384,979 | 0 |
      | 1 | 32,012,320 | 8,479,036 | 40,491,356 | 0 |
      | 0 (all-chiral) | 9,717,438 | 4,021,991 | 13,739,429 | 0 |
      | **Total** | **91,348,302** | **85,470,880** | **176,819,182** | **0** |
      All arithmetic checks (periodic+nonTiler=total, stage-sum
      cross-check) matched exactly across all three runs.

## Language / tooling consolidation (following the JS decision)

- [x] Abort the JS lattice sweep — done, superseded.
- [x] Proved the all-JS + native-binary (CaDiCaL/Kissat + drat-trim) path
      works end-to-end: CNF encoding, solving, DRAT proof, and independent
      third-party proof verification, all reproduced from pure JS with zero
      Python involved (`js_sat_bridge.js`).
- [x] Treat `core.py`/`solve.py` as a validation reference only, not a
      maintained part of the go-forward artifact.
      **Closed 2026-09-28** — moot in practice: the Python files were never
      pulled into the GitHub repo at all, so there is nothing to demote.
      The JS pipeline (`main.sh` + `scripts/00`-`10_*.sh`) is the sole
      go-forward implementation.
- [x] Confirm `canonical_full.js` (with both σ-flip and ρ-flip) is the one
      canonicalization used everywhere going forward.
      **Confirmed 2026-09-28**, verified directly from source:
      `chiral_variants_worker.js` (line 30) calls
      `canonicalFull(tiles, flags, { sigma: true, rho: true })` explicitly
      wherever variants are generated/deduped. `full_resolve_worker.js`
      imports no canonicalization logic at all, by design — it only
      resolves already-deduped records (classify → sheared-lattice →
      vertex-star → SAT), it doesn't dedupe them. No inline or alternate
      canonicalization logic found anywhere in the two files reviewed.
- [x] Audit `check_unmatchable.js`/`canonical_full.js`/`vertex_star_check.js`/
      `js_sat_bridge.js` once more specifically against chiral and mixed
      n=3 patterns once those campaigns are running (all were built or
      re-confirmed to be reflectableFlags-aware this session, but the n=3
      scale is the real stress test).
      **Closed 2026-09-29 — all three buckets passed.** Bucket 0 (stage 06):
      9,690,837 periodic / 4,016,654 non-tiler / 0 unresolved. Bucket 1
      (stage 07): 31,952,812 periodic / 8,480,055 non-tiler / 0 unresolved.
      Bucket 2 (stage 08): 35,811,203 periodic / 4,515,194 non-tiler / 0
      unresolved. All arithmetic cross-checks (fast+sheared=periodic,
      fast+vertexStar+sat=nonTiler, and each bucket's periodic+nonTiler
      matching its stage-05 total exactly) confirmed on every worker of
      every bucket. `_resolve_bucket.sh`'s own hard-fail-on-unresolved
      check never triggered anywhere — the audit passes.

## Extend the pure-JS SAT bridge

- [x] ~~Add torus/periodicity support to `js_sat_bridge.js` (mirror
      `torus_graph` from `solve.py`)~~
      **Closed, not needed, 2026-09-28.** Periodicity is resolved entirely
      via `sheared_solver.js`'s deterministic `searchLattice` +
      `verifyPeriodicSolution` (see `full_resolve_worker.js` stage 2), never
      via SAT. The SAT bridge is only ever called for non-tiler
      patch-infeasibility (stage 4). Consistent with the "Certificate
      rigor" section's own conclusion that periodic certificates need no
      DRAT/SAT proof at all — direct substitution suffices. Adding
      SAT-based periodicity support would just duplicate rigor already
      covered a simpler way.
- [x] Quick benchmark: CaDiCaL vs Kissat on our actual instance mix.
      **Closed 2026-09-29 — not worth pursuing, not even for stage 09.**
      For the completed classification stages (06-08), SAT resolution was
      ~0.0125% of shapes by count (11,788 of 94,466,755) and, extrapolating
      from the residual sweep's own ~30ms/shape benchmark in
      `command_log.md`, well under an hour of a combined ~21h runtime —
      Amdahl's law caps any possible Kissat speedup there at a few minutes,
      not worth benchmarking. For stage 09 specifically, where SAT calls
      *are* ~100% of the work: decided against introducing a second solver
      dependency on spec. CaDiCaL is already built, pinned, and *proven* in
      this project to produce working DRAT proofs end-to-end
      (`command_log.md`, and stage 09's own implementation below) — adding
      Kissat purely for a hypothetical, unmeasured speedup would complicate
      the reproducibility story (a second binary to build and pin a commit
      for) for no confirmed benefit. Default to CaDiCaL for stage 09 too;
      only reconsider Kissat reactively, if CaDiCaL's actual measured
      stage-09 runtime turns out to be a real bottleneck once run at scale —
      not proactively on a guess.
- [x] Re-run the full residual verification (all 1,191 orbits: 352 periodic
      + 839 non-tiler) through the pure-JS bridge, so the final result
      doesn't depend on the Python cross-check at all — just uses it as
      history/provenance.
      **Closed 2026-09-29 — already satisfied, no new computation needed.**
      Of the 839 non-tiler orbits, only the 781 historically resolved via
      Python (`sat_patch_sweep.py`/pysat, per `command_log.md`'s "SAT-based
      resolution" session) ever depended on Python; the 352 periodic (pure-JS
      sheared-lattice sweep) and 58 non-tiler (pure-JS vertex-star filter)
      never did. Checked whether the actual completed reproducible run
      (stage 03's step 5, `full_resolve_multicore.js` over all 1,191
      orbits — predates the Option B redesign above, which only affects
      future fresh runs) already re-derived those 781 via its own SAT-patch
      stage (`js_sat_bridge.js`/CaDiCaL, not Python) as a side effect of
      normal pipeline execution: `grep -o '"resolvedBy":"[a-z-]*"'
      resolve_output/non_tiler_w*.jsonl | sort | uniq -c` on the user's
      machine gave exactly 781 `sat-patch` + 58 `vertex-star` = 839,
      matching the historical split precisely. Every one of the 781
      previously-Python-only verdicts has already been independently
      reconfirmed via the pure-JS/CaDiCaL path. Python is now purely
      historical provenance, not a dependency of the published result.

## Planned: one full fresh re-run, once everything below is batched in

**Decided 2026-09-29.** Multiple fixes now on the list require actually
regenerating classification output, not just re-deriving a summary from
existing files. Per-worker checkpoints mean re-invoking a stage after a
code fix does NOT re-run its classification logic for already-completed
lines — `full_resolve_worker.js` (and the equivalent for buckets/residual)
would just resume-to-instantly-done using the OLD output. Getting new
behavior requires a genuine `--fresh` restart, which repeats the real
~21+ hour cost for buckets 0/1/2 (plus stage 03's residual/torus-recheck
tooling). Given that cost, the plan is: accumulate every pipeline-code
change that needs a fresh run into one batch, THEN do a single
`main.sh --workers 8 --fresh` covering all of them at once, rather than
paying the cost per-fix. Do not run this yet.

Items now landed in the codebase (both **code-complete, not yet run
against real data** — see "Certificate rigor" and "Packaging" below for
detail on each):
- [x] **Persist periodicity certificate data instead of discarding it.**
      `full_resolve_worker.js`'s `tryShearedLattice` now keeps the domain
      assignment from `solutionToDomain` and returns it as a `patch` record
      in the same shape used elsewhere (`periodVectors`,
      `fundamentalDomainSize`, `domain`), instead of discarding it after
      verification. `03_classify_n3_allreflectable.sh` was also redesigned
      ("Option B"): the residual's orbit-dedup → `full_resolve_multicore.js`
      (on orbit reps) → `expand_orbit_results.js` path — which was
      silently discarding resolved certificates when expanding orbit
      verdicts back to raw members — is replaced by a direct
      `full_resolve_multicore.js` pass over all 17,524 raw candidates,
      matching how buckets 0-2 already work. `combine_n3_allreflectable_summary.js`
      rewritten to match (reads `resolve_output/` directly instead of the
      now-removed `final_summary.json`). Committed 2026-09-29.
- [x] **Stage 09 (DRAT generation + batch verification) built.** See
      "Certificate rigor" and "Packaging" below — real implementation now
      exists and is wired into `main.sh`'s default stage list. Verified
      end-to-end with real CaDiCaL + drat-trim binaries on synthetic data;
      not yet run against the actual pipeline's real non-tiler output.

**After the fresh run:** re-verify buckets 0/1/2 the same way as before
(arithmetic cross-checks, unresolved=0, ratios in the expected range) —
verdicts should reproduce identically to this run, only the certificate
data should be new/different, and stage 09 will produce real archived
DRAT proofs instead of the synthetic-data test run. Re-run
`10_summarize_results.sh` too and confirm `SUMMARY.md` still matches
(it will now also include the certificate-verification section).

## Certificate rigor (the DRAT upgrade)

- [x] Generate and archive a DRAT proof for every non-tiler certificate
      found via patch infeasibility (currently only spot-checked one).
      **Built 2026-09-29** — `gather_sat_certificates.js` +
      `verify_sat_certificates_multicore.js`/`..._worker.js`, wired into
      `scripts/09_verify_sat_certificates.sh`. Scope excludes the 58
      vertex-star non-tilers per the decision below — only
      SAT-patch-infeasibility certificates get a DRAT proof. Verified
      end-to-end against real CaDiCaL + drat-trim binaries (built from
      source in a scratch environment) on both a real SAT-patch UNSAT case
      and the trivially-unsat (radius 0, no CNF ever built) edge case; not
      yet run against the real pipeline's actual non-tiler output — that
      happens as part of the batched fresh re-run above.
- [x] Batch-verify all DRAT proofs with `drat-trim` (or a modern LRAT
      checker) — this becomes the artifact's actual proof-checking step.
      **Built 2026-09-29**, same implementation as above —
      `verify_sat_certificates_worker.js` calls `js_sat_bridge.js`'s
      `verifyDrat()` (which wraps `drat-trim`) on every generated proof;
      stage 09 exits nonzero (exit 2) if anything fails to verify, matching
      `_resolve_bucket.sh`'s hard-fail pattern.
- [x] Decide: do the 58 vertex-star non-tilers stay as a separate
      mathematical argument, or get re-derived via patch-SAT too?
      **Decided 2026-09-28: keep vertex-star separate.** Two independently
      verified methods agreeing is corroborating evidence, not
      inconsistency — worth more to the paper than presentational
      uniformity, and avoids re-deriving something already proven correct
      purely for format's sake. Consequence: stage 09's DRAT tooling only
      needs to cover the SAT-patch-infeasibility non-tilers, not the 58
      vertex-star orbits, which keep their existing combinatorial argument
      as their certificate.
- [ ] For periodic certificates: no DRAT needed (a periodic tiling is
      trivially checkable by direct substitution) — just make sure each
      explicit tiling is exported in a clean, directly-verifiable format
      (period vectors + full assignment over one fundamental domain).
      **Still blocked** on the fresh re-run above: exporting requires every
      periodic record to reliably carry a full domain assignment, which the
      certificate-persistence fix (this session) makes true going forward
      but doesn't retroactively fix in already-completed output. Build the
      actual exporter once the fresh run's output exists.

## Data-quality bugs found verifying the final run (2026-09-29)

- [x] **`scripts/10_summarize_results.sh`'s "3 | all-reflectable (3/3)" row
      was wrong, not just stale.** It read `periodicRaw`/`nonTilerRaw` from
      `results/n3_allreflectable/final_summary.json`, which
      `expand_orbit_results.js` only ever computed over the 17,524-item
      *residual* (stage 03 steps 3-6) — never the original ~82.2M sweep's
      `periodic_w*.jsonl`/`non_tiler_w*.jsonl` from step 1. Under-reported
      periodic by roughly 2,300x for this row. The 0-unresolved claim
      itself was still correct (checked separately), only the reported
      breakdown was broken.
      **Fixed**: `combine_n3_allreflectable_summary.js` (repo root, later
      rewritten again for the Option B residual redesign above) +
      `scripts/03_classify_n3_allreflectable.sh` (writes
      `results/n3_allreflectable/summary.json` with the true combined
      totals) + `scripts/10_summarize_results.sh` (reads that file's
      `periodic`/`nonTiler`/`unresolved` fields instead of
      `final_summary.json`'s residual-only fields). Hit
      `ERR_STRING_TOO_LONG` in an early version of the summary script (used
      `fs.readFileSync` + `.split('\n')` against the large original-sweep
      files) — fixed by switching to a `readline`-over-a-stream line
      counter, matching `gather_periodic_parents.js`'s established
      convention for large JSONL files.
      **Verified fixed:** re-ran with `WORKERS=8`, `SUMMARY.md` showed
      periodic=13,707,491 / nonTiler=68,244,320 for this row. Cross-checked:
      13,707,491+68,244,320+251,721 (skipped duplicates) = 82,203,532,
      exactly the original sweep's total shape count. Closed.
- [x] **n=2's reported total didn't match the known canonical count, by
      exactly 276 (= n=1's total shape count).** `SUMMARY.md` showed 18,788
      periodic + 107,585 non-tiler = 126,373, vs. the known total of
      126,649. Cause: duplicate-tile filtering routes duplicate-tile 2-tile
      shapes to `skipped_duplicate_w*.jsonl`, but
      `scripts/02_classify_n2.sh`'s summary computation only counted
      `periodic_w*`/`non_tiler_w*`/`aperiodic_candidates_w*`, never
      `skipped_duplicate_w*`, so those shapes silently vanished from the
      reported total.
      **Fixed:** `02_classify_n2.sh` updated to also count and report its
      skipped-duplicate file, plus a warning check (exit if the total
      doesn't match 126,649).
      **Verified fixed:** `SUMMARY.md` showed periodic=18,788 /
      nonTiler=107,585 (126,373), + 276 skipped duplicates (tracked
      separately) = 126,649 exactly, the known canonical total. No warning
      fired. Closed.

      **Bonus finding while reconciling totals:** the full n=3 grand total
      across all 4 reflectable patterns is 176,418,566 today vs. the
      historical 176,819,182 in `command_log.md` — a gap of exactly
      400,616. Fully explained, not a new issue: 251,607 from the
      all-reflectable row's duplicate-tile filtering (251,721 newly-skipped
      shapes, minus 114 that historically got resolved-and-discarded via
      the old reprocessing step instead) + 31,938/58,489/58,582 from
      buckets 0/1/2 each having proportionally fewer periodic parents to
      generate variants from (13,707,491 today vs. 13,739,429 historical).
      Sums to exactly 400,616. No action needed — belongs with the
      "Recompute and finalize top-line numbers" paper-stage task below.

## Recompute and finalize top-line numbers

**Deferred as a whole, 2026-09-28** — treated as part of a separate,
later "paper write-up" stage/phase, not something to resolve alongside
the pipeline-running work in this session. Revisit both items once
write-up begins.

- [ ] The blocking reflectableFlags question is now resolved and the full
      symmetry group (σ+ρ) is used everywhere; still need to recompute the
      final "official" orbit counts (as opposed to raw tileset counts) for
      n=1/n=2/n=3 to report in the paper. Orbit-level (canonical,
      σ+ρ-deduped) counts still need consolidating across all patterns per n.
      **Update 2026-09-29, run now complete:** the n=3 total quoted above
      in the header (176,819,182) is the *historical* figure and no longer
      matches the actual completed run's output (176,418,566) — see
      "Data-quality bugs found" above for the full 400,616-shape
      reconciliation (all accounted for by the duplicate-tile-filtering
      improvement). Use 176,418,566 (or better, recompute directly from
      `results/SUMMARY.md` plus the 251,721+276 tracked skipped-duplicate
      counts) as the starting point here, not the stale 176,819,182. Also
      still affected by the planned fresh re-run above (verdicts should
      reproduce identically, but don't treat this as fully final until
      that run confirms it).
- [ ] Decide how much of this session's report-cross-check work (Theorem 1
      verification, `enum.c` comparison, index-13 rigidity reproduction)
      belongs in the paper itself (e.g. as independent verification of a
      companion result) versus staying as internal validation notes.

## Packaging

- [x] **Reproduction entry point built.** `main.sh` + `scripts/00`-`10_*.sh`
      + `REPRODUCE.md`, matching the two-repo layout (`cadical/` sibling +
      `aperiodic_triangles/`). Each stage is independently idempotent
      (marker files under `working/.markers/`) so `sh main.sh --workers N`
      is safely re-runnable after any interruption without redoing
      finished work; `--fresh` does a true from-scratch run.
      `expand_orbit_results.js` (new) correctly expands orbit-level
      verdicts back to raw-tileset membership for stages that consume
      "the periodic parents" downstream — this was a real correctness trap
      (using only the 352 orbit reps instead of all 5,911 raw periodic
      members would have under-generated bucket 0-2 by the orbit-size
      factor).
- [x] Pin the exact CaDiCaL commit SHA used for the paper's results in
      `README.md`'s "Initial setup" section.
      **Closed 2026-09-28.** SHA confirmed from the actual build (`git
      rev-parse HEAD` on the sibling `cadical/` clone, working tree clean):
      `c60730422e758ef1cebe7aeddf2dda31c996bf04` (tag `rel-3.0.1`). The
      placeholder `<commit-sha-used-in-the-paper>` inside the
      `git checkout <...>` line (README.md, "Initial setup" code block) has
      been replaced with this SHA.
- [x] Stage 09 (DRAT batch verification) is a placeholder that exits
      nonzero on purpose — build the real tool (see "Certificate rigor"
      above) and wire it into `main.sh`'s default stage list once it
      exists.
      **Closed 2026-09-29.** Real implementation built and added to
      `main.sh`'s default `STAGES` list. `scripts/10_summarize_results.sh`
      updated to include a certificate-verification section in
      `SUMMARY.md` when stage 09 has run. Not yet run against real
      pipeline data — batched into the planned fresh re-run above.
- [ ] `chiral_variants_multicore.js` (stage 05) has no internal
      checkpointing of its own — if killed mid-run it restarts from
      scratch (~66 min at original scale, so low priority, but worth
      knowing before assuming every stage resumes at the sub-stage level).
- [x] Decide whether `working/n3_allreflectable`'s step 2-3 tools should be
      folded into `full_resolve_multicore.js`'s cascade.
      **Decided 2026-09-28: leave as-is.** Note: `reprocess_candidates_multicore.js`
      is already gone from the active pipeline (dropped from stage 03 as a
      provable no-op once duplicate-tile shapes started being caught
      upstream during classification), so only `recheck_torus_unresolved_multicore.js`
      and `compute_remaining_after_torus_recheck.js` remain in play. Stage
      03 runs once at the top of the pipeline and isn't a shared code path
      the way buckets 0/1/2 share `full_resolve_multicore.js`, so folding
      would be pure cleanup with no functional benefit and real risk of
      disturbing already-validated, already-correct code. Skipped.
- [ ] **New 2026-09-28.** `README.md`'s "Expected scale" table (near the
      end) still lists n=3's canonical shape count as "~83,000,000
      (estimated)" — stale now that the exact figure is known: 82,203,532
      all-reflectable, or 176,819,182 across all four reflectable patterns
      combined. Noticed while fixing the CaDiCaL SHA; deferred as a
      separate documentation-polish pass rather than fixed inline.
- [x] Update `command_log.md` (or fold it into the README) to describe the
      finalized reproducible procedure, distinct from its session-by-
      session exploratory history.
      **Closed 2026-09-28 — already resolved, no further action needed.**
      `README.md` already serves as the clean reproduction spec (the
      "Reproducing the full n≤3 minimality result" section, now with the
      CaDiCaL SHA pinned too). `command_log.md` staying a session-by-session
      narrative is fine as-is and arguably valuable — it's the provenance/
      investigative record (dead ends, validation steps, the twists and
      turns) that complements rather than duplicates the spec. No fold-in
      needed; division of labor between the two files is intentional.
