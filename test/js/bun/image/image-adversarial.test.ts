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
import { bunEnv, bunExe, gcTick, isASAN, isWindows, rss, tempDir } from "harness";
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
/// Past JSC's fastSizeLimit (1000 elements), so a `new Uint8Array(kilobytePng)`
/// is an OversizeTypedArray: its bytes sit in fastMalloc with no ArrayBuffer.
const kilobytePng = makePng(32, 32, (x, y) => [(x * 7 + y * 13) & 255, (x * 31) & 255, (y * 17) & 255, 255]);

/// Decode any image to RGBA via Bun.Image→PNG, then walk the PNG ourselves
/// (filter de-prediction included) so assertions are against ground truth,
/// not against another Bun.Image call. Hoisted to file scope so the
/// heap-leak / hostile-input tests can use it.
async function rgbaOf(bytes: Uint8Array): Promise<Uint8Array> {
  const png = await new Bun.Image(bytes).png().bytes();
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
    const px = await rgbaOf(gif);
    expect(px.length).toBe(4 * 4 * 4);
    // The fixture's two LZW bytes decode as `clear` then a spurious literal
    // `1` (the leftover 7 bits) before EOF, so idx[0]=1 and the security-
    // relevant region is idx[1..16) — the `@memset(idx[written..], 0)` tail.
    // If that regresses, those 15 indices are raw mimalloc bytes mapped 1:1
    // through the identity palette and at least one R/G/B sample ≠ 0.
    expect([...px.subarray(0, 4)]).toEqual([1, 1, 1, 255]);
    for (let i = 4; i < px.length; i += 4) expect([px[i], px[i + 1], px[i + 2], px[i + 3]]).toEqual([0, 0, 0, 255]);
  });

  test("GIF LZW with code > avail rejects (GIFLIB-CVE-style table overrun)", async () => {
    Bun.Image.backend = "bun";
    // CVE-2016-3177 / CVE-2022-28506 pattern: an LZW code that references a
    // dictionary entry that hasn't been written yet. In our decoder this hits
    // the `code > avail` guard at codec_gif.zig:221 and must DecodeFailed,
    // never reach Dict.emit(). Craft: 2-colour palette, 9-bit stream where
    // the first code after clear is 511 (way past avail=6).
    // prettier-ignore
    const gif = Buffer.concat([
      Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61, 2,0, 1,0, 0x80, 0, 0]),  // 2-col GCT
      Buffer.from([0,0,0, 255,255,255]),                                    // palette
      Buffer.from([0x2c,0,0,0,0,2,0,1,0,0, 2]),                             // imgdesc, lzw_min=2
      // sub-block: 2 bytes. At csize=3 after clear bumps to csize=3? No —
      // lzw_min=2, csize starts at 3, clear=4. Send: clear(=4, 3 bits) then
      // code 7 (max 3-bit, > avail which is 6 after clear). Packed LE:
      // bits: 100 111 ... = 0b111100 = 0x3C, then EOI(=5): 101 → next byte 0x05
      Buffer.from([2, 0x3c, 0x05, 0, 0x3b]),
    ]);
    expect(await survives(new Bun.Image(gif).png().bytes())).toBe("rejected");
    // And a wider one: lzw_min=8, code 4095 immediately after clear (avail=258).
    // prettier-ignore
    const gif12 = Buffer.concat([
      Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61, 1,0, 1,0, 0xf7, 0, 0]),
      Buffer.alloc(256 * 3),
      Buffer.from([0x2c,0,0,0,0,1,0,1,0,0, 8]),
      // csize=9, clear=256. Send clear (0x100, 9 bits) then 0x1FF (=511 > 258).
      // LE-packed 18 bits: byte0=0x00 (low 8 of clear), byte1 bit0=1 (high
      // bit of clear) | bits1-7=low 7 of 511 → 0xFF, byte2 bits0-1=high 2 of
      // 511 → 0x03.
      Buffer.from([3, 0x00, 0xff, 0x03, 0, 0x3b]),
    ]);
    expect(await survives(new Bun.Image(gif12).png().bytes())).toBe("rejected");
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

  test("IDAT CRC and zlib adler32 mismatches are tolerated (checksums are skipped on decode)", async () => {
    const expected = await rgbaOf(tinyPng);
    const buf = Buffer.from(tinyPng);
    const idatLen = buf.readUInt32BE(33);
    buf[33 + 8 + idatLen - 1] ^= 0xff; // last adler32 byte of the zlib stream
    buf[33 + 8 + idatLen + 3] ^= 0xff; // last IDAT CRC byte
    expect(await rgbaOf(buf)).toStrictEqual(expected);
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

// ─── 5b. JPEG that libjpeg decodes with a warning ────────────────────────────
//
// libjpeg finishes these decodes and only warns (djpeg: exit status 2, whole
// image written), so Bun.Image returns the pixels. A fatal error (djpeg: exit
// status 1) rejects, also when a warning came first: TurboJPEG returns -1 for
// both, and after a fatal error the output rows were never written.

const warnW = 96;
const warnH = 64;
const warnPng = makePng(warnW, warnH, (x, y) => [
  Math.round((x * 255) / (warnW - 1)),
  Math.round((y * 255) / (warnH - 1)),
  ((x ^ y) * 4) & 255,
  255,
]);
const warnJpegs = {
  baseline: await new Bun.Image(warnPng).jpeg({ quality: 90 }).bytes(),
  progressive: await new Bun.Image(warnPng).jpeg({ quality: 90, progressive: true }).bytes(),
};
const warnRgba = {
  baseline: await rgbaOf(warnJpegs.baseline),
  progressive: await rgbaOf(warnJpegs.progressive),
};

/** Each marker up to EOI: its offset, and where its segment ends. In entropy-coded data, FF00 and RSTn are data. */
function jpegMarkers(jpeg: Uint8Array): { marker: number; offset: number; end: number }[] {
  const out: { marker: number; offset: number; end: number }[] = [];
  let i = 2;
  while (i + 1 < jpeg.length) {
    if (jpeg[i] !== 0xff) throw new Error(`no marker at ${i}`);
    const marker = jpeg[i + 1];
    if (marker === 0xd9) {
      out.push({ marker, offset: i, end: i + 2 });
      break;
    }
    const end = i + 2 + ((jpeg[i + 2] << 8) | jpeg[i + 3]);
    out.push({ marker, offset: i, end });
    i = end;
    if (marker === 0xda) {
      while (i + 1 < jpeg.length && !(jpeg[i] === 0xff && jpeg[i + 1] !== 0 && (jpeg[i + 1] & 0xf8) !== 0xd0)) i++;
    }
  }
  return out;
}

function insertBytes(jpeg: Uint8Array, offset: number, bytes: number[]): Buffer {
  return Buffer.concat([jpeg.subarray(0, offset), Buffer.from(bytes), jpeg.subarray(offset)]);
}

/** Each scan's entropy-coded data as [start, end). */
function scanRanges(markers: { marker: number; offset: number; end: number }[]): [number, number][] {
  return markers.flatMap((m, i) => (m.marker === 0xda ? [[m.end, markers[i + 1].offset] as [number, number]] : []));
}

/**
 * The largest cut at or below `target` that keeps whole marker segments. A cut
 * inside one truncates a length-prefixed header, which is a fatal error, not
 * the warning this file is about. The fixture's size moves with the encoder's
 * output, so a cut at a fraction of the file cannot assume where it lands.
 */
function cutInsideScanData(markers: { marker: number; offset: number; end: number }[], target: number): number {
  let best = 0;
  for (const [start, end] of scanRanges(markers)) {
    if (target >= start) best = Math.min(target, end);
  }
  if (best === 0) throw new Error(`no scan data at or below ${target}`);
  return best;
}

function rowsIdenticalFromTop(a: Uint8Array, b: Uint8Array, width: number): number {
  const stride = width * 4;
  for (let row = 0; row * stride < a.length; row++) {
    if (Buffer.compare(a.subarray(row * stride, (row + 1) * stride), b.subarray(row * stride, (row + 1) * stride)))
      return row;
  }
  return a.length / stride;
}

function countPixels(rgba: Uint8Array, pixel: [number, number, number, number]): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4)
    if (rgba[i] === pixel[0] && rgba[i + 1] === pixel[1] && rgba[i + 2] === pixel[2] && rgba[i + 3] === pixel[3]) n++;
  return n;
}

/**
 * libjpeg writes 255 into every alpha byte it outputs. A row it never wrote shows up here
 * only if the allocator did not hand back a block that held a decoded image before, so in
 * this process the check is a cheap extra. "commits no byte that libjpeg did not write"
 * below runs it where every new allocation is filled with another byte.
 */
function everyAlphaOpaque(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
  return true;
}

describe.each(["baseline", "progressive"] as const)("%s JPEG that libjpeg decodes with a warning", kind => {
  const clean = warnJpegs[kind];
  const cleanRgba = warnRgba[kind];
  const markers = jpegMarkers(clean);
  const eoi = markers.at(-1)!.offset;
  const firstDqt = markers.find(m => m.marker === 0xdb)!.offset;
  const firstSos = markers.findIndex(m => m.marker === 0xda);
  // The first scan's entropy-coded data. It ends at EOI (baseline) or at the next scan's DHT (progressive).
  const scanStart = markers[firstSos].end;
  const scanEnd = markers[firstSos + 1].offset;
  const junk = (n: number) => new Array<number>(n).fill(0);
  const sof5 = [0xff, 0xc5]; // differential sequential DCT: libjpeg's fatal JERR_SOF_UNSUPPORTED
  const decodeFailed = { code: "ERR_IMAGE_DECODE_FAILED" };
  const metadata = { width: warnW, height: warnH, format: "jpeg" };

  test("fixture layout", () => {
    expect([clean[eoi], clean[eoi + 1], eoi]).toEqual([0xff, 0xd9, clean.length - 2]);
    expect(markers.filter(m => m.marker === 0xda).length > 1).toBe(kind === "progressive");
  });

  // "Corrupt JPEG data: N extraneous bytes before marker 0xd9"
  test.each([8, 16, 32])("%d junk bytes before EOI decode to the clean file's pixels", async n => {
    const padded = insertBytes(clean, eoi, junk(n));
    expect(await new Bun.Image(padded).metadata()).toEqual(metadata);
    expect(Buffer.compare(await rgbaOf(padded), cleanRgba)).toBe(0);
  });

  test("junk after EOI decodes to the clean file's pixels", async () => {
    const padded = Buffer.concat([clean, Buffer.alloc(32, 0x41)]);
    expect(Buffer.compare(await rgbaOf(padded), cleanRgba)).toBe(0);
  });

  // "Corrupt JPEG data: 16 extraneous bytes before marker 0xdb", from the header parse.
  test("junk between header segments: metadata() and the decode both accept it", async () => {
    const padded = insertBytes(clean, firstDqt, junk(16));
    expect(await new Bun.Image(padded).metadata()).toEqual(metadata);
    expect(Buffer.compare(await rgbaOf(padded), cleanRgba)).toBe(0);
  });

  test("DCT-scaled decode of a file with junk before EOI matches the clean file", async () => {
    const small = (b: Uint8Array) =>
      new Bun.Image(b)
        .resize(warnW / 4, warnH / 4)
        .png()
        .bytes();
    expect(Buffer.compare(await small(insertBytes(clean, eoi, junk(16))), await small(clean))).toBe(0);
  });

  // "Premature end of JPEG file": libjpeg acts as if EOI were there. All the scan data is present.
  test("EOI removed decodes to the clean file's pixels", async () => {
    expect(Buffer.compare(await rgbaOf(clean.subarray(0, eoi)), cleanRgba)).toBe(0);
  });

  // The same warning, but scan data is missing. libjpeg decodes what it has and
  // fills the rest, so the output is complete and the pixels are not.
  test("truncated at 95%: the output is complete and the pixels differ", async () => {
    const rgba = await rgbaOf(clean.subarray(0, cutInsideScanData(markers, Math.floor(clean.length * 0.95))));
    expect({
      bytes: rgba.length,
      opaque: everyAlphaOpaque(rgba),
      sameAsClean: !Buffer.compare(rgba, cleanRgba),
    }).toEqual({ bytes: cleanRgba.length, opaque: true, sameAsClean: false });
  });

  test("cuts across the first scan's data each give a fully written image", async () => {
    const partlyWritten: number[] = [];
    const step = Math.max(1, Math.floor((scanEnd - scanStart) / 24));
    for (let cut = scanStart + 1; cut < scanEnd; cut += step) {
      if (!everyAlphaOpaque(await rgbaOf(clean.subarray(0, cut)))) partlyWritten.push(cut);
    }
    expect(partlyWritten).toEqual([]);
  });

  // TurboJPEG keeps its warning flag after a fatal error. In the progressive file the fatal
  // error comes before any row is written, so to accept it would return heap garbage.
  test("warning, then a fatal error after the first scan: rejects", async () => {
    expect(Buffer.compare(await rgbaOf(insertBytes(clean, scanEnd, junk(16))), cleanRgba)).toBe(0);
    const warnThenFatal = insertBytes(clean, scanEnd, [...junk(16), ...sof5]);
    expect(await new Bun.Image(warnThenFatal).metadata()).toEqual(metadata);
    await expect(new Bun.Image(warnThenFatal).png().bytes()).rejects.toMatchObject(decodeFailed);
    await expect(new Bun.Image(warnThenFatal).resize(8, 8).jpeg().bytes()).rejects.toMatchObject(decodeFailed);
  });

  test("warning, then a fatal error in the header: metadata() and the decode reject", async () => {
    const warnThenFatal = insertBytes(clean, firstDqt, [...junk(16), ...sof5]);
    await expect(new Bun.Image(warnThenFatal).metadata()).rejects.toMatchObject(decodeFailed);
    await expect(new Bun.Image(warnThenFatal).png().bytes()).rejects.toMatchObject(decodeFailed);
  });

  test("fatal error with no warning: rejects", async () => {
    const unsupportedSof = insertBytes(clean, scanEnd, sof5);
    expect(await new Bun.Image(unsupportedSof).metadata()).toEqual(metadata);
    await expect(new Bun.Image(unsupportedSof).png().bytes()).rejects.toMatchObject(decodeFailed);

    // DQT segment length one byte short: JERR_BAD_LENGTH in the header parse.
    const badDqt = Buffer.from(clean);
    badDqt[firstDqt + 3] -= 1;
    await expect(new Bun.Image(badDqt).metadata()).rejects.toMatchObject(decodeFailed);
    await expect(new Bun.Image(badDqt).png().bytes()).rejects.toMatchObject(decodeFailed);
  });
});

describe("JPEG truncated inside its scan data", () => {
  // A baseline file loses whole MCU rows from the bottom.
  test("baseline: the rows above the cut are intact and the rest is libjpeg's grey", async () => {
    const clean = warnJpegs.baseline;
    const [[scanStart, scanEnd]] = scanRanges(jpegMarkers(clean));
    const rgba = await rgbaOf(clean.subarray(0, scanStart + Math.floor((scanEnd - scanStart) / 2)));
    const kept = rowsIdenticalFromTop(rgba, warnRgba.baseline, warnW);
    expect({ kept: kept > 0 && kept < warnH, grey: countPixels(rgba, [128, 128, 128, 255]) > 0 }).toEqual({
      kept: true,
      grey: true,
    });
  });

  // A progressive file has data for every block once its first scan is complete. The last
  // scan is a refinement pass, so the picture without it is whole and the error is small.
  test("progressive: without its last scan the whole picture decodes, with less detail", async () => {
    const clean = warnJpegs.progressive;
    const rgba = await rgbaOf(clean.subarray(0, scanRanges(jpegMarkers(clean)).at(-1)![0]));
    let total = 0;
    for (let i = 0; i < rgba.length; i++) total += Math.abs(rgba[i] - warnRgba.progressive[i]);
    expect({ opaque: everyAlphaOpaque(rgba), meanError: total / rgba.length < 4 }).toEqual({
      opaque: true,
      meanError: true,
    });
  });
});

// Each of these warns and then hits a fatal error, which TurboJPEG reports as a warning
// unless the fatal exit clears its warning flag. One test per function that clears it.
describe("JPEG that warns and then fails", () => {
  const decodeFailed = { code: "ERR_IMAGE_DECODE_FAILED" };

  // tj3Decompress8, the way a real file gets there: a progressive download that stops inside
  // the DHT or the SOS after the first scan. "Premature end of JPEG file", then "Bogus Huffman
  // table definition" or "Invalid component ID 255 in SOS", before any row is written.
  test("a progressive file cut inside the segments after its first scan rejects", async () => {
    const clean = warnJpegs.progressive;
    const markers = jpegMarkers(clean);
    const firstSos = markers.findIndex(m => m.marker === 0xda);
    const [dht, sos] = [markers[firstSos + 1], markers[firstSos + 2]];
    expect([dht.marker, sos.marker]).toEqual([0xc4, 0xda]);
    expect(await new Bun.Image(clean.subarray(0, dht.offset + 10)).metadata()).toMatchObject({ format: "jpeg" });
    await expect(new Bun.Image(clean.subarray(0, dht.offset + 10)).png().bytes()).rejects.toMatchObject(decodeFailed);
    await expect(new Bun.Image(clean.subarray(0, sos.offset + 5)).png().bytes()).rejects.toMatchObject(decodeFailed);
  });

  // tj3DecompressHeader. Its fatal exits through libjpeg leave the dimensions unset, which
  // rejects on its own. "Could not determine colorspace of JPEG image" comes after they are
  // set: a 2-component frame, built from the baseline fixture's SOF0 and SOS.
  test("a header that warns and then fails the colorspace check rejects in metadata()", async () => {
    const clean = warnJpegs.baseline;
    const markers = jpegMarkers(clean);
    const sof = markers.find(m => m.marker === 0xc0)!;
    const sos = markers.find(m => m.marker === 0xda)!;
    const sof2 = Buffer.from(clean.subarray(sof.offset, sof.offset + 10 + 2 * 3));
    sof2[3] = 8 + 2 * 3; // segment length
    sof2[9] = 2; // component count
    const sos3 = clean.subarray(sos.offset, sos.end);
    const sos2 = Buffer.concat([sos3.subarray(0, 5 + 2 * 2), sos3.subarray(5 + 3 * 2)]);
    sos2[3] = 6 + 2 * 2;
    sos2[4] = 2;
    const twoComponents = Buffer.concat([
      clean.subarray(0, sof.offset),
      sof2,
      clean.subarray(sof.end, sos.offset),
      sos2,
      clean.subarray(sos.end),
    ]);
    const firstDqt = markers.find(m => m.marker === 0xdb)!.offset;
    const warned = insertBytes(twoComponents, firstDqt, new Array<number>(16).fill(0));
    await expect(new Bun.Image(twoComponents).metadata()).rejects.toMatchObject(decodeFailed);
    await expect(new Bun.Image(warned).metadata()).rejects.toMatchObject(decodeFailed);
  });
});

// ─── 5c. lossless JPEG (SOF3) ────────────────────────────────────────────────
//
// TurboJPEG refuses a cropping region for a lossless stream, and libjpeg
// ignores the scaling factor for one, so the DCT-scaled decode path has to
// fall back to the source size. A narrow fixture is what makes the two
// disagree: the row-width check inside the library catches a wider one first.
// Bun's encoder writes baseline or progressive only, so the bytes are an
// encode by TurboJPEG itself (TJPARAM_LOSSLESS, PSV 1), 2x64, one gradient.
const losslessJpeg = Buffer.from(
  "/9j/7gAOQWRvYmUAZAAAAAAA/8MAEQgAQAACA1IRAEcRAEIRAP/EABwAAAMBAQEBAQEAAAAAAAAAAAADCAQFAgEGB//aAAwDUgBHAEIAAQAAn+" +
    "f/AON3+cMZxL/NIzrX+ckYm/z6MRf48Zuv8xDObf54Gab/ABAz9Vf5zhhf5mGeb/PIzl3+NGar/PYzXf5yxnMv87IzpX+PGfob/Pgx1/mMYi/x" +
    "YzlX+d0Z1r/Mg3mX+dkYu/zWM61/iBnev8WMxX+fRiL/ADuDOlf4oZiv86AzqX+ZBnJv8+jG3+LGfor/ABoz7f55GZL/ADeMff50xmq/zOM59/" +
    "m0Zpv81jHX+exn6O/zIMwX+aRq7/PQzXf56Ga7/PozBf5sGde/znDOVf4oZ+iv8zjPt/ngZvv8QM83+YxmW/zeMzX+bxnVv89DMN/nwZ37/PQz" +
    "Vf4DHX+cgZyL/NgzpX+ZRnq/zAMw3+aBu6/zl//Z",
  "base64",
);

describe("lossless JPEG", () => {
  const sof3 = losslessJpeg.indexOf(Buffer.from([0xff, 0xc3]));
  // 16 junk bytes before SOF3: a header warning, which the decode now accepts.
  const headerWarning = insertBytes(losslessJpeg, sof3, new Array<number>(16).fill(0));

  test("metadata reports the SOF3 dimensions", async () => {
    expect(sof3).toBeGreaterThan(0);
    expect(await new Bun.Image(losslessJpeg).metadata()).toEqual({ width: 2, height: 64, format: "jpeg" });
    expect(await new Bun.Image(headerWarning).metadata()).toEqual({ width: 2, height: 64, format: "jpeg" });
  });

  test("a header warning does not change the full-size pixels", async () => {
    expect(await rgbaOf(headerWarning)).toEqual(await rgbaOf(losslessJpeg));
  });

  // A decode that asks libjpeg for a scaling factor it ignores writes more rows
  // than the buffer holds, so a build without the fix dies here. Run it in a
  // child, or it takes the whole test file with it.
  test("a scaled decode stays inside the buffer", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const jpeg = Buffer.from(${JSON.stringify(losslessJpeg.toString("base64"))}, "base64");
          const warned = Buffer.concat([jpeg.subarray(0, ${sof3}), Buffer.alloc(16), jpeg.subarray(${sof3})]);
          const scaled = b => new Bun.Image(b).resize(2, 50, { fit: "fill" }).png().bytes();
          // The same pixels by the route that never scales inside the decoder.
          const viaFullSize = await scaled(await new Bun.Image(jpeg).png().bytes());
          console.log(JSON.stringify({
            scaled: Buffer.compare(await scaled(jpeg), viaFullSize) === 0,
            withHeaderWarning: Buffer.compare(await scaled(warned), viaFullSize) === 0,
          }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const stderr = rawStderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout || "{}")).toEqual({ scaled: true, withHeaderWarning: true });
    expect(exitCode).toBe(0);
  });
});

// TurboJPEG also refuses a cropping region for sampling factors outside its table. Here the
// luma is 3x1, which libjpeg decodes and, unlike a lossless stream, also scales. The bytes are
// `cjpeg -quality 90 -sample 3x1,1x1,1x1` of a 24x16 gradient: Bun's encoder writes 4:2:0 only.
const unknownSubsamplingJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGB" +
    "YUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQ" +
    "ABgDATEAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhBy" +
    "JxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKT" +
    "lJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAA" +
    "AAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRom" +
    "JygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExc" +
    "bHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4u0H4SeRt/c5z7dK9a0D4SeTt/c5z7dK9a0H4SeRt/c5z7dK7" +
    "cnzr2d9dr/8Aktvzv8j9T8O+IL8nvdjtNB+Enkbf3Ofw6V2egfCTyNv7nP4dK+gdB+Enk7f3Oc+3SvyPJ869nxM9dqb/APJWvzv8j+YvDziC9G" +
    "GvVH//2Q==",
  "base64",
);

describe("JPEG with sampling factors TurboJPEG cannot classify", () => {
  test("the SOF0 luma factors are 3x1", async () => {
    const sof0 = unknownSubsamplingJpeg.indexOf(Buffer.from([0xff, 0xc0]));
    expect([...unknownSubsamplingJpeg.subarray(sof0 + 10, sof0 + 12)]).toEqual([1, 0x31]);
    expect(await new Bun.Image(unknownSubsamplingJpeg).metadata()).toEqual({ width: 24, height: 16, format: "jpeg" });
  });

  // Whatever size the decoder picks for this stream, a resize has to show the same picture
  // as resizing the full-size decode. Rows packed at one width and read at another do not.
  test("a resize shows the picture of the full-size decode", async () => {
    const resized = (b: Uint8Array) => new Bun.Image(b).resize(12, 8, { fit: "fill" }).png().bytes();
    const direct = await rgbaOf(await resized(unknownSubsamplingJpeg));
    const viaFullSize = await rgbaOf(await resized(await new Bun.Image(unknownSubsamplingJpeg).png().bytes()));
    let total = 0;
    for (let i = 0; i < direct.length; i++) total += Math.abs(direct[i] - viaFullSize[i]);
    expect({ bytes: direct.length, opaque: everyAlphaOpaque(direct), meanError: total / direct.length < 8 }).toEqual({
      bytes: 12 * 8 * 4,
      opaque: true,
      meanError: true,
    });
  });
});

// The decoder's output buffer is uninitialised capacity, so an accepted decode must not
// leave a byte of it unwritten. ASAN can fill every new allocation with a chosen byte:
// an alpha byte that libjpeg never wrote then reads as that byte, whatever the block held
// before. The child decodes under that fill, and this process reads the alpha back.
test.skipIf(!isASAN)("an accepted JPEG decode commits no byte that libjpeg did not write", async () => {
  type Case = { name: string; kind: string; cut?: number; insert?: [number, number[]]; resize?: [number, number] };
  const cases: Case[] = [
    // TurboJPEG refuses a cropping region for these two, so the decoder sizes the buffer itself.
    { name: "lossless resized to 2x50", kind: "lossless", resize: [2, 50] },
    { name: "unknown subsampling resized to 12x8", kind: "unknownSubsampling", resize: [12, 8] },
  ];
  for (const kind of ["baseline", "progressive"] as const) {
    const clean = warnJpegs[kind];
    const markers = jpegMarkers(clean);
    const scans = scanRanges(markers);
    const [scanStart, scanEnd] = scans[0];
    const step = Math.max(1, Math.floor((scanEnd - scanStart) / 12));
    for (let cut = scanStart; cut < scanEnd; cut += step) cases.push({ name: `${kind} cut at ${cut}`, kind, cut });
    cases.push({ name: `${kind} cut at 95%`, kind, cut: cutInsideScanData(markers, Math.floor(clean.length * 0.95)) });
    cases.push({ name: `${kind} without its last scan's data`, kind, cut: scans.at(-1)![0] });
    // A warning and then a fatal error: no row is written for the progressive file.
    cases.push({
      name: `${kind} junk and SOF5 after the first scan`,
      kind,
      // 16 junk bytes: libjpeg swallows a few without a warning.
      insert: [scanEnd, [...new Array<number>(16).fill(0), 0xff, 0xc5]],
    });
  }

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { files, cases } = await Bun.stdin.json();
        const out = {};
        for (const c of cases) {
          const file = Buffer.from(files[c.kind], "base64");
          const bytes = c.insert
            ? Buffer.concat([file.subarray(0, c.insert[0]), Buffer.from(c.insert[1]), file.subarray(c.insert[0])])
            : file.subarray(0, c.cut);
          const image = new Bun.Image(bytes);
          if (c.resize) image.resize(c.resize[0], c.resize[1], { fit: "fill" });
          out[c.name] = await image.png().bytes().then(
            png => Buffer.from(png).toString("base64"),
            e => "rejected: " + e.code,
          );
        }
        console.log(JSON.stringify(out));
      `,
    ],
    env: {
      ...bunEnv,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "malloc_fill_byte=90", "max_malloc_fill_size=1073741824"]
        .filter(Boolean)
        .join(":"),
    },
    stdin: Buffer.from(
      JSON.stringify({
        files: {
          baseline: Buffer.from(warnJpegs.baseline).toString("base64"),
          progressive: Buffer.from(warnJpegs.progressive).toString("base64"),
          lossless: losslessJpeg.toString("base64"),
          unknownSubsampling: unknownSubsamplingJpeg.toString("base64"),
        },
        cases,
      }),
    ),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stderr = rawStderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(stderr).toBe("");

  const pngs: Record<string, string> = JSON.parse(stdout || "{}");
  const got: Record<string, string> = {};
  for (const { name } of cases) {
    const png = pngs[name] ?? "missing";
    if (png.startsWith("rejected") || png === "missing") got[name] = png;
    else
      got[name] = everyAlphaOpaque(await rgbaOf(Buffer.from(png, "base64"))) ? "fully written" : "has unwritten bytes";
  }
  const want = Object.fromEntries(
    cases.map(c => [c.name, c.insert ? "rejected: ERR_IMAGE_DECODE_FAILED" : "fully written"]),
  );
  expect(got).toEqual(want);
  expect(exitCode).toBe(0);
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
      if ((i & 127) === 0) gcTick();
    }
    gcTick();
    const before = rss();
    for (let i = 0; i < run; i++) {
      await body();
      if ((i & 127) === 0) gcTick();
    }
    gcTick();
    return rss() - before;
  }

  test("decode/encode cycles plateau (no per-call leak after warmup)", async () => {
    const delta = await leakCheck(() => new Bun.Image(tinyPng).png().bytes());
    // 32 MB budget over 1500 calls = >21 KB/call would have to leak to fail.
    // ASAN's quarantine retains freed allocations so the measured window still
    // grows under bun-asan even after warmup; widen the threshold there.
    expect(delta).toBeLessThan((isASAN ? 128 : 32) * 1024 * 1024);
  });

  test("error paths plateau (no per-call leak after warmup)", async () => {
    const bad = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const delta = await leakCheck(() => survives(new Bun.Image(bad).metadata()));
    expect(delta).toBeLessThan((isASAN ? 128 : 32) * 1024 * 1024);
  });

  test("constructor with throwing getter cleans up under repetition", () => {
    const before = rss();
    for (let i = 0; i < 10_000; i++) {
      try {
        new Bun.Image(tinyPng, {
          get maxPixels() {
            throw new Error("x");
          },
        });
      } catch {}
      if ((i & 1023) === 0) gcTick();
    }
    gcTick();
    expect(rss() - before).toBeLessThan((isASAN ? 256 : 64) * 1024 * 1024);
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

  test("a view that never had a `.buffer` is pinned too, so the same transfer copies", async () => {
    // Same as above without the subarray(): subarray() materializes the
    // ArrayBuffer, so that test only ever reached the already-has-a-buffer
    // path. A view handed straight to the constructor is still
    // OversizeTypedArray when the borrow happens, and the helper has to adopt
    // an ArrayBuffer for it before a pin has anywhere to live.
    const a = new Uint8Array(kilobytePng); // > fastSizeLimit elements, no .buffer touched
    const p = new Bun.Image(a).png().bytes();
    const moved = a.buffer.transfer();
    expect(moved.byteLength).toBe(kilobytePng.length);
    expect(a.byteLength).toBe(kilobytePng.length); // pinned: `a` keeps its bytes
    expect((await p)[0]).toBe(0x89);
    a.buffer.transfer();
    expect(a.byteLength).toBe(0); // pin released with the task
  });

  test("transfer + GC after the borrow does not free the bytes the pool thread reads", async () => {
    // Without the pin, `.buffer` + transfer moves the storage to an
    // ArrayBuffer nothing references and the collection frees it while the
    // pool job may still read it. The assertion does not depend on catching
    // that read in the act: the transfer either copies (pinned, `byteLength`
    // stays) or detaches (`byteLength` 0). `Malloc=1` routes the Gigacage
    // through system malloc, so ASAN reports the read too when the job is
    // still running at the free. Windows is left alone: bmalloc's SystemHeap
    // is unimplemented there and `Malloc=1` would RELEASE_BASSERT.
    const script = `
      import zlib from "node:zlib";
      const be32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
      const chunk = (t, d) =>
        Buffer.concat([be32(d.length), Buffer.from(t), d,
          be32(zlib.crc32(Buffer.concat([Buffer.from(t), d])) >>> 0)]);
      const w = 32, h = 32, stride = w * 4 + 1;
      // Noise, so the IDAT does not compress below fastSizeLimit: the input
      // has to stay an OversizeTypedArray to reach the pin at all.
      const rows = Buffer.alloc(stride * h);
      crypto.getRandomValues(rows);
      for (let y = 0; y < h; y++) rows[y * stride] = 0; // filter byte: none
      const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", Buffer.concat([be32(w), be32(h), Buffer.from([8, 6, 0, 0, 0])])),
        chunk("IDAT", zlib.deflateSync(rows)),
        chunk("IEND", Buffer.alloc(0)),
      ]);
      const want = Bun.hash(await new Bun.Image(new Uint8Array(png)).bytes());
      const input = new Uint8Array(png);           // OversizeTypedArray: no ArrayBuffer yet
      const decode = new Bun.Image(input).bytes(); // borrows input's storage for the pool
      input.buffer.transfer(0);                    // storage moves to an unreferenced owner
      Bun.gc(true);                                // ... which this collection sweeps
      for (let k = 0; k < 8; k++) new Uint8Array(png.length).fill(0xee); // reuse the block
      const decoded = await decode.then(
        r => (Bun.hash(r) === want ? "same" : "different"),
        e => "rejected:" + (e.code ?? e.message),
      );
      console.log(JSON.stringify({ pngBytes: png.length, byteLength: input.byteLength, decoded }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        ...(isWindows ? {} : { Malloc: "1" }),
        // symbolize=0: symbolizing a failure report outlasts the test timeout.
        // detect_leaks=0: Malloc=1 exposes JSC's never-freed startup allocations to LSAN,
        // and without symbols test/leaksan.supp cannot match them.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    expect(out.pngBytes).toBeGreaterThan(1000); // else the input is a FastTypedArray and gets duped
    expect({ byteLength: out.byteLength, decoded: out.decoded }).toEqual({
      byteLength: out.pngBytes, // pinned: the transfer copied and left `input` attached
      decoded: "same",
    });
    expect(exitCode).toBe(0);
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
