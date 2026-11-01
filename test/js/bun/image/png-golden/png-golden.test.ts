// PNG files of every kind the format has, well formed and damaged, with what Bun.Image made of each
// one when it was recorded. See record.ts. By the start of a case's name:
//   PngSuite/   by Willem van Schaik
//   libspng/    the test files of libspng
//   generated/  made for this test
//   limit/      one of PngSuite's, decoded with a `maxPixels`
//   damaged/    the above with chunks changed, one for each thing libspng had to say about such a file
//   fuzz/       from fuzzing libspng and src/png side by side, one for each piece of code reached in either
//   history/    made to set off the bugs libspng has had, named by the commit that fixed one or the issue, if any
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { differences } from "../../archive-golden/observe";
import { chunksOf, linesOf, loadCases, observeDecode, observeEncode, type PngOptions } from "./observe";

const cases = await loadCases(join(import.meta.dir, "cases.json.gz"));
const files = new Map(cases.decode.map(c => [c.name, Buffer.from(c.data, "base64")]));

describe("Bun.Image reads and writes PNG the way it was recorded to", () => {
  test("decode", async () => {
    expect(cases.decode.length).toBe(1097);
    const results = await Promise.all(
      cases.decode.map(async c => ({
        index: c.name,
        expected: c.result,
        actual: await observeDecode(files.get(c.name)!, c.maxPixels),
      })),
    );
    expect(differences(results)).toBe("");
  });

  test("encode", async () => {
    expect(cases.encode.length).toBe(200);
    const results = await Promise.all(
      cases.encode.map(async c => ({
        index: `${c.source} ${JSON.stringify(c.options)}`,
        expected: c.result,
        actual: await observeEncode(files.get(c.source)!, c.options),
      })),
    );
    expect(differences(results)).toBe("");
  });
});

// Of some of those files.
describe("what is written", () => {
  const source = files.get("generated/noise 120x90")!;
  const withProfile = files.get("generated/gradient with profile 90x70")!;
  const chunkList = async (file: Uint8Array, options: PngOptions) =>
    [...chunksOf(await new Bun.Image(file).png(options).bytes())].map(c => `${c.type} ${c.data.length}`);

  test("IDAT chunks of 8192 bytes", async () => {
    // 90 rows of 1 + 120 * 4 bytes make a little over five of them.
    expect(await chunkList(source, { compressionLevel: 0 })).toEqual([
      "IHDR 13",
      ...Array(5).fill("IDAT 8192"),
      expect.stringMatching(/^IDAT [1-9]\d{0,3}$/),
      "IEND 0",
    ]);
  });

  test("iCCP, PLTE and tRNS come in this order, tRNS only if a color is not opaque", async () => {
    const types = async (file: Uint8Array, options: PngOptions) =>
      (await chunkList(file, options)).map(c => c.slice(0, 4)).join(" ");
    expect(await types(withProfile, {})).toBe("IHDR iCCP IDAT IEND");
    expect(await types(withProfile, { palette: true, colors: 4 })).toBe("IHDR iCCP PLTE IDAT IEND");
    expect(await chunkList(source, { palette: true, colors: 4 })).toEqual([
      "IHDR 13",
      "PLTE 12",
      "tRNS 4",
      expect.stringMatching(/^IDAT \d+$/),
      "IEND 0",
    ]);
  });

  test("the profile is named ICC Profile, whatever it was called", async () => {
    const [, written] = chunksOf(await new Bun.Image(withProfile).png().bytes());
    expect(written.data.toString("latin1", 0, 13)).toBe("ICC Profile\0\0");
  });

  test("rows are filtered, except at level 0 and with a palette", async () => {
    const filters = async (options: PngOptions, bytesPerPixel: number) => {
      const lines = linesOf([
        ...chunksOf(await new Bun.Image(files.get("generated/gradient 200x150")!).png(options).bytes()),
      ]);
      return new Set(Array.from({ length: 150 }, (_, y) => lines[y * (1 + 200 * bytesPerPixel)]));
    };
    expect(await filters({ compressionLevel: 0 }, 4)).toEqual(new Set([0]));
    expect(await filters({ palette: true }, 1)).toEqual(new Set([0]));
    expect(await filters({ compressionLevel: 1 }, 4)).not.toContain(0);
  });
});
