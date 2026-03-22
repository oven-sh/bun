import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("accessing Bun.$ during stack overflow does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function F(...a) {
        if (!new.target) throw 'must be called with new';
        try { new F(a); } catch (e) {}
        Bun.$;
      }
      try { new F([]); } catch (e) {}
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
