import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect does not crash when value has Symbol.toPrimitive returning a Symbol", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      const obj = /foo/;
      obj[Symbol.toPrimitive] = Symbol;
      try { Bun.jest().expect(obj).toBeFalse(); } catch {}
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(exitCode).toBe(0);
});
