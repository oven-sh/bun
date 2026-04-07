// BUN-2C1
//   const value = @field(this, @tagName(field));
//  if (comptime (Big and @typeInfo(@TypeOf(value)) == .Int)) {
//    return JSC.JSValue.fromInt64NoTruncate(globalObject, @intCast(value));
//  }
import { createStatsFromU64ForTesting } from "bun:internal-for-testing";
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

// Regression: previously `Stat.zig` clamped `u64` stat fields to `INT64_MAX`
// via `clampedInt64`, so filesystems with inodes near 2^63 (common on NFS)
// collapsed every file to the same inode.
//
// After the fix the conversion matches Node.js exactly:
//   * `Stats` fills via `static_cast<double>(uint64_t)` (precision lost above
//     2^53, but never clamped). See `src/node_file-inl.h:85-116` upstream.
//   * `BigIntStats` fills via `static_cast<int64_t>(uint64_t)` (a Node-side
//     `BigInt64Array`), so values above 2^63 wrap to a negative BigInt.
//     This matches Node; see `src/node_file.h:78-79` / `AliasedBigInt64Array`.

// Helper: Node's `static_cast<int64_t>(uint64_t)` interpretation of a u64.
function asSignedI64(value: bigint): bigint {
  const mask = (1n << 64n) - 1n;
  const v = value & mask;
  return v < 1n << 63n ? v : v - (1n << 64n);
}

test("fs.stats preserves high 64-bit inodes (near 2^63)", () => {
  // Real-world NFS inode from the original bug report.
  const highIno = 9225185599684229422n;

  // BigIntStats path: matches Node's BigInt64Array reinterpretation.
  const big = createStatsFromU64ForTesting(highIno, true);
  expect(big.ino).toBe(asSignedI64(highIno));

  // Stats path: Node represents `ino` as a `Number` (double), so precision is
  // lost above 2^53 — but the value must NOT be clamped to INT64_MAX.
  const small = createStatsFromU64ForTesting(highIno, false);
  expect(small.ino).toBeTypeOf("number");
  expect(small.ino).toBeGreaterThan(9e18);
  // And two distinct high inodes must produce two distinct Number values.
  // The pre-fix clamp mapped every ino > INT64_MAX to 9223372036854775807,
  // so this comparison caught the bug.
  const other = createStatsFromU64ForTesting(highIno - 1_000_000_000_000n, false);
  expect(other.ino).not.toBe(small.ino);
});

test("fs.stats preserves u64 inodes across the boundary (Number path)", () => {
  // A value that fits in a double exactly and another that doesn't but is
  // still within u64. Neither should be clamped.
  const inBounds = 2n ** 52n - 1n; // fits in f64 exactly
  const outOfBounds = (1n << 63n) + 12345n; // > INT64_MAX

  const a = createStatsFromU64ForTesting(inBounds, false);
  expect(a.ino).toBe(Number(inBounds));

  const b = createStatsFromU64ForTesting(outOfBounds, false);
  // Can't exactly compare Number to BigInt > 2^53, but it must be a
  // finite positive number > 2^63, not the old INT64_MAX clamp value.
  expect(Number.isFinite(b.ino)).toBe(true);
  expect(b.ino).toBeGreaterThan(2 ** 63);
});

test("fs.stats preserves u64 inodes across the boundary (BigInt path)", () => {
  // Every u64 bit pattern should come back as the `int64_t` reinterpretation
  // of itself — matching Node's `static_cast<int64_t>(uint64_t)`. In
  // particular, values above 2^63 wrap to negative, they must NOT be clamped
  // to `INT64_MAX` like Bun used to do.
  const cases = [
    0n,
    1n,
    (1n << 31n) - 1n,
    1n << 31n,
    (1n << 32n) - 1n,
    1n << 32n,
    (1n << 53n) - 1n,
    1n << 53n,
    (1n << 62n) - 1n,
    (1n << 63n) - 1n,
    1n << 63n,
    9225185599684229422n,
    (1n << 64n) - 1n,
  ];

  const observed = cases.map(ino => createStatsFromU64ForTesting(ino, true).ino);
  const expected = cases.map(asSignedI64);
  expect(observed).toEqual(expected);

  // Sanity-check the oracle: the collision with `INT64_MAX` that used to
  // define the bug is only present for a single input (INT64_MAX itself),
  // not for the entire `ino > INT64_MAX` upper half.
  const max = (1n << 63n) - 1n;
  expect(observed.filter(v => v === max).length).toBe(1);
});
