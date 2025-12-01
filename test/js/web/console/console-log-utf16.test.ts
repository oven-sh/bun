import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

it("works with large utf-16 strings", async () => {
  const filepath = join(import.meta.dir, "console-log-utf16.fixture.js").replaceAll("\\", "/");
  const proc = Bun.spawn({
    cmd: [bunExe(), filepath],
    env: { ...bunEnv },
    stdio: ["inherit", "pipe", "pipe"],
  });

  const exitCode = await proc.exited;
  const stdout = await proc.stdout.text();
  const stderr = await proc.stderr.text();
  expect(stderr).toBeEmpty();
  expect(exitCode).toBe(0);

  const expected = Array(10000).fill("肉醬意大利粉").join("\n");
  // Add the \n because `console.log` adds a newline
  expect(stdout).toBe(expected + "\n");
});
