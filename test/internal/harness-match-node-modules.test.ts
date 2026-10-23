import { install_test_helpers } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { runBunInstall, toMatchNodeModulesAt } from "harness";
import { join } from "path";
import { installEnv, TestRegistry } from "registry";
const { parseLockfile } = install_test_helpers;

expect.extend({ toMatchNodeModulesAt });

const registry = new TestRegistry();
beforeAll(() => registry.start());
afterAll(() => registry.stop());

/** Installs a project with the hoisted linker and returns its folder. */
async function install(files: Record<string, object>) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
  });
  await runBunInstall(installEnv(packageDir), packageDir);
  return packageDir;
}

/** What the matcher reports for the project: one line for each dependency that node_modules gets wrong. */
function problems(dir: string, lockfile = parseLockfile(dir)) {
  const { pass, message } = toMatchNodeModulesAt(lockfile, dir);
  return pass
    ? []
    : message()
        .split("\n")
        .slice(1)
        .map(line => line.trim());
}

function editJson(path: string, edit: (json: any) => void) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  edit(json);
  writeFileSync(path, JSON.stringify(json));
}

describe.concurrent("toMatchNodeModulesAt", () => {
  test("checks every package of a hoisted install", async () => {
    // one-fixed-dep depends on no-deps@1.0.0, which is nested because the root has no-deps@2.0.0.
    const dir = await install({
      "package.json": {
        name: "foo",
        dependencies: { "no-deps": "2.0.0", "one-fixed-dep": "1.0.0", "aliased": "npm:a-dep@1.0.1" },
      },
    });
    const nodeModules = join(dir, "node_modules");
    expect(parseLockfile(dir)).toMatchNodeModulesAt(dir);

    // The lockfile resolves a dependency to another version than the one on disk.
    const lockfile = parseLockfile(dir);
    lockfile.packages.find((pkg: any) => pkg.name === "a-dep").resolution.value = "1.0.2";
    expect(problems(dir, lockfile)).toEqual([
      ". depends on aliased@npm:a-dep@1.0.1 (a-dep@1.0.2), but node_modules/aliased is a-dep@1.0.1",
    ]);
    expect(lockfile).not.toMatchNodeModulesAt(dir);

    // A package on disk is another version than the one the lockfile resolves.
    editJson(join(nodeModules, "one-fixed-dep", "package.json"), json => (json.version = "3.0.0"));
    expect(problems(dir)).toEqual([
      ". depends on one-fixed-dep@1.0.0 (one-fixed-dep@1.0.0), but node_modules/one-fixed-dep is one-fixed-dep@3.0.0",
    ]);
    editJson(join(nodeModules, "one-fixed-dep", "package.json"), json => (json.version = "1.0.0"));
    expect(problems(dir)).toEqual([]);

    // Without its nested copy, one-fixed-dep loads the root's no-deps.
    rmSync(join(nodeModules, "one-fixed-dep", "node_modules"), { recursive: true });
    expect(problems(dir)).toEqual([
      "node_modules/one-fixed-dep depends on no-deps@1.0.0 (no-deps@1.0.0), but node_modules/no-deps is no-deps@2.0.0",
    ]);

    rmSync(nodeModules, { recursive: true });
    expect(problems(dir).sort()).toEqual([
      ". depends on aliased@npm:a-dep@1.0.1 (a-dep@1.0.1), but there is no node_modules/aliased",
      ". depends on no-deps@2.0.0 (no-deps@2.0.0), but there is no node_modules/no-deps",
      ". depends on one-fixed-dep@1.0.0 (one-fixed-dep@1.0.0), but there is no node_modules/one-fixed-dep",
    ]);
  });

  test("reads the package.json of a package whose exports hide it", async () => {
    const dir = await install({ "package.json": { name: "foo", dependencies: { "one-fixed-dep": "2.0.0" } } });
    // `require.resolve("no-deps/package.json")` now gives lib/package.json, which has no name or version.
    const noDeps = join(dir, "node_modules", "no-deps");
    editJson(join(noDeps, "package.json"), json => (json.exports = { "./*": "./lib/*" }));
    mkdirSync(join(noDeps, "lib"));
    writeFileSync(join(noDeps, "lib", "package.json"), JSON.stringify({ type: "module" }));
    expect(problems(dir)).toEqual([]);
  });

  test("follows the dependencies of a workspace package from its folder", async () => {
    const dir = await install({
      "package.json": { name: "foo", workspaces: ["packages/*"], dependencies: { "no-deps": "2.0.0" } },
      "packages/a/package.json": { name: "a", dependencies: { "no-deps": "1.0.0", "b": "workspace:*" } },
      "packages/b/package.json": { name: "b", devDependencies: { "a-dep": "1.0.1" } },
    });
    expect(problems(dir)).toEqual([]);

    rmSync(join(dir, "packages", "a", "node_modules"), { recursive: true });
    expect(problems(dir)).toEqual([
      "packages/a depends on no-deps@1.0.0 (no-deps@1.0.0), but node_modules/no-deps is no-deps@2.0.0",
    ]);

    // A copy of the workspace package is not the workspace package.
    rmSync(join(dir, "node_modules", "b"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "b"));
    writeFileSync(join(dir, "node_modules", "b", "package.json"), JSON.stringify({ name: "b" }));
    rmSync(join(dir, "node_modules", "a-dep"), { recursive: true });
    expect(problems(dir).sort()).toEqual([
      "packages/a depends on b@workspace:* (b@workspace:packages/b), but node_modules/b is not packages/b",
      "packages/a depends on no-deps@1.0.0 (no-deps@1.0.0), but node_modules/no-deps is no-deps@2.0.0",
      "packages/b depends on a-dep@1.0.1 (a-dep@1.0.1), but there is no node_modules/a-dep",
    ]);
  });

  test("accepts what an install leaves out or shares", async () => {
    // optional-native and native depend on packages for an os that does not exist, which are not installed.
    // one-fixed-dep has its own no-deps@1.0.0.
    const dir = await install({
      "package.json": {
        name: "foo",
        dependencies: {
          "optional-native": "1.0.0",
          "native": "1.0.0",
          "no-deps": "2.0.0",
          "one-fixed-dep": "1.0.0",
          "peer-deps-fixed": "1.0.0",
        },
      },
    });
    const nodeModules = join(dir, "node_modules");
    expect(problems(dir)).toEqual([]);

    // An optional dependency can be missing. Which of the two is installed depends on the platform.
    for (const name of ["native-libc-glibc", "native-libc-musl"]) {
      rmSync(join(nodeModules, name), { recursive: true, force: true });
    }
    expect(problems(dir)).toEqual([]);

    // peer-deps-fixed loads the root's no-deps@2.0.0, whichever no-deps the lockfile gives its peer dependency.
    const lockfile = parseLockfile(dir);
    const peer = lockfile.dependencies.find((dep: any) => dep.behavior.peer);
    expect(peer).toMatchObject({ name: "no-deps", literal: "^1.0.0" });
    const noDeps = (version: string) =>
      lockfile.packages.find((pkg: any) => pkg.name === "no-deps" && pkg.resolution.value === version).id;
    for (const version of ["1.0.0", "2.0.0"]) {
      peer.package_id = noDeps(version);
      expect(problems(dir, lockfile)).toEqual([]);
    }

    // A peer dependency still needs a copy to load.
    rmSync(join(nodeModules, "no-deps"), { recursive: true });
    expect(problems(dir, lockfile).sort()).toEqual([
      ". depends on no-deps@2.0.0 (no-deps@2.0.0), but there is no node_modules/no-deps",
      "node_modules/peer-deps-fixed depends on no-deps@^1.0.0 (no-deps@2.0.0), but there is no node_modules/no-deps",
    ]);
  });
});
