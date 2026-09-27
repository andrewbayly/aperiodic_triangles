'use strict';
// After running a resolver (e.g. full_resolve_multicore.js) on a
// canonical_full.js --dedupe'd *_unique.jsonl file, expand each orbit's
// verdict back out to every one of its raw members using the matching
// *_orbits.jsonl file's memberIdx lists (line numbers into the ORIGINAL
// pre-dedup file).
//
// This matters beyond just getting the raw *counts* right: downstream
// steps that consume "the periodic parents" (e.g. chiral-variant
// generation) need every raw member as its own input line, not just one
// representative per orbit -- two raw tilesets in the same sigma/rho
// orbit are related by an exact symmetry of the whole system, so their
// respective chiral/mixed variant sets are themselves related by that
// same symmetry, i.e. they are genuinely different raw tilesets whose
// variants must each be generated and counted.
//
// Usage:
//   node expand_orbit_results.js <predup_input.jsonl> <orbits.jsonl> <resolve_output_dir> <out_prefix>
//
// <predup_input.jsonl> is the file canonical_full.js --dedupe was run on
// (its line numbers are what memberIdx refers to).
// <orbits.jsonl> and its sibling <same-prefix>_unique.jsonl are the two
// files --dedupe wrote.
//
// Writes:
//   <out_prefix>_periodic_raw.jsonl
//   <out_prefix>_non_tiler_raw.jsonl
//   <out_prefix>_unresolved_raw.jsonl
//   <out_prefix>_summary.json  { periodicOrbits, periodicRaw, nonTilerOrbits,
//                                 nonTilerRaw, unresolvedOrbits, unresolvedRaw }
// Exits 2 (after writing everything) if any raw tileset is unresolved.
const fs = require('fs');
const path = require('path');

const [, , predupPath, orbitsPath, resolveDir, outPrefix] = process.argv;
if (!predupPath || !orbitsPath || !resolveDir || !outPrefix) {
  console.error('Usage: node expand_orbit_results.js <predup_input.jsonl> <orbits.jsonl> <resolve_output_dir> <out_prefix>');
  process.exit(1);
}

function orbitKey(tiles, flags) { return JSON.stringify({ tiles, reflectableFlags: flags }); }

const uniquePath = orbitsPath.replace(/_orbits\.jsonl$/, '_unique.jsonl');
if (!fs.existsSync(uniquePath)) {
  console.error(`ERROR: expected sibling file ${uniquePath} (from canonical_full.js --dedupe) not found.`);
  process.exit(1);
}
const predupLines = fs.readFileSync(predupPath, 'utf8').split('\n').filter(l => l.trim());
const orbitLines = fs.readFileSync(orbitsPath, 'utf8').split('\n').filter(l => l.trim());
const uniqueLines = fs.readFileSync(uniquePath, 'utf8').split('\n').filter(l => l.trim());
if (orbitLines.length !== uniqueLines.length) {
  console.error(`ERROR: ${orbitsPath} has ${orbitLines.length} lines but ${uniquePath} has ${uniqueLines.length} -- mismatched pair.`);
  process.exit(1);
}

// orbitKey(rep) -> memberIdx (line numbers into predupLines)
const keyToMembers = new Map();
for (let i = 0; i < orbitLines.length; i++) {
  const orbit = JSON.parse(orbitLines[i]);
  const rec = JSON.parse(uniqueLines[i]);
  keyToMembers.set(orbitKey(rec.tiles, rec.reflectableFlags), orbit.memberIdx);
}

// Writes synchronously (buffer-then-writeFileSync, not a WriteStream) on
// purpose: an earlier version used fs.createWriteStream + out.end(), which
// is asynchronous, and a subsequent process.exit() (see bottom of file, the
// unresolvedRaw > 0 case) killed the process before those writes flushed --
// out_summary.json (written with writeFileSync) would appear, but the
// actual *_raw.jsonl files would be silently empty or truncated. Confirmed
// with a small synthetic test before trusting this against real data.
function expand(globPrefix, outFile) {
  const files = fs.readdirSync(resolveDir).filter(f => f.startsWith(globPrefix) && f.endsWith('.jsonl'));
  const outLines = [];
  let rawTotal = 0, orbitTotal = 0;
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(resolveDir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      const k = orbitKey(rec.tiles, rec.reflectableFlags);
      const members = keyToMembers.get(k);
      if (members === undefined) {
        console.error(`WARNING: record in ${f} has no matching orbit in ${orbitsPath} -- writing just this one record as its own raw member.`);
        outLines.push(line.trim());
        rawTotal += 1;
      } else {
        for (const idx of members) outLines.push(predupLines[idx]);
        rawTotal += members.length;
      }
      orbitTotal++;
    }
  }
  fs.writeFileSync(outFile, outLines.length ? outLines.join('\n') + '\n' : '');
  return { rawTotal, orbitTotal };
}

const periodic = expand('periodic_w', `${outPrefix}_periodic_raw.jsonl`);
const nonTiler = expand('non_tiler_w', `${outPrefix}_non_tiler_raw.jsonl`);
const unresolved = expand('still_unresolved_w', `${outPrefix}_unresolved_raw.jsonl`);

const summary = {
  periodicOrbits: periodic.orbitTotal, periodicRaw: periodic.rawTotal,
  nonTilerOrbits: nonTiler.orbitTotal, nonTilerRaw: nonTiler.rawTotal,
  unresolvedOrbits: unresolved.orbitTotal, unresolvedRaw: unresolved.rawTotal,
};
fs.writeFileSync(`${outPrefix}_summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`wrote ${outPrefix}_{periodic,non_tiler,unresolved}_raw.jsonl and ${outPrefix}_summary.json`);
if (summary.unresolvedRaw > 0) {
  console.error(`\nWARNING: ${summary.unresolvedRaw} raw tilesets (${summary.unresolvedOrbits} orbits) remain unresolved.`);
  process.exit(2);
}
