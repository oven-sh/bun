import { describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, pack, tempDir, tmpdirSync } from "harness";
import { dirname, join } from "path";

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
    await using testDir = tempDir("migration-failure", {
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

  await using testDir = tempDir("migrate-extraneous-inbundle", {
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

  await using testDir = tempDir("migrate-off-registry-tarball", {
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
  await using testDir = tempDir("migrate-git-committish-validation", {
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

  await using testDir = tempDir("migrate-arbitrary-tarball-url", {
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

// npm infers a name from a lockfile entry's folder path, keeping an `@scope` parent
// component, and omits the entry's `name` field whenever that inference matches it.
function npmNameFromFolder(folder: string) {
  const parts = folder.split("/");
  const base = parts[parts.length - 1];
  const scope = parts[parts.length - 2];
  return scope?.startsWith("@") ? `${scope}/${base}` : base;
}

// Regular (non-optional) `file:` folder dependency whose package.json declares `os`/`cpu`
// arrays. npm records those fields in the package-lock.json entry for every package, but
// Bun only applies platform constraints to npm registry packages; a fresh `bun install`
// of the same package.json installs the folder regardless. Migrating must not diverge.
function filePlatformFixture(name: string, folder: string, os: string[], cpu: string[]) {
  const folderPackageJson: Record<string, unknown> = { name, version: "1.0.0" };
  const folderLockEntry: Record<string, unknown> = { version: "1.0.0" };
  if (npmNameFromFolder(folder) !== name) folderLockEntry.name = name;
  if (os.length) folderPackageJson.os = folderLockEntry.os = os;
  if (cpu.length) folderPackageJson.cpu = folderLockEntry.cpu = cpu;
  return {
    "package.json": JSON.stringify({ name: "repro", dependencies: { [name]: `file:./${folder}` } }),
    [`${folder}/package.json`]: JSON.stringify(folderPackageJson),
    // Exactly what `npm install --package-lock-only` produces for this tree.
    "package-lock.json": JSON.stringify({
      name: "repro",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "repro", dependencies: { [name]: `file:./${folder}` } },
        [`node_modules/${name}`]: { resolved: folder, link: true },
        [folder]: folderLockEntry,
      },
    }),
  };
}

async function install(testDir: string, ...args: string[]) {
  await using proc = Bun.spawn([bunExe(), "install", ...args], {
    env: bunEnv,
    cwd: testDir,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

test.concurrent("package-lock.json migration does not platform-skip a regular file: folder dependency", async () => {
  await using testDir = tempDir(
    "migrate-folder-platform",
    filePlatformFixture("a", "vendor/a", [`!${process.platform}`], [`!${process.arch}`]),
  );

  const { stderr, exitCode } = await install(testDir);
  expect(stderr).toContain("migrated lockfile from package-lock.json");
  expect(stderr).not.toContain("InvalidNPMLockfile");
  expect(exitCode).toBe(0);
  expect(await Bun.file(join(testDir, "node_modules", "a", "package.json")).json()).toHaveProperty("name", "a");

  // The migrated bun.lock matches what a fresh resolve of the same package.json writes:
  // the folder package keeps its real name and carries no os/cpu constraint.
  expect(await Bun.file(join(testDir, "bun.lock")).text()).toContain(`"a": ["a@file:vendor/a", {}]`);
});

test.concurrent.each([
  ["a", "vendor/a"],
  ["@scope/a", "vendor/@scope/a"],
  // npm writes an explicit `name` for these two, because the name it infers from the
  // folder path (`@admin`) differs from the manifest's; migration must honor it.
  ["admin", "@admin"],
  ["admin", "packages/@admin"],
])(
  "package-lock.json migration writes a bun.lock its own parser accepts for file: folder dependency %s at %s",
  async (name, folder) => {
    await using testDir = tempDir("migrate-folder-name", filePlatformFixture(name, folder, [], []));

    const first = await install(testDir);
    expect(first.stderr).toContain("migrated lockfile from package-lock.json");
    expect(first.exitCode).toBe(0);
    expect(await Bun.file(join(testDir, "bun.lock")).text()).toContain(`"${name}": ["${name}@file:${folder}", {}]`);

    // The second install consumes the bun.lock the migration just wrote. It must parse,
    // otherwise --frozen-lockfile is permanently broken after an npm migration.
    const second = await install(testDir, "--frozen-lockfile");
    expect(second.stderr).not.toContain("Invalid package name");
    expect(second.stderr).not.toContain("Ignoring lockfile");
    expect(second.exitCode).toBe(0);
    expect(await Bun.file(join(testDir, "node_modules", name, "package.json")).json()).toHaveProperty("name", name);
  },
);

test.concurrent("package-lock.json migration does not platform-skip a regular file: tarball dependency", async () => {
  // Same divergence as the folder variant, for a `LocalTarball` resolution. npm records
  // the packed package's `os`/`cpu` arrays in its lockfile entry, and a fresh resolve of
  // the same package.json extracts and installs the tarball regardless of them.
  const nonMatching = { os: [`!${process.platform}`], cpu: [`!${process.arch}`] };
  await using testDir = tempDir("migrate-tarball-platform", {
    "package.json": JSON.stringify({ name: "repro", dependencies: { a: "file:./a-1.0.0.tgz" } }),
    "src-a/package.json": JSON.stringify({ name: "a", version: "1.0.0", ...nonMatching }),
  });

  await pack(join(testDir, "src-a"), bunEnv, "--destination", testDir);
  expect(fs.existsSync(join(testDir, "a-1.0.0.tgz"))).toBeTrue();

  await Bun.write(
    join(testDir, "package-lock.json"),
    JSON.stringify({
      name: "repro",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "repro", dependencies: { a: "file:./a-1.0.0.tgz" } },
        "node_modules/a": { version: "1.0.0", resolved: "file:a-1.0.0.tgz", ...nonMatching },
      },
    }),
  );

  const { stderr, exitCode } = await install(testDir);
  expect(stderr).toContain("migrated lockfile from package-lock.json");
  expect(stderr).not.toContain("InvalidNPMLockfile");
  expect(exitCode).toBe(0);
  expect(await Bun.file(join(testDir, "node_modules", "a", "package.json")).json()).toHaveProperty("name", "a");
});

test.concurrent("pnpm-lock.yaml migration does not platform-skip a regular file: folder dependency", async () => {
  // The pnpm migration copied the lockfile's `os`/`cpu` arrays into every package the
  // same way the npm one did. pnpm records them for any `packages:` entry whose manifest
  // declares them, so a `file:` folder dependency was silently dropped on a mismatch.
  await using testDir = tempDir("migrate-pnpm-folder-platform", {
    "package.json": JSON.stringify({ name: "repro", dependencies: { a: "file:./vendor/a" } }),
    "vendor/a/package.json": JSON.stringify({
      name: "a",
      version: "1.0.0",
      os: [`!${process.platform}`],
      cpu: [`!${process.arch}`],
    }),
    "pnpm-lock.yaml": [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      a:",
      "        specifier: file:./vendor/a",
      "        version: file:vendor/a",
      "",
      "packages:",
      "",
      "  a@file:vendor/a:",
      "    resolution: {directory: vendor/a, type: directory}",
      `    os: ['!${process.platform}']`,
      `    cpu: ['!${process.arch}']`,
      "    version: 1.0.0",
      "",
      "snapshots:",
      "",
      "  a@file:vendor/a: {}",
      "",
    ].join("\n"),
  });

  const { stderr, exitCode } = await install(testDir);
  expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
  expect(exitCode).toBe(0);
  expect(await Bun.file(join(testDir, "node_modules", "a", "package.json")).json()).toHaveProperty("name", "a");
});

describe("package-lock.json migration fixes", () => {
  const NPM = join(import.meta.dir, "npm");
  // Port 1 refuses connections, so any accidental registry access fails the test.
  const OFFLINE_BUNFIG = `[install]\nregistry = "http://localhost:1/"\n`;

  function writeExtra(dir: string, extra: Record<string, string>) {
    fs.writeFileSync(join(dir, "bunfig.toml"), OFFLINE_BUNFIG);
    for (const [name, contents] of Object.entries(extra)) {
      fs.mkdirSync(dirname(join(dir, name)), { recursive: true });
      fs.writeFileSync(join(dir, name), contents);
    }
  }

  function fixture(name: string, extra: Record<string, string> = {}) {
    const dir = tempDir("npm-migrate-" + name, join(NPM, name));
    writeExtra(String(dir), extra);
    return dir;
  }

  function synthetic(name: string, files: Record<string, string>) {
    const dir = tempDir(name, files);
    writeExtra(String(dir), {});
    return dir;
  }

  async function run(dir: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  async function readLock(dir: string) {
    const text = await Bun.file(join(String(dir), "bun.lock")).text();
    return { text, lock: Bun.JSONC.parse(text) as any };
  }

  async function migrate(dir: string) {
    const result = await run(dir, "pm", "migrate");
    if (result.exitCode !== 0) {
      throw new Error(`bun pm migrate exited with ${result.exitCode}\n${result.stderr}`);
    }
    return { ...result, ...(await readLock(dir)) };
  }

  async function frozen(dir: string) {
    const before = await Bun.file(join(String(dir), "bun.lock")).text();
    const { stderr, exitCode } = await run(dir, "install", "--frozen-lockfile", "--lockfile-only");
    expect(stderr).not.toContain("Ignoring lockfile");
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "bun.lock")).text()).toBe(before);
  }

  async function pmHash(dir: string) {
    const { stdout, stderr, exitCode } = await run(dir, "pm", "hash");
    if (exitCode !== 0) throw new Error(`bun pm hash exited with ${exitCode}\n${stderr}`);
    return stdout.trim();
  }

  const firstsOf = (packages: Record<string, unknown[]>) => Object.values(packages).map(v => v[0]);

  const sha = (n: number) => Buffer.alloc(39, "0").toString() + n;

  test.concurrent("git hosts round-trip (B1, github: parity)", async () => {
    const dependencies = {
      a: "github:user/a",
      c: "git+https://github.com/user/c.git",
      d: "user/d#v1",
      e: "git+https://gitlab.com/user/e.git",
      f: "git+ssh://git@github.com/user/f.git",
    };
    using dir = synthetic("npm-migrate-git-hosts", {
      "package.json": JSON.stringify({ name: "git-hosts", dependencies }),
      "package-lock.json": JSON.stringify({
        name: "git-hosts",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "git-hosts", dependencies },
          "node_modules/a": { version: "1.0.0", resolved: `git+ssh://git@github.com/user/a.git#${sha(1)}` },
          "node_modules/c": { version: "1.0.0", resolved: `git+https://github.com/user/c.git#${sha(3)}` },
          "node_modules/d": { version: "1.0.0", resolved: `git+ssh://git@github.com/user/d.git#${sha(4)}` },
          "node_modules/e": { version: "1.0.0", resolved: `git+https://gitlab.com/user/e.git#${sha(5)}` },
          "node_modules/f": { version: "1.0.0", resolved: `git+ssh://git@github.com/user/f.git#${sha(6)}` },
        },
      }),
    });

    const { text, lock } = await migrate(dir);
    expect(lock.packages.a[0]).toBe(`a@github:user/a#${sha(1)}`);
    expect(lock.packages.c[0]).toBe(`c@github:user/c#${sha(3)}`);
    expect(lock.packages.d[0]).toBe(`d@github:user/d#${sha(4)}`);
    expect(lock.packages.e[0]).toBe(`e@git+https://gitlab.com/user/e.git#${sha(5)}`);
    expect(lock.packages.f[0]).toBe(`f@git+ssh://git@github.com/user/f.git#${sha(6)}`);
    expect(text).not.toContain("git+user/");
    await frozen(dir);
  });

  test.concurrent("root bundleDependencies keeps its subtree (B2)", async () => {
    using dir = fixture("testing-rebuild-bundle-a");
    const { text, lock } = await migrate(dir);
    expect(lock.packages["@isaacs/testing-rebuild-bundle-b"][0]).toBe("@isaacs/testing-rebuild-bundle-b@1.0.1");
    expect(lock.workspaces[""].dependencies).toStrictEqual({ "@isaacs/testing-rebuild-bundle-b": "" });
    expect(text).not.toContain('"bundled"');
    await frozen(dir);
  });

  test.concurrent("root bundle with cyclic bundled contents (B2)", async () => {
    using dir = fixture("bundle-metadep-duplication-x");
    const before = await pmHash(dir);
    const { text, lock } = await migrate(dir);
    expect(Object.keys(lock.packages).sort()).toStrictEqual(
      [
        "@isaacs/bundle-metadep-duplication-a",
        "@isaacs/bundle-metadep-duplication-y",
        "@isaacs/bundle-metadep-duplication-z",
      ].sort(),
    );
    expect(text).not.toContain('"bundled"');
    expect(await pmHash(dir)).toBe(before);
    await frozen(dir);
  });

  test.concurrent("workspace bundleDependencies are plain edges (B2 variant)", async () => {
    const a = { name: "a", version: "1.0.0", dependencies: { abbrev: "1.1.1" }, bundleDependencies: ["abbrev"] };
    using dir = synthetic("npm-migrate-ws-bundle", {
      "package.json": JSON.stringify({ name: "ws-bundle", workspaces: ["packages/a"] }),
      "packages/a/package.json": JSON.stringify(a),
      "package-lock.json": JSON.stringify({
        name: "ws-bundle",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "ws-bundle", workspaces: ["packages/a"] },
          "node_modules/a": { resolved: "packages/a", link: true },
          "node_modules/abbrev": {
            version: "1.1.1",
            resolved: "https://registry.npmjs.org/abbrev/-/abbrev-1.1.1.tgz",
            integrity:
              "sha512-nne9/IiQ/hzIhY6pdDnbBtz7DjPTKrY00P/zvPSm5pOFkl6xuGrGnXn/VtTNNfNtAfZ9/1RtehkszU9qcTii0Q==",
            inBundle: true,
          },
          "packages/a": { version: "1.0.0", dependencies: { abbrev: "1.1.1" }, bundleDependencies: ["abbrev"] },
        },
      }),
    });

    const { text, lock } = await migrate(dir);
    expect(lock.packages.abbrev[0]).toBe("abbrev@1.1.1");
    expect(lock.workspaces["packages/a"].dependencies).toStrictEqual({ abbrev: "1.1.1" });
    expect(text).not.toContain('"bundled"');
    await frozen(dir);
  });

  test.concurrent("root bundleDependencies: true still injects workspaces (B10)", async () => {
    using dir = synthetic("npm-migrate-b10", {
      "package.json": JSON.stringify({
        name: "b10",
        workspaces: ["packages/w"],
        dependencies: { x: "1.0.0" },
        bundleDependencies: true,
      }),
      "packages/w/package.json": JSON.stringify({ name: "w", version: "1.0.0" }),
      "package-lock.json": JSON.stringify({
        name: "b10",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "b10", workspaces: ["packages/w"], dependencies: { x: "1.0.0" }, bundleDependencies: true },
          "node_modules/w": { resolved: "packages/w", link: true },
          "packages/w": { version: "1.0.0" },
          "node_modules/x": { version: "1.0.0", inBundle: true },
        },
      }),
    });

    const { text, lock } = await migrate(dir);
    expect(lock.packages.w).toStrictEqual(["w@workspace:packages/w"]);
    expect(lock.workspaces[""].dependencies).toStrictEqual({ x: "1.0.0" });
    expect(lock.packages.x[0]).toBe("x@1.0.0");
    expect(text).not.toContain('"bundled"');
    await frozen(dir);
  });

  test.concurrent("lockfileVersion 1 is a warning, not a fatal error (B3)", async () => {
    {
      using dir = fixture("old-package-lock");
      const { stderr, exitCode } = await run(dir, "pm", "migrate");
      expect(stderr).toContain("lockfileVersion 1");
      expect(stderr).toContain("--lockfile-version=3");
      expect(stderr).not.toContain("Please upgrade");
      expect(exitCode).toBe(1);
    }
    {
      using dir = synthetic("npm-migrate-v1-install", {
        "package.json": JSON.stringify({ name: "v1", dependencies: { "dep-1": "file:dep-1" } }),
        "dep-1/package.json": JSON.stringify({ name: "dep-1" }),
        "package-lock.json": JSON.stringify({ lockfileVersion: 1, requires: true, dependencies: {} }),
      });
      const { stderr, exitCode } = await run(dir, "install");
      expect(stderr).toContain("lockfileVersion 1");
      expect(exitCode).toBe(0);
      expect(fs.existsSync(join(String(dir), "bun.lock"))).toBeTrue();
      expect(fs.existsSync(join(String(dir), "node_modules", "dep-1", "package.json"))).toBeTrue();
    }
  });

  test.concurrent("lockfileVersion 4 is accepted (B3)", async () => {
    const src = join(NPM, "workspaces-with-overrides");
    const packageLock = JSON.parse(fs.readFileSync(join(src, "package-lock.json"), "utf8"));
    packageLock.lockfileVersion = 4;
    packageLock.packages["node_modules/arg"].patched = { "patches/arg.patch": "sha512-x" };
    using dir = synthetic("npm-migrate-v4", {
      "package.json": fs.readFileSync(join(src, "package.json"), "utf8"),
      "ws/package.json": fs.readFileSync(join(src, "ws", "package.json"), "utf8"),
      "package-lock.json": JSON.stringify(packageLock),
    });

    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain("npm patches for 1 package");
    expect(lock.overrides).toStrictEqual({ arg: "4.1.3" });
    expect(lock.packages.arg[0]).toBe("arg@4.1.3");
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "dist-tag and empty specs without resolved use the registry (B4) and duplicate groups collapse (B5)",
    async () => {
      using dir = fixture("testing-rebuild-script-env-flags");
      const before = await pmHash(dir);
      const { text, lock } = await migrate(dir);
      expect(text).not.toContain("file:node_modules");
      const root = lock.workspaces[""];
      expect(root.dependencies).toBeUndefined();
      expect(root.optionalDependencies).toStrictEqual({ optdep: "1.0.0" });
      expect(root.devDependencies).toStrictEqual({ devdep: "1.0.0" });
      expect(lock.packages.devdep[0]).toBe("devdep@1.0.0");
      expect(lock.packages.devdep[2]).toStrictEqual({
        dependencies: { devopt: "" },
        optionalDependencies: { "opt-and-dev": "" },
      });
      expect(Object.keys(lock.packages).sort()).toStrictEqual(["devdep", "devopt", "opt-and-dev", "optdep"]);
      expect(await pmHash(dir)).toBe(before);
      await frozen(dir);
    },
  );

  test.concurrent("root duplicate groups and optional peer meta match a fresh parse (B5, B8)", async () => {
    using dir = fixture("edit-package-json-ok");
    const { lock } = await migrate(dir);
    const root = lock.workspaces[""];
    expect(root.dependencies).toStrictEqual({ abbrev: "^1.1.1" });
    expect(root.optionalDependencies).toStrictEqual({ "json-parse-even-better-errors": "" });
    expect(root.devDependencies).toStrictEqual({ walden: "" });
    expect(root.peerDependencies).toStrictEqual({ once: "", semver: "" });
    expect(root.optionalPeers).toStrictEqual(["semver"]);
    await frozen(dir);
  });

  test.concurrent("file: specs into a registry package's folder (B4)", async () => {
    const src = join(NPM, "external-link-dep");
    using base = tempDir("npm-migrate-external-link-dep", {
      "proj/package.json": fs.readFileSync(join(src, "package.json"), "utf8"),
      "proj/package-lock.json": fs.readFileSync(join(src, "package-lock.json"), "utf8"),
      "proj/bunfig.toml": OFFLINE_BUNFIG,
      "cli-750/package.json": '{"name":"monorepo"}',
    });
    const dir = join(String(base), "proj");

    const { text, lock } = await migrate(dir);
    for (const key of ["aaaaaa", "abbrev", "zzzzzz"]) {
      expect(lock.packages[key][0]).toBe("abbrev@https://registry.npmjs.org/abbrev/-/abbrev-1.1.1.tgz");
    }
    expect(lock.packages.monorepo[0]).toBe("monorepo@file:../cli-750");
    expect(text).not.toContain("file:https://");
    await frozen(dir);
  });

  test.concurrent(
    "unreferenced entries are skipped with a warning (B6) and github shorthand keeps github: form",
    async () => {
      using dir = fixture("minimist-git-metadep");
      const { stderr, exitCode, lock } = await migrate(dir);
      expect(stderr).toContain("not depended on by any package");
      expect(stderr).toContain('"node_modules/@isaacs/no-thing-here"');
      expect(lock.packages.minimist[0]).toBe(
        "minimist@github:substack/minimist#3754568bfd43a841d2d72d7fb54598635aea8fa4",
      );
      expect(lock.packages["@isaacs/minimist-git-dep"][0]).toBe("@isaacs/minimist-git-dep@1.0.0");
      expect(exitCode).toBe(0);
      await frozen(dir);
    },
  );

  test.concurrent("out-of-tree link targets and their node_modules (B6, walk)", async () => {
    using dir = fixture("external-link-root");
    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain('"../a"');
    expect(stderr).toContain('"../i"');
    expect(stderr).toContain('"../m"');
    expect(lock.packages.j[0]).toBe("j@file:../i/j");
    expect(lock.packages.j[1]).toStrictEqual({ dependencies: { k: "" } });
    expect(lock.packages.x[0]).toBe("x@1.0.0");
    const firsts = firstsOf(lock.packages);
    expect(firsts).toContain("k@1.0.0");
    expect(firsts).toContain("b@file:../a/node_modules/b");
    expect(firsts).toContain("c@1.0.0");
    expect(firsts).toContain("o@file:../m/node_modules/n/o");
    expect(exitCode).toBe(0);
  });

  test.concurrent("optional peer that is present keeps optionalPeers (B8)", async () => {
    using dir = fixture("prune-lockfile-optional-peer");
    const { lock } = await migrate(dir);
    expect(lock.packages.dedent[2]).toStrictEqual({
      peerDependencies: { "babel-plugin-macros": "^3.1.0" },
      optionalPeers: ["babel-plugin-macros"],
    });
    expect(lock.packages["babel-plugin-macros"][0]).toBe("babel-plugin-macros@3.1.0");
    await frozen(dir);
  });

  test.concurrent("dependency-level bundles use bundled: true (B9) and same-version copies dedupe (B7)", async () => {
    const B = "@isaacs/testing-bundledeps";
    using dir = fixture("testing-bundledeps-sw");
    const before = await pmHash(dir);
    const { lock } = await migrate(dir);
    expect(lock.packages[B][2].dependencies).toStrictEqual({ [`${B}-a`]: "*", [`${B}-c`]: "*" });
    const nested = lock.packages[`${B}/${B}-a`];
    expect(nested[0]).toBe(`${B}-a@1.0.0`);
    expect(nested[2].bundled).toBe(true);
    expect(await pmHash(dir)).toBe(before);
    await frozen(dir);
  });

  test.concurrent("bundled entry without resolved (B9)", async () => {
    const A = "@isaacs/testing-rebuild-bundle-a";
    const Bn = "@isaacs/testing-rebuild-bundle-b";
    using dir = fixture("testing-rebuild-bundle-parent");
    const { lock } = await migrate(dir);
    expect(lock.packages[A][2].dependencies).toStrictEqual({ [Bn]: "" });
    const nested = lock.packages[`${A}/${Bn}`];
    expect(nested[0]).toBe(`${Bn}@1.0.1`);
    expect(nested[2].bundled).toBe(true);
    await frozen(dir);
  });

  test.concurrent("identical name@version at several paths becomes one package (B7)", async () => {
    using dir = fixture("carbonium");
    const before = await pmHash(dir);
    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).not.toContain("not depended on");
    expect(exitCode).toBe(0);
    expect(await pmHash(dir)).toBe(before);
    expect(firstsOf(lock.packages).filter(v => v === "eslint-visitor-keys@1.3.0")).toHaveLength(4);
    await frozen(dir);

    using fresh = fixture("carbonium");
    const result = await run(fresh, "install", "--frozen-lockfile", "--lockfile-only");
    expect(result.stderr).not.toContain("Ignoring lockfile");
    expect(result.exitCode).toBe(0);
    expect((await readLock(fresh)).lock.packages).toStrictEqual(lock.packages);
  });

  test.concurrent("overrides are carried into the migrated lockfile (#55)", async () => {
    using dir = fixture("workspaces-with-overrides");
    const { lock } = await migrate(dir);
    expect(lock.overrides).toStrictEqual({ arg: "4.1.3" });
    expect(lock.packages.arg[0]).toBe("arg@4.1.3");
    expect(lock.workspaces.ws.dependencies).toStrictEqual({ arg: "4.1.2" });
    await frozen(dir);
  });

  test.concurrent("workspace on disk but missing from a stale lockfile (#59)", async () => {
    using dir = fixture("workspaces-shared-deps-virtual", {
      "packages/d/package.json": '{"name":"d","version":"1.0.0"}',
    });
    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain('workspace "d"');
    expect(stderr).toContain("packages/d");
    expect(Object.keys(lock.workspaces).sort()).toStrictEqual(["", "packages/a", "packages/b", "packages/c"]);
    const firsts = firstsOf(lock.packages);
    expect(firsts).toContain("abbrev@1.1.1");
    expect(firsts).toContain("uuid@3.3.3");
    expect(firsts).toContain("once@1.4.0");
    expect(firsts).toContain("wrappy@1.0.2");
    expect(exitCode).toBe(0);

    const install = await run(dir, "install", "--lockfile-only");
    expect(install.exitCode).toBe(0);
    const { lock: updated } = await readLock(dir);
    expect(updated.workspaces["packages/d"]).toStrictEqual({ name: "d", version: "1.0.0" });
    expect(updated.packages).toStrictEqual(lock.packages);
  });

  test.concurrent("absent peer and optional targets keep their edges (#49, #52)", async () => {
    const dependencies = { once: "1.4.0", "has-opt": "1.0.0" };
    using dir = synthetic("npm-migrate-missing-targets", {
      "package.json": JSON.stringify({ name: "missing-targets", dependencies }),
      "package-lock.json": JSON.stringify({
        name: "missing-targets",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "missing-targets", dependencies },
          "node_modules/once": {
            version: "1.4.0",
            resolved: "https://registry.npmjs.org/once/-/once-1.4.0.tgz",
            peerDependencies: { wrappy: "1" },
          },
          "node_modules/has-opt": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/has-opt/-/has-opt-1.0.0.tgz",
            optionalDependencies: { fsevents: "^2" },
          },
        },
      }),
    });

    const { lock } = await migrate(dir);
    expect(lock.packages.once[2]).toStrictEqual({ peerDependencies: { wrappy: "1" }, optionalPeers: ["wrappy"] });
    expect(lock.packages["has-opt"][2]).toStrictEqual({ optionalDependencies: { fsevents: "^2" } });
    await frozen(dir);
  });

  test.concurrent("unsupported specs are skipped, not fatal (B11)", async () => {
    using dir = synthetic("npm-migrate-b11", {
      "package.json": JSON.stringify({ name: "b11", dependencies: { x: "1.0.0" } }),
      "package-lock.json": JSON.stringify({
        name: "b11",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "b11", dependencies: { x: "1.0.0" } },
          "node_modules/x": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/x/-/x-1.0.0.tgz",
            dependencies: { y: "catalog:", z: "ftp://example.invalid/z.tgz" },
          },
        },
      }),
    });

    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain('skipped "y@catalog:"');
    expect(stderr).toContain('skipped "z@ftp://example.invalid/z.tgz"');
    expect(lock.packages.x[2]).toStrictEqual({});
    expect(exitCode).toBe(0);
    await frozen(dir);
  });

  describe("regression guard", () => {
    // Snapshot matchers are unsupported inside a concurrent group, so these stay sequential.
    test.each([
      "workspaces-simple-virtual",
      "workspaces-top-level-link-virtual",
      "workspaces-shared-deps-virtual",
      "cli-750",
      "dedupe-lockfile",
      "update-exact-version",
      "peer-dep-cycle-with-sw",
      "testing-peer-deps-nested",
      "link-dep-lifecycle-scripts",
      "flow-outdated",
    ])("regression guard: %s migrates unchanged", async name => {
      using dir = fixture(name);
      const { text, exitCode } = await migrate(dir);
      expect(text).toMatchSnapshot();
      expect(exitCode).toBe(0);
      await frozen(dir);
    });
  });
});
