// The rules for arithmetic coding.
import { describe, expect, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { ArithmeticCoder, states } from "./arithmetic";
import { decode, difference, eights, expectPictures, flat, levels, range, where, type Case } from "./decode";
import { pictureOf } from "./model";
import {
  AC,
  as,
  coded,
  DAC,
  dri,
  frameOf,
  headerOf,
  jpeg,
  marker,
  noise,
  RST0,
  scanOf,
  segment,
  simpleProgression,
  SOF10,
  SOF9,
  sos,
  stuffed,
  unfinished,
  write,
  type Frame,
  type Scan,
} from "./write";

test("every state of the estimate, and both ways out of it", async () => {
  // All 14 lower bits of a coefficient of 15 bits share a bin, and can be anything. What comes behind them is only
  // right if the decoder kept up. Those of the first in each block show which bit it takes for the more probable.
  const [firstOfSize, bitsOfSize] = [217, 217 + 13 + 14];
  const ways = states.map(({ less, more }) => [less & 127, more]);
  const untaken = new Set(states.flatMap((_, state) => [state * 2, state * 2 + 1]));
  /** Which way to go for the nearest that has not been taken. */
  function wayFrom(start: number) {
    const queue = [0, 1].map(way => [start, way, way]);
    const seen = new Set([start]);
    for (const [state, way, first] of queue) {
      if (untaken.has(state * 2 + way)) return first;
      const next = ways[state][way];
      if (!seen.has(next)) queue.push([next, 0, first], [next, 1, first]);
      seen.add(next);
    }
  }
  const random = randomBytes(1);
  const cases: Case[] = [];
  while (untaken.size) {
    const coder = new ArithmeticCoder();
    const bins = coder.ac(0);
    const blocks: number[][] = [];
    let way = wayFrom(0);
    // Some more when nothing new can be reached from here, so that the last state is put to use.
    for (let more = 3; more; more -= way === undefined ? 1 : 0) {
      const block = [(random() & 63) - 32];
      coder.difference(0, 0, block[0] - (blocks.at(-1)?.[0] ?? 0));
      blocks.push(block);
      for (let k = 1; k < 64; k++) {
        coder.decide(bins, 3 * (k - 1), 0);
        coder.decide(bins, 3 * (k - 1) + 1, 1);
        coder.evenly(k & 1);
        coder.decide(bins, 3 * (k - 1) + 2, 1);
        // Some are just 2. That stirs up the interval, which has to be at its narrowest for an unlikely step.
        const large = k === 1 ? 1 : random() & 1;
        coder.decide(bins, 3 * (k - 1) + 2, large);
        if (!large) continue;
        for (let x = 0; x <= 13; x++) coder.decide(bins, firstOfSize + x, x < 13 ? 1 : 0);
        let value = 1;
        for (let i = 0; i < 14; i++) {
          const state = bins[bitsOfSize];
          const bit = (state >> 7) ^ (way === 0 ? 1 : 0);
          value = value * 2 + bit;
          if (!coder.decide(bins, bitsOfSize, bit) || way === undefined) continue;
          untaken.delete((state & 127) * 2 + way);
          way = wayFrom(bins[bitsOfSize] & 127);
        }
        block[1] ??= -value - 1;
        if (way === undefined && k < 63) {
          coder.decide(bins, 3 * k, 1);
          break;
        }
      }
    }
    // In 16 bits, 64 times that is -64 if all are 0, and 0 if all are 1.
    const frame = frameOf(8, blocks.length * 8, "1x1", { type: SOF9, tables: [[8, 64, ...Array(62).fill(0)]] });
    blocks.forEach((block, i) => frame.components[0].data.set(block, i * 64));
    const file = jpeg(headerOf(frame), segment(DAC, [AC, 0]), sos(frame, scanOf([0])), stuffed(coder.finish()));
    cases.push({ name: `${cases.length}`, file, eighths: 2, expected: pictureOf(frame, { eighths: 2 }) });
  }
  await expectPictures(cases);
});

describe.each([
  ["sequential", SOF9, [scanOf([0, 1, 2])]],
  ["progressive", SOF10, simpleProgression],
])("%s", (_, type, scans) => {
  // Differences of every size, next to each other in every way.
  const random = randomBytes(2);
  const frame = noise(frameOf(64, 40, "1x1,1x1,1x1", { type }), random, { sparse: 3, ac: 60 });
  for (const { data } of frame.components) {
    for (let i = 64; i < data.length; i += 64) {
      const size = (1 << (random() % 10)) + (random() & 3) - 1;
      data[i] = data[i - 64] + (Math.abs(data[i - 64]) > 500 ? -Math.sign(data[i - 64]) : random() & 1 ? 1 : -1) * size;
    }
  }
  const expected = pictureOf(frame);
  const withAll = (more: Partial<(typeof scans)[0]>) =>
    write(
      frame,
      scans.map(scan => ({ ...scan, ...more })),
    );

  test("DAC says which differences are small and which are large", async () => {
    const bounds = range(0, 11).flatMap(upper => range(0, upper).map(lower => (upper << 4) | lower));
    await expectPictures(
      [...bounds.filter((_, i) => !slow || i % (type === SOF9 ? 3 : 7) === 0), 0xf0, 0xff].map(both => {
        // The other table is left as it is.
        const file = write(frame, [{ ...scans[0], conditioning: { 1: both } }, ...scans.slice(1)]);
        return { name: both.toString(16), file, expected };
      }),
    );
  });

  test("and up to where the low frequencies go", async () => {
    await expectPictures(
      [0, 1, 4, 5, 6, 31, 62, 63, 64, 255].map(k => ({
        name: `${k}`,
        file: withAll({ conditioning: { [AC]: k } }),
        expected,
      })),
    );
  });

  test("there are 16 tables of each class, and components that name the same one share it", async () => {
    await expectPictures(
      range(0, 15).map(number => {
        const [dc, ac] = [
          [number, number, 15 - number],
          [15 - number, number, number],
        ];
        const conditioning = { [number]: 0x52, [AC + number]: 20 };
        return { name: `${number}`, file: withAll({ dc, ac, conditioning }), expected };
      }),
    );
  });

  test("a restart marker starts everything anew", async () => {
    await expectPictures(
      (slow ? [2, 7, 39] : [1, 2, 7, 8, 39, 40]).map(interval => ({
        name: `${interval}`,
        file: withAll({ interval }),
        expected,
      })),
    );
  });

  test("so it does whichever tables the components have or share", async () => {
    const numbers = ["000 000", "012 012", "555 999", "377 7c3", "f0f 0ff"];
    await expectPictures(
      numbers.map(name => {
        const [dc, ac] = name.split(" ").map(digits => [...digits].map(digit => parseInt(digit, 16)));
        const of = (scan: Scan, numbers: number[]) => scan.components.map(c => numbers[c]);
        const restarted = scans.map(scan => ({ ...scan, dc: of(scan, dc), ac: of(scan, ac), interval: 5 }));
        return { name, file: write(frame, restarted), expected };
      }),
    );
  });

  test("where the data ends, zeros follow", async () => {
    const small = noise(frameOf(16, 16, "1x1", { type }), randomBytes(3), { sparse: 4, ac: 8 });
    small.tables = [[1, ...Array(63).fill(0)]];
    const { header, data } = coded(small, scanOf([0], 0, type === SOF9 ? 63 : 0));
    const same = async (length: number) => {
      // One pixel for each block is what it is, however far from a sample.
      const start = unfinished(headerOf(small), header, data.subarray(0, length));
      const [cut, filled] = await Promise.all(
        [start, Buffer.concat([start, Buffer.alloc(2000)])].map(file => decode(file, 1)),
      );
      return String(difference(cut, filled));
    };
    const lengths = range(0, data.length).filter(length => data[length - 1] !== 0xff);
    expect(await where(lengths, same)).toEqual({ undefined: lengths });
  });
});

test("DAC holds until the next one", async () => {
  const frame = noise(frameOf(24, 24, "1x1,1x1,1x1", { type: SOF9 }), randomBytes(4), { sparse: 2 });
  const of = (c: number, conditioning: Record<number, number>) =>
    coded(frame, scanOf([c], 0, 63, 0, 0, { dc: [0], ac: [0], conditioning }));
  const [first, second, third] = [
    of(0, { 0: 0x75, [AC]: 30 }),
    of(1, { 0: 0x75, [AC]: 30 }),
    of(2, { 0: 0x33, [AC]: 30 }),
  ];
  const file = jpeg(
    ...first.tables,
    headerOf(frame),
    ...[first.header, first.data, second.header, second.data],
    ...[segment(DAC, [0, 0x33]), third.header, third.data],
  );
  await expectPictures([{ name: "three scans", file, expected: pictureOf(frame) }]);
});

test("values of up to 15 bits and one more, and sums of 16", async () => {
  // Three of four blocks of luma only fill the MCU, and AC coefficients are multiplied by 0.
  const frame = frameOf(8, 17 * 8, "4x1,1x1,1x1", { type: SOF9, tables: [[1, ...Array(63).fill(0)]] });
  for (let size = 0; size <= 15; size++) {
    const level = size * 8;
    [level, level + (1 << size), level, level - (1 << size)].forEach((dc, i) => {
      // At low frequencies, and at high.
      const ac = [1 << size, -1 << size, (1 << size) - 1];
      frame.components[0].data.set([dc, ...ac, 0, 0, ...ac], (size * 4 + i) * 64);
    });
  }
  frame.components[0].data[16 * 4 * 64] = -100;
  const expected = pictureOf(frame);
  await expectPictures([
    { name: "sequential", file: write(frame), expected },
    { name: "progressive", file: write(as(SOF10, frame), [scanOf([0, 1, 2], 0, 0), scanOf([0], 1, 63)]), expected },
  ]);
});

test("a refinement goes by what the coefficients have come to in 16 bits", async () => {
  const frame = frameOf(8, 8, "1x1", { type: SOF10, tables: [Array(64).fill(8)] });
  const band = (ah: number, al: number, ...values: number[]) => {
    frame.components[0].data.fill(0).set(values, 1);
    const { header, data } = coded(frame, scanOf([0], 1, 5, ah, al));
    return [header, data];
  };
  const files = [
    [...band(0, 2, 8, 8, 8), ...band(0, 2, 0, 0x10000), ...band(2, 1, 10, -2, 8)],
    // A bit is added whether or not it is there.
    [...band(0, 0, 9, -1, 8), ...band(1, 0, 3, -3, 2)],
  ].map(scans => jpeg(headerOf(frame), ...scans));
  frame.components[0].data.set([10, -2, 8], 1);
  await expectPictures(files.map((file, i) => ({ name: `${i}`, file, expected: pictureOf(frame) })));
});

test("FF 00 is FF, with any number of FF", async () => {
  const frame = noise(frameOf(32, 32, "1x1", { type: SOF9 }), randomBytes(5));
  const { header, data } = coded(frame, scanOf([0]));
  const filled = Buffer.from(data.toString("latin1").replaceAll("\xff\0", "\xff\xff\xff\0"), "latin1");
  expect(filled.length).toBeGreaterThan(data.length);
  await expectPictures([{ name: "filled", file: jpeg(headerOf(frame), header, filled), expected: pictureOf(frame) }]);
});

describe("after what cannot be, nothing is read up to the next restart marker", () => {
  const block = (...coefficients: number[]) => Int32Array.from({ length: 64 }, (_, k) => coefficients[k] ?? 0);
  /** A difference of 16 bits. */
  const tooLarge = (coder: ArithmeticCoder, context: number) => {
    coder.decide(coder.dc(0), context, 1);
    coder.decide(coder.dc(0), context + 1, 0);
    for (const bin of [context + 2, ...range(20, 34)]) coder.decide(coder.dc(0), bin, 1);
  };
  /** The same at `k`, or else zeros from there to `se`, where there should be something else. */
  const wrongAt = (coder: ArithmeticCoder, k: number, se?: number) => {
    const bins = coder.ac(0);
    coder.decide(bins, 3 * (k - 1), 0);
    if (se) return range(k, se).forEach(k => coder.decide(bins, 3 * (k - 1) + 1, 0));
    coder.decide(bins, 3 * (k - 1) + 1, 1);
    coder.evenly(0);
    for (const bin of [3 * (k - 1) + 2, 3 * (k - 1) + 2, ...range(189, 202)]) coder.decide(bins, bin, 1);
  };
  /** Two intervals of three blocks, across or down. `wrong` writes the first, up to the fault, and `good` a block. */
  async function expectBlocks(
    type: number,
    band: [number, number, number, number],
    wrong: (coder: ArithmeticCoder) => void,
    good: (coder: ArithmeticCoder) => void,
    blocks: number[][],
    earlier = (frame: Frame) => [] as Buffer[],
  ) {
    const [first, second] = [new ArithmeticCoder(), new ArithmeticCoder()];
    wrong(first);
    for (const coder of [first, first, second, second, second]) good(coder);
    const data = [stuffed(first.finish()), marker(RST0), stuffed(second.finish())];
    await expectPictures(
      [1, 6].map(rows => {
        // The 0 keeps it from being smoothed.
        const frame = frameOf(48 / rows, 8 * rows, "1x1", { type, tables: [eights.with(9, 0)] });
        const file = jpeg(headerOf(frame), ...earlier(frame), dri(3), sos(frame, scanOf([0], ...band)), ...data);
        blocks.forEach((coefficients, i) => frame.components[0].data.set(coefficients, i * 64));
        return { name: `${JSON.stringify(blocks)} in ${rows}`, file, expected: pictureOf(frame) };
      }),
    );
  }

  test("sequential", async () => {
    const good = (coder: ArithmeticCoder) => {
      coder.difference(0, 0, 2);
      coder.band(0, block(0, 3), 1, 63, 0, 0);
    };
    const after = [
      [2, 3],
      [4, 3],
      [6, 3],
    ];
    const difference = (coder: ArithmeticCoder) => {
      good(coder);
      tooLarge(coder, 4);
    };
    await expectBlocks(SOF9, [0, 63, 0, 0], difference, good, [[2, 3], [], [], ...after]);
    // What was read of the block is kept.
    for (const se of [undefined, 63]) {
      const coefficient = (coder: ArithmeticCoder) => {
        good(coder);
        coder.difference(0, 0, 5);
        coder.band(0, block(0, -4), 1, 1, 0, 0);
        wrongAt(coder, 2, se);
      };
      await expectBlocks(SOF9, [0, 63, 0, 0], coefficient, good, [[2, 3], [7, -4], [], ...after]);
    }
  });

  test("DC coefficients", async () => {
    const good = (coder: ArithmeticCoder) => coder.difference(0, 0, 2);
    const wrong = (coder: ArithmeticCoder) => {
      good(coder);
      tooLarge(coder, 4);
    };
    await expectBlocks(SOF10, [0, 0, 0, 1], wrong, good, [[4], [], [], [4], [8], [12]]);
  });

  test("first scan of a band", async () => {
    const good = (coder: ArithmeticCoder) => coder.band(0, block(0, 3), 1, 5, 0, 0);
    for (const se of [undefined, 5]) {
      const wrong = (coder: ArithmeticCoder) => {
        good(coder);
        coder.band(0, block(0, -4), 1, 1, 0, 0);
        wrongAt(coder, 2, se);
      };
      await expectBlocks(SOF10, [1, 5, 0, 1], wrong, good, [[0, 6], [0, -8], [], ...Array(3).fill([0, 6])]);
    }
  });

  /** 2 or else `value` at 1 in all blocks. */
  const earlier = (value: number) => (frame: Frame) => {
    const coder = new ArithmeticCoder();
    for (let i = 0; i < 6; i++) coder.band(0, block(0, value), 1, 5, 0, 0);
    return [sos(frame, scanOf([0], 1, 5)), stuffed(coder.finish())];
  };

  test("refinement", async () => {
    const good = (coder: ArithmeticCoder) => coder.band(0, block(0, 3, 0, -1), 1, 5, 1, 0);
    const wrong = (coder: ArithmeticCoder) => {
      good(coder);
      coder.band(0, block(0, 3), 1, 1, 1, 0);
      wrongAt(coder, 2, 5);
    };
    const refined = [0, 3, 0, -1];
    await expectBlocks(
      SOF10,
      [1, 5, 1, 0],
      wrong,
      good,
      [refined, [0, 3], [0, 2], refined, refined, refined],
      earlier(2),
    );
  });

  test("which a bit that is set already is not: it is added", async () => {
    for (const value of [3, -3]) {
      const good = (coder: ArithmeticCoder) => coder.band(0, block(0, value), 1, 5, 1, 0);
      await expectBlocks(SOF10, [1, 5, 1, 0], good, good, Array(6).fill([0, value + Math.sign(value)]), earlier(value));
    }
  });
});

test("an MCU is given up where the fault is", async () => {
  const frame = frameOf(8, 8, "1x1,1x1,1x1", { type: SOF9, ids: [82, 71, 66], tables: [eights] });
  const coder = new ArithmeticCoder();
  coder.difference(0, 0, 9);
  coder.decide(coder.ac(0), 0, 1);
  coder.difference(1, 1, 7);
  coder.decide(coder.ac(1), 0, 0);
  for (let k = 1; k < 64; k++) coder.decide(coder.ac(1), 3 * (k - 1) + 1, 0);
  coder.difference(1, 2, 5);
  const { rgba } = await decode(jpeg(headerOf(frame), sos(frame, scanOf([0, 1, 2])), stuffed(coder.finish())));
  expect([...rgba.subarray(0, 4)]).toEqual([137, 135, 128, 255]);
});

test("restart markers that are out of turn", async () => {
  const one = (level: number) => coded(flat([[level]], SOF9), scanOf([0])).data;
  const frame = flat([[0, 0, 0]], SOF9);
  const shown = (...data: Buffer[]) => levels(jpeg(headerOf(frame), dri(1), sos(frame, scanOf([0])), ...data));
  const rst = (number: number) => marker(RST0 + number);
  const [[[zeros]]] = [await levels(jpeg(headerOf(flat([[0]], SOF9)), sos(frame, scanOf([0]))))];
  expect(await shown(one(1), rst(0), one(2), rst(1), one(3))).toEqual([[1, 2, 3]]);
  expect(await shown(one(1), Buffer.alloc(20, 7), rst(0), one(2), rst(1), one(3))).toEqual([[1, 2, 3]]);
  expect(await shown(one(1), rst(1), one(3))).toEqual([[1, zeros, 3]]);
  expect(await shown(one(1), rst(7), one(9), rst(0), one(2), rst(1), one(3))).toEqual([[1, 2, 3]]);
  expect(await shown(one(1), rst(4), one(2), rst(1), one(3))).toEqual([[1, 2, 3]]);
  expect(await shown(one(1))).toEqual([[1, zeros, zeros]]);
});
