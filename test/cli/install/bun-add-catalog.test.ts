import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe } from "harness";
import { join } from "path";

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("bun add --catalog", () => {
  test("bun add --catalog adds dependency with catalog reference and populates catalog", async () => {
    const { packageDir } = await registry.createTestDir();

    // Create initial package.json WITHOUT catalog - it should be created
    const initialPackageJson = {
      name: "test-catalog-add",
    };
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(initialPackageJson, null, 2));

    // Run bun add --catalog no-deps
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "no-deps"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    // The add command should succeed
    expect(exitCode).toBe(0);

    // Check that package.json was updated with catalog reference
    const updatedPackageJson = await file(join(packageDir, "package.json")).json();
    expect(updatedPackageJson.dependencies).toEqual({
      "no-deps": "catalog:",
    });

    // Verify catalog was created with the resolved version
    expect(updatedPackageJson.catalog).toBeDefined();
    expect(updatedPackageJson.catalog["no-deps"]).toMatch(/^\^2\.0\.0$/);
  });

  test("bun add --catalog=name adds dependency with named catalog reference and populates catalog", async () => {
    const { packageDir } = await registry.createTestDir();

    // Create initial package.json WITHOUT named catalog - it should be created
    const initialPackageJson = {
      name: "test-catalog-add-named",
    };
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(initialPackageJson, null, 2));

    // Run bun add --catalog=dev a-dep
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog=dev", "a-dep"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(exitCode).toBe(0);

    // Check that package.json was updated with named catalog reference
    const updatedPackageJson = await file(join(packageDir, "package.json")).json();
    expect(updatedPackageJson.dependencies).toEqual({
      "a-dep": "catalog:dev",
    });

    // Verify named catalog was created with the resolved version
    expect(updatedPackageJson.catalogs).toBeDefined();
    expect(updatedPackageJson.catalogs.dev).toBeDefined();
    expect(updatedPackageJson.catalogs.dev["a-dep"]).toMatch(/^\^1\.0\.\d+$/);
  });

  test("bun add --catalog with --dev flag", async () => {
    const { packageDir } = await registry.createTestDir();

    // Create initial package.json
    const initialPackageJson = {
      name: "test-catalog-add-dev",
    };
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(initialPackageJson, null, 2));

    // Run bun add --catalog --dev no-deps
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "--dev", "no-deps"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(exitCode).toBe(0);

    // Check that package.json was updated with catalog reference in devDependencies
    const updatedPackageJson = await file(join(packageDir, "package.json")).json();
    expect(updatedPackageJson.devDependencies).toEqual({
      "no-deps": "catalog:",
    });

    // Verify catalog was created
    expect(updatedPackageJson.catalog).toBeDefined();
    expect(updatedPackageJson.catalog["no-deps"]).toMatch(/^\^2\.0\.0$/);
  });

  test("bun add --catalog works in monorepo workspace", async () => {
    const { packageDir } = await registry.createTestDir();

    // Create root package.json without catalog
    const rootPackageJson = {
      name: "monorepo-root",
      workspaces: ["packages/*"],
    };
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(rootPackageJson, null, 2));

    // Create workspace package
    const workspaceDir = join(packageDir, "packages", "pkg1");
    mkdirSync(workspaceDir, { recursive: true });
    const workspacePackageJson = {
      name: "pkg1",
    };
    writeFileSync(join(workspaceDir, "package.json"), JSON.stringify(workspacePackageJson, null, 2));

    // Run bun add --catalog from workspace directory
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "no-deps"],
      cwd: workspaceDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(exitCode).toBe(0);

    // Check that workspace package.json was updated with catalog reference
    const updatedWorkspacePackageJson = await file(join(workspaceDir, "package.json")).json();
    expect(updatedWorkspacePackageJson.dependencies).toEqual({
      "no-deps": "catalog:",
    });

    // Verify root package.json catalog was created
    const updatedRootPackageJson = await file(join(packageDir, "package.json")).json();
    expect(updatedRootPackageJson.catalog).toBeDefined();
    expect(updatedRootPackageJson.catalog["no-deps"]).toMatch(/^\^2\.0\.0$/);
  });

  test("bun add --catalog multiple packages", async () => {
    const { packageDir } = await registry.createTestDir();

    // Create initial package.json
    const initialPackageJson = {
      name: "test-catalog-add-multiple",
    };
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(initialPackageJson, null, 2));

    // Run bun add --catalog with multiple packages
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "no-deps", "a-dep"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(exitCode).toBe(0);

    // Check that package.json was updated with catalog references for both
    const updatedPackageJson = await file(join(packageDir, "package.json")).json();
    expect(updatedPackageJson.dependencies).toEqual({
      "no-deps": "catalog:",
      "a-dep": "catalog:",
    });

    // Verify catalog was created with both packages
    expect(updatedPackageJson.catalog).toBeDefined();
    expect(updatedPackageJson.catalog["no-deps"]).toMatch(/^\^2\.0\.0$/);
    expect(updatedPackageJson.catalog["a-dep"]).toMatch(/^\^1\.0\.\d+$/);
  });
});
