#!/bin/sh
# Build CaDiCaL from the sibling clone. Not a classification stage, so it
# doesn't use the --workers count (that flag is about the P/E-core
# throughput pitfall in the Node worker pool, below -- it has no bearing
# on a one-off C++ compile, which is fine to run with every logical core).
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh

skip_if_done "00_build_cadical"

CADICAL_SRC="$REPO_ROOT/../cadical"
if [ ! -d "$CADICAL_SRC" ]; then
  echo "ERROR: expected $CADICAL_SRC to exist (see INITIAL SETUP in REPRODUCE.md)." >&2
  echo "  cd $REPO_ROOT/.. && git clone https://github.com/arminbiere/cadical.git" >&2
  exit 1
fi

if [ ! -x "$CADICAL_BIN" ]; then
  BUILD_JOBS=$(command -v nproc >/dev/null 2>&1 && nproc || sysctl -n hw.ncpu 2>/dev/null || echo 4)
  ( cd "$CADICAL_SRC" && ./configure && make -j"$BUILD_JOBS" )
fi

if [ ! -x "$CADICAL_BIN" ]; then
  echo "ERROR: build finished but $CADICAL_BIN still not found -- check cadical's build output above." >&2
  exit 1
fi

mark_done "00_build_cadical"
echo "[00_build_cadical] done -- binary at $CADICAL_BIN"
