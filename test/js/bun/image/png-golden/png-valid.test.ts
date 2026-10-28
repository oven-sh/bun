// Pictures of every kind that PNG has, in files that keep every rule of the specification. Each file is written
// around samples that are chosen first (write.ts), so what it has to decode to is known without asking a decoder.
// What else a valid file may hold is in png-valid-chunks.test.ts, how it may be compressed in png-valid-stream.test.ts.
// Files that were made elsewhere are in png-valid-kept.test.ts.
import { describe, expect, test } from "bun:test";
import { make, maker, mistakes, slow, type Case } from "./check";
import {
  channelsOf,
  chunk,
  formats,
  GRAY,
  GRAY_ALPHA,
  INDEXED,
  noise,
  randomBytes,
  RGB,
  RGBA,
  type Picture,
} from "./write";

const nameOf = ([colorType, depth]: readonly [number, number]) =>
  `${{ [GRAY]: "gray", [RGB]: "RGB", [INDEXED]: "indexed", [GRAY_ALPHA]: "gray with alpha", [RGBA]: "RGBA" }[colorType]}, ${depth} bits`;

/**
 * Filter types such that every sequence of `length` of them comes up once in as many rows, if one goes round.
 * https://en.wikipedia.org/wiki/De_Bruijn_sequence#Algorithm
 */
function everySequenceOfFilters(length: number) {
  const [out, word] = [[] as number[], Array(length + 1).fill(0)];
  const extend = (at: number, period: number) => {
    if (at > length) {
      if (length % period === 0) out.push(...word.slice(1, period + 1));
      return;
    }
    word[at] = word[at - period];
    extend(at + 1, period);
    for (let next = word[at - period] + 1; next < 5; next++) {
      word[at] = next;
      extend(at + 1, at);
    }
  };
  extend(1, 1);
  return out;
}
const filters = everySequenceOfFilters(slow ? 2 : 3);

describe.each(formats.map(format => [nameOf(format), format] as const))("%s", (_, format) => {
  const [colorType, depth] = format;
  const channels = channelsOf(colorType);
  const mayHaveTransparency = colorType === GRAY || colorType === RGB || colorType === INDEXED;

  /** Noise or a few colors, with and without tRNS, a palette of any length, any filters, and dirt in the unused bits. */
  function varied(width: number, height: number, interlaced: boolean, random: () => number) {
    const [few, transparent] = [random() < 128, mayHaveTransparency && random() < 128];
    const paletteLength = 1 + (random() % (1 << Math.min(depth, 8)));
    return make(
      `${width} x ${height}${few ? ", few colors" : ""}${transparent ? ", tRNS" : ""}`,
      noise(format, width, height, random, { few, transparent, paletteLength }),
      { interlaced, filter: () => random() % 5, padding: random },
    );
  }

  test("rows of every length", async () => {
    const random = randomBytes(1);
    const widths = new Set(Array.from({ length: slow ? 33 : 70 }, (_, i) => i + 1));
    // Up to where the loops over a row have taken every turn they can.
    for (let bytes = 1; bytes <= (slow ? 0 : 300); bytes++) widths.add(Math.floor((bytes * 8) / (channels * depth)));
    widths.delete(0);
    const cases: Case[] = [];
    for (const width of widths) {
      for (const height of slow && width > 9 ? [2] : [1, 2, 3]) cases.push(varied(width, height, false, random));
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  // Which of the seven passes have no pixels depends on the width and on the height.
  test("interlaced, every small size and some larger", async () => {
    const random = randomBytes(2);
    const cases: Case[] = [];
    for (let width = 1; width <= (slow ? 9 : 32); width++) {
      for (let height = 1; height <= (slow ? 9 : 32); height++) cases.push(varied(width, height, true, random));
    }
    for (const [width, height] of [
      [16, 16],
      [17, 17],
      [33, 5],
      [5, 33],
      [1, 40],
      [40, 1],
      [2, 23],
      [23, 2],
    ]) {
      cases.push(varied(width, height, true, random));
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  test("every filter after every other, and each of them first", async () => {
    const random = randomBytes(3);
    const cases: Case[] = [];
    for (const [bytes, firsts] of [
      [1, [0, 1, 2, 3, 4]],
      [9, [0, 1, 2, 3, 4]],
      [50, [4]],
      [260, [3]],
    ] as const) {
      const width = Math.ceil((bytes * 8) / (channels * depth));
      for (const first of firsts) {
        const start = filters.indexOf(first);
        const picture = noise(format, width, filters.length + 2, random, { few: first % 2 === 1 });
        const filter = (row: number) => filters[(start + row) % filters.length];
        cases.push(make(`${width} pixels wide, ${first} first`, picture, { filter }));
      }
    }
    // All of them in each pass, and another one first in each.
    for (const shift of [0, 9]) {
      cases.push(
        make(`interlaced, shifted by ${shift}`, noise(format, 11, 8 * (filters.length + 2), random), {
          interlaced: true,
          filter: (row, pass) => filters[(row + pass * 4 + shift) % filters.length],
        }),
      );
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  test("every value of a sample", async () => {
    // At 16 bits every high byte, with low bytes from one end to the other. In each channel in another order.
    const lowBytes = [0, 1, 2, 63, 64, 127, 128, 129, 191, 192, 253, 254, 255];
    const [width, height] = depth === 16 ? [256, lowBytes.length] : [1 << depth, 1];
    const samples = new Uint16Array(width * height * channels);
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < channels; c++, i++) {
          const value = (x * [1, 3, 5, 7][c] + c * 97) % width;
          samples[i] = depth === 16 ? (value << 8) | lowBytes[(y + c) % height] : value;
        }
      }
    }
    const picture: Picture = { width, height, colorType, depth, samples };
    if (colorType === INDEXED) picture.palette = Uint8Array.from({ length: width * 3 }, randomBytes(4));
    expect(await mistakes([make("plain", picture), make("interlaced", picture, { interlaced: true })])).toEqual([]);
  });
});

describe("tRNS", () => {
  test.each([1, 2, 4, 8])("gray, %d bits: every value", async depth => {
    const width = 1 << depth;
    const samples = Uint16Array.from({ length: width }, (_, i) => i);
    const cases: Case[] = [];
    for (let value = 0; value < width; value += slow && value > 16 && value < 240 ? 7 : 1) {
      cases.push(make(`${value}`, { width, height: 1, colorType: GRAY, depth, samples, transparency: [value] }));
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  // The first and the last pixel are of the transparent color. Each of the others differs from it in one bit.
  test.each([
    [GRAY, 16],
    [RGB, 8],
    [RGB, 16],
  ] as const)("color type %d, %d bits: one bit off is opaque", async (colorType, depth) => {
    const random = randomBytes(5);
    const channels = channelsOf(colorType);
    const cases: Case[] = [];
    for (let round = 0; round < 8; round++) {
      const color = Array.from({ length: channels }, () => ((random() << 8) | random()) & ((1 << depth) - 1));
      const width = 2 + channels * depth;
      const samples = new Uint16Array(width * channels);
      for (let x = 0; x < width; x++) samples.set(color, x * channels);
      for (let bit = 0; bit < channels * depth; bit++) {
        samples[(1 + bit) * channels + Math.floor(bit / depth)] ^= 1 << (bit % depth);
      }
      const picture = { width, height: 1, colorType, depth, samples, transparency: color };
      cases.push(make(`${color}`, picture), make(`${color}, interlaced`, picture, { interlaced: true }));
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  test("a color that no pixel has", async () => {
    const cases = (
      [
        [GRAY, 1],
        [GRAY, 8],
        [GRAY, 16],
        [RGB, 8],
        [RGB, 16],
      ] as const
    ).map(([colorType, depth]) => {
      const channels = channelsOf(colorType);
      const picture = { width: 4, height: 1, colorType, depth, samples: new Uint16Array(4 * channels) };
      return make(`${colorType}, ${depth}`, { ...picture, transparency: Array(channels).fill(1) });
    });
    expect(await mistakes(cases)).toEqual([]);
  });
});

describe("PLTE", () => {
  test.each([1, 2, 4, 8])("%d bits: of every length, with tRNS of every length", async depth => {
    const random = randomBytes(6);
    const cases: Case[] = [];
    for (let length = 1; length <= 1 << depth; length += slow && length > 16 && length < 240 ? 13 : 1) {
      const samples = Uint16Array.from({ length }, (_, i) => i);
      const palette = Uint8Array.from({ length: length * 3 }, random);
      // At 8 bits that would be 32,896 files, so only the ends and some in between.
      const between = Array.from({ length: slow ? 1 : 6 }, () => 1 + (random() % length));
      const counts = depth < 8 ? Array.from({ length: length + 1 }, (_, i) => i) : [0, 1, ...between, length];
      for (const count of new Set(counts)) {
        const transparency = count ? Array.from({ length: count }, random) : undefined;
        const picture = { width: length, height: 1, colorType: INDEXED, depth, samples, palette, transparency };
        cases.push(make(`${length} colors, ${count} alphas`, picture));
      }
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  test("only suggests colors where the pixels have their own", async () => {
    const random = randomBytes(7);
    const cases: Case[] = [];
    for (const format of [
      [RGB, 8],
      [RGB, 16],
      [RGBA, 8],
      [RGBA, 16],
    ] as const) {
      const picture = noise(format, 5, 3, random);
      for (const length of [1, 2, 255, 256]) {
        const palette = Uint8Array.from({ length: length * 3 }, random);
        const withPalette = maker({ ...picture, palette });
        cases.push(
          withPalette(`${format}, ${length} colors`, { beforeData: [chunk("hIST", Buffer.alloc(length * 2, 1))] }),
        );
      }
    }
    expect(await mistakes(cases)).toEqual([]);
  });
});
