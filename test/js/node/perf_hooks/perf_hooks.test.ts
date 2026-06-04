import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import perf from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

test("monitorEventLoopDelay keeps recording under GC pressure", async () => {
  // The native monitor records into the histogram object from the timer fire
  // path. The histogram must stay rooted while monitoring is enabled, even
  // when user code drops its own references and the GC runs aggressively
  // between event-loop turns; enable/disable cycles must set/clear that root
  // without crashing or losing the ability to record.
  const script = `
    const { monitorEventLoopDelay } = require("node:perf_hooks");
    {
      let h = monitorEventLoopDelay({ resolution: 1 });
      h.enable();
      h = null;
    }
    // Force GC with no user-held reference while the monitor is enabled.
    for (let i = 0; i < 5; i++) {
      Bun.gc(true);
      const end = Date.now() + 10;
      while (Date.now() < end) {} // block the loop > resolution
      await Bun.sleep(2); // let the monitor timer fire
    }
    // Re-acquire the histogram (module returns the same instance) and wait
    // for at least one recorded sample.
    const h = monitorEventLoopDelay({ resolution: 1 });
    const deadline = Date.now() + 10_000;
    while (h.count === 0 && Date.now() < deadline) {
      Bun.gc(true);
      const end = Date.now() + 10;
      while (Date.now() < end) {}
      await Bun.sleep(2);
    }
    if (h.count === 0) throw new Error("no event-loop-delay samples recorded");
    if (!(h.max > 0)) throw new Error("expected max > 0, got " + h.max);
    // Disable/enable cycle: the root must be cleared and re-established.
    h.disable();
    Bun.gc(true);
    h.enable();
    Bun.gc(true);
    const end = Date.now() + 10;
    while (Date.now() < end) {}
    await Bun.sleep(2);
    h.disable();
    console.log("OK");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 30_000);

test("monitorEventLoopDelay enabled at process exit does not crash teardown", async () => {
  // The monitor's histogram root is released during VM teardown while the JS
  // heap is still alive; exiting with monitoring enabled must not crash.
  const script = `
    const { monitorEventLoopDelay } = require("node:perf_hooks");
    const h = monitorEventLoopDelay({ resolution: 1 });
    h.enable();
    const end = Date.now() + 10;
    while (Date.now() < end) {}
    await Bun.sleep(5);
    console.log("OK");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 15_000);

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
