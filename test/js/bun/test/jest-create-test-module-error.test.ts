import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.jest() returns working test module object outside test runner", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const mod = Bun.jest(() => {});
      console.log(typeof mod.expect);
      console.log(typeof mod.test);
      console.log(typeof mod.describe);
      console.log(typeof mod.xdescribe);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("function\nfunction\nfunction\nfunction\n");
  expect(exitCode).toBe(0);
});
