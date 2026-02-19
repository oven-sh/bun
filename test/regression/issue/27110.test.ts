import { afterAll, beforeAll, expect, test } from "bun:test";
import { readlinkSync } from "fs";
import { VerdaccioRegistry, bunEnv, readdirSorted, runBunInstall } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/27110
// Workspace dependencies should be hoisted to root node_modules by default
// in isolated mode (auto linker with workspaces).

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

test("isolated linker hoists workspace dependencies to root node_modules by default", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        name: "workspace-root",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    },
  });

  await runBunInstall(bunEnv, packageDir);

  // Root node_modules should contain the hoisted dependency
  const rootNodeModules = await readdirSorted(join(packageDir, "node_modules"));
  expect(rootNodeModules).toContain(".bun");
  expect(rootNodeModules).toContain("app");
  expect(rootNodeModules).toContain("no-deps");

  // The hoisted dependency should be a symlink into the .bun store
  expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );

  // Workspace package should also have its dependency symlinked
  const appNodeModules = await readdirSorted(join(packageDir, "packages", "app", "node_modules"));
  expect(appNodeModules).toContain("no-deps");
});

test("isolated linker hoists transitive workspace dependencies to root node_modules by default", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        name: "workspace-root",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: {
          "a-dep": "1.0.1",
        },
      }),
    },
  });

  await runBunInstall(bunEnv, packageDir);

  // Root node_modules should contain both the direct and transitive dependencies
  const rootNodeModules = await readdirSorted(join(packageDir, "node_modules"));
  expect(rootNodeModules).toContain(".bun");
  expect(rootNodeModules).toContain("app");
  expect(rootNodeModules).toContain("a-dep");
  // a-dep depends on no-deps, which should also be hoisted
  expect(rootNodeModules).toContain("no-deps");
});

test("isolated linker respects publicHoistPattern when set", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated", publicHoistPattern: "no-deps" },
    files: {
      "package.json": JSON.stringify({
        name: "workspace-root",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: {
          "a-dep": "1.0.1",
        },
      }),
    },
  });

  await runBunInstall(bunEnv, packageDir);

  // Only no-deps should be hoisted (matches pattern), not a-dep
  const rootNodeModules = await readdirSorted(join(packageDir, "node_modules"));
  expect(rootNodeModules).toContain(".bun");
  expect(rootNodeModules).toContain("app");
  expect(rootNodeModules).toContain("no-deps");
  expect(rootNodeModules).not.toContain("a-dep");
});
