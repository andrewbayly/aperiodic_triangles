#!/bin/sh
# Shared body for stages 06/07/08. Sourced with BUCKET and DEFAULT_FLAGS
# already set by the caller. Not resumable-marked itself -- the caller
# (06/07/08_resolve_bucket*.sh) sets its own stage name for that.
set -e
require_workers
require_cadical

D="$WORK/n3_variants"
cd "$D"

IN="bucket${BUCKET}_all.jsonl"
if [ ! -f "$IN" ]; then
  echo "ERROR: $D/$IN not found -- run scripts/05_generate_chiral_variants.sh first." >&2
  exit 1
fi

split_chunks "$IN" "chunks/bucket${BUCKET}"
node "$REPO_ROOT/full_resolve_multicore.js" \
  --chunk-prefix "chunks/bucket${BUCKET}" --workers "$WORKERS" \
  --output "resolve_bucket${BUCKET}" --default-flags "$DEFAULT_FLAGS" \
  --cadical-bin "$CADICAL_BIN"

mkdir -p "$RESULTS/n3_bucket${BUCKET}"
for kind in periodic non_tiler still_unresolved; do
  cat "resolve_bucket${BUCKET}"/${kind}_w*.jsonl > "${kind}_bucket${BUCKET}.jsonl" 2>/dev/null || true
done
COUNT_PERIODIC=$(wc -l < "periodic_bucket${BUCKET}.jsonl" 2>/dev/null || echo 0)
COUNT_NONTILER=$(wc -l < "non_tiler_bucket${BUCKET}.jsonl" 2>/dev/null || echo 0)
COUNT_UNRESOLVED=$(wc -l < "still_unresolved_bucket${BUCKET}.jsonl" 2>/dev/null || echo 0)
cat > "$RESULTS/n3_bucket${BUCKET}/summary.json" <<EOF
{"bucket": ${BUCKET}, "reflectableFlags": "${DEFAULT_FLAGS}", "periodic": ${COUNT_PERIODIC}, "nonTiler": ${COUNT_NONTILER}, "unresolved": ${COUNT_UNRESOLVED}}
EOF
echo "bucket ${BUCKET}: periodic=${COUNT_PERIODIC} nonTiler=${COUNT_NONTILER} unresolved=${COUNT_UNRESOLVED}"

if [ "$COUNT_UNRESOLVED" -gt 0 ]; then
  echo "ERROR: bucket ${BUCKET} has ${COUNT_UNRESOLVED} unresolved shapes -- these are the actual research question if they're real (see README's caveat that aperiodic-candidate is not a proof of aperiodicity). Investigate before treating this stage as complete." >&2
  exit 2
fi
