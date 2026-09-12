import { type Server, file, spawn, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readlinkSync } from "fs";
import { exists, readdir, realpath, rm } from "fs/promises";
import {
  type DirectoryTree,
  bunEnv,
  bunExe,
  nodeModulesPackages,
  normalizeBunSnapshot,
  pack,
  runBunInstall,
  tempDir,
} from "harness";
import { join } from "path";

type Manifests = Record<string, Record<string, Record<string, Record<string, string>>>>;

// Registry packages that ship a raw `catalog:` specifier; the verdaccio fixtures have none.
const catalogManifests: Manifests = {
  "leaf": { "1.0.0": {}, "2.0.0": {} },
  "wants-leaf-peer": { "1.0.0": { peerDependencies: { leaf: "catalog:" } } },
  "wants-leaf-dep": { "1.0.0": { dependencies: { leaf: "catalog:" } } },
  "wants-leaf-optional": { "1.0.0": { optionalDependencies: { leaf: "catalog:" } } },
  "needs-leaf-2": { "1.0.0": { dependencies: { leaf: "2.0.0" } } },
  "catalog-peer": {
    "1.0.0": { peerDependencies: { "no-deps": "catalog:" } },
    "2.0.0": { peerDependencies: { "no-deps": "catalog:peers" } },
  },
};

type BunfigOpts = { saveTextLockfile?: boolean; linker?: "hoisted" | "isolated" };

/**
 * The one registry of this file, served in-process. It reads the verdaccio fixture packages straight from the storage
 * directory (the same packuments and tarballs, so the integrity hashes in the lockfiles do not change) and adds the
 * packages in `catalogManifests`. Starting verdaccio itself costs several seconds on the ASAN lane.
 */
class FixtureRegistry {
  readonly packagesPath = join(import.meta.dir, "registry", "packages");
  private server!: Server;
  private tarballs = new Map<string, Uint8Array>();

  async start() {
    for (const [name, versions] of Object.entries(catalogManifests)) {
      for (const [version, extra] of Object.entries(versions)) {
        const archive = new Bun.Archive(
          { "package/package.json": JSON.stringify({ name, version, ...extra }) },
          { compress: "gzip" },
        );
        this.tarballs.set(`${name}/-/${name}-${version}.tgz`, await archive.bytes());
      }
    }
    this.server = Bun.serve({ port: 0, fetch: request => this.fetch(request) });
  }

  stop() {
    this.server.stop(true);
  }

  registryUrl() {
    return this.server.url.href;
  }

  private async fetch(request: Request): Promise<Response> {
    const { origin, pathname } = new URL(request.url);
    // bun requests a scoped manifest as `/@scope%2fname`
    const path = decodeURIComponent(pathname.slice(1));
    const separator = path.indexOf("/-/");
    if (separator !== -1) {
      const name = path.slice(0, separator);
      const basename = path.slice(path.lastIndexOf("/") + 1);
      const generated = this.tarballs.get(`${name}/-/${basename}`);
      if (generated) return new Response(generated);
      const stored = file(join(this.packagesPath, name, basename));
      return (await stored.exists()) ? new Response(stored) : new Response("not found", { status: 404 });
    }
    const entry = catalogManifests[path];
    if (entry) {
      const versions: Record<string, unknown> = {};
      for (const [version, extra] of Object.entries(entry)) {
        versions[version] = {
          name: path,
          version,
          dist: { tarball: `${origin}/${path}/-/${path}-${version}.tgz` },
          ...extra,
        };
      }
      const latest = Object.keys(entry).sort(Bun.semver.order).at(-1);
      return Response.json({ name: path, versions, "dist-tags": { latest } });
    }
    const stored = file(join(this.packagesPath, path, "package.json"));
    if (!(await stored.exists())) return new Response("not found", { status: 404 });
    // verdaccio stored the tarball URLs of the publish and rewrites them to the host it serves on. Do the same.
    return new Response((await stored.text()).replaceAll("http://localhost:4873", origin), {
      headers: { "content-type": "application/json" },
    });
  }

  async createTestDir(
    opts: { bunfigOpts?: BunfigOpts; files?: DirectoryTree } = { bunfigOpts: { linker: "hoisted" }, files: {} },
  ) {
    const packageDir = String(tempDir("catalogs-test-", opts.files ?? {}));
    await write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: join(packageDir, ".bun-cache"),
          registry: this.registryUrl(),
          saveTextLockfile: opts.bunfigOpts?.saveTextLockfile,
          linker: opts.bunfigOpts?.linker,
        },
      }),
    );
    return { packageDir, packageJson: join(packageDir, "package.json") };
  }
}

const registry = new FixtureRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Lockfile = {
  lockfileVersion: number;
  configVersion: number;
  workspaces: Record<string, Record<string, unknown>>;
  catalog?: Record<string, string>;
  catalogs?: Record<string, Record<string, string>>;
  packages: Record<string, [string, ...unknown[]]>;
};

/** `bun.lock` with the registry port replaced, the same text for every run. */
async function lockfileText(dir: string) {
  return (await file(join(dir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234");
}

async function readLockfile(dir: string): Promise<Lockfile> {
  return Bun.JSONC.parse(await lockfileText(dir)) as Lockfile;
}

const integrity: Record<string, string> = {
  "a-dep@1.0.1": "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg==",
  "a-dep@1.0.10": "sha512-NeQ6Ql9jRW8V+VOiVb+PSQAYOvVoSimW+tXaR0CoJk4kM9RIk/XlAUGCsNtn5XqjlDO4hcH8NcyaL507InevEg==",
  "no-deps@1.0.0": "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
  "no-deps@2.0.0": "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g==",
};

/** The `bun.lock` entry of a registry package without dependencies, as `readLockfile` returns it. */
function registryEntry(name: string, version: string) {
  return [
    `${name}@${version}`,
    `http://localhost:1234/${name}/-/${name}-${version}.tgz`,
    {},
    integrity[`${name}@${version}`],
  ];
}

/** The resolution of every entry in `bun.lock`'s `packages` section: `{ "no-deps": "no-deps@2.0.0", ... }`. */
function resolutions(lockfile: Lockfile) {
  return Object.fromEntries(Object.entries(lockfile.packages).map(([key, [resolution]]) => [key, resolution]));
}

/** The packages installed under `dir/node_modules`, sorted: `["a-dep/a-dep@1.0.1", "no-deps/no-deps@2.0.0"]`. */
function installedPackages(dir: string) {
  return nodeModulesPackages(join(dir, "node_modules")).split("\n").filter(Boolean);
}

/**
 * `normalizeBunSnapshot` for the output of `bun install` and `bun update`. The task count of the resolve summary
 * ("Resolved, downloaded and extracted [N]") counts the network and extract tasks the run scheduled, which depends on
 * the state of the cache, so it is masked.
 */
function normalizeOutput(text: string, dir: string) {
  return normalizeBunSnapshot(text, dir).replace(/(Resolved, downloaded and extracted) \[\d+\]/g, "$1 [<n>]");
}

/**
 * The env for a `bun install` or `bun update` of the project in `packageDir`. The CI runner sets
 * `BUN_INSTALL_CACHE_DIR` for the whole test file and it wins over the `cache` in bunfig.toml, so without this every
 * test would share one install cache. Concurrent installs of the same package into one cache race on Windows.
 */
function installEnv(packageDir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };
}

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

  const basicPackages = ["a-dep/a-dep@1.0.1", "no-deps/no-deps@2.0.0"];

  for (const isTopLevel of [true, false]) {
    test.concurrent(`both catalog and catalogs ${isTopLevel ? "in top-level" : "in workspaces"}`, async () => {
      const { packageDir } = await registry.createTestDir();

      await createBasicCatalogMonorepo(packageDir, "catalog-basic-1", isTopLevel);

      const first = await runBunInstall(installEnv(packageDir), packageDir);
      expect(normalizeOutput(first.out, packageDir)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        3 packages installed"
      `);
      expect(normalizeOutput(first.err, packageDir)).toMatchInlineSnapshot(`
        "Resolving dependencies
        Resolved, downloaded and extracted [<n>]
        Saved lockfile"
      `);
      expect(installedPackages(packageDir)).toEqual(basicPackages);
      // bun.lock does not record where the catalogs were defined
      const lockfile = await lockfileText(packageDir);
      expect(lockfile).toMatchInlineSnapshot(`
        "{
          "lockfileVersion": 2,
          "configVersion": 1,
          "workspaces": {
            "": {
              "name": "catalog-basic-1",
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

      // another install does not save the lockfile
      const second = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
      expect(normalizeOutput(second.out, packageDir)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        Checked 3 installs across 4 packages (no changes)"
      `);
      expect(normalizeOutput(second.err, packageDir)).toMatchInlineSnapshot(`""`);
      expect(await lockfileText(packageDir)).toBe(lockfile);
      expect(installedPackages(packageDir)).toEqual(basicPackages);
    });
  }

  for (const binaryLockfile of [true, false]) {
    test.concurrent(`detect changes (${binaryLockfile ? "bun.lockb" : "bun.lock"})`, async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { saveTextLockfile: !binaryLockfile, linker: "hoisted" },
      });
      const packageJson = await createBasicCatalogMonorepo(packageDir, "catalog-basic-2");
      const pkg1 = ["pkg1@workspace:packages/pkg1"];

      /** The lockfile sections a catalog change has to move (bun.lockb is only checked to exist). */
      const expectLockfile = async (noDeps: string, aDep: string) => {
        if (binaryLockfile) {
          expect(await exists(join(packageDir, "bun.lockb"))).toBeTrue();
          expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
          return;
        }
        const lockfile = await readLockfile(packageDir);
        expect(lockfile.catalog).toEqual({ "no-deps": noDeps });
        expect(lockfile.catalogs).toEqual({ a: { "a-dep": aDep } });
        expect(lockfile.packages).toEqual({
          "a-dep": registryEntry("a-dep", aDep),
          "no-deps": registryEntry("no-deps", noDeps),
          pkg1,
        });
      };

      let { err } = await runBunInstall(installEnv(packageDir), packageDir);
      expect(err).toContain("Saved lockfile");
      await expectLockfile("2.0.0", "1.0.1");
      expect(installedPackages(packageDir)).toEqual(basicPackages);

      // update catalog
      packageJson.workspaces.catalog["no-deps"] = "1.0.0";
      await write(join(packageDir, "package.json"), JSON.stringify(packageJson));
      ({ err } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: true }));
      expect(err).toContain("Saved lockfile");
      await expectLockfile("1.0.0", "1.0.1");
      expect(installedPackages(packageDir)).toEqual(["a-dep/a-dep@1.0.1", "no-deps/no-deps@1.0.0"]);

      // update catalogs
      packageJson.workspaces!.catalogs!.a["a-dep"] = "1.0.10";
      await write(join(packageDir, "package.json"), JSON.stringify(packageJson));
      ({ err } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: true }));
      expect(err).toContain("Saved lockfile");
      await expectLockfile("1.0.0", "1.0.10");
      expect(installedPackages(packageDir)).toEqual(["a-dep/a-dep@1.0.10", "no-deps/no-deps@1.0.0"]);
    });
  }

  test.concurrent("switching a dependency to a different catalog is detected", async () => {
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
    expect(installedPackages(packageDir)).toEqual(["no-deps/no-deps@1.0.0"]);
    let lockfile = await readLockfile(packageDir);
    expect(lockfile.workspaces["packages/pkg1"]).toEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:a" } });
    expect(resolutions(lockfile)).toEqual({ "no-deps": "no-deps@1.0.0", pkg1: "pkg1@workspace:packages/pkg1" });

    await write(pkg1Path, JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:b" } }));
    await runBunInstall(installEnv(packageDir), packageDir);

    expect(installedPackages(packageDir)).toEqual(["no-deps/no-deps@2.0.0"]);
    lockfile = await readLockfile(packageDir);
    expect(lockfile.workspaces["packages/pkg1"]).toEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:b" } });
    expect(resolutions(lockfile)).toEqual({ "no-deps": "no-deps@2.0.0", pkg1: "pkg1@workspace:packages/pkg1" });

    const text = await lockfileText(packageDir);
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(await lockfileText(packageDir)).toBe(text);
  });

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
    expect(installedPackages(packageDir)).toEqual(["a-dep/a-dep@1.0.1", "no-deps/no-deps@1.0.0"]);
    const lockfile = await readLockfile(packageDir);
    expect(lockfile.catalog).toEqual({ "no-deps": "1.0.0" });
    expect(lockfile.catalogs).toEqual({ default: { "a-dep": "1.0.1" } });
    expect(resolutions(lockfile)).toEqual({ "a-dep": "a-dep@1.0.1", "no-deps": "no-deps@1.0.0" });

    const text = await lockfileText(packageDir);
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(await lockfileText(packageDir)).toBe(text);
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

  /** Runs `bun update` for the monorepo in `packageDir` (from `cwd`, the root by default) and returns its normalized output. */
  async function runUpdate(packageDir: string, args: string[], cwd = packageDir) {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "update", ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: installEnv(packageDir),
    });

    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    return { out: normalizeOutput(out, packageDir), err: normalizeOutput(err, packageDir), exitCode };
  }

  const pkg1Dependencies = { "no-deps": "catalog:", "a-dep": "catalog:a" };

  /** `package.json` and `bun.lock` after `--latest` moved both catalog entries of `createUpdateMonorepo`. */
  async function expectLatestCatalogs(packageDir: string, isTopLevel = false) {
    // catalog entries are updated, preserving the pinning style
    const root = await file(join(packageDir, "package.json")).json();
    const { catalog, catalogs } = isTopLevel ? root : root.workspaces;
    expect(catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(catalogs).toEqual({ a: { "a-dep": "~1.0.10" } });

    // workspace packages keep their catalog references
    expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual(
      pkg1Dependencies,
    );

    const lockfile = await readLockfile(packageDir);
    expect(lockfile.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(lockfile.catalogs).toEqual({ a: { "a-dep": "~1.0.10" } });
    expect(lockfile.workspaces["packages/pkg1"]).toEqual({ name: "pkg1", dependencies: pkg1Dependencies });
    expect(resolutions(lockfile)).toEqual({
      "a-dep": "a-dep@1.0.10",
      "no-deps": "no-deps@2.0.0",
      "pkg1": "pkg1@workspace:packages/pkg1",
    });

    // the new versions are installed
    expect(installedPackages(packageDir)).toEqual(["a-dep/a-dep@1.0.10", "no-deps/no-deps@2.0.0"]);
  }

  // https://github.com/oven-sh/bun/issues/23739
  for (const [flags, label] of [
    [["--latest"], "in top-level"],
    [["--latest"], "in workspaces"],
    [["-r", "--latest"], "with -r"],
  ] as const) {
    const isTopLevel = label === "in top-level";
    test.concurrent(`--latest updates catalog versions ${label}`, async () => {
      const { packageDir } = await registry.createTestDir();
      await createUpdateMonorepo(packageDir, `catalog-update-latest-${label.replace(/\W+/g, "-")}`, isTopLevel);
      await runBunInstall(installEnv(packageDir), packageDir);
      expect(installedPackages(packageDir)).toEqual(["a-dep/a-dep@1.0.10", "no-deps/no-deps@1.1.0"]);

      const { out, err, exitCode } = await runUpdate(packageDir, [...flags]);
      expect(err).toMatchInlineSnapshot(`
        "Resolving dependencies
        Resolved, downloaded and extracted [<n>]
        Saved lockfile"
      `);
      expect(out).toMatchInlineSnapshot(`
        "bun update <version> (<revision>)

        1 package installed"
      `);
      expect(exitCode).toBe(0);
      await expectLatestCatalogs(packageDir, isTopLevel);
    });
  }

  test.concurrent("--frozen-lockfile passes after --latest updates catalogs", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-frozen");
    await runBunInstall(installEnv(packageDir), packageDir);

    const update = await runUpdate(packageDir, ["--latest"]);
    expect(update.err).not.toContain("error:");
    expect(update.exitCode).toBe(0);
    await expectLatestCatalogs(packageDir);
    const lockfile = await lockfileText(packageDir);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: installEnv(packageDir),
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(normalizeOutput(err, packageDir)).toMatchInlineSnapshot(`""`);
    expect(normalizeOutput(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      Checked 3 installs across 4 packages (no changes)"
    `);
    expect(exitCode).toBe(0);
    expect(await lockfileText(packageDir)).toBe(lockfile);
  });

  test.concurrent("--latest run from inside a workspace package updates the root catalog", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-in-workspace");
    await runBunInstall(installEnv(packageDir), packageDir);

    const { out, err, exitCode } = await runUpdate(packageDir, ["--latest"], join(packageDir, "packages", "pkg1"));
    expect(err).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [<n>]
      Saved lockfile"
    `);
    expect(out).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      + no-deps@2.0.0

      1 package installed"
    `);
    expect(exitCode).toBe(0);
    await expectLatestCatalogs(packageDir);
  });

  test.concurrent("--latest updates the same package independently per catalog", async () => {
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
    expect(installedPackages(packageDir)).toEqual(["no-deps/no-deps@1.1.0"]);
    expect(installedPackages(join(packageDir, "packages", "pkg2"))).toEqual(["no-deps/no-deps@1.0.1"]);

    const { out, err, exitCode } = await runUpdate(packageDir, ["--latest"]);
    expect(err).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [<n>]
      Saved lockfile"
    `);
    expect(out).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    const root = await file(join(packageDir, "package.json")).json();
    // each catalog entry keeps its own pinning style, entries not referenced by any workspace are left unchanged
    expect(root.workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(root.workspaces.catalogs).toEqual({ pinned: { "no-deps": "2.0.0" }, unused: { "no-deps": "1.0.0" } });

    const lockfile = await readLockfile(packageDir);
    expect(lockfile.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(lockfile.catalogs).toEqual({ pinned: { "no-deps": "2.0.0" }, unused: { "no-deps": "1.0.0" } });
    expect(resolutions(lockfile)).toEqual({
      "no-deps": "no-deps@2.0.0",
      "pkg1": "pkg1@workspace:packages/pkg1",
      "pkg2": "pkg2@workspace:packages/pkg2",
    });
    expect(installedPackages(packageDir)).toEqual(["no-deps/no-deps@2.0.0"]);
    expect(installedPackages(join(packageDir, "packages", "pkg2"))).toEqual([]);
  });

  for (const fromWorkspace of [false, true]) {
    test.concurrent(
      `--latest --dry-run does not modify any package.json (from ${fromWorkspace ? "workspace" : "root"})`,
      async () => {
        const { packageDir } = await registry.createTestDir();
        await createUpdateMonorepo(packageDir, `catalog-update-dry-run-${fromWorkspace ? "ws" : "root"}`);
        await runBunInstall(installEnv(packageDir), packageDir);

        const rootBefore = await file(join(packageDir, "package.json")).text();
        const pkg1Before = await file(join(packageDir, "packages", "pkg1", "package.json")).text();
        const lockfileBefore = await lockfileText(packageDir);

        const cwd = fromWorkspace ? join(packageDir, "packages", "pkg1") : packageDir;
        const { out, err, exitCode } = await runUpdate(packageDir, ["--latest", "--dry-run"], cwd);
        expect(err).toMatchInlineSnapshot(`
          "Resolving dependencies
          Resolved, downloaded and extracted [<n>]"
        `);
        expect(out).toMatchInlineSnapshot(`
          "bun update <version> (<revision>)

          ^ no-deps 1.1.0 -> 2.0.0

          1 package would be updated"
        `);
        expect(exitCode).toBe(0);

        expect(await file(join(packageDir, "package.json")).text()).toBe(rootBefore);
        expect(await file(join(packageDir, "packages", "pkg1", "package.json")).text()).toBe(pkg1Before);
        expect(await lockfileText(packageDir)).toBe(lockfileBefore);
        expect(installedPackages(packageDir)).toEqual(["a-dep/a-dep@1.0.10", "no-deps/no-deps@1.1.0"]);
      },
    );
  }

  for (const args of [[], ["-r"]] as const) {
    test.concurrent(
      `update without --latest from root moves catalogs within range (${args.join(" ") || "no args"})`,
      async () => {
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

        const { out, err, exitCode } = await runUpdate(packageDir, [...args]);
        expect(err).toMatchInlineSnapshot(`
        "Resolving dependencies
        Resolved, downloaded and extracted [<n>]
        Saved lockfile"
      `);
        expect(out).toMatchInlineSnapshot(`
        "bun update <version> (<revision>)

        2 packages installed"
      `);
        expect(exitCode).toBe(0);

        const root = await file(join(packageDir, "package.json")).json();
        expect(root.workspaces.catalog).toEqual({ "no-deps": "^1.1.0" });

        expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual({
          "no-deps": "catalog:",
        });
        expect(installedPackages(packageDir)).toEqual(["no-deps/no-deps@1.1.0"]);

        const lockfile = await readLockfile(packageDir);
        expect(lockfile.catalog).toEqual({ "no-deps": "^1.1.0" });
        expect(lockfile.workspaces["packages/pkg1"]).toEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
        expect(resolutions(lockfile)).toEqual({ "no-deps": "no-deps@1.1.0", "pkg1": "pkg1@workspace:packages/pkg1" });
      },
    );
  }

  test.concurrent("update without --latest stays in range and keeps catalog references", async () => {
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

    const { out, err, exitCode } = await runUpdate(packageDir, [], join(packageDir, "packages", "pkg1"));
    expect(err).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [<n>]
      Saved lockfile"
    `);
    expect(out).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      Checked 3 installs across 4 packages (no changes)"
    `);
    expect(exitCode).toBe(0);

    const root = await file(join(packageDir, "package.json")).json();
    // ranges move within the range (latest of ^1.0.0 is 1.1.0, not 2.0.0)...
    expect(root.workspaces.catalog).toEqual({ "no-deps": "^1.1.0" });
    // ...and exact versions are not moved by a plain `bun update`
    expect(root.workspaces.catalogs).toEqual({ pinned: { "a-dep": "1.0.1" } });

    const dependencies = { "no-deps": "catalog:", "a-dep": "catalog:pinned" };
    expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual(
      dependencies,
    );

    const lockfile = await readLockfile(packageDir);
    expect(lockfile.catalog).toEqual({ "no-deps": "^1.1.0" });
    expect(lockfile.catalogs).toEqual({ pinned: { "a-dep": "1.0.1" } });
    expect(lockfile.workspaces["packages/pkg1"]).toEqual({ name: "pkg1", dependencies });
    expect(resolutions(lockfile)).toEqual({
      "a-dep": "a-dep@1.0.1",
      "no-deps": "no-deps@1.1.0",
      "pkg1": "pkg1@workspace:packages/pkg1",
    });
    expect(installedPackages(packageDir)).toEqual(["a-dep/a-dep@1.0.1", "no-deps/no-deps@1.1.0"]);
  });

  test.concurrent("update <pkg> --latest keeps the catalog reference", async () => {
    const { packageDir } = await registry.createTestDir();
    await createUpdateMonorepo(packageDir, "catalog-update-targeted");
    await runBunInstall(installEnv(packageDir), packageDir);

    const { out, err, exitCode } = await runUpdate(
      packageDir,
      ["no-deps", "--latest"],
      join(packageDir, "packages", "pkg1"),
    );
    expect(err).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [<n>]"
    `);
    expect(out).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      Checked 3 installs across 4 packages (no changes)"
    `);
    expect(exitCode).toBe(0);

    expect((await file(join(packageDir, "packages", "pkg1", "package.json")).json()).dependencies).toEqual(
      pkg1Dependencies,
    );
    expect((await readLockfile(packageDir)).workspaces["packages/pkg1"]).toEqual({
      name: "pkg1",
      dependencies: pkg1Dependencies,
    });
  });
});

describe("errors", () => {
  /** Runs `bun install` in `cwd` and returns its normalized output. The caller asserts the whole of it. */
  async function failingInstall(cwd: string) {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: installEnv(cwd),
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out: normalizeOutput(out, cwd), err: normalizeOutput(err, cwd), exitCode };
  }

  test.concurrent("fails gracefully when no catalog is found for a package", async () => {
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

    const { out, err, exitCode } = await failingInstall(packageDir);
    expect(err).toMatchInlineSnapshot(`
      "error: a-dep@catalog:aaaaaaaaaaaaaaaaa: there is no catalog named "aaaaaaaaaaaaaaaaa" in the root package.json
      error: no-deps@catalog: is not in the catalog
        bun add --catalog no-deps"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
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

    const { out, err, exitCode } = await failingInstall(packageDir);
    expect(err).toMatchInlineSnapshot(`
      "error: left-pad@catalog:default is not in the catalog
        bun add --catalog left-pad
      error: no-deps@catalog:tools is not in catalog "tools"
        bun add --catalog=tools no-deps"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });

  test.concurrent("invalid dependency version", async () => {
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

    const { out, err, exitCode } = await failingInstall(packageDir);
    expect(err).toMatchInlineSnapshot(`
      "error: Unsupported protocol .:

      1 | {"name":"catalog-error-2","workspaces":{"catalog":{"no-deps":".:"}},"dependencies":{"no-deps":"catalog:"}}
                                                                       ^
      error: Invalid dependency version
          at <dir>/package.json:1:62
      error: no-deps@catalog: is not in the catalog
        bun add --catalog no-deps"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
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
      const source = rootWithDuplicateDefault(
        placement,
        { catalog: { "no-deps": "1.0.0" }, catalogs: { default: { "no-deps": "2.0.0" } } },
        { "no-deps": "catalog:" },
      );
      const { packageDir } = await registry.createTestDir({ files: { "package.json": source } });

      const { out, err, exitCode } = await failingInstall(packageDir);
      // the error points at the entry under catalogs.default
      const column = source.indexOf('"no-deps":"2.0.0"') + 1;
      expect(err).toBe(
        [
          `1 | ${source}`,
          `${" ".repeat(column + 3)}^`,
          'error: "no-deps" is defined in both "catalog" and "catalogs.default"; keep one of them',
          `    at <dir>/package.json:1:${column}`,
        ].join("\n"),
      );
      expect(out).toBe("bun install <version> (<revision>)");
      expect(exitCode).toBe(1);
      expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
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

    const { out, err, exitCode } = await failingInstall(packageDir);
    expect(err).toMatchInlineSnapshot(`
      "1 | "a-dep":"1.0.1"},"catalogs":{"default":{"no-deps":"2.0.0","a-dep":"1.0.10"}}},"dependencies":{"no-deps":"catalog:","a-de
                                                                                                                                               ^
      error: "no-deps" is defined in both "catalog" and "catalogs.default"; keep one of them
          at <dir>/package.json:1:134

      1 | {"name":"catalog-duplicate-default","workspaces":{"packages":[],"catalog":{"no-deps":"1.0.0","a-dep":"1.0.1"},"catalogs":{"default":{"no-deps":"2.0.0","a-dep":"1.0.10"}}},"dependencies":{"no-deps":"catalog:","a-dep":"catalog:"}}
                                                                                                                                                                 ^
      error: "a-dep" is defined in both "catalog" and "catalogs.default"; keep one of them
          at <dir>/package.json:1:152"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
    expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  // pnpm: deps-installer/test/catalogs.ts "external dependency using catalog protocol errors"
  test.concurrent("a catalog: dependency inside a registry package fails to resolve", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { saveTextLockfile: true },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: { catalog: { leaf: "^2.0.0" } },
          dependencies: { "wants-leaf-dep": "1.0.0" },
        }),
      },
    });

    const { out, err, exitCode } = await failingInstall(packageDir);
    expect(err).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [<n>]
      error: leaf@catalog: failed to resolve"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
    expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
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

      const { out, err, exitCode } = await failingInstall(folder.packageDir);
      expect(err).toMatchInlineSnapshot(`"error: no-deps@catalog: failed to resolve"`);
      expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
      expect(exitCode).toBe(1);
      expect(await exists(join(folder.packageDir, "bun.lock"))).toBeFalse();

      await runBunInstall(installEnv(workspace.packageDir), workspace.packageDir);
      expect(installedPackages(workspace.packageDir)).toEqual(["no-deps/no-deps@1.1.0"]);
      expect(resolutions(await readLockfile(workspace.packageDir))).toEqual({
        "local-lib": "local-lib@workspace:packages/local-lib",
        "no-deps": "no-deps@1.1.0",
      });
    },
  );
});

describe("optionalDependencies", () => {
  type Linker = "hoisted" | "isolated";

  async function spawnInstall(dir: string, linker: Linker, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker", linker, ...args],
      cwd: dir,
      env: installEnv(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out: normalizeOutput(out, dir), err: normalizeOutput(err, dir), code };
  }

  async function install(dir: string, linker: Linker, ...args: string[]) {
    const result = await spawnInstall(dir, linker, ...args);
    expect(result.err).not.toContain("error:");
    expect(result.code).toBe(0);
    return result;
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
      const expectLayout = () => {
        if (linker === "isolated") {
          expect(installedPackages(dir)).toEqual([
            ".bun/a-dep@1.0.1/node_modules/a-dep/a-dep@1.0.1",
            ".bun/no-deps@2.0.0/node_modules/no-deps/no-deps@2.0.0",
          ]);
          expect(existsSync(join(dir, "node_modules", "a-dep"))).toBeFalse();
          expect(existsSync(join(dir, "packages", "pkg1", "node_modules", "a-dep", "package.json"))).toBeTrue();
        } else {
          expect(installedPackages(dir)).toEqual(["a-dep/a-dep@1.0.1", "no-deps/no-deps@2.0.0"]);
          expect(existsSync(join(dir, "packages", "pkg1", "node_modules"))).toBeFalse();
        }
      };

      const first = await install(dir, linker);
      expect(first.err).toContain("Saved lockfile");
      expectLayout();

      const lockfile = await readLockfile(dir);
      expect(lockfile.workspaces).toEqual({
        "": { name: "root", optionalDependencies: { "no-deps": "catalog:" } },
        "packages/pkg1": { name: "pkg1", optionalDependencies: { "a-dep": "catalog:a" } },
      });
      expect(lockfile.catalog).toEqual({ "no-deps": "2.0.0" });
      expect(lockfile.catalogs).toEqual({ a: { "a-dep": "1.0.1" } });
      expect(resolutions(lockfile)).toEqual({
        "a-dep": "a-dep@1.0.1",
        "no-deps": "no-deps@2.0.0",
        "pkg1": "pkg1@workspace:packages/pkg1",
      });

      const text = await lockfileText(dir);
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      const warm = await install(dir, linker);
      expect(warm.err).not.toContain("Saved lockfile");
      expect(await lockfileText(dir)).toBe(text);
      expectLayout();
      const frozen = await install(dir, linker, "--frozen-lockfile");
      expect(frozen.err).toBe("");
      expect(await lockfileText(dir)).toBe(text);
    });

    // The registry package's optional `catalog:` edge is stripped to unresolvable instead of reading the consumer's catalog, and stays that way when bun.lock is reloaded.
    test.concurrent("a registry package's optional catalog: dependency is skipped, fresh and on reload", async () => {
      const { packageDir: root } = await registry.createTestDir({
        bunfigOpts: { saveTextLockfile: true },
        files: {
          "package.json": JSON.stringify({
            name: "root",
            workspaces: { catalog: { leaf: "^2.0.0" } },
            dependencies: { "wants-leaf-optional": "1.0.0" },
          }),
        },
      });
      const expectLayout = async () => {
        expect(installedPackages(root)).toEqual(
          linker === "isolated"
            ? [".bun/wants-leaf-optional@1.0.0/node_modules/wants-leaf-optional/wants-leaf-optional@1.0.0"]
            : ["wants-leaf-optional/wants-leaf-optional@1.0.0"],
        );
        expect(existsSync(join(root, "node_modules", "wants-leaf-optional", "package.json"))).toBeTrue();
        const lockfile = await readLockfile(root);
        expect(lockfile.catalog).toEqual({ leaf: "^2.0.0" });
        expect(lockfile.packages).toEqual({
          "wants-leaf-optional": [
            "wants-leaf-optional@1.0.0",
            expect.stringMatching(/^http:\/\/.*\/wants-leaf-optional-1\.0\.0\.tgz$/),
            { optionalDependencies: { leaf: "catalog:" } },
            expect.any(String),
          ],
        });
      };

      const first = await install(root, linker);
      expect(first.err).toContain("Saved lockfile");
      await expectLayout();
      const text = await lockfileText(root);

      await rm(join(root, "node_modules"), { recursive: true, force: true });
      const warm = await install(root, linker);
      expect(warm.err).not.toContain("Saved lockfile");
      expect(await lockfileText(root)).toBe(text);
      await expectLayout();

      await rm(join(root, "node_modules"), { recursive: true, force: true });
      const frozen = await install(root, linker, "--frozen-lockfile");
      expect(frozen.err).not.toContain("lockfile had changes");
      expect(await lockfileText(root)).toBe(text);
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

  /** Every `bun.lock` package entry keyed by its path in the tree: `{ "lib/no-deps": "no-deps@2.0.0", ... }`. */
  async function packages(dir: string) {
    return resolutions(await readLockfile(dir));
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

  const workspacePackages = { app: "app@workspace:packages/app", lib: "lib@workspace:packages/lib" };
  // `one-fixed-dep@2.0.0` depends on `no-deps@2.0.0`, app on `no-deps@1.0.0`, which wins the root slot
  const dedupedPackages = {
    ...workspacePackages,
    "no-deps": "no-deps@1.0.0",
    "one-fixed-dep": "one-fixed-dep@2.0.0",
    "one-fixed-dep/no-deps": "no-deps@2.0.0",
  };
  const nestedPackages = { ...dedupedPackages, "lib/no-deps": "no-deps@2.0.0" };
  const isolatedNoDeps = (version: string) =>
    join("..", "..", "..", "node_modules", ".bun", `no-deps@${version}`, "node_modules", "no-deps");
  const isolatedNoDeps2 = isolatedNoDeps("2.0.0");
  const linkers = ["hoisted", "isolated"] as const;

  test.concurrent("default catalog peer dedupes onto the satisfying ancestor", async () => {
    const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker: "hoisted" });
    await install(dir, "hoisted");
    expect(await packages(dir)).toStrictEqual(dedupedPackages);
    expect(existsSync(join(dir, "packages", "lib", "node_modules", "no-deps"))).toBeFalse();
  });

  test.concurrent("named catalog peer (catalog:peers) dedupes the same way", async () => {
    const dir = await makeRepo({
      catalogs: { peers: { "no-deps": ">=1.0.0" } },
      peerSpec: "catalog:peers",
      linker: "hoisted",
    });
    await install(dir, "hoisted");
    expect(await packages(dir)).toStrictEqual(dedupedPackages);
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
    expect(await packages(dir)).toStrictEqual(dedupedPackages);
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
    expect(await packages(dir)).toStrictEqual({
      ...workspacePackages,
      "@scoped/has-bin-entry": "@scoped/has-bin-entry@1.0.0",
    });
    expect(existsSync(join(dir, "packages", "lib", "node_modules", "@scoped"))).toBeFalse();
  });

  /** Installs `dir` fresh, then again from its bun.lock, and records the packages and the peer's layout both times. */
  async function record(dir: string, linker: Linker, peerName?: string) {
    await install(dir, linker);
    const fresh = { packages: await packages(dir), layout: await layout(dir, peerName) };
    await rmNodeModules(dir);
    const { err } = await install(dir, linker);
    const reload = { packages: await packages(dir), layout: await layout(dir, peerName) };
    return { fresh, reload, reloadSavedLockfile: err.includes("Saved lockfile") };
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

        const expectedPackages = outcome === "dedupes" ? dedupedPackages : nestedPackages;
        expect(fromInline.fresh.packages).toStrictEqual(expectedPackages);
        expect(fromInline.reload.packages).toStrictEqual(expectedPackages);
        expect(fromInline.reloadSavedLockfile).toBeFalse();
        if (linker === "isolated") {
          expect(fromInline.fresh.layout).toEndWith(isolatedNoDeps2);
          expect(fromInline.reload.layout).toEndWith(isolatedNoDeps2);
        } else {
          const expectedLayout = outcome === "dedupes" ? "<hoisted>" : "nested:2.0.0";
          expect(fromInline.fresh.layout).toBe(expectedLayout);
          expect(fromInline.reload.layout).toBe(expectedLayout);
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
      expect(fromInline.fresh.packages).toStrictEqual(dedupedPackages);
      expect(fromInline.reload.packages).toStrictEqual(dedupedPackages);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toStrictEqual(fromInline);
    });

    test.concurrent("aliased catalog entry peer matches the inline alias", async () => {
      const [catalogDir, inlineDir] = await Promise.all([
        makeRepo({ catalog: { "no-deps": "npm:no-deps@>=1.0.0" }, peerSpec: "catalog:", linker }),
        makeRepo({ peerSpec: "npm:no-deps@>=1.0.0", linker }),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
      expect(fromInline.reload).toStrictEqual(fromInline.fresh);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toStrictEqual(fromInline);
    });

    test.concurrent("optional catalog peer matches the inline optional peer on reload", async () => {
      const [catalogDir, inlineDir] = await Promise.all([
        makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", optionalPeer: true, linker }),
        makeRepo({ peerSpec: ">=1.0.0", optionalPeer: true, linker }),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
      expect(fromInline.fresh.packages).toStrictEqual(dedupedPackages);
      expect(fromInline.reload.packages).toStrictEqual(dedupedPackages);
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
        expect(fromInline.fresh.packages).toStrictEqual({
          ...workspacePackages,
          "app2": "app2@workspace:packages/app2",
          "app2/no-deps": "no-deps@2.0.0",
          "no-deps": "no-deps@1.0.0",
        });
        expect(fromInline.reload).toStrictEqual(fromInline.fresh);
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
    expect(await packages(dir)).toStrictEqual(dedupedPackages);
    expect(await layout(dir)).toBe("<hoisted>");

    await rewriteRootPackageJson(dir, { catalog: { "no-deps": "^2.0.0" } });
    let { err } = await install(dir, "hoisted");
    expect(err).toContain("Saved lockfile");
    expect(await packages(dir)).toStrictEqual(nestedPackages);
    expect(await layout(dir)).toBe("nested:2.0.0");

    await rewriteRootPackageJson(dir, { catalog: { "no-deps": ">=1.0.0" } });
    ({ err } = await install(dir, "hoisted"));
    expect(err).toContain("Saved lockfile");
    expect(await packages(dir)).toStrictEqual(dedupedPackages);
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
      expect(result.fresh.layout).toEndWith(isolatedNoDeps("1.0.0"));
      expect(result).toStrictEqual({
        fresh: {
          packages: {
            ...workspacePackages,
            "a-dep": "a-dep@1.0.1",
            "no-deps": "no-deps@1.0.0",
            "one-fixed-dep": "one-fixed-dep@2.0.0",
          },
          layout: result.fresh.layout,
        },
        reload: result.fresh,
        reloadSavedLockfile: false,
      });
    });
  });

  // Only the entry the spec names is `^2.0.0`; a `>=1.0.0` decoy (in another group, or under the other default spelling — one name in both is an error) or an unresolved peer would give dedupedPackages instead (pnpm: resolveFromCatalog.test.ts).
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
      const nested = { packages: nestedPackages, layout: "nested:2.0.0" };
      expect(await record(dir, "hoisted")).toStrictEqual({ fresh: nested, reload: nested, reloadSavedLockfile: false });
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
      const deduped = { packages: dedupedPackages, layout: "<hoisted>" };
      expect(await record(dir, "hoisted")).toStrictEqual({
        fresh: deduped,
        reload: deduped,
        reloadSavedLockfile: false,
      });
    });
  });

  // app's own `no-deps@1.0.0` is hoisted, the registry package's `catalog:` peer binds to it instead of the root catalog
  const registryPeerPackages = (catalogPeerVersion: string) => ({
    ...workspacePackages,
    "catalog-peer": `catalog-peer@${catalogPeerVersion}`,
    "no-deps": "no-deps@1.0.0",
  });

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
      });
      const expected = {
        ...workspacePackages,
        "leaf": "leaf@1.0.0",
        "lib/leaf": "leaf@2.0.0",
        "needs-leaf-2": "needs-leaf-2@1.0.0",
        "needs-leaf-2/leaf": "leaf@2.0.0",
        "wants-leaf-peer": "wants-leaf-peer@1.0.0",
      };

      await install(dir, linker);
      expect(await packages(dir)).toStrictEqual(expected);
      const lockfile = await readLockfile(dir);
      expect(lockfile.packages["wants-leaf-peer"][2]).toEqual({
        peerDependencies: { leaf: "catalog:" },
        optionalPeers: ["leaf"],
      });
      const text = await lockfileText(dir);

      await rmNodeModules(dir);
      const frozen = await install(dir, linker, "--frozen-lockfile");
      expect(frozen.err).not.toContain("lockfile had changes");
      expect(await lockfileText(dir)).toBe(text);
      expect(await packages(dir)).toStrictEqual(expected);
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
        expect(await packages(dir)).toStrictEqual(registryPeerPackages("1.0.0"));
        expect(await boundPeer()).toBe(expected);

        await rmNodeModules(dir);
        const { err } = await install(dir, linker);
        expect(err).not.toContain("Saved lockfile");
        expect(await packages(dir)).toStrictEqual(registryPeerPackages("1.0.0"));
        expect(await boundPeer()).toBe(expected);
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
      expect(result.fresh.packages).toStrictEqual({
        ...workspacePackages,
        "no-deps": "no-deps@1.0.0",
        "peer-deps-fixed": "peer-deps-fixed@1.0.0",
      });
      expect(result.reload.packages).toStrictEqual(result.fresh.packages);
      expect(result.reloadSavedLockfile).toBeFalse();
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
    });
    const result = await record(dir, "hoisted");
    expect(result.fresh.packages).toStrictEqual({ ...workspacePackages, "catalog-peer": "catalog-peer@1.0.0" });
    expect(result.reload.packages).toStrictEqual(result.fresh.packages);
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
    });
    const result = await record(dir, "hoisted");
    expect(result.fresh.packages).toStrictEqual(registryPeerPackages("2.0.0"));
    expect(result.reload.packages).toStrictEqual(result.fresh.packages);
    expect(result.reloadSavedLockfile).toBeFalse();
    expect(existsSync(join(dir, "node_modules", "catalog-peer", "node_modules"))).toBeFalse();
  });

  test.concurrent("changing the root catalog does not re-resolve a registry package's catalog: peer", async () => {
    const dir = await makeRepo({
      rootDependencies: {},
      catalog: { "no-deps": "^1.0.0" },
      appDependencies: { "no-deps": "1.0.0", "catalog-peer": "1.0.0" },
      peerSpec: "*",
      linker: "hoisted",
    });
    await install(dir, "hoisted");
    expect(await packages(dir)).toStrictEqual(registryPeerPackages("1.0.0"));

    await rewriteRootPackageJson(dir, { rootDependencies: {}, catalog: { "no-deps": "^2.0.0" } });
    await install(dir, "hoisted");
    expect(await packages(dir)).toStrictEqual(registryPeerPackages("1.0.0"));
    expect((await readLockfile(dir)).catalog).toEqual({ "no-deps": "^2.0.0" });

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
      expect(await packages(dir)).toStrictEqual({
        "app": "app@workspace:packages/app",
        "app/vendored": "vendored@file:vendor/vendored",
        "no-deps": "no-deps@1.0.0",
      });
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
        expect(result).toStrictEqual({
          fresh: {
            packages: { ...workspacePackages, "no-deps": "no-deps@1.0.0", "one-fixed-dep": "one-fixed-dep@2.0.0" },
            layout: linker === "isolated" ? expect.stringContaining(isolatedNoDeps("1.0.0")) : "<hoisted>",
          },
          reload: result.fresh,
          reloadSavedLockfile: false,
        });
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

  // package.json is edited after the install so bun.lock's catalogs are the ones that lack the entry.
  describe.each([
    ["a-dep", "catalog:"],
    ["no-deps", "catalog:missing"],
  ] as const)("bun pm pack with a %s peer of %s missing from the lockfile's catalogs", (peerName, peerSpec) => {
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
