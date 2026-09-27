'use strict';
// Shared result loading for the sheared sweep: best record per candidateIdx
// (periodic beats unresolved; deeper sweep beats shallower; fewer unknowns breaks ties).
const fs = require('fs');
const path = require('path');

function loadResults(dir) {
  const best = new Map(); // candidateIdx -> record
  if (!fs.existsSync(dir)) return best;
  for (const f of fs.readdirSync(dir)) {
    if (!/^results_w\d+\.jsonl$/.test(f)) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch (e) { continue; } // torn final line after a crash
      const prev = best.get(r.candidateIdx);
      if (!prev) { best.set(r.candidateIdx, r); continue; }
      if (prev.status === 'periodic') continue;
      const rs = r.sweptUpTo || 0, ps = prev.sweptUpTo || 0;
      if (r.status === 'periodic' || rs > ps || (rs === ps && (r.unknown || []).length < (prev.unknown || []).length)) best.set(r.candidateIdx, r);
    }
  }
  return best;
}

module.exports = { loadResults };
