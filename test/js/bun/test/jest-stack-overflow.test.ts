import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.jest() during stack overflow does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function recurse() { try { recurse(); } catch(e) {} }
      recurse();
      // After recovering from stack overflow, Bun.jest() should not crash
      try {
        Bun.jest().expect(1).toBeFalse();
      } catch(e) {
        console.log("OK");
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("OK");
  // Should exit cleanly, not crash with a signal
  expect(exitCode).toBe(0);
});
