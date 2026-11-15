// The rules for the data of a sequential scan with Huffman codes.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import {
  bothWays,
  decode,
  everySymbol,
  expectPictures,
  fine,
  flat,
  headerOnly,
  levels,
  much,
  outcome,
  range,
  where,
  withMoreBehind,
  type Case,
} from "./decode";
import { pictureOf } from "./model";
import {
  AC,
  adobe,
  all,
  coded,
  COM,
  copyOf,
  dht,
  dri,
  EOI,
  frameOf,
  headerOf,
  jpeg,
  marker,
  noise,
  RST0,
  scanOf,
  segment,
  sos,
  stuffed,
  Symbols,
  symbolsOf,
  tableOf,
  TEM,
  typical,
  unfinished,
  walk,
  write,
  type Frame,
} from "./write";

const expectBothWays = (cases: Case[]) => expectPictures(bothWays(cases));

test("the shorter way is taken from where the tests take it to be", async () => {
  const source = await Bun.file(join(import.meta.dir, "../../../../../src/jpeg/sequential.rs")).text();
  expect(source).toContain(`const MIN_LEN_FOR_PAIRS: usize = ${much};`);
  expect(source).toContain("data_len >= MIN_LEN_FOR_PAIRS");
});

describe("codes", () => {
  /** There is no room for a code of each length and two more. */
  const [fromOne, fromTwo] = [[1, ...range(3, 16)], range(2, 16)];

  test.each([
    ["1 and 3 to 16", fromOne],
    ["2 to 16", fromTwo],
  ])("every run and size of an AC coefficient, in %s bits", async (_, lengths) => {
    // One under the other. Of each size the least and the most, and something behind them.
    const symbols = [...typical[AC].symbols].sort((a, b) => a - b);
    const all = frameOf(8, symbols.length * 4 * 8);
    const { data } = all.components[0];
    for (const [i, symbol] of symbols.entries()) {
      const [run, size] = symbol === 0xf0 ? [16, 1] : [symbol >> 4, symbol & 15];
      const [least, most] = size ? [1 << (size - 1), (1 << size) - 1] : [0, 0];
      for (const [j, value] of [least, -least, most, -most].entries()) {
        data.set([j * 8, ...Array(run).fill(0), value, size ? 1 : 0], (i * 4 + j) * 64);
      }
    }
    const { rgba } = pictureOf(all);
    const firsts = range(0, symbols.length - 1).filter(first => !slow || first % 7 === 0);
    const cases = firsts.map(first => {
      const chosen = lengths.map((_, i) => (first + i) % symbols.length);
      const frame = frameOf(8, chosen.length * 4 * 8);
      chosen.forEach((from, i) => frame.components[0].data.set(data.subarray(from * 256, (from + 1) * 256), i * 256));
      const others = [0, 1].filter(symbol => !chosen.includes(symbol));
      const table = tableOf([...chosen.map(i => symbols[i]), ...others], [...lengths, ...others.map(() => 16)]);
      const file = write(frame, undefined, { tables: { 0: typical[0], [AC]: table } });
      const parts = chosen.map(from => rgba.subarray(from * 1024, (from + 1) * 1024));
      const expected = { width: 8, height: frame.height, rgba: Buffer.concat(parts) };
      return { name: `from ${symbols[first]} on`, file, expected };
    });
    await expectBothWays(cases);
  });

  // Of the four blocks of luma in an MCU, three are only there to fill it. They can hold what is too much to show.
  const narrow = (rows: number) => frameOf(8, rows * 8, "4x1,1x1,1x1");

  test("every size of a difference, in 1 to 16 bits", async () => {
    const frame = narrow(16 * 2);
    for (let size = 1; size <= 15; size++) {
      const [least, most] = [1 << (size - 1), (1 << size) - 1];
      const level = size * 8;
      const row = [level, level + least, level, level + most, level, level - most, level, level - least];
      row.forEach((dc, i) => (frame.components[0].data[(size * 8 + i) * 64] = dc));
    }
    const expected = pictureOf(frame);
    const tables = { dc: [0, 1, 1], ac: [0, 0, 0] };
    expect([
      ...symbolsOf(frame, scanOf([0]))
        .occurrences()
        .keys(),
    ]).toEqual([0, AC]);
    await expectBothWays(
      [fromOne, fromTwo].flatMap(lengths =>
        range(0, 15).map(first => {
          const table = tableOf(
            range(0, 15).map(i => (first + i) & 15),
            [...lengths, 16],
          );
          const file = write(frame, [scanOf([0, 1, 2], 0, 63, 0, 0, tables)], { tables: { ...typical, 0: table } });
          return { name: `${lengths[0]} for ${first}`, file, expected };
        }),
      ),
    );
  });

  test("of the sum of the differences, 16 bits count", async () => {
    const [frame, wrapped] = [narrow(4), narrow(4)];
    let sum = 0;
    for (const [i, difference] of [40, 32767, 32767, 2, 40, 32767, 32767, 2, -8, -32767, -32767, -2, 16].entries()) {
      frame.components[0].data[i * 64] = sum += difference;
      wrapped.components[0].data[i * 64] = (sum << 16) >> 16;
    }
    frame.components[0].data.set([sum], 13 * 64);
    frame.components[0].data.set([sum], 14 * 64);
    frame.components[0].data.set([sum], 15 * 64);
    await expectPictures([{ name: "sums", file: write(frame), expected: pictureOf(wrapped) }]);
  });

  test("an AC coefficient can have up to 15 bits", async () => {
    // Every other one is multiplied by 0.
    const frame = frameOf(8, 40, "1x1", { tables: [range(0, 63).map(k => (k & 1 ? 0 : 1))] });
    for (let size = 11; size <= 15; size++) {
      frame.components[0].data.set(
        [8, (1 << size) - 1, 20, -(1 << (size - 1)), -20, 0, 0, 1 << (size - 1), 9],
        (size - 11) * 64,
      );
    }
    const file = write(frame);
    const expected = pictureOf(frame);
    await expectPictures([
      { name: "whole", file, expected },
      { name: "with more behind", file: withMoreBehind(file), expected },
      { name: "an eighth", file, expected: pictureOf(frame, { eighths: 1 }), eighths: 1 },
    ]);
  });

  /** Two blocks, of which the second shows whether the first took the bits it should. */
  async function expectFirstBlock(write: (symbols: Symbols) => unknown, coefficients: Record<number, number>) {
    const frame = frameOf(16, 8);
    Object.assign(frame.components[0].data, coefficients, { 64: 40, 65: 30 });
    const symbols = new Symbols().value(0, 0, 0);
    write(symbols);
    symbols.value(0, 0, 40).value(AC, 0, 30).symbol(AC, 0);
    const tables = { 0: typical[0], [AC]: everySymbol };
    const file = jpeg(headerOf(frame), dht(AC, tables[AC]), sos(frame, scanOf([0])), symbols.bytes(tables));
    await expectPictures(
      [8, 1].flatMap(eighths => [
        { name: "short", file, expected: pictureOf(frame, { eighths }), eighths },
        { name: "with more behind", file: withMoreBehind(file), expected: pictureOf(frame, { eighths }), eighths },
      ]),
    );
  }
  const sixteenZeros = (symbols: Symbols, times: number) => {
    for (let i = 0; i < times; i++) symbols.symbol(AC, 0xf0);
    return symbols;
  };

  test("a block ends by itself with its last coefficient", async () => {
    await expectFirstBlock(symbols => sixteenZeros(symbols, 3).value(AC, 14, 50), { 63: 50 });
    await expectFirstBlock(symbols => sixteenZeros(symbols, 3).value(AC, 13, 50).symbol(AC, 0), { 62: 50 });
    await expectFirstBlock(symbols => sixteenZeros(symbols.value(AC, 14, 50), 3), { 15: 50 });
    await expectFirstBlock(symbols => sixteenZeros(symbols.value(AC, 13, 50), 3).symbol(AC, 0), { 14: 50 });
  });

  test("zeros that lead beyond the end end it too", async () => {
    await expectFirstBlock(symbols => sixteenZeros(symbols, 4), {});
    await expectFirstBlock(symbols => sixteenZeros(symbols, 3).value(AC, 13, 50).symbol(AC, 0xf0), { 62: 50 });
  });

  test("a coefficient beyond the end is the last", async () => {
    await expectFirstBlock(symbols => sixteenZeros(symbols, 3).value(AC, 15, 50), { 63: 50 });
    for (let run = 1; run <= 15; run++) {
      await expectFirstBlock(symbols => sixteenZeros(symbols, 3).value(AC, 13, 9).value(AC, run, 50), {
        62: 9,
        63: 50,
      });
    }
  });

  test("any run of nothing but that of 16 zeros is the end of the block", async () => {
    for (let run = 1; run <= 14; run++) {
      await expectFirstBlock(symbols => symbols.value(AC, 0, 50).symbol(AC, run << 4), { 1: 50 });
    }
  });

  test("what is no code takes 17 bits, and stands for 0", async () => {
    await expectFirstBlock(symbols => symbols.value(AC, 0, 50).bits(0xffff, 16).bits(1, 1), { 1: 50 });
    await expectFirstBlock(symbols => symbols.value(AC, 0, 50).bits(0x8000, 16).bits(0, 1), { 1: 50 });
    // As a difference, and where a table has no codes at all.
    const frame = flat([[0, 7, 7, 9]]);
    const none = { counts: Array(16).fill(0), symbols: [] };
    const symbols = new Symbols();
    for (const difference of [0, 7, 0, 2]) {
      if (difference) symbols.value(0, 0, difference);
      else symbols.bits(0xff80, 16).bits(0, 1);
      symbols.bits(0x1234, 16).bits(1, 1);
    }
    const file = jpeg(headerOf(frame), dht(AC, none), sos(frame, scanOf([0])), symbols.bytes());
    for (const each of [file, withMoreBehind(file)]) expect(await levels(each)).toEqual([[0, 7, 7, 9]]);
  });

  test("a symbol may have two codes", async () => {
    const frame = flat([[0, 0]]);
    const tables = [dht(0, tableOf([2, 2], [1, 12])), dht(AC, tableOf([0], [1]))];
    const data = new Symbols().bits(0b0_11_0, 4).bits(0b1000_0000_0000_11_0, 15).bytes();
    const file = jpeg(headerOf(frame), ...tables, sos(frame, scanOf([0])), data);
    for (const each of [file, withMoreBehind(file)]) expect(await levels(each)).toEqual([[3, 6]]);
  });

  test("each component has the tables that it names", async () => {
    const frame = noise(frameOf(24, 16, "1x1,1x1,1x1"), randomBytes(18), { sparse: 5 });
    const expected = pictureOf(frame);
    await expectBothWays(
      range(0, 63).map(bits => {
        const [dc, ac] = [0, 3].map(first => range(first, first + 2).map(bit => (bits >> bit) & 1));
        const file = write(frame, [scanOf([0, 1, 2], 0, 63, 0, 0, { dc, ac })], { tables: typical });
        return { name: `${dc} ${ac}`, file, expected };
      }),
    );
  });

  test.each([1, 2, 47, 48, 49, 50, 61, 62, 63])("any two short ones in a row, at coefficient %i", async first => {
    const short = [0x00, 0xf0, 0x01, 0x11, 0x21, 0xf1, 0x30, 0x02];
    const long = range(0, 15).map(run => (run << 4) | 3);
    const tables = {
      0: tableOf([0, 1, 2, 3], [2, 2, 10, 10]),
      [AC]: tableOf([...short, ...long], [3, 3, 3, 3, 3, 3, 3, 4, ...long.map(() => 10)]),
    };
    const pairs = short.flatMap(a => short.map(b => [a, b]));
    const frame = frameOf(pairs.length * 8, 16, "1x1", { tables: [Array(64).fill(12)] });
    const symbols = new Symbols();
    // Behind a difference with a long code, then behind one with a short code.
    for (const [i, codes] of [...pairs, ...pairs].entries()) {
      const block = frame.components[0].data.subarray(i * 64, (i + 1) * 64);
      block[0] = i & 1 ? 0 : i < pairs.length ? 5 : 1;
      symbols.value(0, 0, i & 1 ? (i < pairs.length ? -5 : -1) : block[0]);
      let k = 1;
      for (; k < first; k++) {
        const run = Math.min(first - 1 - k, 15);
        symbols.value(AC, run, (block[(k += run)] = -4));
      }
      for (const symbol of [...codes, 0x02, 0x00]) {
        const [run, size] = [symbol >> 4, symbol & 15];
        if (k > 63) break;
        if (size) symbols.value(AC, run, (block[Math.min((k += run), 63)] = k++ & 1 ? size : -size));
        else symbols.symbol(AC, symbol);
        if (!size) k = run === 15 ? k + 16 : 64;
      }
    }
    const file = jpeg(
      headerOf(frame),
      dht(0, tables[0]),
      dht(AC, tables[AC]),
      sos(frame, scanOf([0])),
      symbols.bytes(tables),
    );
    const expected = pictureOf(frame);
    await expectPictures([file, withMoreBehind(file)].map(file => ({ name: `${file.length} bytes`, file, expected })));
  });

  test("a short one and one with many bits behind it, again and again", async () => {
    // Together they take 14 to 19 bits. Every other coefficient is multiplied by 0.
    const sizes = range(8, 13);
    const table = tableOf([0x01, ...sizes, 0x00], [2, ...sizes.map(() => 3), 9].with(6, 4));
    const frame = frameOf(8, sizes.length * 8 * 8, "1x1", { tables: [range(0, 63).map(k => (k & 1 ? 9 : +!k))] });
    const random = randomBytes(14);
    frame.components[0].data.forEach((_, i, data) => {
      const [size, sign] = [sizes[i >> 9], random() & 1 ? 1 : -1];
      data[i] = i % 64 === 0 ? (i >> 6) * (i & 64 ? 7 : -3) : sign * (i & 1 ? 1 : (1 << (size - 1)) + (random() & 127));
      if (i % 64 > 56 + ((i >> 6) & 7)) data[i] = 0;
    });
    const file = write(frame, undefined, { tables: { 0: typical[0], [AC]: table } });
    await expectPictures([{ name: "pairs", file: withMoreBehind(file), expected: pictureOf(frame) }]);
  });

  test("blocks that are as long as can be", async () => {
    // 31 bits for each coefficient, and fewer in every eighth block. Only DC coefficients show.
    const tables = { 0: tableOf([7, 15], [16, 16]), [AC]: tableOf([0, 15], [3, 16]) };
    const frame = narrow(24);
    frame.tables = [[1, ...Array(63).fill(0)]];
    frame.components[0].data.forEach((_, i, data) => {
      const [block, k] = [i >> 6, i % 64];
      if (k === 0) data[i] = (block >> 2) * 8 - 96 + [0, 20000, 0, -20000][block & 3];
      else if (block % 8 !== 7 || k < block >> 1) data[i] = (k & 1 ? 1 : -1) * (16384 + i);
    });
    frame.components.slice(1).forEach(({ data }) => data.forEach((_, i) => (data[i] = i % 64 ? 16384 : 0)));
    const scan = scanOf([0, 1, 2], 0, 63, 0, 0, { dc: [0, 1, 1], ac: [0, 0, 0] });
    const file = write(frame, [scan], { tables: { ...typical, ...tables } });
    await expectPictures([{ name: "long", file, expected: pictureOf(frame) }]);
  });

  test("any bits come to the same, however much of the file is left", async () => {
    const random = randomBytes(15);
    const tables = [
      [typical[0], typical[AC]],
      [tableOf([0, 1, 2, 9], [1, 2, 3, 4]), tableOf([0x01, 0x00, 0xf0, 0x12, 0xf1, 0x0d], [2, 2, 3, 3, 3, 4])],
      [tableOf([3, 0, 15], [2, 2, 2]), tableOf([0xf0, 0x31, 0x01, 0x70, 0x0f, 0x08], [1, 2, 3, 5, 7, 9])],
    ];
    const cases = tables.flatMap(([dc, ac]) =>
      ["1x1", "2x2,1x1,1x1", "2x1,1x1,1x1,2x1"].flatMap(sampling =>
        [0, 1, 3].flatMap(interval =>
          range(1, slow ? 2 : 20).map(async i => {
            const frame = frameOf(64, 32, sampling);
            const scan = scanOf(all(frame), 0, 63, 0, 0, { dc: [0, 0, 0, 0], ac: [0, 0, 0, 0] });
            // Too much for some intervals, and too little for others.
            const parts = range(0, interval ? 32 / interval : 0).flatMap(n => [
              stuffed(range(1, interval ? random() & 31 : random() * 4).map(random)),
              marker(RST0 + (n & 7)),
            ]);
            const file = jpeg(headerOf(frame), dht(0, dc), dht(AC, ac), dri(interval), sos(frame, scan), ...parts);
            return { name: `${sampling}, ${interval}, ${i}`, file: withMoreBehind(file), expected: await decode(file) };
          }),
        ),
      ),
    );
    await expectPictures(await Promise.all(cases));
  });
});

// A block is one byte: 10 for five bits, those, and 0 for the end. What is read from zeros is one less than the last.
const small = { 0: tableOf([1, 5, 0], [1, 2, 3]), [AC]: tableOf([0], [1]) };
const step = (difference: number) => new Symbols().value(0, 0, difference).symbol(AC, 0).bytes(small);
const startOf = (frame: Frame, interval = 0, components = [0]) =>
  unfinished(
    headerOf(frame),
    dht(0, small[0]),
    dht(AC, small[AC]),
    dri(interval),
    sos(frame, scanOf(components, 0, 63, 0, 0, { dc: [0, 0, 0], ac: [0, 0, 0] })),
  );
/** Of a row of so many blocks. */
async function row(blocks: number, interval: number, ...data: (Buffer | number[])[]) {
  const file = Buffer.concat([
    startOf(flat([Array(blocks).fill(0)]), interval),
    ...data.map(part => Buffer.from(part)),
  ]);
  const [short] = await levels(file);
  expect(await levels(withMoreBehind(file))).toEqual([short]);
  return short;
}

describe("where the data ends", () => {
  const [up, down] = [step(20), step(-16)];

  test("the MCU that has begun is read from zeros, and the others are left empty", async () => {
    expect(await row(4, 0, up, down, up, down)).toEqual([20, 4, 24, 8]);
    expect(await row(4, 0, up, down, up)).toEqual([20, 4, 24, 23]);
    expect(await row(4, 0, up, down)).toEqual([20, 4, 3, 0]);
    expect(await row(4, 0, up)).toEqual([20, 19, 0, 0]);
    expect(await row(4, 0)).toEqual([-1, 0, 0, 0]);
    // All of its blocks.
    const rgb = frameOf(24, 8, "1x1,1x1,1x1", { ids: [82, 71, 66], tables: flat([[0]]).tables });
    const { rgba } = await decode(Buffer.concat([startOf(rgb, 0, [0, 1, 2]), up, down, up, up]));
    expect([0, 8, 16].map(x => [...rgba.subarray(x * 4, x * 4 + 3)].map(sample => sample - 128))).toEqual([
      [20, -16, 20],
      [40, -17, 19],
      [0, 0, 0],
    ]);
  });

  test("however long the row is", async () => {
    for (const blocks of [94, 95, 96, 97, 191, 192, 193]) {
      const sent = range(1, blocks).map(i => (i & 1 ? 16 : 0));
      const data = sent.map(level => step(level || -16));
      expect(await row(200, 0, ...data)).toEqual([...sent, sent.at(-1)! - 1, ...Array(199 - blocks).fill(0)]);
    }
  });

  test("in a code, in a value, or with the last bit of a block", async () => {
    // Blocks of two bits: 0 for one bit, the bit, and 0.
    expect(await row(4, 0, [0b010_010_10])).toEqual([1, 2, 2 - 31, 0]);
    expect(await row(4, 0, [0b010_10_110])).toEqual([1, 1 + 24, 0, 0]);
    expect(await row(4, 0, [0b010_110_0_1])).toEqual([1, 1, 1 - 31, 0]);
    expect(await row(4, 0, [0b110_0_010_0])).toEqual([0, 1, 0, 0]);
    expect(await row(4, 0, [0b010_010_01])).toEqual([1, 2, 3, 0]);
    expect(await row(4, 0, [0b110_0_110_0])).toEqual([0, 0, -1, 0]);
  });

  test("any marker ends it, and is then taken for what it is", async () => {
    for (const end of [marker(RST0), marker(RST0 + 7), marker(TEM), segment(COM, "x"), dri(1)]) {
      expect(await row(4, 0, up, end, down, up)).toEqual([20, 19, 0, 0]);
      expect(await row(4, 0, up, [0xff, 0xff], end, down, up)).toEqual([20, 19, 0, 0]);
    }
    expect(await outcome(Buffer.concat([startOf(flat([[0, 0, 0]])), up, marker(0xbf)]))).toBe(headerOnly);
  });

  test("what is left over is passed over up to the next marker", async () => {
    for (const length of [1, 7, 8, 9, 100, 1000]) {
      const rest = Buffer.alloc(length, Buffer.from([0x55, 0xff, 0]));
      expect(await row(2, 0, up, down, rest, [0])).toEqual([20, 4]);
      expect(await outcome(Buffer.concat([startOf(flat([[0]])), up, rest, Buffer.from([0]), marker(0xbf)]))).toBe(
        headerOnly,
      );
    }
  });

  test("FF 00 is FF, wherever it falls", async () => {
    // Ones, as many in a row as there can be: eight for the code, and ten for the value.
    const table = tableOf([0, 1, 2, 3, 4, 5, 6, 7, 10], range(1, 9));
    const frame = frameOf(8, 64 * 8, "1x1", { tables: [[1, ...Array(63).fill(0)]] });
    const random = randomBytes(8);
    frame.components[0].data.forEach((_, i, data) => (data[i] = i % 64 ? [1023, 127, 7, 1][random() & 3] : i >> 3));
    const file = write(frame, undefined, { tables: { 0: typical[0], [AC]: table } });
    expect(file.toString("hex")).toMatch(/^(..)*ff00ff00/);
    await expectPictures([{ name: "ones", file, expected: pictureOf(frame) }]);
  });

  test("FF at the very end is the start of a marker", async () => {
    expect(await row(3, 0, up, [0xff])).toEqual([20, 19, 0]);
  });

  /** 17 bits that are no code, so no difference, and 0. */
  const withFill = (fill: number[]) => [...up, 0xff, ...fill, 0, 0xff, 0, 0b1_0_010_110];

  test("more FF may come before the 00", async () => {
    for (const fill of [[], [0xff], [0xff, 0xff, 0xff]]) {
      const file = Buffer.concat([startOf(flat([[0, 0, 0, 0]])), Buffer.from(withFill(fill))]);
      expect(await levels(file)).toEqual([[20, 20, 21, 21]]);
    }
  });

  test("however much of the file is left", async () => {
    const frame = flat([[0]]);
    frame.components[0].data.set([0, 0, 1, 0, 1, 0, 1]);
    const tables = [dht(0, tableOf([0], [2])), dht(AC, tableOf([0x11], [1]))];
    const data = [0b00_01_01_01, 0xff, 0xff, 0, 0xff, 0, 0xff, 0];
    const file = jpeg(headerOf(frame), ...tables, sos(frame, scanOf([0])), data);
    await expectPictures([
      { name: "little", file, expected: pictureOf(frame) },
      { name: "much", file: withMoreBehind(file), expected: pictureOf(frame) },
    ]);
  });

  test("a file that is cut anywhere is as good as one that has EOI there", async () => {
    const frame = noise(frameOf(24, 24, "2x2,1x1,1x1"), randomBytes(9), { ac: 8, sparse: 8 });
    const { header, data } = coded(frame, scanOf([0, 1, 2]), typical);
    const same = async (length: number) => {
      const cut = unfinished(headerOf(frame), header, data.subarray(0, length));
      const [a, b] = await Promise.all([decode(cut), decode(withMoreBehind(cut))]);
      return String(a.rgba.equals(b.rgba));
    };
    const lengths = range(0, data.length).filter(length => !slow || length % 3 === 0);
    expect(await where(lengths, same)).toEqual({ true: lengths });
  });
});

describe("restart markers", () => {
  const rst = (number: number) => marker(RST0 + (number & 7));
  /** Two blocks. */
  const pair = (level: number) => Buffer.concat([step(level), step(-16)]);

  test("start the differences anew, on a whole byte", async () => {
    expect(await row(4, 2, pair(20), rst(0), pair(30))).toEqual([20, 4, 30, 14]);
    expect(await row(3, 1, [0b010_00000], rst(0), [0b010_11111], rst(1), [0b000_10101])).toEqual([1, 1, -1]);
  });

  test("what comes between the last block and the marker is passed over", async () => {
    for (const rest of [[0], [0xff], [0xff, 0xff], [0xff, 0], Array(7).fill(1), Array(8).fill(1), Array(600).fill(1)]) {
      expect(await row(4, 2, pair(20), rest, rst(0), pair(30))).toEqual([20, 4, 30, 14]);
    }
  });

  test("what is missing in front of one is missing up to there", async () => {
    expect(await row(9, 3, step(20), rst(0), rst(1), pair(30), step(16))).toEqual([20, 19, 0, -1, 0, 0, 30, 14, 30]);
  });

  test("however long the interval before was", async () => {
    // A byte for the difference, and two for each of the others: 00 01 is 1, and 00 00 is -1.
    const tables = [dht(0, tableOf([0], [8])), dht(AC, tableOf([0x01], [15]))];
    const sent = Buffer.from([0, ...range(1, 63).flatMap(() => [0, 1])]);
    const some = [0, 1, 4, 30, 63];
    const shown = frameOf(8, (some.length + 1) * 8, "1x1", { tables: [Array(64).fill(4)] });
    some.forEach((ones, i) =>
      shown.components[0].data.set([0, ...range(1, 63).map(k => (k <= ones ? 1 : -1))], i * 64),
    );
    const { rgba } = pictureOf(shown);
    const block = (i: number) => rgba.subarray(i * 256, (i + 1) * 256);
    const [whole, empty] = [block(4), block(5)];
    await expectBothWays(
      range(1, 70).flatMap(blocks =>
        [0, 1, 2, 3].flatMap(i => {
          if (slow && (blocks + i) % 4) return [];
          const frame = { ...shown, height: blocks * 3 * 8 };
          const [long, short] = [Buffer.alloc(blocks * sent.length, sent), sent.subarray(0, 1 + 2 * some[i])];
          const data = [long, rst(0), short, rst(1), short];
          const cut = [block(i), Buffer.alloc((blocks - 1) * 256, empty)];
          return {
            name: `${blocks} blocks, then ${short.length} bytes`,
            file: jpeg(headerOf(frame), ...tables, dri(blocks), sos(frame, scanOf([0])), ...data),
            expected: { ...frame, rgba: Buffer.concat([Buffer.alloc(blocks * 256, whole), ...cut, ...cut]) },
          };
        }),
      ),
    );
  });

  test("one may follow the last block", async () => {
    expect(await row(4, 2, pair(20), rst(0), pair(30), rst(1))).toEqual([20, 4, 30, 14]);
  });

  test("an interval can be longer than the scan, and DRI with 0 does away with it", async () => {
    for (const interval of [4, 5, 256, 65535])
      expect(await row(4, interval, pair(20), pair(30))).toEqual([20, 4, 34, 18]);
    const frame = flat([[1, 2, 3]]);
    expect(await levels(write(frame, undefined, { before: [dri(1), dri(0)] }))).toEqual([[1, 2, 3]]);
  });

  /** Five intervals, behind `good` that are in order. A number is a marker, counted from the first that is due. */
  async function resumed(...parts: (number | Buffer)[]) {
    const results = await Promise.all(
      range(0, 7).map(async good => {
        const first = range(1, good).flatMap(i => [pair(16), rst(i - 1)]);
        const rest = parts.map(part => (typeof part === "number" ? rst(good + part) : part));
        return (await row(good * 2 + 10, 2, ...first, ...rest)).slice(good * 2);
      }),
    );
    expect(results.slice(1)).toEqual(Array(7).fill(results[0]));
    return results[0];
  }
  const [a, b, c, d, e] = [17, 18, 19, 20, 21].map(pair);

  test("one that is due one or two intervals later is kept until then", async () => {
    expect(await resumed(a, 0, b, 1, c, 2, d, 3, e)).toEqual([17, 1, 18, 2, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, 1, c, 2, d, 3, e)).toEqual([17, 1, -1, 0, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, 2, d, 3, e)).toEqual([17, 1, -1, 0, 0, 0, 20, 4, 21, 5]);
    // Nothing is read from zeros a second time.
    expect(await resumed(step(17), 1, c, 2, d, 3, e)).toEqual([17, 16, 0, 0, 19, 3, 20, 4, 21, 5]);
  });

  test("one that was due one or two intervals ago is passed over, with what follows it", async () => {
    expect(await resumed(a, -1, e, 0, b, 1, c, 2, d, 3, e)).toEqual([17, 1, 18, 2, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, -2, e, -1, e, -2, 0, b, 1, c, 2, d, 3, e)).toEqual([17, 1, 18, 2, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, -1, e, 1, c, 2, d, 3, e)).toEqual([17, 1, -1, 0, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, -1, e)).toEqual([17, 1, -1, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("one that is further off is taken for the one that is due", async () => {
    for (const far of [3, 4, 5]) {
      expect(await resumed(a, far, b, 1, c, 2, d, 3, e)).toEqual([17, 1, 18, 2, 19, 3, 20, 4, 21, 5]);
    }
    expect(await resumed(a, 3, e)).toEqual([17, 1, 21, 5, -1, 0, 0, 0, 0, 0]);
  });

  test("a marker below C0 is passed over where one is due, and any other is left for after the scan", async () => {
    const after = (code: number) => row(4, 2, a, marker(code), e, rst(0), b).then(String, error => error.code);
    const below = slow ? [1, 2, 0x7f, 0x80, 0xbf] : range(1, 0xbf);
    const found = await where([...below, ...range(0xc0, RST0 - 1), ...range(RST0 + 8, 254)], after);
    expect(found["17,1,18,2"]).toEqual(below);
    expect(found["17,1,-1,0"]).toEqual([EOI, 0xdc, ...range(0xe0, 0xef), COM]);
    expect(Object.keys(found)).toEqual(["17,1,18,2", "ERR_IMAGE_DECODE_FAILED", "17,1,-1,0"]);
  });

  test("whichever is due", async () => {
    const codes = [...range(0xc0, RST0 - 1), RST0 + 8, 0xda, 0xdb];
    for (const good of range(1, 7)) {
      const first = range(1, good).flatMap(i => [a, rst(i - 1)]);
      const after = (code: number) =>
        row(good * 2 + 4, 2, ...first, a, marker(code), e, rst(good), b).then(String, error => error.code);
      expect(await where(codes, after)).toEqual({ ERR_IMAGE_DECODE_FAILED: codes });
    }
  });

  test("of any interval, in any layout", async () => {
    const frame = noise(frameOf(45, 37, "2x2,1x1,1x1"), randomBytes(10), { sparse: 4 });
    const expected = pictureOf(frame);
    await expectBothWays(
      range(1, 10).flatMap(interval => [
        { name: `${interval} MCUs`, file: write(frame, [scanOf([0, 1, 2], 0, 63, 0, 0, { interval })]), expected },
        {
          // The interval and the numbers begin again with each scan.
          name: `${interval} blocks`,
          file: write(frame, [
            scanOf([0], 0, 63, 0, 0, { interval }),
            scanOf([1], 0, 63, 0, 0, { interval }),
            scanOf([2], 0, 63, 0, 0, { interval: interval - 1 }),
          ]),
          expected,
        },
      ]),
    );
  });
});

test("rows of many MCUs, with up to 10 blocks each", async () => {
  const random = randomBytes(16);
  await expectBothWays(
    [
      ["1x1", 200 * 8, 16, [95, 96, 97, 199, 201]],
      ["2x2,1x1,1x1", 35 * 16, 32, [15, 16, 17, 33, 36]],
      ["4x2,1x1,1x1", 20 * 32, 16, [8, 9, 10]],
    ].flatMap(([sampling, width, height, intervals]: any[]) => {
      const frame = noise(frameOf(width, height, sampling), random, { sparse: 30 });
      const expected = pictureOf(frame);
      return [0, ...intervals].map(interval => ({
        name: `${sampling}, ${interval}`,
        file: write(frame, [scanOf(all(frame), 0, 63, 0, 0, { interval })], { tables: typical }),
        expected,
      }));
    }),
  );
});

describe("several scans", () => {
  const before = [adobe(0)];

  test("a component by itself has no blocks to fill an MCU", async () => {
    const random = randomBytes(11);
    const sizes = [1, 8, 9, 17, 31, 33];
    await expectBothWays(
      ["2x2", "4x1", "1x4", "3x2", "4x4", "2x2,1x1,1x1", "4x4,2x2,1x1", "1x1,2x3,1x1"].flatMap(sampling =>
        sizes.map((width, i) => {
          const frame = noise(frameOf(width, sizes[(i + 2) % 6], sampling), random, { sparse: 8 });
          const file = write(
            frame,
            frame.components.map((_, c) => scanOf([c])),
            { tables: typical },
          );
          return { name: `${sampling}, ${width} wide`, file, expected: pictureOf(frame) };
        }),
      ),
    );
  });

  test("components can be grouped and ordered in any way", async () => {
    const frame = noise(frameOf(35, 21, "2x1,1x2,1x1"), randomBytes(12), { sparse: 8 });
    const expected = pictureOf(frame);
    const layouts = ["0 1 2", "2 1 0", "01 2", "2 01", "0 12", "12 0", "02 1", "1 02", "21 0", "1 012"];
    await expectBothWays(
      layouts.map(name => {
        const scans = name.split(" ").map(group => scanOf([...group].map(Number)));
        return { name, file: write(frame, scans), expected };
      }),
    );
  });

  test("a second scan of a component replaces the coefficients that it has", async () => {
    const random = randomBytes(13);
    const [first, second] = [0, 1].map(() => noise(frameOf(16, 16, "1x1,1x1,1x1"), random, { sparse: 3, ac: 40 }));
    const both = copyOf(first);
    both.components[1].data.forEach((old, i, data) => (data[i] = second.components[1].data[i] || (i % 64 ? old : 0)));
    second.components[1].data[0] = both.components[1].data[0] = 0;
    const of = (frame: Frame, c: number) => Object.values(coded(frame, scanOf([c]))).flat();
    const file = jpeg(...before, headerOf(first), ...of(first, 0), ...of(first, 1), ...of(first, 2), ...of(second, 1));
    await expectPictures([{ name: "twice", file, expected: pictureOf(both, { colors: "RGB" }) }]);
  });

  test("as far as it gets", async () => {
    const random = randomBytes(17);
    const [first, second] = [0, 1].map(() =>
      noise(frameOf(110 * 16, 32, "2x2,1x1,1x1"), random, { sparse: 30, dc: 7 }),
    );
    // All in whole bytes. What is read from zeros is no difference, and the end of the block.
    const inBytes = (symbols: number[]) =>
      tableOf(
        symbols,
        symbols.map(symbol => (symbol ? 16 - (symbol & 15) : 8)),
      );
    const tables = { 0: inBytes(range(0, 7)), [AC]: inBytes(typical[AC].symbols.filter(symbol => symbol % 16 < 8)) };
    const of = (frame: Frame, components: number[], interval: number) =>
      coded(frame, scanOf(components, 0, 63, 0, 0, { interval, dc: [0, 0], ac: [0, 0] }), tables);
    const start = [of(first, [0], 0), of(first, [1, 2], 0)].flatMap(({ header, data }) => [header, data]);
    await expectBothWays(
      [[0], [0, 2], [1, 2]].flatMap(components =>
        (slow ? [150] : [10, 100, 150]).map(mcus => {
          const both = copyOf(first);
          let [seen, last] = [0, [0, 0]];
          const perMcu = components.length === 1 ? 1 : components.includes(0) ? 5 : 2;
          walk(
            both,
            scanOf(components),
            ({ data, across }, i, x, y) => {
              const [at, mcu] = [(y * across + x) * 64, Math.floor(seen++ / perMcu)];
              const sent = second.components[components[i]].data;
              if (mcu < mcus) for (let k = 1; k < 64; k++) data[at + k] = sent[at + k] || data[at + k];
              if (mcu < mcus) last[i] = sent[at];
              if (mcu <= mcus) data[at] = last[i];
            },
            () => {},
          );
          const { header, data } = of(second, components, mcus);
          const cut = data.subarray(0, data.indexOf(marker(RST0)));
          const file = jpeg(...before, headerOf(first), dht(0, tables[0]), dht(AC, tables[AC]), ...start, header, cut);
          return { name: `${components}, ${mcus}`, file, expected: pictureOf(both, { colors: "RGB" }) };
        }),
      ),
    );
  });

  test("a scan that breaks off does not hold up the next", async () => {
    const rgb = frameOf(24, 8, "1x1,1x1,1x1", { ids: [82, 71, 66], tables: flat([[0]]).tables });
    const next = (c: number) => sos(rgb, scanOf([c], 0, 63, 0, 0, { dc: [0], ac: [0] }));
    const file = Buffer.concat([
      startOf(rgb),
      step(20),
      next(1),
      next(2),
      step(20),
      step(20),
      step(20),
      next(2),
      step(16),
    ]);
    expect(await outcome(file)).toBe(fine);
    const { rgba } = await decode(file);
    expect([0, 8, 16].map(x => [...rgba.subarray(x * 4, x * 4 + 3)].map(sample => sample - 128))).toEqual([
      [20, -1, 16],
      [19, 0, 15],
      [0, 0, 60],
    ]);
  });
});
