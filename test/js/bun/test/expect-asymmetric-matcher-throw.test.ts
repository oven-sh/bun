import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("asymmetricMatch propagates exceptions thrown by custom matcher", async () => {
  const src = `
    const { expect } = Bun.jest(import.meta.path);
    expect.extend({
      _throwingMatcher() {
        throw new Error("boom from matcher");
      },
    });
    const matcher = expect._throwingMatcher();
    try {
      matcher.asymmetricMatch(1);
      console.log("FAIL: did not throw");
    } catch (e) {
      console.log("caught:", e.message);
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(stdout.trim()).toBe("caught: boom from matcher");
  expect(exitCode).toBe(0);
});
