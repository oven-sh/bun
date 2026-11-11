import { file, spawn, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readlinkSync } from "fs";
import { exists, readdir, realpath, rm } from "fs/promises";
import { bunEnv, bunExe, normalizeBunSnapshot, pack, runBunInstall, tempDir } from "harness";
import { join } from "path";
import { installEnv, TestRegistry } from "registry";

var registry = new TestRegistry();

type Manifests = Record<string, Record<string, Record<string, Record<string, string>>>>;

// Registry packages that ship a raw `catalog:` specifier; the fixture registry has none.
const catalogManifests: Manifests = {
  "leaf": { "1.0.0": {}, "2.0.0": {} },
  "wants-leaf-peer": { "1.0.0": { peerDependencies: { leaf: "catalog:" } } },
  "wants-leaf-dep": { "1.0.0": { dependencies: { leaf: "catalog:" } } },
  "wants-leaf-optional": { "1.0.0": { optionalDependencies: { leaf: "catalog:" } } },
  "needs-leaf-2": { "1.0.0": { dependencies: { leaf: "2.0.0" } } },
  "no-deps": { "1.0.0": {}, "2.0.0": {} },
  "catalog-peer": {
    "1.0.0": { peerDependencies: { "no-deps": "catalog:" } },
    "2.0.0": { peerDependencies: { "no-deps": "catalog:peers" } },
  },
};

async function serveRegistry(manifests: Manifests) {
  const tarballs = new Map<string, Uint8Array>();
  for (const [name, versions] of Object.entries(manifests)) {
    for (const [version, extra] of Object.entries(versions)) {
      const archive = new Bun.Archive(
        { "package/package.json": JSON.stringify({ name, version, ...extra }) },
        { compress: "gzip" },
      );
      tarballs.set(`/${name}-${version}.tgz`, await archive.bytes());
    }
  }
  return Bun.serve({
    port: 0,
    fetch(request) {
      const { origin, pathname } = new URL(request.url);
      const tarball = tarballs.get(pathname);
      if (tarball) return new Response(tarball);
      const name = pathname.slice(1);
      const entry = manifests[name];
      if (!entry) return new Response("not found", { status: 404 });
      const versions: Record<string, unknown> = {};
      for (const [version, extra] of Object.entries(entry)) {
        versions[version] = { name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` }, ...extra };
      }
      const latest = Object.keys(entry).sort(Bun.semver.order).at(-1);
      return Response.json({ name, versions, "dist-tags": { latest } });
    },
  });
}

let catalogRegistry: Awaited<ReturnType<typeof serveRegistry>>;

function writeRegistryProject(files: Record<string, string>, registryUrl: string) {
  return tempDir("catalog-registry-", {
    ...files,
    "bunfig.toml": ({ root }) =>
      Bun.TOML.stringify({
        install: { cache: join(root, ".bun-cache"), registry: registryUrl, saveTextLockfile: true },
      }),
  });
}

beforeAll(async () => {
  [catalogRegistry] = await Promise.all([serveRegistry(catalogManifests), registry.start()]);
});

afterAll(() => {
  registry.stop();
  catalogRegistry.stop(true);
});

describe.concurrent("basic", () => {
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

      await runBunInstall(installEnv(packageDir), packageDir);

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "2.0.0",
      });

      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
        name: "a-dep",
        version: "1.0.1",
      });

      // another install does not save the lockfile
      await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    });
  }

  for (const binaryLockfile of [true, false]) {
    test(`detect changes (${binaryLockfile ? "bun.lockb" : "bun.lock"})`, async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { saveTextLockfile: !binaryLockfile, linker: "hoisted" },
      });
      const packageJson: any = await createBasicCatalogMonorepo(packageDir, "catalog-basic-2");
      let { err } = await runBunInstall(installEnv(packageDir), packageDir);
      expect(err).toContain("Saved lockfile");

      const initialLockfile = !binaryLockfile
        ? (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234")
        : undefined;

      if (!binaryLockfile) {
        expect(initialLockfile).toMatchInlineSnapshot(`
          "{
            "lockfileVersion": 2,
            "configVersion": 1,
            "workspaces": {
              "": {
                "name": "catalog-basic-2",
              },
              "packages/pkg1": {
                "name": "pkg1",
                "dependencies": {
                  "a-dep": "catalog:a",
                  "no-deps": "catalog:",
                },
              },
            },
            "catalog": {
              "no-deps": "2.0.0",
            },
            "catalogs": {
              "a": {
                "a-dep": "1.0.1",
              },
            },
            "packages": {
              "a-dep": ["a-dep@1.0.1", "http://localhost:1234/a-dep/-/a-dep-1.0.1.tgz", {}, "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg=="],

              "no-deps": ["no-deps@2.0.0", "http://localhost:1234/no-deps/-/no-deps-2.0.0.tgz", {}, "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g=="],

              "pkg1": ["pkg1@workspace:packages/pkg1"],
            }
          }
          "
        `);
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
      ({ err } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: true }));
      expect(err).toContain("Saved lockfile");

      if (!binaryLockfile) {
        const newLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
          /localhost:\d+/g,
          "localhost:1234",
        );

        expect(newLockfile).not.toEqual(initialLockfile);
        expect(newLockfile).toMatchInlineSnapshot(`
          "{
            "lockfileVersion": 2,
            "configVersion": 1,
            "workspaces": {
              "": {
                "name": "catalog-basic-2",
              },
              "packages/pkg1": {
                "name": "pkg1",
                "dependencies": {
                  "a-dep": "catalog:a",
                  "no-deps": "catalog:",
                },
              },
            },
            "catalog": {
              "no-deps": "1.0.0",
            },
            "catalogs": {
              "a": {
                "a-dep": "1.0.1",
              },
            },
            "packages": {
              "a-dep": ["a-dep@1.0.1", "http://localhost:1234/a-dep/-/a-dep-1.0.1.tgz", {}, "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg=="],

              "no-deps": ["no-deps@1.0.0", "http://localhost:1234/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw=="],

              "pkg1": ["pkg1@workspace:packages/pkg1"],
            }
          }
          "
        `);
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
      ({ err } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: true }));
      expect(err).toContain("Saved lockfile");

      if (!binaryLockfile) {
        const newLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
          /localhost:\d+/g,
          "localhost:1234",
        );

        expect(newLockfile).not.toEqual(initialLockfile);
        expect(newLockfile).toMatchInlineSnapshot(`
          "{
            "lockfileVersion": 2,
            "configVersion": 1,
            "workspaces": {
              "": {
                "name": "catalog-basic-2",
              },
              "packages/pkg1": {
                "name": "pkg1",
                "dependencies": {
                  "a-dep": "catalog:a",
                  "no-deps": "catalog:",
                },
              },
            },
            "catalog": {
              "no-deps": "1.0.0",
            },
            "catalogs": {
              "a": {
                "a-dep": "1.0.10",
              },
            },
            "packages": {
              "a-dep": ["a-dep@1.0.10", "http://localhost:1234/a-dep/-/a-dep-1.0.10.tgz", {}, "sha512-NeQ6Ql9jRW8V+VOiVb+PSQAYOvVoSimW+tXaR0CoJk4kM9RIk/XlAUGCsNtn5XqjlDO4hcH8NcyaL507InevEg=="],

              "no-deps": ["no-deps@1.0.0", "http://localhost:1234/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw=="],

              "pkg1": ["pkg1@workspace:packages/pkg1"],
            }
          }
          "
        `);
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

    await runBunInstall(installEnv(packageDir), packageDir);
    expect((await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).version).toBe("1.0.0");

    await write(pkg1Path, JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:b" } }));
    await runBunInstall(installEnv(packageDir), packageDir);

    expect((await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).version).toBe("2.0.0");
    const lock = Bun.JSONC.parse(await file(join(packageDir, "bun.lock")).text()) as any;
    expect(lock.workspaces["packages/pkg1"].dependencies).toStrictEqual({ "no-deps": "catalog:b" });
    expect(Object.keys(lock.packages)).toStrictEqual(["no-deps", "pkg1"]);
    expect(lock.packages["no-deps"][0]).toBe("no-deps@2.0.0");

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
  });

  // A file: path outside the project is only accepted on a row the root (or a workspace) owns. A catalog change
  // re-resolves every catalog: row; the rows the root was loaded with have been replaced by then and belong to
  // nobody, so re-resolving them fails the way an escaping transitive file: dependency does.
  test.concurrent("changing the entry of a catalog: dependency pointing outside the project", async () => {
    const packageJson = (xPath: string) =>
      JSON.stringify({
        name: "catalog-file-dep",
        workspaces: { packages: [], catalog: { x: xPath } },
        dependencies: { x: "catalog:" },
      });
    using dir = tempDir("catalog-file-dep", {
      "x/package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      "x2/package.json": JSON.stringify({ name: "x", version: "2.0.0" }),
      "project/package.json": packageJson("file:../x"),
    });
    const packageDir = join(String(dir), "project");
    const installedVersion = async () =>
      (await file(join(packageDir, "node_modules", "x", "package.json")).json()).version;

    await runBunInstall(installEnv(packageDir), packageDir);
    expect(await installedVersion()).toBe("1.0.0");

    await write(join(packageDir, "package.json"), packageJson("file:../x2"));
    await runBunInstall(installEnv(packageDir), packageDir);
    expect(await installedVersion()).toBe("2.0.0");
    expect(normalizeBunSnapshot(await file(join(packageDir, "bun.lock")).text(), packageDir)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "catalog-file-dep",
            "dependencies": {
              "x": "catalog:",
            },
          },
        },
        "catalog": {
          "x": "file:../x2",
        },
        "packages": {
          "x": ["x@file:../x2", {}],
        }
      }"
    `);
    await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
  });

  // The registry also has a `no-deps` package. `leaf` is a catalog entry that the workspace itself uses.
  test.concurrent.each([
    ["hoisted", "*", ["install"]],
    ["isolated", "*", ["install"]],
    ["hoisted", "*", ["update", "no-deps"]],
    ["isolated", "^0.1.0", ["update", "no-deps"]],
    ["hoisted", "^0.1.0", ["update", "--latest", "no-deps"]],
  ])(
    "a catalog: dependency still links to a workspace after another catalog entry changes (%s, %j, bun %j)",
    async (linker, range, command) => {
      const packageJson = (leaf: string) =>
        JSON.stringify({ name: "mono", workspaces: { packages: ["packages/*"], catalog: { "no-deps": range, leaf } } });
      using dir = writeRegistryProject(
        {
          "package.json": packageJson("1.0.0"),
          "packages/web/package.json": JSON.stringify({
            name: "web",
            dependencies: { "no-deps": "catalog:", leaf: "catalog:" },
          }),
          "packages/no-deps/package.json": JSON.stringify({
            name: "no-deps",
            version: "0.1.0",
            dependencies: { leaf: "catalog:" },
          }),
        },
        catalogRegistry.url.href,
      );
      const packageDir = String(dir);
      const linked = () =>
        realpath(join(packageDir, "packages", "web", "node_modules", "no-deps")).catch(() =>
          realpath(join(packageDir, "node_modules", "no-deps")),
        );
      const run = async (command: string[]) => {
        await using proc = spawn({
          cmd: [bunExe(), ...command, "--linker", linker],
          cwd: packageDir,
          env: bunEnv,
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("error:");
        expect(await linked()).toBe(await realpath(join(packageDir, "packages", "no-deps")));
        expect(exitCode).toBe(0);
      };

      await run(["install"]);
      await write(join(packageDir, "package.json"), packageJson("2.0.0"));
      await run(command);
    },
  );

  test.concurrent("catalog and catalogs.default may split different packages between them", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "catalog-split-default",
          workspaces: {
            catalog: { "no-deps": "1.0.0" },
            catalogs: { default: { "a-dep": "1.0.1" } },
          },
          dependencies: { "no-deps": "catalog:default", "a-dep": "catalog:" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect((await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).version).toBe("1.0.0");
    expect((await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).version).toBe("1.0.1");

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
  });
});

describe.concurrent("update", () => {
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
      // The project's cache, also when `cwd` is one of its members.
      env: installEnv(cwd.replace(/[\\/]packages[\\/]\w+$/, "")),
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
      await runBunInstall(installEnv(packageDir), packageDir);

      const { out, err, exitCode } = await runUpdate(packageDir, ...flags);
      expect(err).not.toContain("error:");

      // The moved entry is reported like a direct dependency of the root, even though only pkg1 depends on it.
      // a-dep still resolves to 1.0.10 (only its literal changes), so it gets no row.
      expect(out.match(/^.*no-deps.*$/gm)).toStrictEqual(["^ no-deps 1.1.0 -> 2.0.0"]);
      expect(out.match(/^.*a-dep.*$/gm)).toBeNull();

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
    await runBunInstall(installEnv(packageDir), packageDir);

    const update = await runUpdate(packageDir, "--latest");
    expect(update.err).not.toContain("error:");
    expect(update.exitCode).toBe(0);
    expect((await file(join(packageDir, "package.json")).json()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: installEnv(packageDir),
    });
    const [, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("lockfile had changes");
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("--latest run from inside a workspace package updates the root catalog", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-in-workspace");
    await runBunInstall(installEnv(packageDir), packageDir);

    const { out, err, exitCode } = await runUpdate(join(packageDir, "packages", "pkg1"), "--latest");
    expect(err).not.toContain("error:");

    // pkg1's own `catalog:` row is an update row, not a `+ no-deps@2.0.0` install row.
    expect(out.match(/^.*no-deps.*$/gm)).toStrictEqual(["^ no-deps 1.1.0 -> 2.0.0"]);

    const root = await file(join(packageDir, "package.json")).json();
    expect(root.workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(root.workspaces.catalogs).toEqual({ a: { "a-dep": "~1.0.10" } });

    expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
      "no-deps": "catalog:",
      "a-dep": "catalog:a",
    });
    expect(exitCode).toBe(0);
  });

  test("--latest reports a catalog entry the root itself depends on once", async () => {
    const { packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "catalog-update-root-consumer",
          workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^1.0.0" } },
          dependencies: { "no-deps": "catalog:" },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:" } }),
      ),
    ]);
    await runBunInstall(installEnv(packageDir), packageDir);

    const { out, err, exitCode } = await runUpdate(packageDir, "--latest");
    expect(err).not.toContain("error:");
    expect(out.match(/^.*no-deps.*$/gm)).toStrictEqual(["^ no-deps 1.1.0 -> 2.0.0"]);

    const root = await file(join(packageDir, "package.json")).json();
    expect(root.workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(root.dependencies).toEqual({ "no-deps": "catalog:" });
    expect(exitCode).toBe(0);
  });

  test("--latest --verbose reports a catalog entry once, under the workspace that depends on it", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-verbose");
    await runBunInstall(installEnv(packageDir), packageDir);

    const { out, err, exitCode } = await runUpdate(packageDir, "--latest", "--verbose");
    expect(err).not.toContain("error:");
    const lines = out.split(/\r?\n/);
    expect(lines.filter(line => line.includes("no-deps"))).toStrictEqual(["^ no-deps 1.1.0 -> 2.0.0"]);
    expect(lines[lines.indexOf("pkg1:") + 1]).toBe("^ no-deps 1.1.0 -> 2.0.0");
    expect(exitCode).toBe(0);
  });

  test("--latest reports a catalog entry whose new version needs no install (isolated store already has it)", async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await createUpdateMonorepo(packageDir, "catalog-update-isolated-rerun");
    await runBunInstall(installEnv(packageDir), packageDir);
    const rootBefore = await file(join(packageDir, "package.json")).text();
    const lockBefore = await file(join(packageDir, "bun.lock")).text();

    const first = await runUpdate(packageDir, "--latest");
    expect(first.err).not.toContain("error:");
    expect(first.out.match(/^.*no-deps.*$/gm)).toStrictEqual(["^ no-deps 1.1.0 -> 2.0.0"]);
    expect(first.exitCode).toBe(0);

    // Like `git checkout .` followed by `bun install`: the project is back on 1.1.0 while node_modules/.bun keeps no-deps@2.0.0.
    await Promise.all([
      write(join(packageDir, "package.json"), rootBefore),
      write(join(packageDir, "bun.lock"), lockBefore),
    ]);
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    const second = await runUpdate(packageDir, "--latest");
    expect(second.err).not.toContain("error:");
    expect(second.out.match(/^.*no-deps.*$/gm)).toStrictEqual(["^ no-deps 1.1.0 -> 2.0.0"]);
    expect((await file(join(packageDir, "package.json")).json()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(second.exitCode).toBe(0);
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
    await runBunInstall(installEnv(packageDir), packageDir);

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

  test("update reports the catalog entry that moved, not another entry for the same name", async () => {
    // The default catalog pins no-deps@2.0.0 exactly; `catalogs.old` allows ^1.0.0 and the lockfile has it at 1.0.0 (as if 1.1.0 was published after install).
    const { packageDir } = await registry.createTestDir();
    const url = registry.registryUrl();
    const lockfile = {
      lockfileVersion: 2,
      configVersion: 1,
      workspaces: {
        "": { name: "catalog-update-two-entries" },
        "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
        "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:old" } },
      },
      catalog: { "no-deps": "2.0.0" },
      catalogs: { old: { "no-deps": "^1.0.0" } },
      packages: {
        "no-deps": [
          "no-deps@2.0.0",
          `${url}no-deps/-/no-deps-2.0.0.tgz`,
          {},
          "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g==",
        ],
        "pkg1": ["pkg1@workspace:packages/pkg1"],
        "pkg2": ["pkg2@workspace:packages/pkg2"],
        "pkg2/no-deps": [
          "no-deps@1.0.0",
          `${url}no-deps/-/no-deps-1.0.0.tgz`,
          {},
          "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
        ],
      },
    };
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "catalog-update-two-entries",
          workspaces: {
            packages: ["packages/*"],
            catalog: { "no-deps": "2.0.0" },
            catalogs: { old: { "no-deps": "^1.0.0" } },
          },
        }),
      ),
      write(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify(lockfile.workspaces["packages/pkg1"])),
      write(join(packageDir, "packages", "pkg2", "package.json"), JSON.stringify(lockfile.workspaces["packages/pkg2"])),
      write(join(packageDir, "bun.lock"), JSON.stringify(lockfile)),
    ]);

    const { out, err, exitCode } = await runUpdate(packageDir);
    expect(err).not.toContain("error:");
    // Only the `old` entry moved, and the row says so; the default entry stays at 2.0.0 without a row.
    expect(out.match(/^.*no-deps.*$/gm)).toStrictEqual(["^ no-deps 1.0.0 -> 1.1.0 (v2.0.0 available)"]);

    const root = await file(join(packageDir, "package.json")).json();
    expect(root.workspaces.catalog).toEqual({ "no-deps": "2.0.0" });
    expect(root.workspaces.catalogs).toEqual({ old: { "no-deps": "^1.1.0" } });
    const lock = await file(join(packageDir, "bun.lock")).text();
    expect(lock).toContain("no-deps@2.0.0");
    expect(lock).toContain("no-deps@1.1.0");
    expect(lock).not.toContain("no-deps@1.0.0");
    expect(exitCode).toBe(0);
  });

  test("update reports a catalog entry once when a transitive dependency moves with it", async () => {
    const { packageDir } = await registry.createTestDir();
    const url = registry.registryUrl();
    const pkg1 = { name: "pkg1", dependencies: { "no-deps": "catalog:", "one-range-dep": "1.0.0" } };
    const catalog = { "no-deps": "^1.0.0" };
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "catalog-update-transitive", workspaces: { packages: ["packages/*"], catalog } }),
      ),
      write(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify(pkg1)),
      write(
        join(packageDir, "bun.lock"),
        JSON.stringify({
          lockfileVersion: 2,
          configVersion: 1,
          workspaces: { "": { name: "catalog-update-transitive" }, "packages/pkg1": pkg1 },
          catalog,
          packages: {
            "no-deps": [
              "no-deps@1.0.0",
              `${url}no-deps/-/no-deps-1.0.0.tgz`,
              {},
              "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
            ],
            "one-range-dep": [
              "one-range-dep@1.0.0",
              `${url}one-range-dep/-/one-range-dep-1.0.0.tgz`,
              { dependencies: { "no-deps": "^1.0.0" } },
              "sha512-vHHfVxmeKiXLeOtrPjoDbzSGJVrwfqy8HHC50miwrQTabA1eFkRUWfIQ1E5pOloPpti7HSTocPg809DBNV6x0Q==",
            ],
            "pkg1": ["pkg1@workspace:packages/pkg1"],
          },
        }),
      ),
    ]);

    const { out, err, exitCode } = await runUpdate(packageDir);
    expect(err).not.toContain("error:");
    expect(out.match(/^.*no-deps.*$/gm)).toStrictEqual(["^ no-deps 1.0.0 -> 1.1.0 (v2.0.0 available)"]);
    expect(exitCode).toBe(0);
  });

  for (const fromWorkspace of [false, true]) {
    test(`--latest --dry-run does not modify any package.json (from ${fromWorkspace ? "workspace" : "root"})`, async () => {
      const { packageDir } = await registry.createTestDir();
      await createUpdateMonorepo(packageDir, `catalog-update-dry-run-${fromWorkspace ? "ws" : "root"}`);
      await runBunInstall(installEnv(packageDir), packageDir);

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

      const { out, err, exitCode } = await runUpdate(packageDir, ...args);
      expect(err).not.toContain("error:");
      expect(out.match(/^.*no-deps.*$/gm)).toStrictEqual(["^ no-deps 1.0.0 -> 1.1.0 (v2.0.0 available)"]);

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
    await runBunInstall(installEnv(packageDir), packageDir);

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
    await runBunInstall(installEnv(packageDir), packageDir);

    const { err, exitCode } = await runUpdate(join(packageDir, "packages", "pkg1"), "no-deps", "--latest");
    expect(err).not.toContain("error:");

    expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
      "no-deps": "catalog:",
      "a-dep": "catalog:a",
    });
    expect(exitCode).toBe(0);
  });

  test("--latest keeps the npm: alias prefix and pin style of aliased catalog entries", async () => {
    const { packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "catalog-update-alias",
          workspaces: {
            packages: ["packages/*"],
            catalog: { aliased: "npm:no-deps@^1.0.0" },
            catalogs: { pinned: { aliased: "npm:no-deps@1.0.1" } },
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({ name: "pkg1", dependencies: { aliased: "catalog:" } }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({ name: "pkg2", dependencies: { aliased: "catalog:pinned" } }),
      ),
    ]);
    await runBunInstall(installEnv(packageDir), packageDir);

    const { err, exitCode } = await runUpdate(packageDir, "--latest");
    expect(err).not.toContain("error:");

    const { workspaces } = await file(join(packageDir, "package.json")).json();
    expect(workspaces.catalog).toEqual({ aliased: "npm:no-deps@^2.0.0" });
    expect(workspaces.catalogs).toEqual({ pinned: { aliased: "npm:no-deps@2.0.0" } });
    expect(exitCode).toBe(0);
  });

  // Leading whitespace in a version literal is ignored by the installer, so `bun update` has to
  // treat these entries exactly like their trimmed counterparts above.
  for (const [flags, expected] of [
    [[], { "no-deps": "^1.1.0", "aliased-dep": "npm:no-deps@~1.0.1" }],
    [["--latest"], { "no-deps": "^2.0.0", "aliased-dep": "npm:no-deps@~2.0.0" }],
  ] as const) {
    test(`update ${flags.join(" ") || "(no args)"} updates catalog entries with leading whitespace`, async () => {
      const { packageDir } = await registry.createTestDir();
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "catalog-update-whitespace",
            workspaces: {
              packages: ["packages/*"],
              catalog: {
                "no-deps": " ^1.0.0",
                "aliased-dep": "\tnpm:no-deps@~1.0.0",
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
              "aliased-dep": "catalog:",
            },
          }),
        ),
      ]);
      await runBunInstall(installEnv(packageDir), packageDir);

      const { err, exitCode } = await runUpdate(packageDir, ...flags);
      expect(err).not.toContain("error:");

      expect((await file(join(packageDir, "package.json")).json()).workspaces.catalog).toEqual(expected);
      expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
        "no-deps": "catalog:",
        "aliased-dep": "catalog:",
      });
      expect(exitCode).toBe(0);
    });
  }

  for (const flags of [[], ["--latest"]] as const) {
    test(`update <pkg>${flags.length ? ` ${flags.join(" ")}` : ""} keeps a catalog reference with leading whitespace`, async () => {
      const { packageDir } = await registry.createTestDir();
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "catalog-reference-whitespace",
            workspaces: {
              packages: ["packages/*"],
              catalog: {
                "no-deps": "^1.0.0",
              },
            },
          }),
        ),
        write(
          join(packageDir, "packages", "pkg1", "package.json"),
          JSON.stringify({
            name: "pkg1",
            dependencies: {
              "no-deps": " catalog:",
            },
          }),
        ),
      ]);
      await runBunInstall(installEnv(packageDir), packageDir);

      const { err, exitCode } = await runUpdate(join(packageDir, "packages", "pkg1"), "no-deps", ...flags);
      expect(err).not.toContain("error:");

      expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
        "no-deps": " catalog:",
      });
      expect((await file(join(packageDir, "package.json")).json()).workspaces.catalog).toEqual({
        "no-deps": "^1.0.0",
      });
      expect(exitCode).toBe(0);
    });
  }
});

describe.concurrent("pack", () => {
  test("replaces a catalog: reference with leading whitespace", async () => {
    const { packageDir } = await registry.createTestDir();
    const pkg1Dir = join(packageDir, "packages", "pkg1");
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "catalog-pack-whitespace",
          workspaces: {
            packages: ["packages/*"],
            catalog: {
              "no-deps": "^1.0.0",
            },
          },
        }),
      ),
      write(
        join(pkg1Dir, "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          dependencies: {
            "no-deps": " catalog:",
          },
        }),
      ),
    ]);
    await runBunInstall(installEnv(packageDir), packageDir);

    await pack(pkg1Dir, bunEnv);

    const tarball = readTarball(join(pkg1Dir, "pkg1-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([{ pathname: "package/package.json" }]);
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "pkg1",
      version: "1.0.0",
      dependencies: {
        "no-deps": "^1.0.0",
      },
    });
  });

  function appWithLibFromCatalog(catalogs: object) {
    return tempDir("catalog-pack", {
      "package.json": JSON.stringify({ name: "root", workspaces: { packages: ["packages/*"], ...catalogs } }),
      "packages/lib/package.json": JSON.stringify({ name: "lib", version: "2.3.4" }),
      "packages/app/package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { lib: "catalog:" } }),
    });
  }

  test.each([
    ["workspace:^", "^2.3.4"],
    ["workspace:*", "2.3.4"],
    ["workspace:../lib", "2.3.4"],
  ])("publishes the catalog entry %s as %s", async (entry, published) => {
    using dir = appWithLibFromCatalog({ catalog: { lib: entry } });
    const appDir = join(String(dir), "packages", "app");

    await pack(appDir, bunEnv);

    const tarball = readTarball(join(appDir, "app-1.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "app",
      version: "1.0.0",
      dependencies: { lib: published },
    });
  });

  test("fails on a catalog entry that refers to another catalog", async () => {
    using dir = appWithLibFromCatalog({ catalog: { lib: "catalog:g" }, catalogs: { g: { lib: "^2" } } });
    const appDir = join(String(dir), "packages", "app");

    await using proc = spawn({
      cmd: [bunExe(), "pm", "pack"],
      cwd: appDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(err, dir)).toBe(
      'error: Failed to resolve catalog version for "lib" in `dependencies` (catalog entry refers to another catalog).',
    );
    expect(exitCode).toBe(1);
    expect(existsSync(join(appDir, "app-1.0.0.tgz"))).toBeFalse();
  });
});

describe.concurrent("errors", () => {
  async function failingInstall(cwd: string) {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: installEnv(cwd),
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { err, exitCode };
  }

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

    const { err, exitCode } = await failingInstall(packageDir);
    expect(err).toContain(
      'error: a-dep@catalog:aaaaaaaaaaaaaaaaa: there is no catalog named "aaaaaaaaaaaaaaaaa" in the root package.json\n',
    );
    expect(err).toContain("error: no-deps@catalog: not in catalog\n  bun add --catalog no-deps\n");
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("a package missing from an existing named catalog suggests bun add --catalog=<name>", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "catalog-error-3",
          workspaces: {
            catalog: { "a-dep": "1.0.1" },
            catalogs: { tools: { "a-dep": "1.0.1" } },
          },
          dependencies: {
            "no-deps": "catalog:tools",
            "left-pad": "catalog:default",
          },
        }),
      },
    });

    const { err, exitCode } = await failingInstall(packageDir);
    expect(err).toContain('error: no-deps@catalog:tools not in catalog "tools"\n  bun add --catalog=tools no-deps\n');
    expect(err).toContain("error: left-pad@catalog:default not in catalog\n  bun add --catalog left-pad\n");
    expect(err).not.toContain("there is no catalog named");
    expect(exitCode).not.toBe(0);
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

    const { err, exitCode } = await failingInstall(packageDir);
    expect(err).toContain("error: Invalid dependency version\n");
    expect(err).toContain("error: no-deps@catalog: not in catalog\n  bun add --catalog no-deps\n");
    expect(exitCode).not.toBe(0);
  });

  function rootWithDuplicateDefault(placement: "workspaces" | "top-level", definitions: object, dependencies: object) {
    return JSON.stringify(
      placement === "workspaces"
        ? { name: "catalog-duplicate-default", workspaces: { packages: [], ...definitions }, dependencies }
        : { name: "catalog-duplicate-default", ...definitions, workspaces: [], dependencies },
    );
  }

  for (const placement of ["workspaces", "top-level"] as const) {
    test.concurrent(`the same package in both catalog and catalogs.default is rejected (${placement})`, async () => {
      const { packageDir } = await registry.createTestDir({
        files: {
          "package.json": rootWithDuplicateDefault(
            placement,
            { catalog: { "no-deps": "1.0.0" }, catalogs: { default: { "no-deps": "2.0.0" } } },
            { "no-deps": "catalog:" },
          ),
        },
      });

      const { err, exitCode } = await failingInstall(packageDir);
      expect(err).toContain('error: "no-deps" is defined in both "catalog" and "catalogs.default"; keep one of them');
      expect(exitCode).not.toBe(0);
      expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeFalse();
    });
  }

  test.concurrent("every package in both catalog and catalogs.default is reported", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": rootWithDuplicateDefault(
          "workspaces",
          {
            catalog: { "no-deps": "1.0.0", "a-dep": "1.0.1" },
            catalogs: { default: { "no-deps": "2.0.0", "a-dep": "1.0.10" } },
          },
          { "no-deps": "catalog:", "a-dep": "catalog:" },
        ),
      },
    });

    const { err, exitCode } = await failingInstall(packageDir);
    expect(err).toContain('error: "no-deps" is defined in both "catalog" and "catalogs.default"; keep one of them');
    expect(err).toContain('error: "a-dep" is defined in both "catalog" and "catalogs.default"; keep one of them');
    expect(exitCode).not.toBe(0);
    expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  // pnpm: deps-installer/test/catalogs.ts "external dependency using catalog protocol errors"
  test.concurrent("a catalog: dependency inside a registry package fails to resolve", async () => {
    using dir = writeRegistryProject(
      {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: { catalog: { leaf: "^2.0.0" } },
          dependencies: { "wants-leaf-dep": "1.0.0" },
        }),
      },
      catalogRegistry.url.href,
    );

    const { err, exitCode } = await failingInstall(String(dir));
    expect(err).toContain("leaf@catalog: failed to resolve");
    expect(exitCode).not.toBe(0);
    expect(await exists(join(String(dir), "bun.lock"))).toBeFalse();
  });

  test.concurrent(
    "a catalog: dependency inside a file: folder dependency fails to resolve, the same package as a workspace works",
    async () => {
      const localLib = JSON.stringify({ name: "local-lib", dependencies: { "no-deps": "catalog:" } });
      const [folder, workspace] = await Promise.all([
        registry.createTestDir({
          bunfigOpts: { linker: "hoisted" },
          files: {
            "package.json": JSON.stringify({
              name: "root",
              workspaces: { catalog: { "no-deps": "^1.0.0" } },
              dependencies: { "local-lib": "file:./local-lib" },
            }),
            "local-lib/package.json": localLib,
          },
        }),
        registry.createTestDir({
          bunfigOpts: { linker: "hoisted" },
          files: {
            "package.json": JSON.stringify({
              name: "root",
              workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^1.0.0" } },
            }),
            "packages/local-lib/package.json": localLib,
          },
        }),
      ]);

      const { err, exitCode } = await failingInstall(folder.packageDir);
      expect(err).toContain("no-deps@catalog: failed to resolve");
      expect(exitCode).not.toBe(0);

      await runBunInstall(installEnv(workspace.packageDir), workspace.packageDir);
      expect((await file(join(workspace.packageDir, "node_modules", "no-deps", "package.json")).json()).version).toBe(
        "1.1.0",
      );
    },
  );
});

describe("optionalDependencies", () => {
  type Linker = "hoisted" | "isolated";
  type Lockfile = {
    workspaces: Record<string, Record<string, unknown>>;
    packages: Record<string, unknown[]>;
  };

  async function spawnInstall(dir: string, linker: Linker, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker", linker, ...args],
      cwd: dir,
      env: installEnv(dir),
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

  async function readLockfile(dir: string): Promise<Lockfile> {
    return Bun.JSONC.parse(await file(join(dir, "bun.lock")).text()) as Lockfile;
  }

  async function installedVersion(dir: string, name: string) {
    return (await file(join(dir, "node_modules", name, "package.json")).json()).version;
  }

  describe.each(["hoisted", "isolated"] as const)("linker=%s", linker => {
    test.concurrent("catalog: in the root's and a workspace's optionalDependencies resolves", async () => {
      const { packageDir: dir } = await registry.createTestDir({
        bunfigOpts: { linker },
        files: {
          "package.json": JSON.stringify({
            name: "root",
            workspaces: {
              packages: ["packages/*"],
              catalog: { "no-deps": "2.0.0" },
              catalogs: { a: { "a-dep": "1.0.1" } },
            },
            optionalDependencies: { "no-deps": "catalog:" },
          }),
          "packages/pkg1/package.json": JSON.stringify({
            name: "pkg1",
            optionalDependencies: { "a-dep": "catalog:a" },
          }),
        },
      });

      const first = await install(dir, linker);
      expect(first.err).toContain("Saved lockfile");
      expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
      const aDepOwner = linker === "isolated" ? join(dir, "packages", "pkg1") : dir;
      expect(await installedVersion(aDepOwner, "a-dep")).toBe("1.0.1");

      const lockfile = await readLockfile(dir);
      expect(lockfile.workspaces[""]).toStrictEqual({
        name: "root",
        optionalDependencies: { "no-deps": "catalog:" },
      });
      expect(lockfile.workspaces["packages/pkg1"]).toStrictEqual({
        name: "pkg1",
        optionalDependencies: { "a-dep": "catalog:a" },
      });
      expect(Object.keys(lockfile.packages).sort()).toStrictEqual(["a-dep", "no-deps", "pkg1"]);
      expect(lockfile.packages["no-deps"][0]).toBe("no-deps@2.0.0");
      expect(lockfile.packages["a-dep"][0]).toBe("a-dep@1.0.1");

      const lockfileText = await file(join(dir, "bun.lock")).text();
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      const warm = await install(dir, linker);
      expect(warm.err).not.toContain("Saved lockfile");
      expect(await file(join(dir, "bun.lock")).text()).toBe(lockfileText);
      expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
      const frozen = await install(dir, linker, "--frozen-lockfile");
      expect(frozen.err).not.toContain("lockfile had changes");
    });

    // The registry package's optional `catalog:` edge is stripped to unresolvable instead of reading the consumer's catalog, and stays that way when bun.lock is reloaded.
    test.concurrent("a registry package's optional catalog: dependency is skipped, fresh and on reload", async () => {
      using dir = writeRegistryProject(
        {
          "package.json": JSON.stringify({
            name: "root",
            workspaces: { catalog: { leaf: "^2.0.0" } },
            dependencies: { "wants-leaf-optional": "1.0.0" },
          }),
        },
        catalogRegistry.url.href,
      );
      const root = String(dir);
      const expectLayout = async () => {
        expect(await installedVersion(root, "wants-leaf-optional")).toBe("1.0.0");
        expect(existsSync(join(root, "node_modules", "leaf"))).toBeFalse();
        const lockfile = await readLockfile(root);
        expect(Object.keys(lockfile.packages)).toStrictEqual(["wants-leaf-optional"]);
        expect(lockfile.packages["wants-leaf-optional"]).toStrictEqual([
          "wants-leaf-optional@1.0.0",
          expect.stringMatching(/^http:\/\/.*\/wants-leaf-optional-1\.0\.0\.tgz$/),
          { optionalDependencies: { leaf: "catalog:" } },
          expect.any(String),
        ]);
      };

      const first = await install(root, linker);
      expect(first.err).toContain("Saved lockfile");
      await expectLayout();
      const lockfileText = await file(join(root, "bun.lock")).text();

      await rm(join(root, "node_modules"), { recursive: true, force: true });
      const warm = await install(root, linker);
      expect(warm.err).not.toContain("Saved lockfile");
      expect(await file(join(root, "bun.lock")).text()).toBe(lockfileText);
      await expectLayout();

      await rm(join(root, "node_modules"), { recursive: true, force: true });
      const frozen = await install(root, linker, "--frozen-lockfile");
      expect(frozen.err).not.toContain("lockfile had changes");
      expect(await file(join(root, "bun.lock")).text()).toBe(lockfileText);
      await expectLayout();
    });
  });
});

describe("peer dependencies", () => {
  type Linker = "hoisted" | "isolated";

  async function spawnInstall(dir: string, linker: Linker, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--linker", linker, ...args],
      cwd: dir,
      env: installEnv(dir),
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
    registry?: string;
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
    if (opts.registry) {
      await Bun.write(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: join(packageDir, ".bun-cache"),
            registry: opts.registry,
            linker: opts.linker,
            saveTextLockfile: opts.saveTextLockfile,
          },
        }),
      );
    }
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
    expect(await packageKeys(dir)).toStrictEqual(dedupedKeys);
    expect(existsSync(join(dir, "packages", "lib", "node_modules", "no-deps"))).toBeFalse();
  });

  test.concurrent("named catalog peer (catalog:peers) dedupes the same way", async () => {
    const dir = await makeRepo({
      catalogs: { peers: { "no-deps": ">=1.0.0" } },
      peerSpec: "catalog:peers",
      linker: "hoisted",
    });
    await install(dir, "hoisted");
    expect(await packageKeys(dir)).toStrictEqual(dedupedKeys);
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
    expect(await packageKeys(dir)).toStrictEqual(dedupedKeys);
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
    expect(await packageKeys(dir)).toStrictEqual(["@scoped/has-bin-entry", "app", "lib"]);
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
        expect(fromInline.keys).toStrictEqual(expectedKeys);
        expect(fromInline.keysAfterReload).toStrictEqual(expectedKeys);
        expect(fromInline.reloadSavedLockfile).toBeFalse();
        if (linker === "isolated") {
          expect(fromInline.fresh).toEndWith(isolatedNoDeps2);
          expect(fromInline.reload).toEndWith(isolatedNoDeps2);
        } else {
          const expectedLayout = outcome === "dedupes" ? "<hoisted>" : "nested:2.0.0";
          expect(fromInline.fresh).toBe(expectedLayout);
          expect(fromInline.reload).toBe(expectedLayout);
        }

        expect(fromCatalog).toStrictEqual(fromInline);
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
      expect(fromInline.keys).toStrictEqual(dedupedKeys);
      expect(fromInline.keysAfterReload).toStrictEqual(dedupedKeys);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toStrictEqual(fromInline);
    });

    test.concurrent("aliased catalog entry peer matches the inline alias", async () => {
      const [catalogDir, inlineDir] = await Promise.all([
        makeRepo({ catalog: { "no-deps": "npm:no-deps@>=1.0.0" }, peerSpec: "catalog:", linker }),
        makeRepo({ peerSpec: "npm:no-deps@>=1.0.0", linker }),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
      expect(fromInline.keysAfterReload).toStrictEqual(fromInline.keys);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toStrictEqual(fromInline);
    });

    test.concurrent("optional catalog peer matches the inline optional peer on reload", async () => {
      const [catalogDir, inlineDir] = await Promise.all([
        makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", optionalPeer: true, linker }),
        makeRepo({ peerSpec: ">=1.0.0", optionalPeer: true, linker }),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
      expect(fromInline.keys).toStrictEqual(dedupedKeys);
      expect(fromInline.keysAfterReload).toStrictEqual(dedupedKeys);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toStrictEqual(fromInline);
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
        expect(fromInline.keys).toStrictEqual(["app", "app2", "app2/no-deps", "lib", "no-deps"]);
        expect(fromInline.keysAfterReload).toStrictEqual(fromInline.keys);
        expect(fromInline.reloadSavedLockfile).toBeFalse();
        expect(fromCatalog).toStrictEqual(fromInline);
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
    expect(await packageKeys(dir)).toStrictEqual(dedupedKeys);

    await rewriteRootPackageJson(dir, { catalog: { "no-deps": "^2.0.0" } });
    let { err } = await install(dir, "hoisted");
    expect(err).toContain("Saved lockfile");
    expect(await packageKeys(dir)).toStrictEqual(nestedKeys);
    expect(await layout(dir)).toBe("nested:2.0.0");

    await rewriteRootPackageJson(dir, { catalog: { "no-deps": ">=1.0.0" } });
    ({ err } = await install(dir, "hoisted"));
    expect(err).toContain("Saved lockfile");
    expect(await packageKeys(dir)).toStrictEqual(dedupedKeys);
  });

  // When the catalog changes, every row declared through it is re-resolved. The root's rows from bun.lock have
  // been replaced by then and belong to no package; re-resolving them too bound the peer a second time (once to
  // the stale copy, with an "incorrect peer dependency" warning). The peer moves to a version its new range
  // accepts, once, without a warning.
  describe("a root peer whose catalog range stops matching the installed version is re-resolved once", () => {
    const peerWarning = 'warn: incorrect peer dependency "no-deps@1.0.0"';
    const peerWarnings = (err: string) => err.split(peerWarning).length - 1;

    function rootWithPeer(peerSpec: string, fields: Record<string, unknown> = {}) {
      return JSON.stringify({ name: "root", peerDependencies: { "no-deps": peerSpec }, ...fields });
    }

    async function installedAlone(packageJson: string) {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": packageJson },
      });
      const { err } = await install(packageDir, "hoisted", "--verbose");
      expect(peerWarnings(err)).toBe(0);
      expect((await Bun.file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).version).toBe(
        "1.0.0",
      );
      return packageDir;
    }

    /** The version the peer moved to; no warning may be printed on the way. */
    async function reinstall(dir: string, packageJson: string) {
      await Bun.write(join(dir, "package.json"), packageJson);
      const { err } = await install(dir, "hoisted", "--verbose");
      expect(err).toContain("Saved lockfile");
      expect(peerWarnings(err)).toBe(0);
      return (await Bun.file(join(dir, "node_modules", "no-deps", "package.json")).json()).version;
    }

    // The inline row is the baseline: it changes itself and is only re-enqueued by the add/update pass.
    test.concurrent.each([
      [
        "through the catalog",
        (range: string) => rootWithPeer("catalog:", { workspaces: { catalog: { "no-deps": range } } }),
      ],
      ["inline", (range: string) => rootWithPeer(range)],
    ])("declared %s", async (_, packageJson) => {
      const dir = await installedAlone(packageJson("1.0.0"));
      expect(await reinstall(dir, packageJson("^1.0.1"))).toBe("1.1.0");
    });

    test.concurrent("overridden to catalog:", async () => {
      const packageJson = (range: string) =>
        rootWithPeer("1.0.0", { overrides: { "no-deps": "catalog:" }, workspaces: { catalog: { "no-deps": range } } });
      const dir = await installedAlone(packageJson("1.0.0"));
      expect(await reinstall(dir, packageJson("^1.0.1"))).toBe("1.1.0");
    });

    // Selected both as an overridden name and as a catalog: row; one pass handles both.
    test.concurrent("declared through the catalog while an override of the same name changes too", async () => {
      const packageJson = (range: string) =>
        rootWithPeer("catalog:", { overrides: { "no-deps": range }, workspaces: { catalog: { "no-deps": range } } });
      const dir = await installedAlone(packageJson("1.0.0"));
      expect(await reinstall(dir, packageJson("^1.0.1"))).toBe("1.1.0");
    });
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
    expect(await Bun.file(join(dir, "bun.lockb")).bytes()).toStrictEqual(lockb);
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
      expect(result).toStrictEqual({
        keys,
        fresh: result.fresh,
        keysAfterReload: keys,
        reload: result.fresh,
        reloadSavedLockfile: false,
      });
    });
  });

  // Only the entry the spec names is `^2.0.0`; a `>=1.0.0` decoy (in another group, or under the other default spelling — one name in both is an error) or an unresolved peer would give dedupedKeys instead (pnpm: resolveFromCatalog.test.ts).
  describe.each([
    ["catalog:peers", { catalog: { "no-deps": ">=1.0.0" }, catalogs: { peers: { "no-deps": "^2.0.0" } } }],
    ["catalog:", { catalog: { "no-deps": "^2.0.0" }, catalogs: { peers: { "no-deps": ">=1.0.0" } } }],
    ["catalog:default", { catalog: { "no-deps": "^2.0.0" } }],
    ["catalog:", { catalogs: { default: { "no-deps": "^2.0.0" } } }],
    ["catalog:default", { catalogs: { default: { "no-deps": "^2.0.0" } } }],
    ["catalog:default", { catalog: { "a-dep": ">=1.0.0" }, catalogs: { default: { "no-deps": "^2.0.0" } } }],
    ["catalog:", { catalog: { "no-deps": "^2.0.0" }, catalogs: { default: { "a-dep": ">=1.0.0" } } }],
  ] as const)("peer %s resolves through the entry named by its spec (%o)", (peerSpec, catalogFields) => {
    test.concurrent("fresh and reload", async () => {
      const dir = await makeRepo({ ...catalogFields, peerSpec, linker: "hoisted" });
      expect(await record(dir, "hoisted")).toStrictEqual({
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
      expect(await record(dir, "hoisted")).toStrictEqual({
        keys: dedupedKeys,
        fresh: "<hoisted>",
        keysAfterReload: dedupedKeys,
        reload: "<hoisted>",
        reloadSavedLockfile: false,
      });
    });
  });

  const registryPeerKeys = ["app", "catalog-peer", "lib", "no-deps"];

  describe.each(linkers)("linker=%s", linker => {
    // app hoists leaf@1.0.0 (a root dependency would dedupe every peer onto itself) and needs-leaf-2 locks leaf@2.0.0: the workspace's catalog: peer nests it, the registry package's identical spec is satisfied by the hoisted leaf@1.0.0 (unstripped it would add "wants-leaf-peer/leaf").
    test.concurrent("a catalog: peer inside a registry package never reads the consumer's catalog", async () => {
      const dir = await makeRepo({
        catalog: { leaf: "^2.0.0" },
        peerName: "leaf",
        peerSpec: "catalog:",
        rootDependencies: { "needs-leaf-2": "1.0.0", "wants-leaf-peer": "1.0.0" },
        appDependencies: { leaf: "1.0.0" },
        linker,
        registry: catalogRegistry.url.href,
      });
      const keys = ["app", "leaf", "lib", "lib/leaf", "needs-leaf-2", "needs-leaf-2/leaf", "wants-leaf-peer"];

      await install(dir, linker);
      expect(await packageKeys(dir)).toStrictEqual(keys);
      const lockfile = await Bun.file(join(dir, "bun.lock")).text();
      expect(lockfile).toContain('"peerDependencies": { "leaf": "catalog:" }');

      await rmNodeModules(dir);
      const frozen = await install(dir, linker, "--frozen-lockfile");
      expect(frozen.err).not.toContain("lockfile had changes");
      expect(await Bun.file(join(dir, "bun.lock")).text()).toBe(lockfile);
      expect(await packageKeys(dir)).toStrictEqual(keys);
    });

    // pnpm: resolving-deps-resolver walk.rs resolves_children_through_catalogs — only importers substitute catalogs.
    test.concurrent(
      "a registry package's catalog: peer ignores the root catalog and binds to the workspace's copy",
      async () => {
        const dir = await makeRepo({
          rootDependencies: {},
          catalog: { "no-deps": "^2.0.0" },
          appDependencies: { "no-deps": "1.0.0", "catalog-peer": "1.0.0" },
          peerSpec: "*",
          linker,
          registry: catalogRegistry.url.href,
        });
        const boundPeer = async () => {
          if (linker === "isolated") {
            const storeEntry = await realpath(join(dir, "packages", "app", "node_modules", "catalog-peer"));
            return (await Bun.file(join(storeEntry, "..", "no-deps", "package.json")).json()).version;
          }
          return existsSync(join(dir, "node_modules", "catalog-peer", "node_modules")) ? "nested" : "hoisted";
        };
        const expected = linker === "isolated" ? "1.0.0" : "hoisted";

        await install(dir, linker);
        expect(await packageKeys(dir)).toStrictEqual(registryPeerKeys);
        expect(await boundPeer()).toBe(expected);

        await rmNodeModules(dir);
        const { err } = await install(dir, linker);
        expect(err).not.toContain("Saved lockfile");
        expect(await packageKeys(dir)).toStrictEqual(registryPeerKeys);
        expect(await boundPeer()).toBe(expected);
        expect(await Bun.file(join(dir, "bun.lock")).text()).not.toContain("no-deps@2.0.0");
      },
    );

    // Overrides are root-owned: an override VALUE of `catalog:` still applies to a registry package's peer.
    test.concurrent("an override valued catalog: still applies to a registry package's peer", async () => {
      const dir = await makeRepo({
        rootDependencies: {},
        overrides: { "no-deps": "catalog:" },
        catalog: { "no-deps": "1.0.0" },
        appDependencies: { "no-deps": "2.0.0", "peer-deps-fixed": "1.0.0" },
        peerSpec: "*",
        linker,
      });
      const result = await record(dir, linker);
      const keys = ["app", "lib", "no-deps", "peer-deps-fixed"];
      expect(result.keys).toStrictEqual(keys);
      expect(result.keysAfterReload).toStrictEqual(keys);
      expect(result.reloadSavedLockfile).toBeFalse();
      const lockfile = await Bun.file(join(dir, "bun.lock")).text();
      expect(lockfile).not.toContain("no-deps@2.0.0");
      const { packages } = Bun.JSONC.parse(lockfile) as { packages: Record<string, [string, ...unknown[]]> };
      expect(packages["no-deps"][0]).toBe("no-deps@1.0.0");
    });
  });

  test.concurrent("a registry package's catalog: peer with no provider anywhere installs nothing for it", async () => {
    const dir = await makeRepo({
      rootDependencies: {},
      catalog: { "no-deps": "^2.0.0" },
      appDependencies: { "catalog-peer": "1.0.0" },
      peerSpec: "*",
      optionalPeer: true,
      linker: "hoisted",
      registry: catalogRegistry.url.href,
    });
    const keys = ["app", "catalog-peer", "lib"];
    const result = await record(dir, "hoisted");
    expect(result.keys).toStrictEqual(keys);
    expect(result.keysAfterReload).toStrictEqual(keys);
    expect(result.reloadSavedLockfile).toBeFalse();
    expect(await Bun.file(join(dir, "bun.lock")).text()).not.toContain("no-deps@");
    expect(existsSync(join(dir, "node_modules", "no-deps"))).toBeFalse();
  });

  test.concurrent("a registry package's named catalog:peers peer is scoped the same way", async () => {
    const dir = await makeRepo({
      rootDependencies: {},
      catalogs: { peers: { "no-deps": "^2.0.0" } },
      appDependencies: { "no-deps": "1.0.0", "catalog-peer": "2.0.0" },
      peerSpec: "*",
      linker: "hoisted",
      registry: catalogRegistry.url.href,
    });
    const result = await record(dir, "hoisted");
    expect(result.keys).toStrictEqual(registryPeerKeys);
    expect(result.keysAfterReload).toStrictEqual(registryPeerKeys);
    expect(result.reloadSavedLockfile).toBeFalse();
    expect(await Bun.file(join(dir, "bun.lock")).text()).not.toContain("no-deps@2.0.0");
    expect(existsSync(join(dir, "node_modules", "catalog-peer", "node_modules"))).toBeFalse();
  });

  test.concurrent("changing the root catalog does not re-resolve a registry package's catalog: peer", async () => {
    const dir = await makeRepo({
      rootDependencies: {},
      catalog: { "no-deps": "^1.0.0" },
      appDependencies: { "no-deps": "1.0.0", "catalog-peer": "1.0.0" },
      peerSpec: "*",
      linker: "hoisted",
      registry: catalogRegistry.url.href,
    });
    await install(dir, "hoisted");
    expect(await packageKeys(dir)).toStrictEqual(registryPeerKeys);

    await rewriteRootPackageJson(dir, { rootDependencies: {}, catalog: { "no-deps": "^2.0.0" } });
    await install(dir, "hoisted");
    expect(await packageKeys(dir)).toStrictEqual(registryPeerKeys);
    expect(await Bun.file(join(dir, "bun.lock")).text()).not.toContain("no-deps@2.0.0");

    const { err } = await install(dir, "hoisted");
    expect(err).not.toContain("Saved lockfile");
  });

  test.concurrent("a file: folder dependency does not see the catalog either", async () => {
    const { packageDir: dir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          catalog: { "no-deps": "^2.0.0" },
        }),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: { "no-deps": "1.0.0", "vendored": "file:../../vendor/vendored" },
        }),
        "vendor/vendored/package.json": JSON.stringify({
          name: "vendored",
          version: "1.0.0",
          peerDependencies: { "no-deps": "catalog:" },
        }),
      },
    });
    const expectNoNestedCopy = async () => {
      const lockfile = await Bun.file(join(dir, "bun.lock")).text();
      expect(lockfile).not.toContain("no-deps@2.0.0");
      expect((await packageKeys(dir)).filter(key => key.endsWith("vendored/no-deps"))).toStrictEqual([]);
    };

    await install(dir, "hoisted");
    await expectNoNestedCopy();
    await rmNodeModules(dir);
    const { err } = await install(dir, "hoisted");
    expect(err).not.toContain("Saved lockfile");
    await expectNoNestedCopy();
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
        expect(result).toStrictEqual({
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
    ["catalog: peers", { catalogs: { peers: { "no-deps": ">=1.0.0" } } }],
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
      expect(JSON.parse(packageJson.contents)).toStrictEqual({
        name: "lib",
        version: "1.2.3",
        peerDependencies: { "no-deps": ">=1.0.0" },
      });
    });
  });

  // The root catalog is the one in package.json right now, not the one bun.lock recorded at the last install.
  test.concurrent("bun pm pack substitutes the catalog range edited into package.json after the install", async () => {
    const dir = await makeRepo({
      catalog: { "no-deps": "^1.0.0" },
      peerSpec: "catalog:",
      libVersion: "1.2.3",
      linker: "hoisted",
    });
    await install(dir, "hoisted");
    await rewriteRootPackageJson(dir, { catalog: { "no-deps": "^2.0.0" } });
    expect(await Bun.file(join(dir, "bun.lock")).text()).toContain('"no-deps": "^1.0.0"');

    const libDir = join(dir, "packages", "lib");
    await pack(libDir, bunEnv);
    const tarball = readTarball(join(libDir, "lib-1.2.3.tgz"));
    const packageJson = tarball.entries.find(
      (entry: { pathname: string }) => entry.pathname === "package/package.json",
    );
    expect(JSON.parse(packageJson.contents)).toStrictEqual({
      name: "lib",
      version: "1.2.3",
      peerDependencies: { "no-deps": "^2.0.0" },
    });
  });

  // The catalog parse logs this error and skips the entry; pack reports it like `bun install` does
  // instead of complaining that the entry is missing.
  test.concurrent("bun pm pack reports an invalid catalog range at its definition", async () => {
    const dir = await makeRepo({
      catalog: { "no-deps": ".:" },
      peerSpec: "catalog:",
      libVersion: "1.2.3",
      linker: "hoisted",
    });
    const libDir = join(dir, "packages", "lib");

    await using proc = spawn({
      cmd: [bunExe(), "pm", "pack"],
      cwd: libDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const normalizedErr = normalizeBunSnapshot(err, dir);
    expect(normalizedErr).toContain("error: Invalid dependency version\n");
    expect(normalizedErr).toContain("at <dir>/package.json:");
    expect(normalizedErr).not.toContain("no matching catalog dependency");
    expect(normalizeBunSnapshot(out, dir)).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(existsSync(join(libDir, "lib-1.2.3.tgz"))).toBeFalse();
  });

  // lib's package.json is edited after the install; the root catalog never had these entries.
  describe.each([
    ["a-dep", "catalog:"],
    ["no-deps", "catalog:missing"],
  ] as const)("bun pm pack with a %s peer of %s missing from the catalogs", (peerName, peerSpec) => {
    test.concurrent("fails without writing a tarball", async () => {
      const dir = await makeRepo({
        catalog: { "no-deps": ">=1.0.0" },
        peerSpec: "catalog:",
        libVersion: "1.2.3",
        linker: "hoisted",
      });
      await install(dir, "hoisted");
      const libDir = join(dir, "packages", "lib");
      await Bun.write(
        join(libDir, "package.json"),
        JSON.stringify({ name: "lib", version: "1.2.3", peerDependencies: { [peerName]: peerSpec } }),
      );

      await using proc = spawn({
        cmd: [bunExe(), "pm", "pack"],
        cwd: libDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(normalizeBunSnapshot(err, dir)).toBe(
        `error: Failed to resolve catalog version for "${peerName}" in \`peerDependencies\` (no matching catalog dependency).`,
      );
      expect(normalizeBunSnapshot(out, dir)).toBe("bun pack <version> (<revision>)");
      expect(exitCode).toBe(1);
      expect(existsSync(join(libDir, "lib-1.2.3.tgz"))).toBeFalse();
    });
  });
});

// `bun install` advises `bun add --catalog <name>` only where that command accepts the name and the entry is missing.
describe("bun add --catalog advice for a failed catalog: dependency", () => {
  const note =
    'note: catalogs require a "workspaces" field in the root package.json. "<dir>/package.json" was used as root and has none';
  const advice = "error: no-deps@catalog: not in catalog\n  bun add --catalog no-deps";

  function project(files: Record<string, object>) {
    return writeRegistryProject(
      {
        ...Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
        "vendor/x/package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
        "vendor/y/package.json": JSON.stringify({ name: "y", version: "1.0.0" }),
      },
      catalogRegistry.url.href,
    );
  }

  function soloRoot(packageJson: object) {
    return project({ "package.json": { name: "solo", ...packageJson } });
  }

  async function run(cwd: string, args: string[], env = bunEnv) {
    await using proc = spawn({ cmd: [bunExe(), ...args], cwd, stdout: "pipe", stderr: "pipe", env });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { err: normalizeBunSnapshot(err, cwd), exitCode };
  }

  const commands = ["install", "install --frozen-lockfile", "update", "add ./vendor/x", "remove y"];

  describe("a root package.json without workspaces", () => {
    test.concurrent.each(commands)("bun %s prints the package.json it used as the root", async command => {
      using dir = soloRoot({ dependencies: { "no-deps": "catalog:", y: "file:./vendor/y" } });
      const packageJson = await file(join(String(dir), "package.json")).text();

      const { err, exitCode } = await run(String(dir), command.split(" "));
      expect(err).toBe(`error: no-deps@catalog: failed to resolve\n${note}`);
      expect(await file(join(String(dir), "package.json")).text()).toBe(packageJson);
      expect(exitCode).toBe(1);
    });

    test.concurrent.each([
      ["catalog", { catalog: { "no-deps": "1.0.0" } }, "catalog:", "no-deps@catalog: failed to resolve"],
      [
        "catalogs.tools",
        { catalogs: { tools: { "no-deps": "1.0.0" } } },
        "catalog:tools",
        "no-deps@catalog:tools failed to resolve",
      ],
    ] as const)("an entry in a top-level %s is not reported as missing", async (_, catalogs, spec, row) => {
      using dir = soloRoot({ ...catalogs, dependencies: { "no-deps": spec } });

      const { err, exitCode } = await run(String(dir), ["install"]);
      expect(err).toBe(`error: ${row}\n${note}`);
      expect(exitCode).toBe(1);
    });

    test.concurrent("every failed row is listed above one note", async () => {
      using dir = soloRoot({
        dependencies: { "no-deps": "catalog:", "a-dep": "catalog:tools" },
        devDependencies: { leaf: "catalog:" },
      });

      const { err, exitCode } = await run(String(dir), ["install"]);
      expect(err).toBe(
        [
          "error: leaf@catalog: failed to resolve",
          "error: a-dep@catalog:tools failed to resolve",
          "error: no-deps@catalog: failed to resolve",
          note,
        ].join("\n"),
      );
      expect(exitCode).toBe(1);
    });

    test.concurrent(
      'a root that drops "workspaces" after an install gets the note, bun.lock still lists the catalog',
      async () => {
        const packageJson = { catalog: { "no-deps": "1.0.0" }, dependencies: { "no-deps": "catalog:" } };
        using dir = soloRoot({ workspaces: [], ...packageJson });
        await runBunInstall(installEnv(String(dir)), String(dir));
        const lockfile = await file(join(String(dir), "bun.lock")).text();
        expect(lockfile).toContain('"catalog": {\n    "no-deps": "1.0.0",\n  },');
        await write(join(String(dir), "package.json"), JSON.stringify({ name: "solo", ...packageJson }));

        for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
          const { err, exitCode } = await run(String(dir), args);
          expect(err).toBe(`error: no-deps@catalog: failed to resolve\n${note}`);
          expect(await file(join(String(dir), "bun.lock")).text()).toBe(lockfile);
          expect(exitCode).toBe(1);
        }
      },
    );

    test.concurrent("a failed file: dependency gets no catalogs note", async () => {
      using dir = soloRoot({ dependencies: { z: "file:./missing" } });

      const { err, exitCode } = await run(String(dir), ["install"]);
      const lines = err.split("\n");
      expect(lines.filter(line => line.startsWith("note:"))).toEqual([]);
      expect(lines.at(-1)).toBe("error: z@file:./missing failed to resolve");
      expect(exitCode).toBe(1);
    });

    test.concurrent("a catalog: dependency of a file: package gets no catalogs note", async () => {
      using dir = project({
        "package.json": { name: "solo", dependencies: { inner: "file:./inner" } },
        "inner/package.json": { name: "inner", version: "1.0.0", dependencies: { "no-deps": "catalog:" } },
      });

      const { err, exitCode } = await run(String(dir), ["install"]);
      expect(err).toBe("error: no-deps@catalog: failed to resolve");
      expect(exitCode).toBe(1);
    });

    test.concurrent("--silent prints nothing", async () => {
      using dir = soloRoot({ dependencies: { "no-deps": "catalog:" } });

      const { err, exitCode } = await run(String(dir), ["install", "--silent"]);
      expect(err).toBe("");
      expect(exitCode).toBe(1);
    });
  });

  describe("a root package.json with workspaces", () => {
    test.concurrent.each([
      ["[]", [], { catalog: { "no-deps": "^2.0.0" } }],
      ["{}", {}, { workspaces: { catalog: { "no-deps": "^2.0.0" } } }],
    ] as const)(
      'an empty "workspaces": %s gets the advice, and the advice repairs the install',
      async (_, workspaces, written) => {
        using dir = soloRoot({ workspaces, dependencies: { "no-deps": "catalog:" } });

        expect(await run(String(dir), ["install"])).toEqual({ err: advice, exitCode: 1 });

        const added = await run(String(dir), ["add", "--catalog", "no-deps"]);
        expect(await file(join(String(dir), "package.json")).json()).toEqual({
          name: "solo",
          workspaces,
          ...written,
          dependencies: { "no-deps": "catalog:" },
        });
        expect(added.exitCode).toBe(0);

        await runBunInstall(installEnv(String(dir)), String(dir), { savesLockfile: false });
        expect((await file(join(String(dir), "node_modules", "no-deps", "package.json")).json()).version).toBe("2.0.0");
      },
    );

    test.concurrent.each(commands)("bun %s in a workspace member keeps the advice", async command => {
      using dir = project({
        "package.json": { name: "mono", workspaces: ["packages/*"] },
        "packages/api/package.json": {
          name: "api",
          dependencies: { "no-deps": "catalog:", y: "file:../../vendor/y" },
        },
      });

      const args = command.replace("./vendor", "../../vendor").split(" ");
      expect(await run(join(String(dir), "packages", "api"), args)).toEqual({ err: advice, exitCode: 1 });
    });

    // https://github.com/oven-sh/bun/issues/20015
    test.concurrent("bun link <package> in a workspace member reads the root's catalog", async () => {
      using dir = project({
        "package.json": { name: "mono", workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } } },
        "packages/app/package.json": { name: "app", dependencies: { "no-deps": "catalog:" } },
        "linked/package.json": { name: "linked-pkg", version: "1.0.0" },
      });
      const app = join(String(dir), "packages", "app");
      const env = { ...bunEnv, BUN_INSTALL: join(String(dir), "global-install-dir") };
      expect(await run(join(String(dir), "linked"), ["link"], env)).toEqual({ err: "", exitCode: 0 });

      const { err, exitCode } = await run(app, ["link", "linked-pkg", "--linker=isolated"], env);
      expect(err.split("\n").filter(line => /^(error|note):/.test(line))).toEqual([]);
      expect(await file(join(app, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
        version: "1.0.0",
      });
      expect(await file(join(app, "node_modules", "linked-pkg", "package.json")).json()).toEqual({
        name: "linked-pkg",
        version: "1.0.0",
      });
      expect(exitCode).toBe(0);
    });

    // https://github.com/oven-sh/bun/issues/39784
    test.concurrent("an entry whose version does not resolve is not reported as missing", async () => {
      using dir = soloRoot({
        workspaces: [],
        catalog: { "no-deps": "9.9.9" },
        dependencies: { "no-deps": "catalog:" },
      });

      const { err, exitCode } = await run(String(dir), ["install"]);
      expect(err.split("\n").filter(line => line.startsWith("error:") || line.startsWith("  "))).toEqual([
        'error: No version matching "9.9.9" found for specifier "no-deps" (but package exists)',
        "error: no-deps@catalog: failed to resolve",
      ]);
      expect(exitCode).toBe(1);
    });

    test.concurrent("a row named after the root or a workspace gets no bun add --catalog line", async () => {
      using dir = project({
        "package.json": { name: "mono", workspaces: { packages: ["packages/*"], catalogs: { tools: {} } } },
        "packages/app/package.json": {
          name: "app",
          dependencies: { lib: "catalog:", mono: "catalog:tools", "no-deps": "catalog:tools" },
        },
        "packages/lib/package.json": { name: "lib" },
      });

      expect(await run(String(dir), ["install"])).toEqual({
        err: [
          "error: lib@catalog: not in catalog",
          'error: mono@catalog:tools not in catalog "tools"',
          'error: no-deps@catalog:tools not in catalog "tools"',
          "  bun add --catalog=tools no-deps",
        ].join("\n"),
        exitCode: 1,
      });
    });
  });
});

// A cached manifest is used for up to 300 seconds without a request. https://github.com/oven-sh/bun/issues/39784
describe.concurrent("a version published after the manifest was cached", () => {
  /** `versions` and `tags` can change between installs. `requests` has the If-None-Match of every manifest request. */
  function serveMutableRegistry(versions: string[], tags: Record<string, string> = {}, stale304 = false) {
    const requests: (string | null)[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { origin, pathname } = new URL(request.url);
        const version = pathname.match(/^\/fresh-pkg-(.+)\.tgz$/)?.[1];
        if (version) {
          const files = { "package/package.json": JSON.stringify({ name: "fresh-pkg", version }) };
          return new Response(await new Bun.Archive(files, { compress: "gzip" }).bytes());
        }
        if (pathname !== "/fresh-pkg") return new Response("not found", { status: 404 });
        const ifNoneMatch = request.headers.get("if-none-match");
        requests.push(ifNoneMatch);
        const etag = `"v${versions.length}"`;
        // A registry edge server that lags behind confirms what the client already has.
        if (stale304 && ifNoneMatch !== null) return new Response(null, { status: 304, headers: { etag } });
        return Response.json(
          {
            name: "fresh-pkg",
            versions: Object.fromEntries(
              versions.map(v => [
                v,
                { name: "fresh-pkg", version: v, dist: { tarball: `${origin}/fresh-pkg-${v}.tgz` } },
              ]),
            ),
            "dist-tags": { latest: versions.at(-1), ...tags },
          },
          { headers: { etag } },
        );
      },
    });
    return { server, requests, [Symbol.dispose]: () => void server.stop(true) };
  }

  async function install(cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd,
      stdout: "ignore",
      stderr: "pipe",
      // wins over bunfig.toml; every test serves another `fresh-pkg`
      env: installEnv(cwd),
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const lock = Bun.JSONC.parse(await file(join(cwd, "bun.lock")).text()) as { packages: Record<string, [string]> };
    return {
      messages: err.split("\n").filter(line => /^(error|warn):/.test(line)),
      exitCode,
      locked: lock.packages["fresh-pkg"]?.[0],
    };
  }

  /** bun install does not wait for the manifest cache writes before it exits. */
  async function installUntilCached(cwd: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(await install(cwd, ...(attempt ? ["--force"] : []))).toMatchObject({ messages: [], exitCode: 0 });
      if ((await readdir(join(cwd, ".bun-cache"))).some(name => name.endsWith(".npm"))) return;
    }
    throw new Error("the manifest was never cached");
  }

  const depends = (spec: string, group = "dependencies") =>
    JSON.stringify({ name: "root", [group]: { "fresh-pkg": spec } });
  const noVersion = (spec: string) =>
    `error: No version matching "${spec}" found for specifier "fresh-pkg" (but package exists)`;

  test.each([
    { to: depends("1.0.1"), args: [], locked: "fresh-pkg@1.0.1" },
    { to: depends("^1.0.1"), args: [], locked: "fresh-pkg@1.0.1" },
    { to: depends("beta"), args: [], locked: "fresh-pkg@1.0.1" },
    { to: depends("1.0.1"), args: ["--prefer-offline"], locked: "fresh-pkg@1.0.1" },
    // It used to be skipped without a message, and the lockfile that was saved never tried again.
    { to: depends("1.0.1", "optionalDependencies"), args: [], locked: "fresh-pkg@1.0.1" },
    { to: depends("9.9.9", "optionalDependencies"), args: [] },
    { to: depends("9.9.9"), args: [], messages: [noVersion("9.9.9"), "error: fresh-pkg@9.9.9 failed to resolve"] },
    {
      to: depends("nope"),
      args: [],
      messages: [
        'error: Package "fresh-pkg" with tag "nope" not found, but package exists',
        "error: fresh-pkg@nope failed to resolve",
      ],
    },
    // A guard: it passes without the second request too.
    {
      to: depends("1.0.1"),
      args: ["--offline"],
      messages: [noVersion("1.0.1"), "error: fresh-pkg@1.0.1 failed to resolve"],
      requests: [],
    },
  ])("$to $args", async ({ to, args, locked, messages = [], requests = [null] }) => {
    const versions = ["1.0.0"];
    const tags: Record<string, string> = {};
    using registry = serveMutableRegistry(versions, tags);
    using dir = writeRegistryProject({ "package.json": depends("1.0.0") }, registry.server.url.href);
    await installUntilCached(String(dir));

    versions.push("1.0.1");
    tags.beta = "1.0.1";
    await write(join(String(dir), "package.json"), to);
    registry.requests.length = 0;
    // A failed install leaves bun.lock as it was.
    expect(await install(String(dir), ...args)).toEqual({
      messages,
      exitCode: messages.length ? 1 : 0,
      locked: messages.length ? "fresh-pkg@1.0.0" : locked,
    });
    // One request, and without conditional headers: a stale 304 cannot answer it.
    expect(registry.requests).toEqual(requests);

    if (!messages.length) {
      expect(await install(String(dir))).toEqual({ messages: [], exitCode: 0, locked });
      expect(registry.requests).toEqual(requests);
    }
  });

  const catalog = (version: string) =>
    JSON.stringify({ name: "root", workspaces: { packages: ["packages/*"], catalog: { "fresh-pkg": version } } });
  const member = (name: string, spec: string) => JSON.stringify({ name, dependencies: { "fresh-pkg": spec } });

  test.each([
    { version: "1.0.1", messages: [] },
    { version: "9.9.9", messages: [noVersion("9.9.9"), "error: fresh-pkg@catalog: failed to resolve"] },
  ])("a catalog entry moved to $version, used by two workspaces", async ({ version, messages }) => {
    const versions = ["1.0.0"];
    using registry = serveMutableRegistry(versions);
    using dir = writeRegistryProject(
      {
        "package.json": catalog("1.0.0"),
        "packages/a/package.json": member("a", "catalog:"),
        "packages/b/package.json": member("b", "catalog:"),
      },
      registry.server.url.href,
    );
    await installUntilCached(String(dir));

    versions.push("1.0.1");
    await write(join(String(dir), "package.json"), catalog(version));
    registry.requests.length = 0;
    const result = await install(String(dir));
    expect({ ...result, messages: [...new Set(result.messages)] }).toEqual({
      messages,
      exitCode: messages.length ? 1 : 0,
      locked: messages.length ? "fresh-pkg@1.0.0" : "fresh-pkg@1.0.1",
    });
    expect(registry.requests).toEqual([null]);
  });

  test("one request serves both the workspace that it helps and the one that it doesn't", async () => {
    const versions = ["1.0.0"];
    using registry = serveMutableRegistry(versions);
    using dir = writeRegistryProject(
      {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/a/package.json": member("a", "1.0.0"),
        "packages/b/package.json": member("b", "1.0.0"),
      },
      registry.server.url.href,
    );
    await installUntilCached(String(dir));

    versions.push("1.0.1");
    await write(join(String(dir), "packages", "a", "package.json"), member("a", "1.0.1"));
    await write(join(String(dir), "packages", "b", "package.json"), member("b", "9.9.9"));
    registry.requests.length = 0;
    expect(await install(String(dir))).toEqual({
      messages: [noVersion("9.9.9"), "error: fresh-pkg@9.9.9 failed to resolve"],
      exitCode: 1,
      locked: "fresh-pkg@1.0.0",
    });
    expect(registry.requests).toEqual([null]);
  });

  test("a stale 304 does not hide the new version", async () => {
    const versions = ["1.0.0"];
    using registry = serveMutableRegistry(versions, {}, true);
    using dir = writeRegistryProject({ "package.json": depends("1.0.0") }, registry.server.url.href);
    await installUntilCached(String(dir));

    versions.push("1.0.1");
    await write(join(String(dir), "package.json"), depends("1.0.1"));
    registry.requests.length = 0;
    // --force asks whether the cached manifest is still current.
    expect(await install(String(dir), "--force")).toEqual({ messages: [], exitCode: 0, locked: "fresh-pkg@1.0.1" });
    expect(registry.requests).toEqual(['"v1"', null]);
  });

  test("an import that the runtime installs", async () => {
    const versions = ["1.0.0"];
    using registry = serveMutableRegistry(versions);
    using dir = writeRegistryProject({}, registry.server.url.href);
    const requireVersion = async (version: string) => {
      await using proc = spawn({
        cmd: [bunExe(), "--install=force", "-e", `console.log(require("fresh-pkg@${version}/package.json").version)`],
        cwd: String(dir),
        env: installEnv(String(dir)),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { out: out.trim(), err, exitCode };
    };
    expect(await requireVersion("1.0.0")).toEqual({ out: "1.0.0", err: "", exitCode: 0 });

    versions.push("1.0.1");
    registry.requests.length = 0;
    expect(await requireVersion("1.0.1")).toEqual({ out: "1.0.1", err: "", exitCode: 0 });
    expect(registry.requests).toEqual([null]);
  });

  test("a tag that only a workspace with that name can satisfy", async () => {
    using registry = serveMutableRegistry(["1.0.0"]);
    using dir = writeRegistryProject(
      {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/a/package.json": member("a", "1.0.0"),
        "packages/fresh-pkg/package.json": JSON.stringify({ name: "fresh-pkg", version: "5.0.0" }),
      },
      registry.server.url.href,
    );
    await installUntilCached(String(dir));

    await write(join(String(dir), "packages", "a", "package.json"), member("a", "beta"));
    registry.requests.length = 0;
    // The registry may have the tag by now, so it is asked before the workspace is linked. bun.lock then has the link.
    const linked = { messages: [], exitCode: 0, locked: "fresh-pkg@workspace:packages/fresh-pkg" };
    expect(await install(String(dir))).toEqual(linked);
    expect(registry.requests).toEqual([null]);
    expect(await install(String(dir))).toEqual(linked);
    expect(registry.requests).toEqual([null]);
  });

  test.each(["latest", ""])("%j points to a version that the registry doesn't have", async spec => {
    using registry = serveMutableRegistry(["1.0.0", "1.0.1", "2.0.0-rc.1"], { latest: "1.0.2" });
    using dir = writeRegistryProject({ "package.json": depends("1.0.0") }, registry.server.url.href);
    await installUntilCached(String(dir));

    await write(join(String(dir), "package.json"), depends(spec));
    registry.requests.length = 0;
    // The registry may have the version by now, so it's asked before another version is used.
    expect(await install(String(dir))).toEqual({
      messages: [],
      exitCode: 0,
      locked: "fresh-pkg@1.0.1",
    });
    expect(registry.requests).toEqual([null]);
  });
});
