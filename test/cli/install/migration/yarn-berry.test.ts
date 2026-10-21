import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, realpathSync } from "fs";
import { readdir, rm } from "fs/promises";
import {
  bunEnv,
  bunExe,
  isLinux,
  isWindows,
  libcFamily,
  nodeModulesPackages,
  normalizeBunSnapshot,
  toBeValidBin,
  unprivilegedSpawnOptions,
} from "harness";
import { join } from "path";
import { TestRegistry } from "registry";
import { yamlAliasChain } from "./migration-harness";

// Migration of yarn 2+ ("berry") lockfiles. Every fixture pins versions that are
// NOT the newest ones the registry has for the requested ranges (e.g. no-deps@^1.0.0
// is locked to 1.0.0 while 1.0.1 and 1.1.0 exist), so a test only passes if the
// pins came from yarn.lock rather than from a fresh resolve.

expect.extend({ toBeValidBin });

const testRegistry = new TestRegistry();

beforeAll(async () => {
  await testRegistry.start();
});

afterAll(() => {
  testRegistry.stop();
});

async function run(cwd: string, ...args: string[]) {
  return runWithEnv(cwd, {}, ...args);
}

async function runWithEnv(cwd: string, env: Record<string, string>, ...args: string[]) {
  return spawnBun(cwd, env, {}, args);
}

async function spawnBun(
  cwd: string,
  env: Record<string, string>,
  { uid, gid }: { uid?: number; gid?: number },
  args: string[],
) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: {
      ...bunEnv,
      // yarn also reads the rc file of the home folder; keep the machine's own out of the tests
      HOME: cwd,
      USERPROFILE: cwd,
      // CI's per-file BUN_INSTALL_CACHE_DIR overrides bunfig's cache; concurrent installs sharing it race on Windows.
      BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
    ...(uid === undefined ? {} : { uid, gid }),
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function fixture(name: string) {
  const { packageDir } = await testRegistry.createTestDir({
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

  // To yarn, `npm:` before a range, a version or a tag is the default protocol written out.
  test.concurrent.each(["npm:^1.0.0", "npm:1.0.0", "npm:1", "npm:*", "npm:latest"])(
    "a package.json range written as %s",
    async range => {
      const plain = range.slice("npm:".length);
      const member = { name: "pkg-a", version: "1.0.0", devDependencies: { "no-deps": range } };
      const { packageDir: dir } = await testRegistry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "berry-npm-protocol",
            workspaces: ["packages/*"],
            dependencies: { "no-deps": range, "one-range-dep": "^1.0.0" },
            resolutions: { "one-range-dep/no-deps": range },
          }),
          "packages/pkg-a/package.json": JSON.stringify(member),
          "yarn.lock": yarnLock({
            "berry-npm-protocol@workspace:.": [
              `resolution: "berry-npm-protocol@workspace:."`,
              `dependencies:`,
              `  no-deps: "${range}"`,
              `  one-range-dep: "npm:^1.0.0"`,
            ],
            [`no-deps@${range}`]: [`resolution: "no-deps@npm:1.0.0"`],
            "one-range-dep@npm:^1.0.0": [
              `resolution: "one-range-dep@npm:1.0.0"`,
              `dependencies:`,
              `  no-deps: "npm:^1.0.0"`,
            ],
            "pkg-a@workspace:packages/pkg-a": [
              `resolution: "pkg-a@workspace:packages/pkg-a"`,
              `dependencies:`,
              `  no-deps: "${range}"`,
            ],
          }),
        },
      });

      const { stderr, exitCode } = await run(dir, "install");
      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("migrated lockfile from yarn.lock");
      expect(nodeModulesPackages(dir)).toBe(
        [
          "node_modules/no-deps/no-deps@1.0.0",
          "node_modules/one-range-dep/one-range-dep@1.0.0",
          "packages/pkg-a/pkg-a@1.0.0",
        ].join("\n"),
      );
      expect(lockedVersions(await bunLockOf(dir))).toEqual([
        "no-deps@1.0.0",
        "one-range-dep@1.0.0",
        "pkg-a@workspace:packages/pkg-a",
      ]);
      expect(await Bun.file(join(dir, "package.json")).json()).toMatchObject({
        dependencies: { "no-deps": plain, "one-range-dep": "^1.0.0" },
        resolutions: { "one-range-dep/no-deps": plain },
      });
      expect(await Bun.file(join(dir, "packages", "pkg-a", "package.json")).json()).toEqual({
        ...member,
        devDependencies: { "no-deps": plain },
      });
      expect(exitCode).toBe(0);

      await expectFrozenInstall(dir);
    },
  );

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
    // `conditions` become os/cpu/libc, so the optional natives for other platforms are skipped
    expect(bunLock).toContain(
      `"native-foo-x64@1.0.0", "http://localhost:1234/native-foo-x64/-/native-foo-x64-1.0.0.tgz", { "os": "none", "cpu": "x64" }`,
    );
    expect(bunLock).toContain(
      `"native-libc-musl@1.0.0", "http://localhost:1234/native-libc-musl/-/native-libc-musl-1.0.0.tgz", { "libc": "musl" }`,
    );
    expect(await Bun.file(join(dir, "node_modules", "no-deps", "patched.txt")).text()).toBe("hello world\n");
    expect(
      await Bun.file(join(dir, "node_modules", "one-dep", "node_modules", "no-deps", "patched-too.txt")).text(),
    ).toBe("hello world\n");
    expect((await readdir(join(dir, "node_modules"))).filter(e => e.startsWith("native-")).sort()).toEqual(
      isLinux ? [`native-libc-${libcFamily}`] : ["native-libc-glibc", "native-libc-musl"],
    );

    await expectFrozenInstall(dir);
  });

  // The migration edits package.json in memory while the lockfile loads. The files are written just before
  // bun.lock, and only by a command that saves it.
  describe("package.json edits", () => {
    const editedLine = "rewrote patch:/portal:/link:/npm: ranges, added patchedDependencies in package.json";
    const frozenNote =
      "note: lockfile is frozen, migration from yarn.lock not written to bun.lock and package.json; run 'bun install' and commit the result";
    const migratedPackageJson = {
      name: "berry-patch",
      dependencies: { "no-deps": "1.0.0", "one-dep": "^1.0.0", "optional-native": "^1.0.0" },
      resolutions: { "one-dep/no-deps": "1.0.1" },
      patchedDependencies: {
        "no-deps@1.0.0": ".yarn/patches/no-deps-npm-1.0.0-d5a9b7e1c2.patch",
        "no-deps@1.0.1": ".yarn/patches/no-deps-npm-1.0.1-aa11bb22cc.patch",
      },
    };

    test.concurrent.each([
      ["install --frozen-lockfile", ["install", "--frozen-lockfile"]],
      ["ci", ["ci"]],
    ])("bun %s installs what yarn.lock pins without writing package.json or bun.lock", async (_, args) => {
      const dir = await fixture("patch");
      const before = await Bun.file(join(dir, "package.json")).text();

      const { stdout, stderr, exitCode } = await run(dir, ...args, "--verbose");

      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("migrated lockfile from yarn.lock");
      expect(stderr).toContain(frozenNote);
      expect(stderr).not.toContain(editedLine);
      expect(stdout + stderr).not.toContain("Saved");
      expect(await Bun.file(join(dir, "package.json")).text()).toBe(before);
      expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
      // The patch is applied anyway.
      expect(await Bun.file(join(dir, "node_modules", "no-deps", "patched.txt")).text()).toBe("hello world\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent.each([
      ["install --dry-run", ["install", "--dry-run"]],
      ["install --no-save", ["install", "--no-save"]],
      ["outdated", ["outdated"]],
      // these two load into a lockfile that is not the manager's
      ["pm why no-deps", ["pm", "why", "no-deps"]],
      ["why no-deps", ["why", "no-deps"]],
      ["pm migrate --dry-run", ["pm", "migrate", "--dry-run"]],
    ])("bun %s leaves package.json and bun.lock alone", async (_, args) => {
      const dir = await fixture("patch");
      const before = await Bun.file(join(dir, "package.json")).text();

      const { stdout, stderr, exitCode } = await run(dir, ...args);

      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("migrated lockfile from yarn.lock");
      expect(stdout + stderr).not.toContain(editedLine);
      expect(stdout + stderr).not.toContain("Saved");
      expect(await Bun.file(join(dir, "package.json")).text()).toBe(before);
      expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
      expect(exitCode).toBe(0);
    });

    test.concurrent.each([
      ["install", ["install"]],
      ["install --lockfile-only", ["install", "--lockfile-only"]],
      ["pm migrate", ["pm", "migrate"]],
    ])("bun %s writes the edited package.json together with bun.lock", async (_, args) => {
      const dir = await fixture("patch");

      const { stderr, exitCode } = await run(dir, ...args);

      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("migrated lockfile from yarn.lock");
      expect(stderr.split(editedLine).length - 1).toBe(1);
      expect(await Bun.file(join(dir, "package.json")).json()).toEqual(migratedPackageJson);
      expect(existsSync(join(dir, "bun.lock"))).toBeTrue();
      expect(exitCode).toBe(0);
      await expectFrozenInstall(dir);
    });

    test.concurrent("a workspace's package.json is edited too", async () => {
      const range = "patch:no-deps@npm%3A1.0.0#~/no-deps.patch";
      const member = { name: "pkg-a", version: "1.0.0", dependencies: { "no-deps": range } };
      const { packageDir: dir } = await testRegistry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "berry-member-patch", workspaces: ["packages/*"] }),
          "packages/pkg-a/package.json": JSON.stringify(member),
          "no-deps.patch": await Bun.file(
            join(import.meta.dir, "yarn-berry", "patch", ".yarn", "patches", "no-deps-npm-1.0.0-d5a9b7e1c2.patch"),
          ).text(),
          "yarn.lock": yarnLock({
            "berry-member-patch@workspace:.": [`resolution: "berry-member-patch@workspace:."`],
            "no-deps@npm:1.0.0": [`resolution: "no-deps@npm:1.0.0"`],
            [`no-deps@${range}`]: [`resolution: "no-deps@${range}::version=1.0.0&hash=1a2b3c"`],
            "pkg-a@workspace:packages/pkg-a": [
              `resolution: "pkg-a@workspace:packages/pkg-a"`,
              `dependencies:`,
              `  no-deps: "${range}"`,
            ],
          }),
        },
      });

      const frozen = await run(dir, "install", "--frozen-lockfile", "--verbose");
      expect(frozen.stderr).toContain(frozenNote);
      expect(await Bun.file(join(dir, "packages", "pkg-a", "package.json")).json()).toEqual(member);

      const { stderr, exitCode } = await run(dir, "pm", "migrate");
      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("added patchedDependencies in package.json");
      expect(stderr).toContain(
        `rewrote patch:/portal:/link:/npm: ranges in ${join("packages", "pkg-a", "package.json")}`,
      );
      expect(await Bun.file(join(dir, "package.json")).json()).toEqual({
        name: "berry-member-patch",
        workspaces: ["packages/*"],
        patchedDependencies: { "no-deps@1.0.0": "no-deps.patch" },
      });
      expect(await Bun.file(join(dir, "packages", "pkg-a", "package.json")).json()).toEqual({
        ...member,
        dependencies: { "no-deps": "1.0.0" },
      });
      expect(exitCode).toBe(0);
      await expectFrozenInstall(dir);
    });

    test.concurrent("bun remove as the first command writes its own edit and the migration's", async () => {
      const dir = await fixture("patch");

      const { stderr, exitCode } = await run(dir, "remove", "optional-native");

      expect(stderr).toContain("migrated lockfile from yarn.lock");
      expect(stderr).not.toContain("error:");
      expect(await Bun.file(join(dir, "package.json")).json()).toEqual({
        ...migratedPackageJson,
        dependencies: { "no-deps": "1.0.0", "one-dep": "^1.0.0" },
      });
      expect(lockedVersions(await bunLockOf(dir))).toEqual(["no-deps@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"]);
      expect(exitCode).toBe(0);
      await expectFrozenInstall(dir);
    });

    // Otherwise bun.lock would hold patches and ranges the next install cannot see in package.json.
    test.concurrent.skipIf(isWindows)(
      "a read-only package.json fails the migration before bun.lock is written",
      async () => {
        const dir = await fixture("patch");
        const before = await Bun.file(join(dir, "package.json")).text();
        chmodSync(join(dir, "package.json"), 0o444);
        {
          using unprivileged = unprivilegedSpawnOptions(dir);
          const { stderr, exitCode } = await spawnBun(dir, {}, unprivileged, ["pm", "migrate"]);

          expect(stderr).toContain("error: failed to write package.json: EACCES");
          expect(stderr).not.toContain(editedLine);
          expect(await Bun.file(join(dir, "package.json")).text()).toBe(before);
          expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
          expect(exitCode).toBe(1);

          // nothing is half done: once the file can be written the same command migrates
          chmodSync(join(dir, "package.json"), 0o644);
          const again = await spawnBun(dir, {}, unprivileged, ["pm", "migrate"]);
          expect(again.stderr).not.toContain("error:");
          expect(await Bun.file(join(dir, "package.json")).json()).toEqual(migratedPackageJson);
          expect(again.exitCode).toBe(0);
        }
      },
    );
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

  // yarn applies `no-deps@npm:^1.0.0` only to dependencies declared as exactly `^1.0.0`. The root
  // asks for `^1.1.0`, so yarn.lock keeps 1.1.0 for it.
  test.concurrent("a name@range resolution only applies to dependencies that declare exactly that range", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-range-resolution",
          dependencies: { "no-deps": "^1.1.0", "one-range-dep": "^1.0.0" },
          resolutions: { "no-deps@npm:^1.0.0": "1.0.0" },
        }),
        "yarn.lock": yarnLock({
          "berry-range-resolution@workspace:.": [
            "version: 0.0.0-use.local",
            'resolution: "berry-range-resolution@workspace:."',
            "dependencies:",
            '  no-deps: "npm:^1.1.0"',
            '  one-range-dep: "npm:^1.0.0"',
            "languageName: unknown",
            "linkType: soft",
          ],
          "no-deps@npm:1.0.0": [
            "version: 1.0.0",
            'resolution: "no-deps@npm:1.0.0"',
            "languageName: node",
            "linkType: hard",
          ],
          "no-deps@npm:^1.1.0": [
            "version: 1.1.0",
            'resolution: "no-deps@npm:1.1.0"',
            "languageName: node",
            "linkType: hard",
          ],
          "one-range-dep@npm:^1.0.0": [
            "version: 1.0.0",
            'resolution: "one-range-dep@npm:1.0.0"',
            "dependencies:",
            '  no-deps: "npm:^1.0.0"',
            "languageName: node",
            "linkType: hard",
          ],
        }),
      },
    });

    const migrated = await run(dir, "pm", "migrate");
    expect(migrated.stderr).not.toContain("error:");
    expect(migrated.exitCode).toBe(0);
    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual(["no-deps@1.0.0", "no-deps@1.1.0", "one-range-dep@1.0.0"]);

    await expectFrozenInstall(dir);
    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).not.toContain("error:");
    expect(await bunLockOf(dir)).toBe(bunLock);
    expect(exitCode).toBe(0);
  });

  // yarn does not apply the key to `*`, so yarn.lock has `latest` for it. Here `latest` is a prerelease.
  test.concurrent("a name@range resolution does not apply to a dependency declared as *", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "berry-range-resolution-any",
          dependencies: { "prereleases-3": "*" },
          resolutions: { "prereleases-3@npm:^5.0.0-alpha.100": "5.0.0-alpha.150" },
        }),
        "yarn.lock": yarnLock({
          "berry-range-resolution-any@workspace:.": [
            "version: 0.0.0-use.local",
            'resolution: "berry-range-resolution-any@workspace:."',
            "dependencies:",
            '  prereleases-3: "npm:*"',
            "languageName: unknown",
            "linkType: soft",
          ],
          "prereleases-3@npm:*": [
            "version: 5.0.0-alpha.153",
            'resolution: "prereleases-3@npm:5.0.0-alpha.153"',
            "languageName: node",
            "linkType: hard",
          ],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(lockedVersions(await bunLockOf(dir))).toEqual(["prereleases-3@5.0.0-alpha.153"]);
    await expectFrozenInstall(dir);
  });

  describe("name@range rules and a bun.lock edited by hand", () => {
    const npmEntry = (version: string) => [
      `version: ${version}`,
      `resolution: "no-deps@npm:${version}"`,
      "languageName: node",
      "linkType: hard",
    ];
    const row = (bunLock: string, version: string) =>
      bunLock.match(new RegExp(`\\["no-deps@${version.replaceAll(".", "\\.")}"[^\\]]*\\]`))![0];

    async function expectToPass(dir: string, ...args: string[]) {
      const { stderr, exitCode } = await run(dir, ...args);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    /** Replaces no-deps@`version` in bun.lock with no-deps@1.1.0, which is inside every range used below. */
    async function lockAt110(dir: string, version: string) {
      const { packageDir: scratch } = await testRegistry.createTestDir({
        files: { "package.json": JSON.stringify({ name: "scratch", dependencies: { "no-deps": "1.1.0" } }) },
      });
      await expectToPass(scratch, "install", "--lockfile-only");
      const [bunLock, other] = await Promise.all([dir, scratch].map(at => Bun.file(join(at, "bun.lock")).text()));
      await Bun.write(join(dir, "bun.lock"), bunLock.replace(row(bunLock, version), row(other, "1.1.0")));
    }

    /** A frozen install takes no-deps@1.1.0 as it is. `bun install` resolves it again if a rule doesn't allow it. */
    async function expectInstallToLock(dir: string, locked: string[]) {
      await expectFrozenInstall(dir);
      expect((await Bun.file(join(dir, "node_modules", "no-deps", "package.json")).json()).version).toBe("1.1.0");
      await expectToPass(dir, "install", "--lockfile-only");
      expect(lockedVersions(await bunLockOf(dir))).toEqual(locked);
    }

    // Both keys overlap with the root's `^1.0.1`. yarn uses the key whose range is exactly `^1.0.1`.
    test.concurrent("of two keys that overlap, the one with the declared range is enforced", async () => {
      const { packageDir: dir } = await testRegistry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "berry-two-range-resolutions",
            dependencies: { "no-deps": "^1.0.1", "one-range-dep": "^1.0.0" },
            resolutions: { "no-deps@npm:^1.0.0": "1.0.0", "no-deps@npm:^1.0.1": "1.0.1" },
          }),
          "yarn.lock": yarnLock({
            "berry-two-range-resolutions@workspace:.": [
              "version: 0.0.0-use.local",
              'resolution: "berry-two-range-resolutions@workspace:."',
              "dependencies:",
              '  no-deps: "npm:^1.0.1"',
              '  one-range-dep: "npm:^1.0.0"',
              "languageName: unknown",
              "linkType: soft",
            ],
            "no-deps@npm:1.0.0": npmEntry("1.0.0"),
            "no-deps@npm:1.0.1": npmEntry("1.0.1"),
            "one-range-dep@npm:^1.0.0": [
              "version: 1.0.0",
              'resolution: "one-range-dep@npm:1.0.0"',
              "dependencies:",
              '  no-deps: "npm:^1.0.0"',
              "languageName: node",
              "linkType: hard",
            ],
          }),
        },
      });
      await expectToPass(dir, "pm", "migrate");
      expect(lockedVersions(await bunLockOf(dir))).toEqual(["no-deps@1.0.0", "no-deps@1.0.1", "one-range-dep@1.0.0"]);
      await expectFrozenInstall(dir);

      await lockAt110(dir, "1.0.1");
      // Resolving again takes the first key that overlaps.
      await expectInstallToLock(dir, ["no-deps@1.0.0", "one-range-dep@1.0.0"]);
    });

    // yarn treats `npm:^1.0.0` and `^1.0.0` as the same range.
    test.concurrent.each(["npm:^1.0.0", "^1.0.0"])(
      "the key is enforced for a dependency declared as %s",
      async range => {
        const { packageDir: dir } = await testRegistry.createTestDir({
          files: {
            "package.json": JSON.stringify({
              name: "range-resolution",
              dependencies: { "no-deps": range },
              resolutions: { "no-deps@npm:^1.0.0": "1.0.0" },
            }),
          },
        });
        await expectToPass(dir, "install", "--lockfile-only");
        expect(lockedVersions(await bunLockOf(dir))).toEqual(["no-deps@1.0.0"]);
        await expectFrozenInstall(dir);

        await lockAt110(dir, "1.0.0");
        await expectInstallToLock(dir, ["no-deps@1.0.0"]);
      },
    );

    // `^1.1.0` overlaps with the key's `^1.0.0` but is not the same range. npm and pnpm apply the rule, yarn does not.
    test.concurrent.each(["overrides", "resolutions"])(
      "a key in %s and a declared range that only overlaps",
      async field => {
        const { packageDir: dir } = await testRegistry.createTestDir({
          files: {
            "package.json": JSON.stringify({
              name: "range-rule",
              dependencies: { "no-deps": "^1.1.0" },
              [field]: { "no-deps@^1.0.0": "1.0.0" },
            }),
          },
        });
        await expectToPass(dir, "install", "--lockfile-only");
        expect(lockedVersions(await bunLockOf(dir))).toEqual(["no-deps@1.0.0"]);
        await lockAt110(dir, "1.0.0");

        await expectInstallToLock(dir, [field === "resolutions" ? "no-deps@1.1.0" : "no-deps@1.0.0"]);
      },
    );
  });

  test.concurrent("a parent/name resolution only rebinds that parent's edge", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
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
    const { packageDir: dir } = await testRegistry.createTestDir({
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

  test.concurrent("file: and portal: dependencies", async () => {
    const dir = await fixture("protocols");

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    // bun has no protocol for a linked folder whose dependencies are installed too, so it becomes a copy
    expect(stderr).toContain(`migrating "local-portal@portal:./local-portal" as "file:local-portal"`);
    expect(stderr).not.toContain("bun will resolve");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const manifest = await Bun.file(join(dir, "package.json")).json();
    expect(manifest.dependencies).toEqual({
      "local-file": "file:./local-file",
      "local-portal": "file:./local-portal",
    });
    // a `portal:` target of a resolution is rewritten too
    expect(manifest.resolutions).toEqual({ "a-dep": "file:./local-a-dep" });
    const bunLock = await bunLockOf(dir);
    // `sub` is declared by the portal package with a path relative to it
    expect(lockedVersions(bunLock)).toEqual([
      "a-dep@file:local-a-dep",
      "local-file@file:local-file",
      "local-portal@file:local-portal",
      "no-deps@1.0.1",
      "sub@file:local-portal/sub",
    ]);
    // bun keeps transitive folder dependencies under the package that declares them
    expect(nodeModulesPackages(join(dir, "node_modules"))).toMatchInlineSnapshot(`
      "local-file/local-file@1.0.0
      local-portal/local-portal@1.0.0
      local-portal/node_modules/a-dep/a-dep@9.9.9
      local-portal/node_modules/sub/sub@1.0.0
      local-portal/sub/sub@1.0.0
      no-deps/no-deps@1.0.1"
    `);

    await expectFrozenInstall(dir);

    // package.json is written before bun.lock. Without a bun.lock the next migration reads its
    // own `file:` spelling of `portal:`.
    await rm(join(dir, "bun.lock"));
    const again = await run(dir, "pm", "migrate");
    expect(again.stderr).toContain("migrated lockfile from yarn.lock");
    expect(again.stderr).not.toContain("error:");
    // (`configVersion` differs between `bun install` and `bun pm migrate`)
    const packagesOf = (lock: string) => lock.slice(lock.indexOf(`"packages": {`));
    expect(packagesOf(await bunLockOf(dir))).toBe(packagesOf(bunLock));
    expect(again.exitCode).toBe(0);
  });

  // bun.lock holds the folder relative to the project, spelled as a path.
  test.concurrent("link: dependencies stay links", async () => {
    const link = (name: string, range: string, owner: string) => ({
      [`${name}@${range}::locator=${encodeURIComponent(owner)}`]: [
        `resolution: "${name}@${range}::locator=${encodeURIComponent(owner)}"`,
        `linkType: soft`,
      ],
    });
    const member = { name: "pkg-a", version: "1.0.0", dependencies: { shared: "link:../../vendor/shared" } };
    // The project is a subfolder, so that `../outside` is the test's own.
    const { packageDir } = await testRegistry.createTestDir({
      files: {
        "outside/package.json": JSON.stringify({ name: "outside", version: "1.0.0" }),
        "project/bunfig.toml": `[install]\nlinker = "hoisted"\n`,
        "project/package.json": JSON.stringify({
          name: "berry-links",
          workspaces: ["packages/*"],
          // to bun, `link:bare` without `./` names a `bun link` registration
          dependencies: { bare: "link:bare", dotted: "link:./vendor/dotted", outside: "link:../outside" },
        }),
        "project/packages/pkg-a/package.json": JSON.stringify(member),
        "project/bare/package.json": JSON.stringify({ name: "bare", version: "1.0.0" }),
        "project/vendor/dotted/package.json": JSON.stringify({ name: "dotted", version: "1.0.0" }),
        "project/vendor/shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
        "project/yarn.lock": yarnLock({
          "berry-links@workspace:.": [
            `resolution: "berry-links@workspace:."`,
            `dependencies:`,
            `  bare: "link:bare"`,
            `  dotted: "link:./vendor/dotted"`,
            `  outside: "link:../outside"`,
          ],
          "pkg-a@workspace:packages/pkg-a": [
            `resolution: "pkg-a@workspace:packages/pkg-a"`,
            `dependencies:`,
            `  shared: "link:../../vendor/shared"`,
          ],
          ...link("bare", "link:bare", "berry-links@workspace:."),
          ...link("dotted", "link:./vendor/dotted", "berry-links@workspace:."),
          ...link("outside", "link:../outside", "berry-links@workspace:."),
          ...link("shared", "link:../../vendor/shared", "pkg-a@workspace:packages/pkg-a"),
        }),
      },
    });
    const dir = join(packageDir, "project");

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("migrating ");
    expect(stderr).not.toContain("error:");
    expect((await Bun.file(join(dir, "package.json")).json()).dependencies).toEqual({
      bare: "link:./bare",
      dotted: "link:./vendor/dotted",
      outside: "link:../outside",
    });
    expect(await Bun.file(join(dir, "packages", "pkg-a", "package.json")).json()).toEqual(member);
    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual([
      "bare@link:./bare",
      "dotted@link:./vendor/dotted",
      "outside@link:../outside",
      "pkg-a@workspace:packages/pkg-a",
      "shared@link:./vendor/shared",
    ]);
    expect(bunLock).toContain(`"shared": "link:../../vendor/shared",`);
    expect(exitCode).toBe(0);

    await expectFrozenInstall(dir);
    expect(
      Object.fromEntries(
        ["bare", "dotted", "outside", "shared"].map(name => [name, realpathSync(join(dir, "node_modules", name))]),
      ),
    ).toEqual({
      bare: realpathSync(join(dir, "bare")),
      dotted: realpathSync(join(dir, "vendor", "dotted")),
      outside: realpathSync(join(packageDir, "outside")),
      shared: realpathSync(join(dir, "vendor", "shared")),
    });
    expect(await bunLockOf(dir)).toBe(bunLock);

    // the next migration reads its own `link:./bare` spelling of `link:bare`
    await rm(join(dir, "bun.lock"));
    const again = await run(dir, "pm", "migrate");
    expect(again.stderr).not.toContain("error:");
    expect(await bunLockOf(dir)).toBe(bunLock);
    expect(again.exitCode).toBe(0);
  });

  test.concurrent("tarball URL and git resolutions", async () => {
    const registry = testRegistry.registryUrl();
    const { packageDir: dir } = await testRegistry.createTestDir({
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
      const { packageDir: dir } = await testRegistry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "berry-registries", dependencies: { "a-dep": "^1.0.1" } }),
          // the same registry bun is configured with; the scope is one the lockfile does not use
          ".yarnrc.yml": `npmRegistryServer: "${testRegistry.registryUrl()}"\nnpmScopes:\n  unused:\n    npmRegistryServer: "\${UNUSED_REGISTRY}"\n`,
          "yarn.lock": yarnLock({
            "a-dep@npm:^1.0.1": [
              `resolution: "a-dep@npm:1.0.2::__archiveUrl=${encodeURIComponent(`${testRegistry.registryUrl()}a-dep/-/a-dep-1.0.2.tgz`)}"`,
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
    const { packageDir: dir } = await testRegistry.createTestDir({
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
    const { packageDir: dir } = await testRegistry.createTestDir({
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

  // If yarn.lock pins something that Bun can't keep, the migration fails and nothing is written.
  const rootEntry = (deps: string[]) => [`resolution: "berry-reject@workspace:."`, `dependencies:`, ...deps];
  const noDeps100 = { "no-deps@npm:^1.0.0": [`resolution: "no-deps@npm:1.0.0"`] };
  const rejected: {
    name: string;
    manifest?: object;
    files?: () => Record<string, string>;
    lock: () => string;
    error: () => string | RegExp;
  }[] = [
    {
      name: "a dependency with no entry",
      manifest: { dependencies: { "no-deps": "^1.0.0", "a-dep": "^1.0.1" } },
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () => `error: yarn.lock missing "a-dep@^1.0.1", a dependency of "berry-reject"`,
    },
    {
      name: "a resolutions rule whose target has no entry",
      manifest: { dependencies: { "no-deps": "^1.0.0" }, resolutions: { "no-deps": "2.0.0" } },
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () => `error: yarn.lock missing "no-deps@^1.0.0", a dependency of "berry-reject"`,
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
      name: "a file: folder a registry package declares (yarn reads it inside that package)",
      manifest: { dependencies: { "one-dep": "^1.0.0" } },
      files: () => ({ "inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }) }),
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  one-dep: "npm:^1.0.0"`]),
          "inner@file:./inner::locator=one-dep%40npm%3A1.0.0": [
            `resolution: "inner@file:./inner#./inner::hash=1f2e3d&locator=one-dep%40npm%3A1.0.0"`,
          ],
          "one-dep@npm:^1.0.0": [`resolution: "one-dep@npm:1.0.0"`, `dependencies:`, `  inner: "file:./inner"`],
        }),
      error: () =>
        `error: yarn.lock entry "inner@file:./inner#./inner::hash=1f2e3d&locator=one-dep%40npm%3A1.0.0" is a path inside a package that is not a folder of the project`,
    },
    {
      name: "a patch file next to a registry package",
      manifest: { dependencies: { "one-dep": "^1.0.0" } },
      files: () => ({ "a.patch": "" }),
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  one-dep: "npm:^1.0.0"`]),
          "no-deps@npm:1.0.1": [`resolution: "no-deps@npm:1.0.1"`],
          "no-deps@patch:no-deps@npm%3A1.0.1#./a.patch::locator=one-dep%40npm%3A1.0.0": [
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.1#./a.patch::version=1.0.1&hash=1a2b3c&locator=one-dep%40npm%3A1.0.0"`,
          ],
          "one-dep@npm:^1.0.0": [
            `resolution: "one-dep@npm:1.0.0"`,
            `dependencies:`,
            `  no-deps: "patch:no-deps@npm%3A1.0.1#./a.patch"`,
          ],
        }),
      error: () => `error: yarn.lock patch file "./a.patch" is not a file inside the project`,
    },
    {
      name: "a deep chain of YAML aliases",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      lock: () =>
        yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }) +
        `\n${yamlAliasChain("unused")}`,
      error: () => `error: yarn.lock is not valid YAML`,
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
      files: () => ({ ".yarnrc.yml": `npmRegistryServer: "http://127.0.0.1:${testRegistry.port}/"\n` }),
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () =>
        `error: yarn fetches "no-deps" from http://127.0.0.1:${testRegistry.port}/ and bun is configured to fetch it from ${testRegistry.registryUrl()}; add the registry to bunfig.toml or .npmrc`,
    },
    {
      name: "a scope registry in .yarnrc.yml that is not bun's",
      manifest: { dependencies: { "@types/is-number": "^1.0.0", "no-deps": "^1.0.0" } },
      files: () => ({
        ".yarnrc.yml": `npmScopes:\n  types:\n    npmRegistryServer: "http://127.0.0.1:${testRegistry.port}/"\n`,
      }),
      lock: () =>
        yarnLock({
          "@types/is-number@npm:^1.0.0": [`resolution: "@types/is-number@npm:1.0.0"`],
          "berry-reject@workspace:.": rootEntry([`  "@types/is-number": "npm:^1.0.0"`, `  no-deps: "npm:^1.0.0"`]),
          ...noDeps100,
        }),
      error: () => `error: yarn fetches "@types/is-number" from http://127.0.0.1:${testRegistry.port}/`,
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
            `resolution: "what-bin@npm:1.0.0::__archiveUrl=${encodeURIComponent(`http://127.0.0.1:${testRegistry.port}/what-bin/-/what-bin-1.0.0.tgz`)}"`,
          ],
        }),
      error: () =>
        `error: yarn.lock fetches "what-bin@1.0.0" from http://127.0.0.1:${testRegistry.port}/what-bin/-/what-bin-1.0.0.tgz, outside the configured registry (${testRegistry.registryUrl()}): cannot get integrity`,
    },
    {
      name: "an __archiveUrl on the registry .yarnrc.yml names, which is not bun's",
      manifest: { dependencies: { "what-bin": "1.0.0" } },
      files: () => ({ ".yarnrc.yml": `npmRegistryServer: "http://127.0.0.1:${testRegistry.port}/"\n` }),
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  what-bin: "npm:1.0.0"`]),
          "what-bin@npm:1.0.0": [
            `resolution: "what-bin@npm:1.0.0::__archiveUrl=${encodeURIComponent(`http://127.0.0.1:${testRegistry.port}/what-bin/-/what-bin-1.0.0.tgz`)}"`,
          ],
        }),
      error: () => `error: yarn fetches "what-bin" from http://127.0.0.1:${testRegistry.port}/ and bun is configured`,
    },
    {
      name: "several packages with two patch files each, all named in one run",
      manifest: {
        dependencies: {
          "no-deps": "patch:no-deps@npm%3A1.0.0#~/a.patch&~/b.patch",
          "a-dep": "patch:a-dep@npm%3A1.0.1#~/a.patch&~/b.patch&~/c.patch",
        },
      },
      files: () => ({ "a.patch": "", "b.patch": "", "c.patch": "" }),
      lock: () =>
        yarnLock({
          "a-dep@npm:1.0.1": [`resolution: "a-dep@npm:1.0.1"`],
          "a-dep@patch:a-dep@npm%3A1.0.1#~/a.patch&~/b.patch&~/c.patch": [
            `resolution: "a-dep@patch:a-dep@npm%3A1.0.1#~/a.patch&~/b.patch&~/c.patch::version=1.0.1&hash=1a2b3c"`,
          ],
          "berry-reject@workspace:.": rootEntry([
            `  a-dep: "patch:a-dep@npm%3A1.0.1#~/a.patch&~/b.patch&~/c.patch"`,
            `  no-deps: "patch:no-deps@npm%3A1.0.0#~/a.patch&~/b.patch"`,
          ]),
          "no-deps@npm:1.0.0": [`resolution: "no-deps@npm:1.0.0"`],
          "no-deps@patch:no-deps@npm%3A1.0.0#~/a.patch&~/b.patch": [
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.0#~/a.patch&~/b.patch::version=1.0.0&hash=7a6b5c"`,
          ],
        }),
      error: () =>
        `error: yarn.lock applies several patch files to 2 packages ("a-dep@1.0.1" with 3, "no-deps@1.0.0" with 2). bun supports one per package, merge them`,
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
      error: () => /error: .*\.yarnrc\.yml is not valid YAML/,
    },
    {
      name: "a .yarnrc.yml that cannot be read",
      manifest: { dependencies: { "no-deps": "^1.0.0" } },
      // a folder where the file should be
      files: () => ({ ".yarnrc.yml/keep": "" }),
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () => /error: could not read .*\.yarnrc\.yml/,
    },
    {
      name: "a workspace with the name of a package yarn.lock pins for the root",
      manifest: { workspaces: ["packages/*"], devDependencies: { "no-deps": "^1.0.0" } },
      files: () => ({ "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }) }),
      // with yarn's `enableTransparentWorkspaces: false` the root gets no-deps from the registry
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]),
          ...noDeps100,
          "no-deps@workspace:packages/no-deps": [`resolution: "no-deps@workspace:packages/no-deps"`],
        }),
      error: () =>
        `error: "no-deps" is a workspace, and yarn.lock pins the root package's "no-deps@^1.0.0" to a package that is not that workspace; bun installs the workspace in its place`,
    },
    {
      name: "a root range outside the version of the workspace with its name",
      manifest: { workspaces: ["packages/*"], dependencies: { "no-deps": "^2.0.0" } },
      files: () => ({ "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }) }),
      // bun's own lockfile for this project has two packages at `no-deps` and does not load
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^2.0.0"`]),
          "no-deps@npm:^2.0.0": [`resolution: "no-deps@npm:2.0.0"`],
          "no-deps@workspace:packages/no-deps": [`resolution: "no-deps@workspace:packages/no-deps"`],
        }),
      error: () =>
        `error: "no-deps" is a workspace, and yarn.lock pins the root package's "no-deps@^2.0.0" to a package that is not that workspace; bun installs the workspace in its place`,
    },
    {
      name: "a range with no entry that a workspace satisfies, with enableTransparentWorkspaces: false",
      manifest: { workspaces: ["packages/*"] },
      files: () => ({
        ".yarnrc.yml": `enableTransparentWorkspaces: false\n`,
        "packages/pkg-a/package.json": JSON.stringify({ name: "pkg-a", version: "1.2.0" }),
        "packages/pkg-b/package.json": JSON.stringify({ name: "pkg-b", dependencies: { "pkg-a": "^1.0.0" } }),
      }),
      lock: () =>
        yarnLock({
          "berry-reject@workspace:.": [`resolution: "berry-reject@workspace:."`],
          "pkg-a@workspace:packages/pkg-a": [`resolution: "pkg-a@workspace:packages/pkg-a"`],
          "pkg-b@workspace:packages/pkg-b": [
            `resolution: "pkg-b@workspace:packages/pkg-b"`,
            `dependencies:`,
            `  pkg-a: "npm:^1.0.0"`,
          ],
        }),
      error: () => `error: yarn.lock missing "pkg-a@^1.0.0", a dependency of "pkg-b"`,
    },
    {
      name: "a devDependencies range (yarn installs it) the dependencies range (bun installs it) does not accept",
      manifest: { dependencies: { "no-deps": "^2.0.0" }, devDependencies: { "no-deps": "^1.0.0" } },
      lock: () => yarnLock({ "berry-reject@workspace:.": rootEntry([`  no-deps: "npm:^1.0.0"`]), ...noDeps100 }),
      error: () =>
        `error: "no-deps" is in several dependency groups of "berry-reject": yarn uses "^1.0.0" for all, but yarn.lock version does not satisfy "^2.0.0"`,
    },
  ];
  for (const { name, manifest, files, lock, error } of rejected) {
    test.concurrent(`not migrated: ${name}`, async () => {
      const packageJson = JSON.stringify({ name: "berry-reject", ...manifest });
      const { packageDir: dir } = await testRegistry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": packageJson, "yarn.lock": lock(), ...files?.() },
      });

      const { stderr, exitCode } = await run(dir, "pm", "migrate");
      const expected = error();
      if (typeof expected === "string") expect(stderr).toContain(expected);
      else expect(stderr).toMatch(expected);
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
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: missingEntry(),
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain(`error: yarn.lock missing "a-dep@^1.0.1", a dependency of "berry-reject"`);
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
    const { packageDir: silentDir } = await testRegistry.createTestDir({
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

  test.concurrent("a range with a password is not printed", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-reject",
          dependencies: { direct: "http://carol:s3cret@localhost:1/direct-1.0.0.tgz" },
        }),
        "yarn.lock": yarnLock({ "berry-reject@workspace:.": [`resolution: "berry-reject@workspace:."`] }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain(
      `error: yarn.lock missing "direct@http://***@localhost:1/direct-1.0.0.tgz", a dependency of "berry-reject"`,
    );
    expect(stderr).not.toContain("s3cret");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a registry URL with a password is not printed", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        ...cleanProject(),
        ".yarnrc.yml": `npmRegistryServer: "http://builder:hunter2secret@127.0.0.1:${testRegistry.port}/"\n`,
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain(`error: yarn fetches "no-deps" from `);
    expect(stderr).toContain(`127.0.0.1:${testRegistry.port}/ and bun is configured to fetch it from`);
    expect(stderr).not.toContain("hunter2secret");
    expect(exitCode).toBe(1);
  });

  test.concurrent("credentials in bun's registry URL are not written to bun.lock", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: cleanProject(),
    });
    // a registry that comes from an environment variable keeps its `user:password@`
    const bunfig = join(dir, "bunfig.toml");
    await Bun.write(
      bunfig,
      (await Bun.file(bunfig).text()).replace(testRegistry.registryUrl(), "$BERRY_TEST_REGISTRY"),
    );
    const registry = `http://builder:hunter2secret@localhost:${testRegistry.port}/`;

    const { stderr, exitCode } = await runWithEnv(dir, { BERRY_TEST_REGISTRY: registry }, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"no-deps@1.0.0", "http://localhost:1234/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-`);
    expect(bunLock).not.toContain("hunter2secret");
    expect(exitCode).toBe(0);
  });

  test.concurrent("yarn's registry from YARN_NPM_REGISTRY_SERVER", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: cleanProject(),
    });

    const other = `http://127.0.0.1:${testRegistry.port}/`;
    const { stderr, exitCode } = await runWithEnv(dir, { YARN_NPM_REGISTRY_SERVER: other }, "pm", "migrate");
    expect(stderr).toContain(`error: yarn fetches "no-deps" from ${other}`);
    expect(exitCode).toBe(1);

    // the same project migrates when yarn's registry is bun's
    const same = await runWithEnv(dir, { YARN_NPM_REGISTRY_SERVER: testRegistry.registryUrl() }, "pm", "migrate");
    expect(same.stderr).toContain("migrated lockfile from yarn.lock");
    expect(lockedVersions(await bunLockOf(dir))).toEqual(["no-deps@1.0.0"]);
    expect(same.exitCode).toBe(0);
  });

  test.concurrent("yarn's registry from .yarnrc.yml in the home folder and in a parent folder", async () => {
    const other = `http://127.0.0.1:${testRegistry.port}/`;
    const { packageDir: dir } = await testRegistry.createTestDir({
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
    const url = await run(urlDir, "add", `${testRegistry.registryUrl()}one-fixed-dep/-/one-fixed-dep-1.0.0.tgz`);
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

  test.concurrent("bun update <name> as the first command updates that package only", async () => {
    const dir = await fixture("basic");

    const { stderr, exitCode } = await run(dir, "update", "no-deps");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    // no-deps@^1.0.0 moves from 1.0.0 to the newest 1.x; the others keep yarn.lock's versions
    expect(lockedVersions(await bunLockOf(dir))).toEqual([
      "@types/is-number@1.0.0",
      "a-dep@1.0.3",
      "no-deps@1.1.0",
      "one-range-dep@1.0.0",
      "peer-deps-fixed@1.0.0",
      "what-bin@1.0.0",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun patch --commit that has to migrate keeps the migration's package.json edits", async () => {
    const packageJson = JSON.stringify({
      name: "berry-patch-commit",
      dependencies: { "no-deps": "^1.0.0", "local-portal": "portal:./local-portal" },
    });
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": packageJson,
        "local-portal/package.json": JSON.stringify({ name: "local-portal", version: "1.0.0" }),
        "yarn.lock": yarnLock({
          "berry-patch-commit@workspace:.": [
            `resolution: "berry-patch-commit@workspace:."`,
            `dependencies:`,
            `  local-portal: "portal:./local-portal"`,
            `  no-deps: "npm:^1.0.0"`,
          ],
          "local-portal@portal:./local-portal::locator=berry-patch-commit%40workspace%3A.": [
            `resolution: "local-portal@portal:./local-portal::locator=berry-patch-commit%40workspace%3A."`,
          ],
          "no-deps@npm:^1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
        }),
      },
    });

    expect((await run(dir, "install")).exitCode).toBe(0);
    expect((await run(dir, "patch", "no-deps")).exitCode).toBe(0);
    await Bun.write(join(dir, "node_modules", "no-deps", "patched.txt"), "patched\n");
    // back to the yarn project: the commit is the command that migrates
    await Bun.write(join(dir, "package.json"), packageJson);
    await rm(join(dir, "bun.lock"));

    const { stderr, exitCode } = await run(dir, "patch", "--commit", "node_modules/no-deps");
    expect(stderr).not.toContain("error:");
    expect(await Bun.file(join(dir, "package.json")).json()).toEqual({
      name: "berry-patch-commit",
      dependencies: { "no-deps": "^1.0.0", "local-portal": "file:./local-portal" },
      patchedDependencies: { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" },
    });
    expect(await Bun.file(join(dir, "patches", "no-deps@1.0.0.patch")).text()).toContain("+patched");
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
  });

  test.concurrent("YARN_RC_FILENAME names the rc file", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        ...cleanProject(),
        ".yarnrc.custom.yml": `npmRegistryServer: "http://127.0.0.1:${testRegistry.port}/"\n`,
      },
    });

    const custom = await runWithEnv(dir, { YARN_RC_FILENAME: ".yarnrc.custom.yml" }, "pm", "migrate");
    expect(custom.stderr).toContain(`error: yarn fetches "no-deps" from http://127.0.0.1:${testRegistry.port}/`);
    expect(custom.exitCode).toBe(1);

    // without it yarn reads .yarnrc.yml, and there is none
    const standard = await run(dir, "pm", "migrate");
    expect(standard.stderr).toContain("migrated lockfile from yarn.lock");
    expect(standard.exitCode).toBe(0);
  });

  test.concurrent("a file: folder two workspaces declare has one path, as in a fresh resolve", async () => {
    const shared = (owner: string) => ({
      [`shared@file:../shared::locator=${owner}%40workspace%3Apackages%2F${owner}`]: [
        `resolution: "shared@file:../shared#../shared::hash=1f2e3d&locator=${owner}%40workspace%3Apackages%2F${owner}"`,
      ],
    });
    const { packageDir: dir } = await testRegistry.createTestDir({
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
    const { packageDir: dir } = await testRegistry.createTestDir({
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

  test.concurrent(
    "what real lockfiles hold: a range that ends in a space, dev over prod, packageExtensions",
    async () => {
      const { packageDir: dir } = await testRegistry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "berry-real",
            // yarn installs the devDependencies range of a name both groups list; bun reads `dependencies`
            dependencies: { "a-dep": "^1.0.1 || ^2.0.0", "one-range-dep": "^1.0.0" },
            devDependencies: { "a-dep": "~1.0.2" },
          }),
          // yarn adds `one-fixed-dep` to `one-range-dep` when it installs; yarn.lock has the entry, not the edge
          // (a second extension that matches adds nothing for a name the first one added)
          ".yarnrc.yml": `packageExtensions:
  one-range-dep@1:
    dependencies:
      one-fixed-dep: 1.0.0
    peerDependencies:
      a-dep: "*"
    peerDependenciesMeta:
      a-dep:
        optional: true
  one-range-dep@*:
    dependencies:
      one-fixed-dep: 2.0.0
  one-range-dep@^2.0.0:
    dependencies:
      a-dep: 1.0.1
`,
          "yarn.lock": yarnLock({
            "a-dep@npm:~1.0.2": [`version: 1.0.3`, `resolution: "a-dep@npm:1.0.3"`],
            "berry-real@workspace:.": [
              `resolution: "berry-real@workspace:."`,
              `dependencies:`,
              `  a-dep: "npm:~1.0.2"`,
              `  one-range-dep: "npm:^1.0.0"`,
            ],
            // the package.json of one-range-dep spells its range with a space at the end
            "no-deps@npm:1.0.0, no-deps@npm:^1.0.0 ": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
            "one-fixed-dep@npm:1.0.0": [
              `version: 1.0.0`,
              `resolution: "one-fixed-dep@npm:1.0.0"`,
              `dependencies:`,
              `  no-deps: "npm:1.0.0"`,
            ],
            "one-range-dep@npm:^1.0.0": [
              `version: 1.0.0`,
              `resolution: "one-range-dep@npm:1.0.0"`,
              `dependencies:`,
              `  no-deps: "npm:^1.0.0 "`,
            ],
          }),
        },
      });

      const { stderr, exitCode } = await run(dir, "pm", "migrate");
      expect(stderr).toContain("migrated lockfile from yarn.lock");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(dir);
      expect(lockedVersions(bunLock)).toEqual([
        "a-dep@1.0.3",
        "no-deps@1.0.0",
        "one-fixed-dep@1.0.0",
        "one-range-dep@1.0.0",
      ]);
      // both edges, as bun reads the package.json itself, so the next install has nothing to add
      expect(bunLock).toContain(`"a-dep": "^1.0.1 || ^2.0.0",`);
      expect(bunLock).toContain(`"devDependencies": {\n        "a-dep": "~1.0.2",\n      },`);
      expect(bunLock).toContain(
        `"one-range-dep@1.0.0", "http://localhost:1234/one-range-dep/-/one-range-dep-1.0.0.tgz", { "dependencies": { "no-deps": "^1.0.0 ", "one-fixed-dep": "1.0.0" }, "peerDependencies": { "a-dep": "*" }, "optionalPeers": ["a-dep"] }`,
      );
      // bun.lock records which dependencies an extension added, and the extensions are written where Bun reads them.
      expect(bunLock).toContain(
        `  "packageExtensions": {\n    "one-range-dep@1.0.0": { "dependencies": ["one-fixed-dep"], "peerDependencies": ["a-dep"] },\n  },\n`,
      );
      expect(stderr).toContain("copied .yarnrc.yml packageExtensions to packageExtensions in package.json");
      expect((await Bun.file(join(dir, "package.json")).json()).packageExtensions).toEqual({
        "one-range-dep@1": {
          dependencies: { "one-fixed-dep": "1.0.0" },
          peerDependencies: { "a-dep": "*" },
          peerDependenciesMeta: { "a-dep": { optional: true } },
        },
        "one-range-dep@*": { dependencies: { "one-fixed-dep": "2.0.0" } },
        "one-range-dep@^2.0.0": { dependencies: { "a-dep": "1.0.1" } },
      });
      await expectFrozenInstall(dir);
      const again = await run(dir, "install");
      expect(again.stderr).not.toContain("Saved lockfile");
      expect(await bunLockOf(dir)).toBe(bunLock);
    },
  );

  test.concurrent("packageExtensions keep working after the migration", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-extended", dependencies: { "a-dep": "^1.0.1" } }),
        ".yarnrc.yml": `packageExtensions:\n  a-dep@*:\n    dependencies:\n      no-deps: 1.0.0\n`,
        "yarn.lock": yarnLock({
          "a-dep@npm:^1.0.1": [`version: 1.0.3`, `resolution: "a-dep@npm:1.0.3"`],
          "berry-extended@workspace:.": [
            `resolution: "berry-extended@workspace:."`,
            `dependencies:`,
            `  a-dep: "npm:^1.0.1"`,
          ],
          "no-deps@npm:1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
        }),
      },
    });
    const extended = (bunLock: string) => bunLock.match(/^    "a-dep@[^\n]*$/m)?.[0];

    const migrated = await run(dir, "install");
    expect(migrated.stderr).toContain("migrated lockfile from yarn.lock");
    expect(migrated.stderr).not.toContain("error:");
    expect(migrated.exitCode).toBe(0);
    expect(lockedVersions(await bunLockOf(dir))).toEqual(["a-dep@1.0.3", "no-deps@1.0.0"]);
    expect(extended(await bunLockOf(dir))).toBe(`    "a-dep@1.0.3": { "dependencies": ["no-deps"] },`);

    // an edit of the extension moves the edge that the migration added, and nothing else
    const manifest = await Bun.file(join(dir, "package.json")).json();
    expect(manifest.packageExtensions).toEqual({ "a-dep@*": { dependencies: { "no-deps": "1.0.0" } } });
    manifest.packageExtensions["a-dep@*"].dependencies["no-deps"] = "1.0.1";
    await Bun.write(join(dir, "package.json"), JSON.stringify(manifest));
    const edited = await run(dir, "install");
    expect(edited.stderr).not.toContain("error:");
    expect(edited.exitCode).toBe(0);
    expect(lockedVersions(await bunLockOf(dir))).toEqual(["a-dep@1.0.3", "no-deps@1.0.1"]);

    // a version that is resolved later is extended as well
    const updated = await run(dir, "update", "a-dep");
    expect(updated.stderr).not.toContain("error:");
    expect(updated.exitCode).toBe(0);
    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual(["a-dep@1.0.10", "no-deps@1.0.1"]);
    expect(bunLock).toContain(`{ "dependencies": { "no-deps": "1.0.1" } }`);
    expect(extended(bunLock)).toBe(`    "a-dep@1.0.10": { "dependencies": ["no-deps"] },`);
    await expectFrozenInstall(dir);
  });

  test.concurrent("workspaces in both dependency groups, and a link: to a workspace's own folder", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-ws",
          workspaces: ["packages/*"],
          // the folder of the workspace `pkg-a`, under the workspace's own name
          dependencies: { "pkg-a": "link:./packages/pkg-a" },
        }),
        "packages/pkg-a/package.json": JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
        "packages/pkg-b/package.json": JSON.stringify({ name: "pkg-b", version: "1.0.0" }),
        "packages/pkg-c/package.json": JSON.stringify({
          name: "pkg-c",
          version: "1.0.0",
          // the same range in both groups, and two ranges for one workspace
          dependencies: { "pkg-a": "workspace:^", "pkg-b": "workspace:*" },
          devDependencies: { "pkg-a": "workspace:^", "pkg-b": "workspace:^" },
        }),
        "yarn.lock": yarnLock({
          "berry-ws@workspace:.": [
            `resolution: "berry-ws@workspace:."`,
            `dependencies:`,
            `  pkg-a: "link:./packages/pkg-a"`,
          ],
          "pkg-a@link:./packages/pkg-a::locator=berry-ws%40workspace%3A.": [
            `resolution: "pkg-a@link:./packages/pkg-a::locator=berry-ws%40workspace%3A."`,
          ],
          "pkg-a@workspace:^, pkg-a@workspace:packages/pkg-a": [`resolution: "pkg-a@workspace:packages/pkg-a"`],
          "pkg-b@workspace:^, pkg-b@workspace:packages/pkg-b": [`resolution: "pkg-b@workspace:packages/pkg-b"`],
          "pkg-c@workspace:packages/pkg-c": [
            `resolution: "pkg-c@workspace:packages/pkg-c"`,
            `dependencies:`,
            `  pkg-a: "workspace:^"`,
            `  pkg-b: "workspace:^"`,
          ],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(lockedVersions(await bunLockOf(dir))).toEqual([
      "pkg-a@workspace:packages/pkg-a",
      "pkg-b@workspace:packages/pkg-b",
      "pkg-c@workspace:packages/pkg-c",
    ]);
    await expectFrozenInstall(dir);
  });

  // yarn's `enableTransparentWorkspaces` (the default): the range is one more descriptor of the workspace's entry
  test.concurrent("a plain range that yarn resolved to a sibling workspace", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-transparent", workspaces: ["packages/*"] }),
        // the registry has no-deps@1.0.0 too
        "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0", private: true }),
        "packages/pkg-b/package.json": JSON.stringify({
          name: "pkg-b",
          version: "1.0.0",
          dependencies: { "no-deps": "^1.0.0" },
        }),
        "yarn.lock": yarnLock({
          "berry-transparent@workspace:.": [`resolution: "berry-transparent@workspace:."`],
          "no-deps@npm:^1.0.0, no-deps@workspace:packages/no-deps": [
            `resolution: "no-deps@workspace:packages/no-deps"`,
          ],
          "pkg-b@workspace:packages/pkg-b": [
            `resolution: "pkg-b@workspace:packages/pkg-b"`,
            `dependencies:`,
            `  no-deps: "npm:^1.0.0"`,
          ],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"no-deps": "^1.0.0",`);
    expect(lockedVersions(bunLock)).toEqual(["no-deps@workspace:packages/no-deps", "pkg-b@workspace:packages/pkg-b"]);
    expect(await Bun.file(join(dir, "node_modules", "no-deps", "package.json")).json()).toHaveProperty("private", true);
    await expectFrozenInstall(dir);
  });

  test.concurrent("a range yarn.lock has no key for is the workspace that satisfies it", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-stale", workspaces: ["packages/*"] }),
        // pkg-a went from 1.1.0 to 1.2.0 and pkg-b's range with it; yarn.lock still has the old range
        "packages/pkg-a/package.json": JSON.stringify({ name: "pkg-a", version: "1.2.0" }),
        "packages/pkg-b/package.json": JSON.stringify({
          name: "pkg-b",
          version: "1.0.0",
          dependencies: { "pkg-a": "^1.2.0", "no-deps": "^1.0.0" },
        }),
        "yarn.lock": yarnLock({
          "berry-stale@workspace:.": [`resolution: "berry-stale@workspace:."`],
          "no-deps@npm:^1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
          "pkg-a@npm:^1.1.0, pkg-a@workspace:packages/pkg-a": [`resolution: "pkg-a@workspace:packages/pkg-a"`],
          "pkg-b@workspace:packages/pkg-b": [
            `resolution: "pkg-b@workspace:packages/pkg-b"`,
            `dependencies:`,
            `  no-deps: "npm:^1.0.0"`,
            `  pkg-a: "npm:^1.1.0"`,
          ],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(lockedVersions(await bunLockOf(dir))).toEqual([
      "no-deps@1.0.0",
      "pkg-a@workspace:packages/pkg-a",
      "pkg-b@workspace:packages/pkg-b",
    ]);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
  });

  test.concurrent("the packageExtensions yarn ships, and optional peers from packageExtensions", async () => {
    const project = (lockExtra: Record<string, string[]>, rcExtra = "") => ({
      "package.json": JSON.stringify({
        name: "berry-builtin",
        dependencies: { "@babel/parser": "^7.0.0", "peer-deps-fixed": "^1.0.0" },
      }),
      // peer-deps-fixed has the peer no-deps@^1.0.0; with this yarn does not ask for it
      ".yarnrc.yml": `packageExtensions:\n  peer-deps-fixed@*:\n    peerDependenciesMeta:\n      no-deps:\n        optional: true\n${rcExtra}`,
      "yarn.lock": yarnLock({
        "@babel/parser@npm:^7.0.0": [`version: 7.23.0`, `resolution: "@babel/parser@npm:7.23.0"`],
        "berry-builtin@workspace:.": [
          `resolution: "berry-builtin@workspace:."`,
          `dependencies:`,
          `  "@babel/parser": "npm:^7.0.0"`,
          `  peer-deps-fixed: "npm:^1.0.0"`,
        ],
        "peer-deps-fixed@npm:^1.0.0": [
          `version: 1.0.0`,
          `resolution: "peer-deps-fixed@npm:1.0.0"`,
          `peerDependencies:`,
          `  no-deps: ^1.0.0`,
        ],
        ...lockExtra,
      }),
    });

    // yarn's own list has `@babel/parser@*` -> `@babel/types@^7.8.3`: the entry is in
    // yarn.lock, the edge to it is not
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      // yarn registers its own list first, so the same name from .yarnrc.yml (another range) adds nothing
      files: project(
        { "@babel/types@npm:^7.8.3": [`version: 7.8.3`, `resolution: "@babel/types@npm:7.8.3"`] },
        `  "@babel/parser@*":\n    dependencies:\n      "@babel/types": ^7.9.0\n`,
      ),
    });
    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    const bunLock = await bunLockOf(dir);
    // 7.9.0 is newer; no-deps is not installed for the optional peer
    expect(lockedVersions(bunLock)).toEqual(["@babel/parser@7.23.0", "@babel/types@7.8.3", "peer-deps-fixed@1.0.0"]);
    expect(bunLock).toContain(
      `"@babel/parser@7.23.0", "http://localhost:1234/@babel/parser/-/parser-7.23.0.tgz", { "dependencies": { "@babel/types": "^7.8.3" } }`,
    );
    expect(bunLock).toContain(`{ "peerDependencies": { "no-deps": "^1.0.0" }, "optionalPeers": ["no-deps"] }`);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
    // Nothing in package.json corresponds to Yarn's builtin extension, and the next install keeps what it added.
    const again = await run(dir, "install");
    expect(again.stderr).not.toContain("error:");
    expect(await bunLockOf(dir)).toBe(bunLock);
    expect(again.exitCode).toBe(0);

    // a yarn release without that extension wrote no entry for it: nothing is added
    const { packageDir: olderDir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: project({}),
    });
    const older = await run(olderDir, "pm", "migrate");
    expect(older.stderr).toContain("migrated lockfile from yarn.lock");
    expect(lockedVersions(await bunLockOf(olderDir))).toEqual(["@babel/parser@7.23.0", "peer-deps-fixed@1.0.0"]);
    expect(older.exitCode).toBe(0);
  });

  test.concurrent("a resolution keyed on an npm: alias, and on a range after npm:", async () => {
    const patch = await Bun.file(
      join(import.meta.dir, "yarn-berry", "patch", ".yarn", "patches", "no-deps-npm-1.0.1-aa11bb22cc.patch"),
    ).text();
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-alias-rule",
          workspaces: ["packages/*"],
          resolutions: {
            // the key is the alias descriptor a workspace declares
            "pkg-alias@npm:no-deps@^1.0.0": "patch:no-deps@npm:1.0.1#~/.yarn/patches/p.patch",
            "a-dep@npm:>=1.0.1": "1.0.3",
          },
        }),
        "packages/a/package.json": JSON.stringify({
          name: "a",
          version: "1.0.0",
          dependencies: {
            "pkg-alias": "npm:no-deps@^1.0.0",
            // one patch: range under the name of the package it patches and under another name
            "no-deps": "patch:no-deps@npm%3A1.0.1#~/.yarn/patches/p.patch",
            "other-alias": "patch:no-deps@npm%3A1.0.1#~/.yarn/patches/p.patch",
            "a-dep": ">=1.0.1",
          },
        }),
        ".yarn/patches/p.patch": patch,
        "yarn.lock": yarnLock({
          "a-dep@npm:1.0.3": [`version: 1.0.3`, `resolution: "a-dep@npm:1.0.3"`],
          "a@workspace:packages/a": [
            `resolution: "a@workspace:packages/a"`,
            `dependencies:`,
            `  a-dep: "npm:>=1.0.1"`,
            `  no-deps: "patch:no-deps@npm%3A1.0.1#~/.yarn/patches/p.patch"`,
            `  other-alias: "patch:no-deps@npm%3A1.0.1#~/.yarn/patches/p.patch"`,
            `  pkg-alias: "npm:no-deps@^1.0.0"`,
          ],
          "berry-alias-rule@workspace:.": [`resolution: "berry-alias-rule@workspace:."`],
          "no-deps@npm:1.0.1": [`version: 1.0.1`, `resolution: "no-deps@npm:1.0.1"`],
          "no-deps@patch:no-deps@npm%3A1.0.1#~/.yarn/patches/p.patch, other-alias@patch:no-deps@npm%3A1.0.1#~/.yarn/patches/p.patch, pkg-alias@patch:no-deps@npm:1.0.1#~/.yarn/patches/p.patch":
            [
              `version: 1.0.1`,
              `resolution: "no-deps@patch:no-deps@npm%3A1.0.1#~/.yarn/patches/p.patch::version=1.0.1&hash=abc123"`,
            ],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("Missing version range");
    expect(exitCode).toBe(0);

    // under the alias, the range that replaces `patch:` names the package it patches
    expect((await Bun.file(join(dir, "package.json")).json()).resolutions).toEqual({
      "pkg-alias@npm:no-deps@^1.0.0": "npm:no-deps@1.0.1",
      "a-dep@npm:>=1.0.1": "1.0.3",
    });
    expect((await Bun.file(join(dir, "packages", "a", "package.json")).json()).dependencies).toEqual({
      "pkg-alias": "npm:no-deps@^1.0.0",
      "no-deps": "1.0.1",
      "other-alias": "npm:no-deps@1.0.1",
      "a-dep": ">=1.0.1",
    });
    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`"patchedDependencies": {\n    "no-deps@1.0.1": ".yarn/patches/p.patch",\n  },`);
    // both keys are read back, so neither warns and both rules survive a later re-resolve
    expect(stderr).not.toContain("warn:");
    expect(bunLock).toContain(`    "a-dep@>=1.0.1": {\n      ".": "1.0.3",\n    },\n`);
    expect(bunLock).toContain(`    "pkg-alias@npm:no-deps@^1.0.0": {\n      ".": "npm:no-deps@1.0.1",\n    },\n`);
    expect(lockedVersions(bunLock)).toEqual([
      "a-dep@1.0.3",
      "a@workspace:packages/a",
      "no-deps@1.0.1",
      "no-deps@1.0.1",
      "no-deps@1.0.1",
    ]);
    for (const alias of ["pkg-alias", "other-alias", "no-deps"]) {
      expect(await Bun.file(join(dir, "node_modules", alias, "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.0.1",
      });
      expect(await Bun.file(join(dir, "node_modules", alias, "patched-too.txt")).text()).toBe("hello world\n");
    }
    await expectFrozenInstall(dir);
  });

  test.concurrent("a resolution keyed on catalog: is kept as an override", async () => {
    const patch = await Bun.file(
      join(import.meta.dir, "yarn-berry", "patch", ".yarn", "patches", "no-deps-npm-1.0.1-aa11bb22cc.patch"),
    ).text();
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-catalog-rule",
          workspaces: ["packages/*"],
          resolutions: { "no-deps@catalog:": "patch:no-deps@npm:1.0.1#~/.yarn/patches/p.patch" },
        }),
        "packages/a/package.json": JSON.stringify({
          name: "a",
          version: "1.0.0",
          dependencies: { "no-deps": "catalog:" },
        }),
        ".yarnrc.yml": `catalog:\n  no-deps: ^1.0.0\n`,
        ".yarn/patches/p.patch": patch,
        "yarn.lock": yarnLock({
          "a@workspace:packages/a": [`resolution: "a@workspace:packages/a"`, `dependencies:`, `  no-deps: "catalog:"`],
          "berry-catalog-rule@workspace:.": [`resolution: "berry-catalog-rule@workspace:."`],
          "no-deps@npm:1.0.1": [`version: 1.0.1`, `resolution: "no-deps@npm:1.0.1"`],
          "no-deps@patch:no-deps@npm:1.0.1#~/.yarn/patches/p.patch": [
            `version: 1.0.1`,
            `resolution: "no-deps@patch:no-deps@npm%3A1.0.1#~/.yarn/patches/p.patch::version=1.0.1&hash=abc123"`,
          ],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).not.toContain("warn:");
    expect(stderr).not.toContain("error:");
    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`    "no-deps@catalog:": {\n      ".": "1.0.1",\n    },\n`);
    expect(bunLock).toContain(`"patchedDependencies": {\n    "no-deps@1.0.1": ".yarn/patches/p.patch",\n  },`);
    expect(lockedVersions(bunLock)).toEqual(["a@workspace:packages/a", "no-deps@1.0.1"]);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);

    // the catalog allows 1.1.0, and the rule is what keeps 1.0.1 when the lockfile is gone
    await rm(join(dir, "bun.lock"));
    await rm(join(dir, "yarn.lock"));
    const fresh = await run(dir, "install");
    expect(fresh.stderr).not.toContain("warn:");
    expect(lockedVersions(await bunLockOf(dir))).toEqual(["a@workspace:packages/a", "no-deps@1.0.1"]);
    expect(fresh.exitCode).toBe(0);
  });

  test.concurrent("catalog: in the dependencies a packageExtension adds", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-ext-catalog", dependencies: { "no-deps": "^1.0.0" } }),
        ".yarnrc.yml": `catalog:\n  a-dep: ^1.0.1\npackageExtensions:\n  no-deps@^1.0.0:\n    dependencies:\n      a-dep: "catalog:"\n`,
        "yarn.lock": yarnLock({
          "a-dep@npm:^1.0.1": [`version: 1.0.3`, `resolution: "a-dep@npm:1.0.3"`],
          "berry-ext-catalog@workspace:.": [
            `resolution: "berry-ext-catalog@workspace:."`,
            `dependencies:`,
            `  no-deps: "npm:^1.0.0"`,
          ],
          "no-deps@npm:^1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    const bunLock = await bunLockOf(dir);
    // the catalog's range, not `catalog:`: a package of the registry has no catalog
    expect(bunLock).toContain(
      `"no-deps@1.0.0", "http://localhost:1234/no-deps/-/no-deps-1.0.0.tgz", { "dependencies": { "a-dep": "^1.0.1" } }`,
    );
    expect(lockedVersions(bunLock)).toEqual(["a-dep@1.0.3", "no-deps@1.0.0"]);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
    // the copy in package.json has the range too: `catalog:` there is ignored, and the next install would drop the edge
    expect((await Bun.file(join(dir, "package.json")).json()).packageExtensions).toEqual({
      "no-deps@^1.0.0": { dependencies: { "a-dep": "^1.0.1" } },
    });
    const again = await run(dir, "install");
    expect(again.stderr).not.toContain("warn:");
    expect(again.stderr).not.toContain("error:");
    expect(await bunLockOf(dir)).toBe(bunLock);
    expect(again.exitCode).toBe(0);
  });

  // Every rule is copied to package.json. An install ignores a whole rule over one unsupported range,
  // so the next frozen install would fail and a plain one would drop the rule's other edges.
  test.concurrent.each([
    ["matching rule", `  no-deps@*:\n    dependencies:\n      shared: "workspace:*"\n`, "no-deps@*"],
    [
      "rule that matches no locked version",
      `  no-deps@^9:\n    dependencies:\n      shared: "workspace:*"\n`,
      "no-deps@^9",
    ],
    [
      "name already added by an earlier rule",
      `  no-deps@*:\n    dependencies:\n      shared: "^1.0.0"\n  no-deps@^1:\n    dependencies:\n      shared: "workspace:*"\n    peerDependencies:\n      what-bin: "*"\n`,
      "no-deps@^1",
    ],
  ])("not migrated: unsupported range in packageExtensions (%s)", async (_, rules, key) => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "berry-ext-workspace",
          workspaces: ["packages/*"],
          dependencies: { "no-deps": "^1.0.0" },
        }),
        "packages/shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
        ".yarnrc.yml": `packageExtensions:\n${rules}`,
        "yarn.lock": yarnLock({
          "berry-ext-workspace@workspace:.": [
            `resolution: "berry-ext-workspace@workspace:."`,
            `dependencies:`,
            `  no-deps: "npm:^1.0.0"`,
          ],
          "no-deps@npm:^1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
          "shared@workspace:*, shared@workspace:packages/shared": [`resolution: "shared@workspace:packages/shared"`],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain(
      `error: packageExtensions "${key}" in .yarnrc.yml: expected a version, a tag, a git repository or a tarball URL for every dependency`,
    );
    expect(existsSync(join(dir, "bun.lock"))).toBe(false);
    expect((await Bun.file(join(dir, "package.json")).json()).packageExtensions).toBeUndefined();
    expect(exitCode).toBe(1);
  });

  // The migration and the next install have to agree on which versions a rule matches.
  test.concurrent.each([
    ["1.x", "1.0.0-future.1", true],
    ["1.0.x", "1.0.0-future.1", true],
    ["^1", "1.0.0-future.1", true],
    ["1.0.0 - 1.1.0", "1.0.0-future.1", true],
    // node-semver does not lower these two bounds, even with includePrerelease
    ["^1.0.0", "1.0.0-future.1", false],
    ["~1", "1.0.0-future.1", false],
  ])("packageExtensions key %s on a locked %s matches like yarn", async (range, version, applies) => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-ext-key", dependencies: { "prereleases-1": version } }),
        ".yarnrc.yml": `packageExtensions:\n  "prereleases-1@${range}":\n    dependencies:\n      a-dep: "^1.0.1"\n`,
        "yarn.lock": yarnLock({
          "a-dep@npm:^1.0.1": [`version: 1.0.3`, `resolution: "a-dep@npm:1.0.3"`],
          "berry-ext-key@workspace:.": [
            `resolution: "berry-ext-key@workspace:."`,
            `dependencies:`,
            `  prereleases-1: "npm:${version}"`,
          ],
          [`prereleases-1@npm:${version}`]: [`version: ${version}`, `resolution: "prereleases-1@npm:${version}"`],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).not.toContain("error:");
    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual(
      applies ? ["a-dep@1.0.3", `prereleases-1@${version}`] : [`prereleases-1@${version}`],
    );
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
    const again = await run(dir, "install");
    expect(again.stderr).not.toContain("warn:");
    expect(await bunLockOf(dir)).toBe(bunLock);
    expect(again.exitCode).toBe(0);
  });

  test.concurrent("strips npm: from a range added by packageExtensions", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-ext-npm", dependencies: { "no-deps": "^1.0.0" } }),
        ".yarnrc.yml": `packageExtensions:\n  "no-deps@npm:^1.0.0":\n    dependencies:\n      a-dep: "npm:^1.0.1"\n`,
        "yarn.lock": yarnLock({
          "a-dep@npm:^1.0.1": [`version: 1.0.3`, `resolution: "a-dep@npm:1.0.3"`],
          "berry-ext-npm@workspace:.": [
            `resolution: "berry-ext-npm@workspace:."`,
            `dependencies:`,
            `  no-deps: "npm:^1.0.0"`,
          ],
          "no-deps@npm:^1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).not.toContain("error:");
    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual(["a-dep@1.0.3", "no-deps@1.0.0"]);
    // package.json would parse `npm:^1.0.1` as an alias for a package named `^1.0.1`
    expect((await Bun.file(join(dir, "package.json")).json()).packageExtensions).toEqual({
      "no-deps@npm:^1.0.0": { dependencies: { "a-dep": "^1.0.1" } },
    });
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
    const again = await run(dir, "install");
    expect(again.stderr).not.toContain("warn:");
    expect(again.stderr).not.toContain("error:");
    expect(await bunLockOf(dir)).toBe(bunLock);
    expect(again.exitCode).toBe(0);
  });

  test.concurrent("a dist tag in one of two dependency groups accepts what yarn.lock pins", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-group-tag", workspaces: ["packages/*"] }),
        "packages/a/package.json": JSON.stringify({
          name: "a",
          version: "1.0.0",
          dependencies: { "no-deps": "latest" },
          devDependencies: { "no-deps": "^1.0.0" },
        }),
        "yarn.lock": yarnLock({
          "a@workspace:packages/a": [
            `resolution: "a@workspace:packages/a"`,
            `dependencies:`,
            `  no-deps: "npm:^1.0.0"`,
          ],
          "berry-group-tag@workspace:.": [`resolution: "berry-group-tag@workspace:."`],
          "no-deps@npm:^1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    const bunLock = await bunLockOf(dir);
    expect(lockedVersions(bunLock)).toEqual(["a@workspace:packages/a", "no-deps@1.0.0"]);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
    const again = await run(dir, "install");
    expect(await bunLockOf(dir)).toBe(bunLock);
    expect(again.exitCode).toBe(0);
  });

  test.concurrent("a workspace keeps a name in every dependency group that lists it", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "berry-groups", workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        version: "1.0.0",
        dependencies: { "a-dep": "^1.0.1" },
        devDependencies: { "no-deps": "^1.0.0" },
        // the same range as the group above, and another range than `dependencies`
        optionalDependencies: { "no-deps": "^1.0.0", "a-dep": "~1.0.2" },
      }),
    };
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        ...files,
        // yarn installs one range for a name: devDependencies', else optionalDependencies'
        "yarn.lock": yarnLock({
          "a-dep@npm:~1.0.2": [`version: 1.0.3`, `resolution: "a-dep@npm:1.0.3"`],
          "a@workspace:packages/a": [
            `resolution: "a@workspace:packages/a"`,
            `dependencies:`,
            `  a-dep: "npm:~1.0.2"`,
            `  no-deps: "npm:^1.0.0"`,
            `dependenciesMeta:`,
            `  a-dep:`,
            `    optional: true`,
          ],
          "berry-groups@workspace:.": [`resolution: "berry-groups@workspace:."`],
          "no-deps@npm:^1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "pm", "migrate");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    const bunLock = await bunLockOf(dir);
    expect(bunLock).toContain(`    "packages/a": {
      "name": "a",
      "version": "1.0.0",
      "dependencies": {
        "a-dep": "^1.0.1",
      },
      "devDependencies": {
        "no-deps": "^1.0.0",
      },
      "optionalDependencies": {
        "a-dep": "~1.0.2",
        "no-deps": "^1.0.0",
      },
    },`);
    expect(lockedVersions(bunLock)).toEqual(["a-dep@1.0.3", "a@workspace:packages/a", "no-deps@1.0.0"]);

    // the same groups as bun writes for these package.json files with no yarn.lock
    const { packageDir: freshDir } = await testRegistry.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });
    expect((await run(freshDir, "install", "--lockfile-only")).exitCode).toBe(0);
    const workspaces = (lock: string) => lock.slice(lock.indexOf(`  "workspaces": {`), lock.indexOf(`  "packages": {`));
    expect(workspaces(bunLock)).toBe(workspaces(await bunLockOf(freshDir)));

    // and the next install has nothing to add
    await expectFrozenInstall(dir);
    const again = await run(dir, "install");
    expect(again.stderr).not.toContain("Saved lockfile");
    expect(await bunLockOf(dir)).toBe(bunLock);
  });

  test.concurrent("a workspace folder with % and two hex digits in its name", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-percent", workspaces: ["packages/*"] }),
        "packages/50%ab/package.json": JSON.stringify({
          name: "ws",
          version: "1.0.0",
          dependencies: { local: "file:./local" },
        }),
        "packages/50%ab/local/package.json": JSON.stringify({ name: "local", version: "1.0.0" }),
        // yarn encodes the owner of a relative folder once: `%` is `%25`
        "yarn.lock": yarnLock({
          "berry-percent@workspace:.": [`resolution: "berry-percent@workspace:."`],
          "local@file:./local::locator=ws%40workspace%3Apackages%2F50%25ab": [
            `resolution: "local@file:./local#./local::hash=abc123&locator=ws%40workspace%3Apackages%2F50%25ab"`,
          ],
          "ws@workspace:packages/50%ab": [
            `resolution: "ws@workspace:packages/50%ab"`,
            `dependencies:`,
            `  local: "file:./local"`,
          ],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(lockedVersions(await bunLockOf(dir))).toEqual([
      "local@file:packages/50%ab/local",
      "ws@workspace:packages/50%ab",
    ]);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
  });

  test.concurrent("a name with a range in one dependency group and catalog: in another", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "berry-group-catalog", workspaces: ["packages/*"] }),
        ".yarnrc.yml": `catalog:\n  a-dep: ~1.0.2\n  no-deps: ^1.0.0\n  what-bin: ~1.0.0\n`,
        "packages/a/package.json": JSON.stringify({
          name: "a",
          version: "1.0.0",
          // yarn installs the optionalDependencies range over the dependencies one, and devDependencies' over both
          dependencies: { "a-dep": "^1.0.1", "no-deps": "1.x", "one-fixed-dep": "latest" },
          // (a tag accepts any version: `latest` beside the range yarn installs)
          devDependencies: { "no-deps": "catalog:", "what-bin": "catalog:", "one-fixed-dep": "^1.0.0" },
          optionalDependencies: { "a-dep": "catalog:" },
          // a peer is not one of yarn's groups for the name: catalog: beside it is looked up as itself
          peerDependencies: { "what-bin": ">=1.0.0" },
        }),
        // keyed by the catalog's ranges
        "yarn.lock": yarnLock({
          "a-dep@npm:~1.0.2": [`version: 1.0.3`, `resolution: "a-dep@npm:1.0.3"`],
          "a@workspace:packages/a": [
            `resolution: "a@workspace:packages/a"`,
            `dependencies:`,
            `  a-dep: "npm:~1.0.2"`,
            `  no-deps: "npm:^1.0.0"`,
            `  one-fixed-dep: "npm:^1.0.0"`,
            `  what-bin: "npm:~1.0.0"`,
            `peerDependencies:`,
            `  what-bin: ">=1.0.0"`,
            `dependenciesMeta:`,
            `  a-dep:`,
            `    optional: true`,
          ],
          "berry-group-catalog@workspace:.": [`resolution: "berry-group-catalog@workspace:."`],
          "no-deps@npm:1.0.0, no-deps@npm:^1.0.0": [`version: 1.0.0`, `resolution: "no-deps@npm:1.0.0"`],
          "one-fixed-dep@npm:^1.0.0": [
            `version: 1.0.0`,
            `resolution: "one-fixed-dep@npm:1.0.0"`,
            `dependencies:`,
            `  no-deps: "npm:1.0.0"`,
          ],
          "what-bin@npm:~1.0.0": [`version: 1.0.0`, `resolution: "what-bin@npm:1.0.0"`],
        }),
      },
    });

    const { stderr, exitCode } = await run(dir, "install");
    expect(stderr).toContain("migrated lockfile from yarn.lock");
    expect(stderr).not.toContain("error:");
    expect(lockedVersions(await bunLockOf(dir))).toEqual([
      "a-dep@1.0.3",
      "a@workspace:packages/a",
      "no-deps@1.0.0",
      "one-fixed-dep@1.0.0",
      "what-bin@1.0.0",
    ]);
    expect(exitCode).toBe(0);
    await expectFrozenInstall(dir);
  });

  test.concurrent("a berry lockfile that holds the yarn v1 marker below its first lines", async () => {
    const { packageDir: dir } = await testRegistry.createTestDir({
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
