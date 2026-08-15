import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

test("we can go back in time", () => {
  const DateBeforeMocked = Date;
  const orig = new Date();
  orig.setHours(0, 0, 0, 0);
  jest.useFakeTimers();
  jest.setSystemTime(new Date("1995-12-19T00:00:00.000Z"));

  expect(new Date().toISOString()).toBe("1995-12-19T00:00:00.000Z");
  expect(Date.now()).toBe(819331200000);

  if (typeof Bun !== "undefined") {
    // In bun, the Date object remains the same despite being mocked.
    // This prevents a whole bunch of subtle bugs in tests.
    expect(DateBeforeMocked).toBe(Date);
    expect(DateBeforeMocked.now).toBe(Date.now);

    // Jest doesn't property mock new Intl.DateTimeFormat().format()
    expect(new Intl.DateTimeFormat().format()).toBe("12/19/1995");
  } else {
    expect(DateBeforeMocked).not.toBe(Date);
    expect(DateBeforeMocked.now).not.toBe(Date.now);
  }
  jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z").getTime());
  expect(new Date().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  expect(Date.now()).toBe(1577836800000);
  jest.useRealTimers();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expect(now.toISOString()).toBe(orig.toISOString());
});

test("advanceTimersByTime ticks from the setSystemTime value", () => {
  jest.useFakeTimers();
  try {
    const base = new Date("2026-01-01T12:00:00.000Z").getTime();
    jest.setSystemTime(new Date(base));
    expect(Date.now()).toBe(base);

    jest.advanceTimersByTime(1000);
    expect(Date.now()).toBe(base + 1000);
    expect(new Date().toISOString()).toBe("2026-01-01T12:00:01.000Z");

    jest.advanceTimersByTime(500);
    expect(Date.now()).toBe(base + 1500);

    // setSystemTime with a number argument rebases again
    jest.setSystemTime(base);
    jest.advanceTimersByTime(2000);
    expect(Date.now()).toBe(base + 2000);
  } finally {
    jest.useRealTimers();
  }
});

test("setSystemTime accepts pre-epoch and epoch times and resets with no argument", () => {
  const realBefore = Date.now();
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date("1960-01-01T00:00:00.000Z"));
    expect(Date.now()).toBe(-315619200000);
    expect(new Date().toISOString()).toBe("1960-01-01T00:00:00.000Z");

    jest.setSystemTime(0);
    expect(Date.now()).toBe(0);

    // -1 is an ordinary timestamp (1969-12-31T23:59:59.999Z), not a sentinel.
    jest.setSystemTime(-1);
    expect(Date.now()).toBe(-1);

    jest.setSystemTime();
    expect(Date.now()).toBeGreaterThanOrEqual(realBefore);
  } finally {
    jest.useRealTimers();
  }
});

test.each(["'x'", "Symbol()", "1n"])("useFakeTimers does not crash when globalThis.setTimeout is %s", async value => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `globalThis.setTimeout = ${value};
         const jest = Bun.jest().jest;
         jest.useFakeTimers();
         jest.useRealTimers();
         console.log("ok");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  expect(proc.signalCode).toBeNull();
});

test("real timer heap is ticked against the real clock under useFakeTimers", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "test-timers-gc-spin-fixture.ts")],
    env: { ...bunEnv, BUN_GC_TIMER_DISABLE: undefined, BUN_GC_TIMER_INTERVAL: undefined },
    stdout: "pipe",
    stderr: "pipe",
    // Pre-fix the child spins at 100% CPU; bound it so it doesn't outlive the
    // runner by long when the parent test times out on the unfixed build.
    timeout: 20_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error(stderr);
  expect(stdout).toContain("DRAIN_OK");
  // null => exited on its own; non-null => killed by the spawn timeout (spun).
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// Every fixture below waits on a timer that does not keep the event loop alive
// (an unref'd setTimeout, or the per-test timeout) with nothing else ref'ing
// the loop, and prints how much CPU the process burned while waiting. The loop
// has to sleep until the deadline: it used to return from every poll at once
// while nothing ref'd it, so each of these waits spun at 100% CPU for its whole
// duration. The fixtures cover each wait loop that polls this way: the test
// runner's own loop, the nested wait behind `expect().resolves`, and `bun run`
// waiting for a top-level await.
const IDLE_MS = 1000;

const idleLoopFixtures = {
  "idle-window.ts": `
    export function startIdleWindow() {
      const cpu0 = process.cpuUsage();
      const t0 = performance.now();
      return () => {
        const cpu = process.cpuUsage(cpu0);
        console.log(JSON.stringify({ cpuMs: (cpu.user + cpu.system) / 1000, wallMs: performance.now() - t0 }));
      };
    }
  `,
  "per-test-timeout.test.ts": `
    import { afterAll, test } from "bun:test";
    import { startIdleWindow } from "./idle-window";
    let endIdleWindow: () => void;
    afterAll(() => endIdleWindow());
    test("never settles; the per-test timeout ends it", async () => {
      endIdleWindow = startIdleWindow();
      await new Promise(() => {});
    }, ${IDLE_MS});
  `,
  "unref-timer.test.ts": `
    import { test } from "bun:test";
    import { startIdleWindow } from "./idle-window";
    test("awaits an unref'd timer", async () => {
      const endIdleWindow = startIdleWindow();
      await new Promise(resolve => setTimeout(resolve, ${IDLE_MS}).unref());
      endIdleWindow();
    });
  `,
  "expect-resolves.test.ts": `
    import { expect, test } from "bun:test";
    import { startIdleWindow } from "./idle-window";
    test("expect().resolves waits for an unref'd timer", async () => {
      const endIdleWindow = startIdleWindow();
      await expect(new Promise(resolve => setTimeout(() => resolve(1), ${IDLE_MS}).unref())).resolves.toBe(1);
      endIdleWindow();
    });
  `,
  "top-level-await.ts": `
    import { startIdleWindow } from "./idle-window";
    const endIdleWindow = startIdleWindow();
    await new Promise(resolve => setTimeout(resolve, ${IDLE_MS}).unref());
    endIdleWindow();
  `,
};

test.concurrent.each([
  ["bun test waiting for the per-test timeout", ["test", "per-test-timeout.test.ts"], 1],
  ["bun test waiting for an unref'd setTimeout", ["test", "unref-timer.test.ts"], 0],
  ["expect().resolves waiting for an unref'd setTimeout", ["test", "expect-resolves.test.ts"], 0],
  ["bun run waiting for a top-level await on an unref'd setTimeout", ["run", "top-level-await.ts"], 0],
])("%s sleeps instead of spinning", async (_, args, expectedExitCode) => {
  using dir = tempDir("idle-loop", idleLoopFixtures);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const report = stdout.split("\n").find(line => line.startsWith("{"));
  expect(report, stdout + stderr).toBeDefined();
  const { cpuMs, wallMs } = JSON.parse(report!);
  expect(wallMs).toBeGreaterThanOrEqual(IDLE_MS * 0.9);
  // Spinning costs about IDLE_MS of CPU; sleeping costs a few ms (tens under
  // debug + ASAN, mostly the idle GC timer firing once).
  expect(cpuMs).toBeLessThan(IDLE_MS / 2);
  expect(exitCode).toBe(expectedExitCode);
});
