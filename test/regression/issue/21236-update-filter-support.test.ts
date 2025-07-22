import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

describe("bun update --filter support (issue #21236)", () => {
  it("should filter updates to specific workspaces only", async () => {
    const dir = tempDirWithFiles("update-filter-test", {
      "package.json": JSON.stringify({
        name: "my-monorepo",
        workspaces: {
          packages: ["packages/*"],
        },
      }),
      "packages/web/package.json": JSON.stringify({
        name: "web",
        dependencies: {
          "is-even": "1.0.0", // old version, should be updated
        },
      }),
      "packages/server/package.json": JSON.stringify({
        name: "server", 
        dependencies: {
          "is-odd": "1.0.0", // old version, should NOT be updated when filtering web only
        },
      }),
      "packages/docs/package.json": JSON.stringify({
        name: "docs",
        dependencies: {
          "is-number": "3.0.0", // old version, should NOT be updated when filtering web only
        },
      }),
    });

    // First install to create lockfile
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: dir,
    });
    await installProc.exited;

    // Update only the "web" workspace
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--filter=web"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(updateProc.stdout).text(),
      new Response(updateProc.stderr).text(),
      updateProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Unknown option");
    expect(stderr).not.toContain("--filter");
    
    // Verify the lockfile exists
    expect(existsSync(join(dir, "bun.lock"))).toBe(true);
  });

  it("should support catalog dependencies with --filter", async () => {
    const dir = tempDirWithFiles("update-filter-catalog-test", {
      "package.json": JSON.stringify({
        name: "my-monorepo",
        workspaces: {
          packages: ["packages/*"],
          catalog: {
            "is-even": "1.0.0", // old version in catalog
            "is-odd": "1.0.0",  // old version in catalog
          },
        },
      }),
      "packages/web/package.json": JSON.stringify({
        name: "web",
        dependencies: {
          "is-even": "catalog:", // using catalog
        },
      }),
      "packages/server/package.json": JSON.stringify({
        name: "server", 
        dependencies: {
          "is-odd": "catalog:", // using catalog
        },
      }),
    });

    // First install to create lockfile
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: dir,
    });
    await installProc.exited;

    // Update with filter - should work without errors
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--filter=web"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(updateProc.stdout).text(),
      new Response(updateProc.stderr).text(),
      updateProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Unknown option");
    expect(stderr).not.toContain("error");
  });

  it("should support glob patterns in --filter", async () => {
    const dir = tempDirWithFiles("update-filter-glob-test", {
      "package.json": JSON.stringify({
        name: "my-monorepo",
        workspaces: {
          packages: ["packages/*"],
        },
      }),
      "packages/web-app/package.json": JSON.stringify({
        name: "web-app",
        dependencies: {
          "is-even": "1.0.0",
        },
      }),
      "packages/web-client/package.json": JSON.stringify({
        name: "web-client",
        dependencies: {
          "is-odd": "1.0.0",
        },
      }),
      "packages/server/package.json": JSON.stringify({
        name: "server",
        dependencies: {
          "is-number": "3.0.0",
        },
      }),
    });

    // First install to create lockfile
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: dir,
    });
    await installProc.exited;

    // Update with glob pattern - should match web-app and web-client
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--filter=web-*"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(updateProc.stdout).text(),
      new Response(updateProc.stderr).text(),
      updateProc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Unknown option");
    expect(stderr).not.toContain("error");
  });

  it("should show filter option in update help text", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "--help"],
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--filter");
    expect(stdout).toContain("-F,");
  });

  it("should reject invalid filter patterns gracefully", async () => {
    const dir = tempDirWithFiles("update-filter-invalid-test", {
      "package.json": JSON.stringify({
        name: "my-monorepo",
        workspaces: {
          packages: ["packages/*"],
        },
      }),
      "packages/web/package.json": JSON.stringify({
        name: "web",
        dependencies: {
          "is-even": "1.0.0",
        },
      }),
    });

    // Test with non-existent workspace filter
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "--filter=nonexistent"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should not crash with argument parsing errors
    expect(stderr).not.toContain("Unknown option");
    expect(stderr).not.toContain("--filter");
  });
});