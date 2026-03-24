import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.jest() does not crash during stack overflow recovery", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function f() { try { f(); } catch(e) { return Bun.jest(); } }
      try { f(); } catch(e) {}
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
