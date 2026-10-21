import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, githubTarball, nodeModulesPackages, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";
import { pathToFileURL } from "url";

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

async function bunWith(env: Record<string, string>, dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    // CI exports BUN_INSTALL_CACHE_DIR, which overrides the bunfig's per-test `cache`; concurrent tests sharing one cache race on Windows.
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"), ...env },
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

const bun = (dir: string, ...args: string[]) => bunWith({}, dir, ...args);

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
    test.concurrent.each([...frozen, "install"])("bun %s says nothing", async command => {
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

  test.concurrent("a rule that bun.lock has from resolutions goes with the next install", async () => {
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

  // What the registry's packages declare, as bun.lock prints it.
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

  // A fresh install of Bun 1.4 saves each of these: a version stands next to a rule that does not name it, and rightly.
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

    test.concurrent.each(frozen)("bun %s names the entry and the rule", async command => {
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

// In most of these tests `b` is not a registry package. The project, or the tarball package `a`, declares it as a tarball
// URL or as a git repository, and that specifier names `b@1.0.0`. A rule for `b` names a fork instead. Each fork is
// 2.0.0: one keeps the name `b`, and one names itself `bee` in its own package.json.
describe("a rule for a tarball or git dependency", () => {
  const packages = {
    original: { name: "b", version: "1.0.0" },
    "fork-b": { name: "b", version: "2.0.0" },
    "fork-bee": { name: "bee", version: "2.0.0" },
    // A fork with a dependency of its own, for the rules that are nested under it.
    "fork-bee-dep": { name: "bee", version: "2.0.0", dependencies: { "no-deps": "^1.0.0" } },
    "fork-bee-script": { name: "bee", version: "2.0.0", scripts: { postinstall: "echo fork > ran.txt" } },
    // What the specifier of `b` names when the package calls itself something else.
    other: { name: "other", version: "1.0.0" },
    // The `b`, the `a` and the `c` of the registry that this server is for the tests that set `registry`.
    "registry-b": { name: "b", version: "3.0.0", main: "package.json" },
    "registry-a": { name: "a", version: "3.0.0", main: "package.json", dependencies: { b: "^3.0.0" } },
    "registry-c": { name: "c", version: "3.5.0" },
  };
  type Id = keyof typeof packages;
  type Kind = "tarball" | "git";
  // The git cells need the `git` program.
  const kinds: Kind[] = Bun.which("git") ? ["tarball", "git"] : ["tarball"];
  // The registry's `b`, then `other` as a `kind`, then the tarball `v`.
  const z = (kind: Kind) => (spec: ReturnType<typeof at>) => ({
    name: "z",
    version: "1.0.0",
    dependencies: { b: "3.0.0", other: spec[kind]("other"), v: spec.tarball("v") },
  });
  // Tarballs that depend on other packages of their test.
  const dependents: Record<string, (spec: ReturnType<typeof at>) => object> = {
    "z-tarball": z("tarball"),
    "z-git": z("git"),
    v: () => ({ name: "v", version: "1.0.0", dependencies: { a: "3.0.0" } }),
  };

  const tarballs = new Map<string, Promise<Uint8Array>>();
  const requests: string[] = [];
  const gone = new Set<string>();
  const failing = new Set<string>();
  /** The answer to a path waits for its promise. A request for a path of `gates` resolves one. */
  const held = new Map<string, Promise<void>>();
  const gates = new Map<string, () => void>();
  const commits = {} as Record<Id, string>;
  let repos: ReturnType<typeof tempDir>;
  let server: ReturnType<typeof Bun.serve>;
  let tests = 0;

  async function git(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: ["git", "-c", "commit.gpgsign=false", ...args],
      cwd,
      env: {
        ...bunEnv,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${stderr}`);
    return stdout.trim();
  }

  beforeAll(async () => {
    repos = tempDir("override-git-", {});
    await Promise.all(
      (kinds.includes("git") ? (Object.keys(packages) as Id[]) : []).map(async id => {
        const repo = join(String(repos), id);
        mkdirSync(repo);
        writeFileSync(join(repo, "package.json"), JSON.stringify(packages[id]));
        await git(repo, "init", "-q");
        await git(repo, "add", "package.json");
        await git(repo, "commit", "-q", "-m", id);
        await git(repo, "tag", "v1");
        commits[id] = await git(repo, "rev-parse", "HEAD");
      }),
    );
    server = Bun.serve({
      port: 0,
      // `/<test>/<id>.tgz`, or `/repos/<test>/<id>/tarball/v1` for `github:<test>/<id>#v1`, or `/<test>/registry/<name>`
      // for a manifest. `a-<kind>` is the package `a` that depends on the `b` of that test, and `a-peer-<kind>` has it
      // as a peer.
      async fetch(req) {
        const { pathname, origin } = new URL(req.url);
        const heal = /^\/(\w+)\/heal$/.exec(pathname);
        if (heal) {
          for (const path of failing) if (path.startsWith(`/${heal[1]}/`)) failing.delete(path);
          return new Response("ok");
        }
        requests.push(pathname);
        gates.get(pathname)?.();
        await held.get(pathname);
        if (gone.has(pathname)) return new Response(null, { status: 404 });
        if (failing.has(pathname)) return new Response("{}", { status: 500 });
        const manifest = /^\/(\w+)\/registry\/(a|b|c)$/.exec(pathname);
        if (manifest) {
          const found = packages[`registry-${manifest[2] as "a" | "b" | "c"}`];
          const dist = { tarball: `${origin}/${manifest[1]}/registry-${manifest[2]}.tgz` };
          return Response.json({
            name: found.name,
            "dist-tags": { latest: found.version },
            versions: { [found.version]: { ...found, dist } },
          });
        }
        const github = /^\/repos\/(\w+)\/([\w-]+)\/tarball\/v1$/.exec(pathname);
        const [, test, id] = github ?? /^\/(\w+)\/([\w-]+)\.tgz$/.exec(pathname) ?? ["", "", ""];
        const dependent = /^a-(peer-)?(tarball|git)$/.exec(id);
        const json =
          id in packages
            ? packages[id as Id]
            : id in dependents
              ? dependents[id](at(test))
              : dependent && {
                  name: "a",
                  version: "1.0.0",
                  [dependent[1] ? "peerDependencies" : "dependencies"]: {
                    b: at(test)[dependent[2] as Kind]("original"),
                  },
                };
        if (!json) return new Response(null, { status: 404 });
        // One archive per URL: bun.lock pins its bytes.
        if (!tarballs.has(pathname)) {
          const root = github ? `${test}-${id}-v1` : "package";
          tarballs.set(pathname, githubTarball(root, { "package.json": JSON.stringify(json) }));
        }
        return new Response(await tarballs.get(pathname));
      },
    });
  });

  afterAll(async () => {
    await server?.stop(true);
    repos?.[Symbol.dispose]();
  });

  /** The specifiers of the test `test`. Its URLs have a folder of their own, so `requested` counts its requests only. */
  function at(test = `t${++tests}`) {
    const origin = `http://localhost:${server.port}`;
    const tarball = (id: string) => `${origin}/${test}/${id}.tgz`;
    const paths = (id: string) => [`/${test}/${id}.tgz`, `/repos/${test}/${id}/tarball/v1`, `/${test}/registry/${id}`];
    return {
      tarball,
      git: (id: string) => `git+${pathToFileURL(join(String(repos), id))}#v1`,
      github: (id: string) => `github:${test}/${id}#v1`,
      /** For `bunWith`: `a`, `b` and `c` are also registry packages, `registry-a` and so on. */
      registry: { BUN_CONFIG_REGISTRY: `${origin}/${test}/registry/`, GITHUB_API_URL: origin },
      requested: (id: string) => requests.filter(pathname => paths(id).includes(pathname)).length,
      /** The server has `id` no more. */
      remove: (id: string) => paths(id).forEach(path => gone.add(path)),
      /** The server answers 500 for `id` until a request for `heal`. */
      fail: (id: string) => paths(id).forEach(path => failing.add(path)),
      heal: `${origin}/${test}/heal`,
      /** The server answers a request for `id` only after it has a request for `until`. */
      hold(id: string, until: string) {
        const { promise, resolve } = Promise.withResolvers<void>();
        paths(until).forEach(path => gates.set(path, resolve));
        paths(id).forEach(path => held.set(path, promise));
      },
    };
  }

  /** `<name>@<version>` of the package in `folder`. */
  function packageIn(folder: string) {
    const path = join(folder, "package.json");
    if (!existsSync(path)) return "nothing";
    const { name, version } = JSON.parse(readFileSync(path, "utf8"));
    return `${name}@${version}`;
  }

  /** `<name>@<version>` of the package in `node_modules/<key>`. */
  const installed = (dir: string, key: string) => packageIn(join(dir, "node_modules", key));

  /** `<name>@<version>` of the `b` that the package `a` loads, under either linker. */
  function loadedByA(dir: string) {
    const a = realpathSync(join(dir, "node_modules", "a"));
    const nested = join(a, "node_modules", "b");
    return packageIn(existsSync(nested) ? nested : join(a, "..", "b"));
  }

  /** What bun.lock has for `key`: `<name>@<resolution>`. */
  async function locked(dir: string, key: string) {
    const { packages } = Bun.JSONC.parse(await lockfile(dir)) as { packages: Record<string, [string]> };
    return packages[key]?.[0];
  }

  /** The git repositories that the installs of `dir` cloned. */
  const cloned = (dir: string) => {
    const cache = join(dir, ".bun-cache");
    return existsSync(cache) ? readdirSync(cache).filter(entry => entry.endsWith(".git")).length : 0;
  };

  /** How often the package that the rule replaces was fetched, and how many repositories were cloned. */
  const fetched = (spec: ReturnType<typeof at>, dir: string) => ({
    original: spec.requested("original"),
    cloned: cloned(dir),
  });

  /** The next `bun install` resolves nothing and saves nothing. */
  async function expectNextInstallChangesNothing(dir: string) {
    const lock = await lockfile(dir);
    const { stderr, exitCode } = await bun(dir, "install");
    expect({ stderr, sameLock: (await lockfile(dir)) === lock, exitCode }).toEqual({
      stderr: "",
      sameLock: true,
      exitCode: 0,
    });
  }

  const forks = kinds.flatMap(to => (["b", "bee"] as const).map(named => ({ to, named })));
  const cells = kinds.flatMap(from => forks.map(fork => ({ from, ...fork })));

  describe.each(["the project", "the package a"])("%s declares b", declarer => {
    test.concurrent.each(cells)(
      "as a $from, and the rule names a $to that calls itself $named",
      async ({ from, to, named }) => {
        const spec = at();
        const fork: Id = `fork-${named}`;
        const dependencies =
          declarer === "the project" ? { b: spec[from]("original") } : { a: spec.tarball(`a-${from}`) };
        const dir = await project({ name: "foo", dependencies, overrides: { b: spec[to](fork) } });

        const { stderr, exitCode } = await bun(dir, "install");

        expect(stderr).toBe("Saved lockfile");
        expect(installed(dir, "b")).toBe(`${named}@2.0.0`);
        expect(await locked(dir, "b")).toBe(
          `${named}@${to === "git" ? spec.git(fork).replace("#v1", `#${commits[fork]}`) : spec.tarball(fork)}`,
        );
        // The package that the rule replaces is not fetched.
        expect(fetched(spec, dir)).toEqual({ original: 0, cloned: to === "git" ? 1 : 0 });
        expect(exitCode).toBe(0);
        if (declarer === "the project") await expectNextInstallChangesNothing(dir);
      },
    );
  });

  // `b` and `a` come from the registry here, as in most projects: `a@3.0.0` depends on `b@^3.0.0`.
  describe.each(["the project", "the registry package a"])("%s declares b as a range", declarer => {
    test.concurrent.each([...kinds, "github"] as const)("and the rule names a %s that calls itself bee", async to => {
      const spec = at();
      const dependencies = declarer === "the project" ? { b: "^3.0.0" } : { a: "3.0.0" };
      const dir = await project({ name: "foo", dependencies, overrides: { b: spec[to]("fork-bee") } });

      const { stderr, exitCode } = await bunWith(spec.registry, dir, "install");

      expect(stderr).toBe("Saved lockfile");
      expect(installed(dir, "b")).toBe("bee@2.0.0");
      // Neither the manifest nor the tarball of the package that the rule replaces is asked for.
      expect({ manifest: spec.requested("b"), tarball: spec.requested("registry-b") }).toEqual({
        manifest: 0,
        tarball: 0,
      });
      expect(exitCode).toBe(0);

      // a machine that has bun.lock and nothing else
      rmSync(join(dir, "node_modules"), { recursive: true, force: true });
      rmSync(join(dir, ".bun-cache"), { recursive: true, force: true });
      const frozen = await bunWith(spec.registry, dir, "install", "--frozen-lockfile");
      expect(frozen.stderr).toBe("");
      expect(installed(dir, "b")).toBe("bee@2.0.0");
      expect(frozen.exitCode).toBe(0);
    });
  });

  describe.each(cells.filter(cell => cell.named === "bee"))(
    "a $from dependency, and a rule that names a $to of another name",
    ({ from, to }) => {
      test.concurrent("the rule is added to the installed project", async () => {
        const spec = at();
        const dir = await project({ name: "foo", dependencies: { b: spec[from]("original") } });
        expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");
        expect(installed(dir, "b")).toBe("b@1.0.0");

        await editPackageJson(dir, pkg => (pkg.overrides = { b: spec[to]("fork-bee") }));
        const { stderr, exitCode } = await bun(dir, "install");

        expect(stderr).toBe("Saved lockfile");
        expect(installed(dir, "b")).toBe("bee@2.0.0");
        expect(exitCode).toBe(0);
      });

      test.concurrent("the rule is removed from the installed project", async () => {
        const spec = at();
        const dir = await project({
          name: "foo",
          dependencies: { b: spec[from]("original") },
          overrides: { b: spec[to]("fork-bee") },
        });
        expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");
        expect(installed(dir, "b")).toBe("bee@2.0.0");

        await editPackageJson(dir, pkg => delete pkg.overrides);
        const { stderr, exitCode } = await bun(dir, "install");

        expect(stderr).toBe("Saved lockfile");
        expect(installed(dir, "b")).toBe("b@1.0.0");
        expect(exitCode).toBe(0);
      });
    },
  );

  // #33192: the dependency and the rule name one tarball, and a registry package has a peer on the key.
  test.concurrent("a tarball that calls itself other serves its key for the project and for a peer", async () => {
    const spec = at();
    const dir = await project({
      name: "foo",
      devDependencies: { "no-deps": spec.tarball("other"), "peer-deps-fixed": "1.0.0" },
      overrides: { "no-deps": spec.tarball("other") },
    });

    const { stderr, exitCode } = await bun(dir, "install");

    expect(stderr).toBe("Saved lockfile");
    expect(nodeModulesPackages(dir)).toBe(
      ["node_modules/no-deps/other@1.0.0", "node_modules/peer-deps-fixed/peer-deps-fixed@1.0.0"].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  // `owner/repo#ref` is downloaded from `${GITHUB_API_URL}/repos/owner/repo/tarball/ref`.
  test.concurrent("a github: dependency, and the rule names a github: repository that calls itself bee", async () => {
    const spec = at();
    const dir = await project({
      name: "foo",
      dependencies: { b: spec.github("original") },
      overrides: { b: spec.github("fork-bee") },
    });

    const { stderr, exitCode } = await bunWith(spec.registry, dir, "install");

    expect(stderr).toBe("Saved lockfile");
    expect(installed(dir, "b")).toBe("bee@2.0.0");
    expect({ original: spec.requested("original"), fork: spec.requested("fork-bee") }).toEqual({
      original: 0,
      fork: 1,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("a version added as a rule for an installed tarball dependency replaces the tarball", async () => {
    const tarball = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;
    const dir = await project({ name: "foo", dependencies: { "no-deps": tarball } });
    expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");
    expect(installed(dir, "no-deps")).toBe("no-deps@1.0.0");

    await editPackageJson(dir, pkg => (pkg.overrides = { "no-deps": "2.0.0" }));
    const { stderr, exitCode } = await bun(dir, "install");

    expect(stderr).toBe("Saved lockfile");
    expect(installed(dir, "no-deps")).toBe("no-deps@2.0.0");
    expect(await locked(dir, "no-deps")).toBe("no-deps@2.0.0");
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([
    { spelling: "overrides { a: { b } }", rules: (fork: string) => ({ overrides: { a: { b: fork } } }) },
    { spelling: 'overrides { "a>b" }', rules: (fork: string) => ({ overrides: { "a>b": fork } }) },
    { spelling: "resolutions { b }", rules: (fork: string) => ({ resolutions: { b: fork } }) },
    { spelling: 'resolutions { "a/b" }', rules: (fork: string) => ({ resolutions: { "a/b": fork } }) },
  ])("$spelling reaches the tarball that the package a declares", async ({ rules }) => {
    const spec = at();
    const dir = await project({
      name: "foo",
      dependencies: { a: spec.tarball("a-tarball") },
      ...rules(spec.tarball("fork-bee")),
    });

    const { stderr, exitCode } = await bun(dir, "install");

    expect(stderr).toBe("Saved lockfile");
    expect(installed(dir, "b")).toBe("bee@2.0.0");
    expect(spec.requested("original")).toBe(0);
    expect(exitCode).toBe(0);
  });

  // The rule names the catalog, and the catalog names the fork.
  describe.each([
    { rule: "catalog:", catalogs: (fork: string) => ({ catalog: { b: fork } }) },
    { rule: "catalog:forks", catalogs: (fork: string) => ({ catalogs: { forks: { b: fork } } }) },
  ])("a rule that is $rule", ({ rule, catalogs }) => {
    test.concurrent.each(kinds)("replaces a %s with the entry of the catalog", async kind => {
      const spec = at();
      const dir = await project({
        name: "foo",
        workspaces: { packages: [], ...catalogs(spec[kind]("fork-bee")) },
        dependencies: { b: spec[kind]("original") },
        overrides: { b: rule },
      });

      const { stderr, exitCode } = await bun(dir, "install");

      expect(stderr).toBe("Saved lockfile");
      expect(installed(dir, "b")).toBe("bee@2.0.0");
      expect(fetched(spec, dir)).toEqual({ original: 0, cloned: kind === "git" ? 1 : 0 });
      expect(exitCode).toBe(0);
    });
  });

  // `a` has `b` as a peer, and nothing else declares `b`.
  test.concurrent.each(kinds)("a peer that is declared as a %s gets the fork", async kind => {
    const spec = at();
    const dir = await project({
      name: "foo",
      dependencies: { a: spec.tarball(`a-peer-${kind}`) },
      overrides: { b: spec[kind]("fork-bee") },
    });

    const { stderr, exitCode } = await bun(dir, "install");

    expect(stderr).toBe("Saved lockfile");
    expect(loadedByA(dir)).toBe("bee@2.0.0");
    expect(fetched(spec, dir)).toEqual({ original: 0, cloned: kind === "git" ? 1 : 0 });
    expect(exitCode).toBe(0);

    // from bun.lock alone
    rmSync(join(dir, "node_modules"), { recursive: true, force: true });
    const again = await bun(dir, "install", "--frozen-lockfile");
    expect(again.stderr).toBe("");
    expect(loadedByA(dir)).toBe("bee@2.0.0");
    expect(again.exitCode).toBe(0);
  });

  // The project has the `b` that the specifier names, and the rule is for the peer of `a` alone. The package that the
  // rule names is the one that `a` loads, whether it keeps the name `b` or not.
  describe.each(["hoisted", "isolated"])("with the %s linker, a rule for the peer of a", linker => {
    test.concurrent.each(forks)("names a $to that calls itself $named", async ({ to, named }) => {
      const spec = at();
      const dir = await project({
        name: "foo",
        dependencies: { a: spec.tarball(`a-peer-${to}`), b: spec[to]("original") },
        overrides: { a: { b: spec[to](`fork-${named}`) } },
      });

      const { stderr, exitCode } = await bun(dir, "install", `--linker=${linker}`);

      expect(stderr).toBe("Saved lockfile");
      expect({ project: installed(dir, "b"), a: loadedByA(dir) }).toEqual({
        project: "b@1.0.0",
        a: `${named}@2.0.0`,
      });
      expect(exitCode).toBe(0);
    });
  });

  test.concurrent.each(kinds)("bun update and --force keep the fork of a %s, and read it again", async kind => {
    const spec = at();
    const dir = await project({
      name: "foo",
      dependencies: { b: spec[kind]("original") },
      overrides: { b: spec[kind]("fork-bee") },
    });
    expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");
    const lock = await lockfile(dir);

    for (const args of [["update"], ["install", "--force"]]) {
      const { exitCode } = await bun(dir, ...args);
      expect({ args, installed: installed(dir, "b"), lock: await lockfile(dir), exitCode }).toEqual({
        args,
        installed: "bee@2.0.0",
        lock,
        exitCode: 0,
      });
    }
    expect(fetched(spec, dir)).toEqual({ original: 0, cloned: kind === "git" ? 1 : 0 });
    // The install, the update and the forced install each asked for the tarball.
    if (kind === "tarball") expect(spec.requested("fork-bee")).toBe(3);
  });

  // `z` depends on the registry's `b`, on `other` and on the tarball `v`. The project has `other` already, so that
  // dependency of `z` is bound while `b` waits for its manifest. It must not wait for the download once more when its
  // turn comes: a download is added in the order of the dependencies that wait, and `v` would then be added only
  // after everything else has arrived. The server keeps the tarball of `b` until `a`, which only `v` depends on, is
  // resolved and downloaded.
  test.concurrent.each(kinds)(
    "bun install --force adds a tarball in its turn after a dependency on a %s that is there",
    async kind => {
      const spec = at();
      spec.hold("registry-b", "registry-a");
      const dependencies = { other: spec[kind]("other"), z: spec.tarball(`z-${kind}`) };
      const dir = await project({ name: "foo", dependencies });

      const { stderr, exitCode } = await bunWith(spec.registry, dir, "install", "--force");

      expect(stderr).toBe("Saved lockfile");
      expect({ v: installed(dir, "v"), a: installed(dir, "a"), b: installed(dir, "b") }).toEqual({
        v: "v@1.0.0",
        a: "a@3.0.0",
        b: "b@3.0.0",
      });
      // Both dependencies on `other` have the one entry of bun.lock, which pins the commit of a git repository.
      const pinned = kind === "git" ? spec.git("other").replace("#v1", `#${commits.other}`) : spec.tarball("other");
      expect(await locked(dir, "other")).toBe(`other@${pinned}`);
      expect(exitCode).toBe(0);
    },
  );

  // `bun update` reads what a rule names again, like what a dependency names. If that is gone, the update fails and
  // changes nothing, or it leaves an optional dependency out.
  test.concurrent.each([
    { group: "dependencies", says: "error", installs: "bee@2.0.0", exits: 1 },
    { group: "optionalDependencies", says: "warn", installs: "nothing", exits: 0 },
  ])("bun update when the tarball that a rule for $group names is gone", async ({ group, says, installs, exits }) => {
    const spec = at();
    const dir = await project({
      name: "foo",
      [group]: { b: spec.tarball("original") },
      overrides: { b: spec.tarball("fork-bee") },
    });
    expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");
    const lock = await lockfile(dir);
    spec.remove("fork-bee");

    const { stderr, exitCode } = await bun(dir, "update");

    expect(stderr).toContain(`${says}: GET ${spec.tarball("fork-bee")} - 404`);
    expect({ installed: installed(dir, "b"), sameLock: (await lockfile(dir)) === lock, exitCode }).toEqual({
      installed: installs,
      sameLock: exits === 1,
      exitCode: exits,
    });
    expect(spec.requested("original")).toBe(0);
  });

  test.concurrent.each(kinds)("the isolated linker installs the fork of a %s from bun.lock alone", async kind => {
    const spec = at();
    const dir = await project({
      name: "foo",
      dependencies: { b: spec[kind]("original") },
      overrides: { b: spec[kind]("fork-bee") },
    });
    expect((await bun(dir, "install", "--linker=isolated")).stderr).toBe("Saved lockfile");
    expect(installed(dir, "b")).toBe("bee@2.0.0");
    expect(fetched(spec, dir)).toEqual({ original: 0, cloned: kind === "git" ? 1 : 0 });

    // a machine that has bun.lock and nothing else
    rmSync(join(dir, "node_modules"), { recursive: true, force: true });
    rmSync(join(dir, ".bun-cache"), { recursive: true, force: true });
    const { stderr, exitCode } = await bun(dir, "install", "--linker=isolated", "--frozen-lockfile");

    expect(stderr).toBe("");
    expect(installed(dir, "b")).toBe("bee@2.0.0");
    expect(fetched(spec, dir)).toEqual({ original: 0, cloned: kind === "git" ? 1 : 0 });
    expect(exitCode).toBe(0);
  });

  test.concurrent.each(kinds)("a %s that cannot be fetched is not asked for", async kind => {
    const spec = at();
    const dir = await project({
      name: "foo",
      dependencies: { b: spec[kind]("gone") },
      overrides: { b: spec[kind]("fork-bee") },
    });

    const { stderr, exitCode } = await bun(dir, "install");

    expect(stderr).toBe("Saved lockfile");
    expect(installed(dir, "b")).toBe("bee@2.0.0");
    expect({ gone: spec.requested("gone"), cloned: cloned(dir) }).toEqual({ gone: 0, cloned: kind === "git" ? 1 : 0 });
    expect(exitCode).toBe(0);
  });

  test.concurrent.each(kinds)("the rule goes by the key of a %s, not by the name in its package.json", async kind => {
    const spec = at();
    const dir = await project({
      name: "foo",
      dependencies: { b: spec[kind]("other") },
      overrides: { b: spec[kind]("fork-b") },
    });

    const { stderr, exitCode } = await bun(dir, "install");

    expect(stderr).toBe("Saved lockfile");
    expect(installed(dir, "b")).toBe("b@2.0.0");
    expect(exitCode).toBe(0);
  });

  describe("a rule for the name that a package gives itself", () => {
    const warning =
      'warn: override for "b" does not replace "alias": an override replaces a dependency by the name it is declared under, not by the name in its package.json';

    // `alias` is the key, and only the package.json of the package says `b`.
    test.concurrent.each(kinds)("does not replace a %s that is declared under another key", async kind => {
      const spec = at();
      const dir = await project({
        name: "foo",
        dependencies: { alias: spec[kind]("original") },
        overrides: { b: spec[kind]("fork-b") },
      });

      const { stderr, exitCode } = await bun(dir, "install");

      expect(stderr.split("\n")).toEqual([warning, "Saved lockfile"]);
      expect(installed(dir, "alias")).toBe("b@1.0.0");
      expect(exitCode).toBe(0);
      await expectNextInstallChangesNothing(dir);
    });

    // The warning is for a rule that would have replaced the dependency. These rules would not have.
    test.concurrent.each(kinds)("says nothing about a %s that the rule is not for", async kind => {
      const spec = at();
      const fork = spec[kind]("fork-bee");
      const silent = [
        // `b` has its own rule, and the package that the rule names calls itself `bee`.
        { dependencies: { b: spec[kind]("original") }, overrides: { b: fork, bee: "1.0.0" } },
        // The rule for `b` is for the dependency of `a` alone.
        {
          dependencies: { alias: spec[kind]("original"), a: spec.tarball(`a-${kind}`) },
          overrides: { a: { b: fork } },
        },
        // The rule names what `alias` declares.
        { dependencies: { alias: spec[kind]("fork-b") }, overrides: { b: spec[kind]("fork-b") } },
        { dependencies: { alias: spec[kind]("fork-b") }, overrides: { b: "$alias" } },
      ];
      const results = await Promise.all(
        silent.map(async rules => {
          const { stderr, exitCode } = await bun(await project({ name: "foo", ...rules }), "install");
          return { rules, stderr, exitCode };
        }),
      );
      expect(results).toEqual(silent.map(rules => ({ rules, stderr: "Saved lockfile", exitCode: 0 })));
    });
  });

  // The parent of a nested rule is the package that is installed: it goes by the name in its own package.json.
  test.concurrent.each(kinds)(
    "a rule nested under a %s fork goes by the name that the fork gives itself",
    async kind => {
      const spec = at();
      const fork = spec[kind]("fork-bee-dep");
      const dependencies = { b: spec[kind]("original") };

      const byKey = await project({ name: "foo", dependencies, overrides: { b: { ".": fork, "no-deps": "1.0.0" } } });
      const byName = await project({ name: "foo", dependencies, overrides: { b: fork, bee: { "no-deps": "1.0.0" } } });
      const results = [];
      for (const dir of [byKey, byName]) {
        const { stderr, exitCode } = await bun(dir, "install");
        results.push({ stderr, exitCode, b: installed(dir, "b"), "no-deps": installed(dir, "no-deps") });
      }

      expect(results).toEqual([
        { stderr: "Saved lockfile", exitCode: 0, b: "bee@2.0.0", "no-deps": "no-deps@1.1.0" },
        { stderr: "Saved lockfile", exitCode: 0, b: "bee@2.0.0", "no-deps": "no-deps@1.0.0" },
      ]);
    },
  );

  // `bun add <specifier>` learns the key from the package that the specifier names. The rule for that key then applies,
  // as it does when `bun install` reads the package.json that this command writes.
  describe("bun add of a specifier without a name", () => {
    test.concurrent.each(forks)(
      "a $to, and the rule names a $to that calls itself $named",
      async ({ to: kind, named }) => {
        const spec = at();
        const dir = await project({ name: "foo", overrides: { b: spec[kind](`fork-${named}`) } });

        const { stderr, exitCode } = await bun(dir, "add", spec[kind]("original"));

        expect(stderr).toBe("Saved lockfile");
        expect((await file(join(dir, "package.json")).json()).dependencies).toEqual({ b: spec[kind]("original") });
        expect(installed(dir, "b")).toBe(`${named}@2.0.0`);
        expect(exitCode).toBe(0);
        await expectNextInstallChangesNothing(dir);
      },
    );

    test.concurrent.each([
      { flag: "--dev", group: "devDependencies" },
      { flag: "--optional", group: "optionalDependencies" },
      { flag: "--peer", group: "peerDependencies" },
    ])("$flag writes the key to $group", async ({ flag, group }) => {
      const spec = at();
      const dir = await project({ name: "foo", overrides: { b: spec.tarball("fork-bee") } });

      const { stderr, exitCode } = await bun(dir, "add", flag, spec.tarball("original"));

      expect(stderr).toBe("Saved lockfile");
      expect((await file(join(dir, "package.json")).json())[group]).toEqual({ b: spec.tarball("original") });
      expect(installed(dir, "b")).toBe("bee@2.0.0");
      expect(exitCode).toBe(0);
    });

    // The folder and the file are the `b` that the specifier names.
    test.concurrent.each([
      { what: "a folder", specifier: "./b-folder" },
      { what: "a tarball in the project", specifier: "./b.tgz" },
    ])("$what", async ({ specifier }) => {
      const spec = at();
      const dir = await project(
        { name: "foo", overrides: { b: spec.tarball("fork-bee") } },
        { "b-folder/package.json": JSON.stringify(packages.original) },
      );
      await write(
        join(dir, "b.tgz"),
        await githubTarball("package", { "package.json": JSON.stringify(packages.original) }),
      );

      const { stderr, exitCode } = await bun(dir, "add", specifier);

      expect(stderr).toBe("Saved lockfile");
      expect((await file(join(dir, "package.json")).json()).dependencies).toEqual({ b: specifier });
      expect(installed(dir, "b")).toBe("bee@2.0.0");
      expect(exitCode).toBe(0);
    });

    test.concurrent("two specifiers, and a rule for one of them", async () => {
      const spec = at();
      const dir = await project({ name: "foo", overrides: { b: spec.tarball("fork-bee") } });

      const { stderr, exitCode } = await bun(dir, "add", spec.tarball("original"), spec.tarball("other"));

      expect(stderr).toBe("Saved lockfile");
      expect((await file(join(dir, "package.json")).json()).dependencies).toEqual({
        b: spec.tarball("original"),
        other: spec.tarball("other"),
      });
      expect({ b: installed(dir, "b"), other: installed(dir, "other") }).toEqual({
        b: "bee@2.0.0",
        other: "other@1.0.0",
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent("a rule that names a version of the registry", async () => {
      const spec = at();
      const dir = await project({ name: "foo", overrides: { b: "3.0.0" } });

      const { stderr, exitCode } = await bunWith(spec.registry, dir, "add", spec.tarball("original"));

      expect(stderr).toBe("Saved lockfile");
      expect((await file(join(dir, "package.json")).json()).dependencies).toEqual({ b: spec.tarball("original") });
      expect(installed(dir, "b")).toBe("b@3.0.0");
      expect(exitCode).toBe(0);
    });

    // `trustedDependencies` goes by the key too, as it does when `bun install` reads the package.json.
    test.concurrent.each([
      { trusted: "b", runs: true },
      { trusted: "bee", runs: false },
    ])(
      "with $trusted trusted, the postinstall of a fork that calls itself bee runs: $runs",
      async ({ trusted, runs }) => {
        const spec = at();
        const dir = await project({
          name: "foo",
          overrides: { b: spec.tarball("fork-bee-script") },
          trustedDependencies: [trusted],
        });

        const { stderr, exitCode } = await bun(dir, "add", spec.tarball("original"));

        expect(stderr).toBe("Saved lockfile");
        expect({ b: installed(dir, "b"), ran: existsSync(join(dir, "node_modules", "b", "ran.txt")) }).toEqual({
          b: "bee@2.0.0",
          ran: runs,
        });
        expect(exitCode).toBe(0);
      },
    );

    test.concurrent("a rule that names a folder that is not there", async () => {
      const spec = at();
      const dir = await project({ name: "foo", overrides: { b: "file:./not-there" } });

      const { stderr, exitCode } = await bun(dir, "add", spec.tarball("original"));

      expect(stderr).toContain('error: package.json not found for "file:./not-there" dependency "b"');
      expect(installed(dir, "b")).toBe("nothing");
      expect(exitCode).toBe(1);
    });
  });

  describe("an import that installs its package", () => {
    /**
     * Runs `script` in a project without node_modules. `attempt(name)` is the version that `require(name)` finds, and
     * `turn()` asks for `turn`: a failed lookup stands until the event loop has gone around.
     */
    async function autoInstall(env: Record<string, string>, turn: string, packageJson: object, script: string) {
      using dir = tempDir("override-autoinstall", {
        "package.json": JSON.stringify(packageJson),
        "index.js": `
          const attempt = name => {
            try { return require(name).version; } catch (e) { return e.code; }
          };
          const turn = () => fetch(${JSON.stringify(turn)});
          ${script}`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
          // A 500 is tried again once: one lookup is then two requests.
          BUN_CONFIG_HTTP_RETRY_COUNT: "1",
          ...env,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }
    const declared = [...kinds, "github"] as const;

    // The rule sends `b` to the registry, so the lookup that fails is the manifest of `b`.
    test.concurrent.each(declared)("asks again for the manifest that a rule for a %s needs", async kind => {
      const spec = at();
      spec.fail("b");

      const { stdout, stderr, exitCode } = await autoInstall(
        spec.registry,
        spec.heal,
        { name: "foo", dependencies: { b: spec[kind]("original") }, overrides: { b: "3.0.0" } },
        `const results = [attempt("b")];
         await turn(); // the registry answers from here on
         results.push(attempt("b"));
         console.log(JSON.stringify(results));`,
      );

      expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify(["MODULE_NOT_FOUND", "3.0.0"]), stderr: "" });
      expect({ manifest: spec.requested("b"), original: spec.requested("original") }).toEqual({
        manifest: 3,
        original: 0,
      });
      expect(exitCode).toBe(0);
    });

    // The `b` of the project is not the `b` of the registry: that it cannot be fetched says nothing about the manifest.
    test.concurrent.each(declared)("a %s that cannot be fetched leaves the manifest of its name alone", async kind => {
      const spec = at();

      const { stdout, stderr, exitCode } = await autoInstall(
        spec.registry,
        spec.heal,
        { name: "foo", dependencies: { b: spec[kind]("gone") } },
        `const results = [attempt("b@3.0.0")];
         await turn();
         results.push(attempt("b"));
         await turn();
         results.push(attempt("b@9.9.9"));
         console.log(JSON.stringify(results));`,
      );

      expect({ stdout, stderr }).toEqual({
        stdout: JSON.stringify(["3.0.0", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]),
        stderr: "",
      });
      expect(spec.requested("b")).toBe(1);
      expect(exitCode).toBe(0);
    });

    // `a@3.0.0` can share the folder of the project's alias `a`, and the manifest of the alias says whether it does.
    // A turn looks a bare name up twice and a subpath once: only the subpath shows where the first lookup put the miss.
    describe.each(["a@3.0.0", "a@3.0.0/package.json"])("the project has an alias for %s", specifier => {
      const script = `const results = [attempt(${JSON.stringify(specifier)})];
         await turn(); // the registry answers from here on
         results.push(attempt(${JSON.stringify(specifier)}));
         console.log(JSON.stringify(results));`;

      test.concurrent("asks again for the manifest of an alias that the import can follow", async () => {
        const spec = at();
        spec.fail("b");

        const { stdout, stderr, exitCode } = await autoInstall(
          spec.registry,
          spec.heal,
          { name: "foo", dependencies: { a: "npm:b@^3.0.0" } },
          script,
        );

        expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify(["MODULE_NOT_FOUND", "3.0.0"]), stderr: "" });
        // one lookup that failed and was tried again once, and the one after that
        expect({ b: spec.requested("b"), a: spec.requested("a") }).toEqual({ b: 3, a: 0 });
        expect(exitCode).toBe(0);
      });

      // The `c` of the alias is 3.5.0, so the import is the `a` of the registry, whose manifest is the one that fails.
      test.concurrent("asks again for the manifest of its own name when it cannot follow the alias", async () => {
        const spec = at();
        spec.fail("a");

        const { stdout, stderr, exitCode } = await autoInstall(
          spec.registry,
          spec.heal,
          { name: "foo", dependencies: { a: "npm:c@^3.0.0" } },
          script,
        );

        expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify(["MODULE_NOT_FOUND", "3.0.0"]), stderr: "" });
        expect({ c: spec.requested("c"), a: spec.requested("a") }).toEqual({ c: 1, a: 3 });
        expect(exitCode).toBe(0);
      });
    });

    // The manifest that the registry sent has no 2.0.0. The next import asks again, and 2.0.0 is out by then.
    test.concurrent("asks again for a manifest that did not have the version", async () => {
      let versions = ["1.0.0"];
      let manifests = 0;
      const json = (version: string) => ({ name: "late", version, main: "package.json" });
      using registry = Bun.serve({
        port: 0,
        async fetch(req) {
          const { pathname, origin } = new URL(req.url);
          if (pathname === "/publish") return ((versions = ["1.0.0", "2.0.0"]), new Response("ok"));
          const tarball = /^\/late-(.+)\.tgz$/.exec(pathname);
          if (tarball) {
            return new Response(await githubTarball("package", { "package.json": JSON.stringify(json(tarball[1])) }));
          }
          manifests++;
          const dist = (version: string) => ({ tarball: `${origin}/late-${version}.tgz` });
          return Response.json({
            name: "late",
            "dist-tags": { latest: versions.at(-1) },
            versions: Object.fromEntries(versions.map(v => [v, { ...json(v), dist: dist(v) }])),
          });
        },
      });

      const { stdout, stderr, exitCode } = await autoInstall(
        { BUN_CONFIG_REGISTRY: registry.url.href },
        `${registry.url.href}publish`,
        { name: "foo" },
        `const results = [attempt("late@2.0.0")];
         await turn(); // publishes 2.0.0
         results.push(attempt("late@2.0.0"));
         console.log(JSON.stringify(results));`,
      );

      expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify(["MODULE_NOT_FOUND", "2.0.0"]), stderr: "" });
      expect(manifests).toBe(2);
      expect(exitCode).toBe(0);
    });
  });

  test.concurrent("a github: dependency that cannot be fetched is named by its key", async () => {
    const dir = await project({ name: "foo", dependencies: { b: "github:o/r" } });

    const { stderr, exitCode } = await bunWith({ GITHUB_API_URL: "ftp://127.0.0.1:1" }, dir, "install");

    expect(stderr).toContain("note: error occurred while resolving b\n");
    expect(exitCode).toBe(1);
  });

  type Spec = ReturnType<typeof at>;
  // `file` is a tarball in the project, and the registry of these tests has `b@3.0.0`.
  type Source = Kind | "github" | "registry" | "file";
  const sources: Source[] = [...kinds, "github", "registry", "file"];

  /** How a package.json names `id` as a `kind`. */
  const specifier = (spec: Spec, kind: Source, id: Id) =>
    kind === "registry"
      ? id === "original"
        ? "^3.0.0"
        : "3.0.0"
      : kind === "file"
        ? `file:./${id}.tgz`
        : spec[kind](id);

  /** The entry that bun.lock has for `id` as a `kind`: `<name>@<resolution>`, what the package declares, and the rest. */
  function entry(spec: Spec, kind: Source, id: Id, info: object = {}): unknown[] {
    const name = packages[id].name;
    switch (kind) {
      case "tarball":
        return [`${name}@${spec.tarball(id)}`, info];
      case "file":
        return [`${name}@./${id}.tgz`, info];
      case "git":
        return [`${name}@${spec.git(id).replace("#v1", `#${commits[id]}`)}`, info, commits[id]];
      case "github": {
        // The last field is the root folder of the archive that the server has for the repository.
        const repository = spec.github(id).slice("github:".length, -"#v1".length);
        return [`${name}@${spec.github(id)}`, info, `${repository.replace("/", "-")}-v1`];
      }
      case "registry":
        // The manifest of this registry has no integrity, which bun.lock allows up to version 1.
        return ["b@3.0.0", spec.tarball("registry-b"), info, ""];
    }
  }

  /** A bun.lock for `packageJson` that has its rules, with `packages` as its entries. */
  function lockWith(
    { name: _, workspaces: __, overrides, resolutions, ...groups }: Record<string, any>,
    packages: Record<string, unknown[]>,
    { version = 2, rules = overrides ?? resolutions, members = {} } = {},
  ) {
    const workspaces = { "": { name: "foo", ...groups }, ...members };
    if (Object.values(packages).some(entry => entry[3] === "")) version = 1;
    return JSON.stringify(
      { lockfileVersion: version, configVersion: 1, workspaces, overrides: rules, packages },
      null,
      2,
    );
  }

  /** What a frozen install prints for an entry that its rule does not allow. */
  const refusal = (dir: string, has: unknown, field: string, wants: string) =>
    normalizeBunSnapshot(
      `error: lockfile had changes, but lockfile is frozen\nnote: bun.lock has ${has}, ${field} in package.json wants ${wants}\nnote: try re-running without --frozen-lockfile and commit the updated lockfile`,
      dir,
    );

  /** A frozen install of `dir` names `has` and `wants`, and leaves bun.lock as it is. */
  async function expectRefusal(
    dir: string,
    has: unknown,
    wants: string,
    { field = "overrides", env = {}, args = [] as string[] } = {},
  ) {
    const lock = await lockfile(dir);
    const { stderr, exitCode } = await bunWith(env, dir, "install", "--frozen-lockfile", ...args);
    expect(stderr).toBe(refusal(dir, has, field, wants));
    expect({ exitCode, lock: await lockfile(dir) }).toEqual({ exitCode: 1, lock });
  }

  // A version of Bun that passed over the rule saved such a bun.lock, and so does a merge that takes the rule of one
  // branch and the entry of the other. The entry is the package that `b` is declared as, and the rule names the fork.
  describe("bun.lock has the package that a rule replaces", () => {
    // A pair is here if bun.lock alone says that the entry is not what the rule names.
    const decided: Partial<Record<Source, Source[]>> = {
      tarball: ["tarball", "file"],
      git: ["registry", "file"],
      github: ["github", "registry", "file"],
      registry: ["tarball", "git", "github", "file"],
      file: ["tarball", "git", "github", "registry", "file"],
    };
    const pairs = sources.flatMap(from =>
      (decided[from] ?? []).filter(to => sources.includes(to)).map(to => ({ from, to })),
    );

    test.concurrent.each(pairs)("a $from, and the rule names a $to: a frozen install fails", async ({ from, to }) => {
      const spec = at();
      const [declared, rule] = [specifier(spec, from, "original"), specifier(spec, to, "fork-bee")];
      const packageJson = { name: "foo", dependencies: { b: declared }, overrides: { b: rule } };
      const has = entry(spec, from, "original");
      const dir = await project(packageJson, { "bun.lock": lockWith(packageJson, { b: has }) });

      await expectRefusal(dir, has[0], rule, { env: spec.registry });
    });

    // Each kind is the entry of one pair, and the fork of another.
    test.concurrent.each(
      (
        [
          { from: "registry", to: "tarball" },
          { from: "tarball", to: "file" },
          { from: "file", to: "git" },
          { from: "git", to: "registry" },
          { from: "github", to: "github" },
        ] as const
      ).filter(({ from, to }) => sources.includes(from) && sources.includes(to)),
    )("a $from, and the rule names a $to: bun install resolves b again", async ({ from, to }) => {
      const spec = at();
      const [declared, rule] = [specifier(spec, from, "original"), specifier(spec, to, "fork-bee")];
      const packageJson = { name: "foo", dependencies: { b: declared }, overrides: { b: rule } };
      // The registry of these tests has no integrity for `b`, so the bun.lock that gets it is of version 1.
      const stale = lockWith(packageJson, { b: entry(spec, from, "original") }, { version: to === "registry" ? 1 : 2 });
      const dir = await project(packageJson, { "bun.lock": stale });
      if (to === "file") {
        const fork = await githubTarball("package", { "package.json": JSON.stringify(packages["fork-bee"]) });
        await write(join(dir, "fork-bee.tgz"), fork);
      }

      const { stderr, exitCode } = await bunWith(spec.registry, dir, "install");

      expect(stderr).toBe("Saved lockfile");
      expect({
        installed: installed(dir, "b"),
        locked: await locked(dir, "b"),
        // The package that the rule replaces is not asked for.
        replaced: fetched(spec, dir),
        exitCode,
      }).toEqual({
        installed: to === "registry" ? "b@3.0.0" : "bee@2.0.0",
        locked: entry(spec, to, "fork-bee")[0],
        replaced: { original: 0, cloned: to === "git" ? 1 : 0 },
        exitCode: 0,
      });
    });

    type Declared = {
      where: string;
      /** package.json without its name, for `b` declared as `declared` and a rule that names `rule`. */
      pkg: (spec: Spec, declared: string, rule: string) => Record<string, any>;
      /** The entries of bun.lock next to the one for `b`. */
      others?: (spec: Spec, declared: string) => Record<string, unknown[]>;
      lock?: (rule: string, declared: string) => Parameters<typeof lockWith>[2];
      files?: (declared: string) => Record<string, string>;
      field?: "resolutions";
    };
    const a = (spec: Spec, group: string, declared: string, id = "a-tarball") => ({
      a: [`a@${spec.tarball(id)}`, { [group]: { b: declared } }],
    });

    // The other places that declare `b`, and the other ways to write the rule. `b` is a tarball, and so is the fork.
    test.concurrent.each<Declared>([
      {
        where: "a dependency of the package a",
        pkg: (spec, _, rule) => ({ dependencies: { a: spec.tarball("a-tarball") }, overrides: { b: rule } }),
        others: (spec, declared) => a(spec, "dependencies", declared),
      },
      {
        where: "a peer of the package a",
        pkg: (spec, _, rule) => ({ dependencies: { a: spec.tarball("a-peer-tarball") }, overrides: { b: rule } }),
        others: (spec, declared) => a(spec, "peerDependencies", declared, "a-peer-tarball"),
      },
      {
        where: "a dependency of the package a, under a rule for a alone",
        pkg: (spec, _, rule) => ({ dependencies: { a: spec.tarball("a-tarball") }, overrides: { a: { b: rule } } }),
        others: (spec, declared) => a(spec, "dependencies", declared),
        lock: () => ({ version: 3 }),
      },
      {
        where: "an optional dependency of the project",
        pkg: (_, declared, rule) => ({ optionalDependencies: { b: declared }, overrides: { b: rule } }),
      },
      {
        where: "a dependency of a workspace",
        pkg: (_, __, rule) => ({ workspaces: ["packages/*"], overrides: { b: rule } }),
        others: () => ({ w: ["w@workspace:packages/w"] }),
        lock: (_, declared) => ({
          members: { "packages/w": { name: "w", version: "1.0.0", dependencies: { b: declared } } },
        }),
        files: declared => ({
          "packages/w/package.json": JSON.stringify({ name: "w", version: "1.0.0", dependencies: { b: declared } }),
        }),
      },
      {
        where: "a dependency of the project, under resolutions",
        pkg: (_, declared, rule) => ({ dependencies: { b: declared }, resolutions: { b: rule } }),
        field: "resolutions",
      },
      {
        // yarn reads a key with a range in another way than Bun, and bun.lock can follow either reading.
        where: "a dependency of the project, under resolutions that have a range in a key",
        pkg: (_, declared, rule) => ({
          dependencies: { b: declared },
          resolutions: { b: rule, "no-deps@^1.0.0": "1.0.0" },
        }),
        lock: rule => ({ version: 3, rules: { b: rule, "no-deps@^1.0.0": { ".": "1.0.0" } } }),
        field: "resolutions",
      },
    ])("$where: a frozen install fails", async ({ pkg, others, lock, files, field }) => {
      const spec = at();
      const [declared, rule] = [spec.tarball("original"), spec.tarball("fork-bee")];
      const packageJson = { name: "foo", ...pkg(spec, declared, rule) };
      const has = entry(spec, "tarball", "original");
      const stale = lockWith(packageJson, { ...others?.(spec, declared), b: has }, lock?.(rule, declared));
      const dir = await project(packageJson, { "bun.lock": stale, ...files?.(declared) });

      await expectRefusal(dir, has[0], rule, { field });
    });

    // A peer takes the package that is installed. Here nothing else holds the package that the rule replaces.
    test.concurrent("a peer of the package a: bun install resolves it again", async () => {
      const spec = at();
      const [declared, rule] = [spec.tarball("original"), spec.tarball("fork-bee")];
      const packageJson = { name: "foo", dependencies: { a: spec.tarball("a-peer-tarball") }, overrides: { b: rule } };
      const packages = {
        ...a(spec, "peerDependencies", declared, "a-peer-tarball"),
        b: entry(spec, "tarball", "original"),
      };
      const dir = await project(packageJson, { "bun.lock": lockWith(packageJson, packages) });

      const { stderr, exitCode } = await bun(dir, "install");

      expect(stderr).toBe("Saved lockfile");
      expect({ a: loadedByA(dir), replaced: spec.requested("original"), exitCode }).toEqual({
        a: "bee@2.0.0",
        replaced: 0,
        exitCode: 0,
      });
    });

    const commit = "300f5f2ef713fa63cf319bb9df01813cfaf8e986";

    // hosted-git-info knows these hosts, so two URLs say whether they are one repository. Nothing is installed, so
    // nothing is asked of them.
    test.concurrent.each([
      { has: `git+ssh://git@github.com/org/b.git#${commit}`, rule: "git+ssh://git@github.com/org/fork.git#main" },
      { has: `git+ssh://git@github.com/org/b.git#${commit}`, rule: "github:org/fork" },
      { has: "github:org/b#300f5f2", rule: "git+ssh://git@github.com/org/fork.git#main" },
      { has: `git+ssh://git@gitlab.com/org/b.git#${commit}`, rule: "gitlab:org/fork" },
      { has: `git+ssh://git@github.com:org/b.git#${commit}`, rule: "git@bitbucket.org:org/b.git" },
    ])("$has, and the rule names $rule: a frozen install fails", async ({ has, rule }) => {
      const declared = has.slice(0, has.indexOf("#"));
      const packageJson = { name: "foo", dependencies: { b: declared }, overrides: { b: rule } };
      const resolved = has.startsWith("github:") ? "org-b-300f5f2" : commit;
      const dir = await project(packageJson, { "bun.lock": lockWith(packageJson, { b: [`b@${has}`, {}, resolved] }) });

      await expectRefusal(dir, `b@${has}`, rule, { args: ["--lockfile-only"] });
    });

    /** Adds the rule to package.json and to bun.lock, which keeps the packages that it has. */
    async function recordRule(dir: string, rule: string) {
      await editPackageJson(dir, pkg => (pkg.overrides = { b: rule }));
      const section = `  "overrides": {\n    "b": ${JSON.stringify(rule)},\n  },\n`;
      await write(join(dir, "bun.lock"), (await lockfile(dir)).replace('  "packages": {', `${section}  "packages": {`));
    }

    // `bun update` and `--force` download a tarball again, and the project's `b` is the fork before the check runs.
    // The package `a` is in bun.lock with the integrity of its tarball, so its `b` stays what it was. It then takes
    // the download of the fork, which is done. The lockfile was cleaned in between, which numbers the packages anew.
    describe.each(["update", "install --force"])("bun %s", command => {
      test.concurrent("the package a gets the tarball that the project's b was downloaded from", async () => {
        const spec = at();
        const dir = await project({
          name: "foo",
          dependencies: { a: spec.tarball("a-tarball"), b: spec.tarball("original") },
        });
        expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");
        await recordRule(dir, spec.tarball("fork-bee"));

        const { exitCode } = await bun(dir, ...command.split(" "));

        expect({
          project: installed(dir, "b"),
          a: loadedByA(dir),
          locked: await locked(dir, "b"),
          nested: await locked(dir, "a/b"),
          // once, by the install before the rule
          replaced: spec.requested("original"),
          exitCode,
        }).toEqual({
          project: "bee@2.0.0",
          a: "bee@2.0.0",
          locked: entry(spec, "tarball", "fork-bee")[0],
          nested: undefined,
          replaced: 1,
          exitCode: 0,
        });
      });
    });

    // The install drops `c`, so the packages after it in bun.lock have another number when the check runs.
    test.concurrent("bun update after a dependency was taken out of package.json", async () => {
      const spec = at();
      const dependencies = { a: spec.tarball("a-tarball"), b: spec.tarball("original") };
      const dir = await project({ name: "foo", dependencies: { ...dependencies, c: spec.tarball("registry-c") } });
      expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");
      await editPackageJson(dir, pkg => (pkg.dependencies = dependencies));
      await recordRule(dir, spec.tarball("fork-bee"));

      const { exitCode } = await bun(dir, "update");

      expect({ project: installed(dir, "b"), a: loadedByA(dir), c: installed(dir, "c"), exitCode }).toEqual({
        project: "bee@2.0.0",
        a: "bee@2.0.0",
        c: "nothing",
        exitCode: 0,
      });
    });

    // The same for a repository that is checked out: `bun update` resolves the project's `bee` again, and the tarball
    // package `z` has the registry's `b`, which the rule replaces with the repository of `bee`.
    test.concurrent.skipIf(!kinds.includes("git"))(
      "bun update: the package z gets the repository that the project's bee was checked out from",
      async () => {
        const spec = at();
        const dir = await project({
          name: "foo",
          dependencies: { z: spec.tarball("z-tarball"), bee: spec.git("fork-bee") },
        });
        expect((await bunWith(spec.registry, dir, "install")).stderr).toBe("Saved lockfile");
        expect(installed(dir, "b")).toBe("b@3.0.0");
        await recordRule(dir, spec.git("fork-bee"));

        const { exitCode } = await bunWith(spec.registry, dir, "update");

        expect({ b: installed(dir, "b"), locked: await locked(dir, "b"), cloned: cloned(dir), exitCode }).toEqual({
          b: "bee@2.0.0",
          locked: entry(spec, "git", "fork-bee")[0],
          cloned: 1,
          exitCode: 0,
        });
      },
    );
  });

  // Another package manager writes a repository, a path and a registry package in its own way, and `bun pm migrate`
  // keeps much of that. An older Bun wrote a repository in another way than this one. Each bun.lock here is what one
  // of them saved for a rule that was followed, so a frozen install says nothing.
  describe("bun.lock has the package that a rule names", () => {
    const commit = "300f5f2ef713fa63cf319bb9df01813cfaf8e986";
    const integrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;
    const git = (repository: string) => [`b@git+${repository}#${commit}`, {}, commit];

    async function expectInStep(packageJson: object, lock: string) {
      const dir = await project(packageJson, { "bun.lock": lock });
      const { stderr, exitCode } = await bun(dir, "install", "--frozen-lockfile", "--lockfile-only");
      expect({ stderr, exitCode, lock: await lockfile(dir) }).toEqual({ stderr: "", exitCode: 0, lock });
    }

    test.concurrent.each<{ title: string; declared?: string; rule: string; has: unknown[] }>([
      {
        title: "npm and pnpm: the GitHub package that the dependent declares, for a rule that is a git URL",
        declared: "github:org/b#v1",
        rule: `git+ssh://git@github.com/org/b.git#${commit}`,
        has: [`b@github:org/b#${commit}`, {}, commit],
      },
      {
        title: "npm: the git URL that the dependent declares, for a rule that is a GitHub repository",
        declared: "git+ssh://git@github.com/org/b.git#v1",
        rule: `github:org/b#${commit}`,
        has: git("ssh://git@github.com/org/b.git"),
      },
      {
        title: "npm: the ssh URL of GitLab, for a rule that is its https URL",
        rule: "git+https://gitlab.com/org/b.git#main",
        has: git("ssh://git@gitlab.com/org/b.git"),
      },
      {
        title: "yarn berry: an https URL of GitHub, for a rule that is a GitHub repository",
        rule: `github:org/b#${commit}`,
        has: git("https://github.com/org/b.git"),
      },
      {
        title: "yarn: the tarball that GitHub has for a commit, for a rule that is a GitHub repository",
        rule: "org/b#v1",
        has: [`b@https://codeload.github.com/org/b/tar.gz/${commit}`, {}],
      },
      {
        title: "pnpm: a GitHub package, for a rule that is the tarball that GitHub has for a commit",
        rule: `https://codeload.github.com/org/b/tar.gz/${commit}`,
        has: [`b@github:org/b#${commit}`, {}, commit],
      },
      {
        title: "a GitHub package whose owner is in another case than in the rule",
        rule: "github:Org/B#v1",
        has: ["b@github:org/b#300f5f2", {}, "org-b-300f5f2"],
      },
      {
        title: "a repository on a host that hosted-git-info does not know, for a rule that is another URL of it",
        rule: "git+https://git.example.com/org/b.git#main",
        has: git("ssh://git@git.example.com/org/b.git"),
      },
      {
        title: "npm: a registry package with the URL of the rule",
        declared: "^1.0.0",
        rule: "https://example.com/b-1.0.1.tgz",
        has: ["b@1.0.1", "https://example.com/b-1.0.1.tgz", {}, integrity],
      },
      {
        title: "npm: a registry package without its URL, for a rule that is a tarball of the default registry",
        declared: "^1.0.0",
        rule: "https://registry.npmjs.org/b/-/b-1.0.1.tgz",
        has: ["b@1.0.1", "", {}, integrity],
      },
      {
        title: "npm: the tarball of the registry, for a rule that is a version and a dependent that declares a tarball",
        declared: "https://example.com/b-1.0.0.tgz",
        rule: "1.0.0",
        has: ["b@https://registry.npmjs.org/b/-/b-1.0.0.tgz", {}, integrity],
      },
      {
        title: "yarn: a tarball without the checksum that yarn.lock has after #, for a rule that has a # of its own",
        rule: "https://example.com/b-1.0.1.tgz#readme",
        has: ["b@https://example.com/b-1.0.1.tgz", {}, integrity],
      },
      {
        title: "npm: a path without ./, for a rule that is a tarball in the project",
        declared: "^1.0.0",
        rule: "file:./vendor/b-1.0.0.tgz",
        has: ["b@vendor/b-1.0.0.tgz", {}, integrity],
      },
      {
        title: "Bun: ssh:// before a host:path",
        rule: "git@example.com:org/b.git#v1",
        has: git("ssh://git@example.com:org/b.git"),
      },
      { title: "Bun: the URL of a shorthand", rule: "gitlab:org/b#v1", has: git("ssh://git@gitlab.com/org/b") },
      { title: "an older Bun: ssh:// before a shorthand", rule: "gitlab:org/b#v1", has: git("ssh://gitlab:org/b") },
    ])("$title", async ({ declared = "github:org/original", rule, has }) => {
      const packageJson = { name: "foo", dependencies: { b: declared }, overrides: { b: rule } };
      await expectInStep(packageJson, lockWith(packageJson, { b: has }));
    });

    // npm gives a range the tarball that another dependency asks for, if the version in it is in the range. This is
    // what `bun pm migrate` writes for npm's package-lock.json: `a` declares `b@^0.9.0`, and the tarball is `b@1.0.0`.
    test.concurrent("npm: the tarball that the project declares, for a rule that is a range", async () => {
      const packageJson = {
        name: "foo",
        dependencies: { a: "file:./a-1.0.0.tgz", b: "file:./b-1.0.0.tgz" },
        overrides: { a: { b: "^1.0.0" } },
      };
      const packages = {
        a: ["a@a-1.0.0.tgz", { dependencies: { b: "^0.9.0" } }, integrity],
        b: ["b@b-1.0.0.tgz", {}, integrity],
      };
      await expectInStep(packageJson, lockWith(packageJson, packages, { version: 3 }));
    });
  });
});

// `my-alias` asks for the package `no-deps`. A rule is for the name that a dependency is declared under, so the rule
// for `no-deps` is not for an alias of a range of it. Only an alias of a tag goes by the name of its package.
test.concurrent.each([
  { alias: "npm:no-deps@^2.0.0", rule: { "no-deps": "1.0.0" }, installs: "no-deps@2.0.0" },
  { alias: "npm:no-deps@latest", rule: { "no-deps": "1.0.0" }, installs: "no-deps@1.0.0" },
  { alias: "npm:no-deps@latest", rule: { "my-alias": "npm:no-deps@1.0.0" }, installs: "no-deps@2.0.0" },
])("with the rule $rule, the alias $alias installs $installs", async ({ alias, rule, installs }) => {
  const dir = await project({ name: "foo", dependencies: { "my-alias": alias }, overrides: rule });

  const { stderr, exitCode } = await bun(dir, "install");

  expect(stderr).toBe("Saved lockfile");
  expect(nodeModulesPackages(dir)).toBe(`node_modules/my-alias/${installs}`);
  expect(exitCode).toBe(0);
  await expectLockfileStable(dir, await lockfile(dir));
});

// The rule for `no-deps` is the rule of `my-alias` also when it changes in a project that is installed.
test.concurrent.each([
  { change: "added to", before: undefined, after: { "no-deps": "1.0.0" }, installs: "no-deps@1.0.0" },
  { change: "changed in", before: { "no-deps": "1.0.0" }, after: { "no-deps": "1.0.1" }, installs: "no-deps@1.0.1" },
  { change: "removed from", before: { "no-deps": "1.0.0" }, after: undefined, installs: "no-deps@2.0.0" },
])(
  "a rule for the package of a tag alias is $change an installed project: $installs",
  async ({ before, after, installs }) => {
    const dir = await project({ name: "foo", dependencies: { "my-alias": "npm:no-deps@latest" }, overrides: before });
    expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");

    await editPackageJson(dir, pkg => (pkg.overrides = after));
    const { stderr, exitCode } = await bun(dir, "install");

    expect(stderr).toBe("Saved lockfile");
    expect(nodeModulesPackages(dir)).toBe(`node_modules/my-alias/${installs}`);
    expect(exitCode).toBe(0);
  },
);

// The lockfile check goes by that name too. This bun.lock is what a merge leaves: the rule of one branch, and the entry
// of the other.
test.concurrent("bun.lock has another version for a tag alias than the rule for its package allows", async () => {
  const dir = await project({ name: "foo", dependencies: { "my-alias": "npm:no-deps@latest" } });
  expect((await bun(dir, "install")).stderr).toBe("Saved lockfile");
  await editPackageJson(dir, pkg => (pkg.overrides = { "no-deps": "1.0.0" }));
  const rule = '  "overrides": {\n    "no-deps": "1.0.0",\n  },\n';
  await write(join(dir, "bun.lock"), (await lockfile(dir)).replace('  "packages": {', `${rule}  "packages": {`));

  const frozen = await bun(dir, "install", "--frozen-lockfile");
  expect(frozen.stderr).toBe(
    "error: lockfile had changes, but lockfile is frozen\nnote: bun.lock has no-deps@2.0.0, overrides in package.json wants 1.0.0\nnote: try re-running without --frozen-lockfile and commit the updated lockfile",
  );
  expect(frozen.exitCode).toBe(1);

  const { stderr, exitCode } = await bun(dir, "install");
  expect(stderr).toBe("Saved lockfile");
  expect(nodeModulesPackages(dir)).toBe("node_modules/my-alias/no-deps@1.0.0");
  expect(exitCode).toBe(0);
});

// The name that `bun add npm:<name>@<tag>` asks the registry for is the key of its rule before the dependency has one.
test.concurrent("bun add npm:no-deps@latest gets the version that the rule for no-deps names", async () => {
  const dir = await project({ name: "foo", overrides: { "no-deps": "1.0.0" } });

  const { stderr, exitCode } = await bun(dir, "add", "npm:no-deps@latest");

  expect(stderr).toBe("Saved lockfile");
  expect(nodeModulesPackages(dir)).toBe("node_modules/no-deps/no-deps@1.0.0");
  expect(exitCode).toBe(0);
});
