import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { exists } from "fs/promises";
import { VerdaccioRegistry, bunEnv, runBunInstall } from "harness";
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
