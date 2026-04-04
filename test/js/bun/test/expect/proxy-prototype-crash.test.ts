import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.inspect does not crash when prototype is a Proxy with throwing getPrototypeOf", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const obj = {};
      const origProto = Object.getPrototypeOf(obj);
      const newProto = new Proxy(origProto, {
        getPrototypeOf() { throw new Error("trap"); },
        get(target, key, receiver) { return Reflect.get(target, key, receiver); },
      });
      Object.setPrototypeOf(obj, newProto);
      try { Bun.inspect(obj); } catch(e) {}
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});
