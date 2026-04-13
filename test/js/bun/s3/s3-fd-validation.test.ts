import { expect, test } from "bun:test";

test("S3Client.write does not crash with out-of-range float as path", () => {
  expect(() => Bun.S3Client.write(-1.5379890021597998e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(1e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(-Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(NaN, "data")).toThrow();
});
