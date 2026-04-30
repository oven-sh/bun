// BUN-2C1
//   const value = @field(this, @tagName(field));
//  if (comptime (Big and @typeInfo(@TypeOf(value)) == .Int)) {
//    return JSC.JSValue.fromInt64NoTruncate(globalObject, @intCast(value));
//  }
import { createStatsForIno } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { Stats, statSync } from "node:fs";

test("fs.stats truncate", async () => {
  const stats = new Stats(...Array.from({ length: 14 }, () => Number.MAX_VALUE));
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
