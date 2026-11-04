import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The `size` getter of the Map logs while the Map is formatted. That line prints first, and the outer
// line stays whole.
it("should not hang when logging to stdout recursively", async () => {
  await using proc = spawn({
    cmd: [bunExe(), import.meta.dir + "/console-recursive.js"],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "inside size\nmap: Map {}\n", stderr: "" });
  expect(exitCode).toBe(0);
});

it("should not hang when logging to stderr recursively", async () => {
  await using proc = spawn({
    cmd: [bunExe(), import.meta.dir + "/console-recursive.js", "print_to_stderr_skmxctoznf"],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "inside size\nmap: Map {}\n" });
  expect(exitCode).toBe(0);
});
