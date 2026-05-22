import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Constructing a custom matcher registered via expect.extend() used to call a
// null native constructor and segfault.
test("new on an expect.extend custom matcher throws instead of crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const expect = Bun.jest().expect;
      expect.extend({
        _notAConstructor() {
          return { pass: true, message: () => "" };
        },
      });

      for (const matcher of [expect._notAConstructor, expect(1)._notAConstructor]) {
        let threw = false;
        try {
          new matcher();
        } catch (e) {
          threw = e instanceof TypeError;
        }
        if (!threw) throw new Error("expected new matcher() to throw a TypeError");
      }
      console.log("ok");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.error(stderr);
  }
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
