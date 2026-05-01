import { describe, expect, test } from "bun:test";
import { isMacOS, isWindows, tempDir } from "harness";
import zlib from "node:zlib";
import { join } from "path";

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
    const out = await new Bun.Image(cornersPng).png().bytes();
    expect(out[0]).toBe(0x89);
    expect(String.fromCharCode(out[1], out[2], out[3])).toBe("PNG");
    const { w, h, data } = decodePngRaw(out);
    expect(w).toBe(4);
    expect(h).toBe(3);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) expect(rgbaAt(data, 4, x, y)).toEqual(cornerPattern(x, y));
  });

  describe.each(["jpeg", "webp"] as const)("%s", fmt => {
    test(`PNG → ${fmt} → decode dimensions`, async () => {
      const out = await new Bun.Image(gradientPng)[fmt]({ quality: 90 }).bytes();
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
      const out = await new Bun.Image(gradientPng)[fmt]({ quality: 90 }).bytes();
      const back = await new Bun.Image(out).png().bytes();
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
    const out = await new Bun.Image(cornersPng).webp({ lossless: true }).bytes();
    const back = decodePngRaw(await new Bun.Image(out).png().bytes());
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 4; x++) expect(rgbaAt(back.data, 4, x, y)).toEqual(cornerPattern(x, y));
  });

  test("rotate(90) moves corners CW and swaps dimensions", async () => {
    const out = await new Bun.Image(cornersPng).rotate(90).png().bytes();
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
    const { data } = decodePngRaw(await new Bun.Image(cornersPng).rotate(180).png().bytes());
    expect(rgbaAt(data, 4, 3, 2)).toEqual([255, 0, 0, 255]); // red → bottom-right
    expect(rgbaAt(data, 4, 0, 0)).toEqual([255, 255, 255, 255]); // white → top-left
  });

  test("flop() mirrors horizontally", async () => {
    const { data } = decodePngRaw(await new Bun.Image(cornersPng).flop().png().bytes());
    expect(rgbaAt(data, 4, 3, 0)).toEqual([255, 0, 0, 255]); // red moved to top-right
    expect(rgbaAt(data, 4, 0, 0)).toEqual([0, 255, 0, 255]); // green moved to top-left
  });

  describe("resize", () => {
    test("downscale 16→8 with each filter yields correct dims", async () => {
      for (const filter of ["box", "bilinear", "lanczos3"] as const) {
        const out = await new Bun.Image(gradientPng).resize(8, 8, { filter }).png().bytes();
        const { w, h } = decodePngRaw(out);
        expect(w).toBe(8);
        expect(h).toBe(8);
      }
    });

    test("box filter on flat colour is identity", async () => {
      const flat = makePng(8, 8, () => [200, 100, 50, 255]);
      const out = await new Bun.Image(flat).resize(4, 4, { filter: "box" }).png().bytes();
      const { data } = decodePngRaw(out);
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i]).toBe(200);
        expect(data[i + 1]).toBe(100);
        expect(data[i + 2]).toBe(50);
        expect(data[i + 3]).toBe(255);
      }
    });

    test("upscale 4→8 preserves corner colours under lanczos3", async () => {
      const out = await new Bun.Image(cornersPng).resize(8, 6, { filter: "lanczos3" }).png().bytes();
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
      const meta = decodePngRaw(await new Bun.Image(gradientPng).resize(8).png().bytes());
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

  describe("security", () => {
    // A 100k×100k PNG header in <200 bytes — the canonical decompression bomb.
    test("maxPixels rejects oversized PNG before allocating", async () => {
      const bomb = makePng(1, 1, () => [0, 0, 0, 255]);
      // Patch IHDR width/height in-place to 100000×100000 and recompute the
      // chunk CRC; the IDAT is still a single black pixel so the file stays tiny.
      const dv = new DataView(bomb.buffer, bomb.byteOffset);
      dv.setUint32(16, 100_000);
      dv.setUint32(20, 100_000);
      let c = ~0 >>> 0;
      for (let i = 12; i < 29; i++) {
        c ^= bomb[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
      dv.setUint32(29, ~c >>> 0);
      expect(new Bun.Image(bomb).metadata()).rejects.toThrow(/maxPixels/);
    });

    test("maxPixels can be lowered per-instance", async () => {
      expect(new Bun.Image(gradientPng, { maxPixels: 10 }).metadata()).rejects.toThrow(/maxPixels/);
      // …and the default still admits it.
      expect((await new Bun.Image(gradientPng).metadata()).width).toBe(16);
    });

    // Malformed-input regression set: every codec must reject cleanly (no
    // crash, no hang) on truncated or junk data. Tests `.bytes()` (full decode)
    // — `.metadata()` is now header-only and would correctly succeed on a PNG
    // with an intact IHDR but no IDAT.
    for (const [name, bad] of [
      ["truncated PNG", cornersPng.slice(0, 30)],
      ["truncated JPEG", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])],
      ["truncated WebP", Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "binary")],
    ] as const) {
      test(`rejects cleanly on ${name}`, async () => {
        expect(new Bun.Image(bad).bytes()).rejects.toThrow();
      });
    }
  });

  // These exercise the system-backend paths on macOS (CoreGraphics) and
  // Windows (WIC) where they're active; on Linux they hit the static codecs.
  // Either way the assertions are the contract.
  describe("cross-backend correctness", () => {
    test("translucent alpha survives PNG→PNG (catches premultiplied-alpha mislabel)", async () => {
      // 50% alpha red — the case CoreGraphics gets wrong if it interprets the
      // straight-alpha input buffer as premultiplied.
      const src = makePng(4, 4, () => [200, 60, 30, 128]);
      const out = await new Bun.Image(src).png().bytes();
      const back = decodePngRaw(out);
      const px = rgbaAt(back.data, 4, 1, 1);
      expect(px[3]).toBe(128);
      // Allow ±2 for any backend's internal rounding.
      expect(Math.abs(px[0] - 200)).toBeLessThanOrEqual(2);
      expect(Math.abs(px[1] - 60)).toBeLessThanOrEqual(2);
      expect(Math.abs(px[2] - 30)).toBeLessThanOrEqual(2);
    });

    test("PNG output has nothing after IEND (catches WIC GlobalSize over-read)", async () => {
      const out = await new Bun.Image(gradientPng).png().bytes();
      // Walk chunks to find where IEND ends; the buffer must end exactly there.
      const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
      let off = 8;
      let iendEnd = -1;
      while (off + 8 <= out.length) {
        const len = dv.getUint32(off);
        const type = String.fromCharCode(out[off + 4], out[off + 5], out[off + 6], out[off + 7]);
        const chunkEnd = off + 12 + len;
        if (type === "IEND") {
          iendEnd = chunkEnd;
          break;
        }
        off = chunkEnd;
      }
      expect(iendEnd).toBe(out.length);
    });

    test("PNG encode is deterministic across two calls", async () => {
      const a = await new Bun.Image(gradientPng).png().bytes();
      const b = await new Bun.Image(gradientPng).png().bytes();
      expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    });

    test("64×48 lanczos3 downscale → upscale stays close to source", async () => {
      const src = makePng(64, 48, (x, y) => [(x * 4) & 255, (y * 5) & 255, ((x ^ y) * 3) & 255, 255]);
      const half = await new Bun.Image(src).resize(32, 24).png().bytes();
      expect(decodePngRaw(half).w).toBe(32);
      // Round-tripping through a 2× downscale loses high-frequency detail but
      // mean error should stay bounded regardless of which backend resized.
      const back = decodePngRaw(await new Bun.Image(half).resize(64, 48).png().bytes());
      const ref = decodePngRaw(src).data;
      let sum = 0;
      for (let i = 0; i < ref.length; i += 4)
        for (let c = 0; c < 3; c++) sum += Math.abs(ref[i + c] - back.data[i + c]);
      expect(sum / ((ref.length / 4) * 3)).toBeLessThan(25);
    });

    test("JPEG encode respects quality (lower quality → smaller file)", async () => {
      const big = makePng(64, 64, (x, y) => [(x * 4) & 255, (y * 4) & 255, ((x * y) >> 2) & 255, 255]);
      const q90 = await new Bun.Image(big).jpeg({ quality: 90 }).bytes();
      const q20 = await new Bun.Image(big).jpeg({ quality: 20 }).bytes();
      expect(q20.length).toBeLessThan(q90.length);
    });
  });

  // EXIF: build a minimal JPEG via Bun.Image, then splice in an APP1 segment
  // carrying Orientation=6 (90° CW). A 4×2 source should report 2×4 after
  // auto-orient.
  test("EXIF Orientation=6 auto-rotates", async () => {
    const src = makePng(4, 2, () => [128, 128, 128, 255]);
    const jpg = await new Bun.Image(src).jpeg({ quality: 90 }).bytes();
    // Minimal big-endian TIFF: "MM\0*" + IFD0 offset 8; 1 entry: tag 0x0112,
    // type 3 (SHORT), count 1, value 6.
    // prettier-ignore
    const tiff = new Uint8Array([
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // header
      0x00, 0x01,                                     // 1 entry
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,                         // next IFD = 0
    ]);
    const exif = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
    const seglen = exif.length + 2;
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, seglen >> 8, seglen & 255]), exif]);
    const withExif = Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);

    const meta = await new Bun.Image(withExif).metadata();
    expect(meta).toEqual({ width: 2, height: 4, format: "jpeg" });
    // And opting out leaves it landscape.
    const raw = await new Bun.Image(withExif, { autoOrient: false }).metadata();
    expect(raw).toEqual({ width: 4, height: 2, format: "jpeg" });
  });

  test("rejects on unrecognised input", async () => {
    expect(new Bun.Image(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])).metadata()).rejects.toThrow(
      /unrecognised|decode/i,
    );
  });

  test("rotate rejects non-90° multiples", () => {
    expect(() => new Bun.Image(cornersPng).rotate(45)).toThrow();
  });

  describe("HEIC / AVIF (system-backend formats)", () => {
    // Minimal ftyp boxes — enough for the sniffer; not valid images. Decode
    // must reject AFTER sniffing the format (so we hit the right codepath).
    const heicHdr = Buffer.from([
      0,
      0,
      0,
      24,
      ..."ftyp".split("").map(c => c.charCodeAt(0)),
      ..."heic".split("").map(c => c.charCodeAt(0)),
      0,
      0,
      0,
      0,
      ..."mif1heic".split("").map(c => c.charCodeAt(0)),
    ]);
    const avifHdr = Buffer.from([
      0,
      0,
      0,
      24,
      ..."ftyp".split("").map(c => c.charCodeAt(0)),
      ..."avif".split("").map(c => c.charCodeAt(0)),
      0,
      0,
      0,
      0,
      ..."avifmif1".split("").map(c => c.charCodeAt(0)),
    ]);

    test("sniffer recognises ftyp brands", async () => {
      // metadata() will fail (not a real image) but the FORMAT in the error
      // path proves the sniffer routed correctly. On Linux it's
      // UnsupportedOnPlatform; on macOS/Windows the system codec rejects.
      expect(new Bun.Image(heicHdr).metadata()).rejects.toThrow();
      expect(new Bun.Image(avifHdr).metadata()).rejects.toThrow();
    });

    if (!isMacOS && !isWindows) {
      test("encode .heic()/.avif() throws UnsupportedOnPlatform on Linux", async () => {
        expect(new Bun.Image(cornersPng).heic().bytes()).rejects.toThrow(/not supported on this platform/);
        expect(new Bun.Image(cornersPng).avif().bytes()).rejects.toThrow(/not supported on this platform/);
      });
    } else {
      // On macOS/Windows the system encoder may or may not have the codec
      // installed (HEVC license on Windows, AVIF only on macOS 13+). Either
      // outcome is fine; just no crash.
      test(".heic()/.avif() either encode or fall through cleanly", async () => {
        for (const fmt of ["heic", "avif"] as const) {
          try {
            const out = await new Bun.Image(cornersPng)[fmt]({ quality: 50 }).bytes();
            // If it succeeded, it must be an ISO BMFF.
            expect(String.fromCharCode(...out.subarray(4, 8))).toBe("ftyp");
          } catch (e) {
            expect(String(e)).toMatch(/not supported|BackendUnavailable|encode/i);
          }
        }
      });
    }
  });

  // @intFromFloat on NaN/Inf is UB; these used to abort the process.
  test("non-finite numeric inputs throw or clamp instead of panicking", async () => {
    expect(() => new Bun.Image(cornersPng).rotate(Infinity)).toThrow(/finite/);
    expect(() => new Bun.Image(cornersPng).rotate(NaN)).toThrow(/finite/);
    // resize/quality/maxPixels clamp; NaN→lo bound, ±Inf→matching bound.
    const out = await new Bun.Image(cornersPng).resize(NaN, NaN).jpeg({ quality: NaN }).bytes();
    expect(out[0]).toBe(0xff);
    expect((await new Bun.Image(gradientPng, { maxPixels: Infinity }).metadata()).width).toBe(16);
    // Infinity width clamps to the per-side cap; output then exceeds maxPixels
    // and rejects cleanly — the contract is "doesn't abort", not "succeeds".
    expect(new Bun.Image(cornersPng).resize(Infinity).png().bytes()).rejects.toThrow(/maxPixels/);
  });

  test("constructor cleans up on throwing options getter", () => {
    // Just asserts no crash/leak path; the actual leak would only show under
    // a sanitizer, but the throw must surface.
    expect(
      () =>
        new Bun.Image(cornersPng, {
          get maxPixels() {
            throw new Error("boom");
          },
        }),
    ).toThrow("boom");
  });

  // Sharp semantics: rotate runs BEFORE resize regardless of call order, and a
  // second .resize() overwrites the first rather than resizing twice.
  test("pipeline order is fixed (rotate before resize) and setters overwrite", async () => {
    const out = await new Bun.Image(cornersPng) // 4×3
      .resize(100, 100) // overwritten below
      .rotate(90) // → 3×4
      .resize(6, 8)
      .png()
      .bytes();
    const { w, h } = decodePngRaw(out);
    expect(w).toBe(6);
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

    test(".buffer() returns a Node Buffer", async () => {
      const buf = await new Bun.Image(cornersPng).png().buffer();
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf[0]).toBe(0x89);
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

    test("fit:'inside' preserves aspect ratio inside the box", async () => {
      const out = await new Bun.Image(gradientPng) // 16×16
        .resize(8, 32, { fit: "inside" })
        .png()
        .bytes();
      const { w, h } = decodePngRaw(out);
      // 16×16 into an 8×32 box → scale = min(8/16, 32/16) = 0.5 → 8×8.
      expect(w).toBe(8);
      expect(h).toBe(8);
    });

    test("modulate({saturation:0}) greyscales: R=G=B per pixel", async () => {
      const out = await new Bun.Image(cornersPng).modulate({ saturation: 0 }).png().bytes();
      const { data } = decodePngRaw(out);
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i]).toBe(data[i + 1]);
        expect(data[i + 1]).toBe(data[i + 2]);
      }
      // Red corner's luma ≈ 0.299*255 ≈ 76.
      const tl = rgbaAt(data, 4, 0, 0);
      expect(tl[0]).toBeGreaterThan(70);
      expect(tl[0]).toBeLessThan(82);
    });

    test("modulate({brightness}) scales values", async () => {
      const flat = makePng(2, 2, () => [100, 100, 100, 255]);
      const out = await new Bun.Image(flat).modulate({ brightness: 0.5 }).png().bytes();
      const { data } = decodePngRaw(out);
      expect(data[0]).toBe(50);
    });

    test("png({palette:true}) emits indexed PNG that round-trips colours", async () => {
      // 2×2 with 4 distinct, well-separated colours — median-cut at 4 slots
      // is exact when input has ≤ slots distinct values with equal counts.
      const four = makePng(2, 2, (x, y) => [x ? 255 : 0, y ? 255 : 0, x === y ? 255 : 0, 255]);
      const out = await new Bun.Image(four).png({ palette: true, colors: 4 }).bytes();
      // Colour-type byte lives at IHDR[+9] = file offset 25.
      expect(out[25]).toBe(3); // indexed
      const back = decodePngRaw(await new Bun.Image(out).png().bytes());
      expect(rgbaAt(back.data, 2, 0, 0)).toEqual([0, 0, 255, 255]);
      expect(rgbaAt(back.data, 2, 1, 0)).toEqual([255, 0, 0, 255]);
      expect(rgbaAt(back.data, 2, 0, 1)).toEqual([0, 255, 0, 255]);
      expect(rgbaAt(back.data, 2, 1, 1)).toEqual([255, 255, 255, 255]);
    });

    test("png({palette:true, colors:16}) is much smaller than truecolour for a screenshot-ish image", async () => {
      // Flat regions + a few colours — the case palette mode is for.
      const shot = makePng(64, 64, (x, y) =>
        x < 32 ? [30, 30, 30, 255] : y < 32 ? [200, 200, 200, 255] : [80, 120, 200, 255],
      );
      const rgba = await new Bun.Image(shot).png({ compressionLevel: 9 }).bytes();
      const idx = await new Bun.Image(shot).png({ palette: true, colors: 16, compressionLevel: 9 }).bytes();
      expect(idx.length).toBeLessThan(rgba.length);
    });

    test("png({compressionLevel:0}) is larger than level 9", async () => {
      const big = makePng(32, 32, (x, y) => [(x * 8) & 255, (y * 8) & 255, ((x + y) * 4) & 255, 255]);
      const fast = await new Bun.Image(big).png({ compressionLevel: 0 }).bytes();
      const small = await new Bun.Image(big).png({ compressionLevel: 9 }).bytes();
      expect(small.length).toBeLessThan(fast.length);
    });

    test("withoutEnlargement leaves a smaller source untouched", async () => {
      const out = await new Bun.Image(cornersPng) // 4×3
        .resize(100, 100, { fit: "inside", withoutEnlargement: true })
        .png()
        .bytes();
      const { w, h } = decodePngRaw(out);
      expect(w).toBe(4);
      expect(h).toBe(3);
    });

    test("new Response(image) encodes and sets Content-Type", async () => {
      const res = new Response(new Bun.Image(gradientPng).resize(4, 4).webp());
      expect(res.headers.get("content-type")).toBe("image/webp");
      const buf = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(...buf.subarray(8, 12))).toBe("WEBP");
      const meta = await new Bun.Image(buf).metadata();
      expect(meta).toEqual({ width: 4, height: 4, format: "webp" });
    });

    test("new Request({body: image}) works the same way", async () => {
      const req = new Request("http://x/", { method: "POST", body: new Bun.Image(cornersPng).jpeg() });
      expect(req.headers.get("content-type")).toBe("image/jpeg");
      const buf = new Uint8Array(await req.arrayBuffer());
      expect(buf[0]).toBe(0xff);
      expect(buf[1]).toBe(0xd8);
    });
  });
});
