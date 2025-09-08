import { file, spawn } from "bun";
import { afterEach, beforeEach, expect, it, describe, setDefaultTimeout } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { bunExe, bunEnv as env, tmpdirSync } from "harness";
import { join } from "path";

setDefaultTimeout(1000 * 60 * 5);

describe("bun add --filter", () => {
  let monorepoDir: string;

  beforeEach(async () => {
    monorepoDir = tmpdirSync();
    
    // Create a monorepo structure
    await mkdir(join(monorepoDir, "apps", "server"), { recursive: true });
    await mkdir(join(monorepoDir, "apps", "client"), { recursive: true });
    await mkdir(join(monorepoDir, "packages", "shared"), { recursive: true });
    
    // Root package.json with workspaces
    await writeFile(
      join(monorepoDir, "package.json"),
      JSON.stringify({
        name: "my-monorepo",
        version: "1.0.0",
        workspaces: [
          "apps/*",
          "packages/*"
        ]
      }, null, 2)
    );
    
    // Server package.json
    await writeFile(
      join(monorepoDir, "apps", "server", "package.json"),
      JSON.stringify({
        name: "@myapp/server",
        version: "1.0.0",
        dependencies: {}
      }, null, 2)
    );
    
    // Client package.json
    await writeFile(
      join(monorepoDir, "apps", "client", "package.json"),
      JSON.stringify({
        name: "@myapp/client",
        version: "1.0.0",
        dependencies: {}
      }, null, 2)
    );
    
    // Shared package.json
    await writeFile(
      join(monorepoDir, "packages", "shared", "package.json"),
      JSON.stringify({
        name: "@myapp/shared",
        version: "1.0.0",
        dependencies: {}
      }, null, 2)
    );
  });

  afterEach(async () => {
    await rm(monorepoDir, { recursive: true, force: true });
  });

  it("should add dependency to specific workspace using --filter with name", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "lodash", "--filter", "@myapp/server"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    const out = await stdout.text();
    
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that server package.json has lodash
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    expect(serverPkg.dependencies).toHaveProperty("lodash");
    
    // Check that root package.json doesn't have lodash
    const rootPkg = await file(join(monorepoDir, "package.json")).json();
    expect(rootPkg.dependencies).toBeUndefined();
    
    // Check that other workspaces don't have lodash
    const clientPkg = await file(join(monorepoDir, "apps", "client", "package.json")).json();
    expect(clientPkg.dependencies).toEqual({});
  });

  it("should add dependency to workspace using --filter with path pattern", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "express", "--filter", "./apps/server"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that server package.json has express
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    expect(serverPkg.dependencies).toHaveProperty("express");
    
    // Check that root package.json doesn't have express
    const rootPkg = await file(join(monorepoDir, "package.json")).json();
    expect(rootPkg.dependencies).toBeUndefined();
  });

  it("should add dependency to multiple workspaces using --filter with glob pattern", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "react", "--filter", "@myapp/*"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that all @myapp/* workspaces have react
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    const clientPkg = await file(join(monorepoDir, "apps", "client", "package.json")).json();
    const sharedPkg = await file(join(monorepoDir, "packages", "shared", "package.json")).json();
    
    expect(serverPkg.dependencies).toHaveProperty("react");
    expect(clientPkg.dependencies).toHaveProperty("react");
    expect(sharedPkg.dependencies).toHaveProperty("react");
    
    // Check that root package.json doesn't have react
    const rootPkg = await file(join(monorepoDir, "package.json")).json();
    expect(rootPkg.dependencies).toBeUndefined();
  });

  it("should add dev dependency to workspace with --filter and --dev", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "--dev", "typescript", "--filter", "@myapp/server"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that server package.json has typescript in devDependencies
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    expect(serverPkg.devDependencies).toHaveProperty("typescript");
    expect(serverPkg.dependencies?.typescript).toBeUndefined();
    
    // Check that root package.json doesn't have typescript
    const rootPkg = await file(join(monorepoDir, "package.json")).json();
    expect(rootPkg.devDependencies).toBeUndefined();
  });

  it("should add to all workspaces with --filter='*'", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "zod", "--filter", "*"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that all workspaces have zod
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    const clientPkg = await file(join(monorepoDir, "apps", "client", "package.json")).json();
    const sharedPkg = await file(join(monorepoDir, "packages", "shared", "package.json")).json();
    
    expect(serverPkg.dependencies).toHaveProperty("zod");
    expect(clientPkg.dependencies).toHaveProperty("zod");
    expect(sharedPkg.dependencies).toHaveProperty("zod");
    
    // Root should not have it
    const rootPkg = await file(join(monorepoDir, "package.json")).json();
    expect(rootPkg.dependencies).toBeUndefined();
  });

  it("should handle multiple --filter flags", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "axios", "--filter", "@myapp/server", "--filter", "@myapp/client"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that server and client have axios
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    const clientPkg = await file(join(monorepoDir, "apps", "client", "package.json")).json();
    const sharedPkg = await file(join(monorepoDir, "packages", "shared", "package.json")).json();
    
    expect(serverPkg.dependencies).toHaveProperty("axios");
    expect(clientPkg.dependencies).toHaveProperty("axios");
    expect(sharedPkg.dependencies?.axios).toBeUndefined();
    
    // Root should not have it
    const rootPkg = await file(join(monorepoDir, "package.json")).json();
    expect(rootPkg.dependencies).toBeUndefined();
  });

  it("should error when filter matches no workspaces", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "lodash", "--filter", "@nonexistent/package"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).toContain("No workspaces matched the filter");
    expect(await exited).not.toBe(0);
  });

  it("should add exact version with --exact and --filter", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "lodash@4.17.21", "--exact", "--filter", "@myapp/server"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that server package.json has exact version of lodash
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    expect(serverPkg.dependencies.lodash).toBe("4.17.21");
  });

  it("should work from subdirectory with --filter", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "dotenv", "--filter", "@myapp/server"],
      cwd: join(monorepoDir, "apps", "client"),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that server package.json has dotenv
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    expect(serverPkg.dependencies).toHaveProperty("dotenv");
    
    // Client should not have it
    const clientPkg = await file(join(monorepoDir, "apps", "client", "package.json")).json();
    expect(clientPkg.dependencies?.dotenv).toBeUndefined();
  });

  it("should handle negation patterns with --filter", async () => {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "rimraf", "--filter", "*", "--filter", "!@myapp/shared"],
      cwd: monorepoDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    
    // Check that server and client have rimraf but not shared
    const serverPkg = await file(join(monorepoDir, "apps", "server", "package.json")).json();
    const clientPkg = await file(join(monorepoDir, "apps", "client", "package.json")).json();
    const sharedPkg = await file(join(monorepoDir, "packages", "shared", "package.json")).json();
    
    expect(serverPkg.dependencies).toHaveProperty("rimraf");
    expect(clientPkg.dependencies).toHaveProperty("rimraf");
    expect(sharedPkg.dependencies?.rimraf).toBeUndefined();
  });
});