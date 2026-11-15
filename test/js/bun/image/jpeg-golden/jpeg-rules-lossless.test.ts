// The rules for lossless frames.
import { expect, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import {
  bytes,
  decode,
  difference,
  expectPictures,
  fine,
  headerOnly,
  hex,
  outcome,
  pictureFrom,
  range,
  refused,
  where,
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
  jfif,
  jpeg,
  marker,
  noise,
  predict,
  RST0,
  scanOf,
  sof,
  SOF11,
  SOF3,
  sos,
  Symbols,
  tableOf,
  write,
  type Frame,
  type Scan,
} from "./write";

const type = SOF3;
const three = "1x1,1x1,1x1";
const lossless = (components: number[], predictor = 1, al = 0, more: Partial<Scan> = {}) =>
  scanOf(components, predictor, 0, 0, al, { dc: components, ...more });
/** Without the `al` lowest bits of each component. */
function shifted(frame: Frame, al: number[]) {
  const out = copyOf(frame);
  out.components.forEach(({ data }, c) => data.forEach((sample, i) => (data[i] = (sample >> al[c]) << al[c])));
  return out;
}

test("every predictor, with samples of 2 to 8 bits and any number of them left out", async () => {
  const random = randomBytes(1);
  await expectPictures(
    range(2, 8).flatMap(precision => {
      const frame = noise(frameOf(7, 5, three, { type, precision }), random);
      return range(0, precision - 1).flatMap(al => {
        // They are not scaled to 8 bits.
        const expected = pictureOf(shifted(frame, [al, al, al]));
        const predictors = range(1, 7).filter(predictor => !slow || (predictor + al) % 2);
        return predictors.map(predictor => ({
          name: `${precision} bits but for ${al}, predictor ${predictor}`,
          file: write(frame, [lossless([0, 1, 2], predictor, al, { dc: [0, 0, 0] })]),
          expected,
        }));
      });
    }),
  );
});

test("of 9 to 16 bits the size can be had", async () => {
  const file = write(frameOf(2, 2, three, { type }));
  const at = file.indexOf(marker(type)) + 4;
  expect(await where(bytes, precision => outcome(file.with(at, precision)))).toEqual({
    [refused]: [0, 1, ...range(17, 255)],
    [fine]: range(2, 8),
    [headerOnly]: range(9, 16),
  });
});

test("three components are RGB whatever their names, and colors are not converted", async () => {
  const of = (sampling: string, ids: number[], ...before: Buffer[]) =>
    outcome(write(frameOf(2, 2, sampling, { type, ids }), undefined, { before }));
  for (const ids of [
    [1, 2, 3],
    [82, 71, 66],
    [0, 1, 2],
  ]) {
    expect([await of(three, ids), await of(three, ids, adobe(0))]).toEqual([fine, fine]);
    for (const said of [jfif, adobe(1), adobe(2)]) expect(await of(three, ids, said)).toBe(headerOnly);
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

test("with arithmetic coding, only the size can be had", async () => {
  const frame = as(SOF11, frameOf(2, 2, three, { type }));
  expect(await outcome(jpeg(sof(frame), dht(0, tableOf([0], [1])), sos(frame, scanOf([0, 1, 2], 1, 0))))).toBe(
    headerOnly,
  );
});

const small = frameOf(2, 2, three, { type, precision: 5 });
const none = dht(2, tableOf([0], [1]));
const [zeros, twos] = [0, 2].map(number => ({ dc: Array(3).fill(number) }));

test("the predictor is 1 to 7, a bit has to be left, and the other fields are 0", async () => {
  const some = [...range(0, 17), 63, 255];
  // In the only scan, in a later one, and in one that the picture could do without.
  for (const [components, ...before] of [[[0, 1, 2]], [[2], [0, 1]], [[2], [0, 1], [2]]]) {
    const start = [sof(small), none, ...before.map(group => sos(small, lossless(group, 1, 0, twos)))];
    const of = (ss: number, se: number, both: number) =>
      outcome(jpeg(...start, sos(small, scanOf(components, ss, se, both >> 4, both & 15, twos))));
    expect((await where(some, ss => of(ss, 0, 0)))[fine]).toEqual(range(1, 7));
    expect((await where(some, se => of(1, se, 0)))[fine]).toEqual([0]);
    expect((await where(some, both => of(1, 0, both)))[fine]).toEqual(range(0, 4));
  }
  for (const precision of [2, 7, 8]) {
    const of = (al: number) =>
      outcome(jpeg(sof({ ...small, precision }), none, sos(small, lossless([0, 1, 2], 1, al, twos))));
    expect((await where(range(0, 15), of))[fine]).toEqual(range(0, precision - 1));
  }
});

test("there are no typical tables, and none for AC coefficients or for quantization is needed", async () => {
  const header = sos(small, lossless([0, 1, 2], 1, 0, twos));
  const some = bytes.filter(both => both % 5 === 0 || both >> 4 === 2);
  expect((await where(some, both => outcome(jpeg(sof(small), none, header.with(8, both))), hex))[fine]).toBe(
    hex(range(0x20, 0x2f)),
  );
  const named = { ...small, components: small.components.map(c => ({ ...c, table: 255 })) };
  expect(await outcome(jpeg(sof(named), none, header))).toBe(fine);
});

test("a difference has up to 16 bits, and 32768 takes no more than its code", async () => {
  const withSymbol = (symbol: number) =>
    outcome(jpeg(sof(small), dht(2, tableOf([0, symbol], [1, 2])), sos(small, lossless([0, 1, 2], 1, 0, twos))));
  expect((await where(range(0, 32), withSymbol))[fine]).toEqual(range(0, 16));

  // Sums are of 16 bits, of which the low 8 show. The predictors that halve bring down the ninth.
  const frame = frameOf(40, 6, three, { type });
  const random = randomBytes(3);
  for (const { data } of frame.components) {
    data.forEach((_, i) => (data[i] = ((random() << 8) | random()) >> (random() % 16)));
    data.set([128 + 32768, 128, 128 + 32768]);
  }
  await expectPictures(
    range(1, 7).flatMap(predictor => {
      const scan = lossless([0, 1, 2], predictor);
      return { name: `${predictor}`, file: write(frame, [scan]), expected: pictureOf(frame) };
    }),
  );
});

test("long and short codes in any order", async () => {
  // With the bits that follow them, they take 3, 15, 16, 31 and 3 bits.
  const [sizes, lengths] = [
    [1, 8, 9, 15, 16],
    [2, 7, 7, 16, 3],
  ];
  const often = [1, 8, 8, 8, 8, 9, 15, 15, 15, 16];
  const frame = frameOf(1500, 1, three, { type });
  const random = randomBytes(10);
  for (const { data } of frame.components) {
    data.forEach((_, i) => {
      const size = often[random() % often.length];
      const magnitude = (1 << (size - 1)) | (size < 16 ? ((random() << 8) | random()) >> (17 - size) : 0);
      data[i] = ((i ? data[i - 1] : 128) + (random() & 1 ? magnitude : -magnitude)) & 0xffff;
    });
  }
  const file = write(frame, [scanOf(all(frame), 1, 0)], { tables: { 0: tableOf(sizes, lengths) } });
  await expectPictures([{ name: "all", file, expected: pictureOf(frame) }]);
});

test("components can be in one scan or in several, each with its own predictor and shift", async () => {
  const frame = noise(frameOf(9, 7, three, { type }), randomBytes(4));
  await expectPictures(
    ["0 1 2", "2 1 0", "01 2", "1 02", "21 0", "1 012"].map(name => {
      const scans = name.split(" ").map((group, i) => lossless([...group].map(Number), 7 - i, i));
      const al = all(frame).map(c => scans.findLast(scan => scan.components.includes(c))!.al);
      return { name, file: write(frame, scans), expected: pictureOf(shifted(frame, al)) };
    }),
  );
});

test("but each has to be in one", async () => {
  const layouts = ["0", "01", "12", "0 2", "0 0 0", "0 1 2"];
  for (const frame of [small, frameOf(2, 1, three, { type })]) {
    const of = (name: string) =>
      outcome(
        write(
          frame,
          name.split(" ").map(group => lossless([...group].map(Number))),
        ),
      );
    expect(await where(layouts, of)).toEqual({ [headerOnly]: layouts.slice(0, 5), [fine]: layouts.slice(5) });
  }
  const four = frameOf(2, 1, "1x1,1x1,1x1,1x1", { type });
  const without = (c: number) =>
    outcome(write(four, [lossless(all(four).filter(other => other !== c)), lossless([c ? 0 : 1])]));
  expect(await where(all(four), without)).toEqual({ [headerOnly]: all(four) });
  expect(await outcome(write(small, [lossless([0, 1, 2]), lossless([0])]))).toBe(headerOnly);
  const apart = write(small, [lossless([0]), lossless([1, 2])]);
  expect(await outcome(jpeg(apart.subarray(2, -2), marker(0xf0)))).toBe(headerOnly);
});

test("samples that stand for several pixels are repeated", async () => {
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
  expect(await where(samplings, sampling => outcome(write(frameOf(4, 4, sampling, { type }))))).toEqual({
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
])("some of the components in one scan and some in another, at any size: %s", async (sampling, layouts) => {
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
          const scans = layout.split(" ").map((group, nth) => lossless([...group].map(Number), 1 + ((i + nth) % 7)));
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

test.each(["012", "0 1 2"])("thousands of samples across or down, in scans of %s", async layout => {
  const [some, length] = [20, slow ? 8200 : 65500];
  const row = noise(frameOf(some, 1, three, { type }), randomBytes(12));
  // Two bytes for each difference, and at the end the sample that the first is predicted from. So the data can repeat.
  const tables = { 0: tableOf(range(0, 8), range(8, 16).toReversed()) };
  for (const { data } of row.components) data[some - 1] = 128;
  const scans = layout.split(" ").map(group => coded(row, scanOf([...group].map(Number), 1, 0, 0, 0, zeros), tables));
  const of = (width: number, height: number, interval = width * height) => {
    const parts = scans.flatMap(({ header, data }) => {
      const each = Buffer.alloc((data.length * interval) / some, data);
      const more = range(2, (width * height) / interval);
      return [header, each, ...more.flatMap(n => [marker(RST0 + ((n - 2) & 7)), each])];
    });
    return {
      name: `${width} by ${height}, ${interval}`,
      file: jpeg(sof({ ...row, width, height }), dht(0, tables[0]), dri(interval), ...parts),
      expected: { width, height, rgba: Buffer.alloc(width * height * 4, pictureOf(row).rgba) },
    };
  };
  await expectPictures([of(length, 3, length), of(1, length), of(1, length, length / 5)]);
});

test("restart markers come after whole rows, and the next row is predicted like the first", async () => {
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
  expect((await where(range(1, 12), together))[fine]).toEqual([3, 6, 9, 12]);
  const later = (interval: number) => outcome(write(frame, [lossless([1, 2]), lossless([0], 1, 0, { interval })]));
  expect((await where([3, 11, 12, 13], later))[fine]).toEqual([12]);
});

test("in a scan of its own, a component has rows like any other, whatever its sampling factors", async () => {
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

/** Of the first component. A zero is followed by one bit, so zeros count down. 10 is followed by two, and 110 is 0. */
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

test("where the data ends, the row that has begun is read from zeros, and the others are in the middle", async () => {
  expect(await reds(0, 0, threes, threes, threes, threes)).toEqual([3, 6, 6, 9, 9, 12, 12, 15]);
  expect(await reds(0, 0, threes, threes)).toEqual([3, 6, 6, 9, 5, 8, 0, 0]);
  expect(await reds(0, 0, [0b1011_01_10], [0b11_1011_10])).toEqual([3, 4, 6, 7, 3, 6, 0, 0]);
  expect(await reds(0, 0)).toEqual([-1, -2, 0, 0, 0, 0, 0, 0]);
  expect(await reds(0, 2, threes)).toEqual([12, 24, 8, 20, 0, 0, 0, 0]);
});

test("so it is in a longer row, by the table of each component", async () => {
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

test("and in a later row, with all bits of the differences", async () => {
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

test("restart markers that are out of turn", async () => {
  const rst = (number: number) => marker(RST0 + number);
  expect(await reds(2, 0, threes, rst(0), threes, [1, 2], rst(1), threes, rst(2), threes)).toEqual([
    3, 6, 3, 6, 3, 6, 3, 6,
  ]);
  expect(await reds(2, 0, threes, rst(2), threes)).toEqual([3, 6, -1, -2, 0, 0, 3, 6]);
  expect(await reds(2, 0, threes, rst(7), [0], rst(0), threes, rst(5), threes)).toEqual([3, 6, 3, 6, 3, 6, -1, -2]);
  expect(await reds(4, 0, rst(0), threes, threes)).toEqual([-1, -2, 0, 0, 3, 6, 6, 9]);
});

test("what is no code takes 17 bits, and stands for 0", async () => {
  expect(await reds(0, 0, [0xe0, 0, 0b0_1011_101, 0b1_1011_110])).toEqual([0, 3, 3, 6, 3, 5, 0, 0]);
});

test("is decoded at its size, and then resized", async () => {
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
