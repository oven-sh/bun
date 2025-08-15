import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("--filter should work with packages containing mixed case names", async () => {
  const dir = tempDirWithFiles("filter-workspace-case-sensitivity", {
    "package.json": JSON.stringify({
      name: "test-workspace",
      workspaces: ["packages/*"],
      private: true,
    }),
    "packages/camelCase/package.json": JSON.stringify({
      name: "camelCase",
      version: "1.0.0",
      scripts: {
        test: "echo 'camelCase test passed'",
      },
    }),
    "packages/kebab-case/package.json": JSON.stringify({
      name: "kebab-case",
      version: "1.0.0",
      scripts: {
        test: "echo 'kebab-case test passed'",
      },
    }),
    "packages/UPPERCASE/package.json": JSON.stringify({
      name: "UPPERCASE",
      version: "1.0.0",
      scripts: {
        test: "echo 'UPPERCASE test passed'",
      },
    }),
  });

  // Install workspace dependencies
  const proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  // Test filtering specific packages by name
  for (const packageName of ["camelCase", "kebab-case", "UPPERCASE"]) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "run", "--filter", packageName, "test"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`${packageName} test passed`);
    expect(stderr).not.toContain("error: ENOENT");
  }

  // Test filtering all packages
  const proc2 = Bun.spawn({
    cmd: [bunExe(), "run", "--filter", "*", "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([
    proc2.stdout.text(),
    proc2.stderr.text(),
    proc2.exited,
  ]);

  expect(exitCode2).toBe(0);
  expect(stdout2).toContain("camelCase test passed");
  expect(stdout2).toContain("kebab-case test passed");
  expect(stdout2).toContain("UPPERCASE test passed");
  expect(stderr2).not.toContain("error: ENOENT");
});

test("--filter should work with directory names that differ in case from package names", async () => {
  const dir = tempDirWithFiles("filter-workspace-dir-case", {
    "package.json": JSON.stringify({
      name: "test-workspace",
      workspaces: ["packages/*"],
      private: true,
    }),
    // Directory name is lowercase but package name has mixed case
    "packages/mixedcase/package.json": JSON.stringify({
      name: "MixedCase",
      version: "1.0.0",
      scripts: {
        test: "echo 'MixedCase directory test passed'",
      },
    }),
  });

  // Install workspace dependencies
  const proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  // Test filtering by package name (not directory name)
  const proc2 = Bun.spawn({
    cmd: [bunExe(), "run", "--filter", "MixedCase", "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc2.stdout.text(),
    proc2.stderr.text(),
    proc2.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("MixedCase directory test passed");
  expect(stderr).not.toContain("error: ENOENT");
});