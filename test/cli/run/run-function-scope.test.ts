import { expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

test("malformed function definition doesn't crash", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "index1.js"), "function:");
  await Bun.write(join(dir, "index1.ts"), "function:");
  await Bun.write(join(dir, "index2.js"), "function a() {function:}");
  await Bun.write(join(dir, "index2.ts"), "function a() {function:}");

  let result = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index1.js")],
    cwd: dir,
    env: bunEnv,
  });
  expect(result.exitCode).toBe(1);


  result = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index1.ts")],
    cwd: dir,
    env: bunEnv,
  });
  expect(result.exitCode).toBe(1);


  result = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index2.js")],
    cwd: dir,
    env: bunEnv,
  });
  expect(result.exitCode).toBe(1);


  result = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index2.ts")],
    cwd: dir,
    env: bunEnv,
  });
  expect(result.exitCode).toBe(1);
});
