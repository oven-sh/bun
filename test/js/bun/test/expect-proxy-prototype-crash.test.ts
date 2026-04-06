import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect does not crash when expect value has a Proxy in its prototype chain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const obj = Bun.jest().expect(Bun);
      const newProto = new Proxy(Object.getPrototypeOf(obj), {
        get(target, key, receiver) { return Reflect.get(target, key, receiver); },
      });
      Object.setPrototypeOf(obj, newProto);
      try { obj.toContainKey(obj); } catch {}
    `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});
