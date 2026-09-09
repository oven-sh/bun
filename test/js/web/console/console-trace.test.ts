import { join } from "node:path";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("console.trace writes to stderr instead of stdout", () => {
  const filepath = join(import.meta.dir, "console-trace.fixture.js").replaceAll("\\", "/");
  const proc = Bun.spawnSync({
    cmd: [bunExe(), filepath],
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(proc.exitCode).toBe(0);
  const stdout = proc.stdout.toString("utf8").replaceAll("\r\n", "\n");
  const stderr = proc.stderr.toString("utf8").replaceAll("\r\n", "\n");
  expect(stdout).toBe("");
  expect(stderr).toContain("hello trace");
  expect(stderr).toContain("    at ");
});