import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("issue #6883 - Bun should warn when installing deprecated packages", () => {
  test("bun install shows deprecation warning for deprecated package", async () => {
    using dir = tempDir("issue-6883", {
      "package.json": JSON.stringify({
        name: "test-deprecated",
        dependencies: {
          request: "2.88.2",
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

    const [, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toContain("request@2.88.2");
    expect(stderr).toContain("deprecated");
    expect(exitCode).toBe(0);
  });

  test("bun install shows deprecation warnings for transitive deprecated dependencies", async () => {
    using dir = tempDir("issue-6883-transitive", {
      "package.json": JSON.stringify({
        name: "test-deprecated-transitive",
        dependencies: {
          // request has deprecated transitive deps like har-validator and uuid@3
          request: "2.88.2",
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

    const [, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toContain("request@2.88.2");
    expect(stderr).toContain("har-validator");
    expect(stderr).toContain("uuid");
    expect(exitCode).toBe(0);
  });

  test("bun install does not warn for non-deprecated packages", async () => {
    using dir = tempDir("issue-6883-non-deprecated", {
      "package.json": JSON.stringify({
        name: "test-non-deprecated",
        dependencies: {
          // lodash is not deprecated
          lodash: "^4.17.21",
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

    const [, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).not.toContain("deprecated");
    expect(exitCode).toBe(0);
  });
});
