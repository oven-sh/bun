import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

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

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"ok"`);
  expect(exitCode).toBe(0);
});
