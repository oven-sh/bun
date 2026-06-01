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

test("expect does not crash when a failing matcher formats the diff near the stack limit", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let ran = false;
      function deep() {
        try {
          deep();
        } catch {
          if (!ran) {
            ran = true;
            try { Bun.jest().expect(new Map([[1, 2]])).toEqual(new Map()); } catch {}
          }
        }
      }
      deep();
    `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});
