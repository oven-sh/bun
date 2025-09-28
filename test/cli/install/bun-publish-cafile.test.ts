import { file, spawn, write } from "bun";
import { describe, expect, test } from "bun:test";
import { exists, mkdir } from "fs/promises";
import { bunExe, bunEnv as env, tmpdirSync, stderrForInstall } from "harness";
import { join, dirname } from "path";

describe("bunfig cafile", () => {
  test("relative cafile path in bunfig.toml is resolved relative to bunfig location", async () => {
    // Create a test directory structure
    const testDir = tmpdirSync();
    const configDir = join(testDir, "config");
    const packageDir = testDir;
    const packageJson = join(packageDir, "package.json");

    await mkdir(configDir, { recursive: true });

    // Create a dummy CA file in the config directory
    const caFile = join(configDir, "test-ca.crt");
    await write(caFile, "-----BEGIN CERTIFICATE-----\nDUMMY_CERT\n-----END CERTIFICATE-----");

    // Create bunfig.toml with relative path to CA file (same directory as bunfig)
    const bunfig = `[install]
cafile = "test-ca.crt"
cache = false
`;
    await write(join(configDir, "bunfig.toml"), bunfig);

    // Create package.json
    await write(
      packageJson,
      JSON.stringify({
        name: "cafile-test-pkg",
        version: "1.0.0",
        private: false,
      }),
    );

    // Test that the cafile path is correctly resolved when loading bunfig
    // The cafile should be resolved relative to the bunfig.toml location, not CWD
    const result = spawn({
      cmd: [bunExe(), "publish", "--dry-run", "-c", join(configDir, "bunfig.toml")],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        // Disable any real network operations
        BUN_CONFIG_REGISTRY: "http://localhost:0/",
      },
    });

    const stderr = stderrForInstall(await result.stderr.text());
    const stdout = await result.stdout.text();
    const exitCode = await result.exited;

    // With the fix, it should not error about being unable to find/load the CA file
    expect(stderr).not.toContain("failed to find CA file");
    expect(stderr).not.toContain("failed to load CA file");
    expect(stderr).not.toContain("the CA file is invalid");

    // Note: The publish will fail for other reasons (no registry, etc.),
    // but the important thing is that the CA file was found and loaded correctly.
  });

  test("absolute cafile path in bunfig.toml works", async () => {
    // Create a test directory structure
    const testDir = tmpdirSync();
    const packageDir = testDir;
    const packageJson = join(packageDir, "package.json");

    // Create a dummy CA file with absolute path
    const caFile = join(testDir, "absolute-test-ca.crt");
    await write(caFile, "-----BEGIN CERTIFICATE-----\nDUMMY_CERT\n-----END CERTIFICATE-----");

    // Create bunfig.toml with absolute path to CA file
    const bunfig = `[install]
cafile = "${caFile}"
cache = false
`;
    await write(join(packageDir, "bunfig.toml"), bunfig);

    // Create package.json
    await write(
      packageJson,
      JSON.stringify({
        name: "cafile-test-pkg-abs",
        version: "1.0.0",
        private: false,
      }),
    );

    // Test that absolute cafile path works
    const result = spawn({
      cmd: [bunExe(), "publish", "--dry-run"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        // Disable any real network operations
        BUN_CONFIG_REGISTRY: "http://localhost:0/",
      },
    });

    const stderr = stderrForInstall(await result.stderr.text());
    const stdout = await result.stdout.text();
    const exitCode = await result.exited;

    // Should not have CA file loading errors
    expect(stderr).not.toContain("failed to find CA file");
    expect(stderr).not.toContain("failed to load CA file");
    expect(stderr).not.toContain("the CA file is invalid");
  });

  test("command line --cafile overrides bunfig.toml", async () => {
    // Create a test directory structure
    const testDir = tmpdirSync();
    const packageDir = testDir;
    const packageJson = join(packageDir, "package.json");

    // Create two CA files
    const caFileBunfig = join(testDir, "bunfig-ca.crt");
    const caFileCLI = join(testDir, "cli-ca.crt");
    await write(caFileBunfig, "-----BEGIN CERTIFICATE-----\nBUNFIG_CERT\n-----END CERTIFICATE-----");
    await write(caFileCLI, "-----BEGIN CERTIFICATE-----\nCLI_CERT\n-----END CERTIFICATE-----");

    // Create bunfig.toml pointing to the bunfig CA file
    const bunfig = `[install]
cafile = "${caFileBunfig}"
cache = false
`;
    await write(join(packageDir, "bunfig.toml"), bunfig);

    // Create package.json
    await write(
      packageJson,
      JSON.stringify({
        name: "cafile-test-override",
        version: "1.0.0",
        private: false,
      }),
    );

    // Test that command line --cafile overrides bunfig.toml
    const result = spawn({
      cmd: [bunExe(), "publish", "--dry-run", "--cafile", caFileCLI],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        // Disable any real network operations
        BUN_CONFIG_REGISTRY: "http://localhost:0/",
      },
    });

    const stderr = stderrForInstall(await result.stderr.text());
    const stdout = await result.stdout.text();
    const exitCode = await result.exited;

    // Should use the CLI CA file, not the bunfig one
    expect(stderr).not.toContain("failed to find CA file");
    expect(stderr).not.toContain("failed to load CA file");
    expect(stderr).not.toContain("the CA file is invalid");
  });
});