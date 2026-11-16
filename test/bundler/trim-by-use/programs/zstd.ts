import { zstdCompressSync, zstdDecompressSync, createZstdCompress } from "node:zlib";

const text = "zstd ".repeat(2000);
const bytes = new TextEncoder().encode(text);
const decode = (packed: Uint8Array) => new TextDecoder().decode(Bun.zstdDecompressSync(packed)) === text;

const sync = Bun.zstdCompressSync(bytes, { level: 19 });
console.log("Bun.zstdCompressSync", sync.length, Bun.hash.crc32(sync), decode(sync));
const later = await Bun.zstdCompress(bytes);
console.log("Bun.zstdCompress", later.length, decode(later));
const node = zstdCompressSync(bytes);
console.log("node:zlib zstdCompressSync", node.length, zstdDecompressSync(node).toString() === text);
const stream = createZstdCompress();
const chunks: Buffer[] = [];
stream.on("data", (chunk: Buffer) => chunks.push(chunk));
const ended = new Promise(resolve => stream.on("end", resolve));
stream.end(bytes);
await ended;
console.log("node:zlib createZstdCompress", decode(Buffer.concat(chunks)));
const web = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("zstd" as any))).bytes();
console.log("CompressionStream", web.length, decode(web));
