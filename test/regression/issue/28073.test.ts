import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function runBun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`bun ${args.join(" ")} exited with code ${exitCode}:\n${stderr}`);
  }
}

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

    await runBun(String(dir), "install");
    await runBun(String(dir), "update");

    const rootPkg = await file(join(String(dir), "package.json")).json();

    // The catalog: reference in devDependencies must be preserved
    expect(rootPkg.devDependencies["is-odd"]).toBe("catalog:");

    // The catalog section should be updated with a valid semver pin, not the seeded value
    expect(rootPkg.catalog["is-odd"]).not.toBe("^3.0.0");
    expect(rootPkg.catalog["is-odd"]).toMatch(/^[~^]?\d+\./);

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
        dependencies: {
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

    await runBun(String(dir), "install");
    await runBun(String(dir), "update");

    const rootPkg = await file(join(String(dir), "package.json")).json();

    // The catalog:tools reference must be preserved
    expect(rootPkg.dependencies["is-odd"]).toBe("catalog:tools");

    // The named catalog section should be updated with a valid semver pin, not the seeded value
    expect(rootPkg.catalogs.tools["is-odd"]).not.toBe("^3.0.0");
    expect(rootPkg.catalogs.tools["is-odd"]).toMatch(/^[~^]?\d+\./);

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

    await runBun(String(dir), "install");
    await runBun(String(dir), "update", "-r");

    const rootPkg = await file(join(String(dir), "package.json")).json();

    // catalog: references must be preserved
    expect(rootPkg.devDependencies["is-odd"]).toBe("catalog:");

    // The catalog section should be updated with a valid semver pin, not the seeded value
    expect(rootPkg.catalog["is-odd"]).not.toBe("^3.0.0");
    expect(rootPkg.catalog["is-odd"]).toMatch(/^[~^]?\d+\./);

    // Sub-workspace must preserve catalog: references
    const appPkg = await file(join(String(dir), "packages", "app", "package.json")).json();
    expect(appPkg.dependencies["is-odd"]).toBe("catalog:");
  });
});
