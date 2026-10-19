import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync } from "fs";
import { realpath, rm } from "fs/promises";
import { bunEnv, bunExe } from "harness";
import { basename, dirname, join } from "path";
import { TestRegistry } from "registry";

// `packageExtensions` in the root package.json adds dependencies and peer dependencies that a
// registry package forgot to declare. The fixtures `a-dep`, `no-deps`, `peer-no-deps` and
// `left-pad` declare nothing; `one-fixed-dep@1.0.0` declares `no-deps: 1.0.0`, and
// `peer-deps-fixed@1.0.0` the peer `no-deps: ^1.0.0`.

const registry = new TestRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Linker = "hoisted" | "isolated";
type Manifest = Record<string, unknown>;

async function bun(cwd: string, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

/** A project whose package.json is rewritten before each `install`. */
async function project(linker: Linker, bunfigOpts: { saveTextLockfile?: boolean } = {}) {
  const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker, ...bunfigOpts } });
  const lockText = () => file(join(dir, "bun.lock")).text();
  const lock = async () => Bun.JSON5.parse(await lockText()) as any;
  return {
    dir,
    lockText,
    lock,
    /** `saves`: whether the lockfile is written. */
    async install(manifest: Manifest, saves: boolean, ...args: string[]) {
      await write(packageJson, JSON.stringify({ name: "app", version: "1.0.0", ...manifest }));
      const result = await bun(dir, "install", ...args);
      expect(result.err).not.toContain("error:");
      expect(result.err).not.toContain("warn:");
      expect(result.err.includes("Saved lockfile")).toBe(saves);
      expect(result.exitCode).toBe(0);
      return result;
    },
    /** `--frozen-lockfile` refuses a bun.lock that is not what `packageExtensions` asks for, and leaves it alone. */
    async expectFrozenRefusal(manifest: Manifest, lockfile = "bun.lock") {
      await write(packageJson, JSON.stringify({ name: "app", version: "1.0.0", ...manifest }));
      const before = await file(join(dir, lockfile)).bytes();
      const { err, exitCode } = await bun(dir, "install", "--frozen-lockfile");
      expect(err).toContain("error: lockfile had changes, but lockfile is frozen");
      expect(err).toContain(`note: packageExtensions in package.json changed since ${lockfile} was saved`);
      expect(await file(join(dir, lockfile)).bytes()).toEqual(before);
      expect(exitCode).toBe(1);
    },
    /** The info object (`{ dependencies, peerDependencies, optionalPeers, .. }`) bun.lock has for `name`. */
    async entry(name: string): Promise<Record<string, unknown>> {
      return (await lock()).packages[name][2];
    },
    /** `name@version` of every package in bun.lock. */
    async locked(): Promise<string[]> {
      return Object.values<[string]>((await lock()).packages)
        .map(([resolution]) => resolution)
        .sort();
    },
    /** The version of `dependency` that `name@version` gets when it requires it, if any. */
    async resolvedFrom(name: string, version: string, dependency: string): Promise<string | undefined> {
      let nodeModules = join(dir, "node_modules");
      if (linker === "isolated") {
        // Read through the root's link, because added peers rename the entry, and the entry that it replaces stays in
        // the store.
        nodeModules = dirname(await realpath(join(nodeModules, name)));
        expect(basename(dirname(nodeModules))).toStartWith(`${name}@${version}`);
      }
      const manifest = file(join(nodeModules, dependency, "package.json"));
      return (await manifest.exists()) ? (await manifest.json()).version : undefined;
    },
  };
}

describe.each(["hoisted", "isolated"] as const)("packageExtensions (%s)", linker => {
  test.concurrent("adds a dependency, which bun.lock reproduces", async () => {
    const app = await project(linker);
    const manifest = {
      dependencies: { "a-dep": "1.0.5" },
      packageExtensions: { "a-dep": { dependencies: { "no-deps": "^1.0.0" } } },
    };

    await app.install(manifest, true);
    expect(await app.entry("a-dep")).toEqual({ dependencies: { "no-deps": "^1.0.0" } });
    expect((await app.lock()).packageExtensions).toEqual({ "a-dep@1.0.5": { dependencies: ["no-deps"] } });
    expect(await app.resolvedFrom("a-dep", "1.0.5", "no-deps")).toBe("1.1.0");
    const lock = await app.lockText();

    await app.install(manifest, false);

    await rm(join(app.dir, "node_modules"), { recursive: true, force: true });
    await app.install(manifest, false, "--frozen-lockfile");
    expect(await app.resolvedFrom("a-dep", "1.0.5", "no-deps")).toBe("1.1.0");
    expect(await app.lockText()).toBe(lock);
  });

  test.concurrent("a project without the key has no section in bun.lock", async () => {
    const app = await project(linker);
    await app.install({ dependencies: { "a-dep": "1.0.5" } }, true);
    expect(await app.lockText()).not.toContain("packageExtensions");
  });

  test.concurrent.each([
    ["1.0.0", false],
    ["2.0.0", true],
  ])("name@^2 and no-deps@%s", async (version, matches) => {
    const app = await project(linker);
    await app.install(
      {
        dependencies: { "no-deps": version },
        packageExtensions: { "no-deps@^2": { dependencies: { "a-dep": "1.0.1" } } },
      },
      true,
    );
    expect(await app.locked()).toEqual(matches ? ["a-dep@1.0.1", "no-deps@2.0.0"] : ["no-deps@1.0.0"]);
    expect(await app.entry("no-deps")).toEqual(matches ? { dependencies: { "a-dep": "1.0.1" } } : {});
  });

  test.concurrent("adds peer dependencies, optional ones too", async () => {
    const app = await project(linker);
    const manifest = {
      dependencies: { "a-dep": "1.0.3", "peer-no-deps": "1.0.1" },
      packageExtensions: {
        "a-dep@1": {
          peerDependencies: { "peer-no-deps": "^1.0.0", "left-pad": "*" },
          // `no-deps` is in no `peerDependencies`: an optional peer on any version
          peerDependenciesMeta: { "left-pad": { optional: true }, "no-deps": { optional: true } },
        },
      },
    };

    await app.install(manifest, true);
    expect(await app.entry("a-dep")).toEqual({
      peerDependencies: { "left-pad": "*", "no-deps": "*", "peer-no-deps": "^1.0.0" },
      optionalPeers: ["left-pad", "no-deps"],
    });
    expect((await app.lock()).packageExtensions).toEqual({
      "a-dep@1.0.3": { peerDependencies: ["left-pad", "no-deps", "peer-no-deps"] },
    });
    // The root provides the required peer. Nobody provides the optional ones.
    expect(await app.locked()).toEqual(["a-dep@1.0.3", "peer-no-deps@1.0.1"]);
    expect(await app.resolvedFrom("a-dep", "1.0.3", "peer-no-deps")).toBe("1.0.1");
    expect(await app.resolvedFrom("a-dep", "1.0.3", "left-pad")).toBeUndefined();

    await app.install(manifest, false);
    await app.install(manifest, false, "--frozen-lockfile");
  });

  test.concurrent("the package's own declaration wins", async () => {
    const app = await project(linker);
    await app.install(
      {
        dependencies: { "one-fixed-dep": "1.0.0" },
        packageExtensions: { "one-fixed-dep": { dependencies: { "no-deps": "2.0.0", "a-dep": "1.0.2" } } },
      },
      true,
    );
    expect(await app.entry("one-fixed-dep")).toEqual({ dependencies: { "a-dep": "1.0.2", "no-deps": "1.0.0" } });
    expect((await app.lock()).packageExtensions).toEqual({ "one-fixed-dep@1.0.0": { dependencies: ["a-dep"] } });
    expect(await app.locked()).toEqual(["a-dep@1.0.2", "no-deps@1.0.0", "one-fixed-dep@1.0.0"]);
  });

  test.concurrent("the first key that names a dependency wins", async () => {
    const app = await project(linker);
    await app.install(
      {
        dependencies: { "a-dep": "1.0.5" },
        packageExtensions: {
          "a-dep@1": { dependencies: { "no-deps": "1.0.0" } },
          "a-dep": { dependencies: { "no-deps": "2.0.0", "left-pad": "1.0.0" } },
        },
      },
      true,
    );
    expect(await app.entry("a-dep")).toEqual({ dependencies: { "left-pad": "1.0.0", "no-deps": "1.0.0" } });
  });

  // `no-deps` is locked below the newest version its range allows: resolving it again would move it.
  const pinned = { "a-dep": "1.0.4", "no-deps": "^1.0.0" };
  async function projectWithPin() {
    const app = await project(linker);
    await app.install({ dependencies: { ...pinned, "no-deps": "1.0.0" } }, true);
    await app.install({ dependencies: pinned }, true);
    expect(await app.locked()).toEqual(["a-dep@1.0.4", "no-deps@1.0.0"]);
    return app;
  }

  test.concurrent("added, edited and removed later: only those rows change", async () => {
    const app = await projectWithPin();
    const without = await app.lockText();
    const extended = (version: string) => ({
      dependencies: pinned,
      packageExtensions: {
        "a-dep": { dependencies: { "peer-no-deps": version }, peerDependencies: { "no-deps": "*" } },
      },
    });

    await app.expectFrozenRefusal(extended("1.0.0"));
    await app.install(extended("1.0.0"), true);
    expect(await app.entry("a-dep")).toEqual({
      dependencies: { "peer-no-deps": "1.0.0" },
      peerDependencies: { "no-deps": "*" },
    });
    expect(await app.locked()).toEqual(["a-dep@1.0.4", "no-deps@1.0.0", "peer-no-deps@1.0.0"]);
    expect(await app.resolvedFrom("a-dep", "1.0.4", "peer-no-deps")).toBe("1.0.0");
    await app.install(extended("1.0.0"), false, "--frozen-lockfile");

    await app.expectFrozenRefusal(extended("2.0.0"));
    await app.install(extended("2.0.0"), true);
    expect(await app.entry("a-dep")).toEqual({
      dependencies: { "peer-no-deps": "2.0.0" },
      peerDependencies: { "no-deps": "*" },
    });
    expect(await app.locked()).toEqual(["a-dep@1.0.4", "no-deps@1.0.0", "peer-no-deps@2.0.0"]);
    expect(await app.resolvedFrom("a-dep", "1.0.4", "peer-no-deps")).toBe("2.0.0");
    await app.install(extended("2.0.0"), false);

    await app.expectFrozenRefusal({ dependencies: pinned });
    await app.install({ dependencies: pinned }, true);
    expect(await app.lockText()).toBe(without);
    expect(await app.resolvedFrom("a-dep", "1.0.4", "peer-no-deps")).toBeUndefined();
  });

  test.concurrent.each([
    ["one dependency", ["no-deps"]],
    ["two dependencies", ["left-pad", "no-deps"]],
  ])("a-dep cannot load what a removed key added: %s", async (_, added) => {
    const app = await project(linker);
    const dependencies = { "a-dep": "1.0.5" };
    const loadable = async () => {
      const { out } = await bun(
        app.dir,
        "-e",
        `const from = require("fs").realpathSync("node_modules/a-dep");
        const loads = name => { try { return !!Bun.resolveSync(name + "/package.json", from); } catch { return false; } };
        console.log(JSON.stringify(${JSON.stringify(added)}.filter(loads)));`,
      );
      return JSON.parse(out);
    };

    const rows = Object.fromEntries(added.map(name => [name, "1.0.0"]));
    await app.install({ dependencies, packageExtensions: { "a-dep": { dependencies: rows } } }, true);
    expect(await loadable()).toEqual(added);

    await app.install({ dependencies }, true);
    expect(await app.locked()).toEqual(["a-dep@1.0.5"]);
    expect(await loadable()).toEqual([]);
  });

  // bun.lock records which dependencies were added, so one that the package declares isn't mistaken for an added one.
  test.concurrent(
    "removing a key that repeats the package's own declaration keeps the package's dependency",
    async () => {
      const app = await project(linker);
      const dependencies = { "one-fixed-dep": "1.0.0" };
      await app.install({ dependencies }, true);
      const without = await app.lockText();

      await app.install(
        { dependencies, packageExtensions: { "one-fixed-dep": { dependencies: { "no-deps": "1.0.0" } } } },
        false,
      );
      expect(await app.lockText()).toBe(without);
      await app.install({ dependencies }, false);
      expect(await app.entry("one-fixed-dep")).toEqual({ dependencies: { "no-deps": "1.0.0" } });
    },
  );

  test.concurrent("makes a peer that the package declares optional, and required again", async () => {
    const app = await project(linker);
    const dependencies = { "peer-deps-fixed": "1.0.0" };
    const optional = {
      dependencies,
      packageExtensions: { "peer-deps-fixed": { peerDependenciesMeta: { "no-deps": { optional: true } } } },
    };

    await app.install(optional, true);
    expect(await app.entry("peer-deps-fixed")).toEqual({
      peerDependencies: { "no-deps": "^1.0.0" },
      optionalPeers: ["no-deps"],
    });
    expect((await app.lock()).packageExtensions).toEqual({ "peer-deps-fixed@1.0.0": { optionalPeers: ["no-deps"] } });
    expect(await app.locked()).toEqual(["peer-deps-fixed@1.0.0"]);
    await app.install(optional, false);

    await app.expectFrozenRefusal({ dependencies });
    await app.install({ dependencies }, true);
    expect(await app.entry("peer-deps-fixed")).toEqual({ peerDependencies: { "no-deps": "^1.0.0" } });
    expect(await app.locked()).toEqual(["no-deps@1.1.0", "peer-deps-fixed@1.0.0"]);
    expect(await app.lockText()).not.toContain("packageExtensions");

    await app.install(optional, true);
    expect(await app.entry("peer-deps-fixed")).toEqual({
      peerDependencies: { "no-deps": "^1.0.0" },
      optionalPeers: ["no-deps"],
    });
  });

  test.concurrent("an override applies to an added dependency", async () => {
    const app = await project(linker);
    const extended = {
      dependencies: { "a-dep": "1.0.5" },
      packageExtensions: { "a-dep": { dependencies: { "no-deps": "^1.0.0" } } },
    };
    await app.install({ ...extended, overrides: { "no-deps": "1.0.1" } }, true);
    expect(await app.entry("a-dep")).toEqual({ dependencies: { "no-deps": "^1.0.0" } });
    expect(await app.locked()).toEqual(["a-dep@1.0.5", "no-deps@1.0.1"]);
  });

  test.concurrent("a key and an override that are added in the same install", async () => {
    const app = await projectWithPin();
    await app.install(
      {
        dependencies: pinned,
        overrides: { "peer-no-deps": "1.0.1" },
        packageExtensions: { "a-dep": { dependencies: { "peer-no-deps": "^1.0.0" } } },
      },
      true,
    );
    expect(await app.entry("a-dep")).toEqual({ dependencies: { "peer-no-deps": "^1.0.0" } });
    expect(await app.locked()).toEqual(["a-dep@1.0.4", "no-deps@1.0.0", "peer-no-deps@1.0.1"]);
  });

  test.concurrent("bun update of the extended package extends the new version", async () => {
    const app = await project(linker);
    const packageExtensions = { "a-dep": { dependencies: { "no-deps": "1.0.0" } } };
    await app.install({ dependencies: { "a-dep": "1.0.5" }, packageExtensions }, true);
    await app.install({ dependencies: { "a-dep": "^1.0.5" }, packageExtensions }, true);
    expect(await app.locked()).toEqual(["a-dep@1.0.5", "no-deps@1.0.0"]);

    const { err, exitCode } = await bun(app.dir, "update", "a-dep");
    expect(err).not.toContain("error:");
    expect(await app.locked()).toEqual(["a-dep@1.0.10", "no-deps@1.0.0"]);
    expect(await app.entry("a-dep")).toEqual({ dependencies: { "no-deps": "1.0.0" } });
    expect((await app.lock()).packageExtensions).toEqual({ "a-dep@1.0.10": { dependencies: ["no-deps"] } });
    expect(await app.resolvedFrom("a-dep", "1.0.10", "no-deps")).toBe("1.0.0");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun remove of the extended package drops its record", async () => {
    const app = await project(linker);
    await app.install(
      {
        dependencies: { "a-dep": "1.0.5", "left-pad": "1.0.0" },
        packageExtensions: { "a-dep": { dependencies: { "no-deps": "1.0.0" } } },
      },
      true,
    );

    const { err, exitCode } = await bun(app.dir, "remove", "a-dep");
    expect(err).not.toContain("error:");
    expect(await app.locked()).toEqual(["left-pad@1.0.0"]);
    expect((await app.lock()).packageExtensions).toBeUndefined();
    expect(exitCode).toBe(0);

    const frozen = await bun(app.dir, "install", "--frozen-lockfile");
    expect(frozen.err).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
  });

  test.concurrent.each([
    ["no-deps", ["a-dep@1.0.1", "no-deps@1.1.0"], { "no-deps@1.1.0": { dependencies: ["a-dep"] } }],
    ["no-deps@2", ["no-deps@1.1.0"], undefined],
  ])("%s: a version that bun.lock does not list has no record", async (key, locked, records) => {
    const app = await project(linker);
    // The peer resolves to 2.0.0, which is not installed next to the 1.1.0 of the other row.
    const manifest = {
      devDependencies: { "no-deps": "^1.0.0" },
      peerDependencies: { "no-deps": "latest" },
      packageExtensions: { [key]: { dependencies: { "a-dep": "1.0.1" } } },
    };

    await app.install(manifest, true);
    expect(await app.locked()).toEqual(locked);
    expect((await app.lock()).packageExtensions).toEqual(records);
    await app.install(manifest, false, "--frozen-lockfile");
    await app.install(manifest, false);
  });

  test.concurrent("bun.lockb also records what was added", async () => {
    const app = await project(linker, { saveTextLockfile: false });
    const extended = (version: string) => ({
      dependencies: { "a-dep": "1.0.5" },
      packageExtensions: { "a-dep": { dependencies: { "no-deps": version } } },
    });

    await app.install(extended("1.0.0"), true);
    expect(existsSync(join(app.dir, "bun.lockb"))).toBe(true);
    await app.install(extended("1.0.0"), false);
    await app.install(extended("1.0.0"), false, "--frozen-lockfile");

    await app.expectFrozenRefusal(extended("1.0.1"), "bun.lockb");
    await app.install(extended("1.0.1"), true);
    expect(await app.resolvedFrom("a-dep", "1.0.5", "no-deps")).toBe("1.0.1");

    await app.expectFrozenRefusal({ dependencies: { "a-dep": "1.0.5" } }, "bun.lockb");
    await app.install({ dependencies: { "a-dep": "1.0.5" } }, true);
    await app.install({ dependencies: { "a-dep": "1.0.5" } }, false, "--frozen-lockfile");
  });
});

test.concurrent("the same name in several groups follows the rules of a manifest", async () => {
  const app = await project("hoisted");
  const manifest = {
    dependencies: { "a-dep": "1.0.9" },
    packageExtensions: {
      "a-dep": {
        dependencies: { "no-deps": "1.0.0", "peer-no-deps": "1.0.0" },
        // overrides `dependencies`
        optionalDependencies: { "no-deps": "1.0.1" },
        // a name that is a dependency already is not a peer as well
        peerDependencies: { "no-deps": "*", "peer-no-deps": "*" },
        peerDependenciesMeta: { "peer-no-deps": { optional: true } },
      },
    },
  };
  await app.install(manifest, true);
  expect(await app.entry("a-dep")).toEqual({
    dependencies: { "peer-no-deps": "1.0.0" },
    optionalDependencies: { "no-deps": "1.0.1" },
  });
  expect(await app.locked()).toEqual(["a-dep@1.0.9", "no-deps@1.0.1", "peer-no-deps@1.0.0"]);
  await app.install(manifest, false);
});

test.concurrent("a key with a mistake is ignored with a warning", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  const dependencies = { "no-deps": "1.0.0" };
  await write(
    packageJson,
    JSON.stringify({
      name: "app",
      dependencies: { "a-dep": "1.0.7" },
      packageExtensions: {
        "a-dep@1.0.7": { dependencies: { "no-deps": 1 } },
        "a-dep@1": "not an object",
        "a-dep@not a range": { dependencies },
        "a-dep@": { dependencies },
        "": { dependencies },
        // Read against the extended package, these wouldn't mean what they say.
        "a-dep@1.x": { dependencies: { "no-deps": "file:./no-deps" } },
        "a-dep@^1": { dependencies: { "no-deps": "link:./no-deps" } },
        "a-dep@~1": { dependencies: { "no-deps": "workspace:*" } },
        "a-dep@>=1": { dependencies: { "no-deps": "catalog:" } },
        "a-dep@>0": { dependencies: { "no-deps": "./no-deps-1.0.0.tgz" } },
      },
    }),
  );

  const { out, err, exitCode } = await bun(packageDir, "install");
  const specifier = "expected a version, a tag, a git repository or a tarball URL for every dependency";
  expect(err.split("\n").filter(line => line.startsWith("warn:"))).toEqual([
    'warn: Ignored "a-dep@1.0.7" in "packageExtensions": expected a map of specifiers',
    'warn: Ignored "a-dep@1" in "packageExtensions": expected an object',
    'warn: Ignored "a-dep@not a range" in "packageExtensions": expected a semver range after the "@"',
    'warn: Ignored "a-dep@" in "packageExtensions": expected "name" or "name@range"',
    'warn: Ignored "" in "packageExtensions": expected "name" or "name@range"',
    `warn: Ignored "a-dep@1.x" in "packageExtensions": ${specifier}`,
    `warn: Ignored "a-dep@^1" in "packageExtensions": ${specifier}`,
    `warn: Ignored "a-dep@~1" in "packageExtensions": ${specifier}`,
    `warn: Ignored "a-dep@>=1" in "packageExtensions": ${specifier}`,
    `warn: Ignored "a-dep@>0" in "packageExtensions": ${specifier}`,
  ]);
  expect(err).not.toContain("error:");
  expect(out).toContain("1 package installed");
  expect(await file(join(packageDir, "bun.lock")).text()).not.toContain("no-deps");
  expect(exitCode).toBe(0);
});

test.concurrent("packageExtensions that is not an object is ignored with a warning", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  await write(packageJson, JSON.stringify({ name: "app", dependencies: { "a-dep": "1.0.7" }, packageExtensions: [] }));

  const { out, err, exitCode } = await bun(packageDir, "install");
  expect(err).toContain('warn: "packageExtensions" expects an object');
  expect(err).not.toContain("error:");
  expect(out).toContain("1 package installed");
  expect(exitCode).toBe(0);
});

test.concurrent("only the root package.json is read", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: {
      "package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
      "packages/member/package.json": JSON.stringify({
        name: "member",
        dependencies: { "a-dep": "1.0.5" },
        packageExtensions: { "a-dep": { dependencies: { "no-deps": "1.0.0" } } },
      }),
    },
  });

  const { err, exitCode } = await bun(packageDir, "install");
  expect(err).not.toContain("error:");
  expect(await file(join(packageDir, "bun.lock")).text()).not.toContain("no-deps");
  expect(exitCode).toBe(0);
});

test.concurrent("a dependency that no key adds anymore is only unlinked from the extended package", async () => {
  const root = { name: "app", workspaces: ["packages/*"], dependencies: { "a-dep": "1.0.5" } };
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        ...root,
        packageExtensions: { "a-dep": { dependencies: { "no-deps": "1.0.0" } } },
      }),
      "packages/member/package.json": JSON.stringify({ name: "member" }),
      "mine/package.json": JSON.stringify({ name: "no-deps", version: "9.9.9" }),
    },
  });
  const added = join(packageDir, "node_modules", ".bun", "a-dep@1.0.5", "node_modules", "no-deps");
  const own = [packageDir, join(packageDir, "packages", "member")].map(dir => join(dir, "node_modules", "no-deps"));
  expect(await bun(packageDir, "install")).toMatchObject({ exitCode: 0 });
  for (const link of own) {
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(join(packageDir, "mine"), link, "junction");
  }
  expect([added, ...own].map(link => existsSync(link))).toEqual([true, true, true]);

  await write(packageJson, JSON.stringify(root));
  const { err, exitCode } = await bun(packageDir, "install");
  expect(err).not.toContain("error:");
  expect([added, ...own].map(link => existsSync(link))).toEqual([false, true, true]);
  expect(exitCode).toBe(0);
});
