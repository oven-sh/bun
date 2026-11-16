import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { exists, rm } from "fs/promises";
import { bunEnv, bunExe, githubTarball, isASAN, isWindows, pack, readdirSorted, runBunInstall, tempDir } from "harness";
import { dirname, join } from "path";
import { installEnv, TestRegistry } from "registry";
import { pathToFileURL } from "url";

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

test("the tree that's written after a ranged peer gains a higher candidate is the tree that the next install produces", async () => {
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

// Fake api.github.com. Responds to every request with the `me/n` archive.
let github: Bun.Server<undefined> | undefined;
const githubFiles = {
  "package.json": JSON.stringify({ name: "n", version: "1.0.0", dependencies: { b: "^2.0.0" } }),
  "index.js": `module.exports = require("b/package.json").version;`,
};
beforeAll(() => {
  github = Bun.serve({ port: 0, fetch: async () => new Response(await githubTarball("me-n-abcdef1", githubFiles)) });
});
afterAll(() => github?.stop(true));

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
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"), GITHUB_API_URL: github?.url.origin },
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

// bun.lock keys `packages` by node_modules path. This maps each path to what's installed there.
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
      // This also applies to a package without dependencies, because a copy that can't be loaded isn't a valid copy.
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

  // The project and every copy exist, and each one resolves every dependency to the version it asks for.
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
          dependencies: { other: `npm:${peer}x@2.0.0` },
          devDependencies: { [`${peer}entry`]: "1.0.0" },
        }),
      },
      `${peer}y@1.0.0 > ${peer}x@2.0.0 > ${peer}y@2.0.0 > ${peer}x@1.0.0 > ${peer}y@1.0.0`,
    ],
  ] as const)("%s", async (_, linker, files, cycle) => {
    for (const args of [[], ["--lockfile-only"]]) {
      const packageDir = await createTestDir({ bunfigOpts: { linker }, files });
      expect(await spawnBun(packageDir, "install", ...args)).toMatchObject({
        stderr: expect.stringContaining(`error: cannot install dependency cycle into node_modules: ${cycle}\n`),
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
  "the same packages are installed when the optional peer is bound to the root's version (%s linker)",
  async linker => {
    // With x@2.0.0 as the root's x, y@2.0.0 is first placed next to it, which binds the optional peer. The y@2.0.0 next
    // to x@1.0.0 shares that x and doesn't rebind the peer. So the y@2.0.0 below the nested x@2.0.0 already has what
    // it's bound to, and nothing is nested again.
    const at = (...names: string[]) => names.map(name => `hoist-optional-peer-cycle-${name}`).join("/");
    const files = {
      "package.json": JSON.stringify({
        name: "pkg",
        dependencies: { [at("x")]: "2.0.0" },
        devDependencies: { [at("entry")]: "1.0.0" },
      }),
    };

    const packageDir = await createTestDir({ bunfigOpts: { linker }, files });
    await run(packageDir, "install");
    const lockfile = await Bun.file(join(packageDir, "bun.lock")).text();
    expect(await lockfileTree(packageDir)).toEqual({
      [at("entry")]: `${at("entry")}@1.0.0`,
      [at("x")]: `${at("x")}@2.0.0`,
      [at("y")]: `${at("y")}@2.0.0`,
      [at("z")]: `${at("z")}@2.0.0`,
      [at("entry", "x")]: `${at("x")}@1.0.0`,
      [at("entry", "x", "y")]: `${at("y")}@1.0.0`,
      [at("entry", "x", "z")]: `${at("z")}@1.0.0`,
      [at("entry", "x", "y", "x")]: `${at("x")}@2.0.0`,
      [at("entry", "x", "z", "y")]: `${at("y")}@2.0.0`,
      [at("entry", "x", "y", "x", "y")]: `${at("y")}@2.0.0`,
      [at("entry", "x", "y", "x", "z")]: `${at("z")}@2.0.0`,
    });
    const installed = await installedPackageJsons(packageDir);

    await run(packageDir, "install", "--frozen-lockfile");
    expect(await run(packageDir, "install")).toContain("(no changes)");
    expect(await installedPackageJsons(packageDir)).toEqual(installed);
    expect(await Bun.file(join(packageDir, "bun.lock")).text()).toBe(lockfile);

    const reloadDir = await createTestDir({ bunfigOpts: { linker }, files: { ...files, "bun.lock": lockfile } });
    await run(reloadDir, "install", "--frozen-lockfile");
    expect(await installedPackageJsons(reloadDir)).toEqual(installed);

    await run(reloadDir, "install", "--lockfile-only");
    expect(await Bun.file(join(reloadDir, "bun.lock")).text()).toBe(lockfile);
  },
);

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
          // a@1.0.0 again, this time below a@2.0.0's e@3.0.0, so it needs its own e@1.0.0.
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
    "gets its dependencies installed again, and the nesting ends where one is found (%s linker)",
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

// docs/pm/workspaces.mdx: none of a self-contained workspace's dependencies are placed above its own node_modules. That
// includes the workspace itself if one of its dependencies depends back on it.
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
      // bun.lock is the same with and without `selfContained`, so the plugin's placement is only visible on disk:
      // inside the workspace, and not above it.
      expect({
        inWorkspace: existsSync(join(desktop, "node_modules", plugin, "package.json")),
        aboveWorkspace: existsSync(join(dir, "node_modules", plugin)),
      }).toEqual({ inWorkspace: true, aboveWorkspace: false });
      expect(realpathSync(join(desktop, "node_modules", "self-contained-app"))).toBe(realpathSync(desktop));
    }
  });

  // The rule that keeps a bundle's dependency out of the bundling package's node_modules doesn't apply here.
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

  test("keeps the slot for its own devDependency free when --production skips it", async () => {
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
    }).toEqual({ top: null, "one-dep": "1.0.1" });
  });

  test.each([
    { at: [], command: ["add", "d"] },
    { at: [], command: ["remove", "elsewhere"] },
    { at: ["apps", "desktop"], command: ["add", "d"] },
  ])("bun $command in $at leaves in its node_modules what bun did not put there", async ({ at, command }) => {
    using server = await serveGraph({
      a: { "1.0.0": {} },
      d: { "1.0.0": {} },
      big: { "1.0.0": { dependencies: { a: "1.0.0" } } },
      elsewhere: { "1.0.0": {} },
      linked: { "1.0.0": {} },
    });
    using tmp = tempDir("self-contained-by-hand", {
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({
        name: "root",
        workspaces: { packages: ["apps/*"], selfContained: ["apps/desktop"] },
        dependencies: { elsewhere: "1.0.0", linked: "1.0.0" },
      }),
      "apps/desktop/package.json": JSON.stringify({
        name: "desktop",
        version: "1.0.0",
        dependencies: { big: "1.0.0" },
      }),
    });
    const dir = String(tmp);
    const nodeModules = join(dir, "apps", "desktop", "node_modules");
    await run(dir, "install");
    // Two have the name of a package that only the root depends on.
    await write(join(nodeModules, "by-hand", "package.json"), JSON.stringify({ name: "by-hand", version: "1.0.0" }));
    await write(join(nodeModules, "elsewhere", "mine.txt"), "mine");
    symlinkSync(join(dir, "apps"), join(nodeModules, "linked"), "junction");

    await run(join(dir, ...at), ...command);
    expect((await readdirSorted(nodeModules)).filter(name => !name.startsWith(".") && name !== "d")).toEqual([
      "a",
      "big",
      "by-hand",
      "elsewhere",
      "linked",
    ]);
  });
});

// If a peer's own resolution conflicts with the copy that the root package.json put at the top of node_modules, the
// peer uses the root's copy regardless of its range (Tree.hoist_dependency). The install that does that has to report
// it, even if an in-range copy is somewhere else in the tree.
const peerWarnings = (stderr: string) => stderr.match(/^warn: incorrect peer dependency [^\r\n]*/gm) ?? [];
const installedVersion = async (packageDir: string, ...path: string[]) =>
  (await file(join(packageDir, "node_modules", ...path, "package.json")).json()).version;
const hasOwnNodeModules = (packageDir: string, name: string) =>
  exists(join(packageDir, "node_modules", name, "node_modules"));

test.concurrent("warns when a workspace's peer gets a root dependency outside its range", async () => {
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
  await runBunInstall(installEnv(packageDir), packageDir, { verbose: true });
  expect(await installedVersion(packageDir, "no-deps")).toBe("1.1.0");

  // The peer stays bound to 1.1.0, but the tree only has room for the root's
  // new copy, so pkg1 gets no-deps@2.0.0. Reported once: the tree is also built
  // while loading and cleaning the lockfile, and those builds stay quiet.
  await write(packageJson, rootPackageJson("^2.0.0"));
  const { err } = await runBunInstall(installEnv(packageDir), packageDir, { allowWarnings: true, verbose: true });
  expect(peerWarnings(err)).toEqual([
    'warn: incorrect peer dependency "no-deps@2.0.0": "pkg1@workspace:packages/pkg1" requires "no-deps@^1.0.0"',
  ]);
  expect(await installedVersion(packageDir, "no-deps")).toBe("2.0.0");
  expect(await hasOwnNodeModules(packageDir, "pkg1")).toBe(false);
});

test.concurrent(
  "the install that resolves it warns when a dependency's peer is served by a root dependency outside its range",
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

    const fresh = await runBunInstall(installEnv(packageDir), packageDir, { allowWarnings: true, verbose: true });
    expect(peerWarnings(fresh.err)).toEqual([expected]);
    expect(await installedVersion(packageDir, "no-deps")).toBe("2.0.0");
    expect(await installedVersion(packageDir, "provides-peer-deps-1-0-0", "node_modules", "no-deps")).toBe("1.0.0");
    expect(await hasOwnNodeModules(packageDir, "peer-deps-fixed")).toBe(false);

    // An install that has nothing to resolve does not repeat it.
    const again = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false, verbose: true });
    expect(peerWarnings(again.err)).toEqual([]);
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

    const { err } = await runBunInstall(installEnv(packageDir), packageDir, {
      allowWarnings: warnings.length > 0,
      verbose: true,
    });
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
    const { err } = await runBunInstall(installEnv(packageDir), packageDir, {
      allowWarnings: warnings.length > 0,
      verbose: true,
    });
    expect(peerWarnings(err)).toEqual(warnings);
    expect(await installedVersion(packageDir, "no-deps")).toBe("2.0.0");
    expect(await installedVersion(packageDir, "provides-peer-deps-1-0-0", "node_modules", "no-deps")).toBe("1.0.0");
    expect(await hasOwnNodeModules(packageDir, "one-optional-peer-dep")).toBe(false);
  },
);

// https://github.com/oven-sh/bun/issues/20376
describe.concurrent("peer dependencies decide how far a package hoists", () => {
  async function version(...path: string[]) {
    return (await Bun.file(join(...path, "package.json")).json()).version;
  }

  // Installs twice, once resolving from scratch and once from the bun.lock the first install wrote.
  // The tests run concurrently and share packages, so each gets its own cache (the env var set by
  // the CI runner would otherwise override the one in bunfig.toml).
  async function installAndCheck(packageDir: string, check: () => Promise<void>) {
    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };
    // Warnings about out-of-range peers aren't what's being tested.
    await runBunInstall(env, packageDir, { allowWarnings: true });
    await check();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    const { err } = await runBunInstall(env, packageDir, { savesLockfile: false, allowWarnings: true });
    expect(err).not.toContain("Saved lockfile");
    await check();
  }

  test("stays next to the peer version it was resolved against", async () => {
    // hoisting-peer-check-parent depends on { hoisting-peer-check-child: 1.0.0, no-deps: 2.0.0 }
    // hoisting-peer-check-child has peerDependencies: { no-deps: 2.0.0 }
    //
    // The root pins no-deps@1.0.0, so no-deps@2.0.0 nests under the parent. The child has to nest
    // with it: hoisted to the root, its `require("no-deps")` would find 1.0.0.
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          dependencies: {
            "no-deps": "1.0.0",
            "hoisting-peer-check-parent": "1.0.0",
          },
        }),
      },
    });

    const nodeModules = join(packageDir, "node_modules");
    await installAndCheck(packageDir, async () => {
      expect(await readdirSorted(join(nodeModules, "hoisting-peer-check-parent", "node_modules"))).toEqual([
        "hoisting-peer-check-child",
        "no-deps",
      ]);
      expect(await version(nodeModules, "no-deps")).toBe("1.0.0");
      expect(await version(nodeModules, "hoisting-peer-check-parent", "node_modules", "no-deps")).toBe("2.0.0");
    });
  });

  test("stays below a peer version provided further up than its own dependent", async () => {
    // mismatched-peer-deps-lvl0 depends on lvl1 and has peerDependencies: { no-deps: <=1.1.0 }
    // mismatched-peer-deps-lvl1 depends on lvl2 and has peerDependencies: { no-deps: <=1.0.1 }
    // mismatched-peer-deps-lvl2 has peerDependencies: { no-deps: 1.0.0 }
    //
    // Only the workspace provides an in-range no-deps. lvl1 and lvl2 depend on nothing that does,
    // but staying under lvl0 keeps the workspace's copy in reach; the root's 2.0.0 is out of range.
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: {
            "no-deps": "1.0.0",
            "mismatched-peer-deps-lvl0": "1.0.0",
          },
        }),
      },
    });

    const appModules = join(packageDir, "packages", "app", "node_modules");
    const lvl0 = join(appModules, "mismatched-peer-deps-lvl0");
    const lvl1 = join(lvl0, "node_modules", "mismatched-peer-deps-lvl1");
    await installAndCheck(packageDir, async () => {
      expect(await version(packageDir, "node_modules", "no-deps")).toBe("2.0.0");
      expect(await readdirSorted(appModules)).toEqual(["mismatched-peer-deps-lvl0", "no-deps"]);
      expect(await version(appModules, "no-deps")).toBe("1.0.0");
      expect(await readdirSorted(join(lvl0, "node_modules"))).toEqual(["mismatched-peer-deps-lvl1"]);
      expect(await readdirSorted(join(lvl1, "node_modules"))).toEqual(["mismatched-peer-deps-lvl2"]);
    });
  });

  test("hoists past an out-of-range version when nothing below would satisfy the peer either", async () => {
    // peer-deps-fixed has peerDependencies: { no-deps: ^1.0.0 }
    //
    // The root pins no-deps@2.0.0 and neither workspace that depends on peer-deps-fixed brings an
    // in-range no-deps along, so a copy under each of them would still resolve the root's 2.0.0.
    // One shared copy at the root, as before. (The third workspace only makes a 1.x exist in the
    // lockfile, so the peer edge resolves to a package other than the root's.)
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
        "packages/a/package.json": JSON.stringify({
          name: "a",
          dependencies: { "peer-deps-fixed": "1.0.0" },
        }),
        "packages/b/package.json": JSON.stringify({
          name: "b",
          dependencies: { "peer-deps-fixed": "1.0.0" },
        }),
        "packages/c/package.json": JSON.stringify({
          name: "c",
          dependencies: { "no-deps": "1.0.0" },
        }),
      },
    });

    await installAndCheck(packageDir, async () => {
      expect(await version(packageDir, "node_modules", "peer-deps-fixed")).toBe("1.0.0");
      expect(await version(packageDir, "node_modules", "no-deps")).toBe("2.0.0");
      expect(await exists(join(packageDir, "packages", "a", "node_modules"))).toBe(false);
      expect(await exists(join(packageDir, "packages", "b", "node_modules"))).toBe(false);
      expect(await readdirSorted(join(packageDir, "packages", "c", "node_modules"))).toEqual(["no-deps"]);
    });
  });

  test("hoists when its own dependent installs an out-of-range copy of the peer", async () => {
    // The a-dep tarball depends on { no-deps: 1.1.0, mismatched-peer-deps-lvl1 } and nests under
    // the workspace because the root has another a-dep. Its no-deps@1.1.0 nests under it too, so
    // that is what lvl1 (peer no-deps <=1.0.1) would find if it stayed there, not the workspace's
    // 1.0.0. Out of range either way, so it hoists to the root like before.
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: {
            "a-dep": "1.0.1",
            "no-deps": "2.0.0",
          },
        }),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: {
            "a-dep": "file:../../a-dep/a-dep-9.0.0.tgz",
            "no-deps": "1.0.0",
          },
        }),
        "a-dep/package.json": JSON.stringify({
          name: "a-dep",
          version: "9.0.0",
          dependencies: {
            "mismatched-peer-deps-lvl1": "1.0.0",
            "no-deps": "1.1.0",
          },
        }),
      },
    });
    await pack(join(packageDir, "a-dep"), bunEnv);

    const appModules = join(packageDir, "packages", "app", "node_modules");
    await installAndCheck(packageDir, async () => {
      expect(await version(packageDir, "node_modules", "mismatched-peer-deps-lvl1")).toBe("1.0.0");
      expect(await version(appModules, "a-dep")).toBe("9.0.0");
      expect(await readdirSorted(join(appModules, "a-dep", "node_modules"))).toEqual(["no-deps"]);
      expect(await version(appModules, "a-dep", "node_modules", "no-deps")).toBe("1.1.0");
    });
  });

  test("hoists when the version at the root satisfies the peer range", async () => {
    // has-peer has peerDependencies: { peer-no-deps: ^1.0.0 }
    // diff-peer-1 depends on { has-peer: 1.0.0, peer-no-deps: 1.0.0 }
    // diff-peer-2 depends on { has-peer: 1.0.0, peer-no-deps: 1.0.1 }
    //
    // The peer edge resolves to 1.0.1, but the 1.0.0 that wins the root slot satisfies ^1.0.0 too,
    // so both dependents share the has-peer at the root. Only peer-no-deps@1.0.1 nests.
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          dependencies: {
            "diff-peer-1": "1.0.0",
            "diff-peer-2": "1.0.0",
          },
        }),
      },
    });

    const nodeModules = join(packageDir, "node_modules");
    await installAndCheck(packageDir, async () => {
      expect(await version(nodeModules, "has-peer")).toBe("1.0.0");
      expect(await version(nodeModules, "peer-no-deps")).toBe("1.0.0");
      expect(await exists(join(nodeModules, "diff-peer-1", "node_modules"))).toBe(false);
      expect(await readdirSorted(join(nodeModules, "diff-peer-2", "node_modules"))).toEqual(["peer-no-deps"]);
      expect(await version(nodeModules, "diff-peer-2", "node_modules", "peer-no-deps")).toBe("1.0.1");
    });
  });

  test("ignores a peer that the package also lists as a regular dependency", async () => {
    // dup-peer lists no-deps@2.0.0 as both a dependency and a peer dependency. The regular
    // dependency is what gets installed under it, so the root's no-deps@1.0.0 is no reason to
    // keep dup-peer out of the root. (Registry manifests drop the duplicate peer edge; a tarball's
    // package.json keeps it.)
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: {
            "dup-peer": "file:../../dup-peer/dup-peer-1.0.0.tgz",
          },
        }),
        "dup-peer/package.json": JSON.stringify({
          name: "dup-peer",
          version: "1.0.0",
          dependencies: { "no-deps": "2.0.0" },
          peerDependencies: { "no-deps": "2.0.0" },
        }),
      },
    });
    await pack(join(packageDir, "dup-peer"), bunEnv);

    const nodeModules = join(packageDir, "node_modules");
    await installAndCheck(packageDir, async () => {
      expect(await version(nodeModules, "no-deps")).toBe("1.0.0");
      expect(await version(nodeModules, "dup-peer", "node_modules", "no-deps")).toBe("2.0.0");
      expect(await exists(join(packageDir, "packages", "app", "node_modules"))).toBe(false);
    });
  });

  test("never nests a workspace package", async () => {
    // A workspace package installs as a symlink to its folder, so a nested link would still
    // resolve the root's no-deps@1.0.0. Its peer range is no reason to add one.
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          peerDependencies: { "no-deps": "2.0.0" },
        }),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: {
            "lib": "workspace:*",
            "no-deps": "2.0.0",
          },
        }),
      },
    });

    const nodeModules = join(packageDir, "node_modules");
    await installAndCheck(packageDir, async () => {
      expect(await version(nodeModules, "no-deps")).toBe("1.0.0");
      expect(await version(nodeModules, "lib")).toBe("1.0.0");
      expect(await readdirSorted(join(packageDir, "packages", "app", "node_modules"))).toEqual(["no-deps"]);
    });
  });
});

// A command that changes bun.lock knows what the previous bun.lock placed. It removes from node_modules what's no
// longer placed, and the nested copies that are now provided from above.
describe.concurrent("packages that are no longer in the tree are removed from node_modules", () => {
  const versionAt = async (...path: string[]) =>
    (await exists(join(...path, "package.json"))) ? (await file(join(...path, "package.json")).json()).version : null;
  const env = (packageDir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") });
  const project = (files: Record<string, object>) =>
    registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
    });

  test("a workspace's own copy, once the workspace uses the version at the root", async () => {
    const { packageDir } = await project({
      "package.json": { name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "2.0.0" } },
      "packages/a/package.json": { name: "a", dependencies: { "no-deps": "1.0.0" } },
      "packages/b/package.json": { name: "b", dependencies: { "no-deps": "1.0.1" } },
    });
    await runBunInstall(env(packageDir), packageDir);
    expect(await versionAt(packageDir, "packages", "a", "node_modules", "no-deps")).toBe("1.0.0");

    await write(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({ name: "a", dependencies: { "no-deps": "2.0.0" } }),
    );
    await runBunInstall(env(packageDir), packageDir);
    expect({
      root: await versionAt(packageDir, "node_modules", "no-deps"),
      a: await versionAt(packageDir, "packages", "a", "node_modules", "no-deps"),
      // Still needs its own.
      b: await versionAt(packageDir, "packages", "b", "node_modules", "no-deps"),
    }).toEqual({ root: "2.0.0", a: null, b: "1.0.1" });
  });

  // `bun prune` is the tool for that.
  test("but not a folder in a workspace's node_modules that bun.lock never placed", async () => {
    const { packageDir, packageJson } = await project({
      "package.json": {
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { "a-dep": "1.0.1", "no-deps": "2.0.0" },
      },
      "packages/a/package.json": { name: "a", dependencies: { "no-deps": "2.0.0" } },
    });
    await runBunInstall(env(packageDir), packageDir);
    await write(
      join(packageDir, "packages", "a", "node_modules", "no-deps", "package.json"),
      JSON.stringify({ name: "no-deps", version: "2.0.0-by-hand" }),
    );
    await write(
      packageJson,
      JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "2.0.0" } }),
    );
    await runBunInstall(env(packageDir), packageDir);
    expect({
      left: await versionAt(packageDir, "node_modules", "a-dep"),
      root: await versionAt(packageDir, "node_modules", "no-deps"),
      a: await versionAt(packageDir, "packages", "a", "node_modules", "no-deps"),
    }).toEqual({ left: null, root: "2.0.0", a: "2.0.0-by-hand" });
  });

  test("but not the copy of a workspace that --filter skips", async () => {
    const { packageDir } = await project({
      "package.json": { name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "2.0.0" } },
      "packages/a/package.json": { name: "a", dependencies: { "no-deps": "1.0.0" } },
      "packages/b/package.json": { name: "b", dependencies: { "no-deps": "1.0.1" } },
    });
    await runBunInstall(env(packageDir), packageDir);
    await write(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({ name: "a", dependencies: { "no-deps": "2.0.0" } }),
    );
    await runBunInstall(env(packageDir), packageDir, { packages: ["--filter", "b"] });
    expect({
      a: await versionAt(packageDir, "packages", "a", "node_modules", "no-deps"),
      b: await versionAt(packageDir, "packages", "b", "node_modules", "no-deps"),
    }).toEqual({ a: "1.0.0", b: "1.0.1" });
  });

  // `a-fixed` (one-fixed-dep@2.0.0) sorts first and puts its `no-deps@2.0.0` at the root, so `one-dep`
  // nests its `no-deps@1.0.1`. Without `a-fixed` the root slot goes to 1.0.1, which a folder left
  // behind would resolve.
  test("a dependency deleted from package.json by hand, with what only it needed and its bin", async () => {
    const { packageDir, packageJson } = await project({
      "package.json": {
        name: "root",
        dependencies: { "a-fixed": "npm:one-fixed-dep@2.0.0", "one-dep": "1.0.0", "what-bin": "1.0.0" },
      },
    });
    await runBunInstall(env(packageDir), packageDir);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bin",
      "a-fixed",
      "no-deps",
      "one-dep",
      "what-bin",
    ]);
    expect([
      await versionAt(packageDir, "node_modules", "no-deps"),
      await versionAt(packageDir, "node_modules", "one-dep", "node_modules", "no-deps"),
    ]).toEqual(["2.0.0", "1.0.1"]);
    // bun.lock never placed it, so removing it is a job for `bun prune`.
    await write(join(packageDir, "node_modules", "by-hand", "package.json"), JSON.stringify({ name: "by-hand" }));

    await write(packageJson, JSON.stringify({ name: "root", dependencies: { "one-dep": "1.0.0" } }));
    await runBunInstall(env(packageDir), packageDir);
    expect((await readdirSorted(join(packageDir, "node_modules"))).filter(name => name !== ".bin")).toEqual([
      "by-hand",
      "no-deps",
      "one-dep",
    ]);
    expect(await exists(join(packageDir, "node_modules", ".bin", "what-bin"))).toBe(false);
    expect([
      await versionAt(packageDir, "node_modules", "no-deps"),
      await versionAt(packageDir, "node_modules", "one-dep", "node_modules", "no-deps"),
    ]).toEqual(["1.0.1", null]);
  });

  // bun.lock places the bundled no-deps under bundled-1, the install places nothing there.
  test("but not what a tarball ships", async () => {
    const { packageDir, packageJson } = await project({
      "package.json": { name: "root", dependencies: { "a-dep": "1.0.1", "bundled-1": "1.0.0" } },
    });
    await runBunInstall(env(packageDir), packageDir);
    await write(packageJson, JSON.stringify({ name: "root", dependencies: { "bundled-1": "1.0.0" } }));
    await runBunInstall(env(packageDir), packageDir);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["bundled-1"]);
    expect(await versionAt(packageDir, "node_modules", "bundled-1", "node_modules", "no-deps")).toBe("1.0.0");
  });

  // The host needs no-deps@2.0.0 and nests it, so bun.lock places the no-deps@1.0.0 of the bundled
  // package one level further down, where the tarball ships it.
  test.each(["install", "update"])(
    "but not what a tarball ships below the package that it bundles (bun %s)",
    async command => {
      const { packageDir, packageJson } = await project({
        "package.json": {
          name: "root",
          dependencies: { "a-dep": "1.0.1", "bundled-conflict-host": "1.0.0", "no-deps": "1.0.1" },
        },
      });
      await runBunInstall(env(packageDir), packageDir);
      await write(
        packageJson,
        JSON.stringify({ name: "root", dependencies: { "bundled-conflict-host": "1.0.0", "no-deps": "1.0.1" } }),
      );
      await using proc = Bun.spawn({ cmd: [bunExe(), command], cwd: packageDir, env: env(packageDir), stderr: "pipe" });
      expect(await proc.stderr.text()).not.toContain("error:");
      const host = join(packageDir, "node_modules", "bundled-conflict-host", "node_modules");
      expect({
        left: await versionAt(packageDir, "node_modules", "a-dep"),
        nested: await versionAt(host, "no-deps"),
        shipped: await versionAt(host, "bundled-shipped-inner", "node_modules", "no-deps"),
      }).toEqual({ left: null, nested: "2.0.0", shipped: "1.0.0" });
      expect(await proc.exited).toBe(0);
    },
  );

  // bun.lock still holds it.
  test("but not a package that an install for another platform placed", async () => {
    const { packageDir, packageJson } = await project({
      "package.json": { name: "root", dependencies: { "a-dep": "1.0.1", "test-native-binlink": "1.0.0" } },
    });
    await runBunInstall(env(packageDir), packageDir);
    await write(packageJson, JSON.stringify({ name: "root", dependencies: { "test-native-binlink": "1.0.0" } }));
    await runBunInstall(env(packageDir), packageDir, { packages: ["--cpu=ppc64"] });
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bin",
      "test-native-binlink",
      "test-native-binlink-target",
    ]);
  });

  test("but not a devDependency that --omit=dev skips", async () => {
    const { packageDir, packageJson } = await project({
      "package.json": {
        name: "root",
        dependencies: { "a-dep": "1.0.1", "no-deps": "1.0.0" },
        devDependencies: { "what-bin": "1.0.0" },
      },
    });
    await runBunInstall(env(packageDir), packageDir);
    await write(
      packageJson,
      JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "what-bin": "1.0.0" } }),
    );
    await runBunInstall(env(packageDir), packageDir, { packages: ["--omit=dev"] });
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "no-deps", "what-bin"]);
  });

  // one-dep nests its no-deps@1.0.1. ships-no-deps declares no dependency, and its tarball holds a no-deps@1.0.0.
  test("but not the folder that a new version of a package ships where the old one had a dependency", async () => {
    const rootPackageJson = (host: string) => ({ name: "root", dependencies: { host, "no-deps": "2.0.0" } });
    const { packageDir, packageJson } = await project({ "package.json": rootPackageJson("npm:one-dep@1.0.0") });
    await runBunInstall(env(packageDir), packageDir);
    expect(await versionAt(packageDir, "node_modules", "host", "node_modules", "no-deps")).toBe("1.0.1");

    await write(packageJson, JSON.stringify(rootPackageJson("npm:ships-no-deps@1.0.0")));
    await runBunInstall(env(packageDir), packageDir);
    expect(await versionAt(packageDir, "node_modules", "host", "node_modules", "no-deps")).toBe("1.0.0");
  });
});

// Maps name -> version -> the other fields of its package.json. `more` maps `name-version` to its other files.
async function serveGraph(
  graph: Record<string, Record<string, object>>,
  more: Record<string, Record<string, string>> = {},
) {
  const tarballs = new Map<string, Uint8Array>();
  for (const [name, versions] of Object.entries(graph)) {
    for (const [version, rest] of Object.entries(versions)) {
      const files: Record<string, string> = { "package/package.json": JSON.stringify({ name, version, ...rest }) };
      for (const [path, text] of Object.entries(more[`${name}-${version}`] ?? {})) files[`package/${path}`] = text;
      tarballs.set(`/${name}-${version}.tgz`, await new Bun.Archive(files, { compress: "gzip" }).bytes());
    }
  }
  return Bun.serve({
    port: 0,
    fetch(request) {
      const { origin, pathname } = new URL(request.url);
      const tarball = tarballs.get(pathname);
      if (tarball) return new Response(tarball);
      const name = pathname.slice(1);
      const versions: Record<string, object> = {};
      for (const [version, rest] of Object.entries(graph[name] ?? {})) {
        versions[version] = { name, version, ...rest, dist: { tarball: `${origin}/${name}-${version}.tgz` } };
      }
      return Response.json({ name, versions, "dist-tags": { latest: Object.keys(versions).at(-1) } });
    },
  });
}

// Every folder in the node_modules of the project and of `members`, as `c/h@1.1.0`. Not the links.
function layout(dir: string, ...members: string[]) {
  const found: string[] = [];
  const walk = (folder: string, label: string) => {
    const nodeModules = join(folder, "node_modules");
    if (!existsSync(nodeModules)) return;
    for (const name of readdirSync(nodeModules).sort()) {
      const path = join(nodeModules, name);
      if (name.startsWith(".") || lstatSync(path).isSymbolicLink()) continue;
      found.push(`${label}${name}@${JSON.parse(readFileSync(join(path, "package.json"), "utf8")).version}`);
      walk(path, `${label}${name}/`);
    }
  };
  walk(dir, "");
  for (const member of members) walk(join(dir, member), `${member}/`);
  return found;
}

// A row that a run leaves out keeps its place, so a run over the node_modules of another run never
// finds a package where another version belongs, nor an old copy in front of the one it placed.
describe.concurrent("where a package is placed doesn't depend on the flags of the install", () => {
  const bunfig = (server: { url: URL }) => `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`;
  const thisOs = process.platform;
  const otherOs = thisOs === "darwin" ? "linux" : "darwin";

  // aa and h take `jj` (1.1.0) and `h` at the root. Without them these would go to e's jj@1.0.0 and c's h@1.1.0.
  test.each([
    ["--production", "devDependencies", {}],
    ["--omit=dev", "devDependencies", {}],
    ["--omit=optional", "optionalDependencies", {}],
    [`--os=${otherOs}`, "optionalDependencies", { os: [thisOs] }],
  ])("%s", async (flag, group, only) => {
    using server = await serveGraph({
      jj: { "1.0.0": {}, "1.1.0": {} },
      h: { "1.1.0": { dependencies: { jj: "1.1.0" } }, "2.0.0": only },
      c: { "1.0.0": { dependencies: { h: "1.1.0" } } },
      e: { "1.0.0": { dependencies: { jj: "1.0.0" } } },
      aa: { "1.0.0": { dependencies: { jj: "1.1.0" }, ...only } },
    });
    using tmp = tempDir("hoist-flags", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { c: "1.0.0", e: "1.0.0" },
        [group]: { aa: "1.0.0", h: "2.0.0" },
      }),
    });
    const dir = String(tmp);
    const all = ["aa@1.0.0", "c@1.0.0", "c/h@1.1.0", "e@1.0.0", "e/jj@1.0.0", "h@2.0.0", "jj@1.1.0"];
    const some = ["c@1.0.0", "c/h@1.1.0", "e@1.0.0", "e/jj@1.0.0", "jj@1.1.0"];

    await run(dir, "install");
    expect(layout(dir)).toEqual(all);
    await run(dir, "install", flag);
    expect(layout(dir)).toEqual(all);

    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    await run(dir, "install", flag);
    expect(layout(dir)).toEqual(some);
    await run(dir, "install");
    expect(layout(dir)).toEqual(all);
  });

  test("--filter", async () => {
    using server = await serveGraph({ d: { "1.0.0": {}, "2.0.0": {} } });
    using tmp = tempDir("hoist-filter", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"], dependencies: { d: "1.0.0" } }),
      "pk/w1/package.json": JSON.stringify({ name: "w1", dependencies: { d: "2.0.0" } }),
      "pk/w2/package.json": JSON.stringify({ name: "w2", dependencies: { d: "1.0.0" } }),
    });
    const dir = String(tmp);
    const all = ["d@1.0.0", "pk/w1/d@2.0.0"];

    await run(dir, "install");
    expect(layout(dir, "pk/w1", "pk/w2")).toEqual(all);
    await run(dir, "install", "--filter", "w1");
    expect(layout(dir, "pk/w1", "pk/w2")).toEqual(all);

    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    await rm(join(dir, "pk", "w1", "node_modules"), { recursive: true, force: true });
    await run(dir, "install", "--filter", "w1");
    expect(layout(dir, "pk/w1", "pk/w2")).toEqual(["pk/w1/d@2.0.0"]);
    await run(dir, "install");
    expect(layout(dir, "pk/w1", "pk/w2")).toEqual(all);
  });

  // b finds its d@2.0.0 in the place that the devDependency took.
  test("a package that's skipped in one place and needed in another is kept", async () => {
    using server = await serveGraph({
      j: { "1.1.0": {}, "2.0.0": {} },
      d: { "1.0.0": {}, "2.0.0": { dependencies: { j: "1.1.0" } } },
      a: { "1.0.0": { dependencies: { d: "1.0.0" } } },
      b: { "1.0.0": { dependencies: { d: "2.0.0" } } },
    });
    using tmp = tempDir("hoist-shared-place", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { a: "1.0.0", b: "1.0.0", j: "2.0.0" },
        devDependencies: { d: "2.0.0" },
      }),
    });
    const dir = String(tmp);
    await run(dir, "install", "--lockfile-only");
    await run(dir, "install", "--production");
    expect(layout(dir)).toEqual(["a@1.0.0", "a/d@1.0.0", "b@1.0.0", "d@2.0.0", "d/j@1.1.0", "j@2.0.0"]);
  });

  // From the root, tool's optional peer finds something under the name `native`, but it isn't the package that it's
  // bound to. It's w1's alias of tool.
  test("a package that is left out is not linked for an entry that only finds its name", async () => {
    using server = await serveGraph({
      native: { "1.0.0": { cpu: [process.arch === "arm64" ? "x64" : "arm64"] } },
      tool: { "3.0.0": { peerDependencies: { native: "*" }, peerDependenciesMeta: { native: { optional: true } } } },
    });
    using tmp = tempDir("hoist-left-out-name", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["pk/*"],
        optionalDependencies: { native: "^1.0.0" },
      }),
      "pk/w1/package.json": JSON.stringify({
        name: "w1",
        dependencies: { native: "npm:tool@3.0.0" },
        peerDependencies: { tool: "*" },
      }),
    });
    const dir = String(tmp);
    const some = ["tool@3.0.0", "pk/w1/native@3.0.0"];

    await run(dir, "install");
    expect(layout(dir, "pk/w1")).toEqual(some);
    await run(dir, "install");
    expect(layout(dir, "pk/w1")).toEqual(some);
  });

  // m's peer is bound to native@1.1.0, which is placed below user. From m, the name resolves to the root's
  // native@2.0.0.
  test("nor for a workspace's peer that is bound to another version", async () => {
    using server = await serveGraph({
      native: { "1.1.0": {}, "2.0.0": { cpu: [process.arch === "arm64" ? "x64" : "arm64"] } },
      user: { "3.0.0": { dependencies: { native: "1.1.0" } } },
    });
    using tmp = tempDir("hoist-left-out-peer", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["pk/*"],
        dependencies: { user: "*", native: "^2.0.0" },
      }),
      "pk/m/package.json": JSON.stringify({ name: "m", peerDependencies: { native: "~1.1.0" } }),
    });
    const dir = String(tmp);
    const some = ["user@3.0.0", "user/native@1.1.0"];

    await run(dir, "install");
    expect(layout(dir, "pk/m")).toEqual(some);
    await run(dir, "install");
    expect(layout(dir, "pk/m")).toEqual(some);
  });

  // This is the only slot whose package depends on the install's flags: it goes to the first of the two entries that
  // the install links. So x doesn't share it, and the dependencies of k@1.1.0 have a slot too. bun.lockb records a
  // package for each entry.
  test("a name in dependencies and devDependencies", async () => {
    using server = await serveGraph({
      m: { "1.0.0": {}, "2.0.0": {} },
      k: { "1.1.0": { dependencies: { m: "1.0.0" } }, "2.5.0": { dependencies: { m: "2.0.0" } } },
      x: { "1.0.0": { dependencies: { k: "2.5.0" } } },
    });
    using tmp = tempDir("hoist-two-groups", {
      "bunfig.toml": bunfig(server) + "saveTextLockfile = false\n",
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { k: "1.1.0", x: "1.0.0" },
        devDependencies: { k: "2.5.0" },
      }),
    });
    const dir = String(tmp);
    const all = ["k@2.5.0", "m@2.0.0", "x@1.0.0", "x/k@2.5.0"];

    await run(dir, "install");
    expect(layout(dir)).toEqual(all);
    await run(dir, "install", "--production");
    expect(layout(dir)).toEqual(["k@1.1.0", "k/m@1.0.0", "m@2.0.0", "x@1.0.0", "x/k@2.5.0"]);
    await run(dir, "install");
    expect(layout(dir)).toEqual(all);
  });
});

// bun.lock records no edges. The project is on react 18 and something else in bun.lock is on react 19, which the
// ranges of these peers accept too.
describe.concurrent("a peer dependency is the package that its dependent loads", () => {
  const graph = () => ({
    react: { "18.0.0": {}, "19.0.0": {} } as Record<string, object>,
    plug: { "1.0.0": { peerDependencies: { react: ">=18.0.0" } } },
    "plug-any": { "1.0.0": { peerDependencies: { react: "*" } } },
    canary: { "1.0.0": { dependencies: { react: "^19.0.0" } } },
    legacy: { "1.0.0": { dependencies: { react: "18.0.0" } } },
  });
  const bunfig = (server: { url: URL }, linker: Linker) =>
    `[install]\nregistry = "${server.url}"\nlinker = "${linker}"\n`;
  const linkers = ["hoisted", "isolated"] as const;
  const plugs = linkers.flatMap(linker => (["plug", "plug-any"] as const).map(plug => [linker, plug] as const));

  // Looks `name` up the way Node does, from the real folder of `from`.
  function folderOf(from: string, name: string) {
    for (let dir = realpathSync(from); dir !== dirname(dir); dir = dirname(dir)) {
      if (existsSync(join(dir, "node_modules", name, "package.json"))) return join(dir, "node_modules", name);
    }
    throw new Error(`${from} cannot load ${name}`);
  }
  const loaded = (from: string, name: string) =>
    JSON.parse(readFileSync(join(folderOf(from, name), "package.json"), "utf8")).version;
  const wipe = (dir: string, ...members: string[]) =>
    Promise.all(["", ...members].map(at => rm(join(dir, at, "node_modules"), { recursive: true, force: true })));
  const installedReacts = (dir: string) =>
    [...new Bun.Glob("**/node_modules/react/package.json").scanSync({ cwd: dir, dot: true, followSymlinks: false })]
      .filter(path => !lstatSync(join(dir, dirname(path))).isSymbolicLink())
      .map(path => JSON.parse(readFileSync(join(dir, path), "utf8")).version)
      .sort();

  test.each(plugs)("%s, %s: no matter what the install skips", async (linker, plug) => {
    using server = await serveGraph(graph());
    const range = graph()[plug]["1.0.0"].peerDependencies.react;
    using tmp = tempDir("peer-flags", {
      "bunfig.toml": bunfig(server, linker),
      "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"], devDependencies: { react: "^18.0.0" } }),
      "pk/next/package.json": JSON.stringify({ name: "next", dependencies: { react: "19.0.0" } }),
      "pk/lib/package.json": JSON.stringify({ name: "lib", peerDependencies: { react: range } }),
      "pk/ui/package.json": JSON.stringify({ name: "ui", dependencies: { [plug]: "1.0.0" } }),
    });
    const dir = String(tmp);
    const reacts = () => [
      loaded(join(dir, "pk", "lib"), "react"),
      loaded(folderOf(join(dir, "pk", "ui"), plug), "react"),
    ];

    await run(dir, "install");
    expect(reacts()).toEqual(["18.0.0", "18.0.0"]);
    for (const flags of [["--production"], ["--omit=dev"], ["--filter", "lib", "--filter", "ui"]]) {
      await wipe(dir, "pk/next", "pk/lib", "pk/ui");
      await run(dir, "install", "--frozen-lockfile", ...flags);
      expect([flags, reacts()]).toEqual([flags, ["18.0.0", "18.0.0"]]);
    }
  });

  test("hoisted: when the install skips the workspace's own devDependency that provides it", async () => {
    using server = await serveGraph(graph());
    using tmp = tempDir("peer-provider-left-out", {
      "bunfig.toml": bunfig(server, "hoisted"),
      "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"], dependencies: { react: "19.0.0" } }),
      "pk/lib/package.json": JSON.stringify({
        name: "lib",
        peerDependencies: { react: ">=18.0.0" },
        devDependencies: { react: "18.0.0" },
      }),
    });
    const dir = String(tmp);
    const lib = join(dir, "pk", "lib");

    await run(dir, "install");
    expect(loaded(lib, "react")).toBe("18.0.0");
    for (const flag of ["--production", "--omit=dev"]) {
      await wipe(dir, "pk/lib");
      await run(dir, "install", "--frozen-lockfile", flag);
      expect([flag, loaded(lib, "react")]).toEqual([flag, "18.0.0"]);
    }
  });

  test.each(plugs)("%s, %s: bun prune, bun pm licenses", async (linker, plug) => {
    using server = await serveGraph(graph());
    using tmp = tempDir("peer-prune", {
      "bunfig.toml": bunfig(server, linker),
      "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"], dependencies: { react: "^18.0.0" } }),
      "pk/app/package.json": JSON.stringify({ name: "app", dependencies: { [plug]: "1.0.0" } }),
      "pk/docs/package.json": JSON.stringify({ name: "docs", devDependencies: { react: "19.0.0" } }),
    });
    const dir = String(tmp);
    const app = join(dir, "pk", "app");

    await run(dir, "install");
    expect(installedReacts(dir)).toEqual(["18.0.0", "19.0.0"]);
    expect(await run(dir, "pm", "licenses", "--production")).not.toContain("react@19.0.0");
    await run(dir, "prune", "--production");
    expect(installedReacts(dir)).toEqual(["18.0.0"]);
    expect(loaded(folderOf(app, plug), "react")).toBe("18.0.0");

    await wipe(dir, "pk/app", "pk/docs");
    await run(dir, "install", "--filter", "app");
    await run(dir, "prune", "--filter", "app");
    expect(loaded(folderOf(app, plug), "react")).toBe("18.0.0");
  });

  test.each(plugs)("%s, %s: bun outdated, and the summary of bun install", async (linker, plug) => {
    const packages = graph();
    packages.react["19.1.0"] = {};
    using server = await serveGraph(packages);
    const range = packages[plug]["1.0.0"].peerDependencies.react;
    using tmp = tempDir("peer-outdated", {
      "bunfig.toml": bunfig(server, linker),
      "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"], dependencies: { react: "18.0.0" } }),
      "pk/next/package.json": JSON.stringify({ name: "next", dependencies: { react: "19.0.0" } }),
      "pk/lib/package.json": JSON.stringify({ name: "lib", peerDependencies: { react: range } }),
      "pk/lib/bunfig.toml": bunfig(server, linker),
    });
    const dir = String(tmp);
    const lib = join(dir, "pk", "lib");

    await run(dir, "install", "--lockfile-only");
    expect(await run(lib, "install")).toContain("+ react@18.0.0");
    expect(loaded(lib, "react")).toBe("18.0.0");
    const row = (await run(lib, "outdated")).split("\n").find(line => line.includes("react (peer)"));
    expect(row?.split(/[|│]/)[2].trim()).toBe("18.0.0");
  });

  test.each(linkers)("%s: bun update", async linker => {
    const packages = { ...graph(), plug: { "1.0.0": { peerDependencies: { react: ">=18.0.0 <19.1.0" } } } };
    packages.react["19.1.0"] = {};
    using server = await serveGraph(packages);
    delete packages.react["19.1.0"];
    using tmp = tempDir("peer-update", {
      "bunfig.toml": bunfig(server, linker),
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { canary: "1.0.0", plug: "1.0.0", react: "18.0.0" },
      }),
    });
    const dir = String(tmp);
    const reacts = () => ["plug", "canary"].map(name => loaded(folderOf(dir, name), "react"));

    await run(dir, "install");
    expect(reacts()).toEqual(["18.0.0", "19.0.0"]);
    packages.react["19.1.0"] = {};
    await rm(join(dir, ".bun-cache"), { recursive: true, force: true });
    await run(dir, "update");
    expect(reacts()).toEqual(["18.0.0", "19.1.0"]);
  });

  test.each(linkers)("%s: bun add --trust", async linker => {
    const built = { scripts: { postinstall: "echo built > built.txt" } };
    using server = await serveGraph({
      native: { "1.0.0": built, "2.0.0": built },
      plug: { "1.0.0": { peerDependencies: { native: ">=1.0.0" } } },
      canary: { "1.0.0": { dependencies: { native: "2.0.0" } } },
    });
    using tmp = tempDir("peer-trust", {
      "bunfig.toml": bunfig(server, linker),
      "package.json": JSON.stringify({ name: "app", dependencies: { canary: "1.0.0", native: "1.0.0" } }),
    });
    const dir = String(tmp);

    await run(dir, "install");
    await run(dir, "add", "--trust", "plug");
    const native = folderOf(folderOf(dir, "plug"), "native");
    expect(JSON.parse(readFileSync(join(native, "package.json"), "utf8")).version).toBe("1.0.0");
    expect(existsSync(join(native, "built.txt"))).toBe(true);
  });

  test.each(linkers)("%s: the security scanner", async linker => {
    using server = await serveGraph(graph());
    using tmp = tempDir("peer-scanner", {
      "bunfig.toml": bunfig(server, linker) + `[install.security]\nscanner = "./scanner.ts"\n`,
      "scanner.ts": `export const scanner = {
        version: "1",
        scan: async ({ packages }) => {
          const asked = packages.map(({ name, version }) => name + "@" + version).sort();
          await Bun.write(import.meta.dir + "/asked.json", JSON.stringify(asked));
          return [];
        },
      };`,
      "package.json": JSON.stringify({ name: "app", dependencies: { canary: "1.0.0", react: "18.0.0" } }),
    });
    const dir = String(tmp);

    await run(dir, "install");
    await run(dir, "add", "plug");
    expect(loaded(folderOf(dir, "plug"), "react")).toBe("18.0.0");
    expect(await file(join(dir, "asked.json")).json()).toEqual(["plug@1.0.0", "react@18.0.0"]);
  });

  // `site` puts react 19 at the top, where `ui` finds it for its devDependency. A react 18 for the peer would hide it.
  test.each(linkers)("%s: a workspace's own devDependency that's outside the range of its peer", async linker => {
    using server = await serveGraph(graph());
    using tmp = tempDir("peer-and-dev", {
      "bunfig.toml": bunfig(server, linker),
      "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"] }),
      "pk/site/package.json": JSON.stringify({ name: "site", dependencies: { legacy: "1.0.0", react: "^19.0.0" } }),
      "pk/ui/package.json": JSON.stringify({
        name: "ui",
        peerDependencies: { react: "^18.0.0" },
        devDependencies: { react: "^19.0.0" },
      }),
    });
    const dir = String(tmp);
    const ui = join(dir, "pk", "ui");

    await run(dir, "install");
    expect(loaded(ui, "react")).toBe("19.0.0");
    expect(await lockfileTree(dir)).not.toHaveProperty("ui/react");
    await run(dir, "install");
    expect(loaded(ui, "react")).toBe("19.0.0");
    await wipe(dir, "pk/site", "pk/ui");
    await run(dir, "install", "--frozen-lockfile");
    expect(loaded(ui, "react")).toBe("19.0.0");
  });

  // ui@1.2.0 satisfies the peer range of `lib`, but it can't be at the top, next to core 1. In the node_modules of
  // `lib`, next to core 2, it would hide the ui@1.0.0 at the top that `lib` itself depends on.
  test.each(
    (["update", "update --latest", "add ui@^1.2.0"] as const).flatMap(command =>
      [
        ["dependencies", "~1.0.0"],
        ["dependencies", "1.0.0"],
        ["devDependencies", "~1.0.0"],
      ].map(([group, range]) => [command, group, range] as const),
    ),
  )("hoisted: bun %s in another member, %s %p of the member itself", async (command, group, range) => {
    const [any, later] = [{ peerDependencies: { core: ">=1" } }, { peerDependencies: { core: "^2.0.0" } }];
    // The last one is `latest`.
    const ui: Record<string, object> = { "1.0.0": any, "2.0.0": any, "1.2.0": later };
    using server = await serveGraph({ ui, core: { "1.0.0": {}, "2.0.0": {} } });
    delete ui["1.2.0"];
    using tmp = tempDir("peer-and-own-range", {
      "bunfig.toml": bunfig(server, "hoisted"),
      "pk/app/bunfig.toml": bunfig(server, "hoisted"),
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["pk/*"],
        devDependencies: { ui: "<=1.2.0", core: "^1.0.0" },
      }),
      "pk/app/package.json": JSON.stringify({
        name: "app",
        dependencies: { ui: "latest" },
        devDependencies: { core: "^2.0.0" },
      }),
      "pk/lib/package.json": JSON.stringify({
        name: "lib",
        dependencies: { core: "*" },
        peerDependencies: { ui: "^1.0.0" },
        [group]: { ...(group === "dependencies" ? { core: "*" } : {}), ui: range },
      }),
    });
    const dir = String(tmp);
    const [app, lib] = [join(dir, "pk", "app"), join(dir, "pk", "lib")];

    await run(dir, "install");
    expect([loaded(app, "ui"), loaded(lib, "ui")]).toEqual(["2.0.0", "1.0.0"]);
    ui["1.2.0"] = later;
    await run(app, ...command.split(" "));
    expect([loaded(app, "ui"), loaded(lib, "ui")]).toEqual(["1.2.0", "1.0.0"]);
    const tree = await lockfileTree(dir);
    expect(tree["lib/ui"] ?? tree["ui"]).toBe("ui@1.0.0");
    await wipe(dir, "pk/app", "pk/lib");
    await run(dir, "install", "--frozen-lockfile");
    expect([loaded(app, "ui"), loaded(lib, "ui")]).toEqual(["1.2.0", "1.0.0"]);
  });

  // The member `lib` is 3.0.0, which the peer range of `plug` accepts too.
  test.each(
    ["*", ">=1.0.0"].flatMap(range =>
      (
        [
          ["a registry package", {}],
          ["a registry package", { plug: "^2.0.0" }],
          ["another member", {}],
        ] as const
      ).map(([host, root]) => [range, host, root] as const),
    ),
  )(
    "hoisted: peer %p, next to the published version of a workspace that %s uses (the root has %p)",
    async (range, host, root) => {
      const plug = { peerDependencies: { lib: range } };
      const uses = { lib: "^1.0.0", plug: "^1.0.0" };
      using server = await serveGraph({
        lib: { "1.0.0": {} },
        plug: { "1.0.0": plug, "2.0.0": plug },
        host: { "1.0.0": { dependencies: uses } },
      });
      using tmp = tempDir("peer-member-and-published", {
        "bunfig.toml": bunfig(server, "hoisted"),
        "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"], dependencies: root }),
        "pk/lib/package.json": JSON.stringify({ name: "lib", version: "3.0.0" }),
        "pk/app/package.json": JSON.stringify({
          name: "app",
          dependencies: host === "another member" ? uses : { host: "^1.0.0" },
        }),
      });
      const dir = String(tmp);
      const app = join(dir, "pk", "app");
      const libs = () => {
        const from = host === "another member" ? app : folderOf(app, "host");
        return [loaded(from, "lib"), loaded(folderOf(from, "plug"), "lib")];
      };

      await run(dir, "install");
      expect(libs()).toEqual(["1.0.0", "1.0.0"]);
      expect(Object.values(await lockfileTree(dir)).filter(to => to.startsWith("lib@workspace:"))).toHaveLength(1);
      expect(await run(dir, "install")).toContain("(no changes)");
      await wipe(dir, "pk/app");
      await run(dir, "install", "--frozen-lockfile");
      expect(libs()).toEqual(["1.0.0", "1.0.0"]);
    },
  );

  // util@1.1.0 below the published lib links the member, which has the published lib below it.
  test.each(linkers)("%s: a workspace that builds with the published version of itself", async linker => {
    using server = await serveGraph({
      util: { "1.0.0": {}, "1.1.0": { dependencies: { lib: "*" } } },
      lib: { "2.1.0": { optionalDependencies: { util: "^1.0.0" } } },
    });
    using tmp = tempDir("member-and-its-published-version", {
      "bunfig.toml": bunfig(server, linker),
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["pk/*"],
        dependencies: { util: "^1.0.0" },
        peerDependencies: { lib: "^1.1.0" },
      }),
      "pk/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        dependencies: { util: "~1.0.0" },
        devDependencies: { lib: "^2.0.0" },
      }),
    });
    const dir = String(tmp);

    await run(dir, "install");
    expect(loaded(join(dir, "pk", "lib"), "lib")).toBe("2.1.0");
    expect(await run(dir, "install")).toContain("(no changes)");
    await run(dir, "install", "--frozen-lockfile");
  });
});

// Up to 1.4.3, packages that a run skipped (e.g. devDependencies under --production) were ignored when hoisting. Here
// that put m's b@1.0.0 at the root and nested a b under n, a path that bun.lock has no key for. Newer versions never
// install there, and n is supposed to load the root's b.
describe.concurrent("upgrading a node_modules that Bun <= 1.4.3 installed with some dependencies skipped", () => {
  const both = { m: "1.0.0", n: "1.0.0" };
  const otherOs = process.platform === "darwin" ? "linux" : "darwin";
  const otherCpu = process.arch === "arm64" ? "x64" : "arm64";

  test.each([
    { title: "--production", args: ["--production"], leftOut: { devDependencies: { b: "^2.0.0" } } },
    { title: "--production, below a package", args: ["--production"], leftOut: { devDependencies: { a: "1.0.0" } } },
    { title: "--omit=dev", args: ["--omit=dev"], leftOut: { devDependencies: { b: "^2.0.0" } } },
    { title: "--omit=optional", args: ["--omit=optional"], leftOut: { optionalDependencies: { a: "1.0.0" } } },
    { title: "a package for another os", args: [], leftOut: { optionalDependencies: { "a-os": "1.0.0" } } },
    { title: "a package for another cpu", args: [], leftOut: { optionalDependencies: { "a-cpu": "1.0.0" } } },
    { title: "--filter", args: ["--filter", "svc"], leftOut: { dependencies: { b: "^2.0.0" } }, member: true },
    {
      title: "--production, with the new bun.lock at once",
      args: ["--production"],
      leftOut: { devDependencies: { b: "^2.0.0" } },
      atOnce: true,
    },
    // `n` is already installed, so it's never downloaded again and never gets a cache entry.
    {
      title: "--production, with an empty cache",
      args: ["--production"],
      leftOut: { devDependencies: { b: "^2.0.0" } },
      noCache: true,
    },
    {
      title: "--production --ignore-scripts, in a project with a prepare script",
      args: ["--production", "--ignore-scripts"],
      leftOut: { devDependencies: { b: "^2.0.0" }, scripts: { prepare: "echo prepared" } },
    },
    {
      title: "--production, below a trusted package with a script",
      args: ["--production"],
      leftOut: { devDependencies: { b: "^2.0.0" }, trustedDependencies: ["n"] },
      script: "echo built",
    },
    {
      title: "a package for another os, with an empty cache",
      args: [],
      leftOut: { optionalDependencies: { "a-os": "1.0.0" } },
      noCache: true,
    },
  ])("$title", async ({ args, leftOut, member, atOnce, noCache, script }) => {
    const graph: Record<string, Record<string, object>> = {
      m: { "1.0.0": { dependencies: { b: "^1.0.0" } } },
      n: { "1.0.0": { dependencies: { b: "^2.0.0" }, ...(script && { scripts: { postinstall: script } }) } },
      b: { "1.0.0": {}, "2.0.0": {}, "2.1.0": {} },
      a: { "1.0.0": { dependencies: { b: "^2.0.0" } } },
      "a-os": { "1.0.0": { os: [otherOs], dependencies: { b: "^2.0.0" } } },
      "a-cpu": { "1.0.0": { cpu: [otherCpu], dependencies: { b: "^2.0.0" } } },
    };
    using server = await serveGraph(graph, {
      "n-1.0.0": { "index.js": `module.exports = require("b/package.json").version;` },
    });
    const { "2.1.0": published, ...before } = graph.b;
    graph.b = before;

    const files = (root: object) => ({
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
      ...(member
        ? {
            "package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"], ...root }),
            "packages/svc/package.json": JSON.stringify({ name: "svc", dependencies: { b: "^1.0.0", n: "1.0.0" } }),
          }
        : { "package.json": JSON.stringify({ name: "app", dependencies: both, ...root }) }),
    });
    using laptop = tempDir("hoist-older-laptop", files(leftOut));
    using machine = tempDir("hoist-older-machine", files({}));
    const [dev, dir] = [String(laptop), String(machine)];
    const pull = async () => {
      await write(join(dir, "package.json"), file(join(dev, "package.json")));
      await write(join(dir, "bun.lock"), file(join(dev, "bun.lock")));
    };
    await run(dev, "install");

    // Reproduce the old layout: installing without the skipped dependencies in package.json gives the same tree that
    // Bun <= 1.4.3 produced with these flags.
    await run(dir, "install");
    expect(layout(dir)).toEqual(["b@1.0.0", ...(member ? [] : ["m@1.0.0"]), "n@1.0.0", "n/b@2.0.0"]);
    if (noCache) rmSync(join(dir, ".bun-cache"), { recursive: true });
    await pull();
    if (!atOnce) {
      // The nested copy is removed even though its version matches bun.lock. Later updates only touch the hoisted
      // copy, so this one would go stale.
      await run(dir, "install", ...args);
      expect(layout(dir)).not.toContain("n/b@2.0.0");
    }

    graph.b = { ...before, "2.1.0": published };
    await run(dev, "update");
    await pull();
    const lockfile = await file(join(dir, "bun.lock")).text();
    expect(lockfile).toContain("b@2.1.0");
    expect(lockfile).not.toContain("b@2.0.0");

    await run(dir, "install", ...args);
    expect(await run(dir, "--no-install", "-p", "require('n')")).toBe("2.1.0\n");
    expect(await run(dir, "install", ...args)).toContain("(no changes)");
    expect(await run(dir, "--no-install", "-p", "require('n')")).toBe("2.1.0\n");
  });
});

// Bun never installs the `node_modules` of a `file:` folder or a git checkout, so `n/node_modules/b` can't be part of
// `n`. A GitHub archive can contain one, so it's kept only if the cached archive has it.
test.concurrent.each(["file: folder", "git repository", "github repository", "github repository, with an empty cache"])(
  "removes the nested copy that Bun <= 1.4.3 left under a %s",
  async kind => {
    const graph: Record<string, Record<string, object>> = {
      m: { "1.0.0": { dependencies: { b: "^1.0.0" } } },
      b: { "1.0.0": {}, "2.0.0": {}, "2.1.0": {} },
    };
    using server = await serveGraph(graph);
    const { "2.1.0": published, ...before } = graph.b;
    graph.b = before;

    const n = githubFiles;
    using repository = tempDir("hoist-older-owner-repository", n);
    if (kind === "git repository") {
      for (const args of [
        ["init", "-q"],
        ["add", "."],
        ["commit", "-q", "-m", "n"],
      ]) {
        const identity = ["-c", "user.name=n", "-c", "user.email=n@example.com"];
        await using git = Bun.spawn({ cmd: ["git", ...identity, ...args], cwd: String(repository) });
        expect(await git.exited).toBe(0);
      }
    }
    const files = (root: object) => ({
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
      "vendor/n/package.json": n["package.json"],
      "vendor/n/index.js": n["index.js"],
      "package.json": JSON.stringify({
        name: "app",
        dependencies: {
          m: "1.0.0",
          n:
            kind === "git repository"
              ? `git+${pathToFileURL(String(repository))}`
              : kind === "file: folder"
                ? "file:./vendor/n"
                : "github:me/n#abcdef1",
        },
        ...root,
      }),
    });
    using laptop = tempDir("hoist-older-owner-laptop", files({ devDependencies: { b: "^2.0.0" } }));
    using machine = tempDir("hoist-older-owner-machine", files({}));
    const [dev, dir] = [String(laptop), String(machine)];
    const pull = async () => {
      await write(join(dir, "package.json"), file(join(dev, "package.json")));
      await write(join(dir, "bun.lock"), file(join(dev, "bun.lock")));
    };
    await run(dev, "install");

    // Reproduce the old --production layout by installing without devDependencies in package.json.
    await run(dir, "install");
    expect(layout(dir)).toEqual(["b@1.0.0", "m@1.0.0", "n@1.0.0", "n/b@2.0.0"]);
    if (kind.endsWith("cache")) rmSync(join(dir, ".bun-cache"), { recursive: true });
    await pull();
    await run(dir, "install", "--production");
    expect(layout(dir)).not.toContain("n/b@2.0.0");

    graph.b = { ...before, "2.1.0": published };
    await run(dev, "update", "b");
    await pull();
    await run(dir, "install", "--production");
    expect(await run(dir, "--no-install", "-p", "require('n')")).toBe("2.1.0\n");
  },
);

// Bun itself installed `pk/w1/node_modules/n`, so it isn't one of the workspace's own files.
test.concurrent(
  "removes the nested copy that Bun <= 1.4.3 left under a package in the node_modules of a workspace with a script",
  async () => {
    const graph: Record<string, Record<string, object>> = {
      m: { "1.0.0": { dependencies: { b: "^1.0.0" } } },
      n: { "1.0.0": {}, "2.0.0": { dependencies: { b: "^2.0.0" } } },
      b: { "1.0.0": {}, "2.0.0": {}, "2.1.0": {} },
    };
    using server = await serveGraph(graph, {
      "n-2.0.0": { "index.js": `module.exports = require("b/package.json").version;` },
    });
    const { "2.1.0": published, ...before } = graph.b;
    graph.b = before;

    const files = (root: object) => ({
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({
        name: "app",
        workspaces: ["pk/*"],
        dependencies: { m: "1.0.0", n: "^1.0.0" },
        ...root,
      }),
      "pk/w1/package.json": JSON.stringify({
        name: "w1",
        dependencies: { n: "^2.0.0" },
        scripts: { postinstall: "echo built" },
      }),
    });
    using laptop = tempDir("hoist-older-in-workspace-laptop", files({ devDependencies: { b: "^2.0.0" } }));
    using machine = tempDir("hoist-older-in-workspace-machine", files({}));
    const [dev, dir] = [String(laptop), String(machine)];

    // Reproduce the old --production layout by installing without devDependencies in package.json.
    await run(dir, "install");
    expect(layout(dir, "pk/w1")).toContain("pk/w1/n/b@2.0.0");

    graph.b = { ...before, "2.1.0": published };
    await run(dev, "install");
    await write(join(dir, "package.json"), file(join(dev, "package.json")));
    await write(join(dir, "bun.lock"), file(join(dev, "bun.lock")));
    await run(dir, "install", "--production");
    expect(await run(join(dir, "pk", "w1"), "--no-install", "-p", "require('n')")).toBe("2.1.0\n");
  },
);

// Whether a package in `pk/two/node_modules` is kept depends on what bun.lock now places there, not on the workspace's
// name.
describe.concurrent("packages nested in a workspace's node_modules", () => {
  const json = (name: string, dependencies: object) => JSON.stringify({ name, dependencies });

  /** Installs, applies `edits`, and installs again. Returns the root and `pk/two` layouts before and after. */
  async function edited(members: Record<string, string>, edits: Record<string, string>) {
    using server = await serveGraph({
      y: { "1.0.0": {}, "2.0.0": {} },
      nn: { "1.0.0": { dependencies: { y: "^1.0.0" } }, "2.0.0": {} },
    });
    using tmp = tempDir("hoist-renamed-workspace", {
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({ name: "app", workspaces: ["pk/*"] }),
      ...members,
    });
    const dir = String(tmp);
    await run(dir, "install");
    const before = layout(dir, "pk/two");
    for (const [path, text] of Object.entries(edits)) await write(join(dir, path), text);
    await run(dir, "install");
    return { before, after: layout(dir, "pk/two") };
  }

  const own = {
    "pk/one/package.json": json("one", { y: "1.0.0" }),
    "pk/two/package.json": json("two", { y: "2.0.0" }),
  };
  test("are kept when the workspace is renamed", async () => {
    expect(await edited(own, { "pk/two/package.json": json("zwei", { y: "2.0.0" }) })).toEqual({
      before: ["y@1.0.0", "pk/two/y@2.0.0"],
      after: ["y@1.0.0", "pk/two/y@2.0.0"],
    });
  });
  test("are removed when the workspace is renamed and now wants the hoisted version", async () => {
    expect(await edited(own, { "pk/two/package.json": json("zwei", { y: "1.0.0" }) })).toEqual({
      before: ["y@1.0.0", "pk/two/y@2.0.0"],
      after: ["y@1.0.0"],
    });
  });
  test("are removed when the folder is no longer a workspace", async () => {
    expect(await edited(own, { "package.json": JSON.stringify({ name: "app", workspaces: ["pk/one"] }) })).toEqual({
      before: ["y@1.0.0", "pk/two/y@2.0.0"],
      after: ["y@1.0.0"],
    });
  });

  // Same thing one level deeper, at `pk/two/node_modules/nn/node_modules/y`.
  const deeper = {
    "pk/one/package.json": json("one", { nn: "2.0.0", y: "2.0.0" }),
    "pk/three/package.json": json("three", { y: "1.0.0" }),
    "pk/two/package.json": json("two", { nn: "1.0.0" }),
  };
  const nested = ["nn@2.0.0", "y@2.0.0", "pk/two/nn@1.0.0", "pk/two/nn/y@1.0.0"];
  test("under another package, are kept when a different workspace takes the old name", async () => {
    const edits = {
      "pk/two/package.json": json("zwei", { nn: "1.0.0" }),
      "pk/three/package.json": json("two", { y: "1.0.0" }),
    };
    expect(await edited(deeper, edits)).toEqual({ before: nested, after: nested });
  });
  test("under another package, are removed when the workspace is renamed and the hoisted version now matches", async () => {
    const edits = {
      "pk/two/package.json": json("zwei", { nn: "1.0.0" }),
      "pk/one/package.json": json("one", { nn: "2.0.0", y: "1.0.0" }),
    };
    expect(await edited(deeper, edits)).toEqual({
      before: nested,
      after: ["nn@2.0.0", "y@1.0.0", "pk/two/nn@1.0.0"],
    });
  });
});

// An install removes a folder only if the bun.lock it started from placed a package there.
describe.concurrent("a folder that no bun.lock placed is kept", () => {
  const bunfig = (server: { url: URL }) => `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`;

  // bun.lock only places `dep` at the root. `ships` has one in its tarball, without bundledDependencies. `builds`
  // creates one in its postinstall. Each one loads its own copy.
  test.each([
    [[["install"]]],
    [[["install"], ["install"]]],
    [[["install", "--force"]]],
    [[["install", "--production"]]],
    [[["install", "--frozen-lockfile"]]],
    [[["ci"]]],
    [[["add", "other"]]],
    [[["add", "other"], ["install"]]],
    [[["remove", "extra"]]],
    [[["remove", "extra"], ["install"]]],
    [[["update"]]],
    [[["update"], ["install"]]],
    [[["dedupe"]]],
  ])("below a package, from its tarball or its script: bun %j", async commands => {
    const own = (from: string) => JSON.stringify({ name: "dep", version: "1.0.0", from });
    const dependencies = { dep: "^1.0.0" };
    using server = await serveGraph(
      {
        dep: { "1.0.0": {}, "1.0.5": {} },
        ships: { "1.0.0": { dependencies } },
        builds: { "1.0.0": { dependencies, scripts: { postinstall: `${bunExe()} build.js` } } },
        extra: { "1.0.0": {} },
        other: { "1.0.0": {} },
      },
      {
        "ships-1.0.0": { "node_modules/dep/package.json": own("the tarball"), "node_modules/dep/index.js": "// mine" },
        "builds-1.0.0": {
          "build.js": `require("fs").mkdirSync("node_modules/dep", { recursive: true });
            require("fs").writeFileSync("node_modules/dep/package.json", ${JSON.stringify(own("the script"))});`,
        },
      },
    );
    using tmp = tempDir("hoist-own-folder", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { ships: "1.0.0", builds: "1.0.0", extra: "1.0.0" },
        trustedDependencies: ["builds"],
      }),
    });
    const dir = String(tmp);
    const seen = () =>
      ["ships", "builds"].map(owner => {
        const folder = join(dir, "node_modules", owner, "node_modules", "dep");
        if (!existsSync(folder)) return `${owner}: nothing`;
        return readdirSync(folder)
          .sort()
          .map(name => `${owner}: ${name}: ${readFileSync(join(folder, name), "utf8")}`);
      });
    await run(dir, "install");
    const first = seen();
    expect(first).toEqual([
      ["ships: index.js: // mine", `ships: package.json: ${own("the tarball")}`],
      [`builds: package.json: ${own("the script")}`],
    ]);

    for (const command of commands) {
      await run(dir, ...command);
      expect(seen()).toEqual(first);
    }
  });

  // Without b in the root's dependencies, Bun <= 1.4.3 hoisted m's b@1.0.0 to the root and nested a b under `ships`.
  test("below a package, from its tarball, at a path where Bun <= 1.4.3 nested a copy", async () => {
    const own = JSON.stringify({ name: "b", version: "2.0.0", from: "the tarball" });
    using server = await serveGraph(
      {
        m: { "1.0.0": { dependencies: { b: "^1.0.0" } } },
        ships: { "1.0.0": { dependencies: { b: "^2.0.0" } } },
        b: { "1.0.0": {}, "2.0.0": {} },
        other: { "1.0.0": {} },
      },
      { "ships-1.0.0": { "node_modules/b/package.json": own } },
    );
    using tmp = tempDir("hoist-own-older-place", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { m: "1.0.0" },
        devDependencies: { b: "^2.0.0" },
      }),
    });
    const dir = String(tmp);
    await run(dir, "install", "--omit=dev");
    // m is already installed when `ships` is added, and `ships` is already installed when `other` is added.
    for (const added of ["ships", "other"]) {
      await run(dir, "add", added, "--omit=dev");
      expect(await file(join(dir, "node_modules", "ships", "node_modules", "b", "package.json")).text()).toBe(own);
    }
  });

  // The registry manifest doesn't say that `ships` bundles `dep`, so bun.lock only places `dep` at the root.
  test.each([
    ["", {}],
    // The root's other@2.0.0 is hoisted, so bun.lock nests other@1.0.0 at "ships/other".
    [", next to a package that bun.lock nests there", { other: "2.0.0" }],
  ])("below a package that bundles it%s: bun prune", async (_, more) => {
    const own = JSON.stringify({ name: "dep", version: "1.0.0", from: "the tarball" });
    const dependencies = { dep: "^1.0.0", other: "^1.0.0" };
    using server = await serveGraph(
      { dep: { "1.0.0": {} }, other: { "1.0.0": {}, "2.0.0": {} }, ships: { "1.0.0": { dependencies } } },
      {
        "ships-1.0.0": {
          "package.json": JSON.stringify({
            name: "ships",
            version: "1.0.0",
            dependencies,
            bundleDependencies: ["dep"],
          }),
          "node_modules/dep/package.json": own,
        },
      },
    );
    using tmp = tempDir("hoist-own-folder-prune", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({ name: "root", dependencies: { ships: "1.0.0", ...more } }),
    });
    const dir = String(tmp);
    await run(dir, "install");
    expect(await file(join(dir, "bun.lock")).text()).not.toContain("bundled");
    // Like a Docker stage that only copies node_modules.
    rmSync(join(dir, ".bun-cache"), { recursive: true });
    await run(dir, "prune");
    expect(await file(join(dir, "node_modules", "ships", "node_modules", "dep", "package.json")).text()).toBe(own);
  });

  test("in a member's node_modules and below a package, by hand", async () => {
    using server = await serveGraph({
      d: { "1.0.0": {}, "2.0.0": {} },
      other: { "1.0.0": {} },
      uses: { "1.0.0": { dependencies: { d: "^1.0.0" } } },
    });
    using tmp = tempDir("hoist-by-hand", {
      "bunfig.toml": bunfig(server),
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["pk/*"],
        dependencies: { d: "1.0.0", other: "1.0.0", uses: "1.0.0" },
      }),
      "pk/w1/package.json": JSON.stringify({
        name: "w1",
        dependencies: { other: "1.0.0" },
        devDependencies: { d: "2.0.0" },
      }),
      "pk/w1/node_modules/other/package.json": JSON.stringify({ name: "other", version: "0.0.0" }),
      "pk/w1/node_modules/.cache/d/package.json": "{}",
    });
    const dir = String(tmp);
    await run(dir, "install");
    await write(join(dir, "node_modules", "uses", "node_modules", "d", "package.json"), '{ "version": "0.0.0" }');
    const all = ["d@1.0.0", "other@1.0.0", "uses@1.0.0", "uses/d@0.0.0", "pk/w1/d@2.0.0", "pk/w1/other@0.0.0"];
    expect(layout(dir, "pk/w1")).toEqual(all);

    // The place of w1's d is in bun.lock, and this run leaves it out.
    await run(dir, "install", "--production");
    expect(layout(dir, "pk/w1")).toEqual(all);
    await run(dir, "install");
    expect(layout(dir, "pk/w1")).toEqual(all);
    expect(existsSync(join(dir, "pk", "w1", "node_modules", ".cache", "d"))).toBeTrue();
  });
});

// `lib` is a member and a package of the registry. What `app` has of it in its own node_modules is in front of the
// `lib` at the root.
describe.concurrent("a workspace switches between a member and the registry package of that name", () => {
  const files = (server: { url: URL }, root: object, lib: string) => ({
    "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
    "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"], ...root }),
    "pk/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
    "pk/app/package.json": JSON.stringify({ name: "app", dependencies: { lib } }),
  });
  const edit = (dir: string, lib: string) =>
    write(join(dir, "pk", "app", "package.json"), JSON.stringify({ name: "app", dependencies: { lib } }));
  const own = (dir: string) => {
    const stat = lstatSync(join(dir, "pk", "app", "node_modules", "lib"), { throwIfNoEntry: false });
    return stat ? (stat.isSymbolicLink() ? "link" : "folder") : "nothing";
  };

  test.each([
    ["an edit, bun install", [["install"]]],
    ["an edit, bun update", [["update"]]],
    ["an edit, bun install --force", [["install", "--force"]]],
    ["an edit, bun install --lockfile-only, bun prune", [["install", "--lockfile-only"], ["prune"]]],
    ["bun add --filter", [["add", "lib@workspace:*", "--filter", "app"]]],
    ["bun add", [["add", "lib@workspace:*"]]],
  ])("to the member: %s", async (title, commands) => {
    using server = await serveGraph({ lib: { "2.0.0": {} } });
    using tmp = tempDir("hoist-to-member", files(server, {}, "^2.0.0"));
    const dir = String(tmp);
    await run(dir, "install");
    expect(layout(dir, "pk/app")).toEqual(["pk/app/lib@2.0.0"]);

    if (title.startsWith("an edit")) await edit(dir, "workspace:*");
    for (const command of commands) await run(title === "bun add" ? join(dir, "pk", "app") : dir, ...command);
    expect(own(dir)).toBe("nothing");
    expect(realpathSync(join(dir, "node_modules", "lib"))).toBe(realpathSync(join(dir, "pk", "lib")));
  });

  test.each([
    ["bun install", [["install"]]],
    ["bun install --lockfile-only, bun prune", [["install", "--lockfile-only"], ["prune"]]],
  ])("to the package, which the root has: an edit, %s", async (_, commands) => {
    using server = await serveGraph({ lib: { "2.0.0": {} } });
    using tmp = tempDir("hoist-from-member", files(server, { dependencies: { lib: "2.0.0" } }, "workspace:*"));
    const dir = String(tmp);
    await run(dir, "install");
    expect(own(dir)).toBe("link");

    await edit(dir, "^2.0.0");
    for (const command of commands) await run(dir, ...command);
    expect(own(dir)).toBe("nothing");
    expect(layout(dir, "pk/app")).toEqual(["lib@2.0.0"]);
  });
});

// bun.lock doesn't record which package a peer resolves to. Loading binds each peer again, and has to get the same
// result as the resolver.
describe.concurrent(
  "bun.lock with a member and the published package of its name loads back as it was resolved",
  () => {
    const member = (json: object) => JSON.stringify(json);
    const shapes: [string, Record<string, Record<string, object>>, object, Record<string, object>][] = [
      [
        "the root's peer links the member, next to an alias of the published version",
        { lib: { "3.0.0": {} } },
        { peerDependencies: { lib: ">=1.1.0" }, devDependencies: { published: "npm:lib@^3.0.0" } },
        { lib: { name: "lib", version: "1.1.0" } },
      ],
      [
        "the root's peer links the member, and another member depends on the published version",
        { lib: { "3.0.0": {} } },
        { peerDependencies: { lib: ">=1.1.0" } },
        { lib: { name: "lib", version: "1.1.0" }, app: { name: "app", dependencies: { lib: "^3.0.0" } } },
      ],
      [
        "a registry package's peer links the member, and its dependent has the published version",
        {
          core: { "1.0.0": {} },
          plugin: { "1.2.0": { peerDependencies: { core: ">=1.0.0" } } },
          host: { "2.1.0": { dependencies: { core: "1.0.0", plugin: "*" } } },
          user: { "2.1.0": { dependencies: { plugin: "^1" } } },
        },
        {},
        {
          core: { name: "core", version: "5.0.0" },
          app: { name: "app", dependencies: { host: "2.1.0", user: "2.1.0" } },
        },
      ],
      [
        "a registry package's optional peer finds the member from one place and the published version from another",
        {
          core: { "2.1.0": { dependencies: { util: "^2" } } },
          util: { "2.0.0": { peerDependencies: { core: "*" }, peerDependenciesMeta: { core: { optional: true } } } },
        },
        {},
        {
          core: { name: "core", dependencies: { core: "~2.1.0" } },
          util: { name: "util", optionalDependencies: { "util-published": "npm:util@~2.0.0" } },
        },
      ],
      [
        "the member depends on the project",
        { lib: { "1.0.0": {} } },
        { version: "1.0.0", dependencies: { lib: "^1.0.0" } },
        { lib: { name: "lib", version: "5.0.0", dependencies: { root: "workspace:*" } } },
      ],
      [
        "the workspace depends on the project, which also uses the published package with its own name",
        { lib: { "1.0.0": {} }, d: { "2.0.0": {} } },
        { name: "d", version: "9.0.0", dependencies: { lib: "^1.0.0", d: "^2.0.0" } },
        { lib: { name: "lib", version: "5.0.0", dependencies: { d: "workspace:*" } } },
      ],
    ];

    test.each(shapes.flatMap(shape => (["hoisted", "isolated"] as const).map(linker => [linker, ...shape] as const)))(
      "%s: %s",
      async (linker, _, graph, root, members) => {
        using server = await serveGraph(graph);
        using tmp = tempDir("hoist-member-and-published", {
          "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "${linker}"\n`,
          "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"], ...root }),
          ...Object.fromEntries(Object.entries(members).map(([dir, json]) => [`pk/${dir}/package.json`, member(json)])),
        });
        const dir = String(tmp);
        const lockfile = () => file(join(dir, "bun.lock")).text();

        await run(dir, "install");
        const fresh = await lockfile();
        await run(dir, "install", "--frozen-lockfile");
        expect(await run(dir, "install")).toContain("(no changes)");
        await run(dir, "install", "--lockfile-only");
        expect(await lockfile()).toBe(fresh);
      },
    );
  },
);

// The root asks for no-deps@1.0.1, and a member is called no-deps too (2.0.0: not accepted).
test.concurrent.each(["hoisted", "isolated"] as const)(
  "%s: the root's own dependency wins over the workspace with that name",
  async linker => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { "no-deps": "1.0.1" },
        }),
        "packages/a/package.json": JSON.stringify({
          name: "no-deps",
          version: "2.0.0",
          dependencies: { "no-deps": "^1.0.1" },
        }),
        "packages/b/package.json": JSON.stringify({
          name: "ws-b",
          version: "1.0.0",
          dependencies: { "no-deps": "workspace:2.0.0" },
        }),
      },
    });
    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };
    const seen = async () => ({
      root: (await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).version,
      "ws-b": (await file(join(packageDir, "packages", "b", "node_modules", "no-deps", "package.json")).json()).version,
    });

    await runBunInstall(env, packageDir);
    expect(await seen()).toEqual({ root: "1.0.1", "ws-b": "2.0.0" });
    const lockfile = await file(join(packageDir, "bun.lock")).text();

    // Installing from bun.lock gives the same result.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(env, packageDir, { savesLockfile: false });
    expect(await seen()).toEqual({ root: "1.0.1", "ws-b": "2.0.0" });
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
  },
);

// `a` (or `zz`) has a peer dependency on `host@1`, and nothing provides it. The project already uses `host@2`.
describe.concurrent("adding an unrelated package doesn't split a plugin from its host", () => {
  const plugin = (optional: boolean) => ({
    n: { "1.0.0": { dependencies: { host: "^2.1.0", plug: "1.0.0" } } },
    plug: { "1.0.0": { peerDependencies: { host: ">=1.0.0" }, peerDependenciesMeta: { host: { optional } } } },
  });
  // `a` gets its own host@1 at the top, and plug stays next to the host@2 that n provides.
  const nested = ["a@1.0.0", "host@1.5.0", "n@1.0.0", "n/host@2.1.0", "n/plug@1.0.0"];

  test.each([
    ["the host depends on it", plugin(false), { n: "1.0.0" }, "a", nested],
    ["the host depends on it, and the plugin's peer dependency is optional", plugin(true), { n: "1.0.0" }, "a", nested],
    [
      // n's packages are placed first, so they keep the top, and zz gets its own host@1.
      "the host depends on it, and the unrelated package comes last",
      plugin(false),
      { n: "1.0.0" },
      "zz",
      ["host@2.1.0", "n@1.0.0", "plug@1.0.0", "zz@1.0.0", "zz/host@1.5.0"],
    ],
    [
      // No version satisfies tg, cx and a, so a shares the host@2 that tg and cx use.
      "the host only has a peer dependency on it",
      {
        tg: { "1.0.0": { dependencies: { cx: "1.0.0" }, peerDependencies: { host: "^2.1.0" } } },
        cx: { "1.0.0": { peerDependencies: { host: "^1.0.0 || ^2.0.0" } } },
        holder: { "1.0.0": { dependencies: { host: "^2.1.0" } } },
      },
      { holder: "1.0.0", tg: "1.0.0" },
      "a",
      ["a@1.0.0", "cx@1.0.0", "holder@1.0.0", "host@2.1.0", "tg@1.0.0"],
    ],
    [
      // kit uses the host@2 that n provides, so kit and plug both stay under n.
      "the plugin's owner has the same peer dependency",
      {
        n: { "1.0.0": { dependencies: { host: "^2.1.0", kit: "1.0.0" } } },
        kit: { "1.0.0": { dependencies: { plug: "1.0.0" }, peerDependencies: { host: "^2.1.0" } } },
        plug: { "1.0.0": { peerDependencies: { host: ">=1.0.0" } } },
      },
      { n: "1.0.0" },
      "a",
      ["a@1.0.0", "host@1.5.0", "n@1.0.0", "n/host@2.1.0", "n/kit@1.0.0", "n/kit/plug@1.0.0"],
    ],
    [
      // As in pnpm, plug belongs to the project and not to n, so it loads the host at the top.
      "but a plugin that's only installed for a peer dependency goes to the top",
      {
        n: { "1.0.0": { dependencies: { host: "^2.1.0" }, peerDependencies: { plug: "1.0.0" } } },
        plug: { "1.0.0": { peerDependencies: { host: ">=1.0.0" } } },
      },
      { n: "1.0.0" },
      "a",
      ["a@1.0.0", "host@1.5.0", "n@1.0.0", "n/host@2.1.0", "plug@1.0.0"],
    ],
  ])("%s", async (_, graph, dependencies, unrelated, expected) => {
    using server = await serveGraph({
      host: { "1.5.0": {}, "2.1.0": {} },
      [unrelated]: { "1.0.0": { peerDependencies: { host: "^1.0.0" } } },
      ...graph,
    });
    const packageJson = (more: object) => JSON.stringify({ name: "root", dependencies: { ...dependencies, ...more } });
    using tmp = tempDir("hoist-unrelated-peer", {
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
      "package.json": packageJson({}),
    });
    const dir = String(tmp);
    const lockfile = () => readFileSync(join(dir, "bun.lock"), "utf8");

    await run(dir, "install");
    await write(join(dir, "package.json"), packageJson({ [unrelated]: "1.0.0" }));
    await run(dir, "install");
    expect(layout(dir)).toEqual(expected);
    const saved = lockfile();

    // bun.lock is stable, and a fresh install gives the same result.
    await run(dir, "install");
    await run(dir, "install", "--frozen-lockfile");
    expect(lockfile()).toBe(saved);
    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    await rm(join(dir, "bun.lock"));
    await run(dir, "install");
    expect(layout(dir)).toEqual(expected);
    expect(lockfile()).toBe(saved);
  });
});

// kernel@1 is at the top for hook's peer dependency, and kernel@2 is under frame. gear accepts both, and kernel@2 doesn't
// depend on itself, so gear goes to the top. That's where lockfiles from older versions have it.
test.concurrent("a package is hoisted past a copy of its peer that its owner doesn't depend on", async () => {
  using server = await serveGraph({
    hook: { "1.0.0": { peerDependencies: { kernel: "^1.0.0" } } },
    kernel: {
      "1.1.0": { peerDependencies: { frame: "2.0.0" } },
      "2.0.0": { dependencies: { gear: "1.0.0" } },
    },
    frame: { "2.0.0": { dependencies: { kernel: "2.0.0" } } },
    gear: { "1.0.0": { peerDependencies: { kernel: "^1.0.0 || ^2.0.0" } } },
  });
  using tmp = tempDir("hoist-past-peer-copy", {
    "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
    "package.json": JSON.stringify({ name: "root", dependencies: { hook: "1.0.0" } }),
  });
  const dir = String(tmp);
  await run(dir, "install");
  expect(layout(dir)).toEqual(["frame@2.0.0", "frame/kernel@2.0.0", "gear@1.0.0", "hook@1.0.0", "kernel@1.1.0"]);
});

// web provides host@2 to its own hostdom. Nothing provides it in ui, where hostdom needs host@2 and refs needs host@1.
// No version satisfies both, so refs shares host@2 instead of getting a second copy.
test.concurrent.each(["hoisted", "isolated"])(
  "packages in one workspace share a copy of a peer that another workspace provides to one of them (%s)",
  async linker => {
    using server = await serveGraph({
      host: { "1.5.0": {}, "2.1.0": {} },
      hostdom: { "2.1.0": { peerDependencies: { host: "^2.1.0" } } },
      refs: { "1.0.0": { peerDependencies: { host: "^1.0.0" } } },
    });
    using tmp = tempDir("hoist-peer-in-two-workspaces", {
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "${linker}"\n`,
      "package.json": JSON.stringify({ name: "root", workspaces: ["pk/*"] }),
      "pk/web/package.json": JSON.stringify({ name: "web", dependencies: { host: "2.1.0", hostdom: "2.1.0" } }),
      "pk/ui/package.json": JSON.stringify({
        name: "ui",
        dependencies: { refs: "1.0.0" },
        devDependencies: { hostdom: "2.1.0" },
      }),
    });
    const dir = String(tmp);
    await run(dir, "install");
    const hosts = Object.entries(await lockfileTree(dir)).filter(([, resolution]) => resolution.startsWith("host@"));
    expect(hosts).toEqual([["host", "host@2.1.0"]]);
    await run(dir, "install", "--frozen-lockfile");
  },
);

// hostdom needs host@2 and lib needs host@1, so no version can satisfy both, and lib shares the installed host@2. The
// registry can't change that, so it isn't asked about host.
test.concurrent("peers whose ranges don't overlap are resolved without a request for their manifest", async () => {
  using graph = await serveGraph({
    host: { "1.5.0": {}, "2.1.0": {} },
    holder: { "1.0.0": { dependencies: { host: "2.1.0" } } },
    hostdom: { "2.1.0": { peerDependencies: { host: "^2.1.0" } } },
    lib: { "1.0.0": { peerDependencies: { host: "^1.0.0" } } },
  });
  const requested: string[] = [];
  using server = Bun.serve({
    port: 0,
    fetch: request => {
      const { pathname } = new URL(request.url);
      requested.push(pathname);
      return fetch(new URL(pathname, graph.url));
    },
  });
  using tmp = tempDir("hoist-disjoint-peers-no-request", {
    "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
    "package.json": JSON.stringify({ name: "root", dependencies: { holder: "1.0.0", hostdom: "2.1.0" } }),
  });
  const dir = String(tmp);
  await run(dir, "install");

  requested.length = 0;
  await rm(join(dir, ".bun-cache"), { recursive: true, force: true });
  await run(dir, "add", "lib@1.0.0");
  expect(requested).toEqual(["/lib"]);
  expect(layout(dir)).toEqual(["holder@1.0.0", "host@2.1.0", "hostdom@2.1.0", "lib@1.0.0"]);
});

// server is only installed for client's peer dependency, and the project's compiler@7 is out of its range. It still uses
// that version, so no other version is looked up or downloaded.
test.concurrent("a package that's installed for a peer dependency uses the version that the project has", async () => {
  using graph = await serveGraph({
    compiler: { "5.9.3": {}, "7.0.2": {} },
    client: { "1.0.0": { peerDependencies: { server: "1.0.0" } } },
    server: { "1.0.0": { peerDependencies: { compiler: "^5.0.0" } } },
  });
  const requested: string[] = [];
  using server = Bun.serve({
    port: 0,
    fetch: request => {
      const { pathname } = new URL(request.url);
      requested.push(pathname);
      return fetch(new URL(pathname, graph.url));
    },
  });
  using tmp = tempDir("hoist-peer-of-installed-peer", {
    "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
    "package.json": JSON.stringify({ name: "root", devDependencies: { compiler: "^7.0.0" } }),
  });
  const dir = String(tmp);
  await run(dir, "install");

  requested.length = 0;
  await rm(join(dir, ".bun-cache"), { recursive: true, force: true });
  await run(dir, "add", "client@1.0.0");
  expect(requested.sort()).toEqual(["/client", "/server"]);
  expect(layout(dir)).toEqual(["client@1.0.0", "compiler@7.0.2", "server@1.0.0"]);
});

// host@2 is only installed for app's peer dependency. Its own plugin@2 needs host@1, and host@1 depends on plugin@1,
// which uses host@2. Installing host@1 for plugin@2 would make a cycle that can't be laid out in node_modules.
test.concurrent("a package provides itself to a dependency that has a peer dependency on it", async () => {
  using server = await serveGraph({
    app: { "1.0.0": { dependencies: { plugin: "^1.0.0 || ^2.0.0" }, peerDependencies: { host: "2.0.0" } } },
    host: { "1.0.0": { dependencies: { plugin: "^1.0.0" } }, "2.0.0": { dependencies: { plugin: "^2.0.0" } } },
    plugin: { "1.0.0": { peerDependencies: { host: "1.0.5" } }, "2.0.0": { peerDependencies: { host: "1.0.0" } } },
  });
  const packageJson = (more: object) => JSON.stringify({ name: "root", dependencies: { app: "1.0.0" }, ...more });
  using tmp = tempDir("hoist-peer-on-own-parent", {
    "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
    "package.json": packageJson({ overrides: { plugin: "1.0.0" } }),
  });
  const dir = String(tmp);
  await run(dir, "install");
  expect(layout(dir)).toEqual(["app@1.0.0", "host@2.0.0", "plugin@1.0.0"]);

  await write(join(dir, "package.json"), packageJson({}));
  await run(dir, "install");
  expect(layout(dir)).toEqual(["app@1.0.0", "host@2.0.0", "host/plugin@2.0.0", "plugin@1.0.0"]);
});

test.concurrent.each(["hoisted", "isolated"])(
  "a plugin in the repository of its host gets the published host (%s)",
  async linker => {
    using server = await serveGraph({
      host: { "2.1.0": {}, "3.0.0": {} },
      plugin: { "1.0.0": { peerDependencies: { host: "^2.0.0" } } },
    });
    using tmp = tempDir("hoist-peer-named-like-the-project", {
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "${linker}"\n`,
      "package.json": JSON.stringify({ name: "host", version: "3.0.0", devDependencies: { plugin: "1.0.0" } }),
    });
    const dir = String(tmp);
    await run(dir, "install");
    expect(await lockfileTree(dir)).toEqual({ host: "host@2.1.0", plugin: "plugin@1.0.0" });
  },
);

// The project's own peer dependency counts like a regular one, so the project provides compiler@7 to plugin.
test.concurrent("the project provides its dependencies to a package that it has a peer dependency on", async () => {
  using server = await serveGraph({
    compiler: { "5.9.3": {}, "7.0.2": {} },
    plugin: { "1.0.0": { peerDependencies: { compiler: "^5.0.0" } } },
  });
  using tmp = tempDir("hoist-peer-of-project-peer", {
    "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
    "package.json": JSON.stringify({
      name: "root",
      peerDependencies: { plugin: "1.0.0" },
      devDependencies: { compiler: "^7.0.0" },
    }),
  });
  const dir = String(tmp);
  await run(dir, "install");
  expect(layout(dir)).toEqual(["compiler@7.0.2", "plugin@1.0.0"]);
  const downloaded = readdirSync(join(dir, ".bun-cache")).filter(name => name.startsWith("compiler@"));
  expect(downloaded.map(name => name.split("@")[1])).toEqual(["7.0.2"]);
});

// The host bundles no-deps@1.0.0, which is what peer-deps-fixed (peer no-deps@^1.0.0) finds next to
// itself under the host. At the root it would find 2.0.0.
test.concurrent("a package stays under the host that bundles the version that its peer accepts", async () => {
  const host = {
    name: "host",
    version: "1.0.0",
    dependencies: { "no-deps": "1.0.0", "peer-deps-fixed": "1.0.0" },
    bundleDependencies: ["no-deps"],
  };
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: {
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { host: "file:./host-1.0.0.tgz", "no-deps": "2.0.0" },
      }),
    },
  });
  await Bun.Archive.write(
    join(packageDir, "host-1.0.0.tgz"),
    {
      "package/package.json": JSON.stringify(host),
      "package/node_modules/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }),
    },
    { compress: "gzip" },
  );
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };
  const layout = async () => ({
    root: await readdirSorted(join(packageDir, "node_modules")),
    host: await readdirSorted(join(packageDir, "node_modules", "host", "node_modules")),
    own: await exists(join(packageDir, "node_modules", "host", "node_modules", "peer-deps-fixed", "node_modules")),
  });
  const expected = { root: ["host", "no-deps"], host: ["no-deps", "peer-deps-fixed"], own: false };

  await runBunInstall(env, packageDir);
  expect(await layout()).toEqual(expected);
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(env, packageDir, { savesLockfile: false });
  expect(await layout()).toEqual(expected);
});

// The hoisted linker links the packages of the cache on the thread pool. Where few files can be
// open, and on Windows, the main thread links each in its turn. Nothing else may differ.
describe("the thread pool links the same files as the main thread", () => {
  // Returns every entry below `dir`: its kind, its mode, and its link target or contents.
  function entriesOf(dir: string, prefix = "", entries: Record<string, string> = {}) {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      const mode = (stat.mode & 0o777).toString(8);
      if (stat.isSymbolicLink()) {
        entries[prefix + name] = `link to ${readlinkSync(path)}`;
      } else if (stat.isDirectory()) {
        entries[prefix + name] = `directory ${mode}`;
        entriesOf(path, `${prefix}${name}/`, entries);
      } else {
        const links = stat.nlink > 1 ? "linked" : "alone";
        entries[prefix + name] = `file ${mode} ${links} ${Bun.hash(readFileSync(path)).toString(16)}`;
      }
    }
    return entries;
  }

  const withFewOpenFiles = isWindows ? [] : ["sh", "-c", 'ulimit -n 200 && exec "$0" "$@"'];
  const bun = (cwd: string, cache: string, ...args: string[]) => run([bunExe(), ...args], cwd, cache);
  async function run(cmd: string[], cwd: string, cache: string) {
    await using proc = Bun.spawn({
      cmd,
      cwd,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const timeless = (text: string) => text.replace(/\[\d+(\.\d+)?m?s\]/g, "[time]");
    return { stdout: timeless(stdout), stderr: timeless(stderr), exitCode };
  }

  // Covers trees two levels deep, scopes, bins at the root and below a package, a script that runs the bin of the
  // package nested below its own, files that a tarball ships, a folder, a workspace with its own copies, a workspace
  // that has two names, and a patched package (added by `bun patch`).
  const members = ["member", "twice", "other"];
  const files = (optionalDependencies: Record<string, string>) => ({
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: {
        "no-deps": "2.0.0",
        "one-fixed-dep": "2.0.0",
        "one-dep": "1.0.0",
        "two-level-nest": "1.0.0",
        "@types/no-deps": "1.0.0",
        "@types/is-number": "1.0.0",
        "@scoped/no-deps": "1.0.0",
        "@scoped/has-bin-entry": "1.0.0",
        "what-bin": "1.5.0",
        "uses-what-bin": "1.0.0",
        "is-number": "2.0.0",
        "bundled-1": "1.0.0",
        "folder": "file:./folder",
        "member": "workspace:*",
      },
      optionalDependencies,
      trustedDependencies: ["uses-what-bin"],
    }),
    "folder/package.json": JSON.stringify({ name: "folder", version: "1.0.0", dependencies: { "no-deps": "1.0.1" } }),
    "folder/lib/index.js": "module.exports = 'folder';\n",
    "packages/member/package.json": JSON.stringify({
      name: "member",
      version: "1.0.0",
      dependencies: { "no-deps": "1.0.0", "@types/no-deps": "2.0.0" },
    }),
    "packages/twice/package.json": JSON.stringify({
      name: "twice",
      version: "1.0.0",
      dependencies: { "no-deps": "1.1.0" },
    }),
    "packages/other/package.json": JSON.stringify({
      name: "other",
      version: "1.0.0",
      dependencies: { "twice-again": "workspace:twice@*" },
    }),
    "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker: "hoisted" } }),
  });

  function removeNodeModules(project: string, ofMembers = true) {
    rmSync(join(project, "node_modules"), { recursive: true, force: true });
    for (const member of ofMembers ? members : []) {
      rmSync(join(project, "packages", member, "node_modules"), { recursive: true, force: true });
    }
  }

  // Leaves bun.lock, the patch and a warm cache.
  async function prepare(project: string, cache: string) {
    const installed = await bun(project, cache, "install");
    expect(installed.stderr).not.toContain("error:");
    expect(installed.exitCode).toBe(0);
    expect((await bun(project, cache, "patch", "is-number")).exitCode).toBe(0);
    writeFileSync(join(project, "node_modules", "is-number", "patched.js"), "module.exports = 'patched';\n");
    expect((await bun(project, cache, "patch", "--commit", "node_modules/is-number")).exitCode).toBe(0);
    return readFileSync(join(project, "bun.lock"), "utf8");
  }

  const installedIn = (project: string) => ({
    node_modules: entriesOf(join(project, "node_modules")),
    members: Object.fromEntries(members.map(member => [member, entriesOf(join(project, "packages", member))])),
  });

  for (const [title, optionalDependencies] of [
    ["every package can be installed", {}],
    ["an optional dependency cannot be downloaded", { "missing-tarball": "1.0.0" }],
  ] as const) {
    for (const cacheIs of ["cold", "warm"]) {
      test.concurrent(`bun.lock, a ${cacheIs} cache, ${title}`, async () => {
        using dir = tempDir("linked-by-the-pool", { project: files(optionalDependencies) });
        const project = join(String(dir), "project");
        const lockfile = await prepare(project, join(String(dir), "cache"));

        const install = async (name: string, prefix: string[] = []) => ({
          ...(await run(
            [...prefix, bunExe(), "install"],
            project,
            join(String(dir), cacheIs === "warm" ? "cache" : `cache-${name}`),
          )),
          lockfile: readFileSync(join(project, "bun.lock"), "utf8"),
          ...installedIn(project),
        });
        removeNodeModules(project);
        const inTurn = await install("in-turn", withFewOpenFiles);
        removeNodeModules(project);
        mkdirSync(join(project, "node_modules"));
        expect(await install("into-an-empty-one")).toEqual(inTurn);
        removeNodeModules(project);
        const byThePool = await install("by-the-pool");
        expect(byThePool).toEqual(inTurn);

        expect(byThePool.stderr).not.toContain("error:");
        expect(byThePool.lockfile).toBe(lockfile);
        const version = (...path: string[]) =>
          JSON.parse(readFileSync(join(project, "node_modules", ...path, "package.json"), "utf8")).version;
        expect({
          root: version("no-deps"),
          "one-dep": version("one-dep", "node_modules", "no-deps"),
          "two-level-nest": version("two-level-nest", "node_modules", "no-deps"),
          "two-level-nest/one-fixed-dep": version(
            ...["two-level-nest", "node_modules", "one-fixed-dep", "node_modules", "no-deps"],
          ),
          member: version("member", "node_modules", "no-deps"),
          twice: version("twice", "node_modules", "no-deps"),
          "twice-again": version("twice-again", "node_modules", "no-deps"),
          folder: version("folder", "node_modules", "no-deps"),
          shipped: version("bundled-1", "node_modules", "no-deps"),
          script: readFileSync(join(project, "node_modules", "uses-what-bin", "what-bin.txt"), "utf8"),
          patched: readFileSync(join(project, "node_modules", "is-number", "patched.js"), "utf8"),
        }).toEqual({
          root: "2.0.0",
          "one-dep": "1.0.1",
          "two-level-nest": "1.1.0",
          "two-level-nest/one-fixed-dep": "1.0.0",
          member: "1.0.0",
          twice: "1.1.0",
          "twice-again": "1.1.0",
          folder: "1.0.1",
          shipped: "1.0.0",
          script: "what-bin@1.0.0",
          patched: "module.exports = 'patched';\n",
        });
        expect(byThePool.exitCode).toBe(0);
      });
    }
  }

  // Nothing is deleted first in that case, so the workspaces' packages are linked over what's already there.
  test.concurrent("the workspaces' node_modules were kept", async () => {
    using dir = tempDir("linked-by-the-pool-over-members", { project: files({}) });
    const project = join(String(dir), "project");
    const cache = join(String(dir), "cache");
    await prepare(project, cache);
    const complete = installedIn(project);

    removeNodeModules(project, false);
    const stale = join(project, "packages", "member", "node_modules", "no-deps", "package.json");
    rmSync(stale);
    writeFileSync(stale, "{}");
    const { stderr, exitCode } = await bun(project, cache, "install");
    expect(stderr).not.toContain("error:");
    expect(installedIn(project)).toEqual(complete);
    expect(exitCode).toBe(0);
  });
});
