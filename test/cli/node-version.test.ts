import { spawnSync } from "bun";
import { describe, expect, test, afterAll } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "node:path";

describe("bun node", () => {
  const originalBunInstall = process.env.BUN_INSTALL;
  let testBunInstall: string;

  test("setup test directory", () => {
    testBunInstall = tempDirWithFiles("node-version-test", {});
    process.env.BUN_INSTALL = testBunInstall;
  });

  afterAll(() => {
    if (originalBunInstall) {
      process.env.BUN_INSTALL = originalBunInstall;
    } else {
      delete process.env.BUN_INSTALL;
    }
  });

  test("shows error when no version specified", () => {
    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "node"],
      env: { ...bunEnv, BUN_INSTALL: testBunInstall },
      stdout: "pipe",
      stderr: "pipe",
    });
    
    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("Please specify a Node.js version to install");
  });

  test("shows error for invalid version format", () => {
    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "node", "invalid-version"],
      env: { ...bunEnv, BUN_INSTALL: testBunInstall },
      stdout: "pipe", 
      stderr: "pipe",
    });
    
    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("Invalid Node.js version format");
  });

  test("accepts valid version format", () => {
    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "node", "20.11.0"],
      env: { ...bunEnv, BUN_INSTALL: testBunInstall },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000, // 30 seconds timeout for download
    });
    
    // The command should start the installation process
    // We expect it to either succeed or fail due to network/download issues
    // but not due to argument validation
    const stderrOutput = stderr.toString();
    expect(stderrOutput).not.toContain("Invalid Node.js version format");
    expect(stderrOutput).not.toContain("Please specify a Node.js version");
    
    // Should show installation message
    expect(stderrOutput).toContain("Installing Node.js v20.11.0");
  });

  test("falls back to ~/.bun when BUN_INSTALL not set", () => {
    const env = { ...bunEnv };
    delete env.BUN_INSTALL; // Ensure BUN_INSTALL is not set
    
    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "node", "20.11.0"],
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000, // 30 seconds timeout for download
    });
    
    // Should start installation process using ~/.bun fallback
    const stderrOutput = stderr.toString();
    expect(stderrOutput).toContain("Installing Node.js v20.11.0");
    expect(stderrOutput).toContain("Downloading from https://nodejs.org/dist/v20.11.0/node-v20.11.0-linux-arm64.tar.gz");
  });

  describe("version validation", () => {
    const validVersions = ["20.11.0", "18.19.1", "16.20.2", "14.21.3"];
    const invalidVersions = ["20", "20.11", "v20.11.0", "20.11.0-beta", "latest", ""];

    test.each(validVersions)("accepts valid version: %s", (version) => {
      const { stderr, exitCode } = spawnSync({
        cmd: [bunExe(), "node", version],
        env: { ...bunEnv, BUN_INSTALL: testBunInstall },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5000, // Short timeout since we just want to test validation
      });
      
      const stderrOutput = stderr.toString();
      expect(stderrOutput).not.toContain("Invalid Node.js version format");
      expect(stderrOutput).toContain(`Installing Node.js v${version}`);
    });

    test.each(invalidVersions)("rejects invalid version: %s", (version) => {
      const { stderr, exitCode } = spawnSync({
        cmd: [bunExe(), "node", version],
        env: { ...bunEnv, BUN_INSTALL: testBunInstall },
        stdout: "pipe", 
        stderr: "pipe",
      });
      
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("Invalid Node.js version format");
    });
  });

  test("creates proper directory structure", () => {
    // Mock a successful installation by creating the expected directories
    const nodeDir = path.join(testBunInstall, "node", "v20.11.0");
    const binDir = path.join(testBunInstall, "bin");
    
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    
    // Create a fake node binary to simulate installation
    const nodeBinaryPath = path.join(nodeDir, "bin", "node");
    fs.mkdirSync(path.dirname(nodeBinaryPath), { recursive: true });
    fs.writeFileSync(nodeBinaryPath, "#!/bin/sh\necho 'fake node'");
    fs.chmodSync(nodeBinaryPath, 0o755);
    
    // Now test that running the command on an already installed version works
    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "node", "20.11.0"],
      env: { ...bunEnv, BUN_INSTALL: testBunInstall },
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const stderrOutput = stderr.toString();
    expect(stderrOutput).toContain("Node.js v20.11.0 is already installed");
    
    // Check that the shim was created
    const shimPath = path.join(binDir, "node");
    expect(fs.existsSync(shimPath)).toBe(true);
  });
});