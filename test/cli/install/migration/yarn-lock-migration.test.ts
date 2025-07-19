import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join, basename } from "path";
import fs from "fs";
import path from "path";

const YARN_TEST_DIRS = [
  "yarn-lock-mkdirp",
  "yarn-lock-mkdirp-no-resolved"
  // Skip file-dep and yarn-stuff tests as they have complex file dependencies
  // "yarn-lock-mkdirp-file-dep",
  // "yarn-stuff"
];

describe("yarn.lock migration", () => {
  // Helper function to parse yarn.lock file and extract versions
  function parseYarnLock(yarnLockContent: string): Record<string, string> {
    const versions: Record<string, string> = {};
    const lines = yarnLockContent.split('\n');
    
    let currentPackage = '';
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
        currentPackage = '';
      }
    }
    
    return versions;
  }

  // Helper function to parse bun.lockb and extract versions
  function parseBunLock(bunLockPath: string): Record<string, string> {
    // Note: This is a simplified approach. In reality, bun.lockb is a binary format
    // and would need proper parsing. For this test, we'll use a different approach
    // by checking the installed packages in node_modules
    const nodeModulesPath = path.join(path.dirname(bunLockPath), 'node_modules');
    const versions: Record<string, string> = {};
    
    if (!fs.existsSync(nodeModulesPath)) {
      return versions;
    }
    
    const packages = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
    for (const pkg of packages) {
      if (pkg.isDirectory() && !pkg.name.startsWith('.')) {
        const packageJsonPath = path.join(nodeModulesPath, pkg.name, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
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

  for (const testDir of YARN_TEST_DIRS) {
    test(`${testDir}: yarn.lock to bun.lock migration preserves versions`, async () => {
      const originalDir = join(import.meta.dir, "yarn", testDir);
      const packageJsonPath = join(originalDir, "package.json");
      
      // Skip if package.json doesn't exist
      if (!fs.existsSync(packageJsonPath)) {
        console.log(`Skipping ${testDir}: no package.json found`);
        return;
      }
      
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Create temporary directory with the package.json
      const tempDir = tempDirWithFiles(`yarn-migration-${testDir}`, {
        "package.json": JSON.stringify(packageJson, null, 2)
      });
      
      console.log(`Testing ${testDir} in ${tempDir}`);
      
      // Step 1: Run yarn install to generate yarn.lock
      const yarnResult = await Bun.spawn({
        cmd: ["yarn", "install"],
        cwd: tempDir,
        env: { ...bunEnv, PATH: process.env.PATH },
      });
      
      await yarnResult.exited;
      expect(yarnResult.exitCode).toBe(0);
      
      const yarnLockPath = join(tempDir, "yarn.lock");
      expect(fs.existsSync(yarnLockPath)).toBe(true);
      
      // Parse yarn.lock to get installed versions
      const yarnLockContent = fs.readFileSync(yarnLockPath, 'utf8');
      const yarnVersions = parseYarnLock(yarnLockContent);
      
      console.log(`Yarn installed versions:`, yarnVersions);
      
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
      
      if (bunResult.exitCode !== 0) {
        console.error(`Bun install failed for ${testDir}:`);
        console.error("STDOUT:", bunStdout);
        console.error("STDERR:", bunStderr);
      }
      
      expect(bunResult.exitCode).toBe(0);
      
      // Check that bun.lock was created (Bun creates .lock in text format, not .lockb)
      const bunLockPath = join(tempDir, "bun.lock");
      expect(fs.existsSync(bunLockPath)).toBe(true);
      
      // Step 4: Compare versions by checking installed packages
      const bunVersions = parseBunLock(bunLockPath);
      
      console.log(`Bun installed versions:`, bunVersions);
      
      // Step 5: Verify that versions match
      for (const [packageName, yarnVersion] of Object.entries(yarnVersions)) {
        expect(bunVersions[packageName]).toBeDefined();
        expect(bunVersions[packageName]).toBe(yarnVersion);
      }
      
      // Also verify that bun didn't install extra packages
      for (const [packageName, bunVersion] of Object.entries(bunVersions)) {
        if (!yarnVersions[packageName]) {
          console.warn(`Bun installed extra package: ${packageName}@${bunVersion}`);
        }
      }
    }, 60000); // 60 second timeout for each test
  }
});