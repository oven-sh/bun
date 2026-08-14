import { file, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, bunExe, runBunInstall } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

const PKG1 = JSON.stringify({ name: "pkg1", version: "1.0.0" });

async function createDir(
  root: Record<string, unknown> | string,
  pkg1: Record<string, unknown> | string = PKG1,
  extraFiles: Record<string, string> = {},
) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted", saveTextLockfile: true },
    files: {
      "package.json": typeof root === "string" ? root : JSON.stringify(root),
      "packages/pkg1/package.json": typeof pkg1 === "string" ? pkg1 : JSON.stringify(pkg1),
      ...extraFiles,
    },
  });

  const rootPath = join(packageDir, "package.json");
  const pkg1Path = join(packageDir, "packages", "pkg1", "package.json");
  const pkg2Path = join(packageDir, "packages", "pkg2", "package.json");

  return {
    packageDir,
    pkg1Dir: join(packageDir, "packages", "pkg1"),
    pkg2Dir: join(packageDir, "packages", "pkg2"),
    rootPath,
    pkg1Path,
    root: () => file(rootPath).json(),
    pkg1: () => file(pkg1Path).json(),
    pkg2: () => file(pkg2Path).json(),
    rootText: () => file(rootPath).text(),
    pkg1Text: () => file(pkg1Path).text(),
    pkg2Text: () => file(pkg2Path).text(),
    lockText: () => file(join(packageDir, "bun.lock")).text(),
    lockExists: () => file(join(packageDir, "bun.lock")).exists(),
    lock: async () => Bun.JSONC.parse(await file(join(packageDir, "bun.lock")).text()) as any,
    installed: (name: string) => file(join(packageDir, "node_modules", name, "package.json")).json(),
    installedExists: (name: string) => file(join(packageDir, "node_modules", name, "package.json")).exists(),
  };
}

const PKG2 = JSON.stringify({ name: "pkg2", version: "1.0.0" });
const withPkg2 = (pkg2: Record<string, unknown> | string = PKG2) => ({
  "packages/pkg2/package.json": typeof pkg2 === "string" ? pkg2 : JSON.stringify(pkg2),
});

async function run(cwd: string, args: string[], env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function runAdd(cwd: string, ...args: string[]) {
  return run(cwd, ["add", ...args]);
}

function expectOk({ stderr, exitCode }: { stderr: string; exitCode: number }) {
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("panic:");
  expect(exitCode).toBe(0);
}

const workspacesObject = (catalogs: Record<string, unknown> = {}) => ({
  name: "root",
  workspaces: { packages: ["packages/*"], ...catalogs },
});

describe.concurrent("bun add --catalog", () => {
  test("default catalog from a workspace member", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

    expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });
    expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");

    const lock = await dir.lock();
    expect(lock.workspaces["packages/pkg1"].dependencies).toEqual({ "no-deps": "catalog:" });
    expect(lock.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(lock.packages["no-deps"][0]).toBe("no-deps@2.0.0");

    const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
    expect(err).not.toContain("Saved lockfile");
  });

  test("named catalog creates the catalogs object", async () => {
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));

    expectOk(await runAdd(dir.pkg1Dir, "a-dep", "--catalog=testing"));

    expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:testing" });
    expect((await dir.root()).workspaces).toEqual({
      packages: ["packages/*"],
      catalog: { "no-deps": "1.0.0" },
      catalogs: { testing: { "a-dep": "^1.0.10" } },
    });
    expect((await dir.installed("a-dep")).version).toBe("1.0.10");

    const lock = await dir.lock();
    expect(lock.workspaces["packages/pkg1"].dependencies).toEqual({ "a-dep": "catalog:testing" });
    expect(lock.catalogs).toEqual({ testing: { "a-dep": "^1.0.10" } });
  });

  describe("placement when no catalog is defined yet", () => {
    test("workspaces object gets workspaces.catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

      expect(await dir.root()).toEqual({
        name: "root",
        workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^2.0.0" } },
      });
      expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });
    });

    test("workspaces array gets a top-level catalog", async () => {
      const dir = await createDir({ name: "root", workspaces: ["packages/*"] });

      expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

      expect(await dir.root()).toEqual({
        name: "root",
        workspaces: ["packages/*"],
        catalog: { "no-deps": "^2.0.0" },
      });
      expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });
    });
  });

  describe("existing top-level placement is respected", () => {
    const topLevel = { name: "root", catalog: { "no-deps": "1.0.0" }, workspaces: ["packages/*"] };

    test("default catalog", async () => {
      const dir = await createDir(topLevel);

      expectOk(await runAdd(dir.pkg1Dir, "a-dep", "--catalog"));

      const root = await dir.root();
      expect(root).toEqual({
        name: "root",
        catalog: { "a-dep": "^1.0.10", "no-deps": "1.0.0" },
        workspaces: ["packages/*"],
      });
      expect(Object.keys(root.catalog)).toEqual(["a-dep", "no-deps"]);
      expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:" });
    });

    test("named catalog", async () => {
      const dir = await createDir(topLevel);

      expectOk(await runAdd(dir.pkg1Dir, "a-dep", "--catalog=x"));

      expect(await dir.root()).toEqual({
        name: "root",
        catalog: { "no-deps": "1.0.0" },
        catalogs: { x: { "a-dep": "^1.0.10" } },
        workspaces: ["packages/*"],
      });
      expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:x" });
    });
  });

  describe("catalog literal", () => {
    for (const { args, entry, installed } of [
      { args: ["no-deps@1.0.0", "--catalog"], entry: "1.0.0", installed: "1.0.0" },
      { args: ["no-deps@^1.0.0", "--catalog"], entry: "^1.0.0", installed: "1.1.0" },
      { args: ["no-deps", "--catalog", "--exact"], entry: "2.0.0", installed: "2.0.0" },
    ]) {
      test(`bun add ${args.join(" ")} writes ${JSON.stringify(entry)}`, async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));

        expectOk(await runAdd(dir.pkg1Dir, ...args));

        expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });
        expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": entry });
        expect((await dir.installed("no-deps")).version).toBe(installed);
        expect((await dir.lock()).catalog).toEqual({ "no-deps": entry });
      });
    }
  });

  test("refreshes an existing catalog entry", async () => {
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), {
      name: "pkg1",
      version: "1.0.0",
      dependencies: { "no-deps": "catalog:" },
    });

    await runBunInstall(bunEnv, dir.packageDir);
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

    expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });

    const lockText = await dir.lockText();
    expect(lockText).not.toContain("no-deps@1.1.0");
    expect(lockText).toContain("no-deps@2.0.0");
    expect((await dir.lock()).catalog).toEqual({ "no-deps": "^2.0.0" });
  });

  test("run from the workspace root", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await runAdd(dir.packageDir, "no-deps", "--catalog"));

    expect(await dir.root()).toEqual({
      name: "root",
      dependencies: { "no-deps": "catalog:" },
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^2.0.0" } },
    });
    expect(await dir.pkg1Text()).toBe(PKG1);
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");

    const lock = await dir.lock();
    expect(lock.workspaces[""].dependencies).toEqual({ "no-deps": "catalog:" });
    expect(lock.catalog).toEqual({ "no-deps": "^2.0.0" });

    const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
    expect(err).not.toContain("Saved lockfile");
  });

  test("bun install <pkg> --catalog --dev", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await run(dir.pkg1Dir, ["install", "no-deps", "--catalog", "--dev"]));

    const pkg1 = await dir.pkg1();
    expect(pkg1.devDependencies).toEqual({ "no-deps": "catalog:" });
    expect(pkg1.dependencies).toBeUndefined();
    expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
  });

  test("several packages into a named catalog", async () => {
    const dir = await createDir(workspacesObject());

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "a-dep", "--catalog=libs"));

    expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:libs", "no-deps": "catalog:libs" });
    const root = await dir.root();
    expect(root.workspaces.catalogs.libs).toEqual({ "a-dep": "^1.0.10", "no-deps": "^2.0.0" });
    expect(Object.keys(root.workspaces.catalogs.libs)).toEqual(["a-dep", "no-deps"]);
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    expect((await dir.installed("a-dep")).version).toBe("1.0.10");
    expect((await dir.lock()).catalogs).toEqual({ libs: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } });
  });

  for (const from of ["member", "root"] as const) {
    test(`--dry-run writes nothing (from ${from})`, async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      const { stderr, exitCode } = await runAdd(cwd, "no-deps", "--catalog", "--dry-run");

      expect(stderr).not.toContain("error:");
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await file(join(dir.packageDir, "bun.lock")).exists()).toBeFalse();
      expect(exitCode).toBe(0);
    });
  }

  describe("only the dependency group plain add edits is rewritten", () => {
    test("name in devDependencies and peerDependencies, adding with --dev", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), {
        name: "pkg1",
        devDependencies: { "no-deps": "1.0.0" },
        peerDependencies: { "no-deps": ">=1" },
      });

      expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog", "--dev"));

      expect(await dir.pkg1()).toEqual({
        name: "pkg1",
        devDependencies: { "no-deps": "catalog:" },
        peerDependencies: { "no-deps": ">=1" },
      });
      expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
      expect((await dir.lock()).workspaces["packages/pkg1"]).toEqual({
        name: "pkg1",
        devDependencies: { "no-deps": "catalog:" },
        peerDependencies: { "no-deps": ">=1" },
      });
    });

    test("name only in peerDependencies, adding with --dev, matches plain add", async () => {
      const pkg1 = { name: "pkg1", peerDependencies: { "no-deps": ">=1" } };
      const [plain, catalog] = await Promise.all([
        createDir(workspacesObject({ catalog: {} }), pkg1),
        createDir(workspacesObject({ catalog: {} }), pkg1),
      ]);

      const [plainResult, catalogResult] = await Promise.all([
        runAdd(plain.pkg1Dir, "no-deps", "--dev"),
        runAdd(catalog.pkg1Dir, "no-deps", "--dev", "--catalog"),
      ]);
      expectOk(plainResult);
      expectOk(catalogResult);

      const plainPkg1 = await plain.pkg1();
      const catalogPkg1 = await catalog.pkg1();
      expect(Object.keys(catalogPkg1)).toEqual(Object.keys(plainPkg1));
      expect(plainPkg1).toEqual({ name: "pkg1", peerDependencies: { "no-deps": "^2.0.0" } });
      expect(catalogPkg1).toEqual({ name: "pkg1", peerDependencies: { "no-deps": "catalog:" } });
    });

    test("--peer", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog", "--peer"));

      expect(await dir.pkg1()).toEqual({ name: "pkg1", version: "1.0.0", peerDependencies: { "no-deps": "catalog:" } });
      expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    });
  });

  test("target already on a named catalog reference is moved to the flag's catalog", async () => {
    const dir = await createDir(workspacesObject({ catalogs: { testing: { "no-deps": "1.0.0" } } }), {
      name: "pkg1",
      dependencies: { "no-deps": "catalog:testing" },
    });
    await runBunInstall(bunEnv, dir.packageDir);
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

    expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });
    expect((await dir.root()).workspaces).toEqual({
      packages: ["packages/*"],
      catalogs: { testing: { "no-deps": "1.0.0" } },
      catalog: { "no-deps": "^2.0.0" },
    });
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");

    const lock = await dir.lock();
    expect(lock.workspaces["packages/pkg1"].dependencies).toEqual({ "no-deps": "catalog:" });
    expect(lock.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(lock.catalogs).toEqual({ testing: { "no-deps": "1.0.0" } });

    const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
    expect(err).not.toContain("Saved lockfile");
  });

  describe("literals other than a bare name", () => {
    test("alias@npm:pkg is written verbatim, like plain add", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await runAdd(dir.pkg1Dir, "foo@npm:no-deps", "--catalog"));

      expect((await dir.pkg1()).dependencies).toEqual({ foo: "catalog:" });
      expect((await dir.root()).workspaces.catalog).toEqual({ foo: "npm:no-deps" });
      expect((await dir.lock()).catalog).toEqual({ foo: "npm:no-deps" });
      expect(await dir.installed("foo")).toMatchObject({ name: "no-deps", version: "2.0.0" });

      const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
      expect(err).not.toContain("Saved lockfile");
    });

    test("alias@npm:pkg@dist-tag gets the resolved range", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await runAdd(dir.pkg1Dir, "foo@npm:no-deps@latest", "--catalog"));

      expect((await dir.pkg1()).dependencies).toEqual({ foo: "catalog:" });
      expect((await dir.root()).workspaces.catalog).toEqual({ foo: "npm:no-deps@^2.0.0" });
      expect((await dir.lock()).catalog).toEqual({ foo: "npm:no-deps@^2.0.0" });
      expect(await dir.installed("foo")).toMatchObject({ name: "no-deps", version: "2.0.0" });

      const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
      expect(err).not.toContain("Saved lockfile");
    });

    test("name@tarball-url is written verbatim, dist-tags become a range", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const tarball = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;

      expectOk(await runAdd(dir.pkg1Dir, `no-deps@${tarball}`, "dep-with-tags@pre-1", "--catalog"));

      expect((await dir.pkg1()).dependencies).toEqual({ "dep-with-tags": "catalog:", "no-deps": "catalog:" });
      const catalog = { "dep-with-tags": "^1.0.1", "no-deps": tarball };
      expect((await dir.root()).workspaces.catalog).toEqual(catalog);
      expect((await dir.lock()).catalog).toEqual(catalog);
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");
      expect((await dir.installed("dep-with-tags")).version).toBe("1.0.1");

      const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
      expect(err).not.toContain("Saved lockfile");
    });

    test("scoped package into a named catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await runAdd(dir.pkg1Dir, "@types/no-deps", "--catalog=types"));

      expect((await dir.pkg1()).dependencies).toEqual({ "@types/no-deps": "catalog:types" });
      expect((await dir.root()).workspaces.catalogs).toEqual({ types: { "@types/no-deps": "^2.0.0" } });
      expect((await dir.lock()).catalogs).toEqual({ types: { "@types/no-deps": "^2.0.0" } });
      expect((await dir.installed("@types/no-deps")).version).toBe("2.0.0");
    });
  });

  describe("workspace sibling", () => {
    test("bare name fails without writing anything", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stderr, exitCode } = await runAdd(dir.pkg1Dir, "pkg2", "--catalog");

      expect(stderr).toContain("error:");
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(exitCode).not.toBe(0);
    });

    for (const from of ["member", "root"] as const) {
      test(`name@workspace:* is rejected (from ${from})`, async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());
        const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

        const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
        const { stderr, exitCode } = await runAdd(cwd, "pkg2@workspace:*", "--catalog");

        expect(stderr).toContain('error: --catalog cannot add a workspace package, but got "pkg2@workspace:*"');
        expect(await dir.rootText()).toBe(rootBefore);
        expect(await dir.pkg1Text()).toBe(pkg1Before);
        expect(await dir.lockExists()).toBeFalse();
        expect(exitCode).toBe(1);
      });
    }

    test("name@workspace:* with --filter is rejected", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stderr, exitCode } = await runAdd(dir.packageDir, "pkg2@workspace:*", "--catalog", "--filter", "pkg1");

      expect(stderr).toContain('error: --catalog cannot add a workspace package, but got "pkg2@workspace:*"');
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(exitCode).toBe(1);
    });
  });

  describe("--filter", () => {
    test("edits only the filtered member and the root catalog", async () => {
      const pkg1 = JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), pkg1, withPkg2());
      await runBunInstall(bunEnv, dir.packageDir);

      expectOk(await runAdd(dir.packageDir, "a-dep", "--catalog", "--filter", "pkg2"));

      expect((await dir.pkg2()).dependencies).toEqual({ "a-dep": "catalog:" });
      expect(await dir.pkg1Text()).toBe(pkg1);
      const root = await dir.root();
      expect(root.dependencies).toBeUndefined();
      expect(root.workspaces.catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": "^1.0.0" });
      expect(Object.keys(root.workspaces.catalog)).toEqual(["a-dep", "no-deps"]);
      expect((await dir.lock()).catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": "^1.0.0" });
      expect((await dir.installed("a-dep")).version).toBe("1.0.10");

      expectOk(await runAdd(dir.packageDir, "a-dep", "--catalog", "--filter", "*"));

      expect((await dir.root()).dependencies).toEqual({ "a-dep": "catalog:" });
      expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:", "no-deps": "catalog:" });
      expect((await dir.pkg2()).dependencies).toEqual({ "a-dep": "catalog:" });
      expect((await dir.root()).workspaces.catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": "^1.0.0" });

      const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
      expect(err).not.toContain("Saved lockfile");
    });

    test("--only-missing skips members that already have the package", async () => {
      const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
      const dir = await createDir(workspacesObject({ catalog: {} }), pkg1, withPkg2());

      expectOk(
        await runAdd(dir.packageDir, "no-deps", "--catalog", "--only-missing", "--filter", "pkg1", "--filter", "pkg2"),
      );

      expect(await dir.pkg1()).toEqual(pkg1);
      expect((await dir.pkg2()).dependencies).toEqual({ "no-deps": "catalog:" });
      expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    });

    test("--only-missing with every member already having the package leaves the catalog empty", async () => {
      const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
      const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);

      const { stderr, exitCode } = await runAdd(
        dir.packageDir,
        "no-deps",
        "--catalog",
        "--only-missing",
        "--filter",
        "pkg1",
      );

      expect(stderr).not.toContain("panic:");
      expect(await dir.pkg1()).toEqual(pkg1);
      expect(await dir.root()).toEqual(workspacesObject({ catalog: {} }));
      expect(exitCode).toBe(0);
    });
  });

  test("--only-missing when the target already has the package leaves the catalog empty", async () => {
    const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
    const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);
    const rootBefore = await dir.rootText();

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog", "--only-missing"));

    expect(await dir.pkg1()).toEqual(pkg1);
    expect(await dir.rootText()).toBe(rootBefore);
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");
  });

  // pnpm #9647: an existing entry is moved to the version given on the command line.
  test("explicit version replaces an entry other members reference", async () => {
    const member = (name: string) => JSON.stringify({ name, dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(
      workspacesObject({ catalog: { "no-deps": "^2.0.0" } }),
      member("pkg1"),
      withPkg2(member("pkg2")),
    );
    await runBunInstall(bunEnv, dir.packageDir);
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");

    expectOk(await runAdd(dir.pkg1Dir, "no-deps@1.0.0", "--catalog"));

    expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "1.0.0" });
    expect(await dir.pkg2Text()).toBe(member("pkg2"));
    expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    const lockText = await dir.lockText();
    expect(lockText).not.toContain("no-deps@2.0.0");
    expect((await dir.lock()).catalog).toEqual({ "no-deps": "1.0.0" });

    const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
    expect(err).not.toContain("Saved lockfile");
  });

  test("other dependencies of the target are left alone", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "a-dep": "1.0.1" },
    });

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

    expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "1.0.1", "no-deps": "catalog:" });
    expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect((await dir.installed("a-dep")).version).toBe("1.0.1");
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
  });

  test("existing direct range is converted in place", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "no-deps": "^1.0.0" },
    });
    await runBunInstall(bunEnv, dir.packageDir);
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

    expect(await dir.pkg1Text()).toBe(
      JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:" } }, null, 2),
    );
    expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
  });

  test("re-running the same add is idempotent", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));
    const [rootAfter, pkg1After, lockAfter] = await Promise.all([dir.rootText(), dir.pkg1Text(), dir.lockText()]);

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

    expect(await dir.rootText()).toBe(rootAfter);
    expect(await dir.pkg1Text()).toBe(pkg1After);
    expect(await dir.lockText()).toBe(lockAfter);
  });

  test("named catalog with other entries and other named catalogs present", async () => {
    const dir = await createDir(
      workspacesObject({ catalogs: { other: { "a-dep": "1.0.1" }, testing: { "no-deps": "1.0.0" } } }),
    );

    expectOk(await runAdd(dir.pkg1Dir, "a-dep", "--catalog=testing"));

    const catalogs = { other: { "a-dep": "1.0.1" }, testing: { "a-dep": "^1.0.10", "no-deps": "1.0.0" } };
    const root = await dir.root();
    expect(root.workspaces.catalogs).toEqual(catalogs);
    expect(Object.keys(root.workspaces.catalogs.testing)).toEqual(["a-dep", "no-deps"]);
    expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:testing" });
    expect((await dir.lock()).catalogs).toEqual(catalogs);
    expect((await dir.installed("a-dep")).version).toBe("1.0.10");

    const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
    expect(err).not.toContain("Saved lockfile");
  });

  test("one package failing to resolve writes nothing", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));
    const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

    const { stderr, exitCode } = await runAdd(dir.pkg1Dir, "no-deps", "this-package-does-not-exist-xyz", "--catalog");

    expect(stderr).toContain("error:");
    expect(await dir.rootText()).toBe(rootBefore);
    expect(await dir.pkg1Text()).toBe(pkg1Before);
    expect(await dir.lockExists()).toBeFalse();
    expect(exitCode).not.toBe(0);
  });

  for (const from of ["member", "root"] as const) {
    test(`--no-save installs but writes neither file (from ${from})`, async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      expectOk(await runAdd(cwd, "no-deps", "--catalog", "--no-save"));

      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    });
  }

  test("root package.json formatting survives the member-path rewrite", async () => {
    const rootBefore =
      JSON.stringify(
        { private: true, workspaces: ["packages/*"], catalog: { "a-dep": "1.0.1" }, name: "root" },
        null,
        4,
      ) + "\n";
    const dir = await createDir(rootBefore);

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

    const rootText = await dir.rootText();
    expect(rootText).toBe(
      JSON.stringify(
        { private: true, workspaces: ["packages/*"], catalog: { "a-dep": "1.0.1", "no-deps": "^2.0.0" }, name: "root" },
        null,
        4,
      ) + "\n",
    );
  });

  // pnpm #7072: `catalog:` and `catalog:default` are one catalog, whether it is spelled `catalog` or `catalogs.default`.
  describe("default catalog alias", () => {
    const member = (name: string, ref = "catalog:") => JSON.stringify({ name, dependencies: { "no-deps": ref } });

    test("--catalog refreshes an existing catalogs.default instead of adding a second catalog", async () => {
      const dir = await createDir(
        workspacesObject({ catalogs: { default: { "no-deps": "1.0.0" } } }),
        member("pkg1"),
        withPkg2(member("pkg2", "catalog:default")),
      );
      await runBunInstall(bunEnv, dir.packageDir);
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");

      expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

      expect((await dir.root()).workspaces).toEqual({
        packages: ["packages/*"],
        catalogs: { default: { "no-deps": "^2.0.0" } },
      });
      expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });
      expect(await dir.pkg2Text()).toBe(member("pkg2", "catalog:default"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");

      const lock = await dir.lock();
      expect(lock.catalog).toBeUndefined();
      expect(lock.catalogs).toEqual({ default: { "no-deps": "^2.0.0" } });
      expect(lock.packages["no-deps"][0]).toBe("no-deps@2.0.0");

      const { stderr, exitCode } = await run(dir.packageDir, ["install", "--frozen-lockfile"]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    });

    test("--catalog=default refreshes the singular catalog every catalog: reference resolves through", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
        PKG1,
        withPkg2(member("pkg2")),
      );
      await runBunInstall(bunEnv, dir.packageDir);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");

      expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog=default"));

      expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:default" });
      expect((await dir.root()).workspaces).toEqual({
        packages: ["packages/*"],
        catalog: { "no-deps": "^2.0.0" },
      });
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");

      const lock = await dir.lock();
      expect(lock.catalog).toEqual({ "no-deps": "^2.0.0" });
      expect(lock.catalogs).toBeUndefined();
      expect(lock.workspaces["packages/pkg1"].dependencies).toEqual({ "no-deps": "catalog:default" });
      expect(await dir.lockText()).not.toContain("no-deps@1.1.0");

      const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
      expect(err).not.toContain("Saved lockfile");
    });

    test("--catalog=default with no catalog defined creates the singular catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog=default"));

      expect(await dir.root()).toEqual({
        name: "root",
        workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^2.0.0" } },
      });
      expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:default" });
      expect((await dir.lock()).catalog).toEqual({ "no-deps": "^2.0.0" });
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    });

    test("bun update --latest refreshes a catalogs.default entry referenced as catalog:", async () => {
      const dir = await createDir(workspacesObject({ catalogs: { default: { "no-deps": "^1.0.0" } } }), member("pkg1"));
      await runBunInstall(bunEnv, dir.packageDir);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");

      expectOk(await run(dir.packageDir, ["update", "--latest"]));

      expect((await dir.root()).workspaces.catalogs).toEqual({ default: { "no-deps": "^2.0.0" } });
      expect(await dir.pkg1Text()).toBe(member("pkg1"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect((await dir.lock()).catalogs).toEqual({ default: { "no-deps": "^2.0.0" } });

      const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
      expect(err).not.toContain("Saved lockfile");
    });

    test("bun pm pack substitutes a catalogs.default entry referenced as catalog:", async () => {
      const dir = await createDir(workspacesObject({ catalogs: { default: { "no-deps": ">=1.0.0" } } }), {
        name: "pkg1",
        version: "1.0.0",
        peerDependencies: { "no-deps": "catalog:" },
      });
      await runBunInstall(bunEnv, dir.packageDir);

      const { stderr, exitCode } = await run(dir.pkg1Dir, ["pm", "pack"]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);

      const tarball = readTarball(join(dir.pkg1Dir, "pkg1-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents)).toEqual({
        name: "pkg1",
        version: "1.0.0",
        peerDependencies: { "no-deps": ">=1.0.0" },
      });
    });
  });

  // pnpm #8996: `bun pm pack` substitutes catalog references in every dependency group.
  test("bun pm pack substitutes the catalog literal, including peerDependencies", async () => {
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": ">=1.0.0" } }), {
      name: "pkg1",
      version: "1.0.0",
      peerDependencies: { "no-deps": "catalog:" },
    });
    await runBunInstall(bunEnv, dir.packageDir);

    expectOk(await runAdd(dir.pkg1Dir, "a-dep", "--catalog=x"));
    expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:x" });

    const { stderr, exitCode } = await run(dir.pkg1Dir, ["pm", "pack"]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir.pkg1Dir, "pkg1-1.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "pkg1",
      version: "1.0.0",
      peerDependencies: { "no-deps": ">=1.0.0" },
      dependencies: { "a-dep": "^1.0.10" },
    });
  });

  // pnpm #10456: removing the last reference to an entry does not drop the catalog from bun.lock.
  test("bun remove from members keeps the catalog definitions", async () => {
    const member = (name: string) => JSON.stringify({ name, dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(
      workspacesObject({ catalog: { "no-deps": "1.0.0" } }),
      member("pkg1"),
      withPkg2(member("pkg2")),
    );

    expectOk(await runAdd(dir.pkg1Dir, "a-dep", "--catalog=libs"));
    expectOk(await run(dir.pkg1Dir, ["remove", "no-deps"]));
    expectOk(await run(dir.pkg2Dir, ["remove", "no-deps"]));

    expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:libs" });
    expect((await dir.pkg2()).dependencies).toBeUndefined();
    expect((await dir.root()).workspaces).toEqual({
      packages: ["packages/*"],
      catalog: { "no-deps": "1.0.0" },
      catalogs: { libs: { "a-dep": "^1.0.10" } },
    });
    const lock = await dir.lock();
    expect(lock.catalog).toEqual({ "no-deps": "1.0.0" });
    expect(lock.catalogs).toEqual({ libs: { "a-dep": "^1.0.10" } });

    const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
    expect(err).not.toContain("Saved lockfile");
  });

  // pnpm #8795: --frozen-lockfile notices a changed catalog entry.
  for (const from of ["member", "root"] as const) {
    test(`--frozen-lockfile passes after the add and fails once the entry is edited (from ${from})`, async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await runAdd(from === "member" ? dir.pkg1Dir : dir.packageDir, "no-deps", "--catalog"));

      const frozen = await run(dir.packageDir, ["install", "--frozen-lockfile"]);
      expect(frozen.stderr).not.toContain("error:");
      expect(frozen.exitCode).toBe(0);

      const root = await dir.root();
      root.workspaces.catalog["no-deps"] = "1.0.0";
      await write(dir.rootPath, JSON.stringify(root));

      const { stderr, exitCode } = await run(dir.packageDir, ["install", "--frozen-lockfile"]);
      expect(stderr).toContain("error:");
      expect(stderr).toContain("frozen-lockfile");
      expect(exitCode).toBe(1);
    });
  }

  // pnpm #12115 / #11591: update never replaces a `catalog:` reference, even with an override or an explicit spec.
  test("catalog: references survive bun update with an override", async () => {
    const pkg1 = { name: "pkg1", dependencies: { "no-deps": "catalog:" } };
    const dir = await createDir(
      { ...workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), overrides: { "no-deps": "1.0.0" } },
      pkg1,
    );
    await runBunInstall(bunEnv, dir.packageDir);
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");

    for (const args of [["update"], ["update", "--recursive"], ["update", "no-deps"], ["update", "no-deps@1.1.0"]]) {
      expectOk(await run(dir.pkg1Dir, args));
      expect(await dir.pkg1()).toEqual(pkg1);
    }
    expectOk(await runAdd(dir.pkg1Dir, "a-dep", "--catalog"));

    expect((await dir.pkg1()).dependencies).toEqual({ "a-dep": "catalog:", "no-deps": "catalog:" });
    const lock = await dir.lock();
    expect(lock.workspaces["packages/pkg1"].dependencies).toEqual({ "a-dep": "catalog:", "no-deps": "catalog:" });
    expect(lock.catalog).toEqual({ "a-dep": "^1.0.10", "no-deps": "^1.0.0" });
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");

    const { stderr, exitCode } = await run(dir.packageDir, ["install", "--frozen-lockfile"]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  // pnpm #9660: overrides win at resolution, so the catalog records the overridden version.
  test("an override decides what --catalog records", async () => {
    const dir = await createDir({ ...workspacesObject({ catalog: {} }), overrides: { "no-deps": "1.0.0" } });

    expectOk(await runAdd(dir.pkg1Dir, "no-deps", "--catalog"));

    expect((await dir.pkg1()).dependencies).toEqual({ "no-deps": "catalog:" });
    expect((await dir.root()).workspaces.catalog).toEqual({ "no-deps": "^1.0.0" });
    expect((await dir.lock()).catalog).toEqual({ "no-deps": "^1.0.0" });
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");

    const { err } = await runBunInstall(bunEnv, dir.packageDir, { savesLockfile: false });
    expect(err).not.toContain("Saved lockfile");
  });

  describe("errors", () => {
    test("root package.json without workspaces", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted", saveTextLockfile: true },
        files: { "package.json": JSON.stringify({ name: "solo" }) },
      });
      const before = await file(join(packageDir, "package.json")).text();

      const { stderr, exitCode } = await runAdd(packageDir, "no-deps", "--catalog");

      expect(stderr).toContain('error: --catalog requires a "workspaces" field in the root package.json');
      expect(await file(join(packageDir, "package.json")).text()).toBe(before);
      expect(await file(join(packageDir, "bun.lock")).exists()).toBeFalse();
      expect(exitCode).toBe(1);
    });

    test("positional without a name", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);
      const tarball = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;

      const { stderr, exitCode } = await runAdd(dir.packageDir, "--catalog", tarball);

      expect(stderr).toContain(`error: --catalog can only add packages by name, but got "${tarball}"`);
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(exitCode).toBe(1);
    });

    test("bun install --catalog without packages", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stderr, exitCode } = await run(dir.packageDir, ["install", "--catalog"]);

      expect(stderr).toContain("error: --catalog requires at least one package to add");
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await file(join(dir.packageDir, "bun.lock")).exists()).toBeFalse();
      expect(exitCode).toBe(1);
    });

    test("--catalog with --global", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);
      const globalDir = join(dir.packageDir, ".bun-global");

      const { stderr, exitCode } = await run(dir.pkg1Dir, ["add", "no-deps", "--catalog", "-g"], {
        ...bunEnv,
        BUN_INSTALL: globalDir,
        BUN_INSTALL_GLOBAL_DIR: join(globalDir, "install", "global"),
        BUN_INSTALL_BIN: join(globalDir, "bin"),
      });

      expect(stderr).toContain("error: --catalog cannot be used with --global");
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await file(join(globalDir, "install", "global", "package.json")).exists()).toBeFalse();
      expect(exitCode).toBe(1);
    });
  });
});
