import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect matcher error formatting after stack overflow does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // Exhaust the stack, catch it, then call a failing expect matcher.
      // The matcher's error formatting must not crash with a pending exception.
      `var done = false;
      function exhaust() {
        try { exhaust(); } catch (e) {
          if (!done) {
            done = true;
            try { Bun.jest(undefined).expect({}).toBeSymbol(); } catch (e2) {}
          }
        }
      }
      exhaust();`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Must not crash with SIGABRT (exit code 134) from releaseAssertNoException
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(exitCode).toBe(0);
});
