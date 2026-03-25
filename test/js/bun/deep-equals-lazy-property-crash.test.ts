import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("deepEquals does not crash when lazy property callback fails after stack overflow", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      var depth = 0;
      function F4() {
        if (depth++ > 100) throw new Error("too deep");
        try { new F4(); } catch (e) {}
        Bun.deepEquals(Uint8Array, Bun);
      }
      new F4();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("null pointer");
  expect(exitCode).toBe(0);
});
