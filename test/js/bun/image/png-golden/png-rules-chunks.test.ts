// The rules for the chunks in front of IDAT, one at a time, in files made by hand.
// Each of these was so with libspng too, whatever the specification says, unless it says what libspng did.
import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";
import { decode, decodes, iccpOf, idat, pixels, profile, rejects } from "./decode";
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

  test("an indexed image needs PLTE, with no more entries than the depth can index", async () => {
    await rejects(indexed, indices, iend);
    await rejects(indexed, chunk("PLTE", Buffer.alloc(5 * 3)), indices, iend);
    await rejects(indexed, chunk("PLTE", Buffer.alloc(4)), indices, iend);
    await rejects(indexed, chunk("PLTE"), indices, iend);
    expect(await pixels(rgbaHeader, chunk("PLTE", Buffer.alloc(256 * 3)), rgbaData, iend)).toEqual(["01020304"]);
    await rejects(rgbaHeader, chunk("PLTE", Buffer.alloc(257 * 3)), rgbaData, iend);
    // Whatever the depth.
    for (const colorType of [GRAY, RGB, GRAY_ALPHA, RGBA]) {
      const [first, data] = [ihdr(1, 1, 16, colorType), idat(Array(8).fill(1))];
      expect(await pixels(first, chunk("PLTE", Buffer.alloc(256 * 3)), data, iend)).toHaveLength(1);
      await rejects(first, chunk("PLTE", Buffer.alloc(257 * 3)), data, iend);
    }
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
    // They have to be as long as a pixel of 16 bits without its alpha. With alpha there is no tRNS, and where the
    // pixels are indices, neither is any good in front of PLTE.
    const lengths = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const [colorType, channels, tRNS, bKGD] of [
      [GRAY, 1, 2, 2],
      [GRAY_ALPHA, 2, 0, 2],
      [RGB, 3, 6, 6],
      [RGBA, 4, 0, 6],
      [INDEXED, 1, 0, 0],
    ]) {
      for (const [type, right] of [
        ["tRNS", tRNS],
        ["bKGD", bKGD],
      ] as const) {
        const [first, data] = [ihdr(1, 1, 8, colorType), idat(Array(channels).fill(1))];
        const found = await Promise.all(
          lengths.map(length => decodes(png(first, chunk(type, Buffer.alloc(length)), palette, data, iend))),
        );
        expect([colorType, type, found]).toEqual([colorType, type, lengths.map(length => length !== right)]);
      }
    }
    // With alpha, a tRNS that is short enough for the PLTE in front of it is passed over too.
    for (const first of [ihdr(1, 1, 8, GRAY_ALPHA), rgbaHeader]) {
      for (const length of [1, 2]) {
        const file = png(first, palette, chunk("tRNS", Buffer.alloc(length)), palette, rgbaData, iend);
        expect(await decodes(file)).toBe(true);
      }
    }
    // hIST has to be as long as the last PLTE.
    const one = chunk("PLTE", [1, 1, 1]);
    await rejects(rgbHeader, palette, one, chunk("hIST", [0, 1]), palette, rgbData, iend);
    expect(await pixels(rgbHeader, palette, one, chunk("hIST", [0, 1, 0, 2]), palette, rgbData, iend)).toEqual([
      "010203ff",
    ]);
    // Half an entry more does not count.
    await rejects(rgbHeader, palette, chunk("hIST", [0, 1, 0, 2, 0]), palette, rgbData, iend);
    for (const length of [3, 6]) {
      expect(await pixels(rgbHeader, palette, chunk("hIST", Buffer.alloc(length)), palette, rgbData, iend)).toEqual([
        "010203ff",
      ]);
    }
    // One byte is no entry, so it does not go with a PLTE of one color.
    expect(await pixels(rgbHeader, one, chunk("hIST", [1]), palette, rgbData, iend)).toEqual(["010203ff"]);
    // Without a PLTE it is passed over, though no entries are as many as no colors.
    expect(await pixels(rgbHeader, chunk("hIST", [1]), palette, rgbData, iend)).toEqual(["010203ff"]);
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
    expect(await profile(rgbaHeader, iccpOf("one"), rgbaData, iend)).toBe("one");
    expect(await profile(rgbaHeader, iccpOf("one"), iccpOf("two"), rgbaData, iend)).toBe("one");
    expect(await profile(rgbaHeader, chunk("PLTE", [1, 2, 3]), iccpOf("one"), rgbaData, iend)).toBe(null);
    // The first one counts as seen even when it is no good.
    expect(await profile(rgbaHeader, iccpOf("one", " name"), iccpOf("two"), rgbaData, iend)).toBe(null);
    // An empty one does not.
    expect(await profile(rgbaHeader, chunk("iCCP"), iccpOf("two"), rgbaData, iend)).toBe("two");
  });

  test("a damaged iCCP loses the profile, not the image", async () => {
    const good = iccpOf("profile").subarray(8, -4);
    for (const [why, data] of [
      ["empty name", iccpOf("profile", "").subarray(8, -4)],
      ["space before the name", iccpOf("profile", " a").subarray(8, -4)],
      ["space after the name", iccpOf("profile", "a ").subarray(8, -4)],
      ["two spaces", iccpOf("profile", "a  b").subarray(8, -4)],
      ["control character", iccpOf("profile", "a\x7fb").subarray(8, -4)],
      ["80 characters", iccpOf("profile", Buffer.alloc(80, "a").toString()).subarray(8, -4)],
      ["no terminator", Buffer.from("name")],
      ["nothing after the name", Buffer.from("name\0")],
      ["compression method 1", Buffer.concat([Buffer.from("name\0\x01"), good.subarray(6)])],
      ["compression method 255", Buffer.concat([Buffer.from("name\0\xff", "latin1"), good.subarray(6)])],
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
      expect(await profile(rgbaHeader, iccpOf("profile", name), rgbaData, iend)).toBe("profile");
    }
    // The checksum has to be there, not to be right.
    const wrongChecksum = Buffer.from(good);
    wrongChecksum[wrongChecksum.length - 1] ^= 0xff;
    expect(await profile(rgbaHeader, chunk("iCCP", wrongChecksum), rgbaData, iend)).toBe("profile");
  });

  // There is room for 8 KiB of what they inflate to, then for twice that, and so on up to the limit.
  test.each([
    ["iCCP", 8 << 20],
    ["zTXt", 4 << 20],
  ])("%s: a stream that breaks off where the room ends is passed over, but not at the limit", async (type, limit) => {
    const open = (size: number) => zlib.deflateSync(Buffer.alloc(size), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    const decodeWith = (stream: Uint8Array) =>
      decode(png(rgbaHeader, chunk(type, Buffer.concat([Buffer.from("name\0\0"), stream])), rgbaData, iend), {
        maxPixels: 64,
      });
    const passedOver = { pixels: ["01020304"], profile: null };
    for (const size of [8190, 8191, 8192, 8193, 16383, 16384, limit - 1]) {
      expect([size, await decodeWith(open(size))]).toEqual([size, passedOver]);
    }
    // With no room left and the end of the stream not in sight, there could be more to come.
    await expect(decodeWith(open(limit))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
    // It is not in sight before the checksum.
    await expect(decodeWith(zlib.deflateSync(Buffer.alloc(limit)).subarray(0, -4))).rejects.toMatchObject({
      code: "ERR_IMAGE_DECODE_FAILED",
    });
    // Damage is found first.
    expect(await decodeWith(Buffer.concat([open(limit), Buffer.alloc(4, 0xff)]))).toEqual(passedOver);
  });

  test("the name of a profile is printable Latin-1", async () => {
    const isPrintable = (byte: number) => (byte >= 32 && byte <= 126) || byte >= 161;
    const all = Array.from({ length: 256 }, (_, byte) => byte);
    const edges = [0, 1, 31, 32, 33, 126, 127, 128, 159, 160, 161, 255];
    // A 0 ends the name early. Then it is empty, or what follows it is not what has to.
    for (const [where, bytes, name, isAllowed] of [
      ["in the middle", all, (c: string) => `a${c}b`, isPrintable],
      ["first", edges, (c: string) => `${c}ab`, (byte: number) => isPrintable(byte) && byte !== 32],
      ["last", edges, (c: string) => `ab${c}`, (byte: number) => isPrintable(byte) && byte !== 32],
    ] as const) {
      const profiles = await Promise.all(
        bytes.map(byte => profile(rgbaHeader, iccpOf("profile", name(String.fromCharCode(byte))), rgbaData, iend)),
      );
      expect([where, bytes.filter((_, i) => profiles[i] === "profile")]).toEqual([where, bytes.filter(isAllowed)]);
    }
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
    const file = (size: number) => png(rgbaHeader, iccpOf(Buffer.alloc(size, "p").toString()), rgbaData, iend);
    const over = file((8 << 20) + 1);
    // 8 MiB is the least the limit can be.
    expect((await decode(file(8 << 20), { maxPixels: 64 })).profile?.length).toBe(8 << 20);
    expect(await decodes(over, { maxPixels: 64 })).toBe(false);
    expect((await decode(over)).profile?.length).toBe((8 << 20) + 1);
    // Otherwise it is 4 bytes for each of `maxPixels`, rounded down to a power of two.
    expect(await decodes(over, { maxPixels: (4 << 20) - 1 })).toBe(false);
    expect((await decode(over, { maxPixels: 4 << 20 })).profile?.length).toBe((8 << 20) + 1);
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
        ["iTXt", "key\0\0\0en\0word\0"],
        ["iTXt", "key\0\x02\0en\0word\0"],
        ["iTXt", "key\0\xff\0en\0word\0"],
        ["iTXt", "key\0\x01\x01en\0word\0"],
        ["iTXt", "key\0\x01\xffen\0word\0"],
        ["zTXt", "key\0\x01"],
        ["zTXt", "key\0\xff"],
      ]) {
        expect((await decode(withText(type, before, big), { maxPixels: 64 })).pixels).toEqual(["01020304"]);
      }
    });

    describe("may inflate to a byte less than a profile, rounded down to a power of two", () => {
      // So many MiB of zeros and one byte more. Nobody looks at the checksum.
      const piece = zlib.deflateRawSync(Buffer.alloc(1 << 20), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      const decodesOver = (mib: number, maxPixels?: number) => {
        const stream = [
          Buffer.from([0x78, 0x9c]),
          ...Array(mib).fill(piece),
          zlib.deflateRawSync("\0"),
          Buffer.alloc(4),
        ];
        return decodes(withText("zTXt", "key\0\0", Buffer.concat(stream)), { maxPixels });
      };

      test("of 4 bytes for each of maxPixels", async () => {
        for (const mib of [4, 8]) {
          // Twice as many MiB, where a profile of as much is taken.
          const maxPixels = ((2 * mib) << 20) / 4;
          expect([mib, await decodesOver(mib, maxPixels)]).toEqual([mib, false]);
          expect([mib, await decodesOver(mib, maxPixels + 1)]).toEqual([mib, true]);
        }
      });

      test("which is 512 MiB by default and 1 GiB at the most", async () => {
        expect(await decodesOver(256)).toBe(true);
        expect(await decodesOver(512)).toBe(false);
        expect(await decodesOver(512, 1e15)).toBe(true);
        expect(await decodesOver(1024, 1e15)).toBe(false);
      });
    });

    test("is inflated only where its own kind has it", async () => {
      const layouts = ["key\0", "key\0\0", "key\0\x01\0\0\0", "key\0\0\0\0\0", "key\0\x01\0en\0word\0"];
      for (const [type, ...inflated] of [["tEXt"], ["zTXt", layouts[1]], ["iTXt", layouts[2], layouts[4]]]) {
        const found = await Promise.all(layouts.map(before => decodes(withText(type, before, big), { maxPixels: 64 })));
        expect([type, found]).toEqual([type, layouts.map(layout => !inflated.includes(layout))]);
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
