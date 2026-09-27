'use strict';
// Independent hex-patch feasibility checker #2: same region/matching logic
// as before, but with forward-checking + MRV instead of naive backtracking,
// so it can actually finish at the radii SAT resolved (still fully
// independent of core.py/solve.py and of sheared_solver.js/classify.js).
const { L, rho } = require('./lattice.js');

function hexPatchCells(r) {
  const inHex = (i,j) => Math.abs(i)<=r && Math.abs(j)<=r && Math.abs(i+j)<=r;
  const Us = [], Ds = [];
  for (let i=-r;i<=r;i++) for (let j=-r;j<=r;j++) {
    if (inHex(i,j) && inHex(i+1,j) && inHex(i,j+1)) Us.push([i,j]);
    if (inHex(i+1,j) && inHex(i+1,j+1) && inHex(i,j+1)) Ds.push([i,j]);
  }
  return { Us, Ds };
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

function patchFeasibleCP(tiles, flags, r, timeLimitMs=120000) {
  const { Us, Ds } = hexPatchCells(r);
  const placements = generatePlacements(tiles, flags);
  const uIdx = new Map(Us.map((c,i)=>[c.join(','), i]));
  const dIdx = new Map(Ds.map((c,i)=>[c.join(','), i]));
  const n = Us.length + Ds.length;
  const isU = i => i < Us.length;

  const neighbors = [];
  Us.forEach(([i,j]) => {
    neighbors.push([[i,j-1],[i,j],[i-1,j]].map(([ni,nj],slot) => {
      const k = ni+','+nj; return dIdx.has(k) ? [Us.length + dIdx.get(k), slot] : null;
    }));
  });
  Ds.forEach(([i,j]) => {
    neighbors.push([[i,j-1],[i,j],[i-1,j]].map(([ni,nj],slot) => {
      const k = ni+','+nj; return uIdx.has(k) ? [uIdx.get(k), slot] : null;
    }));
  });

  const nPl = placements.length;
  // domains[cell] = Set of surviving placement indices
  let domains = Array.from({length:n}, () => new Set([...Array(nPl).keys()]));
  const assigned = new Array(n).fill(-1);
  const t0 = Date.now();

  function consistent(cellIsU, myLabel, nbrLabel) {
    return cellIsU ? (nbrLabel === rho(myLabel)) : (myLabel === rho(nbrLabel));
  }

  // propagate: given cell just fixed to placement p, filter neighbor domains
  function propagateFrom(cell, savedDomains) {
    const queue = [cell];
    while (queue.length) {
      const c = queue.pop();
      const cVals = domains[c];
      for (const entry of neighbors[c]) {
        if (entry === null) continue;
        const [nb, slot] = entry;
        const before = domains[nb].size;
        if (before === 0) continue;
        const cIsU = isU(c);
        const newDomain = new Set();
        for (const q of domains[nb]) {
          // does q survive given c's current domain has >=1 compatible value?
          let ok = false;
          for (const p of cVals) {
            const myLabel = placements[cIsU ? p : q][slot];
            const nbrLabel = placements[cIsU ? q : p][slot];
            if (consistent(cIsU, myLabel, nbrLabel)) { ok = true; break; }
          }
          if (ok) newDomain.add(q);
        }
        if (newDomain.size !== before) {
          if (!savedDomains.has(nb)) savedDomains.set(nb, domains[nb]);
          domains[nb] = newDomain;
          if (newDomain.size === 0) return false;
          queue.push(nb);
        }
      }
    }
    return true;
  }

  function selectCell() {
    let best = -1, bestSize = Infinity;
    for (let c = 0; c < n; c++) {
      if (assigned[c] !== -1) continue;
      const sz = domains[c].size;
      if (sz < bestSize) { bestSize = sz; best = c; if (sz <= 1) break; }
    }
    return best;
  }

  function backtrack(numAssigned) {
    if (Date.now() - t0 > timeLimitMs) throw new Error('TIMEOUT');
    if (numAssigned === n) return true;
    const cell = selectCell();
    if (cell === -1) return true;
    const candidates = [...domains[cell]];
    for (const p of candidates) {
      const savedDomains = new Map();
      const savedSelf = domains[cell];
      domains[cell] = new Set([p]);
      assigned[cell] = p;
      const ok = propagateFrom(cell, savedDomains);
      if (ok && backtrack(numAssigned + 1)) return true;
      // undo
      for (const [k,v] of savedDomains) domains[k] = v;
      domains[cell] = savedSelf;
      assigned[cell] = -1;
    }
    return false;
  }

  try {
    return backtrack(0);
  } catch (e) {
    if (e.message === 'TIMEOUT') return 'TIMEOUT';
    throw e; // don't hide real bugs behind a fake timeout
  }
}

module.exports = { patchFeasibleCP, hexPatchCells };

if (require.main === module) {
  const cases = [
    { idx: 15,  tiles: [[0,0,160],[4,128,128],[128,132,132]], flags: [true,true,true], claimedRadius: 5 },
    { idx: 728, tiles: [[257,66,66],[257,194,198],[70,70,198]], flags: [true,true,true], claimedRadius: 10 },
    { idx: 771, tiles: [[66,66,323],[66,198,198],[70,194,323]], flags: [true,true,true], claimedRadius: 10 },
  ];
  for (const c of cases) {
    const t0 = Date.now();
    const res = patchFeasibleCP(c.tiles, c.flags, c.claimedRadius, 180000);
    console.log(`candidate ${c.idx}: independent CP-based JS check at radius ${c.claimedRadius} -> ${res===true?'FEASIBLE (MISMATCH!)':res===false?'INFEASIBLE (confirms non-tiler)':res}  (${Date.now()-t0}ms)`);
  }
}
