// What Bun.Image makes of a PNG, as text, for png-golden.test.ts and record.ts.

export type PngOptions = NonNullable<Parameters<Bun.Image["png"]>[0]>;

export type DecodeCase = {
  /** Where the file comes from. */
  name: string;
  /** The file, in base64. */
  data: string;
  maxPixels?: number;
  result: string;
};

export type EncodeCase = {
  /** The `name` of the decode case whose pixels are encoded. */
  source: string;
  options: PngOptions;
  result: string;
};

export type Cases = { decode: DecodeCase[]; encode: EncodeCase[] };

export async function loadCases(path: string): Promise<Cases> {
  return JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(path).bytes())).toString());
}

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

async function observe(png: Uint8Array, maxPixels: number | undefined, options: PngOptions) {
  try {
    const out = await new Bun.Image(png, maxPixels === undefined ? {} : { maxPixels }).png(options).bytes();
    const header = new DataView(out.buffer, out.byteOffset);
    return `${header.getUint32(16)}x${header.getUint32(20)} ${out.length} bytes ${sha256(out)}\n`;
  } catch (error: any) {
    return `${error.code}: ${error.message}\n`;
  }
}

/** At level 0 the output holds the pixels as they are, and the color profile in an iCCP chunk. */
export const observeDecode = (png: Uint8Array, maxPixels?: number) => observe(png, maxPixels, { compressionLevel: 0 });

export const observeEncode = (png: Uint8Array, options: PngOptions) => observe(png, undefined, options);

/** One failure message for all the cases that differ, instead of one test per case. */
export function differences(results: { name: string; expected: string; actual: string }[]) {
  const different = results.filter(r => r.actual !== r.expected);
  if (different.length === 0) return "";
  return [
    `${different.length} of ${results.length} differ`,
    ...different.slice(0, 5).map(r => `${r.name}\n--- expected\n${r.expected}--- actual\n${r.actual}`),
  ].join("\n");
}
