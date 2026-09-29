'use strict';
// Combine the original all-reflectable sweep's periodic/non-tiler/skipped
// counts with the residual's already-computed final_summary.json into one
// TRUE top-line summary for the whole all-reflectable category.
//
// This is NOT the same thing as final_summary.json's own periodicRaw/
// nonTilerRaw fields, which describe only the 17,524-item residual
// sub-problem that stage 03 steps 3-6 dig into. Conflating the two was the
// root cause of scripts/10_summarize_results.sh badly under-reporting this
// row (5,911/11,613 instead of ~13.7M/~68.2M) -- see TODO.md, "Data-quality
// bugs found verifying the final run" for the full story.
//
// Line counting is done via a LINE STREAM (readline over a read stream),
// not fs.readFileSync -- the original sweep's periodic_w*.jsonl /
// non_tiler_w*.jsonl files are large enough (hundreds of MB per worker) to
// exceed Node's ~536M-character cap on a single in-memory string, which an
// initial version of this script hit directly (ERR_STRING_TOO_LONG). See
// gather_periodic_parents.js's header comment for the same lesson learned
// earlier in this project.
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

  // final_summary.json itself is small (just the six summary fields, not
  // raw tileset data), so a plain readFileSync is fine for it specifically.
  const finalSummaryPath = path.join(workDir, 'final_summary.json');
  const finalSummary = JSON.parse(fs.readFileSync(finalSummaryPath, 'utf8'));
  const residualPeriodicRaw = finalSummary.periodicRaw;
  const residualNonTilerRaw = finalSummary.nonTilerRaw;
  const residualUnresolvedRaw = finalSummary.unresolvedRaw;

  if (residualPeriodicRaw == null || residualNonTilerRaw == null || residualUnresolvedRaw == null) {
    console.error(`ERROR: ${finalSummaryPath} is missing periodicRaw/nonTilerRaw/unresolvedRaw -- ` +
                  'was it produced by the expected version of expand_orbit_results.js?');
    process.exit(1);
  }

  const out = {
    n: 3,
    reflectablePattern: 'all-reflectable (3/3)',
    periodic: sweepPeriodic + torusRecheckPeriodic + residualPeriodicRaw,
    nonTiler: sweepNonTiler + residualNonTilerRaw,
    unresolved: residualUnresolvedRaw,
    skippedDuplicate: sweepSkippedDuplicate,
    breakdown: {
      sweepPeriodic, sweepNonTiler, sweepSkippedDuplicate,
      torusRecheckPeriodic, residualPeriodicRaw, residualNonTilerRaw, residualUnresolvedRaw,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Combined all-reflectable totals:', JSON.stringify({
    periodic: out.periodic, nonTiler: out.nonTiler, unresolved: out.unresolved, skippedDuplicate: out.skippedDuplicate,
  }));
  console.log('(breakdown written alongside in', outPath, ')');
})();
