'use strict';
// Dev/benchmark helper: sample random canonical n=3 subtype patterns, run the
// REAL classify() pipeline on every flavored shape, keep aperiodic-candidates.
// Usage: node sample_candidates.js <out.jsonl> <seconds> [seed]
const fs = require('fs');
const { findCanonicalSubtypeFast, compareArrays } = require('./canonicalize_subtype.js');
const { computeStabilizer, enumerateFlavoredForSubtype } = require('./orderly.js');
const { classify } = require('./classify.js');

const out = process.argv[2] || 'sampled_candidates.jsonl';
const seconds = parseInt(process.argv[3] || '300', 10);
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(parseInt(process.argv[4] || '12345', 10));

const n = 3, flags = [true, true, true], total = 9 ** 9;
const deadline = Date.now() + seconds * 1000;
let patterns = 0, shapes = 0, cands = 0;
const counts = {};
while (Date.now() < deadline) {
  let c = Math.floor(rand() * total);
  const flat = new Array(9);
  for (let j = 0; j < 9; j++) { flat[j] = c % 9; c = (c / 9) | 0; }
  const canon = findCanonicalSubtypeFast(flat, n);
  if (compareArrays(flat, canon) !== 0) continue;
  patterns++;
  const stab = computeStabilizer(canon, n);
  for (const tiles of enumerateFlavoredForSubtype(canon, n, stab)) {
    const r = classify(tiles, flags);
    shapes++;
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (r.status === 'aperiodic-candidate') {
      cands++;
      fs.appendFileSync(out, JSON.stringify({ n, reflectableFlags: flags, tiles, ...r }) + '\n');
    }
    if (Date.now() > deadline) break;
  }
}
console.log(JSON.stringify({ patterns, shapes, cands, counts }));
