import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun install warns and continues when security scanner is unavailable", async () => {
  using dir = tempDir("issue-28193", {
    "package.json": JSON.stringify({
      name: "test-28193",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
    "bunfig.toml": `[install.security]\nscanner = "@nonexistent-scanner/does-not-exist"\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: String(dir) + "/.cache" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The install should succeed (exit code 0) even though the scanner is unavailable
  expect(stderr).toContain("Continuing installation without security scan");
  expect(exitCode).toBe(0);
});

test("bun install silently exits with code 1 when scanner fails (old behavior check)", async () => {
  // When the scanner is a devDependency that can't be loaded,
  // the install should still complete with a warning
  using dir = tempDir("issue-28193-devdep", {
    "package.json": JSON.stringify({
      name: "test-28193-devdep",
      devDependencies: {
        "is-even": "1.0.0",
      },
    }),
    "bunfig.toml": `[install.security]\nscanner = "is-even"\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: String(dir) + "/.cache" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The install should succeed (exit code 0) even though the scanner module is invalid
  // (is-even is not a valid security scanner - it won't have the right exports)
  expect(stderr).toContain("Continuing installation without security scan");
  expect(exitCode).toBe(0);
});
