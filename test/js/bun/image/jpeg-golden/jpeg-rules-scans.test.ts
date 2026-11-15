// The rules for arithmetic-coded scans that end early, and for long progressive scripts.
import { describe, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { everySymbol, expectPictures, range } from "./decode";
import { pictureOf } from "./model";
import { intervalsOf, readArithmetic } from "./read-arithmetic";
import {
  AC,
  coded,
  copyOf,
  dht,
  dri,
  frameOf,
  headerOf,
  jpeg,
  marker,
  noise,
  RST0,
  scanOf,
  simpleProgression,
  SOF10,
  SOF2,
  SOF9,
  typical,
  unfinished,
  type Frame,
  type Scan,
} from "./write";

describe.each([
  ["sequential", SOF9, [scanOf([0, 1, 2])]],
  ["sequential, in two scans", SOF9, [scanOf([0]), scanOf([1, 2])]],
  ["progressive", SOF10, simpleProgression],
])("what an arithmetic-coded scan lacks is read from zeros: %s", (_, type, scans) => {
  // The 0 keeps it from being smoothed.
  const tables = [Array(64).fill(2).with(9, 0)];
  const empty = frameOf(56, 24, "2x2,1x1,1x1", { type, tables });
  const frame = noise(copyOf(empty), randomBytes(6), { sparse: 3, ac: 14, dc: 8 });
  /** An interval that is left out together with the marker in front of it. */
  const missing = Buffer.alloc(0);

  /** For each of the scans in turn, with all that `change` makes of what is between its restart markers. */
  function expectRead(interval: number, change: (intervals: Buffer[]) => Buffer[][], written = interval) {
    const parts = scans.map(scan => coded(frame, { ...scan, interval: written }));
    const whole = (from: number, to?: number) => parts.slice(from, to).flatMap(({ header, data }) => [header, data]);
    const readWhole = (into: Frame, nth: number) =>
      readArithmetic(into, { ...scans[nth], interval: written }, intervalsOf(parts[nth].data));
    const before = copyOf(empty);
    return expectPictures(
      scans.flatMap((scan, nth) => {
        const cases = change(intervalsOf(parts[nth].data)).flatMap((intervals, i) => {
          const marked = intervals.flatMap((it, n) =>
            n && it !== missing ? [marker(RST0 + ((n - 1) & 7)), it] : [it],
          );
          const start = [headerOf(frame), dri(written), ...whole(0, nth), dri(interval), parts[nth].header, ...marked];
          const read = copyOf(before);
          readArithmetic(read, { ...scan, interval }, intervals);
          const last = { name: `scan ${nth}, ${i}, last`, file: unfinished(...start), expected: pictureOf(read) };
          if (nth === scans.length - 1 || (slow && (nth + i) % 3)) return [last];
          for (const other of range(nth + 1, scans.length - 1)) readWhole(read, other);
          const file = jpeg(...start, dri(written), ...whole(nth + 1));
          return [last, { name: `scan ${nth}, ${i}`, file, expected: pictureOf(read) }];
        });
        readWhole(before, nth);
        return cases;
      }),
    );
  }

  test("nothing", () => expectRead(3, intervals => [intervals]));

  test("the end of its data", () =>
    expectRead(0, ([data]) => [0, 1, 3, data.length >> 1, data.length - 1].map(length => [data.subarray(0, length)])));

  test("the end of each interval", () =>
    expectRead(3, intervals => [0, 1, 2].map(thirds => intervals.map(it => it.subarray(0, (it.length * thirds) / 3)))));

  test("the last intervals", () =>
    expectRead(2, intervals => [1, 2, intervals.length - 1].map(count => intervals.slice(0, count))));

  test("one or two intervals in between", () =>
    expectRead(2, intervals => [intervals.with(2, missing), intervals.with(1, missing).with(2, missing)]));

  test("all restart markers", () => expectRead(3, intervals => [intervals], 0));
});

test.each([
  ["sequential", SOF9, 3, [scanOf([0])]],
  ["DC coefficients", SOF10, 1, [scanOf([0], 0, 0)]],
  ["first scan of a band", SOF10, 3, [scanOf([0], 1, 63)]],
  ["refinement", SOF10, 5, [scanOf([0], 1, 63, 0, 1), scanOf([0], 1, 63, 1, 0)]],
])("so it is in a larger picture that is cut off early: %s", async (name, type, seed, scans) => {
  const read = frameOf(128, 128, "1x1", { type, tables: [Array(64).fill(1).with(9, 0)] });
  const frame = noise(frameOf(128, 128, "1x1", { type }), randomBytes(seed), { sparse: 3, ac: 14, dc: 8 });
  const parts = scans.flatMap(scan => {
    const { header, data } = coded(frame, scan);
    const left = scan === scans.at(-1) ? data.subarray(0, data.length >> 3) : data;
    readArithmetic(read, scan, [left]);
    return [header, left];
  });
  await expectPictures([{ name, file: unfinished(headerOf(read), ...parts), expected: pictureOf(read) }]);
});

describe.each([
  ["Huffman", SOF2, 2],
  ["arithmetic", SOF10, 4],
])("long scripts come to the same picture as short ones: %s", (_, type, count) => {
  const down = (from: number, components: number[], ss: number, se: number) =>
    range(0, from).map(i => scanOf(components, ss, se, i ? from - i + 1 : 0, from - i));
  const each = (make: (c: number) => Scan[]) => [0, 1, 2].flatMap(make);
  const bands = (c: number) => range(1, 63).map(k => scanOf([c], k, k));
  const scripts: [string, string, Scan[]][] = [
    ["from the 11th bit down", "2x2,1x1,1x1", [...down(10, [0, 1, 2], 0, 0), ...each(c => down(10, [c], 1, 63))]],
    ["63 bands", "1x1,1x1,1x1", [scanOf([0, 1, 2], 0, 0), ...each(bands)]],
    ["63 bands, from the last, each refined", "1x1", range(0, 63).flatMap(k => down(2, [0], 63 - k, 63 - k))],
    ["every bit of every coefficient", "1x1", range(0, 63).flatMap(k => down(13, [0], k, k))],
  ];

  /** With a coefficient of up to 10 bits in each block. */
  function frameFor(width: number, height: number, sampling: string) {
    const random = randomBytes(7);
    const frame = noise(frameOf(width, height, sampling, { type }), random, { sparse: 3, ac: 12, dc: 100 });
    for (const { data } of frame.components) {
      for (let i = 0; i < data.length; i += 64) data[i + 1 + (random() % 63)] = (random() - 128) * 5;
    }
    return frame;
  }

  const tables = { 0: typical[0], 1: typical[0], [AC]: everySymbol, [AC + 1]: everySymbol };
  const headerWithTables = (frame: Frame) =>
    Buffer.concat([headerOf(frame), ...Object.entries(tables).map(([number, table]) => dht(+number, table))]);

  test.each(scripts.slice(0, count))("%s", async (name, sampling, scans) => {
    const frame = frameFor(35, 19, sampling);
    const parts = scans.map(scan => coded(frame, scan, tables)).flatMap(({ header, data }) => [header, data]);
    await expectPictures([{ name, file: jpeg(headerWithTables(frame), ...parts), expected: pictureOf(frame) }]);
  });

  test.each(scripts.slice(0, count))("%s, with a restart marker after each row", async (name, sampling, scans) => {
    const [wide, high] = [12, 64];
    const row = frameFor(wide * 8, 8, sampling.replace("2x2", "1x1"));
    const parts = scans.flatMap(scan => {
      const { header, data } = coded(row, scan, tables);
      const eight = Buffer.concat(range(0, 7).flatMap(number => [data, marker(RST0 + number)]));
      return [header, Buffer.alloc((data.length + 2) * high - 2, eight)];
    });
    const file = jpeg(headerWithTables({ ...row, height: high * 8 }), dri(wide), ...parts);
    const one = pictureOf(row);
    const expected = { ...one, height: high * 8, rgba: Buffer.alloc(one.rgba.length * high, one.rgba) };
    await expectPictures([{ name, file, expected }]);
  });
});
