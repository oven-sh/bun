import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("asymmetricMatch on a custom matcher that throws propagates the error instead of crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { expect } = Bun.jest();
      expect.extend({
        myMatcher() {
          throw new Error("boom from matcher");
        },
      });
      const m = expect.myMatcher();
      let caught;
      try {
        m.asymmetricMatch({});
      } catch (e) {
        caught = e;
      }
      if (!(caught instanceof Error) || caught.message !== "boom from matcher") {
        throw new Error("expected thrown error to propagate, got: " + caught);
      }
      console.log("ok");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
