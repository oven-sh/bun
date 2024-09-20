import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
import { join } from "path";

test("running extensionless file works", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "cool"), "const x: Test = 2; console.log('hello world');");
  let { stdout } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "./cool")],
    cwd: dir,
    env: bunEnv,
  });
  expect(stdout.toString("utf8")).toEqual("hello world\n");
});

test.skipIf(isWindows)("running shebang typescript file works", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cool"), `#!${bunExe()}\nconst x: Test = 2; console.log('hello world');`, { mode: 0o777 });

  let { stdout } = Bun.spawnSync({
    cmd: [join(dir, "./cool")],
    cwd: dir,
    env: bunEnv,
  });
  expect(stdout.toString("utf8")).toEqual("hello world\n");
});
