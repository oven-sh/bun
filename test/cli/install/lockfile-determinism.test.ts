import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/16527
// Verifies that lockfile output is deterministic across multiple installs.
test("bun install produces deterministic text lockfile across multiple runs", async () => {
  const lockfiles: string[] = [];

  for (let i = 0; i < 3; i++) {
    using dir = tempDir("lockfile-determinism-", {
      "package.json": JSON.stringify({
        name: "lockfile-determinism-test",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          "pkg-c": "workspace:*",
        },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: {
          "pkg-c": "workspace:*",
          "pkg-a": "workspace:*",
        },
      }),
      "packages/pkg-c/package.json": JSON.stringify({
        name: "pkg-c",
        version: "1.0.0",
      }),
      "packages/pkg-d/package.json": JSON.stringify({
        name: "pkg-d",
        version: "2.0.0",
        dependencies: {
          "pkg-a": "workspace:*",
          "pkg-b": "workspace:*",
          "pkg-c": "workspace:*",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--save-text-lockfile"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const lockfileContent = readFileSync(join(String(dir), "bun.lock"), "utf-8");
    lockfiles.push(lockfileContent);
  }

  // All lockfiles should be identical
  expect(lockfiles[0]).toBe(lockfiles[1]);
  expect(lockfiles[0]).toBe(lockfiles[2]);
}, 30_000);

test("bun install produces deterministic binary lockfile across multiple runs", async () => {
  const lockfiles: Buffer[] = [];

  for (let i = 0; i < 3; i++) {
    using dir = tempDir("lockfile-determinism-", {
      "bunfig.toml": "[install]\nsaveTextLockfile = false\n",
      "package.json": JSON.stringify({
        name: "lockfile-determinism-test",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          "pkg-c": "workspace:*",
        },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: {
          "pkg-c": "workspace:*",
          "pkg-a": "workspace:*",
        },
      }),
      "packages/pkg-c/package.json": JSON.stringify({
        name: "pkg-c",
        version: "1.0.0",
      }),
      "packages/pkg-d/package.json": JSON.stringify({
        name: "pkg-d",
        version: "2.0.0",
        dependencies: {
          "pkg-a": "workspace:*",
          "pkg-b": "workspace:*",
          "pkg-c": "workspace:*",
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

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const lockfileContent = readFileSync(join(String(dir), "bun.lockb"));
    lockfiles.push(lockfileContent);
  }

  // All binary lockfiles should be identical
  expect(Buffer.compare(lockfiles[0], lockfiles[1])).toBe(0);
  expect(Buffer.compare(lockfiles[0], lockfiles[2])).toBe(0);
}, 30_000);
