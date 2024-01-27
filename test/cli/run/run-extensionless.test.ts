// @known-failing-on-windows: 1 failing
import { expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

test("running extensionless file works", async () => {
  const dir = join(realpathSync(tmpdir()), "bun-run-test1");
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "cool"), "const x: Test = 2; console.log('hello world');");
  let { stdout } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "./cool")],
    cwd: dir,
    env: bunEnv,
  });
  expect(stdout.toString("utf8")).toEqual("hello world\n");
});

test.skipIf(process.platform === "win32")("running shebang typescript file works", async () => {
  const dir = join(realpathSync(tmpdir()), "bun-run-test2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cool"), `#!${bunExe()}\nconst x: Test = 2; console.log('hello world');`, { mode: 0o777 });

  let { stdout } = Bun.spawnSync({
    cmd: [join(dir, "./cool")],
    cwd: dir,
    env: bunEnv,
  });
  expect(stdout.toString("utf8")).toEqual("hello world\n");
});
