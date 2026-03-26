import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

test("recursive constructor call with try/catch does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function F0() {
        const Ctor = this.constructor;
        try { new Ctor(); } catch (_e) {}
      }
      new F0();
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
