// What Bun.Image makes of a WebP file and what it writes as one, as text, and how that differs from what was recorded.
import { join } from "node:path";
import zlib from "node:zlib";
import { differences } from "../../archive-golden/observe";
import { chunksOf, linesOf } from "../png-golden/observe";
import { chunk, iend, ihdr, png, RGBA } from "../png-golden/write";
import { layers, noise, sequence } from "./picture";

export type DecodeCase = {
  name: string;
  /** The file, in base64. */
  data: string;
  result: string;
};

export type EncodeCase = {
  name: string;
  /** A function of picture.ts and its arguments, or a lossless WebP file in base64. */
  source: [keyof typeof makers, ...number[]] | string;
  /** By quality, or `lossless`. */
  results: Record<string, string>;
};

export type Cases = { decode: DecodeCase[]; encode: EncodeCase[] };

export const fixture = join(import.meta.dir, "cases.json.gz");

export async function loadCases(): Promise<Cases> {
  return JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(fixture).bytes())).toString());
}

/** For `test.each()`: those whose names start with one of `kinds`, so many at a time. */
export function inParts<T extends { name: string }>(cases: T[], kinds: string[], size: number) {
  const some = cases.filter(c => kinds.includes(c.name.split("/")[0]));
  return Array.from({ length: Math.ceil(some.length / size) }, (_, i) => [some.slice(size * i, size * (i + 1))]);
}

const hash = (bytes: Uint8Array) => Bun.SHA256.hash(bytes, "hex").slice(0, 20);

export const pngOf = (width: number, height: number, rgba: Uint8Array) => {
  const lines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++)
    lines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  return png(ihdr(width, height, 8, RGBA), chunk("IDAT", zlib.deflateSync(lines, { level: 0 })), iend);
};

const makers = { layers, noise, sequence };

export function sourceOf({ source }: EncodeCase) {
  if (typeof source === "string") return Buffer.from(source, "base64");
  const [name, ...args] = source;
  const { width, height, rgba } = (makers[name] as (...args: number[]) => ReturnType<typeof layers>)(...args);
  return pngOf(width, height, rgba);
}

function observePixels(stored: Uint8Array) {
  const chunks = [...chunksOf(stored)];
  const iccp = chunks.find(c => c.type === "iCCP")?.data;
  const profile = iccp ? ` profile ${hash(Bun.inflateSync(iccp.subarray(iccp.indexOf(0) + 4, -4)))}` : "";
  return `${chunks[0].data.readUInt32BE(0)}x${chunks[0].data.readUInt32BE(4)} ${hash(linesOf(chunks))}${profile}`;
}

export async function observeDecode(file: Uint8Array) {
  const maxPixels = 1 << 25;
  const failure = (error: any) => `${error.code ?? error}`;
  const [metadata, image] = await Promise.all([
    new Bun.Image(file, { maxPixels }).metadata().then(it => `${it.width}x${it.height}`, failure),
    new Bun.Image(file, { maxPixels }).png({ compressionLevel: 0 }).bytes().then(observePixels, failure),
  ]);
  return `${metadata}\n${image}\n`;
}

export const encode = (source: Uint8Array, setting: string) =>
  new Bun.Image(source).webp(setting === "lossless" ? { lossless: true } : { quality: Number(setting) }).bytes();

export const observeEncoded = (file: Uint8Array) => `${file.length} bytes ${hash(file)}\n`;

export async function decodeDifferences(cases: DecodeCase[]) {
  const results = cases.map(async c => ({
    index: c.name,
    expected: c.result,
    actual: await observeDecode(Buffer.from(c.data, "base64")),
  }));
  return differences(await Promise.all(results));
}

export async function encodeDifferences(cases: EncodeCase[]) {
  const results = cases.flatMap(c => {
    const source = sourceOf(c);
    return Object.entries(c.results).map(async ([setting, expected]) => ({
      index: `${c.name} ${setting}`,
      expected,
      actual: observeEncoded(await encode(source, setting)),
    }));
  });
  return differences(await Promise.all(results));
}
