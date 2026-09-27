'use strict';
const { findCanonicalSubtypeFast, PERMUTATIONS, compareArrays, subtypeTileRelabelings } = require('./canonicalize_subtype.js');
const { SUBTYPES } = require('./alphabet.js');
const { pack } = require('./lattice.js');

// ---------- Compute the stabilizer of a canonical subtype pattern ----------
// (Only called on the ~453K survivors of Level 1, so brute-forcing the full
// group here -- 1296 elements for n=3 -- is cheap in aggregate.)
function computeStabilizer(canonicalFlat, n) {
  const perms = PERMUTATIONS[n];
  const tiles = []; for (let t = 0; t < n; t++) tiles.push(canonicalFlat.slice(t * 3, t * 3 + 3));
  const relabelings = tiles.map(subtypeTileRelabelings);
  const totalG = Math.pow(6, n);
  const stabilizer = [];
  const candidate = new Array(3 * n);
  for (const perm of perms) {
    for (let gCode = 0; gCode < totalG; gCode++) {
      let rem = gCode;
      const gCombo = new Array(n);
      for (let pos = 0; pos < n; pos++) {
        const origIdx = perm[pos];
        const g = rem % 6; rem = (rem / 6) | 0;
        gCombo[pos] = g;
        const row = relabelings[origIdx];
        candidate[pos * 3 + 0] = row[g * 3 + 0];
        candidate[pos * 3 + 1] = row[g * 3 + 1];
        candidate[pos * 3 + 2] = row[g * 3 + 2];
      }
      if (compareArrays(candidate, canonicalFlat) === 0) stabilizer.push({ perm: perm.slice(), gCombo: gCombo.slice() });
    }
  }
  return stabilizer;
}

// ---------- Level 2: flavor partitions, canonicalized within the stabilizer ----------
function* rgsPartitions(n) {
  if (n === 0) { yield []; return; }
  const a = new Array(n).fill(0);
  const maxSoFar = new Array(n).fill(0);
  function* rec(i) {
    if (i === n) { yield a.slice(); return; }
    const bound = i === 0 ? 0 : maxSoFar[i - 1] + 1;
    for (let v = 0; v <= bound; v++) {
      a[i] = v;
      maxSoFar[i] = Math.max(v, i === 0 ? 0 : maxSoFar[i - 1]);
      yield* rec(i + 1);
    }
  }
  yield* rec(0);
}
function cartesian(arrays) {
  return arrays.reduce((acc, arr) => {
    const out = [];
    for (const a of acc) for (const b of arr) out.push([...a, b]);
    return out;
  }, [[]]);
}

// Apply a stabilizer element to a full flavor-annotated flat label array,
// producing the transformed array (positions permuted, partnership flipped
// for reflected sub-relabelings, flavor VALUES carried along unchanged --
// consistent with how canonicalize.js's tileRelabelings works, restricted to
// stabilizer elements only).
const { L } = require('./lattice.js');
function applyStabilizerElement(fullTiles, n, { perm, gCombo }) {
  const out = new Array(n);
  for (let pos = 0; pos < n; pos++) {
    const origIdx = perm[pos];
    const g = gCombo[pos];
    const mu = fullTiles[origIdx];
    out[pos] = [0, 1, 2].map(j => L(mu, g, j, 0));
  }
  return out;
}

function getCl(l) { return l & 0b11; }
function getFl(l) { return (l >> 2) & 0b111; }
function getPt(l) { return (l >> 5) & 0b11; }
function getPr(l) { return (l >> 7) & 0b11; }

function renumberFlavorsFlat(flat, n) {
  const next = [0, 0, 0];
  const seen = [new Map(), new Map(), new Map()];
  return flat.map(l => {
    const cl = getCl(l);
    if (cl === 3) return l;
    const oldFl = getFl(l);
    if (!seen[cl].has(oldFl)) seen[cl].set(oldFl, next[cl]++);
    return pack(cl, seen[cl].get(oldFl), getPt(l), getPr(l));
  });
}

// Given a canonical subtype pattern and its stabilizer, enumerate exactly
// one representative full labeling (with flavor) per stabilizer-orbit.
function* enumerateFlavoredForSubtype(canonicalSubtypeFlat, n, stabilizer) {
  const totalEdges = 3 * n;
  const byClass = { 0: [], 1: [], 2: [] };
  for (let i = 0; i < totalEdges; i++) {
    const [cl] = SUBTYPES[canonicalSubtypeFlat[i]];
    if (cl !== 3) byClass[cl].push(i);
  }
  const classKeys = [0, 1, 2].filter(c => byClass[c].length > 0);
  const partitionOptionsPerClass = classKeys.map(c => [...rgsPartitions(byClass[c].length)]);
  const combos = cartesian(partitionOptionsPerClass.length ? partitionOptionsPerClass : [[[]]]);

  const seenCanonical = stabilizer.length === 1 ? null : new Set(); // stabilizer.length===1 means only identity -> no dedup needed

  for (const combo of combos) {
    const flavorOf = new Array(totalEdges).fill(0);
    classKeys.forEach((c, idx) => {
      const positions = byClass[c];
      const rgs = combo[idx];
      positions.forEach((pos, j) => { flavorOf[pos] = rgs[j]; });
    });
    const flat = new Array(totalEdges);
    for (let i = 0; i < totalEdges; i++) {
      const [cl, pt, pr] = SUBTYPES[canonicalSubtypeFlat[i]];
      flat[i] = pack(cl, cl === 3 ? 0 : flavorOf[i], pt, pr);
    }
    const tiles = []; for (let t = 0; t < n; t++) tiles.push(flat.slice(t * 3, t * 3 + 3));

    if (stabilizer.length === 1) {
      // trivial stabilizer: every flavor-partition choice is already its own
      // canonical representative, no further reduction possible or needed.
      yield tiles;
      continue;
    }

    // nontrivial stabilizer: only accept this partition if it's the
    // lexicographically smallest among its stabilizer-orbit.
    let isCanonicalHere = true;
    let ownKey = null;
    for (const elem of stabilizer) {
      const transformed = applyStabilizerElement(tiles, n, elem);
      const renumbered = renumberFlavorsFlat(transformed.flat(), n);
      if (elem.perm.every((v, i) => v === i) && elem.gCombo.every(g => g === 0)) {
        ownKey = renumbered; // identity element -- this IS our own (already-flavor-canonical) form
      }
      if (compareArrays(renumbered, flat) < 0) { isCanonicalHere = false; break; }
    }
    if (isCanonicalHere) {
      const dedupKey = JSON.stringify(flat);
      if (!seenCanonical.has(dedupKey)) { seenCanonical.add(dedupKey); yield tiles; }
    }
  }
}

// Full orderly generator: yields exactly one representative per orbit.
function* enumerateCanonicalOrderly(n) {
  const totalSubtypePatterns = 9 ** (3 * n);
  const seenSubtype = new Set();
  for (let code = 0; code < totalSubtypePatterns; code++) {
    let c = code;
    const flat = new Array(3 * n);
    for (let j = 0; j < 3 * n; j++) { flat[j] = c % 9; c = (c / 9) | 0; }
    const canonicalSubtype = findCanonicalSubtypeFast(flat, n);
    if (compareArrays(flat, canonicalSubtype) !== 0) continue; // not canonical, skip
    const key = canonicalSubtype.join(',');
    if (seenSubtype.has(key)) continue; // safety net; shouldn't trigger given the check above
    seenSubtype.add(key);
    const stabilizer = computeStabilizer(canonicalSubtype, n);
    yield* enumerateFlavoredForSubtype(canonicalSubtype, n, stabilizer);
  }
}

module.exports = { enumerateCanonicalOrderly, computeStabilizer, enumerateFlavoredForSubtype };

// ============================================================================
// Validation against the slow-but-proven brute-force method (canonicalize.js)
// Run on n=1 and n=2 where full brute-force comparison is tractable.
// ============================================================================
if (require.main === module) {
  const { canonicalize: slowCanonicalize } = require('./canonicalize.js');
  const { enumerateCanonical } = require('./alphabet.js');

  function tilesKey(tiles) { return JSON.stringify(tiles); }

  // CORRECT validation methodology: orderly.js and canonicalize.js use
  // DIFFERENT (individually valid) conventions for which representative is
  // "canonical" per orbit -- subtype-code order vs full-packed-integer order.
  // So the right test is NOT "does orderly's pick equal slow's pick", but:
  // mapping every orderly output through the slow canonicalizer must give a
  // BIJECTION with the true orbit set (same count, no duplicates, no gaps).
  function validateBijection(n, label) {
    console.log(`=== Validation ${label}: orderly generator vs true orbit count (bijection test) ===`);
    const start = Date.now();
    const orderlyOutputs = [...enumerateCanonicalOrderly(n)];
    console.log(`  orderly produced ${orderlyOutputs.length} outputs in ${((Date.now() - start) / 1000).toFixed(1)}s`);

    const mapped = orderlyOutputs.map(t => tilesKey(slowCanonicalize(t)));
    const distinctMapped = new Set(mapped);
    console.log(`  no duplicates (orderly count === distinct-after-remapping): ${orderlyOutputs.length === distinctMapped.size}`);

    const groundTruth = new Set();
    for (const tiles of enumerateCanonical(n)) groundTruth.add(tilesKey(slowCanonicalize(tiles)));
    console.log(`  true orbit count: ${groundTruth.size}`);

    let setsMatch = true;
    for (const k of distinctMapped) if (!groundTruth.has(k)) setsMatch = false;
    for (const k of groundTruth) if (!distinctMapped.has(k)) setsMatch = false;
    console.log(`  exact bijection (covers every orbit, no duplicates): ${setsMatch}`);
    return setsMatch && orderlyOutputs.length === distinctMapped.size && distinctMapped.size === groundTruth.size;
  }

  const n1ok = validateBijection(1, 'n=1');
  const n2ok = validateBijection(2, 'n=2');

  console.log('=== Classification preserved under canonicalization (n=2 sample) ===');
  const { classify } = require('./classify.js');
  let count = 0, classOk = true;
  for (const tiles of enumerateCanonical(2)) {
    count++; if (count > 500) break;
    const c = slowCanonicalize(tiles);
    const r1 = classify(tiles, [true, true]), r2 = classify(c, [true, true]);
    if (r1.status !== r2.status) classOk = false;
  }
  console.log(`  checked ${count - 1}, classification preserved: ${classOk}`);

  console.log();
  console.log('ALL VALIDATIONS PASSED:', n1ok && n2ok && classOk);
}
