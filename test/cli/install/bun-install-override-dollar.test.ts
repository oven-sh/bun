import { bunExe, bunEnv, tmpdirSync, tempDirWithFiles } from "harness";
import { beforeEach, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "fs";
import { $ } from "bun";

/**
 * Test for verifying the fix for $ override syntax preserving package identity
 * This ensures packages using "$package-name" override syntax maintain their identity
 * and are not hardlinked to the same files.
 *
 * Bug: https://github.com/oven-sh/bun/issues/[TBD]
 * Fix: https://github.com/oven-sh/bun/pull/[TBD]
 */

beforeEach(() => {
  // Clean environment for each test
  delete process.env.BUN_INSTALL_CACHE_DIR;
});

test("$ override syntax preserves package identity and prevents hardlinking", async () => {
  const cwd = tmpdirSync();

  // Create package.json with $ overrides like @polkadot
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "test-dollar-override",
        dependencies: {
          "@polkadot/api": "15.10.2",
          "@polkadot/api-derive": "15.10.2",
          "@polkadot/types": "15.10.2",
          "@polkadot/util": "13.1.1",
        },
        overrides: {
          "@polkadot/api": "$@polkadot/api",
          "@polkadot/api-derive": "$@polkadot/api",
          "@polkadot/types": "$@polkadot/api",
          "@polkadot/util": "$@polkadot/util",
        },
      },
      null,
      2,
    ),
  );

  // Run bun install
  const proc = await $`${bunExe()} install`.cwd(cwd).env(bunEnv).quiet();

  expect(proc.exitCode).toBe(0);
  expect(proc.stderr.toString()).not.toContain("error");

  // Test 1: Verify each package maintains its own identity
  const packages = ["@polkadot/api", "@polkadot/api-derive", "@polkadot/types", "@polkadot/util"];

  for (const pkg of packages) {
    const packageJsonPath = join(cwd, "node_modules", ...pkg.split("/"), "package.json");
    expect(existsSync(packageJsonPath)).toBe(true);

    const content = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    // Each package should have its correct name, not all be "@polkadot/api"
    expect(content.name).toBe(pkg);
  }

  // Test 2: Verify files are NOT hardlinked (different inodes)
  const packageJsonPaths = packages.map(pkg => join(cwd, "node_modules", ...pkg.split("/"), "package.json"));

  const stats = packageJsonPaths.map(path => statSync(path));
  const inodes = stats.map(stat => stat.ino);

  // Each file should have a unique inode (not hardlinked)
  const uniqueInodes = new Set(inodes);
  expect(uniqueInodes.size).toBe(packages.length);

  // Test 3: Verify the files have correct link count (should be <= 2, not 28+)
  // Bun may use hardlinks for caching, so nlink of 2 is normal
  for (const stat of stats) {
    expect(stat.nlink).toBeLessThanOrEqual(2);
  }

  // Test 4: Verify version resolution still works
  // @polkadot/api-derive should use @polkadot/api's version
  const apiPkg = JSON.parse(readFileSync(join(cwd, "node_modules/@polkadot/api/package.json"), "utf8"));
  const apiDerivePkg = JSON.parse(readFileSync(join(cwd, "node_modules/@polkadot/api-derive/package.json"), "utf8"));

  // They should have the same version due to the override
  expect(apiDerivePkg.version).toBe(apiPkg.version);
});

test("$ override with non-existent reference shows proper warning", async () => {
  const cwd = tmpdirSync();

  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "test-invalid-override",
      dependencies: {
        "tslib": "2.8.1",
      },
      overrides: {
        "tslib": "$non-existent-package",
      },
    }),
  );

  const proc = await $`${bunExe()} install`.cwd(cwd).env(bunEnv).nothrow().quiet();

  // Should show a warning about unresolved override
  expect(proc.stderr.toString()).toContain("warn: Could not resolve override");
  expect(proc.stderr.toString()).toContain("non-existent-package");

  // tslib should still be installed with its original version
  const tslibPath = join(cwd, "node_modules/tslib/package.json");
  expect(existsSync(tslibPath)).toBe(true);
  const tslibPkg = JSON.parse(readFileSync(tslibPath, "utf8"));
  expect(tslibPkg.name).toBe("tslib");
});

test("$ override preserves package-specific exports and functionality", async () => {
  const cwd = tmpdirSync();

  // Use a simpler test that mirrors the actual @polkadot use case
  // Where all packages in the ecosystem share the same version
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "test-exports",
      dependencies: {
        // These babel packages all have version 7.26.0
        "@babel/core": "7.26.0",
        "@babel/parser": "7.26.0",
        "@babel/types": "7.26.0",
      },
      overrides: {
        // Override parser and types to use core's version (which is the same)
        "@babel/parser": "$@babel/core",
        "@babel/types": "$@babel/core",
      },
    }),
  );

  const proc = await $`${bunExe()} install`.cwd(cwd).env(bunEnv).quiet();

  expect(proc.exitCode).toBe(0);

  // Verify @babel/parser maintains its own package identity
  const parserPkgJson = JSON.parse(readFileSync(join(cwd, "node_modules/@babel/parser/package.json"), "utf8"));

  expect(parserPkgJson.name).toBe("@babel/parser");

  // Verify @babel/core has its own identity
  const corePkgJson = JSON.parse(readFileSync(join(cwd, "node_modules/@babel/core/package.json"), "utf8"));

  expect(corePkgJson.name).toBe("@babel/core");

  // They should have different inodes
  const parserStats = statSync(join(cwd, "node_modules/@babel/parser/package.json"));
  const coreStats = statSync(join(cwd, "node_modules/@babel/core/package.json"));

  expect(parserStats.ino).not.toBe(coreStats.ino);
});

test("multiple packages with same $ override target remain independent", async () => {
  const cwd = tmpdirSync();

  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "test-multiple-overrides",
      dependencies: {
        // Use react packages that share version 18.3.1
        "react": "18.3.1",
        "react-dom": "18.3.1",
        "react-is": "18.3.1",
      },
      overrides: {
        // All packages override to react's version (which they already have)
        "react-dom": "$react",
        "react-is": "$react",
      },
    }),
  );

  const proc = await $`${bunExe()} install`.cwd(cwd).env(bunEnv).quiet();

  expect(proc.exitCode).toBe(0);

  // All packages should maintain independent identities
  const packages = ["react", "react-dom", "react-is"];
  const inodes = new Set();

  for (const pkg of packages) {
    const pkgJsonPath = join(cwd, "node_modules", pkg, "package.json");

    // Each should have correct name
    const content = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    expect(content.name).toBe(pkg);

    // Each should have unique inode
    const stat = statSync(pkgJsonPath);
    inodes.add(stat.ino);
    expect(stat.nlink).toBeLessThanOrEqual(5); // May have more links due to caching
  }

  // All 3 packages should have different inodes
  expect(inodes.size).toBe(3);
});
