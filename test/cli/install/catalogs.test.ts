import { file, spawn, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readlinkSync } from "fs";
import { exists, readdir, rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, pack, runBunInstall } from "harness";
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

  test("switching a dependency to a different catalog is detected", async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true, linker: "hoisted" } });
    const pkg1Path = join(packageDir, "packages", "pkg1", "package.json");
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "catalog-switch",
          workspaces: {
            packages: ["packages/*"],
            catalogs: { a: { "no-deps": "1.0.0" }, b: { "no-deps": "2.0.0" } },
          },
        }),
      ),
      write(pkg1Path, JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:a" } })),
    ]);

    await runBunInstall(bunEnv, packageDir);
    expect((await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).version).toBe("1.0.0");

    await write(pkg1Path, JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:b" } }));
    await runBunInstall(bunEnv, packageDir);

    expect((await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).version).toBe("2.0.0");
    const lock = Bun.JSONC.parse(await file(join(packageDir, "bun.lock")).text()) as any;
    expect(lock.workspaces["packages/pkg1"].dependencies).toEqual({ "no-deps": "catalog:b" });
    expect(Object.keys(lock.packages)).toEqual(["no-deps", "pkg1"]);
    expect(lock.packages["no-deps"][0]).toBe("no-deps@2.0.0");

    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
  });
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
    return { out, err, exitCode };
  }

  // https://github.com/oven-sh/bun/issues/23739
  for (const [flags, label] of [
    [["--latest"], "in top-level"],
    [["--latest"], "in workspaces"],
    [["-r", "--latest"], "with -r"],
  ] as const) {
    const isTopLevel = label === "in top-level";
    test(`--latest updates catalog versions ${label}`, async () => {
      const { packageDir } = await registry.createTestDir();
      await createUpdateMonorepo(packageDir, `catalog-update-latest-${label.replace(/\W+/g, "-")}`, isTopLevel);
      await runBunInstall(bunEnv, packageDir);

      const { err, exitCode } = await runUpdate(packageDir, ...flags);
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

  test("--frozen-lockfile passes after --latest updates catalogs", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-frozen");
    await runBunInstall(bunEnv, packageDir);

    const update = await runUpdate(packageDir, "--latest");
    expect(update.err).not.toContain("error:");
    expect(update.exitCode).toBe(0);
    expect((await file(join(packageDir, "package.json")).json()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const [, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("lockfile had changes");
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

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

  for (const fromWorkspace of [false, true]) {
    test(`--latest --dry-run does not modify any package.json (from ${fromWorkspace ? "workspace" : "root"})`, async () => {
      const { packageDir } = await registry.createTestDir();
      await createUpdateMonorepo(packageDir, `catalog-update-dry-run-${fromWorkspace ? "ws" : "root"}`);
      await runBunInstall(bunEnv, packageDir);

      const rootBefore = await file(join(packageDir, "package.json")).text();
      const pkg1Before = await file(join(packageDir, "packages", "pkg1", "package.json")).text();

      const cwd = fromWorkspace ? join(packageDir, "packages", "pkg1") : packageDir;
      const { err, exitCode } = await runUpdate(cwd, "--latest", "--dry-run");
      expect(err).not.toContain("error:");

      expect(await file(join(packageDir, "package.json")).text()).toBe(rootBefore);
      expect(await file(join(packageDir, "packages", "pkg1", "package.json")).text()).toBe(pkg1Before);
      expect(exitCode).toBe(0);
    });
  }

  for (const args of [[], ["-r"]] as const) {
    test(`update without --latest from root moves catalogs within range (${args.join(" ") || "no args"})`, async () => {
      // The lockfile pins no-deps@1.0.0 (as if 1.1.0 was published after install).
      // `bun update` from the workspace root must re-resolve catalog references
      // within range the same as a direct dependency would be.
      const { packageDir } = await registry.createTestDir();
      const url = registry.registryUrl();
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "catalog-update-from-root",
            workspaces: {
              packages: ["packages/*"],
              catalog: { "no-deps": "^1.0.0" },
            },
          }),
        ),
        write(
          join(packageDir, "packages", "pkg1", "package.json"),
          JSON.stringify({
            name: "pkg1",
            dependencies: { "no-deps": "catalog:" },
          }),
        ),
        write(
          join(packageDir, "bun.lock"),
          JSON.stringify({
            lockfileVersion: 1,
            configVersion: 1,
            workspaces: {
              "": { name: "catalog-update-from-root" },
              "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
            },
            catalog: { "no-deps": "^1.0.0" },
            packages: {
              "no-deps": [
                "no-deps@1.0.0",
                `${url}no-deps/-/no-deps-1.0.0.tgz`,
                {},
                "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
              ],
              "pkg1": ["pkg1@workspace:packages/pkg1"],
            },
          }),
        ),
      ]);

      const { err, exitCode } = await runUpdate(packageDir, ...args);
      expect(err).not.toContain("error:");

      const root = await file(join(packageDir, "package.json")).json();
      expect(root.workspaces.catalog).toEqual({ "no-deps": "^1.1.0" });

      expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
        "no-deps": "catalog:",
      });
      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "1.1.0",
      });

      const lock = await file(join(packageDir, "bun.lock")).text();
      expect(lock).toContain("no-deps@1.1.0");
      expect(lock).not.toContain("no-deps@1.0.0");
      expect(exitCode).toBe(0);
    });
  }

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
    const err = await stderr.text();

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
    const err = await stderr.text();

    expect(err).toContain("no-deps@catalog: failed to resolve");
  });
});

describe("peer dependencies", () => {
  type Linker = "hoisted" | "isolated";

  // `--linker` in addition to bunfig: a user-level ~/.npmrc `install-strategy` would otherwise override bunfig's linker.
  async function spawnInstall(dir: string, linker: Linker, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--linker", linker, ...args],
      cwd: dir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, code };
  }

  async function install(dir: string, linker: Linker, ...args: string[]) {
    const result = await spawnInstall(dir, linker, ...args);
    expect(result.err).not.toContain("error:");
    expect(result.code).toBe(0);
    return result;
  }

  async function packageKeys(dir: string): Promise<string[]> {
    const lockfile = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as {
      packages: Record<string, unknown>;
    };
    return Object.keys(lockfile.packages).sort();
  }

  async function layout(dir: string, peerName = "no-deps"): Promise<string> {
    const path = join(dir, "packages", "lib", "node_modules", peerName);
    if (!existsSync(path)) return "<hoisted>";
    if (lstatSync(path).isSymbolicLink()) return readlinkSync(path);
    const { version } = await Bun.file(join(path, "package.json")).json();
    return `nested:${version}`;
  }

  function rootPackageJson(opts: {
    catalog?: Record<string, string>;
    catalogs?: Record<string, Record<string, string>>;
    rootDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  }) {
    return {
      name: "root",
      workspaces: {
        packages: ["packages/*"],
        ...(opts.catalog ? { catalog: opts.catalog } : {}),
        ...(opts.catalogs ? { catalogs: opts.catalogs } : {}),
      },
      dependencies: opts.rootDependencies ?? { "one-fixed-dep": "2.0.0" },
      ...(opts.overrides ? { overrides: opts.overrides } : {}),
    };
  }

  type RepoOpts = {
    peerSpec: string;
    peerName?: string;
    catalog?: Record<string, string>;
    catalogs?: Record<string, Record<string, string>>;
    rootDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
    optionalPeer?: boolean;
    appDependencies?: Record<string, string>;
    extraWorkspaces?: Record<string, object>;
    libVersion?: string;
    linker: Linker;
    saveTextLockfile?: boolean;
  };

  async function makeRepo(opts: RepoOpts): Promise<string> {
    const peerName = opts.peerName ?? "no-deps";
    const extraFiles: Record<string, string> = {};
    for (const [name, pkg] of Object.entries(opts.extraWorkspaces ?? {})) {
      extraFiles[`packages/${name}/package.json`] = JSON.stringify({ name, ...pkg });
    }
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: opts.linker, saveTextLockfile: opts.saveTextLockfile },
      files: {
        "package.json": JSON.stringify(rootPackageJson(opts)),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: opts.appDependencies ?? {
            "no-deps": "1.0.0",
            lib: "workspace:*",
          },
        }),
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          ...(opts.libVersion ? { version: opts.libVersion } : {}),
          peerDependencies: {
            [peerName]: opts.peerSpec,
          },
          ...(opts.optionalPeer ? { peerDependenciesMeta: { [peerName]: { optional: true } } } : {}),
        }),
        ...extraFiles,
      },
    });
    return packageDir;
  }

  async function rewriteRootPackageJson(dir: string, opts: Parameters<typeof rootPackageJson>[0]) {
    await Bun.write(join(dir, "package.json"), JSON.stringify(rootPackageJson(opts)));
  }

  async function rmNodeModules(dir: string) {
    const workspaces = await readdir(join(dir, "packages"));
    await Promise.all(
      [join(dir, "node_modules"), ...workspaces.map(ws => join(dir, "packages", ws, "node_modules"))].map(path =>
        rm(path, { recursive: true, force: true }),
      ),
    );
  }

  const dedupedKeys = ["app", "lib", "no-deps", "one-fixed-dep", "one-fixed-dep/no-deps"];
  const nestedKeys = ["app", "lib", "lib/no-deps", "no-deps", "one-fixed-dep", "one-fixed-dep/no-deps"];
  const isolatedNoDeps = (version: string) =>
    join("..", "..", "..", "node_modules", ".bun", `no-deps@${version}`, "node_modules", "no-deps");
  const isolatedNoDeps2 = isolatedNoDeps("2.0.0");
  const linkers = ["hoisted", "isolated"] as const;

  test.concurrent("default catalog peer dedupes onto the satisfying ancestor", async () => {
    const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker: "hoisted" });
    await install(dir, "hoisted");
    expect(await packageKeys(dir)).toEqual(dedupedKeys);
    expect(existsSync(join(dir, "packages", "lib", "node_modules", "no-deps"))).toBeFalse();
  });

  test.concurrent("named catalog peer (catalog:peers) dedupes the same way", async () => {
    const dir = await makeRepo({
      catalogs: { peers: { "no-deps": ">=1.0.0" } },
      peerSpec: "catalog:peers",
      linker: "hoisted",
    });
    await install(dir, "hoisted");
    expect(await packageKeys(dir)).toEqual(dedupedKeys);
    expect(existsSync(join(dir, "packages", "lib", "node_modules", "no-deps"))).toBeFalse();
  });

  test.concurrent("optional catalog peer dedupes too", async () => {
    const dir = await makeRepo({
      catalog: { "no-deps": ">=1.0.0" },
      peerSpec: "catalog:",
      optionalPeer: true,
      linker: "hoisted",
    });
    await install(dir, "hoisted");
    expect(await packageKeys(dir)).toEqual(dedupedKeys);
    expect(existsSync(join(dir, "packages", "lib", "node_modules", "no-deps"))).toBeFalse();
  });

  test.concurrent("scoped package name as a catalog peer", async () => {
    const dir = await makeRepo({
      rootDependencies: {},
      catalog: { "@scoped/has-bin-entry": ">=1.0.0" },
      peerName: "@scoped/has-bin-entry",
      peerSpec: "catalog:",
      appDependencies: { "@scoped/has-bin-entry": "1.0.0", lib: "workspace:*" },
      linker: "hoisted",
    });
    await install(dir, "hoisted");
    expect(await packageKeys(dir)).toEqual(["@scoped/has-bin-entry", "app", "lib"]);
    expect(existsSync(join(dir, "packages", "lib", "node_modules", "@scoped"))).toBeFalse();
  });

  async function record(dir: string, linker: Linker, peerName?: string) {
    await install(dir, linker);
    const keys = await packageKeys(dir);
    const fresh = await layout(dir, peerName);
    await rmNodeModules(dir);
    const { err } = await install(dir, linker);
    const keysAfterReload = await packageKeys(dir);
    const reload = await layout(dir, peerName);
    return { keys, fresh, keysAfterReload, reload, reloadSavedLockfile: err.includes("Saved lockfile") };
  }

  describe.each([
    [">=1.0.0", "dedupes"],
    ["^2.0.0", "stays nested"],
  ] as const)("peer range %s (%s)", (range, outcome) => {
    describe.each(linkers)("linker=%s", linker => {
      test.concurrent("catalog: peer produces the same lockfile and layout as the inline range", async () => {
        const [catalogDir, inlineDir] = await Promise.all([
          makeRepo({ catalog: { "no-deps": range }, peerSpec: "catalog:", linker }),
          makeRepo({ peerSpec: range, linker }),
        ]);
        const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);

        const expectedKeys = outcome === "dedupes" ? dedupedKeys : nestedKeys;
        expect(fromInline.keys).toEqual(expectedKeys);
        expect(fromInline.keysAfterReload).toEqual(expectedKeys);
        expect(fromInline.reloadSavedLockfile).toBeFalse();
        if (linker === "isolated") {
          expect(fromInline.fresh).toEndWith(isolatedNoDeps2);
          expect(fromInline.reload).toEndWith(isolatedNoDeps2);
        } else {
          const expectedLayout = outcome === "dedupes" ? "<hoisted>" : "nested:2.0.0";
          expect(fromInline.fresh).toBe(expectedLayout);
          expect(fromInline.reload).toBe(expectedLayout);
        }

        expect(fromCatalog).toEqual(fromInline);
      });
    });
  });

  describe.each(linkers)("linker=%s", linker => {
    test.concurrent("catalog `*` peer behaves exactly like an inline `*` peer", async () => {
      const [catalogDir, inlineDir] = await Promise.all([
        makeRepo({ catalog: { "no-deps": "*" }, peerSpec: "catalog:", linker }),
        makeRepo({ peerSpec: "*", linker }),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
      expect(fromInline.keys).toEqual(dedupedKeys);
      expect(fromInline.keysAfterReload).toEqual(dedupedKeys);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toEqual(fromInline);
    });

    test.concurrent("aliased catalog entry peer matches the inline alias", async () => {
      const [catalogDir, inlineDir] = await Promise.all([
        makeRepo({ catalog: { "no-deps": "npm:no-deps@>=1.0.0" }, peerSpec: "catalog:", linker }),
        makeRepo({ peerSpec: "npm:no-deps@>=1.0.0", linker }),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
      expect(fromInline.keysAfterReload).toEqual(fromInline.keys);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toEqual(fromInline);
    });

    test.concurrent("optional catalog peer matches the inline optional peer on reload", async () => {
      const [catalogDir, inlineDir] = await Promise.all([
        makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", optionalPeer: true, linker }),
        makeRepo({ peerSpec: ">=1.0.0", optionalPeer: true, linker }),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
      expect(fromInline.keys).toEqual(dedupedKeys);
      expect(fromInline.keysAfterReload).toEqual(dedupedKeys);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toEqual(fromInline);
    });

    // pnpm: deps-installer/test/catalogs.ts "importer with different peers uses correct peer"
    test.concurrent(
      "two consumers providing different peer versions: catalog peer still equals inline peer",
      async () => {
        const twoConsumers = (peerSpec: string, catalog?: Record<string, string>) =>
          makeRepo({
            peerSpec,
            catalog,
            rootDependencies: {},
            appDependencies: { "no-deps": "1.0.0", lib: "workspace:*" },
            extraWorkspaces: { app2: { dependencies: { "no-deps": "2.0.0", lib: "workspace:*" } } },
            linker,
          });
        const [catalogDir, inlineDir] = await Promise.all([
          twoConsumers("catalog:", { "no-deps": ">=1.0.0" }),
          twoConsumers(">=1.0.0"),
        ]);
        const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
        expect(fromInline.keys).toEqual(["app", "app2", "app2/no-deps", "lib", "no-deps"]);
        expect(fromInline.keysAfterReload).toEqual(fromInline.keys);
        expect(fromInline.reloadSavedLockfile).toBeFalse();
        expect(fromCatalog).toEqual(fromInline);
      },
    );

    // pnpm: deps-installer/test/catalogs.ts "catalog resolutions should be consistent with peer dependencies"
    test.concurrent("warm install leaves bun.lock byte-identical and --frozen-lockfile passes", async () => {
      const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker });
      await install(dir, linker);
      const lockfile = await Bun.file(join(dir, "bun.lock")).text();
      await rmNodeModules(dir);
      const warm = await install(dir, linker);
      expect(warm.err).not.toContain("Saved lockfile");
      expect(await Bun.file(join(dir, "bun.lock")).text()).toBe(lockfile);
      await rmNodeModules(dir);
      const frozen = await install(dir, linker, "--frozen-lockfile");
      expect(frozen.err).not.toContain("lockfile had changes");
      if (linker === "hoisted") expect(await layout(dir)).toBe("<hoisted>");
      else expect(await layout(dir)).toEndWith(isolatedNoDeps2);
    });
  });

  // pnpm: deps-installer/test/catalogs.ts "lockfile is updated if catalog config changes"
  test.concurrent("changing the catalog range of a peer re-hoists on the next install (both directions)", async () => {
    const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker: "hoisted" });
    await install(dir, "hoisted");
    expect(await packageKeys(dir)).toEqual(dedupedKeys);

    await rewriteRootPackageJson(dir, { catalog: { "no-deps": "^2.0.0" } });
    let { err } = await install(dir, "hoisted");
    expect(err).toContain("Saved lockfile");
    expect(await packageKeys(dir)).toEqual(nestedKeys);
    expect(await layout(dir)).toBe("nested:2.0.0");

    await rewriteRootPackageJson(dir, { catalog: { "no-deps": ">=1.0.0" } });
    ({ err } = await install(dir, "hoisted"));
    expect(err).toContain("Saved lockfile");
    expect(await packageKeys(dir)).toEqual(dedupedKeys);
  });

  // pnpm: deps-installer/test/catalogs.ts "frozen lockfile error is thrown if catalog config changes"
  test.concurrent("--frozen-lockfile fails when only a peer's catalog range changed", async () => {
    const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker: "hoisted" });
    await install(dir, "hoisted");
    const lockfile = await Bun.file(join(dir, "bun.lock")).text();

    await rewriteRootPackageJson(dir, { catalog: { "no-deps": "^2.0.0" } });
    const { err, code } = await spawnInstall(dir, "hoisted", "--frozen-lockfile");
    expect(err).toContain("error: lockfile had changes, but lockfile is frozen");
    expect(code).not.toBe(0);
    expect(await Bun.file(join(dir, "bun.lock")).text()).toBe(lockfile);
  });

  test.concurrent("catalog peer with bun.lockb dedupes and reloads identically", async () => {
    const dir = await makeRepo({
      catalog: { "no-deps": ">=1.0.0" },
      peerSpec: "catalog:",
      linker: "hoisted",
      saveTextLockfile: false,
    });
    await install(dir, "hoisted");
    expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
    const lockb = await Bun.file(join(dir, "bun.lockb")).bytes();
    expect(await layout(dir)).toBe("<hoisted>");
    await rmNodeModules(dir);
    await install(dir, "hoisted");
    expect(await layout(dir)).toBe("<hoisted>");
    expect(await Bun.file(join(dir, "bun.lockb")).bytes()).toEqual(lockb);
  });

  // pnpm applies overrides before catalogs, keyed by the peer's own name, even when the catalog entry aliases another package.
  describe.each([
    ["plain", ">=2.0.0"],
    ["aliased", "npm:a-dep@1.0.1"],
  ] as const)("override beats the %s catalog entry of a peer", (_, entry) => {
    test.concurrent("fresh == reload", async () => {
      const dir = await makeRepo({
        overrides: { "no-deps": "1.0.0" },
        rootDependencies: { "one-fixed-dep": "2.0.0", "a-dep": "1.0.1" },
        catalog: { "no-deps": entry },
        peerSpec: "catalog:",
        linker: "isolated",
      });
      const result = await record(dir, "isolated");
      expect(result.fresh).toEndWith(isolatedNoDeps("1.0.0"));
      const keys = ["a-dep", "app", "lib", "no-deps", "one-fixed-dep"];
      expect(result).toEqual({
        keys,
        fresh: result.fresh,
        keysAfterReload: keys,
        reload: result.fresh,
        reloadSavedLockfile: false,
      });
    });
  });

  // Only the entry the spec names is `^2.0.0`; a `>=1.0.0` decoy or an unresolved peer would give dedupedKeys instead (pnpm: resolveFromCatalog.test.ts).
  describe.each([
    ["catalog:peers", { catalog: { "no-deps": ">=1.0.0" }, catalogs: { peers: { "no-deps": "^2.0.0" } } }],
    ["catalog:", { catalog: { "no-deps": "^2.0.0" }, catalogs: { peers: { "no-deps": ">=1.0.0" } } }],
    ["catalog:default", { catalog: { "no-deps": "^2.0.0" } }],
    ["catalog:", { catalogs: { default: { "no-deps": "^2.0.0" } } }],
    ["catalog:default", { catalogs: { default: { "no-deps": "^2.0.0" } } }],
    ["catalog:default", { catalog: { "no-deps": ">=1.0.0" }, catalogs: { default: { "no-deps": "^2.0.0" } } }],
    ["catalog:", { catalog: { "no-deps": "^2.0.0" }, catalogs: { default: { "no-deps": ">=1.0.0" } } }],
  ] as const)("peer %s resolves through the entry named by its spec (%o)", (peerSpec, catalogFields) => {
    test.concurrent("fresh and reload", async () => {
      const dir = await makeRepo({ ...catalogFields, peerSpec, linker: "hoisted" });
      expect(await record(dir, "hoisted")).toEqual({
        keys: nestedKeys,
        fresh: "nested:2.0.0",
        keysAfterReload: nestedKeys,
        reload: "nested:2.0.0",
        reloadSavedLockfile: false,
      });
    });
  });

  // pnpm errors here; Bun never fails an install over an unresolved peer, so the peer must simply not get a nested copy.
  describe.each([
    ["catalog:", { catalog: {} }],
    ["catalog:peers", { catalogs: { other: { "no-deps": ">=1.0.0" } } }],
    ["catalog:default", { catalogs: { other: { "no-deps": ">=1.0.0" } } }],
    ["catalog:", { catalog: { "no-deps": "catalog:other" }, catalogs: { other: { "no-deps": ">=1.0.0" } } }],
  ] as const)("peer %s with no usable catalog entry (%o)", (peerSpec, catalogFields) => {
    test.concurrent("installs without a nested copy and is stable on reload", async () => {
      const dir = await makeRepo({ ...catalogFields, peerSpec, linker: "hoisted" });
      expect(await record(dir, "hoisted")).toEqual({
        keys: dedupedKeys,
        fresh: "<hoisted>",
        keysAfterReload: dedupedKeys,
        reload: "<hoisted>",
        reloadSavedLockfile: false,
      });
    });
  });

  // pnpm #12159 shape: an override whose value is a catalog reference wins over the peer's own range, fresh and on reload.
  describe.each(linkers)("linker=%s", linker => {
    describe.each([
      [">=1.0.0", "catalog:", { catalog: { "no-deps": "1.0.0" } }],
      ["^2.0.0", "catalog:", { catalog: { "no-deps": "1.0.0" } }],
      ["catalog:", "catalog:", { catalog: { "no-deps": "1.0.0" } }],
      ["catalog:", "catalog:pins", { catalog: { "no-deps": ">=1.0.0" }, catalogs: { pins: { "no-deps": "1.0.0" } } }],
    ] as const)("peer %s overridden to %s", (peerSpec, override, catalogFields) => {
      test.concurrent("binds to the overriding catalog entry, fresh == reload", async () => {
        const dir = await makeRepo({ ...catalogFields, overrides: { "no-deps": override }, peerSpec, linker });
        const result = await record(dir, linker);
        const keys = ["app", "lib", "no-deps", "one-fixed-dep"];
        expect(result).toEqual({
          keys,
          fresh: linker === "isolated" ? expect.stringContaining(isolatedNoDeps("1.0.0")) : "<hoisted>",
          keysAfterReload: keys,
          reload: result.fresh,
          reloadSavedLockfile: false,
        });
        const { packages } = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as {
          packages: Record<string, [string, ...unknown[]]>;
        };
        expect(packages["no-deps"][0]).toBe("no-deps@1.0.0");
      });
    });
  });

  // pnpm #8996 (`catalog:` peers survive `pack` unsubstituted) and #7072 (`catalog:` / `catalog:default` are one catalog).
  describe.each([
    ["catalog:", { catalog: { "no-deps": ">=1.0.0" } }],
    ["catalog:peers", { catalogs: { peers: { "no-deps": ">=1.0.0" } } }],
    ["catalog:", { catalogs: { default: { "no-deps": ">=1.0.0" } } }],
    ["catalog:default", { catalog: { "no-deps": ">=1.0.0" } }],
  ] as const)("bun pm pack substitutes the %s peer (%o)", (peerSpec, catalogFields) => {
    test.concurrent("with the catalog's range", async () => {
      const dir = await makeRepo({ ...catalogFields, peerSpec, libVersion: "1.2.3", linker: "hoisted" });
      await install(dir, "hoisted");
      const libDir = join(dir, "packages", "lib");
      await pack(libDir, bunEnv);
      const tarball = readTarball(join(libDir, "lib-1.2.3.tgz"));
      const packageJson = tarball.entries.find(
        (entry: { pathname: string }) => entry.pathname === "package/package.json",
      );
      expect(JSON.parse(packageJson.contents)).toEqual({
        name: "lib",
        version: "1.2.3",
        peerDependencies: { "no-deps": ">=1.0.0" },
      });
    });
  });
});
