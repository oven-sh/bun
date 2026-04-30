import { describe, expect, test } from "bun:test";
import { S3Client } from "bun";

// Regression test: S3Client methods would double-free the path string when an
// error was thrown after the internal S3 blob store had already taken ownership
// of the path (via toThreadSafe()). The `errdefer path.deinit()` in the caller
// then tried to release the same underlying WTFStringImpl again, tripping a
// refcount assertion in debug builds. The bug only reproduced when the path
// string was not already a pre-existing atom (so isolatedCopy() produced a new
// StringImpl and deref'd the original).

describe("S3Client path ownership on error", () => {
  const throwingData = {
    [Symbol.toPrimitive]() {
      throw new Error("boom");
    },
  };

  const throwingCredOptions = {
    get accessKeyId(): string {
      throw new Error("cred-boom");
    },
  };

  const throwingTypeOptions = {
    get type(): string {
      throw new Error("type-boom");
    },
  };

  // Use a path string that is unlikely to already exist as an atom in the VM.
  let counter = 0;
  const freshPath = () => `zzz-unique-s3-path-${process.pid}-${counter++}`;

  describe("instance methods", () => {
    const client = new S3Client();

    test("write() with data whose string coercion throws", () => {
      expect(() => client.write(freshPath(), throwingData)).toThrow("boom");
    });

    test("write() with throwing options.type", () => {
      expect(() => client.write(freshPath(), throwingData, throwingTypeOptions)).toThrow();
    });

    test("file() with throwing credentials option", () => {
      expect(() => client.file(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("presign() with throwing credentials option", () => {
      expect(() => client.presign(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("presign() with throwing options.type", () => {
      expect(() => client.presign(freshPath(), throwingTypeOptions)).toThrow("type-boom");
    });

    test("exists() with throwing credentials option", () => {
      expect(() => client.exists(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("size() with throwing credentials option", () => {
      expect(() => client.size(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("stat() with throwing credentials option", () => {
      expect(() => client.stat(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("unlink() with throwing credentials option", () => {
      expect(() => client.unlink(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("write() with missing data argument", () => {
      // @ts-expect-error
      expect(() => client.write(freshPath())).toThrow();
    });
  });

  describe("static methods", () => {
    test("write() with data whose string coercion throws", () => {
      expect(() => S3Client.write(freshPath(), throwingData)).toThrow("boom");
    });

    test("presign() with throwing options.type", () => {
      expect(() => S3Client.presign(freshPath(), throwingTypeOptions)).toThrow("type-boom");
    });

    test("exists() with throwing credentials option", () => {
      expect(() => S3Client.exists(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("size() with throwing credentials option", () => {
      expect(() => S3Client.size(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("stat() with throwing credentials option", () => {
      expect(() => S3Client.stat(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("unlink() with throwing credentials option", () => {
      expect(() => S3Client.unlink(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("file() with throwing credentials option", () => {
      expect(() => S3Client.file(freshPath(), throwingCredOptions)).toThrow("cred-boom");
    });

    test("write() with missing data argument", () => {
      // @ts-expect-error
      expect(() => S3Client.write(freshPath())).toThrow();
    });
  });
});
