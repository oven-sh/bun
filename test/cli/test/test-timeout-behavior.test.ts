import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, tempDir } from "harness";
import path from "path";

// https://github.com/oven-sh/bun/issues/21277
// A synchronous infinite loop in a test body must be interrupted by the
// per-test timeout. The event-loop timer alone cannot fire while JS is
// running, so the JSC watchdog is armed around the callback to raise a
// TerminationException at the next safepoint.
test.concurrent("synchronous infinite loop is interrupted by --timeout", async () => {
  using dir = tempDir("timeout-sync-loop", {
    "loop.test.ts": `
      import { test } from "bun:test";
      test("spins forever", () => {
        while (true);
      });
      test("runs after the timed-out test", () => {});
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=500", "loop.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = stdout + stderr;

  // The spinning test is reported as a timeout (not a generic failure),
  // and the next test in the file still runs.
  expect(combined).toContain("(fail) spins forever");
  expect(combined).toContain("timed out after 500ms");
  expect(combined).toContain("(pass) runs after the timed-out test");
  expect(exitCode).toBe(1);
});

test.concurrent("synchronous infinite loop after awaited microtask is interrupted by --timeout", async () => {
  using dir = tempDir("timeout-sync-loop-microtask", {
    "loop.test.ts": `
      import { test } from "bun:test";
      test("spins after await", async () => {
        await Promise.resolve();
        while (true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=500", "loop.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = stdout + stderr;

  expect(combined).toContain("(fail) spins after await");
  expect(combined).toContain("timed out after 500ms");
  expect(exitCode).toBe(1);
});

// The outer watchdog's TerminationException must propagate through
// node:vm's Script/Module evaluation when the user didn't pass a
// {timeout} option — NodeVMScript::checkForTermination previously
// RELEASE_ASSERT'd that the termination came from its own watchdog.
test.concurrent("synchronous infinite loop inside node:vm without {timeout} is interrupted", async () => {
  using dir = tempDir("timeout-sync-loop-nodevm", {
    "loop.test.ts": `
      import { test } from "bun:test";
      import vm from "node:vm";
      test("spins inside runInThisContext", () => {
        vm.runInThisContext("while (true);");
      });
      test("runs after the timed-out test", () => {});
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=500", "loop.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = stdout + stderr;

  expect(combined).toContain("(fail) spins inside runInThisContext");
  expect(combined).toContain("timed out after 500ms");
  expect(combined).toContain("(pass) runs after the timed-out test");
  expect(exitCode).toBe(1);
});

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.concurrent.each([true, false])(`processes get killed (sync: %p)`, async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // merge outputs so that this test still works if we change which things are printed to stdout
    // and which to stderr
    const combined = out + err;
    // exit code should indicate failed tests, not abort or anything
    expect(exitCode).toBe(1);
    expect(combined).not.toContain("This should not be printed!");
    expect(combined).toContain("killed 1 dangling process");
    // we should not expose the termination exception
    expect(combined).not.toContain("Unhandled error between tests");
    expect(combined).not.toContain("JavaScript execution terminated");
    // both tests should have run with the expected result
    expect(combined).toContain("(fail) test timeout kills dangling processes");
    expect(combined).toContain("(pass) slow test after test timeout");
  });
}
