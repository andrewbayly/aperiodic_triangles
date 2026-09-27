'use strict';
// Exports the FULL unknown-lattice list (not just the first 10 find_stuck.js
// prints) for every still-unresolved candidate that has one, ready to feed
// into sat_resolve.py.
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || 'sweep_781';
const outPath = process.argv[3] || 'unknowns_export.json';

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
  if (r.status === 'unresolved' && r.unknown && r.unknown.length) {
    out.push({ candidateIdx: r.candidateIdx, tiles: r.tiles, reflectableFlags: r.reflectableFlags, unknown: r.unknown, sweptUpTo: r.sweptUpTo });
  }
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`Exported ${out.length} candidate(s) with a combined ${out.reduce((s,c)=>s+c.unknown.length,0)} unknown lattices -> ${outPath}`);
