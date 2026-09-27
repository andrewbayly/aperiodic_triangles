#!/bin/sh
# n=3, all-reflectable pattern only (the other 3 patterns are stages 04-08).
# This is the distilled path: it reproduces the *result* of the original
# exploration, not every dead end taken to find it. Steps dropped on
# purpose (see command_log.md for why): the single-threaded reprocess
# attempt (superseded by the multicore version kept below), the
# deep-patch-push escalation (tested, found low-leverage, abandoned), and
# the divisor/torusUnresolved distribution diagnostics (analysis only, no
# effect on the classification itself).
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
# Expected: 82,203,532 shapes; 13,738,893 periodic; 68,446,817 non-tiler;
# 17,822 aperiodic-candidates (output/{periodic,non_tiler,aperiodic_candidates}_w*.jsonl)

# --- 2. resolve duplicate-tile-labeling false candidates -----------------
if [ ! -f .step2_done ]; then
  cat output/aperiodic_candidates_w*.jsonl > all_candidates.jsonl
  node "$REPO_ROOT/reprocess_candidates_multicore.js" --input all_candidates.jsonl --workers "$WORKERS"
  cat reprocessed_output/still_candidate_w*.jsonl > still_candidates_after_reprocess.jsonl
  touch .step2_done
fi
# Expected: 17,822 -> 17,708 still-candidate (114 resolved as duplicate-tile artifacts)

# --- 3. recheck previously-unswept torus sizes ----------------------------
if [ ! -f .step3_done ]; then
  node "$REPO_ROOT/recheck_torus_unresolved_multicore.js" --input still_candidates_after_reprocess.jsonl --workers "$WORKERS"
  node "$REPO_ROOT/compute_remaining_after_torus_recheck.js" still_candidates_after_reprocess.jsonl torus_recheck_output still_candidates_after_torus_recheck.jsonl
  touch .step3_done
fi
# Expected: 184 confirmed periodic here; 17,524 candidates remain

# --- 4. dedupe the residual under the full symmetry group (σ+ρ) ----------
if [ ! -f .step4_done ]; then
  node "$REPO_ROOT/canonical_full.js" --dedupe still_candidates_after_torus_recheck.jsonl residual
  touch .step4_done
fi
# Expected: 17,524 raw -> 1,191 distinct orbits (residual_unique.jsonl, residual_orbits.jsonl)

# --- 5. resolve every orbit: fast-classify -> sheared-lattice -----------
#        -> vertex-star -> SAT patch-infeasibility (same cascade proven
#        at scale on the chiral/mixed buckets in stages 06-08 below)
if [ ! -f .step5_done ]; then
  split_chunks residual_unique.jsonl chunks/residual
  node "$REPO_ROOT/full_resolve_multicore.js" \
    --chunk-prefix chunks/residual --workers "$WORKERS" \
    --output resolve_output --default-flags true,true,true \
    --cadical-bin "$CADICAL_BIN"
  touch .step5_done
fi

# --- 6. expand orbit verdicts back to raw-tileset records, verify 0 unresolved
# (needed as real per-record input for stage 04, not just a count -- two
# raw tilesets in the same orbit still need their own chiral variants
# generated separately; see expand_orbit_results.js's header comment)
node "$REPO_ROOT/expand_orbit_results.js" \
  still_candidates_after_torus_recheck.jsonl residual_orbits.jsonl resolve_output final
# Expected: periodicRaw=5,911, unresolvedRaw=0 (expand_orbit_results.js
# exits 2 if unresolvedRaw > 0, which stops this script via `set -e`).

mkdir -p "$RESULTS/n3_allreflectable"
cp final_summary.json "$RESULTS/n3_allreflectable/"
cp residual_orbits.jsonl residual_unique.jsonl "$RESULTS/n3_allreflectable/" 2>/dev/null || true

mark_done "03_classify_n3_allreflectable"
echo "[03_classify_n3_allreflectable] done -- summary at $RESULTS/n3_allreflectable/final_summary.json"
