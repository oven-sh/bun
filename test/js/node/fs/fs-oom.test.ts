import { memfd_create, setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeSync, readFileSync, writeSync } from "fs";
import fsPromises from "fs/promises";
import { isLinux, isPosix } from "harness";
setSyntheticAllocationLimitForTesting(128 * 1024 * 1024);

// /dev/zero reports a size of 0. So we need a separate test for reDgular files that are huge.
if (isPosix) {
  test("fs.readFileSync(/dev/zero) should throw an OOM without crashing the process.", () => {
    expect(() => readFileSync("/dev/zero")).toThrow("ENOMEM: not enough memory, read '/dev/zero'");
    Bun.gc(true);
  });

  test.each(["utf8", "ucs2", "latin1", "hex", "base64", "base64url"] as const)(
    "fs.readFileSync(/dev/zero, '%s') should throw an OOM without crashing the process.",
    encoding => {
      expect(() => readFileSync("/dev/zero", encoding)).toThrow("ENOMEM: not enough memory, read '/dev/zero'");
      Bun.gc(true);
    },
  );
}

// memfd is linux only.
if (isLinux) {
  describe("fs.readFileSync large file show OOM without crashing the process.", () => {
    test.each(["buffer", "utf8", "ucs2", "latin1"] as const)("%s encoding", encoding => {
      const memfd = memfd_create(1024 * 1024 * 16 + 1);
      (function (memfd) {
        let buf = new Uint8Array(8 * 1024 * 1024);
        buf.fill(42);
        for (let i = 0; i < 1024 * 1024 * 16 + 1; i += buf.byteLength) {
          writeSync(memfd, buf, 0, buf.byteLength, i);
        }
      })(memfd);
      Bun.gc(true);
      setSyntheticAllocationLimitForTesting(2 * 1024 * 1024);

      try {
        expect(() => (encoding === "buffer" ? readFileSync(memfd) : readFileSync(memfd, encoding))).toThrow(
          "ENOMEM: not enough memory",
        );
      } finally {
        Bun.gc(true);
        closeSync(memfd);
      }
    });
  });
}

// Async `fs.readFile` coverage — see https://github.com/oven-sh/bun/issues/29184
// where reading `/dev/urandom` with `encoding: "utf8"` never rejected because
// `shouldThrowOutOfMemoryEarlyForJavaScript` compared `size / 4 - 1` (a lower
// bound on the output-string length) against the limit. The fix compares the
// *maximum* possible output length instead. `hex` is the cleanest regression
// target: the old check used `size / 2 - 1` (half the input), the fix uses
// `size * 2` (the actual output), so a file sized between those thresholds
// flips from "silently succeeds" to "rejects with ENOMEM".
describe("fs.readFile (async) OOM early-throw", () => {
  // Scoped to this describe so we don't disturb the synthetic limit set
  // earlier in this file (and inside the readFileSync memfd describe above).
  let previousSyntheticLimit = 0;
  beforeAll(() => {
    previousSyntheticLimit = setSyntheticAllocationLimitForTesting(4 * 1024 * 1024);
  });
  afterAll(() => {
    setSyntheticAllocationLimitForTesting(previousSyntheticLimit);
  });

  test.skipIf(!isLinux)("hex-encoded rejects when the would-be string exceeds the limit", async () => {
    // 2 MiB + 1 byte of input → 4 MiB + 2 hex chars of output.
    const size = 2 * 1024 * 1024 + 1;
    const fd = memfd_create(size);
    try {
      const chunk = new Uint8Array(1024 * 1024);
      chunk.fill(0x42);
      for (let off = 0; off < size; off += chunk.byteLength) {
        writeSync(fd, chunk, 0, Math.min(chunk.byteLength, size - off), off);
      }
      await expect(fsPromises.readFile(fd, { encoding: "hex" })).rejects.toThrow("ENOMEM: not enough memory");
    } finally {
      closeSync(fd);
      Bun.gc(true);
    }
  });

  test.skipIf(!isLinux)("rejects on /dev/urandom instead of reading forever (issue #29184 repro)", async () => {
    // Direct reproduction from the issue. With the 4 MiB limit applied above,
    // this rejects after ~4 MiB of reads instead of never. Gated to Linux
    // because the reporter's environment is Linux; the hex memfd test above
    // proves the same early-throw under the same synthetic limit.
    await expect(fsPromises.readFile("/dev/urandom", { encoding: "utf8" })).rejects.toThrow(
      "ENOMEM: not enough memory, read '/dev/urandom'",
    );
  });

  test("reads a small regular file successfully", async () => {
    // Sanity-check that narrowing the early-throw limit didn't break the
    // common case.
    const self = Bun.fileURLToPath(import.meta.url);
    const contents = await fsPromises.readFile(self, { encoding: "utf8" });
    expect(typeof contents).toBe("string");
    expect(contents.length).toBeGreaterThan(0);
    expect(contents).toContain("fs-oom");
  });
});
