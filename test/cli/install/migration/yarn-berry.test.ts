import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { bunEnv, bunExe, nodeModulesPackages, VerdaccioRegistry } from "harness";
import { join } from "path";

// Migration of yarn 2+ ("berry") lockfiles. Every fixture pins versions that are
// NOT the newest ones the registry has for the requested ranges (e.g. no-deps@^1.0.0
// is locked to 1.0.0 while 1.0.1 and 1.1.0 exist), so a test only passes if the
// pins came from yarn.lock rather than from a fresh resolve.

const verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function fixture(name: string) {
  const { packageDir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: join(import.meta.dir, "yarn-berry", name),
  });
  return packageDir;
}

async function bunLockOf(dir: string) {
  return (await Bun.file(join(dir, "bun.lock")).text()).replaceAll(/(localhost|127\.0\.0\.1):\d+/g, "$1:1234");
}

/** `"name@version"` keys of the `packages` section */
function lockedVersions(bunLock: string): string[] {
  return [...bunLock.matchAll(/^    "[^"]+": \["([^"]+)"/gm)].map(m => m[1]).sort();
}

async function expectFrozenInstall(dir: string) {
  const { stderr, exitCode } = await run(dir, "install", "--frozen-lockfile");
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("migrated lockfile");
  expect(exitCode).toBe(0);
}

describe("yarn berry migration", () => {
  test("npm packages keep the versions yarn.lock pinned", async () => {
    const dir = await fixture("basic");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).toContain("Saved lockfile");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual([
      "@types/is-number@1.0.0",
      "a-dep@1.0.3",
      "no-deps@1.0.0",
      "one-range-dep@1.0.0",
      "peer-deps-fixed@1.0.0",
      "what-bin@1.0.0",
    ]);
    // yarn's `checksum` is not the tarball's hash; integrity comes from the registry manifest
    expect(bunLock).toContain(
      `"no-deps@1.0.0", "http://localhost:1234/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw=="`,
    );
    expect(bunLock).toContain(
      `"peer-deps-fixed@1.0.0", "http://localhost:1234/peer-deps-fixed/-/peer-deps-fixed-1.0.0.tgz", { "peerDependencies": { "no-deps": "^1.0.0" } }`,
    );
    expect(bunLock).toContain(
      `"what-bin@1.0.0", "http://localhost:1234/what-bin/-/what-bin-1.0.0.tgz", { "bin": { "what-bin": "what-bin.js" } }`,
    );
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/@types/is-number/@types/is-number@1.0.0
      node_modules/a-dep/a-dep@1.0.3
      node_modules/no-deps/no-deps@1.0.0
      node_modules/one-range-dep/one-range-dep@1.0.0
      node_modules/peer-deps-fixed/peer-deps-fixed@1.0.0
      node_modules/what-bin/what-bin@1.0.0"
    `);
    expect(existsSync(join(dir, "node_modules", ".bin", "what-bin"))).toBeTrue();

    await expectFrozenInstall(dir);
    // nothing left to re-resolve: a plain install does not touch the lockfile
    const again = await run(dir, "install");
    expect(again.stderr).not.toContain("Saved lockfile");
    expect(again.exitCode).toBe(0);
    expect(await bunLockOf(dir)).toBe(bunLock);
  });

  test("bun pm migrate", async () => {
    const dir = await fixture("basic");

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(exitCode).toBe(0);
    expect(lockedVersions(await bunLockOf(dir))).toEqual([
      "@types/is-number@1.0.0",
      "a-dep@1.0.3",
      "no-deps@1.0.0",
      "one-range-dep@1.0.0",
      "peer-deps-fixed@1.0.0",
      "what-bin@1.0.0",
    ]);
    expect(existsSync(join(dir, "node_modules"))).toBeFalse();

    await expectFrozenInstall(dir);
  });

  test("npm: aliases", async () => {
    const dir = await fixture("aliases");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"aliased": "npm:no-deps@^1.0.0"`);
    expect(bunLock).toContain(`"aliased": ["no-deps@1.0.0", `);
    expect(lockedVersions(bunLock)).toEqual(["no-deps@1.0.0", "no-deps@1.0.1", "no-deps@2.0.0", "one-dep@1.0.0"]);
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/aliased/no-deps@1.0.0
      node_modules/no-deps/no-deps@2.0.0
      node_modules/one-dep/node_modules/no-deps/no-deps@1.0.1
      node_modules/one-dep/one-dep@1.0.0"
    `);

    await expectFrozenInstall(dir);
  });

  test("workspaces and workspace: ranges", async () => {
    const dir = await fixture("workspaces");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(bunLock).toMatchSnapshot();
    expect(lockedVersions(bunLock)).toEqual([
      "@types/is-number@1.0.0",
      "a-dep@1.0.2",
      "no-deps@1.0.0",
      "pkg-a@workspace:packages/pkg-a",
      "pkg-b@workspace:packages/pkg-b",
      "two-range-deps@1.0.0",
    ]);
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/@types/is-number/@types/is-number@1.0.0
      node_modules/a-dep/a-dep@1.0.2
      node_modules/no-deps/no-deps@1.0.0
      node_modules/two-range-deps/two-range-deps@1.0.0
      packages/pkg-a/pkg-a@1.2.3
      packages/pkg-b/pkg-b@2.0.0"
    `);

    await expectFrozenInstall(dir);
  });

  test("patch: protocol becomes patchedDependencies", async () => {
    const dir = await fixture("patch");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await Bun.file(join(dir, "package.json")).json()).toEqual({
      name: "berry-patch",
      dependencies: {
        // the yarn-only `patch:` range is rewritten to the range it patches
        "no-deps": "1.0.0",
        "one-dep": "^1.0.0",
        "optional-native": "^1.0.0",
      },
      resolutions: {
        "one-dep/no-deps": "1.0.1",
      },
      patchedDependencies: {
        "no-deps@1.0.0": ".yarn/patches/no-deps-npm-1.0.0-d5a9b7e1c2.patch",
        "no-deps@1.0.1": ".yarn/patches/no-deps-npm-1.0.1-aa11bb22cc.patch",
      },
    });
    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"patchedDependencies": {
    "no-deps@1.0.0": ".yarn/patches/no-deps-npm-1.0.0-d5a9b7e1c2.patch",
    "no-deps@1.0.1": ".yarn/patches/no-deps-npm-1.0.1-aa11bb22cc.patch",
  },`);
    // yarn's builtin compat patch (optional-native@patch:...#optional!builtin<compat/fsevents>)
    // folds onto the plain package
    expect(lockedVersions(bunLock)).toEqual([
      "native-bar-x64@1.0.0",
      "native-foo-x64@1.0.0",
      "native-foo-x86@1.0.0",
      "native-libc-glibc@1.0.0",
      "native-libc-musl@1.0.0",
      "no-deps@1.0.0",
      "no-deps@1.0.1",
      "one-dep@1.0.0",
      "optional-native@1.0.0",
    ]);
    // `conditions` become os/cpu, so the optional natives for other platforms are skipped
    expect(bunLock).toContain(
      `"native-foo-x64@1.0.0", "http://localhost:1234/native-foo-x64/-/native-foo-x64-1.0.0.tgz", { "os": "none", "cpu": "x64" }`,
    );
    expect(await Bun.file(join(dir, "node_modules", "no-deps", "patched.txt")).text()).toBe("hello world\n");
    expect(
      await Bun.file(join(dir, "node_modules", "one-dep", "node_modules", "no-deps", "patched-too.txt")).text(),
    ).toBe("hello world\n");
    expect((await readdir(join(dir, "node_modules"))).filter(e => e.startsWith("native-")).sort()).toEqual([
      "native-libc-glibc",
      "native-libc-musl",
    ]);

    await expectFrozenInstall(dir);
  });

  test("resolutions that rewrote a descriptor are followed", async () => {
    const dir = await fixture("resolutions");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("bun will resolve");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual(["a-dep@1.0.5", "no-deps@1.0.0", "one-range-dep@1.0.0"]);
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/a-dep/a-dep@1.0.5
      node_modules/no-deps/no-deps@1.0.0
      node_modules/one-range-dep/one-range-dep@1.0.0"
    `);

    await expectFrozenInstall(dir);
  });

  test("file:, portal: and link: dependencies", async () => {
    const dir = await fixture("protocols");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    // bun has no protocol for a symlinked folder outside `workspaces`, so these become copies
    expect(stderr).toContain(`"local-portal@portal:./local-portal" is migrated as "file:local-portal"`);
    expect(stderr).toContain(`"local-link@link:./local-link" is migrated as "file:local-link"`);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect((await Bun.file(join(dir, "package.json")).json()).dependencies).toEqual({
      "local-file": "file:./local-file",
      "local-link": "file:./local-link",
      "local-portal": "file:./local-portal",
    });
    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual([
      "a-dep@1.0.4",
      "local-file@file:local-file",
      "local-link@file:local-link",
      "local-portal@file:local-portal",
      "no-deps@1.0.1",
    ]);
    expect(nodeModulesPackages(join(dir, "node_modules"))).toMatchInlineSnapshot(`
      "a-dep/a-dep@1.0.4
      local-file/local-file@1.0.0
      local-link/local-link@1.0.0
      local-portal/local-portal@1.0.0
      no-deps/no-deps@1.0.1"
    `);

    await expectFrozenInstall(dir);
  });

  test("tarball URL and git resolutions", async () => {
    const registry = verdaccio.registryUrl();
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-urls",
          dependencies: {
            "no-deps": `${registry}no-deps/-/no-deps-2.0.0.tgz`,
            "pkg-a": "git+ssh://git@example.com/org/pkg-a.git#v1",
            hue: "github:org/hue#main",
          },
        }),
        "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"berry-urls@workspace:.":
  version: 0.0.0-use.local
  resolution: "berry-urls@workspace:."
  dependencies:
    hue: "github:org/hue#main"
    no-deps: "${registry}no-deps/-/no-deps-2.0.0.tgz"
    pkg-a: "git+ssh://git@example.com/org/pkg-a.git#v1"
  languageName: unknown
  linkType: soft

"hue@github:org/hue#main":
  version: 0.2.3
  resolution: "hue@https://github.com/org/hue.git#commit=ec3d1d18f73ab023b1fa3e31e1f4316f476566a5"
  languageName: node
  linkType: hard

"no-deps@${registry}no-deps/-/no-deps-2.0.0.tgz":
  version: 2.0.0
  resolution: "no-deps@${registry}no-deps/-/no-deps-2.0.0.tgz"
  languageName: node
  linkType: hard

"pkg-a@git+ssh://git@example.com/org/pkg-a.git#v1":
  version: 1.0.0
  resolution: "pkg-a@git+ssh://git@example.com/org/pkg-a.git#commit=0123456789abcdef0123456789abcdef01234567"
  dependencies:
    no-deps: "${registry}no-deps/-/no-deps-2.0.0.tgz"
  languageName: node
  linkType: hard
`,
      },
    });

    // the git hosts do not exist, so only migrate
    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"no-deps": ["no-deps@http://localhost:1234/no-deps/-/no-deps-2.0.0.tgz", {}]`);
    expect(bunLock).toContain(
      `"pkg-a": ["pkg-a@git+ssh://git@example.com/org/pkg-a.git#0123456789abcdef0123456789abcdef01234567", { "dependencies": { "no-deps": "http://localhost:1234/no-deps/-/no-deps-2.0.0.tgz" } }, "0123456789abcdef0123456789abcdef01234567"]`,
    );
    expect(bunLock).toContain(
      `"hue": ["hue@git+https://github.com/org/hue.git#ec3d1d18f73ab023b1fa3e31e1f4316f476566a5", {}, "ec3d1d18f73ab023b1fa3e31e1f4316f476566a5"]`,
    );
  });

  test("__archiveUrl and npmRegistryServer from .yarnrc.yml decide the tarball URL", async () => {
    // same server, but not the URL bun is configured with, so it is "another registry"
    const other = `http://127.0.0.1:${verdaccio.port}/`;
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-registries",
          dependencies: { "no-deps": "^1.0.0", "a-dep": "^1.0.1" },
        }),
        ".yarnrc.yml": `npmRegistryServer: "${other}"\n`,
        "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"a-dep@npm:^1.0.1":
  version: 1.0.2
  resolution: "a-dep@npm:1.0.2::__archiveUrl=${encodeURIComponent(`${verdaccio.registryUrl()}a-dep/-/a-dep-1.0.2.tgz`)}"
  languageName: node
  linkType: hard

"berry-registries@workspace:.":
  version: 0.0.0-use.local
  resolution: "berry-registries@workspace:."
  dependencies:
    a-dep: "npm:^1.0.1"
    no-deps: "npm:^1.0.0"
  languageName: unknown
  linkType: soft

"no-deps@npm:^1.0.0":
  version: 1.0.0
  resolution: "no-deps@npm:1.0.0"
  languageName: node
  linkType: hard
`,
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain(
      `warn: fetching yarn.lock packages from ${other} (npmRegistryServer in .yarnrc.yml); add it to bunfig.toml or .npmrc if it needs authentication`,
    );
    expect(stderr.match(/npmRegistryServer/g)?.length).toBe(1);
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    // no integrity: the manifest bun fetched is from another registry than the tarball
    expect(bunLock).toContain(`["no-deps@1.0.0", "http://127.0.0.1:1234/no-deps/-/no-deps-1.0.0.tgz", {}, ""]`);
    expect(bunLock).toContain(`["a-dep@1.0.2", "http://localhost:1234/a-dep/-/a-dep-1.0.2.tgz", {}`);
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/a-dep/a-dep@1.0.2
      node_modules/no-deps/no-deps@1.0.0"
    `);

    await expectFrozenInstall(dir);
  });

  test("yarn 3 lockfiles (bare ranges) and unsupported protocols", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-v6",
          dependencies: { "one-range-dep": "^1.0.0", generated: "exec:./gen.js" },
          devDependencies: { "no-deps": "1.0.0" },
        }),
        "yarn.lock": `__metadata:
  version: 6
  cacheKey: 8

"berry-v6@workspace:.":
  version: 0.0.0-use.local
  resolution: "berry-v6@workspace:."
  dependencies:
    generated: "exec:./gen.js"
    no-deps: 1.0.0
    one-range-dep: ^1.0.0
  languageName: unknown
  linkType: soft

"generated@exec:./gen.js::locator=berry-v6%40workspace%3A.":
  version: 1.0.0
  resolution: "generated@exec:./gen.js#./gen.js::hash=3f4a5b&locator=berry-v6%40workspace%3A."
  languageName: node
  linkType: hard

"no-deps@npm:1.0.0, no-deps@npm:^1.0.0":
  version: 1.0.0
  resolution: "no-deps@npm:1.0.0"
  checksum: 8c0aa9a3b3c1b6da2b1e0d5a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f
  languageName: node
  linkType: hard

"one-range-dep@npm:^1.0.0":
  version: 1.0.0
  resolution: "one-range-dep@npm:1.0.0"
  dependencies:
    no-deps: ^1.0.0
  languageName: node
  linkType: hard
`,
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain(
      `warn: skipped "generated@exec:./gen.js#./gen.js::hash=3f4a5b&locator=berry-v6%40workspace%3A." from yarn.lock: unsupported protocol`,
    );
    expect(stderr).toContain(
      `warn: yarn.lock has no entry for 1 dependency (e.g. "generated@exec:./gen.js"); bun will resolve it`,
    );
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual(["no-deps@1.0.0", "one-range-dep@1.0.0"]);
    expect(bunLock).toContain(
      `"one-range-dep@1.0.0", "http://localhost:1234/one-range-dep/-/one-range-dep-1.0.0.tgz", { "dependencies": { "no-deps": "^1.0.0" } }`,
    );
  });

  test("an invalid berry lockfile is reported and bun resolves from package.json", async () => {
    const dir = await fixture("malformed");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain(`yarn.lock entry "no-deps@npm:^1.0.0" has no resolution`);
    expect(stderr).toContain("InvalidYarnBerryLockfile: failed to migrate lockfile: 'yarn.lock'");
    expect(stderr).not.toContain("migrated lockfile from yarn.lock");
    expect(exitCode).toBe(0);
    // resolved fresh: the newest 1.x, not the 1.0.0 the broken lockfile named
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`"node_modules/no-deps/no-deps@1.1.0"`);
  });

  test("catalog: ranges from .yarnrc.yml", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-catalog",
          workspaces: ["packages/*"],
          dependencies: { "no-deps": "catalog:", "a-dep": "catalog:pinned" },
        }),
        "packages/pkg-a/package.json": JSON.stringify({
          name: "pkg-a",
          version: "1.0.0",
          dependencies: { "no-deps": "catalog:" },
        }),
        ".yarnrc.yml": `nodeLinker: node-modules

catalog:
  no-deps: ^1.0.0

catalogs:
  pinned:
    a-dep: ~1.0.2
`,
        "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"a-dep@npm:~1.0.2":
  version: 1.0.4
  resolution: "a-dep@npm:1.0.4"
  languageName: node
  linkType: hard

"berry-catalog@workspace:.":
  version: 0.0.0-use.local
  resolution: "berry-catalog@workspace:."
  dependencies:
    a-dep: "catalog:pinned"
    no-deps: "catalog:"
  languageName: unknown
  linkType: soft

"no-deps@npm:^1.0.0":
  version: 1.0.1
  resolution: "no-deps@npm:1.0.1"
  languageName: node
  linkType: hard

"pkg-a@workspace:packages/pkg-a":
  version: 0.0.0-use.local
  resolution: "pkg-a@workspace:packages/pkg-a"
  dependencies:
    no-deps: "catalog:"
  languageName: unknown
  linkType: soft
`,
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect((await Bun.file(join(dir, "package.json")).json()).workspaces).toEqual({
      packages: ["packages/*"],
      catalog: { "no-deps": "^1.0.0" },
      catalogs: { pinned: { "a-dep": "~1.0.2" } },
    });
    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual(["a-dep@1.0.4", "no-deps@1.0.1", "pkg-a@workspace:packages/pkg-a"]);
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/a-dep/a-dep@1.0.4
      node_modules/no-deps/no-deps@1.0.1
      packages/pkg-a/pkg-a@1.0.0"
    `);

    await expectFrozenInstall(dir);
  });
});
