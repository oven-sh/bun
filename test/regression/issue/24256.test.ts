import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("setting onmessage on main thread global should terminate the process", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", /* js */ `globalThis.onmessage = () => {};`],
    env: bunEnv,
  });

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

test("setting onmessage inside ShadowRealm should terminate the process", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
      const realm = new ShadowRealm();
      realm.evaluate('globalThis.onmessage = () => {};');
      `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

test("setting onmessage inside worker should keep the process alive (bun specific)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
      const { Worker } = require("worker_threads");
      new Worker("globalThis.onmessage = () => {};", { eval: true });
      `,
    ],
    env: bunEnv,
  });

  const exited = await Promise.race([proc.exited, Bun.sleep(300).then(() => 0)]);
  expect(exited).toBe(0);
  proc.kill();
  await proc.exited;
});
