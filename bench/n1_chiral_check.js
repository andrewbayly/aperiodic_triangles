'use strict';
const fs = require('fs');
const { canonicalFull } = require('../canonical_full.js');
const { classify } = require('../classify.js');

const lines = fs.readFileSync('/tmp/n1_all.jsonl','utf8').trim().split('\n').map(JSON.parse);
const orbits = new Map();
for (const r of lines) {
  const { key } = canonicalFull(r.tiles, r.reflectableFlags, { sigma: true, rho: false });
  if (!orbits.has(key)) orbits.set(key, r);
}
let periodic = 0, nonTiler = 0, other = [];
for (const r of orbits.values()) {
  const res = classify(r.tiles, [false], { patchBudget: 2_000_000, torusBudget: 300_000 });
  if (res.status === 'periodic') periodic++;
  else if (res.status === 'non-tiler') nonTiler++;
  else other.push(res);
}
console.log('chiral classify() over 138 sigma-orbits: periodic=', periodic, 'non-tiler=', nonTiler, 'other=', other.length, other);
