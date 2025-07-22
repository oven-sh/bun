import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path, { join } from "path";

const YARN_TEST_DIRS = ["yarn-lock-mkdirp", "yarn-lock-mkdirp-no-resolved", "yarn-lock-mkdirp-file-dep", "yarn-stuff"];

// only download and uninstall if yarn is not already installed
if (!Bun.which("yarn")) {
  beforeAll(() => Bun.$`bun i -g yarn`.quiet());
  afterAll(() => Bun.$`bun rm -g yarn`.quiet());
}

describe("yarn.lock migration", () => {
  // Helper function to parse yarn.lock file and extract versions
  function parseYarnLock(yarnLockContent: string): Record<string, string> {
    const versions: Record<string, string> = {};
    const lines = yarnLockContent.split("\n");

    let currentPackage = "";
    for (const line of lines) {
      // Match package declaration like: "package@^1.0.0", package@"^1.0.0":
      const packageMatch = line.match(/^"?([^@"]+)@[^"]*"?:?\s*$/);
      if (packageMatch) {
        currentPackage = packageMatch[1];
        continue;
      }

      // Match version line like: version "1.0.4"
      const versionMatch = line.match(/^\s*version\s+"([^"]+)"/);
      if (versionMatch && currentPackage) {
        versions[currentPackage] = versionMatch[1];
        currentPackage = "";
      }
    }

    return versions;
  }

  // Helper function to parse bun.lockb and extract versions
  function parseBunLock(bunLockPath: string): Record<string, string> {
    // Note: This is a simplified approach. In reality, bun.lockb is a binary format
    // and would need proper parsing. For this test, we'll use a different approach
    // by checking the installed packages in node_modules
    const nodeModulesPath = path.join(path.dirname(bunLockPath), "node_modules");
    const versions: Record<string, string> = {};

    if (!fs.existsSync(nodeModulesPath)) {
      return versions;
    }

    const packages = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
    for (const pkg of packages) {
      if (pkg.isDirectory() && !pkg.name.startsWith(".")) {
        const packageJsonPath = path.join(nodeModulesPath, pkg.name, "package.json");
        if (fs.existsSync(packageJsonPath)) {
          try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
            if (packageJson.version) {
              versions[pkg.name] = packageJson.version;
            }
          } catch (e) {
            // Skip invalid package.json files
          }
        }
      }
    }

    return versions;
  }

  test.each(YARN_TEST_DIRS)("%s: yarn.lock to bun.lock migration preserves versions", async testDir => {
    const originalDir = join(import.meta.dir, "yarn", testDir);
    const packageJsonPath = join(originalDir, "package.json");

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Create temporary directory with the package.json and any local dependencies
    let tempFiles: Record<string, string> = {
      "package.json": JSON.stringify(packageJson, null, 2),
    };

    // Copy local files for file dependencies
    if (testDir === "yarn-lock-mkdirp-file-dep") {
      const mkdirpPackageJson = fs.readFileSync(join(originalDir, "mkdirp", "package.json"), "utf8");
      tempFiles["mkdirp/package.json"] = mkdirpPackageJson;

      // Copy the yarn.lock we created
      if (fs.existsSync(join(originalDir, "yarn.lock"))) {
        tempFiles["yarn.lock"] = fs.readFileSync(join(originalDir, "yarn.lock"), "utf8");
      }
    } else if (testDir === "yarn-stuff") {
      const abbrevPackageJson = fs.readFileSync(join(originalDir, "abbrev-link-target", "package.json"), "utf8");
      tempFiles["abbrev-link-target/package.json"] = abbrevPackageJson;

      // Copy the yarn.lock we created
      if (fs.existsSync(join(originalDir, "yarn.lock"))) {
        tempFiles["yarn.lock"] = fs.readFileSync(join(originalDir, "yarn.lock"), "utf8");
      }

      // We'll copy the tarball file after creating the temp directory
    }

    const tempDir = tempDirWithFiles(`yarn-migration-${testDir}`, tempFiles);

    // Copy binary files (like tarballs) after temp directory creation
    if (testDir === "yarn-stuff") {
      const tarballPath = join(originalDir, "abbrev-1.1.1.tgz");
      if (fs.existsSync(tarballPath)) {
        fs.copyFileSync(tarballPath, join(tempDir, "abbrev-1.1.1.tgz"));
      }
    }

    const yarnLockPath = join(tempDir, "yarn.lock");
    let yarnVersions: Record<string, string>;

    // Step 1: Generate or use existing yarn.lock
    if (fs.existsSync(yarnLockPath)) {
      // yarn.lock was provided manually
      const yarnLockContent = fs.readFileSync(yarnLockPath, "utf8");
      yarnVersions = parseYarnLock(yarnLockContent);
    } else {
      // Run yarn install to generate yarn.lock
      const yarnResult = await Bun.spawn({
        cmd: ["yarn", "install", "--lockfile-only"],
        cwd: tempDir,
        env: { ...bunEnv, PATH: process.env.PATH },
      });

      await yarnResult.exited;
      expect(yarnResult.exitCode).toBe(0);

      expect(fs.existsSync(yarnLockPath)).toBe(true);

      // Parse yarn.lock to get installed versions
      const yarnLockContent = fs.readFileSync(yarnLockPath, "utf8");
      yarnVersions = parseYarnLock(yarnLockContent);
    }

    // Step 2: Remove node_modules but keep yarn.lock for bun to read
    fs.rmSync(join(tempDir, "node_modules"), { recursive: true, force: true });

    // Step 3: Run bun install (should read yarn.lock and create bun.lockb)
    const bunResult = await Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: tempDir,
      env: bunEnv,
    });

    const [bunStdout, bunStderr] = await Promise.all([
      new Response(bunResult.stdout).text(),
      new Response(bunResult.stderr).text(),
    ]);

    await bunResult.exited;

    expect(bunResult.exitCode).toBe(0);

    // Check that bun.lock was created (Bun creates .lock in text format, not .lockb)
    const bunLockPath = join(tempDir, "bun.lock");
    expect(fs.existsSync(bunLockPath)).toBe(true);

    // Step 4: Compare versions by checking installed packages
    const bunVersions = parseBunLock(bunLockPath);

    // Step 5: Verify that versions match
    for (const [packageName, yarnVersion] of Object.entries(yarnVersions)) {
      expect(bunVersions[packageName]).toBeDefined();
      expect(bunVersions[packageName]).toBe(yarnVersion);
    }
  }, 100000);
});
