import { describe, expect, test } from "bun:test";
import {
  deflateRawSync as nodeDeflateRawSync,
  deflateSync as nodeDeflateSync,
  gzipSync as nodeGzipSync,
  inflateSync as nodeInflateSync,
  constants as zlibConstants,
} from "node:zlib";

// Semi-compressible bytes: compressible enough that every tuning knob moves the
// output, incompressible enough that none of them collapse to the same answer.
function fixture() {
  const buf = Buffer.alloc(32768);
  for (let i = 0; i < buf.length; i++) buf[i] = (i % 251 ^ ((i / 7) | 0)) & 0xff;
  return buf;
}

const text = Buffer.from("Hello, World! ".repeat(100));

// `Bun.gzipSync` and `node:zlib` share the same linked zlib, so identical
// deflateInit2 arguments have to produce identical bytes. Bun's `windowBits` is
// the raw zlib value (the sign and the +16 offset pick the container format),
// while node derives it from the function name, hence the 16 + n below.

describe("Bun.gzipSync", () => {
  test("honors windowBits", () => {
    const input = fixture();
    const base = Bun.gzipSync(input, { level: 9 });
    // 28 == 16 + 12: a gzip container around a 4 KiB window.
    const narrow = Bun.gzipSync(input, { level: 9, windowBits: 28 });

    expect(Buffer.from(narrow)).toEqual(nodeGzipSync(input, { level: 9, windowBits: 12 }));
    expect(narrow.length).toBeGreaterThan(base.length);
    expect(Buffer.from(Bun.gunzipSync(narrow))).toEqual(input);
  });

  test("honors memLevel", () => {
    const input = fixture();
    const base = Bun.gzipSync(input, { level: 9 });
    const lean = Bun.gzipSync(input, { level: 9, memLevel: 1 });

    expect(Buffer.from(lean)).toEqual(nodeGzipSync(input, { level: 9, memLevel: 1 }));
    expect(lean.length).toBeGreaterThan(base.length);
    expect(Buffer.from(Bun.gunzipSync(lean))).toEqual(input);
  });

  test.each([
    ["Z_FILTERED", zlibConstants.Z_FILTERED],
    ["Z_HUFFMAN_ONLY", zlibConstants.Z_HUFFMAN_ONLY],
    ["Z_RLE", zlibConstants.Z_RLE],
    ["Z_FIXED", zlibConstants.Z_FIXED],
  ])("honors strategy %s", (_name, strategy) => {
    const input = fixture();
    const base = Bun.gzipSync(input, { level: 9 });
    const tuned = Bun.gzipSync(input, { level: 9, strategy });

    expect(Buffer.from(tuned)).toEqual(nodeGzipSync(input, { level: 9, strategy }));
    expect(Buffer.from(tuned)).not.toEqual(Buffer.from(base));
    expect(Buffer.from(Bun.gunzipSync(tuned))).toEqual(input);
  });

  test("honors strategy with an explicit library: 'zlib'", () => {
    const input = fixture();
    const tuned = Bun.gzipSync(input, { level: 9, strategy: zlibConstants.Z_HUFFMAN_ONLY, library: "zlib" });

    expect(Buffer.from(tuned)).toEqual(nodeGzipSync(input, { level: 9, strategy: zlibConstants.Z_HUFFMAN_ONLY }));
  });

  test("still emits gzip by default", () => {
    const compressed = Bun.gzipSync(text);

    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
    expect(Buffer.from(compressed)).toEqual(nodeGzipSync(text, { level: 6 }));
    expect(Buffer.from(Bun.gunzipSync(compressed))).toEqual(text);
  });
});

describe("Bun.deflateSync", () => {
  test("honors memLevel and strategy", () => {
    const input = fixture();
    const base = Bun.deflateSync(input, { level: 9 });
    const tuned = Bun.deflateSync(input, { level: 9, memLevel: 1, strategy: zlibConstants.Z_RLE });

    expect(Buffer.from(tuned)).toEqual(
      nodeDeflateRawSync(input, { level: 9, memLevel: 1, strategy: zlibConstants.Z_RLE }),
    );
    expect(Buffer.from(tuned)).not.toEqual(Buffer.from(base));
    expect(Buffer.from(Bun.inflateSync(tuned))).toEqual(input);
  });

  test("still emits raw deflate by default", () => {
    const compressed = Bun.deflateSync(text);

    expect(Buffer.from(compressed)).toEqual(nodeDeflateRawSync(text, { level: 6 }));
    expect(Buffer.from(Bun.inflateSync(compressed))).toEqual(text);
  });

  // https://github.com/oven-sh/bun/issues/8886 — windowBits is the raw zlib
  // value, so it picks the container format just like it does for inflateSync.
  test("windowBits -15 emits raw deflate", () => {
    const compressed = Bun.deflateSync(text, { level: 9, windowBits: -15 });

    expect(Buffer.from(compressed)).toEqual(nodeDeflateRawSync(text, { level: 9 }));
    expect(Buffer.from(Bun.inflateSync(compressed, { windowBits: -15 }))).toEqual(text);
  });

  test("windowBits 15 emits zlib-wrapped deflate", () => {
    const compressed = Bun.deflateSync(text, { level: 9, windowBits: 15 });

    expect(compressed[0]).toBe(0x78);
    expect(((compressed[0] << 8) | compressed[1]) % 31).toBe(0);
    expect(nodeInflateSync(Buffer.from(compressed))).toEqual(text);
    expect(Buffer.from(Bun.inflateSync(compressed, { windowBits: 15 }))).toEqual(text);
  });

  test("windowBits 31 emits gzip", () => {
    const compressed = Bun.deflateSync(text, { level: 9, windowBits: 31 });

    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
    expect(Buffer.from(Bun.gunzipSync(compressed))).toEqual(text);
  });

  test("round-trips through inflateSync with every option set", () => {
    const input = fixture();
    const compressed = Bun.deflateSync(input, {
      level: 9,
      windowBits: -12,
      memLevel: 4,
      strategy: zlibConstants.Z_RLE,
    });

    expect(Buffer.from(Bun.inflateSync(compressed, { windowBits: -12 }))).toEqual(input);
  });
});

describe("invalid zlib options", () => {
  // zlib rejects these inside deflateInit2; the published types already exclude them.
  const outOfRange: [string, object][] = [
    ["windowBits", { windowBits: 99 }],
    ["memLevel", { memLevel: 42 }],
    ["strategy", { strategy: 99 }],
  ];

  test.each(outOfRange)("gzipSync rejects an out-of-range %s", (_name, options) => {
    expect(() => Bun.gzipSync(text, options as Bun.ZlibCompressionOptions)).toThrow("Zlib error: Invalid argument");
  });

  test.each(outOfRange)("deflateSync rejects an out-of-range %s", (_name, options) => {
    expect(() => Bun.deflateSync(text, options as Bun.ZlibCompressionOptions)).toThrow("Zlib error: Invalid argument");
  });

  // `node:zlib` rejects windowBits 0 on every compress function too, and accepts
  // it on inflate, where it means "read the window size from the zlib header".
  test("windowBits 0 is rejected for compression but accepted by inflateSync", () => {
    const zero = { windowBits: 0 } as Bun.ZlibCompressionOptions;

    expect(() => Bun.gzipSync(text, zero)).toThrow("Zlib error: Invalid argument");
    expect(() => Bun.deflateSync(text, zero)).toThrow("Zlib error: Invalid argument");
    expect(() => nodeGzipSync(text, { windowBits: 0 })).toThrow(/out of range/);

    expect(Buffer.from(Bun.inflateSync(nodeDeflateSync(text), zero))).toEqual(text);
  });
});
