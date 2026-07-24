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
