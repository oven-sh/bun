import { describe, expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/34107

describe("Bun.QR", () => {
  test("exists", () => {
    expect(Bun.QR).toBeObject();
    expect(Bun.QR.generate).toBeFunction();
    expect(Bun.QR.parse).toBeFunction();
  });

  describe("generate → object", () => {
    test("basic string", () => {
      const qr = Bun.QR.generate("Hello, world!");
      expect(qr).toEqual({
        version: 1,
        size: 21,
        errorCorrection: "M",
        mask: expect.any(Number),
        matrix: expect.any(Uint8Array),
      });
      expect(qr.matrix.length).toBe(21 * 21);
      // Modules are exactly 0 or 1.
      for (const m of qr.matrix) expect(m === 0 || m === 1).toBe(true);
      // Top-left finder pattern corner is always dark.
      expect(qr.matrix[0]).toBe(1);
      expect(qr.mask).toBeGreaterThanOrEqual(0);
      expect(qr.mask).toBeLessThanOrEqual(7);
    });

    test("deterministic", () => {
      const a = Bun.QR.generate("https://bun.com");
      const b = Bun.QR.generate("https://bun.com");
      expect(a.version).toBe(b.version);
      expect(a.size).toBe(b.size);
      expect(a.mask).toBe(b.mask);
      expect(Buffer.from(a.matrix)).toEqual(Buffer.from(b.matrix));
    });

    test("known vector: finder patterns at three corners", () => {
      // Every QR symbol has a 7x7 finder pattern at top-left, top-right,
      // bottom-left. Verify the top row of each.
      const { matrix, size } = Bun.QR.generate("A");
      const row = (y: number) => Array.from(matrix.subarray(y * size, y * size + size));
      const finder = [1, 1, 1, 1, 1, 1, 1, 0];
      expect(row(0).slice(0, 8)).toEqual(finder);
      expect(row(0).slice(size - 8)).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
      expect(row(size - 7).slice(0, 8)).toEqual(finder);
    });

    test("errorCorrection option", () => {
      for (const ec of ["L", "M", "Q", "H"] as const) {
        const qr = Bun.QR.generate("test", { errorCorrection: ec, boostErrorCorrection: false });
        expect(qr.errorCorrection).toBe(ec);
      }
    });

    test("errorCorrection is boosted when free", () => {
      // Tiny payload fits at v1 for any ECC, so with boost on it goes to H.
      const qr = Bun.QR.generate("A", { errorCorrection: "L" });
      expect(qr.errorCorrection).toBe("H");
      expect(qr.version).toBe(1);
    });

    test("version grows with data length", () => {
      const small = Bun.QR.generate(Buffer.alloc(10, "x").toString());
      const large = Bun.QR.generate(Buffer.alloc(500, "x").toString());
      expect(large.version).toBeGreaterThan(small.version);
      expect(large.size).toBeGreaterThan(small.size);
      expect(large.size).toBe(large.version * 4 + 17);
    });

    test("minVersion forces a larger symbol", () => {
      const qr = Bun.QR.generate("hi", { minVersion: 10 });
      expect(qr.version).toBe(10);
      expect(qr.size).toBe(10 * 4 + 17);
    });

    test("mask option", () => {
      for (let m = 0; m <= 7; m++) {
        const qr = Bun.QR.generate("hello", { mask: m });
        expect(qr.mask).toBe(m);
      }
    });

    test("undefined and NaN mask both mean automatic selection", () => {
      const auto = Bun.QR.generate("hello").mask;
      // "hello" picks a non-zero mask, so a NaN that collapsed to mask 0
      // would be visible here.
      expect(auto).not.toBe(0);
      expect(Bun.QR.generate("hello", { mask: undefined }).mask).toBe(auto);
      expect(Bun.QR.generate("hello", { mask: NaN }).mask).toBe(auto);
    });

    test("accepts BufferSource", () => {
      const bytes = new Uint8Array([0x00, 0xff, 0x42, 0x99]);
      const fromBuf = Bun.QR.generate(bytes);
      const fromView = Bun.QR.generate(new DataView(bytes.buffer));
      const fromAb = Bun.QR.generate(bytes.buffer);
      expect(fromBuf.matrix).toEqual(fromView.matrix);
      expect(fromBuf.matrix).toEqual(fromAb.matrix);
    });

    test("numeric string uses numeric mode (higher capacity)", () => {
      // 7089 digits is the max for version 40-L in numeric mode.
      const digits = Buffer.alloc(7089, "3").toString();
      const qr = Bun.QR.generate(digits, { errorCorrection: "L", boostErrorCorrection: false });
      expect(qr.version).toBe(40);
      expect(qr.size).toBe(177);
    });

    test("empty string encodes", () => {
      const qr = Bun.QR.generate("");
      expect(qr.version).toBe(1);
      expect(qr.matrix.length).toBe(21 * 21);
    });
  });

  describe("generate → svg", () => {
    test("returns valid-looking SVG", () => {
      const svg = Bun.QR.generate("hello", { format: "svg" });
      expect(typeof svg).toBe("string");
      expect(svg).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
      expect(svg).toContain("<svg ");
      expect(svg).toContain('viewBox="0 0 25 25"'); // 21 + 2*2 border
      expect(svg).toContain("</svg>");
    });

    test("border option changes viewBox", () => {
      const svg0 = Bun.QR.generate("hello", { format: "svg", border: 0 });
      const svg4 = Bun.QR.generate("hello", { format: "svg", border: 4 });
      expect(svg0).toContain('viewBox="0 0 21 21"');
      expect(svg4).toContain('viewBox="0 0 29 29"');
    });

    test("light/dark accept any Bun.color input", () => {
      const svg = Bun.QR.generate("x", { format: "svg", light: "#abcdef", dark: "red" });
      expect(svg).toContain('fill="#abcdef"');
      expect(svg).toContain('fill="#ff0000"');

      const svg2 = Bun.QR.generate("x", {
        format: "svg",
        light: [255, 0, 128],
        dark: { r: 0, g: 0, b: 0, a: 0.5 },
      });
      expect(svg2).toContain('fill="#ff0080"');
      expect(svg2).toContain('fill="#0000007f"'); // same truncation as Bun.color

      const svg3 = Bun.QR.generate("x", { format: "svg", dark: 0x336699 });
      expect(svg3).toContain('fill="#336699"');
    });

    test("unparseable color throws", () => {
      const unparseable = () => Bun.QR.generate("x", { format: "svg", dark: "not a color" });
      expect(unparseable).toThrow(TypeError);
      expect(unparseable).toThrow("options.dark must be a color accepted by Bun.color");
    });

    test("colors without a fixed value throw", () => {
      // Bun.color() accepts these, but they only mean something inside a
      // document, so there is nothing to paint.
      for (const color of ["currentColor", "light-dark(white, black)", "Canvas"]) {
        const contextual = () => Bun.QR.generate("x", { format: "svg", light: color });
        expect(contextual).toThrow(TypeError);
        expect(contextual).toThrow("options.light must be a concrete color");
      }
    });

    test("null light/dark mean the defaults", () => {
      expect(Bun.QR.generate("x", { format: "svg", light: null as any, dark: null as any })).toBe(
        Bun.QR.generate("x", { format: "svg" }),
      );
    });
  });

  describe("generate → text", () => {
    test("returns block characters", () => {
      const txt = Bun.QR.generate("hi", { format: "text", border: 0 });
      expect(typeof txt).toBe("string");
      const lines = txt.split("\n").filter(Boolean);
      // 21 modules tall, 2 modules per line → 11 lines.
      expect(lines.length).toBe(11);
      for (const line of lines) {
        expect(line.length).toBe(21);
        expect(line).toMatch(/^[ \u2580\u2584\u2588]+$/);
      }
    });

    test("invert option", () => {
      const a = Bun.QR.generate("hi", { format: "text", border: 0 });
      const b = Bun.QR.generate("hi", { format: "text", border: 0, invert: true });
      const swap: Record<string, string> = { " ": "\u2588", "\u2588": " ", "\u2580": "\u2584", "\u2584": "\u2580" };
      expect(b).toBe(Array.from(a, ch => swap[ch] ?? ch).join(""));
    });
  });

  describe("generate → data-url", () => {
    test("returns an SVG data URL", () => {
      const url = Bun.QR.generate("hi", { format: "data-url" });
      expect(url).toStartWith("data:image/svg+xml;base64,");
      const b64 = url.slice("data:image/svg+xml;base64,".length);
      const svg = Buffer.from(b64, "base64").toString("utf8");
      expect(svg).toContain("<svg ");
    });
  });

  describe("generate → image (Bun.Image)", () => {
    test("returns a Bun.Image PNG", async () => {
      const img = Bun.QR.generate("hi", { format: "image", scale: 4, border: 2 });
      expect(img).toBeInstanceOf(Bun.Image);
      const bytes = await img.bytes();
      expect(bytes).toBeInstanceOf(Uint8Array);
      // PNG magic.
      expect(bytes.subarray(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const meta = await img.metadata();
      // 21 modules + 2*2 border = 25, ×4 scale = 100 px.
      expect(meta).toMatchObject({ width: 100, height: 100, format: "png" });
    });

    test("pipes through Bun.Image without copying across APIs", async () => {
      const img = Bun.QR.generate("https://bun.com", { format: "image", scale: 1, border: 0 });
      // Chain into the Image pipeline.
      const webp = await img.webp().bytes();
      expect(webp.subarray(0, 4)).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46])); // RIFF
    });

    test("scale option validation", () => {
      expect(() => Bun.QR.generate("x", { format: "image", scale: 0 })).toThrow(RangeError);
      expect(() => Bun.QR.generate("x", { format: "image", scale: 2000 })).toThrow(RangeError);
    });

    test("rejects images that would exceed the pixel cap", () => {
      // v1 is 21 modules; (21 + 2 * 1024) * 1024 = 2118656 px per side.
      const huge = () => Bun.QR.generate("x", { format: "image", scale: 1024, border: 1024 });
      expect(huge).toThrow(RangeError);
      expect(huge).toThrow("A 2118656x2118656 pixel QR image exceeds the limit of");
      expect(huge).toThrow("Reduce options.scale or options.border");
      expect(() =>
        Bun.QR.generate(Buffer.alloc(2953, 0xff), {
          format: "image",
          errorCorrection: "L",
          boostErrorCorrection: false,
          scale: 1024,
        }),
      ).toThrow(RangeError);
    });
  });

  describe("parse (matrix)", () => {
    test("round-trips generate()", () => {
      for (const input of ["", "A", "HELLO WORLD", "Hello, world!", "https://bun.com", "こんにちは"]) {
        const qr = Bun.QR.generate(input);
        const decoded = Bun.QR.parse(qr);
        expect(decoded).toEqual({
          text: input,
          bytes: expect.any(Uint8Array),
          version: qr.version,
          errorCorrection: qr.errorCorrection,
          mask: qr.mask,
        });
        expect(Buffer.from(decoded.bytes).toString("utf8")).toBe(input);
      }
    });

    test("round-trips numeric and alphanumeric modes", () => {
      expect(Bun.QR.parse(Bun.QR.generate("0123456789")).text).toBe("0123456789");
      expect(Bun.QR.parse(Bun.QR.generate("HELLO WORLD 123")).text).toBe("HELLO WORLD 123");
    });

    test("accepts bare Uint8Array", () => {
      const { matrix } = Bun.QR.generate("bare");
      expect(Bun.QR.parse(matrix).text).toBe("bare");
    });

    test("round-trips binary bytes", () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = i;
      const qr = Bun.QR.generate(data);
      const decoded = Bun.QR.parse(qr);
      expect(decoded.bytes).toEqual(data);
    });

    test("corrects errors up to the ECC capacity", () => {
      const qr = Bun.QR.generate("error correction works", { errorCorrection: "H" });
      const matrix = new Uint8Array(qr.matrix);
      // Flip a few data modules in the middle of the symbol.
      const mid = (qr.size >> 1) * qr.size + (qr.size >> 1);
      for (let i = 0; i < 3; i++) matrix[mid + i] ^= 1;
      const decoded = Bun.QR.parse({ matrix, size: qr.size });
      expect(decoded.text).toBe("error correction works");
    });

    test("rejects garbage", () => {
      expect(() => Bun.QR.parse(new Uint8Array(21 * 21))).toThrow(TypeError);
    });

    test("rejects wrong sizes", () => {
      expect(() => Bun.QR.parse(new Uint8Array(20 * 20))).toThrow(TypeError);
      expect(() => Bun.QR.parse({ matrix: new Uint8Array(10), size: 10 })).toThrow(RangeError);
      // A valid size whose square is not the matrix length.
      expect(() => Bun.QR.parse({ matrix: new Uint8Array(21 * 21), size: 25 })).toThrow(
        "matrix must hold size*size modules, where size is 21..=177 and size % 4 == 1",
      );
    });

    test("undefined and NaN size both mean infer from the matrix length", () => {
      const { matrix } = Bun.QR.generate("sized");
      expect(Bun.QR.parse({ matrix, size: undefined }).text).toBe("sized");
      expect(Bun.QR.parse({ matrix, size: NaN }).text).toBe("sized");
    });
  });

  describe("errors", () => {
    test("no arguments", () => {
      // @ts-expect-error
      expect(() => Bun.QR.generate()).toThrow(TypeError);
    });

    test("invalid errorCorrection", () => {
      expect(() => Bun.QR.generate("x", { errorCorrection: "Z" as any })).toThrow(TypeError);
    });

    test("invalid format", () => {
      expect(() => Bun.QR.generate("x", { format: "bmp" as any })).toThrow(TypeError);
    });

    test("non-number and non-integer options throw", () => {
      expect(() => Bun.QR.generate("x", { minVersion: "10" as any })).toThrow(TypeError);
      expect(() => Bun.QR.generate("x", { scale: 2.5 })).toThrow(TypeError);
      expect(() => Bun.QR.generate("x", { mask: "3" as any })).toThrow(TypeError);
      expect(() => Bun.QR.parse({ matrix: new Uint8Array(21 * 21), size: "21" as any })).toThrow(TypeError);
      // null is rejected like any other non-number.
      expect(() => Bun.QR.generate("x", { minVersion: null as any })).toThrow(TypeError);
      expect(() => Bun.QR.generate("x", { mask: null as any })).toThrow(TypeError);
      // undefined is the same as absent.
      expect(Bun.QR.generate("x", { minVersion: undefined, mask: undefined }).version).toBe(1);
    });

    test("only the documented format and errorCorrection names are accepted", () => {
      expect(() => Bun.QR.generate("x", { format: "png" as any })).toThrow(TypeError);
      expect(() => Bun.QR.generate("x", { errorCorrection: "l" as any })).toThrow(TypeError);
    });

    test("minVersion out of range", () => {
      expect(() => Bun.QR.generate("x", { minVersion: 0 })).toThrow(RangeError);
      expect(() => Bun.QR.generate("x", { minVersion: 41 })).toThrow(RangeError);
    });

    test("mask out of range", () => {
      expect(() => Bun.QR.generate("x", { mask: 8 })).toThrow(RangeError);
      expect(() => Bun.QR.generate("x", { mask: -1 })).toThrow(RangeError);
    });

    test("minVersion > maxVersion", () => {
      expect(() => Bun.QR.generate("x", { minVersion: 10, maxVersion: 5 })).toThrow(TypeError);
    });

    test("data too long", () => {
      // 2954 bytes > v40-L byte capacity (2953). The message reports the bits
      // the input needs (4 mode + 16 count + 2954 * 8) against v40-L's 23648.
      const tooLong = () =>
        Bun.QR.generate(Buffer.alloc(2954, 0xff), {
          errorCorrection: "L",
          boostErrorCorrection: false,
        });
      expect(tooLong).toThrow(RangeError);
      expect(tooLong).toThrow(
        "Input is too long to encode as a QR code: it needs 23652 data bits, but the largest allowed symbol holds 23648",
      );
      // 2953 bytes fits.
      const ok = Bun.QR.generate(Buffer.alloc(2953, 0xff), {
        errorCorrection: "L",
        boostErrorCorrection: false,
      });
      expect(ok.version).toBe(40);
    });

    test("oversized input is rejected up front", () => {
      // Far beyond any symbol's capacity; must throw rather than build the
      // intermediate bit buffer (which is 8x the input).
      const big = new Uint8Array(1024 * 1024);
      expect(() => Bun.QR.generate(big)).toThrow(RangeError);
      expect(() => Bun.QR.generate(Buffer.alloc(1024 * 1024, "7").toString("latin1"))).toThrow(RangeError);
      // Alphanumeric max is 4296 at v40-L; 4297 is rejected even though it
      // is well under the numeric max.
      expect(
        Bun.QR.generate(Buffer.alloc(4296, "A").toString(), { errorCorrection: "L", boostErrorCorrection: false })
          .version,
      ).toBe(40);
      expect(() => Bun.QR.generate(Buffer.alloc(4297, "A").toString())).toThrow(RangeError);
    });

    test("data too long under maxVersion", () => {
      // 200 byte-mode chars at v1 (8-bit count field): 4 + 8 + 1600 bits; v1-M holds 128.
      const atV1 = () => Bun.QR.generate(Buffer.alloc(200, "x").toString(), { maxVersion: 1 });
      expect(atV1).toThrow(RangeError);
      expect(atV1).toThrow("it needs 1612 data bits, but the largest allowed symbol holds 128");
      // 300 bytes do not even fit the 8-bit count field that versions 1-9
      // use. The message still reports the real bit length, 4 + 8 + 2400.
      const atV9 = () => Bun.QR.generate(new Uint8Array(300), { maxVersion: 9 });
      expect(atV9).toThrow(RangeError);
      expect(atV9).toThrow("it needs 2412 data bits, but the largest allowed symbol holds 1456");
    });
  });
});
