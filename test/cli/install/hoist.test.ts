import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, pack, readdirSorted, runBunInstall } from "harness";
import { exists, rm } from "node:fs/promises";
import { join } from "node:path";

// Every test below runs `bun install` twice against the local registry.
setDefaultTimeout(60_000);

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
    await runBunInstall(env, packageDir);
    await check();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    const { err } = await runBunInstall(env, packageDir, { savesLockfile: false });
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
