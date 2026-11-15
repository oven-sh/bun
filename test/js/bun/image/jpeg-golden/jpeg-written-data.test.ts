// The files that Bun.Image encodes, byte for byte those of libjpeg-turbo: coefficients and Huffman codes.
import { describe, expect, test } from "bun:test";
import { slow } from "../png-golden/check";
import { sha256 } from "../png-golden/observe";
import { randomBytes } from "../png-golden/write";
import { decode, difference, range } from "./decode";
import { encode, fileOf, fill, mistakes, noisy } from "./encode";
import { coefficientsOf, pictureOf, tablesFor, toYCbCr, transforms } from "./model";
import { read, segmentsOf } from "./read";
import {
  AC,
  frameOf,
  headerOf,
  jpeg,
  maxCorrectionBits,
  optimalTable,
  scanOf,
  simpleProgression,
  SOS,
  sos,
  Symbols,
  symbolsOf,
  ZRL,
} from "./write";

describe("color conversion, downsampling and DCT", () => {
  test("alpha is ignored", async () => {
    const picture = noisy(40, 20);
    const opaque = { ...picture, rgba: Buffer.from(picture.rgba.map((byte, i) => (i % 4 === 3 ? 255 : byte))) };
    expect((await encode(picture)).equals(await encode(opaque))).toBe(true);
  });

  test("every value of red, green and blue with many of the others", async () => {
    // At quality 100, a few samples that are off by one change the coefficients.
    const pictures = [0, 1, 2].map(c =>
      fill(256, slow ? 16 : 32, (x, y) =>
        [0, 1, 2].map(i => (i === c ? x : ((y >> 1) * (i + 3) * 17 + (x & ~1) * 7) & 255)),
      ),
    );
    expect(await mistakes(pictures, 100, [false])).toEqual([]);
  });

  test("colors next to a rounding boundary", async () => {
    const colors: number[][] = [];
    const random = randomBytes(3);
    for (const [r, g, b, plus] of toYCbCr) {
      for (const up of [true, false]) {
        for (let found = 0; found < 6;) {
          // A weight that is off by one moves the sum by at least 128.
          const color = [128 | random(), 128 | random(), 128 | random()];
          const rest = (r * color[0] + g * color[1] + b * color[2] + plus) & 65535;
          if (up ? rest < 65536 - 128 : rest >= 128) continue;
          colors.push(color);
          found++;
        }
      }
    }
    // Exact halves.
    colors.push(
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, 255],
      [255, 0, 0],
      [0, 0, 0],
      [255, 255, 255],
      [255, 255, 0],
      [0, 255, 255],
    );
    expect(await mistakes([fill(colors.length * 16, 16, x => colors[x >> 4])], 100, [false])).toEqual([]);
  });

  test("chroma is the mean of 2 by 2 samples, with a bias of 1 and 2 in turns", async () => {
    // Blue of 0 or 2 on black is a Cb of 128 or 129. All 16 patterns, in even and in odd columns.
    const picture = fill(32 * 16, 16, (x, y) => {
      const [way, odd] = [x >> 5, (x >> 4) & 1];
      return [0, 0, ((x >> 1) & 1) === odd && (way >> ((y & 1) * 2 + (x & 1))) & 1 ? 2 : 0];
    });
    expect(await mistakes([picture], 100, [false])).toEqual([]);
  });

  test("the largest coefficients", async () => {
    // Black and white, or blue and yellow, by the sign of each basis function.
    const { factors } = transforms[8];
    const sign = (k: number, x: number, y: number) =>
      factors[(x & 7) * 8 + (k & 7)] * factors[(y & 7) * 8 + (k >> 3)] > 0;
    const pictures = [true, false].flatMap(first => [
      fill(64, 64, (x, y) => Array(3).fill(sign((y >> 3) * 8 + (x >> 3), x, y) === first ? 255 : 0)),
      fill(128, 128, (x, y) => (sign((y >> 4) * 8 + (x >> 4), x >> 1, y >> 1) === first ? [0, 0, 255] : [255, 255, 0])),
    ]);
    expect(await mistakes(pictures, 100)).toEqual([]);
    // DC category 11.
    const stripes = fill(64, 16, x => ((x >> 3) & 1 ? [255, 255, 255] : [0, 0, 0]));
    expect(
      symbolsOf(coefficientsOf(stripes, 100), scanOf([0, 1, 2]))
        .occurrences()
        .get(0)![11],
    ).toBeGreaterThan(0);
    expect(await mistakes([stripes], 100)).toEqual([]);
  });

  test("noise, for the rounding of the DCT", async () => {
    expect(await mistakes([noisy(128, slow ? 64 : 512)], 100)).toEqual([]);
  });
});

/** A gray image that encodes to about these coefficients. */
function grayOf(blocks: ArrayLike<number>[], steps: number[], across = 16) {
  const frame = frameOf(across * 8, Math.ceil(blocks.length / across) * 8, "1x1", { tables: [steps] });
  blocks.forEach((block, i) => frame.components[0].data.set(block, i * 64));
  return pictureOf(frame);
}

describe("Huffman coding", () => {
  test("every run of zeros, before a coefficient and after it", async () => {
    const [steps] = tablesFor(75);
    const blocks = range(1, 63).flatMap(k => [
      range(0, 63).map(i => (i === k ? 3 : 0)),
      range(0, 63).map(i => (i === k ? -1 : i === 63 || i === k >> 1 ? 2 : 0)),
      range(0, 63).map(i => (i === k ? 2 : i === 63 || i === k >> 1 ? -1 : 0)),
    ]);
    const picture = grayOf(blocks, steps);
    const ac = (all: number[]) => all.slice(0, blocks.length * 64).filter((_, i) => i % 64);
    expect(ac([...coefficientsOf(picture, 75).components[0].data])).toEqual(ac(blocks.flat()));
    expect(await mistakes([picture], 75)).toEqual([]);
  });

  test("the longest codes in a row", async () => {
    // These levels give 520 after 9 zeros, 496 after 3 and -496 after 24: codes of 16 bits with 9 or 10 extra bits.
    const sign = (at: number) => +(((at + 1) & 2) !== 0);
    const apart = (x: number, y: number) => [255, 255, 249, 1][sign(y) * 2 + sign(x)];
    const diagonal = (x: number, y: number) => ((x & 7) + (y & 7) < 7 + ((x >> 6) & 1) ? 255 : 0);
    const random = randomBytes(6);
    const kinds = range(0, 255).map(() => random() % 5);
    const picture = fill(128, 128, (x, y) =>
      Array(3).fill([apart(x, y), 256 - apart(x, y), diagonal(x, y), 0, x + y][kinds[(y >> 3) * 16 + (x >> 3)]]),
    );
    const found = symbolsOf(coefficientsOf(picture, 100), scanOf([0, 1, 2])).occurrences();
    expect([0x9a, 0x39, ZRL, 0x89, 0x0a].filter(symbol => !found.get(AC)![symbol])).toEqual([]);
    expect(found.get(0)![11]).toBeGreaterThan(0);
    expect(await mistakes([picture], 100)).toEqual([]);
  });

  test("hundreds of thousands of symbols in a scan", async () => {
    // Noise with flat areas.
    const [noise, plain] = [noisy(1000, 1).rgba, Buffer.alloc(512 * 4, 200)];
    const rows = range(0, 383).flatMap(y =>
      y % 128 < 24 ? [plain] : [noise.subarray((y * y) % 2400).subarray(0, 400 * 4), plain.subarray(400 * 4)],
    );
    const picture = { width: 512, height: 384, rgba: Buffer.concat(rows) };
    const files = await Promise.all([false, true].map(progressive => encode(picture, { quality: 100, progressive })));
    expect(files.map(file => `${file.length} ${sha256(file).slice(0, 16)}`)).toEqual([
      "253124 5997b0b48c51dd6f",
      "182165 3249e6b0f2284b86",
    ]);
    const [baseline, progressive] = await Promise.all(files.map(file => decode(file)));
    expect(difference(progressive, baseline)).toBeUndefined();
  });

  test.each([
    ["at the end", 19, false, /^(..)+ff00$/],
    ["twice in a row", 6691, false, /^(..)+ff00ff00/],
    ["twice in a row at the end of a scan", 3871, true, /^(..)+ff00ff00$/],
  ])("FF is stuffed %s", async (_, seed, progressive, pattern) => {
    const picture = noisy(8, 8, seed);
    const { segments } = read(await encode(picture, { quality: 95, progressive }));
    expect(segments.map(({ data }) => data?.toString("hex"))).toContainEqual(expect.stringMatching(pattern));
    expect(await mistakes([picture], 95, [progressive])).toEqual([]);
  });

  test.each([
    [31, 100, false, 160, (k: number) => (k % 3 ? 0 : 31)],
    // The last scan has only correction bits, which are all 1.
    [99, 90, true, 480, (k: number) => (k & 5 ? 3 : -3)],
  ])("FF is stuffed if it is %i %% of a long scan", async (percent, quality, progressive, blocks, value) => {
    const picture = grayOf(Array(blocks).fill(range(0, 63).map(k => k && value(k))), tablesFor(quality)[0]);
    const data = segmentsOf(await encode(picture, { quality, progressive })).at(-1)!.data!;
    const stuffed = data.filter(byte => byte === 0xff).length;
    expect(Math.round((100 * stuffed) / (data.length - stuffed))).toBe(percent);
    expect(await mistakes([picture], quality, [progressive])).toEqual([]);
  });

  test("optimal codes are limited to 16 bits", async () => {
    // In the scan of 6 to 63 with Al = 2, 18 symbols have Fibonacci frequencies. One more fills the blocks: no EOB.
    const left: number[][] = [];
    for (let i = 18, a = 1, b = 2; i > 0; i--, [a, b] = [b, a + b])
      left.push(...Array(a).fill([Math.floor(i / 3), i % 3]));
    const random = randomBytes(4);
    const blocks = range(1, 28 * 16).map(() => {
      const block = new Int32Array(64);
      for (let k = 6; k < 64; k++) {
        const [run, size] = left.length && k + left.at(-1)![0] < 64 ? left.pop()! : [0, 0];
        block[(k += run)] = (random() & 1 ? 1 : -1) * [6, 12, 20][size];
      }
      return block;
    });
    const file = await encode(grayOf(blocks, Array(64).fill(1)), { quality: 100, progressive: true });
    const { frame } = read(file);
    expect(optimalTable(symbolsOf(frame, simpleProgression[4]).occurrences().get(AC)!).unlimited).toBe(19);
    expect(file.equals(fileOf(frame, true))).toBe(true);
  });

  test("an optimal table can have more than 128 codes", async () => {
    // In the same scan, every run with every size up to 8. Coefficient 39 is a square wave, so large values fit.
    const blocks = range(0, 127).map(i =>
      Array(64)
        .fill(0)
        .with(38 - (i >> 3), 6)
        .with(39, 6 << (i & 7)),
    );
    const file = await encode(grayOf(blocks, Array(64).fill(1)), { quality: 100, progressive: true });
    const { frame } = read(file);
    expect(optimalTable(symbolsOf(frame, simpleProgression[4]).occurrences().get(AC)!).symbols).toHaveLength(130);
    expect(file.equals(fileOf(frame, true))).toBe(true);
  });

  test("ties between frequencies are broken as in libjpeg", async () => {
    // Small images have many ties.
    expect(
      await mistakes(
        range(1, 40).map(seed => noisy(3 + (seed % 14), 8, seed)),
        60,
        [true],
      ),
    ).toEqual([]);
  });

  test("an EOB run has up to 32767 blocks", async () => {
    for (const [wide, high] of [
      [2 * 43, 3 * 127],
      [7 * 31, 151],
      [256, 128],
      [362, 182],
    ]) {
      // Without data, all samples are 128.
      const frame = { ...frameOf(1, 1), width: wide * 8, height: high * 8 };
      const file = await new Bun.Image(jpeg(headerOf(frame), sos(frame, scanOf([0]))))
        .jpeg({ progressive: true })
        .bytes();
      const symbols = new Symbols();
      for (let left = wide * high; left > 0; left -= 32767) symbols.eobRun(AC, Math.min(left, 32767));
      const expected = symbols.bytes({ [AC]: optimalTable(symbols.occurrences().get(AC)!) });
      const scans = segmentsOf(file).filter(({ code }) => code === SOS);
      expect([1, 4, 5, 9].map(i => scans[i].data!.toString("hex"))).toEqual(Array(4).fill(expected.toString("hex")));
    }
  });

  test("an EOB run ends when more than 937 correction bits are pending", async () => {
    const [steps] = tablesFor(90);
    /** `count` correction bits in the last scan, and no new coefficient. */
    const having = (count: number): number[] => range(0, 63).map(k => (k > 63 - count ? (k % 3 ? 2 : -3) : 0));
    const [many, none] = [having(26), having(0).with(63, 1)];
    const blocks = [maxCorrectionBits - 1, maxCorrectionBits, maxCorrectionBits + 1].flatMap(bits => [
      ...Array(35).fill(many),
      having(bits - 35 * 26),
      having(1),
      having(1),
      none,
    ]);
    const file = await encode(grayOf(blocks, steps), { quality: 90, progressive: true });
    const { frame, runs } = read(file);
    expect(runs.filter(run => run.corrections > 900)).toEqual([
      { blocks: 38, corrections: 938 },
      { blocks: 37, corrections: 938 },
      { blocks: 36, corrections: 938 },
    ]);
    expect(file.equals(fileOf(frame, true))).toBe(true);
  });

  test("an EOB run can have 1000 correction bits", async () => {
    const random = randomBytes(5);
    const full = () => range(0, 63).map(k => (k ? (random() & 1 ? 1 : -1) * (8 + (random() & 7)) : 0));
    // 14 times 63 and 55.
    const blocks = [...range(1, 14).map(full), full().fill(0, 56), full()];
    const [steps] = tablesFor(97);
    const small = blocks.map(block =>
      block.map((value, k) => Math.sign(value) * Math.max(2, Math.round(Math.abs(value) / steps[k])) || 0),
    );
    const file = await encode(grayOf(small, steps), { quality: 97, progressive: true });
    const { frame, runs } = read(file);
    expect(runs).toContainEqual({ blocks: 16, corrections: 1000 });
    expect(file.equals(fileOf(frame, true))).toBe(true);
  });
});
