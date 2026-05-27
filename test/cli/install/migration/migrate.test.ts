import { expect, setDefaultTimeout, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDirWithFiles, tmpdirSync } from "harness";
import { join } from "path";

setDefaultTimeout(1000 * 60 * 5);

function testMigration(lockfile: string) {
  const testDir = tmpdirSync();

  fs.writeFileSync(
    join(testDir, "package.json"),
    JSON.stringify({
      name: "test3",
      dependencies: {
        "svelte": "*",
      },
    }),
  );
  fs.cpSync(join(import.meta.dir, lockfile), join(testDir, "package-lock.json"));

  Bun.spawnSync([bunExe(), "add", "lodash@4.17.21"], {
    env: bunEnv,
    cwd: testDir,
  });

  expect(fs.existsSync(join(testDir, "node_modules/lodash"))).toBeTrue();

  const svelte_version = JSON.parse(fs.readFileSync(join(testDir, "node_modules/svelte/package.json"), "utf8")).version;
  expect(svelte_version).toBe("4.0.0");

  const lodash_version = JSON.parse(fs.readFileSync(join(testDir, "node_modules/lodash/package.json"), "utf8")).version;
  expect(lodash_version).toBe("4.17.21");
}

test("migrate from npm during `bun add`", () => {
  testMigration("add-while-migrate-fixture.json");
});

test("migrate from npm lockfile v2 during `bun add`", () => {
  testMigration("migrate-from-lockfilev2-fixture.json");
});

// Currently this upgrades svelte :(
test.todo("migrate workspace from npm during `bun add`", async () => {
  const testDir = tmpdirSync();

  fs.cpSync(join(import.meta.dir, "add-while-migrate-workspace"), testDir, { recursive: true });

  Bun.spawnSync([bunExe(), "add", "lodash@4.17.21"], {
    env: bunEnv,
    cwd: join(testDir, "packages", "a"),
  });

  expect(fs.existsSync(join(testDir, "node_modules/lodash"))).toBeTrue();

  const lodash_version = JSON.parse(fs.readFileSync(join(testDir, "node_modules/lodash/package.json"), "utf8")).version;
  expect(lodash_version).toBe("4.17.21");

  const svelte_version = JSON.parse(fs.readFileSync(join(testDir, "node_modules/svelte/package.json"), "utf8")).version;
  expect(svelte_version).toBe("3.0.0");
});

test("migrate package with dependency on root package", async () => {
  const testDir = tmpdirSync();

  fs.cpSync(join(import.meta.dir, "migrate-package-with-dependency-on-root"), testDir, { recursive: true });

  const { stdout } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: join(testDir),
    stdout: "pipe",
  });

  expect(stdout.toString()).toContain("success!");
  expect(fs.existsSync(join(testDir, "node_modules", "test-pkg", "package.json"))).toBeTrue();
});

test("migrate package with npm dependency that resolves to a git package", async () => {
  const testDir = tmpdirSync();

  fs.cpSync(join(import.meta.dir, "npm-version-to-git-resolution"), testDir, { recursive: true });

  const { exitCode } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
    stdout: "pipe",
  });

  expect(exitCode).toBe(0);
  expect(await Bun.file(join(testDir, "node_modules", "jquery", "package.json")).json()).toHaveProperty(
    "name",
    "install-test",
  );
});

test("migrate from npm lockfile that is missing `resolved` properties", async () => {
  const testDir = tmpdirSync();

  fs.cpSync(join(import.meta.dir, "missing-resolved-properties"), testDir, { recursive: true });

  const { exitCode } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
  });

  expect(fs.existsSync(join(testDir, "node_modules/lodash"))).toBeTrue();
  expect(await Bun.file(join(testDir, "node_modules/lodash/package.json")).json()).toHaveProperty("version", "4.17.21");
  expect(exitCode).toBe(0);
});

test("npm lockfile with relative workspaces", async () => {
  const testDir = tmpdirSync();
  console.log(join(import.meta.dir, "lockfile-with-workspaces"), testDir, { recursive: true });
  fs.cpSync(join(import.meta.dir, "lockfile-with-workspaces"), testDir, { recursive: true });
  const { exitCode, stderr } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
  });
  const err = stderr.toString();
  expect(err).toContain("migrated lockfile from package-lock.json");

  expect(err).not.toContain("InvalidNPMLockfile");
  for (let i = 0; i < 4; i++) {
    expect(await Bun.file(join(testDir, "node_modules", "pkg" + i, "package.json")).json()).toEqual({
      "name": "pkg" + i,
    });
  }

  expect(exitCode).toBe(0);
});

const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

for (const lockfile of lockfiles) {
  test(`should create bun.lock if ${lockfile} migration fails`, async () => {
    const testDir = tempDirWithFiles("migration-failure", {
      "package.json": JSON.stringify({
        name: "pkg",
        dependencies: {
          "dep-1": "file:dep-1",
        },
      }),
      [lockfile]: "{}",
      "dep-1/package.json": JSON.stringify({
        name: "dep-1",
      }),
    });

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: testDir,
      stderr: "ignore",
      stdout: "ignore",
    });

    expect(await exited).toBe(0);

    expect(
      await Promise.all([
        fs.promises.exists(join(testDir, "bun.lock")),
        fs.promises.exists(join(testDir, "bun.lockb")),
      ]),
    ).toEqual([true, false]);
  });
}

test("npm lockfile migration skips extraneous packages that also declare inBundle: false", async () => {
  // A package entry carrying both `"inBundle": false` and `"extraneous": true` must be
  // excluded from every migration pass. The counting pass skips it (so its dependencies
  // are never reserved); the building and linking passes must apply the exact same
  // predicate, otherwise they append more package/dependency entries than were counted.
  const phantomDependencies: Record<string, string> = {};
  for (let i = 0; i < 200; i++) {
    phantomDependencies[`phantom-dep-${i}`] = "1.0.0";
  }

  const testDir = tempDirWithFiles("migrate-extraneous-inbundle", {
    "package.json": JSON.stringify({
      name: "extraneous-test",
      workspaces: ["packages/pkg0"],
    }),
    "packages/pkg0/package.json": JSON.stringify({ name: "pkg0" }),
    "package-lock.json": JSON.stringify({
      name: "extraneous-test",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "extraneous-test",
          workspaces: ["packages/pkg0"],
        },
        "node_modules/pkg0": {
          resolved: "packages/pkg0",
          link: true,
        },
        "packages/pkg0": {},
        "node_modules/not-actually-installed": {
          version: "1.0.0",
          inBundle: false,
          extraneous: true,
          dependencies: phantomDependencies,
        },
      },
    }),
  });

  const { exitCode, stderr } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
  });

  const err = stderr.toString();
  expect(err).toContain("migrated lockfile from package-lock.json");
  expect(err).not.toContain("InvalidNPMLockfile");
  expect(exitCode).toBe(0);
  expect(await Bun.file(join(testDir, "node_modules", "pkg0", "package.json")).json()).toEqual({ name: "pkg0" });
  expect(fs.existsSync(join(testDir, "bun.lock"))).toBeTrue();
});

test("npm lockfile migration bails when resolved:null entry is on a non-default registry", async () => {
  // For `resolved: null` entries the migration synthesises a tarball URL from
  // `<registry>/<name>/-/<unscoped>-<ver>.tgz`. That path is npm's own and
  // doesn't match registries with a different tarball layout (GitHub Packages
  // serves at `/download/<scope>/<pkg>/<ver>/<sha>`, for example). If we
  // synthesised regardless, the install would either 404 (best case) or
  // silently drop the affected entries when the dep-walk falls through to a
  // local-folder resolution. The migration must instead refuse and let the
  // outer install fall back to a fresh resolve, which queries the registry's
  // package metadata for the correct URL.
  const testDir = tempDirWithFiles("npm-resolved-null-altreg", {
    "package.json": JSON.stringify({
      name: "pkg",
      dependencies: { "@altreg/dep": "1.0.0" },
    }),
    "bunfig.toml": `[install.scopes]\n"@altreg" = { url = "https://npm.pkg.github.com/" }\n`,
    "package-lock.json": JSON.stringify({
      name: "pkg",
      version: "0.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "pkg",
          version: "0.0.0",
          dependencies: { "@altreg/dep": "1.0.0" },
        },
        "node_modules/@altreg/dep": {
          version: "1.0.0",
        },
      },
    }),
  });

  const { stderr } = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: testDir,
    stdout: "ignore",
  });

  const err = stderr.toString();
  expect(err).toContain("failed to migrate lockfile");
  expect(err).toContain("Ignoring lockfile");
});
