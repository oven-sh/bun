// The files that Bun.Image encodes, byte for byte those of libjpeg-turbo: segments, quality, sizes, ICC profile.
import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { slow } from "../png-golden/check";
import { chunk, iccp, iend, ihdr, png, RGBA } from "../png-golden/write";
import { decode, expectPictures, grouped, pngOf, range } from "./decode";
import { encode, fill, mistakes, noisy, type Options } from "./encode";
import { coefficientsOf, pictureOf, scaled, tablesFor } from "./model";
import { read, segmentsOf } from "./read";
import { APP2, DHT, DQT, icc, SOF0, SOF2 } from "./write";

describe("the segments", () => {
  const picture = noisy(0x0102, 3);
  /** Of DQT and DHT, only the first byte. */
  const list = async (options?: Options) =>
    segmentsOf(await encode(picture, options)).map(({ code, body }) =>
      [code.toString(16), body.toString("hex", 0, code === DQT || code === DHT ? 1 : undefined)].join(" "),
    );
  const start = ["e0 4a46494600010100000100010000", "db 00", "db 01"];

  test("baseline", async () => {
    expect(await list()).toEqual([
      ...start,
      "c0 080003010203012200021101031101",
      ...["c4 00", "c4 10", "c4 01", "c4 11", "da 03010002110311003f00"],
    ]);
  });

  test("progressive", async () => {
    expect(await list({ progressive: true })).toEqual([
      ...start,
      "c2 080003010203012200021101031101",
      ...["c4 00", "c4 01", "da 03010002100310000001"],
      ...["c4 10", "da 010100010502"],
      ...["c4 11", "da 010301013f01"],
      ...["c4 11", "da 010201013f01"],
      ...["c4 10", "da 010100063f02"],
      ...["c4 10", "da 010100013f21"],
      "da 03010002000300000010",
      ...["c4 11", "da 010301013f10"],
      ...["c4 11", "da 010201013f10"],
      ...["c4 10", "da 010100013f10"],
    ]);
  });

  test("are valid, and hold the expected coefficients", async () => {
    for (const progressive of [false, true]) {
      const { frame } = read(await encode(picture, { progressive }));
      expect(frame).toEqual({ ...coefficientsOf(picture, 80), type: progressive ? SOF2 : SOF0 });
    }
  });
});

describe("quality", () => {
  test("scales the tables of K.1, clamped to 1 to 255", async () => {
    const picture = noisy(1, 1);
    const found = await Promise.all(
      range(1, 100).map(async quality => read(await encode(picture, { quality })).frame.tables),
    );
    expect(found).toEqual(range(1, 100).map(tablesFor));
    expect(found[0].flat()).toEqual(Array(128).fill(255));
    expect(found[49][0].slice(0, 6)).toEqual([16, 11, 12, 14, 12, 10]);
    expect(found[99].flat()).toEqual(Array(128).fill(1));
  });

  test("defaults to 80, and is clamped to 1 to 100", async () => {
    const picture = noisy(9, 9);
    const same = async (a: Options | undefined, quality: number) =>
      (await encode(picture, a)).equals(await encode(picture, { quality }));
    expect([await same(undefined, 80), await same({ quality: 0 }, 1), await same({ quality: 101 }, 100)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  test.each([1, 26, 51, 76])("the 25 from %i on", async first => {
    // Noise has all frequencies, and hard edges have large coefficients.
    const pictures = [noisy(16, 16), fill(32, 16, (x, y) => ((x * y) & 20 ? [255, 255, 0] : [0, 0, 255]))];
    const found = await Promise.all(
      range(first, first + 24)
        .filter(quality => !slow || quality % 3 === 1)
        .map(quality => mistakes(pictures, quality, [quality % 5 === 0])),
    );
    expect(found.flat()).toEqual([]);
  });

  test("quantization rounds to nearest, and a half away from 0", async () => {
    // A flat block for each gray level.
    const grays = fill(128, 128, (x, y) => Array(3).fill((y >> 3) * 16 + (x >> 3)));
    const found = await Promise.all(
      (slow ? [5, 30, 50, 75, 97] : range(1, 100)).map(quality => mistakes([grays], quality, [false])),
    );
    expect(found.flat()).toEqual([]);
  });
});

describe("sizes", () => {
  test.each([false, true])("every width up to 70, and around 128 and 256, progressive: %p", async progressive => {
    const widths = [...range(1, 70), ...range(126, 130), ...range(254, 258)];
    const some = widths.filter(width => !slow || !progressive || width % 8 < 2);
    expect(
      await mistakes(
        some.map(width => noisy(width, 3)),
        30,
        [progressive],
      ),
    ).toEqual([]);
  });

  test("every height up to 50", async () => {
    expect(
      await mistakes(
        range(1, slow ? 34 : 50).map(height => noisy(9 + (height % 3) * 8, height)),
        30,
      ),
    ).toEqual([]);
  });

  test("long rows", async () => {
    expect(
      await mistakes(
        [511, 1025, 2049, ...(slow ? [] : [4097, 16385, 65500])].map(width => noisy(width, 2)),
        30,
      ),
    ).toEqual([]);
  });

  test("padding blocks repeat the previous DC coefficient, and have no AC", async () => {
    const picture = fill(24, 8, x => Array(3).fill([40, 80, 120][x >> 3]));
    for (const progressive of [false, true]) {
      const [{ data }] = read(await encode(picture, { quality: 100, progressive })).frame.components;
      expect(range(0, 7).map(block => data[block * 64] / 8 + 128)).toEqual([40, 80, 120, 120, 80, 80, 120, 120]);
      expect(data.filter((value, i) => i % 64 !== 0 && value !== 0)).toBeEmpty();
    }
  });

  test("width and height go up to 65500", async () => {
    const black = (width: number, height: number) =>
      png(ihdr(width, height, 8, RGBA), chunk("IDAT", deflateSync(Buffer.alloc(height * (1 + width * 4)))), iend);
    const written =
      (progressive: boolean) =>
      ([width, height]: number[]) =>
        new Bun.Image(black(width, height))
          .jpeg({ progressive })
          .bytes()
          .then(
            async file => Object.values(await new Bun.Image(file).metadata()).join(),
            error => error.code,
          );
    for (const progressive of [false, true]) {
      const sizes = [
        [65500, 1],
        [1, 65500],
        [65501, 1],
        [1, 65501],
        [65536, 1],
        [1, 65537],
      ];
      expect(await grouped(sizes, written(progressive))).toEqual({
        "65500,1,jpeg": [sizes[0]],
        "1,65500,jpeg": [sizes[1]],
        ERR_IMAGE_ENCODE_FAILED: sizes.slice(2),
      });
    }
  });

  test.each([false, true])("stripes in a row or a column of 65500 pixels, progressive: %p", async progressive => {
    // At quality 100, a flat gray block survives exactly.
    const length = 65500;
    const grays = range(0, 22).map(i => [...Array(3).fill((i * 89) & 255), 255]);
    const across = Buffer.concat(grays.map(gray => Buffer.alloc(8 * 4, Buffer.from(gray))));
    const down = Buffer.concat(grays.map(gray => Buffer.alloc(8 * 5, Buffer.from([0, ...gray]))));
    const rgba = Buffer.alloc(scaled(length, 1) * 4, Buffer.from(grays.flat()));
    const of = async (width: number, height: number, ...lines: Buffer[]) => {
      const data = deflateSync(Buffer.concat(lines), { level: 0 });
      const from = png(ihdr(width, height, 8, RGBA), chunk("IDAT", data), iend);
      const file = await new Bun.Image(from).jpeg({ quality: 100, progressive }).bytes();
      const expected = { width: scaled(width, 1), height: scaled(height, 1), rgba };
      return { name: `${width} by ${height}`, file, eighths: 1, expected };
    };
    await expectPictures([
      await of(length, 1, Buffer.alloc(1), Buffer.alloc(length * 4, across)),
      await of(1, length, Buffer.alloc(length * 5, down)),
    ]);
  });
});

describe("the ICC profile", () => {
  const picture = noisy(5, 4);
  const most = 65519;

  test("follows JFIF, in segments of up to 65519 bytes", async () => {
    const without = [await encode(picture), await encode(picture, { progressive: true })];
    for (const size of [1, 2, most - 1, most, most + 1, 2 * most, 2 * most + 1]) {
      const profile = Buffer.alloc(size, noisy(61, 1).rgba.subarray(1));
      const count = Math.ceil(size / most);
      const parts = range(1, count).map(number =>
        icc(number, count, profile.subarray((number - 1) * most, number * most)),
      );
      for (const [i, progressive] of [false, true].entries()) {
        const file = await new Bun.Image(pngOf(picture, iccp("name", profile))).jpeg({ progressive }).buffer();
        const expected = Buffer.concat([without[i].subarray(0, 20), ...parts, without[i].subarray(20)]);
        expect([size, progressive, file.equals(expected)]).toEqual([size, progressive, true]);
      }
    }
  });

  /** WebP takes a profile of any size. */
  async function webpWith(profile: Buffer) {
    const simple = await new Bun.Image(pngOf(picture)).webp().buffer();
    const riff = (name: string, data: Buffer) => {
      const head = Buffer.alloc(8, name);
      head.writeUInt32LE(data.length, 4);
      return Buffer.concat([head, data, Buffer.alloc(data.length & 1)]);
    };
    const opaque = simple.subarray(simple.indexOf("VP8 "));
    const features = Buffer.from([0x20, 0, 0, 0, picture.width - 1, 0, 0, picture.height - 1, 0, 0]);
    return riff("RIFF", Buffer.concat([Buffer.from("WEBP"), riff("VP8X", features), riff("ICCP", profile), opaque]));
  }
  const partsFor = async (size: number) => {
    const file = await new Bun.Image(await webpWith(Buffer.alloc(size, 7))).jpeg().bytes();
    return segmentsOf(file).filter(({ code }) => code === APP2).length;
  };

  test("can have 255 segments", async () => {
    expect(await partsFor(255 * most)).toBe(255);
  });

  test("is left out if it needs more", async () => {
    expect(await partsFor(255 * most + 1)).toBe(0);
  });
});

test("round trip", async () => {
  const picture = noisy(50, 37);
  const expected = pictureOf(coefficientsOf(picture, 90));
  for (const progressive of [false, true]) {
    expect((await decode(await encode(picture, { quality: 90, progressive }))).rgba.equals(expected.rgba)).toBe(true);
  }
});
