'use strict';
// ============================================================================
// Computes "what's left" after recheck_torus_unresolved_multicore.js: the
// original input file's candidates, minus whichever ones now appear in any
// resolved_periodic_w*.jsonl (identified by their candidateIdx, which the
// recheck tool records against the ORIGINAL input file's line order).
// Safe to run at any time, including while the recheck job is still in
// progress -- it just reflects whatever has been resolved so far.
// ============================================================================
const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const recheckOutputDir = process.argv[3];
const outPath = process.argv[4] || 'still_candidates_after_torus_recheck.jsonl';

if (!inputPath || !recheckOutputDir) {
  console.error('Usage: node compute_remaining_after_torus_recheck.js <original-input.jsonl> <recheck-output-dir> [output.jsonl]');
  process.exit(1);
}

const candidates = fs.readFileSync(inputPath, 'utf8').split('\n').filter(l => l.trim());
console.log(`Original candidates: ${candidates.length}`);

const resolvedIdx = new Set();
for (const fname of fs.readdirSync(recheckOutputDir)) {
  if (!/^resolved_periodic_w\d+\.jsonl$/.test(fname)) continue;
  const lines = fs.readFileSync(path.join(recheckOutputDir, fname), 'utf8').split('\n').filter(l => l.trim());
  for (const line of lines) {
    const rec = JSON.parse(line);
    resolvedIdx.add(rec.candidateIdx);
  }
}
console.log(`Resolved (genuinely periodic) so far: ${resolvedIdx.size}`);

const remaining = candidates.filter((_, idx) => !resolvedIdx.has(idx));
fs.writeFileSync(outPath, remaining.join('\n') + (remaining.length ? '\n' : ''));
console.log(`Remaining candidates: ${remaining.length}`);
console.log(`Written to: ${path.resolve(outPath)}`);
