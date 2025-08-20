import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "fs";

test("bun prune removes extraneous packages", async () => {
  const tempDir = tempDirWithFiles("prune-test", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "react": "^18.0.0",
      },
    }),
  });

  // First, install dependencies to create a valid lockfile
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [, , exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(), 
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  // Manually create an extraneous package in node_modules
  const nodeModulesPath = join(tempDir, "node_modules");
  const extraneousPackagePath = join(nodeModulesPath, "extraneous-package");
  mkdirSync(extraneousPackagePath, { recursive: true });
  writeFileSync(join(extraneousPackagePath, "package.json"), JSON.stringify({
    name: "extraneous-package",
    version: "1.0.0",
  }));

  // Create a scoped extraneous package
  const scopedPath = join(nodeModulesPath, "@scope");
  mkdirSync(scopedPath, { recursive: true });
  const scopedPackagePath = join(scopedPath, "extraneous");
  mkdirSync(scopedPackagePath, { recursive: true });
  writeFileSync(join(scopedPackagePath, "package.json"), JSON.stringify({
    name: "@scope/extraneous",
    version: "1.0.0",
  }));

  // Run bun prune
  await using pruneProc = Bun.spawn({
    cmd: [bunExe(), "prune"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [pruneStdout, pruneStderr, pruneExitCode] = await Promise.all([
    pruneProc.stdout.text(),
    pruneProc.stderr.text(),
    pruneProc.exited,
  ]);

  expect(pruneExitCode).toBe(0);
  expect(pruneStdout).toMatch(/Removed \d+ extraneous package/);

  // Verify the extraneous packages were removed
  const extraneousExists = await Bun.file(join(extraneousPackagePath, "package.json")).exists();
  const scopedExists = await Bun.file(join(scopedPackagePath, "package.json")).exists();
  
  expect(extraneousExists).toBe(false);
  expect(scopedExists).toBe(false);

  // Verify legitimate packages remain  
  const reactExists = await Bun.file(join(nodeModulesPath, "react", "package.json")).exists();
  expect(reactExists).toBe(true);
});

test("bun prune with no extraneous packages", async () => {
  const tempDir = tempDirWithFiles("prune-test-no-extra", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "react": "^18.0.0",
      },
    }),
  });

  // Install dependencies
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  await proc.exited;

  // Run bun prune - should succeed with no changes
  await using pruneProc = Bun.spawn({
    cmd: [bunExe(), "prune"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [pruneStdout, pruneStderr, pruneExitCode] = await Promise.all([
    pruneProc.stdout.text(),
    pruneProc.stderr.text(),
    pruneProc.exited,
  ]);

  expect(pruneExitCode).toBe(0);
  expect(pruneStdout).toMatch(/Pruned extraneous packages/);
});

test("bun prune without lockfile fails", async () => {
  const tempDir = tempDirWithFiles("prune-test-no-lockfile", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "react": "^18.0.0",
      },
    }),
  });

  // Run bun prune without installing first (no lockfile)
  await using pruneProc = Bun.spawn({
    cmd: [bunExe(), "prune"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [pruneStdout, pruneStderr, pruneExitCode] = await Promise.all([
    pruneProc.stdout.text(),
    pruneProc.stderr.text(),
    pruneProc.exited,
  ]);

  expect(pruneExitCode).toBe(1);
  expect(pruneStderr).toMatch(/Lockfile not found/);
});

test("bun prune without package.json fails", async () => {
  const tempDir = tempDirWithFiles("prune-test-no-package-json", {});

  // Run bun prune without package.json
  await using pruneProc = Bun.spawn({
    cmd: [bunExe(), "prune"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [pruneStdout, pruneStderr, pruneExitCode] = await Promise.all([
    pruneProc.stdout.text(),
    pruneProc.stderr.text(),
    pruneProc.exited,
  ]);

  expect(pruneExitCode).toBe(1);
  expect(pruneStderr).toMatch(/No package\.json was found/);
});

test("bun prune --help shows help text", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "prune", "--help"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toMatch(/Usage.*bun prune/);
  expect(stdout).toMatch(/Remove extraneous packages/);
});

test("bun prune with no node_modules directory", async () => {
  const tempDir = tempDirWithFiles("prune-test-no-node-modules", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "react": "^18.0.0",
      },
    }),
  });

  // Install first to create a valid lockfile
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  await installProc.exited;

  // Remove node_modules directory after installing but keep lockfile
  rmSync(join(tempDir, "node_modules"), { recursive: true, force: true });

  // Run bun prune
  await using pruneProc = Bun.spawn({
    cmd: [bunExe(), "prune"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [pruneStdout, pruneStderr, pruneExitCode] = await Promise.all([
    pruneProc.stdout.text(),
    pruneProc.stderr.text(),
    pruneProc.exited,
  ]);

  // Should succeed even with no node_modules
  expect(pruneExitCode).toBe(0);
});