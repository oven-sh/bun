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
  const start = performance.now();
  const subprocess = Bun.spawn({
    cmd: [bunExe(), "--eval", "await Bun.sleep(100000)"],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    signal: AbortSignal.abort(),
  });
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

test("spawnSync with already-aborted AbortSignal kills the process", () => {
  // On POSIX, Process.kill() previously no-op'd when the poller was still in its
  // initial `.detached` state. Because the abort listener fires synchronously before
  // watchOrReap() upgrades the poller, an already-aborted signal left the child
  // running and spawnSync blocked until the child exited on its own.
  const subprocess = Bun.spawnSync({
    cmd: [bunExe(), "--eval", "await Bun.sleep(100000)"],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    signal: AbortSignal.abort(),
  });

  expect(subprocess.success).toBeFalse();
  expect(subprocess.exitedDueToTimeout).toBeUndefined();
  if (process.platform !== "win32") {
    expect(subprocess.signalCode).toBe("SIGTERM");
  }
});

test("spawnSync with already-aborted AbortSignal kills the process (piped stdio)", () => {
  // Same as above but with default (piped) stdio to cover the non-inherit path.
  const subprocess = Bun.spawnSync({
    cmd: [bunExe(), "--eval", "await Bun.sleep(100000)"],
    env: bunEnv,
    signal: AbortSignal.abort(),
  });

  expect(subprocess.success).toBeFalse();
  expect(subprocess.exitedDueToTimeout).toBeUndefined();
  if (process.platform !== "win32") {
    expect(subprocess.signalCode).toBe("SIGTERM");
  }
});
