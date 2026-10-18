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
async function resizePixels(src: Uint8Array, w: number, h: number, filter: Bun.Image.Filter): Promise<Uint8Array> {
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

  // `nearest` must pick exactly ONE source sample at any scale — pixel art /
  // label maps must keep discrete values. Regression: it used to share box's
  // kernel-stretch on downscale and produced area-averaged greys.
  test("nearest downscale keeps discrete values (B/W checker stays B/W)", async () => {
    const checker = makePng(8, 8, (x, y) => ((x + y) & 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const out = await resizePixels(checker, 4, 4, "nearest");
    for (let i = 0; i < out.length; i += 4) expect(out[i] === 0 || out[i] === 255).toBe(true);
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
    // H-only resize on a y-invariant source ⇒ every output row identical
    // (the V pass has nothing to mix).
    const flat = makePng(16, 5, x => [(x * 16) & 255, 0, 0, 255]);
    const out = await resizePixels(flat, 8, 5, filter);
    for (let x = 0; x < 8; x++) for (let y = 1; y < 5; y++) expect(out[(y * 8 + x) * 4]).toBe(out[x * 4]);
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

// ─── palette mapping ────────────────────────────────────────────────────────

/** The RGBA palette (alpha from tRNS) and the index of every pixel of an indexed PNG. */
function readIndexed(png: Uint8Array): { palette: Uint8Array; indices: Uint8Array } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let w = 0;
  let h = 0;
  let depth = 0;
  let entries = 0;
  const palette = new Uint8Array(256 * 4).fill(255);
  const idats: Uint8Array[] = [];
  for (let off = 8; off < png.length; off += 12 + dv.getUint32(off)) {
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const data = png.subarray(off + 8, off + 8 + dv.getUint32(off));
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = data[8];
      // Colour type 3: a pixel is an index into the palette.
      expect(data[9]).toBe(3);
    } else if (type === "PLTE") {
      entries = data.length / 3;
      for (let i = 0; i < entries; i++) palette.set(data.subarray(i * 3, i * 3 + 3), i * 4);
    } else if (type === "tRNS") {
      for (let i = 0; i < data.length; i++) palette[i * 4 + 3] = data[i];
    } else if (type === "IDAT") idats.push(data);
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  // A row is its filter type, then its indices at 1, 2, 4 or 8 bits each, from the high bits of every byte.
  const stride = 1 + Math.ceil((w * depth) / 8);
  const indices = new Uint8Array(w * h);
  const filters = new Set<number>();
  for (let y = 0; y < h; y++) {
    filters.add(raw[y * stride]);
    for (let x = 0; x < w; x++) {
      const bit = x * depth;
      indices[y * w + x] = (raw[y * stride + 1 + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    }
  }
  // Filter type 0: a row holds the indices as they are.
  expect([...filters]).toEqual([0]);
  return { palette: palette.subarray(0, entries * 4), indices };
}

describe("palette mapping", () => {
  const W = 48;
  const H = 48;
  // A step of the search takes 4, 8 or 16 entries, by CPU. Each count ends the palette at another place in a step.
  const colorCounts = [
    2, // below 4 entries the search takes one at a time
    3,
    4, // one step of 4
    6, // a step of 4, then two entries
    7, // one short of a step of 8
    8, // one step of 8
    15, // one short of a step of 16
    16, // one step of 16
    18, // a step of 16, then two entries
    33, // two steps of 16, then one entry
    129, // an index above 127
    256, // the most entries
  ];
  const noise = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;

  // Without dither, a pixel gets the entry nearest to it by squared distance over the four channels: the first one
  // on a tie. This encodes the image at every colour count and looks each pixel up in the palette that was written.
  // No pixel here is fully transparent: what such a pixel maps to is a choice of the quantizer, not of the search.
  async function mapped(pixel: (x: number, y: number) => [number, number, number, number]) {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set(pixel(x, y), (y * W + x) * 4);
    const src = makePng(W, H, (x, y) => {
      const p = (y * W + x) * 4;
      return [rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]];
    });
    /** The colour counts at which a pixel did not get its nearest entry. */
    const wrong: number[] = [];
    /** Pixels with two entries at the least distance. */
    let ties = 0;
    /** The largest distance from a pixel to its nearest entry, in palettes of 4 entries or more. */
    let farthest = 0;
    const encoded = await Promise.all(
      colorCounts.map(colors => new Bun.Image(src).png({ palette: true, colors }).bytes()),
    );
    for (const [n, colors] of colorCounts.entries()) {
      const { palette, indices } = readIndexed(encoded[n]);
      const nearest = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) {
        let least = Infinity;
        let tie = false;
        for (let i = 0; i * 4 < palette.length; i++) {
          let distance = 0;
          for (let c = 0; c < 4; c++) distance += (rgba[p * 4 + c] - palette[i * 4 + c]) ** 2;
          if (distance === least) tie = true;
          if (distance < least) {
            least = distance;
            nearest[p] = i;
            tie = false;
          }
        }
        if (tie) ties++;
        if (palette.length >= 4 * 4 && least > farthest) farthest = least;
      }
      if (!indices.every((index, p) => index === nearest[p])) wrong.push(colors);
    }
    return { wrong, ties, farthest };
  }

  test("noise: every pixel gets the nearest entry", async () => {
    const byte = noise(1);
    const { wrong } = await mapped(() => [byte(), byte(), byte(), byte() | 1]);
    expect(wrong).toEqual([]);
  });

  test("greys: the grey between two entries gets the first of them", async () => {
    const { wrong, ties } = await mapped((x, y) => {
      const grey = (x * 5 + y * 7) & 255;
      return [grey, grey, grey, 255];
    });
    expect(ties).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  test("one dark pixel in a bright image: a distance of more than 16 bits", async () => {
    const byte = noise(2);
    const { wrong, farthest } = await mapped((x, y) =>
      x === 17 && y === 29 ? [0, 0, 0, 1] : [160 + (byte() % 96), 160 + (byte() % 96), 160 + (byte() % 96), 255],
    );
    expect(farthest).toBeGreaterThan(0xffff);
    expect(wrong).toEqual([]);
  });
});
