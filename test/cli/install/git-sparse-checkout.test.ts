import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Test both regular install and isolated install
describe.each([{ isolated: false }, { isolated: true }])("git sparse checkout (isolated=$isolated)", ({ isolated }) => {
  const installCmd = isolated ? ["install", "--isolated"] : ["install"];

  test("should install from git subdirectory - bun-types from Bun repo", async () => {
    using dir = tempDir("git-sparse-bun-types", {
      "package.json": JSON.stringify({
        name: "test-sparse-checkout",
        dependencies: {
          // Install bun-types from the packages/bun-types subdirectory
          // Using specific commit for stability
          "bun-types": "git+https://github.com/oven-sh/bun.git#6f8138b6e4&path:packages/bun-types",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), ...installCmd],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("uncaught exception");
    expect(exitCode).toBe(0);

    // Verify the package was installed
    const nodeModulesPath = join(String(dir), "node_modules", "bun-types");
    expect(existsSync(nodeModulesPath)).toBe(true);

    // Verify package.json exists in the installed package
    const packageJsonPath = join(nodeModulesPath, "package.json");
    expect(existsSync(packageJsonPath)).toBe(true);

    // Verify it's actually bun-types by checking the package.json
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());
    expect(packageJson.name).toBe("bun-types");

    // CRITICAL: Verify the main .d.ts file exists
    const bunDtsPath = join(nodeModulesPath, "bun.d.ts");
    expect(existsSync(bunDtsPath)).toBe(true);

    const bunDtsContent = await Bun.file(bunDtsPath).text();
    expect(bunDtsContent).toContain("declare module");
    expect(bunDtsContent.length).toBeGreaterThan(1000); // Should be a substantial file

    // Verify other key .d.ts files exist
    expect(existsSync(join(nodeModulesPath, "fetch.d.ts"))).toBe(true);
    expect(existsSync(join(nodeModulesPath, "test.d.ts"))).toBe(true);

    // Verify we didn't download the entire repo (shouldn't have root-level files)
    const files = readdirSync(nodeModulesPath);
    expect(files).not.toContain("CMakeLists.txt"); // Root file from bun repo
    expect(files).not.toContain("build.zig"); // Root file from bun repo
    expect(files).not.toContain("src"); // Root dir from bun repo

    // Should NOT have a nested packages directory (means sparse checkout moved files correctly)
    expect(files).not.toContain("packages");
  }, 180000); // 3 min timeout for git clone

  test("should handle path parameter without leading slash", async () => {
    using dir = tempDir("git-sparse-no-slash", {
      "package.json": JSON.stringify({
        name: "test-sparse-no-slash",
        dependencies: {
          // Path without leading /
          "bun-types": "git+https://github.com/oven-sh/bun.git#6f8138b6e4&path:packages/bun-types",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), ...installCmd],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const bunDtsPath = join(String(dir), "node_modules", "bun-types", "bun.d.ts");
    expect(existsSync(bunDtsPath)).toBe(true);
  }, 180000);

  test("should cache subdirectory separately from full repo", async () => {
    using dir = tempDir("git-sparse-cache", {
      "package.json": JSON.stringify({
        name: "test-sparse-cache",
        dependencies: {
          "types": "git+https://github.com/oven-sh/bun.git#6f8138b6e4&path:packages/bun-types",
        },
      }),
    });

    // First install
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), ...installCmd],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode1 = await proc1.exited;
    expect(exitCode1).toBe(0);

    // Verify package installed
    const pkgPath = join(String(dir), "node_modules", "types", "bun.d.ts");
    expect(existsSync(pkgPath)).toBe(true);

    // Second install should reuse cache
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), ...installCmd],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.exited]);

    expect(exitCode2).toBe(0);
    // Verify it's still installed correctly
    expect(existsSync(pkgPath)).toBe(true);
  }, 240000);
});
