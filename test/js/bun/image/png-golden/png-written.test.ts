// Whatever Bun.Image writes as PNG has to keep every rule of the specification and hold the pixels it was given.
// read.ts checks that, and it shares no code with Bun.
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import zlib from "node:zlib";
import { slow } from "./check";
import { chunksOf, linesOf, type PngOptions } from "./observe";
import { read } from "./read";
import {
  chunk,
  filteredLines,
  formats,
  iccp,
  iend,
  ihdr,
  noise,
  png,
  randomBytes,
  RGBA,
  rgbaOf,
  write,
  type Picture,
} from "./write";

/** Pictures that favor different filters and compress differently. The same for the same size. */
const contents: Record<string, (width: number, height: number) => Picture> = {
  noise: (width, height) => noise([RGBA, 8], width, height, randomBytes(width * 1000 + height)),
  "a few colors": (width, height) => noise([RGBA, 8], width, height, randomBytes(width * 1000 + height), { few: true }),
  "one color": (width, height) => fill(width, height, () => [10, 200, 30, 255]),
  "nothing to see": (width, height) => {
    const random = randomBytes(width * 1000 + height);
    return fill(width, height, () => [random(), random(), random(), 0]);
  },
  "a slope to the right": (width, height) => fill(width, height, x => [x, x * 2, x * 3, 255]),
  "a slope down": (width, height) => fill(width, height, (_, y) => [y, y * 2, y * 3, 255 - y]),
  "a slope across": (width, height) => fill(width, height, (x, y) => [x + y, x - y, x * y, 128]),
  "black and white": (width, height) => fill(width, height, (x, y) => Array(4).fill((x ^ y) & 1 ? 255 : 0)),
};

function fill(width: number, height: number, color: (x: number, y: number) => number[]): Picture {
  const samples = new Uint16Array(width * height * 4);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = color(x, y);
      for (let c = 0; c < 4; c++, i++) samples[i] = rgba[c] & 255;
    }
  }
  return { width, height, colorType: RGBA, depth: 8, samples };
}

const sizes = [
  [1, 1],
  [1, 50],
  [50, 1],
  [7, 5],
  [33, 17],
];
if (!slow) {
  for (let width = 1; width <= 9; width++) {
    for (let height = 1; height <= 4; height++) sizes.push([width, height]);
  }
  sizes.push([16, 16], [257, 3], [3, 257], [64, 64], [1000, 2]);
}
const levels = [undefined, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type Source = { file: Uint8Array; width: number; height: number; rgba: Buffer; profile?: Buffer };

function sourceOf(picture: Picture, profile?: Buffer): Source {
  const file = write(picture, { beforePalette: profile ? [iccp("name", profile)] : [] });
  return { file, width: picture.width, height: picture.height, rgba: rgbaOf(picture), profile };
}

/** What is wrong with what is written for each. */
async function mistakes(cases: { name: string; source: Source; options: PngOptions }[]) {
  const found = await Promise.all(
    cases.map(async ({ name, source, options }) => {
      try {
        const out = read(await new Bun.Image(source.file).png(options).bytes());
        if (out.width !== source.width || out.height !== source.height) return `${name}: ${out.width} x ${out.height}`;
        if (source.profile ? !out.profile?.equals(source.profile) : out.profile) {
          return `${name}: a profile of ${out.profile?.length} bytes`;
        }
        if (options.palette) {
          if (out.colors! > (options.colors ?? 256)) return `${name}: ${out.colors} colors`;
        } else if (!out.rgba.equals(source.rgba)) return `${name}: other pixels`;
      } catch (error: any) {
        return `${name}: ${error.code ?? error.message}`;
      }
    }),
  );
  return found.filter(Boolean);
}

describe("RGBA", () => {
  test.each(Object.keys(contents))("%s, at every level and several sizes", async content => {
    const cases = sizes.flatMap(([width, height]) => {
      const source = sourceOf(contents[content](width, height));
      return levels.map(compressionLevel => ({
        name: `${width} x ${height}, level ${compressionLevel}`,
        source,
        options: { compressionLevel },
      }));
    });
    expect(await mistakes(cases)).toEqual([]);
  });

  // At level 0 the size of the stream follows from the size of the picture: 2 bytes, then 5 for each 65535 or
  // so of rows, then 4. IDAT chunks hold 8192.
  test("streams that end at, before and after the end of an IDAT chunk", async () => {
    const cases = [];
    for (let width = 2040; width <= 2050; width++) {
      for (const height of slow ? [1] : [1, 2, 4]) {
        const source = sourceOf(contents["a few colors"](width, height));
        cases.push({ name: `${width} x ${height}`, source, options: { compressionLevel: 0 } });
      }
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  // When all the rows of this picture have gone in, the IDAT chunk has room for one more byte. At level 1 that is so
  // for one picture of noise in some 8000, and for as long as zlib hands over the same bytes at the same moments. A
  // stream of node:zlib gives zlib a row at a time and the room that is left of 8192 bytes, as src/png/encoder.rs does.
  test("the end of the stream when one byte is left of an IDAT chunk", async () => {
    const source = sourceOf(contents.noise(1316, 4));
    const file = await new Bun.Image(source.file).png({ compressionLevel: 1 }).bytes();
    expect(read(file).rgba.equals(source.rgba)).toBe(true);

    const chunks = [...chunksOf(file)];
    const lines = linesOf(chunks);
    const deflate = zlib.createDeflate({ level: 1, strategy: zlib.constants.Z_FILTERED, chunkSize: 8192 });
    const parts: Buffer[] = [];
    deflate.on("data", part => parts.push(part));
    for (let at = 0; at < lines.length; at += lines.length / 4) {
      await new Promise(done => deflate.write(lines.subarray(at, at + lines.length / 4), done));
    }
    const beforeTheEnd = Buffer.concat(parts).length;
    await new Promise(done => deflate.on("end", done).end());
    // With the same settings, as it comes to the same stream.
    const idat = Buffer.concat(chunks.filter(c => c.type === "IDAT").map(c => c.data));
    expect(Buffer.concat(parts).equals(idat)).toBe(true);
    expect(beforeTheEnd % 8192).toBe(8191);
  });

  // As libspng did: of the five ways to filter a row, the one whose bytes are nearest to zero in sum, where 255 is as
  // near as 1. The first of equals.
  test("each row gets the first of the filters with the lowest sum", async () => {
    // In a row of each, two filters have the lowest sum and no third, or one has it and another has one more.
    const close = `
      1x2 02ff000301020000
      2x1 00ffffffff01ff01
      2x2 80c0c00040800000c0804040c0400000
      2x2 01000100010100010000010100010000
      2x2 fdff0300fffdfe00fcfffffffcfefd03
      2x2 00000000010100010000000100000101
      2x1 0000008080000080
      2x2 0000400080c00080c000c00040804080
      1x2 ff03fd01ff03fc01
      2x2 000000c080c00080c040808000808080
      2x2 01ff01ffff0001ff01010001ff01ffff
      2x2 ff000101010000010001010000ff0001
      2x2 01000101000001000001010001000000
      2x2 00fdfefdfe01020302fd01fe0002fe01
      2x2 0100010101ffffff01ffff000101ff01
      2x2 01000101010001000001000101010101
      2x2 01000100000001010001010000010100
      2x2 0001010101ff00ffff010100ff0101ff
      2x2 00000001010100000101010101000000
      2x2 01010000000000000101010001010001
      2x2 00000001000101010100010000010101
      2x2 ff00000101ffff01ff00000201ffff01
      2x1 1e148a1e0a8a1e14
      2x1 0002000300020201
      1x2 fc00ff01fc007f01
      2x2 949e8a148a148a9e1e1e9e1e0a9e948a
      2x2 00ff010001ff00ffffff0100ff01ff00
      2x2 00000100000001000001010100010101
      2x2 8180808181818180808080807f807f80
      3x2 010101000001010100010001010001010000010101000001`;
    // Paeth has the lowest sum only if, where b is as near as c, or a as near as c, it takes the first of the two.
    const ties = `
      2x2 00000102000001000000000300010000
      2x2 00010000000000000003010000030000`;
    const pictures = Array.from((close + ties).matchAll(/(\d+)x(\d+) (\w+)/g), ([, width, height, hex]) => {
      const bytes = Buffer.from(hex, "hex");
      return fill(+width, +height, (x, y) => [...bytes.subarray((y * +width + x) * 4, (y * +width + x + 1) * 4)]);
    });
    // And of few values that are near each other or near the middle, so that sums are close.
    const random = randomBytes(5);
    for (const values of [
      [0, 1],
      [0, 128],
      [127, 128, 129],
      [0, 1, 255],
      [0, 64, 128, 192],
    ]) {
      const few = () => [0, 0, 0, 0].map(() => values[random() % values.length]);
      for (let i = 0; i < (slow ? 8 : 200); i++) pictures.push(fill(1 + (random() % 6), 1 + (random() % 3), few));
      // Rows are filtered and added up many bytes at a time, and what is left over at the end on its own.
      for (let width = 7; width <= 18; width++) pictures.push(fill(width, 3, few));
    }

    const met = new Set<string>();
    const wrong = await Promise.all(
      pictures.map(async picture => {
        const candidates = [0, 1, 2, 3, 4].map(type => Buffer.from(filteredLines(picture, { filter: () => type })));
        const length = 1 + picture.width * 4;
        const expected = Buffer.concat(
          Array.from({ length: picture.height }, (_, y) => {
            const lines = candidates.map(all => all.subarray(y * length, (y + 1) * length));
            const sums = lines.map(line => line.subarray(1).reduce((sum, x) => sum + Math.min(x, 256 - x), 0));
            const lowest = Math.min(...sums);
            const [first, second, third] = sums.flatMap((sum, type) => (sum === lowest ? [type] : []));
            if (second !== undefined && third === undefined) met.add(`${first} = ${second}`);
            if (second === undefined) sums.forEach((sum, type) => sum === lowest + 1 && met.add(`${first} < ${type}`));
            return lines[first];
          }),
        );
        const file = await new Bun.Image(write(picture)).png({ compressionLevel: 1 }).bytes();
        const lines = linesOf([...chunksOf(file)]);
        return lines.equals(expected) ? [] : [`${rgbaOf(picture).toString("hex")}: ${lines.toString("hex")}`];
      }),
    );
    expect(wrong.flat()).toEqual([]);
    const types = [0, 1, 2, 3, 4];
    expect([...met].sort()).toEqual(
      types
        .flatMap(a => types.flatMap(b => (a === b ? [] : [`${a} < ${b}`, ...(a < b ? [`${a} = ${b}`] : [])])))
        .sort(),
    );
  });

  // Choosing takes six buffers as long as the row. libspng had the same limit, for adding up a row in 32 bits.
  test.skipIf(slow)("the longest row that is filtered, and the shortest that is not", async () => {
    for (const [width, filter] of [
      [4194303, 1],
      [4194304, 0],
    ]) {
      // A slope to the right, over and over.
      const line = new Uint8Array(1 + width * 4);
      for (let i = 1; i <= 4096; i++) line[i] = i >> 2;
      for (let have = 4096; have < width * 4; have *= 2)
        line.copyWithin(1 + have, 1, 1 + Math.min(have, width * 4 - have));
      const file = png(ihdr(width, 1, 8, RGBA), chunk("IDAT", zlib.deflateSync(line, { level: 0 })), iend);
      const [, first] = chunksOf(await new Bun.Image(file).png({ compressionLevel: 1 }).bytes());
      expect([width, zlib.inflateSync(first.data, { finishFlush: zlib.constants.Z_SYNC_FLUSH })[0]]).toEqual([
        width,
        filter,
      ]);
    }
  });

  test("from every kind of PNG file", async () => {
    const found = await Promise.all(
      formats.flatMap(format =>
        [false, true].map(async interlaced => {
          const picture = noise(format, 13, 9, randomBytes(2), { transparent: true });
          const out = read(await new Bun.Image(write(picture, { interlaced })).png().bytes());
          return out.rgba.equals(rgbaOf(picture)) ? undefined : `${format}, interlaced: ${interlaced}`;
        }),
      ),
    );
    expect(found.filter(Boolean)).toEqual([]);
  });

  test("a second time gives the same file", async () => {
    for (const content of Object.keys(contents)) {
      const once = await new Bun.Image(write(contents[content](40, 30))).png().bytes();
      expect(Buffer.from(await new Bun.Image(once).png().bytes()).equals(Buffer.from(once))).toBe(true);
    }
  });
});

describe("with a palette", () => {
  test.each(Object.keys(contents))("%s", async content => {
    const cases = sizes.flatMap(([width, height]) => {
      const source = sourceOf(contents[content](width, height));
      return (slow ? [2, 16, undefined] : [2, 3, 16, 17, 255, 256, undefined]).flatMap(colors =>
        [false, true].map(dither => ({
          name: `${width} x ${height}, ${colors} colors${dither ? ", dithered" : ""}`,
          source,
          options: { palette: true, colors, dither, compressionLevel: colors === 16 ? 0 : undefined },
        })),
      );
    });
    expect(await mistakes(cases)).toEqual([]);
  });
});

test("the color profile, of any size, at any level, with and without a palette", async () => {
  const picture = contents.noise(5, 4);
  const cases = [1, 2, 100, 8179, 8180, 8181, 8192, 70000, 1_000_000].flatMap(size => {
    const profile = Buffer.alloc(size, 1);
    const random = randomBytes(size);
    // The one of 70,000 is all noise, which gets longer when it is compressed, and is more than the file starts with
    // room for.
    for (let i = 0; i < Math.min(size, 70000); i++) profile[i] = random();
    const source = sourceOf(picture, profile);
    return [{}, { compressionLevel: 0 }, { compressionLevel: 9 }, { palette: true }].map(options => ({
      name: `${size} bytes, ${JSON.stringify(options)}`,
      source,
      options,
    }));
  });
  expect(await mistakes(cases)).toEqual([]);
});

describe("Bun.Image", () => {
  const picture = contents.noise(11, 7);
  const file = write(picture);
  const expected = rgbaOf(picture);

  test("reads a PNG file from anything it takes", async () => {
    using dir = tempDir("png-written", { "picture.png": file });
    const path = join(String(dir), "picture.png");
    // Not at the start of its buffer, and not all of it.
    const inside = Buffer.concat([Buffer.alloc(3), file, Buffer.alloc(5)]);
    const inputs = {
      Buffer: file,
      Uint8Array: new Uint8Array(file),
      "part of a buffer": inside.subarray(3, 3 + file.length),
      ArrayBuffer: new Uint8Array(file).buffer,
      DataView: new DataView(new Uint8Array(file).buffer),
      Blob: new Blob([file]),
      "Bun.file": Bun.file(path),
      path,
    };
    for (const [name, input] of Object.entries(inputs)) {
      const image = new Bun.Image(input as any);
      expect({ name, ...(await image.metadata()) }).toEqual({ name, width: 11, height: 7, format: "png" });
      expect({ name, same: read(await image.png().bytes()).rgba.equals(expected) }).toEqual({ name, same: true });
      expect([image.width, image.height]).toEqual([11, 7]);
    }
  });

  test("gives the same PNG file in every way it has", async () => {
    using dir = tempDir("png-written", {});
    const path = join(String(dir), "out.png");
    const image = () => new Bun.Image(file).png();
    const bytes = Buffer.from(await image().bytes());
    expect(read(bytes).rgba.equals(expected)).toBe(true);
    expect((await image().buffer()).equals(bytes)).toBe(true);
    expect((await image().toBuffer()).equals(bytes)).toBe(true);
    const blob = await image().blob();
    expect(blob.type).toBe("image/png");
    expect(Buffer.from(await blob.arrayBuffer()).equals(bytes)).toBe(true);
    expect(await image().toBase64()).toBe(bytes.toString("base64"));
    expect(await image().dataurl()).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
    expect(await image().write(path)).toBe(bytes.length);
    expect(Buffer.from(await Bun.file(path).arrayBuffer()).equals(bytes)).toBe(true);
    // PNG by the name of the file, and because that is what came in.
    expect(await new Bun.Image(file).write(path)).toBe(bytes.length);
    expect(Buffer.from(await new Bun.Image(file).bytes()).equals(bytes)).toBe(true);
  });

  test("writes a valid file after every operation", async () => {
    const operations: Record<string, (image: Bun.Image) => Bun.Image> = {
      "rotate 90": image => image.rotate(90),
      "rotate 180": image => image.rotate(180),
      "rotate 270": image => image.rotate(270),
      flip: image => image.flip(),
      flop: image => image.flop(),
      smaller: image => image.resize(5, 3),
      larger: image => image.resize(40, 50),
      "one pixel": image => image.resize(1, 1),
      modulate: image => image.modulate({ brightness: 1.5, saturation: 0.5 }),
    };
    const sizesAfter: Record<string, number[]> = {};
    for (const [name, operation] of Object.entries(operations)) {
      const out = read(await operation(new Bun.Image(file)).png().bytes());
      sizesAfter[name] = [out.width, out.height];
    }
    expect(sizesAfter).toEqual({
      "rotate 90": [7, 11],
      "rotate 180": [11, 7],
      "rotate 270": [7, 11],
      flip: [11, 7],
      flop: [11, 7],
      smaller: [5, 3],
      larger: [40, 50],
      "one pixel": [1, 1],
      modulate: [11, 7],
    });
  });

  test("writes a valid file from the other formats", async () => {
    const opaque = contents["a slope to the right"](20, 10);
    // WebP does not keep the color under an alpha of 0, so a picture without.
    const translucent = contents["a slope across"](20, 10);
    const lossless = await new Bun.Image(write(translucent)).webp({ lossless: true }).bytes();
    expect(read(await new Bun.Image(lossless).png().bytes()).rgba.equals(rgbaOf(translucent))).toBe(true);
    for (const encoded of [
      await new Bun.Image(write(opaque)).jpeg().bytes(),
      await new Bun.Image(write(opaque)).webp().bytes(),
    ]) {
      const out = read(await new Bun.Image(encoded).png().bytes());
      expect([out.width, out.height]).toEqual([20, 10]);
    }
  });

  test("the placeholder is a valid file", async () => {
    const url = await new Bun.Image(write(contents["a slope across"](60, 40))).placeholder();
    expect(url).toStartWith("data:image/png;base64,");
    const out = read(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    expect(out.width / out.height).toBeCloseTo(1.5, 0);
  });
});
