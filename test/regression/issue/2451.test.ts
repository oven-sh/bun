import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/2451
// bun install should show the folder path when a local dependency is missing a package.json
test("bun install shows folder path for missing package.json in folder dependency", async () => {
  using dir = tempDir("issue-2451", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "my-local-dep": "./doesnotexist",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The error message should contain the folder path that's missing
  expect(stderr).toContain("doesnotexist");
  expect(stderr).toContain("my-local-dep");
  expect(stderr).toContain("no package.json");
  expect(exitCode).toBe(1);
});

test("bun install shows folder path for missing package.json with relative path", async () => {
  using dir = tempDir("issue-2451-relative", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "local-lib": "../nonexistent-lib",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The error message should contain the folder path
  expect(stderr).toContain("nonexistent-lib");
  expect(stderr).toContain("local-lib");
  expect(stderr).toContain("no package.json");
  expect(exitCode).toBe(1);
});
