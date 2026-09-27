'use strict';
const fs = require('fs');
const { canonicalFull } = require('../canonical_full.js');

function getCl(l){ return l & 0b11; }
function getFl(l){ return (l>>2)&0b111; }
function getPt(l){ return (l>>5)&0b11; }
function getPr(l){ return (l>>7)&0b11; }
function rho(l){ const pr=getPr(l); if(pr===2) return l; return (l & ~(0b11<<7)) | ((pr===0?1:0)<<7); }
function sigma(l){ const pt=getPt(l); if(pt===2) return l; return (l & ~(0b11<<5)) | ((pt===0?1:0)<<5); }

function theorem1Periodic(edges, reflectable){
  const [e0,e1,e2] = edges;
  const isRhoFixed = l => getPr(l)===2;
  if (isRhoFixed(e0) && isRhoFixed(e1) && isRhoFixed(e2)) return {periodic:true, case:'i'};
  const idxs=[0,1,2];
  for (const wi of idxs) {
    const others = idxs.filter(i=>i!==wi);
    const w = edges[wi], a = edges[others[0]], b = edges[others[1]];
    if (isRhoFixed(w) && !isRhoFixed(a) && !isRhoFixed(b) && rho(a)===b) return {periodic:true, case:'ii'};
  }
  if (reflectable) {
    for (const wi of idxs) {
      const others = idxs.filter(i=>i!==wi);
      const w = edges[wi], a = edges[others[0]], b = edges[others[1]];
      if (isRhoFixed(w)) {
        if (getCl(a)===0 && rho(sigma(a))===b) return {periodic:true, case:'iii'};
        if (getCl(b)===0 && rho(sigma(b))===a) return {periodic:true, case:'iii'};
      }
    }
  }
  return {periodic:false};
}

const lines = fs.readFileSync('/tmp/n1_all.jsonl','utf8').trim().split('\n').map(JSON.parse);
const orbits = new Map();
for (const r of lines) {
  const { key } = canonicalFull(r.tiles, r.reflectableFlags, { sigma: true, rho: false });
  if (!orbits.has(key)) orbits.set(key, r); // first-seen representative
}
console.log('sigma-only orbits:', orbits.size);

for (const reflectable of [true, false]) {
  const counts = { i:0, ii:0, iii:0 };
  let periodic = 0;
  for (const r of orbits.values()) {
    const t1 = theorem1Periodic(r.tiles[0], reflectable);
    if (t1.periodic) { periodic++; counts[t1.case]++; }
  }
  console.log(`reflectable=${reflectable}: periodic orbits=${periodic}  case breakdown=`, counts);
}
