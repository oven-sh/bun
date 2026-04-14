import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/29308
// `bunfig.toml` at the project root was ignored when running `bun` from a
// subdirectory, which broke `preload` (and every other config entry) in
// monorepos where commands are invoked from inside a package directory.
test("preload in bunfig.toml is respected when cwd is a subdirectory", async () => {
  using dir = tempDir("bun-issue-29308", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
    "packages/pkg1/src/index.ts": `console.log("hello from pkg1");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: join(String(dir), "packages", "pkg1"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from pkg1\n");
  expect(exitCode).toBe(0);
});

test("bunfig.toml preload with relative path works from project root", async () => {
  using dir = tempDir("bun-issue-29308-root", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "src/index.ts": `console.log("hello from root");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from root\n");
  expect(exitCode).toBe(0);
});

// Relative [test].root in a parent bunfig.toml should resolve against the
// bunfig directory, not the cwd. Without this fix, the ancestor walk would
// surface the parent's `root = "./tests"` but resolve it to
// `cwd/tests` (= missing), silently discovering zero tests.
test("[test].root in an ancestor bunfig.toml resolves against the bunfig directory", async () => {
  using dir = tempDir("bun-issue-29308-test-root", {
    "bunfig.toml": `[test]\nroot = "./tests"\n`,
    "tests/thing.test.ts": `import { test, expect } from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n`,
    "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: join(String(dir), "packages", "pkg1"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // 1 pass proves test.root was resolved to <bunfig>/tests, not <cwd>/tests.
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

// Guard against the ancestor walk stopping at a DIRECTORY named bunfig.toml.
// Without the regular-file check, existsZ would treat the directory as a hit
// and the real bunfig.toml higher in the tree would be silently skipped.
test("directory named bunfig.toml in an ancestor does not short-circuit the walk", async () => {
  using dir = tempDir("bun-issue-29308-dir-named-bunfig", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "middle/packages/pkg1/src/index.ts": `console.log("hello from pkg1");\n`,
  });

  // Put a directory literally named `bunfig.toml` between cwd and the real one.
  mkdirSync(join(String(dir), "middle", "bunfig.toml"), { recursive: true });
  writeFileSync(join(String(dir), "middle", "bunfig.toml", "placeholder"), "");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: join(String(dir), "middle", "packages", "pkg1"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from pkg1\n");
  expect(exitCode).toBe(0);
});
