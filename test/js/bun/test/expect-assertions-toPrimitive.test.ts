import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect.assertions does not crash when argument has Symbol.toPrimitive returning an object", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const re = /test/;
      Object.defineProperty(re, Symbol.toPrimitive, { value: () => [] });
      try { Bun.jest().expect.assertions(re); } catch {}
      `,
    ],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
});
