import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "fs";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, isASAN, runBunInstall } from "harness";
import { join } from "node:path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

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

test("should handle resolving optional peer from multiple instances of same package", async () => {
  const packageDir = await createTestDir({
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

// The below-self-* and self-contained-* fixtures are described in
// registry/packages/create-hoist-below-self-packages.ts.
//
// These pin layouts that are easy to break while changing how the tree deals with dependency
// cycles: a package installed a second time below another copy of itself still has to get its own
// node_modules, because what was nested in between shadows some of its dependencies.

type Linker = "hoisted" | "isolated";

// The timeout only matters if an install never returns. The runner does not clean up the children
// of concurrent tests, so without it a layout that stops terminating would keep running, and
// growing, after its test has failed.
//
// CI exports one BUN_INSTALL_CACHE_DIR per test file, which overrides the per-directory cache in
// bunfig.toml. These cases run concurrently and install the same packages, and on Windows installs
// racing on one cache fail with "Failed to install 1 package", so each directory gets its own.
async function run(cwd: string, ...cmd: string[]) {
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
  expect({ cmd, stdout, stderr, signalCode: proc.signalCode, exitCode }).toMatchObject({
    stderr: expect.not.stringContaining("error:"),
    signalCode: null,
    exitCode: 0,
  });
  return stdout;
}

// bun.lock keys `packages` by node_modules path; this maps each path to what is installed there.
async function lockfileTree(dir: string) {
  const { packages } = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as {
    packages: Record<string, [string, ...unknown[]]>;
  };
  return Object.fromEntries(Object.entries(packages).map(([path, [resolution]]) => [path, resolution]));
}

// The same `edges()` every fixture package exports. The project gets one too, because under the
// isolated linker only the project itself goes through the links in its node_modules.
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
  test.each([
    ["a dependency", "self-contained-plugin"],
    ["a peer dependency", "self-contained-peer-plugin"],
  ])("is linked into its own node_modules for a package with %s on it", async (_, plugin) => {
    const { packageDir, reloadDir } = await installFreshAndFromLockfile({
      linker: "hoisted",
      files: {
        "package.json": JSON.stringify({
          name: "root",
          private: true,
          workspaces: { packages: ["apps/*"], selfContained: ["apps/desktop"] },
        }),
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
});
