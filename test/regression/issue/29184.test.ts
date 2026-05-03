// https://github.com/oven-sh/bun/issues/29184
//
// `fs.readFile` on a non-terminating source (e.g. `/dev/urandom`) used to
// read forever: `shouldThrowOutOfMemoryEarlyForJavaScript` computed the
// *minimum* possible output-string length (e.g. `size / 2 - 1` for hex) and
// compared against the allocation limit, so the early-throw only fired once
// the accumulated read had grown far past what the resulting JS string
// could hold. The process kept pulling bytes at 100% CPU until the OOM
// killer arrived.
//
// The check should compute the *maximum* possible output length instead, so
// the limit is enforced on the resulting JS string, not on a fraction of
// it. `hex` is the cleanest regression target: stock code used `size/2 - 1`
// (half the input), the fix uses `size * 2` (the actual output length), so
// for a file that sits between those thresholds the behavior flips from
// "silently succeeds" to "rejects with ENOMEM".
//
// Setup: `setSyntheticAllocationLimitForTesting` lowers the string limit to
// 4 MiB. With that limit + `encoding: "hex"` on a ~2 MiB file:
//   - Stock (buggy):  `size / 2 - 1` ≈ 1 MiB < 4 MiB → no throw → returns a
//                     ~4 MiB hex string.
//   - Fixed:          `size * 2`     ≈ 4 MiB + 2    → throws ENOMEM.

import { memfd_create, setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { isLinux } from "harness";
import { closeSync, writeSync } from "node:fs";
import fs from "node:fs/promises";

// Previous limit, restored in `afterAll` so we don't leak VM-global state into
// whichever test file runs next in the same process.
let previousSyntheticLimit = 0;
beforeAll(() => {
  previousSyntheticLimit = setSyntheticAllocationLimitForTesting(4 * 1024 * 1024);
});
afterAll(() => {
  setSyntheticAllocationLimitForTesting(previousSyntheticLimit);
});

test.skipIf(!isLinux)("fs.readFile hex-encoded rejects when the would-be string exceeds the limit", async () => {
  // 2 MiB + 1 byte of input → 4 MiB + 2 hex chars of output.
  const size = 2 * 1024 * 1024 + 1;
  const fd = memfd_create(size);
  try {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.fill(0x42);
    for (let off = 0; off < size; off += chunk.byteLength) {
      writeSync(fd, chunk, 0, Math.min(chunk.byteLength, size - off), off);
    }
    await expect(fs.readFile(fd, { encoding: "hex" })).rejects.toThrow("ENOMEM: not enough memory");
  } finally {
    closeSync(fd);
    Bun.gc(true);
  }
});

test.skipIf(!isLinux)("fs.readFile on /dev/urandom rejects instead of reading forever (issue repro)", async () => {
  // Direct reproduction from the issue. With the 4 MiB limit applied above,
  // this rejects after ~4 MiB of reads instead of never. Gated to Linux
  // because the reporter's environment (and Bun's existing `/dev/zero`
  // regression coverage in `test/js/node/fs/fs-oom.test.ts`) is Linux; the
  // hex memfd test above proves the same code path under the same synthetic
  // limit.
  await expect(fs.readFile("/dev/urandom", { encoding: "utf8" })).rejects.toThrow(
    "ENOMEM: not enough memory, read '/dev/urandom'",
  );
});

test("fs.readFile on a small regular file still returns its contents", async () => {
  // Sanity-check that narrowing the early-throw limit didn't break the
  // common case.
  const self = Bun.fileURLToPath(import.meta.url);
  const contents = await fs.readFile(self, { encoding: "utf8" });
  expect(typeof contents).toBe("string");
  expect(contents.length).toBeGreaterThan(0);
  expect(contents).toContain("29184");
});
