// The entropy-coded data of sequential scans with Huffman coding.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import {
  alsoWithTrailer,
  decode,
  eights,
  everySymbol,
  expectPictures,
  fine,
  flat,
  grouped,
  headerOnly,
  levels,
  outcome,
  range,
  trailerLength,
  withTrailer,
  type Case,
} from "./decode";
import { pictureOf } from "./model";
import {
  AC,
  adobe,
  all,
  APP0,
  coded,
  COM,
  copyOf,
  dcOnly,
  dht,
  dhts,
  DNL,
  DQT,
  dri,
  EOB,
  EOI,
  frameOf,
  groupsOf,
  headerOf,
  int16,
  jpeg,
  marker,
  noise,
  rgbIds,
  rst,
  RST0,
  scanOf,
  scanWithTables,
  segment,
  SOF0,
  SOI,
  SOS,
  sos,
  stuffed,
  Symbols,
  symbolsOf,
  tableOf,
  TEM,
  typical,
  walk,
  withoutEoi,
  withRestarts,
  write,
  ZRL,
  type Frame,
} from "./write";

const expectAlsoWithTrailer = (cases: Case[]) => expectPictures(alsoWithTrailer(cases));

test("trailerLength is the MIN_LEN_FOR_PAIRS of src/jpeg/sequential.rs", async () => {
  const source = await Bun.file(join(import.meta.dir, "../../../../../src/jpeg/sequential.rs")).text();
  expect(source).toContain(`const MIN_LEN_FOR_PAIRS: usize = ${trailerLength};`);
  expect(source).toContain("data_len >= MIN_LEN_FOR_PAIRS");
});

describe("Huffman codes", () => {
  /** Code lengths. A table cannot have all of 1 to 16 and two more codes. */
  const [fromOne, fromTwo] = [[1, ...range(3, 16)], range(2, 16)];

  test.each([
    ["1 and 3 to 16", fromOne],
    ["2 to 16", fromTwo],
  ])("every AC symbol, with codes of %s bits", async (_, lengths) => {
    // Four blocks for each symbol: the smallest and the largest magnitude, with both signs, followed by a 1.
    const symbols = [...typical[AC].symbols].sort((a, b) => a - b);
    const all = frameOf(8, symbols.length * 4 * 8);
    const { data } = all.components[0];
    for (const [i, symbol] of symbols.entries()) {
      const [run, size] = symbol === ZRL ? [16, 1] : [symbol >> 4, symbol & 15];
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
    await expectAlsoWithTrailer(cases);
  });

  // Three of the four luma blocks of an MCU are padding. They can hold values that are out of range for samples.
  const narrow = (rows: number) => frameOf(8, rows * 8, "4x1,1x1,1x1");

  test("every DC category, with codes of 1 to 16 bits", async () => {
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
    await expectAlsoWithTrailer(
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

  test("the DC prediction wraps at 16 bits", async () => {
    const [frame, wrapped] = [narrow(4), narrow(4)];
    let sum = 0;
    for (const [i, difference] of [40, 32767, 32767, 2, 40, 32767, 32767, 2, -8, -32767, -32767, -2, 16].entries()) {
      frame.components[0].data[i * 64] = sum += difference;
      wrapped.components[0].data[i * 64] = int16(sum);
    }
    for (const block of [13, 14, 15]) frame.components[0].data[block * 64] = sum;
    await expectPictures([{ name: "sums", file: write(frame), expected: pictureOf(wrapped) }]);
  });

  test("an AC coefficient can have up to 15 bits, with codes of 1 to 13 bits", async () => {
    // Every other one is multiplied by 0.
    const frame = frameOf(8, 40, "1x1", { tables: [range(0, 63).map(k => (k & 1 ? 0 : 1))] });
    for (let size = 11; size <= 15; size++) {
      frame.components[0].data.set(
        [8, (1 << size) - 1, 20, -(1 << (size - 1)), -20, 0, 0, 1 << (size - 1), 9],
        (size - 11) * 64,
      );
    }
    const symbols = [EOB, 4, 5, ...range(0x0b, 0x0f), ...range(0x2b, 0x2f)];
    const files = symbols.map((shortest, first) => {
      const lengths = symbols.map((_, i) => 1 + ((i - first + symbols.length) % symbols.length));
      const file = write(frame, undefined, { tables: { [AC]: tableOf(symbols, lengths) } });
      return { name: `1 for ${shortest}`, file };
    });
    const [whole, eighth] = [pictureOf(frame), pictureOf(frame, { eighths: 1 })];
    await expectPictures(
      [{ name: "optimal", file: write(frame) }, ...files].flatMap(({ name, file }) => [
        { name, file, expected: whole },
        { name: `${name}, with a trailer`, file: withTrailer(file), expected: whole },
        { name: `${name}, an eighth`, file, expected: eighth, eighths: 1 },
      ]),
    );
  });

  /** The second block shows whether the first took the right number of bits. */
  async function expectFirstBlock(write: (symbols: Symbols) => unknown, coefficients: Record<number, number>) {
    const frame = frameOf(16, 8);
    Object.assign(frame.components[0].data, coefficients, { 64: 40, 65: 30 });
    const symbols = new Symbols().value(0, 0, 0);
    write(symbols);
    symbols.value(0, 0, 40).value(AC, 0, 30).symbol(AC, EOB);
    const tables = { 0: typical[0], [AC]: everySymbol };
    const file = jpeg(headerOf(frame), dht(AC, tables[AC]), sos(frame, scanOf([0])), symbols.bytes(tables));
    await expectPictures(
      [8, 1].flatMap(eighths => [
        { name: "short", file, expected: pictureOf(frame, { eighths }), eighths },
        { name: "with a trailer", file: withTrailer(file), expected: pictureOf(frame, { eighths }), eighths },
      ]),
    );
  }
  const zrl = (symbols: Symbols, times: number) => {
    for (let i = 0; i < times; i++) symbols.symbol(AC, ZRL);
    return symbols;
  };

  test("no EOB follows coefficient 63", async () => {
    await expectFirstBlock(symbols => zrl(symbols, 3).value(AC, 14, 50), { 63: 50 });
    await expectFirstBlock(symbols => zrl(symbols, 3).value(AC, 13, 50).symbol(AC, EOB), { 62: 50 });
    await expectFirstBlock(symbols => zrl(symbols.value(AC, 14, 50), 3), { 15: 50 });
    await expectFirstBlock(symbols => zrl(symbols.value(AC, 13, 50), 3).symbol(AC, EOB), { 14: 50 });
  });

  test("a ZRL past coefficient 63 ends the block", async () => {
    await expectFirstBlock(symbols => zrl(symbols, 4), {});
    await expectFirstBlock(symbols => zrl(symbols, 3).value(AC, 13, 50).symbol(AC, ZRL), { 62: 50 });
  });

  test("a run past coefficient 63 lands on 63", async () => {
    await expectFirstBlock(symbols => zrl(symbols, 3).value(AC, 15, 50), { 63: 50 });
    for (let run = 1; run <= 15; run++) {
      await expectFirstBlock(symbols => zrl(symbols, 3).value(AC, 13, 9).value(AC, run, 50), { 62: 9, 63: 50 });
    }
  });

  test("any symbol with SSSS = 0 but ZRL is EOB", async () => {
    for (let run = 1; run <= 14; run++) {
      await expectFirstBlock(symbols => symbols.value(AC, 0, 50).symbol(AC, run << 4), { 1: 50 });
    }
  });

  test("an invalid code takes 17 bits and decodes as symbol 0", async () => {
    await expectFirstBlock(symbols => symbols.value(AC, 0, 50).bits(0xffff, 16).bits(1, 1), { 1: 50 });
    await expectFirstBlock(symbols => symbols.value(AC, 0, 50).bits(0x8000, 16).bits(0, 1), { 1: 50 });
    // In a DC table, and in a table without any codes.
    const frame = flat([[0, 7, 7, 9]]);
    const none = { counts: Array(16).fill(0), symbols: [] };
    const symbols = new Symbols();
    for (const difference of [0, 7, 0, 2]) {
      if (difference) symbols.value(0, 0, difference);
      else symbols.bits(0xff80, 16).bits(0, 1);
      symbols.bits(0x1234, 16).bits(1, 1);
    }
    const file = jpeg(headerOf(frame), dht(AC, none), sos(frame, scanOf([0])), symbols.bytes());
    for (const each of [file, withTrailer(file)]) expect(await levels(each)).toEqual([[0, 7, 7, 9]]);
  });

  test("a symbol may have two codes", async () => {
    const frame = flat([[0, 0]]);
    const tables = [dht(0, tableOf([2, 2], [1, 12])), dht(AC, tableOf([EOB], [1]))];
    const data = new Symbols().bits(0b0_11_0, 4).bits(0b1000_0000_0000_11_0, 15).bytes();
    const file = jpeg(headerOf(frame), ...tables, sos(frame, scanOf([0])), data);
    for (const each of [file, withTrailer(file)]) expect(await levels(each)).toEqual([[3, 6]]);
  });

  test("each component uses the tables that SOS selects", async () => {
    const frame = noise(frameOf(24, 16, "1x1,1x1,1x1"), randomBytes(18), { sparse: 5 });
    const expected = pictureOf(frame);
    await expectAlsoWithTrailer(
      range(0, 63).map(bits => {
        const [dc, ac] = [0, 3].map(first => range(first, first + 2).map(bit => (bits >> bit) & 1));
        const file = write(frame, [scanOf([0, 1, 2], 0, 63, 0, 0, { dc, ac })], { tables: typical });
        return { name: `${dc} ${ac}`, file, expected };
      }),
    );
  });

  test.each([1, 2, 47, 48, 49, 50, 61, 62, 63])("any two short codes in a row, at coefficient %i", async first => {
    const short = [EOB, ZRL, 0x01, 0x11, 0x21, 0xf1, 0x30, 0x02];
    const long = range(0, 15).map(run => (run << 4) | 3);
    const tables = {
      0: tableOf([0, 1, 2, 3], [2, 2, 10, 10]),
      [AC]: tableOf([...short, ...long], [3, 3, 3, 3, 3, 3, 3, 4, ...long.map(() => 10)]),
    };
    const pairs = short.flatMap(a => short.map(b => [a, b]));
    const frame = frameOf(pairs.length * 8, 16, "1x1", { tables: [Array(64).fill(12)] });
    const symbols = new Symbols();
    // After a long DC code, then after a short one.
    for (const [i, codes] of [...pairs, ...pairs].entries()) {
      const block = frame.components[0].data.subarray(i * 64, (i + 1) * 64);
      block[0] = i & 1 ? 0 : i < pairs.length ? 5 : 1;
      symbols.value(0, 0, i & 1 ? (i < pairs.length ? -5 : -1) : block[0]);
      let k = 1;
      for (; k < first; k++) {
        const run = Math.min(first - 1 - k, 15);
        symbols.value(AC, run, (block[(k += run)] = -4));
      }
      for (const symbol of [...codes, 0x02, EOB]) {
        const [run, size] = [symbol >> 4, symbol & 15];
        if (k > 63) break;
        if (size) symbols.value(AC, run, (block[Math.min((k += run), 63)] = k++ & 1 ? size : -size));
        else symbols.symbol(AC, symbol);
        if (!size) k = run === 15 ? k + 16 : 64;
      }
    }
    const file = jpeg(headerOf(frame), ...dhts(tables), sos(frame, scanOf([0])), symbols.bytes(tables));
    const expected = pictureOf(frame);
    await expectPictures([file, withTrailer(file)].map(file => ({ name: `${file.length} bytes`, file, expected })));
  });

  test("a short code alternates with one that has many extra bits", async () => {
    // Together they take 14 to 19 bits. Every other coefficient is multiplied by 0.
    const sizes = range(8, 13);
    const table = tableOf([0x01, ...sizes, EOB], [2, ...sizes.map(() => 3), 9].with(6, 4));
    const frame = frameOf(8, sizes.length * 8 * 8, "1x1", { tables: [range(0, 63).map(k => (k & 1 ? 9 : +!k))] });
    const random = randomBytes(14);
    frame.components[0].data.forEach((_, i, data) => {
      const [size, sign] = [sizes[i >> 9], random() & 1 ? 1 : -1];
      data[i] = i % 64 === 0 ? (i >> 6) * (i & 64 ? 7 : -3) : sign * (i & 1 ? 1 : (1 << (size - 1)) + (random() & 127));
      if (i % 64 > 56 + ((i >> 6) & 7)) data[i] = 0;
    });
    const file = write(frame, undefined, { tables: { 0: typical[0], [AC]: table } });
    await expectPictures([{ name: "pairs", file: withTrailer(file), expected: pictureOf(frame) }]);
  });

  test("the longest possible blocks", async () => {
    // 31 bits for each coefficient. Every eighth block has fewer coefficients.
    const tables = { 0: tableOf([7, 15], [16, 16]), [AC]: tableOf([EOB, 15], [3, 16]) };
    const frame = narrow(24);
    frame.tables = [dcOnly(1)];
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

  test("random data decodes the same with a trailer", async () => {
    const random = randomBytes(15);
    const tables = [
      [typical[0], typical[AC]],
      [tableOf([0, 1, 2, 9], [1, 2, 3, 4]), tableOf([0x01, EOB, ZRL, 0x12, 0xf1, 0x0d], [2, 2, 3, 3, 3, 4])],
      [tableOf([3, 0, 15], [2, 2, 2]), tableOf([ZRL, 0x31, 0x01, 0x70, 0x0f, 0x08], [1, 2, 3, 5, 7, 9])],
    ];
    const cases = tables.flatMap(([dc, ac]) =>
      ["1x1", "2x2,1x1,1x1", "2x1,1x1,1x1,2x1"].flatMap(sampling =>
        [0, 1, 3].flatMap(interval =>
          range(1, slow ? 2 : 20).map(async i => {
            const frame = frameOf(64, 32, sampling);
            const scan = scanOf(all(frame), 0, 63, 0, 0, { dc: [0, 0, 0, 0], ac: [0, 0, 0, 0] });
            // Too much data for some restart intervals, too little for others.
            const parts = range(0, interval ? 32 / interval : 0).flatMap(n => [
              stuffed(range(1, interval ? random() & 31 : random() * 4).map(random)),
              rst(n),
            ]);
            const file = jpeg(headerOf(frame), dht(0, dc), dht(AC, ac), dri(interval), sos(frame, scan), ...parts);
            return { name: `${sampling}, ${interval}, ${i}`, file: withTrailer(file), expected: await decode(file) };
          }),
        ),
      ),
    );
    await expectPictures(await Promise.all(cases));
  });
});

// A block is one byte: 10 for category 5, the five bits, and 0 for EOB. Zeros decode as a DC difference of -1 and EOB.
const small = { 0: tableOf([1, 5, 0], [1, 2, 3]), [AC]: tableOf([EOB], [1]) };
const step = (difference: number) => new Symbols().value(0, 0, difference).symbol(AC, EOB).bytes(small);
const startOf = (frame: Frame, interval = 0, components = [0]) =>
  withoutEoi(
    headerOf(frame),
    ...dhts(small),
    dri(interval),
    sos(frame, scanOf(components, 0, 63, 0, 0, { dc: [0, 0, 0], ac: [0, 0, 0] })),
  );
/** The `levels()` of a single row of blocks. */
async function row(blocks: number, interval: number, ...data: (Buffer | number[])[]) {
  const file = Buffer.concat([
    startOf(flat([Array(blocks).fill(0)]), interval),
    ...data.map(part => Buffer.from(part)),
  ]);
  const [short] = await levels(file);
  expect(await levels(withTrailer(file))).toEqual([short]);
  return short;
}
const rgb = frameOf(24, 8, "1x1,1x1,1x1", { ids: rgbIds, tables: [eights] });
async function rgbLevels(file: Buffer) {
  const { rgba } = await decode(file);
  return [0, 8, 16].map(x => [...rgba.subarray(x * 4, x * 4 + 3)].map(sample => sample - 128));
}

describe("the end of the data", () => {
  const [up, down] = [step(20), step(-16)];

  test("the current MCU is decoded from zeros, and later ones stay empty", async () => {
    expect(await row(4, 0, up, down, up, down)).toEqual([20, 4, 24, 8]);
    expect(await row(4, 0, up, down, up)).toEqual([20, 4, 24, 23]);
    expect(await row(4, 0, up, down)).toEqual([20, 4, 3, 0]);
    expect(await row(4, 0, up)).toEqual([20, 19, 0, 0]);
    expect(await row(4, 0)).toEqual([-1, 0, 0, 0]);
    expect(await rgbLevels(Buffer.concat([startOf(rgb, 0, [0, 1, 2]), up, down, up, up]))).toEqual([
      [20, -16, 20],
      [40, -17, 19],
      [0, 0, 0],
    ]);
  });

  test("after about 96 or 192 blocks of a row", async () => {
    for (const blocks of [94, 95, 96, 97, 191, 192, 193]) {
      const sent = range(1, blocks).map(i => (i & 1 ? 16 : 0));
      const data = sent.map(level => step(level || -16));
      expect(await row(200, 0, ...data)).toEqual([...sent, sent.at(-1)! - 1, ...Array(199 - blocks).fill(0)]);
    }
  });

  test("in a code, in its extra bits, or right after a block", async () => {
    // 010 is a whole block: category 1, the bit, and EOB.
    expect(await row(4, 0, [0b010_010_10])).toEqual([1, 2, 2 - 31, 0]);
    expect(await row(4, 0, [0b010_10_110])).toEqual([1, 1 + 24, 0, 0]);
    expect(await row(4, 0, [0b010_110_0_1])).toEqual([1, 1, 1 - 31, 0]);
    expect(await row(4, 0, [0b110_0_010_0])).toEqual([0, 1, 0, 0]);
    expect(await row(4, 0, [0b010_010_01])).toEqual([1, 2, 3, 0]);
    expect(await row(4, 0, [0b110_0_110_0])).toEqual([0, 0, -1, 0]);
  });

  test("any marker ends the data, and is handled after the scan", async () => {
    for (const end of [rst(0), rst(7), marker(TEM), segment(COM, "x"), dri(1)]) {
      expect(await row(4, 0, up, end, down, up)).toEqual([20, 19, 0, 0]);
      expect(await row(4, 0, up, [0xff, 0xff], end, down, up)).toEqual([20, 19, 0, 0]);
    }
    expect(await outcome(Buffer.concat([startOf(flat([[0, 0, 0]])), up, marker(0xbf)]))).toBe(headerOnly);
  });

  test("extra data is skipped up to the next marker", async () => {
    for (const length of [1, 7, 8, 9, 100, 1000]) {
      const rest = Buffer.alloc(length, Buffer.from([0x55, 0xff, 0]));
      expect(await row(2, 0, up, down, rest, [0])).toEqual([20, 4]);
      expect(await outcome(Buffer.concat([startOf(flat([[0]])), up, rest, Buffer.from([0]), marker(0xbf)]))).toBe(
        headerOnly,
      );
    }
  });

  test("FF 00 is unstuffed at any position", async () => {
    // Long runs of ones: eight in the code, ten in the extra bits.
    const table = tableOf([0, 1, 2, 3, 4, 5, 6, 7, 10], range(1, 9));
    const frame = frameOf(8, 64 * 8, "1x1", { tables: [dcOnly(1)] });
    const random = randomBytes(8);
    frame.components[0].data.forEach((_, i, data) => (data[i] = i % 64 ? [1023, 127, 7, 1][random() & 3] : i >> 3));
    const file = write(frame, undefined, { tables: { 0: typical[0], [AC]: table } });
    expect(file.toString("hex")).toMatch(/^(..)*ff00ff00/);
    await expectPictures([{ name: "ones", file, expected: pictureOf(frame) }]);
  });

  test("an FF at the end of the file starts a marker", async () => {
    expect(await row(3, 0, up, [0xff])).toEqual([20, 19, 0]);
  });

  test("FF FF 00 is unstuffed like FF 00", async () => {
    for (const fill of [[], [0xff], [0xff, 0xff, 0xff]]) {
      // The second block is an invalid code of 17 ones, and EOB.
      const data = [...up, 0xff, ...fill, 0, 0xff, 0, 0b1_0_010_110];
      const file = Buffer.concat([startOf(flat([[0, 0, 0, 0]])), Buffer.from(data)]);
      expect(await levels(file)).toEqual([[20, 20, 21, 21]]);
    }
  });

  test("FF FF 00 is unstuffed like FF 00, with a trailer too", async () => {
    const frame = flat([[0]]);
    frame.components[0].data.set([0, 0, 1, 0, 1, 0, 1]);
    const tables = [dht(0, tableOf([0], [2])), dht(AC, tableOf([0x11], [1]))];
    const data = [0b00_01_01_01, 0xff, 0xff, 0, 0xff, 0, 0xff, 0];
    const file = jpeg(headerOf(frame), ...tables, sos(frame, scanOf([0])), data);
    await expectPictures([
      { name: "short", file, expected: pictureOf(frame) },
      { name: "with a trailer", file: withTrailer(file), expected: pictureOf(frame) },
    ]);
  });

  test("a truncated file decodes as if EOI followed", async () => {
    const frame = noise(frameOf(24, 24, "2x2,1x1,1x1"), randomBytes(9), { ac: 8, sparse: 8 });
    const { header, data } = coded(frame, scanOf([0, 1, 2]), typical);
    const same = async (length: number) => {
      const cut = withoutEoi(headerOf(frame), header, data.subarray(0, length));
      const [a, b] = await Promise.all([decode(cut), decode(withTrailer(cut))]);
      return String(a.rgba.equals(b.rgba));
    };
    const lengths = range(0, data.length).filter(length => !slow || length % 3 === 0);
    expect(await grouped(lengths, same)).toEqual({ true: lengths });
  });
});

describe("restart markers", () => {
  /** Two blocks. */
  const pair = (level: number) => Buffer.concat([step(level), step(-16)]);

  test("reset the DC prediction and align to a byte", async () => {
    expect(await row(4, 2, pair(20), rst(0), pair(30))).toEqual([20, 4, 30, 14]);
    expect(await row(3, 1, [0b010_00000], rst(0), [0b010_11111], rst(1), [0b000_10101])).toEqual([1, 1, -1]);
  });

  test("extra data at the end of an interval is skipped", async () => {
    for (const rest of [[0], [0xff], [0xff, 0xff], [0xff, 0], Array(7).fill(1), Array(8).fill(1), Array(600).fill(1)]) {
      expect(await row(4, 2, pair(20), rest, rst(0), pair(30))).toEqual([20, 4, 30, 14]);
    }
  });

  test("decoding resumes after an interval that lacks data", async () => {
    expect(await row(9, 3, step(20), rst(0), rst(1), pair(30), step(16))).toEqual([20, 19, 0, -1, 0, 0, 30, 14, 30]);
  });

  test("an interval that lacks data reads zeros, not what the previous one had", async () => {
    // One byte for DC and two for each AC coefficient: 00 01 is 1, and 00 00 is -1.
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
    await expectAlsoWithTrailer(
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

  test("an interval can be longer than the scan, and DRI with 0 turns them off", async () => {
    for (const interval of [4, 5, 256, 65535])
      expect(await row(4, interval, pair(20), pair(30))).toEqual([20, 4, 34, 18]);
    const frame = flat([[1, 2, 3]]);
    expect(await levels(write(frame, undefined, { before: [dri(1), dri(0)] }))).toEqual([[1, 2, 3]]);
  });

  /** Five intervals, after 0 to 7 intact ones. A number is a restart marker, relative to the first that is expected. */
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

  test("one that is 1 or 2 ahead of the expected one stays pending", async () => {
    expect(await resumed(a, 0, b, 1, c, 2, d, 3, e)).toEqual([17, 1, 18, 2, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, 1, c, 2, d, 3, e)).toEqual([17, 1, -1, 0, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, 2, d, 3, e)).toEqual([17, 1, -1, 0, 0, 0, 20, 4, 21, 5]);
    // If the previous interval ran out of data, the lost one stays empty.
    expect(await resumed(step(17), 1, c, 2, d, 3, e)).toEqual([17, 16, 0, 0, 19, 3, 20, 4, 21, 5]);
  });

  test("one that is 1 or 2 behind is skipped with its data", async () => {
    expect(await resumed(a, -1, e, 0, b, 1, c, 2, d, 3, e)).toEqual([17, 1, 18, 2, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, -2, e, -1, e, -2, 0, b, 1, c, 2, d, 3, e)).toEqual([17, 1, 18, 2, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, -1, e, 1, c, 2, d, 3, e)).toEqual([17, 1, -1, 0, 19, 3, 20, 4, 21, 5]);
    expect(await resumed(a, -1, e)).toEqual([17, 1, -1, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("one that is further off counts as the expected one", async () => {
    for (const far of [3, 4, 5]) {
      expect(await resumed(a, far, b, 1, c, 2, d, 3, e)).toEqual([17, 1, 18, 2, 19, 3, 20, 4, 21, 5]);
    }
    expect(await resumed(a, 3, e)).toEqual([17, 1, 21, 5, -1, 0, 0, 0, 0, 0]);
  });

  test("in place of RST0, a marker below C0 is skipped, and any other ends the scan", async () => {
    const after = (code: number) => row(4, 2, a, marker(code), e, rst(0), b).then(String, error => error.code);
    const below = slow ? [1, 2, 0x7f, 0x80, 0xbf] : range(1, 0xbf);
    const found = await grouped([...below, ...range(0xc0, RST0 - 1), ...range(RST0 + 8, 254)], after);
    expect(found["17,1,18,2"]).toEqual(below);
    expect(found["17,1,-1,0"]).toEqual([EOI, DNL, ...range(APP0, APP0 + 15), COM]);
    expect(Object.keys(found)).toEqual(["17,1,18,2", "ERR_IMAGE_DECODE_FAILED", "17,1,-1,0"]);
  });

  test("in place of RST1 to RST7, the markers around RSTn end the scan too", async () => {
    const codes = [...range(SOF0, RST0 - 1), SOI, SOS, DQT];
    for (const good of range(1, 7)) {
      const first = range(1, good).flatMap(i => [a, rst(i - 1)]);
      const after = (code: number) =>
        row(good * 2 + 4, 2, ...first, a, marker(code), e, rst(good), b).then(String, error => error.code);
      expect(await grouped(codes, after)).toEqual({ ERR_IMAGE_DECODE_FAILED: codes });
    }
  });

  test("intervals of 1 to 10 MCUs, interleaved or not", async () => {
    const frame = noise(frameOf(45, 37, "2x2,1x1,1x1"), randomBytes(10), { sparse: 4 });
    const expected = pictureOf(frame);
    await expectAlsoWithTrailer(
      range(1, 10).flatMap(interval => [
        { name: `${interval} MCUs`, file: write(frame, [scanOf([0, 1, 2], 0, 63, 0, 0, { interval })]), expected },
        {
          // The interval and the numbering start over with each scan.
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
  await expectAlsoWithTrailer(
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

  test("a scan of one component has no padding blocks", async () => {
    const random = randomBytes(11);
    const sizes = [1, 8, 9, 17, 31, 33];
    await expectAlsoWithTrailer(
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
    await expectAlsoWithTrailer(
      layouts.map(name => {
        const scans = groupsOf(name).map(group => scanOf(group));
        return { name, file: write(frame, scans), expected };
      }),
    );
  });

  test("a repeated scan of a component overwrites DC and the AC coefficients that it codes", async () => {
    const random = randomBytes(13);
    const [first, second] = [0, 1].map(() => noise(frameOf(16, 16, "1x1,1x1,1x1"), random, { sparse: 3, ac: 40 }));
    const both = copyOf(first);
    both.components[1].data.forEach((old, i, data) => (data[i] = second.components[1].data[i] || (i % 64 ? old : 0)));
    second.components[1].data[0] = both.components[1].data[0] = 0;
    const of = (frame: Frame, c: number) => scanWithTables(frame, scanOf([c]));
    const file = jpeg(...before, headerOf(first), ...of(first, 0), ...of(first, 1), ...of(first, 2), ...of(second, 1));
    await expectPictures([{ name: "twice", file, expected: pictureOf(both, { colors: "RGB" }) }]);
  });

  test("a truncated repeated scan leaves the remaining blocks unchanged", async () => {
    const random = randomBytes(17);
    const [first, second] = [0, 1].map(() =>
      noise(frameOf(110 * 16, 32, "2x2,1x1,1x1"), random, { sparse: 30, dc: 7 }),
    );
    // Each code with its extra bits takes whole bytes. Zeros decode as a DC difference of 0 and EOB.
    const inBytes = (symbols: number[]) =>
      tableOf(
        symbols,
        symbols.map(symbol => (symbol ? 16 - (symbol & 15) : 8)),
      );
    const tables = { 0: inBytes(range(0, 7)), [AC]: inBytes(typical[AC].symbols.filter(symbol => symbol % 16 < 8)) };
    const of = (frame: Frame, components: number[], interval: number) =>
      coded(frame, scanOf(components, 0, 63, 0, 0, { interval, dc: [0, 0], ac: [0, 0] }), tables);
    const start = [of(first, [0], 0), of(first, [1, 2], 0)].flatMap(({ header, data }) => [header, data]);
    await expectAlsoWithTrailer(
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
          const cut = data.subarray(0, data.indexOf(rst(0)));
          const file = jpeg(...before, headerOf(first), ...dhts(tables), ...start, header, cut);
          return { name: `${components}, ${mcus}`, file, expected: pictureOf(both, { colors: "RGB" }) };
        }),
      ),
    );
  });

  const next = (c: number) => sos(rgb, scanOf([c], 0, 63, 0, 0, { dc: [0], ac: [0] }));

  test.each([
    [4, 6, range(1, 13)],
    [200, 3, [96, 192, 200, 296].flatMap(blocks => range(blocks - 1, blocks + 1))],
  ])("decoding resumes after long intervals that lack data: %i by %i blocks", async (wide, high, intervals) => {
    const frame = { ...rgb, width: wide * 8, height: high * 8 };
    await expectPictures(
      intervals.map(interval => {
        const data = withRestarts<Buffer>(Array(Math.ceil((wide * high) / interval)).fill(step(20)));
        const file = Buffer.concat([startOf(frame, interval), ...data, next(1), ...data, next(2), ...data]);
        const level = (block: number) => [20, 19][block % interval] ?? 0;
        const shown = flat(range(0, high - 1).map(y => range(y * wide, (y + 1) * wide - 1).map(level)));
        return { name: `${interval}`, file, expected: pictureOf(shown) };
      }),
    );
  });

  test("the scan after a truncated one is decoded", async () => {
    const up = step(20);
    const file = Buffer.concat([startOf(rgb), up, next(1), next(2), up, up, up, next(2), step(16)]);
    expect(await outcome(file)).toBe(fine);
    expect(await rgbLevels(file)).toEqual([
      [20, -1, 16],
      [19, 0, 15],
      [0, 0, 60],
    ]);
  });
});
