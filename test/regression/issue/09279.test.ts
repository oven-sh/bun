import { which } from "bun";
import { expect, test } from "bun:test";
import { spawn } from "node:child_process";

test.if(!!which("sleep"))("child_process.spawn({ timeout }) should not exit instantly", async () => {
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sleep", ["1000"], { timeout: 100 });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  const end = performance.now();
  expect(end - start).toBeGreaterThanOrEqual(100);
});
