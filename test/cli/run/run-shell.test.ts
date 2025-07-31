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
    stderr: "pipe",
  });
  console.log(stderr.toString("utf8"));
  expect(stdout.toString("utf8")).toEqual("wah\n");
});

test("invalid syntax reports the error correctly", async () => {
  const dir = tmpdirSync("bun-shell-test-error");
  mkdirSync(dir, { recursive: true });
  const shellScript = `-h)
  echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`;
  await Bun.write(join(dir, "scripts", "script.sh"), shellScript);
  let { stderr } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "scripts", "script.sh")],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });
  expect(stderr.toString("utf8")).toBe("error: Failed to run script.sh due to error Unexpected ')'\n");
});
