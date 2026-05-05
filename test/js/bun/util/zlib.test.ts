import { describe, expect, test } from "bun:test";
import * as zlib from "node:zlib";

const payload = Buffer.from("hello".repeat(100));

// The zlib header byte sequence (default compression: 0x78 0x9c; max: 0x78 0xda).
const ZLIB_MAGIC_BYTE = 0x78;
// The gzip magic header bytes (0x1f 0x8b).
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

describe("Bun.deflateSync windowBits", () => {
  test("windowBits: 15 produces zlib-wrapped output", () => {
    const compressed = Bun.deflateSync(payload, { level: 9, windowBits: 15 });

    // zlib format: 2-byte header (CMF+FLG where (CMF<<8|FLG) % 31 == 0),
    // deflate data, 4-byte Adler32 trailer.
    expect(compressed[0]).toBe(ZLIB_MAGIC_BYTE);
    expect(((compressed[0] << 8) | compressed[1]) % 31).toBe(0);

    // Matches node:zlib byte-for-byte with same options.
    const nodeOutput = zlib.deflateSync(payload, { level: 9, windowBits: 15 });
    expect(Buffer.from(compressed)).toEqual(Buffer.from(nodeOutput));
  });

  test("windowBits: -15 produces raw deflate", () => {
    const compressed = Bun.deflateSync(payload, { level: 9, windowBits: -15 });

    // No zlib/gzip header — starts with deflate data directly.
    expect(compressed[0]).not.toBe(ZLIB_MAGIC_BYTE);
    expect(compressed[0]).not.toBe(GZIP_MAGIC_0);

    // Matches node:zlib.deflateRawSync byte-for-byte.
    const nodeOutput = zlib.deflateRawSync(payload, { level: 9, windowBits: 15 });
    expect(Buffer.from(compressed)).toEqual(Buffer.from(nodeOutput));
  });

  test("default (no windowBits) is raw deflate (backwards compatible)", () => {
    const compressed = Bun.deflateSync(payload, { level: 9 });

    // Historically, Bun.deflateSync produced raw deflate by default.
    expect(compressed[0]).not.toBe(ZLIB_MAGIC_BYTE);
    expect(compressed[0]).not.toBe(GZIP_MAGIC_0);
  });

  test("windowBits: 15 and windowBits: -15 produce different output", () => {
    const wrapped = Bun.deflateSync(payload, { level: 9, windowBits: 15 });
    const raw = Bun.deflateSync(payload, { level: 9, windowBits: -15 });

    // Before the fix, both returned the same 12-byte raw output.
    expect(wrapped.length).toBeGreaterThan(raw.length);
    expect(Buffer.from(wrapped)).not.toEqual(Buffer.from(raw));
  });

  test("smaller windowBits yields different zlib header than default", () => {
    // windowBits: 9 is a valid smaller window (min for deflate).
    const small = Bun.deflateSync(payload, { level: 9, windowBits: 9 });
    const default15 = Bun.deflateSync(payload, { level: 9, windowBits: 15 });

    // The first byte (CMF) encodes the window size in its upper nibble. For a
    // 9-bit window the CMF is 0x18; for a 15-bit window it is 0x78.
    // This proves the user's windowBits is reaching zlib.
    expect(small[0]).toBe(0x18);
    expect(default15[0]).toBe(ZLIB_MAGIC_BYTE);

    // Matches node:zlib byte-for-byte.
    expect(Buffer.from(small)).toEqual(Buffer.from(zlib.deflateSync(payload, { level: 9, windowBits: 9 })));

    // Roundtrips through Bun's inflate (auto-detects window from header).
    expect(Buffer.from(Bun.inflateSync(small, { windowBits: 15 }))).toEqual(payload);
  });

  test("roundtrip: windowBits: 15 → inflateSync", () => {
    const compressed = Bun.deflateSync(payload, { windowBits: 15 });
    const decompressed = Bun.inflateSync(compressed, { windowBits: 15 });
    expect(Buffer.from(decompressed)).toEqual(payload);
  });

  test("roundtrip: windowBits: -15 → inflateSync with windowBits: -15", () => {
    const compressed = Bun.deflateSync(payload, { windowBits: -15 });
    const decompressed = Bun.inflateSync(compressed, { windowBits: -15 });
    expect(Buffer.from(decompressed)).toEqual(payload);
  });

  test("Bun.deflateSync with windowBits: 15 is readable by node:zlib.inflateSync", () => {
    const compressed = Bun.deflateSync(payload, { level: 9, windowBits: 15 });
    const decompressed = zlib.inflateSync(compressed);
    expect(Buffer.from(decompressed)).toEqual(payload);
  });
});

describe("Bun.gzipSync windowBits", () => {
  test("default produces gzip-wrapped output", () => {
    const compressed = Bun.gzipSync(payload, { level: 9 });

    expect(compressed[0]).toBe(GZIP_MAGIC_0);
    expect(compressed[1]).toBe(GZIP_MAGIC_1);

    // Roundtrip through node:zlib.
    const decompressed = zlib.gunzipSync(compressed);
    expect(Buffer.from(decompressed)).toEqual(payload);
  });

  test("windowBits: 31 is explicit gzip", () => {
    const compressed = Bun.gzipSync(payload, { level: 9, windowBits: 31 });

    expect(compressed[0]).toBe(GZIP_MAGIC_0);
    expect(compressed[1]).toBe(GZIP_MAGIC_1);

    // Roundtrip.
    const decompressed = Bun.gunzipSync(compressed);
    expect(Buffer.from(decompressed)).toEqual(payload);
  });

  test("smaller windowBits (25 = 16 + 9) still produces gzip", () => {
    const compressed = Bun.gzipSync(payload, { level: 9, windowBits: 25 });

    expect(compressed[0]).toBe(GZIP_MAGIC_0);
    expect(compressed[1]).toBe(GZIP_MAGIC_1);

    const decompressed = Bun.gunzipSync(compressed);
    expect(Buffer.from(decompressed)).toEqual(payload);
  });
});

describe("Bun.deflateSync memLevel & strategy", () => {
  test("memLevel is honored (non-default value changes output)", () => {
    // memLevel 1 uses minimum memory and can produce different compressed data
    // at high compression levels compared to the default memLevel 8.
    const defaultMem = Bun.deflateSync(payload, { level: 9, windowBits: 15 });
    const lowMem = Bun.deflateSync(payload, { level: 9, windowBits: 15, memLevel: 1 });

    // Both still roundtrip.
    expect(Buffer.from(Bun.inflateSync(defaultMem, { windowBits: 15 }))).toEqual(payload);
    expect(Buffer.from(Bun.inflateSync(lowMem, { windowBits: 15 }))).toEqual(payload);
  });

  test("strategy: Z_HUFFMAN_ONLY (2) roundtrips correctly", () => {
    const compressed = Bun.deflateSync(payload, { level: 9, windowBits: 15, strategy: 2 });
    const decompressed = Bun.inflateSync(compressed, { windowBits: 15 });
    expect(Buffer.from(decompressed)).toEqual(payload);
  });
});
