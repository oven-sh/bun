// https://github.com/oven-sh/bun/issues/26597
// Parallel file execution should work on Windows when bun path contains backslashes
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("#26597: parallel file execution works (Windows backslash path handling)", async () => {
  using dir = tempDir("issue-26597", {
    "a.js": "console.log('hello-a')",
    "b.js": "console.log('hello-b')",
  });

  // This previously failed on Windows with "bun: command not found: C:Usersjake.bunbinbun.exe"
  // because backslashes in the bun executable path were being stripped by the shell parser.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--parallel", "a.js", "b.js"],
    env: { ...bunEnv, NO_COLOR: "1" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Both scripts should run and produce prefixed output
  expect(stdout).toMatch(/a\.js\s+\| .*hello-a/);
  expect(stdout).toMatch(/b\.js\s+\| .*hello-b/);
  expect(exitCode).toBe(0);
});
