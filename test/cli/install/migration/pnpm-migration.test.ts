import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import {
  bunExe,
  bunEnv as env,
  nodeModulesPackages,
  normalizeBunSnapshot,
  stderrForInstall,
  tempDir,
  VerdaccioRegistry,
} from "harness.js";
import { join } from "path";

const verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

async function install(cwd: string) {
  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err: stderrForInstall(err), exitCode };
}

// Each case runs against its own temp dir and only reads from the shared
// verdaccio registry, so the three live tests execute concurrently.

test.concurrent("basic", async () => {
  const { packageDir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: join(import.meta.dir, "pnpm/basic"),
  });

  {
    const { out, err, exitCode } = await install(packageDir);
    expect(err).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(err).toContain("Saved lockfile");
    expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + a-dep-b@1.0.0
      + b-dep-a@1.0.0
      + no-deps@1.0.1 (v2.0.0 available)
      + a-dep@1.0.1 (v1.0.10 available)

      4 packages installed"
    `);
    expect(exitCode).toBe(0);
  }

  expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
    "node_modules/a-dep-b/a-dep-b@1.0.0
    node_modules/a-dep/a-dep@1.0.1
    node_modules/b-dep-a/b-dep-a@1.0.0
    node_modules/no-deps/no-deps@1.0.1"
  `);

  expect((await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"))
    .toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "worky3",
          "dependencies": {
            "no-deps": "~1.0.0",
          },
          "devDependencies": {
            "a-dep-b": "1.0.0",
          },
          "optionalDependencies": {
            "b-dep-a": "1.0.0",
          },
          "peerDependencies": {
            "a-dep": "1.0.1",
          },
        },
      },
      "packages": {
        "a-dep": ["a-dep@1.0.1", "http://localhost:1234/a-dep/-/a-dep-1.0.1.tgz", {}, "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg=="],

        "a-dep-b": ["a-dep-b@1.0.0", "http://localhost:1234/a-dep-b/-/a-dep-b-1.0.0.tgz", { "dependencies": { "b-dep-a": "1.0.0" } }, "sha512-PW1l4ruYaxcIw4rMkOVzb9zcR2srZhTPv2H2aH7QFc7vVxkD7EEMGHg1GPT8ycLFb8vriydUXEPwOy1FcbodaQ=="],

        "b-dep-a": ["b-dep-a@1.0.0", "http://localhost:1234/b-dep-a/-/b-dep-a-1.0.0.tgz", { "dependencies": { "a-dep-b": "1.0.0" } }, "sha512-1owp4Wy5QE893BGgjDQGZm9Oayk38MA++fXmPTQA1WY/NFQv7CcCVpK2Ht/4mU4KejDeHOxaAj7qbzv1dSQA2w=="],

        "no-deps": ["no-deps@1.0.1", "http://localhost:1234/no-deps/-/no-deps-1.0.1.tgz", {}, "sha512-3X6cn4+UJdXJuLPu11v8i/fGLe2PdI6v1yKTELam04lY5esCAFdG/qQts6N6rLrL6g1YRq+MKBAwxbmUQk355A=="],
      }
    }
    "
  `);

  // A second install over the migrated lockfile must be a no-op.
  {
    const { out, err, exitCode } = await install(packageDir);
    expect(err).not.toContain("migrated lockfile");
    expect(err).not.toContain("Saved lockfile");
    expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      Checked 4 installs across 5 packages (no changes)"
    `);
    expect(exitCode).toBe(0);
  }

  expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
    "node_modules/a-dep-b/a-dep-b@1.0.0
    node_modules/a-dep/a-dep@1.0.1
    node_modules/b-dep-a/b-dep-a@1.0.0
    node_modules/no-deps/no-deps@1.0.1"
  `);
});

test.concurrent("version is number with dot", async () => {
  const { packageDir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: join(import.meta.dir, "pnpm/version-number-dot"),
  });

  const { out, err, exitCode } = await install(packageDir);
  expect(err).toContain("pnpm-lock.yaml version is too old (< v7)");
  expect(err).toContain("failed to migrate lockfile: 'pnpm-lock.yaml'");
  // The too-old lockfile is ignored, not fatal: install falls through to a
  // fresh resolve and writes its own bun.lock.
  expect(err).toContain("Ignoring lockfile");
  expect(err).toContain("Saved lockfile");
  expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + no-deps@1.0.0 (v2.0.0 available)

    1 package installed"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(join(packageDir, "bun.lock"))).toBe(true);
  expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`"node_modules/no-deps/no-deps@1.0.0"`);
});

test.concurrent("folder dependencies: links to the root package are resolved correctly", async () => {
  const { packageDir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: join(import.meta.dir, "pnpm/root-package-link-resolution"),
  });

  const { out, err, exitCode } = await install(packageDir);
  expect(err).toContain("migrated lockfile from pnpm-lock.yaml");
  expect(err).toContain("Saved lockfile");
  expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + two-range-deps@1.0.0

    3 packages installed"
  `);
  expect(exitCode).toBe(0);

  expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
    "node_modules/@types/is-number/@types/is-number@2.0.0
    node_modules/two-range-deps/two-range-deps@1.0.0"
  `);

  expect(
    await Promise.all([
      file(join(packageDir, "node_modules", "two-range-deps", "package.json")).json(),
      file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
    ]),
  ).toMatchInlineSnapshot(`
    [
      {
        "dependencies": {
          "@types/is-number": ">=1.0.0",
          "no-deps": "^1.0.0",
        },
        "name": "two-range-deps",
        "version": "1.0.0",
      },
      {
        "dependencies": {
          "two-range-deps": "1.0.0",
        },
        "name": "transitive-root-link-pkg",
      },
    ]
  `);
});

describe.todo("bin", () => {
  test("manifests are fetched for bins", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/bin-manifest-fetching"),
    });
  });
});

describe.todo("peers", () => {
  test("peers basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/peers-basic"),
    });
  });
  test("workspaces with peers", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/peers-workspaces"),
    });
  });
});

describe.todo("patched packages", () => {
  test("patches are detected and migrated correctly", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/patched-packages"),
    });
  });
});

describe.todo("folder dependencies", () => {
  test("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/folder-dependencies-basic"),
    });
  });
});

describe.todo("overrides", () => {
  test("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/overrides-basic"),
    });
  });
  test("accross workspaces", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/overrides-workspaces"),
    });
  });
});

test.todo("from npm", async () => {
  using testDir = tempDir("pnpm-migration-from-npm-registry", join(import.meta.dir, "pnpm/from-npm"));
});

describe.todo("workspaces", async () => {
  test("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/workspaces-basic"),
    });
  });
  test("workspace dependencies", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/workspaces-dependencies"),
    });
  });
  test("catalogs, peers, and workspaces", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/workspaces-catalogs-peers"),
    });
  });
});
