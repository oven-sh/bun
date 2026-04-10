// https://github.com/oven-sh/bun/issues/29109

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

test("bunfig.toml in parent directory is inherited by subprojects", async () => {
  using dir = tempDir("29109-inherit", {
    "bunfig.toml": `
[test]
onlyFailures = true
`,
    "packages/api/sample.test.ts": `
import { test, expect } from "bun:test";
test("inherited-passing-1", () => expect(1).toBe(1));
test("inherited-passing-2", () => expect(2).toBe(2));
test("inherited-failing", () => expect(1).toBe(2));
`,
  });

  // Point HOME at an empty dir so a user-global ~/.bunfig.toml can't
  // accidentally affect the assertions.
  using homeDir = tempDir("29109-inherit-home", {});
  const env = {
    ...bunEnv,
    HOME: String(homeDir),
    XDG_CONFIG_HOME: String(homeDir),
  };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "sample.test.ts"],
    env,
    cwd: join(String(dir), "packages", "api"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The failing test still reports as a fail.
  expect(stderr).toContain("inherited-failing");
  // With onlyFailures active, the passing test names must NOT appear —
  // that's the whole point of the setting. Without inheritance, they
  // would be listed individually above the summary.
  expect(stderr).not.toContain("inherited-passing-1");
  expect(stderr).not.toContain("inherited-passing-2");
  // And the exit code reflects the failing test.
  expect(exitCode).not.toBe(0);
});

test("local bunfig.toml still takes precedence over a parent one", async () => {
  using dir = tempDir("29109-local-wins", {
    // Root: onlyFailures on
    "bunfig.toml": `
[test]
onlyFailures = true
`,
    // Subproject: onlyFailures off — this is what should apply
    "packages/api/bunfig.toml": `
[test]
onlyFailures = false
`,
    "packages/api/sample.test.ts": `
import { test, expect } from "bun:test";
test("local-wins-passing", () => expect(1).toBe(1));
test("local-wins-failing", () => expect(1).toBe(2));
`,
  });

  using homeDir = tempDir("29109-local-wins-home", {});
  const env = {
    ...bunEnv,
    HOME: String(homeDir),
    XDG_CONFIG_HOME: String(homeDir),
  };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "sample.test.ts"],
    env,
    cwd: join(String(dir), "packages", "api"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // With the local bunfig disabling onlyFailures, the passing test
  // IS visible in the output.
  expect(stderr).toContain("local-wins-passing");
  expect(stderr).toContain("local-wins-failing");
  expect(exitCode).not.toBe(0);
});

test("`bun run` from a subproject inherits a parent `bunfig.toml`", async () => {
  // Exercises the walk-up branch in `loadConfigPath` (not `loadConfig`),
  // which is what `bun run` / `bun repl` / `bun <file>` go through.
  //
  // Bake the absolute path of the root preload into the bunfig at test
  // time so it doesn't depend on how Bun resolves relative preload paths
  // (a pre-existing area of the codebase that's tracked separately).
  using dir = tempDir("29109-run-inherit", {
    "preload.js": `console.log("from-preload");`,
    "packages/api/script.ts": `console.log("from-script");`,
  });
  writeFileSync(
    join(String(dir), "bunfig.toml"),
    `preload = ["${join(String(dir), "preload.js").replace(/\\/g, "\\\\")}"]\n`,
  );

  using homeDir = tempDir("29109-run-inherit-home", {});
  const env = {
    ...bunEnv,
    HOME: String(homeDir),
    XDG_CONFIG_HOME: String(homeDir),
  };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "script.ts"],
    env,
    cwd: join(String(dir), "packages", "api"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The preload fired (the parent bunfig was discovered via walk-up)
  // AND the script ran after it.
  expect(stdout).toContain("from-preload");
  expect(stdout).toContain("from-script");
  expect(exitCode).toBe(0);
});

test("no bunfig.toml anywhere up the chain behaves as before", async () => {
  using dir = tempDir("29109-none", {
    "packages/api/sample.test.ts": `
import { test, expect } from "bun:test";
test("plain-passing", () => expect(1).toBe(1));
test("plain-failing", () => expect(1).toBe(2));
`,
  });

  using homeDir = tempDir("29109-none-home", {});
  const env = {
    ...bunEnv,
    HOME: String(homeDir),
    XDG_CONFIG_HOME: String(homeDir),
  };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "sample.test.ts"],
    env,
    cwd: join(String(dir), "packages", "api"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Without any bunfig, default behavior prints both tests.
  expect(stderr).toContain("plain-passing");
  expect(stderr).toContain("plain-failing");
  expect(exitCode).not.toBe(0);
});
