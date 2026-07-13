import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import perf from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

test("eventLoopUtilization reflects event loop activity", async () => {
  // Let the event loop start and idle a bit.
  await Bun.sleep(50);

  const e1 = perf.performance.eventLoopUtilization();
  expect(e1.idle).toBeGreaterThan(0);
  expect(e1.active).toBeGreaterThan(0);
  expect(e1.utilization).toBeGreaterThan(0);
  expect(e1.utilization).toBeLessThanOrEqual(1);

  // Sleeping blocks the loop in the poll phase: idle must accrue.
  const beforeSleep = perf.performance.eventLoopUtilization();
  await Bun.sleep(100);
  const sleepDelta = perf.performance.eventLoopUtilization(beforeSleep);
  expect(sleepDelta.idle).toBeGreaterThan(50);
  expect(sleepDelta.utilization).toBeGreaterThan(0);
  expect(sleepDelta.utilization).toBeLessThanOrEqual(1);

  // A synchronous block is pure active time.
  const beforeBlock = perf.performance.eventLoopUtilization();
  const start = Date.now();
  while (Date.now() - start < 100) {}
  const blockDelta = perf.performance.eventLoopUtilization(beforeBlock);
  expect(blockDelta.active).toBeGreaterThan(90);
  expect(blockDelta.utilization).toBeGreaterThan(0.9);

  // Cumulative values are monotonic.
  const e2 = perf.performance.eventLoopUtilization();
  expect(e2.idle).toBeGreaterThanOrEqual(e1.idle);
  expect(e2.active).toBeGreaterThanOrEqual(e1.active);
});

test("eventLoopUtilization computes the delta between two snapshots", () => {
  const u1 = { idle: 100, active: 300, utilization: 0.75 };
  const u2 = { idle: 80, active: 140, utilization: 140 / 220 };
  expect(perf.performance.eventLoopUtilization(u1, u2)).toEqual({
    idle: 20,
    active: 160,
    utilization: 160 / 180,
  });
});

test("eventLoopUtilization returns zeros before the event loop starts", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.log(JSON.stringify(require("perf_hooks").performance.eventLoopUtilization()))`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: JSON.parse(stdout), exitCode }).toEqual({
    stdout: { idle: 0, active: 0, utilization: 0 },
    exitCode: 0,
  });
});

test("nodeTiming.idleTime and loopStart reflect the event loop", async () => {
  await Bun.sleep(10);
  const nodeTiming = perf.performance.nodeTiming;

  const idle1 = nodeTiming.idleTime;
  await Bun.sleep(100);
  const idle2 = nodeTiming.idleTime;
  expect(idle2).toBeGreaterThan(idle1 + 50);

  const loopStart = nodeTiming.loopStart;
  expect(loopStart).toBeGreaterThan(0);
  expect(loopStart).toBeLessThanOrEqual(perf.performance.now());
  // loopStart is a fixed point in time: repeated reads must agree.
  expect(Math.abs(nodeTiming.loopStart - loopStart)).toBeLessThan(50);
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
