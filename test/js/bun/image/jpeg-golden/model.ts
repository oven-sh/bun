// From coefficients to pixels and back, the slow way. It shares no code with Bun.
// T.81 leaves rounding open. This rounds like libjpeg-turbo.
import { copyOf, frameOf, int16, isLossless, largest, type Component, type Frame, type Scan } from "./write";

/** For each coefficient in zigzag order, `8 * row + column`. */
export const natural = Array.from({ length: 64 }, (_, at) => at).sort((a, b) => {
  const [diagonal, other] = [(a >> 3) + (a & 7), (b >> 3) + (b & 7)];
  return diagonal - other || (diagonal & 1 ? a - b : b - a);
});

/** By block size: how each factor differs from the rounded cosine. A word for each sample of the first half. */
const rounding: Record<number, string> = {
  2: "........",
  3: "... ..-",
  4: "........ ........",
  5: ".+-.. ....+ ..+.-",
  6: "...... ....-. ......",
  7: "....... ....... ....... .......",
  8: ".....+.. ...+.+-. .+.+.++. ........",
  10: "..+-.... .......+ ....-... ...+.... ..-....+",
  12: ".+...+.. ........ .+...+.. ........ ...-.+.. .+......",
  14: ".+...... ......+. .....+.. ....-... ........ ...+..-. ........",
};
const sizesWithFactors = Object.keys(rounding).map(Number);
export const sizes = [1, ...sizesWithFactors];

/** For each of `size` samples, the factors of 8 coefficients. */
function factorsOf(size: number) {
  // Sizes 2 and 4 average groups of the 8 samples. The others sample the cosines at other points.
  const group = size === 2 || size === 4 ? 8 / size : 1;
  const factors = new Int32Array(size * 8);
  for (const [i, word] of rounding[size].split(" ").entries()) {
    for (const [k, sign] of [...word].entries()) {
      let sum = 0;
      for (let j = i * group; j < (i + 1) * group; j++)
        sum += Math.cos(((2 * j + 1) * k * Math.PI) / (2 * size * group));
      const factor = Math.round(sum * 8192 * (k ? Math.SQRT2 : 1)) + "-.+".indexOf(sign) - 1;
      factors[(size - 1 - i) * 8 + k] = k & 1 ? -factor : factor;
      factors[i * 8 + k] = factor;
    }
  }
  return { factors, shift: 13 + Math.log2(group) };
}
export const transforms = Object.fromEntries(sizesWithFactors.map(size => [size, factorsOf(size)]));

const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);

type Plane = { samples: Uint8Array; stride: number };

const [block, half] = [new Int32Array(64), new Int32Array(14 * 8)];

/**
 * `size` by `size` samples of `block`. Columns first, with two extra bits, then rows. Sums wrap at 32 bits. Between the
 * passes they saturate at 16, including the bias that rounds the second pass and adds 128.
 */
function inverseOfBlock(size: number, samples: Uint8Array, to: number, stride: number) {
  const { factors, shift } = transforms[size];
  for (let at = 0; at < size * 8; at++) {
    let sum = (1 << (shift - 3)) + (at & 7 ? 0 : (128 * 32 + 16) << (shift - 2));
    for (let k = 0; k < 8; k++) sum += factors[(at & ~7) + k] * block[k * 8 + (at & 7)];
    half[at] = Math.min(Math.max(sum >> (shift - 2), -32768), 32767);
  }
  for (let row = 0; row < size; row++, to += stride) {
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let k = 0; k < 8; k++) sum += factors[i * 8 + k] * half[row * 8 + k];
      samples[to + i] = clamp(sum >> (shift + 5));
    }
  }
}

function inverse({ data, wide, high, across }: Component, steps: number[], size: number): Plane {
  const stride = wide * size;
  const samples = new Uint8Array(stride * high * size);
  for (let y = 0; y < high; y++) {
    for (let x = 0; x < wide; x++) {
      const at = (y * across + x) * 64;
      if (size === 1) {
        samples[y * stride + x] = clamp(128 + ((data[at] * int16(steps[0]) + 4) >> 3));
        continue;
      }
      for (let k = 0; k < 64; k++) block[natural[k]] = int16(data[at + k] * steps[k]);
      inverseOfBlock(size, samples, (y * stride + x) * size, stride);
    }
  }
  return { samples, stride };
}

export const scaled = (length: number, eighths: number) => Math.ceil((length * eighths) / 8);

/** A subsampled component gets a larger IDCT instead of upsampling where it can. */
export function blockSize(frame: Frame, { h, v }: Component, eighths: number) {
  const [maxH, maxV] = largest(frame);
  let size = eighths;
  while (size < 8 && (maxH * eighths) % (h * size * 2) === 0 && (maxV * eighths) % (v * size * 2) === 0) size *= 2;
  return size;
}

/** A sample for every pixel. */
function planeOf(frame: Frame, component: Component, eighths: number, width: number, height: number): Plane {
  if (isLossless(frame)) eighths = 1;
  const [maxH, maxV] = largest(frame);
  const size = isLossless(frame) ? 1 : blockSize(frame, component, eighths);
  const { samples, stride } = isLossless(frame)
    ? { samples: Uint8Array.from(component.data), stride: component.across }
    : inverse(component, frame.tables[component.table], size);
  const [byX, byY] = [(maxH * eighths) / (component.h * size), (maxV * eighths) / (component.v * size)];
  if (byX === 1 && byY === 1) return { samples, stride };
  const [columns, rows] = [Math.ceil(width / byX), Math.ceil(height / byY)];
  // 3/4 of the nearest sample and 1/4 of the next nearest. The edges repeat.
  const blends = eighths > 1 && byX <= 2 && byY <= 2 && (byX === 1 || columns > 2);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / byY);
    const near = row * stride;
    const far = Math.min(Math.max(row + (y & 1 ? 1 : -1), 0), rows - 1) * stride;
    for (let x = 0; x < width; x++) {
      const column = Math.floor(x / byX);
      const next = Math.min(Math.max(column + (x & 1 ? 1 : -1), 0), columns - 1);
      let sample = samples[near + column];
      if (blends && byX === 1) sample = (3 * sample + samples[far + x] + 1 + (y & 1)) >> 2;
      else if (blends && byY === 1) sample = (3 * sample + samples[near + next] + 1 + (x & 1)) >> 2;
      else if (blends) {
        const beside = 3 * samples[near + next] + samples[far + next];
        sample = (3 * (3 * sample + samples[far + column]) + beside + 8 - (x & 1)) >> 4;
      }
      out[y * width + x] = sample;
    }
  }
  return { samples: out, stride: width };
}

const fixed = (value: number) => Math.round(value * 65536);
const [crToR, cbToG, crToG, cbToB] = [1.402, 0.34414, 0.71414, 1.772].map(fixed);

export type Colors = "gray" | "YCbCr" | "RGB" | "CMYK" | "YCCK";
const usually = (frame: Frame) =>
  (["gray", , isLossless(frame) ? "RGB" : "YCbCr", "CMYK"] as const)[frame.components.length - 1]!;

export function pictureOf(frame: Frame, { eighths = 8, colors = usually(frame) as Colors } = {}) {
  const [width, height] = [scaled(frame.width, eighths), scaled(frame.height, eighths)];
  const planes = frame.components.map(component => planeOf(frame, component, eighths, width, height));
  const [first, second = first, third = first, fourth] = planes;
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let y = 0, to = 0; y < height; y++) {
    for (let x = 0; x < width; x++, to += 4) {
      let r = first.samples[y * first.stride + x];
      let g = second.samples[y * second.stride + x];
      let b = third.samples[y * third.stride + x];
      if (colors === "YCbCr" || colors === "YCCK") {
        const luma = r;
        const cb = g - 128;
        const cr = b - 128;
        r = clamp(luma + ((crToR * cr + 32768) >> 16));
        g = clamp(luma + ((-cbToG * cb - crToG * cr + 32768) >> 16));
        b = clamp(luma + ((cbToB * cb + 32768) >> 16));
      }
      if (fourth) {
        // Inverted, as Adobe writes it: 255 is no ink.
        const k = fourth.samples[y * fourth.stride + x];
        const turn = colors === "YCCK" ? 255 : 0;
        r = Math.round(((r ^ turn) * k) / 255);
        g = Math.round(((g ^ turn) * k) / 255);
        b = Math.round(((b ^ turn) * k) / 255);
      }
      rgba[to] = r;
      rgba[to + 1] = g;
      rgba[to + 2] = b;
    }
  }
  return { width, height, rgba };
}

/** For each component and coefficient: the Al of its last scan, or -1 if it has none. */
export function missingBits(frame: Frame, scans: Scan[]) {
  const bits = frame.components.map(() => Array(64).fill(-1));
  for (const { components, ss, se, al } of scans) for (const c of components) bits[c].fill(al, ss, se + 1);
  return bits;
}

/** The coefficients as far as these progressive scans have them. */
export function known(frame: Frame, scans: Scan[]) {
  const out = copyOf(frame);
  for (const [c, bits] of missingBits(frame, scans).entries()) {
    const { data } = out.components[c];
    for (let i = 0; i < data.length; i++) {
      const missing = bits[i % 64];
      if (missing < 0) data[i] = 0;
      else if (i % 64 === 0) data[i] = (data[i] >> missing) << missing;
      else data[i] = Math.sign(data[i]) * ((Math.abs(data[i]) >> missing) << missing);
    }
  }
  return out;
}

const weights = (text: string) => text.trim().split(/\s+/).map(Number);
const turned = (of: number[]) => of.map((_, i) => of[(i % 5) * 5 + Math.floor(i / 5)]);
/** Weights of the DC coefficients of 5 by 5 blocks, in 256ths. `ac21` is for row 2, column 1. */
const [dc, ac01, ac02, ac03, ac11, ac21] = [
  "-2 -6 -8 -6 -2   -6  6  42   6 -6   -8 42 152  42 -8   -6  6  42   6 -6   -2 -6 -8 -6 -2",
  "-1 -1  0  1  1   -3 13   0 -13  3   -3 38   0 -38  3   -3 13   0 -13  3   -1 -1  0  1  1",
  " 0  0  0  0  0    0  2  -5   2  0    1  7 -14   7  1    0  2  -5   2  0    0  0  0  0  0",
  " 0  0  0  0  0    0  1   0  -1  0    0  2   0  -2  0    0  1   0  -1  0    0  0  0  0  0",
  "-1  0  0  0  1    0  9   0  -9  0    0  0   0   0  0    0 -9   0   9  0    1  0  0  0 -1",
  " 0  0  0  0  0    0  1   0  -1  0    0 -3   0   3  0    0  1   0  -1  0    0  0  0  0  0",
].map(weights);
const withoutAc = [dc, ac01, turned(ac01), turned(ac02), ac11, ac02, ac03, turned(ac21), ac21, turned(ac03)];
const [some01, some02, some11] = [
  " 0  0  0  0  0    0  0   0   0  0   -7 50   0 -50  7    0   0  0   0  0    0  0  0  0  0",
  " 0  0  0  0  0    0  0   0   0  0   -1 13 -24  13 -1    0   0  0   0  0    0  0  0  0  0",
  " 0 -1  0  1  0   -1 10   0 -10  1    0  0   0   0  0    1 -10  0  10 -1    0  1  0 -1  0",
].map(weights);
const withSomeAc = [, some01, turned(some01), turned(some02), some11, some02];

/**
 * Block smoothing, K.8 as libjpeg-turbo extends it: low coefficients that are zero and inexact are estimated from the
 * neighboring DC coefficients. `missing` is the `missingBits()` of a component for a row of MCUs.
 */
export function smoothed(frame: Frame, missing: (component: number, row: number) => number[]) {
  const out = copyOf(frame);
  for (const [c, { data, wide, high, across, down, v, table }] of frame.components.entries()) {
    const steps = frame.tables[table];
    for (let y = 0; y < high; y++) {
      const row = Math.floor(y / v);
      const bits = missing(c, row);
      const all = bits.slice(1, 10).every(bit => bit === -1) ? withoutAc : withSomeAc;
      // It takes all rows of MCUs to have as many rows of blocks as this one.
      const here = Math.min(v, high - row * v);
      const [above, below] = [row * here + (y % v), (down / v - row) * here - (y % v) - 1];
      for (let x = 0; x < wide; x++) {
        const around = Array.from({ length: 25 }, (_, i) => {
          const atY = y + Math.min(Math.max(Math.floor(i / 5) - 2, -above), below);
          const atX = Math.min(Math.max(x + (i % 5) - 2, 0), wide - 1);
          return data[(atY * across + atX) * 64];
        });
        const at = (y * across + x) * 64;
        for (const [k, weights] of all.entries()) {
          if (!weights || (k && (bits[k] === 0 || data[at + k] !== 0))) continue;
          const sum = steps[0] * weights.reduce((sum, weight, i) => sum + weight * around[i], 0);
          let guess = Math.floor((steps[k] * 128 + Math.abs(sum)) / (steps[k] * 256));
          if (k && bits[k] > 0) guess = Math.min(guess, (1 << bits[k]) - 1);
          out.components[c].data[at + k] = sum < 0 ? -guess : guess;
        }
      }
    }
  }
  return out;
}

/** Tables K.1 and K.2, row by row. */
const typicalSteps = [
  `16 11 10 16 24 40 51 61   12 12 14 19 26 58 60 55   14 13 16 24 40 57 69 56       14 17 22 29 51 87 80 62
   18 22 37 56 68 109 103 77   24 35 55 64 81 104 113 92   49 64 78 87 103 121 120 101   72 92 95 98 112 100 103 99`,
  `17 18 24 47 99 99 99 99   18 21 26 66 99 99 99 99   24 26 56 99 99 99 99 99       47 66 99 99 99 99 99 99
   99 99 99 99 99 99 99 99     99 99 99 99 99 99 99 99     99 99 99 99 99 99 99 99       99 99 99 99 99 99 99 99`,
].map(weights);

export function tablesFor(quality: number) {
  const percent = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2;
  return typicalSteps.map(steps =>
    natural.map(at => Math.min(Math.max(Math.floor((steps[at] * percent + 50) / 100), 1), 255)),
  );
}

/** The weights of R, G and B, and the bias. */
export const toYCbCr = [
  [0.299, 0.587, 0.114, 0.5],
  [-0.16874, -0.33126, 0.5, 128.5 - 1 / 65536],
  [0.5, -0.41869, -0.08131, 128.5 - 1 / 65536],
].map(row => row.map(fixed));

type Pixels = ReturnType<typeof pictureOf>;

/** The samples of a component, for whole blocks. */
function samplesOf({ width, height, rgba }: Pixels, c: number, { wide, high }: Component) {
  const [ofR, ofG, ofB, plus] = toYCbCr[c];
  const full = new Uint8Array(width * height);
  for (let i = 0, at = 0; i < full.length; i++, at += 4) {
    full[i] = (ofR * rgba[at] + ofG * rgba[at + 1] + ofB * rgba[at + 2] + plus) >> 16;
  }
  // The last column repeats before downsampling. The last row repeats to complete a pair, then after downsampling.
  const by = c ? 2 : 1;
  const samples = new Uint8Array(wide * high * 64);
  for (let y = 0, to = 0; y < high * 8; y++) {
    const row = Math.min(y, Math.ceil(height / by) - 1) * by;
    const upper = row * width;
    const lower = Math.min(row + by - 1, height - 1) * width;
    for (let x = 0; x < wide * 8; x++) {
      const left = Math.min(x * by, width - 1);
      const right = Math.min(x * by + by - 1, width - 1);
      const sum = full[upper + left] + full[upper + right] + full[lower + left] + full[lower + right];
      samples[to++] = (sum + 1 + (x & 1)) >> 2;
    }
  }
  return samples;
}

/** Rows first. */
function forward(samples: Uint8Array, from: number, stride: number, steps: number[], data: Int32Array, to: number) {
  const { factors } = transforms[8];
  for (let at = 0; at < 64; at++) {
    let sum = 1 << 10;
    for (let i = 0; i < 8; i++) sum += factors[i * 8 + (at & 7)] * (samples[from + (at >> 3) * stride + i] - 128);
    half[at] = sum >> 11;
  }
  for (let k = 0; k < 64; k++) {
    const at = natural[k];
    let sum = 1 << 14;
    for (let i = 0; i < 8; i++) sum += factors[i * 8 + (at >> 3)] * half[i * 8 + (at & 7)];
    const quotient = Math.floor((Math.abs(sum >> 15) + steps[k] * 4) / (steps[k] * 8));
    data[to + k] = sum < 0 ? -quotient : quotient;
  }
}

/** What Bun.Image encodes: YCbCr 4:2:0. */
export function coefficientsOf(picture: Pixels, quality: number) {
  const frame = frameOf(picture.width, picture.height, "2x2,1x1,1x1", { tables: tablesFor(quality) });
  for (const [c, component] of frame.components.entries()) {
    const { data, wide, high, across, down, h, table } = component;
    const samples = samplesOf(picture, c, component);
    for (let y = 0, to = 0; y < down; y++) {
      for (let x = 0; x < across; x++, to += 64) {
        // A padding block repeats the DC coefficient of the block before it.
        if (y >= high) data[to] = data[((y - 1) * across + x - (x % h) + h - 1) * 64];
        else if (x >= wide) data[to] = data[to - 64];
        else forward(samples, (y * wide * 8 + x) * 8, wide * 8, frame.tables[table], data, to);
      }
    }
  }
  return frame;
}
