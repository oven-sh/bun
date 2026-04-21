import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("asymmetricMatch propagates exception from throwing custom matcher instead of crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { expect } = Bun.jest();
      expect.extend({
        myMatcher: () => {
          throw new Error("boom");
        },
      });
      let thrown;
      try {
        expect.myMatcher().asymmetricMatch({});
      } catch (e) {
        thrown = e;
      }
      if (!(thrown instanceof Error) || thrown.message !== "boom") {
        console.error("expected thrown Error('boom'), got:", thrown);
        process.exit(1);
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
