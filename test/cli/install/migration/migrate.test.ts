import { expect, setDefaultTimeout, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, pack, tempDirWithFiles, tmpdirSync } from "harness";
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
  const testDir = tempDirWithFiles(
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
    const testDir = tempDirWithFiles("migrate-folder-name", filePlatformFixture(name, folder, [], []));

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
  const testDir = tempDirWithFiles("migrate-tarball-platform", {
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

// npm records a `file:` link target's declared dependencies in the lockfile but does not
// install them, so for a link target that depends on its own name (or on another link
// target that depends back on it) there is no nested `<target>/node_modules/<name>` entry.
// Migration resolves such a dep through the root `node_modules/<name>` link, producing a
// folder package whose dependency graph reaches itself. The hoist pass must break that
// cycle; before this fix it re-enqueued the same subtree forever and the migration hung.
function folderLockfile(rootDeps: Record<string, string>, folders: Record<string, Record<string, string>>) {
  const packages: Record<string, unknown> = { "": { name: "root", dependencies: rootDeps } };
  const files: Record<string, string> = { "package.json": JSON.stringify({ name: "root", dependencies: rootDeps }) };
  for (const [name, dependencies] of Object.entries(folders)) {
    files[`${name}/package.json`] = JSON.stringify({ name, version: "1.0.0", dependencies });
    packages[name] = { version: "1.0.0", dependencies };
    packages[`node_modules/${name}`] = { resolved: name, link: true };
  }
  files["package-lock.json"] = JSON.stringify({ name: "root", lockfileVersion: 3, requires: true, packages });
  return files;
}

test.concurrent.each([
  ["depends on its own name", folderLockfile({ pkg: "file:pkg" }, { pkg: { pkg: "^1.0.0" } })],
  ["aliases its own name via npm:", folderLockfile({ pkg: "file:pkg" }, { pkg: { pkg: "npm:something@^1.0.0" } })],
  [
    "and another link target depend on each other",
    folderLockfile({ a: "file:a", b: "file:b" }, { a: { b: "^1.0.0" }, b: { a: "^1.0.0" } }),
  ],
])("package-lock.json migration terminates when a file: link target %s", async (_desc, files) => {
  const testDir = tempDirWithFiles("migrate-folder-cycle", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: testDir,
    stdout: "ignore",
    stderr: "pipe",
    // Without the fix the spawned process never exits; bound the wait so the assertion
    // below can report the hang instead of relying on the suite-level test timeout.
    timeout: 30_000,
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("migrated lockfile from package-lock.json");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
  expect(fs.existsSync(join(testDir, "bun.lock"))).toBeTrue();
  for (const name of Object.keys(JSON.parse(files["package.json"]).dependencies)) {
    expect(await Bun.file(join(testDir, "node_modules", name, "package.json")).json()).toHaveProperty("name", name);
  }

  // The bun.lock the migration wrote must round-trip through bun's own parser.
  const second = await install(testDir, "--frozen-lockfile");
  expect(second.stderr).not.toContain("Ignoring lockfile");
  expect(second.exitCode).toBe(0);
});

test.concurrent(
  "bun install terminates when a file: folder dependency declares a workspace:. self-reference",
  async () => {
    // https://github.com/oven-sh/bun/issues/25202
    // Same hoist cycle as the migration cases above, reached without a foreign lockfile:
    // `foo: workspace:.` inside the folder package resolves to the folder package itself
    // under a different name, so the hoist builder re-enqueued its own subtree forever.
    const testDir = tempDirWithFiles("install-folder-self-workspace", {
      "package.json": JSON.stringify({ name: "consumer", dependencies: { test: "file:dir1" } }),
      "dir1/package.json": JSON.stringify({ name: "test", version: "1.0.0", devDependencies: { foo: "workspace:." } }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: testDir,
      stdout: "ignore",
      stderr: "pipe",
      timeout: 30_000,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Saved lockfile");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
    expect(fs.existsSync(join(testDir, "bun.lock"))).toBeTrue();

    // The dep name (`foo`) differs from the package name (`test`), so the placement must
    // still reach bun.lock for the parser to resolve it on reload.
    const second = await install(testDir, "--frozen-lockfile");
    expect(second.stderr).not.toContain("Ignoring lockfile");
    expect(second.exitCode).toBe(0);
  },
);

test.concurrent("pnpm-lock.yaml migration does not platform-skip a regular file: folder dependency", async () => {
  // The pnpm migration copied the lockfile's `os`/`cpu` arrays into every package the
  // same way the npm one did. pnpm records them for any `packages:` entry whose manifest
  // declares them, so a `file:` folder dependency was silently dropped on a mismatch.
  const testDir = tempDirWithFiles("migrate-pnpm-folder-platform", {
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
