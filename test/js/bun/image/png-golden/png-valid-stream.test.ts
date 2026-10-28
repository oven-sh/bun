// The ways in which the rows of a valid PNG file may be compressed, cut into chunks and handed over, and what other
// programs make of them. See png-valid.test.ts.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import zlib from "node:zlib";
import { loadCases } from "../../archive-golden/observe";
import { decoded, make, maker, mistakes, slow, type Case } from "./check";
import {
  filteredLines,
  formats,
  GRAY,
  GRAY_ALPHA,
  noise,
  randomBytes,
  RGB,
  RGBA,
  rgbaLinesOf,
  write,
  writeAround,
  zlibStream,
  type Layout,
} from "./write";

// One for each way the decoder reads rows.
const readers = [
  ["RGBA, 8 bits", [RGBA, 8], false],
  ["RGB, 8 bits", [RGB, 8], false],
  ["gray, 4 bits", [GRAY, 4], false],
  ["RGB, 8 bits, interlaced", [RGB, 8], true],
  ["gray with alpha, 16 bits, interlaced", [GRAY_ALPHA, 16], true],
] as const;

const empty = new Uint8Array(0);

function stored(data: Uint8Array, final = false) {
  const out = new Uint8Array(5 + data.length);
  out.set([final ? 1 : 0, data.length & 255, data.length >> 8, ~data.length & 255, (~data.length >> 8) & 255]);
  out.set(data, 5);
  return out;
}

const inPieces = (data: Uint8Array, size: number) =>
  Array.from({ length: Math.ceil(data.length / size) }, (_, i) => data.subarray(i * size, (i + 1) * size));

/** A block of fixed Huffman codes that copies `length` bytes from `distance` back, which has to be over 24576. */
function copyFromFarBack(length: number, distance: number, final: boolean) {
  const bits: number[] = [];
  // Huffman codes start with their highest bit, everything else with its lowest.
  const code = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  const plain = (value: number, count: number) => {
    for (let i = 0; i < count; i++) bits.push((value >> i) & 1);
  };
  plain(final ? 1 : 0, 1);
  plain(1, 2);
  while (length > 0) {
    // 258, or what leaves at least 3 for the next one.
    const now = length >= 261 || length === 258 ? 258 : length > 258 ? 255 : length;
    if (now === 258) code(0b11000101, 8);
    else if (now >= 227) {
      code(0b11000100, 8);
      plain(now - 227, 5);
    } else if (now <= 10) code(now - 2, 7);
    else throw new Error(`no code here for a length of ${now}`);
    code(29, 5);
    plain(distance - 24577, 13);
    length -= now;
  }
  code(0, 7);
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) out[i >> 3] |= bits[i] << (i & 7);
  return out;
}

describe.each(readers)("%s", (_, format, interlaced) => {
  test("IDAT cut anywhere", async () => {
    const cut = maker(noise(format, 6, 5, randomBytes(14)), { interlaced, filter: row => row % 5 });
    let size = 0;
    const cases = [cut("not at all", { split: stream => ((size = stream.length), [stream]) })];
    for (let at = 0; at <= size; at++) {
      cases.push(cut(`in two at ${at}`, { split: stream => [stream.subarray(0, at), stream.subarray(at)] }));
    }
    for (const step of [1, 2, 3, 7]) cases.push(cut(`every ${step}`, { split: stream => inPieces(stream, step) }));
    cases.push(
      cut("empty ones all over", {
        split: stream => [empty, empty, ...inPieces(stream, 1).flatMap(byte => [byte, empty, empty])],
      }),
    );
    expect(await mistakes(cases)).toEqual([]);
  });

  test("every setting of zlib and of libdeflate", async () => {
    const { Z_FILTERED, Z_HUFFMAN_ONLY, Z_RLE, Z_FIXED, Z_DEFAULT_STRATEGY } = zlib.constants;
    // Enough for several blocks and for a small window to slide.
    const compressed = maker(noise(format, 150, 40, randomBytes(15), { few: true }), {
      interlaced,
      filter: row => row % 5,
    });
    const all: zlib.ZlibOptions[] = [
      ...Array.from({ length: 10 }, (_, level) => ({ level })),
      ...[Z_FILTERED, Z_HUFFMAN_ONLY, Z_RLE, Z_FIXED, Z_DEFAULT_STRATEGY].map(strategy => ({ strategy })),
      ...[9, 10, 11, 12, 13, 14, 15].map(windowBits => ({ windowBits })),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(memLevel => ({ memLevel })),
      { level: 9, memLevel: 1, windowBits: 9 },
      { level: 1, memLevel: 9, windowBits: 9, strategy: Z_FILTERED },
    ];
    const cases = all.map(options =>
      compressed(JSON.stringify(options), { deflate: lines => zlib.deflateSync(lines, options) }),
    );
    for (const level of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const) {
      if (slow && level % 3) continue;
      const deflate = (lines: Uint8Array) =>
        zlibStream(lines, [Bun.deflateSync(lines, { library: "libdeflate", level })]);
      cases.push(compressed(`libdeflate, level ${level}`, { deflate }));
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  test("flushed, stored, and in blocks of any size", async () => {
    const { Z_SYNC_FLUSH, Z_FULL_FLUSH } = zlib.constants;
    const [small, large] = [
      maker(noise(format, 7, 3, randomBytes(16), { few: true }), { interlaced }),
      maker(noise(format, 40, 12, randomBytes(16), { few: true }), { interlaced }),
    ];
    const cases: Case[] = [];
    const endings = {
      "an empty stored block": stored(empty, true),
      "an empty block of fixed codes": Uint8Array.of(3, 0),
    };
    for (const [ending, last] of Object.entries(endings)) {
      for (const finishFlush of slow ? [Z_SYNC_FLUSH] : [Z_SYNC_FLUSH, Z_FULL_FLUSH]) {
        for (const [picture, size] of [
          [small, 1],
          [small, 7],
          [large, 100],
          [large, 1000],
        ] as const) {
          cases.push(
            picture(`flush ${finishFlush} every ${size} bytes, then ${ending}`, {
              deflate: lines =>
                zlibStream(lines, [
                  ...inPieces(lines, size).map(piece => zlib.deflateRawSync(piece, { finishFlush })),
                  last,
                ]),
            }),
          );
        }
      }
      for (const size of [1, 2, 13, 255, 256, 65535]) {
        cases.push(
          large(`stored ${size} bytes at a time, then ${ending}`, {
            deflate: lines => zlibStream(lines, [...inPieces(lines, size).map(piece => stored(piece)), last]),
          }),
        );
      }
    }
    cases.push(
      large("stored, the last block with data", {
        deflate: lines => zlibStream(lines, [stored(lines.subarray(0, 5)), stored(lines.subarray(5), true)]),
      }),
      large("empty blocks first", {
        deflate: lines => zlibStream(lines, [stored(empty), stored(empty), Bun.deflateSync(lines)]),
      }),
    );
    expect(await mistakes(cases)).toEqual([]);
  });

  test("wherever the file lies in memory", async () => {
    const whole = make("", noise(format, 70, 4, randomBytes(24)), { interlaced, filter: row => 4 - row });
    const cases = Array.from({ length: slow ? 17 : 64 }, (_, offset) => {
      const around = new Uint8Array(offset + whole.file.length + (offset % 2)).fill(0xaa);
      around.set(whole.file, offset);
      return { ...whole, name: `${offset}`, file: around.subarray(offset, offset + whole.file.length) };
    });
    expect(await mistakes(cases)).toEqual([]);
  });
});

// If nothing is copied, nothing is copied from further back than the window, however small the header says that is.
test("every zlib header there can be", async () => {
  const withHeader = maker(noise([RGBA, 8], 5, 4, randomBytes(23)));
  const cases: Case[] = [];
  for (let window = 0; window <= 7; window++) {
    for (let level = 0; level <= 3; level++) {
      const deflate: Layout["deflate"] = lines => {
        const stream = zlibStream(lines, [stored(lines, true)], window);
        stream[1] = level << 6;
        stream[1] += 31 - (stream.readUInt16BE(0) % 31);
        return stream;
      };
      cases.push(withHeader(`window ${window}, level ${level}`, { deflate }));
    }
  }
  expect(await mistakes(cases)).toEqual([]);
});

// zlib itself never looks back further than 32,506 bytes. Others do.
test.each([
  ["gray", [GRAY, 8], 4095, 32768],
  ["RGBA", [RGBA, 8], 1023, 32744],
  ["RGB", [RGB, 8], 1365, 32768],
] as const)("%s: copies from as far back as may be", async (_, format, width, distance) => {
  const top = noise(format, width, 8, randomBytes(17));
  const samples = new Uint16Array(top.samples.length * 2);
  samples.set(top.samples);
  samples.set(top.samples, top.samples.length);
  const deflate = (lines: Uint8Array) => {
    expect(lines.length).toBe(distance * 2);
    return zlibStream(lines, [stored(lines.subarray(0, distance)), copyFromFarBack(distance, distance, true)]);
  };
  expect(await mistakes([make("", { ...top, height: 16, samples }, { deflate })])).toEqual([]);
});

// Pictures that were made up first and then written by 24 programs in as many ways as each offers. A name says which
// program, what kind of file came out, and of which picture and settings. They are picked from 54,000 different files
// so that each program is there with every format, zlib header, kind of block, filter, way to cut IDAT, set of other
// chunks and magnitude of a copy's length and distance that it came up with in a file of up to 2.5 KB. Each keeps every
// rule, and libpng gets the pixels that the picture has. What Bun makes of a file had no part in picking it.
// 11 of the programs can put in a profile, and did.
test("files written by other programs", async () => {
  /** `sha256` is of what `rgbaLinesOf` gives for the picture, `profile` of the profile if there is one. */
  type Entry = { name: string; data: string; width: number; height: number; sha256: string; profile?: string };
  const entries = await loadCases<Entry>(join(import.meta.dir, "valid.json.gz"));
  expect(entries.length).toBe(622);
  const sha256 = (bytes: Uint8Array) => Bun.SHA256.hash(bytes, "hex");
  const results = entries.map(async ({ name, data }) => {
    try {
      const { width, height, lines, profile } = await decoded(Buffer.from(data, "base64"));
      return { name, width, height, sha256: sha256(lines), ...(profile && { profile: sha256(profile) }) };
    } catch (error: any) {
      return { name, error: error.code ?? error };
    }
  });
  expect(await Promise.all(results)).toEqual(entries.map(({ data, ...expected }) => expected));
});

/** `height` rows out of a few of noise, unfiltered, so that making the file costs little. */
function tall(format: readonly [number, number], width: number, height: number, seed: number) {
  const random = randomBytes(seed);
  // A long row is a short one over and over.
  const short = Math.min(width, 3000);
  const repeated = (from: Uint8Array, bytesPerPixel: number) => {
    const out = new Uint8Array(1 + width * bytesPerPixel);
    for (let at = 1; at < out.length; at += short * bytesPerPixel) {
      out.set(from.subarray(1, 1 + Math.min(short * bytesPerPixel, out.length - at)), at);
    }
    return out;
  };
  const rows = Array.from({ length: 7 }, () => {
    const picture = noise(format, short, 1, random);
    const line = filteredLines(picture);
    return { line: repeated(line, (line.length - 1) / short), rgba: repeated(rgbaLinesOf(picture), 4) };
  });
  const order = Array.from({ length: height }, () => rows[random() % 7]);
  return { lines: Buffer.concat(order.map(row => row.line)), expected: Buffer.concat(order.map(row => row.rgba)) };
}

describe("large", () => {
  test.each([
    ["RGBA", [RGBA, 8], 1200, slow ? 300 : 900],
    ["RGB", [RGB, 8], 1500, slow ? 300 : 700],
    ["gray", [GRAY, 8], 3000, slow ? 400 : 1000],
    ["RGBA, 16 bits", [RGBA, 16], 700, slow ? 200 : 600],
    ["one row", [RGBA, 8], slow ? 100000 : 300000, 1],
    ["one column", [RGB, 8], 1, slow ? 30000 : 300000],
  ] as const)("%s", async (name, format, width, height) => {
    const { lines, expected } = tall(format, width, height, 18);
    const file = writeAround(
      lines,
      { width, height, colorType: format[0], depth: format[1] },
      {
        deflate: lines => zlib.deflateSync(lines, { level: 1 }),
      },
    );
    expect(await mistakes([{ name, file, width, height, expected }])).toEqual([]);
  });

  // What a compressed chunk may inflate to follows from maxPixels, at 4 bytes a pixel and no less than 8 MiB.
  // These rows are 8.4 MiB, and that limit is not for them.
  test("16 bits a sample, and exactly as many pixels as maxPixels allows", async () => {
    const [width, height] = [1100, 1000];
    const { lines, expected } = tall([RGBA, 16], width, height, 27);
    expect(lines.length).toBeGreaterThan(8 << 20);
    const file = writeAround(
      lines,
      { width, height, colorType: RGBA, depth: 16 },
      {
        deflate: lines =>
          zlibStream(lines, [...inPieces(lines, 65535).map(piece => stored(piece)), stored(empty, true)]),
      },
    );
    expect(await mistakes([{ name: "", file, width, height, expected, maxPixels: width * height }])).toEqual([]);
  });
});

test("the same file many times at once", async () => {
  const whole = make("", noise([RGB, 16], 100, 60, randomBytes(25)), { interlaced: true, filter: row => row % 5 });
  expect(await mistakes(Array.from({ length: 64 }, (_, i) => ({ ...whole, name: `${i}` })))).toEqual([]);
});

test("metadata() of every kind of image", async () => {
  for (const format of formats) {
    for (const interlaced of [false, true]) {
      const file = write(noise(format, 13, 7, randomBytes(26)), { interlaced });
      expect(await new Bun.Image(file).metadata()).toEqual({ width: 13, height: 7, format: "png" });
    }
  }
});
