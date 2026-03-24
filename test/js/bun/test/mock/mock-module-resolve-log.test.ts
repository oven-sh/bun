import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

// Regression test: mock.module() with a non-existent specifier must not crash
// when module resolution triggers auto-install and the package manager uses
// a stale log pointer from the resolver's stack frame.
test("mock.module with non-existent specifier does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { mock } = require("bun:test");
      try {
        mock.module("this-package-does-not-exist-abcdef123", () => ({ a: 1 }));
      } catch (e) {}
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
