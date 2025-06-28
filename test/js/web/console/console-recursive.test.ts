import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("should not hang when logging to stdout recursively", async () => {
  const { exited } = spawn({
    cmd: [bunExe(), import.meta.dir + "/console-recursive.js"],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(await exited).toBe(0);
});

it("should not hang when logging to stderr recursively", async () => {
  const { exited } = spawn({
    cmd: [bunExe(), import.meta.dir + "/console-recursive.js", "print_to_stderr_skmxctoznf"],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(await exited).toBe(0);
});
