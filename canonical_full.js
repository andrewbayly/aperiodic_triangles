'use strict';
// ============================================================================
// Canonical form under the FULL relabeling symmetry group of the matching
// model, and a candidate-deduplication CLI.
//
// The existing canonicalization (orderly.js / canonicalize.js) quotients by
// per-tile D_3 x tile permutation x flavor renumbering. Two further
// relabelings also preserve the matching relation (same class, flavor,
// partnership; complementary pairing) and commute with every placement
// (rotation permutes edges; reflection applies sigma to every edge):
//   per-(class,flavor) SIGMA flip: a <-> b on every A/B edge of that (class,flavor)
//   per-(class,flavor) RHO flip:   p <-> q on every A/C edge of that (class,flavor)
// Hence the tiling problems are identical (same placements work cell for
// cell), so classification is invariant -- verified empirically below.
//
// Chirality-correct group (also valid for mixed reflectability):
//   - tiles may be permuted only among tiles with the SAME reflectability flag
//   - rotations always; per-tile reflection only for reflectable tiles
//   - global mirror: reflect all chiral tiles simultaneously (mirroring the
//     whole tiling; reflectable tiles are unaffected up to relabeling)
//
// Fast canonical form: for each arrangement (permutation x per-tile placement),
// flavors are renumbered by first occurrence and the flips are chosen
// greedily so each (class,flavor)'s FIRST occurrence has pt=a / pr=p. This is
// exactly the lexicographic minimum over flips for that arrangement (the first
// occurrence of each key is the most significant place that key affects, and
// packed labels order pr > pt > fl > cl). The canonical form is the minimum
// over arrangements.
// ============================================================================
const { L, pack } = require('./lattice.js');

const cl = l => l & 3, fl = l => (l >> 2) & 7, pt = l => (l >> 5) & 3, pr = l => (l >> 7) & 3;

function permutationsOf(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => { for (const p of permutationsOf(arr.filter((_, j) => j !== i))) out.push([x, ...p]); });
  return out;
}

// Normalize one arranged flat label array: renumber flavors by first
// occurrence and apply greedy sigma/rho flips. Returns a comma-joined key.
function normalizeArranged(flat, useSigma = true, useRho = true) {
  const next = [0, 0, 0];
  const newFl = [new Map(), new Map(), new Map()];
  const flipS = new Map(), flipR = new Map();
  const out = new Array(flat.length);
  for (let i = 0; i < flat.length; i++) {
    const l = flat[i], c = cl(l);
    if (c === 3) { out[i] = l; continue; }
    const f = fl(l);
    if (!newFl[c].has(f)) newFl[c].set(f, next[c]++);
    const key = c * 8 + f;
    let p = pt(l), r = pr(l);
    if (useSigma && (c === 0 || c === 1)) {
      if (!flipS.has(key)) flipS.set(key, p === 1);
      if (flipS.get(key)) p = 1 - p;
    }
    if (useRho && (c === 0 || c === 2)) {
      if (!flipR.has(key)) flipR.set(key, r === 1);
      if (flipR.get(key)) r = 1 - r;
    }
    out[i] = pack(c, newFl[c].get(f), p, r);
  }
  return out.join(',');
}

function canonicalFull(tiles, reflectableFlags, opts = {}) {
  const useSigma = opts.sigma !== false, useRho = opts.rho !== false;
  const n = tiles.length;
  // Orderings: permute only within equal-flag classes, keeping a canonical
  // flag layout (reflectable tiles first, then chiral).
  const reflIdx = [], chirIdx = [];
  for (let t = 0; t < n; t++) (reflectableFlags[t] ? reflIdx : chirIdx).push(t);
  const orders = [];
  for (const a of permutationsOf(reflIdx)) for (const b of permutationsOf(chirIdx)) orders.push([...a, ...b]);
  // Placement choices: reflectable tiles 0..5; chiral tiles rotations only,
  // but ALL chiral tiles may be simultaneously mirrored (global mirror).
  const hasChiral = chirIdx.length > 0;
  let best = null;
  for (const mirrorAll of hasChiral ? [0, 1] : [0]) {
    const gOpts = tiles.map((_, t) => reflectableFlags[t] ? [0, 1, 2, 3, 4, 5] : (mirrorAll ? [1, 3, 5] : [0, 2, 4]));
    for (const order of orders) {
      const flat = new Array(3 * n);
      const rec = (pos) => {
        if (pos === n) {
          const k = normalizeArranged(flat, useSigma, useRho);
          if (best === null || compareKeys(k, best) < 0) best = k;
          return;
        }
        const t = order[pos];
        for (const g of gOpts[t]) {
          flat[3 * pos] = L(tiles[t], g, 0, 0); flat[3 * pos + 1] = L(tiles[t], g, 1, 0); flat[3 * pos + 2] = L(tiles[t], g, 2, 0);
          rec(pos + 1);
        }
      };
      rec(0);
    }
  }
  const nums = best.split(',').map(Number);
  const canonTiles = [];
  for (let t = 0; t < n; t++) canonTiles.push(nums.slice(3 * t, 3 * t + 3));
  const canonFlags = [...reflIdx.map(() => true), ...chirIdx.map(() => false)];
  return { key: canonFlags.map(x => x ? 1 : 0).join('') + '|' + best, tiles: canonTiles, reflectableFlags: canonFlags };
}
function compareKeys(a, b) {
  const x = a.split(',').map(Number), y = b.split(',').map(Number);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

module.exports = { canonicalFull, normalizeArranged };

// ============================================================================
// CLI: node canonical_full.js --dedupe <candidates.jsonl> <out-prefix>
//   writes <out-prefix>_unique.jsonl  (first member of each orbit, original line)
//          <out-prefix>_orbits.jsonl  ({repIdx, memberIdx:[...], key} per orbit;
//                                     indices are line numbers in the input)
// Self-test: node canonical_full.js --test
// ============================================================================
if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  if (args[0] === '--dedupe') {
    const [, input, prefix] = args;
    const lines = fs.readFileSync(input, 'utf8').split('\n').filter(l => l.trim());
    const orbits = new Map();
    const t0 = Date.now();
    lines.forEach((line, idx) => {
      const r = JSON.parse(line);
      const { key } = canonicalFull(r.tiles, r.reflectableFlags);
      if (!orbits.has(key)) orbits.set(key, []);
      orbits.get(key).push(idx);
    });
    const unique = [], orbitLines = [];
    for (const [key, members] of orbits) {
      unique.push(lines[members[0]]);
      orbitLines.push(JSON.stringify({ repIdx: members[0], memberIdx: members, key }));
    }
    fs.writeFileSync(`${prefix}_unique.jsonl`, unique.join('\n') + '\n');
    fs.writeFileSync(`${prefix}_orbits.jsonl`, orbitLines.join('\n') + '\n');
    const sizes = {}; for (const m of orbits.values()) sizes[m.length] = (sizes[m.length] || 0) + 1;
    console.log(`${lines.length} candidates -> ${orbits.size} distinct under the full group (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`orbit-size histogram (size:count): ${Object.keys(sizes).sort((a, b) => a - b).map(k => `${k}:${sizes[k]}`).join(' ')}`);
    console.log(`wrote ${prefix}_unique.jsonl and ${prefix}_orbits.jsonl`);
  } else if (args[0] === '--test') {
    const { enumerateCanonical } = require('./alphabet.js');
    const { enumerateCanonicalOrderly } = require('./orderly.js');
    // 1. n=1 counts must match the slow brute-force computation (276/138/104/61)
    for (const [s, r, expect] of [[false, false, 276], [true, false, 138], [false, true, 104], [true, true, 61]]) {
      const set = new Set();
      for (const t of enumerateCanonical(1)) set.add(canonicalFull(t, [true], { sigma: s, rho: r }).key);
      console.log(`n=1 sigma=${s} rho=${r}: ${set.size} (expect ${expect}) ${set.size === expect ? 'OK' : 'FAIL'}`);
    }
    // 2. With no flips, the n=2 count must reproduce the validated 126,649.
    const t0 = Date.now();
    const base = new Set(), full = new Set(), sOnly = new Set();
    let cnt = 0;
    for (const t of enumerateCanonicalOrderly(2)) {
      cnt++;
      base.add(canonicalFull(t, [true, true], { sigma: false, rho: false }).key);
      sOnly.add(canonicalFull(t, [true, true], { sigma: true, rho: false }).key);
      full.add(canonicalFull(t, [true, true]).key);
    }
    console.log(`n=2: ${cnt} orderly shapes; no-flip orbits ${base.size} (expect 126649 ${base.size === 126649 ? 'OK' : 'FAIL'}); +sigma ${sOnly.size}; full group ${full.size}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
