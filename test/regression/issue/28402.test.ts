import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { join } from "path";

test("frozen lockfile with filter succeeds when workspace manifests are missing", async () => {
  // Create workspace directory structure
  using dir = tempDir("issue-28402", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        "is-odd": "1.0.0",
      },
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  const cwd = String(dir);

  // Generate lockfile from full workspace
  await using installProc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  expect(await installProc.exited).toBe(0);

  // Read the generated lockfile
  const lockfileContent = await Bun.file(join(cwd, "bun.lock")).text();

  // Simulate Docker pattern: new directory with only subset of workspace manifests
  using dockerDir = tempDir("issue-28402-docker", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "bun.lock": lockfileContent,
    "packages/app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        "is-odd": "1.0.0",
      },
    }),
    // packages/lib/package.json is intentionally NOT present
  });

  const dockerCwd = String(dockerDir);

  // Run frozen install with filter — should succeed
  await using frozenProc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--filter", "app"],
    cwd: dockerCwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stderr, exitCode] = await Promise.all([frozenProc.stderr.text(), frozenProc.exited]);

  expect(stderr).not.toContain("lockfile had changes");
  expect(stderr).not.toContain("Workspace not found");
  expect(exitCode).toBe(0);
});

test("frozen lockfile with filter still catches modified filtered workspace", async () => {
  // Create workspace directory structure
  using dir = tempDir("issue-28402-modified", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        "is-odd": "1.0.0",
      },
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  const cwd = String(dir);

  // Generate lockfile from full workspace
  await using installProc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  expect(await installProc.exited).toBe(0);

  const lockfileContent = await Bun.file(join(cwd, "bun.lock")).text();

  // Docker pattern but with a MODIFIED filtered workspace (added a new dep)
  using dockerDir = tempDir("issue-28402-modified-docker", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "bun.lock": lockfileContent,
    "packages/app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        "is-odd": "1.0.0",
        "is-number": "2.0.0", // NEW dependency not in lockfile
      },
    }),
  });

  const dockerCwd = String(dockerDir);

  // Should FAIL because the filtered workspace has changes not in the lockfile
  await using frozenProc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--filter", "app"],
    cwd: dockerCwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stderr, exitCode] = await Promise.all([frozenProc.stderr.text(), frozenProc.exited]);

  expect(stderr).toContain("lockfile had changes");
  expect(exitCode).not.toBe(0);
});

test("frozen lockfile with filter succeeds with literal workspace paths", async () => {
  // Same as first test but with literal workspace entries instead of globs
  using dir = tempDir("issue-28402-literal", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/app", "packages/lib"],
    }),
    "packages/app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        "is-odd": "1.0.0",
      },
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  const cwd = String(dir);

  await using installProc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  expect(await installProc.exited).toBe(0);

  const lockfileContent = await Bun.file(join(cwd, "bun.lock")).text();

  // Docker pattern with literal paths — only app present
  using dockerDir = tempDir("issue-28402-literal-docker", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/app", "packages/lib"],
    }),
    "bun.lock": lockfileContent,
    "packages/app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        "is-odd": "1.0.0",
      },
    }),
  });

  const dockerCwd = String(dockerDir);

  await using frozenProc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--filter", "app"],
    cwd: dockerCwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stderr, exitCode] = await Promise.all([frozenProc.stderr.text(), frozenProc.exited]);

  expect(stderr).not.toContain("lockfile had changes");
  expect(stderr).not.toContain("Workspace not found");
  expect(exitCode).toBe(0);
});
