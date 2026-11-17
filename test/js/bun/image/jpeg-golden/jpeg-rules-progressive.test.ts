// Progressive scans.
import { describe, expect, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { bytes, decode, everySymbol, expectPictures, fine, grouped, headerOnly, hex, outcome, range } from "./decode";
import { pictureOf, smoothed } from "./model";
import {
  AC,
  bitByBit,
  coded,
  copyOf,
  dcOnly,
  dht,
  dhts,
  dri,
  EOB,
  EOI,
  forThree,
  frameOf,
  headerOf,
  int16,
  jpeg,
  marker,
  noise,
  progressiveTypes,
  rst,
  RST0,
  scanOf,
  scanWithTables,
  simpleProgression,
  SOF2,
  sos,
  stuffed,
  Symbols,
  tableOf,
  typical,
  withoutEoi,
  write,
  ZRL,
  type Frame,
  type Scan,
} from "./write";

describe.each(progressiveTypes)("%s", (_, type) => {
  const color = frameOf(8, 8, "1x1,1x1,1x1", { type });
  const start = [headerOf(color), ...dhts(typical)];
  const [first, later] = [[], [sos(color, scanOf([0, 1, 2], 0, 0))]].map(
    before => (scan: Scan) => outcome(jpeg(...start, ...before, sos(color, scan))),
  );

  test("Ss and Se are both 0, or a band within 1 to 63", async () => {
    const some = [0, 1, 2, 62, 63, 64, 255];
    const bands = some.flatMap(ss => some.map(se => [ss, se]));
    const allowed = bands.filter(([ss, se]) => (ss === 0 ? se === 0 : ss <= se && se <= 63));
    for (const as of [first, later]) {
      expect(await grouped(bands, ([ss, se]) => as(scanOf([0], ss, se)))).toEqual({
        [fine]: allowed,
        [headerOnly]: bands.filter(band => !allowed.includes(band)),
      });
    }
  });

  test("an AC scan has one component", async () => {
    const groups = [[0], [2], [0, 1], [0, 1, 2]];
    expect(await grouped(groups, group => first(scanOf(group, 0, 0)))).toEqual({ [fine]: groups });
    expect(await grouped(groups, group => later(scanOf(group, 1, 63)))).toEqual({
      [fine]: groups.slice(0, 2),
      [headerOnly]: groups.slice(2),
    });
  });

  test("Al is at most 13, and Ah is 0 or Al + 1", async () => {
    const allowed = [...range(0, 13), ...range(1, 14).map(ah => (ah << 4) | (ah - 1))];
    for (const [ss, se] of [
      [0, 0],
      [1, 63],
    ]) {
      expect(await grouped(bytes, both => first(scanOf([0], ss, se, both >> 4, both & 15)), hex)).toEqual({
        [fine]: hex(allowed),
        [headerOnly]: hex(bytes.filter(both => !allowed.includes(both))),
      });
    }
  });

  test("any sequence of scans gives the same image", async () => {
    const scripts: Record<string, Scan[]> = {
      usual: simpleProgression,
      "bands only": [
        scanOf([0, 1, 2], 0, 0),
        ...forThree(c => [scanOf([c], 1, 1), scanOf([c], 2, 62), scanOf([c], 63, 63)]),
      ],
      "high bands first": forThree(c => [scanOf([c], 0, 0), scanOf([c], 33, 63), scanOf([c], 1, 32)]),
      "bits only": [...bitByBit(4, [0, 1, 2], 0, 0), ...forThree(c => bitByBit(4, [c], 1, 63))],
      "DC in two groups": [
        ...bitByBit(1, [0, 2], 0, 0),
        ...bitByBit(2, [1], 0, 0),
        ...forThree(c => bitByBit(1, [c], 1, 63)),
      ],
      "refined in other bands": [
        scanOf([0, 1, 2], 0, 0),
        ...forThree(c => [scanOf([c], 1, 63, 0, 1), scanOf([c], 20, 63, 1, 0), scanOf([c], 1, 19, 1, 0)]),
      ],
      // T.81 wants it first.
      "DC last": [...forThree(c => [scanOf([c], 1, 63)]), scanOf([0, 1, 2], 0, 0)],
    };
    const random = randomBytes(1);
    await expectPictures(
      (slow ? [2, 40] : [1, 5, 40]).flatMap(sparse => {
        const frame = noise(frameOf(35, 19, "2x2,1x1,1x1", { type }), random, { sparse, ac: 40 });
        const expected = pictureOf(frame);
        return Object.entries(scripts).flatMap(([name, scans]) =>
          [{}, { interval: 3 }].map(more => ({
            name: `${name}, one in ${sparse}, ${JSON.stringify(more)}`,
            file: write(
              frame,
              scans.map(scan => ({ ...scan, ...more })),
            ),
            expected,
          })),
        );
      }),
    );
  });

  test("the bits below Al are 0", async () => {
    const frame = frameOf(8, 8, "1x1", { type });
    await expectPictures(
      range(0, 9).map(al => {
        frame.components[0].data.set([-1 << al, 1 << al, 0, -1 << al]);
        const file = write(frame, [scanOf([0], 0, 0, 0, al), scanOf([0], 1, 63, 0, al)]);
        const missing = Array(10).fill(al);
        return { name: `${al}`, file, expected: pictureOf(smoothed(frame, () => missing)) };
      }),
    );
  });

  test("a DC coefficient wraps at 16 bits", async () => {
    const [frame, wrapped] = [0, 1].map(() => frameOf(8, 24, "4x1,1x1,1x1", { type }));
    let sum = 0;
    for (const [i, difference] of [5, 32767, 1, 0, 5, 32767, 1, 0, -20, 0, 0, 0].entries()) {
      frame.components[0].data[i * 64] = (sum += difference) * 2;
      wrapped.components[0].data[i * 64] = int16(sum * 2);
    }
    const file = write(frame, [scanOf([0, 1, 2], 0, 0, 0, 1), ...forThree(c => [scanOf([c], 1, 63)])]);
    await expectPictures([{ name: "sums", file, expected: pictureOf(wrapped) }]);
  });

  test("Ah need not match the Al of the previous scan", async () => {
    const random = randomBytes(3);
    const [one, other] = [0, 1].map(() => noise(frameOf(16, 16, "1x1", { type }), random, { sparse: 3, ac: 40 }));
    const of = (frame: Frame, ...scan: [number, number, number, number]) => scanWithTables(frame, scanOf([0], ...scan));
    const changed = (change: (mine: number, theirs: number, k: number) => number) => {
      const frame = copyOf(one);
      frame.components[0].data.forEach(
        (mine, i, data) => (data[i] = change(mine, other.components[0].data[i], i % 64)),
      );
      return pictureOf(frame);
    };
    const whole = [headerOf(one), ...of(one, 0, 0, 0, 0), ...of(one, 1, 63, 0, 0)];
    await expectPictures([
      {
        name: "a repeated first scan",
        file: jpeg(...whole, ...of(other, 0, 0, 0, 0), ...of(other, 1, 63, 0, 0)),
        expected: changed((mine, theirs, k) => (k ? theirs || mine : theirs)),
      },
      {
        name: "a DC refinement of a known bit",
        file: jpeg(...whole, ...of(other, 0, 0, 5, 4)),
        expected: changed((mine, theirs, k) => (k ? mine : mine | (theirs & 16))),
      },
      {
        name: "a DC refinement without a first scan",
        file: jpeg(headerOf(one), ...of(other, 0, 0, 7, 6), ...of(one, 1, 63, 0, 0)),
        expected: changed((mine, theirs, k) => (k ? mine : theirs & 64)),
      },
    ]);
  });
});

describe("Huffman-coded data", () => {
  type Part = [ss: number, se: number, ah: number, al: number, write: (symbols: Symbols) => unknown];
  const longCodes = tableOf(
    bytes,
    bytes.map(symbol => 11 + (symbol % 6)),
  );
  /** One row of blocks. Without a DC scan, there is no block smoothing. */
  async function expectBlocks(
    parts: Part[],
    blocks: Record<number, number>[],
    tables = [everySymbol, longCodes],
    interval = 0,
  ) {
    const frame = frameOf(blocks.length * 8, 8, "1x1", { type: SOF2, tables: [Array(64).fill(4)] });
    blocks.forEach((block, i) => Object.assign(frame.components[0].data.subarray(i * 64), block));
    const expected = pictureOf(frame);
    await expectPictures(
      tables.map((table, nth) => {
        const scans = parts.flatMap(([ss, se, ah, al, write]) => {
          const symbols = new Symbols();
          write(symbols);
          return [sos(frame, scanOf([0], ss, se, ah, al)), symbols.bytes({ [AC]: table })];
        });
        const file = jpeg(headerOf(frame), dht(AC, table), dri(interval), ...scans);
        return { name: `${JSON.stringify(blocks)}, table ${nth}`, file, expected };
      }),
    );
  }

  test("first scan: a run past Se lands outside the band, and one past 63 on 63", async () => {
    const then = (symbols: Symbols) => symbols.value(AC, 0, 7).symbol(AC, EOB);
    await expectBlocks([[1, 5, 0, 1, s => then(s.value(AC, 4, 9))]], [{ 5: 18 }, { 1: 14 }]);
    await expectBlocks([[1, 5, 0, 1, s => then(s.value(AC, 5, 9))]], [{ 6: 18 }, { 1: 14 }]);
    await expectBlocks([[1, 5, 0, 1, s => then(s.value(AC, 3, 3).value(AC, 15, 9))]], [{ 4: 6, 20: 18 }, { 1: 14 }]);
    await expectBlocks([[1, 5, 0, 1, s => then(s.symbol(AC, ZRL))]], [{}, { 1: 14 }]);
    for (let run = 0; run <= 15; run++) {
      await expectBlocks([[63, 63, 0, 0, s => s.value(AC, run, 9).value(AC, 0, 7)]], [{ 63: 9 }, { 63: 7 }]);
    }
  });

  test("first scan: a ZRL ends the block only if it goes past Se", async () => {
    const short = tableOf([ZRL, EOB, ...range(0, 15).map(run => (run << 4) | 3)], [1, 2, ...Array(16).fill(7)]);
    for (const se of slow ? [18, 33, 62, 63] : range(1, 63)) {
      const blocks: Record<number, number>[] = [];
      const write = (s: Symbols) => {
        blocks.length = 0;
        for (let first = 1; first <= 16; first++) {
          s.value(AC, first - 1, 5);
          for (let k = first + 1; k <= se; k += 16) s.symbol(AC, ZRL);
          blocks.push({ [first]: 5 });
          if (first >= se) continue;
          // As many as stay within the band.
          const last = se - ((se - first - 1) % 16);
          s.value(AC, first - 1, -5);
          for (let k = first + 1; k < last; k += 16) s.symbol(AC, ZRL);
          s.value(AC, 0, 6);
          if (last < se) s.symbol(AC, EOB);
          blocks.push({ [first]: -5, [last]: 6 });
        }
      };
      write(new Symbols());
      await expectBlocks([[1, se, 0, 0, write]], [...blocks], [short, everySymbol, longCodes]);
    }
  });

  test("first scan: an invalid code is EOB", async () => {
    const none = (s: Symbols) => s.bits(0x8000, 16).bits(1, 1);
    await expectBlocks([[1, 5, 0, 0, s => none(s.value(AC, 0, 9)).value(AC, 4, 7)]], [{ 1: 9 }, { 5: 7 }]);
  });

  test("first scan: a coefficient wraps at 16 bits, and one that wraps to 0 counts as zero in a refinement", async () => {
    for (const ss of [1, 61]) {
      const earlier: Part = [ss, 63, 0, 0, s => s.value(AC, 0, 9).value(AC, 0, 9).value(AC, 0, 9).symbol(AC, EOB)];
      // With Ss = 61, the last run goes past 63.
      const large = (s: Symbols) =>
        s
          .value(AC, 0, 0x4000)
          .value(AC, 0, -0x4001)
          .value(AC, ss === 1 ? 0 : 7, -0x4000);
      const first: Part = [ss, ss + 2, 0, 2, large];
      await expectBlocks([earlier, first], [{ [ss + 1]: -4 }]);
      await expectBlocks(
        [earlier, first, [ss, ss + 2, 2, 1, s => s.value(AC, 1, 1).bits(1, 1)]],
        [{ [ss + 1]: -6, [ss + 2]: 2 }],
      );
    }
    for (let al = 2; al <= 13; al++) {
      await expectBlocks(
        [
          [1, 2, 0, al, s => s.value(AC, 0, 1 << (16 - al)).symbol(AC, EOB)],
          [1, 2, 1, 0, s => s.value(AC, 0, -1).symbol(AC, EOB)],
        ],
        [{ 1: -1 }],
      );
    }
  });

  /** 8, -8 and 12 at 2, 4 and 5 in both blocks. */
  const sent: Part = [
    1,
    9,
    0,
    2,
    s => [0, 1].map(() => s.value(AC, 1, 2).value(AC, 1, -2).value(AC, 0, 3).symbol(AC, EOB)),
  ];
  const second = (s: Symbols) => s.symbol(AC, EOB).bits(0b101, 3);
  const corrected = { 2: 10, 4: -8, 5: 14 };

  test("refinement: a run counts only zeros, and nonzero coefficients get correction bits", async () => {
    await expectBlocks(
      [sent, [1, 9, 2, 1, s => second(s.value(AC, 2, -1).bits(0b110, 3).symbol(AC, EOB))]],
      [{ 2: 10, 4: -10, 5: 12, 6: -2 }, corrected],
    );
    await expectBlocks(
      [sent, [1, 9, 2, 1, s => second(s.value(AC, 1, 1).bits(0, 1).symbol(AC, EOB).bits(0b11, 2))]],
      [{ 2: 8, 3: 2, 4: -10, 5: 14 }, corrected],
    );
  });

  test("refinement: a new coefficient has one extra bit, whatever SSSS says", async () => {
    for (let size = 1; size <= 15; size++) {
      await expectBlocks(
        [
          sent,
          [
            1,
            9,
            2,
            1,
            s =>
              second(
                s
                  .symbol(AC, size)
                  .bits(size & 1, 1)
                  .symbol(AC, EOB)
                  .bits(0, 3),
              ),
          ],
        ],
        [{ 1: size & 1 ? 2 : -2, 2: 8, 4: -8, 5: 12 }, corrected],
      );
    }
  });

  test("refinement: a run past Se lands on Se + 1", async () => {
    const before = { 2: 8, 4: -8, 5: 14 };
    await expectBlocks(
      [sent, [1, 9, 2, 1, s => second(s.value(AC, 5, 1).bits(1, 3))]],
      [{ ...before, 9: 2 }, corrected],
    );
    for (const run of [6, 7, 15]) {
      await expectBlocks(
        [sent, [1, 9, 2, 1, s => second(s.value(AC, run, 1).bits(1, 3))]],
        [{ ...before, 10: 2 }, corrected],
      );
    }
    await expectBlocks([sent, [1, 9, 2, 1, s => second(s.symbol(AC, ZRL).bits(1, 3))]], [before, corrected]);
    // It overwrites what is there.
    await expectBlocks(
      [sent, [1, 4, 2, 1, s => s.value(AC, 2, -1).bits(0, 2).symbol(AC, EOB).bits(0b10, 2)]],
      [
        { 2: 8, 4: -8, 5: -2 },
        { 2: 10, 4: -8, 5: 12 },
      ],
    );
    await expectBlocks(
      [
        [63, 63, 0, 2, s => s.value(AC, 0, 3).value(AC, 0, 3)],
        [63, 63, 2, 1, s => s.value(AC, 0, -1).bits(1, 1).symbol(AC, EOB).bits(1, 1)],
      ],
      [{ 63: -2 }, { 63: 14 }],
    );
  });

  test("refinement: a ZRL stops at the sixteenth zero", async () => {
    await expectBlocks(
      [
        [1, 63, 0, 1, s => s.value(AC, 15, 3).value(AC, 1, 3).symbol(AC, EOB)],
        [1, 63, 1, 0, s => s.symbol(AC, ZRL).bits(1, 1).value(AC, 0, 1).bits(1, 1).symbol(AC, EOB)],
      ],
      [{ 16: 7, 18: 7, 19: 1 }],
    );
  });

  test("refinement: every run length, with nonzero coefficients in between", async () => {
    const random = randomBytes(11);
    const blocks = range(0, 15).flatMap(run =>
      [2, 3, 5].map(every => {
        let zeros = 0;
        return range(0, 63).map(k => {
          const sign = random() & 1 ? 1 : -1;
          if (k % every === 0) return k && sign * (2 + (random() & 1));
          return zeros++ % (run + 1) === run ? sign : 0;
        });
      }),
    );
    const frame = frameOf(blocks.length * 8, 8, "1x1", { type: SOF2, tables: [Array(64).fill(4)] });
    frame.components[0].data.set(blocks.flat());
    const file = write(frame, [scanOf([0], 1, 63, 0, 1), scanOf([0], 1, 63, 1, 0)]);
    await expectPictures([{ name: "runs", file, expected: pictureOf(frame) }]);
  });

  test.each([
    ["a new coefficient", 0x01, 62],
    ["ZRL", ZRL, 46],
    ["EOB", EOB, 61],
  ])("refinement: any number of correction bits after the code for %s", async (_, symbol, most) => {
    // That code has 16 bits. The next has 10, and only its last bit tells it from another.
    const next = symbol === EOB ? 0x11 : EOB;
    const table = tableOf([0x21, 0x31, next, symbol], [2, 10, 10, 16]);
    const random = randomBytes(12);
    const only = (at: number) => range(0, 63).map(k => +(k === at));
    const blocks = range(slow ? 28 : 1, most).flatMap(count =>
      range(1, 8).flatMap(() => {
        const block = range(0, 63).map(k => (k && k <= count ? (random() & 1 ? 1 : -1) * (2 + (random() & 1)) : 0));
        const some = symbol === EOB ? [block, only(2)] : [symbol === ZRL ? block : block.with(count + 1, 1)];
        // An odd number of bits, so that eight repetitions start at every bit of a byte.
        return (count + +(symbol !== ZRL)) & 1 ? some : [...some, only(3)];
      }),
    );
    const frame = frameOf(4 * 8, blocks.length * 2, "1x1", { type: SOF2, tables: [Array(64).fill(4)] });
    frame.components[0].data.set(blocks.flat());
    const symbols = new Symbols();
    for (const block of blocks) {
      const known = block.filter(value => Math.abs(value) > 1);
      if (known.length) symbols.symbol(AC, symbol).bits(1, symbol & 1);
      else symbols.value(AC, block.indexOf(1) - 1, 1);
      for (const value of known) symbols.bits(value & 1, 1);
      if (block[63] === 0 && (symbol !== EOB || !known.length)) symbols.symbol(AC, EOB);
    }
    const first = coded(frame, scanOf([0], 1, 63, 0, 1));
    const file = jpeg(
      ...[headerOf(frame), ...first.tables, first.header, first.data],
      ...[dht(AC, table), sos(frame, scanOf([0], 1, 63, 1, 0)), symbols.bytes({ [AC]: table })],
    );
    await expectPictures([{ name: "bits", file, expected: pictureOf(frame) }]);
  });

  test("first scan: the longest possible blocks, at any offset in the data", async () => {
    // A byte for an empty block, and 31 bits for a coefficient. 4 times 16384 is 0 in 16 bits.
    const table = tableOf([EOB, 15], [8, 16]);
    const one = frameOf(8, 8, "1x1", { type: SOF2, tables: [range(0, 63).map(k => (k % 20 === 3 ? 4 : 0))] });
    one.components[0].data.fill(16384 + 21, 1);
    const eight = new Symbols();
    for (let i = 0; i < 8; i++) eight.value(AC, 0, 16384 + 21);
    const [long, { rgba }] = [Buffer.alloc((24 / 8) * 63 * 31, eight.bytes({ [AC]: table })), pictureOf(one)];
    await expectPictures(
      range(0, 40).map(i => {
        const empty = i * 6;
        const frame = { ...one, height: (empty + 24) * 8 };
        const file = jpeg(headerOf(frame), dht(AC, table), sos(frame, scanOf([0], 1, 63)), Buffer.alloc(empty), long);
        const parts = [Buffer.alloc(empty * 256, Buffer.from([128, 128, 128, 255])), Buffer.alloc(24 * 256, rgba)];
        return { name: `${empty}`, file, expected: { width: 8, height: frame.height, rgba: Buffer.concat(parts) } };
      }),
    );
  });

  test("first scan: a coefficient of 31 bits after one to three of 15 bits", async () => {
    // The shorter ones are multiplied by 0.
    const table = tableOf([EOB, 10, 15], [2, 5, 16]);
    await expectPictures(
      range(1, 3).map(shorter => {
        const steps = range(0, 63).map(k => (k && k % (shorter + 1) === 0 ? 4 : 0));
        const frame = frameOf(64, 8, "1x1", { type: SOF2, tables: [steps] });
        frame.components[0].data.forEach((_, i, data) => {
          if (i % 64 && i % 64 < 40) data[i] = steps[i % 64] ? (i & 8 ? 16384 + 15 : -16384 - 8) : 1023;
        });
        const file = write(frame, [scanOf([0], 1, 63, 0, 0, { maxEobRun: 1 })], { tables: { [AC]: table } });
        return { name: `${shorter}`, file, expected: pictureOf(frame) };
      }),
    );
  });

  test("refinement: a coefficient that landed on Se + 1 gets correction bits in later scans", async () => {
    await expectBlocks(
      [
        sent,
        [1, 9, 2, 1, s => second(s.value(AC, 6, 1).bits(0, 3))],
        [1, 11, 1, 0, s => s.value(AC, 6, 1).bits(0b1011, 4).symbol(AC, EOB).bits(0b010, 3)],
      ],
      [
        { 2: 9, 4: -8, 5: 13, 10: 3, 11: 1 },
        { ...corrected, 4: -9 },
      ],
    );
    await expectBlocks(
      [
        [61, 63, 2, 1, s => s.value(AC, 3, -1).symbol(AC, EOB)],
        [61, 63, 1, 0, s => s.value(AC, 1, 1).symbol(AC, EOB).bits(1, 1).value(AC, 0, 1).symbol(AC, EOB)],
      ],
      [{ 62: 1, 63: -3 }, { 61: 1 }],
    );
  });

  test("refinement: a coefficient of 15 bits", async () => {
    await expectBlocks(
      [
        [1, 2, 0, 1, s => s.value(AC, 0, 8200).value(AC, 0, -8200)],
        [1, 2, 1, 0, s => s.symbol(AC, EOB).bits(0b11, 2)],
      ],
      [{ 1: 16401, 2: -16401 }],
    );
  });

  test("refinement: a correction is ignored if the bit is already set in two's complement", async () => {
    const values = range(-9, 9).filter(Boolean);
    for (const inRun of [false, true]) {
      await expectBlocks(
        [
          [1, 18, 0, 0, s => values.map(value => s.value(AC, 0, value))],
          [1, 19, 2, 1, s => (inRun ? s.symbol(AC, EOB) : s.value(AC, 0, 1)).bits(0x1ff, 9).bits(0x1ff, 9)],
        ],
        [[0, ...values.map(value => (value & 2 ? value : value + 2 * Math.sign(value))), inRun ? 0 : 2]],
      );
    }
  });

  test("an EOB run ends with the scan and with the restart interval", async () => {
    for (const ah of [0, 1]) {
      const long = (s: Symbols) => s.eobRun(AC, 16384 + 5);
      const one = (s: Symbols) => s.value(AC, 0, 1);
      await expectBlocks(
        [
          [1, 1, ah, 0, long],
          [2, 2, ah, 0, s => one(one(one(s)))],
        ],
        [{ 2: 1 }, { 2: 1 }, { 2: 1 }],
      );
      await expectBlocks(
        [[1, 1, ah, 0, s => one(one(long(s).marker(RST0)))]],
        [{}, {}, { 1: 1 }, { 1: 1 }],
        undefined,
        2,
      );
    }
  });

  test.each([
    ["first scan", 0],
    ["refinement", 1],
  ])("%s: EOB runs of 1 to 32767 blocks", async (_, ah) => {
    const runs = [...range(0, 11).flatMap(size => [1 << size, (2 << size) - 1]), 4097, 8194, 32767];
    const symbols = new Symbols();
    const expected: number[] = [];
    let blocks = 0;
    for (const run of runs) {
      symbols.eobRun(AC, run).value(AC, 0, 1);
      expected.push((blocks += run + 1) - 1);
    }
    const one = frameOf(8, 8, "1x1", { type: SOF2, tables: [Array(64).fill(100)] });
    const frame = { ...one, width: 256 * 8, height: Math.ceil(blocks / 256) * 8 };
    symbols.eobRun(AC, 256);
    const scan = [sos(frame, scanOf([0], 1, 1, ah, 0)), symbols.bytes({ [AC]: everySymbol })];
    const { rgba, width } = await decode(jpeg(headerOf(frame), dht(AC, everySymbol), ...scan), 2);
    const found: number[] = [];
    for (let i = 0; i < (frame.height / 8) * 256; i++)
      if (rgba[((i >> 8) * 2 * width + (i & 255) * 2) * 4] !== 128) found.push(i);
    expect(found).toEqual(expected);
  });

  test("truncated AC scan: the current block is decoded from zeros, and later ones are unchanged", async () => {
    // 1011 is a coefficient of 3, and 00 one of -1.
    const tables = [tableOf([0x01, 0x02], [1, 2])];
    const threes = (count: number) => (s: Symbols) => range(1, count).map(() => s.value(AC, 0, 3));
    await expectBlocks([[1, 3, 0, 1, threes(4)]], [[0, 6, 6, 6], [0, 6, -2, -2], {}], tables);
    await expectBlocks([[1, 2, 0, 1, threes(2)]], [[0, 6, 6], [0, -2, -2], {}], tables);
    await expectBlocks(
      [
        [2, 2, 0, 1, threes(4)],
        [1, 3, 1, 0, s => s.bits(0b01_01_1_01_0, 8)],
      ],
      [
        [0, 1, 7, 1],
        [0, 1, 6, -1],
        [0, 0, 6],
        [0, 0, 6],
      ],
      tables,
    );
    // In an EOB run.
    const runs = tableOf([0x02, 0x40], [2, 2]);
    await expectBlocks(
      [
        [1, 1, 0, 1, threes(4)],
        [1, 1, 1, 0, s => s.eobRun(AC, 16).bits(0b11, 2)],
      ],
      [{ 1: 7 }, { 1: 7 }, { 1: 6 }, { 1: 6 }],
      [runs],
    );
  });

  test("truncated DC scan: the current block is decoded from zeros, and later ones are unchanged", async () => {
    const frame = frameOf(10 * 8, 8, "1x1", { type: SOF2, tables: [dcOnly(8)] });
    const shown = async (interval: number, ...scans: (Buffer | number[])[]) => {
      const { rgba } = await decode(jpeg(headerOf(frame), dht(0, tableOf([1, 2], [1, 2])), dri(interval), ...scans), 1);
      return range(0, 9).map(i => rgba[i * 4] - 128);
    };
    const [first, refinement] = [sos(frame, scanOf([0], 0, 0, 0, 1)), sos(frame, scanOf([0], 0, 0, 1, 0))];
    expect(await shown(0, first, [0b1011_1011])).toEqual([6, 12, 10, 0, 0, 0, 0, 0, 0, 0]);
    expect(await shown(0, first, [0b01_01_01_10])).toEqual([2, 4, 6, 0, 0, 0, 0, 0, 0, 0]);
    expect(await shown(0, first, [0x55, 0x55, 0x55], refinement, [0xff, 0])).toEqual([
      3, 5, 7, 9, 11, 13, 15, 17, 18, 20,
    ]);
    expect(await shown(5, first, [0b1011_1011], rst(0), [0b1011_1011])).toEqual([6, 12, 10, 0, 0, 6, 12, 10, 0, 0]);
    expect(await shown(4, first, [0x55], rst(1), [0x55])).toEqual([2, 4, 6, 8, -2, 0, 0, 0, 2, 4]);
    expect(await shown(4, refinement, [0xf0], rst(1), [0xf0])).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 1, 1]);
  });

  test("DC refinement of 40960 blocks", async () => {
    const one = frameOf(8, 8, "1x1", { type: SOF2, tables: [dcOnly(8)] });
    const frame = { ...one, width: 256 * 8, height: 160 * 8 };
    const data = Buffer.alloc(32 * 160, Buffer.from(range(0, 250)));
    const { rgba } = await decode(jpeg(headerOf(frame), sos(frame, scanOf([0], 0, 0, 1, 0)), data), 1);
    const found = Buffer.alloc(data.length);
    for (let i = 0; i < data.length * 8; i++) found[i >> 3] = (found[i >> 3] << 1) | (rgba[i * 4] - 128);
    expect(found.equals(data)).toBe(true);
  });

  /** The bits that a DC refinement scan reads from `file`, which follows SOS. Each row is a restart interval. */
  async function bytesTaken(across: number, down: number, ...file: (Buffer | number[])[]) {
    const one = frameOf(8, 8, "1x1", { type: SOF2, tables: [dcOnly(8)] });
    const frame = { ...one, width: across * 64, height: down * 8 };
    const start = [headerOf(frame), dri(across * 8), sos(frame, scanOf([0], 0, 0, 1, 0))];
    const { rgba } = await decode(withoutEoi(...start, ...file), 1);
    const found = Buffer.alloc(across * down);
    for (let i = 0; i < found.length * 8; i++) found[i >> 3] = (found[i >> 3] << 1) | (rgba[i * 4] - 128);
    return range(0, down - 1).map(y => found.toString("hex", y * across, (y + 1) * across));
  }
  const inTurn = (rows: (Buffer | number[])[]) => rows.flatMap((row, y) => [row, rst(y)]);

  test("FF 00 is unstuffed at any distance from the start, the end and another FF 00", async () => {
    const places = range(0, 18);
    const rows = [0xfe, 0x00, 0x7f, 0x80].flatMap(other =>
      places.flatMap(first =>
        places
          .filter(second => second >= first)
          .map(second => places.map(i => (i === first || i === second ? 0xff : other))),
      ),
    );
    expect(await bytesTaken(places.length, rows.length, ...inTurn(rows.map(stuffed)))).toEqual(rows.map(hex));
  });

  test("the data can end at any byte", async () => {
    const row = range(0, 26).map(i => (i % 9 === 4 || i === 14 ? 0xff : 0xfe - i));
    const lengths = range(0, row.length);
    const expected = lengths.map(length => hex(row.map((byte, i) => (i < length ? byte : 0))));
    // At a marker, with or without fill bytes.
    for (const fill of [[], [0xff], Array(9).fill(0xff)]) {
      const rows = lengths.flatMap(length => [row, row.slice(0, length)]).map(some => [...stuffed(some), ...fill]);
      expect(await bytesTaken(row.length, rows.length, ...inTurn(rows))).toEqual(
        expected.flatMap(cut => [hex(row), cut]),
      );
    }
    // At the end of the file, also between FF and 00.
    for (const rest of [[], [0xff], [0xff, 0xff], marker(EOI)]) {
      const cut = (length: number) =>
        bytesTaken(row.length, 2, ...inTurn([stuffed(row)]), stuffed(row.slice(0, length)), rest);
      expect(await Promise.all(lengths.map(cut))).toEqual(expected.map(cut => [hex(row), cut]));
    }
  });

  test("the DC prediction has to fit in 32 bits", async () => {
    // 65538 times 32767 is 2^31 - 2.
    const one = frameOf(8, 8, "1x1", { type: SOF2, tables: [Array(64).fill(0)] });
    const frame = { ...one, width: 256 * 8, height: 257 * 8 };
    const table = tableOf([15, 1, 2, 0], [1, 2, 3, 4]);
    const reaching = (last: number) => {
      const many = Buffer.alloc(65538 * (last < 0 ? 2 : 3), Buffer.from(last < 0 ? [0] : [0x7f, 0xff, 0]));
      const rest = new Symbols().value(0, 0, last);
      for (let i = 0; i < 253; i++) rest.symbol(0, 0);
      const file = jpeg(headerOf(frame), dht(0, table), sos(frame, scanOf([0], 0, 0)), many, rest.bytes({ 0: table }));
      return decode(file, 1).then(
        () => "decoded",
        error => error.code,
      );
    };
    expect(await grouped([1, 2, -2, -3], reaching)).toEqual({ decoded: [1, -2], ERR_IMAGE_DECODE_FAILED: [2, -3] });
  });
});
