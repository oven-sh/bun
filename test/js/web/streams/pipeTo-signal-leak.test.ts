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

// One signal can serve many pipes. It keeps their abort algorithms in pipeTo()
// order, and a pipe that finishes takes its own out of the middle.
describe("ReadableStream.pipeTo with many pipes on one AbortSignal", () => {
  function pipe(signal: AbortSignal, onAbort?: () => void) {
    let source!: ReadableStreamDefaultController;
    const readable = new ReadableStream({
      start(controller) {
        source = controller;
      },
    });
    const writable = new WritableStream({
      abort() {
        onAbort?.();
      },
    });
    const outcome = readable.pipeTo(writable, { signal }).then(
      () => "finished",
      (error: Error) => error.name,
    );
    return { finish: () => source.close(), outcome };
  }

  test("the pipes that are left abort in pipeTo() order", async () => {
    const controller = new AbortController();
    const aborted: number[] = [];
    const pipes = Array.from({ length: 40 }, (_, i) => pipe(controller.signal, () => aborted.push(i)));

    // From the middle, then the first, the last, and the one that became the last.
    const finished = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 0, 39, 38];
    for (const i of finished) {
      pipes[i].finish();
      expect(await pipes[i].outcome).toBe("finished");
    }
    // The collector visits the abort algorithms that are left.
    Bun.gc(true);

    controller.abort();
    const outcomes = await Promise.all(pipes.map(({ outcome }) => outcome));
    const left = pipes.map((_, i) => i).filter(i => !finished.includes(i));
    expect(aborted).toEqual(left);
    expect(outcomes).toEqual(pipes.map((_, i) => (finished.includes(i) ? "finished" : "AbortError")));
  });

  test("a signal whose pipes all finished serves the next pipes", async () => {
    const controller = new AbortController();
    const first = Array.from({ length: 100 }, () => pipe(controller.signal));
    // Every third from the front, every third from the back, then the rest.
    for (let i = 0; i < 100; i += 3) first[i].finish();
    for (let i = 99; i >= 0; i--) if (i % 3 === 1) first[i].finish();
    for (let i = 0; i < 100; i++) if (i % 3 === 2) first[i].finish();
    expect(await Promise.all(first.map(({ outcome }) => outcome))).toEqual(Array(100).fill("finished"));

    const aborted: number[] = [];
    const second = Array.from({ length: 3 }, (_, i) => pipe(controller.signal, () => aborted.push(i)));
    controller.abort();
    expect(await Promise.all(second.map(({ outcome }) => outcome))).toEqual(Array(3).fill("AbortError"));
    expect(aborted).toEqual([0, 1, 2]);
  });
});
