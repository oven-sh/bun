import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("test timeout kills dangling processes", async () => {
  Bun.spawn({
    cmd: [bunExe(), "--eval", "Bun.sleepSync(50); console.log('This should not be printed!');"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: bunEnv,
  });
  await Bun.sleep(5);
}, 1);

test("slow test after test timeout", async () => {
  await Bun.sleep(100);
  console.log("Ran slow test");
}, 200);
