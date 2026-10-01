'use strict';
// For each exported periodic certificate (see export_periodic_certificates.js),
// independently re-verify it with independent_periodic_verifier.js -- which
// shares no code with lattice.js/sheared_solver.js/classify.js, reimplementing
// the neighbor relation, orientation formula, and matching rule from scratch
// and parsing the certificate's readable notation directly. No external
// solver/binary involved (unlike stage 09's CaDiCaL/drat-trim) -- this is
// pure substitution-and-match checking, so it's cheap per record even though
// there are tens of millions of them.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { workerData, parentPort } = require('worker_threads');
const { verifyCertificate } = require('./independent_periodic_verifier.js');

const { chunkPath, outputDir, workerId } = workerData;

const verifiedPath = path.join(outputDir, `verified_w${workerId}.jsonl`);
const failedPath = path.join(outputDir, `failed_w${workerId}.jsonl`);
const checkpointPath = path.join(outputDir, `checkpoint_w${workerId}.json`);

let resumeFromLine = 0;
let counts = { verified: 0, failed: 0 };
if (fs.existsSync(checkpointPath)) {
  try {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (typeof cp.linesCompleted === 'number') { resumeFromLine = cp.linesCompleted; counts = cp.counts; }
  } catch (e) { /* corrupt checkpoint, start over */ }
}

let bufVerified = [], bufFailed = [];
function flushBuffers() {
  if (bufVerified.length) { fs.appendFileSync(verifiedPath, bufVerified.join('')); bufVerified = []; }
  if (bufFailed.length) { fs.appendFileSync(failedPath, bufFailed.join('')); bufFailed = []; }
}
function checkpoint(linesCompleted, done) {
  flushBuffers();
  fs.writeFileSync(checkpointPath, JSON.stringify({ linesCompleted, counts, done: !!done }));
}

(async () => {
  let lineNum = 0, recordsDone = 0;
  const startTime = Date.now();
  let lastCheckpointTime = Date.now();

  if (fs.existsSync(chunkPath)) {
    const rl = readline.createInterface({ input: fs.createReadStream(chunkPath, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      lineNum++;
      if (lineNum <= resumeFromLine) continue;

      const cert = JSON.parse(line);
      let result;
      try {
        result = verifyCertificate(cert);
      } catch (e) {
        result = { ok: false, reason: `verifier threw: ${e.message}` };
      }

      if (result.ok) {
        bufVerified.push(JSON.stringify({ n: cert.n, reflectableFlags: cert.reflectableFlags, source: cert.source, edgesChecked: result.edgesChecked }) + '\n');
        counts.verified++;
      } else {
        bufFailed.push(JSON.stringify({ ...cert, error: result.reason }) + '\n');
        counts.failed++;
      }

      recordsDone++;
      if (Date.now() - lastCheckpointTime > 10000) {
        lastCheckpointTime = Date.now();
        checkpoint(lineNum, false);
        parentPort.postMessage({ type: 'progress', workerId, lineNum, recordsDone, counts, elapsedMs: Date.now() - startTime });
      }
    }
  }
  checkpoint(lineNum, true);
  parentPort.postMessage({ type: 'done', workerId, lineNum, recordsDone, counts, elapsedMs: Date.now() - startTime });
})();
