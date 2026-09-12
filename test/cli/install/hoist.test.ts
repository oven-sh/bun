import { file } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { rm } from "fs/promises";
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

// CI exports BUN_INSTALL_CACHE_DIR, which overrides the harness bunfig's per-test `cache`; concurrent cases sharing one cache race on Windows.
const installEnv = (dir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });

const pkgSeenAt = async (dir: string, ...segments: string[]) => {
  const { name, version } = await file(join(dir, "node_modules", ...segments, "package.json")).json();
  return `${name}@${version}`;
};

// A root npm alias can occupy a peer's name with a different package. The peer
// must not dedupe onto it; its own resolution nests next to the dependent.
test.concurrent("a peer nests its own package when a root alias occupies the name", async () => {
  const { packageDir } = await registry.createTestDir({
    files: {
      "package.json": JSON.stringify({
        name: "pkg",
        dependencies: {
          "a-dep": "npm:no-deps@1.0.0",
          "peer-a-dep-gte-1-0-2": "1.0.0",
        },
      }),
    },
  });

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(await pkgSeenAt(packageDir, "a-dep")).toBe("no-deps@1.0.0");
  expect(await pkgSeenAt(packageDir, "peer-a-dep-gte-1-0-2", "node_modules", "a-dep")).toBe("a-dep@1.0.10");
});

// https://github.com/oven-sh/bun/issues/39883
test.concurrent("an overridden peer nests the override target when a root alias occupies the name", async () => {
  const { packageDir } = await registry.createTestDir({
    files: {
      "package.json": JSON.stringify({
        name: "pkg",
        dependencies: {
          "no-deps": "npm:a-dep@1.0.1",
          "peer-deps-fixed": "1.0.0",
        },
        overrides: {
          "peer-deps-fixed>no-deps": "npm:no-deps@1.0.0",
        },
      }),
    },
  });
  const env = installEnv(packageDir);

  await runBunInstall(env, packageDir);

  const check = async () => {
    expect(await pkgSeenAt(packageDir, "no-deps")).toBe("a-dep@1.0.1");
    expect(await pkgSeenAt(packageDir, "peer-deps-fixed", "node_modules", "no-deps")).toBe("no-deps@1.0.0");
  };
  await check();

  // the reported scenario: reinstall from the saved lockfile
  const lockBefore = await file(join(packageDir, "bun.lock")).text();
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(env, packageDir, { frozenLockfile: true });
  await check();
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockBefore);
});
