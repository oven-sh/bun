// What Bun.Image makes of a PNG, as text, for png-golden.test.ts and record.ts.

export type PngOptions = NonNullable<Parameters<Bun.Image["png"]>[0]>;

export type DecodeCase = {
  /** Where the file comes from. */
  name: string;
  /** The file, in base64. */
  data: string;
  maxPixels?: number;
  result: string;
  /** Why `result` is not what it was with libspng. */
  unlikeLibspng?: string;
};

export type EncodeCase = {
  /** The `name` of the decode case whose pixels are encoded. */
  source: string;
  options: PngOptions;
  result: string;
  unlikeLibspng?: string;
};

export type Cases = { decode: DecodeCase[]; encode: EncodeCase[] };

export async function loadCases(path: string): Promise<Cases> {
  return JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(path).bytes())).toString());
}

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export function* chunksOf(file: Uint8Array) {
  const bytes = Buffer.from(file);
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    yield { type: bytes.toString("latin1", at + 4, at + 8), data: bytes.subarray(at + 8, at + 8 + length) };
    at += 12 + length;
  }
}

/** What the IDAT chunks inflate to: each row behind its filter type. */
export const linesOf = (chunks: { type: string; data: Buffer }[]) =>
  Buffer.from(Bun.inflateSync(Buffer.concat(chunks.filter(c => c.type === "IDAT").map(c => c.data)).subarray(2, -4)));

/**
 * Only the last line depends on how zlib compresses. Should that change, the lines before it stay as they were
 * recorded: the chunks, the filter chosen for each row with the filtered row, and the profile.
 */
async function observe(png: Uint8Array, maxPixels: number | undefined, options: PngOptions, wholeFile: boolean) {
  let out: Buffer;
  try {
    out = await new Bun.Image(png, maxPixels === undefined ? {} : { maxPixels }).png(options).buffer();
  } catch (error: any) {
    return `${error.code}: ${error.message}\n`;
  }
  const chunks = [...chunksOf(out)];
  const types: string[] = [];
  let otherChunks = "";
  for (const { type, data } of chunks) {
    if (type === "iCCP") {
      const nameLength = data.indexOf(0);
      const profile = Bun.inflateSync(data.subarray(nameLength + 4, -4));
      otherChunks += `iCCP ${data.toString("latin1", 0, nameLength)} ${sha256(profile)}\n`;
    } else if (type !== "IDAT" && type !== "IEND") otherChunks += `${type} ${data.toString("hex")}\n`;
    if (types.at(-1) !== type) types.push(type);
  }
  const lines = linesOf(chunks);
  return (
    `${types.join(" ")}\n${otherChunks}IDAT ${lines.length} bytes ${sha256(lines)}\n` +
    (wholeFile ? `file ${out.length} bytes ${sha256(out)}\n` : "")
  );
}

/** At level 0 rows are not filtered, so IDAT holds the pixels as they are. */
export const observeDecode = (png: Uint8Array, maxPixels?: number) =>
  observe(png, maxPixels, { compressionLevel: 0 }, false);

export const observeEncode = (png: Uint8Array, options: PngOptions) => observe(png, undefined, options, true);
