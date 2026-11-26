// Exercises Bun's SIMD code paths to verify the baseline binary doesn't
// emit instructions beyond its CPU target (no AVX on x64, no LSE/SVE on aarch64).
//
// Each test uses inputs large enough to hit vectorized fast paths (>= 16 bytes
// for @Vector(16, u8), >= 64 bytes for wider paths) and validates correctness
// to catch both SIGILL and miscompilation from wrong instruction lowering.

import { describe, expect, test } from "bun:test";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants,
  crc32,
  deflateSync,
  gunzipSync,
  gzipSync,
  inflateSync,
} from "node:zlib";
import * as zlibGolden from "../../../node/zlib/zlib-golden/observe";
import { decodeDifferences, encodeDifferences, inParts, loadCases } from "../../image/webp-golden/observe";
import * as zstdGolden from "../../util/zstd-golden/observe";

// Use Buffer.alloc instead of "x".repeat() — repeat is slow in debug JSC builds.
const ascii256 = Buffer.alloc(256, "a").toString();
const ascii1k = Buffer.alloc(1024, "x").toString();

describe("escapeHTML — @Vector(16, u8) gated by enableSIMD", () => {
  test("clean passthrough", () => {
    expect(Bun.escapeHTML(ascii256)).toBe(ascii256);
  });

  test("ampersand in middle", () => {
    const input = ascii256 + "&" + ascii256;
    const escaped = Bun.escapeHTML(input);
    expect(escaped).toContain("&amp;");
    // The raw "&" should have been replaced — only "&amp;" should remain
    expect(escaped.replaceAll("&amp;", "").includes("&")).toBe(false);
  });

  test("all special chars", () => {
    const input = '<div class="test">' + ascii256 + "</div>";
    const escaped = Bun.escapeHTML(input);
    expect(escaped).toContain("&lt;");
    expect(escaped).toContain("&gt;");
    expect(escaped).toContain("&quot;");
  });
});

describe("stringWidth — @Vector(16, u8) ungated", () => {
  test("ascii", () => {
    expect(Bun.stringWidth(ascii256)).toBe(256);
  });

  test("empty", () => {
    expect(Bun.stringWidth("")).toBe(0);
  });

  test("tabs", () => {
    expect(Bun.stringWidth(Buffer.alloc(32, "\t").toString())).toBe(0);
  });

  test("mixed printable and zero-width", () => {
    const mixed = "hello" + "\x00".repeat(64) + "world";
    expect(Bun.stringWidth(mixed)).toBe(10);
  });
});

describe("Buffer hex encoding — @Vector(16, u8) gated by enableSIMD", () => {
  test.each([16, 32, 64, 128, 256])("size %d", size => {
    const buf = Buffer.alloc(size, 0xab);
    const hex = buf.toString("hex");
    expect(hex.length).toBe(size * 2);
    expect(hex).toBe("ab".repeat(size));
  });

  test("all byte values", () => {
    const varied = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) varied[i] = i;
    const hex = varied.toString("hex");
    expect(hex).toStartWith("000102030405");
    expect(hex).toEndWith("fdfeff");
  });
});

describe("base64 — simdutf runtime dispatch", () => {
  test("ascii roundtrip", () => {
    const encoded = btoa(ascii1k);
    expect(atob(encoded)).toBe(ascii1k);
  });

  test("binary roundtrip", () => {
    const binary = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i));
    expect(atob(btoa(binary))).toBe(binary);
  });
});

describe("TextEncoder/TextDecoder — simdutf runtime dispatch", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  test("ascii roundtrip", () => {
    const bytes = encoder.encode(ascii1k);
    expect(bytes.length).toBe(1024);
    expect(decoder.decode(bytes)).toBe(ascii1k);
  });

  test("mixed ascii + multibyte", () => {
    const mixed = ascii256 + "\u00e9\u00e9\u00e9" + ascii256 + "\u2603\u2603" + ascii256;
    expect(decoder.decode(encoder.encode(mixed))).toBe(mixed);
  });

  test("emoji surrogate pairs", () => {
    const emoji = "\u{1F600}".repeat(64);
    expect(decoder.decode(encoder.encode(emoji))).toBe(emoji);
  });
});

describe("decodeURIComponent — SIMD % scanning", () => {
  test("clean passthrough", () => {
    const clean = Buffer.alloc(256, "a").toString();
    expect(decodeURIComponent(clean)).toBe(clean);
  });

  test("encoded at various positions", () => {
    const input = "a".repeat(128) + "%20" + "b".repeat(128) + "%21";
    expect(decodeURIComponent(input)).toBe("a".repeat(128) + " " + "b".repeat(128) + "!");
  });

  test("heavy utf8 encoding", () => {
    const input = Array.from({ length: 64 }, () => "%C3%A9").join("");
    expect(decodeURIComponent(input)).toBe("\u00e9".repeat(64));
  });
});

describe("URL parsing — Highway indexOfChar/indexOfAny", () => {
  test("long URL with all components", () => {
    const longPath = "/" + "segment/".repeat(32) + "end";
    const url = new URL("https://user:pass@example.com:8080" + longPath + "?key=value&foo=bar#section");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("example.com");
    expect(url.port).toBe("8080");
    expect(url.pathname).toBe(longPath);
    expect(url.search).toBe("?key=value&foo=bar");
    expect(url.hash).toBe("#section");
  });
});

describe("JSON — JS lexer SIMD string scanning", () => {
  test("large object roundtrip", () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      obj["key_" + Buffer.alloc(32, "a").toString() + "_" + i] = "value_" + Buffer.alloc(64, "b").toString() + "_" + i;
    }
    const parsed = JSON.parse(JSON.stringify(obj));
    expect(Object.keys(parsed).length).toBe(100);
    expect(parsed["key_" + Buffer.alloc(32, "a").toString() + "_0"]).toBe(
      "value_" + Buffer.alloc(64, "b").toString() + "_0",
    );
  });

  test("string with escape sequences", () => {
    const original = { msg: 'quote"here\nand\ttab' + Buffer.alloc(256, "x").toString() };
    const reparsed = JSON.parse(JSON.stringify(original));
    expect(reparsed.msg).toBe(original.msg);
  });
});

describe("HTTP request head", () => {
  test("long headers", async () => {
    const longHeaderValue = Buffer.alloc(512, "v").toString();
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(req.headers.get("X-Test-Header") || "missing");
      },
    });

    const resp = await fetch(`http://localhost:${server.port}/` + "path/".repeat(20), {
      headers: {
        "X-Test-Header": longHeaderValue,
        "X-Header-A": Buffer.alloc(64, "a").toString(),
        "X-Header-B": Buffer.alloc(64, "b").toString(),
        "X-Header-C": Buffer.alloc(64, "c").toString(),
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,de;q=0.7",
      },
    });
    expect(await resp.text()).toBe(longHeaderValue);
  });
});

describe("HTTP response head — Highway byte sets", () => {
  test("long header name and value", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("", { headers: { [ascii256]: ascii1k } }) });
    expect((await fetch(server.url)).headers.get(ascii256)).toBe(ascii1k);
  });
});

describe("Latin-1 to UTF-8 — @Vector(16, u8) ungated", () => {
  test("full byte range", () => {
    const latin1Bytes = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) latin1Bytes[i] = i;
    const latin1Str = latin1Bytes.toString("latin1");
    const utf8Buf = Buffer.from(latin1Str, "utf-8");
    expect(utf8Buf.length).toBeGreaterThan(256);
    expect(utf8Buf.toString("utf-8").length).toBe(256);
  });
});

describe("String search — Highway memMem/indexOfChar", () => {
  test("indexOf long string", () => {
    const haystack = Buffer.alloc(1000, "a").toString() + "needle" + Buffer.alloc(1000, "b").toString();
    expect(haystack.indexOf("needle")).toBe(1000);
    expect(haystack.indexOf("missing")).toBe(-1);
    expect(haystack.lastIndexOf("needle")).toBe(1000);
  });

  test("includes long string", () => {
    const haystack = Buffer.alloc(1000, "a").toString() + "needle" + Buffer.alloc(1000, "b").toString();
    expect(haystack.includes("needle")).toBe(true);
    expect(haystack.includes("missing")).toBe(false);
  });
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(Buffer.from(type, "latin1"), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** `lines` are the rows, each behind its filter type. */
function pngFile(width: number, height: number, depth: number, colorType: number, lines: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([depth, colorType, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(lines)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** The rows of `file`, each behind its filter type. */
function linesOf(file: Uint8Array): Buffer {
  const view = new DataView(file.buffer, file.byteOffset);
  const idat: Uint8Array[] = [];
  for (let at = 8; at < file.length; at += 12 + view.getUint32(at)) {
    if (view.getUint32(at + 4) === 0x49444154) idat.push(file.subarray(at + 8, at + 8 + view.getUint32(at)));
  }
  return inflateSync(Buffer.concat(idat));
}

describe("Brotli: Highway runtime dispatch", () => {
  // src/jsc/bindings/highway_brotli.cpp is compiled for SSSE3 and for AVX2 on x64, and has separate code for arm64. All
  // three have to lead to the same bytes. These checksums are from google/brotli. The loops in src/brotli that read and
  // write bits are compiled with BMI2 and without.
  // Text takes turns with bytes of few, of many, and of scattered values, and some of it comes again with changes.
  const words = ["the ", "The ", "time ", "information ", "of ", "<div>", "</div>\n", "é", "working ", "1024, "];
  const input = Buffer.alloc(24000);
  let state = 1;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 16;
  for (let at = 0, part = 0; at < input.length; part++) {
    const end = Math.min(input.length, at + 300 + (random() % 900));
    while (at < end) {
      if (part % 5 === 0) {
        at += input.write(words[random() % words.length], at);
      } else if (part % 5 === 4 && random() % 16) {
        input[at] = input[at - 1100 - (part % 3)];
        at++;
      } else {
        input[at++] = random() & [0, 0x07, 0x7f, 0xc9, 0xff][part % 5];
      }
    }
  }

  test.each([
    { quality: 5, expected: [0xa8b039ed, 0x3df1b1bd] },
    { quality: 9, expected: [0x869eb61c, 0xfbea90a9] },
    { quality: 10, expected: [0xf294e22b, 0x51cb00fb] },
    { quality: 11, expected: [0x089c7811, 0x89fdfe52] },
  ])("quality $quality", ({ quality, expected }) => {
    const params = { [constants.BROTLI_PARAM_QUALITY]: quality };
    const streams = [input.subarray(0, 1500), input].map(bytes => brotliCompressSync(bytes, { params }));
    expect(streams.map(stream => Bun.hash.crc32(stream))).toEqual(expected);
    expect(brotliDecompressSync(streams[1]).equals(input)).toBe(true);
  });

  test.each([0, 1, 2, 5])("many literals and long copies at quality %d", quality => {
    state = 1;
    const literals = Buffer.alloc(9000).map(() => random() & random());
    const bytes = Buffer.concat([input, Buffer.alloc(200_000, "far"), literals, input]);
    const params = { [constants.BROTLI_PARAM_QUALITY]: quality };
    expect(brotliDecompressSync(brotliCompressSync(bytes, { params })).equals(bytes)).toBe(true);
  });

  // These depend on how bytes that are equally frequent get sorted.
  test.each([
    { quality: 0, expected: 0xf3f68ec3 },
    { quality: 3, expected: 0x3b33ad84 },
  ])("each number of distinct bytes at quality $quality", ({ quality, expected }) => {
    const bytes = Array.from({ length: 700 }, (_, i) => Math.imul(i * i + 1, 0x9e3779b1) >>> 24);
    const streams = Array.from({ length: 256 }, (_, last) =>
      brotliCompressSync(Buffer.concat([Buffer.alloc(300), Buffer.from(bytes.map(byte => byte % (last + 1)))]), {
        params: { [constants.BROTLI_PARAM_QUALITY]: quality },
      }),
    );
    expect(Bun.hash.crc32(Buffer.concat(streams))).toBe(expected);
  });

  test("counts that are far from their place or too large to sort", () => {
    const sumsOf = (gaps: number[]) => {
      const isSum = [true];
      for (let i = 1; i < 240; i++) isSum[i] = gaps.some(gap => isSum[i - gap]);
      return [...Array(15).fill(5), ...isSum.map(is => (is ? 20 : 5))];
    };
    const large = [16400, 32744, 32745].map(count => Array(21).fill(1).with(10, count));
    const streams = [sumsOf([4, 10, 23]), sumsOf([10, 23, 57, 132]), ...large].map(counts =>
      brotliCompressSync(Buffer.concat(counts.map((count, i) => Buffer.alloc(count, 255 - i))), {
        params: { [constants.BROTLI_PARAM_QUALITY]: 0 },
      }),
    );
    expect(Bun.hash.crc32(Buffer.concat(streams))).toBe(0x38d935b8);
  });

  // Pairs of contexts cost the same to join, so their order decides.
  test("short inputs", () => {
    const starts = [100, 3936, 6308, 6336, 6772, 6836, 11384, 11688, 13124, 15672];
    const streams = starts.map(start => brotliCompressSync(input.subarray(start, start + 150)));
    expect(Bun.hash.crc32(Buffer.concat(streams))).toBe(0x0b9294f1);
  });

  // Each part takes its bytes from values that start `step` after those of the previous one.
  test.each([
    { seed: 7, parts: 10, size: 300, masks: [0xff, 0x0f], step: 0, expected: 0xeef0b62d },
    { seed: 6, parts: 20, size: 300, masks: [0xff, 0x7f, 0x83, 0x87], step: 0, expected: 0xbebb1aef },
    { seed: 15, parts: 30, size: 400, masks: [0x83, 0x87, 0x8f, 0x81], step: 0, expected: 0x79bd566c },
    { seed: 1, parts: 72, size: 540, masks: [0x3f], step: 16, expected: 0x7355a11b },
  ])("$parts parts with values of their own", ({ seed, parts, size, masks, step, expected }) => {
    state = seed;
    const values = Buffer.alloc(step * parts + 256).map((_, i) => (step ? random() >> 8 : i));
    const bytes = Buffer.alloc(parts * size).map((_, i) => {
      const part = Math.floor(i / size);
      return values[step * part + ((random() >> 8) & masks[part % masks.length])];
    });
    const params = { [constants.BROTLI_PARAM_QUALITY]: 10 };
    expect(Bun.hash.crc32(brotliCompressSync(bytes, { params }))).toBe(expected);
  });
});

describe("JPEG codec: Highway runtime dispatch", () => {
  // src/jsc/bindings/highway_jpeg.cpp is compiled for SSSE3 and for AVX2 on x64, and has separate code for arm64. All
  // three have to give the same bytes. These checksums are from libjpeg-turbo 3.2.0.
  // Two groups of 32 pixels and a remainder, and partial blocks on both edges.
  const width = 75;
  const height = 37;

  function noise(length: number, mask: number): Buffer {
    const bytes = Buffer.alloc(length);
    let state = 1;
    for (let i = 0; i < length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      bytes[i] = (state >>> 24) & mask;
    }
    return bytes;
  }

  /** YCbCr with random coefficients of 1 to 3 bits. */
  function jpegFile(lumaSampling: number, step: number, acSymbols = [0x01, 0x02, 0x13, 0x03]): Buffer {
    // The codes 0, 10, 110 and 1110. Without four ones in a row, any bits are valid.
    const counts = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    return Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 131, 0x10]),
      Buffer.alloc(128, Buffer.from([step >> 8, step & 255])),
      Buffer.from([0xff, 0xc0, 0, 17, 8, 0, height, 0, width, 3, 1, lumaSampling, 0, 2, 0x11, 0, 3, 0x11, 0]),
      Buffer.from([0xff, 0xc4, 0, 23, 0x00, ...counts, 0, 1, 2, 3]),
      Buffer.from([0xff, 0xc4, 0, 23, 0x10, ...counts, ...acSymbols]),
      Buffer.from([0xff, 0xda, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0]),
      noise(4096, 0x77),
      Buffer.from([0xff, 0xd9]),
    ]);
  }

  /** At 1/8 to 8/8 of the size. The decoder scales to these itself. */
  async function checksums(file: Buffer): Promise<number[]> {
    const sums: number[] = [];
    for (let eighths = 1; eighths <= 8; eighths++) {
      const [w, h] = [Math.ceil((width * eighths) / 8), Math.ceil((height * eighths) / 8)];
      const png = await new Bun.Image(file).resize(w, h, { fit: "fill" }).png({ compressionLevel: 0 }).bytes();
      sums.push(Bun.hash.crc32(linesOf(png)));
    }
    return sums;
  }

  test.each([
    {
      name: "4:4:4",
      lumaSampling: 0x11,
      expected: [0xdf362e97, 0x848849e1, 0xeb0932a5, 0xaf4262f5, 0x19afcb90, 0x8dd0fb7d, 0x441e7bdc, 0xc0af7673],
    },
    {
      name: "4:2:2",
      lumaSampling: 0x21,
      expected: [0x98c41678, 0x5b7e5919, 0x1087358d, 0xddbb89d8, 0x3803b37a, 0x30b05c66, 0x016d7b1c, 0xe73c7ad3],
    },
    // Below 8/8, chroma gets an IDCT of twice the size.
    {
      name: "4:2:0",
      lumaSampling: 0x22,
      expected: [0x5729f58c, 0xa5ce966f, 0xc6381a69, 0xb719dbfa, 0xb401b545, 0x1c760a27, 0x4495887e, 0x09b98b79],
    },
  ])("decode $name at every scale", async ({ lumaSampling, expected }) => {
    expect(await checksums(jpegFile(lumaSampling, 7))).toEqual(expected);
  });

  // Out-of-range checksums are from test/js/bun/image/jpeg-golden/model.ts.
  test.each([
    {
      step: 255,
      expected: [0x4cab1463, 0x072a2234, 0xe1c74f4b, 0x0d236dc2, 0x1b629600, 0x1d4aff3f, 0x04be1ae7, 0x8c04dfff],
    },
    {
      step: 9999,
      expected: [0xabd57f9a, 0x024f6f0a, 0x44dd2a4a, 0xaa6c089a, 0xca2b36e4, 0xa2522916, 0x053d1182, 0x70e25041],
    },
  ])("decode out-of-range coefficients, quantization step $step", async ({ step, expected }) => {
    expect(await checksums(jpegFile(0x22, step))).toEqual(expected);
  });

  // More than half of the blocks have only DC. Steps above 7 are out of range.
  test.each([
    {
      step: 7,
      expected: [0xa67fb013, 0xbe9cf025, 0x1e26834d, 0x557065fa, 0x0fe5c1f6, 0xa5b5aa66, 0x4317ebb4, 0x62d5763f],
    },
    {
      step: 255,
      expected: [0x8d9317a3, 0x2cf2e5d6, 0xfdda9ada, 0xc8d514fd, 0x3f002844, 0x1271948e, 0x35022add, 0x3ef68fd5],
    },
    {
      step: 9999,
      expected: [0xb7c9ecd0, 0x21e1dce4, 0xb3732c01, 0x66722d11, 0x24e5f4fc, 0xef38c213, 0xd37d6369, 0x7392d52a],
    },
    {
      step: 40000,
      expected: [0xd1c842b1, 0x968b43a6, 0x7ac16001, 0xf648a4e5, 0x22202101, 0xe906df4a, 0x02f29c81, 0x10fd209e],
    },
  ])("decode blocks with few AC coefficients, quantization step $step", async ({ step, expected }) => {
    expect(await checksums(jpegFile(0x22, step, [0x00, 0x03, 0x12, 0x71]))).toEqual(expected);
  });

  test.each([
    { quality: 20, expected: [0xe2d5c0c5, 0x3917f1ee] },
    { quality: 80, expected: [0x1b2e030e, 0x7f932e5d] },
    { quality: 100, expected: [0x4bc87526, 0x4c691afb] },
  ])("encode at quality $quality, baseline and progressive", async ({ quality, expected }) => {
    const lines = noise(height * (1 + width * 4), 0xff);
    for (let y = 0; y < height; y++) lines[y * (1 + width * 4)] = 0;
    const png = pngFile(width, height, 8, 6, lines);
    const baseline = await new Bun.Image(png).jpeg({ quality }).bytes();
    const progressive = await new Bun.Image(png).jpeg({ quality, progressive: true }).bytes();
    expect([Bun.hash.crc32(baseline), Bun.hash.crc32(progressive)]).toEqual(expected);
  });
});

describe("PNG codec: Highway runtime dispatch", () => {
  // src/jsc/bindings/highway_png.cpp is compiled several times over, on x64 for SSSE3, SSE4 and AVX2. A machine with
  // AVX2 runs that one alone, and any file can reach the others on a machine without. An emulated Nehalem runs SSSE3:
  // it lacks the AES that Highway wants for SSE4.
  // Rows 9 and 21 begin with 96 bytes that repeat a pixel, or are such bytes. Below them Paeth has a shorter way, which
  // it looks for 64 bytes in and leaves where they end.
  const someFilterTypes = [0, 1, 2, 3, 4, 4, 3, 2, 1, 0, 4, 4];
  const flatRow = 9;
  // Once on any bytes, and once on bytes within 6 of their neighbors, where Paeth often has two to pick from.
  const filterTypes = [...someFilterTypes, ...someFilterTypes];
  const height = filterTypes.length;

  // Under Intel SDE code is slow the first time it runs: the first of these tests took 6 s, the fifth 0.1 s. Hence
  // plain loops and few functions, so that less runs for the first time, and the small pictures first, to spread it.

  /** What byte `i` of row `y` is filtered against. https://www.w3.org/TR/png-3/#9Filter-types */
  function prediction(type: number, rows: Uint8Array, stride: number, bytesPerPixel: number, y: number, i: number) {
    const a = i >= bytesPerPixel ? rows[y * stride + i - bytesPerPixel] : 0;
    const b = y > 0 ? rows[(y - 1) * stride + i] : 0;
    const c = y > 0 && i >= bytesPerPixel ? rows[(y - 1) * stride + i - bytesPerPixel] : 0;
    if (type === 1) return a;
    if (type === 2) return b;
    if (type === 3) return (a + b) >> 1;
    if (type !== 4) return 0;
    const pa = Math.abs(b - c);
    const pb = Math.abs(a - c);
    const pc = Math.abs(a + b - 2 * c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  describe.each([
    // Most rows are shorter than a vector.
    3,
    // Every row is whole vectors.
    32,
    // No row is whole vectors of 16 or 32 bytes, at any pixel size, nor is a row of RGBA without its first pixel, which
    // the encoder takes by itself.
    119,
  ])("%i px wide", width => {
    test.each([
      // Where red, green, blue and alpha are in a pixel. Of 16 bits Bun keeps the first 8, so the other 8 go unseen.
      { colorType: 0, depth: 8, bytesPerPixel: 1, channels: [0, 0, 0] },
      { colorType: 4, depth: 8, bytesPerPixel: 2, channels: [0, 0, 0, 1] },
      { colorType: 2, depth: 8, bytesPerPixel: 3, channels: [0, 1, 2] },
      { colorType: 6, depth: 8, bytesPerPixel: 4, channels: [0, 1, 2, 3] },
      { colorType: 2, depth: 16, bytesPerPixel: 6, channels: [0, 2, 4] },
      { colorType: 6, depth: 16, bytesPerPixel: 8, channels: [0, 2, 4, 6] },
    ])("every filter type on pixels of $bytesPerPixel bytes", async ({ colorType, depth, bytesPerPixel, channels }) => {
      const stride = width * bytesPerPixel;
      const rows = new Uint8Array(height * stride);
      let state = colorType * 16 + depth;
      for (let i = 0; i < rows.length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        rows[i] = i < rows.length / 2 ? state >>> 24 : 125 + ((state >>> 24) % 7);
      }
      rows.fill(0x55, flatRow * stride, flatRow * stride + Math.min(96, stride));
      const otherFlatRow = someFilterTypes.length + flatRow;
      rows.fill(0xaa, otherFlatRow * stride, otherFlatRow * stride + Math.min(96, stride));
      const lines = new Uint8Array(height * (1 + stride));
      for (let y = 0; y < height; y++) {
        lines[y * (1 + stride)] = filterTypes[y];
        for (let i = 0; i < stride; i++) {
          const predicted = prediction(filterTypes[y], rows, stride, bytesPerPixel, y, i);
          lines[y * (1 + stride) + 1 + i] = rows[y * stride + i] - predicted;
        }
      }
      const [red, green, blue, alpha] = channels;
      const rgba = new Uint8Array(height * width * 4).fill(255);
      for (let pixel = 0; pixel < height * width; pixel++) {
        const at = pixel * bytesPerPixel;
        rgba[pixel * 4] = rows[at + red];
        rgba[pixel * 4 + 1] = rows[at + green];
        rgba[pixel * 4 + 2] = rows[at + blue];
        if (alpha !== undefined) rgba[pixel * 4 + 3] = rows[at + alpha];
      }

      // At level 0 Bun.Image writes the rows as they are. Above it, it also filters each row in the four ways there
      // are, and of the five keeps the first whose bytes, taken as signed, are nearest to zero.
      const lineLength = 1 + width * 4;
      const asTheyAre = Buffer.alloc(height * lineLength);
      const nearestToZero = Buffer.alloc(height * lineLength);
      const candidate = new Uint8Array(lineLength);
      for (let y = 0; y < height; y++) {
        let least = Infinity;
        for (let type = 0; type <= 4; type++) {
          candidate[0] = type;
          let distance = 0;
          for (let i = 0; i < width * 4; i++) {
            const filtered = (rgba[y * width * 4 + i] - prediction(type, rgba, width * 4, 4, y, i)) & 255;
            candidate[1 + i] = filtered;
            distance += Math.min(filtered, 256 - filtered);
          }
          if (type === 0) asTheyAre.set(candidate, y * lineLength);
          if (distance < least) nearestToZero.set(candidate, y * lineLength);
          least = Math.min(least, distance);
        }
      }
      const file = pngFile(width, height, depth, colorType, lines);
      expect(linesOf(await new Bun.Image(file).png({ compressionLevel: 0 }).bytes())).toEqual(asTheyAre);
      expect(linesOf(await new Bun.Image(file).png().bytes())).toEqual(nearestToZero);
    });
  });
});

const webp = await loadCases();

describe("WebP codec: Highway runtime dispatch", () => {
  // src/jsc/bindings/highway_webp_*.cpp are compiled for SSSE3 and AVX2 on x64, and webp-golden.test.ts gets to see
  // the one that suits the machine. In small parts, for the sake of Intel SDE.
  const kinds = ["encoded", "random", "handmade", "changed", "extreme"];
  test.each(inParts(webp.decode, kinds, 20))("decode, part %#", async some => {
    expect(await decodeDifferences(some)).toBe("");
  });

  // The lossless encoder has no kernels.
  const lossy = webp.encode
    .map(({ results: { lossless, ...results }, ...c }) => ({ ...c, results }))
    .filter(c => Object.keys(c.results).length > 0);
  test.each(inParts(lossy, ["layers", "stored"], 20))("encode, part %#", async some => {
    expect(await encodeDifferences(some)).toBe("");
  });
});

const crcTable = new Uint32Array(256);
for (let byte = 0; byte < 256; byte++) {
  let state = byte;
  for (let bit = 0; bit < 8; bit++) state = (state >>> 1) ^ (state & 1 ? 0xedb88320 : 0);
  crcTable[byte] = state;
}

/** The checksums of the first `length` bytes, for each of `lengths`, which ascend. */
function expectedChecksums(bytes: Uint8Array, lengths: number[], seed = 0) {
  const crcs: number[] = [];
  const adlers: number[] = [];
  let state = ~seed;
  let a = 1;
  let b = 0;
  let at = 0;
  for (const length of lengths) {
    for (; at < length; at++) {
      state = crcTable[(state ^ bytes[at]) & 255] ^ (state >>> 8);
      a = (a + bytes[at]) % 65521;
      b = (b + a) % 65521;
    }
    crcs.push(~state >>> 0);
    adlers.push(((b << 16) | a) >>> 0);
  }
  return { crcs, adlers };
}

const zlibCases = await zlibGolden.loadCases();

describe("zlib: Highway runtime dispatch", () => {
  // src/jsc/bindings/highway_checksums.cpp is compiled five times over on x64 and up to three times on arm64. An
  // emulated Nehalem cannot multiply polynomials, and gets its CRC-32 from src/highway/checksums.rs.
  function noise(length: number) {
    const bytes = Buffer.alloc(length);
    let state = 1;
    for (let i = 0; i < length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      bytes[i] = state >>> 24;
    }
    return bytes;
  }

  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  const around = (...lengths: number[]) => lengths.flatMap(length => range(length - 17, length + 18));
  // Every way through the kernels begins or ends at one of these.
  const short = range(0, 700);
  const medium = around(896, 1152, 1248, 2048, 2208, 2400, 4096, 5552);
  const long = [16383, 16384, 16385, 16399, 16400, 65535, 65536, 65537, 65551, 65552, 131072, 140001];

  describe.each([
    { name: "noise", bytes: noise(140064) },
    // The sums of Adler-32 get as large as they can.
    { name: "0xff", bytes: Buffer.alloc(140064, 0xff) },
  ])("$name", ({ bytes }) => {
    describe.each([
      { name: "short", lengths: short },
      { name: "medium", lengths: medium },
      { name: "long", lengths: long },
    ])("$name", ({ lengths }) => {
      test.each([0, 13])("checksums from byte %i on", offset => {
        const input = bytes.subarray(offset);
        const seed = offset * 0x13579bdf;
        const { crcs, adlers } = expectedChecksums(input, lengths, seed);
        expect(lengths.map(length => crc32(input.subarray(0, length), seed))).toEqual(crcs);
        expect(lengths.map(length => Bun.hash.crc32(input.subarray(0, length), seed))).toEqual(crcs);
        expect(lengths.map(length => Bun.hash.adler32(input.subarray(0, length)))).toEqual(adlers);
      });

      test("stored blocks are copied and get their checksum", () => {
        const some = lengths.filter((_, i) => lengths === long || i % 5 === 0);
        const { crcs, adlers } = expectedChecksums(bytes, some);
        const gzipped = some.map(length => gzipSync(bytes.subarray(0, length), { level: 0 }));
        const deflated = some.map(length => deflateSync(bytes.subarray(0, length), { level: 0 }));
        expect(gzipped.map(file => file.readUInt32LE(file.length - 8))).toEqual(crcs);
        expect(deflated.map(file => file.readUInt32BE(file.length - 4))).toEqual(adlers);
        const differs = (output: Buffer, i: number) => !output.equals(bytes.subarray(0, some[i]));
        expect(some.filter((_, i) => differs(gunzipSync(gzipped[i]), i))).toEqual([]);
        expect(some.filter((_, i) => differs(inflateSync(deflated[i]), i))).toEqual([]);
      });
    });
  });

  test("weights of either sign alone", () => {
    // One half of every 128 or 256 bytes is zero, so that nothing cancels out.
    for (const period of [128, 256]) {
      for (const half of [0, 1]) {
        const bytes = Buffer.alloc(65536);
        for (let at = (half * period) / 2; at < bytes.length; at += period) bytes.fill(0xff, at, at + period / 2);
        expect([Bun.hash.adler32(bytes)]).toEqual(expectedChecksums(bytes, [bytes.length]).adlers);
      }
    }
  });

  const { inParts, fewerIfSlow, sample } = zlibGolden;

  // Parts of src/zlib are compiled with BMI2 and without. Each case is inflated again, and many have windows that slide.
  test.each(inParts(fewerIfSlow(sample(zlibCases.whole, 8), 5), 10))("deflate and inflate, part %#", some => {
    expect(zlibGolden.deflateDifferences(some)).toBe("");
  });

  test.each(inParts(fewerIfSlow(sample(zlibCases.damaged, 20), 3), 2))("inflate what is damaged, part %#", some => {
    expect(zlibGolden.damagedDifferences(some)).toBe("");
  });
});

describe("DEFLATE: Highway runtime dispatch", () => {
  // src/jsc/bindings/highway_checksums.cpp has code for each width of vector, and for what does not fill one. Parts of
  // src/deflate/{decompressor,block}.rs are compiled with BMI2 and without.
  const library = "libdeflate";
  const bytes = Buffer.alloc(140_000);
  for (let i = 0, state = 1; i < bytes.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = state >>> 24;
  }

  const lengths = Array.from({ length: 150 }, (_, i) => i);
  for (let power = 128; power <= 4096; power *= 2) {
    for (const more of [-1, 0, 1, 15, 16, 17, 48, 100, 127]) lengths.push(power + more, 3 * power + more);
  }
  lengths.push(65_536, 65_537, 139_000);
  function checksumsOf(input: Uint8Array) {
    const { crcs, adlers } = expectedChecksums(input, [input.length]);
    return { crc: crcs[0], adler: adlers[0] };
  }
  const parts = (bytes: Buffer) => lengths.map((length, i) => bytes.subarray(i % 67, (i % 67) + length));

  test("CRC-32", () => {
    const inputs = parts(bytes);
    const trailers = inputs.map(input => Buffer.from(Bun.gzipSync(input, { library, level: 0 })).subarray(-8));
    expect(trailers.map(trailer => trailer.readUInt32LE())).toEqual(inputs.map(input => checksumsOf(input).crc));
  });

  test("Adler-32", () => {
    const inputs = [...parts(bytes), ...parts(Buffer.alloc(bytes.length, 255))];
    expect(inputs.map(input => Bun.hash.adler32(input))).toEqual(inputs.map(input => checksumsOf(input).adler));
  });

  test.each([0, 384, 1120, 1216, 5504])("up to the last readable byte, from %i bytes on", least => {
    // What a buffer can still grow into is not readable.
    const last = new Uint8Array(new ArrayBuffer(65_536, { maxByteLength: 131_072 }));
    last.set(bytes.subarray(0, last.length));
    const ends = Array.from({ length: 70 }, (_, i) => last.subarray(-least - i - 1));
    const expected = ends.map(checksumsOf);
    expect(ends.map(end => ({ crc: Bun.hash.crc32(end), adler: Bun.hash.adler32(end) }))).toEqual(expected);
    const crcs = ends.map(end => gzipSync(end, { level: 0 }).subarray(-8).readUInt32LE());
    const adlers = ends.map(end => deflateSync(end, { level: 0 }).subarray(-4).readUInt32BE());
    expect(crcs.map((crc, i) => ({ crc, adler: adlers[i] }))).toEqual(expected);
  });

  test.each([0, 4])("round trip with strategy %i of zlib", strategy => {
    const input = Buffer.from(bytes.subarray(0, 6000).toString("base64").replaceAll("A", ascii256));
    expect(input.equals(Bun.gunzipSync(gzipSync(input, { strategy }), { library }))).toBe(true);
  });

  test.each([1, 4, 6, 9, 12])("round trip at level %i", level => {
    const input = Buffer.from(bytes.subarray(0, 6000).toString("hex").replaceAll("0", "zero "));
    expect(input.equals(Bun.gunzipSync(Bun.gzipSync(input, { library, level })))).toBe(true);
  });
});

const zstd = await zstdGolden.loadCases();

describe("zstd codec: BMI2 runtime dispatch", () => {
  // The hot loops of src/zstd are compiled with and without BMI2 on x64, and zstd-golden.test.ts gets to see the ones
  // that suit the machine. In small parts, for the sake of Intel SDE.
  test.each(inParts(zstd.encode, ["small"], 20))("compress, part %#", async some => {
    expect(await zstdGolden.encodeDifferences(some)).toBe("");
  });
  test("as many literals as src/jsc/bindings/highway_zstd.cpp takes where it can", () => {
    let state = 1;
    const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 24;
    const frame = Bun.zstdCompressSync(
      Uint8Array.from({ length: 20_000 }, () => next() & next()),
      { level: 1 },
    );
    expect([frame.length, crc32(frame)]).toEqual([16390, 1591368713]);
  });
  test.each(inParts(zstd.decode, ["stored"], 40))("decompress, part %#", async some => {
    expect(await zstdGolden.decodeDifferences(some)).toBe("");
  });
});
