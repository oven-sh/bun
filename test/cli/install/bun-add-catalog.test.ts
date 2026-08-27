import { file, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  DirectoryTree,
  nodeModulesPackages,
  normalizeBunSnapshot,
  readdirSorted,
  runBunInstall,
  VerdaccioRegistry,
} from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

// The install cache (manifests and extracted tarballs) of one install that pulls every registry version the cases
// below resolve. It is written into each case's own directory, so a case's `bun add` resolves offline and cases never
// share a cache (concurrent installs into one cache race on Windows). A manifest is fresh for 300s after its fetch.
let cacheFiles: DirectoryTree = {};

// The cache's per-name index entries are links that installs write and never read, so only plain files are captured.
function captureCache(cacheDir: string) {
  const files: DirectoryTree = {};
  const capture = (dir: string) => {
    for (const entry of readdirSync(join(cacheDir, dir), { withFileTypes: true })) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) capture(path);
      else if (entry.isFile()) files[`.bun-cache/${path}`] = readFileSync(join(cacheDir, path));
    }
  };
  capture("");
  return files;
}

beforeAll(async () => {
  await registry.start();
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted", saveTextLockfile: true },
    files: {
      "package.json": JSON.stringify({ name: "warm", workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        dependencies: { "no-deps": "2.0.0", "a-dep": "1.0.10", "dep-with-tags": "1.0.1", "@types/no-deps": "2.0.0" },
      }),
      "packages/b/package.json": JSON.stringify({ name: "b", dependencies: { "no-deps": "1.1.0", "a-dep": "1.0.1" } }),
      "packages/c/package.json": JSON.stringify({ name: "c", dependencies: { "no-deps": "1.0.0" } }),
      "packages/d/package.json": JSON.stringify({ name: "d", dependencies: { "no-deps": "1.0.1" } }),
    },
  });
  await runBunInstall(envFor(packageDir), packageDir);
  cacheFiles = captureCache(join(packageDir, ".bun-cache"));
  expect(Object.keys(cacheFiles).filter(path => path.endsWith(".npm"))).toHaveLength(4);
});

afterAll(() => {
  registry.stop();
});

const PKG1 = JSON.stringify({ name: "pkg1", version: "1.0.0" });
const PKG2 = JSON.stringify({ name: "pkg2", version: "1.0.0" });
// `bun add` re-prints the package.json it edits; fixtures asserted byte-for-byte afterwards are written in that shape.
const pretty = (json: Record<string, unknown>) => JSON.stringify(json, null, 2);

const withPkg2 = (pkg2: Record<string, unknown> | string = PKG2) => ({
  "packages/pkg2/package.json": typeof pkg2 === "string" ? pkg2 : JSON.stringify(pkg2),
});

const workspacesObject = (catalogs: Record<string, unknown> = {}) => ({
  name: "root",
  workspaces: { packages: ["packages/*"], ...catalogs },
});

// bun.lock rows for the fixtures above.
const ROOT_ROW = { name: "root" };
const PKG1_ROW = { name: "pkg1", version: "1.0.0" };
const PKG2_ROW = { name: "pkg2", version: "1.0.0" };
const PKG1_LINK = { pkg1: "pkg1@workspace:packages/pkg1" };
const PKG2_LINK = { pkg2: "pkg2@workspace:packages/pkg2" };

// CI's per-file BUN_INSTALL_CACHE_DIR overrides bunfig's cache; concurrent installs sharing it race on Windows.
function envFor(packageDir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };
}

type Result = { stdout: string; stderr: string; exitCode: number; packageDir: string };

type LockState = {
  workspaces: Record<string, unknown>;
  catalog?: Record<string, string>;
  catalogs?: Record<string, Record<string, string>>;
  packages: Record<string, string>;
};

async function spawnBun(
  packageDir: string,
  cwd: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, packageDir } satisfies Result;
}

const ADD = "bun add <version> (<revision>)";
const INSTALL = "bun install <version> (<revision>)";
const UPDATE = "bun update <version> (<revision>)";
const REMOVE = "bun remove <version> (<revision>)";
const SAVED = "Saved lockfile";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
// `bun add` lists the packages it was asked for, then how many packages this run put in place (workspace links and
// moved copies included).
const added = (packages: number, ...rows: string[]) => [
  ADD,
  "",
  ...rows,
  "",
  `${plural(packages, "package")} installed`,
];
// A `bun add` that changes no install ends with ` done` instead of a count.
const unchangedAdd = (...rows: string[]) => [ADD, "", ...rows, " done"];
const freshInstall = (packages: number) => [INSTALL, "", `${plural(packages, "package")} installed`];
const checked = (installs: number, packages: number) => [
  INSTALL,
  "",
  `Checked ${installs} installs across ${packages} packages (no changes)`,
];

// Output as lines. Two things depend on whether a manifest came from the copied cache or was fetched again, not on
// the behavior under test, so they are dropped: the two resolve progress lines, and the "(vX.Y.Z available)" hint
// a `+ name@version` row carries when the manifest lists a newer version.
function lines({ packageDir }: Result, output: string): readonly unknown[] {
  const normalized = normalizeBunSnapshot(output, packageDir);
  return (normalized === "" ? [] : normalized.split("\n"))
    .filter(line => line !== "Resolving dependencies" && !line.startsWith("Resolved, downloaded and extracted ["))
    .map(line => line.replace(/^(\+ \S+) \(v[\d.]+ available\)$/, "$1"));
}

// `stdout` and `stderr` are whole outputs, line by line; a row may be an `expect.stringMatching` matcher.
function expectOk(result: Result, stdout: readonly unknown[], stderr: readonly unknown[] = [SAVED]) {
  expect(lines(result, result.stdout)).toEqual(stdout);
  expect(lines(result, result.stderr)).toEqual(stderr);
  expect(result.exitCode).toBe(0);
}

function expectRefused(result: Result, stderr: readonly unknown[], stdout: readonly unknown[] = [ADD]) {
  expect(lines(result, result.stdout)).toEqual(stdout);
  expect(lines(result, result.stderr)).toEqual(stderr);
  expect(result.exitCode).toBe(1);
}

// A remote tarball is re-linked by every install, so its `--frozen-lockfile` summary is not a "no changes" line.
function expectFrozenOk(result: Result) {
  expect(lines(result, result.stderr)).toEqual([]);
  expect(result.exitCode).toBe(0);
}

async function createDir(
  root: Record<string, unknown> | string,
  pkg1: Record<string, unknown> | string = PKG1,
  extraFiles: Record<string, string> = {},
  linker: "hoisted" | "isolated" = "hoisted",
) {
  const rootText = typeof root === "string" ? root : JSON.stringify(root);
  const pkg1Text = typeof pkg1 === "string" ? pkg1 : JSON.stringify(pkg1);
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker, saveTextLockfile: true },
    files: {
      "package.json": rootText,
      "packages/pkg1/package.json": pkg1Text,
      ...extraFiles,
      ...cacheFiles,
    },
  });

  const rootPath = join(packageDir, "package.json");
  const pkg1Dir = join(packageDir, "packages", "pkg1");
  const pkg2Dir = join(packageDir, "packages", "pkg2");
  const pkg1Path = join(pkg1Dir, "package.json");
  const pkg2Path = join(pkg2Dir, "package.json");
  const pkg2Text = extraFiles["packages/pkg2/package.json"];
  const env = envFor(packageDir);
  const text = (path: string) => file(path).text();
  const lockText = () => text(join(packageDir, "bun.lock"));
  const lockExists = () => file(join(packageDir, "bun.lock")).exists();
  const members = Object.keys(extraFiles)
    .map(path => path.match(/^packages\/([^/]+)\/package\.json$/)?.[1])
    .filter((member): member is string => member !== undefined);
  // Every package folder under the root's and each member's node_modules as `<folder>/<name>@<version>`. Links
  // (workspace members, the isolated linker's node_modules entries) are not folders and are left out.
  const folders = (nodeModules: string) =>
    nodeModulesPackages(join(packageDir, nodeModules))
      .split("\n")
      .filter(Boolean)
      .map(folder => `${nodeModules}/${folder}`);

  const dir = {
    packageDir,
    env,
    pkg1Dir,
    pkg2Dir,
    rootPath,
    run: (cwd: string, args: readonly string[], spawnEnv: Record<string, string | undefined> = env) =>
      spawnBun(packageDir, cwd, args, spawnEnv),
    add: (cwd: string, ...args: string[]) => spawnBun(packageDir, cwd, ["add", ...args], env),
    install: () => spawnBun(packageDir, packageDir, ["install"], env),
    frozen: () => spawnBun(packageDir, packageDir, ["install", "--frozen-lockfile"], env),
    root: () => file(rootPath).json(),
    pkg1: () => file(pkg1Path).json(),
    pkg2: () => file(pkg2Path).json(),
    rootText: () => text(rootPath),
    pkg1Text: () => text(pkg1Path),
    pkg2Text: () => text(pkg2Path),
    lockText,
    lockExists,
    // The bun.lock rows a catalog add touches: every workspace's dependency groups, both catalog sections, and the
    // entry each package path resolved to.
    lock: async (): Promise<LockState> => {
      const { workspaces, catalog, catalogs, packages } = Bun.JSONC.parse(await lockText()) as {
        workspaces: Record<string, unknown>;
        catalog?: Record<string, string>;
        catalogs?: Record<string, Record<string, string>>;
        packages: Record<string, [string, ...unknown[]]>;
      };
      return {
        workspaces,
        ...(catalog && { catalog }),
        ...(catalogs && { catalogs }),
        packages: Object.fromEntries(Object.entries(packages).map(([path, [entry]]) => [path, entry])),
      };
    },
    installed: () => [
      ...folders("node_modules"),
      ...["pkg1", ...members].flatMap(member => folders(`packages/${member}/node_modules`)),
    ],
    memberVersion: (member: string, name: string) =>
      file(join(packageDir, "packages", member, "node_modules", name, "package.json"))
        .json()
        .then(pkg => pkg.version),
    store: () => readdirSorted(join(packageDir, "node_modules", ".bun")),
    // Every package.json reads back exactly as this case wrote it.
    expectPackageJsonsUntouched: async () => {
      expect(await text(rootPath)).toBe(rootText);
      expect(await text(pkg1Path)).toBe(pkg1Text);
      if (pkg2Text !== undefined) expect(await text(pkg2Path)).toBe(pkg2Text);
    },
    // Nothing was written at all: the package.json files are as written, and there is no bun.lock or node_modules.
    expectNothingWritten: async () => {
      await dir.expectPackageJsonsUntouched();
      expect(await lockExists()).toBeFalse();
      expect(existsSync(join(packageDir, "node_modules"))).toBeFalse();
      expect(existsSync(join(pkg1Dir, "node_modules"))).toBeFalse();
    },
  };
  return dir;
}

const note = (name: string, where: string, entry: string, was: string) =>
  `note: ${name} in ${where} now follows the catalog entry "${entry}" instead of "${was}"`;
const keeps = (name: string, where: string, literal: string, entry: string) =>
  `note: ${name} in ${where} keeps "${literal}" because the catalog entry is "${entry}"`;
// Printed when an explicit version replaces an existing entry; names the other members that resolve through it.
const changed = (name: string, from: string, to: string, alsoUsedBy?: string) =>
  `note: catalog entry ${name} changed from "${from}" to "${to}"${alsoUsedBy ? ` (also used by ${alsoUsedBy})` : ""}`;

describe.concurrent("bun add --catalog", () => {
  test("default catalog from a workspace member", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), added(2, "installed no-deps@2.0.0"));

    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "catalog:" } });
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } } },
      catalog: { "no-deps": "^2.0.0" },
      packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
    });

    expectOk(await dir.frozen(), checked(2, 3), []);
  });

  test("named catalog creates the catalogs object", async () => {
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));

    expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=testing"), added(2, "installed a-dep@1.0.10"));

    expect(await dir.pkg1()).toStrictEqual({
      name: "pkg1",
      version: "1.0.0",
      dependencies: { "a-dep": "catalog:testing" },
    });
    expect(await dir.root()).toStrictEqual(
      workspacesObject({ catalog: { "no-deps": "1.0.0" }, catalogs: { testing: { "a-dep": "^1.0.10" } } }),
    );
    expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "a-dep": "catalog:testing" } } },
      catalog: { "no-deps": "1.0.0" },
      catalogs: { testing: { "a-dep": "^1.0.10" } },
      packages: { ...PKG1_LINK, "a-dep": "a-dep@1.0.10" },
    });
  });

  describe("placement when no catalog is defined yet", () => {
    test("workspaces object gets workspaces.catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), added(2, "installed no-deps@2.0.0"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^2.0.0" });
    });

    test("workspaces array gets a top-level catalog", async () => {
      const dir = await createDir({ name: "root", workspaces: ["packages/*"] });

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), added(2, "installed no-deps@2.0.0"));

      expect(await dir.root()).toStrictEqual({
        name: "root",
        workspaces: ["packages/*"],
        catalog: { "no-deps": "^2.0.0" },
      });
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^2.0.0" });
    });
  });

  describe("existing top-level placement is respected", () => {
    const topLevel = { name: "root", catalog: { "no-deps": "1.0.0" }, workspaces: ["packages/*"] };

    test("default catalog", async () => {
      const dir = await createDir(topLevel);

      expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog"), added(2, "installed a-dep@1.0.10"));

      const root = await dir.root();
      expect(root).toStrictEqual({
        name: "root",
        catalog: { "a-dep": "^1.0.10", "no-deps": "1.0.0" },
        workspaces: ["packages/*"],
      });
      expect(Object.keys(root.catalog)).toStrictEqual(["a-dep", "no-deps"]);
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { "a-dep": "catalog:" } });
      expect((await dir.lock()).catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": "1.0.0" });
    });

    test("named catalog", async () => {
      const dir = await createDir(topLevel);

      expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=x"), added(2, "installed a-dep@1.0.10"));

      expect(await dir.root()).toStrictEqual({
        name: "root",
        catalog: { "no-deps": "1.0.0" },
        catalogs: { x: { "a-dep": "^1.0.10" } },
        workspaces: ["packages/*"],
      });
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "a-dep": "catalog:x" },
      });
      const lock = await dir.lock();
      expect(lock.catalog).toEqual({ "no-deps": "1.0.0" });
      expect(lock.catalogs).toEqual({ x: { "a-dep": "^1.0.10" } });
    });

    test("workspaces.catalog wins when a top-level catalog also exists", async () => {
      const dir = await createDir({
        name: "root",
        catalog: { "a-dep": "1.0.1" },
        workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
      });

      expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog"), added(2, "installed a-dep@1.0.10"));

      const root = await dir.root();
      expect(root).toStrictEqual({
        name: "root",
        catalog: { "a-dep": "1.0.1" },
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "^1.0.10", "no-deps": "1.0.0" } },
      });
      expect(Object.keys(root.workspaces.catalog)).toStrictEqual(["a-dep", "no-deps"]);
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { "a-dep": "catalog:" } });
      expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10"]);
      expect((await dir.lock()).catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": "1.0.0" });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });
  });

  describe("flag spelling", () => {
    const seeded = workspacesObject({ catalog: { "no-deps": "^2.0.0" } });

    test("--catalog before the package name does not swallow it", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "--catalog", "no-deps"), added(2, "installed no-deps@2.0.0"));

      expect(await dir.root()).toStrictEqual(seeded);
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^2.0.0" });
    });

    test("a word after --catalog is a package, not the catalog name", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(
        await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "a-dep"),
        added(3, "installed no-deps@2.0.0", "installed a-dep@1.0.10"),
      );

      const root = await dir.root();
      expect(root).toStrictEqual(workspacesObject({ catalog: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } }));
      expect(Object.keys(root.workspaces.catalog)).toStrictEqual(["a-dep", "no-deps"]);
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" },
      });
      expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10", "node_modules/no-deps/no-deps@2.0.0"]);
      expect((await dir.lock()).catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": "^2.0.0" });
    });

    test.each(["--catalog=", "--catalog= "])("%p is the default catalog", async flag => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", flag), added(2, "installed no-deps@2.0.0"));

      expect(await dir.root()).toStrictEqual(seeded);
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } } },
        catalog: { "no-deps": "^2.0.0" },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("pnpm's --save-catalog is ignored and the package is added directly", async () => {
      const root = pretty(workspacesObject({ catalog: {} }));
      const dir = await createDir(root);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--save-catalog"), added(2, "installed no-deps@2.0.0"));

      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "^2.0.0" } });
      expect(await dir.rootText()).toBe(root);
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "^2.0.0" } } },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
      });
    });
  });

  describe("catalog literal", () => {
    test.each([
      { args: "no-deps@1.0.0 --catalog", entry: "1.0.0", version: "1.0.0" },
      { args: "no-deps@^1.0.0 --catalog", entry: "^1.0.0", version: "1.1.0" },
      { args: "no-deps --catalog --exact", entry: "2.0.0", version: "2.0.0" },
    ])("bun add $args writes $entry", async ({ args, entry, version }) => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, ...args.split(" ")), added(2, `installed no-deps@${version}`));

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": entry } }));
      expect(dir.installed()).toEqual([`node_modules/no-deps/no-deps@${version}`]);
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } } },
        catalog: { "no-deps": entry },
        packages: { ...PKG1_LINK, "no-deps": `no-deps@${version}` },
      });
    });
  });

  // pnpm keeps an existing entry as written when a bare name is added to the catalog.
  test("a bare name reuses an existing catalog entry", async () => {
    const pkg1 = pretty({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), pkg1);

    expectOk(await dir.install(), freshInstall(2));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
    const lockBefore = await dir.lockText();

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), unchangedAdd("installed no-deps@1.1.0"), []);

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
    expect(await dir.pkg1Text()).toBe(pkg1);
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
    expect(await dir.lockText()).toBe(lockBefore);
    expect((await dir.lock()).catalog).toEqual({ "no-deps": "^1.0.0" });

    expectOk(await dir.frozen(), checked(2, 3), []);
  });

  test("an existing entry is reused by a new consumer without touching the other members", async () => {
    const pkg1 = JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), pkg1, withPkg2());
    expectOk(await dir.install(), freshInstall(3));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);

    expectOk(await dir.add(dir.pkg2Dir, "no-deps", "--catalog"), unchangedAdd("installed no-deps@1.1.0"));

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
    expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", version: "1.0.0", dependencies: { "no-deps": "catalog:" } });
    expect(await dir.pkg1Text()).toBe(pkg1);
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: {
        "": ROOT_ROW,
        "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
        "packages/pkg2": { ...PKG2_ROW, dependencies: { "no-deps": "catalog:" } },
      },
      catalog: { "no-deps": "^1.0.0" },
      packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.1.0" },
    });

    expectOk(await dir.frozen(), checked(3, 4), []);
  });

  test("an existing entry wins over the range the target declares directly", async () => {
    const pkg2 = JSON.stringify({ name: "pkg2", dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(
      workspacesObject({ catalog: { "no-deps": "1.0.0" } }),
      { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
      withPkg2(pkg2),
    );
    expectOk(await dir.install(), freshInstall(4));
    expect(dir.installed()).toEqual([
      "node_modules/no-deps/no-deps@1.1.0",
      "packages/pkg2/node_modules/no-deps/no-deps@1.0.0",
    ]);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), added(1, "installed no-deps@1.0.0"), [
      note("no-deps", "pkg1", "1.0.0", "^1.0.0"),
      SAVED,
    ]);

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
    expect(await dir.pkg2Text()).toBe(pkg2);
    // Both members now resolve to the hoisted 1.0.0; the copy the first install nested under pkg2 is left in place.
    expect(dir.installed()).toEqual([
      "node_modules/no-deps/no-deps@1.0.0",
      "packages/pkg2/node_modules/no-deps/no-deps@1.0.0",
    ]);
    expect(await dir.lock()).toEqual({
      workspaces: {
        "": ROOT_ROW,
        "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
        "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
      },
      catalog: { "no-deps": "1.0.0" },
      packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.0.0" },
    });

    expectOk(await dir.frozen(), checked(3, 4), []);
  });

  test("--silent prints no note when the target's range differs from the entry", async () => {
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), {
      name: "pkg1",
      dependencies: { "no-deps": "1.0.0" },
    });

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--silent"), [], []);

    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
  });

  test("the note names package.json when the target has no name", async () => {
    const dir = await createDir({
      dependencies: { "no-deps": "^1.0.0" },
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
    });

    expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog"), added(2, "installed no-deps@1.0.0"), [
      note("no-deps", "package.json", "1.0.0", "^1.0.0"),
      SAVED,
    ]);

    expect(await dir.root()).toStrictEqual({
      dependencies: { "no-deps": "catalog:" },
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
    });
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": { dependencies: { "no-deps": "catalog:" } }, "packages/pkg1": PKG1_ROW },
      catalog: { "no-deps": "1.0.0" },
      packages: { ...PKG1_LINK, "no-deps": "no-deps@1.0.0" },
    });
  });

  test("a tarball url the target declares is cataloged verbatim", async () => {
    const tarball = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "no-deps": tarball },
    });
    expectOk(await dir.install(), freshInstall(2));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), added(1, `installed no-deps@${tarball}`));

    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball } }));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } } },
      catalog: { "no-deps": tarball },
      packages: { ...PKG1_LINK, "no-deps": `no-deps@${tarball}` },
    });

    expectFrozenOk(await dir.frozen());
  });

  test("an explicit version equal to the existing entry leaves the root as it was", async () => {
    const root = pretty(workspacesObject({ catalog: { "a-dep": "1.0.1", "no-deps": "1.0.0" } }));
    const dir = await createDir(root);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.0", "--catalog"), added(2, "installed no-deps@1.0.0"));

    expect(await dir.rootText()).toBe(root);
    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "catalog:" } });
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
    expect((await dir.lock()).catalog).toEqual({ "a-dep": "1.0.1", "no-deps": "1.0.0" });
  });

  describe("explicit version inside an existing range", () => {
    test.each(["hoisted", "isolated"] as const)(
      "keeps the range and moves the installed version (%s)",
      async linker => {
        const member = (name: string) => pretty({ name, dependencies: { "no-deps": "catalog:" } });
        const dir = await createDir(
          workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
          member("pkg1"),
          withPkg2(member("pkg2")),
          linker,
        );
        const isolated = linker === "isolated";
        // The hoisted tree holds one copy at the root; the isolated store links each member to its own copy.
        const expectVersion = async (version: string) => {
          if (isolated) {
            expect(await dir.memberVersion("pkg1", "no-deps")).toBe(version);
            expect(await dir.memberVersion("pkg2", "no-deps")).toBe(version);
          } else {
            expect(dir.installed()).toEqual([`node_modules/no-deps/no-deps@${version}`]);
          }
        };

        expectOk(await dir.install(), freshInstall(isolated ? 1 : 3));
        await expectVersion("1.1.0");

        expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.0", "--catalog"), added(1, "installed no-deps@1.0.0"));

        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
        expect(await dir.pkg1Text()).toBe(member("pkg1"));
        expect(await dir.pkg2Text()).toBe(member("pkg2"));
        await expectVersion("1.0.0");
        if (isolated) {
          expect(await dir.store()).toContain("no-deps@1.0.0");
        }
        expect(await dir.lock()).toEqual({
          workspaces: {
            "": ROOT_ROW,
            "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
            "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
          },
          catalog: { "no-deps": "^1.0.0" },
          packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.0.0" },
        });

        expectOk(
          await dir.frozen(),
          isolated ? [INSTALL, "", "Done! Checked 4 packages (no changes)"] : checked(3, 4),
          [],
        );
        await expectVersion("1.0.0");
      },
    );

    test("a range that differs replaces the entry", async () => {
      const member = (name: string) => JSON.stringify({ name, dependencies: { "no-deps": "catalog:" } });
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
        member("pkg1"),
        withPkg2(member("pkg2")),
      );
      expectOk(await dir.install(), freshInstall(3));

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@^2.0.0", "--catalog"), added(1, "installed no-deps@2.0.0"), [
        changed("no-deps", "^1.0.0", "^2.0.0", "pkg2"),
        SAVED,
      ]);

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2Text()).toBe(member("pkg2"));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^2.0.0" });
    });
  });

  test("a dist-tag already in package.json is cataloged as that tag's range", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "dep-with-tags": "pre-1" },
    });

    expectOk(await dir.add(dir.pkg1Dir, "dep-with-tags", "--catalog"), added(2, "installed dep-with-tags@1.0.1"));

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "dep-with-tags": "^1.0.1" } }));
    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "dep-with-tags": "catalog:" } });
    expect(dir.installed()).toEqual(["node_modules/dep-with-tags/dep-with-tags@1.0.1"]);
    expect((await dir.lock()).catalog).toEqual({ "dep-with-tags": "^1.0.1" });

    expectOk(await dir.frozen(), checked(2, 3), []);
  });

  test("a direct exact pin in devDependencies is cataloged verbatim", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      devDependencies: { "no-deps": "1.0.0" },
    });

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--dev"), added(2, "installed no-deps@1.0.0"));

    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", devDependencies: { "no-deps": "catalog:" } });
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", devDependencies: { "no-deps": "catalog:" } } },
      catalog: { "no-deps": "1.0.0" },
      packages: { ...PKG1_LINK, "no-deps": "no-deps@1.0.0" },
    });

    expectOk(await dir.frozen(), checked(2, 3), []);
  });

  test("run from the workspace root", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog"), added(2, "installed no-deps@2.0.0"));

    expect(await dir.root()).toStrictEqual({
      name: "root",
      dependencies: { "no-deps": "catalog:" },
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^2.0.0" } },
    });
    expect(await dir.pkg1Text()).toBe(PKG1);
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": { ...ROOT_ROW, dependencies: { "no-deps": "catalog:" } }, "packages/pkg1": PKG1_ROW },
      catalog: { "no-deps": "^2.0.0" },
      packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
    });

    expectOk(await dir.frozen(), checked(2, 3), []);
  });

  test("bun install <pkg> --catalog --dev", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(
      await dir.run(dir.pkg1Dir, ["install", "no-deps", "--catalog", "--dev"]),
      added(2, "installed no-deps@2.0.0"),
    );

    expect(await dir.pkg1()).toStrictEqual({
      name: "pkg1",
      version: "1.0.0",
      devDependencies: { "no-deps": "catalog:" },
    });
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
  });

  test("several packages into a named catalog", async () => {
    const dir = await createDir(workspacesObject());

    expectOk(
      await dir.add(dir.pkg1Dir, "no-deps", "a-dep", "--catalog=libs"),
      added(3, "installed no-deps@2.0.0", "installed a-dep@1.0.10"),
    );

    expect(await dir.pkg1()).toStrictEqual({
      name: "pkg1",
      version: "1.0.0",
      dependencies: { "a-dep": "catalog:libs", "no-deps": "catalog:libs" },
    });
    const root = await dir.root();
    expect(root).toStrictEqual(workspacesObject({ catalogs: { libs: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } } }));
    expect(Object.keys(root.workspaces.catalogs.libs)).toStrictEqual(["a-dep", "no-deps"]);
    expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10", "node_modules/no-deps/no-deps@2.0.0"]);
    expect((await dir.lock()).catalogs).toEqual({ libs: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } });
  });

  describe.each(["member", "root"] as const)("from the %s", from => {
    test("--dry-run writes nothing", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      expectOk(
        await dir.add(cwd, "no-deps", "--catalog", "--dry-run"),
        [ADD, "", " pkg1@workspace:packages/pkg1", "installed no-deps@2.0.0", " done"],
        [],
      );

      await dir.expectNothingWritten();
    });

    test("--lockfile-only writes both files and bun.lock but installs nothing", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      expectOk(await dir.add(cwd, "no-deps", "--catalog", "--lockfile-only"), [ADD, "", "Saved bun.lock (3 packages)"]);

      if (from === "member") {
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
        expect(await dir.pkg1()).toStrictEqual({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "no-deps": "catalog:" },
        });
      } else {
        expect(await dir.root()).toStrictEqual({
          ...workspacesObject({ catalog: { "no-deps": "^2.0.0" } }),
          dependencies: { "no-deps": "catalog:" },
        });
        expect(await dir.pkg1Text()).toBe(PKG1);
      }
      expect(await dir.lock()).toEqual({
        workspaces:
          from === "member"
            ? { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } } }
            : { "": { ...ROOT_ROW, dependencies: { "no-deps": "catalog:" } }, "packages/pkg1": PKG1_ROW },
        catalog: { "no-deps": "^2.0.0" },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
      });
      expect(existsSync(join(dir.packageDir, "node_modules"))).toBeFalse();
      expect(existsSync(join(dir.pkg1Dir, "node_modules"))).toBeFalse();

      // Only the root's own dependencies get a `+` row.
      expectOk(
        await dir.frozen(),
        from === "member" ? freshInstall(2) : [INSTALL, "", "+ no-deps@2.0.0", "", "2 packages installed"],
        [],
      );
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
    });
  });

  describe("only the dependency group plain add edits is rewritten", () => {
    test("--optional", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--optional"), added(2, "installed no-deps@2.0.0"));

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        optionalDependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { ...PKG1_ROW, optionalDependencies: { "no-deps": "catalog:" } },
        },
        catalog: { "no-deps": "^2.0.0" },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("name in devDependencies and peerDependencies, adding with --dev", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), {
        name: "pkg1",
        devDependencies: { "no-deps": "1.0.0" },
        peerDependencies: { "no-deps": ">=1" },
      });

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--dev"), added(2, "installed no-deps@1.0.0"));

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        devDependencies: { "no-deps": "catalog:" },
        peerDependencies: { "no-deps": ">=1" },
      });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": {
            name: "pkg1",
            devDependencies: { "no-deps": "catalog:" },
            peerDependencies: { "no-deps": ">=1" },
          },
        },
        catalog: { "no-deps": "1.0.0" },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@1.0.0" },
      });
    });

    test("name only in peerDependencies, adding with --dev, matches plain add", async () => {
      const pkg1 = { name: "pkg1", peerDependencies: { "no-deps": ">=1" } };
      const [plain, catalog] = await Promise.all([
        createDir(workspacesObject({ catalog: {} }), pkg1),
        createDir(workspacesObject({ catalog: {} }), pkg1),
      ]);

      const [plainResult, catalogResult] = await Promise.all([
        plain.add(plain.pkg1Dir, "no-deps", "--dev"),
        catalog.add(catalog.pkg1Dir, "no-deps", "--dev", "--catalog"),
      ]);
      expectOk(plainResult, added(2, "installed no-deps@2.0.0"));
      expectOk(catalogResult, added(2, "installed no-deps@2.0.0"));

      const plainPkg1 = await plain.pkg1();
      const catalogPkg1 = await catalog.pkg1();
      expect(Object.keys(catalogPkg1)).toStrictEqual(Object.keys(plainPkg1));
      expect(plainPkg1).toStrictEqual({ name: "pkg1", peerDependencies: { "no-deps": "^2.0.0" } });
      expect(catalogPkg1).toStrictEqual({ name: "pkg1", peerDependencies: { "no-deps": "catalog:" } });
      // The peer range the target already declared is what the catalog records.
      expect(await catalog.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": ">=1" } }));
      expect(await plain.root()).toStrictEqual(workspacesObject({ catalog: {} }));
    });

    test("--peer", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--peer"), added(2, "installed no-deps@2.0.0"));

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        peerDependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect((await dir.lock()).workspaces["packages/pkg1"]).toEqual({
        ...PKG1_ROW,
        peerDependencies: { "no-deps": "catalog:" },
      });
    });
  });

  // pnpm: a dependency already on `catalog:<name>` stays in that catalog; the flag only picks the catalog for new references.
  describe("target already on a named catalog reference stays in that catalog", () => {
    const pkg1 = pretty({ name: "pkg1", dependencies: { "no-deps": "catalog:testing" } });
    const testingRoot = workspacesObject({ catalogs: { testing: { "no-deps": "1.0.0" } } });

    test.each([
      {
        args: "no-deps --catalog",
        entry: "1.0.0",
        stdout: unchangedAdd("installed no-deps@1.0.0"),
        stderr: [] as string[],
      },
      {
        args: "no-deps --catalog=other",
        entry: "1.0.0",
        stdout: unchangedAdd("installed no-deps@1.0.0"),
        stderr: [] as string[],
      },
      {
        args: "no-deps@1.1.0 --catalog",
        entry: "1.1.0",
        stdout: added(1, "installed no-deps@1.1.0"),
        stderr: [changed("no-deps", "1.0.0", "1.1.0"), SAVED],
      },
    ])("bun add $args", async ({ args, entry, stdout, stderr }) => {
      const dir = await createDir(testingRoot, pkg1);
      expectOk(await dir.install(), freshInstall(2));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);

      expectOk(await dir.add(dir.pkg1Dir, ...args.split(" ")), stdout, stderr);

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { testing: { "no-deps": entry } } }));
      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(dir.installed()).toEqual([`node_modules/no-deps/no-deps@${entry}`]);
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:testing" } } },
        catalogs: { testing: { "no-deps": entry } },
        packages: { ...PKG1_LINK, "no-deps": `no-deps@${entry}` },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("an explicit version inside the named entry's range moves the resolution within that catalog", async () => {
      const dir = await createDir(workspacesObject({ catalogs: { testing: { "no-deps": "^1.0.0" } } }), pkg1);
      expectOk(await dir.install(), freshInstall(2));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.1", "--catalog"), added(1, "installed no-deps@1.0.1"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { testing: { "no-deps": "^1.0.0" } } }));
      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.1"]);
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:testing" } } },
        catalogs: { testing: { "no-deps": "^1.0.0" } },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@1.0.1" },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });
  });

  describe("target on a named reference whose catalog has no entry", () => {
    const pkg1 = pretty({ name: "pkg1", dependencies: { "no-deps": "catalog:legacy" } });

    test.each([
      { flag: "--catalog", root: { catalog: {} } },
      { flag: "--catalog=other", root: { catalogs: { legacy: {} } } },
    ])("bun add no-deps $flag seeds that catalog and keeps the reference", async ({ flag, root }) => {
      const dir = await createDir(workspacesObject(root), pkg1);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", flag), added(2, "installed no-deps@2.0.0"));

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.root()).toStrictEqual(
        workspacesObject({ ...root, catalogs: { legacy: { "no-deps": "^2.0.0" } } }),
      );
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:legacy" } } },
        catalogs: { legacy: { "no-deps": "^2.0.0" } },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("an explicit version is written into that catalog", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.0", "--catalog=other"), added(2, "installed no-deps@1.0.0"));

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.root()).toStrictEqual(
        workspacesObject({ catalog: {}, catalogs: { legacy: { "no-deps": "1.0.0" } } }),
      );
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
      expect((await dir.lock()).catalogs).toEqual({ legacy: { "no-deps": "1.0.0" } });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });
  });

  describe("literals other than a bare name", () => {
    test("alias@npm:pkg is written verbatim, like plain add", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, "foo@npm:no-deps", "--catalog"), added(2, "installed foo@2.0.0"));

      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { foo: "catalog:" } });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { foo: "npm:no-deps" } }));
      expect(dir.installed()).toEqual(["node_modules/foo/no-deps@2.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { foo: "catalog:" } } },
        catalog: { foo: "npm:no-deps" },
        packages: { ...PKG1_LINK, foo: "no-deps@2.0.0" },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("alias@npm:pkg@dist-tag gets the resolved range", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, "foo@npm:no-deps@latest", "--catalog"), added(2, "installed foo@2.0.0"));

      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { foo: "catalog:" } });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { foo: "npm:no-deps@^2.0.0" } }));
      expect(dir.installed()).toEqual(["node_modules/foo/no-deps@2.0.0"]);
      expect((await dir.lock()).catalog).toEqual({ foo: "npm:no-deps@^2.0.0" });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("name@tarball-url is written verbatim, dist-tags become a range", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const tarball = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;

      expectOk(
        await dir.add(dir.pkg1Dir, `no-deps@${tarball}`, "dep-with-tags@pre-1", "--catalog"),
        added(3, `installed no-deps@${tarball}`, "installed dep-with-tags@1.0.1"),
      );

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "dep-with-tags": "catalog:", "no-deps": "catalog:" },
      });
      const catalog = { "dep-with-tags": "^1.0.1", "no-deps": tarball };
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog }));
      expect(dir.installed()).toEqual([
        "node_modules/dep-with-tags/dep-with-tags@1.0.1",
        "node_modules/no-deps/no-deps@1.0.0",
      ]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { ...PKG1_ROW, dependencies: { "dep-with-tags": "catalog:", "no-deps": "catalog:" } },
        },
        catalog,
        packages: { ...PKG1_LINK, "dep-with-tags": "dep-with-tags@1.0.1", "no-deps": `no-deps@${tarball}` },
      });

      expectFrozenOk(await dir.frozen());
    });

    test("scoped package into a named catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(
        await dir.add(dir.pkg1Dir, "@types/no-deps", "--catalog=types"),
        added(2, "installed @types/no-deps@2.0.0"),
      );

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "@types/no-deps": "catalog:types" },
      });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { types: { "@types/no-deps": "^2.0.0" } } }));
      expect(dir.installed()).toEqual(["node_modules/@types/no-deps/@types/no-deps@2.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { ...PKG1_ROW, dependencies: { "@types/no-deps": "catalog:types" } },
        },
        catalogs: { types: { "@types/no-deps": "^2.0.0" } },
        packages: { ...PKG1_LINK, "@types/no-deps": "@types/no-deps@2.0.0" },
      });
    });

    describe("positionals without a name", () => {
      const tarball = () => `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;
      const tarballRow = () => `+ no-deps@${tarball()}`;

      test.each(["member", "root"] as const)(
        "a tarball url is cataloged under the resolved name (from %s)",
        async from => {
          const dir = await createDir(workspacesObject({ catalog: {} }));

          const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
          expectOk(await dir.add(cwd, tarball(), "--catalog"), added(2, tarballRow()));

          if (from === "member") {
            expect(await dir.pkg1()).toStrictEqual({
              name: "pkg1",
              version: "1.0.0",
              dependencies: { "no-deps": "catalog:" },
            });
            expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball() } }));
          } else {
            expect(await dir.root()).toStrictEqual({
              ...workspacesObject({ catalog: { "no-deps": tarball() } }),
              dependencies: { "no-deps": "catalog:" },
            });
            expect(await dir.pkg1Text()).toBe(PKG1);
          }
          expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
          expect(await dir.lock()).toEqual({
            workspaces:
              from === "member"
                ? { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } } }
                : { "": { ...ROOT_ROW, dependencies: { "no-deps": "catalog:" } }, "packages/pkg1": PKG1_ROW },
            catalog: { "no-deps": tarball() },
            packages: { ...PKG1_LINK, "no-deps": `no-deps@${tarball()}` },
          });

          expectFrozenOk(await dir.frozen());
        },
      );

      test("--filter puts every selected member on the entry", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());

        expectOk(
          await dir.add(dir.packageDir, tarball(), "--catalog", "--filter", "pkg1", "--filter", "pkg2"),
          added(3, tarballRow()),
        );

        expect(await dir.pkg1()).toStrictEqual({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "no-deps": "catalog:" },
        });
        expect(await dir.pkg2()).toStrictEqual({
          name: "pkg2",
          version: "1.0.0",
          dependencies: { "no-deps": "catalog:" },
        });
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball() } }));
        expect(await dir.lock()).toEqual({
          workspaces: {
            "": ROOT_ROW,
            "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } },
            "packages/pkg2": { ...PKG2_ROW, dependencies: { "no-deps": "catalog:" } },
          },
          catalog: { "no-deps": tarball() },
          packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": `no-deps@${tarball()}` },
        });

        expectFrozenOk(await dir.frozen());
      });

      test("mixed with a named package", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));

        expectOk(
          await dir.add(dir.pkg1Dir, tarball(), "a-dep", "--catalog"),
          added(3, tarballRow(), "", "installed a-dep@1.0.10"),
        );

        expect(await dir.pkg1()).toStrictEqual({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" },
        });
        const catalog = (await dir.root()).workspaces.catalog;
        expect(catalog).toStrictEqual({ "a-dep": "^1.0.10", "no-deps": tarball() });
        expect(Object.keys(catalog)).toStrictEqual(["a-dep", "no-deps"]);
        expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10", "node_modules/no-deps/no-deps@1.0.0"]);
        expect((await dir.lock()).catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": tarball() });

        expectFrozenOk(await dir.frozen());
      });

      test("the entry is inserted in alphabetical order", async () => {
        const dir = await createDir(workspacesObject({ catalog: { zzz: "1.0.0" } }));

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"), added(2, tarballRow()));

        const catalog = (await dir.root()).workspaces.catalog;
        expect(catalog).toStrictEqual({ "no-deps": tarball(), zzz: "1.0.0" });
        expect(Object.keys(catalog)).toStrictEqual(["no-deps", "zzz"]);
        expect(await dir.pkg1()).toStrictEqual({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "no-deps": "catalog:" },
        });
        expect((await dir.lock()).catalog).toEqual({ "no-deps": tarball(), zzz: "1.0.0" });

        expectFrozenOk(await dir.frozen());
      });

      test("into a named catalog", async () => {
        const dir = await createDir(workspacesObject());

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog=vendored"), added(2, tarballRow()));

        expect(await dir.pkg1()).toStrictEqual({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "no-deps": "catalog:vendored" },
        });
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { vendored: { "no-deps": tarball() } } }));
        expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
        expect((await dir.lock()).catalogs).toEqual({ vendored: { "no-deps": tarball() } });

        expectFrozenOk(await dir.frozen());
      });

      test("an identical entry is reused", async () => {
        const root = workspacesObject({ catalog: { "no-deps": tarball() } });
        const pkg2 = JSON.stringify({ name: "pkg2", dependencies: { "no-deps": "catalog:" } });
        const dir = await createDir(root, PKG1, withPkg2(pkg2));
        expectOk(await dir.install(), freshInstall(3));

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"), added(1, tarballRow()));

        expect(await dir.pkg1()).toStrictEqual({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "no-deps": "catalog:" },
        });
        expect(await dir.root()).toStrictEqual(root);
        expect(await dir.pkg2Text()).toBe(pkg2);
        expect(await dir.lock()).toEqual({
          workspaces: {
            "": ROOT_ROW,
            "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } },
            "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
          },
          catalog: { "no-deps": tarball() },
          packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": `no-deps@${tarball()}` },
        });

        expectFrozenOk(await dir.frozen());
      });

      test("re-running is a no-op", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"), added(2, tarballRow()));
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball() } }));
        const [rootAfter, pkg1After, lockAfter] = await Promise.all([dir.rootText(), dir.pkg1Text(), dir.lockText()]);

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"), added(1, tarballRow()), []);

        expect(await dir.rootText()).toBe(rootAfter);
        expect(await dir.pkg1Text()).toBe(pkg1After);
        expect(await dir.lockText()).toBe(lockAfter);
      });

      test("a different existing entry keeps the package direct", async () => {
        const root = workspacesObject({ catalog: { "no-deps": "^1.0.0" } });
        const dir = await createDir(root, PKG1, withPkg2({ name: "pkg2", dependencies: { "no-deps": "catalog:" } }));
        expectOk(await dir.install(), freshInstall(3));

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"), added(2, `installed no-deps@${tarball()}`), [
          keeps("no-deps", "pkg1", tarball(), "^1.0.0"),
          SAVED,
        ]);

        expect(await dir.pkg1()).toStrictEqual({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "no-deps": tarball() },
        });
        expect(await dir.root()).toStrictEqual(root);
        // pkg1 is the first member, so its tarball is hoisted and pkg2's catalog version is nested.
        expect(dir.installed()).toEqual([
          "node_modules/no-deps/no-deps@1.0.0",
          "packages/pkg2/node_modules/no-deps/no-deps@1.1.0",
        ]);
        expect(await dir.lock()).toEqual({
          workspaces: {
            "": ROOT_ROW,
            "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": tarball() } },
            "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
          },
          catalog: { "no-deps": "^1.0.0" },
          packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": `no-deps@${tarball()}`, "pkg2/no-deps": "no-deps@1.1.0" },
        });

        expectFrozenOk(await dir.frozen());
      });

      // The name is only known after both rows resolved, so this is refused before anything is written; `name@url` binds the declaration instead.
      describe("a name the target already declares", () => {
        const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
        const refusal = () => [
          `error: --catalog cannot add "${tarball()}": pkg1 already declares no-deps`,
          `  bun add no-deps@${tarball()} --catalog`,
        ];

        test.each([
          { title: "alone", args: () => [tarball()] },
          { title: "next to a named package", args: () => ["a-dep", tarball()] },
        ])("is refused without writing anything ($title)", async ({ args }) => {
          const dir = await createDir(pretty(workspacesObject({ catalog: {} })), pretty(pkg1));

          expectRefused(await dir.add(dir.pkg1Dir, ...args(), "--catalog"), refusal());

          await dir.expectNothingWritten();
        });

        test("--filter refuses the whole command when one selected member declares it", async () => {
          const dir = await createDir(pretty(workspacesObject({ catalog: {} })), pretty(pkg1), withPkg2());

          expectRefused(await dir.add(dir.packageDir, tarball(), "--catalog", "--filter", "pkg*"), refusal());

          await dir.expectNothingWritten();
        });

        test("the suggested name@url spelling moves the declaration into the catalog", async () => {
          const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);

          expectOk(
            await dir.add(dir.pkg1Dir, `no-deps@${tarball()}`, "--catalog"),
            added(2, `installed no-deps@${tarball()}`),
          );

          expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
          expect((await dir.pkg1Text()).match(/"no-deps"/g)).toHaveLength(1);
          expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball() } }));
          expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
          expect(await dir.lock()).toEqual({
            workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } } },
            catalog: { "no-deps": tarball() },
            packages: { ...PKG1_LINK, "no-deps": `no-deps@${tarball()}` },
          });

          expectFrozenOk(await dir.frozen());
        });
      });

      test("an absolute local tarball path", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));
        await write(join(dir.packageDir, "vendor", "baz.tgz"), file(join(import.meta.dir, "baz-0.0.3.tgz")));
        const literal = join(dir.packageDir, "vendor", "baz.tgz").replaceAll("\\", "/");

        expectOk(await dir.add(dir.pkg1Dir, literal, "--catalog"), added(2, "+ baz@<dir>/vendor/baz.tgz"));

        expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { baz: "catalog:" } });
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { baz: literal } }));
        expect(dir.installed()).toEqual(["node_modules/baz/baz@0.0.3"]);
        expect(await dir.lock()).toEqual({
          workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { baz: "catalog:" } } },
          catalog: { baz: literal },
          packages: { ...PKG1_LINK, baz: `baz@${literal}` },
        });

        expectFrozenOk(await dir.frozen());
      });

      test("a url that fails to resolve writes nothing", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));
        const url = `${registry.registryUrl()}no-deps/-/no-deps-9.9.9.tgz`;

        expectRefused(await dir.add(dir.pkg1Dir, url, "--catalog"), [
          `error: GET ${url} - 404`,
          `error: Invalid dependency name "${url}"`,
          `error: ${url} failed to resolve`,
        ]);

        await dir.expectNothingWritten();
      });
    });
  });

  describe("workspace sibling", () => {
    const pkg2Message = 'error: --catalog cannot add a workspace package, but "pkg2" is the workspace at packages/pkg2';

    test.each(["member", "root"] as const)("bare name is refused before anything is written (from %s)", async from => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      expectRefused(await dir.add(cwd, "pkg2", "--catalog"), [pkg2Message]);

      await dir.expectNothingWritten();
    });

    test.each(["pkg2", "pkg2@1.0.0"])("%s with --filter is refused", async positional => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());

      expectRefused(await dir.add(dir.packageDir, positional, "--catalog", "--filter", "pkg1"), [pkg2Message]);

      await dir.expectNothingWritten();
    });

    test("name@version is refused", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());

      expectRefused(await dir.add(dir.pkg1Dir, "pkg2@1.0.0", "--catalog"), [pkg2Message]);

      await dir.expectNothingWritten();
    });

    test("the root package's name is refused", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectRefused(await dir.add(dir.pkg1Dir, "root", "--catalog"), [
        'error: --catalog cannot add a workspace package, but "root" is the workspace root',
      ]);

      await dir.expectNothingWritten();
    });

    test("a sibling whose name also exists on the registry is refused, not cataloged from the registry", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, {
        "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "9.0.0" }),
      });

      expectRefused(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), [
        'error: --catalog cannot add a workspace package, but "no-deps" is the workspace at packages/no-deps',
      ]);

      await dir.expectNothingWritten();
    });

    // A refused sibling that reached the registry would 404 there; the exact stderr shows it never did.
    test.each(["member", "root --filter pkg1"] as const)(
      "one refused name aborts the whole add before any network request (from %s)",
      async from => {
        const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());

        const result =
          from === "member"
            ? await dir.add(dir.pkg1Dir, "a-dep", "pkg2", "--catalog")
            : await dir.add(dir.packageDir, "a-dep", "pkg2", "--catalog", "--filter", "pkg1");
        expectRefused(result, [pkg2Message]);
        expect(result.stderr).not.toContain("Resolving dependencies");

        await dir.expectNothingWritten();
      },
    );

    test.each(["member", "root"] as const)("name@workspace:* is rejected (from %s)", async from => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      expectRefused(await dir.add(cwd, "pkg2@workspace:*", "--catalog"), [
        'error: --catalog cannot add a workspace package, but got "pkg2@workspace:*"',
      ]);

      await dir.expectNothingWritten();
    });

    test("name@workspace:* with --filter is rejected", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());

      expectRefused(await dir.add(dir.packageDir, "pkg2@workspace:*", "--catalog", "--filter", "pkg1"), [
        'error: --catalog cannot add a workspace package, but got "pkg2@workspace:*"',
      ]);

      await dir.expectNothingWritten();
    });
  });

  describe("local paths", () => {
    const localPathMessage = (spec: string) =>
      `error: --catalog cannot add "${spec}": a local path in the catalog would resolve from the workspace root, not from the package that added it`;

    test.each(["foo@file:../vendor/foo", "foo@link:../vendor/foo", "foo@./vendor/foo"])("%s is refused", async spec => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectRefused(await dir.add(dir.pkg1Dir, spec, "--catalog"), [localPathMessage(spec)]);

      await dir.expectNothingWritten();
    });

    test("a bare relative path is refused as a positional without a name", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectRefused(await dir.add(dir.pkg1Dir, "../../vendor/foo", "--catalog"), [
        localPathMessage("../../vendor/foo"),
      ]);

      await dir.expectNothingWritten();
    });

    test("an absolute file: path is cataloged verbatim", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, {
        "vendor/foo/package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
      });
      const literal = `file:${join(dir.packageDir, "vendor", "foo").replaceAll("\\", "/")}`;

      expectOk(await dir.add(dir.pkg1Dir, `foo@${literal}`, "--catalog"), added(2, "installed foo@vendor/foo"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { foo: literal } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { foo: "catalog:" } });
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { foo: "catalog:" } } },
        catalog: { foo: literal },
        packages: { ...PKG1_LINK, "pkg1/foo": "foo@file:vendor/foo" },
      });
      // Folder dependencies of a workspace are installed under that workspace's node_modules, not hoisted.
      expect(dir.installed()).toEqual(["packages/pkg1/node_modules/foo/foo@1.0.0"]);
    });
  });

  describe("--filter", () => {
    test("'*' alone edits the members and the root catalog, not the root's dependencies", async () => {
      const pkg1 = JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), pkg1, withPkg2());
      expectOk(await dir.install(), freshInstall(3));

      expectOk(
        await dir.add(dir.packageDir, "a-dep", "--catalog", "--filter", "*"),
        added(1, "installed a-dep@1.0.10"),
      );

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" },
      });
      expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", version: "1.0.0", dependencies: { "a-dep": "catalog:" } });
      expect(await dir.root()).toStrictEqual(
        workspacesObject({ catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" } }),
      );
      expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10", "node_modules/no-deps/no-deps@1.1.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" } },
          "packages/pkg2": { ...PKG2_ROW, dependencies: { "a-dep": "catalog:" } },
        },
        catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@1.1.0" },
      });

      expectOk(await dir.frozen(), checked(4, 5), []);
    });

    test("an existing entry is reused for every selected member", async () => {
      const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), PKG1, withPkg2());

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "*"),
        added(3, "installed no-deps@1.1.0"),
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.pkg2()).toStrictEqual({
        name: "pkg2",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } },
          "packages/pkg2": { ...PKG2_ROW, dependencies: { "no-deps": "catalog:" } },
        },
        catalog: { "no-deps": "^1.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.1.0" },
      });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("a range declared by any selected member is what gets cataloged", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
        withPkg2(),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg1", "--filter", "pkg2"),
        added(3, "installed no-deps@1.1.0"),
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2()).toStrictEqual({
        name: "pkg2",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^1.0.0" });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    // pnpm's rule: the first member declaring a range seeds the entry; later members switch only when equal or an exact version inside it, otherwise they are kept with a note.
    test("members declaring different ranges: the first selected member's range seeds the entry", async () => {
      const pkg2 = pretty({ name: "pkg2", dependencies: { "no-deps": "1.0.1" } });
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "1.0.0" } },
        withPkg2(pkg2),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"),
        added(4, "installed no-deps@1.0.0"),
        [keeps("no-deps", "pkg2", "1.0.1", "1.0.0"), SAVED],
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2Text()).toBe(pkg2);
      expect(dir.installed()).toEqual([
        "node_modules/no-deps/no-deps@1.0.0",
        "packages/pkg2/node_modules/no-deps/no-deps@1.0.1",
      ]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "1.0.1" } },
        },
        catalog: { "no-deps": "1.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.0.0", "pkg2/no-deps": "no-deps@1.0.1" },
      });

      expectOk(await dir.frozen(), checked(4, 5), []);
    });

    test("a later member whose exact version is inside the seeded range switches to the catalog", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
        withPkg2({ name: "pkg2", dependencies: { "no-deps": "1.0.0" } }),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"),
        added(3, "installed no-deps@1.1.0"),
        [note("no-deps", "pkg2", "^1.0.0", "1.0.0"), SAVED],
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", dependencies: { "no-deps": "catalog:" } });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
        },
        catalog: { "no-deps": "^1.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.1.0" },
      });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("members declaring the same range are all switched without a note", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
        withPkg2({ name: "pkg2", dependencies: { "no-deps": "^1.0.0" } }),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"),
        added(3, "installed no-deps@1.1.0"),
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", dependencies: { "no-deps": "catalog:" } });
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^1.0.0" });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("a member declaring nothing does not block a later member's range from seeding", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        PKG1,
        withPkg2({ name: "pkg2", dependencies: { "no-deps": "^1.0.0" } }),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"),
        added(3, "installed no-deps@1.1.0"),
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", dependencies: { "no-deps": "catalog:" } });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^1.0.0" });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("an entry the root already has is used by every selected member, with a note per member that declared something else", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "1.0.0" } }),
        { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
        withPkg2({ name: "pkg2", dependencies: { "no-deps": "2.0.0" } }),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"),
        added(3, "installed no-deps@1.0.0"),
        [note("no-deps", "pkg1", "1.0.0", "^1.0.0"), note("no-deps", "pkg2", "1.0.0", "2.0.0"), SAVED],
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", dependencies: { "no-deps": "catalog:" } });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
        },
        catalog: { "no-deps": "1.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.0.0" },
      });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("--silent prints no notes", async () => {
      const pkg2 = pretty({ name: "pkg2", dependencies: { "no-deps": "1.0.1" } });
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "1.0.0" } },
        withPkg2(pkg2),
      );

      expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*", "--silent"), [], []);

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2Text()).toBe(pkg2);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "1.0.1" } },
        },
        catalog: { "no-deps": "1.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.0.0", "pkg2/no-deps": "no-deps@1.0.1" },
      });

      expectOk(await dir.frozen(), checked(4, 5), []);
    });

    test("each member keeps its own catalog", async () => {
      const pkg1 = pretty({ name: "pkg1", dependencies: { "no-deps": "catalog:legacy" } });
      const dir = await createDir(
        workspacesObject({ catalogs: { legacy: { "no-deps": "1.0.0" } } }),
        pkg1,
        withPkg2({ name: "pkg2" }),
      );

      // The summary row names the first selected member's resolution, pkg1's legacy entry.
      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg1", "--filter", "pkg2"),
        added(4, "installed no-deps@1.0.0"),
      );

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.root()).toStrictEqual(
        workspacesObject({ catalogs: { legacy: { "no-deps": "1.0.0" } }, catalog: { "no-deps": "^2.0.0" } }),
      );
      expect(dir.installed()).toEqual([
        "node_modules/no-deps/no-deps@1.0.0",
        "packages/pkg2/node_modules/no-deps/no-deps@2.0.0",
      ]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:legacy" } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
        },
        catalog: { "no-deps": "^2.0.0" },
        catalogs: { legacy: { "no-deps": "1.0.0" } },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.0.0", "pkg2/no-deps": "no-deps@2.0.0" },
      });

      expectOk(await dir.frozen(), checked(4, 5), []);
    });

    test("edits only the filtered member and the root catalog", async () => {
      const pkg1 = JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), pkg1, withPkg2());
      expectOk(await dir.install(), freshInstall(3));

      expectOk(
        await dir.add(dir.packageDir, "a-dep", "--catalog", "--filter", "pkg2"),
        added(1, "installed a-dep@1.0.10"),
      );

      expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", version: "1.0.0", dependencies: { "a-dep": "catalog:" } });
      expect(await dir.pkg1Text()).toBe(pkg1);
      const root = await dir.root();
      expect(root).toStrictEqual(workspacesObject({ catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" } }));
      expect(Object.keys(root.workspaces.catalog)).toStrictEqual(["a-dep", "no-deps"]);
      expect((await dir.lock()).catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": "^1.0.0" });
      expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10", "node_modules/no-deps/no-deps@1.1.0"]);

      expectOk(
        await dir.add(dir.packageDir, "a-dep", "--catalog", "--filter", "*", "--filter", "root"),
        unchangedAdd("installed a-dep@1.0.10"),
      );

      expect(await dir.root()).toStrictEqual({
        ...workspacesObject({ catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" } }),
        dependencies: { "a-dep": "catalog:" },
      });
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" },
      });
      expect(await dir.pkg2()).toStrictEqual({ name: "pkg2", version: "1.0.0", dependencies: { "a-dep": "catalog:" } });
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": { ...ROOT_ROW, dependencies: { "a-dep": "catalog:" } },
          "packages/pkg1": { name: "pkg1", dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" } },
          "packages/pkg2": { ...PKG2_ROW, dependencies: { "a-dep": "catalog:" } },
        },
        catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@1.1.0" },
      });

      expectOk(await dir.frozen(), checked(4, 5), []);
    });

    test("--only-missing skips members that already have the package", async () => {
      const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
      const dir = await createDir(workspacesObject({ catalog: {} }), pkg1, withPkg2());

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--only-missing", "--filter", "pkg1", "--filter", "pkg2"),
        added(4, "installed no-deps@2.0.0"),
      );

      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.pkg2()).toStrictEqual({
        name: "pkg2",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(dir.installed()).toEqual([
        "node_modules/no-deps/no-deps@1.1.0",
        "packages/pkg2/node_modules/no-deps/no-deps@2.0.0",
      ]);
    });

    test("--only-missing with every member already having the package leaves the catalog empty", async () => {
      const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
      const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);

      expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog", "--only-missing", "--filter", "pkg1"), [
        ADD,
        "",
        "2 packages installed",
      ]);

      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: {} }));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
    });
  });

  test("--only-missing when the target already has the package leaves the catalog empty", async () => {
    const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
    const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--only-missing"), added(2, "+ no-deps@1.1.0"));

    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: {} }));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
  });

  // pnpm #9647: an existing entry is moved to the version given on the command line.
  test("explicit version replaces an entry other members reference", async () => {
    const member = (name: string) => JSON.stringify({ name, dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(
      workspacesObject({ catalog: { "no-deps": "^2.0.0" } }),
      member("pkg1"),
      withPkg2(member("pkg2")),
    );
    expectOk(await dir.install(), freshInstall(3));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.0", "--catalog"), added(1, "installed no-deps@1.0.0"), [
      changed("no-deps", "^2.0.0", "1.0.0", "pkg2"),
      SAVED,
    ]);

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
    expect(await dir.pkg2Text()).toBe(member("pkg2"));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: {
        "": ROOT_ROW,
        "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
        "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
      },
      catalog: { "no-deps": "1.0.0" },
      packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.0.0" },
    });

    expectOk(await dir.frozen(), checked(3, 4), []);
  });

  // Bun deviates from pnpm here: pnpm keeps the entry and writes the version directly into the member.
  describe("an explicit version the entry or the target's range does not cover replaces the entry", () => {
    test("entry other members reference", async () => {
      const member = (name: string) => JSON.stringify({ name, dependencies: { "no-deps": "catalog:" } });
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
        member("pkg1"),
        withPkg2(member("pkg2")),
      );
      expectOk(await dir.install(), freshInstall(3));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@2.0.0", "--catalog"), added(1, "installed no-deps@2.0.0"), [
        changed("no-deps", "^1.0.0", "2.0.0", "pkg2"),
        SAVED,
      ]);

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2Text()).toBe(member("pkg2"));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
        },
        catalog: { "no-deps": "2.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@2.0.0" },
      });
    });

    test("range declared directly by the target", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), {
        name: "pkg1",
        dependencies: { "no-deps": "^1.0.0" },
      });
      expectOk(await dir.install(), freshInstall(2));

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@2.0.0", "--catalog"), added(1, "installed no-deps@2.0.0"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "2.0.0" });
    });
  });

  test("other dependencies of the target are left alone", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "a-dep": "1.0.1" },
    });

    expectOk(
      await dir.add(dir.pkg1Dir, "no-deps", "--catalog"),
      added(3, "+ a-dep@1.0.1", "", "installed no-deps@2.0.0"),
    );

    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "a-dep": "1.0.1", "no-deps": "catalog:" } });
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
    expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.1", "node_modules/no-deps/no-deps@2.0.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: {
        "": ROOT_ROW,
        "packages/pkg1": { name: "pkg1", dependencies: { "a-dep": "1.0.1", "no-deps": "catalog:" } },
      },
      catalog: { "no-deps": "^2.0.0" },
      packages: { ...PKG1_LINK, "a-dep": "a-dep@1.0.1", "no-deps": "no-deps@2.0.0" },
    });
  });

  test("existing direct range is converted in place", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "no-deps": "^1.0.0" },
    });
    expectOk(await dir.install(), freshInstall(2));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), unchangedAdd("installed no-deps@1.1.0"));

    expect(await dir.pkg1Text()).toBe(pretty({ name: "pkg1", dependencies: { "no-deps": "catalog:" } }));
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } } },
      catalog: { "no-deps": "^1.0.0" },
      packages: { ...PKG1_LINK, "no-deps": "no-deps@1.1.0" },
    });

    expectOk(await dir.frozen(), checked(2, 3), []);
  });

  test("re-running the same add is idempotent", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), added(2, "installed no-deps@2.0.0"));
    const [rootAfter, pkg1After, lockAfter] = await Promise.all([dir.rootText(), dir.pkg1Text(), dir.lockText()]);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), unchangedAdd("installed no-deps@2.0.0"), []);

    expect(await dir.rootText()).toBe(rootAfter);
    expect(await dir.pkg1Text()).toBe(pkg1After);
    expect(await dir.lockText()).toBe(lockAfter);
  });

  test("named catalog with other entries and other named catalogs present", async () => {
    const dir = await createDir(
      workspacesObject({ catalogs: { other: { "a-dep": "1.0.1" }, testing: { "no-deps": "1.0.0" } } }),
    );

    expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=testing"), added(2, "installed a-dep@1.0.10"));

    const catalogs = { other: { "a-dep": "1.0.1" }, testing: { "a-dep": "^1.0.10", "no-deps": "1.0.0" } };
    const root = await dir.root();
    expect(root).toStrictEqual(workspacesObject({ catalogs }));
    expect(Object.keys(root.workspaces.catalogs.testing)).toStrictEqual(["a-dep", "no-deps"]);
    expect(await dir.pkg1()).toStrictEqual({
      name: "pkg1",
      version: "1.0.0",
      dependencies: { "a-dep": "catalog:testing" },
    });
    expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "a-dep": "catalog:testing" } } },
      catalogs,
      packages: { ...PKG1_LINK, "a-dep": "a-dep@1.0.10" },
    });

    expectOk(await dir.frozen(), checked(2, 3), []);
  });

  test("one package failing to resolve writes nothing", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectRefused(await dir.add(dir.pkg1Dir, "no-deps", "this-package-does-not-exist-xyz", "--catalog"), [
      `error: GET ${registry.registryUrl()}this-package-does-not-exist-xyz - 404`,
    ]);

    await dir.expectNothingWritten();
  });

  test.each(["member", "root"] as const)("--no-save installs but writes neither file (from %s)", async from => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
    expectOk(await dir.add(cwd, "no-deps", "--catalog", "--no-save"), added(2, "installed no-deps@2.0.0"), []);

    await dir.expectPackageJsonsUntouched();
    expect(await dir.lockExists()).toBeFalse();
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
  });

  test("root package.json formatting survives the member-path rewrite", async () => {
    const rootBefore =
      JSON.stringify(
        { private: true, workspaces: ["packages/*"], catalog: { "a-dep": "1.0.1" }, name: "root" },
        null,
        4,
      ) + "\n";
    const dir = await createDir(rootBefore);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), added(2, "installed no-deps@2.0.0"));

    expect(await dir.rootText()).toBe(
      JSON.stringify(
        { private: true, workspaces: ["packages/*"], catalog: { "a-dep": "1.0.1", "no-deps": "^2.0.0" }, name: "root" },
        null,
        4,
      ) + "\n",
    );
    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "catalog:" } });
  });

  // pnpm #7072: `catalog:` and `catalog:default` are one catalog, whether it is spelled `catalog` or `catalogs.default`.
  describe("default catalog alias", () => {
    const member = (name: string, ref = "catalog:") => JSON.stringify({ name, dependencies: { "no-deps": ref } });

    test.each([
      {
        flag: "--catalog",
        spelled: "catalogs.default",
        root: { catalogs: { default: { "no-deps": "1.0.0" } } },
        reference: "catalog:",
      },
      {
        flag: "--catalog=default",
        spelled: "catalog",
        root: { catalog: { "no-deps": "1.0.0" } },
        reference: "catalog:default",
      },
    ])("$flag reuses the entry spelled $spelled", async ({ flag, root, reference }) => {
      const otherReference = reference === "catalog:" ? "catalog:default" : "catalog:";
      const dir = await createDir(workspacesObject(root), PKG1, withPkg2(member("pkg2", otherReference)));
      expectOk(await dir.install(), freshInstall(3));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", flag), unchangedAdd("installed no-deps@1.0.0"));

      expect(await dir.root()).toStrictEqual(workspacesObject(root));
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": reference },
      });
      expect(await dir.pkg2Text()).toBe(member("pkg2", otherReference));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": reference } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": otherReference } },
        },
        ...root,
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.0.0" },
      });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    const bothObjects = workspacesObject({
      catalog: { "a-dep": "1.0.1" },
      catalogs: { default: { "no-deps": "1.0.0" } },
    });

    test("both objects present: the one defining the name is reused", async () => {
      const dir = await createDir(bothObjects, PKG1, withPkg2(member("pkg2")));
      expectOk(await dir.install(), freshInstall(3));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), unchangedAdd("installed no-deps@1.0.0"));

      expect(await dir.root()).toStrictEqual(bothObjects);
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
      const lock = await dir.lock();
      expect(lock.catalog).toEqual({ "a-dep": "1.0.1" });
      expect(lock.catalogs).toEqual({ default: { "no-deps": "1.0.0" } });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("both objects present: an explicit version replaces the entry where it is defined", async () => {
      const dir = await createDir(bothObjects, PKG1, withPkg2(member("pkg2")));
      expectOk(await dir.install(), freshInstall(3));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@2.0.0", "--catalog"), added(1, "installed no-deps@2.0.0"), [
        changed("no-deps", "1.0.0", "2.0.0", "pkg2"),
        SAVED,
      ]);

      expect(await dir.root()).toStrictEqual(
        workspacesObject({ catalog: { "a-dep": "1.0.1" }, catalogs: { default: { "no-deps": "2.0.0" } } }),
      );
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      const lock = await dir.lock();
      expect(lock.catalog).toEqual({ "a-dep": "1.0.1" });
      expect(lock.catalogs).toEqual({ default: { "no-deps": "2.0.0" } });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("--catalog with an explicit version replaces the catalogs.default entry instead of adding a second catalog", async () => {
      const dir = await createDir(
        workspacesObject({ catalogs: { default: { "no-deps": "1.0.0" } } }),
        member("pkg1"),
        withPkg2(member("pkg2", "catalog:default")),
      );
      expectOk(await dir.install(), freshInstall(3));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@2.0.0", "--catalog"), added(1, "installed no-deps@2.0.0"), [
        changed("no-deps", "1.0.0", "2.0.0", "pkg2"),
        SAVED,
      ]);

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { default: { "no-deps": "2.0.0" } } }));
      expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg2Text()).toBe(member("pkg2", "catalog:default"));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:default" } },
        },
        catalogs: { default: { "no-deps": "2.0.0" } },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@2.0.0" },
      });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("--catalog=default with an explicit range replaces the singular catalog every catalog: reference resolves through", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
        PKG1,
        withPkg2(member("pkg2")),
      );
      expectOk(await dir.install(), freshInstall(3));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@^2.0.0", "--catalog=default"), added(1, "installed no-deps@2.0.0"), [
        changed("no-deps", "^1.0.0", "^2.0.0", "pkg2"),
        SAVED,
      ]);

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:default" },
      });
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:default" } },
          "packages/pkg2": { name: "pkg2", dependencies: { "no-deps": "catalog:" } },
        },
        catalog: { "no-deps": "^2.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@2.0.0" },
      });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("--catalog=default with no catalog defined creates the singular catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog=default"), added(2, "installed no-deps@2.0.0"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:default" },
      });
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^2.0.0" });
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
    });

    test("bun update --latest refreshes a catalogs.default entry referenced as catalog:", async () => {
      const dir = await createDir(workspacesObject({ catalogs: { default: { "no-deps": "^1.0.0" } } }), member("pkg1"));
      expectOk(await dir.install(), freshInstall(2));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);

      expectOk(await dir.run(dir.packageDir, ["update", "--latest"]), [UPDATE, "", "1 package installed"]);

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { default: { "no-deps": "^2.0.0" } } }));
      expect(await dir.pkg1Text()).toBe(member("pkg1"));
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "catalog:" } } },
        catalogs: { default: { "no-deps": "^2.0.0" } },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("bun pm pack substitutes a catalogs.default entry referenced as catalog:", async () => {
      const dir = await createDir(workspacesObject({ catalogs: { default: { "no-deps": ">=1.0.0" } } }), {
        name: "pkg1",
        version: "1.0.0",
        peerDependencies: { "no-deps": "catalog:" },
      });
      expectOk(await dir.install(), freshInstall(2));

      const pack = await dir.run(dir.pkg1Dir, ["pm", "pack"]);
      expect(lines(pack, pack.stderr)).toEqual([]);
      expect(pack.exitCode).toBe(0);

      const tarball = readTarball(join(dir.pkg1Dir, "pkg1-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents)).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        peerDependencies: { "no-deps": ">=1.0.0" },
      });
    });
  });

  // pnpm #8996: `bun pm pack` substitutes catalog references in every dependency group.
  test("bun pm pack substitutes the catalog literal, including peerDependencies", async () => {
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": ">=1.0.0" } }), {
      name: "pkg1",
      version: "1.0.0",
      peerDependencies: { "no-deps": "catalog:" },
    });
    expectOk(await dir.install(), freshInstall(2));

    expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=x"), added(1, "installed a-dep@1.0.10"));
    expect(await dir.pkg1()).toStrictEqual({
      name: "pkg1",
      version: "1.0.0",
      peerDependencies: { "no-deps": "catalog:" },
      dependencies: { "a-dep": "catalog:x" },
    });

    const pack = await dir.run(dir.pkg1Dir, ["pm", "pack"]);
    expect(lines(pack, pack.stderr)).toEqual([]);
    expect(pack.exitCode).toBe(0);

    const tarball = readTarball(join(dir.pkg1Dir, "pkg1-1.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents)).toStrictEqual({
      name: "pkg1",
      version: "1.0.0",
      peerDependencies: { "no-deps": ">=1.0.0" },
      dependencies: { "a-dep": "^1.0.10" },
    });
  });

  // pnpm #10456: removing the last reference to an entry does not drop the catalog from bun.lock.
  test("bun remove from members keeps the catalog definitions", async () => {
    const member = (name: string) => JSON.stringify({ name, dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(
      workspacesObject({ catalog: { "no-deps": "1.0.0" } }),
      member("pkg1"),
      withPkg2(member("pkg2")),
    );

    expectOk(
      await dir.add(dir.pkg1Dir, "a-dep", "--catalog=libs"),
      added(4, "+ no-deps@1.0.0", "", "installed a-dep@1.0.10"),
    );
    expectOk(await dir.run(dir.pkg1Dir, ["remove", "no-deps"]), [REMOVE, "", "- no-deps done"]);
    expectOk(await dir.run(dir.pkg2Dir, ["remove", "no-deps"]), [REMOVE, "", "- no-deps", "1 package removed"]);

    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "a-dep": "catalog:libs" } });
    expect(await dir.pkg2()).toStrictEqual({ name: "pkg2" });
    expect(await dir.root()).toStrictEqual(
      workspacesObject({ catalog: { "no-deps": "1.0.0" }, catalogs: { libs: { "a-dep": "^1.0.10" } } }),
    );
    expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10"]);
    expect(await dir.lock()).toEqual({
      workspaces: {
        "": ROOT_ROW,
        "packages/pkg1": { name: "pkg1", dependencies: { "a-dep": "catalog:libs" } },
        "packages/pkg2": { name: "pkg2" },
      },
      catalog: { "no-deps": "1.0.0" },
      catalogs: { libs: { "a-dep": "^1.0.10" } },
      packages: { ...PKG1_LINK, ...PKG2_LINK, "a-dep": "a-dep@1.0.10" },
    });

    expectOk(await dir.frozen(), checked(3, 4), []);
  });

  // pnpm #8795: --frozen-lockfile notices a changed catalog entry.
  test.each(["member", "root"] as const)(
    "--frozen-lockfile passes after the add and fails once the entry is edited (from %s)",
    async from => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(
        await dir.add(from === "member" ? dir.pkg1Dir : dir.packageDir, "no-deps", "--catalog"),
        added(2, "installed no-deps@2.0.0"),
      );

      expectOk(await dir.frozen(), checked(2, 3), []);

      const root = await dir.root();
      root.workspaces.catalog["no-deps"] = "1.0.0";
      await write(dir.rootPath, JSON.stringify(root));

      expectRefused(
        await dir.frozen(),
        [
          "error: lockfile had changes, but lockfile is frozen",
          "note: the catalog in package.json changed since bun.lock was saved",
          "note: try re-running without --frozen-lockfile and commit the updated lockfile",
        ],
        [INSTALL],
      );
    },
  );

  // pnpm #12115 / #11591: update never replaces a `catalog:` reference, even with an override or an explicit spec.
  describe("catalog: references with an override", () => {
    const pkg1 = { name: "pkg1", dependencies: { "no-deps": "catalog:" } };
    const overriddenRoot = {
      ...workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
      overrides: { "no-deps": "1.0.0" },
    };

    test.each(["update", "update --recursive", "update no-deps", "update no-deps@1.1.0"])(
      "survive bun %s",
      async command => {
        const dir = await createDir(overriddenRoot, pkg1);
        expectOk(await dir.install(), freshInstall(2));
        expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);

        expectOk(
          await dir.run(dir.pkg1Dir, command.split(" ")),
          [UPDATE, "", "Checked 2 installs across 3 packages (no changes)"],
          [],
        );

        expect(await dir.pkg1()).toStrictEqual(pkg1);
        expect(await dir.root()).toStrictEqual(overriddenRoot);
        expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
        expect(await dir.lock()).toEqual({
          workspaces: { "": ROOT_ROW, "packages/pkg1": pkg1 },
          catalog: { "no-deps": "^1.0.0" },
          packages: { ...PKG1_LINK, "no-deps": "no-deps@1.0.0" },
        });
      },
    );

    test("survive bun add --catalog of another package", async () => {
      const dir = await createDir(overriddenRoot, pkg1);

      expectOk(
        await dir.add(dir.pkg1Dir, "a-dep", "--catalog"),
        added(3, "+ no-deps@1.0.0", "", "installed a-dep@1.0.10"),
      );

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual({
        ...workspacesObject({ catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" } }),
        overrides: { "no-deps": "1.0.0" },
      });
      expect(dir.installed()).toEqual(["node_modules/a-dep/a-dep@1.0.10", "node_modules/no-deps/no-deps@1.0.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { name: "pkg1", dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" } },
        },
        catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" },
        packages: { ...PKG1_LINK, "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@1.0.0" },
      });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });
  });

  // pnpm #9660: overrides win at resolution, so the catalog records the overridden version.
  test("an override decides what --catalog records", async () => {
    const dir = await createDir({ ...workspacesObject({ catalog: {} }), overrides: { "no-deps": "1.0.0" } });

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"), added(2, "installed no-deps@1.0.0"));

    expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "catalog:" } });
    expect(await dir.root()).toStrictEqual({
      ...workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
      overrides: { "no-deps": "1.0.0" },
    });
    expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
    expect(await dir.lock()).toEqual({
      workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } } },
      catalog: { "no-deps": "^1.0.0" },
      packages: { ...PKG1_LINK, "no-deps": "no-deps@1.0.0" },
    });

    expectOk(await dir.frozen(), checked(2, 3), []);
  });

  // pnpm: a bare `add <name>` in a workspace whose default catalog lists <name> writes `catalog:`.
  describe("plain bun add uses the default catalog", () => {
    const defaultRoot = workspacesObject({ catalog: { "no-deps": "^1.0.0" } });
    const referenced = {
      workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } } },
      catalog: { "no-deps": "^1.0.0" },
      packages: { ...PKG1_LINK, "no-deps": "no-deps@1.1.0" },
    };

    test("bare name from a member", async () => {
      const dir = await createDir(defaultRoot);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps"), added(2, "installed no-deps@1.1.0"));

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual(defaultRoot);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect(await dir.lock()).toEqual(referenced);

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("bare name from the root", async () => {
      const dir = await createDir(defaultRoot);

      expectOk(await dir.add(dir.packageDir, "no-deps"), added(2, "installed no-deps@1.1.0"));

      expect(await dir.root()).toStrictEqual({ ...defaultRoot, dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg1Text()).toBe(PKG1);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: { "": { ...ROOT_ROW, dependencies: { "no-deps": "catalog:" } }, "packages/pkg1": PKG1_ROW },
        catalog: { "no-deps": "^1.0.0" },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@1.1.0" },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test.each([
      { title: "bare name", args: ["no-deps"] },
      { title: "a spec equal to the entry text", args: ["no-deps@^1.0.0"] },
    ])("$title with the default catalog spelled catalogs.default", async ({ args }) => {
      const root = pretty(workspacesObject({ catalogs: { default: { "no-deps": "^1.0.0" } } }));
      const dir = await createDir(root);

      expectOk(await dir.add(dir.pkg1Dir, ...args), added(2, "installed no-deps@1.1.0"));

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.rootText()).toBe(root);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } } },
        catalogs: { default: { "no-deps": "^1.0.0" } },
        packages: { ...PKG1_LINK, "no-deps": "no-deps@1.1.0" },
      });

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("--dev writes the reference into devDependencies", async () => {
      const dir = await createDir(defaultRoot);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--dev"), added(2, "installed no-deps@1.1.0"));

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        devDependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual(defaultRoot);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect((await dir.lock()).workspaces["packages/pkg1"]).toEqual({
        ...PKG1_ROW,
        devDependencies: { "no-deps": "catalog:" },
      });
    });

    test.each([
      { title: "bun install <pkg>", args: ["install", "no-deps"] },
      { title: "a spec equal to the entry text", args: ["add", "no-deps@^1.0.0"] },
      { title: "--exact", args: ["add", "no-deps", "--exact"] },
      { title: "-E", args: ["add", "no-deps", "-E"] },
    ])("$title writes the reference like a bare add", async ({ args }) => {
      const dir = await createDir(defaultRoot);

      expectOk(await dir.run(dir.pkg1Dir, args), added(2, "installed no-deps@1.1.0"));

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual(defaultRoot);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect(await dir.lock()).toEqual(referenced);

      expectOk(await dir.frozen(), checked(2, 3), []);
    });

    test("--filter writes the reference into every selected member", async () => {
      const dir = await createDir(defaultRoot, PKG1, withPkg2());

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--filter", "pkg1", "--filter", "pkg2"),
        added(3, "installed no-deps@1.1.0"),
      );

      expect(await dir.pkg1()).toStrictEqual({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.pkg2()).toStrictEqual({
        name: "pkg2",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      });
      expect(await dir.root()).toStrictEqual(defaultRoot);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
      expect(await dir.lock()).toEqual({
        workspaces: {
          "": ROOT_ROW,
          "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "catalog:" } },
          "packages/pkg2": { ...PKG2_ROW, dependencies: { "no-deps": "catalog:" } },
        },
        catalog: { "no-deps": "^1.0.0" },
        packages: { ...PKG1_LINK, ...PKG2_LINK, "no-deps": "no-deps@1.1.0" },
      });

      expectOk(await dir.frozen(), checked(3, 4), []);
    });

    test("re-adding a package already on catalog: keeps the reference", async () => {
      const pkg1 = pretty({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      const dir = await createDir(defaultRoot, pkg1);
      expectOk(await dir.install(), freshInstall(2));
      const lockBefore = await dir.lockText();

      expectOk(await dir.add(dir.pkg1Dir, "no-deps"), unchangedAdd("installed no-deps@1.1.0"), []);

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.root()).toStrictEqual(defaultRoot);
      expect(await dir.lockText()).toBe(lockBefore);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
    });

    test("an existing named reference is kept", async () => {
      const pkg1 = pretty({ name: "pkg1", dependencies: { "no-deps": "catalog:libs" } });
      const libsRoot = workspacesObject({ catalogs: { libs: { "no-deps": "1.0.0" } } });
      const dir = await createDir(libsRoot, pkg1);
      expectOk(await dir.install(), freshInstall(2));
      const lockBefore = await dir.lockText();

      expectOk(await dir.add(dir.pkg1Dir, "no-deps"), unchangedAdd("installed no-deps@1.0.0"), []);

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.root()).toStrictEqual(libsRoot);
      expect(await dir.lockText()).toBe(lockBefore);
      expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.0.0"]);
    });

    describe("explicit versions and unlisted names are added normally", () => {
      // `installed`: the summary row, `row`: the bun.lock entry, `folder`: the node_modules folder.
      test.each([
        {
          spec: "no-deps@1.0.0",
          written: { "no-deps": "1.0.0" },
          installed: "no-deps@1.0.0",
          row: "no-deps@1.0.0",
          folder: "node_modules/no-deps/no-deps@1.0.0",
        },
        {
          spec: "no-deps@latest",
          written: { "no-deps": "^2.0.0" },
          installed: "no-deps@2.0.0",
          row: "no-deps@2.0.0",
          folder: "node_modules/no-deps/no-deps@2.0.0",
        },
        {
          spec: "no-deps@^2.0.0",
          written: { "no-deps": "^2.0.0" },
          installed: "no-deps@2.0.0",
          row: "no-deps@2.0.0",
          folder: "node_modules/no-deps/no-deps@2.0.0",
        },
        {
          spec: "a-dep",
          written: { "a-dep": "^1.0.10" },
          installed: "a-dep@1.0.10",
          row: "a-dep@1.0.10",
          folder: "node_modules/a-dep/a-dep@1.0.10",
        },
        {
          spec: "@types/no-deps",
          written: { "@types/no-deps": "^2.0.0" },
          installed: "@types/no-deps@2.0.0",
          row: "@types/no-deps@2.0.0",
          folder: "node_modules/@types/no-deps/@types/no-deps@2.0.0",
        },
        {
          spec: "foo@npm:no-deps",
          written: { foo: "npm:no-deps@^2.0.0" },
          installed: "foo@npm:no-deps@2.0.0",
          row: "no-deps@2.0.0",
          folder: "node_modules/foo/no-deps@2.0.0",
        },
      ])("bun add $spec", async ({ spec, written, installed: installedRow, row, folder }) => {
        const dir = await createDir(defaultRoot);
        const [name] = Object.keys(written);

        expectOk(await dir.add(dir.pkg1Dir, spec), added(2, `installed ${installedRow}`));

        expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", version: "1.0.0", dependencies: written });
        expect(await dir.root()).toStrictEqual(defaultRoot);
        expect(dir.installed()).toEqual([folder]);
        expect(await dir.lock()).toEqual({
          workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: written } },
          catalog: { "no-deps": "^1.0.0" },
          packages: { ...PKG1_LINK, [name]: row },
        });
      });

      test("an explicit version replaces a named reference", async () => {
        const libsRoot = workspacesObject({ catalogs: { libs: { "no-deps": "1.0.0" } } });
        const dir = await createDir(libsRoot, { name: "pkg1", dependencies: { "no-deps": "catalog:libs" } });

        expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.1.0"), added(2, "installed no-deps@1.1.0"));

        expect(await dir.pkg1()).toStrictEqual({ name: "pkg1", dependencies: { "no-deps": "1.1.0" } });
        expect(await dir.root()).toStrictEqual(libsRoot);
        expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@1.1.0"]);
        expect(await dir.lock()).toEqual({
          workspaces: { "": ROOT_ROW, "packages/pkg1": { name: "pkg1", dependencies: { "no-deps": "1.1.0" } } },
          catalogs: { libs: { "no-deps": "1.0.0" } },
          packages: { ...PKG1_LINK, "no-deps": "no-deps@1.1.0" },
        });
      });

      test("named catalogs are not used without the flag", async () => {
        const libsRoot = workspacesObject({ catalogs: { libs: { "no-deps": "1.0.0" } } });
        const dir = await createDir(libsRoot);

        expectOk(await dir.add(dir.pkg1Dir, "no-deps"), added(2, "installed no-deps@2.0.0"));

        expect(await dir.pkg1()).toStrictEqual({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "no-deps": "^2.0.0" },
        });
        expect(await dir.root()).toStrictEqual(libsRoot);
        expect(dir.installed()).toEqual(["node_modules/no-deps/no-deps@2.0.0"]);
        expect(await dir.lock()).toEqual({
          workspaces: { "": ROOT_ROW, "packages/pkg1": { ...PKG1_ROW, dependencies: { "no-deps": "^2.0.0" } } },
          catalogs: { libs: { "no-deps": "1.0.0" } },
          packages: { ...PKG1_LINK, "no-deps": "no-deps@2.0.0" },
        });
      });
    });
  });

  describe("errors", () => {
    test("root package.json without workspaces", async () => {
      const solo = JSON.stringify({ name: "solo" });
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted", saveTextLockfile: true },
        files: { "package.json": solo, ...cacheFiles },
      });

      expectRefused(await spawnBun(packageDir, packageDir, ["add", "no-deps", "--catalog"], envFor(packageDir)), [
        'error: --catalog requires a "workspaces" field in the root package.json',
      ]);

      expect(await file(join(packageDir, "package.json")).text()).toBe(solo);
      expect(await file(join(packageDir, "bun.lock")).exists()).toBeFalse();
      expect(existsSync(join(packageDir, "node_modules"))).toBeFalse();
    });

    test("a root defining a package in both catalog and catalogs.default is rejected before anything is written", async () => {
      const dir = await createDir(
        pretty(workspacesObject({ catalog: { "no-deps": "1.0.0" }, catalogs: { default: { "no-deps": "2.0.0" } } })),
      );

      // The excerpt points at the `catalogs.default` entry. Its line number is taken from the re-printed root, not
      // from the file as written, so only the quoted text is pinned.
      expectRefused(await dir.add(dir.pkg1Dir, "a-dep", "--catalog"), [
        expect.stringMatching(/^\d+ \| {9}"no-deps": "2\.0\.0"$/),
        expect.stringMatching(/^ +\^$/),
        'error: "no-deps" is defined in both "catalog" and "catalogs.default"; keep one of them',
        expect.stringMatching(/^ {4}at <dir>\/package\.json:\d+:9$/),
      ]);

      await dir.expectNothingWritten();
    });

    test("bun install --catalog without packages", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectRefused(
        await dir.run(dir.packageDir, ["install", "--catalog"]),
        ["error: no package specified to add"],
        [],
      );

      await dir.expectNothingWritten();
    });

    test("--catalog with --global", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const globalDir = join(dir.packageDir, ".bun-global");

      expectRefused(
        await dir.run(dir.pkg1Dir, ["add", "no-deps", "--catalog", "-g"], {
          ...dir.env,
          BUN_INSTALL: globalDir,
          BUN_INSTALL_GLOBAL_DIR: join(globalDir, "install", "global"),
          BUN_INSTALL_BIN: join(globalDir, "bin"),
        }),
        ["error: --catalog cannot be used with --global"],
        [],
      );

      await dir.expectNothingWritten();
      expect(existsSync(globalDir)).toBeFalse();
    });
  });
});
