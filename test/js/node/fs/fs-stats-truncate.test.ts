// BUN-2C1
//   const value = @field(this, @tagName(field));
//  if (comptime (Big and @typeInfo(@TypeOf(value)) == .Int)) {
//    return JSC.JSValue.fromInt64NoTruncate(globalObject, @intCast(value));
//  }
import { Stats, statSync } from "node:fs";
import { test, expect } from "bun:test";

test("fs.stats truncate", async () => {
  const stats = new Stats(...Array.from({ length: 14 }, () => Number.MAX_VALUE));
  expect(stats.dev).toBeNumber();
  expect(stats.mode).toBeNumber();
  expect(stats.nlink).toBeNumber();
  expect(stats.uid).toBeNumber();
  expect(stats.gid).toBeNumber();
  expect(stats.rdev).toBeNumber();
  expect(stats.blksize).toBeNumber();
  expect(stats.ino).toBeNumber();
  expect(stats.size).toBeNumber();
  expect(stats.blocks).toBeNumber();
  expect(stats.atimeMs).toBeNumber();
  expect(stats.mtimeMs).toBeNumber();
  expect(stats.ctimeMs).toBeNumber();
  expect(stats.birthtimeMs).toBeNumber();
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
