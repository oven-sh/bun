import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

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
