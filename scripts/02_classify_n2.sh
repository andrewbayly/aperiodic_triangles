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

mark_done "02_classify_n2"
echo "[02_classify_n2] done -- output under $WORK/n2/output/"
