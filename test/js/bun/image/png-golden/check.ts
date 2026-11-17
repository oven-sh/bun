// Gives a PNG file to Bun.Image, and takes apart what comes back.
import { isASAN, isDebug } from "harness";

/** These builds run JavaScript and zlib many times slower, so they get a part of what the others get. */
export const slow = isDebug || isASAN;

/** `AHEAD_LEN` in src/png/decoder.rs: so many bytes of lines are inflated at a time. */
export const aheadLength = 128 * 1024;
/** How many lines of so many bytes that is. */
export const linesAtATime = (line: number) => Math.floor(aheadLength / line);

const IDAT = 0x49444154;
const ICCP = 0x69434350;

/** Takes apart a file that Bun.Image wrote at level 0, where zlib only stores. */
export function parse(out: Uint8Array) {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const [width, height] = [view.getUint32(16), view.getUint32(20)];
  const data: Uint8Array[] = [];
  let profile: Uint8Array | undefined;
  for (let at = 8; at < out.length;) {
    const [length, type] = [view.getUint32(at), view.getUint32(at + 4)];
    if (type === IDAT) data.push(out.subarray(at + 8, at + 8 + length));
    // Behind the name, its end and the compression method comes a zlib stream.
    if (type === ICCP) profile = Bun.inflateSync(out.subarray(out.indexOf(0, at + 8) + 4, at + 4 + length));
    at += 12 + length;
  }
  const stream = data.length === 1 ? data[0] : Buffer.concat(data);
  const lines = new Uint8Array(height * (1 + width * 4));
  for (let at = 2, to = 0, last = 0; !last;) {
    if (at + 5 > stream.length) throw new Error("the stream has no end");
    last = stream[at];
    if (last > 1) throw new Error("not a stored block");
    const length = stream[at + 1] | (stream[at + 2] << 8);
    if (to + length > lines.length) throw new Error("too many rows");
    lines.set(stream.subarray(at + 5, at + 5 + length), to);
    to += length;
    at += 5 + length;
    if (last && to < lines.length) throw new Error("too few rows");
  }
  return { width, height, lines, profile };
}

/** The pixels as RGBA, each row behind a zero, and the profile. */
export const decoded = async (file: Uint8Array, maxPixels?: number) =>
  parse(await new Bun.Image(file, { maxPixels }).png({ compressionLevel: 0 }).bytes());

/** The names of the images for which `imageData(target)` does not do what `imageData()` does, or writes next to `target`. */
export async function differentInTarget(images: { name: string; open: () => Bun.Image | Promise<Bun.Image> }[]) {
  const margin = Buffer.alloc(64, 0xa5);
  const codeOf = (error: any): string => error.code ?? String(error);
  let [decodedCount, refusedCount] = [0, 0];
  const different = await Promise.all(
    images.map(async ({ name, open }) => {
      const image = await open();
      const expected = await image.imageData().catch(codeOf);
      const size = typeof expected === "string" ? await image.metadata().catch(() => null) : expected;
      if (!size || size.width * size.height > 1 << 20) return [];
      const length = size.width * size.height * 4;
      const memory = new Uint8ClampedArray(64 + length + 64).fill(0xa5);
      const target = new ImageData(memory.subarray(64, 64 + length), size.width);
      const actual = await image.imageData(target).catch(codeOf);
      const isRefused = typeof expected === "string";
      isRefused ? refusedCount++ : decodedCount++;
      const isSame = isRefused ? actual === expected : actual === target && !Buffer.compare(target.data, expected.data);
      return isSame && margin.equals(memory.subarray(0, 64)) && margin.equals(memory.subarray(-64)) ? [] : [name];
    }),
  );
  return { decoded: decodedCount, refused: refusedCount, different: different.flat() };
}
