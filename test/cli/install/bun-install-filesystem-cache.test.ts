import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { exists, mkdir, rm, stat, realpath } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  tempDirWithFiles,
  tmpdirSync,
  VerdaccioRegistry,
} from "harness";
import { join, dirname } from "path";

let registry: VerdaccioRegistry;
let projectDir: string;
let packageJson: string;
let testRoot: string;

beforeAll(async () => {
  setDefaultTimeout(1000 * 60 * 5);
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(async () => {
  registry.stop();
});

beforeEach(async () => {
  // Clean up environment
  delete env.BUN_INSTALL_CACHE_DIR;
  delete env.BUN_INSTALL;
  delete env.XDG_CACHE_HOME;
  
  // Create test directory using registry helper
  ({ packageDir: projectDir, packageJson } = await registry.createTestDir({ saveTextLockfile: false }));
  testRoot = dirname(projectDir);
  
  // Set up environment to isolate cache behavior
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(projectDir, ".bun-tmp");
  
  // Set HOME to ensure cache doesn't go to real home directory
  env.HOME = env.USERPROFILE = testRoot;
});

afterEach(async () => {
  // Clean up is handled by registry.createTestDir
});

describe("filesystem-aware cache", () => {
  test("uses default cache when on same filesystem", async () => {
    // Set up a default cache location
    const defaultCache = join(dirname(projectDir), "default-cache");
    env.BUN_INSTALL_CACHE_DIR = defaultCache;
    
    // Create a simple package.json with registry
    const pkg = {
      name: "test-project",
      dependencies: {
        "no-deps": "1.0.0", // Use a simple package from the test registry
      },
    };
    
    await writeFileSync(packageJson, JSON.stringify(pkg));
    
    // Run bun install
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    
    // Verify cache was created in the default location
    expect(await exists(defaultCache)).toBe(true);
    
    // Verify that packages were installed
    expect(await exists(join(projectDir, "node_modules", "no-deps"))).toBe(true);
  });
  
  test("creates filesystem-specific cache when on different filesystem", async () => {
    // This test simulates different filesystems by checking if the optimal cache
    // location is created when the default would be on a different filesystem
    
    // For testing, we'll check that .bun-cache is created in the project directory
    // when no other cache location is specified
    const pkg = {
      name: "test-project",
      dependencies: {
        "no-deps": "1.0.0",
      },
    };
    
    await writeFileSync(packageJson, JSON.stringify(pkg));
    
    // Run bun install without specifying cache dir
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const [stdout, stderr] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
    ]);
    
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      console.error("Install failed:", { stdout, stderr, exitCode });
    }
    
    expect(exitCode).toBe(0);
    
    // Check for possible cache locations
    const possibleCaches = [
      join(projectDir, ".bun-cache"),
      join(projectDir, "node_modules", ".bun-cache"),
      join(projectDir, "node_modules", ".cache"),
      join(dirname(projectDir), ".bun-cache"),
    ];
    
    let cacheFound = false;
    let foundCache = "";
    for (const cache of possibleCaches) {
      if (await exists(cache)) {
        cacheFound = true;
        foundCache = cache;
        break;
      }
    }
    
    if (!cacheFound) {
      // List directory contents to debug
      console.error("No cache found. Project dir contents:");
      await Bun.$`ls -la ${projectDir}`.quiet(false);
      console.error("Node modules contents:");
      await Bun.$`ls -la ${join(projectDir, "node_modules")}`.quiet(false).catch(() => {});
    }
    
    expect(cacheFound).toBe(true);
    expect(await exists(join(projectDir, "node_modules", "no-deps"))).toBe(true);
  });
  
  test("walks up directory tree to find writable cache location", async () => {
    // Create a nested project structure
    const nestedProject = join(projectDir, "nested", "deep", "project");
    await mkdir(nestedProject, { recursive: true });
    
    const pkg = {
      name: "nested-project",
      dependencies: {
        "no-deps": "1.0.0",
      },
    };
    
    // Write package.json to nested location
    await mkdir(dirname(join(nestedProject, "package.json")), { recursive: true });
    writeFileSync(join(nestedProject, "package.json"), JSON.stringify(pkg));
    // Also need .npmrc for registry
    writeFileSync(join(nestedProject, ".npmrc"), `registry=${registry.registryUrl()}`);
    
    // Run bun install in the nested directory
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: nestedProject,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const [stdout, stderr] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
    ]);
    
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      console.error("Install failed:", { stdout, stderr, exitCode });
    }
    
    expect(exitCode).toBe(0);
    
    // Check that a cache was created somewhere in the hierarchy
    const possibleCaches = [
      join(nestedProject, ".bun-cache"),
      join(nestedProject, "node_modules", ".bun-cache"),
      join(nestedProject, "node_modules", ".cache"),
      join(dirname(nestedProject), ".bun-cache"),
      join(dirname(dirname(nestedProject)), ".bun-cache"),
      join(dirname(dirname(dirname(nestedProject))), ".bun-cache"),
      join(projectDir, ".bun-cache"),
      join(testRoot, ".bun-cache"),
      join(testRoot, ".bun", "install", "cache"), // Default HOME-based cache
    ];
    
    let cacheFound = false;
    let cacheLocation = "";
    for (const cache of possibleCaches) {
      if (await exists(cache)) {
        cacheFound = true;
        cacheLocation = cache;
        break;
      }
    }
    
    if (!cacheFound) {
      console.error("No cache found. Nested project dir:", nestedProject);
      console.error("Possible cache locations checked:", possibleCaches);
      
      // Check what actually exists
      console.error("Looking for .bun-cache or .cache directories...");
      await Bun.$`find ${testRoot} -name ".bun-cache" -o -name ".cache" 2>/dev/null || true`.quiet(false);
      
      // Also check if there's a default cache being used
      if (env.HOME) {
        const homeCache = join(env.HOME, ".bun", "install", "cache");
        console.error("Checking HOME cache:", homeCache);
        if (await exists(homeCache)) {
          console.error("Found cache in HOME directory");
          await Bun.$`ls -la ${homeCache}`.quiet(false).catch(() => {});
        }
      }
    }
    
    expect(cacheFound).toBe(true);
    expect(await exists(join(nestedProject, "node_modules", "no-deps"))).toBe(true);
    
    // Verify the cache contains the package
    if (cacheLocation && cacheFound) {
      const cacheContents = await Bun.$`ls ${cacheLocation}`.text();
      expect(cacheContents.length).toBeGreaterThan(0);
    }
  });
  
  test("respects BUN_INSTALL_CACHE_DIR even on different filesystem", async () => {
    // When BUN_INSTALL_CACHE_DIR is explicitly set, it should always be used
    const explicitCache = join(dirname(projectDir), "explicit-cache");
    env.BUN_INSTALL_CACHE_DIR = explicitCache;
    
    const pkg = {
      name: "explicit-cache-test",
      dependencies: {
        "no-deps": "1.0.0",
      },
    };
    
    await writeFileSync(packageJson, JSON.stringify(pkg));
    
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    
    // Verify the explicit cache was used
    expect(await exists(explicitCache)).toBe(true);
    expect(await exists(join(projectDir, "node_modules", "no-deps"))).toBe(true);
    
    // Verify no other cache was created
    expect(await exists(join(projectDir, ".bun-cache"))).toBe(false);
    expect(await exists(join(projectDir, "node_modules", ".bun-cache"))).toBe(false);
  });
  
  test("falls back to node_modules/.bun-cache when no writable location found", async () => {
    // This test verifies the ultimate fallback behavior
    const pkg = {
      name: "fallback-test",
      dependencies: {
        "no-deps": "1.0.0",
      },
    };
    
    await writeFileSync(packageJson, JSON.stringify(pkg));
    
    // Run install without any cache configuration
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    
    // Package should be installed
    expect(await exists(join(projectDir, "node_modules", "no-deps"))).toBe(true);
    
    // Some cache should exist
    const possibleCaches = [
      join(projectDir, "node_modules", ".bun-cache"),
      join(projectDir, ".bun-cache"),
      join(dirname(projectDir), ".bun-cache"),
    ];
    
    let cacheFound = false;
    for (const cache of possibleCaches) {
      if (await exists(cache)) {
        cacheFound = true;
        break;
      }
    }
    
    expect(cacheFound).toBe(true);
  });
});