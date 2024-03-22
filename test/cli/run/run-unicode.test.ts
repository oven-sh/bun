import { expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test("running a weird filename works", async () => {
  const troll = process.platform == "win32" ? "💥'​\\" : "💥'\"​\n";
  const dir = join(realpathSync(tmpdir()), "bun-run-test" + troll);
  mkdirSync(dir, { recursive: true });
  console.log("dir", dir);
  // i this it's possible that the filesystem rejects the path
  await Bun.write(join(dir, troll + ".js"), "console.log('hello world');");
  let { stdout } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, troll + ".js")],
    cwd: dir,
    env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  expect(stdout.toString("utf8")).toEqual("hello world\n");
});
