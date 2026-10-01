# DESIGN.md — Design Document

This document exists to orient a reader — first and foremost the author,
secondarily anyone reviewing the code for the paper — before they dive into
the source. It walks from the mathematical problem, through the
architecture and the key design decisions that shape the code, down to a
complete list of every module in the repository with a short description
of what it does. It is deliberately not a tutorial on how to run the
pipeline (`README.md` covers that) and not a running log of what happened
session-by-session (`TODO.md` and `command_log.md` cover that). Where this
document and those disagree on a detail, `README.md`/`TODO.md` are more
current — this document should be kept in sync with them but may lag.

## Table of contents

1. [Problem statement](#1-problem-statement)
2. [The mathematical model](#2-the-mathematical-model)
3. [Architecture overview](#3-architecture-overview)
4. [Key design decisions](#4-key-design-decisions)
5. [The pipeline, stage by stage](#5-the-pipeline-stage-by-stage)
6. [Data formats](#6-data-formats)
7. [Module list](#7-module-list)
8. [Exploratory / non-production tools](#8-exploratory--non-production-tools)
9. [Known limitations and open items](#9-known-limitations-and-open-items)

## 1. Problem statement

An **edge-matching triangle tileset** is a small set of `n` triangular
prototiles, each edge carrying a label, such that triangles can be placed
edge-to-edge on a triangular lattice only where adjacent edges' labels are
compatible ("match"). Each prototile is independently either
**reflectable** (it and its mirror image are both allowed placements) or
**chiral** (only its unreflected rotations are allowed).

For a given tileset, exactly one of three things is true:

- **Periodic**: some finite patch of the tileset's triangles, repeated via
  two independent period vectors, tiles the entire plane. This is provable
  by exhibiting one explicit fundamental domain and period pair — a
  periodic witness is self-certifying.
- **Non-tiler**: no placement of the tileset's triangles can tile the
  plane at all, not even a single finite patch of some size. This needs a
  genuine proof of non-existence, not just "we didn't find one" — see
  [§4](#4-key-design-decisions) for how this repo proves it unconditionally.
- **Aperiodic** (or, before it is fully resolved, an **aperiodic-candidate**):
  the tileset *can* tile the plane, but only non-periodically. This is the
  hardest of the three to establish and is not something this repo's
  automated checks can prove on their own — see the note in
  [§4](#4-key-design-decisions).

The paper this repo supports makes a **minimality claim**: for every
`n ≤ 3` and every reflectable/chiral configuration, every edge-matching
triangle tileset is either periodic or a non-tiler — i.e. **no genuinely
aperiodic tileset exists with 3 or fewer prototiles.** Combined with an
existing n=4 all-reflectable aperiodic witness (established separately,
not by this codebase), this makes n=4 the smallest possible prototile
count for a genuinely aperiodic edge-matching triangle tileset.

This repository's job is to make that `n ≤ 3` claim **computationally
exhaustive and independently verifiable**: classify every single tileset
(up to symmetry) for n=1, n=2, and n=3, under every reflectable/chiral
configuration, and reduce the "0 aperiodic candidates remain" conclusion
to a reproducible command plus a set of archivable proof certificates,
rather than to a one-off exploratory script run once and not revisited.

## 2. The mathematical model

Triangles sit on the standard triangular lattice, alternating "up" and
"down" orientation, each with 3 edges. An edge's label packs four
independent fields (see `lattice.js`, `alphabet.js`):

- **class** (A/B/C/D) — bundles two independent choices: whether the edge
  is **self-matching** (B/D, pairing fixed to "r" — it matches another
  edge of the same type directly) or **directionally paired** (A/C,
  pairing is p or q and must be matched against the opposite value); and
  whether its partnership is drawn from the two-slot domain {a,b} (A/B) or
  the single-slot domain {c} (C/D).
- **flavor** — an arbitrary integer tag, canonicalized jointly across all
  tiles (two edges of different flavors can never match),
- **partnership** (a/b/c) — which partner position within a class+flavor
  this edge occupies (two-way for classes A/B, fixed for classes C/D),
- **pairing** (p/q/r) — whether this edge is one half of a p/q matching
  pair, or self-matching (r).

Two edges match iff same class, same flavor, same partnership, and
pairing p against pairing q (or both r). A tile can be placed in any of 6
orientations (3 rotations × reflected-or-not), but a **chiral** tile is
restricted to its 3 unreflected rotations only.

Two further exact symmetries of the classification (beyond the obvious
rotation/tile-permutation/flavor-renumbering group) were found and proven
during this project and are load-bearing for correct deduplication (see
`canonical_full.js`):

- **σ-flip**: swapping the a/b partnership labels within one flavor class,
  across all tiles simultaneously.
- **ρ-flip**: swapping the p/q pairing labels within one (class, flavor)
  pair, across all tiles simultaneously.

Both commute with every placement and preserve the matching relation
exactly, so two tilesets related by either flip are the *same* tileset for
classification purposes — missing either one means over-counting (treating
true duplicates as distinct) rather than under-counting.

## 3. Architecture overview

The codebase has two architecturally distinct halves that are joined by a
file-based hand-off (JSONL on disk), not by any in-process coupling:

**Phase A — fixed-lattice enumeration and classification** (`main.js` /
`worker.js`, driving `classify.js`). For a given `n` and reflectable
pattern, directly constructs (not enumerate-then-filter) one canonical
representative per true orbit under the enumeration symmetry group
("orderly generation", `canonicalize_subtype.js` + `orderly.js`), then
classifies each one via `classify.js`'s cascade (duplicate-tile →
unmatchable-edge → conservation-law LP → axis-aligned patch battery →
axis-aligned torus battery). This is cheap enough to brute-force at full
scale for n=1 and n=2 (run separately for *every* reflectable/chiral
pattern — both n=1 patterns in stage 01, all three n=2 patterns in stage
02) and resolves the overwhelming majority of tilesets outright, leaving
only a small residual of "aperiodic-candidate" shapes that need deeper,
more expensive treatment.

For n=3, Phase A is run only for the **all-reflectable** pattern (stage
03) — a full orderly-generation sweep of n=3's chiral/mixed patterns was
never attempted, since it's both intractable at that scale and
unnecessary: two theorems (see [§4](#4-key-design-decisions)) establish
that every n=3 chiral/mixed tileset can instead be *generated* from an
already-classified all-reflectable periodic parent rather than enumerated
from scratch. So n=3's chiral/mixed patterns never go through Phase A at
all — they're produced by `chiral_variants_multicore.js` and fed directly
into Phase B.

**Phase B — deep resolution of survivors** (`full_resolve_multicore.js` /
`full_resolve_worker.js`, plus `chiral_variants_multicore.js` for
generating the chiral/mixed-chirality variants of n=3's all-reflectable
periodic parents). Takes whatever Phase A could not resolve — either
genuine aperiodic-candidates, or (for n=3's chiral/mixed patterns) tilesets
generated from scratch by applying chirality variants to already-resolved
all-reflectable parents — and pushes each one through 4 progressively more
powerful (and more expensive) techniques: the same fast `classify()` first
(cheap re-check), then a **sheared-lattice** sweep (periods not aligned to
the axes, `sheared_solver.js`), then a **vertex-star** combinatorial filter
(`vertex_star_check.js`), then **SAT-based patch-infeasibility** proof via
an external SAT solver (`js_sat_bridge.js` driving CaDiCaL). Every one of
the ~176M n=3 chiral/mixed tilesets and the entire all-reflectable residual
passes through this cascade; as of the latest full run, **zero** remain
unresolved.

A third piece sits alongside these two phases rather than inside them:
**certificate generation and verification** (stage 09,
`gather_sat_certificates.js` → `verify_sat_certificates_multicore.js` /
`_worker.js`, using `js_sat_bridge.js`'s DRAT support). This re-derives an
independently checkable DRAT proof for every SAT-patch-infeasibility
non-tiler verdict and verifies it with a second, independent tool
(`drat-trim`), so the paper's non-tiler claims are backed by archivable,
machine-checkable proof objects rather than "trust our solver's exit
code." It deliberately runs *after* classification is already complete and
correct (reading finished output, not participating in classification) so
it can be skipped, re-run, or extended without touching the actual
classification result.

All three pieces are glued together by an idempotent shell pipeline
(`main.sh` + `scripts/00`-`10_*.sh`, see [§5](#5-the-pipeline-stage-by-stage)) rather
than a single monolithic program, because a multi-day computation needs to
survive crashes, reboots, and incremental code fixes without restarting
from scratch — see [§4](#4-key-design-decisions) for why that mattered in
practice.

```
                         ┌─────────────────────────────────────┐
                         │  Phase A: main.js / worker.js        │
                         │  orderly generation -> classify()    │
                         │  (n=1, n=2, n=3-all-reflectable)     │
                         └───────────────┬───────────────────────┘
                                          │ periodic / non-tiler / candidate
                      ┌───────────────────┼────────────────────────┐
                      │                   │                        │
            (n=1, n=2: done)   all-reflectable periodic     aperiodic-candidates
                                 parents (n=3)                (n=3 residual)
                                      │                             │
                                      ▼                             │
                     chiral_variants_multicore.js                   │
                     (7 nonempty chirality subsets                  │
                      per parent, bucketed 0/1/2)                   │
                                      │                             │
                                      ▼                             ▼
                     ┌─────────────────────────────────────────────────┐
                     │  Phase B: full_resolve_multicore.js /            │
                     │  full_resolve_worker.js                          │
                     │  classify -> sheared-lattice -> vertex-star ->   │
                     │  SAT patch-infeasibility                         │
                     └───────────────────┬───────────────────────────────┘
                                          │ periodic / non-tiler (0 unresolved)
                                          ▼
                     ┌─────────────────────────────────────────────────┐
                     │  Stage 09: non-tiler certificates                │
                     │  gather_sat_certificates.js ->                   │
                     │  verify_sat_certificates_multicore.js            │
                     │  (DRAT proof via CaDiCaL, checked by drat-trim)  │
                     └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌─────────────────────────────────────────────────┐
                     │  Stage 10: periodic certificates                 │
                     │  export_periodic_certificates.js ->              │
                     │  verify_periodic_certificates_multicore.js       │
                     │  (independent, no-shared-code re-verification;   │
                     │   no external solver -- substitution only)       │
                     └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                       results/SUMMARY.md (stage 11)
```

## 4. Key design decisions

This section records *why* the code is shaped the way it is — the
decisions that would not be obvious from reading any one file in
isolation.

**Orderly generation instead of enumerate-then-dedupe.** Directly
constructing one canonical representative per orbit (`canonicalize_subtype.js`
+ `orderly.js`) rather than generating every raw labeling and filtering
duplicates is the difference between a tractable n=3 enumeration (hours)
and an intractable one (estimated ~57 days). This was validated by an
exact bijection test against slow brute-force enumeration for n=1 and n=2
before being trusted at n=3 scale.

**Two canonicalization groups, used at different stages.** `orderly.js`'s
enumeration group (rotation × tile-permutation × flavor-renumbering) is
what makes Phase A's enumeration tractable. `canonical_full.js` additionally
quotients by σ-flip and ρ-flip (§2) and is used wherever deduplication
*must* be exactly correct for a downstream count to be trusted — chiral
variant generation (`chiral_variants_worker.js`) in particular. These two
groups are not interchangeable: using only the smaller group anywhere σ/ρ
symmetry actually matters silently over-counts orbits.

**Patch and torus infeasibility are *unconditional* proofs, not
heuristics.** `classify.js`'s patch battery (open-boundary regions, sizes
3×3 up to 8×8) and torus battery (periodic wraparound regions, up to 6×6)
are not a probabilistic search — infeasibility at *any one* patch size is
an unconditional proof of non-existence (a larger open patch is strictly
more constrained than a smaller one, so feasibility doesn't transfer
upward), and feasibility at any one torus size is an unconditional proof
that a periodic tiling exists (a torus solution repeats to tile the whole
plane). This is why `classify.js` can report `non-tiler` or `periodic`
definitively rather than "probably." What survives *neither* battery is
not proven aperiodic — it's simply unresolved by the fixed-size batteries
checked, which is exactly the "aperiodic-candidate" bucket Phase B exists
to shrink to zero.

**The sheared-lattice sweep exists because axis-aligned tori are not
enough.** `classify.js`'s torus battery only checks lattices generated by
`(a,0),(0,b)` — axis-aligned. A tileset can be periodic only on a genuinely
sheared lattice (e.g. generators `(13,0),(7,1)`) that no axis-aligned
check at any size would ever find. `sheared_solver.js` generalizes the
torus search to arbitrary full-rank sublattices of Z² (via Hermite Normal
Form), symmetry-reduced to one representative per rotation/mirror orbit so
the sweep doesn't redundantly re-check lattices related by an obvious
symmetry. In practice this sheared sweep resolved a meaningful fraction
(roughly a third) of what the axis-aligned battery alone left as
candidates.

**Vertex-star and SAT-patch are last resorts, in that cost order.** After
classify() and the sheared sweep, `vertex_star_check.js`'s combinatorial
filter is tried before the much more expensive SAT-based patch-infeasibility
check (`js_sat_bridge.js` + CaDiCaL), specifically because it is far
cheaper and resolves a useful fraction of what's left on its own. SAT
patch-infeasibility is the heaviest technique in the cascade and the one
whose soundness depends on an external binary, which is exactly why it
alone gets independent DRAT proof generation and verification (stage 09)
rather than being trusted on its raw exit code.

**Checkpointed, crash-safe, idempotent everything.** A full n=3 run spans
multiple days. Every long-running worker (`main.js`/`worker.js`,
`full_resolve_worker.js`, `verify_sat_certificates_worker.js`, etc.)
checkpoints its progress with a **synchronous** flush of output data
*before* the checkpoint write, specifically so a crash, kill, or power
loss can never silently lose already-completed results or leave a
checkpoint pointing past data that was never actually written. Every
shell pipeline stage is independently idempotent via marker files under
`working/.markers/` (`scripts/_common.sh`'s `skip_if_done`/`mark_done`),
so re-running `main.sh` after an interruption — or after a code fix that
only needs one stage re-run — is always just "run the same command again,"
never a special resume procedure to remember. The cost of this discipline
is real (it was not free to build and has caught real bugs, see
`TODO.md`'s "bugs found" sections), but the alternative — losing a
multi-day computation to a crash near the end, or silently resuming past
corrupted state — was judged worse.

**A worker-thread's striding is deliberately non-contiguous.**
`worker.js` owns `code mod numWorkers`, not a contiguous slice of the
subtype-code space, because canonical-pattern density varies enormously
(empirically, some contiguous regions are ~1000× denser than others) —
contiguous sharding would badly load-imbalance the workers. Striding was
measured to balance load within under 1% across workers.

**Why the n=3 residual is resolved directly, not via orbit-dedup
("Option B").** An earlier design deduplicated the n=3 all-reflectable
residual under `canonical_full.js` before resolving (one `full_resolve_multicore.js`
pass per orbit representative, then `expand_orbit_results.js` to project
verdicts back onto every raw member of the orbit). This was replaced
because the expansion step was found to silently discard each orbit's
actual resolved periodicity certificate (fundamental domain + period
vectors) when re-emitting raw members, re-writing each raw tileset's
*original pre-dedup* record instead. The fix resolves every one of the
17,524 raw residual candidates directly and independently through the
same 4-stage cascade used everywhere else in Phase B, at the cost of more
machine time but without relying on an unverified assumption that
canonical equivalence provably preserves periodic/non-tiler status end to
end. See `TODO.md`'s "Fresh re-run" and "Bugs found during the fresh run"
sections for the concrete numeric discrepancy this surfaced and the
reasoning for treating the new numbers as authoritative.

**Certificates are scoped to what each kind of claim actually needs, not
applied uniformly.** Only SAT-patch-infeasibility non-tiler verdicts get an
archived DRAT proof (stage 09). Vertex-star non-tiler verdicts keep their
existing combinatorial argument rather than being re-derived through SAT
purely for presentational uniformity — two independently-implemented
methods already agreeing is treated as corroborating evidence, not a gap
to paper over. Periodic verdicts need no DRAT proof at all, since a
periodic tiling is a self-certifying witness (directly checkable by
substituting the fundamental domain and period vectors and confirming
every edge matches) — but "no DRAT proof needed" doesn't mean "no
independent check needed": stage 10 re-verifies every one of the ~91.17M
periodic records with `independent_periodic_verifier.js`, a from-scratch
reimplementation sharing no code with `lattice.js`/`sheared_solver.js`, so
a bug shared between the solver that produced the witness and whatever
checks it can't hide from it. Decided against archiving a curated
subset of periodic examples for the paper's appendix — at 91 million
records, a handful of examples can't carry a completeness claim, so (same
treatment as stage 09's DRAT proofs) the full readable export lives under
`working/` and the paper-facing artifact is the aggregate "N of N
independently verified" count in `SUMMARY.md`.

**A note on what is *not* proven.** Nothing in this pipeline proves a
tileset is genuinely aperiodic. "Aperiodic-candidate" means only that no
periodic tiling was found within the (large but finite) search performed,
and no non-existence check available managed to refute it either. A
genuine aperiodicity proof needs a structural argument specific to the
tileset, outside the scope of this automated classification. For this
project's actual minimality claim, that distinction doesn't matter: the
claim is that every n≤3 tileset is periodic *or* a non-tiler (i.e. the
aperiodic-candidate bucket is empty), which this pipeline does fully
establish by exhaustively driving that bucket to zero rather than by
positively characterizing what "aperiodic" would require.

## 5. The pipeline, stage by stage

`main.sh --workers N [--fresh] [--from NN]` runs `scripts/00_*.sh` through
`scripts/10_*.sh` in order; each is independently idempotent via
`working/.markers/<stage>.done`. See `README.md` for full usage
instructions, expected timings, and output-directory layout — this is a
one-line-per-stage map of what each one *is*, for orientation.

| Stage | Script | Purpose |
|---|---|---|
| 00 | `00_build_cadical.sh` | Build the CaDiCaL SAT solver from a sibling checkout. |
| 01 | `01_classify_n1.sh` | Phase A for n=1 (both reflectable patterns). |
| 02 | `02_classify_n2.sh` | Phase A for n=2 (all 3 reflectable-tile-count patterns). |
| 03 | `03_classify_n3_allreflectable.sh` | Phase A for n=3 all-reflectable, plus targeted torus recheck and direct Phase-B resolution of the residual. The most involved single stage (6 internal steps). |
| 04 | `04_gather_periodic_parents.sh` | Merge all sources of n=3 all-reflectable periodic parents into one file, ready for chirality-variant generation. |
| 05 | `05_generate_chiral_variants.sh` | Generate every chiral/mixed-chirality variant of those parents, bucketed by reflectable-tile-count (0/1/2). |
| 06–08 | `06_resolve_bucket0.sh` / `07_resolve_bucket1.sh` / `08_resolve_bucket2.sh` | Phase B resolution of buckets 0 (all-chiral), 1 (1 reflectable tile), 2 (2 reflectable tiles). The three largest stages by compute time. |
| 09 | `09_verify_sat_certificates.sh` | Gather every SAT-patch-infeasibility non-tiler verdict across buckets 0–2 and the n=3 residual; regenerate and verify a DRAT proof for each. |
| 10 | `10_verify_periodic_certificates.sh` | Export every periodic verdict (n=1, n=2, n=3 all four patterns) into readable notation and independently re-verify every one with a from-scratch, no-shared-code reimplementation of the matching/orientation rules. The periodic-side counterpart to stage 09; no external solver needed since a periodic witness is directly checkable by substitution. |
| 11 | `11_summarize_results.sh` | Assemble every earlier stage's `results/*/summary.json` into the final `results/SUMMARY.md`. Re-derives nothing; purely reads what earlier stages already wrote. |

## 6. Data formats

The pipeline communicates between stages almost entirely via JSONL (one
JSON object per line), sharded per-worker as `<name>_w<id>.jsonl` to avoid
write contention, concatenated with `cat` where a stage needs one merged
file. The two shapes that matter most:

**A tileset record** (input to most things): `{"tiles": [...packed edge
labels per tile...], "reflectableFlags": [bool, ...]}`, optionally with
`"n"`.

**A periodic verdict**, carrying a directly-verifiable witness:
```json
{"tiles": [...], "reflectableFlags": [...],
 "resolvedBy": "fast-classify" | "sheared-lattice",
 "patch": {"periodVectors": [[P,0],[s,Q]], "fundamentalDomainSize": {"P":P,"Q":Q},
           "domain": [{"a":0,"b":0,"slot":"up","tile":0,"orientation":0}, ...]}}
```
Repeating `domain` by the two period vectors tiles the plane; this is
checkable by direct substitution with no solver involved.

**A non-tiler verdict**, carrying its proof method:
```json
{"tiles": [...], "reflectableFlags": [...],
 "resolvedBy": "fast-classify" | "vertex-star" | "sat-patch",
 "radius": N}
```
`radius` (present for `sat-patch` verdicts) is the hexagonal patch radius
at which CaDiCaL found the encoding UNSAT; stage 09 uses it to
deterministically regenerate the exact same CNF for DRAT proof generation.

See `README.md`'s "Output format" section for the full field-level
detail of Phase A's `main.js` output files, which predates and is a
superset of the shapes above.

## 7. Module list

Every module in the repository, grouped by role. "Entry point" means it's
invoked directly (`node <file>.js ...` or as a worker thread target);
"library" means it's only ever `require()`d by other modules.

### 7.1 Core classification library

| Module | Role |
|---|---|
| `lattice.js` | Library. Foundational triangular-lattice geometry: label packing, the `rho`/`sigma` matching involutions, the `L(mu,g,j,slot)` edge-label formula for a tile in a given orientation at a given lattice cell, and up/down neighbor offsets. Required by nearly every other module. |
| `alphabet.js` | Library. Defines the 9 edge subtypes and a brute-force (non-orderly) canonical-labeling enumerator, kept mainly as independent ground truth for validation, plus a closed-form `canonicalCount(n)` formula. |
| `duplicate_tile_check.js` | Library. `hasDuplicateTile`: detects two tiles identical up to rotation, which makes a tileset provably reducible to an already-resolved smaller one. |
| `check_unmatchable.js` | Library. `hasUnmatchableEdge`: iterative pruning check — removes tiles with no matching edge among survivors until a fixed point; everything pruning away proves non-tileability. |
| `conservation_check.js` | Library. `checkConservationLaw`: a linear-programming check (via `javascript-lp-solver`) that p-paired and q-paired edge counts of each type must balance in any valid tiling; the only non-negative solution being trivial proves non-tileability. |
| `solver.js` | Library. The core backtracking constraint solver: `buildStates`/`buildAdjBitmasks` (compiles a tileset into bitmask-based state/adjacency tables) and `patchFeasible`/`torusFeasible` (MRV backtracking over open-boundary patches and axis-aligned wraparound tori). |
| `classify.js` | Library. The single-tileset classification cascade: duplicate-tile → unmatchable-edge → conservation-law → patch battery (3×3–8×8) → axis-aligned torus battery (up to 6×6) → `aperiodic-candidate`. |
| `vertex_star_check.js` | Library. `vertexStarPrune`: a necessary-condition filter modeling every lattice vertex as needing a closed 6-step walk in the matching-adjacency digraph; iteratively prunes unmatchable placements to a fixpoint. |
| `sheared_solver.js` | Library. Generalizes torus search to arbitrary (sheared) period lattices via Hermite Normal Form: lattice arithmetic, symmetry-orbit enumeration, `compileTileset`/`searchLattice` (MAC + MRV with a translation-symmetry cut), and an independent `verifyPeriodicSolution` sharing no code with the solver. |
| `canonicalize_subtype.js` | Library. Orderly-generation Level 1: canonicalizes subtype patterns (class+partnership+pairing, flavor stripped) under the full enumeration group. |
| `orderly.js` | Library/entry point. Orderly-generation Level 2: stabilizer computation and one-representative-per-orbit flavored-labeling enumeration for a given canonical subtype. `require.main` is a validation self-test (currently not runnable — see §9). |
| `canonical_full.js` | Library/entry point. Canonical form under the *full* symmetry group (enumeration group + σ-flip + ρ-flip), chirality-correct. CLI: `--dedupe <in.jsonl> <prefix>` writes orbit representatives + member-index mapping; `--test` self-checks. |
| `js_sat_bridge.js` | Library. Pure-JS bridge to an external CaDiCaL binary for hexagonal-patch SAT encoding (`buildCnf`, `writeDimacs`), solving (`runCadical`, with optional DRAT proof output), and DRAT verification (`verifyDrat`, wrapping `drat-trim`). |
| `independent_periodic_verifier.js` | Library. Stage 10's from-scratch re-verification of a periodic certificate: its own neighbor-offset table, orientation/presentation formula, and matching rule (parsing the certificate's readable notation directly), plus the unfold-across-several-periods-and-check-every-seam algorithm. Deliberately shares no code with `lattice.js` or `sheared_solver.js`. Self-test (`node independent_periodic_verifier.js`) includes a brute-force search for a genuine witness plus a battery of deliberately corrupted variants. |

### 7.2 Multicore orchestrators and their workers

| Modules | Role |
|---|---|
| `main.js` / `worker.js` | Phase A entry point. `main.js` spawns worker threads striding over the subtype-code space; `worker.js` canonicalizes, enumerates, and classifies, with synchronous-flush-then-checkpoint resumability, a lock file against concurrent instances, and SIGINT/SIGTERM handling. |
| `full_resolve_multicore.js` / `full_resolve_worker.js` | Phase B entry point — the main deep-resolve cascade (fast-classify → sheared-lattice → vertex-star → SAT patch-infeasibility) for n=3 chiral/mixed buckets and the all-reflectable residual. |
| `chiral_variants_multicore.js` / `chiral_variants_worker.js` | Generates all 7 nonempty chirality-subset variants of each all-reflectable periodic parent, canonicalizes and dedupes within each parent, buckets by resulting reflectable-tile-count. |
| `recheck_torus_unresolved_multicore.js` / `recheck_torus_unresolved_multicore_worker.js` | Targeted re-check of only each candidate's own previously-ambiguous torus sizes (not a uniform sweep), promoting genuinely periodic candidates. |
| `verify_sat_certificates_multicore.js` / `verify_sat_certificates_worker.js` | Stage 09's certificate pipeline: regenerates each SAT-patch-infeasibility record's exact CNF, requests a DRAT proof from CaDiCaL, verifies it with `drat-trim`. |
| `verify_periodic_certificates_multicore.js` / `verify_periodic_certificates_worker.js` | Stage 10's certificate pipeline: runs `independent_periodic_verifier.js` over every exported periodic certificate. No external binary dependency (pure JS substitution checking). |
| `sheared_torus_multicore.js` / `sheared_torus_multicore_worker.js` | Standalone multi-core sheared-lattice sweep over a candidate file (predecessor of the sheared-lattice stage now folded into `full_resolve_worker.js`; not wired into `main.sh`). |
| `deep_patch_push_multicore.js` / `deep_patch_push_multicore_worker.js` | Standalone parallel-by-(tileset,size) deep patch-infeasibility push for a small hard candidate set; tested, found low-leverage, not wired into `main.sh`. |
| `reprocess_candidates_multicore.js` / `reprocess_candidates_multicore_worker.js` | Standalone re-classification of an existing candidates file against the current `classify()`; found to be a provable no-op once duplicate-tile filtering moved upstream, not wired into `main.sh`. |

### 7.3 Data wrangling and glue

| Module | Role |
|---|---|
| `gather_periodic_parents.js` | Merges all sources of n=3 all-reflectable periodic parents into one clean input file for chirality-variant generation. |
| `gather_sat_certificates.js` | Scans buckets 0–2 and the residual for `resolvedBy: 'sat-patch'` non-tiler records, the only ones needing a DRAT certificate. |
| `export_periodic_certificates.js` | Gathers every periodic record across all n=1/n=2/n=3-pattern sources and expands packed tile labels into readable class+flavor+partnership+pairing notation for stage 10. Self-test (`--test`) cross-checks the decode against `lattice.js`'s own `getPt`/`getPr`. |
| `expand_orbit_results.js` | Expands a resolver's per-orbit verdicts back out to every raw member of the orbit via a `canonical_full.js --dedupe` orbit-membership file. (Historical — underlies the now-superseded "Option A" orbit-dedup residual path; see §4.) |
| `combine_n3_allreflectable_summary.js` | Combines the original full sweep, the targeted torus recheck, and the direct residual resolution into one true n=3 all-reflectable summary. |
| `compute_remaining_after_torus_recheck.js` | Computes the candidate set remaining after the targeted torus recheck (original input minus whatever got promoted to periodic). |
| `split_lines_roundrobin.js` | Generic streaming utility: splits a JSONL file into N round-robin chunk files. Used throughout via `scripts/_common.sh`'s `split_chunks`. |
| `sheared_results.js` | Library. Loads and merges per-worker sheared-sweep result files, keeping the best record per candidate. |
| `summarize_sheared.js` | Entry point. Reports and splits a completed sheared-sweep run against its original candidate input. |

### 7.4 Shell pipeline

| Script | Role |
|---|---|
| `main.sh` | Top-level driver: runs `scripts/00`–`10_*.sh` in order, each gated by an idempotency marker. |
| `scripts/_common.sh` | Sourced by every stage: working/results directory setup, `require_workers`/`require_cadical`/`require_drat_trim`, marker-file helpers, `split_chunks`. |
| `scripts/_resolve_bucket.sh` | Shared body for stages 06–08 (Phase B resolution of one chirality bucket). |
| `scripts/00_build_cadical.sh` – `scripts/10_summarize_results.sh` | The 11 numbered stages; see [§5](#5-the-pipeline-stage-by-stage). |

## 8. Exploratory / non-production tools

These remain in the repository as working, validated tools from earlier
investigation phases, but are **not** invoked by `main.sh`'s numbered
pipeline. A reviewer can generally skip these on a first pass; they're
listed so their presence doesn't read as dead or forgotten code.

- `sample_candidates.js` — random-sampling benchmark/dev helper.
- `find_stuck.js` — human-readable report of stuck sheared-sweep candidates.
- `decode_enumc_n2.js` — one-off decoder for an external C enumeration tool's output format (that tool is not part of this repo).
- `verify_hex_cp.js` — an independent, deliberately code-sharing-free second implementation of patch feasibility, used to cross-validate specific historical non-tiler verdicts.
- `test_sheared_solver.js` — validation suite for `sheared_solver.js`; currently **not runnable as-is** (depends on a `./sheared_torus.js` reference module that no longer exists in the repo — see §9).
- `export_remaining_range.js` / `export_unknowns.js` — bridge scripts producing input for an external `sat_resolve.py` consumer that is not part of this repo; handoff artifacts from an earlier investigation phase, superseded by the SAT stage now built into `full_resolve_worker.js`.
- `sheared_torus_multicore.js` / `_worker.js`, `deep_patch_push_multicore.js` / `_worker.js`, `reprocess_candidates_multicore.js` / `_worker.js` — see §7.2; each superseded by, or found lower-leverage than, what Phase B does today, but kept as standalone tools (they were each useful for a specific past investigation and may be again).

## 9. Known limitations and open items

- `orderly.js`'s and `test_sheared_solver.js`'s self-test blocks reference
  `canonicalize.js` and `sheared_torus.js` respectively, neither of which
  currently exists in the repository — these self-tests cannot be run
  as-is. (Likely superseded/removed during development; not blocking,
  since the functionality they validated is now covered by
  `canonical_full.js --test` and the production pipeline's own
  cross-checks, but worth fixing or removing the dead references.)
- The unexplained bucket 0/1/2 numeric discrepancy between the pre-fresh
  and fresh pipeline runs (documented in detail in `TODO.md`, "Bugs found
  during the fresh run") is a decided-and-documented open item, not a
  blocking one — see that entry for the full reasoning.
- Periodic certificate export and independent verification (stage 10) was
  built this session but has only been exercised against a real n=1 run
  (31/31 verified) and hand-built/brute-force synthetic cases, not yet
  against the full ~91.17M-record production scale — that's the next
  real run to watch once this lands. See `TODO.md`, "Certificate rigor."
- `chiral_variants_multicore_worker.js` lacks the internal checkpointing
  the rest of the pipeline's workers have — a lower-priority gap, noted
  in `README.md`/`TODO.md`.

For anything not covered here — exact historical figures, session-by-session
decisions, and the full paper trail behind each design choice — see
`TODO.md` and `command_log.md`.
