import { describe, expect, test } from "bun:test";

// Argument validation for the S3 static and instance methods. Every case here
// is rejected synchronously, before any network request, so no server is
// needed.

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
