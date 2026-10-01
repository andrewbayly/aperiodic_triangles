'use strict';
// Export every periodic verdict produced anywhere in the pipeline into a
// clean, human-readable certificate format: packed integer labels expanded
// into the existing class+flavor+partnership+pairing notation ("A0ap",
// already used by render_tilesets.js), alongside the period vectors and
// full fundamental-domain assignment every periodic record already carries.
// This is the periodic counterpart to gather_sat_certificates.js, except a
// periodic record needs no DRAT proof -- the witness itself (domain +
// period vectors) is the proof, directly checkable by substitution. See
// independent_periodic_verifier.js for the actual checker, and TODO.md's
// "Certificate rigor" section for why it's scoped this way.
//
// Gathers from every source stage already writes periodic_w*.jsonl (or, for
// the targeted torus recheck, resolved_periodic_w*.jsonl) to, covering all
// four n=3 reflectable patterns -- the same source set
// combine_n3_allreflectable_summary.js already reads for the all-reflectable
// row, plus the three chiral/mixed buckets and n=1/n=2:
//   n1/output/periodic_w*.jsonl
//   n2/output/periodic_w*.jsonl
//   n3_allreflectable/output/periodic_w*.jsonl
//   n3_allreflectable/torus_recheck_output/resolved_periodic_w*.jsonl
//   n3_allreflectable/resolve_output/periodic_w*.jsonl
//   n3_variants/resolve_bucket{0,1,2}/periodic_w*.jsonl
//
// Streamed via readline (not fs.readFileSync), same large-file lesson as
// gather_periodic_parents.js/gather_sat_certificates.js -- these files can
// be very large.
//
// Takes the pipeline's working directory as an explicit argument rather
// than assuming cwd -- gather_sat_certificates.js originally got this
// wrong (hardcoded paths that were only valid relative to repo root, but
// invoked from inside working/09_certificates/) and silently processed 0
// records; see TODO.md, "Bugs found during the fresh run". Not repeating
// that mistake here.
//
// Usage: node export_periodic_certificates.js <out.jsonl> <working-dir>
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const [, , outPath, workDir] = process.argv;
if (!process.argv.includes('--test') && (!outPath || !workDir)) {
  console.error('Usage: node export_periodic_certificates.js <out.jsonl> <working-dir>');
  console.error('       node export_periodic_certificates.js --test');
  process.exit(1);
}

function sources(workDir) {
  return [
    { dir: path.join(workDir, 'n1/output'), prefix: 'periodic_w', source: 'n1' },
    { dir: path.join(workDir, 'n2/output'), prefix: 'periodic_w', source: 'n2' },
    { dir: path.join(workDir, 'n3_allreflectable/output'), prefix: 'periodic_w', source: 'n3-all-reflectable-sweep' },
    { dir: path.join(workDir, 'n3_allreflectable/torus_recheck_output'), prefix: 'resolved_periodic_w', source: 'n3-all-reflectable-torus-recheck' },
    { dir: path.join(workDir, 'n3_allreflectable/resolve_output'), prefix: 'periodic_w', source: 'n3-all-reflectable-residual' },
    { dir: path.join(workDir, 'n3_variants/resolve_bucket0'), prefix: 'periodic_w', source: 'n3-bucket0' },
    { dir: path.join(workDir, 'n3_variants/resolve_bucket1'), prefix: 'periodic_w', source: 'n3-bucket1' },
    { dir: path.join(workDir, 'n3_variants/resolve_bucket2'), prefix: 'periodic_w', source: 'n3-bucket2' },
  ];
}

// ---------------------------------------------------------------------------
// Packed-integer -> readable-notation decode. Same packing scheme as
// lattice.js's pack()/getPt()/getPr() (cl | fl<<2 | pt<<5 | pr<<7), but
// reimplemented locally here rather than importing lattice.js, so this
// decode step has no hidden dependency on the rest of the pipeline either
// -- it only needs to agree with lattice.js's pack() about the bit layout,
// which is cross-checked by this file's own self-test (--test) against
// lattice.js's exported getPt/getPr directly.
// ---------------------------------------------------------------------------
const CLASS_CHARS = ['A', 'B', 'C', 'D'];
const PARTNERSHIP_CHARS = ['a', 'b', 'c'];
const PAIRING_CHARS = ['p', 'q', 'r'];

function decodeLabel(l) {
  const cl = l & 0b11;
  const fl = (l >> 2) & 0b111;
  const pt = (l >> 5) & 0b11;
  const pr = (l >> 7) & 0b11;
  return `${CLASS_CHARS[cl]}${fl}${PARTNERSHIP_CHARS[pt]}${PAIRING_CHARS[pr]}`;
}

function describeOrientation(g) {
  const k = g >> 1, flip = !!(g & 1);
  return { orientation: g, rotationDegrees: k * 120, reflected: flip };
}

function exportRecord(rec, source) {
  if (!rec.patch) return null; // defensive: should never happen post certificate-persistence fix, but don't crash the export over it
  return {
    n: rec.n !== undefined ? rec.n : rec.tiles.length,
    reflectableFlags: rec.reflectableFlags,
    tiles: rec.tiles.map((edges) => edges.map(decodeLabel)),
    resolvedBy: rec.resolvedBy || 'fast-classify', // main.js/worker.js's classify()-only periodic records predate the resolvedBy field; they're all fast-classify torus hits
    patch: {
      periodVectors: rec.patch.periodVectors,
      fundamentalDomainSize: rec.patch.fundamentalDomainSize,
      domain: rec.patch.domain.map((cell) => ({ a: cell.a, b: cell.b, slot: cell.slot, tile: cell.tile, ...describeOrientation(cell.orientation) })),
    },
    source,
  };
}

async function exportDir({ dir, prefix, source }, out) {
  if (!fs.existsSync(dir)) { console.log(`  (skip, not found) ${dir}`); return 0; }
  let count = 0;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl'));
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f), { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      const exported = exportRecord(rec, source);
      if (!exported) {
        console.error(`  WARNING: record in ${dir}/${f} has no patch data -- skipped (should not happen post certificate-persistence fix)`);
        continue;
      }
      out.write(JSON.stringify(exported) + '\n');
      count++;
    }
  }
  return count;
}

if (process.argv.includes('--test')) {
  // Cross-check decodeLabel against lattice.js's own getPt/getPr (and the
  // class/partnership/pairing meanings documented in alphabet.js's
  // SUBTYPES table) -- this is the one place this file needs to agree
  // with the rest of the pipeline about the bit layout, so it's worth
  // checking directly rather than assuming.
  const { pack, getPt, getPr } = require('./lattice.js');
  let failures = 0;
  function check(name, cond) { if (cond) console.log(`  ok: ${name}`); else { console.error(`  FAIL: ${name}`); failures++; } }
  for (let cl = 0; cl < 4; cl++) {
    for (let fl = 0; fl < 8; fl++) {
      for (let pt = 0; pt < 3; pt++) {
        for (let pr = 0; pr < 3; pr++) {
          const l = pack(cl, fl, pt, pr);
          const decoded = decodeLabel(l);
          const expected = `${CLASS_CHARS[cl]}${fl}${PARTNERSHIP_CHARS[pt]}${PAIRING_CHARS[pr]}`;
          check(`decode(pack(${cl},${fl},${pt},${pr})) === ${expected}`, decoded === expected);
          check(`decode agrees with lattice.js getPt/getPr for ${decoded}`, getPt(l) === pt && getPr(l) === pr);
        }
      }
    }
  }
  // Round-trip through independent_periodic_verifier.js's own parser.
  const { parseLabel } = require('./independent_periodic_verifier.js');
  const sample = decodeLabel(pack(2, 5, 2, 1));
  const parsed = parseLabel(sample);
  check(`independent_periodic_verifier.parseLabel round-trips ${sample}`, parsed.cls === 'C' && parsed.flavor === 5 && parsed.partnership === 'c' && parsed.pairing === 'q');
  console.log(failures === 0 ? '\nAll self-tests passed.' : `\n${failures} self-test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

(async () => {
  const out = fs.createWriteStream(outPath);
  let total = 0;
  for (const src of sources(workDir)) {
    const n = await exportDir(src, out);
    console.log(`${src.dir}: ${n} periodic records exported`);
    total += n;
  }
  out.end();
  await new Promise((resolve) => out.on('finish', resolve));
  console.log(`Total: ${total} periodic certificates exported -> ${outPath}`);
})();
