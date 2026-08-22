import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

test("symbol-keyed env properties are not passed to the child", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", "console.log(JSON.stringify([process.env.SYMK ?? null, process.env.REALK ?? null]))"],
    env: { ...bunEnv, REALK: "yes", [Symbol("SYMK")]: "leaked" },
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe('[null,"yes"]\n');
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
