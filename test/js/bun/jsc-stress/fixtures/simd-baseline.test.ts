// Exercises Bun's SIMD code paths to verify the baseline binary doesn't
// emit instructions beyond its CPU target (no AVX on x64, no LSE/SVE on aarch64).
//
// Each test uses inputs large enough to hit vectorized fast paths (>= 16 bytes
// for @Vector(16, u8), >= 64 bytes for wider paths) and validates correctness
// to catch both SIGILL and miscompilation from wrong instruction lowering.

import { describe, expect, test } from "bun:test";
import { crc32, deflateSync } from "node:zlib";

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

describe("HTTP parsing — llhttp SSE4.2 PCMPESTRI", () => {
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

describe("WebP lossless: libwebp VP8GetCPUInfo runtime dispatch", () => {
  // libwebp's VP8L encoder and decoder pick SSE2 / SSE4.1 / AVX2 (x64) or
  // NEON kernels at init based on cpuid; the AVX2 ones are linked into the
  // baseline binary and must stay behind that check. 64 pixels wide so the
  // 8-pixel-wide kernels run, with a gradient plus noise so the encoder uses
  // the predictor and colour transforms (the bulk of the SIMD surface).
  function pngChunk(type: string, data: Uint8Array): Buffer {
    const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
  }

  const width = 64;
  const height = 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(height * (1 + width * 4));
  let seed = 0x9e3779b9;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const offset = y * (1 + width * 4) + 1 + x * 4;
      rows[offset] = (x * 4 + (seed & 7)) & 255;
      rows[offset + 1] = (y * 16 + ((seed >>> 8) & 7)) & 255;
      rows[offset + 2] = (x * 2 + y * 3 + ((seed >>> 16) & 7)) & 255;
      rows[offset + 3] = y < height / 2 ? 255 : 128;
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);

  test("encode + decode round-trips every pixel", async () => {
    const webp = await new Bun.Image(png).webp({ lossless: true }).bytes();
    expect(Buffer.from(webp.subarray(12, 16)).toString("latin1")).toBe("VP8L");
    expect(await new Bun.Image(webp).metadata()).toEqual({ width, height, format: "webp" });

    // Both PNGs are produced by the same encoder from what must be the same
    // pixels, so the lossless round-trip shows up as byte-identical output.
    const viaWebp = await new Bun.Image(webp).png().bytes();
    const viaPng = await new Bun.Image(png).png().bytes();
    expect(viaWebp).toEqual(viaPng);
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
