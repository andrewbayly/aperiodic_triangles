#!/bin/sh
# n=2, all 3 reflectable-tile-count patterns (main.js's own --n 2 sweep
# covers all of them in one pass, per command_log.md). ~36 min at
# --workers 8 in the original run; scales with core count.
# Expected result: 126,649 shapes, 18,819 periodic / 107,830 non-tiler,
# 0 candidates.
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
mkdir -p "$RESULTS/n2"
cat > "$RESULTS/n2/summary.json" <<EOF
{"n": 2, "periodic": ${P:-0}, "nonTiler": ${NT:-0}, "unresolved": ${C:-0}}
EOF
echo "n=2: periodic=${P:-0} nonTiler=${NT:-0} unresolved=${C:-0}"
if [ "${C:-0}" -gt 0 ]; then
  echo "ERROR: n=2 has ${C:-0} unresolved (aperiodic-candidate) shapes -- that would itself be major news, not just a pipeline issue. Investigate before treating this stage as complete." >&2
  exit 2
fi

mark_done "02_classify_n2"
echo "[02_classify_n2] done -- output under $WORK/n2/output/, summary at $RESULTS/n2/summary.json"
