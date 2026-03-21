import { test, expect } from "bun:test";

// Regression: passing a very large float as a file descriptor to S3Client.write
// caused a panic in @intFromFloat because the value was outside i64 range.
test("S3Client.write does not crash with out-of-range float as path", () => {
  expect(() => Bun.S3Client.write(-1.5379890021597998e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(1e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(-Infinity, "data")).toThrow();
});
