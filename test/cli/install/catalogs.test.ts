import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, runBunInstall, stderrForInstall } from "harness";
import { join } from "path";

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("basic", () => {
  async function createBasicCatalogMonorepo(packageDir: string, name: string, inTopLevelKey: boolean = false) {
    const catalogs = {
      catalog: {
        "no-deps": "2.0.0",
      },
      catalogs: {
        a: {
          "a-dep": "1.0.1",
        },
      },
    };
    const packageJson = !inTopLevelKey
      ? {
          name,
          workspaces: {
            packages: ["packages/*"],
            ...catalogs,
          },
        }
      : {
          name,
          ...catalogs,
          workspaces: {
            packages: ["packages/*"],
          },
        };

    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify(packageJson)),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "catalog:",
            "a-dep": "catalog:a",
          },
        }),
      ),
    ]);

    return packageJson;
  }

  for (const isTopLevel of [true, false]) {
    test(`both catalog and catalogs ${isTopLevel ? "in top-level" : "in workspaces"}`, async () => {
      const { packageDir } = await registry.createTestDir();

      await createBasicCatalogMonorepo(packageDir, "catalog-basic-1", isTopLevel);

      await runBunInstall(bunEnv, packageDir);

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "2.0.0",
      });

      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
        name: "a-dep",
        version: "1.0.1",
      });

      // another install does not save the lockfile
      await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
    });
  }

  for (const binaryLockfile of [true, false]) {
    test(`detect changes (${binaryLockfile ? "bun.lockb" : "bun.lock"})`, async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { saveTextLockfile: !binaryLockfile, linker: "hoisted" },
      });
      const packageJson = await createBasicCatalogMonorepo(packageDir, "catalog-basic-2");
      let { err } = await runBunInstall(bunEnv, packageDir);
      expect(err).toContain("Saved lockfile");

      const initialLockfile = !binaryLockfile
        ? (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234")
        : undefined;

      if (!binaryLockfile) {
        expect(initialLockfile).toMatchSnapshot();
      } else {
        expect(await exists(join(packageDir, "bun.lockb"))).toBeTrue();
      }

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "2.0.0",
      });
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
        name: "a-dep",
        version: "1.0.1",
      });

      // update catalog
      packageJson.workspaces.catalog["no-deps"] = "1.0.0";
      await write(join(packageDir, "package.json"), JSON.stringify(packageJson));
      ({ err } = await runBunInstall(bunEnv, packageDir, { savesLockfile: true }));
      expect(err).toContain("Saved lockfile");

      if (!binaryLockfile) {
        const newLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
          /localhost:\d+/g,
          "localhost:1234",
        );

        expect(newLockfile).not.toEqual(initialLockfile);
        expect(newLockfile).toMatchSnapshot();
      } else {
        expect(await exists(join(packageDir, "bun.lockb"))).toBeTrue();
      }

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "1.0.0",
      });
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
        name: "a-dep",
        version: "1.0.1",
      });

      // update catalogs
      packageJson.workspaces!.catalogs!.a["a-dep"] = "1.0.10";
      await write(join(packageDir, "package.json"), JSON.stringify(packageJson));
      ({ err } = await runBunInstall(bunEnv, packageDir, { savesLockfile: true }));
      expect(err).toContain("Saved lockfile");

      if (!binaryLockfile) {
        const newLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
          /localhost:\d+/g,
          "localhost:1234",
        );

        expect(newLockfile).not.toEqual(initialLockfile);
        expect(newLockfile).toMatchSnapshot();
      } else {
        expect(await exists(join(packageDir, "bun.lockb"))).toBeTrue();
      }

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "1.0.0",
      });
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
        name: "a-dep",
        version: "1.0.10",
      });
    });
  }
});

describe("update", () => {
  async function createUpdateMonorepo(packageDir: string, name: string, inTopLevelKey: boolean = false) {
    const catalogs = {
      catalog: {
        "no-deps": "^1.0.0",
      },
      catalogs: {
        a: {
          "a-dep": "~1.0.1",
        },
      },
    };
    const packageJson = !inTopLevelKey
      ? {
          name,
          workspaces: {
            packages: ["packages/*"],
            ...catalogs,
          },
        }
      : {
          name,
          ...catalogs,
          workspaces: {
            packages: ["packages/*"],
          },
        };

    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify(packageJson)),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "catalog:",
            "a-dep": "catalog:a",
          },
        }),
      ),
    ]);

    return packageJson;
  }

  async function runUpdate(cwd: string, ...args: string[]) {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "update", ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    return { out, err: stderrForInstall(err), exitCode };
  }

  for (const isTopLevel of [true, false]) {
    test(`--latest updates catalog versions ${isTopLevel ? "in top-level" : "in workspaces"}`, async () => {
      const { packageDir } = await registry.createTestDir();
      await createUpdateMonorepo(packageDir, `catalog-update-latest-${isTopLevel ? "top" : "ws"}`, isTopLevel);
      await runBunInstall(bunEnv, packageDir);

      const { err, exitCode } = await runUpdate(packageDir, "--latest");
      expect(err).not.toContain("error:");

      // catalog entries are updated, preserving the pinning style
      const root = await file(join(packageDir, "package.json")).json();
      const { catalog, catalogs } = isTopLevel ? root : root.workspaces;
      expect(catalog).toEqual({ "no-deps": "^2.0.0" });
      expect(catalogs).toEqual({ a: { "a-dep": "~1.0.10" } });

      // workspace packages keep their catalog references
      expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
        "no-deps": "catalog:",
        "a-dep": "catalog:a",
      });

      // the new versions are installed
      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "2.0.0",
      });
      expect((await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).version).toBe("1.0.10");
      expect(exitCode).toBe(0);
    });
  }

  test("--latest run from inside a workspace package updates the root catalog", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-in-workspace");
    await runBunInstall(bunEnv, packageDir);

    const { err, exitCode } = await runUpdate(join(packageDir, "packages", "pkg1"), "--latest");
    expect(err).not.toContain("error:");

    const root = await file(join(packageDir, "package.json")).json();
    expect(root.workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(root.workspaces.catalogs).toEqual({ a: { "a-dep": "~1.0.10" } });

    expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
      "no-deps": "catalog:",
      "a-dep": "catalog:a",
    });
    expect(exitCode).toBe(0);
  });

  test("--latest updates the same package independently per catalog", async () => {
    const { packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "catalog-update-identity",
          workspaces: {
            packages: ["packages/*"],
            catalog: {
              "no-deps": "^1.0.0",
            },
            catalogs: {
              pinned: {
                "no-deps": "1.0.1",
              },
              unused: {
                "no-deps": "1.0.0",
              },
            },
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "catalog:",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          dependencies: {
            "no-deps": "catalog:pinned",
          },
        }),
      ),
    ]);
    await runBunInstall(bunEnv, packageDir);

    const { err, exitCode } = await runUpdate(packageDir, "--latest");
    expect(err).not.toContain("error:");

    const root = await file(join(packageDir, "package.json")).json();
    // each catalog entry keeps its own pinning style
    expect(root.workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(root.workspaces.catalogs.pinned).toEqual({ "no-deps": "2.0.0" });
    // entries not referenced by any workspace are left unchanged
    expect(root.workspaces.catalogs.unused).toEqual({ "no-deps": "1.0.0" });
    expect(exitCode).toBe(0);
  });

  test("--latest --dry-run does not modify any package.json", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-dry-run");
    await runBunInstall(bunEnv, packageDir);

    const rootBefore = await file(join(packageDir, "package.json")).text();
    const pkg1Before = await file(join(packageDir, "packages", "pkg1", "package.json")).text();

    const { err, exitCode } = await runUpdate(packageDir, "--latest", "--dry-run");
    expect(err).not.toContain("error:");

    expect(await file(join(packageDir, "package.json")).text()).toBe(rootBefore);
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).text()).toBe(pkg1Before);
    expect(exitCode).toBe(0);
  });

  test("update without --latest stays in range and keeps catalog references", async () => {
    const { packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "catalog-update-no-latest",
          workspaces: {
            packages: ["packages/*"],
            catalog: {
              "no-deps": "^1.0.0",
            },
            catalogs: {
              pinned: {
                "a-dep": "1.0.1",
              },
            },
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "catalog:",
            "a-dep": "catalog:pinned",
          },
        }),
      ),
    ]);
    await runBunInstall(bunEnv, packageDir);

    const { err, exitCode } = await runUpdate(join(packageDir, "packages", "pkg1"));
    expect(err).not.toContain("error:");

    const root = await file(join(packageDir, "package.json")).json();
    // ranges move within the range (latest of ^1.0.0 is 1.1.0, not 2.0.0)...
    expect(root.workspaces.catalog).toEqual({ "no-deps": "^1.1.0" });
    // ...and exact versions are not moved by a plain `bun update`
    expect(root.workspaces.catalogs).toEqual({ pinned: { "a-dep": "1.0.1" } });

    expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
      "no-deps": "catalog:",
      "a-dep": "catalog:pinned",
    });
    expect(exitCode).toBe(0);
  });

  test("update <pkg> --latest keeps the catalog reference", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-targeted");
    await runBunInstall(bunEnv, packageDir);

    const { err, exitCode } = await runUpdate(join(packageDir, "packages", "pkg1"), "no-deps", "--latest");
    expect(err).not.toContain("error:");

    expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
      "no-deps": "catalog:",
      "a-dep": "catalog:a",
    });
    expect(exitCode).toBe(0);
  });
});

describe("errors", () => {
  test("fails gracefully when no catalog is found for a package", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "catalog-error-1",
        workspaces: {
          // empty, any catalog should fail to resolve
          catalog: {},
          catalogs: {},
        },
        dependencies: {
          "no-deps": "catalog:",

          // longer than 8
          "a-dep": "catalog:aaaaaaaaaaaaaaaaa",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const out = await stdout.text();
    const err = stderrForInstall(await stderr.text());

    expect(err).toContain("no-deps@catalog: failed to resolve");
    expect(err).toContain("a-dep@catalog:aaaaaaaaaaaaaaaaa failed to resolve");
  });

  test("invalid dependency version", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "catalog-error-2",
        workspaces: {
          catalog: {
            "no-deps": ".:",
          },
        },
        dependencies: {
          "no-deps": "catalog:",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const out = await stdout.text();
    const err = stderrForInstall(await stderr.text());

    expect(err).toContain("no-deps@catalog: failed to resolve");
  });
});
