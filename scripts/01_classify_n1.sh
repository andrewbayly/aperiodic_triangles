#!/bin/sh
# n=1, both reflectable patterns. Fast (<1 min); no --workers/--patch-budget
# needed at this size. Expected result: 276 shapes, 31 periodic / 245
# non-tiler, 0 candidates (see command_log.md).
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh

skip_if_done "01_classify_n1"
mkdir -p "$WORK/n1"
# --workers 2, not main.js's own default of os.cpus().length: n=1's total
# workload is only 276 canonical shapes, so a large worker-thread count adds
# pure overhead for zero benefit -- confirmed on real hardware that leaving
# this unset can make an under-a-second job appear to hang for 100+ seconds.
( cd "$WORK/n1" && node "$REPO_ROOT/main.js" --n 1 --workers 2 )

# Count main.js's own output files rather than trusting a hardcoded number
# (see 10_summarize_results.sh -- it reads this file instead of guessing).
cd "$WORK/n1"
P=$(cat output/periodic_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
NT=$(cat output/non_tiler_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
C=$(cat output/aperiodic_candidates_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
mkdir -p "$RESULTS/n1"
cat > "$RESULTS/n1/summary.json" <<EOF
{"n": 1, "periodic": ${P:-0}, "nonTiler": ${NT:-0}, "unresolved": ${C:-0}}
EOF
echo "n=1: periodic=${P:-0} nonTiler=${NT:-0} unresolved=${C:-0}"
if [ "${C:-0}" -gt 0 ]; then
  echo "ERROR: n=1 has ${C:-0} unresolved (aperiodic-candidate) shapes -- that would itself be major news, not just a pipeline issue. Investigate before treating this stage as complete." >&2
  exit 2
fi

mark_done "01_classify_n1"
echo "[01_classify_n1] done -- output under $WORK/n1/output/, summary at $RESULTS/n1/summary.json"
