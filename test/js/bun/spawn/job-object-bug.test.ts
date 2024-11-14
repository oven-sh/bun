import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

it("does not hang", async () => {
  const subprocess = spawn({
    cmd: [bunExe(), "test", join(import.meta.dirname, "job-object-bug.ts")],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await Bun.readableStreamToText(subprocess.stdout);
  expect(await subprocess.exited).toBe(0);
});
