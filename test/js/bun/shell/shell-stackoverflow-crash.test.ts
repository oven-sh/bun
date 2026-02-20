import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("accessing Bun.$ after stack overflow does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function F8() {
          if (!new.target) { throw 'must be called with new'; }
          const v14 = this?.constructor;
          try { new v14(); } catch (e) {}
          Bun.$;
      }
      new F8();
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});
