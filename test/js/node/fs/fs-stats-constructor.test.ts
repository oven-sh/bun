import { expect, test } from "bun:test";
import { Stats, statSync } from "node:fs";

// Node.js's Stats constructor signature (deprecated, DEP0180):
//   Stats(dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs)
const args = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const expected = {
  dev: 0,
  mode: 1,
  nlink: 2,
  uid: 3,
  gid: 4,
  rdev: 5,
  blksize: 6,
  ino: 7,
  size: 8,
  blocks: 9,
  atimeMs: 10,
  mtimeMs: 11,
  ctimeMs: 12,
  birthtimeMs: 13,
};

test("new Stats(...) assigns fields in Node's order", () => {
  // @ts-expect-error DEP0180
  expect({ ...new Stats(...args) }).toMatchObject(expected);
});

test("Stats(...) without new assigns fields in Node's order", () => {
  // Regression: callJSStatsFunction used to write putDirectOffset slots in
  // argument order, but the structure's slot layout differs, so .ino returned
  // the mode argument etc.
  // @ts-expect-error DEP0180
  expect({ ...Stats(...args) }).toMatchObject(expected);
});

test("Stats instances share Stats.prototype", () => {
  // Regression: initJSStatsClassStructure created two JSStatsPrototype objects,
  // so Object.getPrototypeOf(instance) !== Stats.prototype and instanceof failed.
  const fromSync = statSync(import.meta.path);
  // @ts-expect-error DEP0180
  const fromNew = new Stats(...args);
  // @ts-expect-error DEP0180
  const fromCall = Stats(...args);

  expect(fromSync instanceof Stats).toBe(true);
  expect(fromNew instanceof Stats).toBe(true);
  expect(fromCall instanceof Stats).toBe(true);
  expect(Object.getPrototypeOf(fromSync)).toBe(Stats.prototype);
  expect(Object.getPrototypeOf(fromNew)).toBe(Stats.prototype);
  expect(Object.getPrototypeOf(fromCall)).toBe(Stats.prototype);

  const bigint = statSync(import.meta.path, { bigint: true });
  expect(Object.getPrototypeOf(bigint).constructor.name).toBe("BigIntStats");
  expect(bigint instanceof Object.getPrototypeOf(bigint).constructor).toBe(true);
});
