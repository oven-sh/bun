import { memfd_create, setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { closeSync, readFileSync, writeSync } from "fs";
import { isLinux, isPosix } from "harness";
setSyntheticAllocationLimitForTesting(128 * 1024 * 1024);

// /dev/zero reports a size of 0. So we need a separate test for reDgular files that are huge.
if (isPosix) {
  test("fs.readFileSync(/dev/zero) should throw an OOM without crashing the process.", () => {
    expect(() => readFileSync("/dev/zero")).toThrow("Out of memory");
    Bun.gc(true);
  });

  test.each(["utf8", "ucs2", "latin1", "hex", "base64", "base64url"] as const)(
    "fs.readFileSync(/dev/zero, '%s') should throw an OOM without crashing the process.",
    encoding => {
      expect(() => readFileSync("/dev/zero", encoding)).toThrow("Out of memory");
      Bun.gc(true);
    },
  );
}

// memfd is linux only.
if (isLinux) {
  test("fs.readFileSync large file show OOM without crashing the process.", () => {
    const memfd = memfd_create(1024 * 1024 * 256 + 1);
    {
      let buf = new Uint8Array(32 * 1024 * 1024);
      for (let i = 0; i < 1024 * 1024 * 256 + 1; i += buf.byteLength) {
        writeSync(memfd, buf, i, buf.byteLength);
      }
    }
    setSyntheticAllocationLimitForTesting(128 * 1024 * 1024);

    try {
      expect(() => readFileSync(memfd)).toThrow("Out of memory");
      Bun.gc(true);
      expect(() => readFileSync(memfd, "utf8")).toThrow("Out of memory");
      Bun.gc(true);
      expect(() => readFileSync(memfd, "latin1")).toThrow("Out of memory");
      Bun.gc(true);
      // it is difficult in CI to test the other encodings.
    } finally {
      closeSync(memfd);
    }
  });
}
