'use strict';
// Worker for sheared_torus_multicore.js: pulls one candidate at a time from
// the master, sweeps orbit-representative period lattices in increasing
// index order, stops at the first feasible one (independently verified).
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const S = require('./sheared_solver.js');

const { workerId, outputDir, maxIndex, budget, latticeTimeoutMs, candidateTimeoutMs, useSymmetry } = workerData;
const resultsPath = path.join(outputDir, `results_w${workerId}.jsonl`);

// Lattice lists per (withMirror, startIndex), built lazily and cached.
const repCache = new Map();
function latticeList(withMirror, startIndex) {
  const key = `${withMirror}|${startIndex}`;
  let list = repCache.get(key);
  if (!list) {
    if (useSymmetry) list = S.latticeOrbitReps(startIndex, maxIndex, withMirror);
    else { list = []; for (let N = startIndex; N <= maxIndex; N++) for (const l of S.hnfOfIndex(N)) list.push({ ...l, orbitSize: 1 }); }
    repCache.set(key, list);
  }
  return list;
}

function processCandidate({ candidateIdx, record, startIndex }) {
  const t0 = Date.now();
  const { tiles, reflectableFlags, n } = record;
  const ct = S.compileTileset(tiles, reflectableFlags);
  // Mirror symmetry is only valid if EVERY tile may be reflected.
  const withMirror = useSymmetry && reflectableFlags.every(Boolean);
  const lats = latticeList(withMirror, startIndex);
  let tried = 0, refuted = 0, nodesTotal = 0;
  const unknown = [];
  let sweptUpTo = startIndex - 1, curIndex = startIndex, timedOut = false;

  for (const lat of lats) {
    if (lat.N !== curIndex) { sweptUpTo = lat.N - 1; curIndex = lat.N; }
    if (Date.now() - t0 > candidateTimeoutMs) { timedOut = true; break; }
    const r = S.searchLattice(ct, lat, { budget, timeoutMs: latticeTimeoutMs });
    tried++; nodesTotal += r.nodes;
    if (r.result === true) {
      const { domain, map } = S.solutionToDomain(ct, lat, r.solution);
      const v = S.verifyPeriodicSolution(tiles, reflectableFlags, lat, map);
      if (!v.ok) {
        // Should be impossible (validated), but never report an unverified claim.
        unknown.push([lat.P, lat.s, lat.Q, 'VERIFY-FAILED:' + v.why]);
        continue;
      }
      return {
        candidateIdx, n, reflectableFlags, tiles, status: 'periodic',
        lattice: { P: lat.P, s: lat.s, Q: lat.Q, N: lat.N },
        periodVectors: [[lat.P, 0], [lat.s, lat.Q]],
        domain, verified: true, edgesChecked: v.edgesChecked,
        latticesTried: tried, unknownBeforeHit: unknown, nodes: nodesTotal,
        startIndex, maxIndex, elapsedMs: Date.now() - t0,
      };
    }
    if (r.result === false) refuted++;
    else unknown.push([lat.P, lat.s, lat.Q]);
  }
  if (!timedOut) sweptUpTo = maxIndex;
  return {
    candidateIdx, n, reflectableFlags, tiles, status: 'unresolved',
    startIndex, sweptUpTo, maxIndex, timedOut, latticesTried: tried, refuted,
    unknown, nodes: nodesTotal, elapsedMs: Date.now() - t0,
    symmetryReduced: useSymmetry, mirrorUsed: withMirror,
  };
}

parentPort.on('message', (msg) => {
  if (msg.type === 'task') {
    const out = processCandidate(msg);
    // Synchronous append BEFORE reporting completion: a candidate is only
    // ever considered done if its full result line is durably on disk.
    fs.appendFileSync(resultsPath, JSON.stringify(out) + '\n');
    parentPort.postMessage({ type: 'result', workerId, candidateIdx: out.candidateIdx, status: out.status, N: out.lattice ? out.lattice.N : null, elapsedMs: out.elapsedMs, unknownCount: out.unknown ? out.unknown.length : (out.unknownBeforeHit || []).length });
    parentPort.postMessage({ type: 'ready', workerId });
  } else if (msg.type === 'stop') {
    process.exit(0);
  }
});
parentPort.postMessage({ type: 'ready', workerId });
