#!/bin/sh
# 1 reflectable tile (canonically tile 0). ~5h52m on 8 performance cores
# in the original run. Expected: 32,012,320 periodic / 8,479,036 non-tiler
# / 0 unresolved.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh
skip_if_done "07_resolve_bucket1"
BUCKET=1 DEFAULT_FLAGS=true,false,false . ./scripts/_resolve_bucket.sh
mark_done "07_resolve_bucket1"
