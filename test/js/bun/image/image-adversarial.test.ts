// Adversarial / hardening suite for Bun.Image.
//
// Goal: every input that comes from outside (the byte buffer, the option
// objects, the dimensions inside a header) is hostile until proven otherwise.
// These tests don't care WHICH error gets thrown — they care that nothing
// aborts, hangs, leaks, or returns uninitialised memory. A pass is "rejected
// cleanly OR succeeded with sane output"; a fail is a crash, a SIGKILL, a
// timeout, or a buffer that doesn't match what it claims to be.
//
// Kept in its own file so the happy-path image.test.ts stays readable.

import { afterEach, describe, expect, test } from "bun:test";
import { gcTick, tempDir } from "harness";
import { join } from "node:path";
import zlib from "node:zlib";

// Several tests below force `backend = "bun"` to reach the static decoders
// regardless of platform; restore after every test so a throw can't leak the
// override into the next describe (which would falsify the system-backend
// suites in image.test.ts run after this file).
const defaultBackend = Bun.Image.backend;
afterEach(() => {
  Bun.Image.backend = defaultBackend;
});

// ─── shared fixture builders (duplicated from image.test.ts intentionally —
//     this file should be runnable standalone) ────────────────────────────────

function crc32(buf: Uint8Array): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function makePng(
  w: number,
  h: number,
  pixelOf: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixelOf(x, y);
      const p = row + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

const tinyPng = makePng(2, 2, (x, y) => [x * 255, y * 255, 128, 255]);
const tinyJpeg = await new Bun.Image(tinyPng).jpeg({ quality: 80 }).bytes();
const tinyWebp = await new Bun.Image(tinyPng).webp({ quality: 80 }).bytes();
const tinyWebpLossless = await new Bun.Image(tinyPng).webp({ lossless: true }).bytes();

/** Assert the promise either rejects or resolves — never aborts/hangs. */
async function survives(p: Promise<unknown>): Promise<"rejected" | "resolved"> {
  try {
    await p;
    return "resolved";
  } catch {
    return "rejected";
  }
}

// ─── 1. format confusion / lying magic bytes ─────────────────────────────────

describe("format confusion", () => {
  // Real magic, wrong body.
  test.each([
    ["JPEG magic + PNG body", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), tinyPng.subarray(8)])],
    ["PNG magic + JPEG body", Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n"), tinyJpeg.subarray(2)])],
    ["WebP magic + JPEG body", Buffer.concat([Buffer.from("RIFF\x00\x00\x00\x00WEBP"), tinyJpeg.subarray(2)])],
    ["JPEG magic + zeros", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)])],
    ["PNG magic + zeros", Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n"), Buffer.alloc(64, 0)])],
  ])("%s rejects without crashing", async (_name, buf) => {
    expect(await survives(new Bun.Image(buf).metadata())).toBe("rejected");
  });

  // Valid magic, valid different-format body — sniffer should follow the
  // MAGIC, codec then rejects the body. Either way no crash.
  test("PNG with valid JPEG appended (polyglot-ish)", async () => {
    const poly = Buffer.concat([tinyPng, tinyJpeg]);
    // Leading PNG is valid → should decode fine and ignore the trailer.
    const meta = await new Bun.Image(poly).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(2);
  });

  test("magic-only inputs (3–12 bytes)", async () => {
    for (const buf of [
      new Uint8Array([0xff, 0xd8, 0xff]),
      Buffer.from("\x89PNG\r\n\x1a\n"),
      Buffer.from("RIFF\x04\x00\x00\x00WEBP"),
    ]) {
      expect(await survives(new Bun.Image(buf).metadata())).toBe("rejected");
    }
  });
});

// ─── 2. truncation at every boundary ─────────────────────────────────────────

describe("truncation sweep", () => {
  // Slice each known-good fixture at every offset and confirm we never crash.
  // This is the cheapest broad-spectrum fuzz: it hits every "read N more bytes"
  // boundary in each codec's header parser.
  for (const [name, fixture] of [
    ["png", tinyPng],
    ["jpeg", tinyJpeg],
    ["webp", tinyWebp],
  ] as const) {
    test.concurrent(`${name}: every prefix length 1..${fixture.length - 1}`, async () => {
      for (let n = 1; n < fixture.length; n++) {
        await survives(new Bun.Image(fixture.subarray(0, n)).metadata());
      }
    });
  }

  test("zero-length input", async () => {
    expect(await survives(new Bun.Image(new Uint8Array(0)).metadata())).toBe("rejected");
  });

  test("single byte of every value", async () => {
    for (let v = 0; v < 256; v++) await survives(new Bun.Image(new Uint8Array([v])).metadata());
  });

  test("GIF with EOI-only LZW does not leak heap bytes into output", async () => {
    Bun.Image.backend = "bun";
    // 4×4 frame, 256-colour identity palette (entry i = {i,i,i}), LZW stream =
    // clear,EOI only → `written = 0`. Pre-fix the unfilled idx[] was raw
    // mimalloc bytes mapped 1:1 through the identity palette into R/G/B.
    // Post-fix the tail is filled with the trns/background index (0) so the
    // whole frame is palette[0] = black.
    const ct = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) ct.set([i, i, i], i * 3);
    // prettier-ignore
    const gif = Buffer.concat([
      Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61, 4,0, 4,0, 0xf7, 0, 0]), // sig+LSD: 256-col GCT
      ct,
      Buffer.from([0x2c,0,0,0,0,4,0,4,0,0,  8, 2, 0x00,0x03, 0, 0x3b]), // imgdesc · min=8 · clear(256),eoi(257) at 9-bit
    ]);
    const got = await new Bun.Image(gif).png().bytes();
    // png decode of an all-black 4×4 — every R/G/B byte must be 0. If ANY
    // heap byte leaked through the identity palette, this fails.
    const m = await new Bun.Image(got).metadata();
    expect(m).toEqual({ width: 4, height: 4, format: "png" });
  });

  test("BMP BI_BITFIELDS with hostile masks rejects, not panics", async () => {
    Bun.Image.backend = "bun";
    // V4HEADER (108) so the alpha mask slot exists; r_mask=0xFFFFFFFF
    // (popcount 32 → would have @intCast-panicked into u5).
    function bmpWithMasks(r: number, g: number, b: number, a: number) {
      const buf = new Uint8Array(14 + 108 + 4);
      const dv = new DataView(buf.buffer);
      buf[0] = 0x42;
      buf[1] = 0x4d;
      dv.setUint32(2, buf.length, true);
      dv.setUint32(10, 14 + 108, true);
      dv.setUint32(14, 108, true); // biSize = V4
      dv.setInt32(18, 1, true);
      dv.setInt32(22, 1, true);
      dv.setUint16(26, 1, true);
      dv.setUint16(28, 32, true);
      dv.setUint32(30, 3, true); // BI_BITFIELDS
      dv.setUint32(54, r, true);
      dv.setUint32(58, g, true);
      dv.setUint32(62, b, true);
      dv.setUint32(66, a, true);
      return buf;
    }
    for (const m of [0xffffffff, 0x01ffffff /* 25-bit */, 0x00ff00ff /* non-contiguous */]) {
      await expect(new Bun.Image(bmpWithMasks(m, 0x0000ff00, 0x000000ff, 0)).png().bytes()).rejects.toThrow(
        /decode failed/,
      );
    }
    // Sanity: a normal 8-bit mask still decodes.
    await new Bun.Image(bmpWithMasks(0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000)).png().bytes();
  });

  test("BMP biSize ≈ u32::MAX rejects (no `14 + ih_size` wrap)", async () => {
    Bun.Image.backend = "bun";
    const buf = new Uint8Array(54);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x42;
    buf[1] = 0x4d;
    dv.setUint32(14, 0xffff_fff0, true); // ih_size that wraps 14+x in u32
    await expect(new Bun.Image(buf).metadata()).rejects.toThrow(/decode failed/);
  });
});

// ─── 3. lying / overflowing header fields ────────────────────────────────────

describe("hostile header dimensions", () => {
  function pngWithDims(w: number, h: number): Uint8Array {
    const out = Buffer.from(tinyPng); // copy
    const dv = new DataView(out.buffer, out.byteOffset);
    dv.setUint32(16, w >>> 0);
    dv.setUint32(20, h >>> 0);
    dv.setUint32(29, crc32(out.subarray(12, 29)));
    return out;
  }

  test.each([
    ["0×0", 0, 0],
    ["0×100", 0, 100],
    ["2^31-1 × 1", 0x7fffffff, 1],
    ["2^32-1 × 2^32-1 (wraps to negative in i32 land)", 0xffffffff, 0xffffffff],
    ["65535 × 65535 (passes i32 but huge)", 65535, 65535],
    ["1 × 2^31-1", 1, 0x7fffffff],
  ])("PNG IHDR %s rejects via maxPixels or codec, no alloc", async (_name, w, h) => {
    expect(await survives(new Bun.Image(pngWithDims(w, h)).metadata())).toBe("rejected");
  });

  // Same headers with maxPixels raised past the default — probe must reject
  // out-of-spec >2³¹-1 dims itself, not let them reach the i32 last_width
  // cast. (PNG spec §11.2.2 caps each dimension at 2³¹-1.)
  test.each([
    ["2^32-1 × 1", 0xffffffff, 1],
    ["2^31 × 1 (one past spec cap)", 0x80000000, 1],
  ])("PNG IHDR %s rejects even with maxPixels: 1e15", async (_name, w, h) => {
    await expect(new Bun.Image(pngWithDims(w, h), { maxPixels: 1e15 }).metadata()).rejects.toThrow(/decode failed/);
  });

  test("PNG IHDR claiming bit-depth 0 / colour-type 99", async () => {
    for (const [off, val] of [
      [24, 0],
      [25, 99],
    ] as const) {
      const buf = Buffer.from(tinyPng);
      buf[off] = val;
      const dv = new DataView(buf.buffer, buf.byteOffset);
      dv.setUint32(29, crc32(buf.subarray(12, 29)));
      // metadata() is header-only and IHDR is structurally readable; full
      // decode is what must reject.
      expect(await survives(new Bun.Image(buf).bytes())).toBe("rejected");
    }
  });

  test("path source: non-regular file rejects with ENODEV (no infinite read / FIFO park)", async () => {
    if (process.platform === "win32") return; // NUL behaves differently
    // /dev/null is a char device everywhere; the fstat S_ISREG guard must
    // refuse it before readToEnd loops.
    await expect(new Bun.Image("/dev/null").metadata()).rejects.toThrow(/ENODEV|not a/i);
  });

  test("resize H-then-V intermediate (dst_w × src_h) is bounded by maxPixels", async () => {
    // 1×8192 real source (8192px input — well under default cap), resize to
    // 200000×1 (200k output — also under). Intermediate is 200000×8192 ≈
    // 1.6 G, which the cross-product guard rejects against default maxPixels.
    // Without the guard this would alloc 200000×8192×4 ≈ 6.5 GiB.
    const tall = makePng(1, 8192, () => [0, 0, 0, 255]);
    await expect(new Bun.Image(tall).resize(200000, 1).bytes()).rejects.toThrow(/maxPixels/);
    // And with maxPixels low enough that even modest intermediates trip:
    const small = makePng(1, 64, () => [0, 0, 0, 255]);
    await expect(new Bun.Image(small, { maxPixels: 1000 }).resize(100, 1).bytes()).rejects.toThrow(/maxPixels/);
    // Sanity: a small intermediate still works.
    expect((await new Bun.Image(small).resize(4, 4).png().bytes())[0]).toBe(0x89);
  });

  test("WebP VP8 frame header with absurd dims", async () => {
    // RIFF + WEBP + VP8 chunk header + 10-byte VP8 bitstream header where
    // bytes 6–9 encode width/height (14-bit each). Craft 16383×16383.
    // This is within u16 but width*height*4 ≈ 1 GiB → maxPixels guard.
    const riff = Buffer.from("RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00", "binary");
    const vp8 = Buffer.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0xff, 0x3f, 0xff, 0x3f, 0, 0, 0, 0]);
    expect(await survives(new Bun.Image(Buffer.concat([riff, vp8])).bytes())).toBe("rejected");
  });
});

// ─── 4. malformed PNG chunk structure ────────────────────────────────────────

describe("malformed PNG structure", () => {
  test("IDAT length field larger than remaining file", async () => {
    const buf = Buffer.from(tinyPng);
    // IDAT starts after sig(8)+IHDR(25)=33; its length field is at offset 33.
    const dv = new DataView(buf.buffer, buf.byteOffset);
    dv.setUint32(33, 0xffffff00);
    expect(await survives(new Bun.Image(buf).bytes())).toBe("rejected");
  });

  test("IHDR CRC mismatch is tolerated (spng default ignores CRC)", async () => {
    const buf = Buffer.from(tinyPng);
    buf[29] ^= 0xff;
    expect(await new Bun.Image(buf).metadata()).toEqual({ width: 2, height: 2, format: "png" });
  });

  test("missing IEND is tolerated (spec recovery: stream ending after a complete IDAT is valid)", async () => {
    const buf = tinyPng.subarray(0, tinyPng.length - 12);
    expect(await new Bun.Image(buf).metadata()).toEqual({ width: 2, height: 2, format: "png" });
  });

  test("IDAT with zlib bomb (header says small, IDAT inflates huge)", async () => {
    // 8×8 IHDR but IDAT is a highly-compressible stream that *would* inflate
    // to far more bytes than 8×8 needs. The codec should stop at the expected
    // size, not keep inflating.
    const ihdr = new Uint8Array(13);
    const iv = new DataView(ihdr.buffer);
    iv.setUint32(0, 8);
    iv.setUint32(4, 8);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const huge = Buffer.alloc(10_000_000, 0); // 10 MB of zeros, deflates tiny
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", zlib.deflateSync(huge)),
      pngChunk("IEND", new Uint8Array(0)),
    ]);
    // Either succeeds (codec reads only what IHDR demands) or rejects; the
    // assertion is "doesn't allocate 10 MB worth of pixels for an 8×8".
    const meta = await new Bun.Image(png).metadata();
    expect(meta.width).toBe(8);
  });
});

// ─── 5. malformed JPEG / EXIF ────────────────────────────────────────────────

describe("malformed JPEG", () => {
  test("APP segment length pointing past EOF", async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    expect(await survives(new Bun.Image(buf).metadata())).toBe("rejected");
  });

  test("SOS with no scan data", async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
    expect(await survives(new Bun.Image(buf).metadata())).toBe("rejected");
  });

  // EXIF-specific: hostile IFD0 count / offsets must not loop or read OOB.
  test("EXIF with IFD count = 0xFFFF (entry walk bounds-check)", async () => {
    // Build the same minimal-EXIF JPEG as image.test.ts but lie about count.
    const tiff = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0xff, 0xff]);
    const exif = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
    const seglen = exif.length + 2;
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, seglen >> 8, seglen & 255]), exif]);
    const withExif = Buffer.concat([tinyJpeg.subarray(0, 2), app1, tinyJpeg.subarray(2)]);
    // exif.zig must bail on the first OOB rd16 and return .normal — JPEG still decodes.
    const meta = await new Bun.Image(withExif).metadata();
    expect(meta.format).toBe("jpeg");
  });

  test("EXIF with IFD0 offset pointing outside the segment", async () => {
    const tiff = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0xff, 0xff, 0xff, 0xf0]);
    const exif = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
    const seglen = exif.length + 2;
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, seglen >> 8, seglen & 255]), exif]);
    const withExif = Buffer.concat([tinyJpeg.subarray(0, 2), app1, tinyJpeg.subarray(2)]);
    expect((await new Bun.Image(withExif).metadata()).format).toBe("jpeg");
  });
});

// ─── 6. lossless roundtrip parity ────────────────────────────────────────────

describe("lossless roundtrip", () => {
  // Random-ish RGBA8 noise; PNG and lossless WebP must preserve every byte.
  const w = 17;
  const h = 13; // intentionally odd & non-power-of-two
  const seed = 0x9e3779b9;
  function lcg(n: number) {
    return (Math.imul(n, 1664525) + 1013904223) >>> 0;
  }
  // Alpha is forced to ≥1: WebPEncodeLosslessRGBA calls
  // WebPCleanupTransparentArea which zeroes RGB under α=0 (a documented
  // libwebp size optimisation, not a Bun bug). PNG preserves RGB under α=0;
  // WebP-lossless does not. The α=0 case is asserted separately below.
  let s = seed;
  const noise = makePng(w, h, () => {
    s = lcg(s);
    return [(s >>> 0) & 255, (s >>> 8) & 255, (s >>> 16) & 255, ((s >>> 24) & 255) | 1];
  });
  const ref = (() => {
    let s2 = seed;
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      s2 = lcg(s2);
      out[i * 4] = s2 & 255;
      out[i * 4 + 1] = (s2 >>> 8) & 255;
      out[i * 4 + 2] = (s2 >>> 16) & 255;
      out[i * 4 + 3] = ((s2 >>> 24) & 255) | 1;
    }
    return out;
  })();

  async function rgbaOf(bytes: Uint8Array): Promise<Uint8Array> {
    // Route back to PNG and decode with the test's own minimal decoder so we
    // compare against ground truth, not against another Bun.Image call.
    const png = await new Bun.Image(bytes).png().bytes();
    // (use the inflate-based reader from image.test.ts logic)
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let off = 8;
    let pw = 0;
    let ph = 0;
    const idats: Uint8Array[] = [];
    while (off < png.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
      const data = png.subarray(off + 8, off + 8 + len);
      if (type === "IHDR") {
        pw = dv.getUint32(off + 8);
        ph = dv.getUint32(off + 12);
      } else if (type === "IDAT") idats.push(data);
      else if (type === "IEND") break;
      off += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idats));
    const stride = pw * 4;
    const out = new Uint8Array(pw * ph * 4);
    let p = 0;
    for (let y = 0; y < ph; y++) {
      const f = raw[p++];
      const ro = y * stride;
      const po = (y - 1) * stride;
      for (let i = 0; i < stride; i++) {
        const x = raw[p++];
        const a = i >= 4 ? out[ro + i - 4] : 0;
        const b = y > 0 ? out[po + i] : 0;
        const c = y > 0 && i >= 4 ? out[po + i - 4] : 0;
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
        out[ro + i] = v;
      }
    }
    return out;
  }

  test("PNG → PNG preserves every byte of noise", async () => {
    const out = await new Bun.Image(noise).png().bytes();
    expect(Buffer.compare(await rgbaOf(out), ref)).toBe(0);
  });

  test("PNG → lossless WebP → PNG preserves every byte of noise (α≥1)", async () => {
    const wp = await new Bun.Image(noise).webp({ lossless: true }).bytes();
    const back = await new Bun.Image(wp).png().bytes();
    expect(Buffer.compare(await rgbaOf(back), ref)).toBe(0);
  });

  test("WebP-lossless zeroes RGB under α=0 (documented libwebp behaviour)", async () => {
    const one = makePng(1, 1, () => [123, 45, 200, 0]);
    const wp = await new Bun.Image(one).webp({ lossless: true }).bytes();
    const back = await rgbaOf(wp);
    expect([...back]).toEqual([0, 0, 0, 0]);
  });

  test("rotate(90)×4 = identity", async () => {
    let cur: Uint8Array = noise;
    for (let i = 0; i < 4; i++) cur = await new Bun.Image(cur).rotate(90).png().bytes();
    expect(Buffer.compare(await rgbaOf(cur), ref)).toBe(0);
  });

  test("flip().flip() = identity, flop().flop() = identity", async () => {
    const a = await new Bun.Image(await new Bun.Image(noise).flip().png().bytes()).flip().png().bytes();
    const b = await new Bun.Image(await new Bun.Image(noise).flop().png().bytes()).flop().png().bytes();
    expect(Buffer.compare(await rgbaOf(a), ref)).toBe(0);
    expect(Buffer.compare(await rgbaOf(b), ref)).toBe(0);
  });
});

// ─── 7. memory hygiene under repetition ──────────────────────────────────────

describe("memory hygiene", () => {
  // RSS is the wrong metric for the first N iterations: each WorkPool thread
  // gets its own mimalloc arena, and on macOS ImageIO/vImage allocate per-call
  // CF/CG temporaries that under ASAN sit in quarantine before reuse. RSS
  // climbs a few hundred MB while those warm, then plateaus (release build is
  // flat by ~200 iters; debug+ASAN takes ~2k). To detect a real per-call leak,
  // warm the caches first, THEN measure.
  async function leakCheck(body: () => Promise<unknown>, warm = 2000, run = 1500) {
    for (let i = 0; i < warm; i++) {
      await body();
      if ((i & 127) === 0) gcTick(true);
    }
    gcTick(true);
    const before = process.memoryUsage().rss;
    for (let i = 0; i < run; i++) {
      await body();
      if ((i & 127) === 0) gcTick(true);
    }
    gcTick(true);
    return process.memoryUsage().rss - before;
  }

  test("decode/encode cycles plateau (no per-call leak after warmup)", async () => {
    const delta = await leakCheck(() => new Bun.Image(tinyPng).png().bytes());
    // 32 MB budget over 1500 calls = >21 KB/call would have to leak to fail.
    expect(delta).toBeLessThan(32 * 1024 * 1024);
  });

  test("error paths plateau (no per-call leak after warmup)", async () => {
    const bad = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const delta = await leakCheck(() => survives(new Bun.Image(bad).metadata()));
    expect(delta).toBeLessThan(32 * 1024 * 1024);
  });

  test("constructor with throwing getter cleans up under repetition", () => {
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 10_000; i++) {
      try {
        new Bun.Image(tinyPng, {
          get maxPixels() {
            throw new Error("x");
          },
        });
      } catch {}
      if ((i & 1023) === 0) gcTick(true);
    }
    gcTick(true);
    expect(process.memoryUsage().rss - before).toBeLessThan(64 * 1024 * 1024);
  });
});

// ─── 8. hostile JS option objects ────────────────────────────────────────────

describe("hostile option objects", () => {
  test("Proxy that throws on every property access", async () => {
    const p = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        has() {
          throw new Error("trap");
        },
      },
    );
    expect(() => new Bun.Image(tinyPng).resize(2, 2, p as any)).toThrow();
    expect(() => new Bun.Image(tinyPng).jpeg(p as any)).toThrow();
    expect(() => new Bun.Image(tinyPng, p as any)).toThrow();
  });

  test("garbage option types: enum slots throw, numeric slots ignore non-numbers", async () => {
    // Non-string enum option → getOptionalEnum throws synchronously.
    expect(() => new Bun.Image(tinyPng).resize(2, 2, { filter: 12345 } as any)).toThrow(/filter must be a string/);
    expect(() => new Bun.Image(tinyPng).resize(2, 2, { fit: [] } as any)).toThrow(/fit must be a string/);
    // A string-coercible object isn't a JS string — refused, not coerced.
    expect(() => new Bun.Image(tinyPng).resize(2, 2, { fit: { toString: () => "inside" } } as any)).toThrow(
      /fit must be a string/,
    );
    // Numeric options are gated on isNumber(); a Symbol is ignored and the
    // default applies, so the pipeline still produces a valid JPEG.
    const out = await new Bun.Image(tinyPng).jpeg({ quality: Symbol() } as any).bytes();
    expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  test("getter that mutates the same Image mid-parse", async () => {
    const img = new Bun.Image(tinyPng);
    let fired = false;
    const opts = {
      get filter() {
        if (!fired) {
          fired = true;
          img.rotate(90).flop(); // re-enter while resize() is parsing
        }
        return "lanczos3";
      },
    };
    // Pipeline is plain struct slots; re-entrant set is harmless. Just no crash.
    const out = await img
      .resize(2, 2, opts as any)
      .png()
      .bytes();
    expect(out[0]).toBe(0x89);
  });

  test("detached ArrayBuffer input", async () => {
    const ab = tinyPng.buffer.slice(tinyPng.byteOffset, tinyPng.byteOffset + tinyPng.byteLength);
    structuredClone(ab, { transfer: [ab] }); // detaches `ab`
    // Constructor sees byteLength 0; must reject, not read freed memory.
    expect(await survives(new Bun.Image(ab).metadata())).toBe("rejected");
  });

  test("resizable ArrayBuffer is rejected at construction", () => {
    const ab = new ArrayBuffer(tinyPng.byteLength, { maxByteLength: tinyPng.byteLength * 2 });
    new Uint8Array(ab).set(tinyPng);
    expect(() => new Bun.Image(ab)).toThrow(/resizable/);
    // …and a view into one is rejected the same way.
    expect(() => new Bun.Image(new Uint8Array(ab))).toThrow(/resizable/);
  });

  test("detach AFTER construction rejects the next terminal", async () => {
    const ab = tinyPng.buffer.slice(tinyPng.byteOffset, tinyPng.byteOffset + tinyPng.byteLength);
    const img = new Bun.Image(ab);
    expect((await img.metadata()).width).toBe(2);
    structuredClone(ab, { transfer: [ab] }); // detach between calls
    // schedule() re-reads the buffer and sees byteLength 0.
    await expect(img.png().bytes()).rejects.toThrow(/detached/);
  });

  test("OversizeTypedArray input survives `.buffer` → transfer() while worker decodes (pin-after-adopt)", async () => {
    // Fresh Uint8Array > fastSizeLimit elements with no .buffer touched yet =
    // OversizeTypedArray. The borrow helper adopts its storage into a real
    // ArrayBuffer (createAdopted — wraps in place, no byte copy) and pins.
    // `transfer()` on a pinned buffer falls back to copyTo (JSC ArrayBuffer
    // .cpp:500), so the call SUCCEEDS but the original storage is untouched
    // — the worker keeps reading the same pointer.
    const a = new Uint8Array(tinyPng.length + 4096);
    a.set(tinyPng);
    const p = new Bun.Image(a.subarray(0, tinyPng.length)).png().bytes();
    const moved = a.buffer.transfer();
    // While pinned: transfer() returned a COPY; `a` is NOT detached.
    expect(moved.byteLength).toBe(tinyPng.length + 4096);
    expect(a.byteLength).toBe(tinyPng.length + 4096);
    expect((await p)[0]).toBe(0x89);
    // After resolve the pin is released; now transfer() actually detaches.
    a.buffer.transfer();
    expect(a.byteLength).toBe(0);
  });

  test("SharedArrayBuffer input is refused (cross-thread mutation surface)", () => {
    const sab = new SharedArrayBuffer(tinyPng.byteLength);
    new Uint8Array(sab).set(tinyPng);
    // The borrow-not-copy contract means a cross-thread store between header
    // parse and full decode could re-shape the implied output behind a guard
    // that's already passed; refuse SAB so the contract is enforceable.
    expect(() => new Bun.Image(sab)).toThrow(/shared/);
    expect(() => new Bun.Image(new Uint8Array(sab))).toThrow(/shared/);
  });

  test("data: URL input (base64)", async () => {
    const url = "data:image/png;base64," + Buffer.from(tinyPng).toString("base64");
    const meta = await new Bun.Image(url).metadata();
    expect(meta).toEqual({ width: 2, height: 2, format: "png" });
  });

  test("data: URL with bad base64 throws", () => {
    expect(() => new Bun.Image("data:image/png;base64,!!!not base64!!!")).toThrow(/base64/);
  });
});

// ─── 9. concurrency / re-use ─────────────────────────────────────────────────

describe("concurrent terminals on one Image", () => {
  test("100 concurrent .bytes() on the same instance", async () => {
    const img = new Bun.Image(tinyPng).png();
    const all = await Promise.all(Array.from({ length: 100 }, () => img.bytes()));
    // Each must be a valid, identical PNG (deterministic encode).
    for (const b of all) expect(Buffer.compare(Buffer.from(b), Buffer.from(all[0]))).toBe(0);
  });

  test("concurrent terminals on a Bun.file source — first BlobReadChain wins, later resolvers don't free it", async () => {
    // The .blob source path used to UAF: two BlobReadChains both swap source
    // to .owned, the second one's source.deinit() frees what a worker thread
    // is mid-decode on. With the fix, only the first swap takes effect; later
    // resolvers drop their redundant read and re-enter on the existing .owned.
    using dir = tempDir("image-blob-race", {});
    const p = join(String(dir), "src.png");
    await Bun.write(p, tinyPng);
    const img = new Bun.Image(Bun.file(p)).png();
    const all = await Promise.all(Array.from({ length: 32 }, () => img.bytes()));
    for (const b of all) expect(Buffer.compare(Buffer.from(b), Buffer.from(all[0]))).toBe(0);
  });

  test("interleaved setters between awaits don't tear a snapshot", async () => {
    // Each terminal copies Pipeline at schedule time; mutating after schedule
    // must not change the in-flight task.
    const img = new Bun.Image(tinyPng);
    const p = img.jpeg({ quality: 90 }).bytes();
    img.png(); // change format AFTER scheduling
    const out = await p;
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8); // still JPEG
  });
});

// ─── 10. random-byte fuzz (cheap, bounded) ───────────────────────────────────

describe("random-byte fuzz", () => {
  // Deterministic LCG so failures are reproducible from the seed.
  function fuzz(seed: number, len: number): Uint8Array {
    let s = seed >>> 0;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  }

  test("256 random buffers of varying length never crash", async () => {
    for (let i = 0; i < 256; i++) {
      const len = 4 + ((i * 37) % 512);
      await survives(new Bun.Image(fuzz(i, len)).metadata());
    }
  });

  // Mutate one byte of each known-good fixture at every offset — catches
  // codec parsers that trust a length/type byte without bounds-checking.
  for (const [name, fixture] of [
    ["png", tinyPng],
    ["jpeg", tinyJpeg],
    ["webp-lossless", tinyWebpLossless],
  ] as const) {
    test.concurrent(`${name}: single-byte flip at every offset`, async () => {
      for (let off = 0; off < fixture.length; off++) {
        const mut = Buffer.from(fixture);
        mut[off] ^= 0xff;
        await survives(new Bun.Image(mut).bytes());
      }
    });
  }
});
