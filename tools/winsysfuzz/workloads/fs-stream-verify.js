// Stateful file/stream workload: write many files through several paths
// (writeFileSync, Bun.write, a writable stream), then read every one back
// through several paths (readFileSync, Bun.file().text(), a stream) and
// verify byte-for-byte. A garbage or short-transfer fault that produces a
// wrong-but-successful read/write shows up as WSF-CORRUPTION.
import { createReadStream, createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
console.log("STAGE: setup");
const dir = "wsf-fs-verify";
mkdirSync(dir, { recursive: true });
const files = [];
const mk = i => Array.from({ length: 300 + i * 53 }, (_, j) => `${i}:${j};`).join("");
console.log("STAGE: write");
for (let i = 0; i < 12; i++) {
  const content = mk(i);
  const name = `${dir}/f${i}.txt`;
  if (i % 3 === 0) writeFileSync(name, content);
  else if (i % 3 === 1) await Bun.write(name, content);
  else {
    await new Promise((res, rej) => {
      const ws = createWriteStream(name);
      ws.on("finish", res).on("error", rej);
      // chunked writes exercise the stream/pipe path
      for (let c = 0; c < content.length; c += 128) ws.write(content.slice(c, c + 128));
      ws.end();
    });
  }
  files.push({ name, content });
}
console.log("STAGE: read");
let corrupt = 0;
for (const [i, f] of files.entries()) {
  let got;
  try {
    if (i % 3 === 0) got = readFileSync(f.name, "utf8");
    else if (i % 3 === 1) got = await Bun.file(f.name).text();
    else {
      const chunks = [];
      await new Promise((res, rej) => {
        createReadStream(f.name).on("data", d => chunks.push(d)).on("end", res).on("error", rej);
      });
      got = Buffer.concat(chunks).toString("utf8");
    }
  } catch (e) {
    continue; // an error is fine under fault; wrong data is not
  }
  if (got.length !== f.content.length) {
    console.log(`WSF-CORRUPTION: ${f.name} length ${got.length} != ${f.content.length}`);
    corrupt++;
  } else if (got !== f.content) {
    console.log(`WSF-CORRUPTION: ${f.name} content mismatch`);
    corrupt++;
  }
}
console.log("STAGE: verify");
console.log(`fs-stream-verify ok files=${files.length} corrupt=${corrupt}`);
