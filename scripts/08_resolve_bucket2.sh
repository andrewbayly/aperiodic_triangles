#!/bin/sh
# 2 reflectable tiles (canonically tiles 0,1). ~14h27m on 8 performance
# cores in the original run -- the longest single stage. Expected:
# 35,873,556 periodic / 4,511,423 non-tiler / 0 unresolved.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh
skip_if_done "08_resolve_bucket2"
BUCKET=2 DEFAULT_FLAGS=true,true,false . ./scripts/_resolve_bucket.sh
mark_done "08_resolve_bucket2"
