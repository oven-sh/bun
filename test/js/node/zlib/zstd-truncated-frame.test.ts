import { describe, expect, it } from "bun:test";
import * as util from "node:util";
import * as zlib from "node:zlib";

// `ZSTD_decompressStream` reports a complete frame by returning 0 and reports a
// truncated one by never returning 0, so the decoder has to raise the truncation
// itself at the finishing flush the way inflate and the brotli decoder do.
describe("zstd decompression of a frame that ends mid-stream", () => {
  const original = Buffer.alloc(1140, "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ");
  const frame = zlib.zstdCompressSync(original);
  const truncated = frame.subarray(0, frame.length - 10);

  function thrownBy(fn: () => unknown) {
    try {
      fn();
    } catch (err: any) {
      return { message: err.message, code: err.code, errno: err.errno };
    }
    return { threw: false };
  }

  it("zstdDecompressSync rejects a truncated frame", () => {
    expect(thrownBy(() => zlib.zstdDecompressSync(truncated))).toEqual({
      message: "unexpected end of file",
      code: "Z_BUF_ERROR",
      errno: -5,
    });
  });

  it("zstdDecompressSync rejects an empty input", () => {
    expect(thrownBy(() => zlib.zstdDecompressSync(Buffer.alloc(0)))).toEqual({
      message: "unexpected end of file",
      code: "Z_BUF_ERROR",
      errno: -5,
    });
  });

  it("createZstdDecompress emits the error instead of ending cleanly", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    const decoder = zlib.createZstdDecompress();
    decoder.on("error", resolve);
    decoder.on("end", () => reject(new Error("stream ended cleanly on a truncated frame")));
    decoder.resume();
    decoder.end(truncated);

    const err = await promise;
    expect({ message: err.message, code: err.code, errno: err.errno }).toEqual({
      message: "unexpected end of file",
      code: "Z_BUF_ERROR",
      errno: -5,
    });
  });

  it("finishFlush: ZSTD_e_continue still hands back what was decoded", () => {
    // One block's worth of input decodes to nothing once its tail is cut off,
    // so use enough input to leave whole blocks behind.
    const big = Buffer.alloc(1 << 20, "hello world ");
    const bigFrame = zlib.zstdCompressSync(big);
    const partial = zlib.zstdDecompressSync(bigFrame.subarray(0, bigFrame.length - 10), {
      finishFlush: zlib.constants.ZSTD_e_continue,
    });

    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(big.length);
    expect(partial.equals(big.subarray(0, partial.length))).toBe(true);
  });

  it("a frame that encodes zero bytes is not a truncated frame", () => {
    expect(zlib.zstdDecompressSync(zlib.zstdCompressSync(Buffer.alloc(0)))).toEqual(Buffer.alloc(0));
  });

  it("a frame whose output spans many chunks is not a truncated frame", async () => {
    // The finishing flush is re-driven once per 16 KiB of output, so the check
    // must wait until the decoder stops asking for more output room.
    const big = Buffer.alloc(1 << 20, "hello world ");
    const bigFrame = zlib.zstdCompressSync(big);
    expect(zlib.zstdDecompressSync(bigFrame).equals(big)).toBe(true);
    expect((await util.promisify(zlib.zstdDecompress)(bigFrame)).equals(big)).toBe(true);

    const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
    const decoder = zlib.createZstdDecompress();
    const chunks: Buffer[] = [];
    decoder.on("data", chunk => chunks.push(chunk));
    decoder.on("end", () => resolve(Buffer.concat(chunks)));
    decoder.on("error", reject);
    for (let i = 0; i < bigFrame.length; i += 7) decoder.write(bigFrame.subarray(i, i + 7));
    decoder.end();

    expect((await promise).equals(big)).toBe(true);
  });

  it("a complete frame followed by trailing bytes is not a truncated frame", () => {
    const withTrailer = Buffer.concat([frame, Buffer.from("not valid compressed data")]);
    expect(zlib.zstdDecompressSync(withTrailer).equals(original)).toBe(true);
  });
});
