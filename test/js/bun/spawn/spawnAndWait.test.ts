import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

describe.concurrent("Bun.spawnAndWait basics", () => {
  test("basic stdout", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "console.log('hello')"],
      env: bunEnv,
    });
    expect(result.stdout.toString()).toBe("hello\n");
    expect(result.stderr.toString()).toBe("");
    expect(result.success).toBe(true);
    expect(result.pid).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  });

  test("stderr is captured by default", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "console.error('err output')"],
      env: bunEnv,
    });
    expect(result.stderr.toString()).toBe("err output\n");
    expect(result.stdout.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("array form", async () => {
    const result = await Bun.spawnAndWait([bunExe(), "-e", "process.stdout.write('hi')"], {
      env: bunEnv,
    });
    expect(result.stdout.toString()).toBe("hi");
    expect(result.exitCode).toBe(0);
  });

  test("non-zero exit code", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "process.exit(42)"],
      env: bunEnv,
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
  });

  test("returns a real Promise", async () => {
    const promise = Bun.spawnAndWait({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
    });
    expect(promise).toBeInstanceOf(Promise);
    const result = await promise;
    expect(result.exitCode).toBe(0);
  });

  test("stdout and stderr are Buffers", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "console.log('out'); console.error('err')"],
      env: bunEnv,
    });
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(Buffer.isBuffer(result.stderr)).toBe(true);
    expect(result.stdout.toString()).toBe("out\n");
    expect(result.stderr.toString()).toBe("err\n");
    expect(result.exitCode).toBe(0);
  });

  test("resourceUsage is present", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
    });
    expect(result.resourceUsage).toBeDefined();
    expect(typeof result.resourceUsage.maxRSS).toBe("number");
    expect(result.exitCode).toBe(0);
  });

  test("large output is buffered correctly", async () => {
    const size = 256 * 1024;
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", `process.stdout.write(Buffer.alloc(${size}, 'x'))`],
      env: bunEnv,
    });
    expect(result.stdout.length).toBe(size);
    expect(result.exitCode).toBe(0);
  });

  test("signalCode when killed", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "process.kill(process.pid, 'SIGTERM'); await Bun.sleep(1000)"],
      env: bunEnv,
    });
    if (isWindows) {
      expect(result.success).toBe(false);
    } else {
      expect(result.signalCode).toBe("SIGTERM");
      expect(result.exitCode).toBe(null);
      expect(result.success).toBe(false);
    }
  });

  test("cwd option", async () => {
    using dir = tempDir("spawnAndWait-cwd", {
      "marker.txt": "",
    });
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "console.log(require('fs').existsSync('marker.txt'))"],
      env: bunEnv,
      cwd: String(dir),
    });
    expect(result.stdout.toString().trim()).toBe("true");
    expect(result.exitCode).toBe(0);
  });

  test("env option", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "console.log(process.env.MY_TEST_VAR)"],
      env: { ...bunEnv, MY_TEST_VAR: "hello_from_env" },
    });
    expect(result.stdout.toString().trim()).toBe("hello_from_env");
    expect(result.exitCode).toBe(0);
  });

  test("stdin as Uint8Array", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "process.stdout.write(await Bun.stdin.text())"],
      env: bunEnv,
      stdin: new TextEncoder().encode("from stdin"),
    });
    expect(result.stdout.toString()).toBe("from stdin");
    expect(result.exitCode).toBe(0);
  });

  test("stdin: 'pipe' is treated as ignore (matches spawnSync)", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "process.stdout.write(await Bun.stdin.text())"],
      env: bunEnv,
      stdin: "pipe",
    });
    expect(result.stdout.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("stdout: 'ignore' yields undefined", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "console.log('discarded')"],
      env: bunEnv,
      stdout: "ignore",
    });
    expect(result.stdout).toBeUndefined();
    expect(result.exitCode).toBe(0);
  });

  test("concurrent spawns run in parallel", async () => {
    const results = await Promise.all(
      [1, 2, 3].map(i =>
        Bun.spawnAndWait({
          cmd: [bunExe(), "-e", `console.log(${i})`],
          env: bunEnv,
        }),
      ),
    );
    expect(results.map(r => r.stdout.toString().trim())).toEqual(["1", "2", "3"]);
    for (const r of results) expect(r.exitCode).toBe(0);
  });
});

test("does not block the event loop", async () => {
  let tick = 0;
  const interval = setInterval(() => {
    tick++;
  }, 10);
  try {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "await Bun.sleep(200)"],
      env: bunEnv,
    });
    expect(result.exitCode).toBe(0);
  } finally {
    clearInterval(interval);
  }
  // spawnSync would block the event loop and the interval would not fire.
  expect(tick).toBeGreaterThan(0);
});

test("ENOENT throws synchronously", () => {
  expect(() =>
    Bun.spawnAndWait({
      cmd: ["this-binary-definitely-does-not-exist-12345"],
      env: bunEnv,
    }),
  ).toThrow(expect.objectContaining({ code: "ENOENT" }));
});

test("onExit is ignored and does not leak the internal Subprocess", async () => {
  let called = false;
  const result = await Bun.spawnAndWait({
    cmd: [bunExe(), "-e", "console.log('hi')"],
    env: bunEnv,
    // @ts-expect-error - onExit is not in SpawnSyncOptions; must be a silent no-op at runtime
    onExit(proc: any) {
      called = true;
      proc.stdout;
    },
  });
  expect(called).toBe(false);
  expect(result.stdout.toString()).toBe("hi\n");
  expect(result.exitCode).toBe(0);
});

test.skipIf(isWindows)("stdio: 'socket-fd' is rejected", () => {
  expect(() =>
    Bun.spawnAndWait({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe", "socket-fd"],
    }),
  ).toThrow(/socket-fd/);
});

test("terminal option is rejected", () => {
  expect(() =>
    Bun.spawnAndWait({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
      // @ts-expect-error - not allowed on spawnAndWait
      terminal: {},
    }),
  ).toThrow(/spawnAndWait/);
});

describe.concurrent("timeout", () => {
  test("fires and sets exitedDueToTimeout", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "await Bun.sleep(30_000)"],
      env: bunEnv,
      timeout: 100,
      killSignal: "SIGKILL",
    });
    expect(result.exitedDueToTimeout).toBe(true);
    expect(result.success).toBe(false);
  });

  test("does not fire when process exits first", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
      timeout: 60_000,
    });
    expect(result.exitedDueToTimeout).toBe(false);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("key is absent when not requested", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
    });
    expect("exitedDueToTimeout" in result).toBe(false);
  });
});

describe.concurrent("maxBuffer", () => {
  test("kills the process and sets exitedDueToMaxBuffer", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "exec", "yes"],
      env: bunEnv,
      maxBuffer: 256,
      killSignal: isWindows ? "SIGKILL" : "SIGHUP",
    });
    expect(result.exitedDueToMaxBuffer).toBe(true);
    expect(result.success).toBe(false);
    expect(result.signalCode).toBe(isWindows ? "SIGKILL" : "SIGHUP");
    expect(result.stdout.toString("utf-8")).toStartWith("y\n".repeat(128));
    expect(result.exitCode).toBe(null);
  });

  test("not exceeded", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", "console.log('short')"],
      env: bunEnv,
      maxBuffer: 1024 * 1024,
    });
    expect(result.exitedDueToMaxBuffer).toBe(false);
    expect(result.stdout.toString()).toBe("short\n");
    expect(result.exitCode).toBe(0);
  });

  test("key is absent when not requested", async () => {
    const result = await Bun.spawnAndWait({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
    });
    expect("exitedDueToMaxBuffer" in result).toBe(false);
  });
});

test("AbortSignal aborts and resolves", async () => {
  const ac = new AbortController();
  const promise = Bun.spawnAndWait({
    cmd: [bunExe(), "-e", "await Bun.sleep(30_000)"],
    env: bunEnv,
    signal: ac.signal,
    killSignal: "SIGKILL",
  });
  ac.abort();
  const result = await promise;
  expect(result.signalCode).toBe("SIGKILL");
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(null);
});
