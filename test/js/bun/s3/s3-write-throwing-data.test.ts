import { expect, test } from "bun:test";

// When a later step of an S3 operation throws after the blob store has taken
// ownership of the path string, the caller's `errdefer path.deinit()` used to
// run as well, over-dereffing the path's WTFStringImpl (whose ref had already
// been transferred by `toThreadSafe()` inside `Store.initS3`).
const throwing = {
  [Symbol.toPrimitive]() {
    throw new Error("boom");
  },
};

test("S3Client#write propagates data coercion errors without crashing", () => {
  const s3 = new Bun.S3Client();
  expect(() => s3.write("ab", throwing)).toThrow("boom");
  expect(() => s3.write("some/longer/path", [throwing, throwing])).toThrow("boom");
});

test("S3Client.write (static) propagates data coercion errors without crashing", () => {
  const opts = { accessKeyId: "a", secretAccessKey: "b", bucket: "c", endpoint: "http://localhost:1" };
  expect(() => Bun.S3Client.write("ab", throwing, opts)).toThrow("boom");
  expect(() => Bun.S3Client.write("some/longer/path", [throwing], opts)).toThrow("boom");
});

test("S3Client#presign with missing credentials does not crash", () => {
  const s3 = new Bun.S3Client();
  expect(() => s3.presign("ab")).toThrow("Missing S3 credentials");
  expect(() => s3.presign("some/longer/path")).toThrow("Missing S3 credentials");
});
