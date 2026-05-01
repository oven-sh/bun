import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("spawn AbortSignal works after spawning", async () => {
  const controller = new AbortController();
  const { signal } = controller;
  const start = performance.now();
  const subprocess = Bun.spawn({
    cmd: [bunExe(), "--eval", "await Bun.sleep(100000)"],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    signal,
  });
  await Bun.sleep(1);
  controller.abort();
  expect(await subprocess.exited).not.toBe(0);
  const end = performance.now();
  expect(end - start).toBeLessThan(100);
});

test("spawn AbortSignal works if already aborted", async () => {
  const controller = new AbortController();
  const { signal } = controller;
  const start = performance.now();
  const subprocess = Bun.spawn({
    cmd: [bunExe(), "--eval", "await Bun.sleep(100000)"],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    signal,
  });
  await Bun.sleep(1);
  controller.abort();
  expect(await subprocess.exited).not.toBe(0);
  const end = performance.now();
  expect(end - start).toBeLessThan(100);
});

test("spawn AbortSignal args validation", async () => {
  expect(() =>
    Bun.spawn({
      cmd: [bunExe(), "--eval", "await Bun.sleep(100000)"],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      signal: 123,
    }),
  ).toThrow();
});

test("spawnSync AbortSignal works as timeout", async () => {
  const start = performance.now();
  const subprocess = Bun.spawnSync({
    cmd: [bunExe(), "--eval", "await Bun.sleep(100000)"],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    signal: AbortSignal.timeout(10),
  });

  expect(subprocess.success).toBeFalse();
  const end = performance.now();
  expect(end - start).toBeLessThan(100);
});
