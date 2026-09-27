#!/bin/sh
# n=1, both reflectable patterns. Fast (<1 min); no --workers/--patch-budget
# needed at this size. Expected result: 276 shapes, 31 periodic / 245
# non-tiler, 0 candidates (see command_log.md).
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh

skip_if_done "01_classify_n1"
mkdir -p "$WORK/n1"
( cd "$WORK/n1" && node "$REPO_ROOT/main.js" --n 1 )

mark_done "01_classify_n1"
echo "[01_classify_n1] done -- output under $WORK/n1/output/"
