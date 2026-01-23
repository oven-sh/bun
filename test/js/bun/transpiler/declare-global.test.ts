import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("declare global with type annotation should not crash", async () => {
  using dir = tempDir("declare-global-test", {
    "test.ts": `
declare global {
  A: 'a';
}

() => {};

console.log("SUCCESS");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Scope mismatch");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});

test("declare global with multiple type annotations and nested arrow functions", async () => {
  using dir = tempDir("declare-global-multi", {
    "test.ts": `
declare global {
  TIMER: NodeJS.Timeout;
  FOO: string;
  BAR: number;
  BAZ: () => void;
}

// Test nested arrow functions to ensure scope handling is correct
const fn = () => {
  const nested = () => {
    const deeplyNested = () => "nested";
    return deeplyNested();
  };
  return nested();
};

console.log(fn());
console.log("SUCCESS");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Scope mismatch");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});
