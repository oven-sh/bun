import { describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, normalizeBunSnapshot, pack, tempDir } from "harness";
import { join, relative } from "path";
import { pathToFileURL } from "url";
import { ARBORIST, OFFLINE_REGISTRY, fixture, readLock, run, writeExtra } from "./migration-harness";

setDefaultTimeout(1000 * 60 * 5);

const REGISTRY_PACKAGES = join(import.meta.dir, "..", "registry", "packages");

function synthetic(name: string, files: Record<string, string>, registry = OFFLINE_REGISTRY) {
  const dir = tempDir(name, files);
  writeExtra(String(dir), {}, registry);
  return dir;
}

// Serves the registry fixture packages from disk and records every path requested.
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
      return Response.json(JSON.parse((await file.text()).replaceAll(/http:\/\/(?:http:\/\/)?localhost:4873\//g, url)));
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

// bun.lock for an inline snapshot: `replace` maps the values that differ between runs (a port, a commit) to placeholders.
async function lockSnapshot(dir: string, replace: Record<string, string> = {}) {
  let { text } = await readLock(dir);
  for (const [from, to] of Object.entries(replace)) text = text.replaceAll(from, to);
  return normalizeBunSnapshot(text, String(dir));
}

// The sorted entries of node_modules: a link as "-> <target relative to the project>", a package as its version.
function nodeModules(dir: string) {
  const root = join(String(dir), "node_modules");
  return Object.fromEntries(
    fs
      .readdirSync(root)
      .sort()
      .map(name => {
        const path = join(root, name);
        if (fs.lstatSync(path).isSymbolicLink()) {
          const target = relative(String(dir), fs.realpathSync.native(path)).replaceAll("\\", "/");
          return [name, `-> ${target || "."}`];
        }
        return [name, JSON.parse(fs.readFileSync(join(path, "package.json"), "utf8")).version ?? null];
      }),
  );
}

const install = (dir: string, ...args: string[]) => run(dir, "install", ...args);

// Git reads neither the system nor the user's config, so a signing or hook setting cannot fail the commit.
async function git(cwd: string, ...args: string[]) {
  const env = {
    ...bunEnv,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(cwd, "no-gitconfig"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  await using proc = Bun.spawn({ cmd: ["git", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${stderr}`);
  return stdout.trim();
}

// `bun add` migrates first, so a dependency the lockfile pins below what its range allows keeps the pinned version.
test.concurrent.each([3, 2])("migrate from npm lockfile v%d during `bun add`", async lockfileVersion => {
  using registry = localRegistry();
  const noDeps = {
    version: "1.0.0",
    resolved: registry.tarball("no-deps", "1.0.0"),
    integrity: registry.integrity("no-deps", "1.0.0"),
  };
  using dir = synthetic(
    "migrate-add",
    {
      "package.json": JSON.stringify({ name: "test3", dependencies: { "no-deps": "*" } }),
      "package-lock.json": JSON.stringify({
        name: "test3",
        lockfileVersion,
        requires: true,
        packages: {
          "": { name: "test3", dependencies: { "no-deps": "*" } },
          "node_modules/no-deps": noDeps,
        },
        // lockfileVersion 2 also carries the lockfileVersion 1 `dependencies` section.
        ...(lockfileVersion === 2 ? { dependencies: { "no-deps": noDeps } } : {}),
      }),
    },
    registry.url,
  );

  const { stdout, stderr, exitCode } = await run(dir, "add", "is-number@1.0.0");
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "migrated lockfile from package-lock.json
    Resolving dependencies
    Resolved, downloaded and extracted [4]
    Saved lockfile"
  `);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun add <version> (<revision>)

    + no-deps@1.0.0

    installed is-number@1.0.0

    2 packages installed"
  `);
  expect(exitCode).toBe(0);
  // no-deps keeps the lockfile's 1.0.0 although 2.0.0 is "latest"; its manifest is never fetched.
  expect(registry.requests.sort()).toEqual([
    "/is-number",
    "/is-number/-/is-number-1.0.0.tgz",
    "/no-deps/-/no-deps-1.0.0.tgz",
  ]);
  expect(nodeModules(dir)).toEqual({ "is-number": "1.0.0", "no-deps": "1.0.0" });
  expect(await Bun.file(join(String(dir), "package.json")).json()).toEqual({
    name: "test3",
    dependencies: { "is-number": "1.0.0", "no-deps": "*" },
  });
  expect(await lockSnapshot(dir, { [registry.url]: "<registry>/" })).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 0,
      "workspaces": {
        "": {
          "name": "test3",
          "dependencies": {
            "is-number": "1.0.0",
            "no-deps": "*",
          },
        },
      },
      "packages": {
        "is-number": ["is-number@1.0.0", "<registry>/is-number/-/is-number-1.0.0.tgz", {}, "sha512-PWbU1PO3loy/91zx8zOoQ37b8UWuu64eJONVIObQSlUUrYag+zy562vmZuRwRcv2hDhgK1Dc9qkJVS954CB1Nw=="],

        "no-deps": ["no-deps@1.0.0", "<registry>/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw=="],
      }
    }"
  `);
});

// Currently this upgrades svelte :(
test.todo("migrate workspace from npm during `bun add`", async () => {
  using dir = tempDir("migrate-add-workspace", join(import.meta.dir, "add-while-migrate-workspace"));

  const { exitCode } = await run(join(String(dir), "packages", "a"), "add", "lodash@4.17.21");
  expect(exitCode).toBe(0);
  expect(nodeModules(dir)).toMatchObject({ lodash: "4.17.21", svelte: "3.0.0" });
});

test.concurrent("migrate package with dependency on root package", async () => {
  const root = { name: "test-pkg", version: "2.2.2", dependencies: { "test-pkg": "." } };
  using dir = synthetic("migrate-root-dependency", {
    "package.json": JSON.stringify({ ...root, scripts: { postinstall: "echo success!" } }),
    "package-lock.json": npmLock(
      "test-pkg",
      {
        "": { ...root, hasInstallScript: true },
        "node_modules/test-pkg": { resolved: "", link: true },
      },
      { version: "2.2.2" },
    ),
  });

  const { stdout, stderr, exitCode } = await install(dir);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "migrated lockfile from package-lock.json
    Saved lockfile

    $ echo success!"
  `);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)
    success!

    + test-pkg@

    1 package installed"
  `);
  expect(exitCode).toBe(0);
  expect(nodeModules(dir)).toEqual({ "test-pkg": "-> ." });
  expect(await lockSnapshot(dir)).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 0,
      "workspaces": {
        "": {
          "name": "test-pkg",
          "dependencies": {
            "test-pkg": ".",
          },
        },
      },
      "packages": {
        "test-pkg": ["test-pkg@root:", {}],
      }
    }"
  `);
});

// npm resolved an npm range to a git commit. The migration keeps the git resolution and the install clones it.
test.concurrent("migrate package with npm dependency that resolves to a git package", async () => {
  using dir = tempDir("migrate-npm-to-git", {
    "repo/package.json": JSON.stringify({ name: "install-test", version: "3.7.1" }),
    "project/package.json": JSON.stringify({ name: "lock", version: "0.0.1", dependencies: { jquery: "3.7.1" } }),
  });
  const repo = join(String(dir), "repo");
  await git(repo, "init", "-q");
  await git(repo, "add", "package.json");
  await git(repo, "commit", "-q", "-m", "init");
  const sha = await git(repo, "rev-parse", "HEAD");
  const repoUrl = `git+${pathToFileURL(repo).href}`;

  const project = join(String(dir), "project");
  writeExtra(project, {
    "package-lock.json": npmLock(
      "lock",
      {
        "": { name: "lock", version: "0.0.1", dependencies: { jquery: "3.7.1" } },
        "node_modules/jquery": { version: "3.7.1", resolved: `${repoUrl}#${sha}`, license: "MIT" },
      },
      { version: "0.0.1" },
    ),
  });

  const { stdout, stderr, exitCode } = await install(project);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "migrated lockfile from package-lock.json
    Saved lockfile"
  `);
  expect(normalizeBunSnapshot(stdout.replaceAll(repoUrl, "<repo>").replaceAll(sha, "<sha>"))).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + jquery@<repo>#<sha>

    1 package installed"
  `);
  expect(exitCode).toBe(0);
  expect(nodeModules(project)).toEqual({ jquery: "3.7.1" });
  expect(await Bun.file(join(project, "node_modules", "jquery", "package.json")).json()).toEqual({
    name: "install-test",
    version: "3.7.1",
  });
  expect(await lockSnapshot(project, { [repoUrl]: "<repo>", [sha]: "<sha>" })).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 0,
      "workspaces": {
        "": {
          "name": "lock",
          "dependencies": {
            "jquery": "3.7.1",
          },
        },
      },
      "packages": {
        "jquery": ["jquery@<repo>#<sha>", { "version": "3.7.1" }, "<sha>"],
      }
    }"
  `);
});

test.concurrent("migrate from npm lockfile that is missing `resolved` properties", async () => {
  using registry = localRegistry();
  const root = { name: "bun", version: "0.0.0", dependencies: { "no-deps": "1.0.0" } };
  using dir = synthetic(
    "migrate-missing-resolved",
    {
      "package.json": JSON.stringify(root),
      "package-lock.json": npmLock(
        "bun",
        {
          "": root,
          "node_modules/no-deps": { version: "1.0.0", integrity: registry.integrity("no-deps", "1.0.0") },
        },
        { version: "0.0.0" },
      ),
    },
    registry.url,
  );

  const { stdout, stderr, exitCode } = await install(dir);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "migrated lockfile from package-lock.json
    Saved lockfile"
  `);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + no-deps@1.0.0

    1 package installed"
  `);
  expect(exitCode).toBe(0);
  // The tarball URL is built from the configured registry, so no manifest is needed.
  expect(registry.requests).toEqual(["/no-deps/-/no-deps-1.0.0.tgz"]);
  expect(nodeModules(dir)).toEqual({ "no-deps": "1.0.0" });
  expect(await lockSnapshot(dir, { [registry.url]: "<registry>/" })).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 0,
      "workspaces": {
        "": {
          "name": "bun",
          "dependencies": {
            "no-deps": "1.0.0",
          },
        },
      },
      "packages": {
        "no-deps": ["no-deps@1.0.0", "<registry>/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw=="],
      }
    }"
  `);
});

// https://github.com/oven-sh/bun/issues/38668
test.concurrent("migrate npm lockfile with missing `resolved` when scope registry has no trailing slash", async () => {
  using dir = tempDir("migrate-scope-no-slash", {
    "package.json": JSON.stringify({
      name: "repro",
      version: "1.0.0",
      dependencies: {
        "@myscope/a": "1.0.0",
        "@myscope/b": "2.0.0",
      },
    }),
    // With a path: a URL that is only a host gets its `/` when it is parsed.
    "bunfig.toml": `
[install.scopes]
"@myscope" = { url = "https://example-registry.invalid/npm/repo" }
`,
    "package-lock.json": JSON.stringify({
      name: "repro",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "repro",
          version: "1.0.0",
          dependencies: {
            "@myscope/a": "1.0.0",
            "@myscope/b": "2.0.0",
          },
        },
        // without `integrity` the malformed URL failed the whole migration
        "node_modules/@myscope/a": { version: "1.0.0" },
        // with `integrity` the malformed URL was written into bun.lock
        "node_modules/@myscope/b": {
          version: "2.0.0",
          integrity: "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==",
        },
      },
    }),
  });

  // `bun pm migrate` never touches the network, so the unresolvable registry host is fine
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "migrate"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("InvalidNPMLockfile");
  expect(exitCode).toBe(0);

  const lock = await Bun.file(join(String(dir), "bun.lock")).text();
  expect(lock).toContain("https://example-registry.invalid/npm/repo/@myscope/a/-/a-1.0.0.tgz");
  expect(lock).toContain("https://example-registry.invalid/npm/repo/@myscope/b/-/b-2.0.0.tgz");
  expect(lock).not.toContain("repo@myscope");
});

test.concurrent("npm lockfile with relative workspaces", async () => {
  const workspaces = ["./packages/pkg0", "packages\\pkg1", ".//packages/pkg2", "packages/../packages/pkg3"];
  const names = ["pkg0", "pkg1", "pkg2", "pkg3"];
  using dir = synthetic("migrate-relative-workspaces", {
    "package.json": JSON.stringify({ name: "npm-lockfile-test", workspaces }),
    "package-lock.json": npmLock("npm-lockfile-test", {
      "": { name: "npm-lockfile-test", workspaces },
      ...Object.fromEntries(names.map(name => [`node_modules/${name}`, { resolved: `packages/${name}`, link: true }])),
      ...Object.fromEntries(names.map(name => [`packages/${name}`, {}])),
    }),
    ...Object.fromEntries(names.map(name => [`packages/${name}/package.json`, JSON.stringify({ name })])),
  });

  const { stdout, stderr, exitCode } = await install(dir);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "migrated lockfile from package-lock.json
    Saved lockfile"
  `);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    4 packages installed"
  `);
  expect(exitCode).toBe(0);
  expect(nodeModules(dir)).toEqual({
    pkg0: "-> packages/pkg0",
    pkg1: "-> packages/pkg1",
    pkg2: "-> packages/pkg2",
    pkg3: "-> packages/pkg3",
  });
  expect(await lockSnapshot(dir)).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 0,
      "workspaces": {
        "": {
          "name": "npm-lockfile-test",
        },
        "packages/pkg0": {
          "name": "pkg0",
        },
        "packages/pkg1": {
          "name": "pkg1",
        },
        "packages/pkg2": {
          "name": "pkg2",
        },
        "packages/pkg3": {
          "name": "pkg3",
        },
      },
      "packages": {
        "pkg0": ["pkg0@workspace:packages/pkg0"],

        "pkg1": ["pkg1@workspace:packages/pkg1"],

        "pkg2": ["pkg2@workspace:packages/pkg2"],

        "pkg3": ["pkg3@workspace:packages/pkg3"],
      }
    }"
  `);
});

test.concurrent.each([
  [
    "npm-shrinkwrap.json",
    "InvalidNPMLockfile: failed to migrate lockfile: 'npm-shrinkwrap.json'\n\nwarn: Ignoring lockfile\nSaved lockfile",
  ],
  [
    "package-lock.json",
    "InvalidNPMLockfile: failed to migrate lockfile: 'package-lock.json'\n\nwarn: Ignoring lockfile\nSaved lockfile",
  ],
  [
    "yarn.lock",
    "UnsupportedYarnLockfileVersion: failed to migrate lockfile: 'yarn.lock'\n\nwarn: Ignoring lockfile\nSaved lockfile",
  ],
  [
    "pnpm-lock.yaml",
    "error: pnpm-lock.yaml missing 'lockfileVersion' field\nInvalidLockfile: failed to migrate lockfile: 'pnpm-lock.yaml'\n\nwarn: Ignoring lockfile\nSaved lockfile",
  ],
])("should create bun.lock if %s migration fails", async (lockfile, expectedStderr) => {
  using dir = synthetic("migration-failure", {
    "package.json": JSON.stringify({ name: "pkg", dependencies: { "dep-1": "file:dep-1" } }),
    [lockfile]: "{}",
    "dep-1/package.json": JSON.stringify({ name: "dep-1" }),
  });

  const { stdout, stderr, exitCode } = await install(dir);
  expect(normalizeBunSnapshot(stderr)).toBe(expectedStderr);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + dep-1@dep-1

    1 package installed"
  `);
  expect(exitCode).toBe(0);
  expect(nodeModules(dir)).toEqual({ "dep-1": null });
  expect(fs.existsSync(join(String(dir), "bun.lockb"))).toBeFalse();
  expect(await lockSnapshot(dir)).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "pkg",
          "dependencies": {
            "dep-1": "file:dep-1",
          },
        },
      },
      "packages": {
        "dep-1": ["dep-1@file:dep-1", {}],
      }
    }"
  `);
});

test.concurrent("npm lockfile migration skips extraneous packages that also declare inBundle: false", async () => {
  // A package entry carrying both `"inBundle": false` and `"extraneous": true` must be
  // excluded from every migration pass. The counting pass skips it (so its dependencies
  // are never reserved); the building and linking passes must apply the exact same
  // predicate, otherwise they append more package/dependency entries than were counted.
  const phantomDependencies: Record<string, string> = {};
  for (let i = 0; i < 200; i++) {
    phantomDependencies[`phantom-dep-${i}`] = "1.0.0";
  }

  using dir = synthetic("migrate-extraneous-inbundle", {
    "package.json": JSON.stringify({ name: "extraneous-test", workspaces: ["packages/pkg0"] }),
    "packages/pkg0/package.json": JSON.stringify({ name: "pkg0" }),
    "package-lock.json": npmLock("extraneous-test", {
      "": { name: "extraneous-test", workspaces: ["packages/pkg0"] },
      "node_modules/pkg0": { resolved: "packages/pkg0", link: true },
      "packages/pkg0": {},
      "node_modules/not-actually-installed": {
        version: "1.0.0",
        inBundle: false,
        extraneous: true,
        dependencies: phantomDependencies,
      },
    }),
  });

  const { stdout, stderr, exitCode } = await install(dir);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "migrated lockfile from package-lock.json
    Saved lockfile"
  `);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    1 package installed"
  `);
  expect(exitCode).toBe(0);
  expect(nodeModules(dir)).toEqual({ pkg0: "-> packages/pkg0" });
  expect(await lockSnapshot(dir)).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 0,
      "workspaces": {
        "": {
          "name": "extraneous-test",
        },
        "packages/pkg0": {
          "name": "pkg0",
        },
      },
      "packages": {
        "pkg0": ["pkg0@workspace:packages/pkg0"],
      }
    }"
  `);
});

test.concurrent(
  "bun update <name> re-resolves a file: dependency of a file: package in the same run as the migration",
  async () => {
    // package-lock.json (as `npm install --package-lock-only` writes it) keeps `b` the way
    // vendor/a/package.json declares it, relative to vendor/a. Updating `b` resolves that row again
    // straight from the migrated lockfile, so it has to be looked up from vendor/a, not the project.
    await using testDir = tempDir("migrate-nested-file-dep", {
      "package.json": JSON.stringify({ name: "app", dependencies: { a: "file:./vendor/a" } }),
      "vendor/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", dependencies: { b: "file:../b" } }),
      "vendor/b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
      "package-lock.json": JSON.stringify({
        name: "app",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "app", dependencies: { a: "file:./vendor/a" } },
          "node_modules/a": { resolved: "vendor/a", link: true },
          "node_modules/b": { resolved: "vendor/b", link: true },
          "vendor/a": { version: "1.0.0", dependencies: { b: "file:../b" } },
          "vendor/b": { version: "1.0.0" },
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "b"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("migrated lockfile from package-lock.json");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await Bun.file(join(testDir, "bun.lock")).text();
    expect(bunLock).toContain(`"a": ["a@file:vendor/a", { "dependencies": { "b": "file:../b" } }]`);
    expect(bunLock).toContain(`"a/b": ["b@file:vendor/b", {}]`);
    expect(await Bun.file(join(testDir, "node_modules", "a", "node_modules", "b", "package.json")).json()).toEqual({
      name: "b",
      version: "1.0.0",
    });
  },
);

// The bun.lock parser fails closed on a tarball URL outside the configured registry that has no `integrity`.
// The migration does not import such a URL either: the pinned version, and its integrity, come from the configured registry.
describe.concurrent("a package-lock.json entry of another host without an integrity", () => {
  function otherHost() {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname);
        return new Response("not found", { status: 404 });
      },
    });
    return { requests, url: server.url.href, [Symbol.dispose]: () => void server.stop(true) };
  }

  // The registry also has newer versions in both ranges.
  const root = { name: "one-off-registry-entry", dependencies: { "a-dep": "^1.0.1", "no-deps": "^1.0.0" } };
  const project = (registry: ReturnType<typeof localRegistry>, version: string, resolved: string) =>
    synthetic(
      "migrate-one-off-registry-entry",
      {
        "package.json": JSON.stringify(root),
        "package-lock.json": npmLock(root.name, {
          "": root,
          "node_modules/a-dep": {
            version: "1.0.1",
            resolved: registry.tarball("a-dep", "1.0.1"),
            integrity: registry.integrity("a-dep", "1.0.1"),
          },
          "node_modules/no-deps": { version, resolved },
        }),
      },
      registry.url,
    );

  test("keeps every version", async () => {
    using registry = localRegistry();
    using other = otherHost();
    const url = `${other.url}no-deps-1.0.0.tgz`;
    using dir = project(registry, "1.0.0", url);

    const { stderr, exitCode } = await install(dir);
    expect(stderr).toContain(`warn: missing integrity, downloading from configured registry instead of ${url}\n`);
    expect(stderr).toContain("package-lock.json:1:");
    expect(stderr).toContain("migrated lockfile from package-lock.json");
    expect(nodeModules(dir)).toEqual({ "a-dep": "1.0.1", "no-deps": "1.0.0" });
    expect(other.requests).toEqual([]);
    expect(registry.requests.sort()).toEqual(["/a-dep/-/a-dep-1.0.1.tgz", "/no-deps", "/no-deps/-/no-deps-1.0.0.tgz"]);
    expect((await readLock(dir)).lock.packages["no-deps"]).toEqual([
      "no-deps@1.0.0",
      "",
      {},
      registry.integrity("no-deps", "1.0.0"),
    ]);
    expect(exitCode).toBe(0);
  });

  test.each(["before", "after"])("takes the integrity of the same package's entry %s it", async order => {
    using registry = localRegistry();
    using other = otherHost();
    const verified = {
      version: "1.0.0",
      resolved: registry.tarball("no-deps", "1.0.0"),
      integrity: registry.integrity("no-deps", "1.0.0"),
    };
    const unverified = { version: "1.0.0", resolved: `${other.url}no-deps-1.0.0.tgz` };
    const dependencies = { "no-deps": "1.0.0", parent: "1.0.0" };
    using dir = synthetic(
      "migrate-off-registry-entry-twice",
      {
        "package.json": JSON.stringify({ name: "twice", dependencies }),
        "package-lock.json": npmLock("twice", {
          "": { name: "twice", dependencies },
          "node_modules/no-deps": order === "before" ? verified : unverified,
          "node_modules/parent": {
            version: "1.0.0",
            resolved: registry.tarball("parent", "1.0.0"),
            integrity: "sha512-" + Buffer.alloc(64, 1).toString("base64"),
            dependencies: { "no-deps": "1.0.0" },
          },
          "node_modules/parent/node_modules/no-deps": order === "before" ? unverified : verified,
        }),
      },
      registry.url,
    );

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from package-lock.json");
    expect((await readLock(dir)).lock.packages["no-deps"]).toEqual([
      "no-deps@1.0.0",
      verified.resolved,
      {},
      verified.integrity,
    ]);
    expect({ registry: registry.requests, other: other.requests }).toEqual({ registry: [], other: [] });
    expect(exitCode).toBe(0);
  });

  // A bundled copy has neither `resolved` nor `integrity`, and is one package with the entry of its version.
  test.each(["before", "after"])("gets the registry's integrity with a bundled copy %s it", async order => {
    using registry = localRegistry();
    using other = otherHost();
    const published = (name: string, rest: object) => ({
      version: "1.0.0",
      resolved: registry.tarball(name, "1.0.0"),
      integrity: "sha512-" + Buffer.alloc(64, 1).toString("base64"),
      dependencies: { "no-deps": "1.0.0" },
      ...rest,
    });
    // The dependencies of the first are reached first.
    const names = order === "before" ? ["bundler", "user"] : ["user", "bundler"];
    const dependencies = Object.fromEntries(names.map(name => [name, "1.0.0"]));
    using dir = synthetic(
      "migrate-off-registry-entry-and-bundled-copy",
      {
        "package.json": JSON.stringify({ name: "bundled", dependencies }),
        "package-lock.json": npmLock("bundled", {
          "": { name: "bundled", dependencies },
          "node_modules/bundler": published("bundler", { bundleDependencies: ["no-deps"] }),
          "node_modules/bundler/node_modules/no-deps": { version: "1.0.0", inBundle: true },
          "node_modules/no-deps": { version: "1.0.0", resolved: `${other.url}no-deps-1.0.0.tgz` },
          "node_modules/user": published("user", {}),
        }),
      },
      registry.url,
    );

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from package-lock.json");
    const rows = Object.values((await readLock(dir)).lock.packages) as string[][];
    // Printed once for `user` and once inside `bundler`.
    expect(rows.filter(row => row[0] === "no-deps@1.0.0").map(row => row[3])).toEqual([
      registry.integrity("no-deps", "1.0.0"),
      registry.integrity("no-deps", "1.0.0"),
    ]);
    expect({ registry: registry.requests, other: other.requests }).toEqual({ registry: ["/no-deps"], other: [] });
    expect(exitCode).toBe(0);
  });

  test("is not migrated when the registry does not have that version", async () => {
    using registry = localRegistry();
    using other = otherHost();
    const refused = "error: missing integrity, and configured registry has none for this version\n";

    using migrated = project(registry, "1.0.5", `${other.url}no-deps-1.0.5.tgz`);
    const migrate = await run(migrated, "pm", "migrate");
    expect(migrate.stderr).toContain(refused);
    expect(fs.existsSync(join(String(migrated), "bun.lock"))).toBeFalse();
    expect(migrate.exitCode).toBe(1);

    using installed = project(registry, "1.0.5", `${other.url}no-deps-1.0.5.tgz`);
    const { stderr, exitCode } = await install(installed);
    expect(stderr).toContain(refused);
    expect(stderr).toContain("InvalidNPMLockfile: failed to migrate lockfile: 'package-lock.json'");
    expect(other.requests).toEqual([]);
    const { packages } = (await readLock(installed)).lock;
    expect(Object.values(packages).map(row => (row as string[])[3])).toEqual([
      registry.integrity("a-dep", "1.0.10"),
      registry.integrity("no-deps", "1.1.0"),
    ]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("a lockfile that cannot be migrated does not hide the one next to it", () => {
  const npm6 = JSON.stringify({ name: "two-lockfiles", lockfileVersion: 1, requires: true, dependencies: {} });
  const pairs: [label: string, used: string, leftover: Record<string, string>, warning: string][] = [
    [
      "npm 6's package-lock.json",
      "yarn.lock",
      { "package-lock.json": npm6 },
      "warn: cannot migrate package-lock.json: unsupported lockfileVersion 1, trying yarn.lock\n",
    ],
    [
      "npm 6's package-lock.json",
      "pnpm-lock.yaml",
      { "package-lock.json": npm6 },
      "warn: cannot migrate package-lock.json: unsupported lockfileVersion 1, trying pnpm-lock.yaml\n",
    ],
    [
      "a package-lock.json without packages",
      "yarn.lock",
      { "package-lock.json": "{}" },
      "warn: cannot migrate package-lock.json (InvalidNPMLockfile), trying yarn.lock\n",
    ],
    [
      "an empty yarn.lock",
      "pnpm-lock.yaml",
      { "yarn.lock": "" },
      "warn: cannot migrate yarn.lock (UnsupportedYarnLockfileVersion), trying pnpm-lock.yaml\n",
    ],
  ];
  test.each(pairs)("%s, %s", async (_, used, leftover, warning) => {
    using registry = localRegistry();
    const integrity = registry.integrity("no-deps", "1.0.0");
    const locks: Record<string, string> = {
      "yarn.lock": `# yarn lockfile v1\n\n\nno-deps@^1.0.0:\n  version "1.0.0"\n  resolved "${registry.tarball("no-deps", "1.0.0")}"\n  integrity ${integrity}\n`,
      "pnpm-lock.yaml": `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      no-deps:\n        specifier: ^1.0.0\n        version: 1.0.0\n\npackages:\n\n  no-deps@1.0.0:\n    resolution: {integrity: ${integrity}}\n\nsnapshots:\n\n  no-deps@1.0.0: {}\n`,
    };
    using dir = synthetic(
      "migrate-two-lockfiles",
      {
        // The registry also has no-deps 1.0.1 and 1.1.0.
        "package.json": JSON.stringify({ name: "two-lockfiles", dependencies: { "no-deps": "^1.0.0" } }),
        ...leftover,
        [used]: locks[used],
      },
      registry.url,
    );

    const { stderr, exitCode } = await install(dir);
    expect(stderr).toContain(warning);
    expect(stderr).toContain(`migrated lockfile from ${used}`);
    expect(stderr).not.toContain("package.json instead");
    expect(stderr).not.toContain("Ignoring lockfile");
    expect(nodeModules(dir)).toEqual({ "no-deps": "1.0.0" });
    expect(exitCode).toBe(0);
  });
});

// The value after "#" in a git `resolved` field becomes a cache folder name, so migration
// must only accept a single safe path component (same rule the bun.lock parser applies).
test.concurrent(
  "package-lock.json migration rejects git committish values that are not a single path component",
  async () => {
    using registry = localRegistry();
    const root = { name: "git-committish-test", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } };
    using dir = synthetic(
      "migrate-git-committish-validation",
      {
        "package.json": JSON.stringify(root),
        "package-lock.json": npmLock(
          root.name,
          {
            "": root,
            "node_modules/no-deps": {
              version: "1.0.0",
              resolved:
                "git+ssh://git@github.com/dylan-conway/install-test.git#596234dab30564f37adae1e5c4d7123bcffce537/../../../../outside-of-cache",
              license: "MIT",
            },
          },
          { version: "1.0.0" },
        ),
      },
      registry.url,
    );

    const { stdout, stderr, exitCode } = await install(dir);
    // The migration is rejected; the install ignores the lockfile and resolves no-deps@1.0.0 from the registry.
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "InvalidNPMLockfile: failed to migrate lockfile: 'package-lock.json'

    warn: Ignoring lockfile
    Resolving dependencies
    Resolved, downloaded and extracted [4]
    Saved lockfile"
  `);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + no-deps@1.0.0 (v2.0.0 available)

    1 package installed"
  `);
    expect(exitCode).toBe(0);
    expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-1.0.0.tgz"]);
    expect(nodeModules(dir)).toEqual({ "no-deps": "1.0.0" });
    expect(await lockSnapshot(dir, { [registry.url]: "<registry>/" })).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "git-committish-test",
          "dependencies": {
            "no-deps": "1.0.0",
          },
        },
      },
      "packages": {
        "no-deps": ["no-deps@1.0.0", "<registry>/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw=="],
      }
    }"
  `);
  },
);

test.concurrent(
  "package-lock.json migration keeps dependencies declared as arbitrary tarball URLs without integrity",
  async () => {
    const tarball = await Bun.file(join(import.meta.dir, "..", "baz-0.0.3.tgz")).arrayBuffer();
    const requests: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname);
        return new Response(tarball);
      },
    });

    const tarballUrl = `http://localhost:${server.port}/baz-0.0.3.tgz`;
    const root = { name: "arbitrary-tarball-url-test", version: "1.0.0", dependencies: { baz: tarballUrl } };
    using dir = synthetic("migrate-arbitrary-tarball-url", {
      "package.json": JSON.stringify(root),
      "package-lock.json": npmLock(
        root.name,
        {
          "": root,
          "node_modules/baz": { version: "0.0.3", resolved: tarballUrl, license: "MIT" },
        },
        { version: "1.0.0" },
      ),
    });

    const { stdout, stderr, exitCode } = await install(dir);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "migrated lockfile from package-lock.json
    Saved lockfile"
  `);
    expect(normalizeBunSnapshot(stdout.replaceAll(tarballUrl, "<tarball>"))).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + baz@<tarball>

    1 package installed"
  `);
    expect(exitCode).toBe(0);
    expect(requests).toEqual(["/baz-0.0.3.tgz"]);
    expect(nodeModules(dir)).toEqual({ baz: "0.0.3" });
    expect(await lockSnapshot(dir, { [tarballUrl]: "<tarball>" })).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 0,
      "workspaces": {
        "": {
          "name": "arbitrary-tarball-url-test",
          "dependencies": {
            "baz": "<tarball>",
          },
        },
      },
      "packages": {
        "baz": ["baz@<tarball>", { "version": "0.0.3" }, "sha512-NDeQ0yQgI9RPCbmajKIrJnQStwKUz04Ve/WkZimSqijwqgE8RhAxqpzdXC/ica+GZFwLkeoZHtukOuOG2b4ENg=="],
      }
    }"
  `);
  },
);

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

test.concurrent("package-lock.json migration does not platform-skip a regular file: folder dependency", async () => {
  using testDir = synthetic(
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
    using testDir = synthetic("migrate-folder-name", filePlatformFixture(name, folder, [], []));

    const first = await install(testDir);
    expect(first.stderr).toContain("migrated lockfile from package-lock.json");
    expect(first.exitCode).toBe(0);
    expect(await Bun.file(join(testDir, "bun.lock")).text()).toContain(`"${name}": ["${name}@file:${folder}", {}]`);

    // The second install consumes the bun.lock the migration just wrote. It must parse,
    // otherwise --frozen-lockfile is permanently broken after an npm migration.
    const second = await install(testDir, "--frozen-lockfile");
    expect(second.stderr).not.toContain("invalid package name");
    expect(second.stderr).not.toContain("Ignoring lockfile");
    expect(second.exitCode).toBe(0);
    expect(await Bun.file(join(testDir, "node_modules", name, "package.json")).json()).toHaveProperty("name", name);
  },
);

test.concurrent(
  "migrated bun.lock with a nested-placed peer of a file: dependency round-trips --frozen-lockfile",
  async () => {
    // delta is a regular peer of gamma placed only as "gamma/delta"; listing it in optionalPeers too made reload drop the entry.
    using testDir = synthetic("migrate-nested-peer-fixed-point", {
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
  using testDir = synthetic("migrate-tarball-platform", {
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
  using testDir = synthetic("migrate-folder-cycle", files);

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
    using testDir = synthetic("install-folder-self-workspace", {
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
  using testDir = synthetic("migrate-pnpm-folder-platform", {
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

// `libc` is carried over for registry packages like `os`/`cpu` are, and like them is dropped
// for a `file:` dependency, which a fresh resolve installs unconditionally. Nothing is installed
// (port 1 refuses connections), only the lockfile is migrated.
describe.each([
  [
    "package-lock.json",
    {
      "package-lock.json": JSON.stringify({
        name: "repro",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "repro", dependencies: { "native-musl": "1.0.0", a: "file:vendor/a" } },
          "node_modules/native-musl": {
            version: "1.0.0",
            resolved: "http://localhost:1/native-musl/-/native-musl-1.0.0.tgz",
            integrity:
              "sha512-1uffg8IA4EJ4VUnuZU4zyRO9EyduuNfbqg2MMVCWSMAsQkfzZnNR0hqtL0GW/EuhE8FWU/FE//Srf1px1pnN2Q==",
            os: ["linux"],
            libc: ["musl"],
          },
          "node_modules/a": { resolved: "vendor/a", link: true },
          // npm copies the field as written in package.json, which may be a bare string.
          "vendor/a": { version: "1.0.0", libc: "musl" },
        },
      }),
    },
  ],
  [
    "pnpm-lock.yaml",
    {
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      a:",
        "        specifier: file:vendor/a",
        "        version: file:vendor/a",
        "      native-musl:",
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "",
        "packages:",
        "",
        "  a@file:vendor/a:",
        "    resolution: {directory: vendor/a, type: directory}",
        "    libc: [musl]",
        "    version: 1.0.0",
        "",
        "  native-musl@1.0.0:",
        "    resolution: {integrity: sha512-1uffg8IA4EJ4VUnuZU4zyRO9EyduuNfbqg2MMVCWSMAsQkfzZnNR0hqtL0GW/EuhE8FWU/FE//Srf1px1pnN2Q==}",
        "    os: [linux]",
        "    libc: [musl]",
        "",
        "snapshots:",
        "",
        "  a@file:vendor/a: {}",
        "",
        "  native-musl@1.0.0: {}",
        "",
      ].join("\n"),
    },
  ],
])("%s migration keeps the libc of registry packages", (lockfile, lockfileFiles) => {
  test.concurrent("bun.lock records it", async () => {
    await using testDir = tempDir("migrate-libc", {
      "package.json": JSON.stringify({ name: "repro", dependencies: { "native-musl": "1.0.0", a: "file:vendor/a" } }),
      "vendor/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", libc: ["musl"] }),
      "bunfig.toml": '[install]\nregistry = "http://localhost:1/"\n',
      ...lockfileFiles,
    });

    const { stderr, exitCode } = await install(testDir, "--lockfile-only");
    expect(stderr).toContain(`migrated lockfile from ${lockfile}`);
    expect(exitCode).toBe(0);

    const lines = (await Bun.file(join(testDir, "bun.lock")).text()).split("\n").map(line => line.trim());
    expect(lines.find(line => line.startsWith('"native-musl": ['))).toContain(`{ "os": "linux", "libc": "musl" }`);
    expect(lines.find(line => line.startsWith('"a": ['))).toBe('"a": ["a@file:vendor/a", {}],');
  });
});

describe("package-lock.json migration fixes", () => {
  // Some arborist fixtures ship a package.json that disagrees with their lockfile, which --frozen-lockfile rejects.
  function manifestFromLockfile(name: string) {
    const lock = JSON.parse(fs.readFileSync(join(ARBORIST, name, "package-lock.json"), "utf8"));
    return JSON.stringify(lock.packages[""]);
  }

  /** With --verbose, which also reports what bun resolves by itself. */
  async function migrate(dir: string) {
    const result = await run(dir, "pm", "migrate", "--verbose");
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

  // A git resolution is written to bun.lock as "git+" + the repository URL, so a
  // dependency on a plain git:// host comes back as "git+git://...". The lockfile
  // parser has to accept that spelling, otherwise every later install throws the
  // lockfile away ("Unexpected resolution") and --frozen-lockfile can never pass.
  test.concurrent("git:// hosts round-trip through bun.lock", async () => {
    const dependencies = {
      g: "git://example.com/user/g.git",
      h: "git://example.com/user/h.git#v1",
    };
    using dir = synthetic("npm-migrate-git-protocol", {
      "package.json": JSON.stringify({ name: "git-protocol", dependencies }),
      "package-lock.json": npmLock("git-protocol", {
        "": { name: "git-protocol", dependencies },
        "node_modules/g": { version: "1.0.0", resolved: `git://example.com/user/g.git#${sha(1)}` },
        "node_modules/h": { version: "1.0.0", resolved: `git://example.com/user/h.git#${sha(2)}` },
      }),
    });

    const { lock } = await migrate(dir);
    expect(lock.workspaces[""].dependencies).toStrictEqual(dependencies);
    expect(lock.packages.g[0]).toBe(`g@git+git://example.com/user/g.git#${sha(1)}`);
    expect(lock.packages.h[0]).toBe(`h@git+git://example.com/user/h.git#${sha(2)}`);
    await frozen(dir);
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
        "error: cannot migrate package-lock.json: unsupported lockfileVersion 1\nnote: npm install --package-lock-only --lockfile-version=3\n",
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
        "warn: cannot migrate package-lock.json: unsupported lockfileVersion 1, resolving from package.json\nnote: npm install --package-lock-only --lockfile-version=3\n",
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
    expect(stderr).toContain(
      'warn: skipping npm patches for "arg" from package-lock.json\nnote: recreate them with bun patch <pkg>\n',
    );
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
        hasInstallScript: true,
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
      expect(stderr).toContain(" unused package-lock.json entr");
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
      'skipping "p" from package-lock.json: transitive folder dependency "../m/node_modules/p" is outside the project',
    );
    expect(stderr).toContain(
      'skipping "b" from package-lock.json: transitive folder dependency "../a/node_modules/b" is outside the project',
    );
    expect(stderr).toContain('skipping 3 unused package-lock.json entries: "../a", "../i", "../m"');
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
    expect(stderr).not.toContain(" unused package-lock.json entr");
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
    const result = await run(fresh, "install", "--lockfile-only");
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

  test.concurrent("a required dependency with no entry is reported", async () => {
    using dir = synthetic("npm-migrate-no-entry", {
      "package.json": JSON.stringify({ name: "no-entry", dependencies: { x: "1.0.0" } }),
      "package-lock.json": JSON.stringify({
        name: "no-entry",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "no-entry", dependencies: { x: "1.0.0" } },
          "node_modules/x": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/x/-/x-1.0.0.tgz",
            dependencies: { y: "^1.0.0", z: "http://carol:s3cret@localhost:1/z-1.0.0.tgz" },
          },
        },
      }),
    });

    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain(
      'warn: skipping "y@^1.0.0" from package-lock.json: no entry for this dependency of "node_modules/x"',
    );
    // a range can be a tarball URL with credentials
    expect(stderr).toContain('warn: skipping "z@http://***@localhost:1/z-1.0.0.tgz" from package-lock.json');
    expect(stderr).not.toContain("s3cret");
    expect(lock.packages.x[2]).toStrictEqual({});
    expect(exitCode).toBe(0);
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
    expect(stderr).toContain('skipping "y@catalog:"');
    expect(stderr).toContain('skipping "z@ftp://example.invalid/z.tgz"');
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

  test.concurrent(
    "bun install resolves the project's required peers that are missing from package-lock.json",
    async () => {
      // what `npm install --legacy-peer-deps` writes
      using registry = localRegistry();
      const root = {
        name: "unlocked-peers",
        dependencies: { "no-deps": "1.0.0" },
        peerDependencies: { "a-dep": "1.0.1" },
      };
      const ui = { name: "ui", version: "1.0.0", peerDependencies: { "what-bin": "1.0.0" } };
      using dir = synthetic(
        "npm-migrate-unlocked-peers",
        {
          "package.json": JSON.stringify({ ...root, workspaces: ["ui"] }),
          "ui/package.json": JSON.stringify(ui),
          "package-lock.json": npmLock("unlocked-peers", {
            "": { ...root, workspaces: ["ui"] },
            "node_modules/no-deps": {
              version: "1.0.0",
              resolved: registry.tarball("no-deps", "1.0.0"),
              integrity: registry.integrity("no-deps", "1.0.0"),
            },
            "node_modules/ui": { resolved: "ui", link: true },
            ui,
          }),
        },
        registry.url,
      );

      // a frozen install takes package-lock.json as it is
      const frozenMigration = await run(dir, "install", "--frozen-lockfile");
      expect(frozenMigration.stderr).not.toContain("error:");
      expect(frozenMigration.exitCode).toBe(0);
      expect(fs.existsSync(join(String(dir), "bun.lock"))).toBe(false);

      const install = await run(dir, "install");
      expect(install.stderr).toContain("migrated lockfile from package-lock.json");
      expect(install.exitCode).toBe(0);
      const { lock } = await readLock(dir);
      expect(lock.workspaces).toStrictEqual({ "": root, ui });
      expect(firstsOf(lock.packages)).toStrictEqual([
        "a-dep@1.0.1",
        "no-deps@1.0.0",
        "ui@workspace:ui",
        "what-bin@1.0.0",
      ]);
      await frozen(dir);
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

    expect((await run(dir, "install", "--lockfile-only", "--dry-run")).stderr).not.toContain("warn:");
    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).toContain('skipping 1 unused package-lock.json entry: "b"');
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
    expect(normalizeBunSnapshot(install.stderr)).toBe("");
    expect(normalizeBunSnapshot(install.stdout)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + o@m/node_modules/n/o

      2 packages installed"
    `);
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
        'skipping "p" from package-lock.json: transitive folder dependency "../m/node_modules/p" is outside the project',
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

    // Without "p" the lockfile is behind o/package.json. A plain install reads that again and asks the registry for "p".
    const install = await run(project.dir, "install", "--frozen-lockfile", "--linker", linker);
    expect(normalizeBunSnapshot(install.stderr)).toBe(
      "warn: dependencies in ../m/node_modules/n/o/package.json changed since lockfile was saved (run 'bun install')",
    );
    expect(normalizeBunSnapshot(install.stdout)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + o@../m/node_modules/n/o

      1 package installed"
    `);
    expect(install.exitCode).toBe(0);
    expect(await Bun.file(join(project.dir, "node_modules", "o", "package.json")).json()).toHaveProperty("name", "o");
    expect(fs.existsSync(join(project.dir, "node_modules", "o", "node_modules", "p"))).toBeFalse();
    expect(fs.existsSync(join(project.oSource, "node_modules"))).toBeFalse();
    expect(storeEntries(project.dir)).toStrictEqual(linker === "isolated" ? [project.o.replaceAll(/[/:]/g, "+")] : []);
  });

  // A file: path written in an out-of-tree file: package's own package.json is trusted like a
  // root dependency, the same as a fresh `bun install` does, even when it leaves the project.
  test.concurrent("a file: dependency declared by an out-of-tree file: package migrates", async () => {
    const dependencies = { plugin: "file:../packages/plugin" };
    using copy = tempDir("npm-migrate-folder-declares-file-dep", {
      "root/package.json": JSON.stringify({ name: "root", dependencies }),
      "root/package-lock.json": npmLock("root", {
        "": { name: "root", dependencies },
        "../packages/plugin": { version: "1.0.0", dependencies: { "shared-lib": "file:../shared-lib" } },
        "../packages/plugin/node_modules/shared-lib": { resolved: "../packages/shared-lib", link: true },
        "../packages/shared-lib": { version: "1.0.0" },
        "node_modules/plugin": { resolved: "../packages/plugin", link: true },
      }),
      "packages/plugin/package.json": JSON.stringify({
        name: "plugin",
        version: "1.0.0",
        dependencies: { "shared-lib": "file:../shared-lib" },
      }),
      "packages/shared-lib/package.json": JSON.stringify({ name: "shared-lib", version: "1.0.0" }),
    });
    const dir = join(String(copy), "root");
    writeExtra(dir, {});

    const { stderr, exitCode, lock } = await migrate(dir);
    expect(stderr).not.toContain("outside the project");
    expect(exitCode).toBe(0);
    expect(lock.packages).toStrictEqual({
      plugin: ["plugin@file:../packages/plugin", { dependencies: { "shared-lib": "file:../shared-lib" } }],
      "plugin/shared-lib": ["shared-lib@file:../packages/shared-lib", {}],
    });
    await frozen(dir);

    // The same lockfile a fresh `bun install` writes, and the installer links the nested package.
    const install = await run(dir, "install", "--frozen-lockfile");
    expect(install.stderr).not.toContain("error");
    expect(install.exitCode).toBe(0);
    expect(
      await Bun.file(join(dir, "node_modules", "plugin", "node_modules", "shared-lib", "package.json")).json(),
    ).toHaveProperty("name", "shared-lib");
  });

  // A folder that a registry package ships inside itself is a `Folder` entry too, but the registry
  // package declared it, so a `file:` path in its package.json that leaves the project is still skipped.
  test.concurrent("a file: dependency declared by a registry package's own folder is still skipped", async () => {
    const dependencies = { evil: "1.0.0" };
    using copy = tempDir("npm-migrate-registry-folder-declares-file-dep", {
      "root/package.json": JSON.stringify({ name: "root", dependencies }),
      "root/package-lock.json": npmLock("root", {
        "": { name: "root", dependencies },
        "node_modules/evil": {
          version: "1.0.0",
          resolved: `${OFFLINE_REGISTRY}evil/-/evil-1.0.0.tgz`,
          dependencies: { inner: "file:./inner" },
        },
        "node_modules/evil/node_modules/inner": { resolved: "node_modules/evil/inner", link: true },
        "node_modules/evil/inner": { version: "1.0.0", dependencies: { loot: "file:../../../../secret" } },
        "node_modules/evil/inner/node_modules/loot": { resolved: "../secret", link: true },
        "../secret": { version: "1.0.0" },
      }),
      "secret/package.json": JSON.stringify({ name: "loot", version: "1.0.0" }),
      "secret/credentials.txt": "do-not-link-me",
    });
    const dir = join(String(copy), "root");
    writeExtra(dir, {});

    const { stderr, exitCode, text, lock } = await migrate(dir);
    expect(stderr).toContain(
      'skipping "loot" from package-lock.json: transitive folder dependency "../secret" is outside the project',
    );
    expect(exitCode).toBe(0);
    expect(Object.keys(lock.packages).sort()).toStrictEqual(["evil", "evil/inner"]);
    expect(lock.packages["evil/inner"]).toStrictEqual(["inner@file:inner", {}]);
    expect(text).not.toContain("../secret");
    expect(text).not.toContain("loot");
  });

  // npm resolves a `file:` directory declared by a registry package against the package itself and keys the
  // target entry by its project-relative path (`node_modules/<pkg>/<dir>`). bun installs a folder declared by a
  // registry package from inside that package, so the migrated row has to be the path inside the package.
  describe("file: directory inside a registry package", () => {
    function project(
      name: string,
      registry: ReturnType<typeof localRegistry>,
      pkg: "file-dep" | "missing-file-dep",
      folder: string,
      linkKey: string,
    ) {
      const dependencies = { [pkg]: "1.0.0" };
      return synthetic(
        name,
        {
          "package.json": JSON.stringify({ name, dependencies }),
          "package-lock.json": npmLock(name, {
            "": { name, dependencies },
            [`node_modules/${pkg}`]: {
              version: "1.0.0",
              resolved: registry.tarball(pkg, "1.0.0"),
              integrity: registry.integrity(pkg, "1.0.0"),
              dependencies: { files: `file:./${folder}` },
            },
            [`node_modules/${pkg}/${folder}`]: {},
            [linkKey]: { resolved: `node_modules/${pkg}/${folder}`, link: true },
          }),
        },
        registry.url,
      );
    }

    test.concurrent.each([
      ["node_modules/files", "hoisted"],
      ["node_modules/file-dep/node_modules/files", "nested"],
    ])("is recorded relative to the package and installed from it (link at %s)", async (linkKey, slug) => {
      using registry = localRegistry();
      using dir = project(`npm-migrate-folder-in-package-${slug}`, registry, "file-dep", "the-files", linkKey);

      const { text, lock } = await migrate(dir);
      expect(lock.packages).toStrictEqual({
        "file-dep": [
          "file-dep@1.0.0",
          registry.tarball("file-dep", "1.0.0"),
          { dependencies: { files: "file:./the-files" } },
          registry.integrity("file-dep", "1.0.0"),
        ],
        "file-dep/files": ["files@file:the-files", {}],
      });
      expect(text).not.toContain("node_modules/file-dep/the-files");
      await frozen(dir);

      const install = await run(dir, "install", "--linker", "hoisted");
      expect(install.stderr).not.toContain("error");
      expect(install.exitCode).toBe(0);
      expect(
        await Bun.file(join(String(dir), "node_modules", "file-dep", "node_modules", "files", "package.json")).json(),
      ).toHaveProperty("name", "files");
      const resolve = await run(join(String(dir), "node_modules", "file-dep"), "-e", `require("files")`);
      expect(resolve.stdout).toBe("hello files\n");
      expect(resolve.exitCode).toBe(0);
      expect(registry.requests).toStrictEqual(["/file-dep/-/file-dep-1.0.0.tgz"]);
    });

    test.concurrent("a directory the package does not ship installs nothing, like a fresh resolve", async () => {
      using registry = localRegistry();
      using dir = project(
        "npm-migrate-folder-in-package-missing",
        registry,
        "missing-file-dep",
        "missing-folder",
        "node_modules/files",
      );

      const { lock } = await migrate(dir);
      expect(lock.packages["missing-file-dep/files"]).toStrictEqual(["files@file:missing-folder", {}]);
      await frozen(dir);

      const install = await run(dir, "install", "--linker", "hoisted");
      expect(install.stderr).not.toContain("error");
      expect(install.exitCode).toBe(0);
      expect(fs.existsSync(join(String(dir), "node_modules", "missing-file-dep", "node_modules", "files"))).toBeFalse();
    });

    // `file:.` links back to the package's own entry, which is not inside itself, so the edge resolves to the package.
    test.concurrent("a package depending on itself with file:. keeps resolving to itself", async () => {
      using registry = localRegistry();
      const dependencies = { "self-file-dep": "1.0.0" };
      using dir = synthetic(
        "npm-migrate-folder-self",
        {
          "package.json": JSON.stringify({ name: "folder-self", dependencies }),
          "package-lock.json": npmLock("folder-self", {
            "": { name: "folder-self", dependencies },
            "node_modules/self-file-dep": {
              version: "1.0.0",
              resolved: registry.tarball("self-file-dep", "1.0.0"),
              integrity: registry.integrity("self-file-dep", "1.0.0"),
              dependencies: { "self-file-dep": "file:." },
            },
            "node_modules/self-file-dep/node_modules/self-file-dep": {
              resolved: "node_modules/self-file-dep",
              link: true,
            },
          }),
        },
        registry.url,
      );

      const { lock } = await migrate(dir);
      expect(lock.packages).toStrictEqual({
        "self-file-dep": [
          "self-file-dep@1.0.0",
          registry.tarball("self-file-dep", "1.0.0"),
          { dependencies: { "self-file-dep": "file:." } },
          registry.integrity("self-file-dep", "1.0.0"),
        ],
      });
      await frozen(dir);

      const install = await run(dir, "install", "--linker", "hoisted");
      expect(install.stderr).not.toContain("error");
      expect(install.exitCode).toBe(0);
      const resolve = await run(
        join(String(dir), "node_modules", "self-file-dep"),
        "-e",
        `console.log(require("self-file-dep/package.json").version)`,
      );
      expect(resolve.stdout).toBe("1.0.0\n");
      expect(resolve.exitCode).toBe(0);
    });

    test.concurrent("a directory inside a folder the root declares stays relative to the project", async () => {
      const dependencies = { a: "file:vendor/a" };
      using dir = synthetic("npm-migrate-folder-in-local-folder", {
        "package.json": JSON.stringify({ name: "folder-in-local-folder", dependencies }),
        "vendor/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", dependencies: { b: "file:./b" } }),
        "vendor/a/b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
        "package-lock.json": npmLock("folder-in-local-folder", {
          "": { name: "folder-in-local-folder", dependencies },
          "node_modules/a": { resolved: "vendor/a", link: true },
          "vendor/a": { version: "1.0.0", dependencies: { b: "file:./b" } },
          "vendor/a/b": { version: "1.0.0" },
          "vendor/a/node_modules/b": { resolved: "vendor/a/b", link: true },
        }),
      });

      const { lock } = await migrate(dir);
      expect(lock.packages).toStrictEqual({
        a: ["a@file:vendor/a", { dependencies: { b: "file:./b" } }],
        "a/b": ["b@file:vendor/a/b", {}],
      });
      await frozen(dir);

      const install = await run(dir, "install", "--linker", "hoisted");
      expect(install.stderr).not.toContain("error");
      expect(install.exitCode).toBe(0);
      expect(
        await Bun.file(join(String(dir), "node_modules", "a", "node_modules", "b", "package.json")).json(),
      ).toStrictEqual({ name: "b", version: "1.0.0" });
    });

    // npm deduplicated a local folder's `files` onto the hoisted link into file-dep. Each dependent needs its own
    // form of the row: file-dep's is read relative to file-dep, the local folder's relative to the project.
    test.concurrent.each([
      ["file-dep", "local"],
      ["local", "file-dep"],
    ])("a local folder sharing the directory gets the project-relative row (%s linked first)", async (...order) => {
      using registry = localRegistry();
      const specs: Record<string, string> = { "file-dep": "1.0.0", local: "file:vendor/local" };
      const dependencies = Object.fromEntries(order.map(name => [name, specs[name]]));
      const name = `npm-migrate-folder-shared-${order[0]}-first`;
      using dir = synthetic(
        name,
        {
          "package.json": JSON.stringify({ name, dependencies }),
          "vendor/local/package.json": JSON.stringify({
            name: "local",
            version: "1.0.0",
            dependencies: { files: "*" },
          }),
          "package-lock.json": npmLock(name, {
            "": { name, dependencies },
            "node_modules/file-dep": {
              version: "1.0.0",
              resolved: registry.tarball("file-dep", "1.0.0"),
              integrity: registry.integrity("file-dep", "1.0.0"),
              dependencies: { files: "file:./the-files" },
            },
            "node_modules/file-dep/the-files": { name: "files", version: "1.1.1" },
            "node_modules/files": { resolved: "node_modules/file-dep/the-files", link: true },
            "node_modules/local": { resolved: "vendor/local", link: true },
            "vendor/local": { version: "1.0.0", dependencies: { files: "*" } },
          }),
        },
        registry.url,
      );

      const { lock } = await migrate(dir);
      expect(lock.packages["file-dep/files"]).toStrictEqual(["files@file:the-files", {}]);
      expect(lock.packages["local/files"]).toStrictEqual(["files@file:node_modules/file-dep/the-files", {}]);
      await frozen(dir);

      const install = await run(dir, "install", "--linker", "hoisted");
      expect(install.stderr).not.toContain("error");
      expect(install.exitCode).toBe(0);
      for (const dependent of ["file-dep", "local"]) {
        expect(
          await Bun.file(join(String(dir), "node_modules", dependent, "node_modules", "files", "package.json")).json(),
        ).toHaveProperty("name", "files");
      }
    });

    test.concurrent(
      "a registry package deduplicated onto a folder the root declares keeps the root's row",
      async () => {
        using registry = localRegistry();
        const dependencies = { "dep-file-dep": "1.0.0", "file-dep": "file:vendor/file-dep" };
        using dir = synthetic(
          "npm-migrate-folder-dedupe",
          {
            "package.json": JSON.stringify({ name: "folder-dedupe", dependencies }),
            "vendor/file-dep/package.json": JSON.stringify({ name: "file-dep", version: "1.0.0" }),
            "package-lock.json": npmLock("folder-dedupe", {
              "": { name: "folder-dedupe", dependencies },
              "node_modules/dep-file-dep": {
                version: "1.0.0",
                resolved: registry.tarball("dep-file-dep", "1.0.0"),
                integrity: registry.integrity("dep-file-dep", "1.0.0"),
                dependencies: { "file-dep": "1.0.0" },
              },
              "node_modules/file-dep": { resolved: "vendor/file-dep", link: true },
              "vendor/file-dep": { version: "1.0.0" },
            }),
          },
          registry.url,
        );

        const { lock } = await migrate(dir);
        expect(lock.packages["file-dep"]).toStrictEqual(["file-dep@file:vendor/file-dep", {}]);
        expect(lock.packages["dep-file-dep/file-dep"]).toStrictEqual(["file-dep@file:vendor/file-dep", {}]);
        await frozen(dir);

        const install = await run(dir, "install", "--linker", "hoisted");
        expect(install.stderr).not.toContain("error");
        expect(install.exitCode).toBe(0);
        // The copy under dep-file-dep has nothing to install from; the root's copy in node_modules serves it.
        expect(
          fs.existsSync(join(String(dir), "node_modules", "dep-file-dep", "node_modules", "file-dep")),
        ).toBeFalse();
        const resolve = await run(
          join(String(dir), "node_modules", "dep-file-dep"),
          "-e",
          `console.log(require("file-dep/package.json").name)`,
        );
        expect(resolve.stdout).toBe("file-dep\n");
        expect(resolve.exitCode).toBe(0);
      },
    );

    // The target's key starts with the package's key and then climbs out of the package and of the project, so it
    // is not inside the package. It is skipped like every other transitive folder outside the project. The
    // directory is planted where the path leads from the package and where it leads from the project.
    test.concurrent.each(linkers)("a link target that climbs out of the package is skipped (%s)", async linker => {
      using registry = localRegistry();
      const dependencies = { "file-dep": "1.0.0" };
      const climbing = "node_modules/file-dep/../../../secret";
      const secret = {
        "package.json": JSON.stringify({ name: "loot", version: "1.0.0" }),
        "credentials.txt": "do-not-link-me",
      };
      using copy = tempDir(`npm-migrate-folder-climbs-${linker}`, {
        secret,
        a: {
          b: {
            secret,
            root: {
              "package.json": JSON.stringify({ name: "root", dependencies }),
              "package-lock.json": npmLock("root", {
                "": { name: "root", dependencies },
                "node_modules/file-dep": {
                  version: "1.0.0",
                  resolved: registry.tarball("file-dep", "1.0.0"),
                  integrity: registry.integrity("file-dep", "1.0.0"),
                  dependencies: { loot: "file:../../../secret" },
                },
                [climbing]: {},
                "node_modules/file-dep/node_modules/loot": { resolved: climbing, link: true },
              }),
            },
          },
        },
      });
      const dir = join(String(copy), "a", "b", "root");
      writeExtra(dir, {}, registry.url);

      const { stderr, text, lock } = await migrate(dir);
      expect(stderr).toContain(
        `skipping "loot" from package-lock.json: transitive folder dependency "${climbing}" is outside the project`,
      );
      expect(Object.keys(lock.packages)).toStrictEqual(["file-dep"]);
      expect(text).not.toContain("secret");
      await frozen(dir);

      const install = await run(dir, "install", "--linker", linker);
      expect(install.stderr).not.toContain("error");
      expect([
        ...new Bun.Glob("**/credentials.txt").scanSync({
          cwd: join(dir, "node_modules"),
          dot: true,
          followSymlinks: true,
        }),
      ]).toStrictEqual([]);
      expect(install.exitCode).toBe(0);
    });
  });

  // `npm install --install-links` packs a `file:` directory and installs the copy. The entry is not a link: it sits
  // at its `node_modules` key and `resolved` is `file:` plus the directory. Which directory a dependency names is for
  // the `file:` spec of its declarer to say, so the entry is skipped and the install resolves the spec.
  describe("file: directories that npm --install-links copied", () => {
    const skipped = (name: string) =>
      `warn: skipping "${name}" from package-lock.json: folder copied by npm (--install-links)`;

    test.concurrent("are resolved from the file: specs in package.json", async () => {
      const dependencies = { d: "file:../packages/d", v: "file:vendor/v" };
      using copy = tempDir("npm-migrate-install-links", {
        "root/package.json": JSON.stringify({ name: "root", dependencies }),
        "root/package-lock.json": npmLock("root", {
          "": { name: "root", dependencies },
          "node_modules/d": { version: "1.0.0", resolved: "file:../packages/d", dependencies: { e: "file:../e" } },
          "node_modules/e": { version: "1.0.0", resolved: "file:../packages/e" },
          "node_modules/v": { version: "2.0.0", resolved: "file:vendor/v" },
        }),
        "root/vendor/v/package.json": JSON.stringify({ name: "v", version: "2.0.0" }),
        "packages/d/package.json": JSON.stringify({ name: "d", version: "1.0.0", dependencies: { e: "file:../e" } }),
        "packages/d/index.js": "module.exports = 'd';",
        "packages/e/package.json": JSON.stringify({ name: "e", version: "1.0.0" }),
      });
      const dir = join(String(copy), "root");
      writeExtra(dir, {});

      const install = await run(dir, "install", "--verbose");
      expect(install.stderr).toContain("migrated lockfile from package-lock.json");
      expect(install.stderr).toContain(skipped("d"));
      expect(install.stderr).toContain(skipped("v"));
      // `e` is removed together with the `d` that declares it.
      expect(install.stderr).not.toContain(" unused package-lock.json entr");
      expect(install.stderr).not.toContain("error");
      expect(await Bun.file(join(dir, "node_modules", "d", "index.js")).text()).toBe("module.exports = 'd';");
      expect(await Bun.file(join(dir, "node_modules", "v", "package.json")).json()).toEqual({
        name: "v",
        version: "2.0.0",
      });
      expect(install.exitCode).toBe(0);
      const { lock } = await readLock(dir);
      await frozen(dir);

      // the lockfile of a fresh resolve
      fs.rmSync(join(dir, "package-lock.json"));
      fs.rmSync(join(dir, "bun.lock"));
      const fresh = await run(dir, "install", "--lockfile-only");
      expect(fresh.exitCode).toBe(0);
      expect((await readLock(dir)).lock.packages).toStrictEqual(lock.packages);
    });

    // Written by hand, in the shape above.
    test.concurrent("one that a registry package declares is dropped", async () => {
      const dependencies = { evil: "1.0.0" };
      using copy = tempDir("npm-migrate-install-links-registry-declares", {
        "root/package.json": JSON.stringify({ name: "root", dependencies }),
        "root/package-lock.json": npmLock("root", {
          "": { name: "root", dependencies },
          "node_modules/evil": {
            version: "1.0.0",
            resolved: `${OFFLINE_REGISTRY}evil/-/evil-1.0.0.tgz`,
            dependencies: { loot: "file:../../../secret" },
          },
          "node_modules/loot": { version: "1.0.0", resolved: "file:../secret" },
        }),
        "secret/package.json": JSON.stringify({ name: "loot", version: "1.0.0" }),
        "secret/credentials.txt": "do-not-link-me",
      });
      const dir = join(String(copy), "root");
      writeExtra(dir, {});

      const { stderr, text, lock } = await migrate(dir);
      expect(stderr).toContain(skipped("loot"));
      expect(Object.keys(lock.packages)).toStrictEqual(["evil"]);
      expect(text).not.toContain("secret");
      expect(text).not.toContain("loot");
      await frozen(dir);
    });

    test.concurrent("a local tarball is still a tarball", async () => {
      const dependencies = { "no-deps": "file:no-deps-1.0.0.tgz" };
      using dir = synthetic("npm-migrate-install-links-tarball", {
        "package.json": JSON.stringify({ name: "root", dependencies }),
        "package-lock.json": npmLock("root", {
          "": { name: "root", dependencies },
          "node_modules/no-deps": { version: "1.0.0", resolved: "file:no-deps-1.0.0.tgz" },
        }),
      });

      const { stderr, lock } = await migrate(String(dir));
      expect(stderr).not.toContain("skipping");
      expect(lock.packages["no-deps"][0]).toBe("no-deps@no-deps-1.0.0.tgz");
    });
  });

  test.concurrent("lockfileVersion 5 is refused, and install falls back to a fresh resolve", async () => {
    using dir = synthetic("npm-migrate-v5", {
      "package.json": JSON.stringify({ name: "v5", dependencies: { "dep-1": "file:dep-1" } }),
      "dep-1/package.json": JSON.stringify({ name: "dep-1" }),
      "package-lock.json": npmLock("v5", {}, { lockfileVersion: 5 }),
    });
    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toBe(
      "error: cannot migrate package-lock.json: unsupported lockfileVersion 5\nnote: npm install --package-lock-only --lockfile-version=3\n",
    );
    expect(exitCode).toBe(1);
    expect(fs.existsSync(join(String(dir), "bun.lock"))).toBeFalse();

    const install = await run(dir, "install");
    expect(install.stderr).toContain(
      "warn: cannot migrate package-lock.json: unsupported lockfileVersion 5, resolving from package.json\nnote: npm install --package-lock-only --lockfile-version=3\n",
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
    expect(stderr).toContain(
      'warn: skipping npm patches for "x", "y" from package-lock.json\nnote: recreate them with bun patch <pkg>\n',
    );
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

  // npm-shrinkwrap.json is package-lock.json under another name, and npm reads it in preference to package-lock.json.
  describe("npm-shrinkwrap.json", () => {
    test.concurrent("bun install keeps the versions it pins instead of resolving afresh", async () => {
      using registry = localRegistry();
      // The registry also has no-deps 1.0.1 and 1.1.0, which a fresh resolve of this range would pick.
      const dependencies = { "no-deps": "^1.0.0" };
      using dir = synthetic(
        "npm-migrate-shrinkwrap-install",
        {
          "package.json": JSON.stringify({ name: "shrinkwrapped", dependencies }),
          "npm-shrinkwrap.json": npmLock("shrinkwrapped", {
            "": { name: "shrinkwrapped", dependencies },
            "node_modules/no-deps": {
              version: "1.0.0",
              resolved: registry.tarball("no-deps", "1.0.0"),
              integrity: registry.integrity("no-deps", "1.0.0"),
            },
          }),
        },
        registry.url,
      );

      const { stderr, exitCode } = await run(dir, "install");
      expect(stderr).toContain("migrated lockfile from npm-shrinkwrap.json");
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(String(dir), "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
        name: "no-deps",
        version: "1.0.0",
      });
      const { lock } = await readLock(dir);
      expect(lock.packages["no-deps"]).toStrictEqual([
        "no-deps@1.0.0",
        registry.tarball("no-deps", "1.0.0"),
        {},
        registry.integrity("no-deps", "1.0.0"),
      ]);
      expect(registry.requests).toStrictEqual(["/no-deps/-/no-deps-1.0.0.tgz"]);
      await frozen(dir);
    });

    test.concurrent("bun pm migrate reads it", async () => {
      const dependencies = { x: "^1.0.0" };
      using dir = synthetic("npm-migrate-shrinkwrap-pm-migrate", {
        "package.json": JSON.stringify({ name: "shrinkwrapped", dependencies }),
        "npm-shrinkwrap.json": npmLock("shrinkwrapped", {
          "": { name: "shrinkwrapped", dependencies },
          "node_modules/x": { version: "1.0.0" },
        }),
      });
      const { stderr, lock } = await migrate(dir);
      expect(stderr).toContain("migrated lockfile from npm-shrinkwrap.json");
      expect(lock.packages.x).toStrictEqual(["x@1.0.0", `${OFFLINE_REGISTRY}x/-/x-1.0.0.tgz`, {}, ""]);
      await frozen(dir);
    });

    test.concurrent("takes precedence over a package-lock.json next to it, as in npm", async () => {
      const dependencies = { x: "^1.0.0" };
      using dir = synthetic("npm-migrate-shrinkwrap-precedence", {
        "package.json": JSON.stringify({ name: "both", dependencies }),
        "npm-shrinkwrap.json": npmLock("both", {
          "": { name: "both", dependencies },
          "node_modules/x": { version: "1.0.0" },
        }),
        "package-lock.json": npmLock("both", {
          "": { name: "both", dependencies },
          "node_modules/x": { version: "1.0.1" },
        }),
      });
      const { stderr, lock } = await migrate(dir);
      expect(stderr).toContain("migrated lockfile from npm-shrinkwrap.json");
      expect(stderr).not.toContain("package-lock.json");
      expect(firstsOf(lock.packages)).toStrictEqual(["x@1.0.0"]);
      await frozen(dir);
    });

    test.concurrent("migration warnings name it", async () => {
      const dependencies = { x: "1.0.0" };
      using dir = synthetic("npm-migrate-shrinkwrap-warnings", {
        "package.json": JSON.stringify({ name: "warned", dependencies }),
        "npm-shrinkwrap.json": npmLock("warned", {
          "": { name: "warned", dependencies },
          "node_modules/x": { version: "1.0.0", patched: { "patches/x.patch": "sha512-x" } },
          "node_modules/y": { version: "1.0.0" },
        }),
      });
      const { stderr, lock } = await migrate(dir);
      expect(stderr).toContain('warn: skipping 1 unused npm-shrinkwrap.json entry: "node_modules/y"\n');
      expect(stderr).toContain(
        'warn: skipping npm patches for "x" from npm-shrinkwrap.json\nnote: recreate them with bun patch <pkg>\n',
      );
      expect(stderr).not.toContain("package-lock.json");
      expect(firstsOf(lock.packages)).toStrictEqual(["x@1.0.0"]);
    });

    test.concurrent("an unsupported lockfileVersion is reported under its own name", async () => {
      using dir = synthetic("npm-migrate-shrinkwrap-v1", {
        "package.json": JSON.stringify({ name: "v1", dependencies: { "dep-1": "file:dep-1" } }),
        "dep-1/package.json": JSON.stringify({ name: "dep-1" }),
        "npm-shrinkwrap.json": JSON.stringify({ name: "v1", lockfileVersion: 1, requires: true, dependencies: {} }),
      });
      const { stderr, exitCode } = await run(dir, "pm", "migrate");
      expect(stderr).toBe(
        "error: cannot migrate npm-shrinkwrap.json: unsupported lockfileVersion 1\nnote: npm install --package-lock-only --lockfile-version=3\n",
      );
      expect(exitCode).toBe(1);
      expect(fs.existsSync(join(String(dir), "bun.lock"))).toBeFalse();

      const install = await run(dir, "install");
      expect(install.stderr).toContain(
        "warn: cannot migrate npm-shrinkwrap.json: unsupported lockfileVersion 1, resolving from package.json\nnote: npm install --package-lock-only --lockfile-version=3\n",
      );
      expect(install.stderr).not.toContain("migrated lockfile");
      expect(install.stderr).not.toContain("failed to migrate");
      expect(install.exitCode).toBe(0);
      expect((await readLock(dir)).lock.packages["dep-1"]).toStrictEqual(["dep-1@file:dep-1", {}]);
      expect(fs.existsSync(join(String(dir), "node_modules", "dep-1", "package.json"))).toBeTrue();
    });
  });
});
