import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { readdir, rm } from "fs/promises";
import { bunEnv, bunExe, nodeModulesPackages, normalizeBunSnapshot, toBeValidBin, VerdaccioRegistry } from "harness";
import { join } from "path";

// Migration of yarn 2+ ("berry") lockfiles. Every fixture pins versions that are
// NOT the newest ones the registry has for the requested ranges (e.g. no-deps@^1.0.0
// is locked to 1.0.0 while 1.0.1 and 1.1.0 exist), so a test only passes if the
// pins came from yarn.lock rather than from a fresh resolve.

expect.extend({ toBeValidBin });

const verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

async function run(cwd: string, ...args: string[]) {
  return runWithEnv(cwd, {}, ...args);
}

async function runWithEnv(cwd: string, env: Record<string, string>, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    // yarn also reads the rc file of the home folder; keep the machine's own out of the tests
    env: { ...bunEnv, HOME: cwd, USERPROFILE: cwd, ...env },
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

/** yarn.lock text from `key -> the lines of that entry` */
function yarnLock(entries: Record<string, string[]>, version: number | string = 8) {
  return (
    `__metadata:\n  version: ${version}\n  cacheKey: 10c0\n` +
    Object.entries(entries)
      .map(([key, lines]) => `\n${JSON.stringify(key)}:\n${lines.map(line => `  ${line}\n`).join("")}`)
      .join("")
  );
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
  test.concurrent("npm packages keep the versions yarn.lock pinned", async () => {
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
    expect(bunLock).not.toContain("trustedDependencies");
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
    // what-bin is in dependencies (^1.5.0) and optionalDependencies (^1.0.0): the optional entry wins, as in bun
    expect(bunLock).not.toContain(`"what-bin": "^1.5.0"`);
    expect(bunLock).toContain(`"what-bin": "^1.0.0"`);
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/@types/is-number/@types/is-number@1.0.0
      node_modules/a-dep/a-dep@1.0.3
      node_modules/no-deps/no-deps@1.0.0
      node_modules/one-range-dep/one-range-dep@1.0.0
      node_modules/peer-deps-fixed/peer-deps-fixed@1.0.0
      node_modules/what-bin/what-bin@1.0.0"
    `);
    expect(join(dir, "node_modules", ".bin", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));

    await expectFrozenInstall(dir);
    // nothing left to re-resolve: a plain install does not touch the lockfile
    const again = await run(dir, "install");
    expect(again.stderr).not.toContain("Saved lockfile");
    expect(again.exitCode).toBe(0);
    expect(await bunLockOf(dir)).toBe(bunLock);
  });

  test.concurrent("bun pm migrate", async () => {
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

  test.concurrent("npm: aliases", async () => {
    const dir = await fixture("aliases");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"aliased": "npm:no-deps@^1.0.0"`);
    expect(bunLock).toContain(`"aliased": ["no-deps@1.0.0", `);
    // targets starting with `v` or a digit are still aliases, not `v1.2.3` / `1.2.3` ranges
    expect(bunLock).toContain(`"v-alias": "npm:various-requires@^1.0.0"`);
    expect(bunLock).toContain(`"v-alias": ["various-requires@1.0.0", `);
    expect(bunLock).toContain(`"seven": "npm:7-no-deps@^1.0.0"`);
    expect(bunLock).toContain(`"seven": ["7-no-deps@1.0.0", `);
    expect(lockedVersions(bunLock)).toEqual([
      "7-no-deps@1.0.0",
      "no-deps@1.0.0",
      "no-deps@1.0.1",
      "no-deps@2.0.0",
      "one-dep@1.0.0",
      "various-requires@1.0.0",
    ]);
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/aliased/no-deps@1.0.0
      node_modules/no-deps/no-deps@2.0.0
      node_modules/one-dep/node_modules/no-deps/no-deps@1.0.1
      node_modules/one-dep/one-dep@1.0.0
      node_modules/seven/7-no-deps@1.0.0
      node_modules/v-alias/various-requires@1.0.0"
    `);

    await expectFrozenInstall(dir);
  });

  // not concurrent: file snapshot matchers are unsupported in concurrent tests
  test("workspaces and workspace: ranges", async () => {
    const dir = await fixture("workspaces");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(normalizeBunSnapshot(bunLock, dir)).toMatchSnapshot();
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

  test.concurrent("patch: protocol becomes patchedDependencies", async () => {
    const dir = await fixture("patch");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    // the builtin compat patch that wraps the user patch (listed first in the fixture) folds too
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
      // the fixture already lists the first patch for bun; the second is merged in
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

  test.concurrent("package.json is written with the lockfile, not before", async () => {
    // --dry-run writes no package.json, so a migration that has to edit it is not done
    const dryDir = await fixture("patch");
    const before = await Bun.file(join(dryDir, "package.json")).text();
    const dry = await run(dryDir, "install", "--dry-run");
    expect(dry.stderr).toContain(
      "error: migrating yarn.lock has to edit package.json (rewrote patch:/portal:/link: ranges, added patchedDependencies), and this command does not write package.json",
    );
    expect(await Bun.file(join(dryDir, "package.json")).text()).toBe(before);
    expect(existsSync(join(dryDir, "bun.lock"))).toBeFalse();

    // --lockfile-only saves bun.lock, so it writes package.json too
    const lockOnlyDir = await fixture("patch");
    const lockOnly = await run(lockOnlyDir, "install", "--lockfile-only");
    expect(lockOnly.stderr).toContain("migrated lockfile from yarn.lock");
    expect(lockOnly.stderr).not.toContain("error:");
    expect((await Bun.file(join(lockOnlyDir, "package.json")).json()).dependencies["no-deps"]).toBe("1.0.0");
    expect(lockOnly.exitCode).toBe(0);
    await expectFrozenInstall(lockOnlyDir);

    // `bun remove` as the first command writes its own edit and the migration's
    const dir = await fixture("patch");
    const { stderr, exitCode } = await run(dir, "remove", "optional-native");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(await Bun.file(join(dir, "package.json")).json()).toEqual({
      name: "berry-patch",
      dependencies: { "no-deps": "1.0.0", "one-dep": "^1.0.0" },
      resolutions: { "one-dep/no-deps": "1.0.1" },
      patchedDependencies: {
        "no-deps@1.0.0": ".yarn/patches/no-deps-npm-1.0.0-d5a9b7e1c2.patch",
        "no-deps@1.0.1": ".yarn/patches/no-deps-npm-1.0.1-aa11bb22cc.patch",
      },
    });
    expect(lockedVersions(await bunLockOf(dir))).toEqual(["no-deps@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"]);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
  });

  test.concurrent("resolutions that rewrote a descriptor are followed", async () => {
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

  test.concurrent("a parent/name resolution only rebinds that parent's edge", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-scoped-resolution",
          dependencies: { "@scoped/create-test-app": "^1.0.0", "one-fixed-dep": "^1.0.0", "one-range-dep": "^1.0.0" },
          // create-test-app and one-fixed-dep ask for no-deps@1.0.0, one-range-dep for ^1.0.0 (which
          // yarn had to rewrite for an unrelated reason); only create-test-app's copy is redirected.
          // `parent@<version>` names the parent's locked version, as yarn matches it.
          resolutions: { "@scoped/create-test-app@npm:1.0.0/no-deps": "1.0.1", "no-deps@npm:^1.0.0": "1.0.0" },
        }),
        "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"@scoped/create-test-app@npm:^1.0.0":
  version: 1.0.0
  resolution: "@scoped/create-test-app@npm:1.0.0"
  dependencies:
    no-deps: "npm:1.0.0"
  bin:
    create-test-app: bin.js
  languageName: node
  linkType: hard

"berry-scoped-resolution@workspace:.":
  version: 0.0.0-use.local
  resolution: "berry-scoped-resolution@workspace:."
  dependencies:
    "@scoped/create-test-app": "npm:^1.0.0"
    one-fixed-dep: "npm:^1.0.0"
    one-range-dep: "npm:^1.0.0"
  languageName: unknown
  linkType: soft

"no-deps@npm:1.0.0":
  version: 1.0.0
  resolution: "no-deps@npm:1.0.0"
  languageName: node
  linkType: hard

"no-deps@npm:1.0.1":
  version: 1.0.1
  resolution: "no-deps@npm:1.0.1"
  languageName: node
  linkType: hard

"one-fixed-dep@npm:^1.0.0":
  version: 1.0.0
  resolution: "one-fixed-dep@npm:1.0.0"
  dependencies:
    no-deps: "npm:1.0.0"
  languageName: node
  linkType: hard

"one-range-dep@npm:^1.0.0":
  version: 1.0.0
  resolution: "one-range-dep@npm:1.0.0"
  dependencies:
    no-deps: "npm:^1.0.0"
  languageName: node
  linkType: hard
`,
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("bun will resolve");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"no-deps": ["no-deps@1.0.1", `);
    expect(bunLock).toContain(`"one-fixed-dep/no-deps": ["no-deps@1.0.0", `);
    expect(lockedVersions(bunLock)).toEqual([
      "@scoped/create-test-app@1.0.0",
      "no-deps@1.0.0",
      "no-deps@1.0.0",
      "no-deps@1.0.1",
      "one-fixed-dep@1.0.0",
      "one-range-dep@1.0.0",
    ]);
    expect(bunLock).toContain(`"one-range-dep/no-deps": ["no-deps@1.0.0", `);
    // one-range-dep's `no-deps@^1.0.0` goes through the unscoped resolution (1.0.0); the
    // scoped one (1.0.1) is not considered for it
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/@scoped/create-test-app/@scoped/create-test-app@1.0.0
      node_modules/no-deps/no-deps@1.0.1
      node_modules/one-fixed-dep/node_modules/no-deps/no-deps@1.0.0
      node_modules/one-fixed-dep/one-fixed-dep@1.0.0
      node_modules/one-range-dep/node_modules/no-deps/no-deps@1.0.0
      node_modules/one-range-dep/one-range-dep@1.0.0"
    `);

    await expectFrozenInstall(dir);
  });

  test.concurrent("a parent@range/name resolution only applies to the parent locked from that range", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-ranged-parent",
          dependencies: { "one-fixed-dep": "1.0.0", "one-fixed-dep-2": "npm:one-fixed-dep@2.0.0" },
          // one-fixed-dep@1.0.0 wants no-deps@1.0.0 and gets 1.0.1; one-fixed-dep@2.0.0 keeps no-deps@2.0.0
          resolutions: { "one-fixed-dep@npm:1.0.0/no-deps": "1.0.1" },
        }),
        "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"berry-ranged-parent@workspace:.":
  version: 0.0.0-use.local
  resolution: "berry-ranged-parent@workspace:."
  dependencies:
    one-fixed-dep: "npm:1.0.0"
    one-fixed-dep-2: "npm:one-fixed-dep@2.0.0"
  languageName: unknown
  linkType: soft

"no-deps@npm:1.0.1":
  version: 1.0.1
  resolution: "no-deps@npm:1.0.1"
  languageName: node
  linkType: hard

"no-deps@npm:2.0.0":
  version: 2.0.0
  resolution: "no-deps@npm:2.0.0"
  languageName: node
  linkType: hard

"one-fixed-dep-2@npm:one-fixed-dep@2.0.0":
  version: 2.0.0
  resolution: "one-fixed-dep@npm:2.0.0"
  dependencies:
    no-deps: "npm:2.0.0"
  languageName: node
  linkType: hard

"one-fixed-dep@npm:1.0.0":
  version: 1.0.0
  resolution: "one-fixed-dep@npm:1.0.0"
  dependencies:
    no-deps: "npm:1.0.0"
  languageName: node
  linkType: hard
`,
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("bun will resolve");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual([
      "no-deps@1.0.1",
      "no-deps@2.0.0",
      "one-fixed-dep@1.0.0",
      "one-fixed-dep@2.0.0",
    ]);
    // each parent got its own copy: one-fixed-dep@1.0.0 resolves the hoisted, redirected
    // 1.0.1; the alias of one-fixed-dep@2.0.0 keeps its untouched 2.0.0 nested
    expect(bunLock).toContain(`"no-deps": ["no-deps@1.0.1", `);
    expect(bunLock).toContain(`"one-fixed-dep-2/no-deps": ["no-deps@2.0.0", `);
    expect(existsSync(join(dir, "node_modules", "one-fixed-dep", "node_modules"))).toBeFalse();
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/no-deps/no-deps@1.0.1
      node_modules/one-fixed-dep-2/node_modules/no-deps/no-deps@2.0.0
      node_modules/one-fixed-dep-2/one-fixed-dep@2.0.0
      node_modules/one-fixed-dep/one-fixed-dep@1.0.0"
    `);

    await expectFrozenInstall(dir);
  });

  test.concurrent("file:, portal: and link: dependencies", async () => {
    const dir = await fixture("protocols");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    // bun has no protocol for a symlinked folder outside `workspaces`, so these become copies
    expect(stderr).toContain(`"local-portal@portal:./local-portal" is migrated as "file:local-portal"`);
    // a bare `link:dir` (no `./`) is still yarn's folder link, not a `bun link` name
    expect(stderr).toContain(`"local-link@link:local-link" is migrated as "file:local-link"`);
    expect(stderr).not.toContain("bun will resolve");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const manifest = await Bun.file(join(dir, "package.json")).json();
    expect(manifest.dependencies).toEqual({
      "local-file": "file:./local-file",
      "local-link": "file:local-link",
      "local-portal": "file:./local-portal",
    });
    // a `portal:` target of a resolution is rewritten too
    expect(manifest.resolutions).toEqual({ "a-dep": "file:./local-a-dep" });
    const bunLock = await bunLockOf(dir);
    // `sub` is declared by the portal package with a path relative to it
    expect(lockedVersions(bunLock)).toEqual([
      "a-dep@file:local-a-dep",
      "local-file@file:local-file",
      "local-link@file:local-link",
      "local-portal@file:local-portal",
      "no-deps@1.0.1",
      "sub@file:local-portal/sub",
    ]);
    // bun keeps transitive folder dependencies under the package that declares them
    expect(nodeModulesPackages(join(dir, "node_modules"))).toMatchInlineSnapshot(`
      "local-file/local-file@1.0.0
      local-link/local-link@1.0.0
      local-portal/local-portal@1.0.0
      local-portal/node_modules/a-dep/a-dep@9.9.9
      local-portal/node_modules/sub/sub@1.0.0
      local-portal/sub/sub@1.0.0
      no-deps/no-deps@1.0.1"
    `);

    await expectFrozenInstall(dir);

    // An install that fails after the migration leaves the rewritten package.json and no
    // bun.lock. The next migration reads its own `file:` spelling of `portal:` / `link:`.
    await rm(join(dir, "bun.lock"));
    const again = await run(dir, "pm", "migrate");
    expect(again.stderr).toContain("migrated lockfile from yarn.lock");
    expect(again.stderr).not.toContain("error:");
    // (`configVersion` differs between `bun install` and `bun pm migrate`)
    const packagesOf = (lock: string) => lock.slice(lock.indexOf(`"packages": {`));
    expect(packagesOf(await bunLockOf(dir))).toBe(packagesOf(bunLock));
    expect(again.exitCode).toBe(0);
  });

  test.concurrent("tarball URL and git resolutions", async () => {
    const registry = verdaccio.registryUrl();
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-urls",
          dependencies: {
            // a patch on a non-npm package is keyed by its resolution
            "no-deps": `patch:no-deps@${encodeURIComponent(`${registry}no-deps/-/no-deps-2.0.0.tgz`)}#./patches/no-deps.patch`,
            "pkg-a": "git+ssh://git@example.com/org/pkg-a.git#v1",
            hue: "github:org/hue#main",
          },
          // pkg-a asks for pkg-b@^2.0.0; the resolution redirects it to a git commit
          resolutions: { "pkg-b": "git+ssh://git@example.com/org/pkg-b.git#v2" },
        }),
        "patches/no-deps.patch": "",
        "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"berry-urls@workspace:.":
  version: 0.0.0-use.local
  resolution: "berry-urls@workspace:."
  dependencies:
    hue: "github:org/hue#main"
    no-deps: "patch:no-deps@${encodeURIComponent(`${registry}no-deps/-/no-deps-2.0.0.tgz`)}#./patches/no-deps.patch::locator=berry-urls%40workspace%3A."
    pkg-a: "git+ssh://git@example.com/org/pkg-a.git#v1"
  languageName: unknown
  linkType: soft

"no-deps@patch:no-deps@${encodeURIComponent(`${registry}no-deps/-/no-deps-2.0.0.tgz`)}#./patches/no-deps.patch::locator=berry-urls%40workspace%3A.":
  version: 2.0.0
  resolution: "no-deps@patch:no-deps@${encodeURIComponent(`${registry}no-deps/-/no-deps-2.0.0.tgz`)}#./patches/no-deps.patch::version=2.0.0&hash=5e4d3c&locator=berry-urls%40workspace%3A."
  languageName: node
  linkType: hard

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
    pkg-b: "npm:^2.0.0"
  languageName: node
  linkType: hard

"pkg-b@git+ssh://git@example.com/org/pkg-b.git#v2":
  version: 2.0.0
  resolution: "pkg-b@git+ssh://git@example.com/org/pkg-b.git#commit=89abcdef0123456789abcdef0123456789abcdef"
  languageName: node
  linkType: hard
`,
      },
    });

    // the git hosts do not exist, so only migrate
    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("bun will resolve");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const manifest = await Bun.file(join(dir, "package.json")).json();
    expect(manifest.dependencies["no-deps"]).toBe(`${registry}no-deps/-/no-deps-2.0.0.tgz`);
    expect(manifest.patchedDependencies).toEqual({
      [`no-deps@${registry}no-deps/-/no-deps-2.0.0.tgz`]: "patches/no-deps.patch",
    });
    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"no-deps": ["no-deps@http://localhost:1234/no-deps/-/no-deps-2.0.0.tgz", {}]`);
    expect(bunLock).toContain(`"no-deps@http://localhost:1234/no-deps/-/no-deps-2.0.0.tgz": "patches/no-deps.patch",`);
    expect(bunLock).toContain(
      `"pkg-a": ["pkg-a@git+ssh://git@example.com/org/pkg-a.git#0123456789abcdef0123456789abcdef01234567", { "dependencies": { "no-deps": "http://localhost:1234/no-deps/-/no-deps-2.0.0.tgz", "pkg-b": "^2.0.0" } }, "0123456789abcdef0123456789abcdef01234567"]`,
    );
    expect(bunLock).toContain(
      `"pkg-b": ["pkg-b@git+ssh://git@example.com/org/pkg-b.git#89abcdef0123456789abcdef0123456789abcdef", {}, "89abcdef0123456789abcdef0123456789abcdef"]`,
    );
    expect(bunLock).toContain(
      `"hue": ["hue@git+https://github.com/org/hue.git#ec3d1d18f73ab023b1fa3e31e1f4316f476566a5", {}, "ec3d1d18f73ab023b1fa3e31e1f4316f476566a5"]`,
    );
  });

  test.concurrent(
    "__archiveUrl under the configured registry keeps its URL and gets the manifest's integrity",
    async () => {
      const { packageDir: dir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "berry-registries", dependencies: { "a-dep": "^1.0.1" } }),
          // the same registry bun is configured with; the scope is one the lockfile does not use
          ".yarnrc.yml": `npmRegistryServer: "${verdaccio.registryUrl()}"\nnpmScopes:\n  unused:\n    npmRegistryServer: "\${UNUSED_REGISTRY}"\n`,
          "yarn.lock": yarnLock({
            "a-dep@npm:^1.0.1": [
              `resolution: "a-dep@npm:1.0.2::__archiveUrl=${encodeURIComponent(`${verdaccio.registryUrl()}a-dep/-/a-dep-1.0.2.tgz`)}"`,
            ],
            "berry-registries@workspace:.": [
              `resolution: "berry-registries@workspace:."`,
              `dependencies:`,
              `  a-dep: "npm:^1.0.1"`,
            ],
          }),
        },
      });

      const { stderr, exitCode } = await run(dir, "install");
      expect(stderr).toContain("migrated lockfile from yarn.lock");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await bunLockOf(dir)).toContain(
        `["a-dep@1.0.2", "http://localhost:1234/a-dep/-/a-dep-1.0.2.tgz", {}, "sha512-786lp/Wqdz6jY9NOPFnU2OZAl/7wW/CWCHNn4I+0Or9NtA0F9I1TXtisuy8hMFw/6u6CYXwlzdwySiOdpJ94oQ=="]`,
      );
      await expectFrozenInstall(dir);
    },
  );

  test.concurrent("yarn 2/3 lockfiles: bare ranges, and ranges YAML reads as numbers", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-v6",
          dependencies: { "one-range-dep": "^1.0.0", "one-fixed-dep": "^1.0.0" },
          devDependencies: { "no-deps": "1.0.0" },
        }),
        // yarn 2 and 3 write ranges without the `npm:` prefix and without quotes, so `1` and
        // `1.0` are YAML numbers (and the same number). Yarn reads them as the text.
        "yarn.lock": `__metadata:
  version: 6
  cacheKey: 8

"berry-v6@workspace:.":
  version: 0.0.0-use.local
  resolution: "berry-v6@workspace:."
  dependencies:
    no-deps: 1.0.0
    one-fixed-dep: ^1.0.0
    one-range-dep: ^1.0.0
  languageName: unknown
  linkType: soft

"no-deps@npm:1":
  version: 1.1.0
  resolution: "no-deps@npm:1.1.0"
  languageName: node
  linkType: hard

"no-deps@npm:1.0":
  version: 1.0.1
  resolution: "no-deps@npm:1.0.1"
  languageName: node
  linkType: hard

"no-deps@npm:1.0.0":
  version: 1.0.0
  resolution: "no-deps@npm:1.0.0"
  checksum: 8c0aa9a3b3c1b6da2b1e0d5a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f
  languageName: node
  linkType: hard

"one-fixed-dep@npm:^1.0.0":
  version: 1.0.0
  resolution: "one-fixed-dep@npm:1.0.0"
  dependencies:
    no-deps: 1.0
  languageName: node
  linkType: hard

"one-range-dep@npm:^1.0.0":
  version: 1.0.0
  resolution: "one-range-dep@npm:1.0.0"
  dependencies:
    no-deps: 1
  languageName: node
  linkType: hard
`,
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual([
      "no-deps@1.0.0",
      "no-deps@1.0.1",
      "no-deps@1.1.0",
      "one-fixed-dep@1.0.0",
      "one-range-dep@1.0.0",
    ]);
    expect(bunLock).toContain(
      `"one-fixed-dep@1.0.0", "http://localhost:1234/one-fixed-dep/-/one-fixed-dep-1.0.0.tgz", { "dependencies": { "no-deps": "1.0" } }`,
    );
    expect(bunLock).toContain(
      `"one-range-dep@1.0.0", "http://localhost:1234/one-range-dep/-/one-range-dep-1.0.0.tgz", { "dependencies": { "no-deps": "1" } }`,
    );
    expect(bunLock).toContain(`"one-fixed-dep/no-deps": ["no-deps@1.0.1", `);
    expect(bunLock).toContain(`"one-range-dep/no-deps": ["no-deps@1.1.0", `);
  });

  test.concurrent("an invalid berry lockfile is reported and bun resolves from package.json", async () => {
    const dir = await fixture("malformed");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain(`yarn.lock entry "no-deps@npm:^1.0.0" has no resolution`);
    expect(stderr).toContain("InvalidYarnBerryLockfile: failed to migrate lockfile: 'yarn.lock'");
    expect(stderr).not.toContain("migrated lockfile from yarn.lock");
    expect(exitCode).toBe(0);
    // resolved fresh: the newest 1.x, not the 1.0.0 the broken lockfile named
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`"node_modules/no-deps/no-deps@1.1.0"`);
  });

  test.concurrent("catalog: ranges from .yarnrc.yml", async () => {
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
  no-deps: "npm:^1.0.0"

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

  // What yarn.lock pins and bun cannot keep fails the migration; nothing is written.
  const rootEntry = (deps: string[]) => [`resolution: "berry-reject@workspace:."`, `dependencies:`, ...deps];
  const noDeps100 = { "no-deps@npm:^1.0.0": [`resolution: "no-deps@npm:1.0.0"`] };
  const rejected: {
    name: string;
    manifest?: object;
    files?: () => Record<string, string>;
    lock: () => string;
    error: () => string;
  }[] = [
    {
      name: "a dependency with no entry",
      manifest: { dependencies: { "no-deps": "^1.0.0", "a-dep": "^1.0.1" } },
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () => `error: yarn.lock has no entry for "a-dep@^1.0.1", a dependency of "berry-reject"`,
    },
    {
      name: "a resolutions rule whose target has no entry",
      manifest: { dependencies: { "no-deps": "^1.0.0" }, resolutions: { "no-deps": "2.0.0" } },
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () => `error: yarn.lock has no entry for "no-deps@^1.0.0", a dependency of "berry-reject"`,
    },
    {
      name: "a protocol bun does not have",
      manifest: { dependencies: { generated: "exec:./gen.js" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  generated: "exec:./gen.js"`]),
          "generated@exec:./gen.js::locator=berry-reject%40workspace%3A.": [
            `resolution: "generated@exec:./gen.js#./gen.js::hash=3f4a5b&locator=berry-reject%40workspace%3A."`,
          ],
        }),
      error: () =>
        `error: yarn.lock entry "generated@exec:./gen.js#./gen.js::hash=3f4a5b&locator=berry-reject%40workspace%3A." uses a protocol bun does not support`,
    },
    {
      name: "a package inside a git repository",
      manifest: { dependencies: { sub: "git@example.com:org/mono.git#workspace=sub" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  sub: "git@example.com:org/mono.git#workspace=sub"`]),
          "sub@git@example.com:org/mono.git#workspace=sub": [
            `resolution: "sub@git@example.com:org/mono.git#workspace=sub&commit=0123456789abcdef0123456789abcdef01234567"`,
          ],
        }),
      error: () =>
        `error: yarn.lock entry "sub@git@example.com:org/mono.git#workspace=sub&commit=0123456789abcdef0123456789abcdef01234567" is a package inside a git repository, which bun does not support`,
    },
    {
      name: "a patch on a folder dependency",
      manifest: { dependencies: { local: "patch:local@portal%3A./local#./patches/local.patch" } },
      files: () => ({
        "local/package.json": JSON.stringify({ name: "local", version: "1.0.0" }),
        "patches/local.patch": "",
      }),
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  local: "patch:local@portal%3A./local#./patches/local.patch"`]),
          "local@patch:local@portal%3A./local#./patches/local.patch::locator=berry-reject%40workspace%3A.": [
            `resolution: "local@patch:local@portal%3A./local%3A%3Alocator=berry-reject%2540workspace%253A.#./patches/local.patch::version=1.0.0&hash=1f2e3d&locator=berry-reject%40workspace%3A."`,
          ],
          "local@portal:./local::locator=berry-reject%40workspace%3A.": [
            `resolution: "local@portal:./local::locator=berry-reject%40workspace%3A."`,
          ],
        }),
      error: () =>
        `error: yarn.lock patches "local" with "patches/local.patch"; bun does not patch packages installed from a project folder`,
    },
    {
      name: "two patch files for one package",
      manifest: { dependencies: { "no-deps": "patch:no-deps@npm%3A1.0.0#~/a.patch&~/b.patch" } },
      files: () => ({ "a.patch": "", "b.patch": "" }),
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "patch:no-deps@npm%3A1.0.0#~/a.patch&~/b.patch"`]),
          "no-deps@npm:1.0.0": [`resolution: "no-deps@npm:1.0.0"`],
          "no-deps@patch:no-deps@npm%3A1.0.0#~/a.patch&~/b.patch": [
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.0#~/a.patch&~/b.patch::version=1.0.0&hash=7a6b5c"`,
          ],
        }),
      error: () => `error: yarn.lock patches "no-deps@1.0.0" with 2 files ("a.patch", ...)`,
    },
    {
      name: "two different patches for one package",
      manifest: {
        dependencies: { "no-deps": "patch:no-deps@npm%3A1.0.0#~/a.patch", "one-dep": "^1.0.0" },
        resolutions: { "one-dep/no-deps": "patch:no-deps@npm%3A1.0.0#~/b.patch" },
      },
      files: () => ({ "a.patch": "", "b.patch": "" }),
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([
            `  no-deps: "patch:no-deps@npm%3A1.0.0#~/a.patch"`,
            `  one-dep: "npm:^1.0.0"`,
          ]),
          "no-deps@npm:1.0.0": [`resolution: "no-deps@npm:1.0.0"`],
          "no-deps@patch:no-deps@npm%3A1.0.0#~/a.patch": [
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.0#~/a.patch::version=1.0.0&hash=1a2b3c"`,
          ],
          "no-deps@patch:no-deps@npm%3A1.0.0#~/b.patch": [
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.0#~/b.patch::version=1.0.0&hash=4d5e6f"`,
          ],
          "one-dep@npm:^1.0.0": [`resolution: "one-dep@npm:1.0.0"`, `dependencies:`, `  no-deps: "npm:1.0.1"`],
        }),
      error: () => `error: yarn.lock patches "no-deps@1.0.0" with both "a.patch" and "b.patch"`,
    },
    {
      name: "a patch file outside the project",
      manifest: { dependencies: { "no-deps": "patch:no-deps@npm%3A1.0.0#~/../outside.patch" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "patch:no-deps@npm%3A1.0.0#~/../outside.patch"`]),
          "no-deps@npm:1.0.0": [`resolution: "no-deps@npm:1.0.0"`],
          "no-deps@patch:no-deps@npm%3A1.0.0#~/../outside.patch": [
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.0#~/../outside.patch::version=1.0.0&hash=1a2b3c"`,
          ],
        }),
      error: () => `error: yarn.lock patch file "../outside.patch" is not a file inside the project`,
    },
    {
      name: "a patch with an empty path",
      manifest: { dependencies: { "no-deps": "patch:no-deps@npm%3A1.0.0#~/" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "patch:no-deps@npm%3A1.0.0#~/"`]),
          "no-deps@npm:1.0.0": [`resolution: "no-deps@npm:1.0.0"`],
          "no-deps@patch:no-deps@npm%3A1.0.0#~/": [
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.0#~/::version=1.0.0&hash=1a2b3c"`,
          ],
        }),
      error: () => `error: yarn.lock patch file "" is not a file inside the project`,
    },
    {
      name: "a workspace package.json does not list",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]),
          ...noDeps100,
          "pkg-x@workspace:packages/pkg-x": [`resolution: "pkg-x@workspace:packages/pkg-x"`],
        }),
      error: () => `error: yarn.lock workspace "packages/pkg-x" is not one of the package.json "workspaces"`,
    },
    {
      name: "a lockfile version newer than yarn 4's",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }, 11),
      error: () => `error: yarn.lock version 11 is not supported`,
    },
    {
      name: "a field written twice (yarn reads the last, bun the first)",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]),
          "no-deps@npm:^1.0.0": [`resolution: "no-deps@npm:1.0.1"`, `resolution: "no-deps@npm:1.0.0"`],
        }),
      error: () => `error: yarn.lock has the key "resolution" more than once in one mapping`,
    },
    {
      name: "a descriptor in two entries",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]),
          ...noDeps100,
          "no-deps@npm:1.0.1, no-deps@npm:^1.0.0": [`resolution: "no-deps@npm:1.0.1"`],
        }),
      error: () => `error: yarn.lock has more than one entry for "no-deps@npm:^1.0.0"`,
    },
    {
      name: "a YAML merge key (bun expands it, yarn does not)",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]),
          "no-deps@npm:^1.0.0": [`<<: { resolution: "no-deps@npm:1.0.1" }`, `resolution: "no-deps@npm:1.0.0"`],
        }),
      error: () => `error: yarn.lock has a "<<" merge key`,
    },
    {
      name: "a merge key spelled with an escape",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]),
          "no-deps@npm:^1.0.0": [
            `"\\x3c\\x3C": { resolution: "no-deps@npm:1.0.1" }`,
            `resolution: "no-deps@npm:1.0.0"`,
          ],
        }),
      error: () => `error: yarn.lock has a "<<" merge key`,
    },
    {
      name: "npmRegistryServer in .yarnrc.yml that is not bun's registry",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      // the same server under another name: to bun it is another registry
      files: () => ({ ".yarnrc.yml": `npmRegistryServer: "http://127.0.0.1:${verdaccio.port}/"\n` }),
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () =>
        `error: yarn fetches "no-deps" from http://127.0.0.1:${verdaccio.port}/ and bun is configured to fetch it from ${verdaccio.registryUrl()}; add the registry to bunfig.toml or .npmrc`,
    },
    {
      name: "a scope registry in .yarnrc.yml that is not bun's",
      manifest: { dependencies: { "@types/is-number": "^1.0.0", "no-deps": "^1.0.0" } },
      files: () => ({
        ".yarnrc.yml": `npmScopes:\n  types:\n    npmRegistryServer: "http://127.0.0.1:${verdaccio.port}/"\n`,
      }),
      lock: () =>
        yarnLock({
          "@types/is-number@npm:^1.0.0": [`resolution: "@types/is-number@npm:1.0.0"`],
          "berry-reject@workspace:.": rootEntry([`  "@types/is-number": "npm:^1.0.0"`, `  no-deps: "npm:^1.0.0"`]),
          ...noDeps100,
        }),
      error: () => `error: yarn fetches "@types/is-number" from http://127.0.0.1:${verdaccio.port}/`,
    },
    {
      name: "a registry spelled with an environment variable",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      files: () => ({ ".yarnrc.yml": `npmRegistryServer: "\${REGISTRY}"\n` }),
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () =>
        `error: yarn's registry for "no-deps" uses an environment variable ("\${REGISTRY}"); bun cannot tell if it is the registry bun is configured with`,
    },
    {
      name: "the @jsr scope, which yarn fetches from npm.jsr.io by default",
      manifest: { dependencies: { "@jsr/std__path": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "@jsr/std__path@npm:^1.0.0": [`resolution: "@jsr/std__path@npm:1.0.0"`],
          "berry-reject@workspace:.": rootEntry([`  "@jsr/std__path": "npm:^1.0.0"`]),
        }),
      error: () =>
        `error: yarn fetches "@jsr/std__path" from https://npm.jsr.io and bun is configured to fetch it from`,
    },
    {
      name: "an __archiveUrl the registry manifest does not list (no integrity for it)",
      manifest: { dependencies: { "what-bin": "1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  what-bin: "npm:1.0.0"`]),
          "what-bin@npm:1.0.0": [
            `resolution: "what-bin@npm:1.0.0::__archiveUrl=${encodeURIComponent(`http://127.0.0.1:${verdaccio.port}/what-bin/-/what-bin-1.0.0.tgz`)}"`,
          ],
        }),
      error: () => `error: could not get the integrity of "what-bin@1.0.0" from the registry`,
    },
    {
      name: "a yarn.lock that is not YAML",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () => `__metadata:\n  version: 8\n"no-deps@npm:^1.0.0": [\n`,
      error: () => `error: yarn.lock is not valid YAML`,
    },
    {
      name: "no __metadata.version",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () => `__metadata:\n  cacheKey: 10c0\n\n"no-deps@npm:^1.0.0":\n  resolution: "no-deps@npm:1.0.0"\n`,
      error: () => `error: yarn.lock is missing __metadata.version`,
    },
    {
      name: "no entry for the root workspace",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () => yarnLock(noDeps100),
      error: () => `error: yarn.lock has no root workspace entry ("@workspace:.")`,
    },
    {
      name: "an entry that is not a mapping",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]) }) +
        `\n"no-deps@npm:^1.0.0": 1.0.0\n`,
      error: () => `error: yarn.lock entry "no-deps@npm:^1.0.0" is not a mapping`,
    },
    {
      name: "a resolution with no name",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]),
          "no-deps@npm:^1.0.0": [`resolution: "npm:1.0.0"`],
        }),
      error: () => `error: yarn.lock entry "no-deps@npm:^1.0.0" has an invalid resolution "npm:1.0.0"`,
    },
    {
      name: "an npm resolution that is not a version",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]),
          "no-deps@npm:^1.0.0": [`resolution: "no-deps@npm:^1.0.0"`],
        }),
      error: () => `error: yarn.lock entry "npm:^1.0.0" has an invalid version`,
    },
    {
      name: "a patch of a package the lockfile does not have",
      manifest: { dependencies: { "no-deps": "patch:no-deps@npm%3A1.0.0#~/a.patch" } },
      files: () => ({ "a.patch": "" }),
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "patch:no-deps@npm%3A1.0.0#~/a.patch"`]),
          "no-deps@patch:no-deps@npm%3A1.0.0#~/a.patch": [
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.0#~/a.patch::version=1.0.0&hash=1a2b3c"`,
          ],
        }),
      error: () =>
        `error: yarn.lock patch "patch:no-deps@npm%3A1.0.0#~/a.patch::version=1.0.0&hash=1a2b3c" patches "no-deps@npm:1.0.0", which is not in the lockfile`,
    },
    {
      name: "a dependency range that is not a scalar",
      manifest: { dependencies: { "one-range-dep": "^1.0.0" } },
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  one-range-dep: "npm:^1.0.0"`]),
          "one-range-dep@npm:^1.0.0": [`resolution: "one-range-dep@npm:1.0.0"`, `dependencies:`, `  no-deps: [1]`],
        }),
      error: () => `error: yarn.lock entry "one-range-dep" has a dependency that is not a string`,
    },
    {
      name: "a .yarnrc.yml that is not YAML",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      files: () => ({ ".yarnrc.yml": `npmScopes: [\n` }),
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () => `.yarnrc.yml is not valid YAML`,
    },
    {
      name: "a .yarnrc.yml that cannot be read",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      // a folder where the file should be
      files: () => ({ ".yarnrc.yml/keep": "" }),
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () => `.yarnrc.yml`,
    },
  ];
  for (const { name, manifest, files, lock, error } of rejected) {
    test.concurrent(`not migrated: ${name}`, async () => {
      const packageJson = JSON.stringify({ name: "berry-reject", ...manifest });
      const { packageDir: dir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": packageJson, "yarn.lock": lock(), ...files?.() },
      });

      const { stderr, exitCode } = await run(dir, "pm", "migrate");
      expect(stderr).toContain(error());
      expect(stderr).not.toContain("migrated lockfile from yarn.lock");
      expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
      expect(await Bun.file(join(dir, "package.json")).text()).toBe(packageJson);
      expect(exitCode).toBe(1);
    });
  }

  const missingEntry = () => ({
    "package.json": JSON.stringify({ name: "berry-reject", dependencies: { "no-deps": "^1.0.0", "a-dep": "^1.0.1" } }),
    "yarn.lock": yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
  });

  test.concurrent("a lockfile that is not migrated is reported and bun resolves from package.json", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: missingEntry(),
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain(`error: yarn.lock has no entry for "a-dep@^1.0.1", a dependency of "berry-reject"`);
    expect(stderr).toContain("InvalidYarnBerryLockfile: failed to migrate lockfile: 'yarn.lock'");
    expect(stderr).not.toContain("migrated lockfile from yarn.lock");
    // resolved fresh: the newest 1.x, not the 1.0.0 yarn.lock named
    expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
      "node_modules/a-dep/a-dep@1.0.10
      node_modules/no-deps/no-deps@1.1.0"
    `);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);

    // with --silent the reasons are not printed, and they do not fail the install either
    const { packageDir: silentDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: missingEntry(),
    });
    const silent = await run(silentDir, "install", "--silent");
    expect(silent.stderr).toBe("");
    expect(lockedVersions(await bunLockOf(silentDir))).toEqual(["a-dep@1.0.10", "no-deps@1.1.0"]);
    expect(silent.exitCode).toBe(0);
  });

  // yarn's registry can be set outside the project too
  const cleanProject = () => ({
    "package.json": JSON.stringify({ name: "berry-reject", dependencies: { "no-deps": "^1.0.0" } }),
    "yarn.lock": yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
  });

  test.concurrent("yarn's registry from YARN_NPM_REGISTRY_SERVER", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: cleanProject(),
    });

    const other = `http://127.0.0.1:${verdaccio.port}/`;
    const { stderr, exitCode } = await runWithEnv(dir, { YARN_NPM_REGISTRY_SERVER: other }, "pm", "migrate");
    expect(stderr).toContain(`error: yarn fetches "no-deps" from ${other}`);
    expect(exitCode).toBe(1);

    // the same project migrates when yarn's registry is bun's
    const same = await runWithEnv(dir, { YARN_NPM_REGISTRY_SERVER: verdaccio.registryUrl() }, "pm", "migrate");
    expect(same.stderr).toContain("migrated lockfile from yarn.lock");
    expect(lockedVersions(await bunLockOf(dir))).toEqual(["no-deps@1.0.0"]);
    expect(same.exitCode).toBe(0);
  });

  test.concurrent("yarn's registry from .yarnrc.yml in the home folder and in a parent folder", async () => {
    const other = `http://127.0.0.1:${verdaccio.port}/`;
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "home/.yarnrc.yml": `npmRegistryServer: "${other}"\n`,
        "parent/.yarnrc.yml": `npmScopes:\n  types:\n    npmRegistryServer: "${other}"\n`,
        "parent/app/package.json": JSON.stringify({
          name: "berry-reject",
          dependencies: { "@types/is-number": "^1.0.0" },
        }),
        "parent/app/yarn.lock": yarnLock({
          "@types/is-number@npm:^1.0.0": [`resolution: "@types/is-number@npm:1.0.0"`],
          "berry-reject@workspace:.": rootEntry([`  "@types/is-number": "npm:^1.0.0"`]),
        }),
        ...cleanProject(),
      },
    });
    await Bun.write(join(dir, "parent", "app", "bunfig.toml"), Bun.file(join(dir, "bunfig.toml")));

    const home = await runWithEnv(dir, { HOME: join(dir, "home"), USERPROFILE: join(dir, "home") }, "pm", "migrate");
    expect(home.stderr).toContain(`error: yarn fetches "no-deps" from ${other}`);
    expect(home.exitCode).toBe(1);

    const parent = await run(join(dir, "parent", "app"), "pm", "migrate");
    expect(parent.stderr).toContain(`error: yarn fetches "@types/is-number" from ${other}`);
    expect(parent.exitCode).toBe(1);
  });

  test.concurrent("bun add as the first command keeps what yarn.lock pinned", async () => {
    const dir = await fixture("basic");

    const { stderr, exitCode } = await run(dir, "add", "one-fixed-dep@1.0.0");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(lockedVersions(await bunLockOf(dir))).toEqual([
      "@types/is-number@1.0.0",
      "a-dep@1.0.3",
      "no-deps@1.0.0",
      "one-fixed-dep@1.0.0",
      "one-range-dep@1.0.0",
      "peer-deps-fixed@1.0.0",
      "what-bin@1.0.0",
    ]);
    expect(exitCode).toBe(0);

    // a tarball URL has no name until it is resolved
    const urlDir = await fixture("basic");
    const url = await run(urlDir, "add", `${verdaccio.registryUrl()}one-fixed-dep/-/one-fixed-dep-1.0.0.tgz`);
    expect(url.stderr).toContain("migrated lockfile from yarn.lock");
    expect(url.stderr).not.toContain("error:");
    expect(lockedVersions(await bunLockOf(urlDir))).toEqual([
      "@types/is-number@1.0.0",
      "a-dep@1.0.3",
      "no-deps@1.0.0",
      "one-fixed-dep@http://localhost:1234/one-fixed-dep/-/one-fixed-dep-1.0.0.tgz",
      "one-range-dep@1.0.0",
      "peer-deps-fixed@1.0.0",
      "what-bin@1.0.0",
    ]);
    expect(url.exitCode).toBe(0);
  });

  test.concurrent("a file: folder two workspaces declare has one path, as in a fresh resolve", async () => {
    const shared = (owner: string) => ({
      [`shared@file:../shared::locator=${owner}%40workspace%3Apackages%2F${owner}`]: [
        `resolution: "shared@file:../shared#../shared::hash=1f2e3d&locator=${owner}%40workspace%3Apackages%2F${owner}"`,
      ],
    });
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-shared", workspaces: ["packages/a", "packages/b"] }),
        "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { shared: "file:../shared" } }),
        "packages/b/package.json": JSON.stringify({ name: "b", dependencies: { shared: "file:../shared" } }),
        "packages/shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
        "yarn.lock": yarnLock({
          "a@workspace:packages/a": [
            `resolution: "a@workspace:packages/a"`,
            `dependencies:`,
            `  shared: "file:../shared"`,
          ],
          "b@workspace:packages/b": [
            `resolution: "b@workspace:packages/b"`,
            `dependencies:`,
            `  shared: "file:../shared"`,
          ],
          "berry-shared@workspace:.": [`resolution: "berry-shared@workspace:."`],
          ...shared("a"),
          ...shared("b"),
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    // not `packages/a/../shared` and `packages/b/../shared`
    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"a/shared": ["shared@file:packages/shared", {}],`);
    expect(bunLock).toContain(`"b/shared": ["shared@file:packages/shared", {}],`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("resolutions: a parent is matched by its locked version, and the first rule wins", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-rules",
          dependencies: { "one-fixed-dep": "^1.0.0", "@scoped/create-test-app": "^1.0.0", "one-range-dep": "^1.0.0" },
          resolutions: {
            // names the version one-fixed-dep@^1.0.0 is locked to: applies
            "one-fixed-dep@1.0.0/no-deps": "1.0.1",
            // names a range, which is not create-test-app's locator: yarn never applies it
            "@scoped/create-test-app@npm:^1.0.0/no-deps": "2.0.0",
            // one-range-dep's `no-deps@^1.0.0` matches this rule first, although the next one
            // names its parent and 1.1.0 has an entry of its own
            "no-deps@^1.0.0": "1.0.1",
            "one-range-dep/no-deps": "1.1.0",
          },
        }),
        "yarn.lock": yarnLock({
          "@scoped/create-test-app@npm:^1.0.0": [
            `resolution: "@scoped/create-test-app@npm:1.0.0"`,
            `dependencies:`,
            `  no-deps: "npm:1.0.0"`,
            `bin:`,
            `  create-test-app: bin.js`,
          ],
          "berry-rules@workspace:.": [
            `resolution: "berry-rules@workspace:."`,
            `dependencies:`,
            `  "@scoped/create-test-app": "npm:^1.0.0"`,
            `  one-fixed-dep: "npm:^1.0.0"`,
            `  one-range-dep: "npm:^1.0.0"`,
          ],
          "no-deps@npm:1.0.0": [`resolution: "no-deps@npm:1.0.0"`],
          "no-deps@npm:1.0.1": [`resolution: "no-deps@npm:1.0.1"`],
          // entries another project state left behind; no edge reaches them through yarn's rules
          "no-deps@npm:1.1.0": [`resolution: "no-deps@npm:1.1.0"`],
          "no-deps@npm:2.0.0": [`resolution: "no-deps@npm:2.0.0"`],
          "no-deps@npm:^1.0.0": [`resolution: "no-deps@npm:1.1.0"`],
          "one-fixed-dep@npm:^1.0.0": [
            `resolution: "one-fixed-dep@npm:1.0.0"`,
            `dependencies:`,
            `  no-deps: "npm:1.0.0"`,
          ],
          "one-range-dep@npm:^1.0.0": [
            `resolution: "one-range-dep@npm:1.0.0"`,
            `dependencies:`,
            `  no-deps: "npm:^1.0.0"`,
          ],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(dir);
    // create-test-app keeps 1.0.0 (hoisted); the other two get 1.0.1
    expect([...bunLock.matchAll(/^    "([^"]*no-deps)": \["(no-deps@[^"]+)"/gm)].map(m => [m[1], m[2]])).toEqual([
      ["no-deps", "no-deps@1.0.0"],
      ["one-fixed-dep/no-deps", "no-deps@1.0.1"],
      ["one-range-dep/no-deps", "no-deps@1.0.1"],
    ]);
  });

  test.concurrent("a berry lockfile that holds the yarn v1 marker below its first lines", async () => {
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        ...cleanProject(),
        "yarn.lock":
          cleanProject()["yarn.lock"] +
          `\n# yarn lockfile v1\n"what-bin@npm:1.0.0":\n  resolution: "what-bin@npm:1.0.0"\n`,
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(lockedVersions(await bunLockOf(dir))).toEqual(["no-deps@1.0.0"]);
    expect(exitCode).toBe(0);
  });
});
