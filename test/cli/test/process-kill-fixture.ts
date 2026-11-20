import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The timeout leaves the callback time to spawn the process: a callback that is still running script at
// its timeout is stopped there.
test("test timeout kills dangling processes", async () => {
  Bun.spawn({
    cmd: [bunExe(), "--eval", "Bun.sleepSync(3000); console.log('This should not be printed!');"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: bunEnv,
  });
  await Bun.sleep(3000);
}, 500);

test("slow test after test timeout", async () => {
  await Bun.sleep(100);
  console.log("Ran slow test");
}, 200);
