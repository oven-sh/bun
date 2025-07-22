import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bun update --filter support (issue #21236)", () => {
  it("should support --filter flag for monorepo workspaces", async () => {
    const dir = tempDirWithFiles("update-filter-test", {
      "package.json": JSON.stringify({
        name: "my-monorepo",
        workspaces: {
          packages: ["packages/*"],
          catalog: {
            react: "18.0.0",
            "react-dom": "18.0.0",
            dotenv: "^16.4.7",
          },
        },
      }),
      "packages/web/package.json": JSON.stringify({
        name: "web",
        dependencies: {
          react: "catalog:",
          "react-dom": "catalog:",
          "lodash": "^4.0.0",
        },
      }),
      "packages/server/package.json": JSON.stringify({
        name: "server", 
        dependencies: {
          dotenv: "catalog:",
          express: "^4.0.0",
        },
      }),
    });

    // Test that --filter flag is recognized and doesn't error
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "--filter=*", "--help"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should show help with filter option
    expect(stdout).toContain("--filter");
    expect(stdout).toContain("Update dependencies for each matching workspace");
    expect(exitCode).toBe(0);
  });

  it("should support --filter flag with workspace patterns", async () => {
    const dir = tempDirWithFiles("update-filter-pattern-test", {
      "package.json": JSON.stringify({
        name: "my-monorepo",
        workspaces: {
          packages: ["packages/*"],
        },
      }),
      "packages/web/package.json": JSON.stringify({
        name: "web",
        dependencies: {
          lodash: "^4.0.0",
        },
      }),
      "packages/api/package.json": JSON.stringify({
        name: "api",
        dependencies: {
          express: "^4.0.0",
        },
      }),
    });

    // Test specific workspace filter
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "--filter=web"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should not crash with invalid argument errors
    expect(stderr).not.toContain("Unknown option");
    expect(stderr).not.toContain("--filter");
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
});