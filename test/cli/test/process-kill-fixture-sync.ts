import { test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("test timeout kills dangling processes", async () => {
  Bun.spawnSync({
    cmd: [bunExe(), "--eval", "Bun.sleepSync(5000); console.log('This should not be printed!');"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: bunEnv,
  });
}, 10);

test("slow test after test timeout", async () => {
  await Bun.sleep(100);
  console.log("Ran slow test");
}, 200);
