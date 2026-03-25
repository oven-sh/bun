import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.log with throwing getter behind Proxy prototype does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      const proto = { get x() { throw new Error('boom'); } };
      const obj = {};
      Object.setPrototypeOf(obj, new Proxy(proto, {}));
      console.log(obj);
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe("{}\n");
  expect(exitCode).toBe(0);
});

test("formatting object with Proxy prototype and multiple getters where later ones throw", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      let state = 0;
      const proto = {
        get a() { state = 1; return 'A'; },
        get b() { if (state === 1) throw new Error('boom'); return 'B'; }
      };
      const obj = {};
      Object.setPrototypeOf(obj, new Proxy(proto, {}));
      console.log(obj);
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
});
