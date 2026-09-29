#!/bin/sh
# Reproduces the full n<=3 minimality classification: every n=1, n=2, and
# n=3 tileset, under every reflectable/chiral configuration, classified
# periodic or non-tiler with 0 unresolved. See REPRODUCE.md for the
# two-repo project layout this expects (this file lives in
# aperiodic_triangles/, with a sibling ../cadical/ checkout).
#
# Usage:
#   sh ./main.sh --workers <performance-core-count> [--fresh] [--from <NN>]
#
#   --workers N   required, no default -- see scripts/_common.sh for why
#                 (NOT your total logical core count on hybrid CPUs).
#   --fresh       delete ./working and ./results first, for a genuinely
#                 from-scratch run. Omit this to resume a prior run in
#                 place -- every stage below is independently idempotent
#                 (skips instantly if already done; the underlying
#                 multicore tools resume mid-file via their own per-worker
#                 checkpoints if a stage was interrupted partway).
#   --from NN     start at stage NN instead of 00 (e.g. --from 06 to
#                 rerun only the bucket resolutions). Rarely needed since
#                 every stage already skips itself when done -- mainly
#                 useful for deliberately re-running one stage after
#                 deleting its marker in working/.markers/.
#
# This is one long-running command (multi-day on the original 8-core
# machine), so it's also fine to run the numbered scripts under scripts/
# directly, one at a time, in order -- main.sh is a convenience wrapper
# around exactly that, nothing more.
set -e
cd "$(dirname "$0")"

WORKERS=""
FRESH=0
FROM="00"
while [ $# -gt 0 ]; do
  case "$1" in
    --workers) WORKERS="$2"; shift 2 ;;
    --fresh) FRESH=1; shift ;;
    --from) FROM="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
export WORKERS

if [ -z "$WORKERS" ]; then
  echo "ERROR: --workers is required. See the header of this script and" >&2
  echo "README.md's 'Choosing --workers' section before picking a number." >&2
  exit 1
fi

if [ "$FRESH" = "1" ]; then
  echo "Deleting ./working and ./results for a from-scratch run..."
  rm -rf ./working ./results
fi

STAGES="00 01 02 03 04 05 06 07 08 09 10"
# 2026-09-29: stage 09 (SAT certificate/DRAT verification) is now a real
# tool (see scripts/09_verify_sat_certificates.sh) and included in the
# default sequence. It reads stages 06-08's (and 03's) already-finished
# non_tiler_w*.jsonl output rather than participating in classification
# itself, so it's safe to run after them; classification correctness
# (stages 00-08) does not depend on it.

for s in $STAGES; do
  if [ "$s" -lt "$FROM" ]; then continue; fi
  script=$(ls scripts/${s}_*.sh 2>/dev/null | head -1)
  if [ -z "$script" ]; then echo "ERROR: no script for stage $s" >&2; exit 1; fi
  echo
  echo "==> $script"
  sh "$script"
done

echo
echo "All stages complete. See results/SUMMARY.md."
