// Truncated arithmetic-coded scans, and long sequences of progressive scans.
import { describe, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { everySymbol, expectPictures, range } from "./decode";
import { pictureOf } from "./model";
import { intervalsOf, readArithmetic } from "./read-arithmetic";
import {
  AC,
  bitByBit,
  coded,
  copyOf,
  dhts,
  dri,
  forThree,
  frameOf,
  headerOf,
  jpeg,
  noise,
  progressiveTypes,
  rst,
  scanOf,
  scanWithoutTables,
  simpleProgression,
  SOF10,
  SOF9,
  typical,
  withoutEoi,
  type Frame,
  type Scan,
} from "./write";

describe.each([
  ["sequential", SOF9, [scanOf([0, 1, 2])]],
  ["sequential, in two scans", SOF9, [scanOf([0]), scanOf([1, 2])]],
  ["progressive", SOF10, simpleProgression],
])("missing arithmetic-coded data decodes as zeros: %s", (_, type, scans) => {
  // The 0 turns block smoothing off.
  const tables = [Array(64).fill(2).with(9, 0)];
  const empty = frameOf(56, 24, "2x2,1x1,1x1", { type, tables });
  const frame = noise(copyOf(empty), randomBytes(6), { sparse: 3, ac: 14, dc: 8 });
  /** A restart interval that is left out together with the marker before it. */
  const missing = Buffer.alloc(0);

  /** Damages each scan in turn. `change` returns variants of its restart intervals. */
  function expectRead(interval: number, change: (intervals: Buffer[]) => Buffer[][], written = interval) {
    const parts = scans.map(scan => coded(frame, { ...scan, interval: written }));
    const whole = (from: number, to?: number) => parts.slice(from, to).flatMap(({ header, data }) => [header, data]);
    const readWhole = (into: Frame, nth: number) =>
      readArithmetic(into, { ...scans[nth], interval: written }, intervalsOf(parts[nth].data));
    const before = copyOf(empty);
    return expectPictures(
      scans.flatMap((scan, nth) => {
        const cases = change(intervalsOf(parts[nth].data)).flatMap((intervals, i) => {
          const marked = intervals.flatMap((it, n) => (n && it !== missing ? [rst(n - 1), it] : [it]));
          const start = [headerOf(frame), dri(written), ...whole(0, nth), dri(interval), parts[nth].header, ...marked];
          const read = copyOf(before);
          readArithmetic(read, { ...scan, interval }, intervals);
          const last = { name: `scan ${nth}, ${i}, last`, file: withoutEoi(...start), expected: pictureOf(read) };
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

  test("nothing is missing", () => expectRead(3, intervals => [intervals]));

  test("the end of the scan", () =>
    expectRead(0, ([data]) => [0, 1, 3, data.length >> 1, data.length - 1].map(length => [data.subarray(0, length)])));

  test("the end of each restart interval", () =>
    expectRead(3, intervals => [0, 1, 2].map(thirds => intervals.map(it => it.subarray(0, (it.length * thirds) / 3)))));

  test("the last restart intervals", () =>
    expectRead(2, intervals => [1, 2, intervals.length - 1].map(count => intervals.slice(0, count))));

  test("one or two restart intervals in the middle", () =>
    expectRead(2, intervals => [intervals.with(2, missing), intervals.with(1, missing).with(2, missing)]));

  test("all restart markers", () => expectRead(3, intervals => [intervals], 0));
});

test.each([
  ["sequential", SOF9, 3, [scanOf([0])]],
  ["first DC scan", SOF10, 1, [scanOf([0], 0, 0)]],
  ["first AC scan", SOF10, 3, [scanOf([0], 1, 63)]],
  ["AC refinement", SOF10, 5, [scanOf([0], 1, 63, 0, 1), scanOf([0], 1, 63, 1, 0)]],
])("an arithmetic-coded scan of 256 blocks with an eighth of its data: %s", async (name, type, seed, scans) => {
  const read = frameOf(128, 128, "1x1", { type, tables: [Array(64).fill(1).with(9, 0)] });
  const frame = noise(frameOf(128, 128, "1x1", { type }), randomBytes(seed), { sparse: 3, ac: 14, dc: 8 });
  const parts = scans.flatMap(scan => {
    const { header, data } = coded(frame, scan);
    const left = scan === scans.at(-1) ? data.subarray(0, data.length >> 3) : data;
    readArithmetic(read, scan, [left]);
    return [header, left];
  });
  await expectPictures([{ name, file: withoutEoi(headerOf(read), ...parts), expected: pictureOf(read) }]);
});

describe.each(progressiveTypes)("long sequences of scans: %s", (_, type) => {
  const bands = (c: number, al: number) => range(0, 31).map(i => bitByBit(al, [c], 2 * i + 1, Math.min(2 * i + 2, 63)));
  const ends = [0, 1, 2, 9, 30, 62, 63];
  const scripts: [string, string, Scan[]][] = [
    ["from Al = 10", "2x2,1x1,1x1", [...bitByBit(10, [0, 1, 2], 0, 0), ...forThree(c => bitByBit(10, [c], 1, 63))]],
    ["32 bands", "1x1,1x1,1x1", [scanOf([0, 1, 2], 0, 0), ...forThree(c => bands(c, 0).flat())]],
    ["32 bands, from the last, each refined", "1x1", [bitByBit(2, [0], 0, 0), ...bands(0, 2)].reverse().flat()],
    ["every bit of 7 bands", "1x1", ends.flatMap((se, i) => bitByBit(13, [0], i && ends[i - 1] + 1, se))],
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

  test.each(scripts)("%s", async (name, sampling, scans) => {
    const frame = frameFor(35, 19, sampling);
    const file = jpeg(headerOf(frame), ...dhts(tables), ...scans.map(scan => scanWithoutTables(frame, scan, tables)));
    await expectPictures([{ name, file, expected: pictureOf(frame) }]);
  });

  test.each(scripts)("%s, with a restart marker after each row", async (name, sampling, scans) => {
    const [wide, high] = [12, 64];
    const row = frameFor(wide * 8, 8, sampling.replace("2x2", "1x1"));
    const parts = scans.flatMap(scan => {
      const { header, data } = coded(row, scan, tables);
      const eight = Buffer.concat(range(0, 7).flatMap(number => [data, rst(number)]));
      return [header, Buffer.alloc((data.length + 2) * high - 2, eight)];
    });
    const file = jpeg(headerOf({ ...row, height: high * 8 }), ...dhts(tables), dri(wide), ...parts);
    const one = pictureOf(row);
    const expected = { ...one, height: high * 8, rgba: Buffer.alloc(one.rgba.length * high, one.rgba) };
    await expectPictures([{ name, file, expected }]);
  });
});
