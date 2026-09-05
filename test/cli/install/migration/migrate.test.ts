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

test.concurrent(
  "migrated bun.lock with a nested-placed peer of a file: dependency round-trips --frozen-lockfile",
  async () => {
    // delta is a regular peer of gamma placed only as "gamma/delta"; listing it in optionalPeers too made reload drop the entry.
    await using testDir = tempDir("migrate-nested-peer-fixed-point", {
      "package.json": JSON.stringify({
        name: "sandbox",
        version: "1.0.0",
        workspaces: ["packages/ws-a"],
        dependencies: { gamma: "file:vendor/gamma" },
      }),
      "vendor/gamma/package.json": JSON.stringify({
        name: "gamma",
        version: "1.0.0",
        peerDependencies: { delta: "*" },
      }),
      "vendor/delta/package.json": JSON.stringify({ name: "delta", version: "2.0.0" }),
      "packages/ws-a/package.json": JSON.stringify({
        name: "ws-a",
        version: "0.1.0",
        dependencies: { delta: "file:../../vendor/delta" },
      }),
      // What `npm install --package-lock-only` produces for this tree.
      "package-lock.json": JSON.stringify({
        name: "sandbox",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name: "sandbox",
            version: "1.0.0",
            dependencies: { gamma: "file:vendor/gamma" },
            workspaces: ["packages/ws-a"],
          },
          "node_modules/gamma": { resolved: "vendor/gamma", link: true },
          "vendor/gamma": { name: "gamma", version: "1.0.0", peerDependencies: { delta: "*" } },
          "node_modules/delta": { resolved: "vendor/delta", link: true },
          "vendor/delta": { name: "delta", version: "2.0.0" },
          "node_modules/ws-a": { resolved: "packages/ws-a", link: true },
          "packages/ws-a": { name: "ws-a", version: "0.1.0", dependencies: { delta: "file:../../vendor/delta" } },
        },
      }),
    });

    const first = await install(testDir);
    expect(first.stderr).toContain("migrated lockfile from package-lock.json");
    expect(first.exitCode).toBe(0);

    const lock = await Bun.file(join(testDir, "bun.lock")).text();
    expect(lock).toContain('"gamma/delta"');
    expect(lock).not.toContain("optionalPeers");

    const frozen = await install(testDir, "--frozen-lockfile");
    expect(frozen.stderr).not.toContain("lockfile had changes");
    expect(frozen.exitCode).toBe(0);

    // A plain re-install of the unchanged tree must not rewrite the lockfile.
    const second = await install(testDir);
    expect(second.exitCode).toBe(0);
    expect(await Bun.file(join(testDir, "bun.lock")).text()).toBe(lock);
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

// npm records a file: link target's own dependencies but never nests them, so a target that reaches its own name resolves through the root link and the hoist tree must cut the cycle.
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

test.concurrent.each<[string, Record<string, string>, string[]]>([
  ["depends on its own name", folderLockfile({ pkg: "file:pkg" }, { pkg: { pkg: "^1.0.0" } }), ["pkg"]],
  [
    "aliases its own name via npm:",
    folderLockfile({ pkg: "file:pkg" }, { pkg: { pkg: "npm:something@^1.0.0" } }),
    ["pkg"],
  ],
  [
    "and another link target depend on each other",
    folderLockfile({ a: "file:a", b: "file:b" }, { a: { b: "^1.0.0" }, b: { a: "^1.0.0" } }),
    ["a", "a/b", "b", "b/a"],
  ],
])("package-lock.json migration terminates when a file: link target %s", async (_desc, files, lockPackages) => {
  await using testDir = tempDir("migrate-folder-cycle", files);

  const first = await install(testDir);
  expect(first.stderr).toContain("migrated lockfile from package-lock.json");
  expect(first.exitCode).toBe(0);
  const lock = Bun.JSONC.parse(await Bun.file(join(testDir, "bun.lock")).text()) as {
    packages: Record<string, unknown>;
  };
  expect(Object.keys(lock.packages).sort()).toStrictEqual(lockPackages);
  for (const name of Object.keys(JSON.parse(files["package.json"]).dependencies)) {
    expect(await Bun.file(join(testDir, "node_modules", name, "package.json")).json()).toStrictEqual(
      JSON.parse(files[`${name}/package.json`]),
    );
  }

  // The bun.lock the migration wrote must round-trip through bun's own parser.
  const second = await install(testDir, "--frozen-lockfile");
  expect(second.stderr).not.toContain("Ignoring lockfile");
  expect(second.exitCode).toBe(0);
});

test.concurrent(
  "bun install terminates when a file: folder dependency declares a workspace:. self-reference (#25202)",
  async () => {
    // Same hoist cycle without a foreign lockfile; today a transitive workspace: range is resolved against the root project, so this errors instead of hanging.
    await using testDir = tempDir("install-folder-self-workspace", {
      "package.json": JSON.stringify({ name: "consumer", dependencies: { test: "file:dir1" } }),
      "dir1/package.json": JSON.stringify({ name: "test", version: "1.0.0", devDependencies: { foo: "workspace:." } }),
    });

    const { stderr, exitCode } = await install(testDir);
    expect(stderr).toContain('Workspace dependency "foo" not found');
    expect(stderr).toContain("foo@workspace:. failed to resolve");
    expect(exitCode).toBe(1);
    expect(fs.existsSync(join(testDir, "bun.lock"))).toBeFalse();
  },
);

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
  const ARBORIST = join(import.meta.dir, "npm-arborist");
  const arboristFixtures: { name: string; root?: string }[] = JSON.parse(
    fs.readFileSync(join(ARBORIST, "fixtures.json"), "utf8"),
  );
  // Port 1 refuses connections, so any accidental registry access fails the test.
  const OFFLINE_REGISTRY = "http://localhost:1/";
  const REGISTRY_PACKAGES = join(import.meta.dir, "..", "registry", "packages");

  function writeExtra(dir: string, extra: Record<string, string>, registry = OFFLINE_REGISTRY) {
    fs.writeFileSync(join(dir, "bunfig.toml"), `[install]\nregistry = "${registry}"\n`);
    for (const [name, contents] of Object.entries(extra)) {
      fs.mkdirSync(dirname(join(dir, name)), { recursive: true });
      fs.writeFileSync(join(dir, name), contents);
    }
  }

  // The project dir of a fixture copy; disposing removes the whole copy, including out-of-tree link targets.
  class FixtureDir extends String {
    constructor(
      dir: string,
      private copy: Disposable,
    ) {
      super(dir);
    }
    [Symbol.dispose]() {
      this.copy[Symbol.dispose]();
    }
  }

  function fixture(name: string, extra: Record<string, string> = {}) {
    const entry = arboristFixtures.find(f => f.name === name);
    if (!entry) throw new Error(`${name} is not listed in npm-arborist/fixtures.json`);
    const copy = tempDir("npm-migrate-" + name, join(ARBORIST, name));
    const dir = entry.root ? join(String(copy), entry.root) : String(copy);
    writeExtra(dir, extra);
    return new FixtureDir(dir, copy) as unknown as string & Disposable;
  }

  // Some arborist fixtures ship a package.json that disagrees with their lockfile, which --frozen-lockfile rejects.
  function manifestFromLockfile(name: string) {
    const lock = JSON.parse(fs.readFileSync(join(ARBORIST, name, "package-lock.json"), "utf8"));
    return JSON.stringify(lock.packages[""]);
  }

  function synthetic(name: string, files: Record<string, string>, registry = OFFLINE_REGISTRY) {
    const dir = tempDir(name, files);
    writeExtra(String(dir), {}, registry);
    return dir;
  }

  // Serves the verdaccio fixture packages from disk and records every path requested.
  function localRegistry() {
    const requests: string[] = [];
    let url = "";
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        requests.push(pathname);
        const tarball = pathname.match(/^\/([^/]+)\/-\/([^/]+\.tgz)$/);
        const file = tarball
          ? Bun.file(join(REGISTRY_PACKAGES, tarball[1], tarball[2]))
          : Bun.file(join(REGISTRY_PACKAGES, pathname.slice(1), "package.json"));
        if (!(await file.exists())) return new Response("not found", { status: 404 });
        if (tarball) return new Response(file);
        return Response.json(
          JSON.parse((await file.text()).replaceAll(/http:\/\/(?:http:\/\/)?localhost:4873\//g, url)),
        );
      },
    });
    url = `http://localhost:${server.port}/`;
    return {
      url,
      requests,
      tarball: (name: string, version: string) => `${url}${name}/-/${name}-${version}.tgz`,
      integrity: (name: string, version: string): string =>
        JSON.parse(fs.readFileSync(join(REGISTRY_PACKAGES, name, "package.json"), "utf8")).versions[version].dist
          .integrity,
      [Symbol.dispose]() {
        server.stop(true);
      },
    };
  }

  const npmLock = (name: string, packages: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ name, lockfileVersion: 3, requires: true, ...extra, packages: { "": { name }, ...packages } });

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

  // Minimal codeload-style tarball: a single root directory that wraps the
  // package contents. GitHub names it `<Owner>-<repo>-<short sha>`, which a
  // package-lock.json migration cannot know ahead of the download.
  function githubTarball(rootDir: string, files: Record<string, string>): Uint8Array {
    const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";
    const header = (name: string, size: number, type: "0" | "5") => {
      const buf = Buffer.alloc(512, 0);
      buf.write(name, 0, 100, "utf8");
      buf.write(octal(type === "5" ? 0o755 : 0o644, 8), 100); // mode
      buf.write(octal(0, 8), 108); // uid
      buf.write(octal(0, 8), 116); // gid
      buf.write(octal(size, 12), 124); // size
      buf.write(octal(0, 12), 136); // mtime
      buf.fill(" ", 148, 156); // checksum placeholder
      buf.write(type, 156);
      buf.write("ustar\0", 257);
      buf.write("00", 263);
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += buf[i];
      buf.write(octal(sum, 8), 148);
      return buf;
    };
    const chunks: Buffer[] = [header(`${rootDir}/`, 0, "5")];
    for (const [path, contents] of Object.entries(files)) {
      const body = Buffer.from(contents, "utf8");
      chunks.push(
        header(`${rootDir}/${path}`, body.length, "0"),
        body,
        Buffer.alloc((512 - (body.length % 512)) % 512),
      );
    }
    chunks.push(Buffer.alloc(1024));
    return Bun.gzipSync(Buffer.concat(chunks));
  }

  // #40489: a github: dependency migrated from package-lock.json was
  // downloaded and extracted, but never written to node_modules, and the
  // install still exited 0. The migrated bun-tag (the commit sha) never
  // matches the cache folder, which is named after the tarball's root
  // directory and only known after extraction.
  test.concurrent("github dependency from package-lock.json is installed (#40489)", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const rootDir = "User-repo-0123456";
    const tgz = githubTarball(rootDir, {
      "package.json": JSON.stringify({ name: "@scope/internal-name", version: "2.0.1" }),
      "index.js": "module.exports = 42;\n",
    });
    const requests: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname);
        return new Response(tgz, { headers: { "content-type": "application/gzip" } });
      },
    });
    const spec = `git+https://github.com/user/repo#${sha}`;
    using dir = synthetic("npm-migrate-github-install", {
      "package.json": JSON.stringify({ name: "gh-install", dependencies: { alias: spec } }),
      "package-lock.json": npmLock("gh-install", {
        "": { name: "gh-install", dependencies: { alias: spec } },
        "node_modules/alias": {
          name: "@scope/internal-name",
          version: "2.0.1",
          resolved: `git+ssh://git@github.com/user/repo.git#${sha}`,
        },
      }),
    });
    const install = async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: {
          ...bunEnv,
          BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
          GITHUB_API_URL: `http://localhost:${server.port}`,
        },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };

    const first = await install();
    expect(first.stderr).toContain("Saved lockfile");
    expect(first.stdout).toContain("1 package installed");
    expect(first.exitCode).toBe(0);
    expect(requests).toEqual([`/repos/user/repo/tarball/${sha}`]);
    const installed = JSON.parse(fs.readFileSync(join(String(dir), "node_modules/alias/package.json"), "utf8"));
    expect(installed.name).toBe("@scope/internal-name");

    // The saved lockfile keeps the migrated bun-tag (the commit sha), and the
    // cache folder is keyed by it, not by the archive's root directory name.
    const { lock } = await readLock(dir);
    expect(lock.packages.alias[0]).toBe(`@scope/internal-name@github:user/repo#${sha}`);
    expect(lock.packages.alias[2]).toBe(sha);

    // Reinstall from the saved bun.lock and the warm cache: no new download.
    fs.rmSync(join(String(dir), "node_modules"), { recursive: true, force: true });
    const second = await install();
    expect(second.stdout).toContain("1 package installed");
    expect(second.exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    expect(fs.existsSync(join(String(dir), "node_modules/alias/index.js"))).toBeTrue();
  });

  test.concurrent("root bundleDependencies keeps its subtree (B2)", async () => {
    using dir = fixture("testing-rebuild-bundle--a");
    const { text, lock } = await migrate(dir);
    expect(lock.packages["@isaacs/testing-rebuild-bundle-b"][0]).toBe("@isaacs/testing-rebuild-bundle-b@1.0.1");
    expect(lock.workspaces[""].dependencies).toStrictEqual({ "@isaacs/testing-rebuild-bundle-b": "" });
    expect(text).not.toContain('"bundled"');
    await frozen(dir);
  });

  test.concurrent("root bundle with cyclic bundled contents (B2)", async () => {
    using dir = fixture("bundle-metadep-duplication--x", {
      "package.json": manifestFromLockfile("bundle-metadep-duplication--x"),
    });
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
      expect(stderr).toBe(
        "error: package-lock.json is lockfileVersion 1, which bun cannot migrate\nnote: npm install --package-lock-only --lockfile-version=3\n",
      );
      expect(exitCode).toBe(1);
    }
    {
      using dir = synthetic("npm-migrate-v1-install", {
        "package.json": JSON.stringify({ name: "v1", dependencies: { "dep-1": "file:dep-1" } }),
        "dep-1/package.json": JSON.stringify({ name: "dep-1" }),
        "package-lock.json": JSON.stringify({ lockfileVersion: 1, requires: true, dependencies: {} }),
      });
      const { stderr, exitCode } = await run(dir, "install");
      expect(stderr).toContain(
        "warn: package-lock.json is lockfileVersion 1, which bun cannot migrate; resolving from package.json instead\nnote: npm install --package-lock-only --lockfile-version=3\n",
      );
      expect(stderr).not.toContain("failed to migrate");
      expect(exitCode).toBe(0);
      expect(fs.existsSync(join(String(dir), "bun.lock"))).toBeTrue();
      expect(fs.existsSync(join(String(dir), "node_modules", "dep-1", "package.json"))).toBeTrue();
    }
  });

  test.concurrent("lockfileVersion 4 is accepted (B3)", async () => {
    const src = join(ARBORIST, "workspaces-with-overrides");
    const packageLock = JSON.parse(fs.readFileSync(join(src, "package-lock.json"), "utf8"));
    packageLock.lockfileVersion = 4;
    packageLock.packages["node_modules/arg"].patched = { "patches/arg.patch": "sha512-x" };
    using dir = synthetic("npm-migrate-v4", {
      "package.json": fs.readFileSync(join(src, "package.json"), "utf8"),
      "ws/package.json": fs.readFileSync(join(src, "ws", "package.json"), "utf8"),
      "package-lock.json": JSON.stringify(packageLock),
    });

    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain('warn: skipped npm patches for "arg" from package-lock.json\nnote: bun patch <pkg>\n');
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
    using dir = fixture("edit-package-json--ok");
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
    using dir = fixture("external-link-dep");
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
    using dir = fixture("external-link--root");
    const { stderr, exitCode, text, lock } = await migrate(dir);
    expect(stderr).toContain(
      'skipped "p" from package-lock.json: transitive folder dependency "../m/node_modules/p" is outside the project',
    );
    expect(stderr).toContain(
      'skipped "b" from package-lock.json: transitive folder dependency "../a/node_modules/b" is outside the project',
    );
    expect(stderr).toContain(
      'skipped 3 package-lock.json entries not depended on by any package: "../a", "../i", "../m"',
    );
    const registry = (name: string) => `${OFFLINE_REGISTRY}${name}/-/${name}-1.0.0.tgz`;
    // Root-declared out-of-tree folders (j, o, o2) and registry entries under them (k) migrate; transitive out-of-tree folders (p, b) are skipped along with their edges and their own subtree (c).
    expect(
      Object.fromEntries(Object.entries<any[]>(lock.packages).map(([key, v]) => [key, [v[0], v[1]]])),
    ).toStrictEqual({
      j: ["j@file:../i/j", { dependencies: { k: "" } }],
      k: ["k@1.0.0", registry("k")],
      o: ["o@file:../m/node_modules/n/o", {}],
      o2: ["o2@file:../m/node_modules/n/o2", {}],
      x: ["x@1.0.0", registry("x")],
    });
    expect(lock.packages.x[2]).toStrictEqual({});
    expect(text).not.toContain("../m/node_modules/p");
    expect(text).not.toContain("../a/node_modules/b");
    expect(exitCode).toBe(0);
    await frozen(dir);
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
    using dir = fixture("testing-rebuild-bundle--parent");
    const { lock } = await migrate(dir);
    expect(lock.packages[A][2].dependencies).toStrictEqual({ [Bn]: "" });
    const nested = lock.packages[`${A}/${Bn}`];
    expect(nested[0]).toBe(`${Bn}@1.0.1`);
    expect(nested[2].bundled).toBe(true);
    await frozen(dir);
  });

  test.concurrent("a bundled copy reached first does not lose the registry copy's integrity (B7, B9)", async () => {
    const B = "@isaacs/testing-bundledeps";
    using dir = fixture("two-bundled-deps");
    const npmLock = JSON.parse(fs.readFileSync(join(ARBORIST, "two-bundled-deps", "package-lock.json"), "utf8"));
    const { integrity } = npmLock.packages[`node_modules/${B}-b`];
    const { lock } = await migrate(dir);
    // `${B}-a` (bundled) reaches its nested `${B}-b` before `${B}-c` reaches the hoisted registry one.
    const b = [`${B}-b@1.0.0`, "", {}, integrity];
    expect(lock.packages[`${B}-b`]).toStrictEqual(b);
    expect(lock.packages[`${B}/${B}-b`]).toStrictEqual(b);
    expect(lock.packages[`${B}/${B}-a`][2]).toStrictEqual({ dependencies: { [`${B}-b`]: "*" }, bundled: true });
  });

  test.concurrent("identical name@version at several paths becomes one package (B7)", async () => {
    using dir = fixture("carbonium");
    const before = await pmHash(dir);
    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).not.toContain("not depended on");
    expect(exitCode).toBe(0);
    expect(await pmHash(dir)).toBe(before);
    // npm nested four copies of 1.3.0; bun keeps one package and hoists it (2.0.0 stays under eslint).
    expect(
      Object.entries<any[]>(lock.packages)
        .filter(([, v]) => v[0].startsWith("eslint-visitor-keys@"))
        .map(([key, v]) => [key, v[0]]),
    ).toStrictEqual([
      ["eslint-visitor-keys", "eslint-visitor-keys@1.3.0"],
      ["eslint/eslint-visitor-keys", "eslint-visitor-keys@2.0.0"],
    ]);
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
    const { d, ...rest } = updated.packages;
    expect(d).toStrictEqual(["d@workspace:packages/d"]);
    // "" means the registry.npmjs.org tarball; a re-save under a different configured registry spells it out.
    for (const entry of Object.values(rest) as unknown[][]) {
      if (typeof entry[1] === "string" && entry[1].startsWith(OFFLINE_REGISTRY)) entry[1] = "";
    }
    expect(rest).toStrictEqual(lock.packages);
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

  const linkers = ["hoisted", "isolated"] as const;

  function storeEntries(dir: string) {
    const store = join(dir, "node_modules", ".bun");
    if (!fs.existsSync(store)) return [];
    return fs
      .readdirSync(store)
      .filter(n => !n.startsWith(".") && n !== "node_modules")
      .sort();
  }

  test.concurrent.each(linkers)("bundled: true edges install from the parent tarball (B9, %s)", async linker => {
    using registry = localRegistry();
    const dependencies = { "bundled-1": "1.0.0" };
    using dir = synthetic(
      `npm-migrate-bundled-install-${linker}`,
      {
        "package.json": JSON.stringify({ name: "bundled-install", dependencies }),
        "package-lock.json": npmLock("bundled-install", {
          "": { name: "bundled-install", dependencies },
          "node_modules/bundled-1": {
            version: "1.0.0",
            resolved: registry.tarball("bundled-1", "1.0.0"),
            dependencies: { "no-deps": "1.0.0" },
            bundleDependencies: ["no-deps"],
          },
          "node_modules/bundled-1/node_modules/no-deps": { version: "1.0.0", inBundle: true },
        }),
      },
      registry.url,
    );

    const { stderr, exitCode } = await run(dir, "install", "--linker", linker);
    expect(stderr).toContain("migrated lockfile from package-lock.json");
    expect(exitCode).toBe(0);
    const { lock } = await readLock(dir);
    expect(lock.packages["bundled-1"][2]).toStrictEqual({ dependencies: { "no-deps": "1.0.0" } });
    expect(lock.packages["bundled-1/no-deps"]).toStrictEqual([
      "no-deps@1.0.0",
      registry.tarball("no-deps", "1.0.0"),
      { bundled: true },
      "",
    ]);
    expect(
      await Bun.file(join(String(dir), "node_modules", "bundled-1", "node_modules", "no-deps", "package.json")).json(),
    ).toStrictEqual({ name: "no-deps", version: "1.0.0" });
    expect(registry.requests).toStrictEqual(["/bundled-1/-/bundled-1-1.0.0.tgz"]);
    expect(storeEntries(String(dir))).toStrictEqual(linker === "isolated" ? ["bundled-1@1.0.0"] : []);
    await frozen(dir);
  });

  test.concurrent(
    "workspace listing a dependency in dependencies and optionalDependencies matches a fresh resolve",
    async () => {
      using registry = localRegistry();
      const w = {
        name: "w",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
        optionalDependencies: { "no-deps": "1.0.0" },
      };
      const files = {
        "package.json": JSON.stringify({ name: "ws-dups", workspaces: ["packages/w"] }),
        "packages/w/package.json": JSON.stringify(w),
      };
      using dir = synthetic(
        "npm-migrate-ws-optional-dup",
        {
          ...files,
          "package-lock.json": npmLock("ws-dups", {
            "": { name: "ws-dups", workspaces: ["packages/w"] },
            "node_modules/no-deps": {
              version: "1.0.0",
              resolved: registry.tarball("no-deps", "1.0.0"),
              integrity: registry.integrity("no-deps", "1.0.0"),
            },
            "node_modules/w": { resolved: "packages/w", link: true },
            "packages/w": {
              version: "1.0.0",
              dependencies: w.dependencies,
              optionalDependencies: w.optionalDependencies,
            },
          }),
        },
        registry.url,
      );
      const { lock } = await migrate(dir);
      await frozen(dir);

      using freshDir = synthetic("npm-migrate-ws-optional-dup-fresh", files, registry.url);
      const fresh = await run(freshDir, "install", "--lockfile-only");
      expect(fresh.exitCode).toBe(0);
      const { lock: freshLock } = await readLock(freshDir);
      expect(lock.workspaces).toStrictEqual(freshLock.workspaces);
      expect(lock.packages).toStrictEqual(freshLock.packages);
    },
  );

  // A workspace whose ranges link to sibling workspaces (`^1.0.0` on a versioned one, `*` on a
  // versionless one) is unchanged by the migration, so its registry pins survive the install that
  // migrates and every install after it. A changed workspace would re-resolve `no-deps@^1.0.0` to 1.1.0.
  test.concurrent("workspace ranges that link to sibling workspaces keep the migrated pins", async () => {
    using registry = localRegistry();
    const a = { name: "a", version: "1.0.0", dependencies: { b: "^1.0.0", c: "*", "no-deps": "^1.0.0" } };
    using dir = synthetic(
      "npm-migrate-ws-links",
      {
        "package.json": JSON.stringify({ name: "ws-links", workspaces: ["packages/*"] }),
        "packages/a/package.json": JSON.stringify(a),
        "packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
        "packages/c/package.json": JSON.stringify({ name: "c" }),
        "package-lock.json": npmLock("ws-links", {
          "": { name: "ws-links", workspaces: ["packages/*"] },
          "node_modules/a": { resolved: "packages/a", link: true },
          "node_modules/b": { resolved: "packages/b", link: true },
          "node_modules/c": { resolved: "packages/c", link: true },
          "node_modules/no-deps": {
            version: "1.0.0",
            resolved: registry.tarball("no-deps", "1.0.0"),
            integrity: registry.integrity("no-deps", "1.0.0"),
          },
          "packages/a": a,
          "packages/b": { name: "b", version: "1.0.0" },
          "packages/c": { name: "c" },
        }),
      },
      registry.url,
    );

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from package-lock.json");
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
      name: "no-deps",
      version: "1.0.0",
    });
    expect(registry.requests).toStrictEqual(["/no-deps/-/no-deps-1.0.0.tgz"]);

    const second = await run(dir, "install");
    expect(second.stdout).toContain("(no changes)");
    expect(second.exitCode).toBe(0);
    expect(registry.requests).toStrictEqual(["/no-deps/-/no-deps-1.0.0.tgz"]);
  });

  test.concurrent(
    "a registry entry naming a dep in dependencies and peerDependencies keeps one edge; the root keeps both",
    async () => {
      const root = { name: "peer-dups", dependencies: { x: "1.0.0", z: "1.0.0" }, peerDependencies: { z: "1.0.0" } };
      using dir = synthetic("npm-migrate-peer-dups", {
        "package.json": JSON.stringify(root),
        "package-lock.json": npmLock("peer-dups", {
          "": root,
          "node_modules/x": { version: "1.0.0", dependencies: { y: "1.0.0" }, peerDependencies: { y: "1.0.0" } },
          "node_modules/y": { version: "1.0.0" },
          "node_modules/z": { version: "1.0.0" },
        }),
      });
      const { lock } = await migrate(dir);
      expect(lock.packages.x[2]).toStrictEqual({ dependencies: { y: "1.0.0" } });
      expect(lock.workspaces[""]).toStrictEqual(root);
      await frozen(dir);
    },
  );

  test.concurrent(
    "a ranged peer npm satisfied with a lower version migrates to the tree a fresh resolve writes",
    async () => {
      // npm satisfied peer-deps-fixed's `no-deps@^1.0.0` with the 1.0.0 it hoisted. bun binds such a
      // peer to the highest satisfying version in the lockfile (1.0.1) whenever it loads bun.lock, and
      // peer-deps-fixed, a devDependency, hoists before the root's dependencies: a migrated tree
      // built from npm's binding would key 1.0.0 at the root and be rebuilt with 1.0.1 there by the
      // first install that loads it.
      using registry = localRegistry();
      const entry = (name: string, version: string, info: Record<string, unknown> = {}) => ({
        version,
        resolved: registry.tarball(name, version),
        integrity: registry.integrity(name, version),
        ...info,
      });
      const root = {
        name: "ranged-peer",
        dependencies: { "one-dep": "1.0.0", "one-fixed-dep": "1.0.0" },
        devDependencies: { "peer-deps-fixed": "1.0.0" },
      };
      using dir = synthetic(
        "npm-migrate-ranged-peer",
        {
          "package.json": JSON.stringify(root),
          "package-lock.json": npmLock("ranged-peer", {
            "": root,
            "node_modules/no-deps": entry("no-deps", "1.0.0"),
            "node_modules/one-dep": entry("one-dep", "1.0.0", { dependencies: { "no-deps": "1.0.1" } }),
            "node_modules/one-dep/node_modules/no-deps": entry("no-deps", "1.0.1"),
            "node_modules/one-fixed-dep": entry("one-fixed-dep", "1.0.0", { dependencies: { "no-deps": "1.0.0" } }),
            "node_modules/peer-deps-fixed": entry("peer-deps-fixed", "1.0.0", {
              dev: true,
              peerDependencies: { "no-deps": "^1.0.0" },
            }),
          }),
        },
        registry.url,
      );
      const { lock } = await migrate(dir);
      expect(lock.packages["no-deps"][0]).toBe("no-deps@1.0.1");
      expect(lock.packages["one-fixed-dep/no-deps"][0]).toBe("no-deps@1.0.0");
      await frozen(dir);

      using freshDir = synthetic(
        "npm-migrate-ranged-peer-fresh",
        { "package.json": JSON.stringify(root) },
        registry.url,
      );
      const fresh = await run(freshDir, "install", "--lockfile-only");
      expect(fresh.exitCode).toBe(0);
      const { lock: freshLock } = await readLock(freshDir);
      expect(lock.packages).toStrictEqual(freshLock.packages);
    },
  );

  test.concurrent("workspace listed in the lockfile but deleted from disk is skipped", async () => {
    const src = join(ARBORIST, "workspaces-simple-virtual");
    const packageLock = JSON.parse(fs.readFileSync(join(src, "package-lock.json"), "utf8"));
    delete packageLock.packages.a.dependencies;
    using dir = fixture("workspaces-simple-virtual", {
      "package.json": JSON.stringify({ name: "workspace-simple", workspaces: ["a"] }),
      "a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
      "package-lock.json": JSON.stringify(packageLock),
    });
    fs.rmSync(join(String(dir), "b"), { recursive: true });

    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain('skipped 1 package-lock.json entry not depended on by any package: "b"');
    expect(exitCode).toBe(0);
    expect(lock.workspaces).toStrictEqual({
      "": { name: "workspace-simple" },
      a: { name: "a", version: "1.0.0" },
    });
    expect(lock.packages).toStrictEqual({ a: ["a@workspace:a"] });
    await frozen(dir);
  });

  const overridesFixture = (rootFields: Record<string, unknown>, extra: Record<string, string> = {}) =>
    fixture("workspaces-with-overrides", {
      "package.json": JSON.stringify({ name: "workspace-with-overrides", workspaces: ["ws"], ...rootFields }),
      ...extra,
    });

  test.concurrent("yarn-style resolutions are carried into the migrated lockfile", async () => {
    using dir = overridesFixture({ resolutions: { arg: "4.1.3" } });
    const { lock } = await migrate(dir);
    expect(lock.overrides).toStrictEqual({ arg: "4.1.3" });
    expect(lock.packages.arg[0]).toBe("arg@4.1.3");
    await frozen(dir);
  });

  test.concurrent("a $ref override resolves through a workspace's dependencies", async () => {
    const packageLock = JSON.parse(
      fs.readFileSync(join(ARBORIST, "workspaces-with-overrides", "package-lock.json"), "utf8"),
    );
    packageLock.packages["node_modules/arg"] = {
      version: "4.1.2",
      resolved: "https://registry.npmjs.org/arg/-/arg-4.1.2.tgz",
    };
    using dir = overridesFixture({ overrides: { arg: "$arg" } }, { "package-lock.json": JSON.stringify(packageLock) });
    const { stderr, lock } = await migrate(dir);
    expect(stderr).not.toContain("Could not resolve");
    expect(lock.overrides).toStrictEqual({ arg: "4.1.2" });
    expect(lock.packages.arg[0]).toBe("arg@4.1.2");
    expect(lock.workspaces.ws.dependencies).toStrictEqual({ arg: "4.1.2" });
    await frozen(dir);
  });

  test.concurrent("nested and version-scoped overrides migrate into a lockfileVersion 3 bun.lock", async () => {
    using dir = overridesFixture({ overrides: { "arg@4": "4.1.3", ws: { arg: "4.1.3" } } });
    const { text, lock } = await migrate(dir);
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.overrides).toStrictEqual({ "arg@4": { ".": "4.1.3" }, ws: { arg: "4.1.3" } });
    expect(text).not.toContain("only supports one level");
    await frozen(dir);
  });

  test.concurrent("override warnings are printed after a successful migration", async () => {
    using dir = overridesFixture({ overrides: { arg: 5 } });
    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain('Invalid override value for "arg"');
    expect(stderr).toContain("migrated lockfile from package-lock.json");
    expect(lock.overrides).toBeUndefined();
    expect(exitCode).toBe(0);
  });

  // Folder dep `o` gets `p` from the node_modules beside it; `m` sits next to the project (external-link--root shape) or inside it.
  function folderLinkProject(name: string, opts: { outOfTree: boolean; directP?: boolean }) {
    const m = opts.outOfTree ? "../m" : "m";
    const project = opts.outOfTree ? "root" : ".";
    const dependencies: Record<string, string> = { o: `file:${m}/node_modules/n/o` };
    if (opts.directP) dependencies.p = `file:${m}/node_modules/p`;
    const copy = tempDir(name, {
      [`${project}/${m}/node_modules/n/o/package.json`]: JSON.stringify({
        name: "o",
        version: "1.0.0",
        dependencies: { p: "" },
      }),
      [`${project}/${m}/node_modules/n/o/index.js`]: `module.exports = require("p/package.json").name;`,
      [`${project}/${m}/node_modules/p/package.json`]: JSON.stringify({ name: "p", version: "1.0.0" }),
      [`${project}/package.json`]: JSON.stringify({ name: "root", dependencies }),
      [`${project}/package-lock.json`]: npmLock("root", {
        "": { name: "root", dependencies },
        [m]: {},
        [`${m}/node_modules/n/o`]: { version: "1.0.0", dependencies: { p: "" } },
        [`${m}/node_modules/p`]: {},
        "node_modules/o": { resolved: `${m}/node_modules/n/o`, link: true },
        ...(opts.directP ? { "node_modules/p": { resolved: `${m}/node_modules/p`, link: true } } : {}),
      }),
    });
    const dir = join(String(copy), project);
    writeExtra(dir, {});
    return {
      dir,
      o: `o@file:${m}/node_modules/n/o`,
      p: `p@file:${m}/node_modules/p`,
      oSource: join(dir, m, "node_modules", "n", "o"),
      [Symbol.dispose]() {
        copy[Symbol.dispose]();
      },
    };
  }

  async function expectFolderLinkInstalled(project: ReturnType<typeof folderLinkProject>, linker: string) {
    const install = await run(project.dir, "install", "--frozen-lockfile", "--linker", linker);
    expect(install.stderr).not.toContain("error");
    expect(install.exitCode).toBe(0);
    expect(fs.existsSync(join(project.oSource, "node_modules"))).toBeFalse();
    const resolve = await run(project.dir, "-e", `console.log(require("o"))`);
    expect(resolve.stdout).toBe("p\n");
    expect(resolve.exitCode).toBe(0);
    const storeName = (key: string) => key.replaceAll(/[/:]/g, "+");
    expect(storeEntries(project.dir)).toStrictEqual(
      linker === "isolated" ? [storeName(project.o), storeName(project.p)] : [],
    );
  }

  test.concurrent(
    "a link target reached both directly and through the find_target walk keeps only the direct entry",
    async () => {
      using project = folderLinkProject("npm-migrate-folder-link-direct", { outOfTree: true, directP: true });
      const { stderr, exitCode, lock } = await migrate(project.dir);
      // The root's own `p` is recorded; the copy `o` reaches through the walk is a transitive out-of-tree folder and is skipped even though it is the same target.
      expect(stderr).toContain(
        'skipped "p" from package-lock.json: transitive folder dependency "../m/node_modules/p" is outside the project',
      );
      expect(exitCode).toBe(0);
      expect(lock.packages).toStrictEqual({
        o: [project.o, {}],
        p: [project.p, {}],
      });
      await frozen(project.dir);
    },
  );

  test.concurrent.each(linkers)("in-tree link target and its node_modules install (%s)", async linker => {
    using project = folderLinkProject(`npm-migrate-folder-link-in-tree-${linker}`, { outOfTree: false });
    const { lock } = await migrate(project.dir);
    expect(lock.packages).toStrictEqual({
      o: [project.o, { dependencies: { p: "" } }],
      "o/p": [project.p, {}],
    });
    await frozen(project.dir);
    await expectFolderLinkInstalled(project, linker);
  });

  // A transitive folder target outside the project is skipped with a warning, so both linkers install the same lockfile.
  test.concurrent.each(linkers)("out-of-tree link target and its node_modules install (%s)", async linker => {
    using project = folderLinkProject(`npm-migrate-folder-link-out-of-tree-${linker}`, { outOfTree: true });
    const { stderr, exitCode, text, lock } = await migrate(project.dir);
    expect(stderr).toContain("../m/node_modules/p");
    expect(stderr).toContain("outside");
    expect(exitCode).toBe(0);
    expect(Object.keys(lock.packages)).toStrictEqual(["o"]);
    expect(lock.packages.o[0]).toBe(project.o);
    expect(text).not.toContain("../m/node_modules/p");

    const install = await run(project.dir, "install", "--linker", linker);
    expect(install.stderr).not.toContain("error");
    expect(install.exitCode).toBe(0);
    expect(await Bun.file(join(project.dir, "node_modules", "o", "package.json")).json()).toHaveProperty("name", "o");
    expect(fs.existsSync(join(project.dir, "node_modules", "o", "node_modules", "p"))).toBeFalse();
    expect(fs.existsSync(join(project.oSource, "node_modules"))).toBeFalse();
    expect(storeEntries(project.dir)).toStrictEqual(linker === "isolated" ? [project.o.replaceAll(/[/:]/g, "+")] : []);
  });

  test.concurrent("lockfileVersion 5 is refused, and install falls back to a fresh resolve", async () => {
    using dir = synthetic("npm-migrate-v5", {
      "package.json": JSON.stringify({ name: "v5", dependencies: { "dep-1": "file:dep-1" } }),
      "dep-1/package.json": JSON.stringify({ name: "dep-1" }),
      "package-lock.json": npmLock("v5", {}, { lockfileVersion: 5 }),
    });
    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toBe(
      "error: package-lock.json is lockfileVersion 5, which bun cannot migrate\nnote: npm install --package-lock-only --lockfile-version=3\n",
    );
    expect(exitCode).toBe(1);
    expect(fs.existsSync(join(String(dir), "bun.lock"))).toBeFalse();

    const install = await run(dir, "install");
    expect(install.stderr).toContain(
      "warn: package-lock.json is lockfileVersion 5, which bun cannot migrate; resolving from package.json instead\nnote: npm install --package-lock-only --lockfile-version=3\n",
    );
    expect(install.stderr).not.toContain("migrated lockfile");
    expect(install.stderr).not.toContain("failed to migrate");
    expect(install.exitCode).toBe(0);
    expect((await readLock(dir)).lock.packages["dep-1"]).toStrictEqual(["dep-1@file:dep-1", {}]);
    expect(fs.existsSync(join(String(dir), "node_modules", "dep-1", "package.json"))).toBeTrue();
  });

  test.concurrent.each([
    ["a string", { lockfileVersion: "3" }],
    ["missing", { lockfileVersion: undefined }],
  ])("lockfileVersion %s is an invalid lockfile, and install falls back to a fresh resolve", async (_, extra) => {
    using dir = synthetic("npm-migrate-bad-version", {
      "package.json": JSON.stringify({ name: "bad-version", dependencies: { "dep-1": "file:dep-1" } }),
      "dep-1/package.json": JSON.stringify({ name: "dep-1" }),
      "package-lock.json": npmLock("bad-version", {}, extra),
    });
    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("InvalidNPMLockfile");
    expect(stderr).not.toContain("migrated lockfile");
    expect(exitCode).toBe(0);
    expect((await readLock(dir)).lock.packages["dep-1"]).toStrictEqual(["dep-1@file:dep-1", {}]);
    expect(fs.existsSync(join(String(dir), "node_modules", "dep-1", "package.json"))).toBeTrue();
  });

  test.concurrent("several patched entries are listed in one warning", async () => {
    const dependencies = { x: "1.0.0", y: "1.0.0" };
    using dir = synthetic("npm-migrate-patched-plural", {
      "package.json": JSON.stringify({ name: "patched", dependencies }),
      "package-lock.json": npmLock("patched", {
        "": { name: "patched", dependencies },
        "node_modules/x": { version: "1.0.0", patched: { "patches/x.patch": "sha512-x" } },
        "node_modules/y": { version: "1.0.0", patched: { "patches/y.patch": "sha512-y" } },
      }),
    });
    const { stderr, lock } = await migrate(dir);
    expect(stderr).toContain('warn: skipped npm patches for "x", "y" from package-lock.json\nnote: bun patch <pkg>\n');
    expect(firstsOf(lock.packages)).toStrictEqual(["x@1.0.0", "y@1.0.0"]);
    expect(lock.patchedDependencies).toBeUndefined();
    await frozen(dir);
  });

  test.concurrent("bundleDependencies: false bundles nothing even when npm marked the child inBundle", async () => {
    const dependencies = { x: "1.0.0" };
    using dir = synthetic("npm-migrate-bundle-false", {
      "package.json": JSON.stringify({ name: "bundle-false", dependencies }),
      "package-lock.json": npmLock("bundle-false", {
        "": { name: "bundle-false", dependencies },
        "node_modules/x": { version: "1.0.0", dependencies: { y: "1.0.0" }, bundleDependencies: false },
        "node_modules/x/node_modules/y": { version: "1.0.0", inBundle: true },
      }),
    });
    const { text, lock } = await migrate(dir);
    expect(lock.packages.x[2]).toStrictEqual({ dependencies: { y: "1.0.0" } });
    expect(lock.packages.y[0]).toBe("y@1.0.0");
    expect(text).not.toContain('"bundled"');
    await frozen(dir);
  });

  test.concurrent("an empty bin object migrates as no bin", async () => {
    const dependencies = { x: "1.0.0" };
    using dir = synthetic("npm-migrate-empty-bin", {
      "package.json": JSON.stringify({ name: "empty-bin", dependencies }),
      "package-lock.json": npmLock("empty-bin", {
        "": { name: "empty-bin", dependencies },
        "node_modules/x": { version: "1.0.0", bin: {} },
      }),
    });
    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).not.toContain("InvalidNPMLockfile");
    expect(exitCode).toBe(0);
    expect(lock.packages.x).toStrictEqual(["x@1.0.0", `${OFFLINE_REGISTRY}x/-/x-1.0.0.tgz`, {}, ""]);
    await frozen(dir);
  });

  test.concurrent("a git resolved without a committish is an invalid lockfile, and install falls back", async () => {
    using dir = synthetic("npm-migrate-git-no-committish", {
      "package.json": JSON.stringify({ name: "git-no-committish", dependencies: { "dep-1": "file:dep-1" } }),
      "dep-1/package.json": JSON.stringify({ name: "dep-1" }),
      "package-lock.json": npmLock("git-no-committish", {
        "": {
          name: "git-no-committish",
          dependencies: { "dep-1": "file:dep-1", x: "git+https://github.com/user/x.git" },
        },
        "node_modules/dep-1": { resolved: "dep-1", link: true },
        "dep-1": {},
        "node_modules/x": { version: "1.0.0", resolved: "git+https://github.com/user/x.git" },
      }),
    });
    const migrateResult = await run(dir, "pm", "migrate");
    expect(migrateResult.stderr).toContain("InvalidNPMLockfile");
    expect(migrateResult.exitCode).toBe(1);
    expect(fs.existsSync(join(String(dir), "bun.lock"))).toBeFalse();

    const install = await run(dir, "install");
    expect(install.stderr).toContain("InvalidNPMLockfile");
    expect(install.stderr).not.toContain("migrated lockfile");
    expect(install.exitCode).toBe(0);
    expect(firstsOf((await readLock(dir)).lock.packages)).toStrictEqual(["dep-1@file:dep-1"]);
  });

  test.concurrent("a link entry without resolved drops the dependency", async () => {
    using dir = synthetic("npm-migrate-link-no-resolved", {
      "package.json": JSON.stringify({ name: "link-no-resolved" }),
      "package-lock.json": npmLock("link-no-resolved", {
        "": { name: "link-no-resolved", dependencies: { a: "file:../a" } },
        "node_modules/a": { link: true },
      }),
    });
    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).not.toContain("InvalidNPMLockfile");
    expect(exitCode).toBe(0);
    expect(lock.workspaces).toStrictEqual({ "": { name: "link-no-resolved" } });
    expect(lock.packages).toStrictEqual({});
  });

  describe("arborist fixtures", () => {
    // Snapshot matchers are unsupported inside a concurrent group, so these stay sequential.
    test.each(arboristFixtures.map(f => f.name))("%s", async name => {
      using dir = fixture(name);
      const { stderr, exitCode } = await run(dir, "pm", "migrate");
      const report = [stderr.replace(/^\[[\d.]+m?s\] /gm, "").trimEnd(), `bun pm migrate exit code: ${exitCode}`];
      if (exitCode === 0) {
        const { text } = await readLock(dir);
        const check = await run(dir, "install", "--frozen-lockfile", "--lockfile-only");
        report.push(`bun install --frozen-lockfile exit code: ${check.exitCode}`, "", text);
      }
      expect(report.join("\n")).toMatchSnapshot();
    });
  });
});
