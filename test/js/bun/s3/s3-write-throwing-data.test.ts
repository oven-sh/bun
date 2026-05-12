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

const opts = { accessKeyId: "a", secretAccessKey: "b", bucket: "c", endpoint: "http://localhost:1" };

test("S3Client#write propagates data coercion errors without crashing", () => {
  const s3 = new Bun.S3Client(opts);
  expect(() => s3.write("ab", throwing)).toThrow("boom");
  expect(() => s3.write("some/longer/path", [throwing, throwing])).toThrow("boom");
});

test("S3Client.write (static) propagates data coercion errors without crashing", () => {
  expect(() => Bun.S3Client.write("ab", throwing, opts)).toThrow("boom");
  expect(() => Bun.S3Client.write("some/longer/path", [throwing], opts)).toThrow("boom");
});

test("S3Client presign with invalid expiresIn does not crash", () => {
  expect(() => Bun.S3Client.presign("some/path", { ...opts, expiresIn: -1 })).toThrow("expiresIn");
  expect(() => Bun.S3Client.presign("\u{1F600}/path", { ...opts, expiresIn: -1 })).toThrow("expiresIn");
  const s3 = new Bun.S3Client(opts);
  expect(() => s3.presign("some/path", { expiresIn: -1 })).toThrow("expiresIn");
  expect(() => s3.presign("ab", { expiresIn: -1 })).toThrow("expiresIn");
});

test("S3 file construction with options.type getter throwing does not crash", () => {
  const throwingType = {
    get type() {
      throw new Error("type-boom");
    },
  };
  const s3 = new Bun.S3Client(opts);
  expect(() => s3.file("some/path", throwingType)).toThrow("type-boom");
  expect(() => Bun.file("s3://bucket/some/path", throwingType)).toThrow("type-boom");
  expect(() => Bun.S3Client.file("some/path", throwingType)).toThrow("type-boom");
});
