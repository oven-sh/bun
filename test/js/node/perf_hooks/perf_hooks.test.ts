import { describe, expect, test } from "bun:test";
import perf from "perf_hooks";
import { Worker } from "worker_threads";

const { eventLoopUtilization } = perf.performance;

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

// The sleeps and busy-waits below are the quantity under test (ELU measures
// how event-loop wall time is split), not a wait for an unrelated condition.
describe("performance.eventLoopUtilization", () => {
  test("reports real, internally consistent loop time", () => {
    const elu = eventLoopUtilization();
    // The loop has existed for the whole process, part of which ran this file.
    expect(elu.active).toBeGreaterThan(0);
    expect(elu.idle).toBeGreaterThanOrEqual(0);
    expect(elu.utilization).toBeGreaterThan(0);
    expect(elu.utilization).toBeLessThanOrEqual(1);
    expect(elu.utilization).toBe(elu.active / (elu.idle + elu.active));
  });

  test("a synchronous block is reported as active time", async () => {
    // Land inside a loop tick rather than in test-runner setup.
    await Bun.sleep(5);
    const before = eventLoopUtilization();
    const start = Date.now();
    while (Date.now() - start < 100) {}
    const delta = eventLoopUtilization(before);

    // The loop never ticked between the two reads, so no idle time accrued.
    expect(delta.idle).toBeLessThan(1);
    expect(delta.active).toBeGreaterThanOrEqual(95);
    expect(delta.utilization).toBeGreaterThan(0.99);
    expect(delta.utilization).toBeLessThanOrEqual(1);
  });

  test("an awaited timer is reported as idle time", async () => {
    const before = eventLoopUtilization();
    const wallStart = performance.now();
    await Bun.sleep(100);
    const wallElapsed = performance.now() - wallStart;
    const delta = eventLoopUtilization(before);

    // Nothing else was scheduled, so the loop spent most of the awaited
    // window blocked in its I/O poll.
    expect(delta.idle).toBeGreaterThan(wallElapsed / 2);
    expect(delta.active).toBeGreaterThanOrEqual(0);
    expect(delta.utilization).toBeGreaterThanOrEqual(0);
    expect(delta.utilization).toBeLessThan(0.5);
    // active + idle covers at least the elapsed wall time.
    expect(delta.active + delta.idle).toBeGreaterThanOrEqual(wallElapsed - 1);
  });

  test("eventLoopUtilization(a, b) diffs two earlier samples", async () => {
    const a = eventLoopUtilization();
    await Bun.sleep(20);
    const b = eventLoopUtilization();

    const idle = b.idle - a.idle;
    const active = b.active - a.active;
    expect(eventLoopUtilization(b, a)).toEqual({
      idle,
      active,
      utilization: active / (idle + active),
    });
    expect(idle).toBeGreaterThan(0);
  });

  test("a Worker reports its own loop, not the main thread's", async () => {
    // The worker pins its own loop at ~1.0 utilization with a synchronous
    // block; the main thread does nothing but wait. The two must differ.
    const worker = new Worker(
      `const { parentPort } = require("node:worker_threads");
       const { performance } = require("node:perf_hooks");
       setTimeout(() => {
         const a = performance.eventLoopUtilization();
         const t = Date.now();
         while (Date.now() - t < 100) {}
         parentPort.postMessage(performance.eventLoopUtilization(a));
       }, 10);`,
      { eval: true },
    );
    const { promise, resolve, reject } = Promise.withResolvers<ReturnType<typeof eventLoopUtilization>>();
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", code => {
      if (code !== 0) reject(new Error(`worker exited with ${code}`));
    });

    try {
      const mainBefore = eventLoopUtilization();
      const workerDelta = await promise;
      const mainDelta = eventLoopUtilization(mainBefore);

      expect(workerDelta.idle).toBeLessThan(1);
      expect(workerDelta.active).toBeGreaterThanOrEqual(95);
      expect(workerDelta.utilization).toBeGreaterThan(0.99);
      // Over the same wall window the main thread was mostly blocked in its
      // own poll waiting for the worker's message.
      expect(mainDelta.idle).toBeGreaterThan(mainDelta.active);
    } finally {
      await worker.terminate();
    }
  });
});

describe("performance.nodeTiming", () => {
  test("idleTime grows while the loop is idle", async () => {
    const { nodeTiming } = perf.performance;
    const before = nodeTiming.idleTime;
    expect(before).toBeGreaterThanOrEqual(0);
    await Bun.sleep(50);
    const after = nodeTiming.idleTime;
    expect(after).toBeGreaterThan(before);
    // It is the same counter eventLoopUtilization() reports, read later.
    expect(eventLoopUtilization().idle).toBeGreaterThanOrEqual(after);
  });
});

test("doesn't throw", () => {
  expect(() => performance.mark("test")).not.toThrow();
  expect(() => performance.measure("test", "test")).not.toThrow();
  expect(() => performance.clearMarks()).not.toThrow();
  expect(() => performance.clearMeasures()).not.toThrow();
  expect(() => performance.getEntries()).not.toThrow();
  expect(() => performance.getEntriesByName("test")).not.toThrow();
  expect(() => performance.getEntriesByType("measure")).not.toThrow();
  expect(() => performance.now()).not.toThrow();
  expect(() => performance.timeOrigin).not.toThrow();
  expect(() => performance.markResourceTiming()).not.toThrow();
});
