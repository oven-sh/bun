// The rules for the chunks in front of IDAT, one at a time, in files made by hand.
// A comment says so where libspng did otherwise.
import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";
import { slow } from "./check";
import { decode, iccpOf, idat, pixels, profile, rejects } from "./decode";
import { chunk, GRAY, GRAY_ALPHA, iend, ihdr, INDEXED, png, RGB, RGBA } from "./write";

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
    // Of a length that would do for a PLTE.
    await rejects(rgbaHeader, chunk("IHDR", [1, 2, 3]), rgbaData, iend);
    await rejects(rgbaHeader, chunk("IEND", [1, 2, 3]), rgbaData, iend);
  });

  test("an index that PLTE has no entry for is opaque black", async () => {
    expect(await pixels(indexed, palette, indices, iend)).toEqual(["0a0b0cff", "141516ff", "000000ff", "000000ff"]);
  });

  test("an indexed image needs PLTE, of 1 to 256 colors", async () => {
    await rejects(indexed, indices, iend);
    await rejects(indexed, chunk("PLTE"), indices, iend);
    await rejects(indexed, chunk("PLTE", Buffer.alloc(4)), indices, iend);
    await rejects(indexed, chunk("PLTE", Buffer.alloc(257 * 3)), indices, iend);
    expect(await pixels(indexed, chunk("PLTE", Buffer.alloc(256 * 3, 9)), indices, iend)).toEqual(
      Array(4).fill("090909ff"),
    );
  });

  // libspng refused such a file. This is what libpng does.
  test("the colors that the depth cannot index are not there", async () => {
    const five = chunk("PLTE", [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5]);
    const opaque = ["010101ff", "020202ff", "030303ff", "040404ff"];
    expect(await pixels(indexed, five, indices, iend)).toEqual(opaque);
    expect(await pixels(indexed, five, chunk("tRNS", [6, 7, 8, 9]), indices, iend)).toEqual([
      "01010106",
      "02020207",
      "03030308",
      "04040409",
    ]);
    // So a tRNS for all five is too long, and is passed over.
    expect(await pixels(indexed, five, chunk("tRNS", [6, 7, 8, 9, 10]), indices, iend)).toEqual(opaque);
  });

  // libspng let it replace as many entries of the first as it had.
  test("a second PLTE is refused where the pixels are indices into it", async () => {
    const first = chunk("PLTE", [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    await rejects(indexed, first, palette, indices, iend);
    await rejects(indexed, palette, chunk("abCd"), palette, indices, iend);
    expect(await pixels(rgbaHeader, first, palette, rgbaData, iend)).toEqual(["01020304"]);
  });

  // libspng held it to the rules for its length, its number and its place, which is in front of tRNS, bKGD and hIST.
  test("PLTE is not looked at where the pixels are not indices", async () => {
    for (const [colorType, channels] of [
      [GRAY, 1],
      [GRAY_ALPHA, 2],
      [RGB, 3],
      [RGBA, 4],
    ]) {
      const [first, data] = [ihdr(1, 1, 8, colorType), idat(Array(channels).fill(1))];
      const expected = await pixels(first, data, iend);
      for (const before of [
        [chunk("PLTE")],
        [chunk("PLTE", Buffer.alloc(4))],
        [chunk("PLTE", Buffer.alloc(257 * 3))],
        [palette, palette],
        // Of the length for the color type, and not the color of the pixel.
        [chunk("tRNS", Buffer.alloc(channels < 3 ? 2 : 6)), palette],
        [chunk("bKGD", Buffer.alloc(channels < 3 ? 2 : 6)), palette],
        [palette, chunk("hIST", [0, 1, 0, 2]), palette],
      ]) {
        expect([colorType, await pixels(first, ...before, data, iend)]).toEqual([colorType, expected]);
      }
    }
    // So it does not undo a tRNS in front of it either, as it did in libpng before 1.6.47.
    const transparent = chunk("tRNS", [0, 1, 0, 1, 0, 1]);
    expect(await pixels(ihdr(1, 1, 8, RGB), transparent, palette, idat([1, 1, 1]), iend)).toEqual(["01010100"]);
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

  test("only the first iCCP counts, wherever it is in front of the image", async () => {
    expect(await profile(rgbaHeader, iccpOf("one"), rgbaData, iend)).toBe("one");
    expect(await profile(rgbaHeader, iccpOf("one"), iccpOf("two"), rgbaData, iend)).toBe("one");
    // libspng passed it over behind PLTE.
    expect(await profile(rgbaHeader, palette, iccpOf("one"), rgbaData, iend)).toBe("one");
    expect(await profile(indexed, palette, iccpOf("one"), indices, iend)).toBe("one");
    // The first one counts as seen even when it is no good.
    expect(await profile(rgbaHeader, iccpOf("one", ""), iccpOf("two"), rgbaData, iend)).toBe(null);
    // An empty one does not.
    expect(await profile(rgbaHeader, chunk("iCCP"), iccpOf("two"), rgbaData, iend)).toBe("two");
  });

  test("a damaged iCCP loses the profile, not the image", async () => {
    const good = iccpOf("profile").subarray(8, -4);
    for (const [why, data] of [
      ["empty name", iccpOf("profile", "").subarray(8, -4)],
      ["80 characters", iccpOf("profile", Buffer.alloc(80, "a").toString()).subarray(8, -4)],
      ["no terminator", Buffer.from("name")],
      ["nothing after the name", Buffer.from("name\0")],
      ["compression method 1", Buffer.concat([Buffer.from("name\0\x01"), good.subarray(6)])],
      ["compression method 255", Buffer.concat([Buffer.from("name\0\xff", "latin1"), good.subarray(6)])],
      ["no stream", Buffer.from("name\0\0")],
      ["stream cut short", good.subarray(0, -5)],
      ["stream damaged", Buffer.concat([good.subarray(0, 6), Buffer.from([0xff, 0xff]), good.subarray(8)])],
      ["stream of nothing", Buffer.concat([Buffer.from("name\0\0"), zlib.deflateSync(Buffer.alloc(0))])],
    ] as const) {
      expect([why, await decode(png(rgbaHeader, chunk("iCCP", data), rgbaData, iend))]).toEqual([
        why,
        { pixels: ["01020304"], profile: null },
      ]);
    }
    // The checksum does not have to be right, nor all there. libspng wanted it there.
    const wrongChecksum = Buffer.from(good);
    wrongChecksum[wrongChecksum.length - 1] ^= 0xff;
    for (const data of [wrongChecksum, good.subarray(0, -1), good.subarray(0, -4)]) {
      expect(await profile(rgbaHeader, chunk("iCCP", data), rgbaData, iend)).toBe("profile");
    }
  });

  // libspng wanted printable Latin-1, with spaces only inside and one at a time.
  test("the name of a profile is 1 to 79 bytes of any kind", async () => {
    const bytes = Buffer.from(Array.from({ length: 255 }, (_, i) => i + 1)).toString("latin1");
    for (const name of ["a", " ", " a", "a ", "a  b", ...(bytes.match(/.{1,79}/gs) ?? [])]) {
      expect([name, await profile(rgbaHeader, iccpOf("profile", name), rgbaData, iend)]).toEqual([name, "profile"]);
    }
  });

  // libspng refused the image, and its limit was 4 bytes for each of `maxPixels`, rounded down to a power of two.
  test("a profile that a JPEG file has no room for is passed over", async () => {
    const limit = 255 * 65519;
    const withStream = (stream: Uint8Array) =>
      decode(png(rgbaHeader, chunk("iCCP", Buffer.concat([Buffer.from("name\0\0"), stream])), rgbaData, iend), {
        maxPixels: 1,
      });
    const passedOver = { pixels: ["01020304"], profile: null };
    expect((await withStream(zlib.deflateSync(Buffer.alloc(limit)))).profile?.length).toBe(limit);
    expect(await withStream(zlib.deflateSync(Buffer.alloc(limit + 1)))).toEqual(passedOver);
    // One that breaks off there is cut short, like one that breaks off anywhere.
    const open = (size: number) => zlib.deflateSync(Buffer.alloc(size), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    for (const size of [8191, 8192, 8193, 16384, limit]) {
      expect([size, await withStream(open(size))]).toEqual([size, passedOver]);
    }
  });

  test.skipIf(slow)("the largest profile that is kept can be written to a JPEG file", async () => {
    const largest = Buffer.alloc(255 * 65519, "profile").toString();
    const jpeg = await new Bun.Image(png(rgbaHeader, iccpOf(largest), rgbaData, iend)).jpeg().bytes();
    expect((await decode(jpeg)).profile === largest).toBe(true);
  });

  // libspng counted them, refused the image with more than 1000, and inflated compressed text to see how long it was.
  test("text, sPLT, eXIf, bKGD and hIST are passed over, however many and whatever is in them", async () => {
    const kinds = ["tEXt", "zTXt", "iTXt", "sPLT", "eXIf", "bKGD", "hIST"].flatMap(type => [
      chunk(type, "key\0\0not a stream"),
      chunk(type, "key\0\x01\0\0\0not a stream"),
      chunk(type, "x"),
      chunk(type),
    ]);
    const many = Array.from({ length: 2800 }, (_, i) => kinds[i % kinds.length]);
    expect(await pixels(rgbaHeader, ...many, rgbaData, iend)).toEqual(["01020304"]);
    expect(await pixels(indexed, ...many, palette, ...many, indices, iend)).toEqual([
      "0a0b0cff",
      "141516ff",
      "000000ff",
      "000000ff",
    ]);
  });
});
