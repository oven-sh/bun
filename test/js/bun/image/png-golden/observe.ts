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

/**
 * Only the last line depends on how zlib compresses. Should that change, the lines before it still hold what
 * was recorded with libspng: the chunks, the filter chosen for each row with the filtered row, and the profile.
 */
async function observe(png: Uint8Array, maxPixels: number | undefined, options: PngOptions, wholeFile: boolean) {
  let out: Buffer;
  try {
    out = await new Bun.Image(png, maxPixels === undefined ? {} : { maxPixels }).png(options).buffer();
  } catch (error: any) {
    return `${error.code}: ${error.message}\n`;
  }
  const types: string[] = [];
  const idat: Buffer[] = [];
  let rest = "";
  for (let at = 8; at < out.length;) {
    const length = out.readUInt32BE(at);
    const type = out.toString("latin1", at + 4, at + 8);
    const data = out.subarray(at + 8, at + 8 + length);
    if (type === "IDAT") idat.push(data);
    else if (type === "iCCP") {
      const name = data.indexOf(0);
      rest += `iCCP ${data.toString("latin1", 0, name)} ${sha256(Bun.inflateSync(data.subarray(name + 4, -4)))}\n`;
    } else if (type !== "IEND") rest += `${type} ${data.toString("hex")}\n`;
    if (types.at(-1) !== type) types.push(type);
    at += 12 + length;
  }
  const lines = Bun.inflateSync(Buffer.concat(idat).subarray(2, -4));
  return (
    `${types.join(" ")}\n${rest}IDAT ${lines.length} bytes ${sha256(lines)}\n` +
    (wholeFile ? `file ${out.length} bytes ${sha256(out)}\n` : "")
  );
}

/** At level 0 rows are not filtered, so IDAT holds the pixels as they are. */
export const observeDecode = (png: Uint8Array, maxPixels?: number) =>
  observe(png, maxPixels, { compressionLevel: 0 }, false);

export const observeEncode = (png: Uint8Array, options: PngOptions) => observe(png, undefined, options, true);

/** One failure message for all the cases that differ, instead of one test per case. */
export function differences(results: { name: string; expected: string; actual: string }[]) {
  const different = results.filter(r => r.actual !== r.expected);
  if (different.length === 0) return "";
  return [
    `${different.length} of ${results.length} differ`,
    ...different.slice(0, 5).map(r => `${r.name}\n--- expected\n${r.expected}--- actual\n${r.actual}`),
  ].join("\n");
}
