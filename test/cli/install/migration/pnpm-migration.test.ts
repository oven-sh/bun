import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunExe, bunEnv as env, nodeModulesPackages, tempDir, VerdaccioRegistry } from "harness.js";
import { join } from "path";

let verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

test("basic", async () => {
  const { packageDir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: join(import.meta.dir, "pnpm/basic"),
  });

  let proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

  proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(err).not.toContain("Saved lockfile");
});

test("version is number with dot", async () => {
  const { packageDir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: join(import.meta.dir, "pnpm/version-number-dot"),
  });

  let proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(err).toContain("pnpm-lock.yaml version is too old (< v7)");
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

describe("folder dependencies", () => {
  test.todo("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/folder-dependencies-basic"),
    });
  });
  test("links to the root package are resolved correctly", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/root-package-link-resolution"),
    });

    let proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(err).toContain("Saved lockfile");

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

describe("pnpm settings migration", () => {
  test("migrates onlyBuiltDependencies to trustedDependencies", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/settings-trusted"),
    });

    const proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode] = await Promise.all([proc.exited]);
    expect(exitCode).toBe(0);

    const pkgJson = await file(join(packageDir, "package.json")).json();
    expect(pkgJson.trustedDependencies).toEqual(["esbuild", "fsevents"]);
  });

  test("migrates minimumReleaseAge to bunfig.toml (minutes to seconds)", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/settings-minage"),
    });

    const proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode] = await Promise.all([proc.exited]);
    expect(exitCode).toBe(0);

    const bunfigText = await file(join(packageDir, "bunfig.toml")).text();
    const bunfig = Bun.TOML.parse(bunfigText) as {
      install?: { minimumReleaseAge?: number; minimumReleaseAgeExcludes?: string[] };
    };

    // 1440 minutes * 60 = 86400 seconds
    expect(bunfig.install?.minimumReleaseAge).toBe(86400);
    expect(bunfig.install?.minimumReleaseAgeExcludes).toEqual(["webpack", "react"]);
  });

  test("migrates hoistPattern and shamefullyHoist to bunfig.toml", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/settings-hoist"),
    });

    const proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode] = await Promise.all([proc.exited]);
    expect(exitCode).toBe(0);

    const bunfigText = await file(join(packageDir, "bunfig.toml")).text();
    const bunfig = Bun.TOML.parse(bunfigText) as {
      install?: { publicHoistPattern?: string[]; hoistPattern?: string[] };
    };

    // shamefullyHoist prepends "*" to publicHoistPattern
    expect(bunfig.install?.publicHoistPattern).toEqual(["*", "*plugin*"]);
    expect(bunfig.install?.hoistPattern).toEqual(["*eslint*", "*babel*"]);
  });

  test("does not duplicate settings on second migration", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      files: join(import.meta.dir, "pnpm/settings-minage"),
    });

    // First install - migrates settings
    let proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    let [exitCode] = await Promise.all([proc.exited]);
    expect(exitCode).toBe(0);

    const bunfigAfterFirst = await file(join(packageDir, "bunfig.toml")).text();
    const firstParsed = Bun.TOML.parse(bunfigAfterFirst) as { install?: { minimumReleaseAge?: number } };
    expect(firstParsed.install?.minimumReleaseAge).toBe(86400);

    // Second install - should not duplicate
    proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    [exitCode] = await Promise.all([proc.exited]);
    expect(exitCode).toBe(0);

    const bunfigAfterSecond = await file(join(packageDir, "bunfig.toml")).text();
    const secondParsed = Bun.TOML.parse(bunfigAfterSecond) as { install?: { minimumReleaseAge?: number } };

    // Should still have the same value, not duplicated
    expect(secondParsed.install?.minimumReleaseAge).toBe(86400);
    // Key should only appear once since we check if it exists before appending
    // Use word boundary to not match minimumReleaseAgeExcludes
    const matches = bunfigAfterSecond.match(/minimumReleaseAge\s*=/g);
    expect(matches?.length).toBe(1);
  });
});
