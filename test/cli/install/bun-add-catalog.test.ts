import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

beforeEach(async () => {
  await dummyBeforeEach();
});

afterEach(dummyAfterEach);

describe("bun add --catalog", () => {
  test("bun add --catalog adds dependency with catalog reference and populates catalog", async () => {
    // Set up handler for bar package (bar-0.0.2.tgz exists in test/cli/install/)
    setHandler(dummyRegistry([], { "0.0.2": {} }));

    // Create initial package.json WITHOUT catalog - it should be created
    await Bun.write(join(package_dir, "package.json"), JSON.stringify({ name: "test-catalog-add" }, null, 2));

    // Run bun add --catalog bar
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "bar"],
      cwd: package_dir,
      env,
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

    // Verify node_modules WAS created (--catalog installs to resolve versions)
    expect(existsSync(join(package_dir, "node_modules"))).toBe(true);

    // Check that package.json was updated with catalog reference
    const updatedPackageJson = await file(join(package_dir, "package.json")).json();
    expect(updatedPackageJson.dependencies).toEqual({
      bar: "catalog:",
    });

    // Verify catalog was created with the resolved version
    expect(updatedPackageJson.catalog).toBeDefined();
    expect(updatedPackageJson.catalog["bar"]).toMatch(/^\^0\.0\.2$/);
  });

  test("bun add --catalog=name adds dependency with named catalog reference and populates catalog", async () => {
    // Set up handler for baz package (baz-0.0.3.tgz exists in test/cli/install/)
    setHandler(dummyRegistry([], { "0.0.3": {} }));

    // Create initial package.json WITHOUT named catalog - it should be created
    await Bun.write(join(package_dir, "package.json"), JSON.stringify({ name: "test-catalog-add-named" }, null, 2));

    // Run bun add --catalog=dev baz
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog=dev", "baz"],
      cwd: package_dir,
      env,
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
    const updatedPackageJson = await file(join(package_dir, "package.json")).json();
    expect(updatedPackageJson.dependencies).toEqual({
      baz: "catalog:dev",
    });

    // Verify named catalog was created with the resolved version
    expect(updatedPackageJson.catalogs).toBeDefined();
    expect(updatedPackageJson.catalogs.dev).toBeDefined();
    expect(updatedPackageJson.catalogs.dev["baz"]).toMatch(/^\^0\.0\.3$/);
  });

  test("bun add --catalog with --dev flag", async () => {
    // Set up handler for bar package
    setHandler(dummyRegistry([], { "0.0.2": {} }));

    // Create initial package.json
    await Bun.write(join(package_dir, "package.json"), JSON.stringify({ name: "test-catalog-add-dev" }, null, 2));

    // Run bun add --catalog --dev bar
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "--dev", "bar"],
      cwd: package_dir,
      env,
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
    const updatedPackageJson = await file(join(package_dir, "package.json")).json();
    expect(updatedPackageJson.devDependencies).toEqual({
      bar: "catalog:",
    });

    // Verify catalog was created
    expect(updatedPackageJson.catalog).toBeDefined();
    expect(updatedPackageJson.catalog["bar"]).toMatch(/^\^0\.0\.2$/);
  });

  test("bun add --catalog works in monorepo workspace", async () => {
    // Set up handler for bar package
    setHandler(dummyRegistry([], { "0.0.2": {} }));

    // Create root package.json without catalog
    await Bun.write(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "monorepo-root", workspaces: ["packages/*"] }, null, 2),
    );

    // Create workspace package
    const workspaceDir = join(package_dir, "packages", "pkg1");
    await mkdir(workspaceDir, { recursive: true });
    await Bun.write(join(workspaceDir, "package.json"), JSON.stringify({ name: "pkg1" }, null, 2));

    // Run bun add --catalog from workspace directory
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "bar"],
      cwd: workspaceDir,
      env,
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
      bar: "catalog:",
    });

    // Verify root package.json catalog was created
    const updatedRootPackageJson = await file(join(package_dir, "package.json")).json();
    expect(updatedRootPackageJson.catalog).toBeDefined();
    expect(updatedRootPackageJson.catalog["bar"]).toMatch(/^\^0\.0\.2$/);
  });

  test("bun add --catalog multiple packages", async () => {
    // Set up handler that handles multiple packages
    setHandler(req => {
      const url = req.url;
      if (url.includes("bar")) {
        return dummyRegistry([], { "0.0.2": {} })(req);
      } else if (url.includes("baz")) {
        return dummyRegistry([], { "0.0.3": {} })(req);
      }
      return new Response("Not found", { status: 404 });
    });

    // Create initial package.json
    await Bun.write(join(package_dir, "package.json"), JSON.stringify({ name: "test-catalog-add-multiple" }, null, 2));

    // Run bun add --catalog with multiple packages
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "bar", "baz"],
      cwd: package_dir,
      env,
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
    const updatedPackageJson = await file(join(package_dir, "package.json")).json();
    expect(updatedPackageJson.dependencies).toEqual({
      bar: "catalog:",
      baz: "catalog:",
    });

    // Verify catalog was created with both packages
    expect(updatedPackageJson.catalog).toBeDefined();
    expect(updatedPackageJson.catalog["bar"]).toMatch(/^\^0\.0\.2$/);
    expect(updatedPackageJson.catalog["baz"]).toMatch(/^\^0\.0\.3$/);
  });

  test("bun add --catalog --no-save does not modify package.json", async () => {
    // Set up handler for bar package
    setHandler(dummyRegistry([], { "0.0.2": {} }));

    // Create initial package.json
    const initialContent = JSON.stringify({ name: "test-no-save" }, null, 2);
    await Bun.write(join(package_dir, "package.json"), initialContent);

    // Run bun add --catalog --no-save bar
    await using proc = spawn({
      cmd: [bunExe(), "add", "--catalog", "--no-save", "bar"],
      cwd: package_dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(exitCode).toBe(0);

    // Verify package.json was not modified
    const finalContent = await file(join(package_dir, "package.json")).text();
    expect(finalContent).toBe(initialContent);
  });
});
