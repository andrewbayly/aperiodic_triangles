#!/bin/sh
# For each all-reflectable periodic parent, generate its 7 nonempty
# chiral-subset variants and bucket by resulting reflectable-tile-count.
# Relies on the no-cross-parent-collision theorem: no expensive global
# dedup pass needed, only within-parent (<=7 candidates).
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh
require_workers

skip_if_done "05_generate_chiral_variants"
D="$WORK/n3_variants"
cd "$D"

split_chunks all_n3_periodic_parents.jsonl chunks/parent
node "$REPO_ROOT/chiral_variants_multicore.js" \
  --chunk-prefix chunks/parent --workers "$WORKERS" --output variant_output

for b in 0 1 2; do
  cat variant_output/bucket${b}_w*.jsonl > bucket${b}_all.jsonl
done

mark_done "05_generate_chiral_variants"
echo "[05_generate_chiral_variants] done -- bucket{0,1,2}_all.jsonl written under $D"
