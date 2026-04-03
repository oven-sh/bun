import { expect, test } from "bun:test";

// Regression test for double-free of path in S3 static and instance methods.
// The bug crashes under ASAN/debug builds when signRequest fails after
// constructS3FileInternalStore/constructS3FileWithS3CredentialsAndOptions
// transfers path ownership to the blob store via toThreadSafe().
// Both errdefer and defer would deref the same WTFStringImpl.

// Instance method path (S3Client.zig) — uses explicit empty credentials
// to ensure missing-credentials path regardless of ambient AWS/S3 env vars.
test("S3Client instance presign does not crash on missing credentials", () => {
  const client = new Bun.S3Client({ accessKeyId: "", secretAccessKey: "" });
  expect(() => client.presign("a")).toThrow("Missing S3 credentials");
  expect(() => client.presign("some-key", {})).toThrow("Missing S3 credentials");
});

// Static method path (S3File.zig) — exercises the separate static entrypoint.
test("S3Client static presign does not crash on missing credentials", () => {
  expect(() => Bun.S3Client.presign("a")).toThrow("Missing S3 credentials");
});
