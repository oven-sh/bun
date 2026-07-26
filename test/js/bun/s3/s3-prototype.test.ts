import { describe, expect, test } from "bun:test";

describe("S3File prototype", () => {
  const client = new Bun.S3Client({
    accessKeyId: "a",
    secretAccessKey: "s",
    bucket: "b",
    endpoint: "http://127.0.0.1:9",
  });
  const s3file = client.file("k.txt");
  const S3FileProto = Object.getPrototypeOf(s3file);

  test("inherits from Blob.prototype via the prototype chain", () => {
    expect(S3FileProto).not.toBe(Blob.prototype);
    expect(Object.getPrototypeOf(S3FileProto)).toBe(Blob.prototype);
    expect(s3file).toBeInstanceOf(Blob);
  });

  test("does not redeclare Blob.prototype members as own properties", () => {
    // These live on Blob.prototype; S3File.prototype must inherit them, not
    // shadow them with duplicate own properties. A shadowing copy would be a
    // separate function object that brand-checks at the Blob level, so
    // S3File.prototype.text.call(new Blob([...])) would run instead of throwing.
    for (const name of [
      "text",
      "json",
      "arrayBuffer",
      "bytes",
      "formData",
      "stream",
      "slice",
      "exists",
      "image",
      "write",
      "writer",
      "unlink",
      "delete",
      "size",
      "type",
      "lastModified",
      "name",
    ]) {
      expect(
        Object.getOwnPropertyDescriptor(S3FileProto, name),
        `S3File.prototype should not have own property '${name}'`,
      ).toBeUndefined();
      expect(name in s3file, `'${name}' should be reachable on an S3File instance`).toBe(true);
    }
  });

  test("own members brand-check for S3File", () => {
    // S3File.prototype only defines S3-specific members as own properties.
    const own = new Set(Object.getOwnPropertyNames(S3FileProto));
    expect(own.has("presign")).toBe(true);
    expect(own.has("stat")).toBe(true);
    expect(own.has("bucket")).toBe(true);

    const mem = new Blob(["mem-bytes"]);
    for (const name of Object.getOwnPropertyNames(S3FileProto)) {
      const desc = Object.getOwnPropertyDescriptor(S3FileProto, name)!;
      const fn = desc.value ?? desc.get;
      if (typeof fn !== "function") continue;
      expect(() => fn.call(mem), `S3File.prototype.${name} should reject a plain Blob receiver`).toThrow(TypeError);
      expect(() => fn.call({}), `S3File.prototype.${name} should reject a plain-object receiver`).toThrow(TypeError);
    }
  });

  test("Symbol.toStringTag", () => {
    expect(S3FileProto[Symbol.toStringTag]).toBe("S3File");
    expect(Object.prototype.toString.call(s3file)).toBe("[object S3File]");
  });
});
