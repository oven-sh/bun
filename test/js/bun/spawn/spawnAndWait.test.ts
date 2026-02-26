import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("basic echo", async () => {
  const result = await Bun.spawnAndWait(["echo", "hello"]);
  expect(result.stdout.toString()).toBe("hello\n");
  expect(result.exitCode).toBe(0);
  expect(result.success).toBe(true);
  expect(result.pid).toBeGreaterThan(0);
});

test("stderr is captured by default", async () => {
  const result = await Bun.spawnAndWait({
    cmd: [bunExe(), "-e", "console.error('err output')"],
    env: bunEnv,
  });
  expect(result.stderr.toString()).toBe("err output\n");
  expect(result.exitCode).toBe(0);
});

test("non-zero exit code", async () => {
  const result = await Bun.spawnAndWait({
    cmd: [bunExe(), "-e", "process.exit(42)"],
    env: bunEnv,
  });
  expect(result.exitCode).toBe(42);
  expect(result.success).toBe(false);
});

test("returns a promise", () => {
  const result = Bun.spawnAndWait(["echo", "hello"]);
  expect(result).toBeInstanceOf(Promise);
});

test("does not block the event loop", async () => {
  let timerFired = false;
  setTimeout(() => {
    timerFired = true;
  }, 1);

  // Sleep for 100ms in a child process - timer should fire during wait
  const result = await Bun.spawnAndWait({
    cmd: [bunExe(), "-e", "await Bun.sleep(100)"],
    env: bunEnv,
  });
  expect(result.exitCode).toBe(0);
  expect(timerFired).toBe(true);
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
});

test("resourceUsage is present", async () => {
  const result = await Bun.spawnAndWait(["echo", "hello"]);
  expect(result.resourceUsage).toBeDefined();
  expect(typeof result.resourceUsage.maxRSS).toBe("number");
});

test("large output is buffered correctly", async () => {
  const size = 1024 * 1024; // 1MB
  const result = await Bun.spawnAndWait({
    cmd: [bunExe(), "-e", `process.stdout.write("x".repeat(${size}))`],
    env: bunEnv,
  });
  expect(result.stdout.length).toBe(size);
  expect(result.exitCode).toBe(0);
});

test("signal code when killed", async () => {
  const result = await Bun.spawnAndWait({
    cmd: [bunExe(), "-e", "process.kill(process.pid, 'SIGTERM')"],
    env: bunEnv,
  });
  // Process was killed by signal
  expect(result.exitCode).not.toBe(0);
});

test("env option is forwarded", async () => {
  const result = await Bun.spawnAndWait({
    cmd: [bunExe(), "-e", "console.log(process.env.MY_TEST_VAR)"],
    env: { ...bunEnv, MY_TEST_VAR: "hello_from_env" },
  });
  expect(result.stdout.toString().trim()).toBe("hello_from_env");
});

test("cwd option is forwarded", async () => {
  const result = await Bun.spawnAndWait({
    cmd: [bunExe(), "-e", "console.log(process.cwd())"],
    env: bunEnv,
    cwd: "/tmp",
  });
  // /tmp may be a symlink to /private/tmp on macOS
  expect(result.stdout.toString().trim()).toEndWith("tmp");
});

test("invalid command throws", () => {
  // spawnAndWait throws synchronously when the command is not found
  expect(() => Bun.spawnAndWait(["this-command-does-not-exist-12345"])).toThrow();
});

test("array form works", async () => {
  const result = await Bun.spawnAndWait(["echo", "array", "form"]);
  expect(result.stdout.toString()).toBe("array form\n");
  expect(result.exitCode).toBe(0);
});

test("object form with cmd works", async () => {
  const result = await Bun.spawnAndWait({
    cmd: ["echo", "object", "form"],
  });
  expect(result.stdout.toString()).toBe("object form\n");
  expect(result.exitCode).toBe(0);
});

test("empty stdout", async () => {
  const result = await Bun.spawnAndWait(["true"]);
  expect(result.stdout.length).toBe(0);
  expect(result.exitCode).toBe(0);
});
