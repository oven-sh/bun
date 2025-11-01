import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { join } from "path";

test("empty trustedDependencies array should be preserved in bun.lock", async () => {
  using packageDir = tempDir("trusted-deps-test-", {
    "package.json": JSON.stringify({
      name: "test-empty-trusted-deps",
      version: "1.0.0",
      trustedDependencies: [],
      workspaces: ["packages/*"], // workspaces force lockfile creation
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      version: "1.0.0",
    }),
  });

  // Run bun install with text lockfile
  const { exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: String(packageDir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await exited;
  if (exitCode !== 0) {
    console.log("stdout:", await stdout.text());
    console.log("stderr:", await stderr.text());
  }
  expect(exitCode).toBe(0);

  // Read the generated bun.lock file
  const lockfilePath = join(String(packageDir), "bun.lock");
  const lockfileContent = await Bun.file(lockfilePath).text();

  // Verify that trustedDependencies field exists in the lockfile and is an empty array
  expect(lockfileContent).toContain('"trustedDependencies":');
  // Should be an empty array (might be formatted with newlines)
  expect(lockfileContent).toMatch(/"trustedDependencies"\s*:\s*\[\s*\]/);
});

test("trustedDependencies missing vs empty should behave differently", async () => {
  // Test 1: No trustedDependencies field (should use default list)
  using packageDir1 = tempDir("trusted-deps-test-missing-", {
    "package.json": JSON.stringify({
      name: "test-default-trusted",
      version: "1.0.0",
      workspaces: ["packages/*"],
      // No trustedDependencies field
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      version: "1.0.0",
    }),
  });

  const {
    exited: exited1,
    stdout: stdout1,
    stderr: stderr1,
  } = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: String(packageDir1),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode1 = await exited1;
  if (exitCode1 !== 0) {
    console.log("stdout:", await stdout1.text());
    console.log("stderr:", await stderr1.text());
  }
  expect(exitCode1).toBe(0);

  const lockfile1 = await Bun.file(join(String(packageDir1), "bun.lock")).text();

  // Should NOT contain trustedDependencies field when it's not in package.json
  expect(lockfile1).not.toContain('"trustedDependencies"');

  // Test 2: Empty trustedDependencies field (should block all)
  using packageDir2 = tempDir("trusted-deps-test-empty-", {
    "package.json": JSON.stringify({
      name: "test-empty-trusted",
      version: "1.0.0",
      workspaces: ["packages/*"],
      trustedDependencies: [],
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      version: "1.0.0",
    }),
  });

  const {
    exited: exited2,
    stdout: stdout2,
    stderr: stderr2,
  } = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: String(packageDir2),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode2 = await exited2;
  if (exitCode2 !== 0) {
    console.log("stdout:", await stdout2.text());
    console.log("stderr:", await stderr2.text());
  }
  expect(exitCode2).toBe(0);

  const lockfile2 = await Bun.file(join(String(packageDir2), "bun.lock")).text();

  // SHOULD contain trustedDependencies field as empty array
  expect(lockfile2).toContain('"trustedDependencies":');
  expect(lockfile2).toMatch(/"trustedDependencies"\s*:\s*\[\s*\]/);
});
