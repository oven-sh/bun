import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

test("sleep should saturate timeout values", async () => {
  const fixturesThatShouldTimeout = [
    "Infinity",
    "999999999999999",
    "999999999999999.999999999999999",
    "999999999999999",
  ];
  const fixturesThatSHouldCompleteInstantly = [
    "0",
    "0.0",
    "-0",
    "-0.1",
    "-0.0000000000000001",
    "-999999999999999",
    "-999999999999999.999999999999999",
  ];
  const ASAN_MULTIPLIER = isASAN ? 2 : 1;

  const toKill = fixturesThatShouldTimeout.map(timeout => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "sleep-4ever.js", timeout],
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
      env: bunEnv,
      cwd: import.meta.dir,
    });
    return proc;
  });

  const start = performance.now();
  const toWait = fixturesThatSHouldCompleteInstantly.map(async timeout => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "sleep-4ever.js", timeout],
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
      env: bunEnv,
      cwd: import.meta.dir,
    });
    expect(await proc.exited).toBe(0);
    expect(performance.now() - start).toBeLessThan(1000 * ASAN_MULTIPLIER);
  });

  await Promise.all(toWait);
  for (let i = 0; i < toKill.length; i++) {
    const proc = toKill[i];
    if (proc.exitCode === 0) {
      console.warn("warn: Expected process #", i, "to timeout, but it didn't");
    }
    expect(proc.exitCode).toBe(null);
  }

  const allExited = Promise.all(toKill.map(proc => proc.exited));
  toKill.forEach(proc => proc.kill());

  await allExited;
});

test("sleep should keep the event loop alive", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "sleep-keepalive.ts"],
    stderr: "inherit",
    stdout: "pipe",
    stdin: "inherit",
    env: bunEnv,
    cwd: import.meta.dir,
  });
  await proc.exited;
  expect(proc.exitCode).toBe(0);
  expect(await proc.stdout.text()).toContain("event loop was not killed");
});
