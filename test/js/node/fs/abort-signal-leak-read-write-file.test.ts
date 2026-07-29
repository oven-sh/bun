import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import fs from "fs";
import { isASAN, isDebug, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/pull/16788
test("fs.promises readFile/writeFile does not leak AbortSignal", async () => {
  using dir = tempDir("fs-abort-signal-leak", { blah: "blah" });
  const target = join(String(dir), "blah");
  const noop = () => {};

  // pre-aborted signal: readFile/writeFile reject immediately and must release
  // the signal reference on the early-return path.
  await expect(fs.promises.readFile(target, { signal: AbortSignal.abort() })).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(fs.promises.writeFile(target, "blah", { signal: AbortSignal.abort() })).rejects.toMatchObject({
    name: "AbortError",
  });

  // abort after the write has been scheduled: the async completion path must
  // also release the signal reference. The write may legitimately finish before
  // nextTick fires, so either resolution or AbortError is acceptable here.
  {
    const controller = new AbortController();
    const prom = fs.promises.writeFile(target, "blah", { signal: controller.signal });
    process.nextTick(() => controller.abort());
    await prom.catch(e => expect(e).toMatchObject({ name: "AbortError" }));
  }

  // Leak detector. A JSAbortSignal wrapper is only pinned by hasPendingActivity()
  // when the signal is NOT aborted AND has an abort listener (see
  // JSAbortSignalCustom.cpp), so the loop below uses a never-aborted signal with
  // a no-op listener: if readFile/writeFile forget to drop the pending-activity
  // ref they take, every one of these wrappers survives GC and the object count
  // below climbs with ITERATIONS instead of staying flat.
  const ITERATIONS = isDebug || isASAN ? 100 : 2_000;
  for (let i = 0; i < ITERATIONS; i++) {
    const controller = new AbortController();
    controller.signal.addEventListener("abort", noop);
    await fs.promises.writeFile(target, "blah", { signal: controller.signal });
    await fs.promises.readFile(target, { signal: controller.signal });
  }

  Bun.gc(true);
  const numAbortSignalObjects = heapStats().objectTypeCounts.AbortSignal ?? 0;
  expect(numAbortSignalObjects).toBeLessThanOrEqual(10);
});
