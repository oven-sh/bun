import { spawn } from "bun";
import { test } from "bun:test";
import { bunExe } from "harness";

test("spawn env", async () => {
  const env = {};
  Object.defineProperty(env, "LOL", {
    get() {
      throw new Error("Bad!!");
    },
    configurable: false,
    enumerable: true,
  });

  // This was the minimum to reliably cause a crash in Bun < v1.1.42
  for (let i = 0; i < 1024 * 10; i++) {
    try {
      const result = spawn({
        env,
        cmd: [bunExe(), "-e", "console.log(process.env.LOL)"],
      });
    } catch (e) {}
  }
});
