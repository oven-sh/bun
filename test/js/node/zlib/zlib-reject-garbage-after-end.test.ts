import { describe, expect, it } from "bun:test";
import type { Transform } from "node:stream";
import zlib from "node:zlib";

// `rejectGarbageAfterEnd` is the (undocumented) option node's DecompressionStream
// passes to every decompressor so that trailing data after the end of the
// compressed stream errors instead of being silently dropped.
describe("rejectGarbageAfterEnd", () => {
  const input = "0123456789".repeat(4);
  const trailingJunk = Buffer.from("not valid compressed data");

  type Decompressor = (options?: any) => Transform;
  const cases: [name: string, create: Decompressor, makeData: () => Buffer][] = [
    ["createInflate", zlib.createInflate, () => Buffer.concat([zlib.deflateSync(input), trailingJunk])],
    ["createInflateRaw", zlib.createInflateRaw, () => Buffer.concat([zlib.deflateRawSync(input), trailingJunk])],
    [
      "createBrotliDecompress",
      zlib.createBrotliDecompress,
      () => Buffer.concat([zlib.brotliCompressSync(input), trailingJunk]),
    ],
    [
      "createZstdDecompress",
      zlib.createZstdDecompress,
      () => Buffer.concat([zlib.zstdCompressSync(input), trailingJunk]),
    ],
    // Gunzip feeds non-zero trailing bytes back to zlib as a second member
    // (which fails with Z_DATA_ERROR on its own), so only trailing zero-byte
    // padding reaches the rejectGarbageAfterEnd check.
    ["createGunzip", zlib.createGunzip, () => Buffer.concat([zlib.gzipSync(input), Buffer.alloc(4)])],
  ];

  function decompress(
    create: Decompressor,
    options: Record<string, unknown> | undefined,
    data: Buffer,
  ): Promise<{ output: string; error: (Error & { code?: string }) | null }> {
    const { promise, resolve } = Promise.withResolvers<{ output: string; error: Error | null }>();
    const stream = create(options);
    let output = "";
    stream.setEncoding("utf8");
    stream.on("data", chunk => (output += chunk));
    stream.on("error", error => resolve({ output, error }));
    stream.on("end", () => resolve({ output, error: null }));
    stream.end(data);
    return promise;
  }

  for (const [name, create, makeData] of cases) {
    it(`${name} emits ERR_TRAILING_JUNK_AFTER_STREAM_END when enabled`, async () => {
      const { output, error } = await decompress(create, { rejectGarbageAfterEnd: true }, makeData());
      expect(error).toBeInstanceOf(TypeError);
      expect(error!.code).toBe("ERR_TRAILING_JUNK_AFTER_STREAM_END");
      expect(error!.message).toBe("Trailing junk found after the end of the compressed stream");
      expect(output).toBe(input);
    });

    it(`${name} keeps ending early without an error by default`, async () => {
      const { output, error } = await decompress(create, undefined, makeData());
      expect(error).toBe(null);
      expect(output).toBe(input);
    });
  }

  it("createGunzip still accepts concatenated members when enabled", async () => {
    const data = Buffer.concat([zlib.gzipSync(input), zlib.gzipSync(input)]);
    const { output, error } = await decompress(zlib.createGunzip, { rejectGarbageAfterEnd: true }, data);
    expect(error).toBe(null);
    expect(output).toBe(input + input);
  });
});
