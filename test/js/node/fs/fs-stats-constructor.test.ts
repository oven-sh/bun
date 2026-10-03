import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

// A call resolved through a binding that a closure captures is compiled with the scope object
// itself in the this slot, and native functions see it raw. isFile() and friends used to read
// `mode` out of that scope object (the date getters, once pulled out of their property descriptor,
// `atimeMs` and so on): a missing binding produced a bogus answer, and a binding still in its
// temporal dead zone crashed the process. Such a receiver now gets the same answer as any other
// non-object receiver.
describe("Stats methods and accessors called without a receiver", () => {
  test("a mode method called through a captured binding is treated like an undefined receiver", () => {
    const stats = statSync(import.meta.path);
    const bigintStats = statSync(import.meta.dir, { bigint: true });
    const { isFile } = stats;
    const { isDirectory } = bigintStats;
    function keep() {
      return [isFile, isDirectory];
    }
    expect({
      bare: [isFile(), isDirectory()],
      undefinedReceiver: [isFile.call(undefined), isDirectory.call(undefined)],
      statsReceiver: [isFile.call(stats), isDirectory.call(bigintStats)],
    }).toEqual({
      bare: [undefined, undefined],
      undefinedReceiver: [undefined, undefined],
      statsReceiver: [true, true],
    });
    expect(keep()).toEqual([isFile, isDirectory]);
  });

  test("a date getter called through a captured binding is treated like an undefined receiver", () => {
    const stats = statSync(import.meta.path);
    const bigintStats = statSync(import.meta.path, { bigint: true });
    const atime = Object.getOwnPropertyDescriptor(Stats.prototype, "atime")!.get!;
    const bigintMtime = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(bigintStats), "mtime")!.get!;
    function keep() {
      return [atime, bigintMtime];
    }
    expect({
      bare: [atime(), bigintMtime()],
      undefinedReceiver: [atime.call(undefined), bigintMtime.call(undefined)],
      statsReceiver: [atime.call(stats), bigintMtime.call(bigintStats)],
    }).toEqual({
      bare: [undefined, undefined],
      undefinedReceiver: [undefined, undefined],
      statsReceiver: [stats.atime, bigintStats.mtime],
    });
    expect(keep()).toEqual([atime, bigintMtime]);
  });

  test("calls through a scope whose `mode` and `atimeMs` bindings are in their TDZ do not crash", async () => {
    const src = `
      const { Stats, statSync } = require("node:fs");
      const { isFile } = statSync(${JSON.stringify(import.meta.path)});
      const { isDirectory } = statSync(${JSON.stringify(import.meta.dir)}, { bigint: true });
      const atime = Object.getOwnPropertyDescriptor(Stats.prototype, "atime").get;
      console.log(isFile(), isDirectory(), atime());
      let mode = 0;
      let atimeMs = 0;
      function keep() {
        return [isFile, isDirectory, atime, mode, atimeMs];
      }
      keep();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "undefined undefined undefined\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
