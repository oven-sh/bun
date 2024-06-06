import { expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

test("running a shell script works", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "something.sh"), "echo wah");
  let { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "something.sh")],
    cwd: dir,
    env: bunEnv,
  });
  console.log(stderr.toString("utf8"));
  expect(stdout.toString("utf8")).toEqual("wah\n");
});
