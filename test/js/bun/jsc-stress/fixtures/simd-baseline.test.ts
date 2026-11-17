// Exercises Bun's SIMD code paths to verify the baseline binary doesn't
// emit instructions beyond its CPU target (no AVX on x64, no LSE/SVE on aarch64).
//
// Each test uses inputs large enough to hit vectorized fast paths (>= 16 bytes
// for @Vector(16, u8), >= 64 bytes for wider paths) and validates correctness
// to catch both SIGILL and miscompilation from wrong instruction lowering.

import { describe, expect, test } from "bun:test";
import { deflateSync, inflateSync } from "node:zlib";
import { decodeDifferences, encodeDifferences, inParts, loadCases } from "../../image/webp-golden/observe";

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
