import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// This test verifies that the placeholder scripts created during npm package build
// print an error message and exit with code 1, rather than silently succeeding.
// See: https://github.com/oven-sh/bun/issues/24329

// This is the placeholder script content that gets written to bin/bun.exe
// during npm package build (see packages/bun-release/scripts/upload-npm.ts)
// Note: no shebang — a #!/bin/sh shebang breaks Windows because npm's cmd-shim
// bakes the interpreter path into .ps1/.cmd wrappers before postinstall runs.
const placeholderScript = `echo "Error: Bun's postinstall script was not run." >&2
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

test("bun npm placeholder script should exit with error if postinstall hasn't run", async () => {
  // Skip on Windows as the placeholder is a shell script
  if (isWindows) {
    return;
  }

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

  // Run via sh explicitly — in real usage, bash/zsh automatically fall back to sh
  // interpretation when execve returns ENOEXEC for a shebang-less executable file.
  // Bun.spawn doesn't have that fallback, so we invoke sh directly here.
  await using proc = Bun.spawn({
    cmd: ["sh", "./bun-placeholder"],
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

// `execve` answers ENOEXEC for the placeholder, because it has no `#!` line. Bun then runs it with sh, as npx does.
test.skipIf(isWindows).each([
  ["bun x", ["x", "--no-install", "bun", "--version"]],
  ["bun run", ["run", "--silent", "bun", "--version"]],
  ["Bun Shell", ["exec", "./node_modules/.bin/bun --version"]],
])("%s prints the message of the placeholder that an install linked", async (_, cmd) => {
  using dir = tempDir("issue-24329-linked", {
    "package.json": `{ "name": "app" }`,
    "node_modules/bun/package.json": `{ "name": "bun", "version": "1.0.0", "bin": { "bun": "bin/bun.exe" } }`,
    "node_modules/bun/bin/bun.exe": placeholderScript,
  });
  chmodSync(join(String(dir), "node_modules", "bun", "bin", "bun.exe"), 0o755);
  mkdirSync(join(String(dir), "node_modules", ".bin"));
  symlinkSync("../bun/bin/bun.exe", join(String(dir), "node_modules", ".bin", "bun"));

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "",
    stderr: `Error: Bun's postinstall script was not run.

This occurs when using --ignore-scripts during installation, or when using a
package manager like pnpm that does not run postinstall scripts by default.

To fix this, run the postinstall script manually:
  cd node_modules/bun && node install.js

Or reinstall bun without the --ignore-scripts flag.
`,
    exitCode: 1,
  });
});
