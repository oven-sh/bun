import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("issue #28073 - bun update preserves catalog references", () => {
  test("default catalog: bun update preserves catalog: in devDependencies", async () => {
    using dir = tempDir("28073-default-catalog", {
      "package.json": JSON.stringify({
        name: "catalog-monorepo",
        private: true,
        workspaces: ["packages/*"],
        catalog: {
          "is-odd": "^3.0.0",
        },
        devDependencies: {
          "is-odd": "catalog:",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: {
          "is-odd": "catalog:",
        },
      }),
    });

    // Install first
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // Run bun update
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await updateProc.exited).toBe(0);

    const rootPkg = await file(join(String(dir), "package.json")).json();

    // The catalog: reference in devDependencies must be preserved
    expect(rootPkg.devDependencies["is-odd"]).toBe("catalog:");

    // The catalog section should be updated with the resolved version
    expect(rootPkg.catalog["is-odd"]).toMatch(/^\^3\./);

    // Sub-workspace catalog: references must also be preserved
    const appPkg = await file(join(String(dir), "packages", "app", "package.json")).json();
    expect(appPkg.dependencies["is-odd"]).toBe("catalog:");
  });

  test("named catalog: bun update preserves catalog:group in dependencies", async () => {
    using dir = tempDir("28073-named-catalog", {
      "package.json": JSON.stringify({
        name: "catalog-monorepo",
        private: true,
        workspaces: ["packages/*"],
        catalogs: {
          tools: {
            "is-odd": "^3.0.0",
          },
        },
        devDependencies: {
          "is-odd": "catalog:tools",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: {
          "is-odd": "catalog:tools",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await updateProc.exited).toBe(0);

    const rootPkg = await file(join(String(dir), "package.json")).json();

    // The catalog:tools reference must be preserved
    expect(rootPkg.devDependencies["is-odd"]).toBe("catalog:tools");

    // The named catalog section should be updated
    expect(rootPkg.catalogs.tools["is-odd"]).toMatch(/^\^3\./);

    // Sub-workspace catalog: references must also be preserved
    const appPkg = await file(join(String(dir), "packages", "app", "package.json")).json();
    expect(appPkg.dependencies["is-odd"]).toBe("catalog:tools");
  });

  test("bun update -r preserves catalog references", async () => {
    using dir = tempDir("28073-update-r", {
      "package.json": JSON.stringify({
        name: "catalog-monorepo",
        private: true,
        workspaces: ["packages/*"],
        catalog: {
          "is-odd": "^3.0.0",
        },
        devDependencies: {
          "is-odd": "catalog:",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: {
          "is-odd": "catalog:",
        },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "-r"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await updateProc.exited).toBe(0);

    const rootPkg = await file(join(String(dir), "package.json")).json();

    // catalog: references must be preserved
    expect(rootPkg.devDependencies["is-odd"]).toBe("catalog:");

    // The catalog section should be updated
    expect(rootPkg.catalog["is-odd"]).toMatch(/^\^3\./);

    // Sub-workspace must preserve catalog: references
    const appPkg = await file(join(String(dir), "packages", "app", "package.json")).json();
    expect(appPkg.dependencies["is-odd"]).toBe("catalog:");
  });
});
