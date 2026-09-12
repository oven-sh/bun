import { sleepSync } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

it("sleepSync uses milliseconds", async () => {
  const start = performance.now();
  sleepSync(50);
  const end = performance.now();
  expect(end - start).toBeGreaterThanOrEqual(5);
  expect(end - start).toBeLessThan(1000);
});

it("sleepSync with no arguments throws", async () => {
  // @ts-expect-error
  expect(() => sleepSync()).toThrow();
});

it("sleepSync with non-numbers throws", async () => {
  const invalidValues = [true, false, "hi", {}, [], undefined, null] as any[];
  for (const v of invalidValues) {
    expect(() => sleepSync(v)).toThrow();
  }
});

it("sleepSync with negative number throws", async () => {
  expect(() => sleepSync(-10)).toThrow();
});

it("can map with sleepSync", async () => {
  [1, 2, 3].map(sleepSync);
});

// sleepSync used to re-arm a relative nanosleep with the remaining time after
// every EINTR, so once a signal handler was installed each delivery added its
// round trip to the sleep, and a fast enough stream of signals kept sleepSync
// from returning until the stream stopped. The child floods itself with SIGUSR2
// from a `sh` loop and times a 100 ms sleepSync while the flood is running.
it.skipIf(isWindows)("sleepSync returns on time while signals are being delivered", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { promise: firstSignal, resolve } = Promise.withResolvers();
      process.on("SIGUSR2", resolve);
      const flood = Bun.spawn({
        cmd: ["sh", "-c", "i=0; while [ $i -lt 1000000 ] && kill -s USR2 " + process.pid + "; do i=$((i+1)); done"],
        stdio: ["ignore", "ignore", "ignore"],
      });
      await firstSignal;
      const start = performance.now();
      Bun.sleepSync(100);
      const elapsed = performance.now() - start;
      flood.kill();
      console.log(JSON.stringify({ elapsed }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { elapsed } = JSON.parse(stdout);
  // Without the fix this is however long the flood lasts (seconds).
  expect(elapsed).toBeGreaterThanOrEqual(100);
  expect(elapsed).toBeLessThan(1000);
  expect(exitCode).toBe(0);
});
