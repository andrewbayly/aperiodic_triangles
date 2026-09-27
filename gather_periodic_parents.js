'use strict';
// Merge every known source of all-reflectable n=3 periodic tilesets into
// one clean file (just {tiles, reflectableFlags} per line), ready to feed
// into the chiral-variant generation pipeline.
//
// Usage: node gather_periodic_parents.js <out.jsonl> <input1.jsonl> [input2.jsonl ...]
// (shell globs like output/periodic_w*.jsonl are expanded by the shell,
// this script just takes however many input paths you give it)
//
// Reads inputs as a LINE STREAM rather than fs.readFileSync -- some of these
// files are large enough (one worker's periodic_w<N>.jsonl can be several
// hundred MB) to exceed Node's ~536M-character cap on a single in-memory
// string, which readFileSync would hit directly.

const fs = require('fs');
const readline = require('readline');

const [, , outPath, ...inputPaths] = process.argv;
if (!outPath || inputPaths.length === 0) {
  console.error('Usage: node gather_periodic_parents.js <out.jsonl> <input1.jsonl> [input2.jsonl ...]');
  process.exit(1);
}

async function processFile(p, out) {
  if (!fs.existsSync(p)) { console.error('WARNING: missing file, skipping:', p); return { count: 0, malformed: 0 }; }
  const rl = readline.createInterface({ input: fs.createReadStream(p, { encoding: 'utf8' }), crlfDelay: Infinity });
  let count = 0, malformed = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (e) { malformed++; continue; }
    if (!rec.tiles) { malformed++; continue; }
    const ok = out.write(JSON.stringify({ tiles: rec.tiles, reflectableFlags: rec.reflectableFlags || [true, true, true] }) + '\n');
    if (!ok) await new Promise(res => out.once('drain', res)); // respect backpressure on huge files
    count++;
  }
  return { count, malformed };
}

(async () => {
  const out = fs.createWriteStream(outPath);
  let total = 0, totalMalformed = 0;
  for (const p of inputPaths) {
    const { count, malformed } = await processFile(p, out);
    console.log(p, '->', count, 'periodic records', malformed ? `(${malformed} malformed/skipped lines)` : '');
    total += count; totalMalformed += malformed;
  }
  await new Promise(res => out.end(res));
  console.log('TOTAL:', total, totalMalformed ? `(${totalMalformed} malformed/skipped lines overall)` : '', '-- wrote', outPath);
  console.log('Expected total: 13,744,988 (13,738,893 original + 184 torus-recheck + 5,911 this session)');
})();
