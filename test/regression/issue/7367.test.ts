import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/7367
// bun test --coverage should exit non-zero when coverage is below the configured threshold.

test("exits non-zero when function coverage is below threshold", async () => {
  using dir = tempDir("coverage-threshold", {
    "bunfig.toml": `
[test]
coverage = true
coverageThreshold = { functions = 0.9, lines = 0.9 }
`,
    "lib.ts": `
export function used() { return 1; }
export function unused1() { return 2; }
export function unused2() { return 3; }
export function unused3() { return 4; }
export function unused4() { return 5; }
export function unused5() { return 6; }
export function unused6() { return 7; }
export function unused7() { return 8; }
export function unused8() { return 9; }
export function unused9() { return 10; }
`,
    "lib.test.ts": `
import { test, expect } from "bun:test";
import { used } from "./lib";
test("uses one function", () => {
  expect(used()).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // lib.ts has 10% function coverage (1/10) which is below the 90% threshold.
  // Coverage table is written to stderr.
  expect(stderr).toContain("lib.ts");
  expect(exitCode).not.toBe(0);
});

test("exits zero when coverage meets threshold", async () => {
  using dir = tempDir("coverage-threshold-pass", {
    "bunfig.toml": `
[test]
coverage = true
coverageThreshold = { functions = 0.5, lines = 0.5 }
`,
    "lib.ts": `
export function a() { return 1; }
export function b() { return 2; }
`,
    "lib.test.ts": `
import { test, expect } from "bun:test";
import { a, b } from "./lib";
test("uses all functions", () => {
  expect(a()).toBe(1);
  expect(b()).toBe(2);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // lib.ts has 100% coverage which is above the 50% threshold.
  expect(stderr).toContain("lib.ts");
  expect(exitCode).toBe(0);
});
