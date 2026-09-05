import { afterAll, beforeAll, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, bunExe, runBunInstall } from "harness";
import { join } from "node:path";

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
