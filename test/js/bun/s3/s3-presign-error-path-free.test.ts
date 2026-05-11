import { describe, expect, test } from "bun:test";

// When an S3 operation throws after the blob store has been constructed
// (e.g. invalid presign options), the path was being freed twice: once by
// the blob's defer cleanup and again by the caller's errdefer. This tripped
// a refcount assertion in debug builds.

describe("S3 presign error after store construction does not double-free path", () => {
  test("static S3Client.presign", () => {
    expect(() => Bun.S3Client.presign("some/path", { expiresIn: -1 })).toThrow("expiresIn");
    Bun.gc(true);
  });

  test("static S3Client.presign with non-latin1 path", () => {
    expect(() => Bun.S3Client.presign("\u{1F600}/path", { expiresIn: -1 })).toThrow("expiresIn");
    Bun.gc(true);
  });

  test("Bun.s3.presign", () => {
    expect(() => Bun.s3.presign("some/path", { expiresIn: -1 })).toThrow("expiresIn");
    Bun.gc(true);
  });

  test("instance presign", () => {
    const client = new Bun.S3Client({
      accessKeyId: "x",
      secretAccessKey: "y",
      bucket: "b",
      endpoint: "http://localhost",
    });
    expect(() => client.presign("some/path", { expiresIn: -1 })).toThrow("expiresIn");
    Bun.gc(true);
  });

  test("options.type getter throws after store is created", () => {
    const client = new Bun.S3Client({
      accessKeyId: "x",
      secretAccessKey: "y",
      bucket: "b",
      endpoint: "http://localhost",
    });
    let n = 0;
    const opts = {
      get type() {
        if (n++ === 0) return undefined;
        throw new Error("boom");
      },
    };
    expect(() => client.presign("\u{1F600}/k", opts)).toThrow("boom");
    Bun.gc(true);
  });
});
