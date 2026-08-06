import { file, spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { exists } from "fs/promises";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

// These tests cover the `configVersion` field in bun.lock and the linker
// selection it gates. They run fully offline using file:/workspace: deps so no
// registry process is spawned; see lockfile-version-2.test.ts for the same
// pattern. All three spawn into independent tempdirs and run concurrently.

async function install(cwd: string) {
  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

describe.concurrent("configVersion", () => {
  test("new projects use current config version", async () => {
    using dir = tempDir("config-version-new-proj", {
      "package.json": JSON.stringify({
        name: "new-proj",
        dependencies: { dep: "file:./dep" },
      }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
    const packageDir = String(dir);

    const { out, err, exitCode } = await install(packageDir);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + dep@dep

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    // non-monorepo: hoisted linker, no .bun store
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules/.bun")),
        file(join(packageDir, "node_modules/dep/package.json")).json(),
      ]),
    ).toEqual([false, { name: "dep", version: "1.0.0" }]);

    expect(await file(join(packageDir, "bun.lock")).text()).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "new-proj",
            "dependencies": {
              "dep": "file:./dep",
            },
          },
        },
        "packages": {
          "dep": ["dep@file:dep", {}],
        }
      }
      "
    `);
  });

  test("new monorepos use isolated linker", async () => {
    using dir = tempDir("config-version-new-monorepo", {
      "package.json": JSON.stringify({
        name: "new-proj",
        workspaces: ["packages/*"],
      }),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        dependencies: { dep: "file:../../dep" },
      }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
    const packageDir = String(dir);

    const { out, err, exitCode } = await install(packageDir);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      2 packages installed"
    `);
    expect(exitCode).toBe(0);

    // monorepo: isolated linker, dep lives in the .bun store and is linked into pkg1
    expect(
      await Promise.all([
        exists(join(packageDir, "packages/pkg1/node_modules/dep")),
        file(join(packageDir, "node_modules/.bun/dep@file+dep/node_modules/dep/package.json")).json(),
      ]),
    ).toEqual([true, { name: "dep", version: "1.0.0" }]);

    expect(await file(join(packageDir, "bun.lock")).text()).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "new-proj",
          },
          "packages/pkg1": {
            "name": "pkg1",
            "dependencies": {
              "dep": "file:../../dep",
            },
          },
        },
        "packages": {
          "pkg1": ["pkg1@workspace:packages/pkg1"],

          "pkg1/dep": ["dep@file:dep", {}],
        }
      }
      "
    `);
  });

  test("should add configVersion@v0 to an existing lockfile", async () => {
    using dir = tempDir("config-version-existing-lockfile", {
      "package.json": JSON.stringify({
        name: "root-1",
        workspaces: ["packages/*"],
        dependencies: { pkg1: "workspace:*" },
      }),
      "packages/pkg1/package.json": JSON.stringify({ name: "pkg1" }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "new-proj",
            dependencies: { pkg1: "workspace:*" },
          },
          "packages/pkg1": { name: "pkg1" },
        },
        packages: {
          pkg1: ["pkg1@workspace:packages/pkg1"],
        },
      }),
    });
    const packageDir = String(dir);

    const { out, err, exitCode } = await install(packageDir);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + pkg1@workspace:packages/pkg1

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    // should be hoisted install
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules/.bun")),
        file(join(packageDir, "node_modules/pkg1/package.json")).json(),
      ]),
    ).toEqual([false, { name: "pkg1" }]);

    // lockfileVersion stays 1 — an existing lockfile is never bumped on re-save.
    // configVersion is backfilled (0) because the loaded lockfile had none.
    expect(await file(join(packageDir, "bun.lock")).text()).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 1,
        "configVersion": 0,
        "workspaces": {
          "": {
            "name": "new-proj",
            "dependencies": {
              "pkg1": "workspace:*",
            },
          },
          "packages/pkg1": {
            "name": "pkg1",
          },
        },
        "packages": {
          "pkg1": ["pkg1@workspace:packages/pkg1"],
        }
      }
      "
    `);
  });
});
