import { jest, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("test timeout kills dangling processes under fake timers", () => {
  jest.useFakeTimers();
  try {
    Bun.spawnSync({
      cmd: [bunExe(), "--eval", "Bun.sleepSync(5000); console.log('This should not be printed!');"],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: bunEnv,
    });
  } finally {
    jest.useRealTimers();
  }
}, 10);
