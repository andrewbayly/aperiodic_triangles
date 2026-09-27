#!/bin/sh
# Shared helpers, sourced (not executed) by every numbered stage script.
# Assumes the caller has already `cd`ed to the aperiodic_triangles repo root.
set -e

REPO_ROOT="$(pwd)"
WORK="$REPO_ROOT/working"
RESULTS="$REPO_ROOT/results"
MARKERS="$WORK/.markers"
CADICAL_BIN="$REPO_ROOT/../cadical/build/cadical"

mkdir -p "$WORK" "$RESULTS" "$MARKERS"

# --- worker count -----------------------------------------------------
# Deliberately NOT auto-detected. os.cpus().length / nproc count every
# logical core, including efficiency cores on Apple Silicon (and similar
# hybrid designs elsewhere). Oversubscribing efficiency cores measurably
# *reduces* aggregate throughput on this workload (see README's
# "Choosing --workers" section) so a wrong automatic guess is worse than
# asking. main.sh requires --workers and refuses to guess.
require_workers() {
  if [ -z "$WORKERS" ]; then
    echo "ERROR: --workers not set." >&2
    echo "" >&2
    echo "Use your machine's PERFORMANCE core count, not its total logical" >&2
    echo "core count -- these differ substantially on hybrid CPUs (e.g." >&2
    echo "Apple Silicon), and including efficiency cores can make total" >&2
    echo "throughput WORSE, not better. See README.md, 'Choosing --workers'." >&2
    echo "" >&2
    echo "  macOS:  sysctl -n hw.perflevel0.physicalcpu" >&2
    echo "  Linux:  check for a P-core/E-core split before trusting nproc;" >&2
    echo "          on a uniform-core machine nproc is fine." >&2
    echo "" >&2
    echo "If in doubt, benchmark a few values on the n=2 stage (minutes," >&2
    echo "not hours) and pick whichever gives the highest aggregate rate." >&2
    exit 1
  fi
}

# --- idempotency markers -----------------------------------------------
# A stage is "done" only once its marker file exists. main.sh re-running
# after a crash/interruption re-invokes every stage; each one either
# no-ops instantly (marker present) or resumes the underlying tool, which
# has its own per-worker checkpoint files under $WORK/<stage>/ that let it
# pick up mid-file rather than restart from record 0.
stage_done() { [ -f "$MARKERS/$1.done" ]; }
mark_done() { echo "$(date -u +%FT%TZ)" > "$MARKERS/$1.done"; }
skip_if_done() {
  if stage_done "$1"; then
    echo "[$1] already complete (see $MARKERS/$1.done) -- skipping."
    exit 0
  fi
  echo "[$1] starting..."
}

require_cadical() {
  if [ ! -x "$CADICAL_BIN" ]; then
    echo "ERROR: CaDiCaL binary not found at $CADICAL_BIN" >&2
    echo "Run scripts/00_build_cadical.sh first." >&2
    exit 1
  fi
}

# Splits a big JSONL file into $WORKERS round-robin chunks next to it,
# skipping the split if the chunk files already exist (cheap resumability
# for the split step itself, which has no internal checkpointing).
split_chunks() {
  in_file="$1"; prefix="$2"
  last_chunk="${prefix}_$((WORKERS - 1)).jsonl"
  if [ -f "$last_chunk" ]; then
    echo "  chunks already exist at ${prefix}_*.jsonl -- skipping split"
  else
    node "$REPO_ROOT/split_lines_roundrobin.js" "$in_file" "$WORKERS" "$prefix"
  fi
}
