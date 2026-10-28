// Gives PNG files to Bun.Image. Of those made with write.ts it says where the result is not what the samples stand for.
import { isASAN, isDebug } from "harness";
import { filteredLines, rgbaLinesOf, writeAround, type Layout, type Picture } from "./write";

/** These builds run JavaScript and zlib many times slower, so they get a part of what the others get. */
export const slow = isDebug || isASAN;

export type Case = {
  name: string;
  file: Uint8Array;
  width: number;
  height: number;
  /** What `rgbaLinesOf` gives. */
  expected: Buffer;
  profile?: Uint8Array;
  maxPixels?: number;
};

/** For many files of one picture, filtered and interlaced in one way, that differ in something else. */
export function maker(picture: Picture, shared: Layout = {}) {
  const lines = filteredLines(picture, shared);
  const expected = rgbaLinesOf(picture);
  return (name: string, layout: Layout = {}, profile?: Uint8Array): Case => ({
    name,
    file: writeAround(lines, picture, { ...shared, ...layout }),
    width: picture.width,
    height: picture.height,
    expected,
    profile,
  });
}

export const make = (name: string, picture: Picture, layout?: Layout, profile?: Uint8Array) =>
  maker(picture, layout)(name, undefined, profile);

const IDAT = 0x49444154;
const ICCP = 0x69434350;

/** Takes apart a file that Bun.Image wrote at level 0, where zlib only stores. */
function parse(out: Uint8Array) {
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

/** The pixels as `rgbaLinesOf` gives them, and the profile. */
export const decoded = async (file: Uint8Array, maxPixels?: number) =>
  parse(await new Bun.Image(file, { maxPixels }).png({ compressionLevel: 0 }).bytes());

async function mistake({ name, file, width, height, expected, profile, maxPixels }: Case) {
  let out: ReturnType<typeof parse>;
  try {
    out = await decoded(file, maxPixels);
  } catch (error: any) {
    return `${name}: ${error.code ?? error}`;
  }
  if (out.width !== width || out.height !== height) return `${name}: ${out.width} x ${out.height}`;
  if (profile ? !out.profile || !Buffer.from(profile).equals(out.profile) : out.profile) {
    return `${name}: a profile of ${out.profile?.length} bytes`;
  }
  if (expected.equals(out.lines)) return;
  const at = expected.findIndex((byte, i) => byte !== out.lines[i]);
  const [x, y] = [((at % (1 + width * 4)) - 1) >> 2, Math.floor(at / (1 + width * 4))];
  const hex = (from: Uint8Array) =>
    Buffer.from(from).toString("hex", at - ((at - y - 1) % 4), at - ((at - y - 1) % 4) + 4);
  return `${name}: at ${x}, ${y} ${hex(out.lines)} and not ${hex(expected)}`;
}

/** What is wrong with how each file decodes. Nothing, one hopes. */
export const mistakes = async (cases: Case[]) => (await Promise.all(cases.map(mistake))).filter(Boolean);
