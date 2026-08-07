import { describe, expect, test } from "bun:test";
import { bunRun, isASAN, isBroken } from "harness";
import { join } from "path";

describe("Worker destruction", () => {
  const method = ["Bun.connect", "Bun.listen", "fetch"];
  describe.each(method)("bun when %s is used in a Worker that is terminating", method => {
    // fetch: ASAN failure
    // ASAN builds have WebKit assertions enabled, and terminate() landing
    // during the worker's module loads trips one (tracked in #34655).
    test.concurrent.skipIf((isBroken && method == "fetch") || isASAN)("exits cleanly", async () => {
      expect(await bunRun([join(import.meta.dir, "worker_thread_check.ts"), method])).toSpawn();
    });
  });
});
