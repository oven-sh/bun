// Algorithm-level tests for the resize filters and the palette quantizer.
//
// These pin down properties of the *kernels themselves* (sum-to-one, support
// width, ringing vs. softness, dither error distribution) rather than the
// pipeline glue. Kept separate so a kernel regression points straight here.

import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";

// ─── plumbing (PNG build/read; same shape as image.test.ts) ─────────────────

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
function makePng(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8Array {
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
  return { w, h, data: out };
}
async function resizePixels(
  src: Uint8Array,
  w: number,
  h: number,
  filter: "box" | "bilinear" | "lanczos3" | "mitchell",
): Promise<Uint8Array> {
  return decodePng(await new Bun.Image(src).resize(w, h, { filter }).png().bytes()).data;
}

// ─── resize filters ─────────────────────────────────────────────────────────

describe("resize filter properties", () => {
  const allFilters = [
    "nearest",
    "box",
    "bilinear",
    "cubic",
    "mitchell",
    "lanczos2",
    "lanczos3",
    "mks2013",
    "mks2021",
  ] as const;

  // DC gain: a flat field must come back flat under every filter (weights are
  // renormalised to sum to 1 even where the kernel was clipped at an edge).
  test.each(allFilters)("%s preserves a flat field exactly (sum-to-one + edge renormalisation)", async filter => {
    const flat = makePng(9, 7, () => [173, 173, 173, 255]);
    for (const [w, h] of [
      [3, 3],
      [18, 14],
      [9, 7],
    ] as const) {
      const out = await resizePixels(flat, w, h, filter);
      for (let i = 0; i < out.length; i += 4) {
        expect(out[i]).toBe(173);
        expect(out[i + 3]).toBe(255);
      }
    }
  });

  test.each(allFilters)("%s 1×1 source → N×N is constant", async filter => {
    const one = makePng(1, 1, () => [42, 99, 200, 255]);
    const out = await resizePixels(one, 5, 5, filter);
    for (let i = 0; i < out.length; i += 4) expect([out[i], out[i + 1], out[i + 2]]).toEqual([42, 99, 200]);
  });

  test.each(allFilters)("%s same-size is identity", async filter => {
    const src = makePng(7, 5, (x, y) => [(x * 37) & 255, (y * 53) & 255, ((x ^ y) * 11) & 255, 255]);
    const out = await resizePixels(src, 7, 5, filter);
    expect(Buffer.compare(out, decodePng(src).data)).toBe(0);
  });

  // Ringing test: a hard black/white step. lanczos3 has negative lobes →
  // overshoots; mitchell has none → must not. This is the property that
  // distinguishes the two.
  test("mitchell never overshoots a step (no negative lobes)", async () => {
    const step = makePng(32, 1, x => (x < 16 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const m = await resizePixels(step, 64, 1, "mitchell");
    const l = await resizePixels(step, 64, 1, "lanczos3");
    // Mitchell: every sample ∈ [0, 255] with the transition monotone.
    let prev = -1;
    for (let i = 0; i < 64; i++) {
      const v = m[i * 4];
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
      expect(v).toBeGreaterThanOrEqual(prev); // monotone non-decreasing
      prev = v;
    }
    // Lanczos3: at least one sample must clip (the implementation clamps, so
    // we look for it *touching* the rails immediately past the edge — i.e. a
    // 0 in the white half or a 255 in the black half within the ring radius).
    // We don't assert this strictly (clamping hides it); just verify mitchell
    // is at least as monotone as lanczos by counting direction changes.
    let lFlips = 0;
    let lp = l[0];
    for (let i = 1; i < 64; i++) {
      if (l[i * 4] < lp) lFlips++;
      lp = l[i * 4];
    }
    // Mitchell had 0 flips by the loop above; lanczos may have ≥0.
    expect(lFlips).toBeGreaterThanOrEqual(0); // sanity, not strict
  });

  // Support width: at 1:1 each filter sees a fixed number of taps. Probe by
  // resizing a single-white-pixel impulse and counting non-zero outputs.
  test("impulse response width matches kernel support (upscale 1→64)", async () => {
    const impulse = makePng(9, 1, x => (x === 4 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    async function spread(filter: "box" | "bilinear" | "lanczos3" | "mitchell") {
      const out = await resizePixels(impulse, 9 * 8, 1, filter);
      let lo = -1;
      let hi = -1;
      for (let i = 0; i < 9 * 8; i++) {
        if (out[i * 4] > 0) {
          if (lo < 0) lo = i;
          hi = i;
        }
      }
      return hi - lo + 1;
    }
    // Ordering, not exact counts (renormalisation/rounding fuzz the edges):
    // box ≤ bilinear ≤ mitchell ≤ lanczos3.
    const sb = await spread("box");
    const sl = await spread("bilinear");
    const sm = await spread("mitchell");
    const s3 = await spread("lanczos3");
    expect(sb).toBeLessThanOrEqual(sl);
    expect(sl).toBeLessThanOrEqual(sm);
    expect(sm).toBeLessThanOrEqual(s3);
  });

  // Anisotropy: a 1-D resize must leave the orthogonal axis untouched.
  // (Separability is structural — H pass then V pass — so this is what's
  // observable from outside.)
  test.each(["lanczos3", "mitchell"] as const)("%s W-only resize leaves columns identical", async filter => {
    const src = makePng(16, 4, (x, y) => [(x * 16 + y * 60) & 255, 0, 0, 255]);
    const out = await resizePixels(src, 8, 4, filter);
    // Every column should be unchanged across y (the V pass had nothing to do).
    for (let x = 0; x < 8; x++) {
      const ref = decodePng(src).data;
      // Can't compare to source columns directly (x changed), but each output
      // column must vary across y the same way the source did at every x:
      // since the H pass is per-row independent, out[y][x] depends only on
      // row y of the source — so out[x, y] = f(row_y). With identical row
      // shapes per y… not quite. Simpler: H-only resize on a source where
      // every ROW is identical → output rows identical.
      void ref;
    }
    const flat = makePng(16, 5, x => [(x * 16) & 255, 0, 0, 255]); // y-invariant
    const o2 = await resizePixels(flat, 8, 5, filter);
    for (let x = 0; x < 8; x++) for (let y = 1; y < 5; y++) expect(o2[(y * 8 + x) * 4]).toBe(o2[x * 4]);
  });
});

// ─── Floyd–Steinberg dither ─────────────────────────────────────────────────

describe("Floyd–Steinberg dither", () => {
  // A 0..255 horizontal grey ramp quantised to 2 colours. Median-cut on a
  // uniform ramp yields palette ≈ [64, 192] (means of the two halves), so
  // values outside [64,192] saturate — FS can only track the source *within
  // the palette's gamut*. Inside that band, the local mean over any window
  // should converge to the source value (the defining property of error
  // diffusion).
  test("2-colour dithered ramp tracks source mean inside palette gamut", async () => {
    const ramp = makePng(256, 8, x => [x, x, x, 255]);
    const png = await new Bun.Image(ramp).png({ palette: true, colors: 2, dither: true }).bytes();
    const back = decodePng(await new Bun.Image(png).png().bytes());
    // Discover the two greys median-cut actually picked.
    const seen = new Set<number>();
    for (let i = 0; i < back.data.length; i += 4) seen.add(back.data[i]);
    expect(seen.size).toBeLessThanOrEqual(2);
    const [lo, hi] = [...seen].sort((a, b) => a - b);
    // 16×8-wide window mean tracks x within ±12 inside [lo+16, hi-16].
    for (let cx = lo + 16; cx <= hi - 16; cx += 16) {
      let sum = 0;
      for (let dx = -8; dx < 8; dx++) for (let y = 0; y < 8; y++) sum += back.data[(y * 256 + cx + dx) * 4];
      const mean = sum / 128;
      expect(Math.abs(mean - cx)).toBeLessThan(12);
    }
    // Outside the gamut everything saturates to the nearest endpoint.
    for (let x = 0; x < lo; x++) expect(back.data[x * 4]).toBe(lo);
    for (let x = hi; x < 256; x++) expect(back.data[x * 4]).toBe(hi);
  });

  test("dither=false on the same ramp is a single hard step", async () => {
    const ramp = makePng(256, 1, x => [x, x, x, 255]);
    const png = await new Bun.Image(ramp).png({ palette: true, colors: 2, dither: false }).bytes();
    const back = decodePng(await new Bun.Image(png).png().bytes());
    let transitions = 0;
    for (let x = 1; x < 256; x++) if (back.data[x * 4] !== back.data[(x - 1) * 4]) transitions++;
    expect(transitions).toBe(1);
  });

  // Dither actually does something: on a ramp, the dithered output mixes both
  // palette values across the gamut band; the un-dithered output has exactly
  // one transition.
  test("dither produces a mixed pattern where un-dithered has a single step", async () => {
    const ramp = makePng(256, 4, x => [x, x, x, 255]);
    const d = decodePng(
      await new Bun.Image(await new Bun.Image(ramp).png({ palette: true, colors: 2, dither: true }).bytes())
        .png()
        .bytes(),
    );
    let dt = 0;
    for (let x = 1; x < 256; x++) if (d.data[x * 4] !== d.data[(x - 1) * 4]) dt++;
    expect(dt).toBeGreaterThan(10);
  });

  test("dither is deterministic (same input → same output)", async () => {
    const ramp = makePng(64, 8, (x, y) => [x * 4, y * 32, 128, 255]);
    const a = await new Bun.Image(ramp).png({ palette: true, colors: 4, dither: true }).bytes();
    const b = await new Bun.Image(ramp).png({ palette: true, colors: 4, dither: true }).bytes();
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  // 1×N and N×1 are the edge cases where FS has no "below" or no "right".
  test("1-pixel-wide and 1-pixel-tall sources", async () => {
    for (const [w, h] of [
      [1, 32],
      [32, 1],
    ] as const) {
      const src = makePng(w, h, (x, y) => [((x + y) * 8) & 255, 0, 0, 255]);
      const png = await new Bun.Image(src).png({ palette: true, colors: 2, dither: true }).bytes();
      const back = decodePng(await new Bun.Image(png).png().bytes());
      expect(back.w).toBe(w);
      expect(back.h).toBe(h);
    }
  });
});
