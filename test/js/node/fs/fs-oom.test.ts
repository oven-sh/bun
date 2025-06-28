import { memfd_create, setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { closeSync, readFileSync, writeSync } from "fs";
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
