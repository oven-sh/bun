import { bunEnv, bunExe } from "harness";

test("readline should unref", () => {
  const res = Bun.spawnSync({
    cmd: [bunExe(), import.meta.dir + "/readline_never_unrefs.js"],
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
    // Loading the v26 readline stack alone is ~3s under debug+asan.
    timeout: 10_000,
  });
  expect(res.exitCode).toBe(0);
});
