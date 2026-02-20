import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/8886
// deflateSync ignores the windowBits parameter.

test("deflateSync respects windowBits: -15 (raw deflate)", () => {
  const input = new Uint8Array([0x12, 0x01, 0x03, 0x05, 0x05]);

  // windowBits: -15 should produce raw deflate (no zlib header)
  const compressed = Bun.deflateSync(input, { windowBits: -15 });
  // Raw deflate data should NOT start with 0x78 (zlib header)
  expect(compressed[0]).not.toBe(0x78);

  // inflateSync with matching windowBits should decompress it
  const decompressed = Bun.inflateSync(compressed, { windowBits: -15 });
  expect(Buffer.from(decompressed)).toEqual(Buffer.from(input));
});

test("deflateSync with windowBits: 15 produces zlib-wrapped output", () => {
  const input = new Uint8Array([0x12, 0x01, 0x03, 0x05, 0x05]);

  // windowBits: 15 should produce zlib-wrapped format (starts with 0x78)
  const compressed = Bun.deflateSync(input, { windowBits: 15 });
  expect(compressed[0]).toBe(0x78);

  // inflateSync with windowBits: 15 should decompress it
  const decompressed = Bun.inflateSync(compressed, { windowBits: 15 });
  expect(Buffer.from(decompressed)).toEqual(Buffer.from(input));
});

test("deflateSync with windowBits: 31 produces gzip output", () => {
  const input = new Uint8Array([0x12, 0x01, 0x03, 0x05, 0x05]);

  // windowBits: 31 (15 + 16) should produce gzip format (starts with 0x1f 0x8b)
  const compressed = Bun.deflateSync(input, { windowBits: 31 });
  expect(compressed[0]).toBe(0x1f);
  expect(compressed[1]).toBe(0x8b);

  // gunzipSync should decompress it
  const decompressed = Bun.gunzipSync(compressed);
  expect(Buffer.from(decompressed)).toEqual(Buffer.from(input));
});

test("deflateSync/inflateSync roundtrip without options (raw deflate default)", () => {
  const input = new Uint8Array([0x12, 0x01, 0x03, 0x05, 0x05]);

  // Default deflateSync produces raw deflate, inflateSync expects raw deflate
  const compressed = Bun.deflateSync(input);
  const decompressed = Bun.inflateSync(compressed);
  expect(Buffer.from(decompressed)).toEqual(Buffer.from(input));
});

test("deflateSync/inflateSync roundtrip with windowBits: -15", () => {
  const input = new Uint8Array([0x12, 0x01, 0x03, 0x05, 0x05]);

  // Raw deflate roundtrip
  const compressed = Bun.deflateSync(input, { windowBits: -15 });
  const decompressed = Bun.inflateSync(compressed, { windowBits: -15 });
  expect(Buffer.from(decompressed)).toEqual(Buffer.from(input));
});

test("different windowBits produce different output", () => {
  const input = new Uint8Array([0x12, 0x01, 0x03, 0x05, 0x05]);

  const raw = Bun.deflateSync(input, { windowBits: -15 });
  const zlib = Bun.deflateSync(input, { windowBits: 15 });
  const gzip = Bun.deflateSync(input, { windowBits: 31 });

  // All three should produce different output because of different headers
  const rawHex = Buffer.from(raw).toString("hex");
  const zlibHex = Buffer.from(zlib).toString("hex");
  const gzipHex = Buffer.from(gzip).toString("hex");

  expect(rawHex).not.toBe(zlibHex);
  expect(rawHex).not.toBe(gzipHex);
  expect(zlibHex).not.toBe(gzipHex);
});

test("gzipSync/gunzipSync still work correctly", () => {
  const input = new Uint8Array([0x12, 0x01, 0x03, 0x05, 0x05]);

  // gzipSync should produce gzip format
  const compressed = Bun.gzipSync(input);
  expect(compressed[0]).toBe(0x1f);
  expect(compressed[1]).toBe(0x8b);

  // gunzipSync should decompress it
  const decompressed = Bun.gunzipSync(compressed);
  expect(Buffer.from(decompressed)).toEqual(Buffer.from(input));
});

test("inflateSync with windowBits: 47 (auto-detect) handles both formats", () => {
  const input = new Uint8Array([0x12, 0x01, 0x03, 0x05, 0x05]);

  // windowBits: 47 (15 + 32) enables auto-detection of zlib/gzip
  const zlibData = Bun.deflateSync(input, { windowBits: 15 });
  const gzipData = Bun.gzipSync(input);

  const fromZlib = Bun.inflateSync(zlibData, { windowBits: 47 });
  const fromGzip = Bun.inflateSync(gzipData, { windowBits: 47 });

  expect(Buffer.from(fromZlib)).toEqual(Buffer.from(input));
  expect(Buffer.from(fromGzip)).toEqual(Buffer.from(input));
});

test("deflateSync with larger data and windowBits: -15", () => {
  // Test with larger data to ensure compression actually works
  const input = Buffer.from("Hello, World! ".repeat(100));

  const compressed = Bun.deflateSync(input, { level: 9, windowBits: -15 });
  expect(compressed.length).toBeLessThan(input.length);

  const decompressed = Bun.inflateSync(compressed, { windowBits: -15 });
  expect(Buffer.from(decompressed)).toEqual(input);
});

test("deflateSync with larger data and windowBits: 15 (zlib-wrapped)", () => {
  const input = Buffer.from("Hello, World! ".repeat(100));

  const compressed = Bun.deflateSync(input, { level: 9, windowBits: 15 });
  expect(compressed[0]).toBe(0x78);
  expect(compressed.length).toBeLessThan(input.length);

  const decompressed = Bun.inflateSync(compressed, { windowBits: 15 });
  expect(Buffer.from(decompressed)).toEqual(input);
});
