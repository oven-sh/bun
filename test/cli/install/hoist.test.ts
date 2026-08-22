import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { exists, rm } from "fs/promises";
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
