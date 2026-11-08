import { expect, test } from "bun:test";
import { isWindows } from "harness";

// Each call watches the child and its two pipes, and what it watched with is let go at the end of the event loop's next turn.
// A test without an `await` makes no turn, so what these calls watched with is still waiting when the process ends.
test.skipIf(isWindows)("spawnSync many times without a turn of the event loop", () => {
  let bytes = 0;
  for (let i = 0; i < 60; i++) {
    const { stdout, exitCode } = Bun.spawnSync({ cmd: ["echo", "hi"], stderr: "pipe" });
    expect(exitCode).toBe(0);
    bytes += stdout.length;
  }
  expect(bytes).toBe(180);
});
