import { describe, expect, test } from "bun:test";
import { deflateSync as nodeDeflateSync } from "node:zlib";

describe("Bun.inflateSync windowBits", () => {
  test("0 reads window size from zlib header", () => {
    // node:zlib deflateSync produces a zlib-wrapped stream (78 xx header + adler32 trailer).
    // Bun.inflateSync defaults to raw deflate and cannot decode this without windowBits:0,
    // which per zlib.h inflateInit2 docs means "use the window size in the zlib header".
    const input = "hello zlib wrapped stream";
    const wrapped = nodeDeflateSync(input);

    expect(wrapped[0]).toBe(0x78); // zlib magic

    // Without windowBits:0, the zlib header is interpreted as deflate data and fails
    expect(() => Bun.inflateSync(wrapped)).toThrow();

    // With windowBits:0, the header is read and the stream decodes
    const out = Bun.inflateSync(wrapped, { windowBits: 0 });
    expect(new TextDecoder().decode(out)).toBe(input);
  });

  test("0 works across all zlib compression levels", () => {
    // Each level produces a different 2-byte header (78 01 / 78 9c / 78 da).
    // windowBits:0 reads the header regardless of which level wrote it.
    const input = "test";
    for (const level of [1, 6, 9] as const) {
      const wrapped = nodeDeflateSync(input, { level });
      const out = Bun.inflateSync(wrapped, { windowBits: 0 });
      expect(new TextDecoder().decode(out)).toBe(input);
    }
  });

  test("raw deflate still round-trips with no options", () => {
    // Bun.deflateSync produces raw deflate (no zlib header). Unchanged by this PR.
    const input = "round trip";
    const raw = Bun.deflateSync(input);
    expect(raw[0]).not.toBe(0x78);
    expect(new TextDecoder().decode(Bun.inflateSync(raw))).toBe(input);
  });
});
