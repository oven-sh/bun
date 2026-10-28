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
import zlib from "node:zlib";
import { differences } from "../../archive-golden/observe";
import { chunksOf, linesOf, loadCases, observeDecode, observeEncode, type PngOptions } from "./observe";
import {
  chunk,
  GRAY,
  GRAY_ALPHA,
  iend,
  ihdr,
  INDEXED,
  paeth,
  png,
  iccp as profileChunk,
  randomBytes,
  RGB,
  RGBA,
} from "./write";

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

/** `rows` are unfiltered. */
const idat = (...rows: number[][]) => chunk("IDAT", zlib.deflateSync(Buffer.from(rows.flatMap(row => [0, ...row]))));

/** The pixels as `rrggbbaa`, and the color profile. */
async function decodeToHex(file: Uint8Array, options: { maxPixels?: number } = {}) {
  const out = [...chunksOf(await new Bun.Image(file, options).png({ compressionLevel: 0 }).bytes())];
  const width = out[0].data.readUInt32BE(0);
  const lines = linesOf(out);
  const rows: string[] = [];
  for (let at = 0; at < lines.length; at += 1 + width * 4) {
    expect(lines[at]).toBe(0);
    rows.push(lines.toString("hex", at + 1, at + 1 + width * 4));
  }
  const written = out.find(c => c.type === "iCCP")?.data;
  return {
    hex: rows.join(""),
    profile: written ? zlib.inflateSync(written.subarray(written.indexOf(0) + 2)).toString("latin1") : null,
  };
}
async function decode(file: Uint8Array, options: { maxPixels?: number } = {}) {
  const decoded = await decodeToHex(file, options);
  return { pixels: decoded.hex.match(/.{8}/g) ?? [], profile: decoded.profile };
}
const pixels = async (...chunks: Buffer[]) => (await decode(png(...chunks))).pixels;
const profile = async (...chunks: Buffer[]) => (await decode(png(...chunks))).profile;
const rejects = (...chunks: Buffer[]) =>
  expect(decode(png(...chunks))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });

const iccp = (text: string, name = "name") => profileChunk(name, text);

// Each of these was so with libspng too, whatever the specification says, unless it says what libspng did.
describe("chunks before the image", () => {
  const [rgbaHeader, rgbaData] = [ihdr(1, 1, 8, RGBA), idat([1, 2, 3, 4])];
  const palette = chunk("PLTE", [10, 11, 12, 20, 21, 22]);
  const indexed = ihdr(4, 1, 2, INDEXED);
  const indices = idat([0b00_01_10_11]);

  test("an unknown ancillary chunk is passed over, an unknown critical one is not", async () => {
    expect(await pixels(rgbaHeader, chunk("abCd", "anything"), rgbaData, iend)).toEqual(["01020304"]);
    await rejects(rgbaHeader, chunk("AbCd", "anything"), rgbaData, iend);
  });

  test("a second IHDR, or IEND before IDAT, is refused", async () => {
    await rejects(rgbaHeader, rgbaHeader, rgbaData, iend);
    await rejects(rgbaHeader, iend, rgbaData, iend);
  });

  test("an index that PLTE has no entry for is opaque black", async () => {
    expect(await pixels(indexed, palette, indices, iend)).toEqual(["0a0b0cff", "141516ff", "000000ff", "000000ff"]);
  });

  test("an indexed image needs PLTE, with no more entries than the depth can index", async () => {
    await rejects(indexed, indices, iend);
    await rejects(indexed, chunk("PLTE", Buffer.alloc(5 * 3)), indices, iend);
    await rejects(indexed, chunk("PLTE", Buffer.alloc(4)), indices, iend);
    await rejects(indexed, chunk("PLTE"), indices, iend);
    expect(await pixels(rgbaHeader, chunk("PLTE", Buffer.alloc(256 * 3)), rgbaData, iend)).toEqual(["01020304"]);
    await rejects(rgbaHeader, chunk("PLTE", Buffer.alloc(257 * 3)), rgbaData, iend);
  });

  // libspng let it replace as many entries of the first as it had.
  test("a second PLTE is refused where the pixels are indices into it", async () => {
    const first = chunk("PLTE", [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    await rejects(indexed, first, palette, indices, iend);
    await rejects(indexed, palette, chunk("abCd"), palette, indices, iend);
    expect(await pixels(rgbaHeader, first, palette, rgbaData, iend)).toEqual(["01020304"]);
  });

  test("PLTE may not follow tRNS, bKGD or hIST, unless they were passed over", async () => {
    const [rgbHeader, rgbData] = [ihdr(1, 1, 8, RGB), idat([1, 2, 3])];
    for (const [type, good, bad, goodIfIndexed] of [
      ["tRNS", [0, 9, 0, 9, 0, 9], [0, 9, 0, 9, 0], [7]],
      ["bKGD", [0, 9, 0, 9, 0, 9], [0, 9, 0, 9, 0, 9, 0], [0]],
      ["hIST", [0, 1, 0, 2], [0, 1], [0, 1, 0, 2]],
    ] as const) {
      await rejects(rgbHeader, palette, chunk(type, [...good]), palette, rgbData, iend);
      expect(await pixels(rgbHeader, palette, chunk(type, [...bad]), palette, rgbData, iend)).toEqual(["010203ff"]);
      // With no palette yet to refer to, they are passed over.
      expect((await pixels(indexed, chunk(type, [...goodIfIndexed]), palette, indices, iend))[0]).toBe("0a0b0cff");
    }
    for (const type of ["tRNS", "bKGD"]) {
      await rejects(rgbHeader, chunk(type, [0, 9, 0, 9, 0, 9]), palette, rgbData, iend);
      expect(await pixels(rgbHeader, chunk(type, Buffer.alloc(5)), palette, rgbData, iend)).toEqual(["010203ff"]);
    }
    // hIST has to be as long as the last PLTE.
    const one = chunk("PLTE", [1, 1, 1]);
    await rejects(rgbHeader, palette, one, chunk("hIST", [0, 1]), palette, rgbData, iend);
    expect(await pixels(rgbHeader, palette, one, chunk("hIST", [0, 1, 0, 2]), palette, rgbData, iend)).toEqual([
      "010203ff",
    ]);
  });

  test("tRNS gives the first palette entries their alpha", async () => {
    expect(await pixels(indexed, palette, chunk("tRNS", [7]), indices, iend)).toEqual([
      "0a0b0c07",
      "141516ff",
      "000000ff",
      "000000ff",
    ]);
    // Before PLTE, or a second one: passed over.
    expect((await pixels(indexed, chunk("tRNS", [7]), palette, indices, iend))[0]).toBe("0a0b0cff");
    expect((await pixels(indexed, palette, chunk("tRNS", [7]), chunk("tRNS", [9]), indices, iend))[0]).toBe("0a0b0c07");
  });

  // libspng compared all 16 bits with a gray sample of 8 bits or less, so that the second of each pair was opaque.
  test("of a sample in tRNS, only as many bits count as a sample of the image has", async () => {
    const gray = (depth: number, trns: number[], row: number[]) =>
      pixels(ihdr(2, 1, depth, GRAY), chunk("tRNS", trns), idat(row), iend);
    expect(await gray(8, [0, 5], [5, 6])).toEqual(["05050500", "060606ff"]);
    expect(await gray(8, [1, 5], [5, 6])).toEqual(["05050500", "060606ff"]);
    expect(await gray(4, [0, 0x05], [0x56])).toEqual(["55555500", "666666ff"]);
    expect(await gray(4, [0, 0x15], [0x56])).toEqual(["55555500", "666666ff"]);
    expect(await gray(2, [0, 2], [0b10_11_0000])).toEqual(["aaaaaa00", "ffffffff"]);
    expect(await gray(2, [0, 6], [0b10_11_0000])).toEqual(["aaaaaa00", "ffffffff"]);
    expect(await gray(1, [0, 0], [0b0_1_000000])).toEqual(["00000000", "ffffffff"]);
    expect(await gray(1, [0xff, 0xfe], [0b0_1_000000])).toEqual(["00000000", "ffffffff"]);
    expect(await gray(16, [1, 5], [1, 5, 1, 6])).toEqual(["01010100", "010101ff"]);

    const rgb = (depth: number, trns: number[], row: number[]) =>
      pixels(ihdr(2, 1, depth, RGB), chunk("tRNS", trns), idat(row), iend);
    expect(await rgb(8, [0, 1, 0, 2, 0, 3], [1, 2, 3, 1, 2, 4])).toEqual(["01020300", "010204ff"]);
    expect(await rgb(8, [9, 1, 9, 2, 9, 3], [1, 2, 3, 1, 2, 4])).toEqual(["01020300", "010204ff"]);
    expect(await rgb(16, [9, 1, 9, 2, 9, 3], [9, 1, 9, 2, 9, 3, 9, 1, 9, 2, 9, 4])).toEqual(["09090900", "090909ff"]);
  });

  test("tRNS means nothing where there is an alpha channel", async () => {
    expect(await pixels(rgbaHeader, chunk("tRNS", [0, 1, 0, 2, 0, 3]), rgbaData, iend)).toEqual(["01020304"]);
  });

  test("only the first iCCP counts, and only before PLTE", async () => {
    expect(await profile(rgbaHeader, iccp("one"), rgbaData, iend)).toBe("one");
    expect(await profile(rgbaHeader, iccp("one"), iccp("two"), rgbaData, iend)).toBe("one");
    expect(await profile(rgbaHeader, chunk("PLTE", [1, 2, 3]), iccp("one"), rgbaData, iend)).toBe(null);
    // The first one counts as seen even when it is no good.
    expect(await profile(rgbaHeader, iccp("one", " name"), iccp("two"), rgbaData, iend)).toBe(null);
    // An empty one does not.
    expect(await profile(rgbaHeader, chunk("iCCP"), iccp("two"), rgbaData, iend)).toBe("two");
  });

  test("a damaged iCCP loses the profile, not the image", async () => {
    const good = iccp("profile").subarray(8, -4);
    for (const [why, data] of [
      ["empty name", iccp("profile", "").subarray(8, -4)],
      ["space before the name", iccp("profile", " a").subarray(8, -4)],
      ["space after the name", iccp("profile", "a ").subarray(8, -4)],
      ["two spaces", iccp("profile", "a  b").subarray(8, -4)],
      ["control character", iccp("profile", "a\x7fb").subarray(8, -4)],
      ["80 characters", iccp("profile", Buffer.alloc(80, "a").toString()).subarray(8, -4)],
      ["no terminator", Buffer.from("name")],
      ["nothing after the name", Buffer.from("name\0")],
      ["compression method 1", Buffer.concat([Buffer.from("name\0\x01"), good.subarray(6)])],
      ["no stream", Buffer.from("name\0\0")],
      ["stream cut short", good.subarray(0, -5)],
      ["stream without its checksum", good.subarray(0, -4)],
      ["stream damaged", Buffer.concat([good.subarray(0, 6), Buffer.from([0xff, 0xff]), good.subarray(8)])],
      ["stream of nothing", Buffer.concat([Buffer.from("name\0\0"), zlib.deflateSync(Buffer.alloc(0))])],
    ] as const) {
      expect([why, await decode(png(rgbaHeader, chunk("iCCP", data), rgbaData, iend))]).toEqual([
        why,
        { pixels: ["01020304"], profile: null },
      ]);
    }
    for (const name of ["a", "a b", "q q~\xa1", "\xa1\xff", Buffer.alloc(79, "a").toString()]) {
      expect(await profile(rgbaHeader, iccp("profile", name), rgbaData, iend)).toBe("profile");
    }
    // The checksum has to be there, not to be right.
    const wrongChecksum = Buffer.from(good);
    wrongChecksum[wrongChecksum.length - 1] ^= 0xff;
    expect(await profile(rgbaHeader, chunk("iCCP", wrongChecksum), rgbaData, iend)).toBe("profile");
  });

  test("1000 chunks of text, suggested palettes and Exif, and no more", async () => {
    const many = (count: number, ...kinds: Buffer[]) =>
      png(rgbaHeader, ...Array.from({ length: count }, (_, i) => kinds[i % kinds.length]), rgbaData, iend);
    const text = chunk("tEXt", "key\0value");
    const mixed = [text, chunk("zTXt", "not even valid"), chunk("iTXt", "x"), chunk("sPLT", "x")];
    expect((await decode(many(1000, text))).pixels).toEqual(["01020304"]);
    await expect(decode(many(1001, text))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
    expect((await decode(many(1000, ...mixed))).pixels).toEqual(["01020304"]);
    await expect(decode(many(1001, ...mixed))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
    // Empty ones do not count, nor any eXIf but the first, nor chunks of other types.
    expect((await decode(many(3000, chunk("tEXt"), chunk("eXIf", "x"), chunk("teXt", "x")))).pixels).toEqual([
      "01020304",
    ]);
    expect((await decode(many(1001, ...Array(999).fill(text), chunk("eXIf", "x"), chunk("eXIf", "x")))).pixels).toEqual(
      ["01020304"],
    );
    // But the first does.
    await rejects(rgbaHeader, ...Array(1000).fill(text), chunk("eXIf", "x"), rgbaData, iend);
    await rejects(rgbaHeader, chunk("eXIf", "x"), ...Array(1000).fill(text), rgbaData, iend);
  });

  test("a profile that inflates to more than the limit costs the image too", async () => {
    const file = (size: number) => png(rgbaHeader, iccp(Buffer.alloc(size, "p").toString()), rgbaData, iend);
    // 8 MiB is the least the limit can be.
    expect((await decode(file(8 << 20), { maxPixels: 64 })).profile?.length).toBe(8 << 20);
    await expect(decode(file((8 << 20) + 1), { maxPixels: 64 })).rejects.toMatchObject({
      code: "ERR_IMAGE_DECODE_FAILED",
    });
    expect((await decode(file((8 << 20) + 1))).profile?.length).toBe((8 << 20) + 1);
  });

  describe("compressed text", () => {
    // libspng's buffer only ever doubled, and its terminator took a byte of the 8 MiB.
    const big = zlib.deflateSync(Buffer.alloc((4 << 20) + 1));
    const small = zlib.deflateSync(Buffer.alloc(4 << 20));
    const withText = (type: string, before: string, stream: Buffer) =>
      png(rgbaHeader, chunk(type, Buffer.concat([Buffer.from(before, "latin1"), stream])), rgbaData, iend);
    /** Whether the text was inflated shows in nothing else. */
    const isTooMuch = (file: Buffer) =>
      expect(decode(file, { maxPixels: 64 })).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });

    test("that inflates to more than the limit costs the image, though none of it is kept", async () => {
      for (const [type, before] of [
        ["zTXt", "key\0\0"],
        ["iTXt", "key\0\x01\0en\0word\0"],
      ]) {
        expect((await decode(withText(type, before, big))).pixels).toEqual(["01020304"]);
        expect((await decode(withText(type, before, small), { maxPixels: 64 })).pixels).toEqual(["01020304"]);
        await isTooMuch(withText(type, before, big));
      }
      // Not compressed, or not well formed up to the stream: not inflated.
      for (const [type, before] of [
        ["tEXt", "key\0"],
        ["iTXt", "key\0\0\0en\0word\0"],
        ["iTXt", "key\0\x01\x01en\0word\0"],
        ["zTXt", "key\0\x01"],
      ]) {
        expect((await decode(withText(type, before, big), { maxPixels: 64 })).pixels).toEqual(["01020304"]);
      }
    });

    // A keyword has 79 bytes at most, and all that is in front of the stream 256.
    test.each([
      ["keyword of a zTXt", "zTXt", (keyword: string) => `${keyword}\0\0`, 79 + 2],
      ["keyword of an iTXt", "iTXt", (keyword: string) => `${keyword}\0\x01\0\0\0`, 79 + 5],
      ["language tag", "iTXt", (language: string) => `key\0\x01\0${language}\0\0`, 256],
      ["translated keyword", "iTXt", (translated: string) => `key\0\x01\0\0${translated}\0`, 256],
    ] as const)("is not inflated behind a %s that is too long", async (_, type, fields, most) => {
      const file = (length: number) =>
        withText(type, fields(Buffer.alloc(length - fields("").length, "x").toString()), big);
      expect((await decode(file(most))).pixels).toEqual(["01020304"]);
      await isTooMuch(file(most));
      expect((await decode(file(most + 1), { maxPixels: 64 })).pixels).toEqual(["01020304"]);
      expect((await decode(file(most + 2), { maxPixels: 64 })).pixels).toEqual(["01020304"]);
    });
  });
});

describe("the image", () => {
  const header = ihdr(2, 2, 8, GRAY);
  const stream = zlib.deflateSync(Buffer.from([0, 1, 2, 0, 3, 4]));
  const expected = ["010101ff", "020202ff", "030303ff", "040404ff"];

  test("the stream can be cut into IDAT chunks anywhere, empty ones too", async () => {
    for (let cut = 0; cut <= stream.length; cut++) {
      const parts = [
        chunk("IDAT"),
        chunk("IDAT", stream.subarray(0, cut)),
        chunk("IDAT"),
        chunk("IDAT", stream.subarray(cut)),
      ];
      expect(await pixels(header, ...parts, iend)).toEqual(expected);
    }
  });

  test("another chunk between two IDAT ends the stream", async () => {
    await rejects(
      header,
      chunk("IDAT", stream.subarray(0, 5)),
      chunk("tEXt", "a\0b"),
      chunk("IDAT", stream.subarray(5)),
    );
  });

  test("nothing after the last pixel is looked at", async () => {
    const whole = png(header, chunk("IDAT", stream));
    expect((await decode(whole)).pixels).toEqual(expected);
    // Not the CRC of the last IDAT,
    expect((await decode(whole.subarray(0, -4))).pixels).toEqual(expected);
    // but what an IDAT announces has to be there.
    await expect(decode(whole.subarray(0, -5))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
    expect(await pixels(header, chunk("IDAT", stream), chunk("JUNK"), header)).toEqual(expected);
    // Not the rest of the stream either: more rows, or no end.
    const longer = zlib.deflateSync(Buffer.from([0, 1, 2, 0, 3, 4, 9, 9, 9, 9]));
    expect(await pixels(header, chunk("IDAT", longer), iend)).toEqual(expected);
    const stored = Buffer.from([0x78, 0x01, 0x00, 6, 0, ~6 & 255, 255, 0, 1, 2, 0, 3, 4]);
    expect(await pixels(header, chunk("IDAT", stored), iend)).toEqual(expected);
  });

  test("a row of 2^32 - 1 bytes is too long, however many pixels are allowed", async () => {
    const code = (width: number) =>
      decode(png(ihdr(width, 1, 8, RGB), idat([1, 2, 3]), iend)).catch(error => error.code);
    expect(await code(1431655764)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await code(1431655765)).toBe("ERR_IMAGE_DECODE_FAILED");
  });

  test("a stream that ends early, or a filter that does not exist, is refused", async () => {
    await rejects(header, chunk("IDAT", zlib.deflateSync(Buffer.from([0, 1, 2, 0, 3]))), iend);
    await rejects(header, chunk("IDAT", zlib.deflateSync(Buffer.from([0, 1, 2, 5, 3, 4]))), iend);
    await rejects(header, chunk("IDAT", zlib.deflateSync(Buffer.from([5, 1, 2, 0, 3, 4]))), iend);
    await rejects(header, chunk("IDAT", zlib.deflateRawSync(Buffer.from([0, 1, 2, 0, 3, 4]))), iend);
    await rejects(header, iend);
  });

  /** Color type, bit depth, channels. */
  const pixelFormats = [
    [GRAY, 8, 1],
    [GRAY_ALPHA, 8, 2],
    [RGB, 8, 3],
    [RGBA, 8, 4],
    [RGB, 16, 3],
    [RGBA, 16, 4],
  ];

  /** A file whose rows have `filters` and the bytes that `filtered()` gives, with what it decodes to. */
  function filteredImage(format: number[], width: number, filters: number[], filtered: (predicted: number) => number) {
    const [colorType, depth, channels] = format;
    const bpp = (channels * depth) / 8;
    const lines = Buffer.alloc(filters.length * (1 + width * bpp));
    const rgba = Buffer.alloc(filters.length * width * 4, 255);
    let above = new Uint8Array(width * bpp);
    for (const [y, filter] of filters.entries()) {
      const row = lines.subarray(y * (1 + width * bpp) + 1, (y + 1) * (1 + width * bpp));
      const unfiltered = new Uint8Array(row.length);
      lines[y * (1 + width * bpp)] = filter;
      for (let i = 0; i < row.length; i++) {
        const a = i < bpp ? 0 : unfiltered[i - bpp];
        const b = above[i];
        const predicted =
          filter === 4
            ? paeth(a, b, i < bpp ? 0 : above[i - bpp])
            : filter === 3
              ? (a + b) >> 1
              : filter === 2
                ? b
                : filter === 1
                  ? a
                  : 0;
        row[i] = filtered(predicted);
        unfiltered[i] = row[i] + predicted;
      }
      for (let x = 0; x < width; x++) {
        const to = (y * width + x) * 4;
        // Gray is three times the same, and then comes the alpha.
        for (let channel = 0; channel < (channels <= 2 ? channels + 2 : channels); channel++) {
          const from = channels <= 2 ? Math.max(0, channel - 2) : channel;
          rgba[to + channel] = unfiltered[x * bpp + (from * depth) / 8];
        }
      }
      above = unfiltered;
    }
    return {
      name: `color type ${colorType}, depth ${depth}, width ${width}`,
      file: png(ihdr(width, filters.length, depth, colorType), chunk("IDAT", zlib.deflateSync(lines))),
      expected: rgba.toString("hex") + "\n",
    };
  }

  async function expectToDecode(images: ReturnType<typeof filteredImage>[]) {
    const results = await Promise.all(
      images.map(async ({ name, file, expected }) => ({
        index: name,
        expected,
        actual: (await decodeToHex(file)).hex + "\n",
      })),
    );
    expect(differences(results)).toBe("");
  }

  test("every filter, for every size of pixel, in rows of several lengths", async () => {
    // Twice each, so that each also comes after a row that is not zeros.
    const filters = [4, 3, 2, 1, 0, 1, 2, 3, 4, 0];
    const random = randomBytes(1);
    await expectToDecode(
      pixelFormats.flatMap(format =>
        [1, 2, 3, 4, 5, 7, 8, 9, 13].map(width => filteredImage(format, width, filters, random)),
      ),
    );
  });

  test("Paeth where two of a, b and c are as near, or almost", async () => {
    // a, b, c, a, b, c and so on. Which one is picked depends on a - c and b - c alone.
    const triples: number[] = [];
    const seen = new Set<number>();
    const add = (a: number, b: number) => {
      const c = -Math.min(0, a, b);
      if (c + Math.max(0, a, b) > 255 || seen.has(a * 1024 + b)) return;
      seen.add(a * 1024 + b);
      triples.push(c + a, c + b, c);
    };
    for (let d = -255; d <= 255; d++) {
      for (const tie of [d, -d, -2 * d, -d >> 1, 0]) {
        for (let e = tie - 1; e <= tie + 1; e++) {
          add(d, e);
          add(e, d);
        }
      }
    }
    for (const format of pixelFormats) {
      // One of them to a byte: c and b side by side in the first row, a under c, and zero under b.
      const bpp = (format[1] * format[2]) / 8;
      const width = 2 * Math.ceil(triples.length / 3 / bpp);
      const wanted = new Uint8Array(2 * width * bpp);
      for (let i = 0; i < triples.length / 3; i++) {
        const at = i + Math.floor(i / bpp) * bpp;
        wanted[at + width * bpp] = triples[i * 3];
        wanted[at + bpp] = triples[i * 3 + 1];
        wanted[at] = triples[i * 3 + 2];
      }
      let at = 0;
      const image = filteredImage(format, width, [0, 4], predicted => wanted[at++] - predicted);
      const { hex } = await decodeToHex(image.file);
      const same = hex + "\n" === image.expected;
      const wrong = same ? 0 : Array.from(hex).findIndex((digit, i) => digit !== image.expected[i]) >> 3;
      const first = ((wrong % width) >> 1) * bpp * 3;
      expect({ format, wrong: same ? [] : triples.slice(first, first + bpp * 3) }).toEqual({ format, wrong: [] });
    }
  });

  test("Paeth under a row that is the same pixel over and over in places", async () => {
    const random = randomBytes(2);
    // None, so the bytes are the row: first stretches of one pixel, of two or three taking turns and of noise, then
    // one pixel all the way. Under Paeth, zeros keep what the row above has and anything else breaks it up.
    const filters = [0, 4, 4, 0, 4, 4];
    await expectToDecode(
      pixelFormats.flatMap(format => {
        const bpp = (format[1] * format[2]) / 8;
        return [50, 100, 340, 620].map(bytes => {
          const width = Math.ceil(bytes / bpp);
          let [at, left, pattern] = [0, 0, [] as number[]];
          return filteredImage(format, width, filters, () => {
            const row = Math.floor(at++ / (width * bpp));
            if (filters[row] === 4) return random() < 2 ? random() : 0;
            if (left === 0) {
              left = row === 0 ? bpp * (1 + (random() % Math.ceil(200 / bpp))) : width * bpp;
              pattern = Array.from({ length: bpp * [1, 1, 1, 2, 3, 200][row === 0 ? random() % 6 : 0] }, random);
            }
            return pattern[--left % pattern.length];
          });
        });
      }),
    );
  });
});

// libspng read the chunks after IDAT when asked for the profile, and gave none if they were bad or missing.
test("the color profile does not depend on what follows the image", async () => {
  const start = [ihdr(1, 1, 8, RGBA), iccp("profile"), idat([1, 2, 3, 4])];
  const expected = { pixels: ["01020304"], profile: "profile" };
  expect(await decode(png(...start, iend))).toEqual(expected);
  expect(await decode(png(...start))).toEqual(expected);
  expect(await decode(png(...start).subarray(0, -4))).toEqual(expected);
  expect(await decode(png(...start, chunk("JUNK"), iend))).toEqual(expected);
  expect(await decode(png(...start, chunk("tEXt", "a\0b"), idat([1, 2, 3, 4]), iend))).toEqual(expected);
  expect(await decode(png(...start, chunk("IEND", "not empty")))).toEqual(expected);
});

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
