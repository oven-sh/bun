import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "fs";
import { exists, rm } from "fs/promises";
import { bunEnv, bunExe, isASAN, runBunInstall } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";

const registry = new TestRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

test("should handle resolving optional peer from multiple instances of same package", async () => {
  const { packageDir } = await registry.createTestDir({
    files: {
      "package.json": JSON.stringify({
        name: "pkg",
        dependencies: {
          "dep-1": "npm:one-optional-peer-dep@1.0.2",
          "dep-2": "npm:one-optional-peer-dep@1.0.2",
          "one-dep": "1.0.0",
        },
      }),
    },
  });

  // this shouldn't hit an assertion
  await runBunInstall(bunEnv, packageDir);
});

test("tree written after a ranged peer gains a higher candidate is the tree the next install lays out", async () => {
  // `peer-deps-fixed` has a peer on `no-deps@^1.0.0`. As a devDependency it is
  // hoisted before the root's `dependencies`, so whatever its peer edge is bound
  // to is the `no-deps` that lands at the root of node_modules. Loading bun.lock
  // binds such an edge to the highest satisfying version in the lockfile, so
  // the install that adds `one-dep` (no-deps@1.0.1, next to one-fixed-dep's
  // 1.0.0) has to bind it the same way before hoisting. Otherwise it writes a
  // lockfile keyed with 1.0.0 at the root and the very next `bun install`
  // relinks node_modules with 1.0.1 at the root, without touching bun.lock.
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  const noDepsVersion = async (...segments: string[]) => {
    const pkg = join(packageDir, "node_modules", ...segments, "no-deps", "package.json");
    return (await exists(pkg)) ? ((await file(pkg).json()) as { version: string }).version : null;
  };
  const layout = async () => ({
    root: await noDepsVersion(),
    "one-dep": await noDepsVersion("one-dep", "node_modules"),
    "one-fixed-dep": await noDepsVersion("one-fixed-dep", "node_modules"),
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "ranged-peer-roundtrip",
      dependencies: { "one-fixed-dep": "1.0.0" },
      devDependencies: { "peer-deps-fixed": "1.0.0" },
    }),
  );
  await runBunInstall(bunEnv, packageDir);
  expect(await layout()).toEqual({ root: "1.0.0", "one-dep": null, "one-fixed-dep": null });

  await write(
    packageJson,
    JSON.stringify({
      name: "ranged-peer-roundtrip",
      dependencies: { "one-dep": "1.0.0", "one-fixed-dep": "1.0.0" },
      devDependencies: { "peer-deps-fixed": "1.0.0" },
    }),
  );
  await runBunInstall(bunEnv, packageDir);
  const written = await layout();
  const lockfile = await file(join(packageDir, "bun.lock")).text();

  // the tree on disk is the tree the lockfile describes, so reinstalling from it is a no-op
  const { out, err } = await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
  expect(out).toContain("(no changes)");
  expect(err).not.toContain("Saved lockfile");
  expect(await layout()).toEqual(written);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);

  // the peer is bound to the highest satisfying version, and peer-deps-fixed hoists it first
  expect(written).toEqual({ root: "1.0.1", "one-dep": null, "one-fixed-dep": "1.0.0" });
  expect(lockfile).toContain('"no-deps": ["no-deps@1.0.1"');
  expect(lockfile).toContain('"one-fixed-dep/no-deps": ["no-deps@1.0.0"');

  // a fresh resolve of the same package.json binds the peer the same way
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "bun.lock"));
  await runBunInstall(bunEnv, packageDir);
  expect(await layout()).toEqual(written);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
});

type Linker = "hoisted" | "isolated";

// `createTestDir` hands back a plain path, so nothing removes the directory. Each case below
// installs into two of them, with a cache inside each.
const createdDirs: string[] = [];
async function createTestDir(opts: Parameters<typeof registry.createTestDir>[0]) {
  const { packageDir } = await registry.createTestDir(opts);
  createdDirs.push(packageDir);
  return packageDir;
}
afterAll(async () => {
  await Promise.all(createdDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

// The timeout only matters if an install never returns. The runner does not clean up the children
// of concurrent tests, so without it a layout that stops terminating would keep running, and
// growing, after its test has failed.
//
// CI exports one BUN_INSTALL_CACHE_DIR per test file, which overrides the per-directory cache in
// bunfig.toml. These cases run concurrently and install the same packages, and on Windows installs
// racing on one cache fail with "Failed to install 1 package", so each directory gets its own.
async function spawnBun(cwd: string, ...cmd: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
    timeout: isASAN ? 90_000 : 30_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { cmd, stdout, stderr, signalCode: proc.signalCode, exitCode };
}

async function run(cwd: string, ...cmd: string[]) {
  const result = await spawnBun(cwd, ...cmd);
  expect(result).toMatchObject({
    stderr: expect.not.stringContaining("error:"),
    signalCode: null,
    exitCode: 0,
  });
  return result.stdout;
}

// bun.lock keys `packages` by node_modules path; this maps each path to what is installed there.
async function lockfileTree(dir: string) {
  const { packages } = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as {
    packages: Record<string, [string, ...unknown[]]>;
  };
  return Object.fromEntries(Object.entries(packages).map(([path, [resolution]]) => [path, resolution]));
}

async function installedPackageJsons(dir: string) {
  const nodeModules = join(dir, "node_modules");
  const paths = await Array.fromAsync(new Bun.Glob("**/package.json").scan({ cwd: nodeModules, dot: true }));
  return paths.map(path => path.replaceAll("\\", "/")).sort();
}

// The same `edges()` every below-self-* and self-contained-* fixture exports. The project gets one
// too, because under the isolated linker only the project itself goes through the links in its node_modules.
const edgesJs = `exports.edges = () => {
  const { dependencies = {}, peerDependencies = {} } = require("./package.json");
  return Object.fromEntries(
    Object.keys({ ...dependencies, ...peerDependencies }).map(name => [name, require(name + "/package.json").version]),
  );
};
`;

// Loads the project and every installed fixture package from where it is on disk and lets each
// resolve its own dependencies. Returns one entry per project and per installed copy: what it is,
// and any dependency that resolved to a version other than the exact one it declares.
const probe = `
  const { join, dirname } = require("node:path");
  const { existsSync } = require("node:fs");
  const [projects, roots] = JSON.parse(process.argv[1]);
  const dirs = [...projects];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const rel of new Bun.Glob("**/package.json").scanSync({ cwd: root, dot: true })) dirs.push(dirname(join(root, rel)));
  }
  const out = dirs.map(dir => {
    const pkg = require(join(dir, "package.json"));
    const declared = { ...pkg.dependencies, ...pkg.peerDependencies };
    let wrong;
    try {
      const edges = require(join(dir, "index.js")).edges();
      wrong = Object.keys(declared).filter(name => edges[name] !== declared[name]).map(name => name + ": wanted " + declared[name] + ", got " + edges[name]);
    } catch (e) {
      // Also for a package without dependencies: a copy that cannot be loaded is not a good copy.
      wrong = ["edges() failed: " + String(e)];
    }
    return { id: pkg.version ? pkg.name + "@" + pkg.version : pkg.name, wrong };
  });
  console.log(JSON.stringify(out.sort((a, b) => a.id.localeCompare(b.id))));
`;

async function installedCopies(dir: string, project: string, nodeModules: string[]) {
  const args = [[join(dir, project)], nodeModules.map(rel => join(dir, rel))];
  return JSON.parse(await run(dir, "-e", probe, JSON.stringify(args))) as { id: string; wrong: string[] }[];
}

// Installs `files` from scratch, then in a new directory from the bun.lock that produced.
// `project` is the directory of the package whose dependencies are installed: "." or a workspace.
async function installFreshAndFromLockfile(opts: {
  files: Record<string, string>;
  linker: Linker;
  tree: Record<string, string>;
  copies: string[];
  project?: string;
  nodeModules?: string[];
}) {
  const project = opts.project ?? ".";
  const nodeModules = opts.nodeModules ?? ["node_modules"];
  // Keys of `files` use "/" on every platform, so they are not built with path.join.
  const prefix = project === "." ? "" : `${project}/`;
  const files = { ...opts.files, [`${prefix}index.js`]: edgesJs };
  const { name, version } = JSON.parse(files[`${prefix}package.json`]);

  const packageDir = await createTestDir({ bunfigOpts: { linker: opts.linker }, files });
  await run(packageDir, "install");
  const lockfile = await Bun.file(join(packageDir, "bun.lock")).text();
  expect(await lockfileTree(packageDir)).toEqual(opts.tree);

  // The project and every copy are there, and each resolves every dependency to the version it asks for.
  const expected = [version ? `${name}@${version}` : name, ...opts.copies]
    .map(id => ({ id, wrong: [] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  expect(await installedCopies(packageDir, project, nodeModules)).toEqual(expected);

  const reloadDir = await createTestDir({
    bunfigOpts: { linker: opts.linker },
    files: { ...files, "bun.lock": lockfile },
  });
  await run(reloadDir, "install", "--frozen-lockfile");
  expect(await installedCopies(reloadDir, project, nodeModules)).toEqual(expected);

  // --lockfile-only always writes, so this is the tree a reload builds, printed back.
  await run(reloadDir, "install", "--lockfile-only");
  expect(await Bun.file(join(reloadDir, "bun.lock")).text()).toBe(lockfile);

  return { packageDir, reloadDir };
}

// The hoist-*-cycle-* fixtures are described in registry/packages/create-hoist-cycle-packages.ts.
//
// Every package of these cycles conflicts with the version of its name one level up, so each copy
// needs another copy nested below it and no finite node_modules holds them. bun.lock is keyed by
// node_modules path, so the isolated linker cannot install them either. `bun install` used to nest
// until it ran out of memory.
describe.concurrent("a dependency cycle that nests without end is an error", () => {
  const x = "hoist-cycle-x";
  const y = "hoist-cycle-y";
  const peer = "hoist-optional-peer-cycle-";
  const twoVersions = `${y}@1.0.0 > ${x}@2.0.0 > ${y}@2.0.0 > ${x}@1.0.0 > ${y}@1.0.0`;

  test.each([
    [
      "through two versions of the same packages (hoisted linker)",
      "hoisted",
      { "package.json": JSON.stringify({ name: "pkg", dependencies: { [x]: "1.0.0" } }) },
      twoVersions,
    ],
    [
      "through two versions of the same packages (isolated linker)",
      "isolated",
      { "package.json": JSON.stringify({ name: "pkg", dependencies: { [x]: "1.0.0" } }) },
      twoVersions,
    ],
    [
      "entered at both of its versions, from the root and from a workspace",
      "hoisted",
      {
        "package.json": JSON.stringify({ name: "pkg", workspaces: ["packages/*"], dependencies: { [x]: "1.0.0" } }),
        "packages/app/package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { [x]: "2.0.0" } }),
      },
      twoVersions,
    ],
    [
      "closed through an optional peer",
      "hoisted",
      {
        "package.json": JSON.stringify({
          name: "pkg",
          dependencies: { [`${peer}x`]: "2.0.0" },
          devDependencies: { [`${peer}entry`]: "1.0.0" },
        }),
      },
      `${peer}y@1.0.0 > ${peer}x@2.0.0 > ${peer}y@2.0.0 > ${peer}x@1.0.0 > ${peer}y@1.0.0`,
    ],
  ] as const)("%s", async (_, linker, files, cycle) => {
    for (const args of [[], ["--lockfile-only"]]) {
      const packageDir = await createTestDir({ bunfigOpts: { linker }, files });
      expect(await spawnBun(packageDir, "install", ...args)).toMatchObject({
        stderr: expect.stringContaining(`error: dependency cycle cannot be laid out in node_modules: ${cycle}\n`),
        signalCode: null,
        exitCode: 1,
      });
      expect({
        lockfile: existsSync(join(packageDir, "bun.lock")),
        nodeModules: existsSync(join(packageDir, "node_modules")),
      }).toEqual({ lockfile: false, nodeModules: false });
    }
  });
});

test.concurrent.each(["hoisted", "isolated"] as const)(
  "a bundled dependency with a peer on the package bundling it is installed (%s linker)",
  async linker => {
    // The plugin's peer is satisfied by the host it is bundled in. The host used to be copied into
    // its own node_modules instead, and the copy bundled the plugin again below it, and so on.
    const files = {
      "package.json": JSON.stringify({ name: "pkg", dependencies: { "hoist-bundled-cycle-host": "1.0.0" } }),
    };

    const packageDir = await createTestDir({ bunfigOpts: { linker }, files });
    await run(packageDir, "install");
    const lockfile = await Bun.file(join(packageDir, "bun.lock")).text();
    expect(await lockfileTree(packageDir)).toEqual({
      "hoist-bundled-cycle-host": "hoist-bundled-cycle-host@1.0.0",
      "hoist-bundled-cycle-host/hoist-bundled-cycle-plugin": "hoist-bundled-cycle-plugin@1.0.0",
    });

    const reloadDir = await createTestDir({ bunfigOpts: { linker }, files: { ...files, "bun.lock": lockfile } });
    await run(reloadDir, "install", "--frozen-lockfile");
    expect(await installedPackageJsons(reloadDir)).toEqual(await installedPackageJsons(packageDir));

    await run(reloadDir, "install", "--lockfile-only");
    expect(await Bun.file(join(reloadDir, "bun.lock")).text()).toBe(lockfile);
  },
);

// The below-self-* and self-contained-* fixtures are described in
// registry/packages/create-hoist-below-self-packages.ts.
//
// These layouts end, so the error above must leave them alone: a package installed a second time
// below another copy of itself still has to get its own node_modules, because what was nested in
// between shadows some of its dependencies.
describe.concurrent("a package installed again below another copy of itself", () => {
  test.each(["hoisted", "isolated"] as const)(
    "gets the dependency that the versions nested in between shadow (%s linker)",
    async linker => {
      const a1 = "below-self-a@1.0.0";
      const e1 = "below-self-e@1.0.0";
      await installFreshAndFromLockfile({
        linker,
        files: {
          "package.json": JSON.stringify({
            name: "pkg",
            dependencies: {
              "below-self-a": "1.0.0",
              "below-self-b": "2.0.0",
              "below-self-c": "2.0.0",
              "below-self-e": "2.0.0",
            },
          }),
        },
        tree: {
          "below-self-a": a1,
          "below-self-b": "below-self-b@2.0.0",
          "below-self-c": "below-self-c@2.0.0",
          "below-self-e": "below-self-e@2.0.0",
          "below-self-a/below-self-b": "below-self-b@1.0.0",
          "below-self-a/below-self-e": e1,
          "below-self-a/below-self-b/below-self-a": "below-self-a@2.0.0",
          "below-self-a/below-self-b/below-self-a/below-self-c": "below-self-c@1.0.0",
          "below-self-a/below-self-b/below-self-a/below-self-e": "below-self-e@3.0.0",
          // a@1.0.0 again, now below a@2.0.0's e@3.0.0, so it needs an e@1.0.0 of its own.
          "below-self-a/below-self-b/below-self-a/below-self-c/below-self-a": a1,
          "below-self-a/below-self-b/below-self-a/below-self-c/below-self-a/below-self-e": e1,
        },
        copies:
          linker === "hoisted"
            ? [
                a1,
                a1,
                "below-self-a@2.0.0",
                "below-self-b@1.0.0",
                "below-self-b@2.0.0",
                "below-self-c@1.0.0",
                "below-self-c@2.0.0",
                e1,
                e1,
                "below-self-e@2.0.0",
                "below-self-e@3.0.0",
              ]
            : [
                a1,
                "below-self-a@2.0.0",
                "below-self-b@1.0.0",
                "below-self-b@2.0.0",
                "below-self-c@1.0.0",
                "below-self-c@2.0.0",
                e1,
                "below-self-e@2.0.0",
                "below-self-e@3.0.0",
              ],
      });
    },
  );

  test.each(["hoisted", "isolated"] as const)(
    "has its dependencies laid out again, and the layout ends where one is found (%s linker)",
    async linker => {
      const a1 = "below-self-again-a@1.0.0";
      const a2 = "below-self-again-a@2.0.0";
      const b1 = "below-self-again-b@1.0.0";
      const b3 = "below-self-again-b@3.0.0";
      await installFreshAndFromLockfile({
        linker,
        files: {
          "package.json": JSON.stringify({
            name: "pkg",
            dependencies: {
              "below-self-again-a": "1.0.0",
              "below-self-again-b": "2.0.0",
              "below-self-again-c": "2.0.0",
            },
          }),
        },
        tree: {
          "below-self-again-a": a1,
          "below-self-again-b": "below-self-again-b@2.0.0",
          "below-self-again-c": "below-self-again-c@2.0.0",
          "below-self-again-a/below-self-again-b": b1,
          "below-self-again-a/below-self-again-b/below-self-again-a": a2,
          "below-self-again-a/below-self-again-b/below-self-again-a/below-self-again-b": b3,
          "below-self-again-a/below-self-again-b/below-self-again-a/below-self-again-c": "below-self-again-c@1.0.0",
          // a@1.0.0 again, below a@2.0.0's b@3.0.0: its b@1.0.0, and what that needs, are nested once more.
          "below-self-again-a/below-self-again-b/below-self-again-a/below-self-again-c/below-self-again-a": a1,
          "below-self-again-a/below-self-again-b/below-self-again-a/below-self-again-c/below-self-again-a/below-self-again-b":
            b1,
          "below-self-again-a/below-self-again-b/below-self-again-a/below-self-again-c/below-self-again-a/below-self-again-b/below-self-again-a":
            a2,
          "below-self-again-a/below-self-again-b/below-self-again-a/below-self-again-c/below-self-again-a/below-self-again-b/below-self-again-a/below-self-again-b":
            b3,
        },
        copies:
          linker === "hoisted"
            ? [
                a1,
                a1,
                a2,
                a2,
                b1,
                b1,
                "below-self-again-b@2.0.0",
                b3,
                b3,
                "below-self-again-c@1.0.0",
                "below-self-again-c@2.0.0",
              ]
            : [a1, a2, b1, "below-self-again-b@2.0.0", b3, "below-self-again-c@1.0.0", "below-self-again-c@2.0.0"],
      });
    },
  );
});

// docs/pm/workspaces.mdx: nothing a self-contained workspace depends on is placed above its own
// node_modules. That includes the workspace itself when one of its dependencies depends back on it.
describe.concurrent("a self-contained workspace", () => {
  const rootPackageJson = JSON.stringify({
    name: "root",
    private: true,
    workspaces: { packages: ["apps/*"], selfContained: ["apps/desktop"] },
  });

  test.each([
    ["a dependency", "self-contained-plugin"],
    ["a peer dependency", "self-contained-peer-plugin"],
  ])("is linked into its own node_modules for a package with %s on it", async (_, plugin) => {
    const { packageDir, reloadDir } = await installFreshAndFromLockfile({
      linker: "hoisted",
      files: {
        "package.json": rootPackageJson,
        "apps/desktop/package.json": JSON.stringify({
          name: "self-contained-app",
          version: "1.0.0",
          dependencies: { [plugin]: "1.0.0" },
        }),
      },
      tree: {
        "self-contained-app": "self-contained-app@workspace:apps/desktop",
        [plugin]: `${plugin}@1.0.0`,
      },
      copies: [`${plugin}@1.0.0`],
      project: "apps/desktop",
      nodeModules: ["node_modules", "apps/desktop/node_modules"],
    });

    for (const dir of [packageDir, reloadDir]) {
      const desktop = join(dir, "apps", "desktop");
      // bun.lock is the same with and without `selfContained`, so where the plugin is placed
      // only shows on disk: inside the workspace, and not above it.
      expect({
        inWorkspace: existsSync(join(desktop, "node_modules", plugin, "package.json")),
        aboveWorkspace: existsSync(join(dir, "node_modules", plugin)),
      }).toEqual({ inWorkspace: true, aboveWorkspace: false });
      expect(realpathSync(join(desktop, "node_modules", "self-contained-app"))).toBe(realpathSync(desktop));
    }
  });

  // What keeps a bundle's dependency out of the bundling package's node_modules does not apply here.
  const versionIn = async (dir: string, ...path: string[]) => {
    const packageJson = join(dir, "apps", "desktop", "node_modules", ...path, "no-deps", "package.json");
    return existsSync(packageJson) ? (await file(packageJson).json()).version : null;
  };

  test("hoists one of two versions its dependencies need to the top of its node_modules", async () => {
    const packageDir = await createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": rootPackageJson,
        // one-dep depends on no-deps@1.0.1, one-fixed-dep on no-deps@1.0.0
        "apps/desktop/package.json": JSON.stringify({
          name: "desktop",
          dependencies: { "one-dep": "1.0.0", "one-fixed-dep": "1.0.0" },
        }),
      },
    });
    await run(packageDir, "install");
    expect({
      top: await versionIn(packageDir),
      "one-dep": await versionIn(packageDir, "one-dep", "node_modules"),
      "one-fixed-dep": await versionIn(packageDir, "one-fixed-dep", "node_modules"),
    }).toEqual({ top: "1.0.1", "one-dep": null, "one-fixed-dep": "1.0.0" });
  });

  test("hoists a dependency's version of a name whose own devDependency --production leaves out", async () => {
    const packageDir = await createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": rootPackageJson,
        "apps/desktop/package.json": JSON.stringify({
          name: "desktop",
          dependencies: { "one-dep": "1.0.0" },
          devDependencies: { "no-deps": "1.0.0" },
        }),
      },
    });
    await run(packageDir, "install", "--lockfile-only");
    await run(packageDir, "install", "--production");
    expect({
      top: await versionIn(packageDir),
      "one-dep": await versionIn(packageDir, "one-dep", "node_modules"),
    }).toEqual({ top: "1.0.1", "one-dep": null });
  });
});

// A peer whose own resolution conflicts with the copy the root package.json put
// at the top of node_modules is served by the root's copy whatever its range
// says (Tree.hoist_dependency). The install doing that has to say so; the
// resolver's own `incorrect peer dependency` warning only covers peers it bound
// out of range itself.
const peerWarnings = (stderr: string) => stderr.match(/^warn: incorrect peer dependency [^\r\n]*/gm) ?? [];
// CI exports BUN_INSTALL_CACHE_DIR, which overrides the harness bunfig's per-test `cache`; concurrent cases sharing one cache race on Windows.
const installEnv = (dir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });
const installedVersion = async (packageDir: string, ...path: string[]) =>
  (await file(join(packageDir, "node_modules", ...path, "package.json")).json()).version;
const hasOwnNodeModules = (packageDir: string, name: string) =>
  exists(join(packageDir, "node_modules", name, "node_modules"));

test.concurrent("warns when a workspace member's peer is served by a root dependency outside its range", async () => {
  const rootPackageJson = (noDeps: string) =>
    JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": noDeps } });
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: {
      "package.json": rootPackageJson("^1.0.0"),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        peerDependencies: { "no-deps": "^1.0.0" },
      }),
    },
  });

  // The member's peer binds to the root's no-deps@1.1.0: nothing to report.
  await runBunInstall(installEnv(packageDir), packageDir);
  expect(await installedVersion(packageDir, "no-deps")).toBe("1.1.0");

  // The peer stays bound to 1.1.0, but the tree only has room for the root's
  // new copy, so pkg1 gets no-deps@2.0.0. Reported once: the tree is also built
  // while loading and cleaning the lockfile, and those builds stay quiet.
  await write(packageJson, rootPackageJson("^2.0.0"));
  const { err } = await runBunInstall(installEnv(packageDir), packageDir, { allowWarnings: true });
  expect(peerWarnings(err)).toEqual([
    'warn: incorrect peer dependency "no-deps@2.0.0": "pkg1@workspace:packages/pkg1" requires "no-deps@^1.0.0"',
  ]);
  expect(await installedVersion(packageDir, "no-deps")).toBe("2.0.0");
  expect(await hasOwnNodeModules(packageDir, "pkg1")).toBe(false);
});

test.concurrent(
  "warns on every install while a dependency's peer is served by a root dependency outside its range",
  async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          dependencies: {
            // peer-deps-fixed@1.0.0 has a peer on no-deps@^1.0.0.
            // provides-peer-deps-1-0-0 depends on no-deps@1.0.0, which the
            // resolver binds that peer to, so the resolver itself has nothing
            // to warn about.
            "peer-deps-fixed": "1.0.0",
            "no-deps": "2.0.0",
            "provides-peer-deps-1-0-0": "1.0.0",
          },
        }),
      },
    });
    const expected =
      'warn: incorrect peer dependency "no-deps@2.0.0": "peer-deps-fixed@1.0.0" requires "no-deps@^1.0.0"';

    const fresh = await runBunInstall(installEnv(packageDir), packageDir, { allowWarnings: true });
    expect(peerWarnings(fresh.err)).toEqual([expected]);
    expect(await installedVersion(packageDir, "no-deps")).toBe("2.0.0");
    expect(await installedVersion(packageDir, "provides-peer-deps-1-0-0", "node_modules", "no-deps")).toBe("1.0.0");
    expect(await hasOwnNodeModules(packageDir, "peer-deps-fixed")).toBe(false);

    // Nothing changed, so the same tree gets installed again.
    const again = await runBunInstall(installEnv(packageDir), packageDir, {
      allowWarnings: true,
      savesLockfile: false,
    });
    expect(peerWarnings(again.err)).toEqual([expected]);
  },
);

// The root provides no-deps as something other than a registry package. A
// workspace is checked through its own version; a copy with no version in the
// lockfile (a tarball here, git would be the same) cannot be checked and is
// never reported.
const workspaceNoDeps = (version?: string) => ({
  "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version }),
});
const tarballNoDeps = {
  "no-deps-2.0.0.tgz": readFileSync(join(registry.packagesPath, "no-deps", "no-deps-2.0.0.tgz")),
};
test.concurrent.each([
  [
    "a workspace at 2.0.0",
    "warns",
    workspaceNoDeps("2.0.0"),
    {},
    [
      'warn: incorrect peer dependency "no-deps@workspace:packages/no-deps": "peer-deps-fixed@1.0.0" requires "no-deps@^1.0.0"',
    ],
    "2.0.0",
  ],
  ["a workspace at 1.5.0", "is quiet", workspaceNoDeps("1.5.0"), {}, [], "1.5.0"],
  ["a workspace without a version", "is quiet", workspaceNoDeps(), {}, [], undefined],
  ["a file: tarball of 2.0.0", "is quiet", tarballNoDeps, { "no-deps": "file:./no-deps-2.0.0.tgz" }, [], "2.0.0"],
])(
  "root-provided no-deps (%s) serving a dependency's no-deps@^1.0.0 peer %s",
  async (_, __, files, noDepsDependency, warnings, installed) => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        ...files,
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { "peer-deps-fixed": "1.0.0", "provides-peer-deps-1-0-0": "1.0.0", ...noDepsDependency },
        }),
      },
    });

    const { err } = await runBunInstall(installEnv(packageDir), packageDir, { allowWarnings: warnings.length > 0 });
    expect(peerWarnings(err)).toEqual(warnings);
    expect(await installedVersion(packageDir, "no-deps")).toBe(installed);
    expect(await installedVersion(packageDir, "provides-peer-deps-1-0-0", "node_modules", "no-deps")).toBe("1.0.0");
    expect(await hasOwnNodeModules(packageDir, "peer-deps-fixed")).toBe(false);
  },
);

// one-optional-peer-dep has a peer on no-deps@^1.0.0: required in 1.0.1, optional in 1.0.2.
test.concurrent.each([
  [
    "1.0.1",
    "is reported",
    ['warn: incorrect peer dependency "no-deps@2.0.0": "one-optional-peer-dep@1.0.1" requires "no-deps@^1.0.0"'],
  ],
  ["1.0.2", "is rebound quietly", []],
])(
  "a peer of one-optional-peer-dep@%s left on no-deps@1.0.0 when the root moves to 2.0.0 %s",
  async (version, _, warnings) => {
    const rootPackageJson = (noDeps: string) =>
      JSON.stringify({
        name: "root",
        dependencies: {
          "one-optional-peer-dep": version,
          "no-deps": noDeps,
          // Keeps no-deps@1.0.0, and with it the peer's binding to it, in the lockfile after the root moves on.
          "provides-peer-deps-1-0-0": "1.0.0",
        },
      });
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: { "package.json": rootPackageJson("1.0.0") },
    });

    await runBunInstall(installEnv(packageDir), packageDir);
    expect(await installedVersion(packageDir, "no-deps")).toBe("1.0.0");

    await write(packageJson, rootPackageJson("2.0.0"));
    const { err } = await runBunInstall(installEnv(packageDir), packageDir, { allowWarnings: warnings.length > 0 });
    expect(peerWarnings(err)).toEqual(warnings);
    expect(await installedVersion(packageDir, "no-deps")).toBe("2.0.0");
    expect(await installedVersion(packageDir, "provides-peer-deps-1-0-0", "node_modules", "no-deps")).toBe("1.0.0");
    expect(await hasOwnNodeModules(packageDir, "one-optional-peer-dep")).toBe(false);
  },
);
