import { brotliCompressSync, brotliDecompressSync, createBrotliCompress, constants } from "node:zlib";

const text = "brotli ".repeat(3000);
const packed = brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
console.log(
  "brotliCompressSync",
  packed.length,
  Bun.hash.crc32(packed),
  brotliDecompressSync(packed).toString() === text,
);
const stream = createBrotliCompress();
const chunks: Buffer[] = [];
stream.on("data", (chunk: Buffer) => chunks.push(chunk));
const ended = new Promise(resolve => stream.on("end", resolve));
stream.end(text);
await ended;
console.log("createBrotliCompress", brotliDecompressSync(Buffer.concat(chunks)).toString() === text);
const web = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("brotli" as any))).bytes();
console.log(
  "CompressionStream",
  web.length,
  (await new Response(new Blob([web]).stream().pipeThrough(new DecompressionStream("brotli" as any))).text()) === text,
);
