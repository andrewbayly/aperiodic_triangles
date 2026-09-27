'use strict';
// Decode enum.c's packed uint64 keys (n=2 output) back into our own
// (tiles, reflectableFlags) representation, then bucket by how many of the
// tiles are reflectable (0, 1, or 2) -- this is the n+1 = 3 campaigns we
// actually need, already correctly separated out of enum.c's combined
// all-2^N-flag-patterns enumeration (verified: its canon() permutes each
// tile's flag along with the tile itself, so this bucketing is sound).
const fs = require('fs');
const { pack } = require('./lattice.js');

const N = 2;
function decodeLabel(code9) {
  // enum.c: code(l) = (((c*8)+f)*4+pa)*4+pr  -- 9 bits: c(2) f(3) pa(2) pr(2)
  const pr = code9 & 0b11;
  const pa = (code9 >> 2) & 0b11;
  const f = (code9 >> 4) & 0b111;
  const c = (code9 >> 7) & 0b11;
  return pack(c, f, pa, pr); // our own pack() uses the same 4 field values/order semantics
}

const lines = fs.readFileSync('/tmp/n2_timed.txt', 'utf8').trim().split('\n');
const buckets = { 0: [], 1: [], 2: [] };
for (const line of lines) {
  const [kStr] = line.split(' ');
  const k = BigInt(kStr);
  const tiles = [], flags = [];
  for (let j = 0; j < N; j++) {
    const shift = BigInt(28 * (N - 1 - j));
    const block = (k >> shift) & ((1n << 28n) - 1n);
    const flag = Number((block >> 27n) & 1n);
    const labels = [];
    for (let s = 0; s < 3; s++) {
      const code9 = Number((block >> BigInt(9 * (2 - s))) & 0x1ffn);
      labels.push(decodeLabel(code9));
    }
    tiles.push(labels);
    flags.push(!!flag);
  }
  const nRefl = flags.filter(Boolean).length;
  buckets[nRefl].push({ tiles, reflectableFlags: flags });
}
for (const k of [0,1,2]) console.log(`${k} reflectable tile(s): ${buckets[k].length} raw canonical shapes (from enum.c, sigma-flip already applied, rho-flip not yet)`);
fs.writeFileSync('/tmp/n2_buckets.json', JSON.stringify(buckets));
