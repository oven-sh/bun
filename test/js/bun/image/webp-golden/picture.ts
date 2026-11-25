// Makes up pictures to encode. The recorded results depend on every detail of this.
import { createCipheriv } from "node:crypto";

let state = 1;
const startWith = (seed: number) => (state = Math.imul(seed + 1, 0x9e3779b1) | 1);
function next() {
  state ^= state << 13;
  state ^= state >>> 17;
  return (state ^= state << 5);
}
/** 0 up to `n`, not including it. */
const below = (n: number) => (next() >>> 0) % n;
const pick = <T>(...choices: T[]) => choices[below(choices.length)];

/** Rectangles of what encoders treat differently, on top of each other. */
export function layers(seed: number) {
  startWith(seed);
  const rgba = (r: number, g: number, b: number, a: number) =>
    (r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24);
  const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);
  /** Adds to red, green and blue. */
  const add = (p: number, r: number, g: number, b: number) =>
    rgba(clamp((p & 255) + r), clamp(((p >> 8) & 255) + g), clamp(((p >> 16) & 255) + b), p >>> 24);
  const withAlpha = (p: number, a: number) => (p & 0xffffff) | ((a & 255) << 24);

  const [maxWidth, maxHeight] = pick([9, 9], [40, 40], [40, 40], [100, 100], [260, 200], [5000, 5], [5, 3000]);
  const [width, height] = [1 + below(maxWidth), 1 + below(maxHeight)];
  const colors = pick(1, 2, 3, 4, 5, 9, 16, 17, 18, 40, 100, 255, 256, 257, 600);
  const color = pick<(r: number, g: number, b: number, a: number, ramp: number) => number>(
    (r, g, b) => rgba(r, g, b, 255),
    (r, g, b, a) => rgba(r, g, b, a),
    (_r, _g, _b, _a, ramp) => rgba(ramp, ramp, ramp, 255),
    (_r, _g, _b, _a, ramp) => rgba(0, 0, 0, ramp),
    (_r, _g, _b, _a, ramp) => rgba(ramp, ramp * 2, 255 - ramp, 255),
    (r, g, b) => rgba(r & 128 ? 255 : 0, g & 128 ? 255 : 0, b & 128 ? 255 : 0, 255),
  );
  const palette = new Uint32Array(colors);
  for (let i = 0; i < colors; i++) {
    palette[i] = color(below(256), below(256), below(256), below(256), ((i * 255) / colors) | 0);
  }
  if (below(4) === 0) palette[0] = 0;
  const pixels = new Uint32Array(width * height).fill(palette[0]);

  for (let layers = 1 + below(6); layers > 0; layers--) {
    const whole = below(2);
    const [left, top] = whole ? [0, 0] : [below(width), below(height)];
    const [right, bottom] = whole ? [width, height] : [left + 1 + below(width - left), top + 1 + below(height - top)];
    const [c, d, e] = [below(256), below(256), below(256)];
    const size = pick(1, 2, 3, 4, 8, 16, 1 + (c % 40));
    const cell = (x: number, y: number) => palette[(Math.imul(x * 7919 + y * 104729 + d, 0x9e3779b1) >>> 8) % colors];
    const distance = pick(1 + (c % 8) + width * (d % 9), 1 + ((c * 256 + d) % pixels.length));
    const amplitude = pick(2, 3, 6, 20, 60, 256);
    const wobble = () => below(amplitude) - (amplitude >> 1);
    let [run, last] = [0, 0];
    const paint = pick<Paint>(
      () => palette[c % colors],
      () => palette[below(colors)],
      // Some colors far more often than others.
      () => palette[Math.clz32(next()) % colors],
      // Blocks, stripes, slopes, and a smooth landscape.
      (x, y) => cell((x / size) | 0, (y / size) | 0),
      (x, y) => palette[(((x * (c % 8) + y * (d % 8)) / (1 + (e % 8))) | 0) % colors],
      (x, y, old) => rgba((x * (c % 9)) / 2 + y, (y * (d % 9)) / 2 + x / 2, ((x + y) * (e % 9)) / 3, old >>> 24),
      (x, y, old) => {
        const [cx, cy, fx, fy] = [(x / size) | 0, (y / size) | 0, x % size, y % size];
        const [p, q, r, s] = [cell(cx, cy), cell(cx + 1, cy), cell(cx, cy + 1), cell(cx + 1, cy + 1)];
        const between = (shift: number) =>
          ((((p >> shift) & 255) * (size - fx) + ((q >> shift) & 255) * fx) * (size - fy) +
            (((r >> shift) & 255) * (size - fx) + ((s >> shift) & 255) * fx) * fy) /
          (size * size);
        return rgba(between(0), between(8), between(16), old >>> 24);
      },
      // Noise: in each channel by itself, and with red and blue following green.
      (_x, _y, old) => add(old, wobble(), wobble(), wobble()),
      (_x, _y, old) => {
        const green = wobble();
        return add(old, (green * (d - 128)) >> 5, green, (green * (e - 128)) >> 5);
      },
      (x, y, old, at) =>
        x && y ? add(withAlpha(pixels[at - pick(1, width, width + 1)], old >>> 24), wobble() >> 2, 0, 0) : old,
      (_x, _y, old) => (below(4096) < c ? palette[below(colors)] : old),
      // What was there before, and runs.
      (_x, _y, old, at) => (at >= distance ? pixels[at - distance] : old),
      () => (run-- > 0 ? last : ((run = below(1 + size * c)), (last = palette[below(colors)]))),
      (_x, _y, old, at) => {
        if (run-- <= 0) [run, last] = [below(size * 3), 1 + below(at + 1)];
        return at >= last && last % 4 ? pixels[at - last] : palette[below(colors)];
      },
      // Alpha.
      (_x, _y, old) => withAlpha(old, pick(0, c)),
      (_x, _y, old) => withAlpha(old, c & 1 ? 0 : d),
      (x, y, old) => withAlpha(old, x * (c % 9) + y * (d % 9) + e),
      (_x, _y, old) => withAlpha(old, clamp(d + wobble())),
      (x, y, old) => withAlpha(old, cell((x / size) | 0, (y / size) | 0) & 128 ? 0 : 255),
      (x, y, old) => withAlpha(old, clamp((c * 40 - (x - d) ** 2 - (y - e) ** 2) / size)),
      (_x, _y, old) => withAlpha(old, old >> 8),
    );
    for (let y = top; y < bottom; y++) paintRow(paint, pixels, y, y * width, left, right);
  }
  return { width, height, rgba: new Uint8Array(pixels.buffer) };
}

/** Noise, runs and repetitions, one after the other. Larger, and often one tile of the lossless format wide. */
export function sequence(seed: number) {
  startWith(seed);
  const near = (n: number) => n - 4 + below(8);
  const side = pick(8, 8, 32);
  const columns = pick(1, 1, 2, 3, 5, 23, 40, 130);
  const tiles = pick(30, 130, 256, 512, 1024, 2600) + pick(-1, 0, 1, below(300));
  const [width, height] = [columns * side, Math.min(Math.ceil(tiles / columns) * side, 16383)];
  const colors = pick(2, 3, 16, 17, 20, 200, 256, 300, 5000);
  const [random, set] = pick(
    [0xffffff, 255 << 24],
    [0x0f0f0f, 255 << 24],
    [0xff00, 255 << 24],
    [255 << 24, 0],
    [-1, 0],
  );
  const palette = Uint32Array.from({ length: colors }, () => (next() & random) | set);
  const [noise, runs, copies] = [1 + below(8), below(4), below(6)];
  const [families, colorsInFamily] = [pick(1, 3, 20, 150, 3000), pick(2, 3, 5, 17, 40, 300)];
  const longest = pick(20, 300, 5000, 70000);
  const pixels = new Uint32Array(width * height);

  for (let at = 0; at < pixels.length;) {
    const kind = below(noise + runs + copies);
    const length = pick(near(8), near(256), near(4096), below(longest), width * side - (at % (width * side)));
    const end = Math.min(at + 1 + length, pixels.length);
    if (kind < noise) {
      fillFrom(palette, below(families), colorsInFamily, pixels, at, end);
    } else if (kind < noise + runs) {
      pixels.fill(palette[below(3) % colors], at, end);
    } else {
      const far = pick(8, width, 16 * width, 64 * width, 256 * width, 2 ** 20 - 120, 5000);
      repeat(pixels, Math.max(1, Math.min(at, pick(near(far), below(far)))), at, end);
    }
    at = end;
  }
  const rgba = new Uint8Array(pixels.buffer);
  // So that all this is what a predictor leaves.
  const before = pick(0, 0, 4, width * 4);
  if (before) addUp(rgba, before);
  return { width, height, rgba };
}

// The loops are functions of their own, so that a debug build, which takes long to compile them, does so only once.
type Paint = (x: number, y: number, old: number, at: number) => number;
function paintRow(paint: Paint, pixels: Uint32Array, y: number, start: number, left: number, right: number) {
  for (let x = left; x < right; x++) pixels[start + x] = paint(x, y, pixels[start + x], start + x);
}
function fillFrom(palette: Uint32Array, family: number, colors: number, to: Uint32Array, at: number, end: number) {
  for (; at < end; at++) {
    const n = below(colors);
    to[at] = palette[(family * 7919 + (1 + (family % 5)) * (family % 3 ? n : below(n + 1))) % palette.length];
  }
}
function repeat(pixels: Uint32Array, distance: number, at: number, end: number) {
  for (; at < end; at++) pixels[at] = pixels[at - distance];
}
function addUp(rgba: Uint8Array, before: number) {
  for (let at = before; at < rgba.length; at++) if (at % 4 < 3) rgba[at] += rgba[at - before];
}

/** Of each pixel, taken as the number 0xAABBGGRR, the bits of `random` are random and those of `set` are set. */
export function noise(width: number, height: number, random: number, set: number) {
  const zeros = Buffer.alloc(16);
  const rgba = new Uint8Array(createCipheriv("aes-128-ctr", zeros, zeros).update(Buffer.alloc(width * height * 4)));
  const pixels = new Uint32Array(rgba.buffer);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (pixels[i] & random) | set;
  return { width, height, rgba };
}
