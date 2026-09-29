#!/bin/sh
# n=2, all 3 reflectable-tile-count patterns (main.js's own --n 2 sweep
# covers all of them in one pass, per command_log.md). ~36 min at
# --workers 8 in the original run; scales with core count.
#
# Historical result (before the duplicate-tile-at-classify-time
# improvement -- see scripts/03_classify_n3_allreflectable.sh's comments
# for the full explanation of this upstream change): 126,649 shapes,
# 18,819 periodic / 107,830 non-tiler, 0 candidates.
#
# Current result (2026-09-29; duplicate-tile n=2 shapes -- i.e. a 2-tile
# set whose tiles are identical -- are now filtered upstream into
# skipped_duplicate_w*.jsonl instead of being counted as periodic or
# non-tiler, same as n=3): 18,788 periodic / 107,585 non-tiler /
# 0 candidates / 276 skipped duplicates. 276 is not a coincidence -- it
# equals n=1's total canonical shape count, since a duplicate-tile n=2
# shape is exactly "two copies of one n=1 shape." Both splits sum to
# 126,649; the sanity check below verifies whichever split your current
# worker.js actually produces, rather than trusting a fixed number.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh
require_workers

skip_if_done "02_classify_n2"
mkdir -p "$WORK/n2"
( cd "$WORK/n2" && node "$REPO_ROOT/main.js" --n 2 --workers "$WORKERS" --patch-budget 200000000 )

# Count main.js's own output files rather than trusting a hardcoded number
# (see 10_summarize_results.sh -- it reads this file instead of guessing).
cd "$WORK/n2"
P=$(cat output/periodic_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
NT=$(cat output/non_tiler_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
C=$(cat output/aperiodic_candidates_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
SK=$(cat output/skipped_duplicate_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
mkdir -p "$RESULTS/n2"
cat > "$RESULTS/n2/summary.json" <<EOF
{"n": 2, "periodic": ${P:-0}, "nonTiler": ${NT:-0}, "unresolved": ${C:-0}, "skippedDuplicate": ${SK:-0}}
EOF
echo "n=2: periodic=${P:-0} nonTiler=${NT:-0} unresolved=${C:-0} skippedDuplicate=${SK:-0}"
TOTAL_N2=$((${P:-0} + ${NT:-0} + ${C:-0} + ${SK:-0}))
if [ "$TOTAL_N2" -ne 126649 ]; then
  echo "WARNING: n=2's total (periodic+nonTiler+unresolved+skippedDuplicate = ${TOTAL_N2}) does not equal the known canonical total of 126,649 -- investigate before trusting these numbers." >&2
fi
if [ "${C:-0}" -gt 0 ]; then
  echo "ERROR: n=2 has ${C:-0} unresolved (aperiodic-candidate) shapes -- that would itself be major news, not just a pipeline issue. Investigate before treating this stage as complete." >&2
  exit 2
fi

mark_done "02_classify_n2"
echo "[02_classify_n2] done -- output under $WORK/n2/output/, summary at $RESULTS/n2/summary.json"
