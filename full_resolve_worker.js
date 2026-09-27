'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { workerData, parentPort } = require('worker_threads');
const { classify } = require('./classify.js');
const { compileTileset, searchLattice, latticeOrbitReps, verifyPeriodicSolution, solutionToDomain } = require('./sheared_solver.js');
const { vertexStarPrune } = require('./vertex_star_check.js');
const { hexPatchGraph, generatePlacements, viablePlacements, buildCnf, writeDimacs, runCadical } = require('./js_sat_bridge.js');

const {
  chunkPath, outputDir, workerId, defaultReflectableFlags,
  patchBudget, torusBudget,          // stage 1: fast classify()
  shearedMaxIndex, shearedBudget,    // stage 2: sheared-lattice sweep
  satMaxRadius,                      // stage 4: SAT patch-infeasibility
  cadicalBin,
} = workerData;

const periodicPath = path.join(outputDir, `periodic_w${workerId}.jsonl`);
const nonTilerPath = path.join(outputDir, `non_tiler_w${workerId}.jsonl`);
const unresolvedPath = path.join(outputDir, `still_unresolved_w${workerId}.jsonl`);
const checkpointPath = path.join(outputDir, `checkpoint_w${workerId}.json`);
const scratchCnf = path.join(outputDir, `scratch_w${workerId}.cnf`);

let resumeFromLine = 0;
let counts = { periodic: 0, nonTiler: 0, unresolved: 0 };
let stageCounts = { fastPeriodic: 0, fastNonTiler: 0, shearedPeriodic: 0, vertexStarNonTiler: 0, satNonTiler: 0 };
if (fs.existsSync(checkpointPath)) {
  try {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (typeof cp.linesCompleted === 'number') { resumeFromLine = cp.linesCompleted; counts = cp.counts; stageCounts = cp.stageCounts; }
  } catch (e) { /* corrupt checkpoint, start over */ }
}

let bufPeriodic = [], bufNonTiler = [], bufUnresolved = [];
function flushBuffers() {
  if (bufPeriodic.length) { fs.appendFileSync(periodicPath, bufPeriodic.join('')); bufPeriodic = []; }
  if (bufNonTiler.length) { fs.appendFileSync(nonTilerPath, bufNonTiler.join('')); bufNonTiler = []; }
  if (bufUnresolved.length) { fs.appendFileSync(unresolvedPath, bufUnresolved.join('')); bufUnresolved = []; }
}
function checkpoint(linesCompleted, done) {
  flushBuffers();
  fs.writeFileSync(checkpointPath, JSON.stringify({ linesCompleted, counts, stageCounts, done: !!done }));
}

// Stage 2: sheared-lattice periodicity sweep.
function tryShearedLattice(tiles, flags) {
  const allReflectable = flags.every(Boolean);
  const ct = compileTileset(tiles, flags);
  const reps = latticeOrbitReps(1, shearedMaxIndex, allReflectable);
  for (const lat of reps) {
    const res = searchLattice(ct, lat, { budget: shearedBudget });
    if (res.result) {
      const { map } = solutionToDomain(ct, lat, res.solution);
      const v = verifyPeriodicSolution(tiles, flags, lat, map);
      if (v.ok) return { resolved: true, lattice: lat };
    }
  }
  return { resolved: false };
}

// Stage 4: SAT patch-infeasibility, escalating radius.
function trySatPatch(tiles, flags) {
  const raw = generatePlacements(tiles, flags);
  const V = viablePlacements(raw);
  if (V.length === 0) return { resolved: true, radius: 0 };
  for (let r = 1; r <= satMaxRadius; r++) {
    const { nU, nD, edges } = hexPatchGraph(r);
    const { numVars, clauses } = buildCnf(V, nU, nD, edges);
    writeDimacs(numVars, clauses, scratchCnf);
    const res = runCadical(cadicalBin, scratchCnf);
    if (res.status === 'UNSAT') return { resolved: true, radius: r };
  }
  return { resolved: false };
}

(async () => {
  let lineNum = 0, shapesDone = 0;
  const startTime = Date.now();
  let lastCheckpointTime = Date.now();

  if (fs.existsSync(chunkPath)) {
    const rl = readline.createInterface({ input: fs.createReadStream(chunkPath, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      lineNum++;
      if (lineNum <= resumeFromLine) continue;

      const rec = JSON.parse(line);
      const tiles = rec.tiles;
      const flags = rec.reflectableFlags || defaultReflectableFlags;
      const base = { n: tiles.length, reflectableFlags: flags, tiles };

      // Stage 1: fast classify (arc-consistency, conservation LP, patch battery, axis-aligned torus)
      const r1 = classify(tiles, flags, { patchBudget, torusBudget });
      if (r1.status === 'periodic') {
        counts.periodic++; stageCounts.fastPeriodic++;
        bufPeriodic.push(JSON.stringify({ ...base, resolvedBy: 'fast-classify', patch: r1.patch }) + '\n');
      } else if (r1.status === 'non-tiler') {
        counts.nonTiler++; stageCounts.fastNonTiler++;
        bufNonTiler.push(JSON.stringify({ ...base, resolvedBy: 'fast-classify' }) + '\n');
      } else {
        // Stage 2: sheared-lattice sweep
        const r2 = tryShearedLattice(tiles, flags);
        if (r2.resolved) {
          counts.periodic++; stageCounts.shearedPeriodic++;
          bufPeriodic.push(JSON.stringify({ ...base, resolvedBy: 'sheared-lattice', lattice: r2.lattice }) + '\n');
        } else {
          // Stage 3: vertex-star filter
          const r3 = vertexStarPrune(tiles, flags);
          if (r3.nonTiler) {
            counts.nonTiler++; stageCounts.vertexStarNonTiler++;
            bufNonTiler.push(JSON.stringify({ ...base, resolvedBy: 'vertex-star' }) + '\n');
          } else {
            // Stage 4: SAT patch-infeasibility
            const r4 = trySatPatch(tiles, flags);
            if (r4.resolved) {
              counts.nonTiler++; stageCounts.satNonTiler++;
              bufNonTiler.push(JSON.stringify({ ...base, resolvedBy: 'sat-patch', radius: r4.radius }) + '\n');
            } else {
              counts.unresolved++;
              bufUnresolved.push(JSON.stringify({ ...base, sweptShearedTo: shearedMaxIndex, sweptPatchTo: satMaxRadius }) + '\n');
            }
          }
        }
      }
      shapesDone++;

      if (Date.now() - lastCheckpointTime > 10000) {
        lastCheckpointTime = Date.now();
        checkpoint(lineNum, false);
        parentPort.postMessage({ type: 'progress', workerId, lineNum, shapesDone, counts, stageCounts, elapsedMs: Date.now() - startTime });
      }
    }
  }
  checkpoint(lineNum, true);
  parentPort.postMessage({ type: 'done', workerId, lineNum, shapesDone, counts, stageCounts, elapsedMs: Date.now() - startTime });
})();
