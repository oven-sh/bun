// The largest numbers of blocks in a row, of bits, of scans and of components.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "../png-golden/write";
import { ArithmeticCoder } from "./arithmetic";
import { colorMarkers, expectPictures, headerOnly, outcome, range } from "./decode";
import { known, pictureOf, scaled } from "./model";
import {
  all,
  bitByBit,
  coded,
  dri,
  frameOf,
  groupsOf,
  headerOf,
  isLossless,
  isProgressive,
  jpeg,
  noise,
  progressiveTypes,
  random16,
  scanOf,
  scanWithTables,
  simpleProgression,
  SOF0,
  SOF10,
  SOF2,
  SOF3,
  SOF9,
  sos,
  stuffed,
  withRestarts,
  write,
} from "./write";

describe.each([
  ["sequential", SOF0, [scanOf([0, 1, 2])]],
  ["sequential, in two scans", SOF0, [scanOf([0]), scanOf([1, 2])]],
  ["progressive", SOF2, simpleProgression],
  ["sequential, arithmetic", SOF9, [scanOf([0, 1, 2])]],
  ["progressive, arithmetic", SOF10, simpleProgression],
])("8188 MCUs, in restart intervals of 356: %s", (name, type, scans) => {
  const [interval, count, length, eighths] = [356, 23, 65500, 2];
  const [row, column] = [frameOf(interval * 8, 8, "1x1,1x1,1x1", { type }), frameOf(8, interval * 8, "1x1,1x1,1x1")];
  noise(row, randomBytes(1), { sparse: 20, ac: 60 });
  column.components.forEach((component, c) => (component.data = row.components[c].data));
  const parts = scans.flatMap(scan => {
    const { tables, header, data } = coded(row, scan);
    return [...tables, header, ...withRestarts<Buffer>(Array(count).fill(data))];
  });
  const fileOf = (width: number, height: number) => jpeg(headerOf({ ...row, width, height }), dri(interval), ...parts);
  const long = scaled(length, eighths);

  test("across", async () => {
    const { width, rgba } = pictureOf(row, { eighths });
    const lines = range(0, eighths - 1).map(y =>
      Buffer.alloc(long * 4, rgba.subarray(y * width * 4, (y + 1) * width * 4)),
    );
    const expected = { width: long, height: eighths, rgba: Buffer.concat(lines) };
    await expectPictures([{ name, file: fileOf(length, 8), eighths, expected }]);
  });

  test("down", async () => {
    const rgba = Buffer.alloc(long * eighths * 4, pictureOf(column, { eighths }).rgba);
    await expectPictures([
      { name, file: fileOf(8, length), eighths, expected: { width: eighths, height: long, rgba } },
    ]);
  });
});

test.each(progressiveTypes)("successive approximation of 16-bit coefficients: %s", async (_, type) => {
  // Odd values of every size, the last below -32768. With these steps, they dequantize to small values in 16 bits.
  const random = randomBytes(13);
  const sizes = range(0, 63).map(k => 1 << (14 - ((k * 7) % 15)));
  const values = sizes.map(size => size | (random16(random) & (size - 1)) | 1).with(63, 32769);
  const steps = values.map(value => range(1, 32767).find(step => ((value * step + 24) & 0xffff) < 48 && step & 8)!);
  const frame = frameOf(40, 8, "1x1", { type, tables: [steps] });
  const { data } = frame.components[0];
  data.forEach((_, i) => (data[i] = [values[i % 64], -values[i % 64], 0][i % 64 === 63 ? 1 : random() % 3]));
  const expected = pictureOf(frame);
  await expectPictures(
    [13, 14].map(missing => {
      const first = known(frame, [scanOf([0], 0, 63, 0, missing)]);
      const band = (ss: number, se: number) =>
        bitByBit(missing, [0], ss, se).flatMap((scan, i) =>
          i ? scanWithTables(frame, scan) : scanWithTables(first, { ...scan, al: 13 }),
        );
      const file = jpeg(headerOf(frame), ...band(0, 0), ...band(1, 20), ...band(21, 63));
      return { name: `from Ah = ${missing}`, file, expected };
    }),
  );
});

test("arithmetic coding: coefficients after thousands of empty blocks", async () => {
  const [wide, high] = [64, 80];
  const random = randomBytes(2);
  const [top, bottom] = [0, 1].map(() => frameOf(wide * 8, 8, "1x1", { type: SOF10 }));
  top.components[0].data.fill(1, 1, 64);
  const [{ data }] = noise(bottom, random, { ac: 3, dc: 0 }).components;
  const frame = { ...top, height: high * 8 };
  const band = (ss: number, se: number, first: number, lastRow: Int32Array) => {
    const coder = new ArithmeticCoder();
    coder.band(0, new Int32Array(64).fill(first), ss, se, 0, 0);
    for (let i = 1; i < wide * (high - 1); i++) coder.decide(coder.ac(0), 3 * (ss - 1), 1);
    for (let i = 0; i < wide; i++) coder.band(0, lastRow.subarray(i * 64), ss, se, 0, 0);
    return [sos(frame, scanOf([0], ss, se)), stuffed(coder.finish())];
  };
  // The value in the first block shifts the rest of the data by some number of bits. The last scan overwrites it.
  const bands = range(1, 63).flatMap(k => band(k, k, 1 + (random16(random) >> (2 + (k % 14))), data));
  const file = jpeg(headerOf(frame), ...bands, ...band(1, 63, 1, new Int32Array(wide * 64)));
  const between = Buffer.alloc(wide * (high - 2) * 64 * 4, Buffer.from([128, 128, 128, 255]));
  const rgba = Buffer.concat([pictureOf(top).rgba, between, pictureOf(bottom).rgba]);
  await expectPictures([{ name: "64 scans", file, expected: { width: wide * 8, height: high * 8, rgba } }]);
});

test("arithmetic coding: a scan for every bit of seven coefficients of 128 by 128 blocks", async () => {
  const side = 128;
  const [frame, lastRow] = [side, 1].map(high => frameOf(side * 8, high * 8, "1x1", { type: SOF10 }));
  // These coefficients of a block are equal, so their AC bands have the same data.
  const [{ data }] = lastRow.components;
  for (let x = 0; x < side; x++) data.fill((x % 19) - 9, x * 64, x * 64 + 7);
  frame.components[0].data.set(data, (side - 1) * data.length);
  const dc = bitByBit(13, [0], 0, 0).map(scan => coded(frame, scan).data);
  const ac = bitByBit(13, [0], 1, 1).map(({ ah, al }) => {
    const coder = new ArithmeticCoder();
    for (let i = 0; i < side * (side - 1); i++) coder.decide(coder.ac(0), 0, 1);
    for (let x = 0; x < side; x++) coder.band(0, data.subarray(x * 64), 1, 1, ah, al);
    return stuffed(coder.finish());
  });
  const scans = range(0, 6).flatMap(k =>
    bitByBit(13, [0], k, k).flatMap((scan, i) => [sos(frame, scan), (k ? ac : dc)[i]]),
  );
  // With Al = 13, the first of the bands is empty.
  const file = jpeg(headerOf(frame), ...scans, sos(frame, scanOf([0], 7, 63)), ac[0]);
  const above = Buffer.alloc(side * (side - 1) * 64 * 4, Buffer.from([128, 128, 128, 255]));
  const expected = { ...frame, rgba: Buffer.concat([above, pictureOf(lastRow).rgba]) };
  await expectPictures([{ name: "99 scans", file, expected }]);
});

const kinds = [
  ["sequential", SOF0],
  ["progressive", SOF2],
  ["lossless", SOF3],
  ["sequential, arithmetic", SOF9],
  ["progressive, arithmetic", SOF10],
] as const;

test.each(kinds)("100 scans are decoded, 101 are refused: %s", async (name, type) => {
  const frame = noise(frameOf(16, 8, "1x1,1x1,1x1", { type }), randomBytes(4), { ac: 20 });
  const whole = (c: number) => (isLossless(frame) ? scanOf([c], 1, 0) : scanOf([c]));
  // The image is not complete before the last scan.
  const scans = (count: number) =>
    isProgressive(frame)
      ? [
          ...bitByBit(1, [0, 1, 2], 0, 0),
          ...[1, 2].map(c => scanOf([c], 1, 63)),
          ...range(1, 63).flatMap(k => bitByBit(k <= count - 67 ? 1 : 0, [0], k, k)),
        ]
      : [...range(2, count).map(i => whole(i & 1)), whole(2)];
  const [most, more] = [scans(100), scans(101)];
  expect([most.length, more.length]).toEqual([100, 101]);
  await expectPictures([{ name, file: write(frame, most), expected: pictureOf(frame) }]);
  expect(await outcome(write(frame, more))).toBe(headerOnly);
});

test.each(kinds)("each of four components has its own tables and sampling factors: %s", async (_, type) => {
  const random = randomBytes(9);
  const tables = range(1, 4).map(n => range(0, 63).map(k => n + (k % (n + 1))));
  const samplings = ["1x1,1x1,1x1,2x2", "2x1,2x1,2x1,1x1", "1x2,1x1,2x1,2x2", "2x2,1x1,2x1,1x2", "1x1,1x1,1x1,1x4"];
  const numbers = ["3210 2301", "3210 1111", "2222 3210"].map(groupsOf);
  await expectPictures(
    samplings.flatMap((sampling, i) => {
      const frame = noise(frameOf(37, 21, sampling, { type, tables }), random, { sparse: 3, ac: 40 });
      const colors = !isLossless(frame) && i & 1 ? "YCCK" : "CMYK";
      const expected = pictureOf(frame, { colors });
      const [dc, ac] = numbers[i % 3];
      const interval = isLossless(frame) ? 0 : i;
      const named = (components: number[], ...fields: [number, number, number, number]) =>
        scanOf(components, ...fields, { dc: components.map(c => dc[c]), ac: components.map(c => ac[c]), interval });
      return ["0123", "01 23", "3 012", "0 0123"].map(layout => {
        const bands = (ah: number, al: number) => all(frame).map(c => named([c], 1, 63, ah, al));
        const each = (...fields: [number, number, number, number]) =>
          groupsOf(layout).map(group => named(group, ...fields));
        const scans = isProgressive(frame)
          ? [...each(0, 0, 0, 1), ...bands(0, 1), ...each(0, 0, 1, 0), ...bands(1, 0)]
          : each(isLossless(frame) ? 4 : 0, isLossless(frame) ? 0 : 63, 0, 0);
        return {
          name: `${sampling}, ${layout}`,
          file: write(frame, scans, { before: colorMarkers[colors] }),
          expected,
        };
      });
    }),
  );
});
