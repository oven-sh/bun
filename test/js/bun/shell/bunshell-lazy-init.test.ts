import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("accessing Bun.$ after stack overflow does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function F() {
        if (!new.target) throw 'must be called with new';
        const C = this?.constructor;
        try { new C(); } catch (e) {}
        Bun.$;
      }
      new F();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
});
