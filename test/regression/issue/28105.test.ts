import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

let repoDir: ReturnType<typeof tempDir>;

beforeAll(() => {
  // Create a local git repo to use as a file:// dependency.
  // We don't use `using` because the directory must survive until afterAll.
  repoDir = tempDir("git-repo-28105", {
    "package.json": JSON.stringify({ name: "test-git-pkg", version: "1.0.0" }),
    "index.js": "module.exports = 'hello';",
  });

  const gitEnv = { ...bunEnv, GIT_CONFIG_NOSYSTEM: "1" };
  const cwd = String(repoDir);

  expect(Bun.spawnSync({ cmd: ["git", "init"], cwd, env: gitEnv }).exitCode).toBe(0);
  expect(Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd, env: gitEnv }).exitCode).toBe(0);
  expect(Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd, env: gitEnv }).exitCode).toBe(0);
  expect(Bun.spawnSync({ cmd: ["git", "add", "."], cwd, env: gitEnv }).exitCode).toBe(0);
  expect(Bun.spawnSync({ cmd: ["git", "commit", "-m", "initial"], cwd, env: gitEnv }).exitCode).toBe(0);
});

afterAll(() => {
  repoDir[Symbol.dispose]();
});

test("bun install with git+file:// dependency succeeds", async () => {
  using projectDir = tempDir("test-28105", {
    "package.json": JSON.stringify({
      name: "test-project",
      dependencies: {
        "test-git-pkg": `git+file://${repoDir}`,
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(projectDir),
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
});
