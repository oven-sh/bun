import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test.concurrent("--coverage CLI flag overrides bunfig.toml coverage = false", async () => {
  using dir = tempDir("issue-12216", {
    "bunfig.toml": `[test]\ncoverage = false`,
    "helper.ts": `export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }`,
    "test.test.ts": `import { test, expect } from "bun:test";\nimport { add } from "./helper";\ntest("add", () => { expect(add(1,2)).toBe(3); });`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Coverage table is printed to stderr
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("helper.ts");
  expect(exitCode).toBe(0);
});

test.concurrent("--coverage-reporter CLI flag overrides bunfig.toml coverageReporter", async () => {
  using dir = tempDir("issue-12216-reporter", {
    "bunfig.toml": `[test]\ncoverage = true\ncoverageReporter = "lcov"`,
    "helper.ts": `export function add(a: number, b: number) { return a + b; }`,
    "test.test.ts": `import { test, expect } from "bun:test";\nimport { add } from "./helper";\ntest("add", () => { expect(add(1,2)).toBe(3); });`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage-reporter", "text"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // text reporter prints the coverage table to stderr
  expect(stderr).toContain("% Funcs");
  // lcov reporter should NOT have run
  expect(existsSync(join(String(dir), "coverage", "lcov.info"))).toBe(false);
  expect(exitCode).toBe(0);
});

test.concurrent("--coverage-dir CLI flag overrides bunfig.toml coverageDir", async () => {
  using dir = tempDir("issue-12216-dir", {
    "bunfig.toml": `[test]\ncoverage = true\ncoverageReporter = "lcov"\ncoverageDir = "config-coverage"`,
    "helper.ts": `export function add(a: number, b: number) { return a + b; }`,
    "test.test.ts": `import { test, expect } from "bun:test";\nimport { add } from "./helper";\ntest("add", () => { expect(add(1,2)).toBe(3); });`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage-reporter", "lcov", "--coverage-dir", "cli-coverage"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // lcov report should be written to the CLI-specified directory, not the bunfig one
  expect(existsSync(join(String(dir), "cli-coverage", "lcov.info"))).toBe(true);
  expect(existsSync(join(String(dir), "config-coverage", "lcov.info"))).toBe(false);
  expect(exitCode).toBe(0);
});
