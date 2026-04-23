import { describe, expect, test } from "bun:test";

// A non-ASCII character forces the PathLike to be an allocated encoded_slice.
// When the operation fails after the path has been placed in the blob store,
// it must be freed exactly once; previously both the blob store and the
// caller's errdefer would free it, causing an ASAN use-after-poison.
const nonAsciiPath = "bucket/key-ü.txt";

describe("S3Client error paths do not double-free the path", () => {
  test("instance presign() throwing after blob creation", () => {
    const client = new Bun.S3Client({ accessKeyId: "x", secretAccessKey: "y", endpoint: "http://example.com" });
    expect(() => client.presign(nonAsciiPath, { expiresIn: -1 })).toThrow();
    expect(() =>
      client.presign(nonAsciiPath, {
        get method() {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
  });

  test("instance presign() throwing before blob creation", () => {
    const client = new Bun.S3Client();
    expect(() =>
      client.presign(nonAsciiPath, {
        get type() {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
  });

  test("instance file() throwing before blob creation", () => {
    const client = new Bun.S3Client();
    expect(() =>
      client.file(nonAsciiPath, {
        get type() {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
  });

  test("instance write() with non-ASCII path and missing data", () => {
    const client = new Bun.S3Client();
    expect(() => client.write(nonAsciiPath)).toThrow();
  });

  test.each(["exists", "size", "stat", "unlink"] as const)(
    "instance %s() throwing before blob creation",
    method => {
      const client = new Bun.S3Client();
      expect(() =>
        client[method](nonAsciiPath, {
          get type() {
            throw new Error("boom");
          },
        }),
      ).toThrow("boom");
    },
  );

  test("static presign() throwing after blob creation", () => {
    expect(() =>
      Bun.S3Client.presign(nonAsciiPath, {
        accessKeyId: "x",
        secretAccessKey: "y",
        endpoint: "http://example.com",
        expiresIn: -1,
      }),
    ).toThrow();
    expect(() =>
      Bun.S3Client.presign(nonAsciiPath, {
        accessKeyId: "x",
        secretAccessKey: "y",
        endpoint: "http://example.com",
        get method() {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
  });

  test("static presign() throwing before blob creation", () => {
    expect(() =>
      Bun.S3Client.presign(nonAsciiPath, {
        get type() {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
  });

  test("static file() throwing before blob creation", () => {
    expect(() =>
      Bun.S3Client.file(nonAsciiPath, {
        get type() {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
  });

  test.each(["exists", "size", "stat", "unlink"] as const)(
    "static %s() throwing before blob creation",
    method => {
      expect(() =>
        Bun.S3Client[method](nonAsciiPath, {
          get type() {
            throw new Error("boom");
          },
        }),
      ).toThrow("boom");
    },
  );
});
