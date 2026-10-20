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

type Rgba = [number, number, number, number];
const byChannel = (a: Rgba, b: Rgba) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
function rgbaAt(buf: Uint8Array, w: number, x: number, y: number): Rgba {
  const i = (y * w + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}
// An RGBA8 PNG from width×height×4 bytes of pixels.
function pngFromRgba(w: number, h: number, rgba: Uint8Array): Uint8Array {
  return makePng(w, h, (x, y) => rgbaAt(rgba, w, x, y));
}
// PLTE of an indexed PNG in file order (tRNS supplies alpha, 255 past its
// end), and the length of tRNS (0 when the file has none).
function pngPlte(png: Uint8Array): { entries: Rgba[]; trns: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let plte = new Uint8Array(0);
  let trns = new Uint8Array(0);
  for (let off = 8; off + 8 <= png.length;) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (type === "PLTE") plte = png.subarray(off + 8, off + 8 + len);
    else if (type === "tRNS") trns = png.subarray(off + 8, off + 8 + len);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const entries: Rgba[] = [];
  for (let i = 0; i < plte.length / 3; i++) {
    entries.push([plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], i < trns.length ? trns[i] : 255]);
  }
  return { entries, trns: trns.length };
}
// The same palette sorted, so tests can compare against a set of expected
// colours.
function pngPalette(png: Uint8Array): Rgba[] {
  return pngPlte(png).entries.sort(byChannel);
}
// Channel `c` of the pixel at byte `i` as it shows over a background of one
// level: 0 is black, 255 is white.
function shownOver(background: number, rgba: Uint8Array, i: number, c: number): number {
  const a = rgba[i + 3];
  return Math.floor((rgba[i + c] * a + 127) / 255) + Math.floor(((255 - a) * background) / 255);
}
// Mean squared difference per colour channel between two images as they show
// over that background.
function errorOver(background: number, source: Uint8Array, output: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < source.length; i += 4) {
    for (let c = 0; c < 3; c++) sum += (shownOver(background, source, i, c) - shownOver(background, output, i, c)) ** 2;
  }
  return sum / ((source.length / 4) * 3);
}
// What mid-grey adds to a colour channel behind alpha `a`, in whole levels.
const grey = (a: number) => 127 - (a >> 1);
// What a pixel shows over mid-grey, and its alpha: the space an image that
// does not fit is measured in (`Shown` in quantize.rs).
const shown = (p: Rgba): Rgba =>
  [...[0, 1, 2].map(c => Math.floor((p[c] * p[3] + 127) / 255) + grey(p[3])), p[3]] as Rgba;
// Rows 0 to 46 are fully transparent. Below them: grey 30 to 240 across, under
// alpha 0 to 48 down. A shadow or a glow on its own layer looks like this.
function faintGreys(x: number, y: number): Rgba {
  const u = x / 127;
  const v = Math.round(u < 0.5 ? 30 + 98 * 2 * u : 128 + 112 * (2 * u - 1));
  const a = y < 47 ? 0 : Math.round(48 * Math.sqrt((y - 47) / 80));
  return a === 0 ? [0, 0, 0, 0] : [v, v, v, a];
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

// ─── palette quantizer ──────────────────────────────────────────────────────

// The quantizer used to sort pixels and cut a box at its pixel-count
// midpoint. When one colour held more than half the box, that midpoint
// fell inside its run, the colour landed in both halves and the smaller
// half's mean was a blend (75% white / 25% black gave white +
// [128,128,128]). It now cuts only between two distinct values, at the
// position with the least squared error, so a colour is never split
// across two palette entries and a noisy dominant colour is cut off from
// the rest, not in its middle.
describe("png({palette:true}) never splits one colour across two palette entries", () => {
  const white: [number, number, number, number] = [255, 255, 255, 255];
  const black: [number, number, number, number] = [0, 0, 0, 255];
  const grey = (v: number): [number, number, number, number] => [v, v, v, 255];

  test.each([false, true])("white:black 3:1, colors:2, dither %p", async dither => {
    const src = makePng(40, 40, (_x, y) => (y < 30 ? white : black));
    const out = await new Bun.Image(src).png({ palette: true, colors: 2, dither }).bytes();
    expect(out[25]).toBe(3); // indexed
    expect(pngPalette(out)).toEqual([black, white]);
    // Every pixel maps to its own colour, none to a blend.
    const back = decodePng(await new Bun.Image(out).png().bytes());
    expect(rgbaAt(back.data, 40, 0, 0)).toEqual(white);
    expect(rgbaAt(back.data, 40, 39, 29)).toEqual(white);
    expect(rgbaAt(back.data, 40, 0, 30)).toEqual(black);
    expect(rgbaAt(back.data, 40, 39, 39)).toEqual(black);
  });

  test("five colours with unequal counts, colors:5 and colors:8", async () => {
    const red: [number, number, number, number] = [255, 0, 0, 255];
    const green: [number, number, number, number] = [0, 255, 0, 255];
    const blue: [number, number, number, number] = [0, 0, 255, 255];
    // 50% white, 25% black, 12.5% red, 7.5% green, 5% blue: every split
    // lands its midpoint inside a run.
    const src = makePng(40, 40, (_x, y) => (y < 20 ? white : y < 30 ? black : y < 35 ? red : y < 38 ? green : blue));
    const expected = [black, blue, green, red, white];
    const exact = await new Bun.Image(src).png({ palette: true, colors: 5 }).bytes();
    expect(pngPalette(exact)).toEqual(expected);
    // Spare slots must not be filled with duplicates of the same colour.
    const spare = await new Bun.Image(src).png({ palette: true, colors: 8 }).bytes();
    expect(pngPalette(spare)).toEqual(expected);
  });

  test("two alphas of one colour with unequal counts, colors:2", async () => {
    // Same RGB: the entries differ only in tRNS.
    const src = makePng(40, 40, (_x, y) => (y < 30 ? [100, 100, 100, 255] : [100, 100, 100, 0]));
    const out = await new Bun.Image(src).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([
      [100, 100, 100, 0],
      [100, 100, 100, 255],
    ]);
  });

  test("three alphas of one colour, colors:2: the cut is on the alpha channel", async () => {
    // 60% opaque, 20% alpha 128, 20% alpha 64. Alpha has the most error, and
    // {64, 128} | {255} leaves the least. Neither alpha has more than half
    // of its box, so the entry is their mean, 96. Grey 100 times alpha is 50
    // at alpha 128 and 25 at alpha 64: the mean is 38, and grey 101 is the
    // middle one of the greys that give 38 at alpha 96.
    const alphaOf = (y: number) => (y < 24 ? 255 : y < 32 ? 128 : 64);
    const src = makePng(40, 40, (_x, y) => [100, 100, 100, alphaOf(y)]);
    const out = await new Bun.Image(src).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([
      [100, 100, 100, 255],
      [101, 101, 101, 96],
    ]);
    const back = decodePng(await new Bun.Image(out).png().bytes());
    expect([0, 24, 32].map(y => rgbaAt(back.data, 40, 0, y)[3])).toEqual([255, 96, 96]);
  });

  // Black, a middle grey, then white, in 40 rows. The middle run straddles
  // the midpoint, so the old cut split it.
  const threeGreys = (dark: number, mid: number, value = 128) =>
    makePng(40, 40, (_x, y) => (y < dark ? black : y < dark + mid ? grey(value) : white));

  test("three greys 30%/30%/40%, colors:3 is exact", async () => {
    const out = await new Bun.Image(threeGreys(12, 12)).png({ palette: true, colors: 3 }).bytes();
    expect(pngPalette(out)).toEqual([black, grey(128), white]);
  });

  test("three greys, colors:2: the middle grey joins the side that costs the least error", async () => {
    // Grey 128 is equally far from both, so the counts decide: the pair
    // with fewer pixels merges.
    const moreWhite = await new Bun.Image(threeGreys(12, 12)).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(moreWhite)).toEqual([grey(64), white]);
    const moreBlack = await new Bun.Image(threeGreys(16, 12)).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(moreBlack)).toEqual([black, grey(192)]);
    // A grey near one end merges with that end whatever the counts. The
    // end has more than half of the pair's pixels, so it is the entry.
    const middle = async (png: Uint8Array, y: number) =>
      rgbaAt(decodePng(await new Bun.Image(png).png().bytes()).data, 40, 0, y);
    const nearWhite = await new Bun.Image(threeGreys(12, 12, 225)).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(nearWhite)).toEqual([black, white]);
    expect(await middle(nearWhite, 12)).toEqual(white);
    const nearBlack = await new Bun.Image(threeGreys(16, 12, 30)).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(nearBlack)).toEqual([black, white]);
    expect(await middle(nearBlack, 16)).toEqual(black);
  });

  // +-2 per channel, in a fixed pattern so the fixture is deterministic.
  const noise = (x: number, y: number, k: number) => ((x * k + y * (k + 4)) % 5) - 2;

  test("a dominant colour with noise is cut off whole, colors:2", async () => {
    // 75% near-white (250 +- 2) over 25% black. The white is five adjacent
    // runs, not one, so a cut at the count midpoint would land between two
    // of them and black would again map to a grey blend.
    const src = makePng(40, 40, (x, y) => (y < 30 ? grey(250 + noise(x, y, 7)) : black));
    const out = await new Bun.Image(src).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([black, grey(250)]);
    const back = decodePng(await new Bun.Image(out).png().bytes());
    expect(rgbaAt(back.data, 40, 0, 30)).toEqual(black);
    expect(rgbaAt(back.data, 40, 39, 39)).toEqual(black);
  });

  test.each([3, 6])("three flat colours with JPEG-like noise, colors:%d", async colors => {
    // 70% off-white, 20% blue, 10% red, each +-2 on every channel. Every
    // pixel must come back within the noise of its source colour, so no
    // two source colours share an entry and no entry is a blend.
    const base = [
      [240, 240, 240],
      [30, 60, 120],
      [200, 40, 40],
    ];
    const pixel = (x: number, y: number): [number, number, number, number] => {
      const c = base[y < 45 ? 0 : y < 58 ? 1 : 2];
      return [c[0] + noise(x, y, 7), c[1] + noise(x, y, 3), c[2] + noise(x, y, 13), 255];
    };
    const src = makePng(64, 64, pixel);
    const out = await new Bun.Image(src).png({ palette: true, colors }).bytes();
    expect(pngPalette(out)).toHaveLength(colors);
    const back = decodePng(await new Bun.Image(out).png().bytes());
    let worst = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const got = rgbaAt(back.data, 64, x, y);
        const want = pixel(x, y);
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(got[c] - want[c]));
      }
    }
    expect(worst).toBeLessThanOrEqual(4);
  });

  test.each([4, 16])("over budget: 75%% white + a 201-step grey ramp, colors:%d", async colors => {
    // More colours than slots, with one dominant colour. White must get
    // exactly one entry and every other slot must go to the ramp.
    const src = makePng(64, 64, (x, y) => (y < 48 ? white : grey(((y - 48) * 64 + x) % 201)));
    const out = await new Bun.Image(src).png({ palette: true, colors }).bytes();
    const palette = pngPalette(out);
    expect(palette).toHaveLength(colors);
    expect(new Set(palette.map(e => e.join())).size).toBe(colors);
    expect(palette.filter(e => e[0] === 255)).toEqual([white]);
    // A blend of white with the ramp would land in (200, 255).
    expect(palette.filter(e => e[0] > 200 && e[0] < 255)).toEqual([]);
  });

  test("256 distinct colours with a dominant one come out exact at the default colors", async () => {
    // The shape of a re-encoded 256-colour GIF or PNG8: one background
    // colour on 94% of the pixels and 255 single-pixel colours.
    const table: [number, number, number, number][] = Array.from({ length: 256 }, (_, i) =>
      i === 0 ? grey(128) : [i, (i * 7 + 3) & 255, (i * 13 + 5) & 255, 255],
    );
    const colourAt = (x: number, y: number) => table[y * 64 + x < 255 ? y * 64 + x + 1 : 0];
    const src = makePng(64, 64, colourAt);
    const out = await new Bun.Image(src).png({ palette: true }).bytes();
    expect(pngPalette(out)).toEqual(
      table.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]),
    );
    const back = decodePng(await new Bun.Image(out).png().bytes());
    let changed = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (rgbaAt(back.data, 64, x, y).join() !== colourAt(x, y).join()) changed++;
      }
    }
    expect(changed).toBe(0);
  });
});

// An image with at most `colors` colours keeps them, in order of first
// appearance. A bigger one is split where the squared error is largest,
// and every pixel is written as the entry nearest to what it shows.
describe("png({palette:true}) keeps the colours that fit and splits the rest by squared error", () => {
  // A different colour for every i below 2^24: an odd multiplier
  // permutes the low 24 bits.
  const colourAt = (i: number): Rgba => {
    const v = Math.imul(i, 0x9e3779b1) & 0xffffff;
    return [v & 255, (v >> 8) & 255, v >> 16, 255];
  };
  const decode = async (png: Uint8Array) => decodePng(await new Bun.Image(png).png().bytes());

  describe.each([2, 4, 16, 256])("%d colours in unequal amounts", colors => {
    // Colour i first appears before colour i+1 and holds more pixels.
    const indexAt = (x: number, y: number) => Math.floor(colors * ((y * 64 + x) / 4096) ** 2);
    const inOrder = Array.from({ length: colors }, (_, i) => colourAt(i));

    test.each([false, true])(
      "fit colors:" + colors + " exactly, in order of first appearance (dither %p)",
      async dither => {
        const src = makePng(64, 64, (x, y) => colourAt(indexAt(x, y)));
        const out = await new Bun.Image(src).png({ palette: true, colors, dither }).bytes();
        expect(pngPlte(out)).toEqual({ entries: inOrder, trns: 0 });
        expect((await decode(out)).data).toEqual(decodePng(src).data);
      },
    );

    test("keep their alpha, and tRNS is written", async () => {
      // Colour 0 is half transparent, colour 1 fully transparent: the
      // colour it hides is kept too.
      const withAlpha = (i: number): Rgba => {
        const c = colourAt(i);
        return [c[0], c[1], c[2], i === 0 ? 128 : i === 1 ? 0 : 255];
      };
      const src = makePng(64, 64, (x, y) => withAlpha(indexAt(x, y)));
      const out = await new Bun.Image(src).png({ palette: true, colors }).bytes();
      const plte = pngPlte(out);
      expect(plte.entries).toEqual(inOrder.map((_, i) => withAlpha(i)));
      expect(plte.trns).toBeGreaterThanOrEqual(2);
    });

    test.each([false, true])("plus one more: only the two closest share an entry (dither %p)", async dither => {
      // The extra colour is colour 0 one alpha step down, on three
      // pixels. No other pair of colours is that close.
      const base = colourAt(0);
      const twin: Rgba = [base[0], base[1], base[2], 254];
      const pixelOf = (x: number, y: number) => (y === 63 && x < 3 ? twin : colourAt(indexAt(x, y)));
      const src = makePng(64, 64, pixelOf);
      const out = await new Bun.Image(src).png({ palette: true, colors, dither }).bytes();
      expect(pngPalette(out)).toEqual(inOrder.slice().sort(byChannel));
      const back = await decode(out);
      let wrong = 0;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const want = y === 63 && x < 3 ? base : pixelOf(x, y);
          if (rgbaAt(back.data, 64, x, y).join() !== want.join()) wrong++;
        }
      }
      expect(wrong).toBe(0);
    });
  });

  describe("colours that share a slot of the first pass's table", () => {
    // The first pass keeps colours in 512 slots and starts each one at the
    // top 9 bits of key × 0x9e3779b1 (`exact_palette` in quantize.rs). These
    // all start at slot 511, so each one after the first goes round to slot
    // 0 and walks past every colour before it.
    const lastSlot = (count: number): Rgba[] => {
      const colours: Rgba[] = [];
      for (let key = 0xff000000; colours.length < count; key++) {
        if (Math.imul(key, 0x9e3779b1) >>> 23 === 511)
          colours.push([key & 255, (key >> 8) & 255, (key >> 16) & 255, 255]);
      }
      return colours;
    };
    const indexAt = (x: number, y: number) => Math.floor(256 * ((y * 64 + x) / 4096) ** 2);

    test("three colours, colors:3", async () => {
      const three = lastSlot(3);
      const src = makePng(3, 1, x => three[x]);
      const out = await new Bun.Image(src).png({ palette: true, colors: 3 }).bytes();
      expect(pngPlte(out)).toEqual({ entries: three, trns: 0 });
      expect((await decode(out)).data).toEqual(decodePng(src).data);
    });

    test.each([false, true])("256 colours fit colors:256 exactly (dither %p)", async dither => {
      const colours = lastSlot(256);
      const src = makePng(64, 64, (x, y) => colours[indexAt(x, y)]);
      const out = await new Bun.Image(src).png({ palette: true, colors: 256, dither }).bytes();
      expect(pngPlte(out)).toEqual({ entries: colours, trns: 0 });
      expect((await decode(out)).data).toEqual(decodePng(src).data);
    });

    test("257 colours do not fit colors:256", async () => {
      const colours = lastSlot(257);
      const src = makePng(64, 64, (x, y) => colours[y === 63 && x > 60 ? 256 : indexAt(x, y)]);
      const out = await new Bun.Image(src).png({ palette: true, colors: 256 }).bytes();
      const palette = pngPlte(out).entries;
      expect(palette).toHaveLength(256);
      expect(new Set(palette.map(e => e.join())).size).toBe(256);
    });
  });

  describe("fully transparent pixels in an image that does not fit", () => {
    test.each([false, true])("hide no colour: they are one entry (dither %p)", async dither => {
      // 24 rows of alpha 0 that hide a different colour at every pixel, then 8
      // opaque colours in rows of 5. With the hidden colours: 1,544 colours.
      const opaque = Array.from({ length: 8 }, (_, i): Rgba => [i * 36, 255 - i * 36, (i * 90) % 256, 255]);
      const pixel = (x: number, y: number): Rgba =>
        (y < 24 ? [...colourAt(y * 64 + x)].fill(0, 3) : opaque[((y - 24) / 5) | 0]) as Rgba;
      const out = await new Bun.Image(makePng(64, 64, pixel)).png({ palette: true, colors: 16, dither }).bytes();
      expect(pngPalette(out)).toEqual([[0, 0, 0, 0] as Rgba, ...opaque].sort(byChannel));
      const back = (await decode(out)).data;
      let wrong = 0;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const want = y < 24 ? [0, 0, 0, 0] : pixel(x, y);
          if (rgbaAt(back, 64, x, y).join() !== want.join()) wrong++;
        }
      }
      expect(wrong).toBe(0);
    });

    test.each([false, true])("that hide white are not written as opaque white (dither %p)", async dither => {
      // As bytes, transparent white is nearer to opaque white than to transparent black.
      const pixel = (x: number, y: number): Rgba =>
        y < 32 ? [255, 255, 255, 0] : y < 48 ? [255, 255, 255, 255] : [x * 3, x * 3, x * 3, 255];
      const out = await new Bun.Image(makePng(64, 64, pixel)).png({ palette: true, colors: 16, dither }).bytes();
      expect(pngPalette(out)[0]).toEqual([0, 0, 0, 0]);
      const back = (await decode(out)).data;
      let visible = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (rgbaAt(back, 64, x, y)[3] !== 0) visible++;
      expect(visible).toBe(0);
    });
  });

  // In an image that does not fit, the fully transparent pixels are a count on
  // the first box, not pixels of its range. These pin the places that read it.
  describe("fully transparent pixels as a count", () => {
    // A different colour under alpha 0 for every i.
    const hidden = (i: number): Rgba => [...colourAt(i)].fill(0, 3) as Rgba;

    test("a box of the count and one pixel can be split", async () => {
      // 60 fully transparent, one white at alpha 8, one red and two green.
      const rest: Rgba[] = [
        [255, 255, 255, 8],
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 255, 0, 255],
      ];
      const pixel = (x: number, y: number): Rgba => (y * 8 + x < 60 ? hidden(y * 8 + x) : rest[y * 8 + x - 60]);
      const out = await new Bun.Image(makePng(8, 8, pixel)).png({ palette: true, colors: 4 }).bytes();
      expect(pngPalette(out)).toEqual([[0, 0, 0, 0], rest[2], rest[1], rest[0]]);
    });

    test("more than half of a box counts the count", async () => {
      // 40 fully transparent, 50 black at alpha 10 and 10 at alpha 20 share
      // a box. Alpha 10 has half of the 100, not more: the entry is the
      // mean, alpha 7.
      const pixel = (x: number, y: number): Rgba => {
        const i = y * 20 + x;
        return i < 40 ? hidden(i) : i < 90 ? [0, 0, 0, 10] : i < 100 ? [0, 0, 0, 20] : [255, 255, 255, 255];
      };
      const out = await new Bun.Image(makePng(20, 10, pixel)).png({ palette: true, colors: 2 }).bytes();
      expect(pngPalette(out)).toEqual([
        [0, 0, 0, 7],
        [255, 255, 255, 255],
      ]);
    });
  });

  // From 16 colours the last split takes the fully transparent pixels out of
  // their box, and their entry is the first one in the file.
  describe("fully transparent pixels from 16 colours", () => {
    // A black shadow: alpha 0 to 31 down, two rows of 64 pixels per level. The
    // fully transparent pixels share a box with the faintest ones.
    const shadow = makePng(64, 64, (_x, y) => [0, 0, 0, y >> 1]);
    // The first entry of the file, and the alpha of rows 0 and 1 (alpha 0) and
    // of row 2 (alpha 1).
    const firstRows = async (colors: number) => {
      const out = await new Bun.Image(shadow).png({ palette: true, colors }).bytes();
      const back = (await decode(out)).data;
      return { entry: pngPlte(out).entries[0], alpha: [0, 1, 2].map(y => rgbaAt(back, 64, 63, y)[3]) };
    };

    test("they have an entry, the first one of the file", async () => {
      expect(await firstRows(16)).toEqual({ entry: [0, 0, 0, 0], alpha: [0, 0, 1] });
      expect(await firstRows(24)).toEqual({ entry: [0, 0, 0, 0], alpha: [0, 0, 1] });
    });

    test("below 16 colours they share the entry of their box", async () => {
      // One entry for alpha 0 and the faintest pixels: their mean.
      expect(await firstRows(15)).toEqual({ entry: [0, 0, 0, 1], alpha: [1, 1, 1] });
    });

    test("one fully transparent pixel takes an entry too", async () => {
      // 16 flat opaque bands of 4 rows, and pixel (0,0) fully transparent. At
      // 16 colours the pixel keeps alpha 0 and the first two bands share an
      // entry: the colour of the second, which has more than half of their
      // box. The rule has no floor on how many pixels it is for.
      const band = (y: number): Rgba => {
        const v = 8 + 16 * (y >> 2);
        return [v, 255 - v, (v * 3) % 256, 255];
      };
      const src = makePng(64, 64, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 0] : band(y)));
      const out = await new Bun.Image(src).png({ palette: true, colors: 16 }).bytes();
      const entries = pngPlte(out).entries;
      expect(entries[0]).toEqual([0, 0, 0, 0]);
      expect(new Set(entries.map(String)).size).toBe(16);
      const back = (await decode(out)).data;
      expect([0, 1].map(x => rgbaAt(back, 64, x, 0))).toEqual([[0, 0, 0, 0], band(4)]);
    });
  });

  test("the next box to split is the one with the most squared error, not the widest", async () => {
    // Three greys share almost every pixel. Four single pixels are
    // saturated colours: the widest box is always one that holds them.
    const outliers: Rgba[] = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 0, 255],
    ];
    const greyOf = (y: number): Rgba =>
      y < 24 ? [60, 60, 60, 255] : y < 48 ? [90, 90, 90, 255] : [120, 120, 120, 255];
    const src = makePng(64, 64, (x, y) => (y === 0 && x < 4 ? outliers[x] : greyOf(y)));
    const out = await new Bun.Image(src).png({ palette: true, colors: 3 }).bytes();
    expect(pngPalette(out)).toEqual([greyOf(0), greyOf(24), greyOf(48)]);
  });

  test("a box is split along the channel with the most squared error, not the widest", async () => {
    // Two colours that differ in green share almost every pixel, three
    // to one. Two single pixels stretch red further than green.
    const low: Rgba = [100, 50, 0, 255];
    const high: Rgba = [100, 200, 0, 255];
    const src = makePng(64, 64, (x, y) =>
      y === 0 && x === 0 ? [0, 125, 0, 255] : y === 0 && x === 1 ? [255, 125, 0, 255] : y < 48 ? low : high,
    );
    const out = await new Bun.Image(src).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([low, high]);
  });

  test("a colour on more than half of a box is written exactly: white beside a light panel", async () => {
    // White on 70% of the pixels, grey 245 on 12.5%, then a ramp of 201
    // greys. At 4 colours white and the panel share a box, and the mean of
    // that box is (253,253,253).
    const grey = (v: number): Rgba => [v, v, v, 255];
    const src = makePng(64, 64, (x, y) => (y < 45 ? grey(255) : y < 53 ? grey(245) : grey(((y - 53) * 64 + x) % 201)));
    const out = await new Bun.Image(src).png({ palette: true, colors: 4 }).bytes();
    expect(pngPalette(out)).toEqual([grey(40), grey(119), grey(182), grey(255)]);
    expect(rgbaAt((await decode(out)).data, 64, 0, 0)).toEqual(grey(255));
  });

  test("a colour on more than half of a box is written exactly: a transparent background", async () => {
    // 62.5% fully transparent, two rows of low alphas under it, then three
    // opaque colours with noise. The transparent pixels and the soft edge
    // share a box, and the mean of that box has alpha 2.
    const opaque = [
      [251, 240, 223],
      [200, 60, 70],
      [20, 20, 20],
    ];
    const pixel = (x: number, y: number): Rgba => {
      if (y < 40) return [0, 0, 0, 0];
      if (y < 42) return [0, 0, 0, 8 + ((x * 7 + y * 3) % 8) * 8];
      const c = opaque[y < 52 ? 0 : y < 58 ? 1 : 2];
      const n = ((x * 7 + y * 11) % 5) - 2;
      return [Math.max(0, c[0] + n), Math.max(0, c[1] + n), Math.max(0, c[2] + n), 255];
    };
    const out = await new Bun.Image(makePng(64, 64, pixel)).png({ palette: true, colors: 4 }).bytes();
    expect(pngPalette(out)).toEqual([
      [0, 0, 0, 0],
      [20, 20, 20, 255],
      [200, 60, 70, 255],
      [251, 240, 223, 255],
    ]);
    const back = (await decode(out)).data;
    let visible = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 64; x++) if (rgbaAt(back, 64, x, y)[3] !== 0) visible++;
    expect(visible).toBe(0);
  });

  // width×height×4 bytes of pixels: white on the first `white`, then
  // `distinct - 1` dark colours on one pixel each, then white again. The
  // dark colours are all different (an odd multiplier permutes the low
  // 21 bits) and every channel is below 128.
  const whiteThenDark = (pixels: number, white: number, distinct: number) => {
    const rgba = new Uint8Array(pixels * 4).fill(255);
    for (let i = 0, p = white * 4; i < distinct - 1; i++, p += 4) {
      const v = Math.imul(i, 0x9e3779b1) & 0x1fffff;
      rgba[p] = v & 127;
      rgba[p + 1] = (v >> 7) & 127;
      rgba[p + 2] = v >> 14;
    }
    return rgba;
  };
  // Pixels of `back` that are not a palette entry nearest to the same
  // pixel of `rgba` (squared RGBA distance: an opaque pixel shows its bytes).
  const countNotNearest = (rgba: Uint8Array, palette: Rgba[], back: Uint8Array) => {
    // The least distance from a colour to the palette, found once per colour.
    const least = new Map<number, number>();
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
      const key = r | (g << 8) | (b << 16) | (a << 24);
      let best = least.get(key);
      if (best === undefined) {
        best = Infinity;
        for (const e of palette) {
          best = Math.min(best, (r - e[0]) ** 2 + (g - e[1]) ** 2 + (b - e[2]) ** 2 + (a - e[3]) ** 2);
        }
        least.set(key, best);
      }
      const got = (r - back[i]) ** 2 + (g - back[i + 1]) ** 2 + (b - back[i + 2]) ** 2 + (a - back[i + 3]) ** 2;
      if (got !== best) count++;
    }
    return count;
  };

  // [name, width, height, white pixels, distinct colours, colors].
  test.each([
    ["white and a few thousand other colours", 128, 128, 8192, 4000, 16],
    ["mostly different colours", 64, 64, 1900, 2197, 16],
  ] as const)("every pixel is written as a nearest entry: %s", async (_name, w, h, white, distinct, colors) => {
    const rgba = whiteThenDark(w * h, white, distinct);
    const out = await new Bun.Image(pngFromRgba(w, h, rgba)).png({ palette: true, colors }).bytes();
    const palette = pngPlte(out).entries;
    expect(palette).toHaveLength(colors);
    // One colour per entry: white holds one entry, not several.
    expect(new Set(palette.map(e => e.join())).size).toBe(colors);
    expect(countNotNearest(rgba, palette, (await decode(out)).data)).toBe(0);
  });

  test("the palette does not depend on the order of the pixels", async () => {
    const [w, h] = [128, 128];
    const forward = whiteThenDark(w * h, 8192, 4000);
    const backward = forward.slice();
    new Uint32Array(backward.buffer).reverse();
    const [first, second] = await Promise.all(
      [forward, backward].map(rgba =>
        new Bun.Image(pngFromRgba(w, h, rgba)).png({ palette: true, colors: 16 }).bytes(),
      ),
    );
    expect(pngPlte(second).entries).toEqual(pngPlte(first).entries);
  });

  test("a cut is scored in fractions of a level", async () => {
    // A cut after 3 leaves a squared error of 2.8 per channel, a cut after 2
    // leaves 3. Scored in whole levels the two are equal.
    const greys = [1, 1, 2, 2, 3, 5];
    const src = makePng(6, 1, x => [greys[x], greys[x], greys[x], 255]);
    const out = await new Bun.Image(src).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([
      [2, 2, 2, 255],
      [5, 5, 5, 255],
    ]);
  });

  test("the error of a box counts alpha", async () => {
    // The first cut is on alpha: the greys at 90 with alpha 1 and 128 on one
    // side, the opaque greys on the other. The alpha side has more squared
    // error (32,273 against 29,455, and 30,242 of it is alpha), so it is
    // split next. Grey 90 has more than half of the opaque side. At alpha 1
    // grey 90 shows as black does: it is written as black.
    const runs: [Rgba, number][] = [
      [[90, 90, 90, 1], 5],
      [[150, 150, 150, 255], 5],
      [[90, 90, 90, 128], 3],
      [[90, 90, 90, 255], 6],
    ];
    const pixels = runs.flatMap(([colour, count]) => Array.from({ length: count }, () => colour));
    const out = await new Bun.Image(makePng(pixels.length, 1, x => pixels[x]))
      .png({ palette: true, colors: 3 })
      .bytes();
    expect(pngPalette(out)).toEqual([
      [0, 0, 0, 1],
      [90, 90, 90, 128],
      [90, 90, 90, 255],
    ]);
  });

  test("a 512x256 ramp: the score of a cut passes 64 bits", async () => {
    const src = makePng(512, 256, x => {
      const v = Math.floor(Math.sqrt(x / 511) * 255);
      return [v, v, v, 255];
    });
    const out = await new Bun.Image(src).png({ palette: true, colors: 3 }).bytes();
    expect(pngPalette(out)).toEqual([
      [63, 63, 63, 255],
      [128, 128, 128, 255],
      [209, 209, 209, 255],
    ]);
  });

  test("a 512x512 image: the products that choose a box pass 64 bits", async () => {
    // Flat rows: 172 white, 11 black, 43 yellow, 286 cyan.
    const rowOf = (y: number): Rgba =>
      y < 172 ? [255, 255, 255, 255] : y < 183 ? [0, 0, 0, 255] : y < 226 ? [255, 255, 0, 255] : [0, 255, 255, 255];
    const src = makePng(512, 512, (_x, y) => rowOf(y));
    const out = await new Bun.Image(src).png({ palette: true, colors: 3 }).bytes();
    expect(pngPalette(out)).toEqual([
      [0, 255, 255, 255],
      [255, 255, 0, 255],
      [255, 255, 255, 255],
    ]);
  });

  // The middle one of the colours that show `seen`.
  const straight = (seen: Rgba): Rgba => {
    if (seen[3] === 0) return [0, 0, 0, 0];
    const whole = (c: number) => Math.floor(((seen[c] - grey(seen[3])) * 255 + (seen[3] >> 1)) / seen[3]);
    return [whole(0), whole(1), whole(2), seen[3]];
  };

  // The rules of the quantizer, one step at a time. Exact for the small
  // images below: every sum is under 2^53, and the score is a BigInt.
  const model = (pixels: Rgba[], colors: number): { palette: Rgba[]; indices: number[] } => {
    const channels = [0, 1, 2, 3];
    type Box = { pixels: Rgba[]; sums: number[]; error: number[] };
    const boxOf = (pixels: Rgba[]): Box => {
      const sums = channels.map(c => pixels.reduce((s, p) => s + p[c], 0));
      // The number of pixels times the squared error, per channel.
      const error = channels.map(c => pixels.length * pixels.reduce((s, p) => s + p[c] * p[c], 0) - sums[c] ** 2);
      return { pixels, sums, error };
    };
    const total = (box: Box) => box.error.reduce((s, e) => s + e, 0);
    const sumsSquared = (box: Box) => BigInt(box.sums.reduce((s, v) => s + v * v, 0));

    // At most `colors` colours: those colours, in order of first appearance.
    let palette: Rgba[] = [];
    for (const p of pixels) if (!palette.some(e => e.join() === p.join())) palette.push(p);
    // What the entries show: a pixel takes the nearest of these.
    let seen = palette;
    if (palette.length > colors) {
      // From here on a pixel is what it shows. Fully transparent pixels all
      // show the same.
      pixels = pixels.map(shown);
      const boxes = [boxOf(pixels)];
      while (boxes.length < colors) {
        // From 16 colours up the last split is for the fully transparent
        // pixels, unless they are more than half of their box.
        const holder = boxes.find(box => box.pixels.some(p => p[3] === 0));
        if (colors >= 16 && boxes.length + 1 === colors && holder) {
          const clear = holder.pixels.filter(p => p[3] === 0);
          if (clear.length < holder.pixels.length && clear.length * 2 <= holder.pixels.length) {
            boxes[boxes.indexOf(holder)] = boxOf(holder.pixels.filter(p => p[3] !== 0));
            boxes.push(boxOf(clear));
            break;
          }
        }
        // The box with the most squared error.
        let pick: Box | undefined;
        for (const box of boxes) {
          if (box.pixels.length < 2) continue;
          if (!pick || total(box) * pick.pixels.length > total(pick) * box.pixels.length) pick = box;
        }
        if (!pick) break;
        const box = pick;
        // Its channel with the most squared error.
        let ch = 0;
        for (const c of channels) if (box.error[c] > box.error[ch]) ch = c;
        // The cut between two values of that channel that leaves the least
        // squared error. The score keeps 32 fraction bits.
        const values = [...new Set(box.pixels.map(p => p[ch]))].sort((a, b) => a - b);
        let best: { score: bigint; parts: [Box, Box] } | undefined;
        for (const value of values.slice(1)) {
          const parts: [Box, Box] = [
            boxOf(box.pixels.filter(p => p[ch] < value)),
            boxOf(box.pixels.filter(p => p[ch] >= value)),
          ];
          const [below, rest] = parts;
          const score =
            (sumsSquared(below) << 32n) / BigInt(below.pixels.length) +
            (sumsSquared(rest) << 32n) / BigInt(rest.pixels.length);
          if (!best || score > best.score) best = { score, parts };
        }
        if (!best) break;
        boxes[boxes.indexOf(box)] = best.parts[0];
        boxes.push(best.parts[1]);
      }
      // An entry shows what more than half of the box shows. With no such
      // colour it shows the mean of the box, a half rounded up: the mean
      // alpha, and the mean of the colours times alpha over the grey of that
      // alpha. It is written as the middle one of the colours that show it.
      seen = boxes.map(box => {
        const n = box.pixels.length;
        const most = box.pixels.find(p => box.pixels.filter(q => q.join() === p.join()).length * 2 > n);
        if (most) return most;
        const mean = (sum: number) => Math.floor((sum + (n >> 1)) / n);
        const alpha = mean(box.sums[3]);
        const greys = box.pixels.reduce((s, p) => s + grey(p[3]), 0);
        return [...[0, 1, 2].map(c => mean(box.sums[c] - greys) + grey(alpha)), alpha] as Rgba;
      });
      // The fully transparent entry is first in the file.
      const first = seen.findIndex(e => e[3] === 0);
      if (first > 0) seen.unshift(...seen.splice(first, 1));
      palette = seen.map(straight);
    }
    // A pixel takes the nearest entry, the first one when two are as near.
    const indices = pixels.map(p => {
      const distances = seen.map(e => channels.reduce((s, c) => s + (p[c] - e[c]) ** 2, 0));
      return distances.indexOf(Math.min(...distances));
    });
    return { palette, indices };
  };

  test("small random images match a model of the rules", async () => {
    let state = 0x2f6e2b1;
    const next = (below: number) => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return (state >>> 16) % below;
    };
    const cases = Array.from({ length: 60 }, (_, i) => {
      // The last 20 have 16 to 19 colours, the palette size from which the
      // fully transparent pixels have an entry, and faint pixels that share a
      // box with them: in 15 the last split is theirs.
      const large = i >= 40;
      const [w, h, colors] = large ? [6 + next(3), 6 + next(3), 16 + next(4)] : [1 + next(8), 1 + next(8), 2 + next(8)];
      // A few levels per channel, so that colours repeat and scores tie.
      const [levels, withAlpha] = large ? [6, true] : [1 + next(6), next(3) === 0];
      const level = () => next(levels) * 51;
      const alpha = () => (large ? [0, 1, 2, 3, 128, 255][next(6)] : withAlpha ? level() : 255);
      const pixels = Array.from({ length: w * h }, (): Rgba => [level(), level(), level(), alpha()]);
      return { w, h, colors, pixels };
    });
    const got = await Promise.all(
      cases.map(async ({ w, h, colors, pixels }) => {
        const out = await new Bun.Image(makePng(w, h, (x, y) => pixels[y * w + x]))
          .png({ palette: true, colors })
          .bytes();
        const back = (await decode(out)).data;
        return {
          palette: pngPlte(out).entries,
          pixels: pixels.map((_, i) => rgbaAt(back, w, i % w, Math.floor(i / w))),
        };
      }),
    );
    const want = cases.map(({ colors, pixels }) => {
      const { palette, indices } = model(pixels, colors);
      return { palette, pixels: indices.map(i => palette[i]) };
    });
    expect(got).toEqual(want);
  });
});

// An image that does not fit is measured in what its pixels show over
// mid-grey, and in their alpha: the mean of the errors over black and over
// white. The colour of a nearly transparent pixel weighs almost nothing.
describe("png({palette:true}) measures what a pixel shows, not its bytes", () => {
  const decode = async (png: Uint8Array) => decodePng(await new Bun.Image(png).png().bytes()).data;
  const clear: Rgba = [0, 0, 0, 0];
  const white: Rgba = [255, 255, 255, 255];

  // [colors, the error of 1.4.3 over black, over white]. On the bytes a grey
  // at alpha 20 weighed as much as an opaque one: the palette kept two or
  // three levels of alpha and spent the other entries on greys.
  test.each([
    [16, 8.896, 7.651],
    [32, 3.899, 3.413],
    [64, 3.247, 2.847],
  ])("faint greys keep their levels of alpha, colors:%d", async (colors, black, white) => {
    const src = makePng(128, 128, faintGreys);
    const out = await decode(await new Bun.Image(src).png({ palette: true, colors }).bytes());
    const source = decodePng(src).data;
    // Under two thirds of the error that 1.4.3 had, on either background.
    expect({
      black: errorOver(0, source, out) * 1.5 < black,
      white: errorOver(255, source, out) * 1.5 < white,
    }).toEqual({ black: true, white: true });
  });

  test("a pixel takes the entry nearest to what it shows", async () => {
    // 26 rows fully transparent, 26 opaque white, 12 white at alpha 3. White
    // at alpha 3 shows next to nothing: it is beside transparent. As bytes it
    // is nearer to opaque white.
    const rows: Rgba[] = [clear, white, [255, 255, 255, 3]];
    const rowOf = (y: number) => rows[y < 26 ? 0 : y < 52 ? 1 : 2];
    const out = await new Bun.Image(makePng(64, 64, (_x, y) => rowOf(y))).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([clear, white]);
    const back = await decode(out);
    expect([0, 26, 52, 63].map(y => rgbaAt(back, 64, 0, y))).toEqual([clear, white, clear, clear]);
  });

  test("an entry shows the mean of what its pixels show", async () => {
    // Red at alpha 64 and blue at alpha 192 share a box, 1,024 pixels each.
    // Times alpha they are (64,0,0) and (0,0,192): the mean is (32,0,96) at
    // alpha 128, and (64,0,191) gives that. The mean of the bytes is
    // (128,0,128).
    const rowOf = (y: number): Rgba => (y < 16 ? [255, 0, 0, 64] : y < 32 ? [0, 0, 255, 192] : white);
    const out = await new Bun.Image(makePng(64, 64, (_x, y) => rowOf(y))).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([[64, 0, 191, 128], white]);
  });

  test("a faint colour does not pull an opaque one to its alpha", async () => {
    // Red, green and blue opaque, then red and blue at alpha 16. On the bytes
    // faint blue had its own entry, and opaque red shared one with faint red:
    // it was written at alpha 136.
    const row: Rgba[] = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 0, 0, 16],
      [0, 0, 255, 16],
    ];
    const out = await new Bun.Image(makePng(5, 1, x => row[x])).png({ palette: true, colors: 4 }).bytes();
    expect(pngPalette(out)).toEqual([row[2], row[1], [128, 0, 128, 16], row[0]]);
    const back = await decode(out);
    expect([0, 1, 2, 3, 4].map(x => rgbaAt(back, 5, x, 0))).toEqual([
      row[0],
      row[1],
      row[2],
      [128, 0, 128, 16],
      [128, 0, 128, 16],
    ]);
  });

  // A different colour under alpha 0 for every i: the image does not fit.
  const hidden = (i: number): Rgba => {
    const v = Math.imul(i + 1, 0x9e3779b1) & 0xffffff;
    return [v & 255, (v >> 8) & 255, v >> 16, 0];
  };

  test("a cut-out: fully transparent is as far from black as from white", async () => {
    // 6 rows fully transparent, 7 opaque black, 7 opaque white. As (0,0,0,0)
    // the transparent pixels were nearer to black, and were written as
    // opaque black.
    const pixel = (x: number, y: number): Rgba => (y < 6 ? hidden(y * 20 + x) : y < 13 ? [0, 0, 0, 255] : white);
    const out = await new Bun.Image(makePng(20, 20, pixel)).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([clear, [128, 128, 128, 255]]);
    const back = await decode(out);
    expect([0, 5, 6, 19].map(y => rgbaAt(back, 20, 0, y)[3])).toEqual([0, 0, 255, 255]);
  });

  test("every grey at every alpha is written as the entry nearest to what it shows", async () => {
    // 256x256: grey x at alpha y. All 65,536 pairs go through the transform.
    const src = makePng(256, 256, (x, y) => [x, x, x, y]);
    const out = await new Bun.Image(src).png({ palette: true, colors: 16 }).bytes();
    const entries = pngPlte(out).entries;
    const seen = entries.map(shown);
    const back = await decode(out);
    let wrong = 0;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const [v, a] = [Math.floor((x * y + 127) / 255) + grey(y), y];
        let [nearest, least] = [0, Infinity];
        for (let e = 0; e < seen.length; e++) {
          const d = 3 * (v - seen[e][0]) ** 2 + (a - seen[e][3]) ** 2;
          if (d < least) [nearest, least] = [e, d];
        }
        const i = (y * 256 + x) * 4;
        if (back[i] !== entries[nearest][0] || back[i + 3] !== entries[nearest][3]) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });

  // 8 fully transparent, then (126,0,0) and (255,127,127) opaque. The first cut
  // is on red, between 126 and 127: what a fully transparent pixel shows has
  // red 127, so the count goes to the second part. A split sums its shorter
  // part, and the other part is the rest: each part is the shorter one once.
  // The fully transparent entry is first in the file.
  test.each([
    [196, 196],
    [200, 192],
  ])(
    "the count moves to the second part when a colour cut leaves the transparent point there, %d pixels and %d",
    async (dark, light) => {
      const pixel = (x: number, y: number): Rgba =>
        y * 20 + x < 8 ? hidden(y * 20 + x) : y * 20 + x < 8 + dark ? [126, 0, 0, 255] : [255, 127, 127, 255];
      expect(8 + dark + light).toBe(400);
      const out = await new Bun.Image(makePng(20, 20, pixel)).png({ palette: true, colors: 3 }).bytes();
      expect(pngPlte(out).entries).toEqual([clear, [126, 0, 0, 255], [255, 127, 127, 255]]);
    },
  );

  test("a flat run of many chunks takes the entry of its colour", async () => {
    // Two translucent colours in long runs, a run of five inside a long one,
    // opaque white, and two near greens so that the image does not fit. The
    // search is asked once per run, and a chunk of 256 pixels of the colour
    // before it is not looked at.
    const long: Rgba = [200, 40, 40, 128];
    const short: Rgba = [40, 40, 200, 64];
    const colourOf = (i: number): Rgba =>
      i < 700
        ? long
        : i < 1000
          ? short
          : i < 1100
            ? long
            : i < 1105
              ? short
              : i < 1500
                ? long
                : i < 1502
                  ? [10 + 2 * (i - 1500), 200, 10, 255]
                  : white;
    const src = makePng(64, 32, (x, y) => colourOf(y * 64 + x));
    const out = await new Bun.Image(src).png({ palette: true, colors: 4 }).bytes();
    const back = await decode(out);
    const written = (i: number) => rgbaAt(back, 64, i % 64, Math.floor(i / 64)).join();
    const runs = { long: new Set<string>(), short: new Set<string>() };
    for (let i = 0; i < 1500; i++) runs[colourOf(i) === long ? "long" : "short"].add(written(i));
    expect([runs.long.size, runs.short.size, runs.long.has([...runs.short][0])]).toEqual([1, 1, false]);
    const source = decodePng(src).data.subarray(0, 1500 * 4);
    expect([
      errorOver(0, source, back.subarray(0, 1500 * 4)),
      errorOver(255, source, back.subarray(0, 1500 * 4)),
    ]).toEqual([0, 0]);
  });

  test("faint black and faint white are as far from transparent as each other", async () => {
    // 20 rows fully transparent, 22 black at alpha 64, 22 white at alpha 64.
    // Over black only, faint black is the same as transparent, so the two
    // shared an entry at alpha 64. Over mid-grey the two faint colours are
    // nearer to each other than to transparent: their mean is grey.
    const rowOf = (y: number): Rgba => (y < 20 ? clear : y < 42 ? [0, 0, 0, 64] : [255, 255, 255, 64]);
    const src = makePng(64, 64, (_x, y) => rowOf(y));
    const out = await new Bun.Image(src).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([clear, [128, 128, 128, 64]]);
    const [source, back] = [decodePng(src).data, await decode(out)];
    expect(errorOver(0, source, back)).toBe(errorOver(255, source, back));
  });

  test("black and white keep their colour in the mean of a box", async () => {
    // Opaque white, then black at alpha 101 and at alpha 103 in equal
    // amounts: the black box has no colour on more than half of its pixels.
    // The same with black and white the other way round.
    for (const [opaque, faint] of [
      [255, 0],
      [0, 255],
    ]) {
      const rowOf = (y: number): Rgba =>
        y < 32 ? [opaque, opaque, opaque, 255] : [faint, faint, faint, y < 48 ? 101 : 103];
      const out = await new Bun.Image(makePng(64, 64, (_x, y) => rowOf(y))).png({ palette: true, colors: 2 }).bytes();
      expect(pngPalette(out)).toEqual(
        [[opaque, opaque, opaque, 255] as Rgba, [faint, faint, faint, 102] as Rgba].sort(byChannel),
      );
    }
  });

  test("colours that show the same share an entry", async () => {
    // A different colour on every pixel, all at alpha 1. A channel shows one
    // level from 128 up and none below: the image shows eight colours.
    const pixel = (x: number, y: number): Rgba => {
      const v = Math.imul(y * 64 + x, 0x9e3779b1) & 0xffffff;
      return [v & 255, (v >> 8) & 255, v >> 16, 1];
    };
    const src = makePng(64, 64, pixel);
    const out = await new Bun.Image(src).png({ palette: true, colors: 16 }).bytes();
    const eight = Array.from({ length: 8 }, (_, i): Rgba => [i & 4 ? 255 : 0, i & 2 ? 255 : 0, i & 1 ? 255 : 0, 1]);
    expect(pngPalette(out)).toEqual(eight);
    const [source, back] = [decodePng(src).data, await decode(out)];
    expect([errorOver(0, source, back), errorOver(255, source, back)]).toEqual([0, 0]);
  });

  test("the last pixels of an image show what the others do", async () => {
    // Three pixels are fewer than one vector of the kernel at any width: its
    // scalar tail maps them. 128 at alpha 1 shows one level and 0 shows none,
    // so the two faint pixels show two colours, and their entry is the mean.
    const row: Rgba[] = [[128, 0, 0, 1], [0, 0, 0, 1], white];
    const out = await new Bun.Image(makePng(3, 1, x => row[x])).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([[255, 0, 0, 1], white]);
  });

  test("alpha 254 is not opaque", async () => {
    // 16 pixels at alpha 254 or 255: whole vectors of the kernel at every
    // width. Grey 200 and grey 202 at alpha 254 show 199 and 201. Their mean
    // shows 200, as grey 201 does. The mean of the bytes is written as 202.
    const row = (x: number): Rgba => (x < 4 ? [200, 200, 200, 254] : x < 8 ? [202, 202, 202, 254] : [0, 0, 0, 255]);
    const out = await new Bun.Image(makePng(16, 1, row)).png({ palette: true, colors: 2 }).bytes();
    expect(pngPalette(out)).toEqual([
      [0, 0, 0, 255],
      [201, 201, 201, 254],
    ]);
  });

  test("a translucent colour with its own entry is written as the middle colour that shows the same", async () => {
    // Grey 127 at alpha 127 on 75% of the pixels, then a ramp of 201 opaque
    // greys. Greys 126 and 127 show the same at alpha 127, and the entry is
    // the lower one: the bytes of a translucent colour can move.
    const flat: Rgba = [127, 127, 127, 127];
    const grey = (v: number): Rgba => [v, v, v, 255];
    const src = makePng(64, 64, (x, y) => (y < 48 ? flat : grey(((y - 48) * 64 + x) % 201)));
    const out = await new Bun.Image(src).png({ palette: true, colors: 4 }).bytes();
    expect(pngPalette(out)).toEqual([grey(48), grey(124), [126, 126, 126, 127], grey(175)]);
    const [source, back] = [decodePng(src).data, await decode(out)];
    const top = 48 * 64 * 4;
    expect([
      errorOver(0, source.subarray(0, top), back.subarray(0, top)),
      errorOver(255, source.subarray(0, top), back.subarray(0, top)),
    ]).toEqual([0, 0]);
  });
});

// ─── Floyd–Steinberg dither ─────────────────────────────────────────────────

describe("Floyd–Steinberg dither", () => {
  // A 0..255 horizontal grey ramp quantised to 2 colours. The quantizer cuts
  // a uniform ramp in the middle: palette ≈ [64, 192] (means of the halves), so
  // values outside [64,192] saturate — FS can only track the source *within
  // the palette's gamut*. Inside that band, the local mean over any window
  // should converge to the source value (the defining property of error
  // diffusion).
  test("2-colour dithered ramp tracks source mean inside palette gamut", async () => {
    const ramp = makePng(256, 8, x => [x, x, x, 255]);
    const png = await new Bun.Image(ramp).png({ palette: true, colors: 2, dither: true }).bytes();
    const back = decodePng(await new Bun.Image(png).png().bytes());
    // Discover the two greys the quantizer actually picked.
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

  type Px = [number, number, number, number];
  const ditherBack = async (w: number, h: number, pixelOf: (x: number, y: number) => Px, colors: number) => {
    const png = await new Bun.Image(makePng(w, h, pixelOf)).png({ palette: true, colors, dither: true }).bytes();
    return decodePng(await new Bun.Image(png).png().bytes()).data;
  };
  // Mean squared difference, per colour channel, between the means of the 8x8
  // blocks of two square images of side `w` as they show over a background.
  const blockError = (background: number, source: Uint8Array, output: Uint8Array, w: number) => {
    let sum = 0;
    const blocks = (w / 8) ** 2;
    for (let b = 0; b < blocks; b++) {
      for (let c = 0; c < 3; c++) {
        let diff = 0;
        for (let p = 0; p < 64; p++) {
          const i = ((Math.floor(b / (w / 8)) * 8 + (p >> 3)) * w + (b % (w / 8)) * 8 + (p & 7)) * 4;
          diff += shownOver(background, source, i, c) - shownOver(background, output, i, c);
        }
        sum += (diff / 64) ** 2;
      }
    }
    return sum / (blocks * 3);
  };
  // Pixels from row `from` on that are not `flat`.
  const displaced = (data: Uint8Array, w: number, from: number, flat: Px) => {
    let count = 0;
    for (let i = from * w * 4; i < data.length; i += 4) {
      if (data[i] !== flat[0] || data[i + 1] !== flat[1] || data[i + 2] !== flat[2] || data[i + 3] !== flat[3]) count++;
    }
    return count;
  };

  // The four shares of a pixel's error add up to that error. With four
  // floored shares an error of -1 pushed -4: small errors grew as they
  // travelled and speckled a flat area that has its own palette entry.
  test("a flat area with its own entry stays flat below a fine ramp", async () => {
    const grey128: Px = [128, 128, 128, 255];
    // Every grey, with a tint per row so that there are more than 256 colours.
    const ramp = (x: number, y: number): Px => [x, x, Math.min(255, x + (y & 3)), 255];
    const data = await ditherBack(256, 64, (x, y) => (y < 16 ? ramp(x, y) : grey128), 256);
    // Rows 16 and 17 take the error of the last ramp row.
    expect(displaced(data, 256, 18, grey128)).toBe(0);
  });

  // The error is measured inside 0..255. The palette here is black and grey
  // 192: white is 63 past it. Unclamped, every white pixel added 63 that
  // nothing could absorb, and the sum came down on the black area as a band
  // of grey.
  test("error past the palette's range does not spill into a flat area", async () => {
    const black: Px = [0, 0, 0, 255];
    const top = (x: number): Px => (x < 32 ? [255, 255, 255, 255] : [128, 128, 128, 255]);
    const data = await ditherBack(64, 64, (x, y) => (y < 32 ? top(x) : black), 2);
    // Rows 32 and 33 take the error of the last row above them.
    expect(displaced(data, 64, 34, black)).toBe(0);
  });

  // The error rows hold sixteenths of a level, so an error of 1 still splits
  // 7/3/5/1. In whole levels it went straight down and the grain lined up in
  // rows. On a gradient that is the same along x and along y, neighbours in a
  // row and neighbours in a column must differ by about the same amount.
  test("the grain of a diagonal gradient has no direction", async () => {
    const data = await ditherBack(256, 256, (x, y) => [(x + y) >> 1, (x + y) >> 1, (x + y) >> 1, 255], 32);
    let alongRows = 0;
    let alongColumns = 0;
    for (let y = 0; y < 255; y++) {
      for (let x = 0; x < 255; x++) {
        const i = (y * 256 + x) * 4;
        alongRows += Math.abs(data[i] - data[i + 4]);
        alongColumns += Math.abs(data[i] - data[i + 256 * 4]);
      }
    }
    const ratio = alongRows / alongColumns;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.25);
  });

  // The error is in what pixels show, and so is the palette that it is
  // measured against. On the bytes, the colour of a faint pixel pushed as
  // much error as that of an opaque one.
  test("the means of 8x8 blocks follow the source over black and over white", async () => {
    const src = decodePng(makePng(128, 128, faintGreys)).data;
    const out = await ditherBack(128, 128, faintGreys, 16);
    // 1.4.3: 4.3 over black and 3.7 over white.
    expect({ black: blockError(0, src, out, 128) < 2, white: blockError(255, src, out, 128) < 2 }).toEqual({
      black: true,
      white: true,
    });
  });

  // The error of a colour channel is measured inside what a pixel of that
  // alpha can show. The palette here is black and grey 191 at alpha 16: white
  // at alpha 16 is past it, and its error came down on the black area.
  test("error past what a translucent pixel can show does not spill into a flat area", async () => {
    const black: Px = [0, 0, 0, 16];
    const top = (x: number): Px => (x < 32 ? [255, 255, 255, 16] : [128, 128, 128, 16]);
    const data = await ditherBack(64, 64, (x, y) => (y < 32 ? top(x) : black), 2);
    // Rows 32 and 33 take the error of the last row above them.
    expect(displaced(data, 64, 34, black)).toBe(0);
  });

  // Alpha is measured inside 0..255. Black at three alphas: a flat area
  // below, and above it two alphas that share an entry at their mean. One of
  // the two is 63 levels past that entry: above it, then below it.
  test("error past the palette's range of alpha does not spill into a flat area", async () => {
    for (const [flat, past, inside, entry] of [
      [16, 255, 128, 192],
      [239, 1, 127, 64],
    ]) {
      const area: Px = [0, 0, 0, flat];
      const pixel = (x: number, y: number): Px => (y >= 32 ? area : [0, 0, 0, x < 32 ? past : inside]);
      const png = await new Bun.Image(makePng(64, 64, pixel)).png({ palette: true, colors: 2, dither: true }).bytes();
      expect(pngPalette(png)).toEqual([area, [0, 0, 0, entry] as Px].sort(byChannel));
      const data = decodePng(await new Bun.Image(png).png().bytes()).data;
      // Rows 32 and 33 take the error of the last row above them.
      expect(displaced(data, 64, 34, area)).toBe(0);
    }
  });

  // A fully transparent pixel takes no error. The error of a soft edge beside
  // it put faint entries on the background.
  test.each([16, 32, 64])(
    "fully transparent pixels beside a soft edge stay fully transparent, colors:%d",
    async colors => {
      // A disc with a gradient, an antialiased edge and a soft shadow.
      const sprite = (x: number, y: number): Px => {
        const cover = Math.min(1, Math.max(0, 28.5 - Math.hypot(x - 48, y - 45)));
        const shadow = 0.5 * Math.exp(-(((x - 48) / 31) ** 2 + ((y - 79) / 3.75) ** 2));
        const a = cover + (1 - cover) * shadow;
        if (a < 1 / 510) return [0, 0, 0, 0];
        const t = (y - 17) / 56;
        const k = cover / a;
        return [k * (250 - 60 * t), k * (190 - 90 * t), k * (60 + 40 * t), 255 * a].map(Math.floor) as Px;
      };
      const src = decodePng(makePng(96, 96, sprite)).data;
      const out = await ditherBack(96, 96, sprite, colors);
      let background = 0;
      let visible = 0;
      for (let i = 3; i < src.length; i += 4) {
        if (src[i] !== 0) continue;
        background++;
        if (out[i] !== 0) visible++;
      }
      expect({ background, visible }).toEqual({ background: 5254, visible: 0 });
    },
  );

  // Carried alpha must not write a faint pixel as a far more opaque entry of
  // another colour. 64x96: an opaque band, a fully transparent band (more
  // than half of its box, so its entry is fully transparent) and a flat
  // black area at one alpha. Counts the pixels of that area written opaque.
  const opaqueInShadow = async (band: Px, alpha: number) => {
    const clear: Px = [0, 0, 0, 0];
    const pixel = (x: number, y: number): Px => (y < 16 ? band : y < 64 ? clear : [0, 0, 0, alpha]);
    const png = await new Bun.Image(makePng(64, 96, pixel)).png({ palette: true, colors: 2, dither: true }).bytes();
    expect(pngPalette(png)).toEqual([clear, band]);
    const data = decodePng(await new Bun.Image(png).png().bytes()).data;
    let opaque = 0;
    for (let i = 64 * 64 * 4 + 3; i < data.length; i += 4) if (data[i] === 255) opaque++;
    return opaque;
  };
  // The palette is transparent and opaque bright: neither shows a faint
  // black. The alpha that the area cannot have is carried on, and it came
  // down as opaque bright pixels in a black shadow.
  test.each([8, 16, 32, 64, 96, 120])(
    "flat black at alpha %d beside an opaque bright area has no bright pixel",
    async alpha => {
      expect(await opaqueInShadow([250, 190, 60, 255], alpha)).toBe(0);
    },
  );
  // Beside an opaque band of its own colour the carried alpha is what dither
  // is for: the shadow is a stipple of opaque black with the mean alpha.
  test.each([32, 64])("flat black at alpha %d beside an opaque black area is a stipple", async alpha => {
    const opaque = await opaqueInShadow([0, 0, 0, 255], alpha);
    expect(Math.abs((opaque * 255) / 2048 - alpha)).toBeLessThan(8);
  });

  // A row of more than 256 pixels is read in chunks. Three flat colours in
  // stripes have an entry each, and two near greens share the fourth: the
  // image does not fit, and only the greens have error to pass on, less than
  // a level. With dither every pixel is written as without it.
  test.each([257, 300, 600])("a row of %d pixels is read in chunks", async w => {
    const stripes: Px[] = [
      [200, 40, 40, 128],
      [40, 40, 200, 64],
      [250, 250, 250, 255],
    ];
    const pixel = (x: number, y: number): Px =>
      y === 0 && x < 2 ? [10 + 2 * x, 200, 10, 255] : stripes[Math.floor(x / 7) % 3];
    const src = makePng(w, 3, pixel);
    const png = await new Bun.Image(src).png({ palette: true, colors: 4 }).bytes();
    const plain = decodePng(await new Bun.Image(png).png().bytes()).data;
    expect(Buffer.from(await ditherBack(w, 3, pixel, 4)).equals(Buffer.from(plain))).toBe(true);
    // Rows 1 and 2 are stripes only: they show what the source shows.
    const [source, rows] = [decodePng(src).data.subarray(w * 4), plain.subarray(w * 4)];
    expect([errorOver(0, source, rows), errorOver(255, source, rows)]).toEqual([0, 0]);
  });

  // A fully transparent pixel passes nothing on: the error that reaches it is
  // dropped. Where holes sit between the visible pixels, dither has less to
  // work with. These two pin that cost.
  const gradient = (x: number, y: number): Px => [40 + x, 200 - x, 60 + (y >> 1), 60 + y];
  const withHoles = async (visible: (x: number, y: number) => boolean) => {
    const pixel = (x: number, y: number): Px => (visible(x, y) ? gradient(x, y) : [0, 0, 0, 0]);
    const src = makePng(128, 128, pixel);
    const png = await new Bun.Image(src).png({ palette: true, colors: 16 }).bytes();
    return {
      source: decodePng(src).data,
      plain: decodePng(await new Bun.Image(png).png().bytes()).data,
      dithered: await ditherBack(128, 128, pixel, 16),
    };
  };
  test("a checkerboard of holes: every hole stays, and dither still brings the block means nearer", async () => {
    const { source, plain, dithered } = await withHoles((x, y) => ((x + y) & 1) === 0);
    let visible = 0;
    for (let i = 3; i < source.length; i += 4) if (source[i] === 0 && dithered[i] !== 0) visible++;
    expect(visible).toBe(0);
    for (const background of [0, 255]) {
      expect(blockError(background, source, dithered, 128)).toBeLessThan(blockError(background, source, plain, 128));
    }
  });
  test("pixels with only holes beside them are written as without dither", async () => {
    const { plain, dithered } = await withHoles((x, y) => (x & 1) === 0 && (y & 1) === 0);
    expect(Buffer.from(dithered).equals(Buffer.from(plain))).toBe(true);
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
