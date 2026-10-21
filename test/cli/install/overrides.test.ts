import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, nodeModulesPackages, normalizeBunSnapshot } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";

// Fixtures from ./registry/packages used below:
//   no-deps        1.0.0, 1.0.1, 1.1.0 and 2.0.0 (latest), the package the overrides target
//   one-dep        1.0.0, depends on no-deps@1.0.1
//   one-range-dep  1.0.0, depends on no-deps@^1.0.0
//   a-dep          1.0.1 to 1.0.10 (latest), no dependencies
const registry = new TestRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

async function project(packageJson: Record<string, unknown>, files: Record<string, string> = {}) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: { "package.json": JSON.stringify(packageJson), ...files },
  });
  return packageDir;
}

// Printed only by installs that had registry work to do; the bracketed task count is not what these tests check.
const progressLine = /^Resolv(?:ing dependencies|ed, downloaded and extracted \[\d+\])\r?\n?/gm;

async function bun(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    // CI exports BUN_INSTALL_CACHE_DIR, which overrides the bunfig's per-test `cache`; concurrent tests sharing one cache race on Windows.
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: normalizeBunSnapshot(stdout, dir),
    stderr: normalizeBunSnapshot(stderr.replace(progressLine, ""), dir),
    exitCode,
  };
}

const lockfile = (dir: string) => file(join(dir, "bun.lock")).text();

async function editPackageJson(dir: string, edit: (pkg: Record<string, unknown>) => void) {
  const path = join(dir, "package.json");
  const pkg = await file(path).json();
  edit(pkg);
  await write(path, JSON.stringify(pkg));
}

// `lock` is the bun.lock written by the install under test. The frozen install checks that bun considers it in sync with
// package.json; the plain install checks that it is neither re-resolved nor re-saved (each goes through its own comparison).
async function expectLockfileStable(dir: string, lock: string) {
  const frozen = await bun(dir, "install", "--frozen-lockfile");
  expect(frozen.stderr).toBe("");
  expect(frozen.exitCode).toBe(0);

  const plain = await bun(dir, "install");
  expect(plain.stderr).toBe("");
  expect(plain.exitCode).toBe(0);

  expect(await lockfile(dir)).toBe(lock);
}

test.concurrent("overrides affect your own packages", async () => {
  const dir = await project({ dependencies: {}, overrides: { "no-deps": "1.0.0" } });

  const { stdout, stderr, exitCode } = await bun(dir, "install", "no-deps", "a-dep");

  expect(stdout).toMatchInlineSnapshot(`
    "bun add <version> (<revision>)

    installed no-deps@1.0.0
    installed a-dep@1.0.10

    2 packages installed"
  `);
  expect(stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(exitCode).toBe(0);
  expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
    "node_modules/a-dep/a-dep@1.0.10
    node_modules/no-deps/no-deps@1.0.0"
  `);
  await expectLockfileStable(dir, await lockfile(dir));
});

test.concurrent("overrides affects all dependencies", async () => {
  const dir = await project({ dependencies: {}, overrides: { "no-deps": "1.0.0" } });

  const { stdout, stderr, exitCode } = await bun(dir, "install", "one-dep", "one-range-dep");

  expect(stdout).toMatchInlineSnapshot(`
    "bun add <version> (<revision>)

    installed one-dep@1.0.0
    installed one-range-dep@1.0.0

    3 packages installed"
  `);
  expect(stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(exitCode).toBe(0);
  expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
    "node_modules/no-deps/no-deps@1.0.0
    node_modules/one-dep/one-dep@1.0.0
    node_modules/one-range-dep/one-range-dep@1.0.0"
  `);
  await expectLockfileStable(dir, await lockfile(dir));
});

test.concurrent("overrides being set later affects all dependencies", async () => {
  const dir = await project({ dependencies: {} });
  const add = await bun(dir, "install", "one-dep");
  expect(add.stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(add.exitCode).toBe(0);
  expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
    "node_modules/no-deps/no-deps@1.0.1
    node_modules/one-dep/one-dep@1.0.0"
  `);
  await expectLockfileStable(dir, await lockfile(dir));

  await editPackageJson(dir, pkg => (pkg.overrides = { "no-deps": "1.0.0" }));
  const { stdout, stderr, exitCode } = await bun(dir, "install");

  expect(stdout).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    1 package installed"
  `);
  expect(stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(exitCode).toBe(0);
  expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
    "node_modules/no-deps/no-deps@1.0.0
    node_modules/one-dep/one-dep@1.0.0"
  `);
  await expectLockfileStable(dir, await lockfile(dir));
});

test.concurrent("overrides to npm specifier", async () => {
  const dir = await project({ dependencies: {}, overrides: { "no-deps": "npm:a-dep@1.0.1" } });

  const { stdout, stderr, exitCode } = await bun(dir, "install", "one-dep");

  expect(stdout).toMatchInlineSnapshot(`
    "bun add <version> (<revision>)

    installed one-dep@1.0.0

    2 packages installed"
  `);
  expect(stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(exitCode).toBe(0);
  expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
    "node_modules/no-deps/a-dep@1.0.1
    node_modules/one-dep/one-dep@1.0.0"
  `);
  await expectLockfileStable(dir, await lockfile(dir));
});

test.concurrent("changing overrides makes the lockfile changed, prevent frozen install", async () => {
  const dir = await project({ dependencies: {}, overrides: { "no-deps": "1.0.0" } });
  const add = await bun(dir, "install", "one-dep");
  expect(add.stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(add.exitCode).toBe(0);
  const lock = await lockfile(dir);
  const tree = nodeModulesPackages(dir);
  expect(tree).toMatchInlineSnapshot(`
    "node_modules/no-deps/no-deps@1.0.0
    node_modules/one-dep/one-dep@1.0.0"
  `);

  await editPackageJson(dir, pkg => (pkg.overrides = { "no-deps": "1.1.0" }));
  const { stdout, stderr, exitCode } = await bun(dir, "install", "--frozen-lockfile");

  expect(stdout).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
  expect(stderr).toMatchInlineSnapshot(`
    "error: lockfile had changes, but lockfile is frozen
    note: overrides in package.json changed since bun.lock was saved
    note: try re-running without --frozen-lockfile and commit the updated lockfile"
  `);
  expect(exitCode).toBe(1);
  expect(await lockfile(dir)).toBe(lock);
  expect(nodeModulesPackages(dir)).toBe(tree);
});

test.concurrent("overrides reset when removed", async () => {
  const dir = await project({ overrides: { "no-deps": "1.0.0" } });
  const add = await bun(dir, "install", "one-dep");
  expect(add.stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(add.exitCode).toBe(0);
  expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
    "node_modules/no-deps/no-deps@1.0.0
    node_modules/one-dep/one-dep@1.0.0"
  `);
  expect(await lockfile(dir)).toContain('"overrides"');

  await editPackageJson(dir, pkg => delete pkg.overrides);
  const { stdout, stderr, exitCode } = await bun(dir, "install");

  expect(stdout).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    1 package installed"
  `);
  expect(stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(exitCode).toBe(0);
  expect(nodeModulesPackages(dir)).toMatchInlineSnapshot(`
    "node_modules/no-deps/no-deps@1.0.1
    node_modules/one-dep/one-dep@1.0.0"
  `);
  const lock = await lockfile(dir);
  expect(lock).not.toContain('"overrides"');
  await expectLockfileStable(dir, lock);
});

test.concurrent("overrides do not apply to workspaces", async () => {
  const dir = await project(
    { name: "monorepo-root", workspaces: ["packages/*"], overrides: { pkg1: "file:pkg2" } },
    {
      "packages/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.1.1" }),
      "pkg2/package.json": JSON.stringify({ name: "pkg2", version: "2.2.2" }),
    },
  );

  const { stdout, stderr, exitCode } = await bun(dir, "install");

  expect(stdout).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    1 package installed"
  `);
  expect(stderr).toMatchInlineSnapshot(`"Saved lockfile"`);
  expect(exitCode).toBe(0);
  // node_modules/pkg1 links to the workspace; the override is recorded but does not redirect it to pkg2.
  expect(await file(join(dir, "node_modules", "pkg1", "package.json")).json()).toEqual({
    name: "pkg1",
    version: "1.1.1",
  });
  const lock = await lockfile(dir);
  expect(lock).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "monorepo-root",
        },
        "packages/pkg1": {
          "name": "pkg1",
          "version": "1.1.1",
        },
      },
      "overrides": {
        "pkg1": "file:pkg2",
      },
      "packages": {
        "pkg1": ["pkg1@workspace:packages/pkg1"],
      }
    }
    "
  `);
  await expectLockfileStable(dir, lock);
});

// `bun install` resolves a second time when the first resolve leaves an entry that its rule does not allow. In most of
// these tests bun.lock records the rule `r: 2.0.0` and still has r@1.0.0, as after the merge in "a merge took the rule of
// one branch and the entry of the other" below. The second resolve runs after the unused packages are removed from the
// lockfile, which numbers the packages and their dependencies again. What the first resolve remembers by those numbers
// has to follow.
describe("the entry that a rule replaces is resolved after the lockfile is cleaned", () => {
  type Packages = Record<string, Record<string, object>>;
  type Served = { hold?: string; until?: string; latest?: Record<string, string> };

  const pack = (json: object) =>
    new Bun.Archive({ "package/package.json": JSON.stringify(json) }, { compress: "gzip" }).bytes();

  /**
   * A registry for `packages`. `/<name>.tgz` is the package `<name>@1.0.0`, for a dependency on that URL. The answer to
   * `hold` waits for a request for `until`. `latest` has the `latest` tag of a package where that is not its newest
   * version.
   */
  function serve(packages: (origin: string) => Packages, { hold, until, latest = {} }: Served = {}) {
    const archives = new Map<string, Promise<Uint8Array>>();
    const requests: string[] = [];
    const gate = Promise.withResolvers<void>();
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { origin, pathname } = new URL(request.url);
        requests.push(pathname);
        if (pathname === until) gate.resolve();
        if (pathname === hold) await gate.promise;
        const registry = packages(origin);
        const [, name, version] = /^\/(\w+?)(?:-([\d.]+))?\.tgz$/.exec(pathname) ?? [];
        const declares = version ? registry[name]?.[version] : name && {};
        if (declares) {
          // One archive per URL: bun.lock pins its bytes.
          if (!archives.has(pathname)) archives.set(pathname, pack({ name, version: version ?? "1.0.0", ...declares }));
          return new Response(await archives.get(pathname));
        }
        const named = pathname.slice(1);
        const versions = registry[named];
        if (!versions) return new Response(null, { status: 404 });
        const tarball = (version: string) => `${origin}${pathname}-${version}.tgz`;
        return Response.json({
          name: named,
          "dist-tags": { latest: latest[named] ?? Object.keys(versions).sort(Bun.semver.order).at(-1) },
          versions: Object.fromEntries(
            Object.entries(versions).map(([version, declares]) => [
              version,
              { name: named, version, dist: { tarball: tarball(version) }, ...declares },
            ]),
          ),
        });
      },
    });
    const bunfig = `[install]\nregistry = "${server.url.href}"\nlinker = "hoisted"\n`;
    return { origin: server.url.origin, bunfig, requests, [Symbol.dispose]: () => void server.stop(true) };
  }

  /** A project for `registry` that has `packageJson`. */
  async function created(registry: { bunfig: string }, packageJson: object, files: Record<string, string> = {}) {
    const dir = await project({ name: "foo", ...packageJson }, files);
    await write(join(dir, "bunfig.toml"), registry.bunfig);
    return dir;
  }

  async function install(dir: string) {
    const { stderr, exitCode } = await bun(dir, "install");
    expect({ stderr, exitCode }).toEqual({ stderr: "Saved lockfile", exitCode: 0 });
  }

  /** A project that has installed `packageJson` from `registry`. */
  async function installed(registry: { bunfig: string }, packageJson: object, files: Record<string, string> = {}) {
    const dir = await created(registry, packageJson, files);
    await install(dir);
    return dir;
  }

  /** package.json becomes `packageJson` with the rule for `r`. bun.lock gets the rule only, and keeps r@1.0.0. */
  async function mergeRule(dir: string, packageJson: { overrides?: object; [group: string]: unknown }, rule = "2.0.0") {
    const overrides = { ...packageJson.overrides, r: rule };
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", ...packageJson, overrides }));
    const lock = await lockfile(dir);
    const line = `    "r": "${rule}",\n`;
    await write(
      join(dir, "bun.lock"),
      lock.includes(`  "overrides": {\n`)
        ? lock.replace(`  "overrides": {\n`, `  "overrides": {\n${line}`)
        : lock.replace(`  "packages": {`, `  "overrides": {\n${line}  },\n  "packages": {`),
    );
    type Lock = { overrides?: Record<string, string>; packages: Record<string, [string]> };
    const merged = Bun.JSONC.parse(await lockfile(dir)) as Lock;
    expect({ rule: merged.overrides?.r, entry: merged.packages.r[0] }).toEqual({ rule, entry: "r@1.0.0" });
  }

  /** Runs `bun <args>` as `bun()` does. `resolves` is how many times the command resolved. */
  async function run(dir: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: dir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      stderr: normalizeBunSnapshot(stderr.replace(progressLine, ""), dir),
      exitCode,
      resolves: stderr.match(/^Resolving dependencies/gm)?.length ?? 0,
    };
  }
  /** The second resolve ran, and the command saved what it resolved. */
  const saved = { stderr: "Saved lockfile", exitCode: 0, resolves: 2 };

  /** What bun.lock has for each key: `<name>@<resolution>`. */
  async function locked(dir: string) {
    const { packages } = Bun.JSONC.parse(await lockfile(dir)) as { packages: Record<string, [string]> };
    return Object.fromEntries(Object.entries(packages).map(([key, [id]]) => [key, id]));
  }

  /** What `nodeModulesPackages` returns when `node_modules` has exactly these folders, each with its package. */
  const inNodeModules = (...packages: string[]) => packages.map(path => `node_modules/${path}`).join("\n");

  /** Makes `<dir>/repo` a git repository of the package `name`, with one commit that has the tag v1. */
  async function repository(dir: string, name: string) {
    const repo = join(dir, "repo");
    await write(join(repo, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    const author = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com" };
    const committer = { GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
    let stdout = "";
    for (const args of [
      "init -q",
      "add package.json",
      "commit -q -m first --no-gpg-sign",
      "tag v1",
      "rev-parse HEAD",
    ]) {
      await using git = Bun.spawn({
        cmd: ["git", ...args.split(" ")],
        cwd: repo,
        env: { ...bunEnv, ...author, ...committer, GIT_CONFIG_NOSYSTEM: "1" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, stderr, exitCode] = await Promise.all([git.stdout.text(), git.stderr.text(), git.exited]);
      expect({ args, stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ args, stderr: "", exitCode: 0 });
      stdout = out;
    }
    const url = `git+${Bun.pathToFileURL(repo)}`;
    return { specifier: `${url}#v1`, locked: `${name}@${url}#${stdout.trim()}` };
  }

  const plain = { "1.0.0": {} };
  /** r@2.0.0 is the version that the rule asks for. */
  const r = (dependencies: Record<string, string>) => ({ "1.0.0": {}, "2.0.0": { dependencies } });
  /** Each of `names` at 1.0.0, for a group of dependencies. */
  const pinned = (names: string[]) => Object.fromEntries(names.map(name => [name, "1.0.0"]));

  describe.each(["update t", "install --force"])("bun %s reads the tarball of the project once", command => {
    test.concurrent.each([
      // The clean numbers the packages again even when it removes none.
      { title: "no dependency is removed", removed: [] },
      { title: "a dependency is removed", removed: ["a"] },
      // The number that `t` had is past the end of the lockfile then.
      { title: "two dependencies are removed", removed: ["a", "b"] },
    ])("$title: r@2.0.0 uses the package of that tarball", async ({ removed }) => {
      using registry = serve(origin => ({ a: plain, b: plain, r: r({ t: `${origin}/t.tgz` }) }));
      const t = `${registry.origin}/t.tgz`;
      const dependencies = { r: "^1.0.0", t };
      const dir = await installed(registry, { dependencies: { ...pinned(removed), ...dependencies } });
      await mergeRule(dir, { dependencies });
      registry.requests.length = 0;

      expect(await run(dir, ...command.split(" "))).toEqual(saved);
      expect(await locked(dir)).toEqual({ r: "r@2.0.0", t: `t@${t}` });
      expect(nodeModulesPackages(dir)).toBe(inNodeModules("r/r@2.0.0", "t/t@1.0.0"));
      expect(registry.requests.filter(pathname => pathname === "/t.tgz")).toEqual(["/t.tgz"]);
    });
  });

  // Nobody edits bun.lock in these. The rule for `r` is the range of `p`, which `bun update --latest` moves to ^2.0.0.
  describe("bun update --latest moves the dependency that the rule $p refers to", () => {
    test.concurrent("r@2.0.0 uses the package of the tarball of the project", async () => {
      using registry = serve(origin => ({ p: { ...plain, "2.0.0": {} }, r: r({ t: `${origin}/t.tgz` }) }));
      const t = `${registry.origin}/t.tgz`;
      const dir = await installed(registry, { dependencies: { p: "^1.0.0", r: "*", t }, overrides: { r: "$p" } });
      expect(await locked(dir)).toEqual({ p: "p@1.0.0", r: "r@1.0.0", t: `t@${t}` });

      expect(await run(dir, "update", "--latest")).toEqual(saved);
      expect(await locked(dir)).toEqual({ p: "p@2.0.0", r: "r@2.0.0", t: `t@${t}` });
      expect(nodeModulesPackages(dir)).toBe(inNodeModules("p/p@2.0.0", "r/r@2.0.0", "t/t@1.0.0"));
    });

    // bun.lockb is loaded in the order of the last clean. p@1.0.0 brings `q`, so this clean moves `a` all the same.
    test.concurrent("with bun.lockb", async () => {
      using registry = serve(origin => ({
        p: { "1.0.0": { dependencies: { q: "1.0.0" } }, "2.0.0": {} },
        q: plain,
        r: r({ a: `${origin}/a.tgz` }),
      }));
      const dependencies = { a: `${registry.origin}/a.tgz`, p: "^1.0.0", r: "*" };
      const dir = await created(registry, { dependencies, overrides: { r: "$p" } });
      await write(join(dir, "bunfig.toml"), `${registry.bunfig}saveTextLockfile = false\n`);
      await install(dir);
      registry.requests.length = 0;

      expect(await run(dir, "update", "--latest")).toEqual(saved);
      expect(nodeModulesPackages(dir)).toBe(inNodeModules("a/a@1.0.0", "p/p@2.0.0", "r/r@2.0.0"));
      expect(registry.requests.filter(pathname => pathname === "/a.tgz")).toEqual(["/a.tgz"]);
    });

    // `w` links the workspace once its range is ^2.0.0. That cleans the lockfile once more, before the rule is checked.
    test.concurrent("in a workspace, where a dependency starts to link another workspace", async () => {
      using registry = serve(origin => ({
        p: { ...plain, "2.0.0": {} },
        w: { ...plain, "2.0.0": {} },
        r: r({ t: `${origin}/t.tgz` }),
      }));
      const t = `${registry.origin}/t.tgz`;
      const app = { name: "app", version: "1.0.0", dependencies: { p: "^1.0.0", r: "*", t, w: "^1.0.0" } };
      const dir = await installed(
        registry,
        { workspaces: ["packages/*"], overrides: { r: "$p" } },
        {
          "packages/app/package.json": JSON.stringify(app),
          "packages/w/package.json": JSON.stringify({ name: "w", version: "2.0.0" }),
        },
      );

      expect(await run(join(dir, "packages", "app"), "update", "--latest")).toEqual(saved);
      expect(await locked(dir)).toEqual({
        app: "app@workspace:packages/app",
        p: "p@2.0.0",
        r: "r@2.0.0",
        t: `t@${t}`,
        w: "w@workspace:packages/w",
      });
    });
  });

  test.concurrent.skipIf(!Bun.which("git"))("bun update g: r@2.0.0 uses the package of the repository", async () => {
    let g = "";
    using registry = serve(() => ({ r: r({ g }) }));
    const dir = await created(registry, {});
    const repo = await repository(dir, "g");
    g = repo.specifier;
    const dependencies = { g, r: "^1.0.0" };
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies }));
    await install(dir);
    expect(await locked(dir)).toEqual({ g: repo.locked, r: "r@1.0.0" });
    await mergeRule(dir, { dependencies });

    expect(await run(dir, "update", "g")).toEqual(saved);
    expect(await locked(dir)).toEqual({ g: repo.locked, r: "r@2.0.0" });
    expect(nodeModulesPackages(dir)).toBe(`${inNodeModules("g/g@1.0.0", "r/r@2.0.0")}\nrepo/g@1.0.0`);
  });

  // The hoist binds the peer of `y` to the x@1.0.5 that `v` brings. x@1.0.0 is then unused, and the clean runs again.
  test.concurrent("bun update t: the clean runs twice", async () => {
    using registry = serve(origin => ({
      x: { ...plain, "1.0.5": {} },
      w: { "1.0.0": { dependencies: { x: "1.0.0" } } },
      v: { "1.0.0": { dependencies: { x: "1.0.5" } } },
      y: { "1.0.0": { peerDependencies: { x: "^1.0.0" } } },
      r: r({ t: `${origin}/t.tgz` }),
    }));
    const t = `${registry.origin}/t.tgz`;
    const dir = await installed(registry, { dependencies: { r: "^1.0.0", t, w: "1.0.0", y: "1.0.0" } });
    expect(await locked(dir)).toEqual({ r: "r@1.0.0", t: `t@${t}`, w: "w@1.0.0", x: "x@1.0.0", y: "y@1.0.0" });
    await mergeRule(dir, { dependencies: { r: "^1.0.0", t, v: "1.0.0", y: "1.0.0" } });
    registry.requests.length = 0;

    expect(await run(dir, "update", "t")).toEqual(saved);
    expect(await locked(dir)).toEqual({ r: "r@2.0.0", t: `t@${t}`, v: "v@1.0.0", x: "x@1.0.5", y: "y@1.0.0" });
    expect(registry.requests.filter(pathname => pathname === "/t.tgz")).toEqual(["/t.tgz"]);
  });

  // `a` and `b` are new. `a` takes z@2.0.0, which depends on `d`. `b` then takes z@1.0.5, and `a` moves to it. The clean
  // removes z@2.0.0 and `d`, and r@2.0.0 asks for `d` again.
  describe("the clean removes the package that the first resolve fetched", () => {
    const packages = (d: string): Packages => ({
      d: plain,
      a: { "1.0.0": { dependencies: { z: "*" } } },
      b: { "1.0.0": { dependencies: { z: "~1.0.0" } } },
      z: { ...plain, "1.0.5": {}, "2.0.0": { dependencies: { d } } },
      r: r({ d }),
    });
    const dependencies = { a: "1.0.0", b: "1.0.0", r: "^1.0.0" };
    const kept = { a: "a@1.0.0", b: "b@1.0.0", r: "r@2.0.0", z: "z@1.0.5" };

    test.concurrent("bun install downloads a tarball again", async () => {
      using registry = serve(origin => packages(`${origin}/d.tgz`));
      const dir = await installed(registry, { dependencies: { r: "^1.0.0" } });
      await mergeRule(dir, { dependencies });
      registry.requests.length = 0;

      expect(await run(dir, "install")).toEqual(saved);
      expect(await locked(dir)).toEqual({ ...kept, d: `d@${registry.origin}/d.tgz` });
      expect(nodeModulesPackages(dir)).toBe(
        inNodeModules("a/a@1.0.0", "b/b@1.0.0", "d/d@1.0.0", "r/r@2.0.0", "z/z@1.0.5"),
      );
      expect(registry.requests.filter(pathname => pathname === "/d.tgz")).toEqual(["/d.tgz", "/d.tgz"]);
    });

    test.concurrent.skipIf(!Bun.which("git"))("bun install checks a repository out again", async () => {
      let d = "";
      using registry = serve(() => packages(d));
      const dir = await created(registry, { dependencies: { r: "^1.0.0" } });
      const repo = await repository(dir, "d");
      d = repo.specifier;
      await install(dir);
      await mergeRule(dir, { dependencies });

      expect(await run(dir, "install")).toEqual(saved);
      expect(await locked(dir)).toEqual({ ...kept, d: repo.locked });
    });

    test.concurrent("bun install reads a folder again", async () => {
      using registry = serve(() => packages("^1.0.0"));
      const overrides = { d: "file:./vendor/d" };
      const files = { "vendor/d/package.json": JSON.stringify({ name: "d", version: "1.0.0" }) };
      const dir = await installed(registry, { dependencies: { r: "^1.0.0" }, overrides }, files);
      await mergeRule(dir, { dependencies, overrides });

      expect(await run(dir, "install")).toEqual(saved);
      expect(await locked(dir)).toEqual({ ...kept, "r/d": "d@file:vendor/d" });
    });

    test.concurrent("bun install reads a tarball of the project again", async () => {
      using registry = serve(() => packages("^1.0.0"));
      const overrides = { d: "file:./d.tgz" };
      const dir = await created(registry, { dependencies: { r: "^1.0.0" }, overrides });
      await write(join(dir, "d.tgz"), await pack({ name: "d", version: "1.0.0" }));
      await install(dir);
      await mergeRule(dir, { dependencies, overrides });

      expect(await run(dir, "install")).toEqual(saved);
      expect(await locked(dir)).toEqual({ ...kept, d: "d@./d.tgz" });
    });
  });

  // The peer of the project takes z@1.0.5, the `latest` of z. That version brings the tarball `d`, and `k`, which needs
  // z@2.0.0. The hoist binds the peer to z@2.0.0, so the clean runs again and removes z@1.0.5, `k` and `d`.
  test.concurrent("bun install downloads a tarball again when the second run of the clean removed it", async () => {
    using registry = serve(
      origin => ({
        z: { "1.0.5": { dependencies: { d: `${origin}/d.tgz`, k: "1.0.0" } }, "2.0.0": {} },
        k: { "1.0.0": { dependencies: { z: "2.0.0" } } },
        r: r({ d: `${origin}/d.tgz` }),
      }),
      { latest: { z: "1.0.5" } },
    );
    const dependencies = { r: "^1.0.0" };
    const dir = await installed(registry, { dependencies });
    await mergeRule(dir, { dependencies, peerDependencies: { z: ">=1.0.0" } });
    registry.requests.length = 0;

    expect(await run(dir, "install")).toEqual(saved);
    expect(await locked(dir)).toEqual({ d: `d@${registry.origin}/d.tgz`, r: "r@2.0.0", z: "z@2.0.0" });
    expect(registry.requests.filter(pathname => pathname === "/d.tgz")).toEqual(["/d.tgz", "/d.tgz"]);
  });

  // The rule for `d` sends the `d` of `q` and of r@2.0.0 to one folder. `q` is new, so the first resolve reads the folder.
  test.concurrent.each([
    { title: "a dependency is removed", removed: ["a"] },
    { title: "two dependencies are removed", removed: ["a", "b"] },
  ])("bun install, $title: r@2.0.0 uses the folder that the first resolve read", async ({ removed }) => {
    const needsD = { dependencies: { d: "^1.0.0" } };
    using registry = serve(() => ({ a: plain, b: plain, d: plain, q: { "1.0.0": needsD }, r: r(needsD.dependencies) }));
    const overrides = { d: "file:./vendor/d" };
    const files = { "vendor/d/package.json": JSON.stringify({ name: "d", version: "1.0.0" }) };
    const dir = await installed(registry, { dependencies: { ...pinned(removed), r: "^1.0.0" }, overrides }, files);
    await mergeRule(dir, { dependencies: { q: "1.0.0", r: "^1.0.0" }, overrides });

    expect(await run(dir, "install")).toEqual(saved);
    const folder = "d@file:vendor/d";
    expect(await locked(dir)).toEqual({ q: "q@1.0.0", r: "r@2.0.0", "q/d": folder, "r/d": folder });
  });

  // `x` and `y` are new, and the first resolve lists who asks for their peer `p`. r@2.0.0 asks for it too.
  test.concurrent("bun install resolves the peer of r@2.0.0 after the peers of the first resolve", async () => {
    const peer = { peerDependencies: { p: "^1.0.0" } };
    using registry = serve(() => ({
      ...{ a: plain, b: plain, c: plain, d: plain, p: plain, s: plain },
      x: { "1.0.0": peer },
      y: { "1.0.0": peer },
      r: { "1.0.0": {}, "2.0.0": { dependencies: { s: "1.0.0" }, ...peer } },
    }));
    const dir = await installed(registry, {
      dependencies: { ...pinned(["a", "b", "c", "d"]), p: "^1.0.0", r: "^1.0.0" },
    });
    await mergeRule(dir, { dependencies: { r: "^1.0.0", x: "1.0.0", y: "1.0.0" } });

    expect(await run(dir, "install")).toEqual(saved);
    expect(await locked(dir)).toEqual({ p: "p@1.0.0", r: "r@2.0.0", s: "s@1.0.0", x: "x@1.0.0", y: "y@1.0.0" });
  });

  // The tarball of `bad` is missing, so the first resolve ends with an error and does not resolve the peer of `x`. The
  // manifest of `x` waits for that download. The second resolve must not take the peer for one of its own dependencies.
  describe("the first resolve fails and leaves a peer", () => {
    test.concurrent.each([
      { title: "a registry package", peer: () => "^1.0.0", needs: () => ({}) },
      // The second resolve downloads the tarball that the peer waited for.
      {
        title: "a tarball",
        peer: (origin: string) => `${origin}/p.tgz`,
        needs: (origin: string) => ({ p: `${origin}/p.tgz` }),
      },
    ])("the peer is $title: bun install reports the download", async ({ peer, needs }) => {
      using registry = serve(
        origin => ({
          ...{ a: plain, b: plain, c: plain, d: plain, p: plain, s: plain },
          x: { "1.0.0": { peerDependencies: { p: peer(origin) } } },
          bad: { "1.0.0": { dist: { tarball: `${origin}/bad-0.0.0.tgz` } } },
          r: r({ s: "1.0.0", ...needs(origin) }),
        }),
        { hold: "/x", until: "/bad-0.0.0.tgz" },
      );
      const dir = await installed(registry, {
        dependencies: { ...pinned(["a", "b", "c", "d"]), p: "^1.0.0", r: "^1.0.0" },
      });
      await mergeRule(dir, { dependencies: { bad: "1.0.0", p: "^1.0.0", r: "^1.0.0", x: "1.0.0" } });
      const merged = await lockfile(dir);

      expect(await run(dir, "install")).toEqual({
        stderr: `error: GET ${registry.origin}/bad-0.0.0.tgz - 404`,
        exitCode: 1,
        resolves: 2,
      });
      expect(await lockfile(dir)).toBe(merged);
    });
  });

  // The registry has no `o`. The first resolve notes which dependency of the project asked for it. r@2.0.0 asks for it
  // too, and that must not look like a failure of the dependency that the command names.
  test.concurrent("bun update z when the registry does not have an optional dependency", async () => {
    using registry = serve(() => ({
      z: { ...plain, "1.0.1": {} },
      r: { "1.0.0": {}, "2.0.0": { optionalDependencies: { o: "^1.0.0" } } },
    }));
    const dir = await installed(registry, { dependencies: { r: "^1.0.0", z: "1.0.0" } });
    const optionalDependencies = { o: "^1.0.0" };
    await mergeRule(dir, { dependencies: { r: "^1.0.0", z: "^1.0.0" }, optionalDependencies });

    const missing = `warn: GET ${registry.origin}/o - 404`;
    expect(await run(dir, "update", "z")).toEqual({ ...saved, stderr: `${missing}\nSaved lockfile` });
    expect(await locked(dir)).toEqual({ r: "r@2.0.0", z: "z@1.0.1" });
  });

  // `bun update <name>` in the workspace `m`, or with `--filter m`, updates the dependencies that `m` reaches, and those
  // of the packages that the update adds. Which packages those are must not depend on what else the install removes.
  describe.each([
    { how: "in the workspace m", at: "m", filter: [] },
    { how: "with --filter m", at: "", filter: ["--filter", "m"] },
  ])("bun update $how", ({ at, filter }) => {
    // r@2.0.0 is added, so its `x` takes the newest version of its range. The x@2.0.0 of `m` is not in that range.
    test.concurrent.each([
      { title: "a dependency is removed", removed: ["a"] },
      { title: "two dependencies are removed", removed: ["a", "b"] },
    ])("$title: the x of r@2.0.0 is the newest in its range", async ({ removed }) => {
      using registry = serve(() => ({
        a: plain,
        b: plain,
        x: { ...plain, "1.0.5": {}, "2.0.0": {} },
        r: { "1.0.0": { dependencies: { x: "1.0.0" } }, "2.0.0": { dependencies: { x: "^1.0.0" } } },
      }));
      const root = { workspaces: ["m"] };
      const files = { "m/package.json": JSON.stringify({ name: "m", version: "1.0.0", dependencies: { x: "2.0.0" } }) };
      const dir = await installed(registry, { ...root, dependencies: { ...pinned(removed), r: "^1.0.0" } }, files);
      await mergeRule(dir, { ...root, dependencies: { r: "^1.0.0" } });

      expect(await run(join(dir, at), "update", "x", ...filter)).toEqual(saved);
      expect(await locked(dir)).toEqual({ m: "m@workspace:m", r: "r@2.0.0", x: "x@2.0.0", "r/x": "x@1.0.5" });
    });

    // `m` reaches the package r only as `r2`, which the rule does not replace. `q` is outside of its scope, so the r
    // of `q` takes the r@2.0.0 that bun.lock has, not the newest. That needs no request, so only one resolve is printed.
    test.concurrent("a package that m does not reach is not updated", async () => {
      using registry = serve(() => ({
        r: { ...plain, "2.0.0": {}, "2.1.0": {} },
        q: { "1.0.0": { dependencies: { r: "^1.0.0" } } },
      }));
      const root = { workspaces: ["m"], dependencies: { q: "1.0.0" } };
      const m = { name: "m", version: "1.0.0", dependencies: { r2: "npm:r@~2.0.0" } };
      const dir = await installed(registry, root, { "m/package.json": JSON.stringify(m) });
      await mergeRule(dir, root, "^2.0.0");

      expect(await run(join(dir, at), "update", "r", ...filter)).toEqual({ ...saved, resolves: 1 });
      expect(await locked(dir)).toEqual({ m: "m@workspace:m", q: "q@1.0.0", r: "r@2.0.0", r2: "r@2.0.0" });
    });
  });
});

// "resolutions" is read only when package.json has no "overrides", so an upgrade leaves bun.lock as it is.
describe("a bun.lock written by Bun 1.4", () => {
  const dependencies = { "one-dep": "1.0.0", "a-dep": "^1.0.1" };
  const integrity = {
    "a-dep@1.0.10": "sha512-NeQ6Ql9jRW8V+VOiVb+PSQAYOvVoSimW+tXaR0CoJk4kM9RIk/XlAUGCsNtn5XqjlDO4hcH8NcyaL507InevEg==",
    "no-deps@1.0.0": "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
    "no-deps@1.0.1": "sha512-3X6cn4+UJdXJuLPu11v8i/fGLe2PdI6v1yKTELam04lY5esCAFdG/qQts6N6rLrL6g1YRq+MKBAwxbmUQk355A==",
    "one-dep@1.0.0": "sha512-qG6lZjwM1vFmRCHwP+XpOKu6FkrBmwr20+54+qaHGdjZlw/wz8aJrhFqX4dZksqmBLZtj2mzL77Yf04WKs1+Kg==",
  };
  /** What 1.4 writes for `dependencies`: with `no-deps` overridden to 1.0.0, or without a rule. */
  function lockOf14(overridden: boolean) {
    const entry = (name: string, version: string, info = "{}") =>
      `    "${name}": ["${name}@${version}", "${registry.registryUrl()}${name}/-/${name}-${version}.tgz", ${info}, "${integrity[`${name}@${version}` as keyof typeof integrity]}"],\n`;
    return (
      `{\n  "lockfileVersion": 2,\n  "configVersion": 1,\n  "workspaces": {\n    "": {\n      "name": "foo",\n` +
      `      "dependencies": {\n        "a-dep": "^1.0.1",\n        "one-dep": "1.0.0",\n      },\n    },\n  },\n` +
      (overridden ? `  "overrides": {\n    "no-deps": "1.0.0",\n  },\n` : "") +
      `  "packages": {\n` +
      [
        entry("a-dep", "1.0.10"),
        entry("no-deps", overridden ? "1.0.0" : "1.0.1"),
        entry("one-dep", "1.0.0", `{ "dependencies": { "no-deps": "1.0.1" } }`),
      ].join("\n") +
      `  }\n}\n`
    );
  }
  const frozen = ["install --frozen-lockfile", "ci", "install --production"];
  const changed = (section: string) =>
    `error: lockfile had changes, but lockfile is frozen\nnote: ${section} in package.json changed since bun.lock was saved\nnote: try re-running without --frozen-lockfile and commit the updated lockfile`;

  async function upgraded(rules: object, overridden = true) {
    const lock = lockOf14(overridden);
    const dir = await project({ name: "foo", dependencies, ...rules }, { "bun.lock": lock });
    return { dir, lock };
  }

  describe.each([
    { title: "overrides only", rules: { overrides: { "no-deps": "1.0.0" } } },
    { title: "resolutions only", rules: { resolutions: { "no-deps": "1.0.0" } } },
    {
      title: "the same key in both",
      rules: { overrides: { "no-deps": "1.0.0" }, resolutions: { "no-deps": "2.0.0" } },
    },
    {
      title: "overrides, and another name in resolutions",
      rules: { overrides: { "no-deps": "1.0.0" }, resolutions: { "a-dep": "1.0.2" } },
    },
    {
      title: "overrides, and a scoped rule in resolutions",
      rules: { overrides: { "no-deps": "1.0.0" }, resolutions: { "one-dep/no-deps": "2.0.0" } },
    },
    {
      title: "overrides, and resolutions that is not an object",
      rules: { overrides: { "no-deps": "1.0.0" }, resolutions: "2.0.0" },
    },
    {
      title: "an empty overrides, and resolutions",
      rules: { overrides: {}, resolutions: { "no-deps": "1.0.0" } },
      overridden: false,
    },
  ])("$title", ({ rules, overridden = true }) => {
    test.concurrent.each([...frozen, "install"])("bun %s prints nothing", async command => {
      const { dir, lock } = await upgraded(rules, overridden);
      const { stderr, exitCode } = await bun(dir, ...command.split(" "));
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(await lockfile(dir)).toBe(lock);
    });
  });

  const both = { overrides: { "no-deps": "1.0.0" }, resolutions: { "a-dep": "1.0.2" } };

  test.concurrent("an edit of overrides still fails a frozen install", async () => {
    const { dir, lock } = await upgraded({ ...both, overrides: { "no-deps": "1.0.1" } });
    const { stderr, exitCode } = await bun(dir, "install", "--frozen-lockfile");
    expect(stderr).toBe(changed("overrides"));
    expect(exitCode).toBe(1);
    expect(await lockfile(dir)).toBe(lock);
  });

  test.concurrent("resolutions added or edited next to overrides change nothing", async () => {
    const dir = await project({ name: "foo", dependencies, overrides: both.overrides });
    expect((await bun(dir, "install")).exitCode).toBe(0);
    const lock = await lockfile(dir);
    for (const resolutions of [both.resolutions, { "a-dep": "1.0.3", "one-dep": "1.0.0" }, {}]) {
      await editPackageJson(dir, pkg => void (pkg.resolutions = resolutions));
      await expectLockfileStable(dir, lock);
    }
  });

  test.concurrent("a rule that bun.lock has from resolutions is removed by the next install", async () => {
    const dir = await project({ name: "foo", dependencies, overrides: { ...both.overrides, ...both.resolutions } });
    expect((await bun(dir, "install")).exitCode).toBe(0);
    expect(await lockfile(dir)).toContain('"a-dep": "1.0.2"');
    await editPackageJson(dir, pkg => void Object.assign(pkg, both));

    const refused = await bun(dir, "install", "--frozen-lockfile");
    expect(refused.stderr).toBe(changed("overrides"));
    expect(refused.exitCode).toBe(1);

    const { stderr, exitCode } = await bun(dir, "install");
    expect(stderr).toBe("Saved lockfile");
    expect(exitCode).toBe(0);
    const saved = await lockfile(dir);
    expect(saved).not.toContain('"a-dep": "1.0.2"');
    await expectLockfileStable(dir, saved);
  });

  // What the registry's packages declare, the way bun.lock prints it.
  const declares: Record<string, string> = {
    "bundled-1@1.0.0": `{ "dependencies": { "no-deps": "1.0.0" } }`,
    "one-dep@1.0.0": `{ "dependencies": { "no-deps": "1.0.1" } }`,
    "one-optional-peer-dep@1.0.1": `{ "peerDependencies": { "no-deps": "^1.0.0" } }`,
    "one-optional-peer-dep@1.0.2": `{ "peerDependencies": { "no-deps": "^1.0.0" }, "optionalPeers": ["no-deps"] }`,
    "one-range-dep@1.0.0": `{ "dependencies": { "no-deps": "^1.0.0" } }`,
    "peer-deps@1.0.0": `{ "peerDependencies": { "no-deps": "*" } }`,
  };
  const noDepsTarball = () => `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;

  type Saved = {
    title: string;
    /** package.json without its name. */
    pkg: () => Record<string, unknown>;
    /** The folder and the package.json of each workspace. */
    members?: Record<string, object>;
    files?: Record<string, string>;
    /** "overrides" in bun.lock, where it is not what package.json has. A rule that is not a plain name needs version 3. */
    rules?: object;
    version?: 3;
    catalogs?: object;
    /** The key, `name@resolution`, and what the entry declares. */
    packages: () => [key: string, id: string, info?: string][];
  };

  /** bun.lock prints an object with a key per line and a comma after each. */
  function block(value: unknown, indent = "  "): string {
    if (typeof value !== "object" || value === null) return JSON.stringify(value);
    const lines = Object.entries(value).map(
      ([key, inner]) => `${indent}  ${JSON.stringify(key)}: ${block(inner, indent + "  ")},\n`,
    );
    return `{\n${lines.join("")}${indent}}`;
  }

  function entryOf14([key, id, info = declares[id] ?? "{}"]: [string, string, string?]) {
    const at = id.indexOf("@", 1);
    const [name, resolution] = [id.slice(0, at), id.slice(at + 1)];
    if (resolution.startsWith("workspace:")) return `    "${key}": ["${id}"],\n`;
    if (resolution.startsWith("file:")) return `    "${key}": ["${id}", ${info}],\n`;
    const version = resolution.match(/-([^/-]+)\.tgz$/)?.[1] ?? resolution;
    const manifest = JSON.parse(readFileSync(join(registry.packagesPath, name, "package.json"), "utf8"));
    const url = version === resolution ? `"${registry.registryUrl()}${name}/-/${name}-${version}.tgz", ` : "";
    return `    "${key}": ["${id}", ${url}${info}, "${manifest.versions[version].dist.integrity}"],\n`;
  }

  function savedBy14({ pkg, members = {}, rules, version, catalogs = {}, packages }: Saved) {
    const { workspaces: _, overrides, resolutions, ...groups } = pkg();
    const sections = {
      lockfileVersion: version ?? 2,
      configVersion: 1,
      workspaces: { "": { name: "foo", ...groups }, ...members },
      overrides: rules ?? overrides ?? resolutions,
      ...catalogs,
    };
    return `${block(sections, "").slice(0, -1)}  "packages": {\n${packages().map(entryOf14).join("\n")}  }\n}\n`;
  }

  // A fresh install with Bun 1.4 saves each of these. A version is next to a rule that doesn't mention it, and that's
  // correct.
  test.concurrent.each<Saved>([
    {
      title: "the rule is a dist-tag",
      pkg: () => ({ dependencies: { "dep-with-tags": "^3.0.0" }, overrides: { "dep-with-tags": "pre-1" } }),
      packages: () => [["dep-with-tags", "dep-with-tags@1.0.1"]],
    },
    {
      title: "the rule is an npm: alias",
      pkg: () => ({ dependencies: { "one-dep": "1.0.0" }, overrides: { "no-deps": "npm:a-dep@^1.0.1" } }),
      packages: () => [
        ["no-deps", "a-dep@1.0.10"],
        ["one-dep", "one-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is an npm: alias of the same name",
      pkg: () => ({ dependencies: { "one-dep": "1.0.0" }, overrides: { "no-deps": "npm:no-deps@2.0.0" } }),
      packages: () => [
        ["no-deps", "no-deps@2.0.0"],
        ["one-dep", "one-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is a tarball URL",
      pkg: () => ({ dependencies: { "one-dep": "1.0.0" }, overrides: { "no-deps": noDepsTarball() } }),
      packages: () => [
        ["no-deps", `no-deps@${noDepsTarball()}`],
        ["one-dep", "one-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is a folder",
      pkg: () => ({ dependencies: { "one-dep": "1.0.0" }, overrides: { "no-deps": "file:./vendored" } }),
      files: { "vendored/package.json": JSON.stringify({ name: "no-deps", version: "9.9.9" }) },
      packages: () => [
        ["one-dep", "one-dep@1.0.0"],
        ["one-dep/no-deps", "no-deps@file:./vendored"],
      ],
    },
    {
      title: "the rule is workspace:*",
      pkg: () => ({
        workspaces: ["packages/*"],
        dependencies: { "one-dep": "1.0.0" },
        overrides: { "no-deps": "workspace:*" },
      }),
      members: { "packages/no-deps": { name: "no-deps", version: "1.0.5" } },
      packages: () => [
        ["no-deps", "no-deps@workspace:packages/no-deps"],
        ["one-dep", "one-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is catalog:",
      pkg: () => ({
        workspaces: { packages: [], catalog: { "no-deps": "~1.0.0" } },
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "catalog:" },
      }),
      catalogs: { catalog: { "no-deps": "~1.0.0" } },
      packages: () => [
        ["no-deps", "no-deps@1.0.1"],
        ["one-range-dep", "one-range-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is a named catalog",
      pkg: () => ({
        workspaces: { packages: [], catalogs: { x: { "no-deps": "1.0.0" } } },
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "catalog:x" },
      }),
      catalogs: { catalogs: { x: { "no-deps": "1.0.0" } } },
      packages: () => [
        ["no-deps", "no-deps@1.0.0"],
        ["one-range-dep", "one-range-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is $name",
      pkg: () => ({
        dependencies: { "no-deps": "~1.0.0", "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "$no-deps" },
      }),
      rules: { "no-deps": "~1.0.0" },
      packages: () => [
        ["no-deps", "no-deps@1.0.1"],
        ["one-range-dep", "one-range-dep@1.0.0"],
      ],
    },
    {
      title: "a prerelease under ^",
      pkg: () => ({
        dependencies: { "prereleases-3": "5.0.0-alpha.153" },
        overrides: { "prereleases-3": "^5.0.0-alpha.100" },
      }),
      packages: () => [["prereleases-3", "prereleases-3@5.0.0-alpha.153"]],
    },
    {
      title: "a prerelease under >=",
      pkg: () => ({
        dependencies: { "prereleases-3": "5.0.0-alpha.153" },
        overrides: { "prereleases-3": ">=5.0.0-alpha.150" },
      }),
      packages: () => [["prereleases-3", "prereleases-3@5.0.0-alpha.153"]],
    },
    {
      title: "the prerelease that `latest` names under *",
      pkg: () => ({
        dependencies: { "prereleases-3": "5.0.0-alpha.153" },
        overrides: { "prereleases-3": "*" },
      }),
      packages: () => [["prereleases-3", "prereleases-3@5.0.0-alpha.153"]],
    },
    {
      title: "the prerelease that `latest` names under a $name that is *",
      pkg: () => ({
        dependencies: { "prereleases-3": "*" },
        overrides: { "prereleases-3": "$prereleases-3" },
      }),
      rules: { "prereleases-3": "*" },
      packages: () => [["prereleases-3", "prereleases-3@5.0.0-alpha.153"]],
    },
    {
      title: "a workspace has the name and another version",
      pkg: () => ({
        workspaces: ["packages/*"],
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "1.0.0" },
      }),
      members: { "packages/no-deps": { name: "no-deps", version: "1.0.5" } },
      packages: () => [
        ["no-deps", "no-deps@workspace:packages/no-deps"],
        ["one-range-dep", "one-range-dep@1.0.0"],
        ["one-range-dep/no-deps", "no-deps@1.0.0"],
      ],
    },
    {
      title: "a workspace has the name and a version the rule allows",
      pkg: () => ({
        workspaces: ["packages/*"],
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "^1.0.0" },
      }),
      members: { "packages/no-deps": { name: "no-deps", version: "1.0.5" } },
      packages: () => [
        ["no-deps", "no-deps@workspace:packages/no-deps"],
        ["one-range-dep", "one-range-dep@1.0.0"],
      ],
    },
    {
      title: "a bundled dependency",
      pkg: () => ({ dependencies: { "bundled-1": "1.0.0", "one-dep": "1.0.0" }, overrides: { "no-deps": "2.0.0" } }),
      packages: () => [
        ["bundled-1", "bundled-1@1.0.0"],
        ["no-deps", "no-deps@2.0.0"],
        ["one-dep", "one-dep@1.0.0"],
        ["bundled-1/no-deps", "no-deps@2.0.0", `{ "bundled": true }`],
      ],
    },
    {
      title: "an optional peer that nothing provides",
      pkg: () => ({ dependencies: { "one-optional-peer-dep": "1.0.2" }, overrides: { "no-deps": "2.0.0" } }),
      packages: () => [["one-optional-peer-dep", "one-optional-peer-dep@1.0.2"]],
    },
    {
      title: "an optional peer takes the project's version",
      pkg: () => ({
        dependencies: { "no-deps": "1.1.0", "one-optional-peer-dep": "1.0.2" },
        overrides: { "one-optional-peer-dep>no-deps": "1.0.0" },
      }),
      rules: { "one-optional-peer-dep": { "no-deps": "1.0.0" } },
      version: 3,
      packages: () => [
        ["no-deps", "no-deps@1.1.0"],
        ["one-optional-peer-dep", "one-optional-peer-dep@1.0.2"],
      ],
    },
    {
      title: "a peer takes the project's version",
      pkg: () => ({
        dependencies: { "no-deps": "1.1.0", "one-optional-peer-dep": "1.0.1" },
        overrides: { "one-optional-peer-dep>no-deps": "1.0.0" },
      }),
      rules: { "one-optional-peer-dep": { "no-deps": "1.0.0" } },
      version: 3,
      packages: () => [
        ["no-deps", "no-deps@1.1.0"],
        ["one-optional-peer-dep", "one-optional-peer-dep@1.0.1"],
      ],
    },
    {
      title: "a peer shares the version of a peer without a rule",
      pkg: () => ({
        dependencies: { "one-optional-peer-dep": "1.0.1", "peer-deps": "1.0.0" },
        overrides: { "one-optional-peer-dep>no-deps": "1.0.0" },
      }),
      rules: { "one-optional-peer-dep": { "no-deps": "1.0.0" } },
      version: 3,
      packages: () => [
        ["no-deps", "no-deps@2.0.0"],
        ["one-optional-peer-dep", "one-optional-peer-dep@1.0.1"],
        ["peer-deps", "peer-deps@1.0.0"],
      ],
    },
    {
      title: "the project's own peer takes the version of a scoped rule",
      pkg: () => ({
        dependencies: { "one-dep": "1.0.0" },
        peerDependencies: { "no-deps": "^2.0.0" },
        overrides: { "one-dep>no-deps": "1.0.0" },
      }),
      rules: { "one-dep": { "no-deps": "1.0.0" } },
      version: 3,
      packages: () => [
        ["no-deps", "no-deps@1.0.0"],
        ["one-dep", "one-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is for another parent",
      pkg: () => ({
        dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" },
        overrides: { "one-dep>no-deps": "2.0.0" },
      }),
      rules: { "one-dep": { "no-deps": "2.0.0" } },
      version: 3,
      packages: () => [
        ["no-deps", "no-deps@2.0.0"],
        ["one-dep", "one-dep@1.0.0"],
        ["one-range-dep", "one-range-dep@1.0.0"],
        ["one-range-dep/no-deps", "no-deps@1.1.0"],
      ],
    },
    {
      title: "the rule is for another version of the parent",
      pkg: () => ({ dependencies: { "one-dep": "1.0.0" }, overrides: { "one-dep@2>no-deps": "2.0.0" } }),
      rules: { "one-dep@2": { "no-deps": "2.0.0" } },
      version: 3,
      packages: () => [
        ["no-deps", "no-deps@1.0.1"],
        ["one-dep", "one-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is nested under a parent that is not installed",
      pkg: () => ({ dependencies: { "one-range-dep": "1.0.0" }, overrides: { "one-dep": { "no-deps": "2.0.0" } } }),
      version: 3,
      packages: () => [
        ["no-deps", "no-deps@1.1.0"],
        ["one-range-dep", "one-range-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is for another declared range",
      pkg: () => ({ dependencies: { "one-dep": "1.0.0" }, overrides: { "no-deps@2": "1.0.0" } }),
      rules: { "no-deps@2": { ".": "1.0.0" } },
      version: 3,
      packages: () => [
        ["no-deps", "no-deps@1.0.1"],
        ["one-dep", "one-dep@1.0.0"],
      ],
    },
    {
      title: "the rule is for a declared range and the dependency declares a dist-tag",
      pkg: () => ({ dependencies: { "no-deps": "latest" }, overrides: { "no-deps@2": "1.0.0" } }),
      rules: { "no-deps@2": { ".": "1.0.0" } },
      version: 3,
      packages: () => [["no-deps", "no-deps@2.0.0"]],
    },
    {
      title: "the project declares an npm: alias under the rule's name",
      pkg: () => ({
        dependencies: { "no-deps": "npm:no-deps@2.0.0", "one-dep": "1.0.0" },
        overrides: { "no-deps": "1.0.0" },
      }),
      packages: () => [
        ["no-deps", "no-deps@2.0.0"],
        ["one-dep", "one-dep@1.0.0"],
        ["one-dep/no-deps", "no-deps@1.0.0"],
      ],
    },
    {
      title: "the project declares an npm: alias to another package under the rule's name",
      pkg: () => ({
        dependencies: { "no-deps": "npm:a-dep@1.0.1", "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "1.0.0" },
      }),
      packages: () => [
        ["no-deps", "a-dep@1.0.1"],
        ["one-range-dep", "one-range-dep@1.0.0"],
      ],
    },
    {
      title: "an optional dependency whose rule no version serves",
      pkg: () => ({
        workspaces: ["packages/*"],
        dependencies: { "no-deps": "2.0.0" },
        overrides: { "app>no-deps": "9.9.9" },
      }),
      members: { "packages/app": { name: "app", version: "1.0.0", optionalDependencies: { "no-deps": "^1.0.0" } } },
      rules: { app: { "no-deps": "9.9.9" } },
      version: 3,
      packages: () => [
        ["app", "app@workspace:packages/app"],
        ["no-deps", "no-deps@2.0.0"],
      ],
    },
    {
      title: "a workspace's peer takes the version of its devDependency",
      pkg: () => ({ workspaces: ["packages/*"], overrides: { "no-deps@1": "1.0.0" } }),
      members: {
        "packages/app": {
          name: "app",
          version: "1.0.0",
          devDependencies: { "no-deps": "^2.0.0" },
          peerDependencies: { "no-deps": "^1.0.0 || ^2.0.0" },
        },
      },
      rules: { "no-deps@1": { ".": "1.0.0" } },
      version: 3,
      packages: () => [
        ["app", "app@workspace:packages/app"],
        ["no-deps", "no-deps@2.0.0"],
      ],
    },
  ])("$title: bun install and --frozen-lockfile say nothing", async saved => {
    const lock = savedBy14(saved);
    const members = Object.entries(saved.members ?? {}).map(([folder, pkg]) => [
      `${folder}/package.json`,
      JSON.stringify(pkg),
    ]);
    const dir = await project(
      { name: "foo", ...saved.pkg() },
      { "bun.lock": lock, ...saved.files, ...Object.fromEntries(members) },
    );
    await expectLockfileStable(dir, lock);
  });

  test.concurrent("a name in two groups has one version, whichever group the rule is for", async () => {
    const saved: Saved = {
      title: "",
      pkg: () => ({
        dependencies: { "no-deps": "^1.0.0" },
        devDependencies: { "no-deps": "^2.0.0" },
        overrides: { "no-deps@1": "1.0.0" },
      }),
      rules: { "no-deps@1": { ".": "1.0.0" } },
      version: 3,
      packages: () => [["no-deps", "no-deps@2.0.0"]],
    };
    const lock = savedBy14(saved);
    const dir = await project({ name: "foo", ...saved.pkg() }, { "bun.lock": lock });
    for (const args of [["--frozen-lockfile"], []]) {
      const { stderr, exitCode } = await bun(dir, "install", ...args);
      expect(stderr.split("\n").filter(line => /^(warn|error|note):/.test(line))).toEqual([
        'warn: Duplicate dependency: "no-deps" specified in package.json',
        'note: "no-deps" originally specified here',
      ]);
      expect(exitCode).toBe(0);
      expect(await lockfile(dir)).toBe(lock);
    }
  });

  describe.each<Saved & { held: string }>([
    {
      title: "a merge took the rule of one branch and the entry of the other",
      pkg: () => ({ dependencies: { "one-range-dep": "1.0.0" }, overrides: { "no-deps": "1.0.0" } }),
      packages: () => [
        ["no-deps", "no-deps@1.1.0"],
        ["one-range-dep", "one-range-dep@1.0.0"],
      ],
      held: "no-deps@1.1.0",
    },
    {
      title: "the rule came after the install, for a package that only a peer holds",
      pkg: () => ({ dependencies: { "peer-deps": "1.0.0" }, overrides: { "no-deps": "1.0.0" } }),
      packages: () => [
        ["no-deps", "no-deps@2.0.0"],
        ["peer-deps", "peer-deps@1.0.0"],
      ],
      held: "no-deps@2.0.0",
    },
    {
      title: "the entry of a name in devDependencies and peerDependencies",
      pkg: () => ({
        devDependencies: { "no-deps": "^1.0.0" },
        peerDependencies: { "no-deps": "^1.0.0" },
        overrides: { "no-deps": "1.0.0" },
      }),
      packages: () => [["no-deps", "no-deps@1.1.0"]],
      held: "no-deps@1.1.0",
    },
    {
      title: "the entry of the project's own peer",
      pkg: () => ({ peerDependencies: { "no-deps": "^1.0.0" }, overrides: { "no-deps": "1.0.0" } }),
      packages: () => [["no-deps", "no-deps@1.1.0"]],
      held: "no-deps@1.1.0",
    },
    {
      title: "the entry of an optional dependency",
      pkg: () => ({ optionalDependencies: { "no-deps": "^1.0.0" }, overrides: { "no-deps": "1.0.0" } }),
      packages: () => [["no-deps", "no-deps@1.1.0"]],
      held: "no-deps@1.1.0",
    },
    {
      title: "the entry is a prerelease",
      pkg: () => ({ dependencies: { "no-deps-tags": "^1.0.0" }, overrides: { "no-deps-tags": "1.0.0" } }),
      packages: () => [["no-deps-tags", "no-deps-tags@1.0.0-rc.1"]],
      held: "no-deps-tags@1.0.0-rc.1",
    },
  ])("$title", saved => {
    const held = async () => {
      const lock = savedBy14(saved);
      return { lock, dir: await project({ name: "foo", ...saved.pkg() }, { "bun.lock": lock }) };
    };

    test.concurrent.each(frozen)("bun %s prints the entry and the rule", async command => {
      const { dir, lock } = await held();
      const { stderr, exitCode } = await bun(dir, ...command.split(" "));
      expect(stderr).toBe(
        `error: lockfile had changes, but lockfile is frozen\nnote: bun.lock has ${saved.held}, overrides in package.json wants 1.0.0\nnote: try re-running without --frozen-lockfile and commit the updated lockfile`,
      );
      expect(exitCode).toBe(1);
      expect(await lockfile(dir)).toBe(lock);
    });

    test.concurrent("bun install resolves the entry again", async () => {
      const { dir } = await held();
      const { stderr, exitCode } = await bun(dir, "install");
      expect(stderr).toBe("Saved lockfile");
      expect(exitCode).toBe(0);
      const name = saved.held.slice(0, saved.held.indexOf("@"));
      expect(nodeModulesPackages(dir)).toContain(`node_modules/${name}/${name}@1.0.0`);
      const repaired = await lockfile(dir);
      expect(repaired).not.toContain(saved.held);
      await expectLockfileStable(dir, repaired);
    });
  });
});
