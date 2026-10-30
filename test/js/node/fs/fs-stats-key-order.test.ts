/**
 * Node.js assigns the own keys of a Stats object in a fixed order: StatsBase
 * assigns the first ten, then each constructor assigns its times.
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L386-L398 (StatsBase)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L619-L660 (BigIntStats, Stats)
 * Bun listed the ten base keys in the order of the stat buffer instead:
 * dev, ino, mode, nlink, uid, gid, rdev, size, blksize, blocks.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected order comes from. It cannot
 * import from "harness" for the same reason, so it manages its own temporary
 * directory.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const statsKeys = [
  "dev",
  "mode",
  "nlink",
  "uid",
  "gid",
  "rdev",
  "blksize",
  "ino",
  "size",
  "blocks",
  "atimeMs",
  "mtimeMs",
  "ctimeMs",
  "birthtimeMs",
];
const bigintStatsKeys = [...statsKeys, "atimeNs", "mtimeNs", "ctimeNs", "birthtimeNs"];

describe("the own keys of Stats and BigIntStats are in Node's order", () => {
  let dir: string;
  let file: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-stats-key-order-"));
    file = path.join(dir, "file.txt");
    fs.writeFileSync(file, "hello");
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const { bigint, keys } of [
    { bigint: false, keys: statsKeys },
    { bigint: true, keys: bigintStatsKeys },
  ]) {
    describe(`a stat result, bigint: ${bigint}`, () => {
      function viaCallback(stat: Function, target: string | number) {
        const { promise, resolve, reject } = Promise.withResolvers<object>();
        stat(target, { bigint }, (err: Error | null, stats: object) => (err ? reject(err) : resolve(stats)));
        return promise;
      }

      test("from every stat function", async () => {
        const handle = await fs.promises.open(file, "r");
        try {
          const results: Record<string, object> = {
            statSync: fs.statSync(file, { bigint }),
            lstatSync: fs.lstatSync(file, { bigint }),
            fstatSync: fs.fstatSync(handle.fd, { bigint }),
            stat: await viaCallback(fs.stat, file),
            lstat: await viaCallback(fs.lstat, file),
            fstat: await viaCallback(fs.fstat, handle.fd),
            "promises.stat": await fs.promises.stat(file, { bigint }),
            "promises.lstat": await fs.promises.lstat(file, { bigint }),
            "FileHandle.stat": await handle.stat({ bigint }),
          };
          const names = Object.keys(results);
          assert.deepStrictEqual(
            Object.fromEntries(names.map(name => [name, Object.keys(results[name])])),
            Object.fromEntries(names.map(name => [name, keys])),
          );
        } finally {
          await handle.close();
        }
      });

      // A file that does not exist gives the listener one event, with every field zero.
      test("from a watchFile listener", async () => {
        const missing = path.join(dir, `missing-${bigint}.txt`);
        const { promise, resolve } = Promise.withResolvers<object[]>();
        const watchFile: Function = fs.watchFile;
        watchFile(missing, { bigint }, (curr: object, prev: object) => resolve([curr, prev]));
        try {
          assert.deepStrictEqual(
            (await promise).map(stats => Object.keys(stats)),
            [keys, keys],
          );
        } finally {
          fs.unwatchFile(missing);
        }
      });

      test("a date getter adds its key after them", () => {
        const stats = fs.statSync(file, { bigint });
        assert.ok(stats.mtime instanceof Date);
        assert.deepStrictEqual(Object.keys(stats), [...keys, "mtime"]);
      });
    });
  }

  test("JSON.stringify lists the fields of a stat result in that order", () => {
    const stats: Record<string, any> = fs.statSync(file);
    assert.strictEqual(
      JSON.stringify(stats),
      JSON.stringify(Object.fromEntries(statsKeys.map(key => [key, stats[key]]))),
    );
  });

  describe("a constructed one", () => {
    function constructed(Class: any, args: unknown[]): Record<string, object> {
      const Subclass: any = class extends Class {};
      return {
        new: new Class(...args),
        subclass: new Subclass(...args),
        newTarget: Reflect.construct(Class, args, function () {}),
        newTargetWithoutPrototype: Reflect.construct(Class, args, function () {}.bind(null)),
      };
    }

    // Every time argument is zero: Node.js v26.3.0 takes them as eight (seconds, nanoseconds) values, Bun as four.
    test("Stats, each base field with its argument", () => {
      const each = constructed(fs.Stats, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 0, 0, 0, 0, 0]);
      const entries = statsKeys.map((key, index) => [key, index < 10 ? index : 0]);
      assert.deepStrictEqual(
        Object.fromEntries(Object.keys(each).map(how => [how, Object.entries(each[how])])),
        Object.fromEntries(Object.keys(each).map(how => [how, entries])),
      );
    });

    // The time arguments are whole milliseconds. Each *Ms field is its *Ns argument divided by 1e6: a BigInt in
    // Node.js, a Number in Bun (https://github.com/oven-sh/bun/pull/47233). Number() reads both.
    test("BigIntStats, each field with its argument", () => {
      const BigIntStats = fs.statSync(file, { bigint: true }).constructor;
      const times = [10_000_000n, 11_000_000n, 12_000_000n, 13_000_000n];
      const each = constructed(BigIntStats, [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, ...times]);
      const entries = [
        ...statsKeys.slice(0, 10).map((key, index) => [key, BigInt(index)]),
        ["atimeMs", 10],
        ["mtimeMs", 11],
        ["ctimeMs", 12],
        ["birthtimeMs", 13],
        ["atimeNs", times[0]],
        ["mtimeNs", times[1]],
        ["ctimeNs", times[2]],
        ["birthtimeNs", times[3]],
      ];
      const entriesOf = (stats: object) =>
        Object.entries(stats).map(([key, value]) => [key, key.endsWith("Ms") ? Number(value) : value]);
      assert.deepStrictEqual(
        Object.fromEntries(Object.keys(each).map(how => [how, entriesOf(each[how])])),
        Object.fromEntries(Object.keys(each).map(how => [how, entries])),
      );
    });
  });
});
