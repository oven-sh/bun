// Lossless frames.
import { expect, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import {
  bytes,
  decode,
  difference,
  expectPictures,
  fine,
  grouped,
  headerOnly,
  hex,
  outcome,
  pictureFrom,
  range,
  refused,
} from "./decode";
import { pictureOf } from "./model";
import {
  adobe,
  all,
  as,
  coded,
  copyOf,
  dht,
  dri,
  frameOf,
  groupsOf,
  jfif,
  jpeg,
  marker,
  noise,
  predict,
  random16,
  rgbIds,
  rst,
  scanOf,
  sof,
  SOF11,
  SOF3,
  sos,
  Symbols,
  tableOf,
  TEM,
  withRestarts,
  write,
  type Frame,
  type Scan,
} from "./write";

const type = SOF3;
const three = "1x1,1x1,1x1";
const lossless = (components: number[], predictor = 1, al = 0, more: Partial<Scan> = {}) =>
  scanOf(components, predictor, 0, 0, al, { dc: components, ...more });
/** Clears the `al[c]` low bits of component `c`. */
function shifted(frame: Frame, al: number[]) {
  const out = copyOf(frame);
  out.components.forEach(({ data }, c) => data.forEach((sample, i) => (data[i] = (sample >> al[c]) << al[c])));
  return out;
}

test("every predictor, precision from 2 to 8 and point transform", async () => {
  const random = randomBytes(1);
  await expectPictures(
    range(2, 8).flatMap(precision => {
      const frame = noise(frameOf(7, 5, three, { type, precision }), random);
      return range(0, precision - 1).flatMap(al => {
        // Samples are not scaled to 8 bits.
        const expected = pictureOf(shifted(frame, [al, al, al]));
        const predictors = range(1, 7).filter(predictor => !slow || (predictor + al) % 2);
        return predictors.map(predictor => ({
          name: `precision ${precision}, Al ${al}, predictor ${predictor}`,
          file: write(frame, [lossless([0, 1, 2], predictor, al, { dc: [0, 0, 0] })]),
          expected,
        }));
      });
    }),
  );
});

test("precision 9 to 16 only has metadata", async () => {
  const file = write(frameOf(2, 2, three, { type }));
  const at = file.indexOf(marker(type)) + 4;
  expect(await grouped(bytes, precision => outcome(file.with(at, precision)))).toEqual({
    [refused]: [0, 1, ...range(17, 255)],
    [fine]: range(2, 8),
    [headerOnly]: range(9, 16),
  });
});

test("three components are RGB whatever their ids, and gray, YCbCr and YCCK only have metadata", async () => {
  const of = (sampling: string, ids: number[], ...before: Buffer[]) =>
    outcome(write(frameOf(2, 2, sampling, { type, ids }), undefined, { before }));
  for (const ids of [[1, 2, 3], rgbIds, [0, 1, 2]]) {
    expect([await of(three, ids), await of(three, ids, adobe(0))]).toEqual([fine, fine]);
    for (const app of [jfif, adobe(1), adobe(2)]) expect(await of(three, ids, app)).toBe(headerOnly);
  }
  expect(await of("1x1", [1])).toBe(headerOnly);
  const cmyk = noise(frameOf(9, 3, "1x1,1x1,1x1,1x1", { type }), randomBytes(2));
  await expectPictures(
    [[], [adobe(0)], [jfif]].map(before => ({
      name: "CMYK",
      file: write(cmyk, undefined, { before }),
      expected: pictureOf(cmyk),
    })),
  );
  for (const transform of [1, 2]) expect(await of("1x1,1x1,1x1,1x1", [1, 2, 3, 4], adobe(transform))).toBe(headerOnly);
});

test("SOF11 only has metadata", async () => {
  const frame = as(SOF11, frameOf(2, 2, three, { type }));
  expect(await outcome(jpeg(sof(frame), dht(0, tableOf([0], [1])), sos(frame, scanOf([0, 1, 2], 1, 0))))).toBe(
    headerOnly,
  );
});

const small = frameOf(2, 2, three, { type, precision: 5 });
const none = dht(2, tableOf([0], [1]));
const [zeros, twos] = [0, 2].map(number => ({ dc: Array(3).fill(number) }));

test("Ss is 1 to 7, Se and Ah are 0, and Al is below the precision", async () => {
  const some = [...range(0, 17), 63, 255];
  // In the only scan, in a later one, and in a repeated one.
  for (const [components, ...before] of [[[0, 1, 2]], [[2], [0, 1]], [[2], [0, 1], [2]]]) {
    const start = [sof(small), none, ...before.map(group => sos(small, lossless(group, 1, 0, twos)))];
    const of = (ss: number, se: number, both: number) =>
      outcome(jpeg(...start, sos(small, scanOf(components, ss, se, both >> 4, both & 15, twos))));
    expect((await grouped(some, ss => of(ss, 0, 0)))[fine]).toEqual(range(1, 7));
    expect((await grouped(some, se => of(1, se, 0)))[fine]).toEqual([0]);
    expect((await grouped(some, both => of(1, 0, both)))[fine]).toEqual(range(0, 4));
  }
  for (const precision of [2, 7, 8]) {
    const of = (al: number) =>
      outcome(jpeg(sof({ ...small, precision }), none, sos(small, lossless([0, 1, 2], 1, al, twos))));
    expect((await grouped(range(0, 15), of))[fine]).toEqual(range(0, precision - 1));
  }
});

test("there are no default Huffman tables, and neither AC nor quantization tables are needed", async () => {
  const header = sos(small, lossless([0, 1, 2], 1, 0, twos));
  const some = bytes.filter(both => both % 5 === 0 || both >> 4 === 2);
  expect((await grouped(some, both => outcome(jpeg(sof(small), none, header.with(8, both))), hex))[fine]).toBe(
    hex(range(0x20, 0x2f)),
  );
  const named = { ...small, components: small.components.map(c => ({ ...c, table: 255 })) };
  expect(await outcome(jpeg(sof(named), none, header))).toBe(fine);
  const complete = [[0, 1], [2]].map(group => sos(small, lossless(group, 1, 0, twos)));
  const repeated = (dc: number) =>
    outcome(jpeg(sof(small), none, ...complete, sos(small, lossless([2], 1, 0, { dc: [dc] }))));
  expect(await grouped(range(0, 3), repeated)).toEqual({ [headerOnly]: [0, 1, 3], [fine]: [2] });
});

test("categories go up to 16, which is 32768 without extra bits", async () => {
  const withSymbol = (symbol: number) =>
    outcome(jpeg(sof(small), dht(2, tableOf([0, symbol], [1, 2])), sos(small, lossless([0, 1, 2], 1, 0, twos))));
  expect((await grouped(range(0, 32), withSymbol))[fine]).toEqual(range(0, 16));

  // Samples wrap at 16 bits, and the low 8 are output. Predictors 5 to 7 shift higher bits down.
  const frame = frameOf(40, 6, three, { type });
  const random = randomBytes(3);
  for (const { data } of frame.components) {
    data.forEach((_, i) => (data[i] = random16(random) >> (random() % 16)));
    data.set([128 + 32768, 128, 128 + 32768]);
  }
  await expectPictures(
    range(1, 7).flatMap(predictor => {
      const scan = lossless([0, 1, 2], predictor);
      return { name: `${predictor}`, file: write(frame, [scan]), expected: pictureOf(frame) };
    }),
  );
});

test.each([
  ["3, 15, 16, 31 and 3", [1, 8, 9, 15, 16], [2, 7, 7, 16, 3], [1, 8, 8, 8, 8, 9, 15, 15, 15, 16]],
  ["15 to 25", range(5, 15), Array(11).fill(10), [5, 5, 5, 5, 5, 5, ...range(5, 15), 15, 15]],
  ["16, 18, 15, 17, 19 and 15", [15, 14, 10, 12, 13, 8], [1, 4, 5, 5, 6, 7], [15, 14, 10, 10, 12, 13, 8, 8, 8]],
])("codes that take %s bits with their extra bits, in any order", async (_, sizes, lengths, often) => {
  const frame = frameOf(1500, 1, three, { type });
  const random = randomBytes(10);
  for (const { data } of frame.components) {
    data.forEach((_, i) => {
      const size = often[random() % often.length];
      const magnitude = (1 << (size - 1)) | (size < 16 ? random16(random) >> (17 - size) : 0);
      data[i] = ((i ? data[i - 1] : 128) + (random() & 1 ? magnitude : -magnitude)) & 0xffff;
    });
  }
  const file = write(frame, [scanOf(all(frame), 1, 0)], { tables: { 0: tableOf(sizes, lengths) } });
  await expectPictures([{ name: "all", file, expected: pictureOf(frame) }]);
});

test("components can be in one scan or in several, each with its own predictor and point transform", async () => {
  const frame = noise(frameOf(9, 7, three, { type }), randomBytes(4));
  await expectPictures(
    ["0 1 2", "2 1 0", "01 2", "1 02", "21 0", "1 012"].map(name => {
      const scans = groupsOf(name).map((group, i) => lossless(group, 7 - i, i));
      const al = all(frame).map(c => scans.findLast(scan => scan.components.includes(c))!.al);
      return { name, file: write(frame, scans), expected: pictureOf(shifted(frame, al)) };
    }),
  );
});

test("every component needs a scan", async () => {
  const layouts = ["0", "01", "12", "0 2", "0 0 0", "0 1 2"];
  for (const frame of [small, frameOf(2, 1, three, { type })]) {
    const of = (name: string) =>
      outcome(
        write(
          frame,
          groupsOf(name).map(group => lossless(group)),
        ),
      );
    expect(await grouped(layouts, of)).toEqual({ [headerOnly]: layouts.slice(0, 5), [fine]: layouts.slice(5) });
  }
  const four = frameOf(2, 1, "1x1,1x1,1x1,1x1", { type });
  const without = (c: number) =>
    outcome(write(four, [lossless(all(four).filter(other => other !== c)), lossless([c ? 0 : 1])]));
  expect(await grouped(all(four), without)).toEqual({ [headerOnly]: all(four) });
  expect(await outcome(write(small, [lossless([0, 1, 2]), lossless([0])]))).toBe(headerOnly);
  const apart = write(small, [lossless([0]), lossless([1, 2])]);
  expect(await outcome(jpeg(apart.subarray(2, -2), marker(0xf0)))).toBe(headerOnly);
});

test("subsampled components are upsampled by repetition", async () => {
  const random = randomBytes(5);
  await expectPictures(
    ["2x1,1x1,1x1", "1x2,1x1,1x1", "2x2,1x1,1x1", "4x2,1x1,1x1", "1x1,3x1,1x2", "2x2,2x1,1x2", "1x4,1x2,1x1"].flatMap(
      sampling =>
        range(1, 9).flatMap(width => {
          const frame = noise(frameOf(width, 10 - width, sampling, { type }), random);
          const expected = pictureOf(frame);
          const predictor = 1 + (width % 7);
          return [
            { name: `${sampling}, ${width}`, file: write(frame, [lossless([0, 1, 2], predictor)]), expected },
            {
              name: `${sampling}, ${width}, apart`,
              file: write(
                frame,
                [0, 1, 2].map(c => lossless([c], predictor)),
              ),
              expected,
            },
          ];
        }),
    ),
  );
  const samplings = ["3x1,2x1,1x1", "2x2,2x2,2x2"];
  expect(await grouped(samplings, sampling => outcome(write(frameOf(4, 4, sampling, { type }))))).toEqual({
    [headerOnly]: samplings,
  });
});

test.each<[string, string[]]>([
  ["2x2,1x1,1x1", ["01 2", "12 0", "1 02"]],
  ["1x2,2x1,1x1", ["01 2", "0 12", "02 1"]],
  ["1x1,1x3,3x1", ["01 2", "12 0", "02 1"]],
  ["4x1,2x1,1x4", ["01 2", "0 21", "1 02"]],
  ["2x2,2x2,2x2", ["01 2", "12 0", "0 1 2"]],
  ["2x1,1x1,1x2,2x2", ["03 12", "012 3", "2 013"]],
])("subsampled components in several scans, at small sizes: %s", async (sampling, layouts) => {
  const random = randomBytes(11);
  const sides = [1, 2, 3, 5, 7, 8, 13];
  const sizes = sides.flatMap(width => sides.map(height => [width, height]));
  await expectPictures(
    sizes.flatMap(([width, height], i) => {
      const frame = noise(frameOf(width, height, sampling, { type }), random);
      const expected = pictureOf(frame);
      return layouts
        .filter((_, nth) => !slow || (i + nth) % 3 === 0)
        .map(layout => {
          const scans = groupsOf(layout).map((group, nth) => lossless(group, 1 + ((i + nth) % 7)));
          return { name: `${width} by ${height}, ${layout}`, file: write(frame, scans), expected };
        });
    }),
  );
});

test("rows of any length", async () => {
  const random = randomBytes(6);
  await expectPictures(
    [...range(1, 70), 127, 128, 129, 255, 256, 257, 2001].map(width => {
      const frame = noise(frameOf(width, 2, width & 1 ? three : "1x1,1x1,1x1,1x1", { type }), random);
      const tables = { 0: tableOf(range(0, 9), Array(10).fill(4)) };
      return {
        name: `${width}`,
        file: write(frame, [scanOf(all(frame), 4, 0)], { tables }),
        expected: pictureOf(frame),
      };
    }),
  );
});

test.each(["012", "0 1 2"])("very wide and very tall images, in scans of %s", async layout => {
  const [some, length] = [20, slow ? 8200 : 65500];
  const row = noise(frameOf(some, 1, three, { type }), randomBytes(12));
  // Each difference takes two bytes, and the row ends with 128, the initial prediction. So the data can repeat.
  const tables = { 0: tableOf(range(0, 8), range(8, 16).toReversed()) };
  for (const { data } of row.components) data[some - 1] = 128;
  const scans = groupsOf(layout).map(group => coded(row, scanOf(group, 1, 0, 0, 0, zeros), tables));
  const of = (width: number, height: number, interval = width * height) => {
    const parts = scans.flatMap(({ header, data }) => {
      const each = Buffer.alloc((data.length * interval) / some, data);
      return [header, ...withRestarts<Buffer>(Array((width * height) / interval).fill(each))];
    });
    return {
      name: `${width} by ${height}, ${interval}`,
      file: jpeg(sof({ ...row, width, height }), dht(0, tables[0]), dri(interval), ...parts),
      expected: { width, height, rgba: Buffer.alloc(width * height * 4, pictureOf(row).rgba) },
    };
  };
  await expectPictures([of(length, 3, length), of(1, length), of(1, length, length / 5)]);
});

test("a restart interval is whole rows of MCUs, and its first row is predicted like the first of the scan", async () => {
  const frame = noise(frameOf(6, 21, "2x2,1x1,1x1", { type }), randomBytes(7));
  const expected = pictureOf(frame);
  await expectPictures(
    range(1, 7).flatMap(rows => [
      { name: `${rows}`, file: write(frame, [lossless([0, 1, 2], rows, 0, { interval: rows * 3 })]), expected },
      {
        name: `${rows}, apart`,
        file: write(frame, [
          lossless([0], rows, 0, { interval: rows * 2 * 6 }),
          lossless([1], rows, 0, { interval: rows * 3 }),
          lossless([2], rows),
        ]),
        expected,
      },
    ]),
  );
  const together = (interval: number) => outcome(write(frame, [lossless([0, 1, 2], 1, 0, { interval })]));
  expect((await grouped(range(1, 12), together))[fine]).toEqual([3, 6, 9, 12]);
  for (const earlier of [[], [lossless([0])]]) {
    const later = (interval: number) =>
      outcome(write(frame, [...earlier, lossless([1, 2]), lossless([0], 1, 0, { interval })]));
    expect((await grouped([3, 11, 12, 13], later))[fine]).toEqual([12]);
  }
});

test("in a scan of one component, a restart interval can be any number of rows, whatever V is", async () => {
  const random = randomBytes(9);
  await expectPictures(
    ["1x2,1x1,1x1", "2x4,1x1,1x2", "1x3,1x1,1x1"].flatMap(sampling => {
      const frame = noise(frameOf(6, 13, sampling, { type }), random);
      const expected = pictureOf(frame);
      return range(1, 5).map(rows => ({
        name: `${sampling}, ${rows}`,
        file: write(
          frame,
          frame.components.map(({ wide }, c) => lossless([c], 2 + rows, 0, { interval: rows * wide })),
        ),
        expected,
      }));
    }),
  );
});

/** The codes 0, 10 and 110 are the categories 1, 2 and 0. So 1011 is a difference of 3, and 00 one of -1. */
async function reds(interval: number, al: number, ...data: (Buffer | number[])[]) {
  const frame = frameOf(2, 4, three, { type });
  const others = new Symbols();
  const table = tableOf([1, 2, 0], [1, 2, 3]);
  for (let i = 0; i < 16; i++) others.symbol(0, 0);
  const scans = [
    sos(frame, scanOf([1, 2], 1, 0)),
    others.bytes({ 0: table }),
    dri(interval),
    sos(frame, scanOf([0], 2, 0, 0, al)),
  ];
  const { rgba } = await decode(jpeg(sof(frame), dht(0, table), ...scans, ...data));
  return range(0, 7).map(i => rgba[i * 4] - 128);
}
const threes = [0b1011_1011];

test("truncated data: the current row is decoded from zeros, and later rows are 128", async () => {
  expect(await reds(0, 0, threes, threes, threes, threes)).toEqual([3, 6, 6, 9, 9, 12, 12, 15]);
  expect(await reds(0, 0, threes, threes)).toEqual([3, 6, 6, 9, 5, 8, 0, 0]);
  expect(await reds(0, 0, [0b1011_01_10], [0b11_1011_10])).toEqual([3, 4, 6, 7, 3, 6, 0, 0]);
  expect(await reds(0, 0)).toEqual([-1, -2, 0, 0, 0, 0, 0, 0]);
  expect(await reds(0, 2, threes)).toEqual([12, 24, 8, 20, 0, 0, 0, 0]);
});

test("truncated data: zeros decode by the table of each component", async () => {
  const frame = frameOf(50, 2, three, { type });
  const sizes = [1, 2, 0];
  frame.components.forEach(({ data }, c) =>
    data.forEach((_, i) => (data[i] = i < 50 ? (128 - (i + 1) * ((1 << sizes[c]) - 1)) & 255 : 128)),
  );
  const tables = sizes.map((size, c) => dht(c, tableOf([size], [1 + c])));
  await expectPictures(
    [0, 1, 20].map(length => ({
      name: `${length}`,
      file: jpeg(sof(frame), ...tables, sos(frame, lossless([0, 1, 2])), Buffer.alloc(length)),
      expected: pictureOf(frame),
    })),
  );
});

test("truncated data: differences from zeros keep all 16 bits", async () => {
  const frame = frameOf(50, 2, three, { type });
  const sizes = [9, 12, 15];
  frame.components.forEach(({ data }, c) =>
    data.forEach((_, i) => {
      const predicted = i > 50 ? predict(7, data[i - 1], data[i - 50], 0) : i ? data[i % 50 ? i - 1 : 0] : 128;
      data[i] = (predicted + 1 - (1 << sizes[c])) & 0xffff;
    }),
  );
  const tables = sizes.map((size, c) => dht(c, tableOf([size], [1])));
  // A row takes 50 times 39 bits.
  await expectPictures(
    [244, 250, 300, 488].map(length => ({
      name: `${length}`,
      file: jpeg(sof(frame), ...tables, sos(frame, lossless([0, 1, 2], 7)), Buffer.alloc(length)),
      expected: pictureOf(frame),
    })),
  );
});

test("restart markers out of sequence", async () => {
  expect(await reds(2, 0, threes, rst(0), threes, [1, 2], rst(1), threes, rst(2), threes)).toEqual([
    3, 6, 3, 6, 3, 6, 3, 6,
  ]);
  expect(await reds(2, 0, threes, rst(2), threes)).toEqual([3, 6, -1, -2, 0, 0, 3, 6]);
  expect(await reds(2, 0, threes, rst(7), [0], rst(0), threes, rst(5), threes)).toEqual([3, 6, 3, 6, 3, 6, -1, -2]);
  expect(await reds(4, 0, rst(0), threes, threes)).toEqual([-1, -2, 0, 0, 3, 6, 6, 9]);
});

test("the marker after the last restart interval is not skipped", async () => {
  const frame = frameOf(2, 4, three, { type });
  const file = write(frame, [lossless([0, 1, 2], 1, 0, { interval: 4 })]);
  const ending = (code: number) => outcome(jpeg(file.subarray(2, -2), marker(code)));
  expect(await grouped([TEM, 0x02, 0xbf], ending)).toEqual({ [fine]: [TEM], [headerOnly]: [0x02, 0xbf] });
});

test("an invalid code takes 17 bits and decodes as category 0", async () => {
  expect(await reds(0, 0, [0xe0, 0, 0b0_1011_101, 0b1_1011_110])).toEqual([0, 3, 3, 6, 3, 5, 0, 0]);
});

test("resize() decodes at full size", async () => {
  const frame = noise(frameOf(32, 16, three, { type }), randomBytes(8));
  const file = write(frame);
  const whole = await new Bun.Image(file).png().bytes();
  for (const [width, height] of [
    [16, 8],
    [4, 2],
    [1, 1],
  ]) {
    const [actual, expected] = await Promise.all(
      [file, whole].map(from => pictureFrom(new Bun.Image(from).resize(width, height))),
    );
    expect(difference(actual, expected)).toBeUndefined();
  }
});
