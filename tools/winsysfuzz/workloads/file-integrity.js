// Self-verifying file I/O across every Bun/node file API surface. Each write
// path produces content whose SHA-256 is known in advance; each read path
// hashes what it got back. A short/partial/corrupt transfer that the
// runtime swallows shows up as a hash mismatch and prints a WSF-CORRUPTION
// signature (the crash-oracle class) - a wrong answer that would otherwise
// pass silently. Content is pseudo-random and incompressible so a truncation
// or byte flip can't accidentally still hash right.
import { createReadStream, createWriteStream, promises as fsp, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
console.log("STAGE: setup");
const dir = "wsf-fint";
await fsp.mkdir(dir, { recursive: true });

// Deterministic incompressible payload of exactly n bytes (LCG bytes).
const payload = (n, seed) => {
  const b = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    b[i] = s >>> 24;
  }
  return b;
};
const sha = data => new Bun.CryptoHasher("sha256").update(data).digest("hex");
let corrupt = 0;
const check = (label, expectHex, gotBytes) => {
  const gotHex = sha(gotBytes);
  if (gotHex !== expectHex) {
    corrupt++;
    console.log(
      `WSF-CORRUPTION: ${label} hash mismatch (want ${expectHex.slice(0, 12)} got ${gotHex.slice(0, 12)}, ${gotBytes.length} bytes)`,
    );
  }
};

// Sizes chosen to straddle buffer/chunk boundaries where short transfers bite.
const sizes = [1, 4095, 4096, 4097, 65535, 65536, 65537, 262144 + 3, 1048576 + 7];
const files = sizes.map((n, i) => ({ n, seed: 100 + i, path: join(dir, `f${i}.bin`) }));
for (const f of files) f.data = payload(f.n, f.seed);
for (const f of files) f.hex = sha(f.data);

// --- writers: three independent paths ------------------------------------
console.log("STAGE: write");
for (const [i, f] of files.entries()) {
  if (i % 3 === 0) writeFileSync(f.path, f.data);
  else if (i % 3 === 1) await Bun.write(f.path, f.data);
  else
    await new Promise((res, rej) => {
      const ws = createWriteStream(f.path);
      ws.on("error", rej);
      ws.on("finish", res);
      // chunked writes exercise the stream's own buffering/retry path
      for (let o = 0; o < f.data.length; o += 8192) ws.write(f.data.subarray(o, o + 8192));
      ws.end();
    });
}

// --- readers: four independent paths, every file through every path --
console.log("STAGE: read-sync");
for (const f of files) check(`readFileSync ${f.n}`, f.hex, readFileSync(f.path));

console.log("STAGE: read-bunfile");
for (const f of files) check(`Bun.file.bytes ${f.n}`, f.hex, await Bun.file(f.path).bytes());

console.log("STAGE: read-fsp");
for (const f of files) check(`fsp.readFile ${f.n}`, f.hex, await fsp.readFile(f.path));

console.log("STAGE: read-stream");
for (const f of files) {
  const chunks = [];
  await new Promise((res, rej) => {
    const rs = createReadStream(f.path, { highWaterMark: 16384 });
    rs.on("data", c => chunks.push(c));
    rs.on("error", rej);
    rs.on("end", res);
  });
  check(`createReadStream ${f.n}`, f.hex, Buffer.concat(chunks));
}

// --- copy + slice paths ---------------------------------------------------
console.log("STAGE: copy");
for (const f of files.slice(0, 4)) {
  const dst = f.path + ".copy";
  await fsp.copyFile(f.path, dst);
  check(`copyFile ${f.n}`, f.hex, await Bun.file(dst).bytes());
  // Bun.write(file, file) fast path
  const dst2 = f.path + ".bwcopy";
  await Bun.write(dst2, Bun.file(f.path));
  check(`Bun.write(file,file) ${f.n}`, f.hex, await Bun.file(dst2).bytes());
}
console.log("STAGE: slice");
{
  const f = files[files.length - 1]; // big one
  const half = Math.floor(f.n / 2);
  const got = await Bun.file(f.path).slice(0, half).bytes();
  check(`Bun.file.slice head`, sha(f.data.subarray(0, half)), got);
  const got2 = await Bun.file(f.path).slice(half).bytes();
  check(`Bun.file.slice tail`, sha(f.data.subarray(half)), got2);
}

console.log("STAGE: cleanup");
await fsp.rm(dir, { recursive: true, force: true });
console.log(`file-integrity ok files=${files.length} corrupt=${corrupt}`);
