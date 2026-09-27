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
- [ ] Treat `core.py`/`solve.py` as a validation reference only, not a
      maintained part of the go-forward artifact.
- [ ] Confirm `canonical_full.js` (with both σ-flip and ρ-flip) is the one
      canonicalization used everywhere going forward.
- [ ] Audit `check_unmatchable.js`/`canonical_full.js`/`vertex_star_check.js`/
      `js_sat_bridge.js` once more specifically against chiral and mixed
      n=3 patterns once those campaigns are running (all were built or
      re-confirmed to be reflectableFlags-aware this session, but the n=3
      scale is the real stress test).

## Extend the pure-JS SAT bridge

- [ ] Add torus/periodicity support to `js_sat_bridge.js` (mirror
      `torus_graph` from `solve.py`) — right now it only has the hex-patch
      side tested end-to-end.
- [ ] Quick benchmark: CaDiCaL vs Kissat on our actual instance mix: pick
      whichever's the standard for the artifact (Kissat is often faster on
      UNSAT-heavy workloads, worth a real check rather than assuming).
- [ ] Re-run the full residual verification (all 1,191 orbits: 352 periodic
      + 839 non-tiler) through the pure-JS bridge, so the final result
      doesn't depend on the Python cross-check at all — just uses it as
      history/provenance.

## Certificate rigor (the DRAT upgrade)

- [ ] Generate and archive a DRAT proof for every non-tiler certificate
      found via patch infeasibility (currently only spot-checked one).
- [ ] Batch-verify all DRAT proofs with `drat-trim` (or a modern LRAT
      checker) — this becomes the artifact's actual proof-checking step.
- [ ] Decide: do the 58 vertex-star non-tilers stay as a separate
      mathematical argument (clean, self-contained, but a different
      "shape" of certificate), or get re-derived via patch-SAT too, so
      every non-tiler in the paper has the exact same certificate format?
      Given unlimited time, leaning toward "uniform DRAT story" for
      presentation simplicity, but worth deciding deliberately.
- [ ] For periodic certificates: no DRAT needed (a periodic tiling is
      trivially checkable by direct substitution) — just make sure each of
      the 352 explicit tilings is exported in a clean, directly-verifiable
      format (period vectors + full assignment over one fundamental domain).

## Recompute and finalize top-line numbers

- [ ] The blocking reflectableFlags question is now resolved and the full
      symmetry group (σ+ρ) is used everywhere; still need to recompute the
      final "official" orbit counts (as opposed to raw tileset counts) for
      n=1/n=2/n=3 to report in the paper. Current raw tileset totals:
      n=1 = 276 (2 patterns), n=2 = 126,649 (3 patterns), n=3 = 176,819,182
      (4 patterns, all-reflectable + 2/1/0-reflectable combined) — all with
      0 aperiodicity candidates. Orbit-level (canonical, σ+ρ-deduped)
      counts still need consolidating across all patterns per n.
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
- [ ] Pin the exact CaDiCaL commit SHA used for the paper's results in
      `REPRODUCE.md` (currently a placeholder `<commit-sha-used-in-the-paper>`).
- [ ] Stage 09 (DRAT batch verification) is a placeholder that exits
      nonzero on purpose — build the real tool (see "Certificate rigor"
      above) and wire it into `main.sh`'s default stage list once it
      exists.
- [ ] `chiral_variants_multicore.js` (stage 05) has no internal
      checkpointing of its own — if killed mid-run it restarts from
      scratch (~66 min at original scale, so low priority, but worth
      knowing before assuming every stage resumes at the sub-stage level).
- [ ] Decide whether `working/n3_allreflectable`'s step 2-3 tools
      (`reprocess_candidates_multicore.js`, `recheck_torus_unresolved_multicore.js`,
      `compute_remaining_after_torus_recheck.js`) should be folded into
      `full_resolve_multicore.js`'s cascade too, so stage 03 doesn't depend
      on three separate older tools with their own ad hoc output-directory
      conventions.
- [ ] Update `command_log.md` (or fold it into the README) to describe the
      *finalized* reproducible procedure, distinct from the session-by-
      session exploratory history it currently reads as — `REPRODUCE.md`
      now covers the "how to run it" half; `command_log.md` still reads as
      a session-by-session narrative rather than a spec.
