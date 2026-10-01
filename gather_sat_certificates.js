'use strict';
// Scan every non_tiler_w*.jsonl across all three n=3 chiral/mixed buckets
// and the n=3 all-reflectable residual, and pull out just the records
// resolved via SAT patch-infeasibility (resolvedBy: 'sat-patch') -- these
// are the only non-tiler verdicts that need an archivable DRAT proof (see
// TODO.md, "Certificate rigor"): the 58 vertex-star non-tilers keep their
// existing combinatorial argument as their certificate, and periodic
// records need no DRAT at all since periodicity is directly checkable by
// substitution. Only stage 4 (SAT patch-infeasibility) of the resolve
// cascade in full_resolve_worker.js produces resolvedBy: 'sat-patch'.
//
// Usage: node gather_sat_certificates.js <out.jsonl> <working-dir>
// <working-dir> is the pipeline's top-level `working/` directory (i.e. $WORK
// in scripts/_common.sh) -- NOT the current directory. This script is
// invoked from scripts/09_verify_sat_certificates.sh after it has already
// `cd`ed into $WORK/09_certificates/ (so sat_patch_records.jsonl lands
// there), so the source directories below must be resolved against $WORK
// explicitly rather than assumed relative to cwd. Reads from (relative to
// <working-dir>):
//   n3_variants/resolve_bucket0/non_tiler_w*.jsonl
//   n3_variants/resolve_bucket1/non_tiler_w*.jsonl
//   n3_variants/resolve_bucket2/non_tiler_w*.jsonl
//   n3_allreflectable/resolve_output/non_tiler_w*.jsonl
// (the last of these is stage 03's direct, no-orbit-dedup residual
// resolution -- see 03_classify_n3_allreflectable.sh's step 4 comment.)
//
// Streamed via readline (not fs.readFileSync) -- same ERR_STRING_TOO_LONG
// lesson as elsewhere in this project (see gather_periodic_parents.js):
// these files can be very large even though the sat-patch subset within
// them is small.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const [, , outPath, workDir] = process.argv;
if (!outPath || !workDir) {
  console.error('Usage: node gather_sat_certificates.js <out.jsonl> <working-dir>');
  process.exit(1);
}

const SOURCES = [
  path.join(workDir, 'n3_variants/resolve_bucket0'),
  path.join(workDir, 'n3_variants/resolve_bucket1'),
  path.join(workDir, 'n3_variants/resolve_bucket2'),
  path.join(workDir, 'n3_allreflectable/resolve_output'),
];

async function scanDir(dir, out) {
  if (!fs.existsSync(dir)) { console.log(`  (skip, not found) ${dir}`); return 0; }
  let found = 0;
  const files = fs.readdirSync(dir).filter(f => f.startsWith('non_tiler_w') && f.endsWith('.jsonl'));
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f), { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      if (rec.resolvedBy === 'sat-patch') {
        out.write(JSON.stringify({
          tiles: rec.tiles,
          reflectableFlags: rec.reflectableFlags,
          radius: rec.radius,
          source: `${dir}/${f}`,
        }) + '\n');
        found++;
      }
    }
  }
  return found;
}

(async () => {
  const out = fs.createWriteStream(outPath);
  let total = 0;
  for (const dir of SOURCES) {
    const n = await scanDir(dir, out);
    console.log(`${dir}: ${n} sat-patch records`);
    total += n;
  }
  out.end();
  await new Promise((resolve) => out.on('finish', resolve));
  console.log(`Total: ${total} sat-patch certificates to verify -> ${outPath}`);
})();
