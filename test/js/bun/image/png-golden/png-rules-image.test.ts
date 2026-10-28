// The rules for IHDR and IDAT, one at a time, in files made by hand.
// Each of these was so with libspng too, whatever the specification says, unless it says what libspng did.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import zlib from "node:zlib";
import { differences } from "../../archive-golden/observe";
import { slow } from "./check";
import { decode, decodes, decodeToHex, iccpOf, idat, pixels, rejects } from "./decode";
import {
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

  /** What an image with this IHDR is refused with. */
  const code = (...fields: Parameters<typeof ihdr>) =>
    decode(png(ihdr(...fields), idat([0]), iend)).catch(error => error.code);

  test("a row of 2^32 - 1 bytes is too long, however many pixels are allowed", async () => {
    expect(await code(1431655764, 1, 8, RGB)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await code(1431655765, 1, 8, RGB)).toBe("ERR_IMAGE_DECODE_FAILED");
    // 2^32 - 2 bytes.
    expect(await code(2 ** 31 - 1, 1, 16, GRAY)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    // The last pass has all the pixels of a row, but it has no row in an image that is one pixel high.
    expect(await code(2 ** 31 - 1, 1, 8, RGB, 1)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await code(2 ** 31 - 1, 2, 8, RGB, 1)).toBe("ERR_IMAGE_DECODE_FAILED");
  });

  // As RGBA it has to fit in 32 bits too. What is refused for that would be refused for its short IDAT as well, unless
  // the pixels are more than any machine has room for, which is found out in between.
  test("a row of 2^30 pixels is too long", async () => {
    const files = [2 ** 30 - 1, 2 ** 30].map(width => png(ihdr(width, 2 ** 19, 1, GRAY), idat([0]), iend));
    await using child = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `for (const file of process.env.FILES.split(" ")) {
          const image = new Bun.Image(Buffer.from(file, "base64"), { maxPixels: 1e15 });
          console.log(await image.png().bytes().then(() => "decoded", error => error.code));
        }`,
      ],
      env: {
        ...bunEnv,
        FILES: files.map(file => file.toString("base64")).join(" "),
        // Or it ends the process.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1"].filter(Boolean).join(":"),
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    // It warns of the allocation.
    expect({ stdout, exitCode, stderr: exitCode ? stderr : "" }).toEqual({
      stdout: "ERR_OUT_OF_MEMORY\nERR_IMAGE_DECODE_FAILED\n",
      exitCode: 0,
      stderr: "",
    });
  });

  test("a width or a height has 31 bits, and is not 0", async () => {
    expect(await code(2 ** 31 - 1, 1, 1, GRAY)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await code(1, 2 ** 31 - 1, 1, GRAY)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await code(2 ** 31, 1, 1, GRAY)).toBe("ERR_IMAGE_DECODE_FAILED");
    expect(await code(1, 2 ** 31, 1, GRAY)).toBe("ERR_IMAGE_DECODE_FAILED");
    expect(await code(0, 1, 1, GRAY)).toBe("ERR_IMAGE_DECODE_FAILED");
    expect(await code(1, 0, 1, GRAY)).toBe("ERR_IMAGE_DECODE_FAILED");
  });

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

  // The row above is looked at a block at a time. The one byte that is not what its left neighbor has can be the first
  // of a block or the last.
  const block = 48;
  const busy = 5 * block;
  test("the blocks are as long as the next two tests and the files in generated.json.gz take them to be", async () => {
    const source = await Bun.file(join(import.meta.dir, "../../../../../src/png/filter.rs")).text();
    expect(source).toContain(`const BLOCK: usize = ${block};`);
    expect(source).toContain("const BUSY_LEN: usize = 5 * BLOCK;");
  });
  test.each([
    ["from the start", 0],
    // From the start of a block that is not one pixel over and over, so much goes by until the next look.
    ["but for the first", busy],
  ])("Paeth under a row that is one pixel %s, and from somewhere on another in one byte", async (_, skipped) => {
    const wrong = await Promise.all(
      pixelFormats.map(async format => {
        const bpp = (format[1] * format[2]) / 8;
        // RGB is made RGBA before the looking, which starts behind the first pixel.
        const size = bpp === 3 ? 4 : bpp;
        const first = 1 + skipped / size;
        // Only a whole block is looked at, so the third has to be one for a change at its start to count.
        const width = first + (3 * block) / size + 3;
        const changes: number[][] = [];
        for (let x = first; x < first + (2 * block) / size + 3; x++) {
          // Of 16 bits only the first 8 are to be seen.
          for (let byte = 0; byte < bpp; byte += format[1] / 8) {
            // Where that takes too long, up to a pixel and a byte to either side of where a block starts.
            if (!slow || (x * size + byte + 1) % block <= 2 * size + 1) changes.push([x, byte]);
          }
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
            return 100 + byte + (skipped && x === 0 ? 25 : 0) + (x >= from && byte === changed ? 50 : 0);
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
