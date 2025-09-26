import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeModulesPackages, tempDir, VerdaccioRegistry } from "harness.js";
import { join } from "path";

let verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

test("basic", async () => {
  const { packageDir } = await verdaccio.createTestDir({ files: join(import.meta.dir, "pnpm/basic") });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(err).toContain("Saved lockfile");

  expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
    "node_modules/a-dep-b/a-dep-b@1.0.0
    node_modules/a-dep/a-dep@1.0.1
    node_modules/b-dep-a/b-dep-a@1.0.0
    node_modules/no-deps/no-deps@1.0.1"
  `);

  expect(
    (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"),
  ).toMatchSnapshot("bun.lock");

  const [noDeps, aDepB, bDepA, aDep] = await Promise.all([
    file(join(packageDir, "node_modules/no-deps/package.json")).json(),
    file(join(packageDir, "node_modules/a-dep-b/package.json")).json(),
    file(join(packageDir, "node_modules/b-dep-a/package.json")).json(),
    file(join(packageDir, "node_modules/a-dep/package.json")).json(),
  ]);

  expect(noDeps.version).toBe("1.0.1");
  expect(aDepB.version).toBe("1.0.0");
  expect(bDepA.version).toBe("1.0.0");
  expect(aDep.version).toBe("1.0.1");
});

describe("bin", () => {
  test("manifests are fetched for bins", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/bin-manifest-fetching"),
    });
  });
});

describe("peers", () => {
  test("peers basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/peers-basic"),
    });
  });
  test("workspaces with peers", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/peers-workspaces"),
    });
  });
});

describe("patched packages", () => {
  test("patches are detected and migrated correctly", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/patched-packages"),
    });
  });
});

describe("folder dependencies", () => {
  test("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/folder-dependencies-basic"),
    });
  });
  test("links are resolved correctly", async () => {
    // link:
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/folder-dependencies-links"),
    });
  });
});

describe("overrides", () => {
  test("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/overrides-basic"),
    });
  });
  test("accross workspaces", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/overrides-workspaces"),
    });
  });
});

test("from npm", async () => {
  using testDir = tempDir("pnpm-migration-from-npm-registry", join(import.meta.dir, "pnpm/from-npm"));
});

describe("workspaces", async () => {
  test("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/workspaces-basic"),
    });
  });
  test("workspace dependencies", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/workspaces-dependencies"),
    });
  });
});
