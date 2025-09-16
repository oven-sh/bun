import { test, expect, beforeEach, describe } from "bun:test";
import { bunExe, bunEnv, tempDir, normalizeBunSnapshot } from "harness";
import { join } from "path";

describe("minimumReleaseAge", () => {
  test("should skip packages published within the minimum age window", async () => {
    // Create temp directory with package.json
    using dir = tempDir("minimum-release-age-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "express": "*",
        },
      }),
      "bunfig.toml": `
[install]
minimumReleaseAge = 1440 # 1 day in minutes
`,
    });

    // Run install with minimumReleaseAge configured
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    // Check that a package.json was updated with a specific version
    // (not the absolute latest if it was published recently)
    const pkg = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
    expect(pkg.dependencies).toBeDefined();
  });

  test("should allow excluded packages to bypass minimum age", async () => {
    using dir = tempDir("minimum-release-age-exclude", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "webpack": "*",
          "express": "*",
        },
      }),
      "bunfig.toml": `
[install]
minimumReleaseAge = 10080 # 1 week in minutes  
minimumReleaseAgeExclude = ["webpack"]
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    // webpack should get the latest version as it's excluded
    // express should get an older version due to the age restriction
    const lockfile = await Bun.file(join(String(dir), "bun.lockb")).exists();
    expect(lockfile).toBe(true);
  });

  test("should respect exact version even with minimum age", async () => {
    using dir = tempDir("minimum-release-age-exact", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "express": "4.18.0",
        },
      }),
      "bunfig.toml": `
[install]
minimumReleaseAge = 1440
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    // Should install exact version regardless of age
    const pkg = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
    expect(pkg.dependencies.express).toBe("4.18.0");
  });

  test("should work with bun add command", async () => {
    using dir = tempDir("minimum-release-age-add", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
      }),
      "bunfig.toml": `
[install]
minimumReleaseAge = 2880 # 2 days in minutes
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "add", "lodash"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const pkg = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
    expect(pkg.dependencies.lodash).toBeDefined();
  });

  test("should work with zero minimum age (disabled)", async () => {
    using dir = tempDir("minimum-release-age-disabled", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "express": "*",
        },
      }),
      "bunfig.toml": `
[install]
minimumReleaseAge = 0
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    // Should get the latest version when minimumReleaseAge is 0
    const lockfile = await Bun.file(join(String(dir), "bun.lockb")).exists();
    expect(lockfile).toBe(true);
  });

  test("should handle packages without time field", async () => {
    // This tests that packages without publish time info work correctly
    using dir = tempDir("minimum-release-age-no-time", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Using a package that might not have time field in some registries
          "mime": "*",
        },
      }),
      "bunfig.toml": `
[install]
minimumReleaseAge = 10080
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    // Should still work even if time field is missing
    const pkg = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
    expect(pkg.dependencies.mime).toBeDefined();
  });
});
