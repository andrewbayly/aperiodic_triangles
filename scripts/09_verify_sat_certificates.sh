#!/bin/sh
# Batch DRAT-proof generation + drat-trim verification for every SAT
# patch-infeasibility non-tiler certificate (see TODO.md, "Certificate
# rigor"). Only records resolved via resolvedBy: 'sat-patch' need this --
# the 58 vertex-star non-tilers keep their existing combinatorial argument
# (decided 2026-09-28: two independently verified methods agreeing is
# corroborating evidence, not something to collapse into one format), and
# periodic certificates need no DRAT at all since periodicity is directly
# checkable by substitution.
#
# Classification results (stages 00-08) are already complete and correct
# without this stage -- this only adds independent, archivable proof
# certificates for the paper's reproducibility appendix. That's why it can
# safely run AFTER stages 06-08 rather than interleaved with them: it reads
# their finished non_tiler_w*.jsonl output rather than participating in
# classification itself.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh
require_workers
require_cadical
require_drat_trim

skip_if_done "09_verify_sat_certificates"
D="$WORK/09_certificates"
mkdir -p "$D"
cd "$D"

# --- 1. gather every sat-patch-resolved non-tiler record across buckets
#        0/1/2 and the n=3 all-reflectable residual --------------------
if [ ! -f .step1_done ]; then
  node "$REPO_ROOT/gather_sat_certificates.js" sat_patch_records.jsonl
  touch .step1_done
fi

TOTAL_RECORDS=$(wc -l < sat_patch_records.jsonl 2>/dev/null || echo 0)
if [ "$TOTAL_RECORDS" -eq 0 ]; then
  echo "[09_verify_sat_certificates] 0 sat-patch records found -- nothing to verify."
  mkdir -p "$RESULTS/certificates"
  echo '{"totalRecords": 0, "verified": 0, "failed": 0}' > "$RESULTS/certificates/summary.json"
  mark_done "09_verify_sat_certificates"
  exit 0
fi
echo "[09_verify_sat_certificates] $TOTAL_RECORDS sat-patch certificates to verify"

# --- 2. regenerate each record's CNF at its own stored radius, request a
#        DRAT proof from CaDiCaL, and check it with drat-trim -----------
if [ ! -f .step2_done ]; then
  split_chunks sat_patch_records.jsonl chunks/certs
  node "$REPO_ROOT/verify_sat_certificates_multicore.js" \
    --chunk-prefix chunks/certs --workers "$WORKERS" \
    --output verify_output --cadical-bin "$CADICAL_BIN" --drat-trim-bin "$DRAT_TRIM_BIN"
  touch .step2_done
fi

# --- 3. verify 0 failures (same pattern as _resolve_bucket.sh) ----------
VERIFIED=$(cat verify_output/verified_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
FAILED=$(cat verify_output/failed_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
echo "[09_verify_sat_certificates] verified=${VERIFIED} failed=${FAILED} (of ${TOTAL_RECORDS} total)"

if [ "$FAILED" -gt 0 ]; then
  echo "ERROR: ${FAILED} SAT patch-infeasibility certificates FAILED verification -- see" >&2
  echo "  $D/verify_output/failed_w*.jsonl" >&2
  echo "A failure here means either CaDiCaL's original UNSAT verdict (from stage" >&2
  echo "06/07/08's or stage 03's full_resolve_worker.js run) or drat-trim's proof" >&2
  echo "check disagrees with what was originally recorded -- this is a real" >&2
  echo "discrepancy to investigate, not something to skip past." >&2
  exit 2
fi

if [ "$VERIFIED" -ne "$TOTAL_RECORDS" ]; then
  echo "ERROR: verified (${VERIFIED}) + failed (${FAILED}) != total records (${TOTAL_RECORDS})." >&2
  echo "Some records produced neither a verified nor a failed result -- likely an" >&2
  echo "interrupted run; rerun this stage (it resumes via its own checkpoints)." >&2
  exit 2
fi

mkdir -p "$RESULTS/certificates"
cat > "$RESULTS/certificates/summary.json" <<EOF
{"totalRecords": ${TOTAL_RECORDS}, "verified": ${VERIFIED}, "failed": ${FAILED}}
EOF
# The archivable DRAT proofs themselves stay under working/ (large files,
# gitignored, same as every other stage's intermediate output) rather than
# results/ (kept compact elsewhere in this pipeline) -- see
# $D/verify_output/proofs/w<id>/proof_<line>.drat. Curating which subset of
# these actually goes into the paper's reproducibility appendix is a
# separate, later decision (see TODO.md).

mark_done "09_verify_sat_certificates"
echo "[09_verify_sat_certificates] done -- ${VERIFIED} certificates verified, proofs archived under $D/verify_output/proofs/"
