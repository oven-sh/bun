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

    test("light/dark colors", () => {
      const svg = Bun.QR.generate("x", { format: "svg", light: "#abcdef", dark: "red" });
      expect(svg).toContain('fill="#abcdef"');
      expect(svg).toContain('fill="red"');
    });

    test("color values are XML-escaped", () => {
      const svg = Bun.QR.generate("x", { format: "svg", dark: '"/><script>' });
      expect(svg).not.toContain("<script>");
      expect(svg).toContain("&quot;");
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
      expect(a).not.toBe(b);
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
      expect(() => Bun.QR.parse(new Uint8Array(20 * 20))).toThrow();
      expect(() => Bun.QR.parse({ matrix: new Uint8Array(10), size: 10 })).toThrow(RangeError);
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

    test("minVersion out of range", () => {
      expect(() => Bun.QR.generate("x", { minVersion: 0 })).toThrow(RangeError);
      expect(() => Bun.QR.generate("x", { minVersion: 41 })).toThrow(RangeError);
    });

    test("mask out of range", () => {
      expect(() => Bun.QR.generate("x", { mask: 8 })).toThrow(RangeError);
      expect(() => Bun.QR.generate("x", { mask: -1 })).toThrow(RangeError);
    });

    test("minVersion > maxVersion", () => {
      expect(() => Bun.QR.generate("x", { minVersion: 10, maxVersion: 5 })).toThrow();
    });

    test("data too long", () => {
      // 2954 bytes > v40-L byte capacity (2953).
      expect(() =>
        Bun.QR.generate(Buffer.alloc(2954, 0xff), {
          errorCorrection: "L",
          boostErrorCorrection: false,
        }),
      ).toThrow(RangeError);
      // 2953 bytes fits.
      const ok = Bun.QR.generate(Buffer.alloc(2953, 0xff), {
        errorCorrection: "L",
        boostErrorCorrection: false,
      });
      expect(ok.version).toBe(40);
    });

    test("data too long under maxVersion", () => {
      expect(() => Bun.QR.generate(Buffer.alloc(200, "x").toString(), { maxVersion: 1 })).toThrow(RangeError);
    });
  });
});
