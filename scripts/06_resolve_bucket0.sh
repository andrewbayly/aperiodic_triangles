#!/bin/sh
# All-chiral (0 reflectable tiles). ~1h on 8 performance cores in the
# original run. Expected: 9,717,438 periodic / 4,021,991 non-tiler / 0 unresolved.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh
skip_if_done "06_resolve_bucket0"
BUCKET=0 DEFAULT_FLAGS=false,false,false . ./scripts/_resolve_bucket.sh
mark_done "06_resolve_bucket0"
