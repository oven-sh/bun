// glob-oracle.mjs <records> <directory with node_modules/minimatch> [--out=<file>]: asks minimatch about what the target `glob` has written down:
//   FUZZ_RECORD=<records> fuzz_glob -runs=0 <corpus>
// Compared: `new Minimatch(pattern, { dot: true })`: `match(path)` and `match(path, true)`. What is not UTF-8 is left out.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const [records, directory, ...rest] = process.argv.slice(2);
const out = rest.find(it => it.startsWith("--out="))?.slice(6);
const { Minimatch } = createRequire(path.resolve(directory, "index.js"))("minimatch");
const bytes = fs.readFileSync(records);
const counts = new Map();
const differences = [];
const seen = new Set();
for (let at = 0; at < bytes.length; ) {
  const parts = [];
  for (let part = 0; part < 3; part++) {
    const length = bytes.readUInt32LE(at);
    parts.push(bytes.subarray(at + 4, at + 4 + length));
    at += 4 + length;
  }
  const [pattern, file, ours] = parts.map(String);
  const key = pattern + "\0" + file;
  if (seen.has(key) || !parts[0].equals(Buffer.from(pattern)) || !parts[1].equals(Buffer.from(file))) continue;
  seen.add(key);
  let theirs;
  try {
    const matcher = new Minimatch(pattern, { dot: true });
    theirs = `${Number(matcher.match(file))}${Number(matcher.match(file, true))}`;
  } catch (error) {
    theirs = `throws: ${String(error.message).slice(0, 40)}`;
  }
  const verdict = ours == theirs ? "same" : `we: ${ours}, they: ${theirs}`;
  counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  if (verdict != "same") differences.push({ verdict, pattern, path: file });
}
for (const [verdict, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(8), verdict);
differences.sort((a, b) => a.pattern.length + a.path.length - b.pattern.length - b.path.length);
if (out) fs.writeFileSync(out, differences.map(it => JSON.stringify(it) + "\n").join(""));
