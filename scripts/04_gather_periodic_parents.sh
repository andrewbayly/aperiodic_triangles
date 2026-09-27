#!/bin/sh
# Merge every all-reflectable periodic parent found in stage 03 (the
# original sweep's periodic_w*.jsonl, the 184 torus-recheck recoveries,
# and the 5,911 periodic orbits resolved out of the residual -- expanded
# back to raw tilesets) into one file ready for chiral-variant generation.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh

skip_if_done "04_gather_periodic_parents"
D="$WORK/n3_variants"
mkdir -p "$D"
cd "$D"

N3="$WORK/n3_allreflectable"
# Note: the third input is the EXPANDED raw periodic file from stage 03's
# final step (final_periodic_raw.jsonl), not resolve_output/periodic_w*
# directly -- the latter is only the 352 orbit representatives, and each
# of the underlying 5,911 raw periodic tilesets needs its own chiral
# variants generated (see expand_orbit_results.js's header comment).
node "$REPO_ROOT/gather_periodic_parents.js" all_n3_periodic_parents.jsonl \
  "$N3"/output/periodic_w*.jsonl \
  "$N3"/torus_recheck_output/resolved_periodic_w*.jsonl \
  "$N3"/final_periodic_raw.jsonl

echo "Sanity check: sum the per-file counts printed above yourself against" \
     "command_log.md's known-good total for your specific input set before" \
     "trusting the merged file -- see the note in gather_periodic_parents.js."

mark_done "04_gather_periodic_parents"
echo "[04_gather_periodic_parents] done -- wrote $D/all_n3_periodic_parents.jsonl"
