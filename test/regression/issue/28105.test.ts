import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

let repoDir: string;

beforeAll(() => {
  // Create a local git repo to use as a file:// dependency.
  // We cannot use `using tempDir()` because it would be cleaned up when
  // beforeAll returns, before the test runs.
  repoDir = mkdtempSync(join(tmpdir(), "git-repo-28105-"));
  writeFileSync(join(repoDir, "package.json"), JSON.stringify({ name: "test-git-pkg", version: "1.0.0" }));
  writeFileSync(join(repoDir, "index.js"), "module.exports = 'hello';");

  const gitEnv = { ...bunEnv, GIT_CONFIG_NOSYSTEM: "1" };

  expect(Bun.spawnSync({ cmd: ["git", "init"], cwd: repoDir, env: gitEnv }).exitCode).toBe(0);
  Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: repoDir, env: gitEnv });
  Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: repoDir, env: gitEnv });
  expect(Bun.spawnSync({ cmd: ["git", "add", "."], cwd: repoDir, env: gitEnv }).exitCode).toBe(0);
  expect(Bun.spawnSync({ cmd: ["git", "commit", "-m", "initial"], cwd: repoDir, env: gitEnv }).exitCode).toBe(0);
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

test("bun install with git+file:// dependency succeeds", async () => {
  // Create a separate project directory that depends on the git repo
  const projectDir = mkdtempSync(join(tmpdir(), "test-28105-"));
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify({
      name: "test-project",
      dependencies: {
        "test-git-pkg": `git+file://${repoDir}`,
      },
    }),
  );

  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      env: { ...bunEnv, GIT_ASKPASS: "echo", GIT_CONFIG_NOSYSTEM: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // With the fix, file:// git dependencies should install successfully.
    // Before the fix, the debug build would panic with:
    //   "access of union field 'git_clone' while field 'package_manifest' is active"
    // and the release build would produce a misleading error due to undefined behavior.
    expect(stdout).toContain("test-git-pkg");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
