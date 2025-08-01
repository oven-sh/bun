import { bunEnv, bunExe } from "harness";

test("readline should unref", () => {
  const res = Bun.spawnSync({
    cmd: [bunExe(), import.meta.dir + "/readline_never_unrefs.js"],
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
    timeout: 1000,
  });
  expect(res.exitCode).toBe(0);
});
