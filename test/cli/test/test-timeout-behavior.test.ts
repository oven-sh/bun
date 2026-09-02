import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, tempDir } from "harness";
import path from "path";

// Runs `source` as a test file under `bun test --timeout=500` and returns its merged output.
async function runWithTimeout(prefix: string, source: string) {
  using dir = tempDir(prefix, { "loop.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=500", "loop.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { combined: stdout + stderr, exitCode };
}

// https://github.com/oven-sh/bun/issues/21277
// A synchronous infinite loop in a test body must be interrupted by the
// per-test timeout. The event-loop timer alone cannot fire while JS is
// running, so the callback runs under a termination deadline that cuts it
// short at its next safepoint.
test.concurrent("synchronous infinite loop is interrupted by --timeout", async () => {
  const { combined, exitCode } = await runWithTimeout(
    "timeout-sync-loop",
    `
      import { test } from "bun:test";
      test("spins forever", () => {
        while (true);
      });
      test("runs after the timed-out test", () => {});
    `,
  );

  // The spinning test is reported as a timeout (not a generic failure),
  // and the next test in the file still runs.
  expect(combined).toContain("(fail) spins forever");
  expect(combined).toContain("timed out after 500ms");
  expect(combined).toContain("(pass) runs after the timed-out test");
  expect(exitCode).toBe(1);
});

// The microtask checkpoint right after the callback runs under the same deadline.
test.concurrent("synchronous infinite loop after awaited microtask is interrupted by --timeout", async () => {
  const { combined, exitCode } = await runWithTimeout(
    "timeout-sync-loop-microtask",
    `
      import { test } from "bun:test";
      test("spins after await", async () => {
        await Promise.resolve();
        while (true);
      });
      test("runs after the timed-out test", () => {});
    `,
  );

  expect(combined).toContain("(fail) spins after await");
  expect(combined).toContain("timed out after 500ms");
  expect(combined).toContain("(pass) runs after the timed-out test");
  expect(exitCode).toBe(1);
});

// The deadline's termination must propagate through node:vm's Script and
// Module evaluation when the user did not pass a {timeout} option of their own.
test.concurrent("synchronous infinite loop inside node:vm without {timeout} is interrupted", async () => {
  const { combined, exitCode } = await runWithTimeout(
    "timeout-sync-loop-nodevm",
    `
      import { test } from "bun:test";
      import vm from "node:vm";
      test("spins inside runInThisContext", () => {
        vm.runInThisContext("while (true);");
      });
      test("spins inside SourceTextModule.evaluate", async () => {
        const mod = new vm.SourceTextModule("while (true);");
        await mod.link(() => {});
        await mod.evaluate();
      });
      test("runs after the timed-out tests", () => {});
    `,
  );

  expect(combined).toContain("(fail) spins inside runInThisContext");
  expect(combined).toContain("(fail) spins inside SourceTextModule.evaluate");
  expect(combined.match(/timed out after 500ms/g)).toHaveLength(2);
  expect(combined).toContain("(pass) runs after the timed-out tests");
  expect(exitCode).toBe(1);
});

// The deadline covers the callback only, not the reporting of its failure:
// printing the error re-enters user JS (here, a `message` getter). A
// termination in there would outlive the runner's handling of the failure and
// skip the next callback while reporting it as passing.
test.concurrent("the deadline does not fire while a failure is being reported", async () => {
  const { combined, exitCode } = await runWithTimeout(
    "timeout-slow-error-message",
    `
      import { test, expect } from "bun:test";
      test("throws", () => {
        const error = new Error("boom");
        let spun = false;
        Object.defineProperty(error, "message", {
          get() {
            // Spin once, for longer than the 500ms timeout plus the deadline's grace.
            if (!spun) {
              spun = true;
              const start = performance.now();
              while (performance.now() - start < 2000) {}
            }
            return "boom";
          },
        });
        throw error;
      });
      test("still runs and fails on its own assertion", () => {
        expect(1).toBe(2);
      });
    `,
  );

  expect(combined).toContain("(fail) throws");
  expect(combined).toContain("(fail) still runs and fails on its own assertion");
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
