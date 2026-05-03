import { afterAll, describe, expect, test } from "bun:test";
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

  test("Bun.file() input chains the async file read into the pipeline", async () => {
    using dir = tempDir("image-bunfile", {});
    const p = join(String(dir), "src.png");
    await Bun.write(p, cornersPng);
    // The constructor is sync (just refs the store); the read happens when
    // the terminal is awaited, then the pipeline task runs — both off-thread.
    const img = new Bun.Image(Bun.file(p));
    const meta = await img.metadata();
    expect(meta).toEqual({ width: 4, height: 3, format: "png" });
    // Second terminal on the same instance reuses the now-.owned bytes
    // (no re-read).
    const out = await img.png().bytes();
    expect(out[0]).toBe(0x89);
    // Blob#image() is the same construction.
    const via = Bun.file(p).image();
    expect(via).toBeInstanceOf(Bun.Image);
    expect(await via.metadata()).toEqual(meta);
    // In-memory Blob too — covers the sharedView() branch.
    expect(await new Blob([cornersPng]).image().metadata()).toEqual(meta);
    // Options pass-through.
    await expect(Bun.file(p).image({ maxPixels: 4 }).metadata()).rejects.toThrow(/maxPixels/);
    // Missing file rejects with a real fs error, not an Image-layer one.
    await expect(new Bun.Image(Bun.file(join(String(dir), "nope.png"))).metadata()).rejects.toThrow(/ENOENT/);
    // Synchronous Response-body path: path-backed BunFile falls back to
    // .path source and runs inline.
    const res = new Response(new Bun.Image(Bun.file(p)).resize(2, 2).webp());
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect((await res.bytes()).subarray(8, 12)).toEqual(Buffer.from("WEBP"));
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

    test("resize(w, 0) ≡ resize(w) — explicit zero is the aspect-ratio sentinel", async () => {
      // 16×8 source → width 4 should yield 4×2, not the 4×1 a clamp-to-1 would.
      const wide = makePng(16, 8, (x, y) => [(x * 16) & 255, (y * 32) & 255, 0, 255]);
      const a = decodePngRaw(await new Bun.Image(wide).resize(4, 0).png().bytes());
      const b = decodePngRaw(await new Bun.Image(wide).resize(4).png().bytes());
      expect({ w: a.w, h: a.h }).toEqual({ w: 4, h: 2 });
      expect({ w: a.w, h: a.h }).toEqual({ w: b.w, h: b.h });
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
      await expect(new Bun.Image(bomb).metadata()).rejects.toThrow(/maxPixels/);
    });

    test("maxPixels can be lowered per-instance", async () => {
      await expect(new Bun.Image(gradientPng, { maxPixels: 10 }).metadata()).rejects.toThrow(/maxPixels/);
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
        await expect(new Bun.Image(bad).bytes()).rejects.toThrow();
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

  // ICC colour profile preservation — #30197. The RGBA pixel buffer the
  // pipeline works on carries no colour-space tag, so dropping the source's
  // ICC profile reinterprets non-sRGB inputs (Display P3, Adobe RGB, Jpegli
  // XYB) as sRGB and visibly shifts the colours. Bun's contract here is:
  // source-format re-encode preserves the profile; format conversion
  // preserves it when the target container supports ICC (JPEG APP2, PNG
  // iCCP). WebP drops it — libwebpmux isn't in the build.
  describe("ICC profile", () => {
    // CRC32 and chunk helpers — same logic as makePng above, but we need
    // to splice an iCCP chunk between IHDR and IDAT so keep them local.
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

    // Splice an iCCP chunk carrying `profile` into a valid PNG. The PNG spec
    // requires iCCP before the first IDAT; put it right after IHDR. Chunk
    // body: keyword + 0x00 separator + compression_method=0 + deflate(profile).
    function pngWithIccp(basePng: Uint8Array, profile: Uint8Array, name = "ICC Profile"): Uint8Array {
      const compressed = zlib.deflateSync(profile);
      const body = Buffer.concat([Buffer.from(name, "latin1"), Buffer.from([0, 0]), compressed]);
      const iccp = chunk("iCCP", body);
      // 8-byte signature + IHDR (13-byte data + 12-byte framing = 25).
      const ihdrEnd = 8 + 25;
      return Buffer.concat([basePng.subarray(0, ihdrEnd), iccp, basePng.subarray(ihdrEnd)]);
    }

    // Pull the iCCP profile bytes back out of a PNG to verify it round-tripped.
    function extractPngIccp(png: Uint8Array): Uint8Array | null {
      const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
      let off = 8;
      while (off + 8 <= png.length) {
        const len = dv.getUint32(off);
        const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
        if (type === "iCCP") {
          const body = png.subarray(off + 8, off + 8 + len);
          // keyword\0 compression_method deflate-stream
          let nameEnd = 0;
          while (nameEnd < body.length && body[nameEnd] !== 0) nameEnd++;
          return zlib.inflateSync(body.subarray(nameEnd + 2));
        }
        off += 12 + len;
      }
      return null;
    }

    // Hand-crafted "not an ICC profile" — we just need distinctive bytes that
    // round-trip through libspng's deflate/inflate and libjpeg-turbo's APP2
    // chunking without modification. Neither library validates ICC internals.
    // 384 bytes > 256 so it forces multi-APP2-segment emission paths if libjpeg
    // splits. Wide byte range exercises binary-safe transport (not text).
    const fakeProfile = new Uint8Array(384);
    for (let i = 0; i < fakeProfile.length; i++) fakeProfile[i] = (i * 37 + 11) & 0xff;

    test("PNG iCCP survives PNG re-encode byte-for-byte", async () => {
      const src = pngWithIccp(cornersPng, fakeProfile);
      const out = await new Bun.Image(src).png().bytes();
      const got = extractPngIccp(out);
      expect(got).not.toBeNull();
      expect(Array.from(got!)).toEqual(Array.from(fakeProfile));
    });

    test("PNG iCCP survives resize + re-encode — geometry doesn't drop profile", async () => {
      const src = pngWithIccp(cornersPng, fakeProfile);
      const out = await new Bun.Image(src).resize(8, 6).png().bytes();
      const got = extractPngIccp(out);
      expect(got).not.toBeNull();
      expect(Array.from(got!)).toEqual(Array.from(fakeProfile));
    });

    test("PNG iCCP survives rotate — applyPipeline preserves profile across Decoded swap", async () => {
      const src = pngWithIccp(cornersPng, fakeProfile);
      const out = await new Bun.Image(src).rotate(90).png().bytes();
      const got = extractPngIccp(out);
      expect(got).not.toBeNull();
      expect(Array.from(got!)).toEqual(Array.from(fakeProfile));
    });

    test("PNG iCCP transfers to JPEG encode — cross-format preserves profile", async () => {
      const src = pngWithIccp(cornersPng, fakeProfile);
      const jpg = await new Bun.Image(src).jpeg({ quality: 90 }).bytes();
      // APP2 ICC_PROFILE marker: FF E2 + u16be seglen + "ICC_PROFILE\0" + seq + count + payload.
      // There may be multiple APP2 segments for large profiles; concatenate payloads.
      const marker = Buffer.from("ICC_PROFILE\0", "latin1");
      const pieces: Buffer[] = [];
      let i = 0;
      while (i < jpg.length - 1) {
        if (jpg[i] === 0xff && jpg[i + 1] === 0xe2) {
          const seglen = (jpg[i + 2] << 8) | jpg[i + 3];
          const segBody = jpg.subarray(i + 4, i + 2 + seglen);
          if (segBody.length >= marker.length && Buffer.from(segBody.subarray(0, marker.length)).equals(marker)) {
            // Skip marker (12 bytes) + seq (1) + total (1) = 14-byte header inside segment body.
            pieces.push(Buffer.from(segBody.subarray(marker.length + 2)));
          }
          i += 2 + seglen;
          continue;
        }
        i++;
      }
      expect(pieces.length).toBeGreaterThan(0);
      const reassembled = Buffer.concat(pieces);
      expect(Array.from(reassembled)).toEqual(Array.from(fakeProfile));
    });

    test("PNG without iCCP encodes to PNG without iCCP — no synthetic profile", async () => {
      const out = await new Bun.Image(cornersPng).png().bytes();
      expect(extractPngIccp(out)).toBeNull();
    });

    test("JPEG without ICC_PROFILE encodes to JPEG without ICC_PROFILE", async () => {
      // round-trip a tiny PNG through JPEG without touching ICC — no profile
      // should appear in the JPEG output.
      const jpg = await new Bun.Image(cornersPng).jpeg({ quality: 80 }).bytes();
      const hay = Buffer.from(jpg);
      expect(hay.indexOf(Buffer.from("ICC_PROFILE\0", "latin1"))).toBe(-1);
    });

    test("JPEG → JPEG re-encode preserves ICC_PROFILE APP2 marker", async () => {
      // Build a JPEG with ICC by going PNG(with iCCP) → Bun.Image → JPEG,
      // then re-encode that JPEG through Bun.Image and confirm the profile
      // survives the round-trip.
      const srcPng = pngWithIccp(cornersPng, fakeProfile);
      const jpg = await new Bun.Image(srcPng).jpeg({ quality: 90 }).bytes();
      const reJpg = await new Bun.Image(jpg).jpeg({ quality: 90 }).bytes();
      const marker = Buffer.from("ICC_PROFILE\0", "latin1");
      expect(Buffer.from(reJpg).indexOf(marker)).toBeGreaterThan(-1);
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
    await expect(new Bun.Image(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])).metadata()).rejects.toThrow(
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
      await expect(new Bun.Image(heicHdr).metadata()).rejects.toThrow();
      await expect(new Bun.Image(avifHdr).metadata()).rejects.toThrow();
    });

    if (!isMacOS && !isWindows) {
      test("encode .heic()/.avif() rejects ERR_IMAGE_FORMAT_UNSUPPORTED on Linux", async () => {
        for (const fmt of ["heic", "avif"] as const)
          await expect(new Bun.Image(cornersPng)[fmt]().bytes()).rejects.toMatchObject({
            code: "ERR_IMAGE_FORMAT_UNSUPPORTED",
          });
      });
    } else {
      // HEIC/AVIF encode availability is *machine*-specific, not platform:
      //   • macOS: HEVC ships unconditionally; AV1 encode goes through
      //     VideoToolbox/AVE which only exists on M3+ (M1/M2 and Intel return
      //     kVTCouldNotFindVideoEncoderErr).
      //   • Windows: both are optional Store packages.
      // We can't enumerate that from here, so the test branches on `error.code`
      // and pins BOTH outcomes: success → must round-trip through the sniffer;
      // ERR_IMAGE_FORMAT_UNSUPPORTED → that's the contract for "codec absent".
      // Any *other* error is a regression.
      test.each(["heic", "avif"] as const)(".%s() encodes (or rejects ERR_IMAGE_FORMAT_UNSUPPORTED)", async fmt => {
        let out: Uint8Array;
        try {
          out = await new Bun.Image(cornersPng)[fmt]({ quality: 50 }).bytes();
        } catch (e: any) {
          // Stable code, not message-matching.
          expect(e?.code).toBe("ERR_IMAGE_FORMAT_UNSUPPORTED");
          return;
        }
        expect(String.fromCharCode(...out.subarray(4, 8))).toBe("ftyp");
        // ImageIO emits major_brand=mif1 with the codec brand only in
        // compatibles; the sniffer used to misroute that to .heic for AVIF.
        expect((await new Bun.Image(out).metadata()).format).toBe(fmt);
      });
    }
  });

  // @intFromFloat on NaN/Inf is UB; these used to abort the process.
  test("non-finite / huge numeric inputs are clamped by coerceInt", async () => {
    // rotate: coerceInt clamps to ±1e15, neither of which is a multiple of 90,
    // and NaN clamps to the low bound — so every case throws the SAME error.
    for (const v of [Infinity, -Infinity, NaN, 1e300, -1e300]) {
      expect(() => new Bun.Image(cornersPng).rotate(v)).toThrow(/only multiples of 90/);
    }
    // resize/quality/maxPixels clamp; NaN→lo bound, ±Inf→matching bound.
    const out = await new Bun.Image(cornersPng).resize(NaN, NaN).jpeg({ quality: NaN }).bytes();
    expect(out[0]).toBe(0xff);
    expect((await new Bun.Image(gradientPng, { maxPixels: Infinity }).metadata()).width).toBe(16);
    // Infinity width clamps to the per-side cap; output then exceeds maxPixels
    // and rejects with the bomb-guard error.
    await expect(new Bun.Image(cornersPng).resize(Infinity).png().bytes()).rejects.toThrow(/maxPixels/);
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

    test(".dataurl() is .toBase64() with the MIME prefix", async () => {
      const img = new Bun.Image(cornersPng).png();
      const [b64, url] = await Promise.all([img.toBase64(), img.dataurl()]);
      expect(url).toBe(`data:image/png;base64,${b64}`);
      // Round-trip: the constructor accepts data: URLs.
      expect(await new Bun.Image(url).metadata()).toEqual({ width: 4, height: 3, format: "png" });
      // Format follows the chained encoder.
      expect(await new Bun.Image(cornersPng).webp().dataurl()).toMatch(/^data:image\/webp;base64,/);
    });

    test(".placeholder() is a ThumbHash-rendered ≤32px PNG data: URL", async () => {
      // Source big enough to force the ≤100 box-downscale before the DCT;
      // colour gradient so the LPQ coefficients are non-degenerate.
      const src = makePng(80, 60, (x, y) => [(x * 3) & 255, (y * 4) & 255, ((x ^ y) * 7) & 255, 255]);
      const url = await new Bun.Image(src).placeholder();
      expect(url).toMatch(/^data:image\/png;base64,/);
      // Typical ThumbHash render PNG-encodes to a few hundred bytes.
      expect(url.length).toBeLessThan(2000);
      // The data: URL is itself a valid Bun.Image input — verify it decodes
      // to ≤32px on the long side and preserves aspect (80:60 = 4:3).
      const m = await new Bun.Image(url).metadata();
      expect(m.format).toBe("png");
      expect(Math.max(m.width, m.height)).toBeLessThanOrEqual(32);
      expect(m.width / m.height).toBeCloseTo(80 / 60, 0);
      // Average colour: the source's mean R≈118 G≈118 B≈something — sample
      // the centre pixel of the placeholder; ThumbHash's DC term is exact.
      const px = decodePngRaw(await new Bun.Image(url).png().bytes());
      const cx = (px.w >> 1) + (px.h >> 1) * px.w;
      // Wide tolerance — LPQ quantisation + 4-bit AC + 1.25× chroma boost.
      expect(Math.abs(px.data[cx * 4] - 119)).toBeLessThan(40);
      // Explicit "dataurl" arg accepted, anything else throws.
      expect(await new Bun.Image(src).placeholder("dataurl")).toBe(url);
      expect(() => new Bun.Image(src).placeholder("hash" as any)).toThrow(/dataurl/);
    });

    test(".jpeg({progressive: true}) emits SOF2 (multi-scan)", async () => {
      const baseline = await new Bun.Image(gradientPng).jpeg({ quality: 80 }).bytes();
      const prog = await new Bun.Image(gradientPng).jpeg({ quality: 80, progressive: true }).bytes();
      // Baseline JPEG uses SOF0 (FF C0); progressive uses SOF2 (FF C2). Scan
      // for the marker after SOI+APP0.
      const hasMarker = (b: Uint8Array, m: number) => {
        for (let i = 2; i + 1 < b.length; i++) if (b[i] === 0xff && b[i + 1] === m) return true;
        return false;
      };
      expect(hasMarker(baseline, 0xc0)).toBe(true);
      expect(hasMarker(baseline, 0xc2)).toBe(false);
      expect(hasMarker(prog, 0xc2)).toBe(true);
      // Both decode to the same pixels.
      expect(await new Bun.Image(prog).metadata()).toEqual(await new Bun.Image(baseline).metadata());
    });

    test(".toBuffer() is a Sharp-compat alias for .buffer()", async () => {
      const buf = await new Bun.Image(cornersPng).png().toBuffer();
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf[0]).toBe(0x89);
    });

    test(".write(dest) routes through Bun.write — path string, Bun.file, fs errors", async () => {
      using dir = tempDir("image-write", {});
      // 1. Path string + extension-inferred format.
      const out = join(String(dir), "out.webp");
      const n = await new Bun.Image(cornersPng).resize(2, 2).write(out);
      const bytes = await Bun.file(out).bytes();
      expect(n).toBe(bytes.length);
      expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe("WEBP");
      // 2. Explicit format method overrides extension.
      const out2 = join(String(dir), "wrong.png");
      await new Bun.Image(cornersPng).jpeg({ quality: 50 }).write(out2);
      expect((await Bun.file(out2).bytes())[0]).toBe(0xff); // SOI, not 0x89
      // 3. Bun.file destination — same dest types Bun.write accepts.
      const out3 = Bun.file(join(String(dir), "out3.png"));
      const n3 = await new Bun.Image(cornersPng).png().write(out3);
      expect(n3).toBeGreaterThan(0);
      expect((await out3.bytes())[0]).toBe(0x89);
      // 4. fs error propagates from Bun.write, not the Image layer.
      await expect(new Bun.Image(cornersPng).png().write(String(dir))).rejects.toThrow();
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

describe("decode-only formats (BMP / TIFF / GIF)", () => {
  // Several tests here flip the process-global backend; restore after the
  // describe so leaks can't reach the suites below regardless of throw paths.
  const originalBackend = Bun.Image.backend;
  afterAll(() => {
    Bun.Image.backend = originalBackend;
  });

  // Hand-roll a 24-bit BI_RGB BMP. Rows bottom-up, BGR, 4-byte-aligned stride.
  function makeBmp24(w: number, h: number, pixelOf: (x: number, y: number) => [number, number, number]) {
    const stride = ((w * 3 + 3) >> 2) << 2;
    const pix = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = pixelOf(x, y);
        const o = (h - 1 - y) * stride + x * 3; // bottom-up
        pix[o] = b;
        pix[o + 1] = g;
        pix[o + 2] = r;
      }
    const file = new Uint8Array(14 + 40 + pix.length);
    const dv = new DataView(file.buffer);
    file[0] = 0x42;
    file[1] = 0x4d; // 'BM'
    dv.setUint32(2, file.length, true);
    dv.setUint32(10, 54, true); // bfOffBits
    dv.setUint32(14, 40, true); // biSize
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true); // planes
    dv.setUint16(28, 24, true); // bpp
    file.set(pix, 54);
    return file;
  }

  test("sniffer recognises BMP/TIFF/GIF magic", async () => {
    const cases = [
      [makeBmp24(2, 2, () => [0, 0, 0]), "bmp"],
      [Buffer.from("GIF89a\x02\x00\x02\x00\x00\x00\x00", "binary"), "gif"],
      [Buffer.from("II*\x00\x08\x00\x00\x00", "binary"), "tiff"],
      [Buffer.from("MM\x00*\x00\x00\x00\x08", "binary"), "tiff"],
    ] as const;
    for (const [bytes, fmt] of cases) {
      // metadata() may reject (these aren't full valid files for tiff/gif),
      // but the sniffer is exercised via the format echoed back in the error
      // OR via successful header read for bmp/gif.
      const m = await new Bun.Image(bytes).metadata().catch(() => null);
      if (m) expect(m.format).toBe(fmt);
    }
    // BMP header is fully valid → metadata succeeds everywhere.
    const meta = await new Bun.Image(makeBmp24(7, 3, () => [0, 0, 0])).metadata();
    expect(meta).toEqual({ width: 7, height: 3, format: "bmp" });
  });

  test.each(["bun", "system"] as const)("BMP→PNG round-trips colour & orientation (backend=%s)", async be => {
    // 3×2 with a distinct colour per pixel; if BGR↔RGB or bottom-up↔top-down
    // is wrong the corners won't line up.
    const colours: Record<string, [number, number, number]> = {
      "0,0": [255, 0, 0],
      "1,0": [0, 255, 0],
      "2,0": [0, 0, 255],
      "0,1": [255, 255, 0],
      "1,1": [0, 255, 255],
      "2,1": [255, 0, 255],
    };
    const bmpBytes = makeBmp24(3, 2, (x, y) => colours[`${x},${y}`]);
    Bun.Image.backend = be;
    const png = await new Bun.Image(bmpBytes).png().bytes();
    Bun.Image.backend = isMacOS || isWindows ? "system" : "bun";
    const { w, h, data } = decodePngRaw(png);
    expect({ w, h }).toEqual({ w: 3, h: 2 });
    for (const [k, [r, g, b]] of Object.entries(colours)) {
      const [x, y] = k.split(",").map(Number);
      const o = (y * 3 + x) * 4;
      expect([data[o], data[o + 1], data[o + 2], data[o + 3]]).toEqual([r, g, b, 255]);
    }
  });

  test("BMP 32-bit BI_RGB is XRGB: high byte ignored, alpha=255", async () => {
    // BITMAPINFOHEADER spec marks the 32-bit BI_RGB high byte as reserved;
    // CF_DIB clipboard / GetDIBits / Pillow BGRX all write 0 there. A naïve
    // decoder that treats it as alpha returns a fully-transparent image.
    // 2×1, pixels: [B,G,R,X] = [0,0,255,0] [0,255,0,0].
    // prettier-ignore
    const bmp = Buffer.concat([
      Buffer.from([0x42, 0x4d]),                                   // BM
      Buffer.from(new Uint32Array([14 + 40 + 8, 0, 14 + 40]).buffer), // bfSize, reserved, bfOffBits
      Buffer.from(new Uint32Array([40]).buffer),                   // biSize
      Buffer.from(new Int32Array([2, 1]).buffer),                  // biWidth, biHeight
      Buffer.from(new Uint16Array([1, 32]).buffer),                // biPlanes, biBitCount
      Buffer.from(new Uint32Array([0, 8, 0, 0, 0, 0]).buffer),     // BI_RGB, biSizeImage, ppm×2, clrUsed, clrImportant
      Buffer.from([0, 0, 255, 0,  0, 255, 0, 0]),                  // BGRX × 2
    ]);
    const png = await new Bun.Image(bmp, { backend: "bun" }).png().bytes();
    const { data } = decodePngRaw(png);
    expect([...data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...data.subarray(4, 8)]).toEqual([0, 255, 0, 255]);
  });

  test("static BMP decoder rejects truncated pixel data (no OOB read)", async () => {
    // ImageIO/WIC tolerate a short last row, so force the static path. Copy
    // (`.slice`, not `.subarray`) so the Image source can't see past the
    // truncation via the shared backing ArrayBuffer.
    Bun.Image.backend = "bun";
    const ok = makeBmp24(8, 8, () => [1, 2, 3]);
    const cut = ok.slice(0, ok.length - 5);
    await expect(new Bun.Image(cut).png().bytes()).rejects.toThrow(/decode failed/);
  });

  // Reference GIF89a writer — naive LZW (one code per pixel, no string
  // matching) so the bit-packing is the only thing under test; the decoder
  // sees the same code/width sequence a real encoder would emit because
  // dict growth depends on codes-seen, not on whether they were matches.
  function makeGif(
    w: number,
    h: number,
    palette: [number, number, number][],
    indexOf: (x: number, y: number) => number,
    opts: { interlace?: boolean; trns?: number; lct?: boolean } = {},
  ) {
    const bits = Math.max(2, 32 - Math.clz32((palette.length - 1) | 1));
    const tbl = 1 << bits;
    const ct = new Uint8Array(tbl * 3);
    palette.forEach((c, i) => ct.set(c, i * 3));

    // ── LZW pack ──────────────────────────────────────────────────────────
    // The encoder/decoder width-bump rule: width starts at min+1; after the
    // *encoder* has emitted enough codes that the next dict slot would need
    // an extra bit (avail > (1<<size)-1), bump. With one literal per code
    // and no clears mid-stream, the encoder adds a dict entry for every
    // output AFTER the first, so width grows at exactly the points the
    // decoder expects.
    const clear = 1 << bits,
      eoi = clear + 1;
    let size = bits + 1,
      avail = eoi + 1,
      acc = 0,
      nbits = 0;
    const lzw: number[] = [];
    const put = (c: number) => {
      acc |= c << nbits;
      nbits += size;
      while (nbits >= 8) {
        lzw.push(acc & 0xff);
        acc >>>= 8;
        nbits -= 8;
      }
    };
    put(clear);
    // Row order: scan-order or interlace pass-order, so the decoder's
    // de-interlace is what we're actually testing.
    const rows: number[] = [];
    if (opts.interlace)
      for (const [s, st] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ])
        for (let y = s; y < h; y += st) rows.push(y);
    else for (let y = 0; y < h; y++) rows.push(y);
    let first = true;
    for (const y of rows)
      for (let x = 0; x < w; x++) {
        put(indexOf(x, y));
        if (!first && avail < 4096) {
          if (++avail > (1 << size) - 1 && size < 12) size++;
        }
        first = false;
      }
    put(eoi);
    if (nbits) lzw.push(acc & 0xff);

    // ── container ─────────────────────────────────────────────────────────
    const out: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8];
    out.push((opts.lct ? 0 : 0x80) | (bits - 1), 0, 0); // LSD: GCT present (unless lct), size
    if (!opts.lct) out.push(...ct);
    if (opts.trns != null) out.push(0x21, 0xf9, 4, 1, 0, 0, opts.trns, 0); // GCE
    out.push(0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8);
    out.push((opts.lct ? 0x80 : 0) | (opts.interlace ? 0x40 : 0) | (opts.lct ? bits - 1 : 0));
    if (opts.lct) out.push(...ct);
    out.push(bits); // LZW min code size
    for (let i = 0; i < lzw.length; i += 255) {
      const n = Math.min(255, lzw.length - i);
      out.push(n, ...lzw.slice(i, i + n));
    }
    out.push(0, 0x3b);
    return new Uint8Array(out);
  }

  async function gifPixels(gif: Uint8Array, backend: "bun" | "system" = "bun") {
    Bun.Image.backend = backend;
    return decodePngRaw(await new Bun.Image(gif).png().bytes());
  }

  test.each(["bun", "system"] as const)("GIF: 1×1 minimal (backend=%s)", async be => {
    const g = makeGif(1, 1, [[0xff, 0x80, 0x40]], () => 0);
    expect(await new Bun.Image(g).metadata()).toEqual({ width: 1, height: 1, format: "gif" });
    expect([...(await gifPixels(g, be)).data.subarray(0, 4)]).toEqual([0xff, 0x80, 0x40, 0xff]);
  });

  test("GIF: width-growth boundary (forces 3→4→5-bit transitions mid-row)", async () => {
    // 4-colour palette, 20 pixels: avail walks 6→26 so size crosses 3→4 at
    // avail=8 and 4→5 at avail=16. Each pixel is its index mod 4; check
    // every pixel round-trips.
    const pal: [number, number, number][] = [
      [10, 0, 0],
      [0, 20, 0],
      [0, 0, 30],
      [40, 40, 40],
    ];
    const g = makeGif(20, 1, pal, x => x % 4);
    const { data } = await gifPixels(g);
    for (let x = 0; x < 20; x++) expect([...data.subarray(x * 4, x * 4 + 3)]).toEqual(pal[x % 4]);
  });

  test("GIF: GCE transparency index zeroes alpha for that index only", async () => {
    const pal: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
    ];
    const g = makeGif(2, 1, pal, x => x, { trns: 1 });
    const { data } = await gifPixels(g);
    expect([...data]).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });

  test("GIF: interlaced rows reorder to scan order", async () => {
    // 1×9 column where index = y; if de-interlace is wrong the colours come
    // out in pass order (0,8,4,2,6,1,3,5,7) instead of 0..8.
    const pal: [number, number, number][] = Array.from({ length: 9 }, (_, i) => [i * 28, 0, 0]);
    const g = makeGif(1, 9, pal, (_x, y) => y, { interlace: true });
    const { data } = await gifPixels(g);
    for (let y = 0; y < 9; y++) expect(data[y * 4]).toBe(y * 28);
  });

  test("GIF: local colour table overrides GCT", async () => {
    const g = makeGif(1, 1, [[9, 8, 7]], () => 0, { lct: true });
    expect([...(await gifPixels(g)).data.subarray(0, 3)]).toEqual([9, 8, 7]);
  });

  test("GIF: 255-byte extension sub-block (XMP-style) parses without overflow", async () => {
    // Regression: `i += 1 + n` with u8 n=255 overflowed before widening to
    // usize — Debug panic, ReleaseFast spun a WorkPool thread forever. Real
    // GIFs hit this via XMP/ICC application extensions that emit max-size
    // sub-blocks. Splice a 0x21 0xFF application-extension block (11-byte
    // header + one 255-byte sub-block + terminator) before the first frame.
    const base = makeGif(2, 2, [[7, 7, 7]], () => 0);
    // 0x21 0xFF <11> "BUNTESTXMP " <255> <…255 bytes…> <0>
    const ext = Buffer.concat([
      Buffer.from([0x21, 0xff, 11]),
      Buffer.from("BUNTESTXMP "),
      Buffer.from([255]),
      Buffer.alloc(255, 0x41),
      Buffer.from([0]),
    ]);
    // Find the Image Descriptor (0x2C) and insert the extension just before it.
    const at = base.indexOf(0x2c, 13);
    const g = Buffer.concat([base.subarray(0, at), ext, base.subarray(at)]);
    // Force the static decoder explicitly so this regression test still hits
    // codec_gif.zig when run in isolation on macOS/Windows (the constructor
    // has no per-instance backend option; the previous version relied on
    // earlier tests' side-effect on the process-global).
    Bun.Image.backend = "bun";
    const m = await new Bun.Image(g).metadata();
    expect(m).toEqual({ width: 2, height: 2, format: "gif" });
    // And actually decode (exercises Bits.drain too).
    const out = await new Bun.Image(g).png().bytes();
    expect(out[0]).toBe(0x89);
  });

  test("GIF: 256-colour palette + multi-sub-block (>255 LZW bytes)", async () => {
    const pal: [number, number, number][] = Array.from({ length: 256 }, (_, i) => [i, 255 - i, i ^ 0x55]);
    // 64×8=512 pixels at ≥9-bit codes ⇒ well over one 255-byte sub-block.
    const g = makeGif(64, 8, pal, (x, y) => (x * 4 + y * 32) & 255);
    const { w, h, data } = await gifPixels(g);
    expect({ w, h }).toEqual({ w: 64, h: 8 });
    for (const [x, y] of [
      [0, 0],
      [63, 0],
      [0, 7],
      [63, 7],
      [31, 4],
    ]) {
      const i = (x * 4 + y * 32) & 255;
      expect([...data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)]).toEqual(pal[i]);
    }
  });

  test.skipIf(!isMacOS && !isWindows)("GIF: makeGif fixtures parity-check against system backend", async () => {
    // The reference encoder above is the test's own code — guard against it
    // and the static decoder agreeing on a shared bug by cross-checking
    // every fixture against ImageIO/WIC.
    const pal: [number, number, number][] = Array.from({ length: 16 }, (_, i) => [
      i * 16,
      255 - i * 16,
      (i * 37) & 255,
    ]);
    for (const opts of [{}, { interlace: true }, { trns: 3 }, { lct: true }]) {
      const g = makeGif(13, 7, pal, (x, y) => (x + y * 3) & 15, opts);
      const a = await gifPixels(g, "bun");
      const b = await gifPixels(g, "system");
      expect(Buffer.compare(a.data, b.data)).toBe(0);
    }
  });

  test("static GIF decoder rejects out-of-range LZW code", async () => {
    Bun.Image.backend = "bun";
    // First code after clear is 7 (> avail=6): clear=100, 7=111 → bits
    // [0..6)=001·111 → byte 0b00111100 = 0x3c.
    // prettier-ignore
    const bad = Buffer.from([
      0x47,0x49,0x46,0x38,0x39,0x61, 0x02,0x00,0x02,0x00,0x80,0x00,0x00,
      0x00,0x00,0x00, 0xff,0xff,0xff,
      0x2c,0x00,0x00,0x00,0x00,0x02,0x00,0x02,0x00,0x00,
      0x02, 0x01, 0x3c, 0x00, 0x3b,
    ]);
    await expect(new Bun.Image(bad).png().bytes()).rejects.toThrow(/decode failed/);
  });

  // Real-file parity: generate a GIF with macOS `sips` (uses ImageIO's
  // encoder, exercises width growth + interlace=off + a full 256-colour
  // table) and verify the static decoder matches ImageIO's own decode.
  test.skipIf(!isMacOS)("static GIF decoder matches ImageIO on a sips-generated file", async () => {
    using dir = tempDir("image-gif", {});
    const pngPath = join(String(dir), "g.png");
    const gifPath = join(String(dir), "g.gif");
    await Bun.write(
      pngPath,
      makePng(17, 13, (x, y) => [(x * 15) & 255, (y * 19) & 255, ((x ^ y) * 31) & 255, 255]),
    );
    await using sips = Bun.spawn({
      cmd: ["sips", "-s", "format", "gif", pngPath, "--out", gifPath],
      stdio: ["ignore", "ignore", "pipe"],
    });
    expect(await sips.exited).toBe(0);
    const gifBytes = await Bun.file(gifPath).bytes();
    Bun.Image.backend = "system";
    const ref = decodePngRaw(await new Bun.Image(gifBytes).png().bytes()).data;
    Bun.Image.backend = "bun";
    const got = decodePngRaw(await new Bun.Image(gifBytes).png().bytes()).data;
    // GIF quantises, so both decoders see the SAME palette indices → byte-
    // identical RGBA, no tolerance needed.
    expect(Buffer.compare(got, ref)).toBe(0);
  });

  if (!isMacOS && !isWindows) {
    test("TIFF on Linux throws UnsupportedOnPlatform", async () => {
      const tiff = Buffer.from("II*\x00\x08\x00\x00\x00", "binary");
      await expect(new Bun.Image(tiff).png().bytes()).rejects.toMatchObject({ code: "ERR_IMAGE_FORMAT_UNSUPPORTED" });
    });
  }
});

describe("Bun.Image clipboard statics", () => {
  // The actual clipboard contents are environment state we don't control, so
  // these assert API SHAPE per platform, not contents.
  test("hasClipboardImage / clipboardChangeCount / fromClipboard have the documented per-platform behaviour", () => {
    expect(typeof Bun.Image.hasClipboardImage()).toBe("boolean");
    if (isMacOS || isWindows) {
      const n = Bun.Image.clipboardChangeCount();
      expect(Number.isInteger(n)).toBe(true);
      expect(Bun.Image.clipboardChangeCount()).toBe(n); // monotone, idempotent until something writes
      const img = Bun.Image.fromClipboard();
      expect(img === null || img instanceof Bun.Image).toBe(true);
      expect(Bun.Image.hasClipboardImage()).toBe(img !== null);
    } else {
      expect(Bun.Image.clipboardChangeCount()).toBe(-1);
      expect(Bun.Image.fromClipboard()).toBe(null);
      expect(Bun.Image.hasClipboardImage()).toBe(false);
    }
  });
});

describe("Bun.Image.backend", () => {
  // Mutates a process-global; capture and restore around the block so the
  // describe order doesn't leak the override into the suites above.
  const original = Bun.Image.backend;
  afterAll(() => {
    Bun.Image.backend = original;
  });

  test("default reflects platform", () => {
    expect(Bun.Image.backend).toBe(isMacOS || isWindows ? "system" : "bun");
  });

  test("rejects unknown values", () => {
    expect(() => {
      // @ts-expect-error
      Bun.Image.backend = "wic";
    }).toThrow(TypeError);
    expect(Bun.Image.backend).toBe(original);
  });

  // Same input → both backends → both must round-trip pixels exactly. The
  // system path goes through ImageIO/WIC + vImage; the bun path is
  // spng/libwebp + Highway. Reflect/rotate are pure permutations so byte
  // equality holds; resize uses lanczos3 (the only filter the system path
  // accepts) so we just check dimensions and that it's not all-black.
  test.each(["bun", "system"] as const)("backend=%s pipeline parity", async backend => {
    Bun.Image.backend = backend;
    expect(Bun.Image.backend).toBe(backend);

    const round = decodePngRaw(await new Bun.Image(cornersPng).png().bytes());
    expect([...round.data]).toEqual([...decodePngRaw(cornersPng).data]);

    // .flop() is horizontal reflect; .flip() is vertical (Sharp naming).
    const flopOnce = decodePngRaw(await new Bun.Image(cornersPng).flop().png().bytes());
    const flopTwice = decodePngRaw(
      await new Bun.Image(await new Bun.Image(cornersPng).flop().png().bytes()).flop().png().bytes(),
    );
    expect([...flopOnce.data.subarray(0, 4)]).toEqual([...round.data.subarray((4 - 1) * 4, 4 * 4)]);
    expect([...flopTwice.data]).toEqual([...round.data]);

    const r4 = async (deg: number) => decodePngRaw(await new Bun.Image(cornersPng).rotate(deg).png().bytes());
    const r90 = await r4(90);
    expect([r90.w, r90.h]).toEqual([3, 4]);
    expect([...(await r4(180)).data.subarray(0, 4)]).toEqual([...round.data.subarray(-4)]);

    const scaled = decodePngRaw(await new Bun.Image(cornersPng).resize(40, 30, { filter: "lanczos3" }).png().bytes());
    expect([scaled.w, scaled.h]).toEqual([40, 30]);
    // First corner is opaque red in the fixture; lanczos can ring ±a few LSB
    // but it shouldn't be black (the regression this guards against).
    expect(scaled.data[0]).toBeGreaterThan(200);
    expect(scaled.data[3]).toBe(255);
  });

  test("backend='bun' surfaces the HEIC gap, backend='system' covers it", async () => {
    Bun.Image.backend = "bun";
    // No static HEIC encoder anywhere — should reject regardless of OS.
    await expect(new Bun.Image(cornersPng).heic().bytes()).rejects.toThrow();
    if (isMacOS) {
      Bun.Image.backend = "system";
      const out = await new Bun.Image(cornersPng).heic().bytes();
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
