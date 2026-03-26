import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.jest() does not crash after stack overflow", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function F0() {
        const v6 = this.constructor;
        try { new v6(); } catch (e) {}
        Bun.jest(F0, F0);
      }
      try { new F0(); } catch(e) {}
    `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});
