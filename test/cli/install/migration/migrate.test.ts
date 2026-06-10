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

test("package-lock.json migration requires integrity for tarball URLs outside the configured registry", async () => {
  // A package-lock.json entry whose `resolved` tarball URL points outside the configured
  // registry and that carries no `integrity` field must not be imported as-is. The bun.lock
  // parser already fails closed on this shape; migration must apply the same rule.
  let tarballRequests = 0;
  using server = Bun.serve({
    port: 0,
    fetch() {
      tarballRequests++;
      return new Response("not found", { status: 404 });
    },
  });

  const offRegistryUrl = `http://localhost:${server.port}/lodash-4.17.21.tgz`;

  const testDir = tempDirWithFiles("migrate-off-registry-tarball", {
    "package.json": JSON.stringify({
      name: "off-registry-tarball-test",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21",
      },
    }),
    "package-lock.json": JSON.stringify({
      name: "off-registry-tarball-test",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "off-registry-tarball-test",
          version: "1.0.0",
          dependencies: {
            "lodash": "4.17.21",
          },
        },
        "node_modules/lodash": {
          version: "4.17.21",
          // off-registry tarball URL and no "integrity" field
          resolved: offRegistryUrl,
          license: "MIT",
        },
      },
    }),
  });

  const { exitCode, stderr } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
  });

  const err = stderr.toString();
  // The migration is rejected instead of importing an unverifiable off-registry tarball URL.
  expect(err).toContain("InvalidNPMLockfile");
  expect(err).not.toContain("migrated lockfile from package-lock.json");
  // The off-registry URL is never fetched.
  expect(tarballRequests).toBe(0);
  expect(exitCode).toBe(0);
  // The install still succeeds by ignoring the lockfile and resolving lodash@4.17.21 from the registry.
  expect(await Bun.file(join(testDir, "node_modules", "lodash", "package.json")).json()).toHaveProperty(
    "version",
    "4.17.21",
  );
});

test("package-lock.json migration rejects git committish values that are not a single path component", async () => {
  // The value after "#" in a git `resolved` field becomes a cache folder name, so migration
  // must only accept a single safe path component (same rule the bun.lock parser applies).
  const testDir = tempDirWithFiles("migrate-git-committish-validation", {
    "package.json": JSON.stringify({
      name: "git-committish-test",
      version: "1.0.0",
      dependencies: {
        "jquery": "3.7.1",
      },
    }),
    "package-lock.json": JSON.stringify({
      name: "git-committish-test",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "git-committish-test",
          version: "1.0.0",
          dependencies: {
            "jquery": "3.7.1",
          },
        },
        "node_modules/jquery": {
          version: "3.7.1",
          resolved:
            "git+ssh://git@github.com/dylan-conway/install-test.git#596234dab30564f37adae1e5c4d7123bcffce537/../../../../outside-of-cache",
          license: "MIT",
        },
      },
    }),
  });

  const { exitCode, stderr } = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
  });

  const err = stderr.toString();
  // The migration is rejected instead of accepting a committish containing path separators and "..".
  expect(err).toContain("InvalidNPMLockfile");
  expect(err).not.toContain("migrated lockfile from package-lock.json");
  expect(exitCode).toBe(0);
  // The install still succeeds by ignoring the lockfile and resolving jquery@3.7.1 from the registry.
  expect(await Bun.file(join(testDir, "node_modules", "jquery", "package.json")).json()).toHaveProperty(
    "version",
    "3.7.1",
  );
});

test("package-lock.json migration keeps dependencies declared as arbitrary tarball URLs without integrity", async () => {
  const tarball = await Bun.file(join(import.meta.dir, "..", "baz-0.0.3.tgz")).arrayBuffer();
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(tarball);
    },
  });

  const tarballUrl = `http://localhost:${server.port}/baz-0.0.3.tgz`;

  const testDir = tempDirWithFiles("migrate-arbitrary-tarball-url", {
    "package.json": JSON.stringify({
      name: "arbitrary-tarball-url-test",
      version: "1.0.0",
      dependencies: {
        "baz": tarballUrl,
      },
    }),
    "package-lock.json": JSON.stringify({
      name: "arbitrary-tarball-url-test",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "arbitrary-tarball-url-test",
          version: "1.0.0",
          dependencies: {
            "baz": tarballUrl,
          },
        },
        "node_modules/baz": {
          version: "0.0.3",
          resolved: tarballUrl,
          license: "MIT",
        },
      },
    }),
  });

  await using proc = Bun.spawn([bunExe(), "install"], {
    env: bunEnv,
    cwd: testDir,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(err).not.toContain("InvalidNPMLockfile");
  expect(err).toContain("migrated lockfile from package-lock.json");
  expect(await Bun.file(join(testDir, "node_modules", "baz", "package.json")).json()).toHaveProperty(
    "version",
    "0.0.3",
  );
  expect(fs.existsSync(join(testDir, "bun.lock"))).toBeTrue();
  expect(exitCode).toBe(0);
});
