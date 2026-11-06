import { test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { spawnSync } from "node:child_process";

test("test timeout kills dangling processes", async () => {
  spawnSync(bunExe(), ["--eval", "Bun.sleepSync(5000); console.log('This should not be printed!');"], {
    stdio: "inherit",
    env: bunEnv,
  });
}, 10);

test("slow test after test timeout", async () => {
  await Bun.sleep(100);
  console.log("Ran slow test");
}, 200);
