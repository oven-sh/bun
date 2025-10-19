import { spawn } from "bun";
import { beforeEach, expect, test } from "bun:test";
import { writeFile } from "fs/promises";
import { bunExe, bunEnv as env, tmpdirSync } from "harness";
import { join } from "path";

// This test reproduces a crash where metadata is null after a network failure
// The bug was in PackageManagerTask.zig:104 which assumed metadata is always set

let package_dir: string;

beforeEach(async () => {
  package_dir = tmpdirSync();
});

test("metadata null crash - connection refused", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-pkg",
      version: "0.0.1",
      dependencies: {
        "nonexistent-package": "^1.0.0",
      },
    }),
  );

  // Use a registry URL that will refuse connections
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:1/"
`,
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await stderr.text();
  const out = await stdout.text();
  const code = await exited;

  // Should fail gracefully, not crash with panic
  expect(code).not.toBe(0);
  expect(err).not.toContain("panic");
  expect(err).not.toContain("Assertion failure");
  expect(err).toContain("error");
});

test("metadata null crash - max retries exceeded with connection errors", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-pkg",
      version: "0.0.1",
      dependencies: {
        "some-package": "^1.0.0",
      },
    }),
  );

  // Use an invalid/unreachable registry
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://192.0.2.1:12345/"
maxRetryCount = 1
`,
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
    timeout: 30000,
  });

  const err = await stderr.text();
  const out = await stdout.text();
  const code = await exited;

  // Should fail gracefully, not crash with panic
  expect(code).not.toBe(0);
  expect(err).not.toContain("panic");
  expect(err).not.toContain("Assertion failure");
  expect(err).not.toContain("Expected metadata to be set");
});
