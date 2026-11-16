// The rules of the container and of the ALPH chunk one at a time, in files made by hand, and what holds for every file
// that Bun.Image writes. https://www.rfc-editor.org/rfc/rfc9649
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, emptyProcessMaxRSS, isASAN, runFixtureMaxRSS } from "harness";
import { decoded, slow } from "../png-golden/check";
import { decode, decodes, decodeToHex } from "../png-golden/decode";
import { randomBytes } from "../png-golden/write";
import { encode, pngOf } from "./observe";

function chunk(tag: string, data: Uint8Array | number[] | string = [], length?: number) {
  const body = Buffer.from(data as Uint8Array);
  const out = Buffer.alloc(8 + body.length + (body.length & 1));
  out.write(tag, "latin1");
  out.writeUInt32LE(length ?? body.length, 4);
  out.set(body, 8);
  return out;
}
const riff = (...chunks: Buffer[]) => chunk("RIFF", Buffer.concat([Buffer.from("WEBP"), ...chunks]));

const [PROFILE, ALPHA, ANIMATION] = [0x20, 0x10, 0x02];
function vp8x(flags: number, width: number, height: number) {
  const data = Buffer.alloc(10);
  data[0] = flags;
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return chunk("VP8X", data);
}

/** Pairs of a value and its number of bits. */
function bits(...fields: [number, number][]) {
  let [all, length] = [0n, 0n];
  for (const [value, count] of fields) [all, length] = [all | (BigInt(value) << length), length + BigInt(count)];
  return Array.from({ length: Number((length + 7n) / 8n) }, (_, i) => Number((all >> BigInt(8 * i)) & 255n));
}
/** No transform, no color cache, one group of prefix codes that have one symbol each. The pixels take no bits. */
const oneColor = (r: number, g: number, b: number, a: number) =>
  [[0, 3], ...[g, r, b, a, 0].map(symbol => [0b101 | (symbol << 3), 11])] as [number, number][];
/** The pixels take one bit each. */
const twoGreens = oneColor(1, 2, 3, 4).with(1, [0b111 | (0 << 3) | (1 << 11), 19]);
/** Its 256 colors are stored like a picture that has no use for transforms and groups. */
const palette = [[0b111, 3], [255, 8], [0, 1], ...oneColor(1, 1, 1, 1).slice(1)] as [number, number][];
const vp8l = (width: number, height: number, version = 0) =>
  chunk("VP8L", bits([0x2f, 8], [width - 1, 14], [height - 1, 14], [0, 1], [version, 3], ...oneColor(1, 2, 3, 4)));

function* chunksOf(file: Uint8Array) {
  const bytes = Buffer.from(file);
  for (let at = 12; at < bytes.length;) {
    const length = bytes.readUInt32LE(at + 4);
    yield { tag: bytes.toString("latin1", at, at + 4), data: bytes.subarray(at + 8, at + 8 + length) };
    at += 8 + length + (length & 1);
  }
}
const black = async (width: number, height: number) =>
  Buffer.from(await encode(pngOf(width, height, Buffer.alloc(width * height * 4, Buffer.of(0, 0, 0, 255))), "100"));
const vp8 = async (width: number, height: number) => (await black(width, height)).subarray(12);

const size = (file: Uint8Array, maxPixels?: number) =>
  new Bun.Image(file, { maxPixels }).metadata().then(
    it => `${it.width}x${it.height}`,
    error => error.code,
  );
const FAILED = "ERR_IMAGE_DECODE_FAILED";

describe("the container", () => {
  const image = vp8l(2, 1);
  const pixels = ["01020304", "01020304"];
  const header = vp8x(PROFILE, 2, 1);
  const profile = async (...chunks: Buffer[]) => {
    const result = await decode(riff(...chunks));
    expect(result.pixels).toEqual(pixels);
    return result.profile;
  };

  test("the profile is the first ICCP chunk, wherever it is", async () => {
    expect(await profile(header, chunk("ICCP", "even"), image)).toBe("even");
    expect(await profile(header, chunk("ICCP", "odd"), image)).toBe("odd");
    expect(await profile(header, image, chunk("ICCP", "late"))).toBe("late");
    expect(await profile(header, chunk("JUNK", "x"), chunk("ICCP", "one"), chunk("ICCP", "two"), image)).toBe("one");
  });

  test("there is none if it is empty, missing, cut short, not announced or outside of the RIFF chunk", async () => {
    expect(await profile(header, chunk("ICCP"), chunk("ICCP", "two"), image)).toBe(null);
    expect(await profile(header, image)).toBe(null);
    expect(await profile(header, image, chunk("ICCP", "half", 8))).toBe(null);
    expect(await profile(header, image, chunk("JUNK", "half", 8), chunk("ICCP"))).toBe(null);
    expect(await profile(vp8x(~PROFILE & ~ANIMATION & 255, 2, 1), chunk("ICCP", "a"), image)).toBe(null);
    expect(await profile(image, chunk("ICCP", "a"))).toBe(null);
    expect(await decode(Buffer.concat([riff(header, image), chunk("ICCP", "a")]))).toEqual({ pixels, profile: null });
  });

  // libwebp had a second parser for the profile, which gave up on these.
  test("what does not keep the pixels from being decoded does not cost the profile either", async () => {
    const iccp = chunk("ICCP", "kept");
    expect(await profile(header, iccp, image, image)).toBe("kept");
    expect(await profile(header, iccp, header, image)).toBe("kept");
    expect(await profile(header, iccp, chunk("ALPH", "a"), image)).toBe("kept");
    expect(await profile(header, iccp, image, Buffer.alloc(4))).toBe("kept");
    expect(await profile(vp8x(PROFILE | 0x81, 2, 1), iccp, image)).toBe("kept");
  });

  test("the canvas is the size of the image", async () => {
    for (const other of [vp8x(0, 1, 1), vp8x(0, 3, 1), vp8x(0, 2, 2), vp8x(0, 1, 2)]) {
      expect(await size(riff(other, image))).toBe(FAILED);
      expect(await decodes(riff(other, image))).toBe(false);
    }
  });

  test("VP8X has 10 bytes, comes first, and is needed for anything in front of the image", async () => {
    expect(await size(riff(chunk("VP8X", [...header.subarray(8), 0, 0]), image))).toBe(FAILED);
    expect(await size(riff(chunk("VP8X", header.subarray(8, 16)), image))).toBe(FAILED);
    expect(await size(riff(chunk("JUNK"), image))).toBe(FAILED);
    expect(await size(riff(chunk("JUNK"), header, image))).toBe(FAILED);
  });

  test("an animation has a size, and is not decoded", async () => {
    const file = riff(vp8x(ANIMATION, 70000, 3), chunk("ANIM", Buffer.alloc(6)), image);
    expect(await size(file)).toBe("70000x3");
    expect(await decodes(file)).toBe(false);
    expect(await size(riff(vp8x(ANIMATION, 65535, 65537)), 2 ** 40)).toBe("65535x65537");
    expect(await size(riff(vp8x(ANIMATION, 65536, 65536)), 2 ** 40)).toBe(FAILED);
  });

  test("the start of a file has a size as soon as that is there, and is not decoded", async () => {
    for (const [file, enough] of [
      [riff(image), 25],
      [await black(2, 1), 30],
      [riff(header, chunk("ICCP", "abc"), image), 30],
    ] as const) {
      for (let length = 12; length < file.length; length++) {
        const start = file.subarray(0, length);
        expect([length, await size(start), await decodes(start)]).toEqual([
          length,
          length < enough ? FAILED : "2x1",
          false,
        ]);
      }
    }
  });

  test("the chunks up to the image fit the RIFF chunk", async () => {
    for (const whole of [riff(image), riff(header, chunk("JUNK", "abc"), image)]) {
      const file = Buffer.from(whole);
      file.writeUInt32LE(file.length - 8 - 2, 4);
      expect(await size(file)).toBe(FAILED);
    }
    for (const length of [2 ** 31, 2 ** 32 - 11, 2 ** 32 - 10, 2 ** 32 - 1]) {
      expect(await size(riff(header, chunk("JUNK", [], length), image))).toBe(FAILED);
    }
  });

  test("VP8X has a size even if it does not fit", async () => {
    const file = riff(header);
    file.writeUInt32LE(12, 4);
    expect(await size(file)).toBe("2x1");
    expect(await size(Buffer.concat([file, chunk("JUNK")]))).toBe(FAILED);
    file.writeUInt32LE(11, 4);
    expect(await size(file)).toBe(FAILED);
  });

  test("an image is read to its end, be that behind its chunk or the RIFF chunk", async () => {
    const lossy = await vp8(2, 1);
    const firstPartition = lossy.readUIntLE(8, 3) >> 5;
    for (const [whole, shortest] of [
      [image, 0],
      [lossy, firstPartition + 1],
    ] as const) {
      const expected = await decode(riff(whole));
      for (const before of [[], [vp8x(0, 2, 1)]]) {
        const file = riff(...before, whole);
        const at = file.length - whole.length;
        file.writeUInt32LE(shortest, at + 4);
        expect(await decode(file)).toEqual(expected);
        file.writeUInt32LE(at + shortest + (shortest & 1), 4);
        expect(await decode(file)).toEqual(expected);
      }
    }
    lossy.writeUInt32LE(firstPartition, 4);
    expect(await size(riff(lossy))).toBe(FAILED);
  });

  test("an image that is all there is needs no chunk header", async () => {
    for (const whole of [image, await vp8(2, 1)]) {
      expect(await decode(riff(whole.subarray(8)))).toEqual(await decode(riff(whole)));
      expect(await decodes(riff(vp8x(0, 2, 1), whole.subarray(8)))).toBe(false);
    }
    expect(await size(riff(vp8l(2, 1, 1).subarray(8)))).toBe(FAILED);
  });

  test("nothing is read from a partition of a lossy image that starts with 255", async () => {
    const small = await vp8(16, 16);
    const modes = small.subarray(8, 8 + 10 + (small.readUIntLE(8, 3) >> 5));
    const withTokens = (first: number) => riff(chunk("VP8 ", [...modes, first, ...Buffer.alloc(4096)]));
    expect(await decodes(withTokens(254))).toBe(true);
    expect(await decodes(withTokens(255))).toBe(false);

    const withModes = (first: number) => {
      const frame = Buffer.from([...modes.subarray(0, 10), first, ...Buffer.alloc(63, 144), ...Buffer.alloc(4096)]);
      frame.writeUIntLE((64 << 5) | 16, 0, 3);
      return riff(chunk("VP8 ", frame));
    };
    expect(await decodes(withModes(0))).toBe(true);
    expect(await decodes(withModes(255))).toBe(false);
  });

  test("the modes of a macroblock can take less than 3.5 bits", async () => {
    const frame = await vp8(1024, 1024);
    expect(frame.toString("latin1", 0, 4)).toBe("VP8 ");
    expect((frame.readUIntLE(8, 3) >> 5) * 8).toBeLessThan(3.5 * 64 * 64);
    expect(await new Bun.Image(riff(frame)).resize(1).png().bytes().then(decode)).toHaveProperty("pixels", [
      "000000ff",
    ]);
  });

  test("the two bits above the width and the height of a lossy image do not count", async () => {
    const frame = await vp8(2, 1);
    const expected = await decode(riff(frame));
    frame.writeUInt32LE(0xc001_c002, 8 + 6);
    expect(await size(riff(frame))).toBe("2x1");
    expect(await decode(riff(frame))).toEqual(expected);
  });

  test("the limits of a lossless image", async () => {
    expect(await size(riff(vp8l(16384, 16384)), 2 ** 28)).toBe("16384x16384");
    expect((await decodeToHex(riff(vp8l(16384, 1)))).hex).toBe(Buffer.alloc(16384 * 8, "01020304").toString());
    const { lines } = await decoded(riff(vp8l(1, 16384)));
    expect(Buffer.from(lines).toString("hex")).toBe(Buffer.alloc(16384 * 10, "0001020304").toString());
    expect(await size(riff(vp8l(2, 1, 1)))).toBe(FAILED);
    expect(await size(riff(vp8x(0, 2, 1), vp8l(2, 1, 1)))).toBe(FAILED);
  });

  test("maxPixels", async () => {
    for (const file of [riff(vp8l(5, 4)), await black(5, 4)]) {
      expect(await decodes(file, { maxPixels: 20 })).toBe(true);
      expect(await decodes(file, { maxPixels: 19 })).toMatchObject({ code: "ERR_IMAGE_TOO_MANY_PIXELS" });
      expect(await size(file, 19)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    }
  });
});

describe("ALPH", () => {
  const alphas = async (file: Uint8Array) => (await decode(file)).pixels.map(pixel => parseInt(pixel.slice(6), 16));
  const withAlpha = async (width: number, height: number, ...chunks: Buffer[]) =>
    riff(vp8x(ALPHA, width, height), ...chunks, await vp8(width, height));

  test.each([1, 2, 7, 8, 9, 17, 33])("each filter, %i px wide", async width => {
    const height = 19;
    const random = randomBytes(width);
    const expected = Array.from({ length: width * height }, random);
    for (const filter of [0, 1, 2, 3]) {
      const filtered = expected.map((alpha, i) => {
        const [left, above, corner] = [expected[i - 1], expected[i - width], expected[i - width - 1]];
        if (filter === 0 || i === 0) return alpha;
        if (i < width) return alpha - left;
        if (i % width === 0) return alpha - above;
        return alpha - [0, left, above, Math.min(255, Math.max(0, left + above - corner))][filter];
      });
      expect(await alphas(await withAlpha(width, height, chunk("ALPH", [filter << 2, ...filtered])))).toEqual(expected);
    }
  });

  test("the header", async () => {
    const accepted = [];
    const file = await withAlpha(1, 1, chunk("ALPH", [0, ...bits(...oneColor(0, 9, 0, 0))]));
    for (let header = 0; header < 256; header++) {
      file[file.indexOf("ALPH") + 8] = header;
      if (await decodes(file)) accepted.push(header);
    }
    // Two kinds of compression, four filters, two kinds of preprocessing.
    expect(accepted).toEqual([0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25, 28, 29]);
  });

  test("uncompressed, it has a byte for each pixel or more", async () => {
    expect(await alphas(await withAlpha(2, 2, chunk("ALPH", [0, 1, 2, 3, 4, 5])))).toEqual([1, 2, 3, 4]);
    expect(await decodes(await withAlpha(2, 2, chunk("ALPH", [0, 1, 2, 3])))).toBe(false);
    expect(await decodes(await withAlpha(2, 2, chunk("ALPH", [1])))).toBe(false);
    expect(await decodes(await withAlpha(2, 2, chunk("ALPH")))).toBe(false);
  });

  test("compressed, it is the green channel", async () => {
    const file = await withAlpha(2, 1, chunk("ALPH", [1, ...bits(...oneColor(1, 77, 2, 3))]));
    expect(await alphas(file)).toEqual([77, 77]);
  });

  test.each([
    ["without", []],
    ["with", palette],
  ])("compressed %s a palette, it has the bits of the last pixel too", async (_, transform) => {
    const fields = [...transform, ...twoGreens];
    const stream = [...bits(...fields), 255];
    const spare = 8 * stream.length - fields.reduce((sum, [, count]) => sum + count, 0);
    expect(await decodes(await withAlpha(spare, 1, chunk("ALPH", [1, ...stream])))).toBe(true);
    expect(await decodes(await withAlpha(spare + 1, 1, chunk("ALPH", [1, ...stream])))).toBe(false);
  });

  test("the last in front of a lossy image counts, whatever VP8X says", async () => {
    const [one, two, image] = [chunk("ALPH", [0, 1]), chunk("ALPH", [0, 2]), await vp8(1, 1)];
    expect(await alphas(riff(vp8x(ALPHA, 1, 1), one, two, chunk("JUNK"), image))).toEqual([2]);
    expect(await alphas(riff(vp8x(0, 1, 1), one, image))).toEqual([1]);
    expect(await alphas(riff(vp8x(ALPHA, 1, 1), image, one))).toEqual([255]);
    expect(await alphas(riff(vp8x(ALPHA, 1, 1), one, vp8l(1, 1)))).toEqual([4]);
  });
});

describe("memory is written to as the rows come, not when the header does", async () => {
  const someRows = Array(8192).fill(0x55);
  const lossless = (side: number, ...stream: [number, number][]) =>
    riff(chunk("VP8L", [...bits([0x2f, 8], [side - 1, 14], [side - 1, 14], [0, 4], ...stream), ...someRows]));
  const small = await vp8(16, 16);
  /** With the longest first partition, which no size is refused for, and not enough coefficients. */
  const frame = (side: number) => {
    const tag = small.readUIntLE(8, 3);
    const [modesEnd, more] = [8 + 10 + (tag >> 5), 2 ** 19 - 1 - (tag >> 5)];
    const resized = Buffer.concat([small.subarray(8, modesEnd), Buffer.alloc(more), small.subarray(modesEnd)]);
    resized.writeUIntLE(tag + (more << 5), 0, 3);
    resized.writeUInt32LE(side | (side << 16), 6);
    return chunk("VP8 ", resized);
  };
  const withAlpha = (side: number, ...stream: [number, number][]) =>
    riff(vp8x(ALPHA, side, side), chunk("ALPH", [1, ...bits(...stream), ...someRows]), frame(side));

  test.concurrent.each<[string, (side: number) => Buffer]>([
    ["lossless", side => lossless(side, ...twoGreens)],
    ["lossless with a palette", side => lossless(side, ...palette, ...twoGreens)],
    ["lossy", side => riff(frame(side))],
    ["alpha", side => withAlpha(side, ...twoGreens)],
    ["alpha with a palette", side => withAlpha(side, ...palette, ...twoGreens)],
  ])("%s", async (_, file) => {
    expect(await decodes(file(16))).toBe(true);
    // 1 GiB of RGBA, the most the default maxPixels allows.
    const fixture = `
      const file = Bun.gunzipSync(Buffer.from("${Bun.gzipSync(file(16383)).toBase64()}", "base64"));
      console.log(JSON.stringify(await new Bun.Image(file).png().bytes().then(() => "decoded", e => e.code)));
    `;
    const [fixtureMaxRSS, baselineMaxRSS] = await Promise.all([
      runFixtureMaxRSS(fixture, FAILED),
      emptyProcessMaxRSS(),
    ]);
    expect((fixtureMaxRSS - baselineMaxRSS) / 1024 / 1024).toBeLessThan(slow ? 256 : 64);
  });
});

// src/webp/tests/refusals.rs refuses each allocation in turn. Only ASAN's allocator can be given a limit.
test.concurrent.skipIf(!isASAN).each<[string, () => Buffer]>([
  ["decoding", () => riff(vp8l(2048, 2048))],
  ["encoding", () => pngOf(16383, 1, Buffer.from(Array.from({ length: 16383 * 4 }, randomBytes(1))))],
])("refused memory is an error of its own when %s", async (_, file) => {
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const image = new Bun.Image(await Bun.stdin.bytes());
      console.log(await image.webp({ lossless: true }).bytes().then(() => "done", error => error.code));`,
    ],
    env: {
      ...bunEnv,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=8"].join(":"),
    },
    stdin: file(),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  // It warns of the allocation.
  expect({ stdout, exitCode, stderr: exitCode ? stderr : "" }).toEqual({
    stdout: "ERR_OUT_OF_MEMORY\n",
    exitCode: 0,
    stderr: "",
  });
});

describe("what is written", () => {
  const picture = (alpha: number) => pngOf(3, 2, Buffer.alloc(24, Buffer.of(9, 8, 7, alpha)));
  const withProfile = async (alpha: number, profile: string) => {
    const [image] = chunksOf(await encode(picture(alpha), "lossless"));
    return riff(vp8x(PROFILE, 3, 2), chunk("ICCP", profile), chunk(image.tag, image.data));
  };

  test.each([
    { setting: "80", alpha: 255, profile: "", tags: ["VP8 "] },
    { setting: "80", alpha: 254, profile: "", tags: ["VP8X", "ALPH", "VP8 "], flags: ALPHA },
    { setting: "80", alpha: 255, profile: "odd", tags: ["VP8X", "ICCP", "VP8 "], flags: PROFILE },
    { setting: "80", alpha: 254, profile: "even", tags: ["VP8X", "ICCP", "ALPH", "VP8 "], flags: PROFILE | ALPHA },
    { setting: "lossless", alpha: 255, profile: "", tags: ["VP8L"] },
    { setting: "lossless", alpha: 254, profile: "", tags: ["VP8L"] },
    { setting: "lossless", alpha: 255, profile: "even", tags: ["VP8X", "ICCP", "VP8L"], flags: PROFILE },
    { setting: "lossless", alpha: 254, profile: "odd", tags: ["VP8X", "ICCP", "VP8L"], flags: PROFILE | ALPHA },
  ])("the chunks at $setting, alpha $alpha, profile $profile", async ({ setting, alpha, profile, tags, flags }) => {
    const file = Buffer.from(await encode(await withProfile(alpha, profile), setting));
    const chunks = [...chunksOf(file)];
    expect(chunks.map(c => c.tag)).toEqual(tags);
    // Which says that the lengths and the padding are right.
    expect(file).toEqual(riff(...chunks.map(c => chunk(c.tag, c.data))));
    if (flags) expect(file.subarray(12, 30)).toEqual(vp8x(flags, 3, 2));
    if (profile) expect(chunks[1].data.toString()).toBe(profile);
  });

  test.each(["80", "lossless"])("up to 16383 pixels in each direction at %s", async setting => {
    expect(await size(await encode(riff(vp8l(16383, 1)), setting))).toBe("16383x1");
    expect(await size(await encode(riff(vp8l(1, 16383)), setting))).toBe("1x16383");
    for (const file of [riff(vp8l(16384, 1)), riff(vp8l(1, 16384))]) {
      await expect(encode(file, setting)).rejects.toMatchObject({ code: "ERR_IMAGE_ENCODE_FAILED" });
    }
  });

  test("a lossless file of more than 64 KiB has all of the picture, and nothing if it is cut short", async () => {
    const random = randomBytes(5);
    const rgba = Buffer.from(Array.from({ length: 200 * 120 * 4 }, (_, i) => (i % 4 === 3 ? 255 : random())));
    const file = Buffer.from(await encode(pngOf(200, 120, rgba), "lossless"));
    expect(file.length).toBeGreaterThan(65536);
    expect((await decodeToHex(file)).hex).toBe(rgba.toString("hex"));
    const [image] = chunksOf(file);
    expect(await decodes(riff(chunk(image.tag, image.data.subarray(0, -8))))).toBe(false);
  });

  type Color = (x: number, y: number, random: () => number) => number[];
  const lengths = slow ? [1, 2, 3, 17, 33] : [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 65];
  describe.each(
    Object.entries<Color>({
      "noise": (_x, _y, random) => [random(), random(), random(), random()],
      "one color": () => [10, 200, 30, 255],
      "nothing to see": (_x, _y, random) => [random(), random(), random(), 0],
      "two colors": (x, y) => Array(4).fill((x ^ y) & 1 ? 255 : 0),
      "four colors": (_x, _y, random) => [random() & 128, 5, 5, random() | 127],
      "16 colors": (_x, _y, random) => [random() & 192, random() & 192, 0, 255],
      "64 colors": (_x, _y, random) => [random() & 192, random() & 192, 0, random() & 192],
      "slopes": (x, y) => [x * 3 + y, x + y * 2, 200 - x - y, 255 - x * 2 - y],
      "holes": (x, y, random) => [x * 3, y * 3, random() & 7, random() < 64 ? 0 : 255],
    }),
  )("%s", (_, color) => {
    const pictures = lengths.flatMap(width =>
      lengths.map(height => {
        const random = randomBytes(width * 100 + height);
        const rgba = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i++) rgba.set(color(i % width, (i / width) | 0, random), i * 4);
        return { width, height, file: pngOf(width, height, rgba), hex: rgba.toString("hex") };
      }),
    );
    const again = (setting: string, kept: (hex: string) => string) =>
      Promise.all(
        pictures.map(async ({ width, height, file, hex }) => {
          const out = await decodeToHex(await encode(file, setting));
          return kept(out.hex) === kept(hex) ? [] : [`${width}x${height}`];
        }),
      ).then(changed => changed.flat());

    test("lossless keeps all that can be seen", async () => {
      expect(await again("lossless", hex => hex.replace(/(.{6})(..)/g, (all, _, a) => (a === "00" ? a : all)))).toEqual(
        [],
      );
    });

    test("lossy keeps the alpha channel", async () => {
      expect(await again("50", hex => hex.replace(/.{6}(..)/g, "$1"))).toEqual([]);
    });
  });
});
