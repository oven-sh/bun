import { memfd_create, setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { closeSync, readFileSync, writeSync } from "fs";
import { readFile } from "fs/promises";
import { isLinux, isPosix } from "harness";

const limit = 16 * 1024 * 1024;
setSyntheticAllocationLimitForTesting(limit);

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

  // https://github.com/oven-sh/bun/issues/29184
  // /dev/urandom (like /dev/zero) is a non-terminating character device that
  // reports st_size == 0. readFile must stop once the accumulated bytes can no
  // longer produce a valid JavaScript string/buffer, rather than reading
  // forever until the OOM killer fires. Node.js rejects with "Invalid string
  // length" in this situation.
  test("fs.promises.readFile(/dev/urandom, 'utf8') should reject instead of reading forever", async () => {
    await expect(readFile("/dev/urandom", { encoding: "utf8" })).rejects.toThrow(
      "ENOMEM: not enough memory, read '/dev/urandom'",
    );
    Bun.gc(true);
  });

  test("fs.promises.readFile(/dev/zero) should reject with OOM without crashing the process.", async () => {
    await expect(readFile("/dev/zero")).rejects.toThrow("ENOMEM: not enough memory, read '/dev/zero'");
    Bun.gc(true);
  });

  test.each(["utf8", "ucs2", "latin1", "hex", "base64", "base64url"] as const)(
    "fs.promises.readFile(/dev/zero, '%s') should reject with OOM without crashing the process.",
    async encoding => {
      await expect(readFile("/dev/zero", encoding)).rejects.toThrow("ENOMEM: not enough memory, read '/dev/zero'");
      Bun.gc(true);
    },
  );
}

if (isLinux) {
  // https://github.com/oven-sh/bun/issues/29184
  //
  // For a non-terminating source like /dev/zero or /dev/urandom, readFile must
  // stop reading once the accumulated bytes could no longer produce a valid
  // JavaScript value for the requested encoding — not keep reading until the
  // allocator fails or the OOM killer fires.
  //
  // Previously the size check for utf8/ucs2 was `size / 4 > limit` (and the
  // checks for hex/base64 were similarly inverted), so with no configured
  // limit readFile('/dev/urandom', 'utf8') would try to read ~17 GB before
  // giving up. With the default String::MaxLength of ~2 GB the correct cap for
  // utf8 is ~2 GB of input, since each input byte produces at most one UTF-16
  // code unit.
  //
  // We verify this by measuring how many bytes were actually read from the
  // kernel (via /proc/self/io -> rchar) and asserting it stays close to the
  // encoding-appropriate threshold rather than the old, far-too-permissive
  // one. The assertion bounds are chosen so that any regression back to the
  // old `size / N` math is caught while still leaving headroom for ArrayList
  // geometric growth overshoot.
  describe("fs.readFile on a non-terminating source stops reading at the encoding-appropriate limit", () => {
    const rchar = () => {
      const io = readFileSync("/proc/self/io", "utf8");
      return parseInt(io.match(/^rchar: (\d+)/m)![1], 10);
    };

    // For each encoding, the maximum number of input bytes that can still
    // produce a JavaScript value within `limit`, and therefore the point at
    // which readFile should give up. The `max` column is a loose upper bound
    // (>= 2× the correct threshold) chosen to leave room for buffer-growth
    // overshoot while still being well below what the old, inverted math
    // would have read (noted in each comment).
    const cases = [
      // utf8: ≤ 1 code unit per byte → cap at `limit`. Old math (size/4) read ~4×limit.
      ["utf8", limit, limit * 2.5],
      // ucs2/utf16le: 1 code unit per 2 bytes → cap at `2×limit`. Old math (size/4) read ~4×limit.
      ["ucs2", limit * 2, limit * 3],
      // hex: 2 chars per byte → cap at `limit/2`. Old math (size/2) read ~2×limit.
      ["hex", limit / 2, limit * 1.25],
      // base64: 4 chars per 3 bytes → cap at `3×limit/4`. Old math (size/3) read ~3×limit.
      ["base64", (limit * 3) / 4, limit * 1.75],
      ["base64url", (limit * 3) / 4, limit * 1.75],
    ] as const;

    describe.each(["sync", "async"] as const)("%s", flavor => {
      test.each(cases)("%s", async (encoding, expected, max) => {
        const before = rchar();
        if (flavor === "sync") {
          expect(() => readFileSync("/dev/zero", encoding)).toThrow("ENOMEM");
        } else {
          await expect(readFile("/dev/zero", encoding)).rejects.toThrow("ENOMEM");
        }
        const read = rchar() - before;
        Bun.gc(true);
        // Must have read at least up to the threshold (the call can't have
        // bailed out early for some unrelated reason).
        expect(read).toBeGreaterThanOrEqual(expected);
        // Must have stopped well short of what the old inverted math would
        // have read.
        expect(read).toBeLessThan(max);
      });
    });
  });
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
