import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

function createMonorepo() {
  return tempDir("bun-prune", {
    "package.json": JSON.stringify(
      {
        name: "monorepo",
        workspaces: ["packages/*", "services/*"],
        private: true,
      },
      null,
      2,
    ),
    "packages/shared/package.json": JSON.stringify({
      name: "@myapp/shared",
      version: "1.0.0",
    }),
    "packages/shared/index.ts": "export const shared = true;",
    "packages/utils/package.json": JSON.stringify({
      name: "@myapp/utils",
      version: "1.0.0",
      dependencies: {
        "@myapp/shared": "workspace:*",
      },
    }),
    "packages/utils/index.ts": "export const utils = true;",
    "packages/unrelated/package.json": JSON.stringify({
      name: "@myapp/unrelated",
      version: "1.0.0",
    }),
    "packages/unrelated/index.ts": "export const unrelated = true;",
    "services/api/package.json": JSON.stringify({
      name: "@myapp/api",
      version: "1.0.0",
      dependencies: {
        "@myapp/utils": "workspace:*",
        "is-even": "1.0.0",
      },
    }),
    "services/api/src/server.ts": "console.log('api server');",
    "services/web/package.json": JSON.stringify({
      name: "@myapp/web",
      version: "1.0.0",
      dependencies: {
        "@myapp/shared": "workspace:*",
      },
    }),
    "services/web/index.ts": "console.log('web');",
  });
}

async function installInDir(dir: ReturnType<typeof tempDir>) {
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await installProc.exited;
  expect(exitCode).toBe(0);
}

describe("bun prune", () => {
  test("prints usage when no workspace specified", async () => {
    using dir = createMonorepo();
    await installInDir(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "prune"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
  });

  test("errors when workspace not found", async () => {
    using dir = createMonorepo();
    await installInDir(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "prune", "nonexistent"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;
    expect(stderr).toContain("not found");
    expect(exitCode).toBe(1);
  });

  test("prunes monorepo for target workspace", async () => {
    using dir = createMonorepo();
    await installInDir(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "prune", "@myapp/api", "--out-dir=pruned"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(stdout).toContain("Pruned monorepo");

    const outDir = path.join(String(dir), "pruned");

    // Should have pruned package.json
    expect(existsSync(path.join(outDir, "package.json"))).toBe(true);
    const rootPkg = JSON.parse(readFileSync(path.join(outDir, "package.json"), "utf8"));
    const workspaces: string[] = rootPkg.workspaces;
    expect(workspaces).toContain("services/api");
    expect(workspaces).toContain("packages/utils");
    expect(workspaces).toContain("packages/shared");
    expect(workspaces).not.toContain("packages/unrelated");
    expect(workspaces).not.toContain("services/web");

    // Should have pruned lockfile
    expect(existsSync(path.join(outDir, "bun.lock"))).toBe(true);
    const lockContent = readFileSync(path.join(outDir, "bun.lock"), "utf8");
    expect(lockContent).toContain('"services/api"');
    expect(lockContent).toContain('"packages/utils"');
    expect(lockContent).toContain('"packages/shared"');
    expect(lockContent).not.toContain('"packages/unrelated"');
    expect(lockContent).not.toContain('"services/web"');

    // Should have copied workspace source files
    expect(existsSync(path.join(outDir, "services/api/src/server.ts"))).toBe(true);
    expect(existsSync(path.join(outDir, "packages/utils/index.ts"))).toBe(true);
    expect(existsSync(path.join(outDir, "packages/shared/index.ts"))).toBe(true);
    // Should NOT have unrelated workspace files
    expect(existsSync(path.join(outDir, "packages/unrelated"))).toBe(false);
    expect(existsSync(path.join(outDir, "services/web"))).toBe(false);

    // Assert exit code last for better error messages
    expect(exitCode).toBe(0);
  });

  test("--docker splits output into json/ and full/", async () => {
    using dir = createMonorepo();
    await installInDir(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "prune", "@myapp/api", "--docker", "--out-dir=out"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const exitCode = await proc.exited;

    expect(stdout).toContain("Pruned monorepo");

    const outDir = path.join(String(dir), "out");

    // json/ should have package.json files and lockfile
    expect(existsSync(path.join(outDir, "json/package.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "json/bun.lock"))).toBe(true);
    expect(existsSync(path.join(outDir, "json/services/api/package.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "json/packages/utils/package.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "json/packages/shared/package.json"))).toBe(true);
    // json/ should NOT have source files
    expect(existsSync(path.join(outDir, "json/services/api/src/server.ts"))).toBe(false);

    // full/ should have package.json and source files
    expect(existsSync(path.join(outDir, "full/package.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "full/services/api/src/server.ts"))).toBe(true);
    expect(existsSync(path.join(outDir, "full/packages/utils/index.ts"))).toBe(true);
    expect(existsSync(path.join(outDir, "full/packages/shared/index.ts"))).toBe(true);

    // Neither should have unrelated workspaces
    expect(existsSync(path.join(outDir, "json/packages/unrelated"))).toBe(false);
    expect(existsSync(path.join(outDir, "full/packages/unrelated"))).toBe(false);

    // Assert exit code last for better error messages
    expect(exitCode).toBe(0);
  });
});
