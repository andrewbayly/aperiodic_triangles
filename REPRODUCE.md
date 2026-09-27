# Reproducing the n≤3 minimality result

This reproduces the full computational claim behind the paper's
minimality half: every n=1, n=2, and n=3 edge-matching triangle tileset,
under every possible reflectable/chiral configuration, is either
periodic or a non-tiler. See `command_log.md`'s final MILESTONE section
and `results/SUMMARY.md` (once generated) for the numbers this produces.

## Project layout

```
<some-directory>/
  cadical/              -- third-party SAT solver, built once
  aperiodic_triangles/  -- this repo
    main.sh
    scripts/            -- numbered pipeline stages, see below
    *.js                -- pipeline code
    working/            -- large intermediate files (created at runtime)
    results/            -- final, compact outputs (created at runtime)
```

`working/` and `results/` are created by the pipeline itself and should
be gitignored -- `working/` in particular gets large (see "Disk space"
below).

## Initial setup

```sh
mkdir aperiodicity-reproduction && cd aperiodicity-reproduction

git clone https://github.com/arminbiere/cadical.git
# Pin a commit for reproducibility rather than tracking a moving branch tip:
( cd cadical && git checkout <commit-sha-used-in-the-paper> )

git clone <aperiodic_triangles-repo-url>
cd aperiodic_triangles
npm install
```

**Determine `--workers` before running anything.** This is the one
genuinely manual step, and it matters: on hybrid-core machines (Apple
Silicon, recent Intel P/E-core chips), the OS-reported logical core count
includes efficiency cores, and oversubscribing them measurably *reduces*
total throughput on this workload rather than increasing it. Use your
machine's performance-core count instead:

```sh
# macOS
sysctl -n hw.perflevel0.physicalcpu   # use this
sysctl -n hw.ncpu                     # NOT this -- includes efficiency cores

# Linux -- check for a P-core/E-core split before trusting nproc;
# on a uniform-core machine nproc is fine.
```

If in doubt, benchmark: try a couple of `--workers` values for a few
minutes on the n=2 stage and take whichever gives the highest throughput.
`main.sh` refuses to guess this for you on purpose (see
`scripts/_common.sh`).

## Running it

```sh
# From scratch:
sh ./main.sh --workers <N> --fresh

# Resuming after an interruption (crash, reboot, Ctrl-C):
sh ./main.sh --workers <N>
```

Every stage is independently idempotent: a stage that already finished
(marker file present under `working/.markers/`) is skipped instantly, and
a stage interrupted partway resumes from its own tool's per-worker
checkpoint rather than restarting the whole stage. So resuming is always
just re-running the same command -- there's no special "resume mode" to
remember, `--fresh` is the only thing that changes what happens.

If you'd rather run one stage at a time (to inspect intermediate output,
or because you're only interested in one piece), the numbered scripts
under `scripts/` are meant to be run directly and in order -- `main.sh` is
nothing more than a loop over them:

```sh
sh scripts/00_build_cadical.sh
WORKERS=8 sh scripts/01_classify_n1.sh
WORKERS=8 sh scripts/02_classify_n2.sh
# ...and so on through scripts/10_summarize_results.sh
```

(Stages that need `--workers` read it from the `WORKERS` environment
variable when run this way, rather than a flag, since `main.sh` exports
it for them; set it yourself if running a script standalone.)

## What each stage does, and how long it takes

Timings are from the original run, 8 performance cores on an Apple
Silicon Mac. Your numbers will scale with core count and clock speed.

| Stage | What | Time |
|---|---|---|
| 00 | Build CaDiCaL | ~1 min |
| 01 | n=1, both patterns | <1 min |
| 02 | n=2, all 3 patterns | ~36 min |
| 03 | n=3, all-reflectable pattern | ~24h (dominated by the initial full sweep) |
| 04 | Gather all-reflectable periodic parents | minutes |
| 05 | Generate chiral/mixed variants from those parents | ~66 min |
| 06 | Resolve bucket 0 (all-chiral) | ~1h |
| 07 | Resolve bucket 1 (1 reflectable tile) | ~5h52m |
| 08 | Resolve bucket 2 (2 reflectable tiles) | ~14h27m |
| 09 | *(not yet implemented)* DRAT certificate batch verification | — |
| 10 | Write `results/SUMMARY.md` | seconds |

Total is multi-day, dominated by stages 03, 07, and 08. `main.sh` doesn't
parallelize *across* stages (04 needs 03's output, etc.), only within
each stage via `--workers`.

Stage 09 is deliberately excluded from `main.sh`'s default run (see
`scripts/09_verify_sat_certificates.sh` -- it's a placeholder for work
tracked in `TODO.md`, not a broken step). The classification result
itself is already complete and correct after stage 08; stage 09 will add
archivable DRAT proofs for the paper's reproducibility appendix once
built.

## Disk space

`working/` holds every raw intermediate JSONL file, including the ~176M
raw n=3 chiral/mixed tilesets across buckets 0-2. Budget on the order of
several hundred GB free before starting a from-scratch run; `results/`
by contrast stays small (summaries and the ~1,191-orbit n=3
all-reflectable residual, not the bulk periodic/non-tiler files). Once
you've confirmed `results/SUMMARY.md` matches what you expect, `working/`
can be deleted to reclaim space -- nothing later in the pipeline reads
from a stage's `working/` output once that stage's own results have been
copied into `results/`.

## Verifying the result

`results/SUMMARY.md` (written by stage 10) is the top-line table. Every
resolver stage also refuses to report success if any shape came back
unresolved (`expand_orbit_results.js` and `scripts/_resolve_bucket.sh`
both exit nonzero in that case) -- so if `main.sh` completes without
error, `unresolved` is 0 everywhere by construction, not just by the
summary saying so.
