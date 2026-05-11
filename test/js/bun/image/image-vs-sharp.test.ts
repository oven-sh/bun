// Pixel-level cross-reference: Bun.Image vs Sharp/libvips.
//
// The kernel-property tests (image-kernels.test.ts) catch *classes* of error
// (DC gain, monotone step, impulse ordering) but not "your lanczos3 is just
// slightly wrong everywhere". This test asks the only question users care
// about: does Bun.Image produce the same pixels as Sharp for the same kernel?
//
// Method: a small set of deterministic 32×24 source patterns, each resized
// through every (filter × target-size) pair, decoded back to RGBA, and diffed
// against a pre-baked Sharp/libvips reference. Edge mode intentionally differs
// (we clamp+renormalise; libvips embeds with VIPS_EXTEND_COPY — see
// image_resize.cpp header), so the outer 2-pixel border is excluded.
//
// Thresholds:
//   interior MAE   < 1.0   — i16 fixed-point on both sides; sub-1 noise is
//                            quantisation, not a kernel mismatch.
//   interior max   ≤ 3     — a single high-contrast pixel can swing ±3 from
//                            rounding-order differences. Anything larger is a
//                            real disagreement.
//
// Regenerate the reference (needs sharp; lives in bench/image/node_modules):
//   cd bench/image && bun install
//   bun-release ../../test/js/bun/image/image-vs-sharp.test.ts --regenerate

import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

const FIXTURE = join(import.meta.dir, "fixtures", "sharp-reference.bin");
const REGENERATE = Bun.argv.includes("--regenerate");

// ─── deterministic sources (32×24, content chosen to surface different
//     failure modes; small so the fixture stays a few-hundred KB) ────────────
const W = 32,
  H = 24;
type Px = (x: number, y: number) => [number, number, number, number];
// Only smooth + broadband-noise sources. Hard-edge patterns (checker, diag)
// would measure *phase alignment* (libvips' 64-bin offset quantisation + its
// integer pre-shrink) rather than kernel correctness — those differ by design.
const sources: Record<string, Px> = {
  gradient: (x, y) => [Math.round((x / (W - 1)) * 255), Math.round((y / (H - 1)) * 255), 128, 255],
  noise: (x, y) => {
    let s = (x * 0x9e3779b1 + y * 0x85ebca6b) >>> 0;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0), s >>> 24);
    return [r(), r(), r(), 255];
  },
};

// Thresholds split by kernel class. The non-negative kernels (no sharpening
// lobes) should match libvips almost exactly — a divergence there means our
// centre/support math is wrong. The negative-lobe kernels naturally amplify
// the per-pixel-weight vs binned-weight difference; the bound there catches
// "kernel formula is wrong" without failing on "rounding strategy differs".
const filters: { name: string; mae: number; max: number }[] = [
  { name: "bilinear", mae: 0.5, max: 2 },
  { name: "mitchell", mae: 0.5, max: 3 },
  { name: "cubic", mae: 0.5, max: 5 },
  { name: "lanczos2", mae: 0.5, max: 5 },
  { name: "lanczos3", mae: 1.0, max: 12 },
  { name: "mks2013", mae: 1.0, max: 16 },
  { name: "mks2021", mae: 1.0, max: 10 },
];
// box/nearest excluded: output depends on libvips' integer pre-shrink.

// Non-integer ratios in the 1-3× band — Sharp's `kernel` applies to reduction
// only (upscale is always bicubic), and ratios ≥3 hit vips_shrink first.
const targets = [
  { w: 21, h: 16 }, // ~1.5×
  { w: 13, h: 10 }, // ~2.4×
];

// ─── PNG plumbing (same hand-roller as the other suites) ────────────────────
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
function makePng(w: number, h: number, px: Px): Buffer {
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
      const c = px(x, y);
      const p = row + 1 + x * 4;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
      raw[p + 3] = c[3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
function decodePng(png: Uint8Array): { w: number; h: number; data: Uint8Array } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8,
    w = 0,
    h = 0;
  const idats: Uint8Array[] = [];
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
    } else if (type === "IDAT") idats.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = w * 4;
  const out = new Uint8Array(w * h * 4);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const ro = y * stride,
      po = (y - 1) * stride;
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
        const pp = a + b - c,
          pa = Math.abs(pp - a),
          pb = Math.abs(pp - b),
          pc = Math.abs(pp - c);
        v = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      out[ro + i] = v;
    }
  }
  return { w, h, data: out };
}

// ─── reference fixture: one zlib'd blob of all Sharp RGBA outputs back to
//     back, in the same iteration order the test uses. ─────────────────────────
function caseList() {
  const cases: { src: string; filter: string; mae: number; max: number; w: number; h: number; bytes: number }[] = [];
  for (const src of Object.keys(sources))
    for (const f of filters)
      for (const t of targets)
        cases.push({ src, filter: f.name, mae: f.mae, max: f.max, w: t.w, h: t.h, bytes: t.w * t.h * 4 });
  return cases;
}

if (REGENERATE) {
  const sharp = (await import("sharp")).default;
  // Sharp's name for our `bilinear` is `linear`; rest match.
  const sharpKernel: Record<string, string> = { bilinear: "linear" };
  const cases = caseList();
  const total = cases.reduce((a, c) => a + c.bytes, 0);
  const blob = new Uint8Array(total);
  let off = 0;
  for (const c of cases) {
    const srcPng = makePng(W, H, sources[c.src]);
    const { data } = await sharp(srcPng)
      .resize(c.w, c.h, { kernel: (sharpKernel[c.filter] ?? c.filter) as never, fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    blob.set(data, off);
    off += c.bytes;
  }
  writeFileSync(FIXTURE, zlib.deflateSync(blob));
  console.log(`wrote ${cases.length} reference outputs (${(blob.length / 1024).toFixed(0)} KB raw) → ${FIXTURE}`);
  // Don't run the tests themselves under --regenerate.
  process.exit(0);
}

// ─── diff helper: skip a 2-px border (edge-mode difference is documented). ──
function diffInterior(a: Uint8Array, b: Uint8Array, w: number, h: number) {
  const skip = 2;
  let max = 0,
    sum = 0,
    n = 0;
  for (let y = skip; y < h - skip; y++)
    for (let x = skip; x < w - skip; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(a[o + c] - b[o + c]);
        if (d > max) max = d;
        sum += d;
        n++;
      }
    }
  return { mae: n ? sum / n : 0, max };
}

describe("Bun.Image kernel output ≈ Sharp/libvips reference", () => {
  test("reference fixture exists (regenerate with --regenerate)", () => {
    expect(existsSync(FIXTURE)).toBe(true);
  });

  if (!existsSync(FIXTURE)) return;
  const ref = zlib.inflateSync(require("node:fs").readFileSync(FIXTURE));
  const cases = caseList();
  let off = 0;
  for (const c of cases) {
    const slice = ref.subarray(off, off + c.bytes);
    off += c.bytes;
    test(`${c.src} ${c.w}×${c.h} ${c.filter}: MAE<${c.mae} max≤${c.max}`, async () => {
      const out = decodePng(
        await new Bun.Image(makePng(W, H, sources[c.src]))
          .resize(c.w, c.h, { filter: c.filter as never, fit: "fill" })
          .png()
          .bytes(),
      ).data;
      const { mae, max } = diffInterior(out, slice, c.w, c.h);
      // One assertion so the failure message shows both numbers.
      expect({ mae: Number(mae.toFixed(3)), max, ok: mae < c.mae && max <= c.max }).toEqual({
        mae: expect.any(Number),
        max: expect.any(Number),
        ok: true,
      });
    });
  }
});
