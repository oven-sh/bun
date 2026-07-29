import { afterAll, beforeAll, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, readdirSorted, runBunInstall } from "harness";
import { rm } from "node:fs/promises";
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

// https://github.com/oven-sh/bun/issues/20376
test("does not hoist a package past an ancestor holding a conflicting version of its peer dependency", async () => {
  // hoisting-peer-check-parent depends on { hoisting-peer-check-child: 1.0.0, no-deps: 2.0.0 }
  // hoisting-peer-check-child has peerDependencies: { no-deps: 2.0.0 }
  // Root pins no-deps@1.0.0, so no-deps@2.0.0 is nested under hoisting-peer-check-parent.
  // hoisting-peer-check-child must be nested alongside it so `require("no-deps")` resolves
  // to 2.0.0, not root's 1.0.0.
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

  async function check() {
    expect(await readdirSorted(join(packageDir, "node_modules", "hoisting-peer-check-parent", "node_modules"))).toEqual(
      ["hoisting-peer-check-child", "no-deps"],
    );
    expect(await Bun.file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
    expect(
      await Bun.file(
        join(packageDir, "node_modules", "hoisting-peer-check-parent", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toMatchObject({ version: "2.0.0" });
  }

  await runBunInstall(bunEnv, packageDir);
  await check();

  // Same layout when installing from the lockfile.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
  await check();
});
