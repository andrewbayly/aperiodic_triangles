#!/bin/sh
# n=3, all-reflectable pattern only (the other 3 patterns are stages 04-08).
# This is the distilled path: it reproduces the *result* of the original
# exploration, not every dead end taken to find it. Steps dropped on
# purpose (see command_log.md for why): the single-threaded reprocess
# attempt (superseded by the multicore version, itself later removed --
# see below), the deep-patch-push escalation (tested, found low-leverage,
# abandoned), and the divisor/torusUnresolved distribution diagnostics
# (analysis only, no effect on the classification itself).
#
# 2026-09-28: also dropped the duplicate-tile/reclassification reprocessing
# pass (formerly step 2, via reprocess_candidates_multicore.js). It's now
# provably a no-op: worker.js's classify() step was improved at some point
# after the original historical run to detect duplicate-tile shapes
# *during* classification and route them straight to
# skipped_duplicate_w<id>.jsonl (see main.js --help), rather than letting
# them reach candidate status and only catching them here afterward. That
# upstream filter makes this step's duplicate-tile check unable to ever
# find anything -- verified empirically on the real n=3 all-reflectable
# candidates before removing: 17,708 in, 0 resolved via duplicate-tile
# reduction, 0 resolved via reclassification, 105.9 minutes spent for zero
# effect. (This also explains why today's periodic/non-tiler/candidate
# split differs from the historical 13,738,893/68,446,817/17,822 figures
# even though the grand total, including the new skipped category, matches
# exactly: 13,701,396 + 68,232,707 + 17,708 + 251,721 = 82,203,532.)
#
# Expect this to take the better part of a day on an 8-performance-core
# machine -- step 1 alone was ~24h in the original run.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh
require_workers
require_cadical

skip_if_done "03_classify_n3_allreflectable"
D="$WORK/n3_allreflectable"
mkdir -p "$D"
cd "$D"

# --- 1. full classify() sweep over all 82.2M all-reflectable shapes -----
if [ ! -f .step1_done ]; then
  node "$REPO_ROOT/main.js" --n 3 --workers "$WORKERS"
  touch .step1_done
fi
# Expected: 82,203,532 total shapes classified across all categories.
# Historical split (before the duplicate-tile-at-classify-time improvement):
# 13,738,893 periodic; 68,446,817 non-tiler; 17,822 aperiodic-candidates.
# Current split (duplicate-tile shapes now filtered upstream into
# skipped_duplicate_w*.jsonl instead of reaching periodic/non-tiler/
# candidate): 13,701,396 periodic; 68,232,707 non-tiler; 17,708 candidates;
# 251,721 skipped. Both splits sum to 82,203,532 -- check whichever your
# current worker.js actually produces, not a fixed set of per-category
# numbers, since that split depends on how much duplicate-tile filtering
# happens upstream vs. is left for later steps to catch.

# --- 2. merge per-worker candidates into one file for the steps below ---
if [ ! -f .step2_done ]; then
  cat output/aperiodic_candidates_w*.jsonl > all_candidates.jsonl
  touch .step2_done
fi
# Expected: 17,708 lines (see the note above on why this no longer matches
# the historical 17,822 -- the difference is duplicate-tile shapes now
# caught upstream, not a discrepancy to chase).

# --- 3. recheck previously-unswept torus sizes ----------------------------
if [ ! -f .step3_done ]; then
  node "$REPO_ROOT/recheck_torus_unresolved_multicore.js" --input all_candidates.jsonl --workers "$WORKERS"
  node "$REPO_ROOT/compute_remaining_after_torus_recheck.js" all_candidates.jsonl torus_recheck_output still_candidates_after_torus_recheck.jsonl
  touch .step3_done
fi
# Expected (historical, will need re-verifying against today's 17,708-based
# input rather than assumed to match exactly): confirmed periodic here;
# candidates remain in still_candidates_after_torus_recheck.jsonl.

# --- 4. resolve every raw residual candidate directly: fast-classify ----
#        -> sheared-lattice -> vertex-star -> SAT patch-infeasibility
#        (same cascade proven at scale on the chiral/mixed buckets in
#        stages 06-08 below, applied here to every raw candidate on its
#        own -- NOT via orbit-dedup + expand).
#
# 2026-09-29: this replaces the former steps 4-6 (canonical_full.js
# --dedupe -> full_resolve_multicore.js on orbit reps -> expand_orbit_
# results.js). That path was found to silently discard every resolved
# tileset's periodicity certificate: expand_orbit_results.js's expansion
# step re-emits each raw member's *original pre-dedup candidate record*,
# not the orbit's resolved lattice/patch data (see TODO.md, "Planned: one
# full fresh re-run"). Rather than teach the expansion step to carry
# certificate data through a symmetry-orbit representative back out to
# every raw member it stands in for (correct, but a second nontrivial
# thing to get right), we drop the dedup optimization for this residual
# entirely: solve all 17,524 raw candidates independently, exactly the
# way buckets 0-2 already do in stages 06-08. Orbit dedup here was only
# ever a performance optimization (17,524 raw -> 1,191 orbits), and at
# this residual's size the direct approach is cheap enough not to need
# it. canonical_full.js and expand_orbit_results.js stay in the repo --
# they're still used elsewhere (chiral_variants_worker.js) -- they're
# just not called in this particular path any more.
if [ ! -f .step4_done ]; then
  split_chunks still_candidates_after_torus_recheck.jsonl chunks/residual
  node "$REPO_ROOT/full_resolve_multicore.js" \
    --chunk-prefix chunks/residual --workers "$WORKERS" \
    --output resolve_output --default-flags true,true,true \
    --cadical-bin "$CADICAL_BIN"
  touch .step4_done
fi
# Output (per worker, in resolve_output/): periodic_w<id>.jsonl,
# non_tiler_w<id>.jsonl, still_unresolved_w<id>.jsonl -- each resolved
# periodic record now carries its full patch/lattice certificate
# (fast-classify's own patch, or sheared-lattice's patch per the
# full_resolve_worker.js fix), no expansion step needed since every
# record processed here already *is* a raw tileset, not an orbit rep.

# --- 5. verify 0 unresolved (same pattern as _resolve_bucket.sh) --------
UNRESOLVED_N3=$(cat resolve_output/still_unresolved_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNRESOLVED_N3" -ne 0 ]; then
  echo "ERROR: $UNRESOLVED_N3 n=3 all-reflectable residual candidates still unresolved after full cascade -- see resolve_output/still_unresolved_w*.jsonl" >&2
  exit 2
fi

mkdir -p "$RESULTS/n3_allreflectable"

# --- 6. combine the original sweep + torus-recheck + direct-resolve into
#        one TRUE top-line summary for this whole all-reflectable
#        category. combine_n3_allreflectable_summary.js was rewritten
#        2026-09-29 to read resolve_output/ directly instead of the now-
#        defunct final_summary.json (the old orbit-dedup path's output).
if [ ! -f .step6_done ]; then
  node "$REPO_ROOT/combine_n3_allreflectable_summary.js" . "$RESULTS/n3_allreflectable/summary.json"
  touch .step6_done
fi

mark_done "03_classify_n3_allreflectable"
echo "[03_classify_n3_allreflectable] done -- combined summary at $RESULTS/n3_allreflectable/summary.json (per-record certificates in resolve_output/periodic_w*.jsonl)"
