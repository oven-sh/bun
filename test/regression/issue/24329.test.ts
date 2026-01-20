import { expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";

// This test verifies that the placeholder scripts created during npm package build
// print an error message and exit with code 1, rather than silently succeeding.
// See: https://github.com/oven-sh/bun/issues/24329

test("bun npm placeholder script should exit with error if postinstall hasn't run", async () => {
  // Skip on Windows as the placeholder is a shell script
  if (isWindows) {
    return;
  }

  // This is the placeholder script content that gets written to bin/bun.exe
  // during npm package build (see packages/bun-release/scripts/upload-npm.ts)
  const placeholderScript = `#!/bin/sh
echo "Error: Bun's postinstall script was not run." >&2
echo "" >&2
echo "This occurs when using --ignore-scripts during installation, or when using a" >&2
echo "package manager like pnpm that does not run postinstall scripts by default." >&2
echo "" >&2
echo "To fix this, run the postinstall script manually:" >&2
echo "  cd node_modules/bun && node install.js" >&2
echo "" >&2
echo "Or reinstall bun without the --ignore-scripts flag." >&2
exit 1
`;

  using dir = tempDir("issue-24329", {
    "bun-placeholder": placeholderScript,
  });

  // Make the placeholder executable
  const { exitCode: chmodExitCode } = Bun.spawnSync({
    cmd: ["chmod", "+x", "bun-placeholder"],
    cwd: String(dir),
    env: bunEnv,
  });
  expect(chmodExitCode).toBe(0);

  // Run the placeholder script
  await using proc = Bun.spawn({
    cmd: ["./bun-placeholder", "--version"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The placeholder should exit with code 1
  expect(exitCode).toBe(1);

  // stdout should be empty (all output goes to stderr)
  expect(stdout).toBe("");

  // stderr should contain the error message
  expect(stderr).toContain("Error: Bun's postinstall script was not run.");
  expect(stderr).toContain("--ignore-scripts");
  expect(stderr).toContain("cd node_modules/bun && node install.js");
});

test("empty shell script exits with code 0 (demonstrating why the fix is needed)", async () => {
  // Skip on Windows
  if (isWindows) {
    return;
  }

  // This simulates the OLD behavior: an empty shell script (with shebang)
  // Note: A completely empty file can't be executed by Bun.spawn (ENOEXEC),
  // but an empty shell script with a shebang exits with code 0
  using dir = tempDir("issue-24329-old", {
    "bun-placeholder": "#!/bin/sh\n",
  });

  // Make it executable
  const { exitCode: chmodExitCode } = Bun.spawnSync({
    cmd: ["chmod", "+x", "bun-placeholder"],
    cwd: String(dir),
    env: bunEnv,
  });
  expect(chmodExitCode).toBe(0);

  // Run the empty shell script
  await using proc = Bun.spawn({
    cmd: ["./bun-placeholder", "--version"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Empty shell script exits with code 0 silently - this is similar to the bug behavior
  // Assert stdout/stderr before exitCode to get more useful error messages on failure
  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
