import { describe, expect, test } from "bun:test";

test("S3Client.write does not crash with out-of-range float as path", () => {
  expect(() => Bun.S3Client.write(-1.5379890021597998e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(1e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(-Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(NaN, "data")).toThrow();
});

test("S3 file type option containing CR/LF or other control characters is not reflected into upload request headers", async () => {
  const seenRequests: { headers: Headers; url: string }[] = [];
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      seenRequests.push({ headers: req.headers, url: req.url });
      return new Response("", { status: 200 });
    },
  });

  const client = new Bun.S3Client({
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
    endpoint: server.url.href,
  });

  // A `type` value embedding CR/LF is rejected outright at option-parsing time,
  // before any request is made, so it can never become extra request headers.
  expect(() => client.file("report.txt", { type: "text/plain\r\nx-amz-acl: public-read" })).toThrow(
    "type must not contain newline characters (CR/LF)",
  );

  // Other control characters in `type` must not be stored as the file's content
  // type, and must not leak into the outgoing object-storage request headers.
  const file = client.file("report.txt", { type: "text/plain\x0bx-amz-acl: public-read" });
  expect(file.type).not.toContain("\x0b");
  expect(file.type).not.toContain("public-read");
  await file.write("hello");

  expect(seenRequests.length).toBeGreaterThan(0);
  for (const seen of seenRequests) {
    expect(seen.headers.get("x-amz-acl")).toBeNull();
    expect(seen.headers.get("content-type") ?? "").not.toContain("public-read");
    expect(seen.headers.get("content-type") ?? "").not.toContain("\x0b");
  }

  // A legitimate content type still reaches the server unchanged.
  const before = seenRequests.length;
  await client.file("plain.txt", { type: "text/plain" }).write("hello");
  const legit = seenRequests.slice(before);
  expect(legit.length).toBeGreaterThan(0);
  expect(legit.some(seen => (seen.headers.get("content-type") ?? "").startsWith("text/plain"))).toBe(true);
  for (const seen of legit) {
    expect(seen.headers.get("x-amz-acl")).toBeNull();
  }
});

// The static methods accept a path or an S3 blob; everything else is rejected
// up front with a per-method message. Numbers parse as file descriptor paths,
// which S3 also rejects.
describe("S3Client static method argument validation", () => {
  const staticCases = [
    ["presign", "Expected a S3 or path to presign", []],
    ["unlink", "Expected a S3 or path to delete", []],
    ["write", "Expected a S3 or path to upload", ["data"]],
    ["size", "Expected a S3 or path to get size", []],
    ["exists", "Expected a S3 or path to check if it exists", []],
    // stat reuses the size wording
    ["stat", "Expected a S3 or path to get size", []],
  ] as const;

  test.each(staticCases)("S3Client.%s rejects non-S3 arguments", (method, message, extra) => {
    const expected = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message });
    const fn = (Bun.S3Client as any)[method];
    // a data-backed Blob is not S3-backed
    expect(() => fn(new Blob(["x"]), ...extra)).toThrow(expected);
    // a local file Blob is not S3-backed either
    expect(() => fn(Bun.file(import.meta.path), ...extra)).toThrow(expected);
    // a number is parsed as a file descriptor path
    expect(() => fn(0, ...extra)).toThrow(expected);
  });

  test("S3Client.write requires data", () => {
    expect(() => Bun.S3Client.write("some-key")).toThrow(
      expect.objectContaining({ code: "ERR_MISSING_ARGS", message: "Expected a Blob-y thing to upload" }),
    );
  });
});

describe("S3Client instance method argument validation", () => {
  const client = new Bun.S3Client({
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "bucket",
    endpoint: "http://127.0.0.1:1",
  });

  const instanceCases = [
    ["presign", "Expected a path to presign"],
    ["exists", "Expected a path to check if it exists"],
    ["size", "Expected a path to check the size of"],
    ["stat", "Expected a path to check the stat of"],
  ] as const;

  test.each(instanceCases)("client.%s distinguishes a missing path from an invalid one", (method, message) => {
    const fn = (client as any)[method].bind(client);
    // no argument at all: MISSING_ARGS
    expect(() => fn()).toThrow(expect.objectContaining({ code: "ERR_MISSING_ARGS", message }));
    // an argument that is not a path: INVALID_ARG_TYPE, same message
    expect(() => fn(123)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message }));
    expect(() => fn({})).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message }));
  });

  test("client.unlink reports MISSING_ARGS for both missing and invalid paths", () => {
    const expected = expect.objectContaining({ code: "ERR_MISSING_ARGS", message: "Expected a path to unlink" });
    expect(() => (client as any).unlink()).toThrow(expected);
    expect(() => (client as any).unlink(123)).toThrow(expected);
    expect(() => (client as any).unlink({})).toThrow(expected);
  });

  test("S3 file writer() rejects a non-string type option before any request is made", () => {
    const s3file = client.file("some-key.bin");
    expect(() => s3file.writer({ type: 123 as any })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: "Expected options.type to be a string for 'write'.",
      }),
    );
  });
});
