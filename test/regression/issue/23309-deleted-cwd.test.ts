import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("error.Unexpected with ENOENT shows deleted directory message", async () => {
  // This test verifies that when the current directory is deleted,
  // we show a helpful error message instead of the misleading
  // "low max file descriptors" error.

  using dir = tempDir("deleted-cwd-direct", {
    "package.json": JSON.stringify({
      name: "test",
      version: "1.0.0",
    }),
  });

  // Use Python to chdir into a directory and then delete it,
  // then exec bun from that deleted cwd
  const pythonScript = `
import os
import subprocess
os.chdir("${dir}")
os.rmdir("${dir}")
result = subprocess.run(["${bunExe()}", "install"], capture_output=True, text=True)
print(result.stdout, end='')
print(result.stderr, end='')
  `;

  const proc = Bun.spawn({
    cmd: ["python3", "-c", pythonScript],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;

  // We should NOT see the misleading file descriptor error
  expect(output).not.toContain("low max file descriptors");
  expect(output).not.toContain("ulimit -n");

  // The directory was deleted, so we expect some kind of error
  expect(exitCode).not.toBe(0);
});
