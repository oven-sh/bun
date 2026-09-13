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

// Node.js computes the four `*Ms` fields of BigIntStats in JS: `this.atimeMs = atimeNs / 1_000_000n`.
// That is BigInt division: the result is a BigInt, truncated toward zero, with no 64-bit limit, and
// an operand that does not convert to a BigInt throws a TypeError. The native constructor used to
// divide `BigInt.asIntN(64, atimeNs)` as a double and store a Number, which the date getters reject.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L619-L632
describe("BigIntStats constructor", () => {
  const BigIntStats = Object.getPrototypeOf(statSync(import.meta.path, { bigint: true })).constructor;
  class Subclass extends BigIntStats {}
  // BigIntStats(dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeNs, mtimeNs, ctimeNs, birthtimeNs)
  const fields = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n];
  const constructors: [string, (...args: unknown[]) => any][] = [
    ["new BigIntStats(...)", (...args) => new BigIntStats(...args)],
    ["new (class extends BigIntStats)(...)", (...args) => new Subclass(...args)],
    // Node.js throws for a call without new. Bun accepts it, for Stats too.
    ["BigIntStats(...)", (...args) => BigIntStats(...args)],
  ];

  test.each(constructors)("%s divides the *Ns arguments into BigInt *Ms fields", (_, construct) => {
    const stats = construct(...fields, 2_500_000n, 3_999_999n, -2_500_000n, -1n);
    expect({ ...stats }).toEqual({
      dev: 0n,
      mode: 1n,
      nlink: 2n,
      uid: 3n,
      gid: 4n,
      rdev: 5n,
      blksize: 6n,
      ino: 7n,
      size: 8n,
      blocks: 9n,
      atimeMs: 2n,
      mtimeMs: 3n,
      ctimeMs: -2n,
      birthtimeMs: 0n,
      atimeNs: 2_500_000n,
      mtimeNs: 3_999_999n,
      ctimeNs: -2_500_000n,
      birthtimeNs: -1n,
    });
    expect({
      atime: stats.atime,
      mtime: stats.mtime,
      ctime: stats.ctime,
      birthtime: stats.birthtime,
    }).toEqual({
      atime: new Date(2),
      mtime: new Date(3),
      ctime: new Date(-2),
      birthtime: new Date(0),
    });
  });

  test.each(constructors)("%s keeps the precision of *Ns arguments outside the int64 range", (_, construct) => {
    const stats = construct(...fields, 2n ** 70n, -(2n ** 70n), 2n ** 63n, -(2n ** 63n) - 1n);
    expect({
      atimeMs: stats.atimeMs,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      birthtimeMs: stats.birthtimeMs,
    }).toEqual({
      atimeMs: 1_180_591_620_717_411n,
      mtimeMs: -1_180_591_620_717_411n,
      ctimeMs: 9_223_372_036_854n,
      birthtimeMs: -9_223_372_036_854n,
    });
    expect(stats.atime).toEqual(new Date(1_180_591_620_717_411));

    // A *Ms value outside the int64 range is outside the Date range too. The getter must not wrap it into a valid date.
    const wide = construct(...fields, 2n ** 64n * 1_000_000n, -(2n ** 64n) * 1_000_000n, 0n, 0n);
    expect({ atimeMs: wide.atimeMs, mtimeMs: wide.mtimeMs }).toEqual({ atimeMs: 2n ** 64n, mtimeMs: -(2n ** 64n) });
    expect({ atime: wide.atime.getTime(), mtime: wide.mtime.getTime() }).toEqual({ atime: NaN, mtime: NaN });
  });

  test.each(constructors)("%s throws a TypeError if a *Ns argument does not convert to a BigInt", (_, construct) => {
    for (const notBigInt of [2_500_000, "2500000", true, null, undefined, { valueOf: () => 2_500_000 }]) {
      for (let i = 0; i < 4; i++) {
        const times: unknown[] = [0n, 0n, 0n, 0n];
        times[i] = notBigInt;
        expect(() => construct(...fields, ...times)).toThrow(TypeError);
      }
    }
  });

  test.each(constructors)("%s converts object *Ns arguments with valueOf, once each, in order", (_, construct) => {
    const order: string[] = [];
    const argument = (name: string, value: unknown) => ({
      valueOf() {
        order.push(name);
        return value;
      },
    });
    const atimeNs = argument("atimeNs", 1_999_999n);
    const mtimeNs = argument("mtimeNs", 2_000_000n);
    const ctimeNs = argument("ctimeNs", 3_000_000n);
    const birthtimeNs = argument("birthtimeNs", 4_000_000n);
    const stats = construct(...fields, atimeNs, mtimeNs, ctimeNs, birthtimeNs);
    expect(order).toEqual(["atimeNs", "mtimeNs", "ctimeNs", "birthtimeNs"]);
    expect({
      atimeMs: stats.atimeMs,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      birthtimeMs: stats.birthtimeMs,
    }).toEqual({ atimeMs: 1n, mtimeMs: 2n, ctimeMs: 3n, birthtimeMs: 4n });
    // The *Ns fields hold the arguments as given.
    expect(stats.atimeNs).toBe(atimeNs);
    expect(stats.mtimeNs).toBe(mtimeNs);
    expect(stats.ctimeNs).toBe(ctimeNs);
    expect(stats.birthtimeNs).toBe(birthtimeNs);

    // The first argument that does not convert to a BigInt ends the conversion.
    order.length = 0;
    const notBigInt = argument("mtimeNs", 2_000_000);
    expect(() => construct(...fields, atimeNs, notBigInt, ctimeNs, birthtimeNs)).toThrow(TypeError);
    expect(order).toEqual(["atimeNs", "mtimeNs"]);

    // A BigInt wrapper object converts too.
    expect(construct(...fields, Object(2_500_000n), 0n, 0n, 0n).atimeMs).toBe(2n);
  });
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
