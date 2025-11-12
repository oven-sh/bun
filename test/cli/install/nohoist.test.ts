import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, readdirSorted, runBunInstall } from "harness";
import { join } from "path";
import { exists } from "fs/promises";

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("workspaces.nohoist", () => {
  test("basic", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "basic-nohoist",
          workspaces: {
            nohoist: ["one-dep/no-deps"],
          },
          dependencies: {
            "one-dep": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["one-dep"]);
  });

  test("can keep package in workspace node_modules", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "workspace-nohoist",
          workspaces: {
            packages: ["packages/*"],
            nohoist: ["**/one-dep"],
          },
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          dependencies: {
            "one-dep": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir, { linker: "hoisted" });

    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["a-dep", "no-deps", "pkg1"]);
    expect(await readdirSorted(join(packageDir, "packages/pkg1/node_modules"))).toEqual(["one-dep"]);
  });

  test("handles cycles", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "cycles",
          workspaces: {
            nohoist: ["**"],
          },
          dependencies: {
            "a-dep-b": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir, { linker: "hoisted" });

    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "node_modules/a-dep-b/node_modules")),
        exists(join(packageDir, "node_modules/a-dep-b/node_modules/b-dep-a/node_modules")),
      ]),
    ).toEqual([["a-dep-b"], ["b-dep-a"], false]);
  });
});
