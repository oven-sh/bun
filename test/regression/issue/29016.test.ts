// https://github.com/oven-sh/bun/issues/29016
import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "node:path";

function openEmptyTempFile() {
  const dir = tempDirWithFiles("issue-29016", { tempfile: "" });
  return fs.openSync(path.join(dir, "tempfile"), "r+");
}

describe.concurrent("fs.readSync position validation (issue #29016)", () => {
  test("throws TypeError on object position with zero-length buffer", () => {
    const fd = openEmptyTempFile();
    try {
      const empty = new Uint8Array(0);
      expect(() => fs.readSync(fd, empty, 0, empty.length, { not: "a number" } as any)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    } finally {
      fs.closeSync(fd);
    }
  });

  test("throws TypeError on object position with non-zero-length buffer", () => {
    const fd = openEmptyTempFile();
    try {
      const buf = new Uint8Array(5);
      expect(() => fs.readSync(fd, buf, 0, buf.length, { not: "a number" } as any)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    } finally {
      fs.closeSync(fd);
    }
  });

  test("throws TypeError on string position with zero-length buffer", () => {
    const fd = openEmptyTempFile();
    try {
      const empty = new Uint8Array(0);
      expect(() => fs.readSync(fd, empty, 0, empty.length, "nope" as any)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    } finally {
      fs.closeSync(fd);
    }
  });

  test("accepts null position with zero-length buffer", () => {
    const fd = openEmptyTempFile();
    try {
      const empty = new Uint8Array(0);
      expect(fs.readSync(fd, empty, 0, empty.length, null)).toBe(0);
    } finally {
      fs.closeSync(fd);
    }
  });

  test("accepts integer position with zero-length buffer", () => {
    const fd = openEmptyTempFile();
    try {
      const empty = new Uint8Array(0);
      expect(fs.readSync(fd, empty, 0, empty.length, 0)).toBe(0);
    } finally {
      fs.closeSync(fd);
    }
  });

  test("accepts bigint position with zero-length buffer", () => {
    const fd = openEmptyTempFile();
    try {
      const empty = new Uint8Array(0);
      expect(fs.readSync(fd, empty, 0, empty.length, 0n)).toBe(0);
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe.concurrent("fs.read position validation (issue #29016)", () => {
  test("rejects object position with zero-length buffer (callback form)", async () => {
    const fd = openEmptyTempFile();
    try {
      const empty = new Uint8Array(0);
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      try {
        fs.read(fd, empty, 0, empty.length, { not: "a number" } as any, err => {
          if (err?.code === "ERR_INVALID_ARG_TYPE") resolve();
          else if (err) reject(err);
          else reject(new Error("expected fs.read to error out"));
        });
      } catch (err: any) {
        // Synchronously-thrown TypeError is also acceptable.
        if (err?.code === "ERR_INVALID_ARG_TYPE") resolve();
        else reject(err);
      }
      await promise;
    } finally {
      fs.closeSync(fd);
    }
  });
});
