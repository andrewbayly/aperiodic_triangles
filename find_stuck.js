const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || 'sweep_781';
const files = fs.readdirSync(dir).filter(f => /^results_w\d+\.jsonl$/.test(f));
const best = new Map(); // candidateIdx -> most-progressed record
for (const f of files) {
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    const prev = best.get(r.candidateIdx);
    if (!prev || (r.sweptUpTo || 0) > (prev.sweptUpTo || 0)) best.set(r.candidateIdx, r);
  }
}
const stuck = [...best.values()].filter(r => r.status === 'unresolved' && ((r.unknown && r.unknown.length) || r.timedOut));
console.log(`${stuck.length} stuck candidate(s):\n`);
for (const r of stuck) {
  console.log(`candidateIdx=${r.candidateIdx}  sweptUpTo=${r.sweptUpTo}/${r.maxIndex}  timedOut=${r.timedOut}  latticesTried=${r.latticesTried}  elapsedMs=${r.elapsedMs}`);
  console.log(`  tiles=${JSON.stringify(r.tiles)}  reflectableFlags=${JSON.stringify(r.reflectableFlags)}`);
  console.log(`  unknown lattices (${(r.unknown||[]).length}): ${JSON.stringify((r.unknown||[]).slice(0,10))}${(r.unknown||[]).length>10 ? ' ...' : ''}`);
  console.log('');
}
