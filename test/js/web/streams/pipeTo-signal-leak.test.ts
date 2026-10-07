import { setAbortAlgorithmIdentifier } from "bun:internal-for-testing";
import { estimateShallowMemoryUsageOf, heapStats } from "bun:jsc";
import { describe, expect, jest, test } from "bun:test";
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

  describe("abort algorithm identifiers past 2^32", () => {
    // Stays pending until the signal aborts: its source never produces a chunk.
    const pendingPipe = (signal: AbortSignal, cancel: (reason: unknown) => void) =>
      new ReadableStream({ pull: () => new Promise(() => {}), cancel }).pipeTo(new WritableStream({}), { signal });
    // Its source is closed, so it finishes and unregisters from the signal.
    const finishedPipe = (signal: AbortSignal) =>
      new ReadableStream({ start: controller => controller.close() }).pipeTo(new WritableStream({}), { signal });

    test("a pipe that finishes removes its abort algorithm when its identifier is 2^32", async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      const reason = new Error("stop");

      const long = pendingPipe(signal, () => {}); // identifier 1
      const withLongPipe = estimateShallowMemoryUsageOf(signal);

      // The next pipe draws 2^32. Its low 32 bits are 0, the value a pipe holds for "not registered".
      setAbortAlgorithmIdentifier(signal, 0xffff_ffff);
      await finishedPipe(signal);
      expect(estimateShallowMemoryUsageOf(signal)).toBe(withLongPipe);

      controller.abort(reason);
      expect(await long.catch(error => error)).toBe(reason);
    });

    test("abort() reaches a pending pipe after a pipe with an identifier 2^32 higher finished", async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      const reason = new Error("stop");

      const cancelLong = jest.fn();
      const long = pendingPipe(signal, cancelLong); // identifier 1

      // The next two pipes draw 2^32 and 2^32 + 1.
      setAbortAlgorithmIdentifier(signal, 0xffff_ffff);
      await finishedPipe(signal);
      await finishedPipe(signal);

      // Abort algorithms run in registration order: when this source is cancelled, `long` had its turn.
      const fenceCancelled = Promise.withResolvers<unknown>();
      const fence = pendingPipe(signal, fenceCancelled.resolve);
      const errors = Promise.all([long, fence].map(pipe => pipe.catch(error => error)));

      controller.abort(reason);
      expect(await fenceCancelled.promise).toBe(reason);
      expect(cancelLong.mock.calls).toEqual([[reason]]);
      const [longError, fenceError] = await errors;
      expect(longError).toBe(reason);
      expect(fenceError).toBe(reason);
    });
  });
});
