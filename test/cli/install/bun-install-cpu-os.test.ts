import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from "bun:test";
import { exists, writeFile, rm } from "fs/promises";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  requested,
  root_url,
  setHandler,
} from "./dummy.registry.js";
import { bunExe, bunEnv, toMatchNodeModulesAt } from "harness";
import { spawn } from "bun";

expect.extend({
  toMatchNodeModulesAt,
});

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

describe("bun install --cpu and --os flags", () => {
  it("should filter dependencies by CPU architecture", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["x64"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-cpu-filter",
        version: "1.0.0",
        dependencies: {
          "dep-x64-only": "1.0.0",
        },
      }),
    );

    // Install with arm64 CPU - should skip the x64-only dependency
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "arm64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // The package should not be installed
    const depExists = await exists(join(package_dir, "node_modules", "dep-x64-only"));
    expect(depExists).toBe(false);

    // Install with x64 CPU - should install the dependency
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(join(package_dir, "bun.lockb"), { force: true });

    const { exited: exited2 } = spawn({
      cmd: [bunExe(), "install", "--cpu", "x64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode2 = await exited2;
    expect(exitCode2).toBe(0);

    // The package should be installed
    const depExists2 = await exists(join(package_dir, "node_modules", "dep-x64-only"));
    expect(depExists2).toBe(true);
  });

  it("should filter dependencies by OS", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          os: ["linux"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-os-filter",
        version: "1.0.0",
        dependencies: {
          "dep-linux-only": "1.0.0",
        },
      }),
    );

    // Install with darwin OS - should skip the linux-only dependency
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--os", "darwin"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // The package should not be installed
    const depExists = await exists(join(package_dir, "node_modules", "dep-linux-only"));
    expect(depExists).toBe(false);

    // Install with linux OS - should install the dependency
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(join(package_dir, "bun.lockb"), { force: true });

    const { exited: exited2 } = spawn({
      cmd: [bunExe(), "install", "--os", "linux"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode2 = await exited2;
    expect(exitCode2).toBe(0);

    // The package should be installed
    const depExists2 = await exists(join(package_dir, "node_modules", "dep-linux-only"));
    expect(depExists2).toBe(true);
  });

  it("should filter dependencies by both CPU and OS", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["arm64"],
          os: ["darwin"],
        },
        "2.0.0": {
          cpu: ["x64"],
          os: ["linux"],
        },
        "3.0.0": {},
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-cpu-os-filter",
        version: "1.0.0",
        optionalDependencies: {
          "dep-darwin-arm64": "1.0.0",
          "dep-linux-x64": "2.0.0",
          "dep-universal": "3.0.0",
        },
      }),
    );

    // Install with linux/x64 - should only install linux-x64 and universal deps
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "x64", "--os", "linux"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Check which packages were installed
    const darwinArm64Exists = await exists(join(package_dir, "node_modules", "dep-darwin-arm64"));
    expect(darwinArm64Exists).toBe(false);

    const linuxX64Exists = await exists(join(package_dir, "node_modules", "dep-linux-x64"));
    expect(linuxX64Exists).toBe(true);

    const universalExists = await exists(join(package_dir, "node_modules", "dep-universal"));
    expect(universalExists).toBe(true);
  });

  it("should handle multiple CPU architectures in package metadata", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["x64", "arm64"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-multi-cpu",
        version: "1.0.0",
        dependencies: {
          "dep-multi-cpu": "1.0.0",
        },
      }),
    );

    // Install with arm64 - should install since arm64 is in the list
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "arm64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    const depExists = await exists(join(package_dir, "node_modules", "dep-multi-cpu"));
    expect(depExists).toBe(true);
  });

  it("should error on invalid CPU architecture", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-invalid-cpu",
        version: "1.0.0",
        dependencies: {},
      }),
    );

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "invalid-cpu"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    const stderrText = await stderr.text();

    expect(exitCode).toBe(1);
    expect(stderrText).toContain("Invalid CPU architecture");
    expect(stderrText).toContain("invalid-cpu");
  });

  it("should error on invalid OS", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-invalid-os",
        version: "1.0.0",
        dependencies: {},
      }),
    );

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--os", "invalid-os"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    const stderrText = await stderr.text();

    expect(exitCode).toBe(1);
    expect(stderrText).toContain("Invalid operating system");
    expect(stderrText).toContain("invalid-os");
  });

  it("should skip installing packages with negated CPU/OS", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["!arm64"],
        },
        "2.0.0": {
          os: ["!linux"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-negated",
        version: "1.0.0",
        optionalDependencies: {
          "dep-not-arm64": "1.0.0",
          "dep-not-linux": "2.0.0",
        },
      }),
    );

    // Install with arm64 - should skip dep-not-arm64
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "arm64", "--os", "darwin"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    const notArm64Exists = await exists(join(package_dir, "node_modules", "dep-not-arm64"));
    expect(notArm64Exists).toBe(false);

    const notLinuxExists = await exists(join(package_dir, "node_modules", "dep-not-linux"));
    expect(notLinuxExists).toBe(true);
  });
});