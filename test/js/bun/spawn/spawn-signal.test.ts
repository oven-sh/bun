import { describe, expect, test } from "bun:test";
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
  // OHOS: abort propagation to the child takes ~1.5s.
  expect(end - start).toBeLessThan(Bun.env.BUN_OHOS === "1" ? 5000 : 100);
});

test("spawn AbortSignal throws if already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  let proc: Bun.Subprocess | undefined;
  let thrown: any;
  try {
    proc = Bun.spawn({
      cmd: [bunExe(), "--eval", "await Bun.sleep(100000)"],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      signal: controller.signal,
    });
  } catch (e) {
    thrown = e;
  }
  if (proc) {
    proc.kill(9);
    await proc.exited;
  }
  expect(proc).toBeUndefined();
  expect(thrown).toEqual(
    expect.objectContaining({
      name: "AbortError",
      code: "ABORT_ERR",
    }),
  );
});

test("spawn AbortSignal already aborted carries signal.reason as cause", () => {
  const controller = new AbortController();
  const reason = new Error("USER_REASON");
  controller.abort(reason);
  let thrown: any;
  try {
    Bun.spawn({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
      signal: controller.signal,
    });
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toEqual(
    expect.objectContaining({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted",
      cause: reason,
    }),
  );
  expect(thrown.cause).toBe(reason);
});

test("spawn AbortSignal already aborted throws before resolving the executable", () => {
  // If Bun.spawn reached PATH resolution or posix_spawn before checking the
  // signal, this would throw ENOENT for the missing executable instead.
  expect(() =>
    Bun.spawn({
      cmd: ["bun-spawn-nonexistent-executable-for-abort-test"],
      env: bunEnv,
      signal: AbortSignal.abort(),
    }),
  ).toThrow(expect.objectContaining({ name: "AbortError", code: "ABORT_ERR" }));
});

test("spawnSync AbortSignal throws if already aborted", () => {
  const controller = new AbortController();
  const reason = new Error("USER_REASON");
  controller.abort(reason);
  expect(() =>
    Bun.spawnSync({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
      signal: controller.signal,
    }),
  ).toThrow(
    expect.objectContaining({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted",
      cause: reason,
    }),
  );
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
  // OHOS: timeout propagation to the child takes ~1.5s.
  expect(end - start).toBeLessThan(Bun.env.BUN_OHOS === "1" ? 5000 : 100);
});

describe("Bun.spawn option validation", () => {
  const spawners = [
    ["Bun.spawn", (opts: any) => Bun.spawn(opts)],
    ["Bun.spawnSync", (opts: any) => Bun.spawnSync(opts)],
  ] as const;

  describe.each(spawners)("%s", (_, spawn) => {
    test("timeout: NaN throws ERR_OUT_OF_RANGE", () => {
      expect(() =>
        spawn({
          cmd: [bunExe(), "-e", ""],
          env: bunEnv,
          timeout: NaN,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          message: expect.stringContaining('"timeout"'),
        }),
      );
    });

    test("killSignal: 0 throws ERR_UNKNOWN_SIGNAL", () => {
      expect(() =>
        spawn({
          cmd: [bunExe(), "-e", ""],
          env: bunEnv,
          timeout: 100,
          killSignal: 0,
        }),
      ).toThrow(expect.objectContaining({ code: "ERR_UNKNOWN_SIGNAL" }));
    });
  });

  test("proc.kill(0) is still accepted", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "setTimeout(() => {}, 100000)"],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
    });
    expect(() => proc.kill(0)).not.toThrow();
    expect(proc.killed).toBe(false);
    proc.kill(9);
    await proc.exited;
  });
});
