import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { expectMaxObjectTypeCount } from "harness";

describe("ReadableStream.pipeTo with AbortSignal", () => {
  // Regression: when pipeTo() is passed a signal and the pipe never completes,
  // dropping all JS references to the signal should allow it to be collected.
  // Previously, a Strong ref cycle (AbortSignal -> AbortAlgorithm ->
  // Strong<callback> -> closure -> pipeState.signal -> JSAbortSignal ->
  // Ref<AbortSignal>) caused a 100% leak.
  test("dropping signal references should not leak AbortSignal when pipe never completes", async () => {
    const baseline = heapStats().objectTypeCounts.AbortSignal || 0;
    const iterations = 200;

    function iteration() {
      const controller = new AbortController();
      const rs = new ReadableStream({
        pull() {
          // Never enqueue, never close: pipe stays pending forever.
          return new Promise(() => {});
        },
      });
      const ws = new WritableStream({});
      rs.pipeTo(ws, { signal: controller.signal }).catch(() => {});
      // All locals go out of scope here. If there is no Strong ref cycle,
      // GC should be able to reclaim the AbortSignal.
    }

    for (let i = 0; i < iterations; i++) {
      iteration();
    }

    // Allow microtasks to settle before GC.
    await Bun.sleep(0);

    // Allow some slack for GC timing, but nowhere near `iterations`.
    await expectMaxObjectTypeCount(expect, "AbortSignal", baseline + 20);
  });

  test("aborting signal still works and cleans up after pipe completes via abort", async () => {
    const baseline = heapStats().objectTypeCounts.AbortSignal || 0;
    const iterations = 200;

    async function iteration() {
      const controller = new AbortController();
      const rs = new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
      });
      const ws = new WritableStream({});
      const p = rs.pipeTo(ws, { signal: controller.signal });
      controller.abort();
      await p.catch(() => {});
    }

    for (let i = 0; i < iterations; i++) {
      await iteration();
    }

    await Bun.sleep(0);
    await expectMaxObjectTypeCount(expect, "AbortSignal", baseline + 20);
  });
});
