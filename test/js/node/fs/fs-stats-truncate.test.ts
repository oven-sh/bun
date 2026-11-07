// BUN-2C1
//   const value = @field(this, @tagName(field));
//  if (comptime (Big and @typeInfo(@TypeOf(value)) == .Int)) {
//    return JSC.JSValue.fromInt64NoTruncate(globalObject, @intCast(value));
//  }
import { createStatsForIno } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { closeSync, openSync, Stats, statSync } from "node:fs";

test("fs.stats truncate", async () => {
  const stats = new (Stats as any)(...Array.from({ length: 14 }, () => Number.MAX_VALUE));
  expect(stats.dev).toBeGreaterThan(0);
  expect(stats.mode).toBeGreaterThan(0);
  expect(stats.nlink).toBeGreaterThan(0);
  expect(stats.uid).toBeGreaterThan(0);
  expect(stats.gid).toBeGreaterThan(0);
  expect(stats.rdev).toBeGreaterThan(0);
  expect(stats.blksize).toBeGreaterThan(0);
  expect(stats.ino).toBeGreaterThan(0);
  expect(stats.size).toBeGreaterThan(0);
  expect(stats.blocks).toBeGreaterThan(0);
  expect(stats.atimeMs).toBeGreaterThan(0);
  expect(stats.mtimeMs).toBeGreaterThan(0);
  expect(stats.ctimeMs).toBeGreaterThan(0);
  expect(stats.birthtimeMs).toBeGreaterThan(0);
});

test("fs.stats truncate (bigint)", async () => {
  const stats = statSync(import.meta.path, { bigint: true });
  expect(stats.dev).toBeTypeOf("bigint");
  expect(stats.mode).toBeTypeOf("bigint");
  expect(stats.nlink).toBeTypeOf("bigint");
  expect(stats.uid).toBeTypeOf("bigint");
  expect(stats.gid).toBeTypeOf("bigint");
  expect(stats.rdev).toBeTypeOf("bigint");
  expect(stats.blksize).toBeTypeOf("bigint");
  expect(stats.ino).toBeTypeOf("bigint");
  expect(stats.size).toBeTypeOf("bigint");
  expect(stats.blocks).toBeTypeOf("bigint");
  expect(stats.atimeMs).toBeTypeOf("bigint");
  expect(stats.mtimeMs).toBeTypeOf("bigint");
  expect(stats.ctimeMs).toBeTypeOf("bigint");
  expect(stats.birthtimeMs).toBeTypeOf("bigint");
});

// Regression: u64 inodes above INT64_MAX (common on NFS) were clamped to
// INT64_MAX. Node.js goes uv_stat_t (u64) -> Float64Array / BigInt64Array.
test("fs.Stats does not clamp u64 ino to INT64_MAX", () => {
  const cases = [0n, 1n, (1n << 53n) - 1n, (1n << 63n) - 1n, 1n << 63n, 9225185599684229422n, (1n << 64n) - 1n];

  // Number path: static_cast<double>(uint64_t)
  expect(cases.map(ino => createStatsForIno(ino, false).ino)).toEqual(cases.map(Number));

  // BigInt path: static_cast<int64_t>(uint64_t)
  expect(cases.map(ino => createStatsForIno(ino, true).ino)).toEqual(cases.map(ino => BigInt.asIntN(64, ino)));
});

// Node.js assigns the own keys in this order: StatsBase the first ten, then the constructor its times.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L386-L398
// fs-stats-key-order.test.ts checks the order of every stat function, under Node.js too. These two need Bun.
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

// createStatsForIno fills the stat buffer with 1 to 10 in the order of its fields (`ino` is the second one),
// and gives every time but atime a number of seconds of its own.
test("the native creators put each field of the stat buffer under its own key, in Node's order", () => {
  expect(Object.entries(createStatsForIno(2n, false))).toEqual([
    ["dev", 1],
    ["mode", 3],
    ["nlink", 4],
    ["uid", 5],
    ["gid", 6],
    ["rdev", 7],
    ["blksize", 9],
    ["ino", 2],
    ["size", 8],
    ["blocks", 10],
    ["atimeMs", 0],
    ["mtimeMs", 12_000],
    ["ctimeMs", 13_000],
    ["birthtimeMs", 14_000],
  ]);
  expect(Object.entries(createStatsForIno(2n, true))).toEqual([
    ["dev", 1n],
    ["mode", 3n],
    ["nlink", 4n],
    ["uid", 5n],
    ["gid", 6n],
    ["rdev", 7n],
    ["blksize", 9n],
    ["ino", 2n],
    ["size", 8n],
    ["blocks", 10n],
    ["atimeMs", 0n],
    ["mtimeMs", 12_000n],
    ["ctimeMs", 13_000n],
    ["birthtimeMs", 14_000n],
    ["atimeNs", 0n],
    ["mtimeNs", 12_000_000_000n],
    ["ctimeNs", 13_000_000_000n],
    ["birthtimeNs", 14_000_000_000n],
  ]);
});

test("Bun.file().stat() gives the own keys in Node's order", async () => {
  const fd = openSync(import.meta.path, "r");
  try {
    expect({
      path: Object.keys(await Bun.file(import.meta.path).stat()),
      fd: Object.keys(await Bun.file(fd).stat()),
    }).toEqual({ path: statsKeys, fd: statsKeys });
  } finally {
    closeSync(fd);
  }
});
