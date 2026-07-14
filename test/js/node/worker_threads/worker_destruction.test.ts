import { describe, expect, test } from "bun:test";
import "harness";
import { isBroken } from "harness";
import { isOhos } from "harness";
import { join } from "path";

describe.skipIf(isOhos)("Worker destruction", () => {
  const method = ["Bun.connect", "Bun.listen", "fetch"];
  describe.each(method)("bun when %s is used in a Worker that is terminating", method => {
    // fetch: ASAN failure
    test.skipIf(isBroken && method == "fetch")("exits cleanly", () => {
      expect([join(import.meta.dir, "worker_thread_check.ts"), method]).toRun();
    });
  });
});
