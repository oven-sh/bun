import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

// Bun 1.4 and older read "resolutions" only when package.json had no "overrides". Its bun.lock looks exactly like one
// saved before "resolutions" was added, so a frozen install fails on both: `bun install` would rewrite either.
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
  ])("$title", ({ rules }) => {
    test.concurrent.each([...frozen, "install"])("bun %s says nothing", async command => {
      const { dir, lock } = await upgraded(rules);
      const { stderr, exitCode } = await bun(dir, ...command.split(" "));
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(await lockfile(dir)).toBe(lock);
    });
  });

  describe.each([
    {
      title: "a flat rule in resolutions",
      rules: { overrides: { "no-deps": "1.0.0" }, resolutions: { "a-dep": "1.0.2" } },
      overridden: true,
      updated: "a-dep@1.0.2, no-deps@1.0.0",
    },
    {
      title: "a scoped rule in resolutions",
      rules: { overrides: { "no-deps": "1.0.0" }, resolutions: { "one-dep/no-deps": "2.0.0" } },
      overridden: true,
      updated: "a-dep@1.0.10, no-deps@2.0.0",
    },
    {
      title: "an empty overrides",
      rules: { overrides: {}, resolutions: { "no-deps": "1.0.0" } },
      overridden: false,
      updated: "a-dep@1.0.10, no-deps@1.0.0",
    },
  ])("overrides and resolutions, $title", ({ rules, overridden, updated }) => {
    const installed = async (dir: string) =>
      (
        await Promise.all(
          ["a-dep", "no-deps"].map(async name => {
            const { version } = await file(join(dir, "node_modules", name, "package.json")).json();
            return `${name}@${version}`;
          }),
        )
      ).join(", ");

    test.concurrent.each(frozen)("bun %s fails until bun.lock records both fields", async command => {
      const { dir, lock } = await upgraded(rules, overridden);
      const { stderr, exitCode } = await bun(dir, ...command.split(" "));
      expect(stderr).toBe(changed("overrides or resolutions"));
      expect(await lockfile(dir)).toBe(lock);
      expect(exitCode).toBe(1);

      expect((await bun(dir, "install")).exitCode).toBe(0);
      expect(await installed(dir)).toBe(updated);
      const after = await bun(dir, ...command.split(" "));
      expect(after.stderr).toBe("");
      expect(after.exitCode).toBe(0);
    });

    test.concurrent("bun install records both fields, once", async () => {
      const { dir, lock } = await upgraded(rules, overridden);
      const { stderr, exitCode } = await bun(dir, "install");
      expect(stderr).toBe("Saved lockfile");
      expect(await installed(dir)).toBe(updated);
      expect(exitCode).toBe(0);
      const saved = await lockfile(dir);
      expect(saved).not.toBe(lock);
      await expectLockfileStable(dir, saved);
    });
  });

  const both = { overrides: { "no-deps": "1.0.0" }, resolutions: { "a-dep": "1.0.2" } };

  test.concurrent("an edit of overrides still fails a frozen install", async () => {
    const { dir, lock } = await upgraded({ ...both, overrides: { "no-deps": "1.0.1" } });
    const { stderr, exitCode } = await bun(dir, "install", "--frozen-lockfile");
    expect(stderr).toBe(changed("overrides or resolutions"));
    expect(exitCode).toBe(1);
    expect(await lockfile(dir)).toBe(lock);
  });

  test.concurrent("resolutions added next to overrides that this version recorded fail a frozen install", async () => {
    const dir = await project({ name: "foo", dependencies, overrides: both.overrides });
    expect((await bun(dir, "install")).exitCode).toBe(0);
    const lock = await lockfile(dir);
    await editPackageJson(dir, pkg => void (pkg.resolutions = both.resolutions));
    for (const command of frozen) {
      const { stderr, exitCode } = await bun(dir, ...command.split(" "));
      expect({ command, stderr }).toEqual({ command, stderr: changed("overrides or resolutions") });
      expect(await lockfile(dir)).toBe(lock);
      expect(exitCode).toBe(1);
    }
  });

  test.concurrent("once both fields are recorded, an edit of resolutions fails a frozen install", async () => {
    const { dir } = await upgraded(both);
    expect((await bun(dir, "install")).exitCode).toBe(0);
    for (const resolutions of [{ "a-dep": "1.0.3" }, { "a-dep": "1.0.2", "one-dep": "1.0.0" }, {}]) {
      await editPackageJson(dir, pkg => void (pkg.resolutions = resolutions));
      const { stderr, exitCode } = await bun(dir, "install", "--frozen-lockfile");
      expect({ resolutions, stderr }).toEqual({ resolutions, stderr: changed("overrides or resolutions") });
      expect(exitCode).toBe(1);
    }
  });
});
