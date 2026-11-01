import { gzipSync, gunzipSync, deflateRawSync, inflateRawSync, createGzip, crc32 } from "node:zlib";

const text = "deflate ".repeat(3000);
const bytes = new TextEncoder().encode(text);
const same = (unpacked: Uint8Array) => new TextDecoder().decode(unpacked) === text;

const gz = Bun.gzipSync(bytes);
console.log("Bun.gzipSync", gz.length, same(Bun.gunzipSync(gz)));
const raw = Bun.deflateSync(bytes, { level: 9 });
console.log("Bun.deflateSync", raw.length, same(Bun.inflateSync(raw)));
const byZlib = Bun.gzipSync(bytes, { library: "zlib" });
console.log("Bun.gzipSync zlib", byZlib.length, same(Bun.gunzipSync(byZlib, { library: "zlib" })));
console.log(
  "node:zlib",
  gzipSync(bytes).length,
  same(gunzipSync(gzipSync(bytes))),
  same(inflateRawSync(deflateRawSync(bytes))),
  crc32(bytes),
);
const stream = createGzip();
const chunks: Buffer[] = [];
stream.on("data", (chunk: Buffer) => chunks.push(chunk));
const ended = new Promise(resolve => stream.on("end", resolve));
stream.end(bytes);
await ended;
console.log("createGzip", same(Bun.gunzipSync(Buffer.concat(chunks))));
const web = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).bytes();
console.log(
  "CompressionStream",
  web.length,
  (await new Response(new Blob([web]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) === text,
);
