// Tests for Bun.deflateSync / Bun.gzipSync / Bun.inflateSync / Bun.gunzipSync.
//
// Issue #30276: `windowBits` was parsed but discarded on the compress path,
// so `Bun.deflateSync(buf, {windowBits: 15})` produced raw deflate instead of
// zlib-wrapped output. The fix passes `windowBits` (and `memLevel`/`strategy`)
// straight through to `deflateInit2_` and adjusts only when needed to mirror
// node:zlib's Gzip/Gunzip wrapper conventions.

import { describe, expect, test } from "bun:test";
import * as zlib from "node:zlib";

// `"hello".repeat(...)` is intentionally avoided in the debug build; this is
// large enough to exercise the >64-byte / >512-byte allocation branches and
// still cheap.
const payload = Buffer.alloc(500, "hello");

const ZLIB_HEADER_BYTE_0 = 0x78; // CMF for a 32K window at default/max compression.
const GZIP_HEADER_BYTE_0 = 0x1f;
const GZIP_HEADER_BYTE_1 = 0x8b;

describe("Bun.deflateSync windowBits (issue #30276)", () => {
  test("windowBits: 15 produces zlib-wrapped output that matches node:zlib", () => {
    // Before the fix this returned the same 12-byte raw deflate as windowBits: -15.
    const compressed = Bun.deflateSync(payload, { level: 9, windowBits: 15 });

    // zlib format: 2-byte header where (CMF<<8 | FLG) is divisible by 31, then
    // deflate data, then a 4-byte Adler32 trailer.
    expect(compressed[0]).toBe(ZLIB_HEADER_BYTE_0);
    expect(((compressed[0] << 8) | compressed[1]) % 31).toBe(0);

    // Byte-for-byte parity with node:zlib using the same options is the strong
    // signal that windowBits actually reached deflateInit2_ — a roundtrip
    // through inflate would also pass if the option were silently dropped, as
    // long as the headers were self-consistent.
    expect(Buffer.from(compressed)).toEqual(zlib.deflateSync(payload, { level: 9, windowBits: 15 }));
  });

  test("windowBits: -15 produces raw deflate (matches node:zlib.deflateRawSync)", () => {
    const compressed = Bun.deflateSync(payload, { level: 9, windowBits: -15 });

    expect(compressed[0]).not.toBe(ZLIB_HEADER_BYTE_0);
    expect(compressed[0]).not.toBe(GZIP_HEADER_BYTE_0);

    // node:zlib.deflateRawSync internally negates windowBits.
    expect(Buffer.from(compressed)).toEqual(zlib.deflateRawSync(payload, { level: 9, windowBits: 15 }));
  });

  test("default (no options) is raw deflate — backwards compatible", () => {
    // `Bun.deflateSync(buf)` has always produced raw deflate; preserve that to
    // avoid breaking callers that pair it with `Bun.inflateSync(buf)` (also raw
    // by default).
    const compressed = Bun.deflateSync(payload);
    expect(compressed[0]).not.toBe(ZLIB_HEADER_BYTE_0);
    expect(compressed[0]).not.toBe(GZIP_HEADER_BYTE_0);
    expect(Buffer.from(Bun.inflateSync(compressed))).toEqual(payload);
  });

  test("windowBits: 15 vs -15 produce different output", () => {
    // The bug report's exact symptom: identical output regardless of sign.
    const wrapped = Bun.deflateSync(payload, { level: 9, windowBits: 15 });
    const raw = Bun.deflateSync(payload, { level: 9, windowBits: -15 });
    expect(wrapped.length).toBeGreaterThan(raw.length);
    expect(Buffer.from(wrapped)).not.toEqual(raw);
  });

  test("smaller windowBits changes the CMF byte", () => {
    // CMF's upper nibble is windowBits - 8; a 9-bit window encodes as 0x18,
    // a 15-bit window as 0x78. This proves the user's value reached zlib.
    const small = Bun.deflateSync(payload, { level: 9, windowBits: 9 });
    expect(small[0]).toBe(0x18);
    expect(Buffer.from(small)).toEqual(zlib.deflateSync(payload, { level: 9, windowBits: 9 }));
    expect(Buffer.from(Bun.inflateSync(small, { windowBits: 15 }))).toEqual(payload);
  });

  test("output is readable by node:zlib.inflateSync", () => {
    const compressed = Bun.deflateSync(payload, { level: 9, windowBits: 15 });
    expect(Buffer.from(zlib.inflateSync(compressed))).toEqual(payload);
  });
});

describe("Bun.deflateSync memLevel & strategy", () => {
  // Byte-for-byte equality against node:zlib with the same option proves the
  // value reached deflateInit2_ (a mere roundtrip would pass even if dropped).
  test("memLevel propagates to zlib", () => {
    const compressed = Bun.deflateSync(payload, { level: 9, windowBits: 15, memLevel: 1 });
    expect(Buffer.from(compressed)).toEqual(zlib.deflateSync(payload, { level: 9, windowBits: 15, memLevel: 1 }));
    expect(Buffer.from(Bun.inflateSync(compressed, { windowBits: 15 }))).toEqual(payload);
  });

  test("strategy propagates to zlib", () => {
    const compressed = Bun.deflateSync(payload, {
      level: 9,
      windowBits: 15,
      strategy: zlib.constants.Z_HUFFMAN_ONLY,
    });
    expect(Buffer.from(compressed)).toEqual(
      zlib.deflateSync(payload, { level: 9, windowBits: 15, strategy: zlib.constants.Z_HUFFMAN_ONLY }),
    );
    expect(Buffer.from(Bun.inflateSync(compressed, { windowBits: 15 }))).toEqual(payload);
  });
});

describe("Bun.gzipSync windowBits", () => {
  test("default produces gzip-wrapped output", () => {
    const compressed = Bun.gzipSync(payload, { level: 9 });
    expect(compressed[0]).toBe(GZIP_HEADER_BYTE_0);
    expect(compressed[1]).toBe(GZIP_HEADER_BYTE_1);
    expect(Buffer.from(zlib.gunzipSync(compressed))).toEqual(payload);
  });

  // Mirrors node:zlib's Gzip class: a windowBits in 8..15 stays in gzip mode
  // (the +16 is applied so 15 becomes 31). Without the adjustment, asking for
  // gzip with windowBits: 15 would silently produce zlib-wrapped output.
  test("windowBits: 15 stays in gzip mode and matches node:zlib", () => {
    const compressed = Bun.gzipSync(payload, { level: 9, windowBits: 15 });
    expect(compressed[0]).toBe(GZIP_HEADER_BYTE_0);
    expect(compressed[1]).toBe(GZIP_HEADER_BYTE_1);
    expect(Buffer.from(compressed)).toEqual(zlib.gzipSync(payload, { level: 9, windowBits: 15 }));
  });

  test("windowBits: 31 (explicit gzip) works", () => {
    const compressed = Bun.gzipSync(payload, { level: 9, windowBits: 31 });
    expect(compressed[0]).toBe(GZIP_HEADER_BYTE_0);
    expect(compressed[1]).toBe(GZIP_HEADER_BYTE_1);
    expect(Buffer.from(Bun.gunzipSync(compressed))).toEqual(payload);
  });
});

describe("Bun.gunzipSync windowBits", () => {
  // Mirror of the compress-side +16: a windowBits in 8..15 on gunzip must stay
  // in gunzip mode, otherwise zlib reads gzip bytes as zlib-wrapped and errors
  // with "incorrect header check".
  const gzipped = Bun.gzipSync(payload);

  test("windowBits: 15 decompresses gzip data (matches node:zlib)", () => {
    expect(Buffer.from(Bun.gunzipSync(gzipped, { windowBits: 15 }))).toEqual(payload);
    expect(zlib.gunzipSync(gzipped, { windowBits: 15 })).toEqual(payload);
  });
});

describe("Bun.deflateSync / Bun.inflateSync roundtrip", () => {
  test.each([-15, 15, 9, 11, 13] as const)("windowBits: %d", bits => {
    const compressed = Bun.deflateSync(payload, { windowBits: bits });
    const decompressed = Bun.inflateSync(compressed, { windowBits: bits });
    expect(Buffer.from(decompressed)).toEqual(payload);
  });
});
