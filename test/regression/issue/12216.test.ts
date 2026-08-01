import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/12216
// bunfig `[test]` coverage settings must not override explicit CLI flags.

const files = {
  "helper.ts": `
export function covered() { return 42; }
export function uncovered() { return 43; }
`,
  "my.test.ts": `
import { test, expect } from "bun:test";
import { covered } from "./helper";
test("cov", () => { expect(covered()).toBe(42); });
`,
};

test.concurrent("--coverage overrides bunfig [test] coverage = false", async () => {
  using dir = tempDir("issue-12216-enabled", {
    ...files,
    "bunfig.toml": "[test]\ncoverage = false\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "my.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("helper.ts");
  expect(exitCode).toBe(0);
});

test.concurrent("bunfig [test] coverage = true still enables coverage without CLI flag", async () => {
  using dir = tempDir("issue-12216-bunfig-on", {
    ...files,
    "bunfig.toml": "[test]\ncoverage = true\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "my.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("% Funcs");
  expect(exitCode).toBe(0);
});

test.concurrent("--coverage-reporter overrides bunfig [test] coverageReporter", async () => {
  using dir = tempDir("issue-12216-reporter", {
    ...files,
    "bunfig.toml": '[test]\ncoverage = true\ncoverageReporter = "lcov"\n',
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage-reporter", "text", "my.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("% Funcs");
  expect(existsSync(join(String(dir), "coverage", "lcov.info"))).toBe(false);
  expect(exitCode).toBe(0);
});

test.concurrent("--coverage-dir overrides bunfig [test] coverageDir", async () => {
  using dir = tempDir("issue-12216-dir", {
    ...files,
    "bunfig.toml": '[test]\ncoverage = true\ncoverageReporter = "lcov"\ncoverageDir = "from-bunfig"\n',
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage-dir", "from-cli", "my.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(existsSync(join(String(dir), "from-cli", "lcov.info"))).toBe(true);
  expect(existsSync(join(String(dir), "from-bunfig"))).toBe(false);
  expect(exitCode).toBe(0);
});
