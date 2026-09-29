'use strict';
// Combine the original all-reflectable sweep's periodic/non-tiler/skipped
// counts, the torus-recheck's confirmed-periodic count, and the residual's
// DIRECT per-raw-candidate resolve_output/ counts into one TRUE top-line
// summary for the whole all-reflectable category.
//
// 2026-09-29: rewritten -- this used to read the residual's counts from
// final_summary.json, a file produced by the old canonical_full.js
// --dedupe -> full_resolve_multicore.js (on orbit reps) ->
// expand_orbit_results.js pipeline. That pipeline is gone (see
// 03_classify_n3_allreflectable.sh's step 4 comment and TODO.md, "Planned:
// one full fresh re-run"): the residual's 17,524 raw candidates are now
// resolved directly, one record per raw tileset, with resolve_output/
// containing periodic_w*.jsonl / non_tiler_w*.jsonl / still_unresolved_w*
// .jsonl in exactly the same shape stages 06-08 already produce for
// buckets 0-2 -- so this script just counts those directly, the same way
// it already counts the original sweep's own output/periodic_w*.jsonl.
//
// Line counting is done via a LINE STREAM (readline over a read stream),
// not fs.readFileSync -- some of these files (particularly the original
// sweep's periodic_w*.jsonl / non_tiler_w*.jsonl) are large enough
// (hundreds of MB per worker) to exceed Node's ~536M-character cap on a
// single in-memory string, which an earlier version of this script hit
// directly (ERR_STRING_TOO_LONG). See gather_periodic_parents.js's header
// comment for the same lesson learned earlier in this project.
//
// Usage: node combine_n3_allreflectable_summary.js <n3_allreflectable_work_dir> <out.json>
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const [, , workDir, outPath] = process.argv;
if (!workDir || !outPath) {
  console.error('Usage: node combine_n3_allreflectable_summary.js <n3_allreflectable_work_dir> <out.json>');
  process.exit(1);
}

async function countLinesInFile(filePath) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) {
    if (line.trim()) count++;
  }
  return count;
}

async function countLinesMatching(dir, prefix) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(prefix) && f.endsWith('.jsonl')) {
      total += await countLinesInFile(path.join(dir, f));
    }
  }
  return total;
}

(async () => {
  const sweepPeriodic = await countLinesMatching(path.join(workDir, 'output'), 'periodic_w');
  const sweepNonTiler = await countLinesMatching(path.join(workDir, 'output'), 'non_tiler_w');
  const sweepSkippedDuplicate = await countLinesMatching(path.join(workDir, 'output'), 'skipped_duplicate_w');
  const torusRecheckPeriodic = await countLinesMatching(path.join(workDir, 'torus_recheck_output'), 'resolved_periodic_w');

  // Residual: every raw candidate resolved directly (no orbit dedup/expand
  // any more), so these counts are already true raw-tileset counts -- no
  // "Raw" suffix or separate reconciliation step needed like the old
  // periodicRaw/nonTilerRaw/unresolvedRaw fields required.
  const residualPeriodic = await countLinesMatching(path.join(workDir, 'resolve_output'), 'periodic_w');
  const residualNonTiler = await countLinesMatching(path.join(workDir, 'resolve_output'), 'non_tiler_w');
  const residualUnresolved = await countLinesMatching(path.join(workDir, 'resolve_output'), 'still_unresolved_w');

  if (residualUnresolved > 0) {
    console.error(`ERROR: ${residualUnresolved} residual candidates still unresolved in resolve_output/still_unresolved_w*.jsonl -- ` +
                  '03_classify_n3_allreflectable.sh should already have stopped on this (step 5 check); summary refused.');
    process.exit(1);
  }

  const out = {
    n: 3,
    reflectablePattern: 'all-reflectable (3/3)',
    periodic: sweepPeriodic + torusRecheckPeriodic + residualPeriodic,
    nonTiler: sweepNonTiler + residualNonTiler,
    unresolved: residualUnresolved,
    skippedDuplicate: sweepSkippedDuplicate,
    breakdown: {
      sweepPeriodic, sweepNonTiler, sweepSkippedDuplicate,
      torusRecheckPeriodic, residualPeriodic, residualNonTiler, residualUnresolved,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Combined all-reflectable totals:', JSON.stringify({
    periodic: out.periodic, nonTiler: out.nonTiler, unresolved: out.unresolved, skippedDuplicate: out.skippedDuplicate,
  }));
  console.log('(breakdown written alongside in', outPath, ')');
})();
