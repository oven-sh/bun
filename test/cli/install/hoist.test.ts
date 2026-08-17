import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { exists, rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, runBunInstall } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

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

// The hoist-*-cycle-* fixtures are described in registry/packages/create-hoist-cycle-packages.ts.
//
// These graphs can only be laid out by nesting: every package in the cycle conflicts with the
// version of its name one level up, so each copy used to get another copy nested below it and
// `bun install` never finished. The tree now ends at the first copy of a package that is nested
// below another copy of itself; that copy gets no node_modules of its own, so its dependency in
// the cycle resolves to the conflicting version next to it (no finite layout of these graphs avoids
// that). The trees below are what that produces, keyed the way bun.lock keys `packages`.
//
// bun.lock has to load back into the same tree. That copy's row resolves its dependencies to the
// wrong versions by path, so the loader has to bind the package from the copy above it instead; the
// reload half of each test fails if it does not, without --frozen-lockfile noticing.

type Linker = "hoisted" | "isolated";

async function install(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ args, stdout, stderr, exitCode }).toMatchObject({
    stderr: expect.not.stringContaining("error:"),
    exitCode: 0,
  });
}

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

// Installs `files` from scratch, then again in a new directory from the bun.lock that produced,
// and returns the first install's directory.
async function installFreshAndFromLockfile(
  files: Record<string, string>,
  linker: Linker,
  expectedTree: Record<string, string>,
) {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker }, files });
  await install(packageDir);
  const lockfile = await Bun.file(join(packageDir, "bun.lock")).text();
  expect(await lockfileTree(packageDir)).toEqual(expectedTree);

  const { packageDir: reloadDir } = await registry.createTestDir({
    bunfigOpts: { linker },
    files: { ...files, "bun.lock": lockfile },
  });
  await install(reloadDir, "--frozen-lockfile");
  expect(await installedPackageJsons(reloadDir)).toEqual(await installedPackageJsons(packageDir));

  // --lockfile-only always writes, so this is the tree a reload builds, printed back.
  await install(reloadDir, "--lockfile-only");
  expect(await Bun.file(join(reloadDir, "bun.lock")).text()).toBe(lockfile);

  return packageDir;
}

test.each(["hoisted", "isolated"] as const)(
  "a dependency cycle through two versions of the same packages is installed (%s linker)",
  async linker => {
    const packageDir = await installFreshAndFromLockfile(
      { "package.json": JSON.stringify({ name: "pkg", dependencies: { "hoist-cycle-x": "1.0.0" } }) },
      linker,
      {
        "hoist-cycle-x": "hoist-cycle-x@1.0.0",
        "hoist-cycle-y": "hoist-cycle-y@1.0.0",
        "hoist-cycle-y/hoist-cycle-x": "hoist-cycle-x@2.0.0",
        "hoist-cycle-y/hoist-cycle-x/hoist-cycle-y": "hoist-cycle-y@2.0.0",
        "hoist-cycle-y/hoist-cycle-x/hoist-cycle-y/hoist-cycle-x": "hoist-cycle-x@1.0.0",
        // This y@1.0.0 is below the y@1.0.0 at the root, so it gets no node_modules of its own.
        "hoist-cycle-y/hoist-cycle-x/hoist-cycle-y/hoist-cycle-x/hoist-cycle-y": "hoist-cycle-y@1.0.0",
      },
    );

    if (linker === "hoisted") {
      expect(await installedPackageJsons(packageDir)).toEqual([
        "hoist-cycle-x/package.json",
        "hoist-cycle-y/node_modules/hoist-cycle-x/node_modules/hoist-cycle-y/node_modules/hoist-cycle-x/node_modules/hoist-cycle-y/package.json",
        "hoist-cycle-y/node_modules/hoist-cycle-x/node_modules/hoist-cycle-y/node_modules/hoist-cycle-x/package.json",
        "hoist-cycle-y/node_modules/hoist-cycle-x/node_modules/hoist-cycle-y/package.json",
        "hoist-cycle-y/node_modules/hoist-cycle-x/package.json",
        "hoist-cycle-y/package.json",
      ]);
    }
  },
);

test("a cycle entered at both of its versions, from the root and from a workspace, is installed", async () => {
  await installFreshAndFromLockfile(
    {
      "package.json": JSON.stringify({
        name: "pkg",
        workspaces: ["packages/*"],
        dependencies: { "hoist-cycle-x": "1.0.0" },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "hoist-cycle-x": "2.0.0" },
      }),
    },
    "hoisted",
    {
      "app": "app@workspace:packages/app",
      "hoist-cycle-x": "hoist-cycle-x@1.0.0",
      "hoist-cycle-y": "hoist-cycle-y@1.0.0",
      "hoist-cycle-y/hoist-cycle-x": "hoist-cycle-x@2.0.0",
      "hoist-cycle-y/hoist-cycle-x/hoist-cycle-y": "hoist-cycle-y@2.0.0",
      "hoist-cycle-y/hoist-cycle-x/hoist-cycle-y/hoist-cycle-x": "hoist-cycle-x@1.0.0",
      "hoist-cycle-y/hoist-cycle-x/hoist-cycle-y/hoist-cycle-x/hoist-cycle-y": "hoist-cycle-y@1.0.0",
      // The workspace's branch enters the cycle at x@2.0.0, so it is x@2.0.0's copy that ends it.
      "app/hoist-cycle-x": "hoist-cycle-x@2.0.0",
      "app/hoist-cycle-x/hoist-cycle-y": "hoist-cycle-y@2.0.0",
      "app/hoist-cycle-x/hoist-cycle-y/hoist-cycle-x": "hoist-cycle-x@1.0.0",
      "app/hoist-cycle-x/hoist-cycle-y/hoist-cycle-x/hoist-cycle-y": "hoist-cycle-y@1.0.0",
      "app/hoist-cycle-x/hoist-cycle-y/hoist-cycle-x/hoist-cycle-y/hoist-cycle-x": "hoist-cycle-x@2.0.0",
    },
  );
});

test.each(["hoisted", "isolated"] as const)(
  "a bundled dependency with a peer on the package bundling it is installed (%s linker)",
  async linker => {
    // The plugin's peer is satisfied by the host it is bundled in. The host used to be copied into
    // its own node_modules instead, and the copy bundled the plugin again below it, and so on.
    await installFreshAndFromLockfile(
      { "package.json": JSON.stringify({ name: "pkg", dependencies: { "hoist-bundled-cycle-host": "1.0.0" } }) },
      linker,
      {
        "hoist-bundled-cycle-host": "hoist-bundled-cycle-host@1.0.0",
        "hoist-bundled-cycle-host/hoist-bundled-cycle-plugin": "hoist-bundled-cycle-plugin@1.0.0",
      },
    );
  },
);

test("a cycle closed through an optional peer is installed", async () => {
  await installFreshAndFromLockfile(
    {
      "package.json": JSON.stringify({
        name: "pkg",
        dependencies: { "hoist-optional-peer-cycle-x": "2.0.0" },
        devDependencies: { "hoist-optional-peer-cycle-entry": "1.0.0" },
      }),
    },
    "hoisted",
    {
      "hoist-optional-peer-cycle-entry": "hoist-optional-peer-cycle-entry@1.0.0",
      "hoist-optional-peer-cycle-x": "hoist-optional-peer-cycle-x@2.0.0",
      "hoist-optional-peer-cycle-y": "hoist-optional-peer-cycle-y@2.0.0",
      "hoist-optional-peer-cycle-z": "hoist-optional-peer-cycle-z@2.0.0",
      "hoist-optional-peer-cycle-entry/hoist-optional-peer-cycle-x": "hoist-optional-peer-cycle-x@1.0.0",
      "hoist-optional-peer-cycle-entry/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-y":
        "hoist-optional-peer-cycle-y@1.0.0",
      "hoist-optional-peer-cycle-entry/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-z":
        "hoist-optional-peer-cycle-z@1.0.0",
      // y@1.0.0's peer on x@2.0.0, nested because x@1.0.0 is above it.
      "hoist-optional-peer-cycle-entry/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-y/hoist-optional-peer-cycle-x":
        "hoist-optional-peer-cycle-x@2.0.0",
      // z@1.0.0's y@2.0.0, whose optional peer binds to the x@1.0.0 above it here.
      "hoist-optional-peer-cycle-entry/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-z/hoist-optional-peer-cycle-y":
        "hoist-optional-peer-cycle-y@2.0.0",
      "hoist-optional-peer-cycle-entry/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-y/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-y":
        "hoist-optional-peer-cycle-y@2.0.0",
      "hoist-optional-peer-cycle-entry/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-y/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-z":
        "hoist-optional-peer-cycle-z@2.0.0",
      // That y@2.0.0 sits below x@2.0.0, so the bound x@1.0.0 is nested under it; this x@1.0.0 is
      // below the x@1.0.0 under `entry` and is where the tree ends.
      "hoist-optional-peer-cycle-entry/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-y/hoist-optional-peer-cycle-x/hoist-optional-peer-cycle-y/hoist-optional-peer-cycle-x":
        "hoist-optional-peer-cycle-x@1.0.0",
    },
  );
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
