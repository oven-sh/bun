import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/18239
test.skipIf(isWindows)("TTY stdin buffering should work correctly", async () => {
  const dataGeneratorPath = join(import.meta.dir, "data-generator.sh");
  const fixturePath = join(import.meta.dir, "18239.fixture.ts");

  // Run the data generator piped into our TTY test fixture
  const result = spawnSync({
    cmd: ["bash", "-c", `"${dataGeneratorPath}" | "${bunExe()}" "${fixturePath}"`],
    env: {
      ...bunEnv,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();

  // Should have received exactly 3 chunks
  expect(stdout).toContain("Received 3 chunks, exiting...");

  // Should not have the error message
  expect(stderr).not.toContain("Exited without receiving 3 chunks");

  // Should contain chunk messages with timestamps
  expect(stdout).toMatch(/\[.*\] Chunk #1:/);
  expect(stdout).toMatch(/\[.*\] Chunk #2:/);
  expect(stdout).toMatch(/\[.*\] Chunk #3:/);

  expect(result.exitCode).toBe(0);
});
