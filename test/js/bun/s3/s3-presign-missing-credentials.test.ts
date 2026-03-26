import { expect, test } from "bun:test";

// Regression: S3Client.presign("path") with missing credentials crashed in
// debug builds due to stale JSC exception-scope state from PathLike.fromJS.
// The fix validates credentials before PathLike parsing, and the error
// message now correctly lists only the fields that are checked.

test("S3Client.presign(path) throws accurate ERR_S3_MISSING_CREDENTIALS", () => {
  const client = new Bun.S3Client();
  try {
    client.presign("test.txt");
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("ERR_S3_MISSING_CREDENTIALS");
    // The early validation only checks accessKeyId and secretAccessKey,
    // so the message should not mention bucket or endpoint.
    expect(e.message).not.toContain("bucket");
  }
});

test("S3Client.presign(path) throws with non-string credential type", () => {
  const client = new Bun.S3Client();
  expect(() => client.presign("test.txt", { accessKeyId: 123 as any })).toThrow();
});
