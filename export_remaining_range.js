'use strict';
// For candidates that only got partially swept before timing out, generate
// the list of orbit-representative lattices covering the REMAINING index
// range (sweptUpTo+1 .. targetMax), in the same JSON schema sat_resolve.py
// already consumes (as if they were "unknown" lattices to check).
//
// Usage: node export_remaining_range.js sweep_781 remaining_export.json <targetMax> [candidateIdx1,candidateIdx2,...]
const fs = require('fs');
const path = require('path');
const { latticeOrbitReps } = require('./sheared_solver.js');

const dir = process.argv[2] || 'sweep_781';
const outPath = process.argv[3] || 'remaining_export.json';
const targetMax = parseInt(process.argv[4] || '300', 10);
const onlyIdx = process.argv[5] ? new Set(process.argv[5].split(',').map(Number)) : null;

const best = new Map();
for (const f of fs.readdirSync(dir)) {
  if (!/^results_w\d+\.jsonl$/.test(f)) continue;
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (e) { continue; }
    const prev = best.get(r.candidateIdx);
    if (!prev) { best.set(r.candidateIdx, r); continue; }
    if (prev.status === 'periodic') continue;
    const rs = r.sweptUpTo || 0, ps = prev.sweptUpTo || 0;
    if (r.status === 'periodic' || rs > ps || (rs === ps && (r.unknown || []).length < (prev.unknown || []).length)) best.set(r.candidateIdx, r);
  }
}

const out = [];
for (const r of best.values()) {
  if (r.status !== 'unresolved') continue;
  const swept = r.sweptUpTo || 0;
  if (swept >= targetMax) continue; // already covers the full range
  if (onlyIdx && !onlyIdx.has(r.candidateIdx)) continue;
  const allReflectable = r.reflectableFlags.every(Boolean);
  const reps = latticeOrbitReps(swept + 1, targetMax, allReflectable);
  out.push({
    candidateIdx: r.candidateIdx, tiles: r.tiles, reflectableFlags: r.reflectableFlags,
    sweptUpTo: swept, unknown: reps.map(l => [l.P, l.s, l.Q]),
  });
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`Candidates needing extension to index ${targetMax}: ${out.length}`);
for (const c of out) console.log(`  candidateIdx=${c.candidateIdx}  ${c.sweptUpTo}->${targetMax}  (${c.unknown.length} lattices to check)`);
console.log(`Total lattices: ${out.reduce((s,c)=>s+c.unknown.length,0)}`);
console.log(`Wrote ${outPath}`);
