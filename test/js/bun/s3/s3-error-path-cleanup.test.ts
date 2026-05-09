import { describe, expect, test } from "bun:test";

// When an S3 operation fails after the blob store is created (e.g. missing
// credentials in signRequest), the path string's ownership has already been
// transferred to the store via toThreadSafe(). The caller's errdefer must not
// deinit it again or the underlying StringImpl gets double-freed.
describe("S3 methods do not double-free path on error", () => {
  const paths = ["abc", "foo/bar", "xyz" + Math.random().toString(36).slice(2)];

  describe.each(paths)("path=%s", p => {
    test("S3Client instance presign", () => {
      expect(() => Bun.s3.presign(p)).toThrow();
      expect(() => Bun.s3.presign(p, new SharedArrayBuffer(16))).toThrow();
      expect(() => new Bun.S3Client({}).presign(p)).toThrow();
    });

    test("S3Client static presign", () => {
      expect(() => Bun.S3Client.presign(p)).toThrow();
    });

    test("S3Client unlink", () => {
      const a = Bun.s3.unlink(p);
      const b = Bun.S3Client.unlink(p);
      expect(a).rejects.toThrow();
      expect(b).rejects.toThrow();
    });

    test("S3Client write", () => {
      const a = Bun.s3.write(p, "x");
      const b = Bun.S3Client.write(p, "x");
      expect(a).rejects.toThrow();
      expect(b).rejects.toThrow();
    });
  });

  test("valid presign still works", () => {
    const client = new Bun.S3Client({
      accessKeyId: "a",
      secretAccessKey: "b",
      bucket: "c",
      endpoint: "http://localhost",
    });
    expect(client.presign("abc")).toStartWith("http://localhost/c/abc?");
  });

  test("early failure before store creation still cleans up path", () => {
    expect(() => Bun.s3.presign("abc", { accessKeyId: 123 })).toThrow();
    expect(() => new Bun.S3Client({}).presign("abc", { accessKeyId: 123 })).toThrow();
  });

  test("repeated calls under GC", () => {
    for (let i = 0; i < 50; i++) {
      try {
        Bun.s3.presign("k" + i);
      } catch {}
      try {
        Bun.S3Client.presign("k" + i);
      } catch {}
    }
    Bun.gc(true);
  });
});
