// What Bun.Image makes of a JPEG, as text, for jpeg-golden.test.ts and record.ts.
import { chunksOf, linesOf, sha256 } from "../png-golden/observe";
import { scaled } from "./model";

export type JpegOptions = NonNullable<Parameters<Bun.Image["jpeg"]>[0]>;

export type Recorded = {
  result: string;
  /** Why `result` is not what it was with libjpeg-turbo. */
  unlikeLibjpegTurbo?: string;
};

export type DecodeCase = Recorded & {
  /** Where the file comes from. */
  name: string;
  /** The file, in base64. */
  data: string;
  maxPixels?: number;
};

/** `source` is the `name` of a decode case. To be scaled, it must not be lossless. */
export type ScaleCase = Recorded & { source: string; eighths: number };
export type EncodeCase = Recorded & { source: string; options: JpegOptions };

export type Cases = { decode: DecodeCase[]; scale: ScaleCase[]; encode: EncodeCase[] };

const summary = (bytes: Uint8Array) => `${bytes.length} bytes ${sha256(bytes).slice(0, 16)}\n`;
const failure = (error: any) => `${error.code}: ${error.message}\n`;

/** At level 0 rows are not filtered, so IDAT holds the pixels as they are. */
async function pixelsOf(image: Bun.Image) {
  const chunks = [...chunksOf(await image.png({ compressionLevel: 0 }).bytes())];
  const profile = chunks.find(chunk => chunk.type === "iCCP")?.data;
  return (
    `${chunks[0].data.readUInt32BE(0)} by ${chunks[0].data.readUInt32BE(4)}, ${summary(linesOf(chunks))}` +
    (profile ? `profile ${summary(Bun.inflateSync(profile.subarray(profile.indexOf(0) + 4, -4)))}` : "")
  );
}

export async function observeDecode(file: Uint8Array, maxPixels?: number) {
  const image = () => new Bun.Image(file, maxPixels === undefined ? {} : { maxPixels });
  const header = await image()
    .metadata()
    .then(({ width, height }) => `metadata ${width} by ${height}\n`, failure);
  return header + (await pixelsOf(image()).catch(failure));
}

/** The decoder scales to this size itself, so nothing is left to resize. */
export async function observeScale(file: Uint8Array, eighths: number) {
  const image = new Bun.Image(file);
  const { width, height } = await image.metadata();
  return pixelsOf(image.resize(scaled(width, eighths), scaled(height, eighths), { fit: "fill" })).catch(failure);
}

export const observeEncode = (file: Uint8Array, options: JpegOptions) =>
  new Bun.Image(file).jpeg(options).bytes().then(summary, failure);

/** Each case with a name, and the way to get its result. */
export function observable({ decode, scale, encode }: Cases, change = (file: Buffer) => file) {
  const files = new Map(decode.map(c => [c.name, change(Buffer.from(c.data, "base64"))]));
  const of = (c: Recorded, name: string, observe: () => Promise<string>) => ({ recorded: c, name, observe });
  return {
    decode: decode.map(c => of(c, c.name, () => observeDecode(files.get(c.name)!, c.maxPixels))),
    scale: scale.map(c => of(c, `${c.source} at ${c.eighths}`, () => observeScale(files.get(c.source)!, c.eighths))),
    encode: encode.map(c =>
      of(c, `${c.source} ${JSON.stringify(c.options)}`, () => observeEncode(files.get(c.source)!, c.options)),
    ),
  };
}
