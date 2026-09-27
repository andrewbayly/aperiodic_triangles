'use strict';
// Pure-JS bridge to a native SAT solver binary (CaDiCaL / Kissat), for the
// tiling-matching CNF encoding -- no Python, no pysat. Mirrors the exact
// encoding in the report's own solve.py::sat_assign, so results are directly
// comparable, but every line here is JS.
const fs = require('fs');
const { execFileSync } = require('child_process');
const { L, rho } = require('./lattice.js');

function hexPatchGraph(r) {
  const inHex = (i,j) => Math.abs(i)<=r && Math.abs(j)<=r && Math.abs(i+j)<=r;
  const Us = [], Ds = [];
  for (let i=-r;i<=r;i++) for (let j=-r;j<=r;j++) {
    if (inHex(i,j) && inHex(i+1,j) && inHex(i,j+1)) Us.push([i,j]);
    if (inHex(i+1,j) && inHex(i+1,j+1) && inHex(i,j+1)) Ds.push([i,j]);
  }
  const dIdx = new Map(Ds.map((c,i)=>[c.join(','), i]));
  const edges = []; // [uIdx, dIdx, slot]
  Us.forEach(([i,j], u) => {
    [[i,j-1],[i,j],[i-1,j]].forEach(([ni,nj], slot) => {
      const k = ni+','+nj;
      if (dIdx.has(k)) edges.push([u, dIdx.get(k), slot]);
    });
  });
  return { nU: Us.length, nD: Ds.length, edges };
}

function generatePlacements(tiles, flags) {
  const out = [];
  tiles.forEach((mu,t) => {
    const group = flags[t] ? [0,1,2,3,4,5] : [0,2,4];
    for (const g of group) out.push([L(mu,g,0,0), L(mu,g,1,0), L(mu,g,2,0)]);
  });
  const seen = new Set(); const uniq = [];
  for (const p of out) { const k=p.join(','); if(!seen.has(k)){seen.add(k); uniq.push(p);} }
  return uniq;
}

function viablePlacements(P) {
  let V = [...P];
  let changed = true;
  while (changed) {
    changed = false;
    const pres = [0,1,2].map(d => new Set(V.map(p=>p[d])));
    const W = V.filter(p => [0,1,2].every(d => pres[d].has(rho(p[d]))));
    if (W.length !== V.length) { V = W; changed = true; }
  }
  return V;
}

// Build the exact same CNF as solve.py's sat_assign: X[v][k] "cell v = placement k",
// Y[(v,d,l)] "cell v presents label l at slot d", edge-matching clauses.
function buildCnf(placements, nU, nD, edges) {
  const npl = placements.length;
  let nextVar = 0;
  const nv = () => ++nextVar;
  const clauses = [];
  const nCells = nU + nD;
  const X = Array.from({length: nCells}, () => Array.from({length: npl}, nv));
  for (let v = 0; v < nCells; v++) {
    clauses.push(X[v].slice());
    for (let a = 0; a < npl; a++) for (let b = a+1; b < npl; b++) clauses.push([-X[v][a], -X[v][b]]);
  }
  const labelsAt = [0,1,2].map(d => [...new Set(placements.map(p=>p[d]))].sort((a,b)=>a-b));
  const Y = new Map(); // key `${v},${d},${l}` -> var
  for (let v = 0; v < nCells; v++) {
    for (let d = 0; d < 3; d++) {
      for (const l of labelsAt[d]) {
        const y = nv();
        Y.set(`${v},${d},${l}`, y);
        const ps = [];
        for (let k = 0; k < npl; k++) if (placements[k][d] === l) ps.push(X[v][k]);
        clauses.push([-y, ...ps]);
        for (const x of ps) clauses.push([-x, y]);
      }
    }
  }
  for (const [u, dd, d] of edges) {
    const D = nU + dd;
    for (const l of labelsAt[d]) {
      const rl = rho(l);
      const yU = Y.get(`${u},${d},${l}`);
      const yDrl = Y.get(`${D},${d},${rl}`);
      clauses.push(yDrl !== undefined ? [-yU, yDrl] : [-yU]);
    }
    for (const l of labelsAt[d]) {
      const rl = rho(l);
      const yD = Y.get(`${D},${d},${l}`);
      const yUrl = Y.get(`${u},${d},${rl}`);
      clauses.push(yUrl !== undefined ? [-yD, yUrl] : [-yD]);
    }
  }
  return { numVars: nextVar, clauses };
}

function writeDimacs(numVars, clauses, path) {
  const lines = [`p cnf ${numVars} ${clauses.length}`];
  for (const c of clauses) lines.push(c.join(' ') + ' 0');
  fs.writeFileSync(path, lines.join('\n') + '\n');
}

function runCadical(cadicalBin, cnfPath, { proofPath } = {}) {
  const args = ['-q', cnfPath];
  if (proofPath) args.push(proofPath, '--no-binary');
  let stdout;
  try {
    stdout = execFileSync(cadicalBin, args, { encoding: 'utf8' });
  } catch (e) {
    // cadical exits with code 10 (SAT) or 20 (UNSAT), which execFileSync treats as an error
    stdout = e.stdout;
  }
  const status = stdout.includes('s SATISFIABLE') ? 'SAT' : stdout.includes('s UNSATISFIABLE') ? 'UNSAT' : 'UNKNOWN';
  return { status, raw: stdout };
}

function verifyDrat(dratTrimBin, cnfPath, proofPath) {
  let stdout;
  try {
    stdout = execFileSync(dratTrimBin, [cnfPath, proofPath], { encoding: 'utf8' });
  } catch (e) {
    stdout = (e.stdout || '') + (e.stderr || '');
  }
  return { verified: stdout.includes('s VERIFIED'), raw: stdout };
}

module.exports = { hexPatchGraph, generatePlacements, viablePlacements, buildCnf, writeDimacs, runCadical, verifyDrat };
