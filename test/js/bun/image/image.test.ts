import { describe, test, expect } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";
import zlib from "node:zlib";

// ─── Fixture builders ───────────────────────────────────────────────────────
// Fixtures are generated in-process so the test stays hermetic and we never
// commit binary blobs. PNG is hand-assembled (it's the only format where the
// byte layout is simple enough to do that without a codec); JPEG and WebP
// fixtures are produced by round-tripping that PNG through Bun.Image itself —
// which doubles as a smoke-test for the encoders.

// Hand-roll a tiny RGBA8 PNG. width×height pixels, each pixel = pixelOf(x, y).
function makePng(
  width: number,
  height: number,
  pixelOf: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  function crc32(buf: Uint8Array): number {
    let c = ~0 >>> 0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }
  function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(Buffer.from(type, "ascii"), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type = RGBA
  // Raw scanlines: each row is filter byte (0 = none) + width*4 RGBA bytes.
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelOf(x, y);
      const p = row + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// 4×3 with a recognisable per-corner colour so rotate/flip can be asserted by
// looking at where each corner pixel ended up.
//   (0,0)=red   (3,0)=green
//   (0,2)=blue  (3,2)=white
function cornerPattern(x: number, y: number): [number, number, number, number] {
  if (y === 0) return x === 0 ? [255, 0, 0, 255] : x === 3 ? [0, 255, 0, 255] : [128, 128, 128, 255];
  if (y === 2) return x === 0 ? [0, 0, 255, 255] : x === 3 ? [255, 255, 255, 255] : [128, 128, 128, 255];
  return [128, 128, 128, 255];
}
const cornersPng = makePng(4, 3, cornerPattern);

// 16×16 grey gradient — large enough that the lanczos window has real support.
const gradientPng = makePng(16, 16, (x, y) => {
  const v = Math.round(((x + y) / 30) * 255);
  return [v, v, v, 255];
});

function rgbaAt(buf: Uint8Array, w: number, x: number, y: number): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}

// Minimal PNG decoder for 8-bit RGBA non-interlaced (the only kind we emit).
function decodePngRaw(png: Uint8Array): { w: number; h: number; data: Uint8Array } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  let w = 0;
  let h = 0;
  const idats: Uint8Array[] = [];
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  // Undo per-row filter. libspng may pick filter ≠ 0; handle 0–4.
  const stride = w * 4;
  const out = new Uint8Array(w * h * 4);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const rowOut = y * stride;
    const prevOut = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= 4 ? out[rowOut + i - 4] : 0;
      const b = y > 0 ? out[prevOut + i] : 0;
      const c = y > 0 && i >= 4 ? out[prevOut + i - 4] : 0;
      let v = x;
      if (f === 1) v = (x + a) & 255;
      else if (f === 2) v = (x + b) & 255;
      else if (f === 3) v = (x + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      out[rowOut + i] = v;
    }
  }
  return { w, h, data: out };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Bun.Image", () => {
  test("constructor exists and is exposed on Bun", () => {
    expect(typeof Bun.Image).toBe("function");
    expect(() => new Bun.Image()).toThrow();
  });

  test("metadata() reads PNG dimensions", async () => {
    const img = new Bun.Image(cornersPng);
    const meta = await img.metadata();
    expect(meta.width).toBe(4);
    expect(meta.height).toBe(3);
    expect(meta.format).toBe("png");
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
  });

  test("PNG → PNG round-trip preserves every pixel", async () => {
    const out = await new Bun.Image(cornersPng).toBuffer({ format: "png" });
    expect(out[0]).toBe(0x89);
    expect(String.fromCharCode(out[1], out[2], out[3])).toBe("PNG");
    const { w, h, data } = decodePngRaw(out);
    expect(w).toBe(4);
    expect(h).toBe(3);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) expect(rgbaAt(data, 4, x, y)).toEqual(cornerPattern(x, y));
  });

  describe.each(["jpeg", "webp"] as const)("%s", fmt => {
    test(`PNG → ${fmt} → decode dimensions`, async () => {
      const out = await new Bun.Image(gradientPng).toBuffer({ format: fmt, quality: 90 });
      // Magic-byte sanity.
      if (fmt === "jpeg") {
        expect(out[0]).toBe(0xff);
        expect(out[1]).toBe(0xd8);
      } else {
        expect(String.fromCharCode(...out.subarray(0, 4))).toBe("RIFF");
        expect(String.fromCharCode(...out.subarray(8, 12))).toBe("WEBP");
      }
      const meta = await new Bun.Image(out).metadata();
      expect(meta.format).toBe(fmt);
      expect(meta.width).toBe(16);
      expect(meta.height).toBe(16);
    });

    test(`PNG → ${fmt} (q90) → PNG approximates source within tolerance`, async () => {
      const out = await new Bun.Image(gradientPng).toBuffer({ format: fmt, quality: 90 });
      const back = await new Bun.Image(out).toBuffer({ format: "png" });
      const { data } = decodePngRaw(back);
      // Lossy codecs jitter pixels; assert mean absolute error stays small.
      const src = decodePngRaw(gradientPng).data;
      let sum = 0;
      // Compare RGB only — JPEG drops alpha.
      for (let i = 0; i < src.length; i += 4) for (let c = 0; c < 3; c++) sum += Math.abs(src[i + c] - data[i + c]);
      const mae = sum / ((src.length / 4) * 3);
      expect(mae).toBeLessThan(8);
    });
  });

  test("WebP lossless round-trips exactly", async () => {
    const out = await new Bun.Image(cornersPng).toBuffer({ format: "webp", lossless: true });
    const back = decodePngRaw(await new Bun.Image(out).toBuffer({ format: "png" }));
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 4; x++) expect(rgbaAt(back.data, 4, x, y)).toEqual(cornerPattern(x, y));
  });

  test("rotate(90) moves corners CW and swaps dimensions", async () => {
    const out = await new Bun.Image(cornersPng).rotate(90).toBuffer({ format: "png" });
    const { w, h, data } = decodePngRaw(out);
    expect(w).toBe(3);
    expect(h).toBe(4);
    // After 90° CW: src(0,0)=red → dst(h-1, 0)=(2,0); src(3,0)=green → dst(2,3);
    // src(0,2)=blue → dst(0,0); src(3,2)=white → dst(0,3).
    expect(rgbaAt(data, 3, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(data, 3, 2, 3)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(data, 3, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(data, 3, 0, 3)).toEqual([255, 255, 255, 255]);
  });

  test("rotate(180) swaps opposite corners", async () => {
    const { data } = decodePngRaw(await new Bun.Image(cornersPng).rotate(180).toBuffer({ format: "png" }));
    expect(rgbaAt(data, 4, 3, 2)).toEqual([255, 0, 0, 255]); // red → bottom-right
    expect(rgbaAt(data, 4, 0, 0)).toEqual([255, 255, 255, 255]); // white → top-left
  });

  test("flop() mirrors horizontally", async () => {
    const { data } = decodePngRaw(await new Bun.Image(cornersPng).flop().toBuffer({ format: "png" }));
    expect(rgbaAt(data, 4, 3, 0)).toEqual([255, 0, 0, 255]); // red moved to top-right
    expect(rgbaAt(data, 4, 0, 0)).toEqual([0, 255, 0, 255]); // green moved to top-left
  });

  describe("resize", () => {
    test("downscale 16→8 with each filter yields correct dims", async () => {
      for (const filter of ["box", "bilinear", "lanczos3"] as const) {
        const out = await new Bun.Image(gradientPng).resize(8, 8, { filter }).toBuffer({ format: "png" });
        const { w, h } = decodePngRaw(out);
        expect(w).toBe(8);
        expect(h).toBe(8);
      }
    });

    test("box filter on flat colour is identity", async () => {
      const flat = makePng(8, 8, () => [200, 100, 50, 255]);
      const out = await new Bun.Image(flat).resize(4, 4, { filter: "box" }).toBuffer({ format: "png" });
      const { data } = decodePngRaw(out);
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i]).toBe(200);
        expect(data[i + 1]).toBe(100);
        expect(data[i + 2]).toBe(50);
        expect(data[i + 3]).toBe(255);
      }
    });

    test("upscale 4→8 preserves corner colours under lanczos3", async () => {
      const out = await new Bun.Image(cornersPng).resize(8, 6, { filter: "lanczos3" }).toBuffer({ format: "png" });
      const { w, h, data } = decodePngRaw(out);
      expect(w).toBe(8);
      expect(h).toBe(6);
      // Corners should still be ≈ their source colour (lanczos rings clamp at
      // edges, so allow ±10).
      const tl = rgbaAt(data, 8, 0, 0);
      expect(tl[0]).toBeGreaterThan(200);
      expect(tl[1]).toBeLessThan(60);
    });

    test("preserves aspect ratio when height omitted", async () => {
      const meta = decodePngRaw(await new Bun.Image(gradientPng).resize(8).toBuffer({ format: "png" }));
      expect(meta.w).toBe(8);
      expect(meta.h).toBe(8);
    });
  });

  test("path string input reads from disk", async () => {
    using dir = tempDir("bun-image", { "in.png": Buffer.from(gradientPng) });
    const meta = await new Bun.Image(join(String(dir), "in.png")).metadata();
    expect(meta.width).toBe(16);
    expect(meta.height).toBe(16);
  });

  test("rejects on unrecognised input", async () => {
    expect(new Bun.Image(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])).metadata()).rejects.toThrow(
      /unrecognised|decode/i,
    );
  });

  test("rotate rejects non-90° multiples", () => {
    expect(() => new Bun.Image(cornersPng).rotate(45)).toThrow();
  });

  test("chained ops are applied in order (resize then rotate)", async () => {
    const out = await new Bun.Image(gradientPng).resize(8, 4).rotate(90).toBuffer({ format: "png" });
    const { w, h } = decodePngRaw(out);
    expect(w).toBe(4);
    expect(h).toBe(8);
  });

  describe("output-format setters + terminals", () => {
    test(".jpeg().bytes() produces JPEG", async () => {
      const out = await new Bun.Image(gradientPng).jpeg({ quality: 90 }).bytes();
      expect(out[0]).toBe(0xff);
      expect(out[1]).toBe(0xd8);
    });

    test(".webp({lossless}).bytes() produces lossless WebP", async () => {
      const out = await new Bun.Image(cornersPng).webp({ lossless: true }).bytes();
      expect(String.fromCharCode(...out.subarray(8, 12))).toBe("WEBP");
      // Decode-back parity already covered by the round-trip test above; here
      // just confirm the chainable setter took effect.
    });

    test(".bytes() with no setter re-encodes in source format", async () => {
      const jpegBytes = await new Bun.Image(gradientPng).jpeg().bytes();
      const out = await new Bun.Image(jpegBytes).resize(8, 8).bytes();
      // Source was JPEG, no setter called → output should be JPEG.
      expect(out[0]).toBe(0xff);
      expect(out[1]).toBe(0xd8);
    });

    test(".blob() yields a Blob with the right MIME type", async () => {
      const blob = await new Bun.Image(gradientPng).png().blob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/png");
      const back = decodePngRaw(new Uint8Array(await blob.arrayBuffer()));
      expect(back.w).toBe(16);
    });

    test(".toBase64() produces valid base64", async () => {
      const b64 = await new Bun.Image(cornersPng).png().toBase64();
      expect(typeof b64).toBe("string");
      const bytes = Buffer.from(b64, "base64");
      expect(bytes[0]).toBe(0x89);
      expect(String.fromCharCode(bytes[1], bytes[2], bytes[3])).toBe("PNG");
      const back = decodePngRaw(bytes);
      expect(back.w).toBe(4);
    });

    // `new Response(await img.blob())` is the v1 path for serving; lazy
    // body integration (`new Response(img)`) needs Body.zig changes and is
    // tracked separately.
    test("works as a Response body via .blob()", async () => {
      const blob = await new Bun.Image(gradientPng).resize(4, 4).webp().blob();
      const res = new Response(blob);
      expect(res.headers.get("content-type")).toBe("image/webp");
      const buf = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(...buf.subarray(8, 12))).toBe("WEBP");
    });
  });
});
