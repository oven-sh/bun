import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27988
// On Windows, `bun run` should resolve local .bat/.cmd files from CWD
// when referenced as bare command names in package.json scripts
test.todoIf(
  process.platform !== "win32",
  "bun run resolves local .bat files in package.json scripts on Windows",
  async () => {
    using dir = tempDir("issue-27988", {
      "package.json": JSON.stringify({
        name: "bun-test-27988",
        scripts: {
          recovery: "WebRecovery.bat",
        },
      }),
      "WebRecovery.bat": "@echo Hello from WebRecovery.bat\n",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "recovery"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Hello from WebRecovery.bat");
    expect(exitCode).toBe(0);
  },
);
