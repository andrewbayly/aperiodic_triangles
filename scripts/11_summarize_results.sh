#!/bin/sh
# Pull together the final n<=3 minimality table from every stage's
# summary file and write it to results/SUMMARY.md. Does not re-derive any
# numbers -- just reads what stages 01-10 already wrote into $RESULTS.
set -e
cd "$(dirname "$0")/.."
. ./scripts/_common.sh

skip_if_done "11_summarize_results"

get() { node -e "try{const j=JSON.parse(require('fs').readFileSync('$1','utf8'));console.log(j['$2']??'?')}catch(e){console.log('?')}"; }

N1="$RESULTS/n1/summary.json"
N2="$RESULTS/n2/summary.json"
N3_ALLREFL="$RESULTS/n3_allreflectable/summary.json"
B0="$RESULTS/n3_bucket0/summary.json"
B1="$RESULTS/n3_bucket1/summary.json"
B2="$RESULTS/n3_bucket2/summary.json"
CERTS="$RESULTS/certificates/summary.json"
PERIODIC_CERTS="$RESULTS/periodic_certificates/summary.json"

{
  echo "# Minimality classification: final results"
  echo
  echo "Generated $(date -u +%FT%TZ) by scripts/11_summarize_results.sh."
  echo "Every row below is read from this run's own output files -- nothing"
  echo "here is a hardcoded historical number."
  echo
  echo "| n | Reflectable pattern | Periodic | Non-tiler | Unresolved |"
  echo "|---|---|---|---|---|"
  if [ -f "$N1" ]; then
    P=$(get "$N1" periodic); NT=$(get "$N1" nonTiler); U=$(get "$N1" unresolved)
    echo "| 1 | from \`main.js --n 1\` | $P | $NT | $U |"
  fi
  if [ -f "$N2" ]; then
    P=$(get "$N2" periodic); NT=$(get "$N2" nonTiler); U=$(get "$N2" unresolved)
    echo "| 2 | from \`main.js --n 2\` | $P | $NT | $U |"
  fi
  if [ -f "$N3_ALLREFL" ]; then
    P=$(get "$N3_ALLREFL" periodic); NT=$(get "$N3_ALLREFL" nonTiler); U=$(get "$N3_ALLREFL" unresolved)
    echo "| 3 | all-reflectable (3/3) | $P | $NT | $U |"
  fi
  for b in 0 1 2; do
    f=$(eval echo \$B$b)
    if [ -f "$f" ]; then
      P=$(get "$f" periodic); NT=$(get "$f" nonTiler); U=$(get "$f" unresolved)
      echo "| 3 | $b/3 reflectable | $P | $NT | $U |"
    fi
  done
  echo
  echo "0 unresolved anywhere means: every n<=3 tileset, under every possible"
  echo "reflectable/chiral configuration, is either periodic or a non-tiler."
  echo "Combined with the n=4 all-reflectable aperiodic witness, this"
  echo "establishes n=4 as the smallest possible genuinely aperiodic"
  echo "edge-matching triangle tileset."
  if [ -f "$CERTS" ]; then
    echo
    TR=$(get "$CERTS" totalRecords); V=$(get "$CERTS" verified); F=$(get "$CERTS" failed)
    echo "### SAT patch-infeasibility certificates (stage 09)"
    echo
    echo "$V of $TR SAT-patch-infeasibility non-tiler verdicts independently"
    echo "verified via a DRAT proof checked with drat-trim ($F failed)."
    echo "Vertex-star non-tilers and all periodic verdicts need no DRAT proof"
    echo "(see TODO.md, \"Certificate rigor\"); proof files are archived under"
    echo "\`working/09_certificates/verify_output/proofs/\`."
  fi
  if [ -f "$PERIODIC_CERTS" ]; then
    echo
    TR=$(get "$PERIODIC_CERTS" totalRecords); V=$(get "$PERIODIC_CERTS" verified); F=$(get "$PERIODIC_CERTS" failed)
    echo "### Periodic certificates (stage 10)"
    echo
    echo "$V of $TR periodic verdicts independently re-verified by substitution"
    echo "(no DRAT needed -- the fundamental domain + period vectors are the"
    echo "proof) using a from-scratch reimplementation sharing no code with"
    echo "this pipeline's own lattice/matching logic ($F failed). Readable"
    echo "export archived under"
    echo "\`working/10_periodic_certificates/periodic_certificates.jsonl\`."
  fi
} > "$RESULTS/SUMMARY.md"

mark_done "11_summarize_results"
cat "$RESULTS/SUMMARY.md"
echo
echo "[11_summarize_results] done -- $RESULTS/SUMMARY.md"
