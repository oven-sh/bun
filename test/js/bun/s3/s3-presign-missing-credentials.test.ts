import { expect, test } from "bun:test";

// Regression test: S3 presign with missing credentials should throw
// ERR_S3_MISSING_CREDENTIALS instead of crashing.
test("Bun.s3.presign throws with missing credentials", () => {
  expect(() => Bun.s3.presign("test-path")).toThrow("Missing S3 credentials");
});

test("new S3Client().presign throws with missing credentials", () => {
  const client = new Bun.S3Client();
  expect(() => client.presign("test-path")).toThrow("Missing S3 credentials");
});

test("S3Client.presign static throws with missing credentials", () => {
  expect(() => Bun.S3Client.presign("test-path")).toThrow("Missing S3 credentials");
});

test("S3 presign with missing credentials does not crash on GC", () => {
  try {
    Bun.s3.presign("test-path");
  } catch {}
  Bun.gc(true);
});
