// regex-oracle.mjs <records> [--out=<file>]: asks the RegExp of what runs this about what the target `regex` has written down:
//   FUZZ_RECORD=<records> fuzz_regex -runs=0 <corpus>
// Compared: whether the pattern is valid, whether there is a match, where it and each of its groups start and end.
// A pattern or a text that is not UTF-8 is left out: JavaScript cannot be given it. A search runs in a worker that is ended after two seconds.
import fs from "node:fs";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (!isMainThread) {
  parentPort.on("message", ({ pattern, flags, text }) => {
    let regex;
    try {
      regex = new RegExp(pattern, flags.includes("d") ? flags : flags + "d");
    } catch {
      return parentPort.postMessage("SyntaxError");
    }
    const found = regex.exec(text);
    if (!found) return parentPort.postMessage("null");
    // Offsets in bytes of UTF-8.
    const bytes = index => Buffer.byteLength(text.slice(0, index));
    parentPort.postMessage(found.indices.map(it => (it ? `${bytes(it[0])},${bytes(it[1])}` : "-")).join(";"));
  });
} else {
  const [records, ...rest] = process.argv.slice(2);
  const out = rest.find(it => it.startsWith("--out="))?.slice(6);
  let worker;
  const ask = request =>
    new Promise(done => {
      worker ??= new Worker(new URL(import.meta.url));
      const timer = setTimeout(() => {
        worker.terminate();
        worker = undefined;
        done("hangs");
      }, 2000);
      worker.once("message", answer => (clearTimeout(timer), done(answer)));
      worker.postMessage(request);
    });
  const bytes = fs.readFileSync(records);
  const counts = new Map();
  const differences = [];
  const seen = new Set();
  for (let at = 0; at < bytes.length; ) {
    const parts = [];
    for (let part = 0; part < 4; part++) {
      const length = bytes.readUInt32LE(at);
      parts.push(bytes.subarray(at + 4, at + 4 + length));
      at += 4 + length;
    }
    const [pattern, flags, text, ours] = parts.map(String);
    const key = [pattern, flags, text].join("\0");
    if (seen.has(key) || !parts[0].equals(Buffer.from(pattern)) || !parts[2].equals(Buffer.from(text))) continue;
    seen.add(key);
    const theirs = await ask({ pattern, flags, text });
    const kind = it => (/^\d/.test(it) ? "match" : it);
    const verdict = ours == theirs ? "same" : `we: ${kind(ours)}, they: ${kind(theirs)}`;
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
    if (verdict != "same") differences.push({ verdict, pattern, flags, text, ours, theirs });
  }
  worker?.terminate();
  for (const [verdict, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(8), verdict);
  differences.sort((a, b) => a.pattern.length + a.text.length - b.pattern.length - b.text.length);
  if (out) fs.writeFileSync(out, differences.map(it => JSON.stringify(it) + "\n").join(""));
}
