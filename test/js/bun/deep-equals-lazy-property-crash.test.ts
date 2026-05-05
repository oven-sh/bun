import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("deepEquals does not crash when lazy property callback fails after stack overflow", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function F4() {
        try { new F4(); } catch (e) {}
        Bun.deepEquals(Uint8Array, Bun);
      }
      new F4();
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
