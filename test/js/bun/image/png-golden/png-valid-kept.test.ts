// Valid PNG files that were not made with write.ts, so that a mistake in it is not a mistake in them. See
// png-valid.test.ts.
//
// Each is put together by the rules of the third edition, but a profile in one may be any bytes, and some chunks have
// public names that nobody registered, as the iDOT of macOS. libpng gets the pixels that a file was made of, and
// Python's zlib the profile. None was left out for what Bun makes of it. They are small, so that every build can have
// all of them.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadCases } from "../../archive-golden/observe";
import { decoded } from "./check";

type Entry = {
  name: string;
  data: string;
  width: number;
  height: number;
  /** Of what `rgbaLinesOf` gives for the picture. */
  sha256: string;
  /** The SHA-256 of the profile, if there is one. */
  profile?: string;
  /** To decode it with. Some are only worth keeping for how near they come to a limit. */
  maxPixels?: number;
};

async function expectToDecode(fixture: string, count: number) {
  const entries = await loadCases<Entry>(join(import.meta.dir, fixture));
  expect(entries.length).toBe(count);
  const sha256 = (bytes: Uint8Array) => Bun.SHA256.hash(bytes, "hex");
  const results = entries.map(async ({ name, data, maxPixels }) => {
    try {
      const { width, height, lines, profile } = await decoded(Buffer.from(data, "base64"), maxPixels);
      return { name, width, height, sha256: sha256(lines), ...(profile && { profile: sha256(profile) }) };
    } catch (error: any) {
      return { name, error: error.code ?? error };
    }
  });
  expect(await Promise.all(results)).toEqual(entries.map(({ data, maxPixels, ...expected }) => expected));
}

// Pictures that were made up first and then written by 24 programs in many of the ways that each offers. A name says
// which program, what kind of file came out, and of which picture and settings. They are picked from 54,000 different
// files so that each program is there with every format, zlib header, kind of block, filter, way to cut IDAT, set of
// other chunks and magnitude of a copy's length and distance that it came up with in a file of up to 2.5 KB. 10 of the
// programs were given a profile too, and kept it.
test("files written by other programs", () => expectToDecode("valid.json.gz", 622));

// A name in core and rows is what the generator was asked for, and not all of that shows in so small a file. One in
// pairs is made of what it measured in the file, but for `row`, where RGB counts as the RGBA that src/png makes of it,
// and `maxpixels`, which is the option.
// - core: picked with versions of src/png that each have one small mistake. Of the mistakes that were tried, those that
//   a small valid file of the generator's can give away, two of these do.
// - rows: the widths whose rows come nearest to 8, 16, 48, 96, 240 and 288 bytes from below, hit them, and come nearest
//   from above, and those just above 8192 and 65,536. Some interlaced too. Then Paeth under rows that are one pixel
//   over and over from here to there, or that change in one byte, where src/png/filter.rs looks and next to that.
// - pairs: picked so that many properties of a file meet many others.
test("files from a generator that shares nothing with write.ts", () => expectToDecode("generated.json.gz", 617));
