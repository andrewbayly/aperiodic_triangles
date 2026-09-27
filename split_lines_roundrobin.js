'use strict';
// Split a large JSONL file into N chunk files, round-robin by line, for
// feeding into a multicore worker pool. Streams through once; never holds
// more than one line in memory.
// Usage: node split_lines_roundrobin.js <input.jsonl> <num-chunks> <output-prefix>
const fs = require('fs');
const readline = require('readline');

const [, , inputPath, numChunksStr, prefix] = process.argv;
if (!inputPath || !numChunksStr || !prefix) {
  console.error('Usage: node split_lines_roundrobin.js <input.jsonl> <num-chunks> <output-prefix>');
  process.exit(1);
}
const numChunks = parseInt(numChunksStr, 10);

(async () => {
  const outs = [];
  for (let i = 0; i < numChunks; i++) outs.push(fs.createWriteStream(`${prefix}_${i}.jsonl`));
  const rl = readline.createInterface({ input: fs.createReadStream(inputPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let i = 0, total = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const out = outs[i % numChunks];
    const ok = out.write(line + '\n');
    if (!ok) await new Promise(res => out.once('drain', res));
    i++; total++;
    if (total % 2_000_000 === 0) console.log(total, 'lines split...');
  }
  await Promise.all(outs.map(o => new Promise(res => o.end(res))));
  console.log('Done:', total, 'lines split into', numChunks, `chunks (~${Math.round(total / numChunks)} lines each)`);
})();
