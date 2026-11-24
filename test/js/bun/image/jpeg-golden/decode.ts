// Decodes with Bun.Image, and compares the results.
import { expect } from "bun:test";
import { deflateSync } from "node:zlib";
import { parse, slow } from "../png-golden/check";
import { chunk, iend, ihdr, png, RGBA } from "../png-golden/write";
import { pictureOf, scaled, type Colors } from "./model";
import { adobe, EOI, frameOf, marker, tableOf } from "./write";

export type Picture = ReturnType<typeof pictureOf>;

export async function pictureFrom(image: Bun.Image) {
  const { width, height, lines, profile } = parse(await image.png({ compressionLevel: 0 }).bytes());
  const rgba = Buffer.allocUnsafe(width * height * 4);
  for (let y = 0; y < height; y++)
    rgba.set(lines.subarray(y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4)), y * width * 4);
  return { width, height, rgba, profile: profile ? Buffer.from(profile).toString("latin1") : null };
}

/** At `eighths` / 8 of its size. The decoder scales to that itself, so nothing is left to resize. */
export async function decode(file: Uint8Array, eighths = 8) {
  const image = new Bun.Image(file);
  if (eighths === 8) return pictureFrom(image);
  const { width, height } = await image.metadata();
  return pictureFrom(image.resize(scaled(width, eighths), scaled(height, eighths), { fit: "fill" }));
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    error => (error.code === "ERR_IMAGE_DECODE_FAILED" ? "refused" : (error.code ?? String(error))),
  );
/** The result of `metadata()`, then that of decoding. */
export const outcome = async (file: Uint8Array, options?: { maxPixels?: number }) =>
  `${await codeOf(new Bun.Image(file, options).metadata())}, ${await codeOf(new Bun.Image(file, options).png().bytes())}`;
export const [fine, refused, headerOnly] = ["ok, ok", "refused, refused", "ok, refused"];

/** The first difference, if there is one. */
export function difference(actual: Picture, expected: Picture) {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return `${actual.width} by ${actual.height}, not ${expected.width} by ${expected.height}`;
  }
  if (actual.rgba.equals(expected.rgba)) return;
  const at = actual.rgba.findIndex((byte, i) => byte !== expected.rgba[i]) >> 2;
  const [is, should] = [actual, expected].map(({ rgba }) => rgba.toString("hex", at * 4, at * 4 + 4));
  return `${is} at ${at % actual.width}, ${Math.floor(at / actual.width)}, not ${should}`;
}

export type Case = { name: string; file: Uint8Array; expected: Picture; eighths?: number };

export async function expectPictures(cases: Case[]) {
  expect(cases.length).toBeGreaterThan(0);
  const wrong = await Promise.all(
    cases.map(async ({ name, file, expected, eighths }) => {
      const what = await decode(file, eighths).then(
        actual => difference(actual, expected),
        error => error.code ?? String(error),
      );
      return what ? [`${name}: ${what}`] : [];
    }),
  );
  expect(wrong.flat()).toEqual([]);
}

/** With this many bytes left, the decoder of sequential scans looks up two codes at a time. */
export const trailerLength = 2048;
/** Appends EOI markers, which change nothing else: a decoder acts as if they followed any file. */
export const withTrailer = (file: Uint8Array) => Buffer.concat([file, Buffer.alloc(trailerLength, marker(EOI))]);

export const alsoWithTrailer = (cases: Case[]) =>
  cases.flatMap((short, i) => {
    const long = { ...short, name: `${short.name}, with a trailer`, file: withTrailer(short.file) };
    return slow ? [i & 1 ? short : long] : [short, long];
  });

/** With this quantization table, the samples of a block without AC coefficients are 128 plus its DC coefficient. */
export const eights: number[] = Array(64).fill(8);

/** A gray frame of such blocks, from their DC coefficients. */
export function flat(rows: number[][], type?: number) {
  const frame = frameOf(rows[0].length * 8, rows.length * 8, "1x1", { type, tables: [eights] });
  rows.flat().forEach((level, i) => (frame.components[0].data[i * 64] = level));
  return frame;
}

/** The inverse of `flat()`. */
export async function levels(file: Uint8Array) {
  const { width, height, rgba } = await decode(file);
  return Array.from({ length: height / 8 }, (_, y) =>
    Array.from({ length: width / 8 }, (_, x) => {
      const first = rgba.subarray((y * 8 * width + x * 8) * 4).subarray(0, 4);
      const row = Buffer.alloc(32, first);
      for (let i = 0; i < 8; i++) {
        const at = ((y * 8 + i) * width + x * 8) * 4;
        if (!row.equals(rgba.subarray(at, at + 32))) return "not flat";
      }
      return first[0] - 128;
    }),
  );
}

/** Groups `values` by their results. */
export async function grouped<T, U = T[]>(
  values: T[],
  result: (value: T) => Promise<string>,
  show = (some: T[]) => some as unknown as U,
) {
  const results = await Promise.all(values.map(result));
  const groups = Object.groupBy(values, (_, i) => results[i]);
  return Object.fromEntries(Object.entries(groups).map(([key, some]) => [key, show(some!)]));
}

export const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
export const bytes = range(0, 255);
export const hex = (codes: number[]) => Buffer.from(codes).toString("hex");

/** No code starts with 1. */
export const everySymbol = tableOf(
  bytes,
  bytes.map(symbol => 9 + (symbol & 1)),
);

/** The segments that select a color space. */
export const colorMarkers: Record<Colors, Buffer[]> = {
  gray: [],
  YCbCr: [],
  RGB: [adobe(0)],
  CMYK: [],
  YCCK: [adobe(2)],
};

export function pngOf({ width, height, rgba }: Picture, ...chunks: Buffer[]) {
  const lines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) rgba.copy(lines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  return png(ihdr(width, height, 8, RGBA), ...chunks, chunk("IDAT", deflateSync(lines, { level: 0 })), iend);
}
