import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("exit builtin stops execution in multiline script", async () => {
  const result = await $`
    echo "before exit"
    exit
    echo "after exit"
  `.quiet();

  expect(result.stdout.toString()).toBe("before exit\n");
  expect(result.exitCode).toBe(0);
});

test("exit builtin with exit code 0", async () => {
  const result = await $`
    echo "before exit"
    exit 0
    echo "after exit"
  `.quiet();

  expect(result.stdout.toString()).toBe("before exit\n");
  expect(result.exitCode).toBe(0);
});

test("exit builtin with exit code 1", async () => {
  const result = await $`
    echo "before exit"
    exit 1
    echo "after exit"
  `
    .quiet()
    .nothrow();

  expect(result.stdout.toString()).toBe("before exit\n");
  expect(result.exitCode).toBe(1);
});

test("exit builtin with exit code 42", async () => {
  const result = await $`
    echo "before exit"
    exit 42
    echo "after exit"
  `
    .quiet()
    .nothrow();

  expect(result.stdout.toString()).toBe("before exit\n");
  expect(result.exitCode).toBe(42);
});

test("exit builtin in shell script file", async () => {
  using dir = tempDir("exit-test", {
    "test.sh": `#!/usr/bin/env bun
echo "before exit"
exit 5
echo "after exit"
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.sh"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("before exit\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(5);
});

test("exit builtin with invalid argument", async () => {
  const result = await $`
    exit notanumber
  `
    .quiet()
    .nothrow();

  expect(result.stderr.toString()).toContain("exit: numeric argument required");
  expect(result.exitCode).toBe(1);
});

test("exit builtin with too many arguments", async () => {
  const result = await $`
    exit 0 1 2
  `
    .quiet()
    .nothrow();

  expect(result.stderr.toString()).toContain("exit: too many arguments");
  expect(result.exitCode).toBe(1);
});

test("exit builtin with overflow wraps around", async () => {
  const result = await $`
    exit 256
  `
    .quiet()
    .nothrow();

  expect(result.exitCode).toBe(0);
});

test("exit builtin with large number wraps modulo 256", async () => {
  const result = await $`
    exit 257
  `
    .quiet()
    .nothrow();

  expect(result.exitCode).toBe(1);
});

test("exit builtin in command chain with &&", async () => {
  const result = await $`echo "before" && exit && echo "after"`.quiet();
  expect(result.stdout.toString()).toBe("before\n");
  expect(result.exitCode).toBe(0);
});

test("exit builtin in command chain with ||", async () => {
  const result = await $`false || exit 3 || echo "after"`.quiet().nothrow();
  expect(result.stdout.toString()).toBe("");
  expect(result.exitCode).toBe(3);
});

test("exit builtin in nested binary expressions", async () => {
  const result = await $`echo "start" && (false || exit 9) && echo "should not print"`.quiet().nothrow();
  expect(result.stdout.toString()).toBe("start\n");
  expect(result.exitCode).toBe(9);
});
