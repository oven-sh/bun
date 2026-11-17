// Writes ICC profiles. https://www.color.org/specification/ICC.1-2022-05.pdf
import { deflateSync } from "node:zlib";
import { chunk, iccp, iend, ihdr, png, RGBA } from "./png-golden/write";

type Color = number[];
type Mapping = (rgb: Color) => Color;

const u16 = (...values: number[]) => Buffer.from(values.flatMap(it => [it >> 8, it & 255]));
const u32 = (...values: number[]) => Buffer.from(values.flatMap(it => [it >> 24, it >> 16, it >> 8, it]));
const fixed = (...values: number[]) => u32(...values.map(it => Math.round(it * 65536)));
const padded = (bytes: Buffer) => Buffer.concat([bytes, Buffer.alloc(-bytes.length & 3)]);
const tag = (type: string, ...parts: Buffer[]) => padded(Buffer.concat([Buffer.from(type + "\0\0\0\0"), ...parts]));
/** Of numbers from 0 to 1, in 1 or 2 bytes each. */
function samples(size: number, values: number[]) {
  const scaled = values.map(it => Math.round(Math.min(1, Math.max(0, it)) * (256 ** size - 1)));
  return size === 1 ? Buffer.from(scaled) : u16(...scaled);
}
const steps = (count: number) => Array.from({ length: count }, (_, i) => i / (count - 1));
const grid = ([r, g, b]: number[], size: number, mapping: Mapping) =>
  samples(
    size,
    steps(r).flatMap(r => steps(g).flatMap(g => steps(b).flatMap(b => mapping([r, g, b])))),
  );

export const xyz = (color: Color) => tag("XYZ ", fixed(...color));
export const para = (type: number, ...parameters: number[]) => tag("para", u16(type, 0), fixed(...parameters));
export const curv = (...values: number[]) => tag("curv", u32(values.length), u16(...values));
export const three = <T>(it: T) => [it, it, it];

export function mft(size: 1 | 2, points: number, mapping: Mapping, input = (x: number) => x, length = 256) {
  return tag(
    `mft${size}`,
    Buffer.of(3, 3, points, 0),
    fixed(1, 0, 0, 0, 1, 0, 0, 0, 1),
    size === 2 ? u16(length, 2) : Buffer.alloc(0),
    ...three(samples(size, steps(length).map(input))),
    grid(three(points), size, mapping),
    ...three(samples(size, steps(size === 2 ? 2 : 256))),
  );
}

export function mAB(stages: {
  a?: Buffer[];
  clut?: [points: number[], size: number, mapping: Mapping];
  m?: Buffer[];
  matrix?: number[];
  b: Buffer[];
}) {
  const { a, clut, m, matrix, b } = stages;
  const parts = [
    Buffer.concat(b),
    matrix && fixed(...matrix),
    m && Buffer.concat(m),
    clut && padded(Buffer.concat([Buffer.of(...clut[0], ...Array(13).fill(0), clut[1], 0, 0, 0), grid(...clut)])),
    a && Buffer.concat(a),
  ];
  let next = 32;
  const offsets = parts.map(part => (part ? (next += part.length) - part.length : 0));
  return tag("mAB ", Buffer.of(3, 3, 0, 0), u32(...offsets), ...parts.filter(part => part !== undefined));
}

export const D50 = [0.9642, 1, 0.8249];

export function profile(tags: Record<string, Buffer>, { space = "RGB ", connection = "XYZ ", version = 4 } = {}) {
  const entries = Object.entries({ wtpt: xyz(D50), ...tags });
  const header = Buffer.alloc(128);
  header[8] = version;
  header.write("scnr" + space + connection, 12);
  header.write("acsp", 36);
  header.set(fixed(...D50), 68);
  let next = 132 + 12 * entries.length;
  const table = entries.flatMap(([name, { length }]) => [Buffer.from(name), u32((next += length) - length, length)]);
  header.writeUInt32BE(next);
  return Buffer.concat([header, u32(entries.length), ...table, ...entries.map(([, data]) => data)]);
}

export const rgbProfile = ([r, g, b]: Color[], [rTRC, gTRC, bTRC]: Buffer[]) =>
  profile({ rXYZ: xyz(r), gXYZ: xyz(g), bXYZ: xyz(b), rTRC, gTRC, bTRC });

/** As in "sRGB IEC61966-2.1" of Hewlett-Packard. */
export const SRGB = [
  [0.436066, 0.222488, 0.013916],
  [0.385147, 0.716873, 0.097076],
  [0.143066, 0.060608, 0.714096],
];
/** As in "Display P3" of Apple. */
export const P3 = [
  [0.515121, 0.241196, -0.001053],
  [0.291977, 0.692245, 0.041885],
  [0.157104, 0.066574, 0.784073],
];
export const srgbCurve = para(3, 2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045);
export const srgbToLight = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
export const sampledCurve = (count: number, curve: (x: number) => number) =>
  curv(...steps(count).map(x => Math.round(curve(x) * 65535)));

export const mix = (colorants: Color[], light: Color) =>
  [0, 1, 2].map(i => colorants[0][i] * light[0] + colorants[1][i] * light[1] + colorants[2][i] * light[2]);
export const encodedXyz = (color: Color) => color.map(it => (it * 32768) / 65535);
export function encodedLab(color: Color) {
  const [x, y, z] = color
    .map((it, i) => it / D50[i])
    .map(t => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t * (841 / 108) + 4 / 29));
  return [(116 * y - 16) / 100, (500 * (x - y) + 128) / 255, (200 * (y - z) + 128) / 255];
}
/** For `mAB()`: the rows, then the offsets. */
export const matrixOf = (colorants: Color[], offsets = [0, 0, 0]) => [
  ...[0, 1, 2].flatMap(row => encodedXyz(colorants.map(it => it[row]))),
  ...offsets,
];

/** One row. */
export const pngWithProfile = (rgba: number[], icc: Uint8Array) =>
  png(ihdr(rgba.length / 4, 1, 8, RGBA), iccp("icc", icc), chunk("IDAT", deflateSync(Buffer.of(0, ...rgba))), iend);
