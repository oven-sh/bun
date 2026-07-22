// Self-verifying compression round-trips. Incompressible + structured
// payloads go through every compressor bun ships (zlib gzip/deflate/brotli
// via node:zlib streams and one-shot, Bun.gzipSync/deflateSync/zstd where
// present, CompressionStream/DecompressionStream), get decompressed, and are
// hash-compared with the original. Compression internals size buffers from
// stream chunks, so a short/partial transfer in the pipeline that the
// compressor mishandles yields a wrong-but-plausible output - exactly the
// silent-corruption class only a hash oracle catches.
import zlib from "node:zlib";
import { promisify } from "node:util";
console.log("STAGE: setup");
let corrupt = 0;
const fail = msg => {
  corrupt++;
  console.log(`WSF-CORRUPTION: ${msg}`);
};
const sha = data => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const payload = (n, seed) => {
  const b = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    b[i] = s >>> 24;
  }
  return b;
};
// two shapes: incompressible random, and highly repetitive text
const inputs = [
  { name: "rand-1", data: payload(1, 1) },
  { name: "rand-64k", data: payload(65536, 2) },
  { name: "rand-1m", data: payload(1048583, 3) },
  { name: "text-200k", data: Buffer.from("the quick brown fox jumps over the lazy dog. ".repeat(4650)) },
  { name: "zeros-512k", data: new Uint8Array(524288) },
];
for (const inp of inputs) inp.hex = sha(inp.data);
const check = (label, inp, out) => {
  if (sha(out) !== inp.hex) fail(`${label} ${inp.name}: round-trip mismatch (${out.length} vs ${inp.data.length})`);
};

// --- one-shot node:zlib -----------------------------------------------------
console.log("STAGE: zlib-oneshot");
const gz = promisify(zlib.gzip), gunz = promisify(zlib.gunzip);
const df = promisify(zlib.deflate), inf = promisify(zlib.inflate);
const br = promisify(zlib.brotliCompress), unbr = promisify(zlib.brotliDecompress);
for (const inp of inputs) {
  check("gzip", inp, await gunz(await gz(inp.data)));
  check("deflate", inp, await inf(await df(inp.data)));
  check("brotli", inp, await unbr(await br(inp.data)));
}

// --- Bun native one-shots ---------------------------------------------------
console.log("STAGE: bun-oneshot");
for (const inp of inputs) {
  check("Bun.gzipSync", inp, Bun.gunzipSync(Bun.gzipSync(inp.data)));
  check("Bun.deflateSync", inp, Bun.inflateSync(Bun.deflateSync(inp.data)));
  if (Bun.zstdCompressSync) check("Bun.zstd", inp, Bun.zstdDecompressSync(Bun.zstdCompressSync(inp.data)));
}

// --- streaming node:zlib with tiny chunks (buffer-sizing paths) -----------
console.log("STAGE: zlib-stream");
const streamRoundTrip = async (inp, make, unmake) => {
  const compressed = await new Promise((res, rej) => {
    const c = make({ chunkSize: 512 });
    const parts = [];
    c.on("data", d => parts.push(d));
    c.on("end", () => res(Buffer.concat(parts)));
    c.on("error", rej);
    for (let o = 0; o < inp.data.length; o += 4096) c.write(inp.data.subarray(o, o + 4096));
    c.end();
  });
  return await new Promise((res, rej) => {
    const d = unmake({ chunkSize: 512 });
    const parts = [];
    d.on("data", x => parts.push(x));
    d.on("end", () => res(Buffer.concat(parts)));
    d.on("error", rej);
    for (let o = 0; o < compressed.length; o += 1024) d.write(compressed.subarray(o, o + 1024));
    d.end();
  });
};
for (const inp of inputs) {
  check("stream-gzip", inp, await streamRoundTrip(inp, zlib.createGzip, zlib.createGunzip));
  check("stream-brotli", inp, await streamRoundTrip(inp, zlib.createBrotliCompress, zlib.createBrotliDecompress));
}

// --- web CompressionStream / DecompressionStream ---------------------------
console.log("STAGE: web-compress");
const webRoundTrip = async (inp, format) => {
  const src = new Blob([inp.data]).stream();
  const compressed = src.pipeThrough(new CompressionStream(format));
  const restored = compressed.pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(restored).arrayBuffer());
};
for (const inp of inputs) {
  check("CompressionStream-gzip", inp, await webRoundTrip(inp, "gzip"));
  check("CompressionStream-deflate", inp, await webRoundTrip(inp, "deflate"));
}

console.log(`compression-roundtrip ok inputs=${inputs.length} corrupt=${corrupt}`);
