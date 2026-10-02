import { $ } from "bun";

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

// We skip these tests on Windows because:
// 1. Windows didn't have this problem to begin with
// 2. We need system cat.
test.skipIf(isWindows)("writing > send buffer size doesn't block the main thread", async () => {
  const expected = Buffer.alloc(1024 * 1024, "bun!").toString();
  const massiveComamnd = "echo " + expected + " | " + Bun.which("cat");
  const result = await $`${{
    raw: massiveComamnd,
  }}`.text();

  if (result !== expected + "\n") {
    throw new Error("Expected " + expected + "\n but got " + result);
  }
});

test.skipIf(isWindows)("writing > send buffer size (with a variable) doesn't block the main thread", async () => {
  const expected = Buffer.alloc(1024 * 1024, "bun!").toString();
  const result = await $`echo ${expected} | ${Bun.which("cat")}`.text();

  if (result !== expected + "\n") {
    throw new Error("Expected " + expected + "\n but got " + result);
  }
});

// The snapshots are taken in a separate process; the fixture explains why.
test.skipIf(isWindows)("heap snapshots report the script held by a pending shell command", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "shell-heap-snapshot-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { scriptLength, parsedScriptBeforeRun, interpreterWhileRunning, interpreterAfterExit, stdoutMatches } =
    JSON.parse(stdout);
  expect(parsedScriptBeforeRun).toBeGreaterThanOrEqual(scriptLength);
  expect(interpreterWhileRunning).toBeGreaterThanOrEqual(scriptLength);
  expect(interpreterAfterExit).toBeLessThan(scriptLength);
  // The second snapshot ran a full GC underneath the running command; its
  // output must still come through intact.
  expect(stdoutMatches).toBe(true);
  expect(exitCode).toBe(0);
});
