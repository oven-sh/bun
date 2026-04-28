import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect does not crash when value has Symbol.toPrimitive returning a Symbol", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const obj = /foo/;
      obj[Symbol.toPrimitive] = Symbol;
      try { Bun.jest().expect(obj).toBeFalse(); } catch {}
    `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});
