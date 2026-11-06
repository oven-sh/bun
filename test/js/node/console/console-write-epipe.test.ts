import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// `head` closes the pipe after one line. The lines are more than a pipe holds, so a later write fails with EPIPE. Node's console drops the error of a
// write through a replaced process.stdout.write, so the program ends with exit code 0.
test.skipIf(isWindows)("EPIPE from a forwarding process.stdout.write is dropped, like node", async () => {
  await using proc = Bun.spawn({
    cmd: [
      "bash",
      "-c",
      `set -o pipefail; "$0" -e "$1" | head -1`,
      bunExe(),
      `
        const ow = process.stdout.write;
        process.stdout.write = function (c, ...r) { return ow.call(this, c, ...r); };
        const pad = "x".repeat(80);
        for (let i = 0; i < 1000; i++) console.log("line " + i + pad);
        process.stderr.write("done " + process.exitCode + "\\n");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("line 0" + "x".repeat(80) + "\n");
  expect(stderr).toBe("done undefined\n");
  expect(exitCode).toBe(0);
});
