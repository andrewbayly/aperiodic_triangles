'use strict';
const fs = require('fs');
const path = require('path');

function getCl(l){ return l & 0b11; }
function getFl(l){ return (l>>2)&0b111; }
function getPt(l){ return (l>>5)&0b11; } // 0=a,1=b,2=c
function getPr(l){ return (l>>7)&0b11; } // 0=p,1=q,2=r
function rho(l){ const pr=getPr(l); if(pr===2) return l; const npr = pr===0?1:0; return (l & ~(0b11<<7)) | (npr<<7); }
function sigma(l){ const pt=getPt(l); if(pt===2) return l; const npt = pt===0?1:0; return (l & ~(0b11<<5)) | (npt<<5); }
function key(l){ return getCl(l)+','+getFl(l)+','+getPt(l)+','+getPr(l); }

// Theorem 1: single-tile edges {e0,e1,e2}. Reflectable given.
function theorem1Periodic(edges, reflectable){
  const [e0,e1,e2] = edges;
  const isRhoFixed = l => getPr(l)===2;
  // (i) all three rho-fixed
  if (isRhoFixed(e0) && isRhoFixed(e1) && isRhoFixed(e2)) return {periodic:true, case:'i'};
  // (ii) {x, rho x, w}: two edges are exact rho-pair (same cl,fl,pt, pr swapped p<->q), third is rho-fixed
  const idxs=[0,1,2];
  for (const wi of idxs) {
    const others = idxs.filter(i=>i!==wi);
    const w = edges[wi], a = edges[others[0]], b = edges[others[1]];
    if (isRhoFixed(w)) {
      if (!isRhoFixed(a) && !isRhoFixed(b) && rho(a)===b) return {periodic:true, case:'ii'};
    }
  }
  // (iii) reflectable, {x, rho(sigma(x)), w}, x class A (cl===0), w rho-fixed
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

const dir = process.argv[2] || 'bench/n1';
const perLines = fs.readFileSync(path.join(dir,'periodic_w0.jsonl'),'utf8').trim().split('\n');
const nonLines = fs.readFileSync(path.join(dir,'non_tiler_w0.jsonl'),'utf8').trim().split('\n');

let mismatches = [];
let counts = {i:0,ii:0,iii:0};
for (const line of perLines) {
  const rec = JSON.parse(line);
  const edges = rec.tiles[0];
  const refl = rec.reflectableFlags[0];
  const t1 = theorem1Periodic(edges, refl);
  if (!t1.periodic) mismatches.push({rec, oursSay:'periodic', theorem1Says:'non-tiler'});
  else counts[t1.case]++;
}
for (const line of nonLines) {
  const rec = JSON.parse(line);
  const edges = rec.tiles[0];
  const refl = rec.reflectableFlags[0];
  const t1 = theorem1Periodic(edges, refl);
  if (t1.periodic) mismatches.push({rec, oursSay:'non-tiler', theorem1Says:'periodic ('+t1.case+')'});
}

console.log('periodic total:', perLines.length, 'non-tiler total:', nonLines.length);
console.log('Theorem-1 case breakdown among our periodic set:', counts, ' sum=', counts.i+counts.ii+counts.iii);
console.log('Mismatches:', mismatches.length);
for (const m of mismatches) console.log(JSON.stringify(m.rec.tiles), 'reflectable=', m.rec.reflectableFlags, '-> ours:', m.oursSay, ' theorem1:', m.theorem1Says);
