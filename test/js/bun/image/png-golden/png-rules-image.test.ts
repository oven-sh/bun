// The rules for IHDR and IDAT, one at a time, in files made by hand.
// A comment says so where libspng did otherwise.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import zlib from "node:zlib";
import { differences } from "../../archive-golden/observe";
import { aheadLength, decoded, linesAtATime } from "./check";
import { decode, decodes, decodeToHex, iccpOf, idat, pixels, rejects } from "./decode";
import {
  adam7,
  chunk,
  filteredLines,
  formats,
  GRAY,
  GRAY_ALPHA,
  iend,
  ihdr,
  noise,
  paeth,
  png,
  randomBytes,
  RGB,
  RGBA,
  rgbaOf,
  write,
} from "./write";

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

  // The same rows in a stored block that is not the last, and nothing behind it.
  const unfinished = Buffer.from([0x78, 0x01, 0x00, 6, 0, ~6 & 255, 255, 0, 1, 2, 0, 3, 4]);

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
    expect(await pixels(header, chunk("IDAT", unfinished), iend)).toEqual(expected);
  });

  // As with libspng, and as in libpng.
  test("but zlib goes on by itself to the next block, if it has been given that much of the stream", async () => {
    // There is no such block as this.
    const badBlock = Buffer.from([0xff]);
    await rejects(header, chunk("IDAT", Buffer.concat([unfinished, badBlock])), iend);
    expect(await pixels(header, chunk("IDAT", unfinished), chunk("IDAT", badBlock), iend)).toEqual(expected);
  });

  // libspng read the chunks after IDAT when asked for the profile, and gave none if they were bad or missing.
  test("the color profile does not depend on what follows the image", async () => {
    const start = [ihdr(1, 1, 8, RGBA), iccpOf("profile"), idat([1, 2, 3, 4])];
    const expected = { pixels: ["01020304"], profile: "profile" };
    expect(await decode(png(...start, iend))).toEqual(expected);
    expect(await decode(png(...start))).toEqual(expected);
    expect(await decode(png(...start).subarray(0, -4))).toEqual(expected);
    expect(await decode(png(...start, chunk("JUNK"), iend))).toEqual(expected);
    expect(await decode(png(...start, chunk("tEXt", "a\0b"), idat([1, 2, 3, 4]), iend))).toEqual(expected);
    expect(await decode(png(...start, chunk("IEND", "not empty")))).toEqual(expected);
  });

  test("as many pixels as maxPixels, and no more", async () => {
    for (const [width, height] of [
      [1, 1],
      [3, 2],
      [1, 17],
      [11, 7],
    ]) {
      const file = png(ihdr(width, height, 8, GRAY), idat(...Array(height).fill(Array(width).fill(7))), iend);
      expect(await decode(file, { maxPixels: width * height - 1 }).catch(error => error.code)).toBe(
        "ERR_IMAGE_TOO_MANY_PIXELS",
      );
      expect((await decode(file, { maxPixels: width * height })).pixels).toEqual(
        Array(width * height).fill("070707ff"),
      );
    }
  });

  /** What an image with this IHDR is refused with. */
  const code = (...fields: Parameters<typeof ihdr>) =>
    decode(png(ihdr(...fields), idat([0]), iend)).catch(error => error.code);

  test("a row has to fit in 32 bits, in the file and as RGBA", async () => {
    // Without IDAT, so that there is no memory to find for a header that passes.
    const withoutLimit = (width: number, depth: number, colorType: number) =>
      decode(png(ihdr(width, 1, depth, colorType), iend), { maxPixels: 2 ** 40 }).catch(error => error.code);
    for (const [colorType, depth, bytes] of [
      [GRAY, 1, 4],
      [RGB, 8, 4],
      [RGBA, 8, 4],
      [RGB, 16, 6],
      [RGBA, 16, 8],
    ]) {
      const tooWide = Math.ceil((2 ** 32 - 1) / bytes);
      expect([bytes, await withoutLimit(tooWide - 1, depth, colorType)]).toEqual([bytes, "ERR_IMAGE_DECODE_FAILED"]);
      expect([bytes, await withoutLimit(tooWide, depth, colorType)]).toEqual([bytes, "ERR_IMAGE_TOO_MANY_PIXELS"]);
    }
    expect(await withoutLimit(2 ** 31 - 1, 1, GRAY)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    // metadata(), which reads IHDR by itself, calls it the same.
    const wide = png(ihdr(2 ** 30, 1, 1, GRAY), idat([0]), iend);
    expect(await decode(wide).catch(error => error.code)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await new Bun.Image(wide).metadata().catch(error => error.code)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
  });

  test("width and height have 31 bits, and neither is 0", async () => {
    expect(await code(1, 2 ** 31 - 1, 1, GRAY)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await code(1, 2 ** 31, 1, GRAY)).toBe("ERR_IMAGE_DECODE_FAILED");
    expect(await code(2 ** 31 - 1, 1, 1, GRAY)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await code(2 ** 31, 1, 1, GRAY)).toBe("ERR_IMAGE_DECODE_FAILED");
    expect(await code(0, 1, 1, GRAY)).toBe("ERR_IMAGE_DECODE_FAILED");
    expect(await code(1, 0, 1, GRAY)).toBe("ERR_IMAGE_DECODE_FAILED");
  });

  // 8-bit RGBA makes room for itself.
  test.concurrent.each([
    ["gray", GRAY, 1],
    ["RGBA", RGBA, 8],
  ])(
    "pixels that no machine has room for are out of memory, and not the end of the process: %s",
    async (_, ...format) => {
      const file = png(ihdr(2 ** 30 - 1, 2 ** 19, format[1], format[0]), idat([0]), iend);
      await using child = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const image = new Bun.Image(Buffer.from(process.env.FILE, "base64"), { maxPixels: 1e15 });
        console.log(await image.png().bytes().then(() => "decoded", error => error.code));`,
        ],
        env: {
          ...bunEnv,
          FILE: file.toString("base64"),
          // Or it ends the process.
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1"].filter(Boolean).join(":"),
        },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      // It warns of the allocation.
      expect({ stdout, exitCode, stderr: exitCode ? stderr : "" }).toEqual({
        stdout: "ERR_OUT_OF_MEMORY\n",
        exitCode: 0,
        stderr: "",
      });
    },
  );

  // What follows IHDR is enough for any of them.
  const rest = [chunk("PLTE", [1, 2, 3, 4, 5, 6]), chunk("IDAT", zlib.deflateSync(Buffer.alloc(1 + 8))), iend];
  const decodesWith = (...chunks: Buffer[]) => decodes(png(...chunks, ...rest));

  test("there are 15 pairs of color type and bit depth", async () => {
    const some = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17, 24, 32, 64, 128, 255];
    const pairs = some.flatMap(colorType => some.map(depth => [colorType, depth]));
    const found = await Promise.all(pairs.map(([colorType, depth]) => decodesWith(ihdr(1, 1, depth, colorType))));
    expect(pairs.filter((_, i) => found[i]).map(pair => pair.join(" "))).toEqual(
      formats.map(([colorType, depth]) => `${colorType} ${depth}`),
    );
  });

  test("IHDR comes first, has 13 bytes, and one way to compress, one to filter and two to interlace", async () => {
    const fields = ihdr(1, 1, 8, RGB).subarray(8, -4);
    expect(await decodesWith(chunk("IHDR", fields))).toBe(true);
    for (const [at, allowed] of [
      [10, 1],
      [11, 1],
      [12, 2],
    ]) {
      const values = Array.from({ length: 256 }, (_, value) => value);
      const found = await Promise.all(values.map(value => decodesWith(chunk("IHDR", fields.with(at, value)))));
      expect([at, values.filter(value => found[value])]).toEqual([at, values.slice(0, allowed)]);
    }
    expect(await decodesWith(chunk("IHDR", fields.subarray(0, 12)))).toBe(false);
    expect(await decodesWith(chunk("IHDR", [...fields, 0]))).toBe(false);
    // Nor may it say so with 13 bytes there.
    for (const length of [0, 12, 14, 2 ** 31 - 1]) {
      const lying = chunk("IHDR", fields);
      lying.writeUInt32BE(length);
      expect([length, await decodesWith(lying)]).toEqual([length, false]);
    }
    for (const type of ["IHDr", "iHDR", "IDAT", "tEXt"])
      expect([type, await decodesWith(chunk(type, fields))]).toEqual([type, false]);
    expect(await decodesWith(chunk("tEXt", "a\0b"), chunk("IHDR", fields))).toBe(false);
  });

  test("a filter that does not exist, a stream that is not zlib's, or no IDAT at all is refused", async () => {
    await rejects(header, chunk("IDAT", zlib.deflateSync(Buffer.from([0, 1, 2, 5, 3, 4]))), iend);
    await rejects(header, chunk("IDAT", zlib.deflateSync(Buffer.from([5, 1, 2, 0, 3, 4]))), iend);
    await rejects(header, chunk("IDAT", zlib.deflateRawSync(Buffer.from([0, 1, 2, 0, 3, 4]))), iend);
    await rejects(header, iend);
  });

  // zlib's rule, as Bun builds it. libpng has it too, and some decoders do not.
  test("a stream copies from no further back than the window in its header", async () => {
    const row = [0, ...Array.from({ length: 299 }, randomBytes(6))];
    const withWindow = (bits: number) => {
      const stream = zlib.deflateSync(Buffer.from([...row, ...row]));
      stream[0] = ((bits - 8) << 4) | 8;
      stream[1] = 31 - ((stream[0] << 8) % 31);
      return decodes(png(ihdr(299, 2, 8, GRAY), chunk("IDAT", stream), iend));
    };
    expect(await withWindow(9)).toBe(true);
    expect(await withWindow(8)).toBe(false);
  });

  // Which of the seven passes have no pixels depends on the width and on the height.
  test("interlaced, in every size up to 8 by 8", async () => {
    const random = randomBytes(4);
    const wrong: string[] = [];
    await Promise.all(
      [[GRAY, 1] as const, [RGB, 8] as const].flatMap(format =>
        Array.from({ length: 64 }, async (_, i) => {
          const picture = noise(format, 1 + (i % 8), 1 + (i >> 3), random);
          const file = write(picture, { interlaced: true, filter: () => random() % 5 });
          if ((await decodeToHex(file)).hex !== rgbaOf(picture).toString("hex"))
            wrong.push(`${format}, ${picture.width} by ${picture.height}`);
        }),
      ),
    );
    expect(wrong).toEqual([]);
  });

  test("as much is inflated at a time as the tests take it to be", async () => {
    const source = await Bun.file(join(import.meta.dir, "../../../../../src/png/decoder.rs")).text();
    expect(source).toContain(`const AHEAD_LEN: usize = ${aheadLength / 1024} * 1024;`);
    expect(source).toContain("pass.row_bytes < AHEAD_LEN / 2");
  });

  // 8-bit RGBA, not interlaced, is inflated in whole lines to the end of the image. The rest, to a buffer if two fit.
  test("few lines, many lines, short ones, long ones, and both in one image", async () => {
    // A row is one value all the way. The values repeat after a prime number of rows, where no later batch begins.
    const period = 251;
    const value = (y: number) => ((y % period) * 37 + 11) & 255;
    const rows = (count: number, row: (i: number) => Buffer[]) => {
      const some = Buffer.concat(Array.from({ length: Math.min(count, period) }, (_, i) => row(i)).flat());
      return Buffer.alloc((some.length / Math.min(count, period)) * count, some);
    };
    const check = async (format: readonly [number, number], width: number, height: number, interlaced = false) => {
      const [colorType, depth] = format;
      const bpp = ((colorType === GRAY ? 1 : colorType === RGB ? 3 : 4) * depth) / 8;
      const lines = (interlaced ? adam7 : [[0, 0, 1, 1]])
        .filter(([x0, y0]) => x0 < width && y0 < height)
        .map(([x0, y0, dx, dy]) =>
          // All but the first of a period are Up, so each takes the row before it to be right, wherever that came from.
          rows(Math.ceil((height - y0) / dy), i => [
            Buffer.from([i ? 2 : 0]),
            Buffer.alloc(Math.ceil((width - x0) / dx) * bpp, value(y0 + i * dy) - (i ? value(y0 + (i - 1) * dy) : 0)),
          ]),
        );
      // Stored if the height is even, and in seven chunks.
      const stream = zlib.deflateSync(Buffer.concat(lines), { level: height & 1 });
      const part = Math.ceil(stream.length / 7);
      const idats = Array.from({ length: 7 }, (_, i) => chunk("IDAT", stream.subarray(i * part, (i + 1) * part)));
      const file = png(ihdr(width, height, depth, colorType, interlaced ? 1 : 0), ...idats, iend);
      const expected = rows(height, y => [
        Buffer.alloc(1),
        Buffer.alloc(width * 4, Buffer.from([value(y), value(y), value(y), colorType === RGBA ? value(y) : 255])),
      ]);
      const fault = await decoded(file).then(
        ({ lines }) => (expected.equals(lines) ? "" : "other pixels"),
        error => error.code ?? String(error),
      );
      return fault ? [`${format}, ${width} by ${height}${interlaced ? ", interlaced" : ""}: ${fault}`] : [];
    };
    const [gray, rgb, rgba, rgba16] = [
      [GRAY, 8],
      [RGB, 8],
      [RGBA, 8],
      [RGBA, 16],
    ] as const;
    /** As many lines of so many bytes as are inflated at a time, and some more or less. */
    const heights = (line: number, ...more: number[]) => more.map(more => linesAtATime(line) + more);
    const wrong = await Promise.all([
      ...heights(64, -1, 0, 1, aheadLength / 64 + 1).map(height => check(gray, 63, height)),
      ...heights(301, 0, 1).map(height => check(rgb, 100, height)),
      ...heights(401, -1, 0, 1, 2).map(height => check(rgba, 100, height)),
      ...heights(5, -1, 0, 1).map(height => check(rgba, 1, height)),
      // Two lines of RGBA at a time, one because two are too much, one that alone is too much.
      ...[aheadLength / 8 - 1, aheadLength / 8, aheadLength / 4].flatMap(width =>
        [1, 2, 3, 4].map(height => check(rgba, width, height)),
      ),
      // The longest line of which two fit in the buffer, and the shortest of which they do not.
      ...[aheadLength / 2 - 1, aheadLength / 2].flatMap(width => [4, 5].map(height => check(gray, width, height))),
      ...[Math.floor(aheadLength / 6), Math.ceil(aheadLength / 6)].map(width => check(rgb, width, 5)),
      // They do in all seven passes, or in all but the last, the last three or the last five.
      ...[1 / 32, 1 / 16, 1 / 8, 1 / 4].flatMap(part =>
        [5, 6, 9].map(height => check(rgba16, aheadLength * part, height, true)),
      ),
      check(rgb, Math.ceil(aheadLength / 6), 9, true),
      check(rgba, aheadLength / 8, 9, true),
    ]);
    expect(wrong.flat()).toEqual([]);
  });

  // One for each way the decoder reads rows.
  test.each([
    ["RGBA, 8 bits", [RGBA, 8], 0],
    ["RGB, 8 bits", [RGB, 8], 0],
    ["gray, 4 bits", [GRAY, 4], 0],
    ["RGB, 8 bits, interlaced", [RGB, 8], 1],
    ["gray with alpha, 16 bits, interlaced", [GRAY_ALPHA, 16], 1],
  ] as const)("%s: a stream that ends anywhere before the last byte is refused", async (_, format, interlace) => {
    const lines = filteredLines(noise(format, 5, 3, randomBytes(3)), { interlaced: interlace === 1 });
    const stored = zlib.deflateSync(lines, { level: 0 });
    const streams = [
      ...Array.from(lines, (_, length) => zlib.deflateSync(lines.subarray(0, length))),
      // One that breaks off. Stored, it has 7 bytes in front of the rows.
      ...Array.from({ length: 7 + lines.length }, (_, length) => stored.subarray(0, length)),
    ];
    const codes = await Promise.all(
      streams.map(stream =>
        decode(png(ihdr(5, 3, format[1], format[0], interlace), chunk("IDAT", stream), iend)).then(
          () => "decoded",
          error => error.code,
        ),
      ),
    );
    expect(codes).toEqual(streams.map(() => "ERR_IMAGE_DECODE_FAILED"));
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

  test("every filter, for every size of pixel, in rows of every length up to 72 bytes", async () => {
    // Twice each, so that each also comes after a row that is not zeros.
    const filters = [4, 3, 2, 1, 0, 1, 2, 3, 4, 0];
    const random = randomBytes(1);
    await expectToDecode(
      pixelFormats.flatMap(format =>
        Array.from({ length: Math.ceil((72 * 8) / (format[1] * format[2])) }, (_, i) =>
          filteredImage(format, i + 1, filters, random),
        ),
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
    for (let d = -255; d <= 255; d += 3) {
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

  // The row above is looked at a block at a time. The one byte that is not what its left neighbor has can be the first
  // of a block or the last.
  const block = 16;
  const busy = 4 * block;
  test("the blocks are as long as the tests below take them to be", async () => {
    const source = await Bun.file(join(import.meta.dir, "../../../../../src/jsc/bindings/highway_png.cpp")).text();
    expect(source).toContain(`constexpr size_t kBlock = ${block};`);
    expect(source).toContain("constexpr size_t kBusy = 4 * kBlock;");
  });
  test.each([
    // From the start of the row, or of a block that is not one pixel over and over, so much goes by until the next
    // look.
    ["all the way", busy],
    ["but for where the first look is", 2 * busy],
  ])("Paeth under a row that is one pixel %s, and from somewhere on another in one byte", async (_, look) => {
    const wrong = await Promise.all(
      pixelFormats.map(async format => {
        const bpp = (format[1] * format[2]) / 8;
        // RGB is made RGBA before the looking.
        const size = bpp === 3 ? 4 : bpp;
        const first = Math.floor(look / size);
        // Only a whole block is looked at, so the third has to be one for a change at its start to count.
        const width = first + Math.ceil((3 * block) / size) + 3;
        const changes: number[][] = [];
        for (let x = first - 2; x < first + Math.ceil((2 * block) / size) + 3; x++) {
          // Of 16 bits only the first 8 are to be seen.
          for (let byte = 0; byte < bpp; byte += format[1] / 8) changes.push([x, byte]);
        }
        let at = 0;
        // A row for each byte that changes, and under it the same row again, which in Paeth is zeros.
        const { name, file, expected } = filteredImage(
          format,
          width,
          changes.flatMap(() => [0, 4]),
          () => {
            const [row, i] = [Math.floor(at / (width * bpp)), at++ % (width * bpp)];
            if (row % 2 === 1) return 0;
            const [x, byte] = [Math.floor(i / bpp), i % bpp];
            const [from, changed] = changes[row >> 1];
            const odd = look !== busy && x === Math.floor(busy / size);
            return 100 + byte + (odd ? 25 : 0) + (x >= from && byte === changed ? 50 : 0);
          },
        );
        const { hex } = await decodeToHex(file);
        const twoRows = (all: string, i: number) => all.slice(i * width * 16, (i + 1) * width * 16);
        return changes
          .filter((_, i) => twoRows(hex, i) !== twoRows(expected, i))
          .map(([x, byte]) => `${name}: byte ${byte} of pixel ${x}`);
      }),
    );
    expect(wrong.flat()).toEqual([]);
  });

  test("Paeth looks for one pixel over and over in the row above, and not in the row itself", async () => {
    const random = randomBytes(4);
    const length = busy + 3 * block;
    await expectToDecode(
      pixelFormats
        // The pixels that a block holds whole. Not RGB, which gets an alpha of 0 while it is filtered and of 255 after.
        .filter(format => block % ((format[1] * format[2]) / 8) === 0)
        .map(format => {
          const bpp = (format[1] * format[2]) / 8;
          const unfiltered = new Uint8Array(length);
          let at = 0;
          return filteredImage(format, length / bpp, [0, 4], predicted => {
            const [row, i] = [Math.floor(at / length), at++ % length];
            const start = i - (i % block);
            let filtered = random();
            // The row above is noise, but for zeros from two pixels in front of the first look to the end of its block.
            if (row === 0 && i >= busy - 2 * bpp && i < busy + block) filtered = 0;
            // Under the first of them is a zero too, so the pixel in front of the look is the same filtered or not.
            if (row === 1 && i >= busy - 2 * bpp && i < busy - bpp) filtered = -predicted;
            // That block and the next repeat the pixel in front of them, as long as they are filtered and it is not.
            if (row === 1 && (start === busy || start === busy + block)) filtered = unfiltered[start - bpp + (i % bpp)];
            unfiltered[i] = filtered + predicted;
            return filtered;
          });
        }),
    );
  });

  test("Paeth under a row that is the same pixel over and over in places", async () => {
    const random = randomBytes(2);
    // None, so the bytes are the row: first stretches of one pixel, of two or three taking turns and of noise, then
    // one pixel all the way, then bytes that come again one sooner than a pixel would, and one later. Under Paeth,
    // zeros keep what the row above has and anything else breaks it up.
    const filters = [0, 4, 4, 0, 4, 4, 0, 4, 0, 4];
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
              const pixels = [1, 1, 1, 2, 3, 200][row === 0 ? random() % 6 : 0];
              const length = bpp * pixels + (row === 6 ? -1 : row === 8 ? 1 : 0);
              pattern = Array.from({ length: Math.max(1, length) }, random);
            }
            return pattern[--left % pattern.length];
          });
        });
      }),
    );
  });
});
