import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--silent suppresses console output from tests", async () => {
  using dir = tempDir("test-silent", {
    "silent.test.ts": `
import { test, expect } from "bun:test";

test("test with console output", () => {
  console.log("LOG_SHOULD_BE_HIDDEN");
  console.warn("WARN_SHOULD_BE_HIDDEN");
  console.error("ERROR_SHOULD_BE_HIDDEN");
  expect(1 + 1).toBe(2);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--silent", "silent.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("LOG_SHOULD_BE_HIDDEN");
  expect(stderr).not.toContain("WARN_SHOULD_BE_HIDDEN");
  expect(stderr).not.toContain("ERROR_SHOULD_BE_HIDDEN");
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

test("without --silent, console output is visible", async () => {
  using dir = tempDir("test-no-silent", {
    "nosilent.test.ts": `
import { test, expect } from "bun:test";

test("test with console output", () => {
  console.log("LOG_SHOULD_BE_VISIBLE");
  expect(1 + 1).toBe(2);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "nosilent.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("LOG_SHOULD_BE_VISIBLE");
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

test("--silent with bunfig.toml [test] silent = true", async () => {
  using dir = tempDir("test-silent-bunfig", {
    "bunfig.toml": `
[test]
silent = true
`,
    "bunfig-silent.test.ts": `
import { test, expect } from "bun:test";

test("test with console output", () => {
  console.log("BUNFIG_LOG_HIDDEN");
  console.warn("BUNFIG_WARN_HIDDEN");
  expect(true).toBe(true);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "bunfig-silent.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("BUNFIG_LOG_HIDDEN");
  expect(stderr).not.toContain("BUNFIG_WARN_HIDDEN");
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});
