import { expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test("running a commonjs module works", async () => {
  const dir = join(realpathSync(tmpdir()), "bun-run-test1");
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "index1.js"), "module.exports = 1; console.log('hello world');");
  let { stdout } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index1.js")],
    cwd: dir,
    env: bunEnv,
  });
  expect(stdout.toString("utf8")).toEqual("hello world\n");
});
