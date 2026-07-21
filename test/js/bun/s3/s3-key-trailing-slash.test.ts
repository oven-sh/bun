import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";

// No network: presign() signs and builds the URL locally.
// https://github.com/oven-sh/bun/issues/34959
const client = new S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  bucket: "bucket",
  region: "auto",
  endpoint: "https://example.com",
});

describe("S3 keys with trailing separators", () => {
  it("preserves a trailing slash in presigned URLs", () => {
    const url = new URL(client.presign("folder/", { method: "PUT" }));
    expect(url.pathname).toBe("/bucket/folder/");
  });

  it("preserves a trailing slash in nested keys", () => {
    const url = new URL(client.presign("a/b/c/", { method: "PUT" }));
    expect(url.pathname).toBe("/bucket/a/b/c/");
  });

  it("keys without a trailing slash are unchanged", () => {
    const url = new URL(client.presign("folder", { method: "PUT" }));
    expect(url.pathname).toBe("/bucket/folder");
  });

  it("still trims the leading slash", () => {
    const url = new URL(client.presign("/folder/", { method: "PUT" }));
    expect(url.pathname).toBe("/bucket/folder/");
  });

  it("preserves a trailing slash for S3File-based presign", () => {
    const url = new URL(client.file("folder/").presign({ method: "PUT" }));
    expect(url.pathname).toBe("/bucket/folder/");
  });

  it("does not discard a trailing backslash", () => {
    // The exact encoding of `\` is covered elsewhere; it must not be dropped.
    for (const presigned of [
      client.presign("folder\\", { method: "PUT" }),
      client.file("folder\\").presign({ method: "PUT" }),
    ]) {
      const url = new URL(presigned);
      expect(url.pathname).not.toBe("/bucket/folder");
      expect(url.pathname.startsWith("/bucket/folder")).toBe(true);
      expect(url.pathname.length).toBeGreaterThan("/bucket/folder".length);
    }
  });

  it("a bare separator key is still rejected as empty", () => {
    expect(() => client.presign("/", { method: "PUT" })).toThrow();
    expect(() => client.presign("///", { method: "PUT" })).toThrow();
  });
});
