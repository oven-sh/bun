import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("workspace name validation should use path as cache key, not name", async () => {
  // This reproduces the issue where multiple workspaces with the same name
  // incorrectly report duplicate workspace name errors
  using dir = tempDir("workspace-name-cache", {
    "package.json": JSON.stringify({
      name: "root",
      workspaces: ["apps/*"],
    }),
    "apps/1000/package.json": JSON.stringify({
      name: "1000",
      version: "1.0.0",
    }),
    "apps/3000/package.json": JSON.stringify({
      name: "1000",
      version: "1.0.0",
    }),
    "apps/5000/package.json": JSON.stringify({
      name: "1000",
      version: "1.0.0",
    }),
    "apps/10000/package.json": JSON.stringify({
      name: "1000",
      version: "1.0.0",
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // The install should succeed - having the same name in different workspace paths is valid
  // (though not a good practice, it shouldn't error)
  expect(exitCode).toBe(0);
  expect(stderr).not.toContain('Workspace name "1000" already exists');
});
