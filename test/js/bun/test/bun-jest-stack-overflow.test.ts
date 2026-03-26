import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.jest() does not crash after stack overflow", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function F0() {
        const v6 = this.constructor;
        try { new v6(); } catch (e) {}
        Bun.jest(F0, F0);
      }
      try { new F0(); } catch(e) {}
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Must not crash with an assertion failure (SIGABRT = 128+6 = 134)
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(exitCode).not.toBe(134);
});
