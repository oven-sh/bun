import { bunEnv, bunExe } from "harness";
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
