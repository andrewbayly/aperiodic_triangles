#!/bin/sh
# Export every periodic verdict (n=1, n=2, n=3 all four patterns) into a
# human-readable certificate (packed labels expanded to the existing
# class+flavor+partnership+pairing notation, e.g. "A0ap") and independently
# re-verify every single one with independent_periodic_verifier.js -- a
# from-scratch reimplementation sharing no code with lattice.js/
# sheared_solver.js/classify.js (see TODO.md, "Certificate rigor" for why
# this needs to be genuinely independent, not just a second call into the
# same code path). Unlike stage 09, there's no external SAT solver or DRAT
# proof involved: a periodic witness is its own proof, directly checkable
# by substitution, so this stage is pure JS and comparatively cheap per
# record even at tens of millions of records.
#
# Scoped 2026-10-01: every periodic record gets independently verified (not
# a curated subset -- at this scale a handful of examples can't carry a
# completeness claim). The full readable export stays under working/
# (gitignored, same treatment as stage 09's DRAT proofs); the number that
# actually matters for the paper is the aggregate count below, surfaced in
# results/SUMMARY.md by stage 11.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh
require_workers

skip_if_done "10_verify_periodic_certificates"
D="$WORK/10_periodic_certificates"
mkdir -p "$D"
cd "$D"

# --- 1. export every periodic record across all sources to readable notation
if [ ! -f .step1_done ]; then
  node "$REPO_ROOT/export_periodic_certificates.js" periodic_certificates.jsonl "$WORK"
  touch .step1_done
fi

TOTAL_RECORDS=$(wc -l < periodic_certificates.jsonl 2>/dev/null || echo 0)
if [ "$TOTAL_RECORDS" -eq 0 ]; then
  echo "[10_verify_periodic_certificates] 0 periodic records found -- nothing to verify."
  mkdir -p "$RESULTS/periodic_certificates"
  echo '{"totalRecords": 0, "verified": 0, "failed": 0}' > "$RESULTS/periodic_certificates/summary.json"
  mark_done "10_verify_periodic_certificates"
  exit 0
fi
echo "[10_verify_periodic_certificates] $TOTAL_RECORDS periodic certificates to verify"

# --- 2. independently re-verify every one ------------------------------
if [ ! -f .step2_done ]; then
  split_chunks periodic_certificates.jsonl chunks/certs
  node "$REPO_ROOT/verify_periodic_certificates_multicore.js" \
    --chunk-prefix chunks/certs --workers "$WORKERS" --output verify_output
  touch .step2_done
fi

# --- 3. verify 0 failures (same pattern as stage 09) --------------------
VERIFIED=$(cat verify_output/verified_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
FAILED=$(cat verify_output/failed_w*.jsonl 2>/dev/null | wc -l | tr -d ' ')
echo "[10_verify_periodic_certificates] verified=${VERIFIED} failed=${FAILED} (of ${TOTAL_RECORDS} total)"

if [ "$FAILED" -gt 0 ]; then
  echo "ERROR: ${FAILED} periodic certificates FAILED independent verification -- see" >&2
  echo "  $D/verify_output/failed_w*.jsonl" >&2
  echo "A failure here means the exported witness does not actually tile the" >&2
  echo "plane when repeated by its own period vectors -- a real discrepancy" >&2
  echo "between what the solver claimed and what substitution shows, not" >&2
  echo "something to skip past." >&2
  exit 2
fi

if [ "$VERIFIED" -ne "$TOTAL_RECORDS" ]; then
  echo "ERROR: verified (${VERIFIED}) + failed (${FAILED}) != total records (${TOTAL_RECORDS})." >&2
  echo "Some records produced neither a verified nor a failed result -- likely an" >&2
  echo "interrupted run; rerun this stage (it resumes via its own checkpoints)." >&2
  exit 2
fi

mkdir -p "$RESULTS/periodic_certificates"
cat > "$RESULTS/periodic_certificates/summary.json" <<EOF
{"totalRecords": ${TOTAL_RECORDS}, "verified": ${VERIFIED}, "failed": ${FAILED}}
EOF
# The full readable export stays under working/ (large, gitignored), same
# as stage 09's DRAT proofs -- see $D/periodic_certificates.jsonl. Curating
# any subset for the paper's own exposition is a separate, later decision.

mark_done "10_verify_periodic_certificates"
echo "[10_verify_periodic_certificates] done -- ${VERIFIED} certificates independently verified, export at $D/periodic_certificates.jsonl"
