import { join } from "node:path";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("console.assert prints 'Assertion failed' and prefixes messages like Node.js", () => {
  const filepath = join(import.meta.dir, "console-assert.fixture.js").replaceAll("\\", "/");
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
  expect(stderr).toContain("Assertion failed\n");
  expect(stderr).toContain("Assertion failed: message\n");
  expect(stderr).toContain("Assertion failed: with args 1 true\n");
  expect(stderr).not.toContain("should not print");
});