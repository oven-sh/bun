import { expect, test } from "bun:test";

test("S3Client does not crash with queueSize > 255", () => {
  expect(() => new Bun.S3Client({ queueSize: 256 })).not.toThrow();
  expect(() => new Bun.S3Client({ queueSize: 1000 })).not.toThrow();
  expect(() => new Bun.S3Client({ queueSize: 2147483647 })).not.toThrow();
});

test("S3Client throws RangeError with queueSize < 1", () => {
  expect(() => new Bun.S3Client({ queueSize: 0 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ queueSize: -1 })).toThrow(RangeError);
});
