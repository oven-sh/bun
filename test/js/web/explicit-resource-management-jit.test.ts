import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("using with non-disposable in hot loop does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function f() {
        const v = class {};
        using x = v;
      }
      for (let i = 0; i < 1000; i++) {
        try { f(); } catch(e) {}
      }
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("using with disposable works correctly after many iterations", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let count = 0;
      function run() {
        using x = { [Symbol.dispose]() { count++; } };
      }
      for (let i = 0; i < 1000; i++) run();
      console.log(count);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("1000");
  expect(exitCode).toBe(0);
});
