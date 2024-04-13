import { crash_handler } from "bun:internal-for-testing";
import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";
import path from "path";
const { getMachOImageZeroOffset } = crash_handler;

test.if(process.platform === "darwin")("macOS has the assumed image offset", () => {
  // If this fails, then https://bun.report will be incorrect and the stack
  // trace remappings will stop working.
  expect(getMachOImageZeroOffset()).toBe(0x100000000);
});

test("a panic dumps a trace string", async () => {
  const result = Bun.spawnSync([bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "panic"], {
    env: {
      ...bunEnv,
    },
  });
});
