// Bun.gzipSync | gunzipSync | deflateSync | inflateSync | zstdCompress(Sync) | zstdDecompress(Sync)
const text = "compress me ".repeat(50);
const bytes = new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);
console.log(
  decode(Bun.gunzipSync(Bun.gzipSync(bytes))) === text,
  decode(Bun.inflateSync(Bun.deflateSync(bytes))) === text,
  Bun.gzipSync(bytes).length < bytes.length,
);
console.log(
  decode(Bun.zstdDecompressSync(Bun.zstdCompressSync(bytes))) === text,
  decode(await Bun.zstdDecompress(await Bun.zstdCompress(bytes))) === text,
);
try {
  Bun.gunzipSync(new Uint8Array([1, 2, 3]));
} catch (error) {
  console.log((error as Error).name);
}
