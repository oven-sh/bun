import { file, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, readdirSorted, runBunInstall } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

const pkg1Json = { name: "pkg1", version: "1.0.0" };
const PKG1 = JSON.stringify(pkg1Json);
// `bun add` re-prints the package.json it edits; fixtures asserted byte-for-byte afterwards are written in that shape.
const pretty = (json: Record<string, unknown>) => JSON.stringify(json, null, 2);
const rootRow = { "": { name: "root" } };

// CI's per-file BUN_INSTALL_CACHE_DIR overrides bunfig's cache; concurrent installs sharing it race on Windows.
function envFor(packageDir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };
}

async function spawnBun(cwd: string, args: string[], env: Record<string, string | undefined>) {
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

async function createDir(
  root: Record<string, unknown> | string,
  pkg1: Record<string, unknown> | string = PKG1,
  extraFiles: Record<string, string> = {},
  linker: "hoisted" | "isolated" = "hoisted",
) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker, saveTextLockfile: true },
    files: {
      "package.json": typeof root === "string" ? root : JSON.stringify(root),
      "packages/pkg1/package.json": typeof pkg1 === "string" ? pkg1 : JSON.stringify(pkg1),
      ...extraFiles,
    },
  });

  const rootPath = join(packageDir, "package.json");
  const pkg1Path = join(packageDir, "packages", "pkg1", "package.json");
  const pkg2Path = join(packageDir, "packages", "pkg2", "package.json");
  const env = envFor(packageDir);
  const lockText = () => file(join(packageDir, "bun.lock")).text();

  return {
    packageDir,
    env,
    run: (cwd: string, args: string[], spawnEnv: Record<string, string | undefined> = env) =>
      spawnBun(cwd, args, spawnEnv),
    add: (cwd: string, ...args: string[]) => spawnBun(cwd, ["add", ...args], env),
    install: (options: Parameters<typeof runBunInstall>[2] = {}) => runBunInstall(env, packageDir, options),
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
    lockText,
    lockExists: () => file(join(packageDir, "bun.lock")).exists(),
    // Everything `bun add --catalog` can change in bun.lock: the catalog sections (present only when the lockfile has
    // them), every workspace's rows, and the version each non-workspace package resolved to, keyed as bun.lock keys it.
    lockState: async () => {
      const { catalog, catalogs, workspaces, packages } = Bun.JSONC.parse(await lockText()) as any;
      const resolved = Object.fromEntries(
        Object.entries<[string, ...unknown[]]>(packages)
          .filter(([, row]) => !row[0].includes("@workspace:"))
          .map(([key, row]) => [key, row[0]]),
      );
      return { ...(catalog && { catalog }), ...(catalogs && { catalogs }), workspaces, resolved };
    },
    installed: (name: string) => file(join(packageDir, "node_modules", name, "package.json")).json(),
    installedExists: (name: string) => file(join(packageDir, "node_modules", name, "package.json")).exists(),
    memberInstalled: (member: string, name: string) =>
      file(join(packageDir, "packages", member, "node_modules", name, "package.json")).json(),
    store: () => readdirSorted(join(packageDir, "node_modules", ".bun")),
    // The bun.lock the command wrote is what resolving the edited package.json files produces: a plain `bun install`
    // afterwards has nothing to re-save and nothing to link. Tests whose tree holds a tarball package pass `relinks`,
    // because bun re-links a tarball package on every install, with or without a catalog.
    installSavesNothing: async ({ relinks = false } = {}) => {
      const { out, err } = await runBunInstall(env, packageDir, { savesLockfile: false });
      expect(err).not.toContain("Saved lockfile");
      if (!relinks) expect(out).toContain("(no changes)");
    },
  };
}

const pkg2Json = { name: "pkg2", version: "1.0.0" };
const PKG2 = JSON.stringify(pkg2Json);
const withPkg2 = (pkg2: Record<string, unknown> | string = PKG2) => ({
  "packages/pkg2/package.json": typeof pkg2 === "string" ? pkg2 : JSON.stringify(pkg2),
});

// `notes` is every `note:` line the command must have printed, in order; by default the command prints none.
function expectOk({ stderr, exitCode }: { stderr: string; exitCode: number }, ...notes: string[]) {
  expect(stderr.split("\n").filter(line => line.startsWith("note:"))).toStrictEqual(notes);
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("warn:");
  expect(exitCode).toBe(0);
}

const workspacesObject = (catalogs: Record<string, unknown> = {}) => ({
  name: "root",
  workspaces: { packages: ["packages/*"], ...catalogs },
});

const pkg1OnCatalog = { ...pkg1Json, dependencies: { "no-deps": "catalog:" } };
const pkg2OnCatalog = { ...pkg2Json, dependencies: { "no-deps": "catalog:" } };
// A member fixture, which is also its bun.lock row, whose only dependency is no-deps at `spec`.
const onCatalog = (name: string, spec = "catalog:") => ({ name, dependencies: { "no-deps": spec } });
const bothOnCatalog = { ...rootRow, "packages/pkg1": onCatalog("pkg1"), "packages/pkg2": onCatalog("pkg2") };
// bun.lock after `bun add no-deps --catalog` from pkg1 seeds an empty default catalog.
const seededLock = {
  catalog: { "no-deps": "^2.0.0" },
  workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog },
  resolved: { "no-deps": "no-deps@2.0.0" },
};
// The same add run from the workspace root puts the reference on the root instead.
const rootOnCatalog = { "": { name: "root", dependencies: { "no-deps": "catalog:" } }, "packages/pkg1": pkg1Json };

describe.concurrent("bun add --catalog", () => {
  test("default catalog from a workspace member", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    const result = await dir.add(dir.pkg1Dir, "no-deps", "--catalog");
    expectOk(result);
    expect(result.stdout).toContain("installed no-deps@2.0.0");

    expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    expect(await dir.lockState()).toStrictEqual(seededLock);

    await dir.installSavesNothing();
  });

  test("named catalog creates the catalogs object", async () => {
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));

    expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=testing"));

    const pkg1 = { ...pkg1Json, dependencies: { "a-dep": "catalog:testing" } };
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.root()).toStrictEqual(
      workspacesObject({ catalog: { "no-deps": "1.0.0" }, catalogs: { testing: { "a-dep": "^1.0.10" } } }),
    );
    expect((await dir.installed("a-dep")).version).toBe("1.0.10");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "1.0.0" },
      catalogs: { testing: { "a-dep": "^1.0.10" } },
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "a-dep": "a-dep@1.0.10" },
    });
  });

  describe("placement when no catalog is defined yet", () => {
    test("workspaces object gets workspaces.catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect(await dir.lockState()).toStrictEqual(seededLock);
    });

    test("workspaces array gets a top-level catalog", async () => {
      const dir = await createDir({ name: "root", workspaces: ["packages/*"] });

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

      expect(await dir.root()).toStrictEqual({
        name: "root",
        workspaces: ["packages/*"],
        catalog: { "no-deps": "^2.0.0" },
      });
      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect(await dir.lockState()).toStrictEqual(seededLock);
    });
  });

  describe("existing top-level placement is respected", () => {
    const topLevel = { name: "root", catalog: { "no-deps": "1.0.0" }, workspaces: ["packages/*"] };
    const pkg1OnADep = { ...pkg1Json, dependencies: { "a-dep": "catalog:" } };

    test("default catalog", async () => {
      const dir = await createDir(topLevel);

      expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog"));

      const root = await dir.root();
      expect(root).toStrictEqual({
        name: "root",
        catalog: { "a-dep": "^1.0.10", "no-deps": "1.0.0" },
        workspaces: ["packages/*"],
      });
      expect(Object.keys(root.catalog)).toStrictEqual(["a-dep", "no-deps"]);
      expect(await dir.pkg1()).toStrictEqual(pkg1OnADep);
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "a-dep": "^1.0.10", "no-deps": "1.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1OnADep },
        resolved: { "a-dep": "a-dep@1.0.10" },
      });
    });

    test("named catalog", async () => {
      const dir = await createDir(topLevel);

      expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=x"));

      expect(await dir.root()).toStrictEqual({
        name: "root",
        catalog: { "no-deps": "1.0.0" },
        catalogs: { x: { "a-dep": "^1.0.10" } },
        workspaces: ["packages/*"],
      });
      const pkg1 = { ...pkg1Json, dependencies: { "a-dep": "catalog:x" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "1.0.0" },
        catalogs: { x: { "a-dep": "^1.0.10" } },
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
        resolved: { "a-dep": "a-dep@1.0.10" },
      });
    });

    test("workspaces.catalog wins when a top-level catalog also exists", async () => {
      const dir = await createDir({
        name: "root",
        catalog: { "a-dep": "1.0.1" },
        workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
      });

      expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog"));

      const root = await dir.root();
      expect(root).toStrictEqual({
        name: "root",
        catalog: { "a-dep": "1.0.1" },
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "^1.0.10", "no-deps": "1.0.0" } },
      });
      expect(Object.keys(root.workspaces.catalog)).toStrictEqual(["a-dep", "no-deps"]);
      expect(await dir.pkg1()).toStrictEqual(pkg1OnADep);
      expect((await dir.installed("a-dep")).version).toBe("1.0.10");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "a-dep": "^1.0.10", "no-deps": "1.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1OnADep },
        resolved: { "a-dep": "a-dep@1.0.10" },
      });

      await dir.installSavesNothing();
    });
  });

  describe("flag spelling", () => {
    const seeded = {
      name: "root",
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^2.0.0" } },
    };

    test("--catalog before the package name does not swallow it", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "--catalog", "no-deps"));

      expect(await dir.root()).toStrictEqual(seeded);
      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual(seededLock);
    });

    test("a word after --catalog is a package, not the catalog name", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "a-dep"));

      const root = await dir.root();
      expect(root).toStrictEqual(workspacesObject({ catalog: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } }));
      expect(Object.keys(root.workspaces.catalog)).toStrictEqual(["a-dep", "no-deps"]);
      const pkg1 = { ...pkg1Json, dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect((await dir.installed("a-dep")).version).toBe("1.0.10");
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
        resolved: { "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@2.0.0" },
      });
    });

    for (const flag of ["--catalog=", "--catalog= "]) {
      test(`${JSON.stringify(flag)} is the default catalog`, async () => {
        const dir = await createDir(workspacesObject());

        expectOk(await dir.add(dir.pkg1Dir, "no-deps", flag));

        expect(await dir.root()).toStrictEqual(seeded);
        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        expect(await dir.lockState()).toStrictEqual(seededLock);
      });
    }

    test("pnpm's --save-catalog is ignored and the package is added directly", async () => {
      const root = pretty(workspacesObject({ catalog: {} }));
      const dir = await createDir(root);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--save-catalog"));

      const pkg1 = { ...pkg1Json, dependencies: { "no-deps": "^2.0.0" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.rootText()).toBe(root);
      expect(await dir.lockState()).toStrictEqual({
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
        resolved: { "no-deps": "no-deps@2.0.0" },
      });
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

        expectOk(await dir.add(dir.pkg1Dir, ...args));

        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": entry } }));
        expect((await dir.installed("no-deps")).version).toBe(installed);
        expect(await dir.lockState()).toStrictEqual({
          catalog: { "no-deps": entry },
          workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog },
          resolved: { "no-deps": `no-deps@${installed}` },
        });
      });
    }
  });

  // pnpm keeps an existing entry as written when a bare name is added to the catalog.
  test("a bare name reuses an existing catalog entry", async () => {
    const pkg1 = pretty({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), pkg1);

    await dir.install();
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");
    const lockBefore = await dir.lockText();

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
    expect(await dir.pkg1Text()).toBe(pkg1);
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");
    // Byte-identical to what `bun install` wrote, so a later install has nothing to re-save either.
    expect(await dir.lockText()).toBe(lockBefore);
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "^1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog },
      resolved: { "no-deps": "no-deps@1.1.0" },
    });
  });

  test("an existing entry is reused by a new consumer without touching the other members", async () => {
    const pkg1 = JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), pkg1, withPkg2());
    await dir.install();
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");

    expectOk(await dir.add(dir.pkg2Dir, "no-deps", "--catalog"));

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
    expect(await dir.pkg2()).toStrictEqual(pkg2OnCatalog);
    expect(await dir.pkg1Text()).toBe(pkg1);
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "^1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": JSON.parse(pkg1), "packages/pkg2": pkg2OnCatalog },
      resolved: { "no-deps": "no-deps@1.1.0" },
    });

    await dir.installSavesNothing();
  });

  test("an existing entry wins over the range the target declares directly", async () => {
    const pkg2 = JSON.stringify({ name: "pkg2", dependencies: { "no-deps": "catalog:" } });
    const dir = await createDir(
      workspacesObject({ catalog: { "no-deps": "1.0.0" } }),
      { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
      withPkg2(pkg2),
    );
    await dir.install();

    expectOk(
      await dir.add(dir.pkg1Dir, "no-deps", "--catalog"),
      'note: no-deps in pkg1 now follows the catalog entry "1.0.0" instead of "^1.0.0"',
    );

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
    const pkg1 = onCatalog("pkg1");
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.pkg2Text()).toBe(pkg2);
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1, "packages/pkg2": JSON.parse(pkg2) },
      resolved: { "no-deps": "no-deps@1.0.0" },
    });

    await dir.installSavesNothing();
  });

  test("--silent prints no note when the target's range differs from the entry", async () => {
    const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), {
      name: "pkg1",
      dependencies: { "no-deps": "1.0.0" },
    });

    const { stdout, stderr, exitCode } = await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--silent");
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);

    const pkg1 = onCatalog("pkg1");
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "^1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "no-deps": "no-deps@1.1.0" },
    });
  });

  test("the note names package.json when the target has no name", async () => {
    const dir = await createDir({
      dependencies: { "no-deps": "^1.0.0" },
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
    });

    expectOk(
      await dir.add(dir.packageDir, "no-deps", "--catalog"),
      'note: no-deps in package.json now follows the catalog entry "1.0.0" instead of "^1.0.0"',
    );

    expect(await dir.root()).toStrictEqual({
      dependencies: { "no-deps": "catalog:" },
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
    });
    expect(await dir.pkg1Text()).toBe(PKG1);
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "1.0.0" },
      workspaces: { "": { dependencies: { "no-deps": "catalog:" } }, "packages/pkg1": pkg1Json },
      resolved: { "no-deps": "no-deps@1.0.0" },
    });
  });

  test("a tarball url the target declares is cataloged verbatim", async () => {
    const tarball = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "no-deps": tarball },
    });
    await dir.install();
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

    const pkg1 = onCatalog("pkg1");
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball } }));
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": tarball },
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "no-deps": `no-deps@${tarball}` },
    });

    await dir.installSavesNothing({ relinks: true });
  });

  test("an explicit version equal to the existing entry leaves the root as it was", async () => {
    const root = pretty(workspacesObject({ catalog: { "a-dep": "1.0.1", "no-deps": "1.0.0" } }));
    const dir = await createDir(root);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.0", "--catalog"));

    expect(await dir.rootText()).toBe(root);
    expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "a-dep": "1.0.1", "no-deps": "1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog },
      resolved: { "no-deps": "no-deps@1.0.0" },
    });
  });

  describe("explicit version inside an existing range", () => {
    for (const linker of ["hoisted", "isolated"] as const) {
      test(`keeps the range and moves the installed version (${linker})`, async () => {
        const member = (name: string) => pretty(onCatalog(name));
        const dir = await createDir(
          workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
          member("pkg1"),
          withPkg2(member("pkg2")),
          linker,
        );
        const installedVersions = async () =>
          linker === "isolated"
            ? [
                (await dir.memberInstalled("pkg1", "no-deps")).version,
                (await dir.memberInstalled("pkg2", "no-deps")).version,
              ]
            : [(await dir.installed("no-deps")).version];
        await dir.install();
        expect(await installedVersions()).toStrictEqual(linker === "isolated" ? ["1.1.0", "1.1.0"] : ["1.1.0"]);

        expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.0", "--catalog"));

        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
        expect(await dir.pkg1Text()).toBe(member("pkg1"));
        expect(await dir.pkg2Text()).toBe(member("pkg2"));
        expect(await installedVersions()).toStrictEqual(linker === "isolated" ? ["1.0.0", "1.0.0"] : ["1.0.0"]);
        if (linker === "isolated") {
          expect(await dir.store()).toContain("no-deps@1.0.0");
        }
        expect(await dir.lockState()).toStrictEqual({
          catalog: { "no-deps": "^1.0.0" },
          workspaces: bothOnCatalog,
          resolved: { "no-deps": "no-deps@1.0.0" },
        });

        // The range still allows 1.1.0; only the lockfile pins 1.0.0, and a plain install must honor that pin.
        await dir.installSavesNothing();
        expect(await installedVersions()).toStrictEqual(linker === "isolated" ? ["1.0.0", "1.0.0"] : ["1.0.0"]);
      });
    }

    test("a range that differs replaces the entry", async () => {
      const member = (name: string) => JSON.stringify(onCatalog(name));
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
        member("pkg1"),
        withPkg2(member("pkg2")),
      );
      await dir.install();

      expectOk(
        await dir.add(dir.pkg1Dir, "no-deps@^2.0.0", "--catalog"),
        'note: catalog entry no-deps changed from "^1.0.0" to "^2.0.0" (also used by pkg2)',
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect(await dir.pkg2Text()).toBe(member("pkg2"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^2.0.0" },
        workspaces: bothOnCatalog,
        resolved: { "no-deps": "no-deps@2.0.0" },
      });
    });
  });

  test("a dist-tag already in package.json is cataloged as that tag's range", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "dep-with-tags": "pre-1" },
    });

    expectOk(await dir.add(dir.pkg1Dir, "dep-with-tags", "--catalog"));

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "dep-with-tags": "^1.0.1" } }));
    const pkg1 = { name: "pkg1", dependencies: { "dep-with-tags": "catalog:" } };
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect((await dir.installed("dep-with-tags")).version).toBe("1.0.1");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "dep-with-tags": "^1.0.1" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "dep-with-tags": "dep-with-tags@1.0.1" },
    });

    await dir.installSavesNothing();
  });

  test("a direct exact pin in devDependencies is cataloged verbatim", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      devDependencies: { "no-deps": "1.0.0" },
    });

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--dev"));

    const pkg1 = { name: "pkg1", devDependencies: { "no-deps": "catalog:" } };
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "no-deps": "no-deps@1.0.0" },
    });
  });

  test("run from the workspace root", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog"));

    expect(await dir.root()).toStrictEqual({
      name: "root",
      dependencies: { "no-deps": "catalog:" },
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^2.0.0" } },
    });
    expect(await dir.pkg1Text()).toBe(PKG1);
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    expect(await dir.lockState()).toStrictEqual({ ...seededLock, workspaces: rootOnCatalog });

    await dir.installSavesNothing();
  });

  test("bun install <pkg> --catalog --dev", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await dir.run(dir.pkg1Dir, ["install", "no-deps", "--catalog", "--dev"]));

    const pkg1 = { ...pkg1Json, devDependencies: { "no-deps": "catalog:" } };
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    expect(await dir.lockState()).toStrictEqual({ ...seededLock, workspaces: { ...rootRow, "packages/pkg1": pkg1 } });
  });

  test("several packages into a named catalog", async () => {
    const dir = await createDir(workspacesObject());

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "a-dep", "--catalog=libs"));

    const pkg1 = { ...pkg1Json, dependencies: { "a-dep": "catalog:libs", "no-deps": "catalog:libs" } };
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    const root = await dir.root();
    expect(root).toStrictEqual(workspacesObject({ catalogs: { libs: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } } }));
    expect(Object.keys(root.workspaces.catalogs.libs)).toStrictEqual(["a-dep", "no-deps"]);
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    expect((await dir.installed("a-dep")).version).toBe("1.0.10");
    expect(await dir.lockState()).toStrictEqual({
      catalogs: { libs: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } },
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@2.0.0" },
    });
  });

  for (const from of ["member", "root"] as const) {
    test(`--dry-run writes nothing (from ${from})`, async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      const result = await dir.add(cwd, "no-deps", "--catalog", "--dry-run");

      expectOk(result);
      expect(result.stdout).toContain("installed no-deps@2.0.0");
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(existsSync(join(dir.packageDir, "node_modules"))).toBeFalse();
    });

    test(`--lockfile-only writes both files and bun.lock but installs nothing (from ${from})`, async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      const result = await dir.add(cwd, "no-deps", "--catalog", "--lockfile-only");
      expectOk(result);
      expect(result.stdout).toContain("Saved bun.lock (3 packages)");

      if (from === "member") {
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        expect(await dir.lockState()).toStrictEqual(seededLock);
      } else {
        expect(await dir.root()).toStrictEqual({
          ...workspacesObject({ catalog: { "no-deps": "^2.0.0" } }),
          dependencies: { "no-deps": "catalog:" },
        });
        expect(await dir.pkg1Text()).toBe(PKG1);
        expect(await dir.lockState()).toStrictEqual({ ...seededLock, workspaces: rootOnCatalog });
      }
      expect(existsSync(join(dir.packageDir, "node_modules"))).toBeFalse();
      expect(existsSync(join(dir.pkg1Dir, "node_modules"))).toBeFalse();

      const frozen = await dir.run(dir.packageDir, ["install", "--frozen-lockfile"]);
      expectOk(frozen);
      expect(frozen.stdout).toContain("2 packages installed");
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    });
  }

  describe("only the dependency group plain add edits is rewritten", () => {
    test("--optional", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--optional"));

      const pkg1 = { ...pkg1Json, optionalDependencies: { "no-deps": "catalog:" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({ ...seededLock, workspaces: { ...rootRow, "packages/pkg1": pkg1 } });

      await dir.installSavesNothing();
    });

    test("name in devDependencies and peerDependencies, adding with --dev", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), {
        name: "pkg1",
        devDependencies: { "no-deps": "1.0.0" },
        peerDependencies: { "no-deps": ">=1" },
      });

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--dev"));

      const pkg1 = {
        name: "pkg1",
        devDependencies: { "no-deps": "catalog:" },
        peerDependencies: { "no-deps": ">=1" },
      };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "1.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
        resolved: { "no-deps": "no-deps@1.0.0" },
      });
    });

    test("name only in peerDependencies, adding with --dev, matches plain add", async () => {
      const pkg1 = { name: "pkg1", peerDependencies: { "no-deps": ">=1" } };
      const [plain, catalog] = await Promise.all([
        createDir(workspacesObject({ catalog: {} }), pkg1),
        createDir(workspacesObject({ catalog: {} }), pkg1),
      ]);

      const [plainResult, catalogResult] = await Promise.all([
        plain.add(plain.pkg1Dir, "no-deps", "--dev"),
        catalog.add(catalog.pkg1Dir, "no-deps", "--dev", "--catalog"),
      ]);
      expectOk(plainResult);
      expectOk(catalogResult);

      const plainPkg1 = await plain.pkg1();
      const catalogPkg1 = await catalog.pkg1();
      expect(Object.keys(catalogPkg1)).toStrictEqual(Object.keys(plainPkg1));
      expect(plainPkg1).toStrictEqual({ name: "pkg1", peerDependencies: { "no-deps": "^2.0.0" } });
      expect(catalogPkg1).toStrictEqual({ name: "pkg1", peerDependencies: { "no-deps": "catalog:" } });
    });

    test("--peer", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--peer"));

      const pkg1 = { ...pkg1Json, peerDependencies: { "no-deps": "catalog:" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({ ...seededLock, workspaces: { ...rootRow, "packages/pkg1": pkg1 } });
    });
  });

  // pnpm: a dependency already on `catalog:<name>` stays in that catalog; the flag only picks the catalog for new references.
  describe("target already on a named catalog reference stays in that catalog", () => {
    const pkg1Row = onCatalog("pkg1", "catalog:testing");
    const pkg1 = pretty(pkg1Row);
    const testingRoot = workspacesObject({ catalogs: { testing: { "no-deps": "1.0.0" } } });

    for (const { args, entry, installed, notes } of [
      { args: ["no-deps", "--catalog"], entry: "1.0.0", installed: "1.0.0", notes: [] },
      { args: ["no-deps", "--catalog=other"], entry: "1.0.0", installed: "1.0.0", notes: [] },
      {
        args: ["no-deps@1.1.0", "--catalog"],
        entry: "1.1.0",
        installed: "1.1.0",
        notes: ['note: catalog entry no-deps changed from "1.0.0" to "1.1.0"'],
      },
    ]) {
      test(`bun add ${args.join(" ")}`, async () => {
        const dir = await createDir(testingRoot, pkg1);
        await dir.install();
        expect((await dir.installed("no-deps")).version).toBe("1.0.0");

        expectOk(await dir.add(dir.pkg1Dir, ...args), ...notes);

        expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { testing: { "no-deps": entry } } }));
        expect(await dir.pkg1Text()).toBe(pkg1);
        expect((await dir.installed("no-deps")).version).toBe(installed);
        expect(await dir.lockState()).toStrictEqual({
          catalogs: { testing: { "no-deps": entry } },
          workspaces: { ...rootRow, "packages/pkg1": pkg1Row },
          resolved: { "no-deps": `no-deps@${installed}` },
        });
      });
    }

    test("an explicit version inside the named entry's range moves the resolution within that catalog", async () => {
      const dir = await createDir(workspacesObject({ catalogs: { testing: { "no-deps": "^1.0.0" } } }), pkg1);
      await dir.install();
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.1", "--catalog"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { testing: { "no-deps": "^1.0.0" } } }));
      expect(await dir.pkg1Text()).toBe(pkg1);
      expect((await dir.installed("no-deps")).version).toBe("1.0.1");
      expect(await dir.lockState()).toStrictEqual({
        catalogs: { testing: { "no-deps": "^1.0.0" } },
        workspaces: { ...rootRow, "packages/pkg1": pkg1Row },
        resolved: { "no-deps": "no-deps@1.0.1" },
      });

      await dir.installSavesNothing();
      expect((await dir.installed("no-deps")).version).toBe("1.0.1");
    });
  });

  describe("target on a named reference whose catalog has no entry", () => {
    const pkg1Row = onCatalog("pkg1", "catalog:legacy");
    const pkg1 = pretty(pkg1Row);
    const legacyLock = {
      catalogs: { legacy: { "no-deps": "^2.0.0" } },
      workspaces: { ...rootRow, "packages/pkg1": pkg1Row },
      resolved: { "no-deps": "no-deps@2.0.0" },
    };

    for (const { flag, root } of [
      { flag: "--catalog", root: { catalog: {} } },
      { flag: "--catalog=other", root: { catalogs: { legacy: {} } } },
    ]) {
      test(`bun add no-deps ${flag} seeds that catalog and keeps the reference`, async () => {
        const dir = await createDir(workspacesObject(root), pkg1);

        expectOk(await dir.add(dir.pkg1Dir, "no-deps", flag));

        expect(await dir.pkg1Text()).toBe(pkg1);
        expect(await dir.root()).toStrictEqual(
          workspacesObject({ ...root, catalogs: { legacy: { "no-deps": "^2.0.0" } } }),
        );
        expect((await dir.installed("no-deps")).version).toBe("2.0.0");
        expect(await dir.lockState()).toStrictEqual(legacyLock);

        await dir.installSavesNothing();
      });
    }

    test("an explicit version is written into that catalog", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.0.0", "--catalog=other"));

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.root()).toStrictEqual(
        workspacesObject({ catalog: {}, catalogs: { legacy: { "no-deps": "1.0.0" } } }),
      );
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalogs: { legacy: { "no-deps": "1.0.0" } },
        workspaces: { ...rootRow, "packages/pkg1": pkg1Row },
        resolved: { "no-deps": "no-deps@1.0.0" },
      });
    });
  });

  describe("literals other than a bare name", () => {
    const pkg1OnFoo = { ...pkg1Json, dependencies: { foo: "catalog:" } };

    test("alias@npm:pkg is written verbatim, like plain add", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, "foo@npm:no-deps", "--catalog"));

      expect(await dir.pkg1()).toStrictEqual(pkg1OnFoo);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { foo: "npm:no-deps" } }));
      expect(await dir.installed("foo")).toMatchObject({ name: "no-deps", version: "2.0.0" });
      expect(await dir.lockState()).toStrictEqual({
        catalog: { foo: "npm:no-deps" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1OnFoo },
        resolved: { foo: "no-deps@2.0.0" },
      });

      await dir.installSavesNothing();
    });

    test("alias@npm:pkg@dist-tag gets the resolved range", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(dir.pkg1Dir, "foo@npm:no-deps@latest", "--catalog"));

      expect(await dir.pkg1()).toStrictEqual(pkg1OnFoo);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { foo: "npm:no-deps@^2.0.0" } }));
      expect(await dir.installed("foo")).toMatchObject({ name: "no-deps", version: "2.0.0" });
      expect(await dir.lockState()).toStrictEqual({
        catalog: { foo: "npm:no-deps@^2.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1OnFoo },
        resolved: { foo: "no-deps@2.0.0" },
      });

      await dir.installSavesNothing();
    });

    test("name@tarball-url is written verbatim, dist-tags become a range", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const tarball = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;

      expectOk(await dir.add(dir.pkg1Dir, `no-deps@${tarball}`, "dep-with-tags@pre-1", "--catalog"));

      const pkg1 = { ...pkg1Json, dependencies: { "dep-with-tags": "catalog:", "no-deps": "catalog:" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      const catalog = { "dep-with-tags": "^1.0.1", "no-deps": tarball };
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog }));
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");
      expect((await dir.installed("dep-with-tags")).version).toBe("1.0.1");
      expect(await dir.lockState()).toStrictEqual({
        catalog,
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
        resolved: { "dep-with-tags": "dep-with-tags@1.0.1", "no-deps": `no-deps@${tarball}` },
      });
    });

    test("scoped package into a named catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "@types/no-deps", "--catalog=types"));

      const pkg1 = { ...pkg1Json, dependencies: { "@types/no-deps": "catalog:types" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { types: { "@types/no-deps": "^2.0.0" } } }));
      expect((await dir.installed("@types/no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalogs: { types: { "@types/no-deps": "^2.0.0" } },
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
        resolved: { "@types/no-deps": "@types/no-deps@2.0.0" },
      });
    });

    describe("positionals without a name", () => {
      const tarball = () => `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;
      const tarballResolved = { "no-deps": `no-deps@${tarball()}` };

      for (const from of ["member", "root"] as const) {
        test(`a tarball url is cataloged under the resolved name (from ${from})`, async () => {
          const dir = await createDir(workspacesObject({ catalog: {} }));

          const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
          expectOk(await dir.add(cwd, tarball(), "--catalog"));

          const catalog = { "no-deps": tarball() };
          if (from === "member") {
            expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
            expect(await dir.root()).toStrictEqual(workspacesObject({ catalog }));
          } else {
            expect(await dir.root()).toStrictEqual({
              ...workspacesObject({ catalog }),
              dependencies: { "no-deps": "catalog:" },
            });
            expect(await dir.pkg1Text()).toBe(PKG1);
          }
          expect((await dir.installed("no-deps")).version).toBe("1.0.0");
          expect(await dir.lockState()).toStrictEqual({
            catalog,
            workspaces: from === "member" ? seededLock.workspaces : rootOnCatalog,
            resolved: tarballResolved,
          });

          await dir.installSavesNothing({ relinks: true });
        });
      }

      test("--filter puts every selected member on the entry", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());

        expectOk(await dir.add(dir.packageDir, tarball(), "--catalog", "--filter", "pkg1", "--filter", "pkg2"));

        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        expect(await dir.pkg2()).toStrictEqual(pkg2OnCatalog);
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball() } }));
        expect(await dir.lockState()).toStrictEqual({
          catalog: { "no-deps": tarball() },
          workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog, "packages/pkg2": pkg2OnCatalog },
          resolved: tarballResolved,
        });

        await dir.installSavesNothing({ relinks: true });
      });

      test("mixed with a named package", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "a-dep", "--catalog"));

        const pkg1 = { ...pkg1Json, dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" } };
        expect(await dir.pkg1()).toStrictEqual(pkg1);
        const catalog = { "a-dep": "^1.0.10", "no-deps": tarball() };
        const root = await dir.root();
        expect(root).toStrictEqual(workspacesObject({ catalog }));
        expect(Object.keys(root.workspaces.catalog)).toStrictEqual(["a-dep", "no-deps"]);
        expect((await dir.installed("a-dep")).version).toBe("1.0.10");
        expect((await dir.installed("no-deps")).version).toBe("1.0.0");
        expect(await dir.lockState()).toStrictEqual({
          catalog,
          workspaces: { ...rootRow, "packages/pkg1": pkg1 },
          resolved: { "a-dep": "a-dep@1.0.10", ...tarballResolved },
        });

        await dir.installSavesNothing({ relinks: true });
      });

      test("the entry is inserted in alphabetical order", async () => {
        const dir = await createDir(workspacesObject({ catalog: { zzz: "1.0.0" } }));

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"));

        const catalog = { "no-deps": tarball(), zzz: "1.0.0" };
        const root = await dir.root();
        expect(root).toStrictEqual(workspacesObject({ catalog }));
        expect(Object.keys(root.workspaces.catalog)).toStrictEqual(["no-deps", "zzz"]);
        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        expect(await dir.lockState()).toStrictEqual({
          catalog,
          workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog },
          resolved: tarballResolved,
        });
      });

      test("into a named catalog", async () => {
        const dir = await createDir(workspacesObject());

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog=vendored"));

        const pkg1 = { ...pkg1Json, dependencies: { "no-deps": "catalog:vendored" } };
        expect(await dir.pkg1()).toStrictEqual(pkg1);
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { vendored: { "no-deps": tarball() } } }));
        expect((await dir.installed("no-deps")).version).toBe("1.0.0");
        expect(await dir.lockState()).toStrictEqual({
          catalogs: { vendored: { "no-deps": tarball() } },
          workspaces: { ...rootRow, "packages/pkg1": pkg1 },
          resolved: tarballResolved,
        });
      });

      test("an identical entry is reused", async () => {
        const root = workspacesObject({ catalog: { "no-deps": tarball() } });
        const pkg2 = JSON.stringify(onCatalog("pkg2"));
        const dir = await createDir(root, PKG1, withPkg2(pkg2));
        await dir.install();

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"));

        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        expect(await dir.root()).toStrictEqual(root);
        expect(await dir.pkg2Text()).toBe(pkg2);
        expect(await dir.lockState()).toStrictEqual({
          catalog: { "no-deps": tarball() },
          workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog, "packages/pkg2": onCatalog("pkg2") },
          resolved: tarballResolved,
        });
      });

      test("re-running is a no-op", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"));
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball() } }));
        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        const [rootAfter, pkg1After, lockAfter] = await Promise.all([dir.rootText(), dir.pkg1Text(), dir.lockText()]);

        expectOk(await dir.add(dir.pkg1Dir, tarball(), "--catalog"));

        expect(await dir.rootText()).toBe(rootAfter);
        expect(await dir.pkg1Text()).toBe(pkg1After);
        expect(await dir.lockText()).toBe(lockAfter);
      });

      test("a different existing entry keeps the package direct", async () => {
        const root = workspacesObject({ catalog: { "no-deps": "^1.0.0" } });
        const dir = await createDir(root, PKG1, withPkg2(onCatalog("pkg2")));
        await dir.install();

        expectOk(
          await dir.add(dir.pkg1Dir, tarball(), "--catalog"),
          `note: no-deps in pkg1 keeps "${tarball()}" because the catalog entry is "^1.0.0"`,
        );

        const pkg1 = { ...pkg1Json, dependencies: { "no-deps": tarball() } };
        expect(await dir.pkg1()).toStrictEqual(pkg1);
        expect(await dir.root()).toStrictEqual(root);
        expect(await dir.pkg2()).toStrictEqual(onCatalog("pkg2"));
        expect(await dir.lockState()).toStrictEqual({
          catalog: { "no-deps": "^1.0.0" },
          workspaces: { ...rootRow, "packages/pkg1": pkg1, "packages/pkg2": onCatalog("pkg2") },
          // Both resolutions stay: the tarball is hoisted and pkg2's catalog resolution is nested under pkg2.
          resolved: { ...tarballResolved, "pkg2/no-deps": "no-deps@1.1.0" },
        });

        await dir.installSavesNothing({ relinks: true });
      });

      // The name is only known after both rows resolved, so this is refused before anything is written; `name@url` binds the declaration instead.
      describe("a name the target already declares", () => {
        const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };

        for (const { title, args } of [
          { title: "alone", args: () => [tarball()] },
          { title: "next to a named package", args: () => ["a-dep", tarball()] },
        ]) {
          test(`is refused without writing anything (${title})`, async () => {
            const root = pretty(workspacesObject({ catalog: {} }));
            const pkg1Text = pretty(pkg1);
            const dir = await createDir(root, pkg1Text);

            const { stderr, exitCode } = await dir.add(dir.pkg1Dir, ...args(), "--catalog");

            expect(stderr).toEndWith(
              `error: --catalog cannot add "${tarball()}": pkg1 already declares no-deps\n  bun add no-deps@${tarball()} --catalog\n`,
            );
            expect(await dir.rootText()).toBe(root);
            expect(await dir.pkg1Text()).toBe(pkg1Text);
            expect(await dir.lockExists()).toBeFalse();
            expect(await dir.installedExists("no-deps")).toBeFalse();
            expect(await dir.installedExists("a-dep")).toBeFalse();
            expect(exitCode).toBe(1);
          });
        }

        test("--filter refuses the whole command when one selected member declares it", async () => {
          const root = pretty(workspacesObject({ catalog: {} }));
          const dir = await createDir(root, pretty(pkg1), withPkg2());
          const pkg2Before = await dir.pkg2Text();

          const { stderr, exitCode } = await dir.add(dir.packageDir, tarball(), "--catalog", "--filter", "pkg*");

          expect(stderr).toEndWith(
            `error: --catalog cannot add "${tarball()}": pkg1 already declares no-deps\n  bun add no-deps@${tarball()} --catalog\n`,
          );
          expect(await dir.rootText()).toBe(root);
          expect(await dir.pkg1Text()).toBe(pretty(pkg1));
          expect(await dir.pkg2Text()).toBe(pkg2Before);
          expect(await dir.lockExists()).toBeFalse();
          expect(exitCode).toBe(1);
        });

        test("the suggested name@url spelling moves the declaration into the catalog", async () => {
          const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);

          expectOk(await dir.add(dir.pkg1Dir, `no-deps@${tarball()}`, "--catalog"));

          const moved = onCatalog("pkg1");
          expect(await dir.pkg1()).toStrictEqual(moved);
          expect((await dir.pkg1Text()).match(/"no-deps"/g)).toHaveLength(1);
          expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": tarball() } }));
          expect((await dir.installed("no-deps")).version).toBe("1.0.0");
          expect(await dir.lockState()).toStrictEqual({
            catalog: { "no-deps": tarball() },
            workspaces: { ...rootRow, "packages/pkg1": moved },
            resolved: tarballResolved,
          });
        });
      });

      test("an absolute local tarball path", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));
        await write(join(dir.packageDir, "vendor", "baz.tgz"), file(join(import.meta.dir, "baz-0.0.3.tgz")));
        const literal = join(dir.packageDir, "vendor", "baz.tgz").replaceAll("\\", "/");

        expectOk(await dir.add(dir.pkg1Dir, literal, "--catalog"));

        const pkg1 = { ...pkg1Json, dependencies: { baz: "catalog:" } };
        expect(await dir.pkg1()).toStrictEqual(pkg1);
        expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { baz: literal } }));
        expect((await dir.installed("baz")).version).toBe("0.0.3");
        expect(await dir.lockState()).toStrictEqual({
          catalog: { baz: literal },
          workspaces: { ...rootRow, "packages/pkg1": pkg1 },
          resolved: { baz: `baz@${literal}` },
        });

        await dir.installSavesNothing({ relinks: true });
      });

      test("a url that fails to resolve writes nothing", async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));
        const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);
        const url = `${registry.registryUrl()}no-deps/-/no-deps-9.9.9.tgz`;

        const { stderr, exitCode } = await dir.add(dir.pkg1Dir, url, "--catalog");

        expect(stderr).toContain(`error: GET ${url} - 404`);
        expect(stderr).toContain(`error: ${url} failed to resolve`);
        expect(await dir.rootText()).toBe(rootBefore);
        expect(await dir.pkg1Text()).toBe(pkg1Before);
        expect(await dir.lockExists()).toBeFalse();
        expect(exitCode).toBe(1);
      });
    });
  });

  describe("workspace sibling", () => {
    const pkg2Message = 'error: --catalog cannot add a workspace package, but "pkg2" is the workspace at packages/pkg2';

    for (const from of ["member", "root"] as const) {
      test(`bare name is refused before anything is written (from ${from})`, async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());
        const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

        const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
        const { stderr, exitCode } = await dir.add(cwd, "pkg2", "--catalog");

        expect(stderr).toContain(pkg2Message);
        expect(await dir.rootText()).toBe(rootBefore);
        expect(await dir.pkg1Text()).toBe(pkg1Before);
        expect(await dir.lockExists()).toBeFalse();
        expect(exitCode).toBe(1);
      });
    }

    for (const positional of ["pkg2", "pkg2@1.0.0"]) {
      test(`${positional} with --filter is refused`, async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());
        const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

        const { stderr, exitCode } = await dir.add(dir.packageDir, positional, "--catalog", "--filter", "pkg1");

        expect(stderr).toContain(pkg2Message);
        expect(await dir.rootText()).toBe(rootBefore);
        expect(await dir.pkg1Text()).toBe(pkg1Before);
        expect(await dir.lockExists()).toBeFalse();
        expect(exitCode).toBe(1);
      });
    }

    test("name@version is refused", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stderr, exitCode } = await dir.add(dir.pkg1Dir, "pkg2@1.0.0", "--catalog");

      expect(stderr).toContain(pkg2Message);
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(exitCode).toBe(1);
    });

    test("the root package's name is refused", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stderr, exitCode } = await dir.add(dir.pkg1Dir, "root", "--catalog");

      expect(stderr).toContain('error: --catalog cannot add a workspace package, but "root" is the workspace root');
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(exitCode).toBe(1);
    });

    test("a sibling whose name also exists on the registry is refused, not cataloged from the registry", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, {
        "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "9.0.0" }),
      });
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stderr, exitCode } = await dir.add(dir.pkg1Dir, "no-deps", "--catalog");

      expect(stderr).toContain(
        'error: --catalog cannot add a workspace package, but "no-deps" is the workspace at packages/no-deps',
      );
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(await dir.installedExists("no-deps")).toBeFalse();
      expect(exitCode).toBe(1);
    });

    for (const from of ["member", "root --filter pkg1"] as const) {
      test(`one refused name aborts the whole add before any network request (from ${from})`, async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());
        const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

        const { stderr, exitCode } =
          from === "member"
            ? await dir.add(dir.pkg1Dir, "a-dep", "pkg2", "--catalog")
            : await dir.add(dir.packageDir, "a-dep", "pkg2", "--catalog", "--filter", "pkg1");

        expect(stderr).toContain(pkg2Message);
        expect(stderr).not.toContain("404");
        expect(stderr).not.toContain("failed to resolve");
        expect(await dir.rootText()).toBe(rootBefore);
        expect(await dir.pkg1Text()).toBe(pkg1Before);
        expect(await dir.lockExists()).toBeFalse();
        expect(await dir.installedExists("a-dep")).toBeFalse();
        expect(exitCode).toBe(1);
      });
    }

    for (const from of ["member", "root"] as const) {
      test(`name@workspace:* is rejected (from ${from})`, async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, withPkg2());
        const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

        const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
        const { stderr, exitCode } = await dir.add(cwd, "pkg2@workspace:*", "--catalog");

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

      const { stderr, exitCode } = await dir.add(dir.packageDir, "pkg2@workspace:*", "--catalog", "--filter", "pkg1");

      expect(stderr).toContain('error: --catalog cannot add a workspace package, but got "pkg2@workspace:*"');
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(exitCode).toBe(1);
    });
  });

  describe("local paths", () => {
    for (const spec of ["foo@file:../vendor/foo", "foo@link:../vendor/foo", "foo@./vendor/foo"]) {
      test(`${spec} is refused`, async () => {
        const dir = await createDir(workspacesObject({ catalog: {} }));
        const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

        const { stderr, exitCode } = await dir.add(dir.pkg1Dir, spec, "--catalog");

        expect(stderr).toContain(
          `error: --catalog cannot add "${spec}": a local path in the catalog would resolve from the workspace root, not from the package that added it`,
        );
        expect(await dir.rootText()).toBe(rootBefore);
        expect(await dir.pkg1Text()).toBe(pkg1Before);
        expect(await dir.lockExists()).toBeFalse();
        expect(exitCode).toBe(1);
      });
    }

    test("a bare relative path is refused as a positional without a name", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stderr, exitCode } = await dir.add(dir.pkg1Dir, "../../vendor/foo", "--catalog");

      expect(stderr).toContain(
        'error: --catalog cannot add "../../vendor/foo": a local path in the catalog would resolve from the workspace root, not from the package that added it',
      );
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(exitCode).toBe(1);
    });

    test("an absolute file: path is cataloged verbatim", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), PKG1, {
        "vendor/foo/package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
      });
      const literal = `file:${join(dir.packageDir, "vendor", "foo").replaceAll("\\", "/")}`;

      expectOk(await dir.add(dir.pkg1Dir, `foo@${literal}`, "--catalog"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { foo: literal } }));
      const pkg1 = { ...pkg1Json, dependencies: { foo: "catalog:" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      // Folder dependencies of a workspace are linked under that workspace's node_modules, not hoisted, and bun.lock
      // records the folder relative to the workspace root.
      expect(await dir.memberInstalled("pkg1", "foo")).toMatchObject({ name: "foo", version: "1.0.0" });
      expect(await dir.lockState()).toStrictEqual({
        catalog: { foo: literal },
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
        resolved: { "pkg1/foo": "foo@file:vendor/foo" },
      });
    });
  });

  describe("--filter", () => {
    // pkg1's "1.0.0" seeded the entry; pkg2 kept its own "1.0.1", which bun.lock nests under pkg2.
    const seededAndKept = {
      catalog: { "no-deps": "1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": onCatalog("pkg1"), "packages/pkg2": onCatalog("pkg2", "1.0.1") },
      resolved: { "no-deps": "no-deps@1.0.0", "pkg2/no-deps": "no-deps@1.0.1" },
    };

    test("'*' alone edits the members and the root catalog, not the root's dependencies", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
        onCatalog("pkg1"),
        withPkg2(),
      );

      expectOk(await dir.add(dir.packageDir, "a-dep", "--catalog", "--filter", "*"));

      const pkg1After = { name: "pkg1", dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" } };
      const pkg2After = { ...pkg2Json, dependencies: { "a-dep": "catalog:" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1After);
      expect(await dir.pkg2()).toStrictEqual(pkg2After);
      const catalog = { "a-dep": "^1.0.10", "no-deps": "^1.0.0" };
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog }));
      expect(await dir.lockState()).toStrictEqual({
        catalog,
        workspaces: { ...rootRow, "packages/pkg1": pkg1After, "packages/pkg2": pkg2After },
        resolved: { "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@1.1.0" },
      });
    });

    test("an existing entry is reused for every selected member", async () => {
      const root = workspacesObject({ catalog: { "no-deps": "^1.0.0" } });
      const dir = await createDir(root, PKG1, withPkg2());

      expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "*"));

      expect(await dir.root()).toStrictEqual(root);
      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect(await dir.pkg2()).toStrictEqual(pkg2OnCatalog);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^1.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog, "packages/pkg2": pkg2OnCatalog },
        resolved: { "no-deps": "no-deps@1.1.0" },
      });
    });

    test("a range declared by any selected member is what gets cataloged", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
        withPkg2(),
      );

      expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg1", "--filter", "pkg2"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      const pkg1 = onCatalog("pkg1");
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.pkg2()).toStrictEqual(pkg2OnCatalog);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^1.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1, "packages/pkg2": pkg2OnCatalog },
        resolved: { "no-deps": "no-deps@1.1.0" },
      });
    });

    // pnpm's rule: the first member declaring a range seeds the entry; later members switch only when equal or an exact version inside it, otherwise they are kept with a note.
    test("members declaring different ranges: the first selected member's range seeds the entry", async () => {
      const pkg2 = pretty({ name: "pkg2", dependencies: { "no-deps": "1.0.1" } });
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "1.0.0" } },
        withPkg2(pkg2),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"),
        'note: no-deps in pkg2 keeps "1.0.1" because the catalog entry is "1.0.0"',
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect(await dir.pkg2Text()).toBe(pkg2);
      expect(await dir.lockState()).toStrictEqual(seededAndKept);

      await dir.installSavesNothing();
    });

    test("a later member whose exact version is inside the seeded range switches to the catalog", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
        withPkg2({ name: "pkg2", dependencies: { "no-deps": "1.0.0" } }),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"),
        'note: no-deps in pkg2 now follows the catalog entry "^1.0.0" instead of "1.0.0"',
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect(await dir.pkg2()).toStrictEqual(onCatalog("pkg2"));
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^1.0.0" },
        workspaces: bothOnCatalog,
        resolved: { "no-deps": "no-deps@1.1.0" },
      });
    });

    test("members declaring the same range are all switched without a note", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
        withPkg2({ name: "pkg2", dependencies: { "no-deps": "^1.0.0" } }),
      );

      expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect(await dir.pkg2()).toStrictEqual(onCatalog("pkg2"));
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^1.0.0" },
        workspaces: bothOnCatalog,
        resolved: { "no-deps": "no-deps@1.1.0" },
      });
    });

    test("a member declaring nothing does not block a later member's range from seeding", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        PKG1,
        withPkg2({ name: "pkg2", dependencies: { "no-deps": "^1.0.0" } }),
      );

      expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect(await dir.pkg2()).toStrictEqual(onCatalog("pkg2"));
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^1.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog, "packages/pkg2": onCatalog("pkg2") },
        resolved: { "no-deps": "no-deps@1.1.0" },
      });
    });

    test("an entry the root already has is used by every selected member, with a note per member that declared something else", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "1.0.0" } }),
        { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } },
        withPkg2({ name: "pkg2", dependencies: { "no-deps": "2.0.0" } }),
      );

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg*"),
        'note: no-deps in pkg1 now follows the catalog entry "1.0.0" instead of "^1.0.0"',
        'note: no-deps in pkg2 now follows the catalog entry "1.0.0" instead of "2.0.0"',
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect(await dir.pkg2()).toStrictEqual(onCatalog("pkg2"));
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "1.0.0" },
        workspaces: bothOnCatalog,
        resolved: { "no-deps": "no-deps@1.0.0" },
      });
    });

    test("--silent prints no notes", async () => {
      const pkg2 = pretty({ name: "pkg2", dependencies: { "no-deps": "1.0.1" } });
      const dir = await createDir(
        workspacesObject({ catalog: {} }),
        { name: "pkg1", dependencies: { "no-deps": "1.0.0" } },
        withPkg2(pkg2),
      );

      const { stdout, stderr, exitCode } = await dir.add(
        dir.packageDir,
        "no-deps",
        "--catalog",
        "--filter",
        "pkg*",
        "--silent",
      );
      expect(stderr).toBe("");
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect(await dir.pkg2Text()).toBe(pkg2);
      expect(await dir.lockState()).toStrictEqual(seededAndKept);
    });

    test("each member keeps its own catalog", async () => {
      const pkg1Row = onCatalog("pkg1", "catalog:legacy");
      const pkg1 = pretty(pkg1Row);
      const dir = await createDir(
        workspacesObject({ catalogs: { legacy: { "no-deps": "1.0.0" } } }),
        pkg1,
        withPkg2({ name: "pkg2" }),
      );

      expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog", "--filter", "pkg1", "--filter", "pkg2"));

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.pkg2()).toStrictEqual(onCatalog("pkg2"));
      expect(await dir.root()).toStrictEqual(
        workspacesObject({ catalogs: { legacy: { "no-deps": "1.0.0" } }, catalog: { "no-deps": "^2.0.0" } }),
      );
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^2.0.0" },
        catalogs: { legacy: { "no-deps": "1.0.0" } },
        workspaces: { ...rootRow, "packages/pkg1": pkg1Row, "packages/pkg2": onCatalog("pkg2") },
        resolved: { "no-deps": "no-deps@1.0.0", "pkg2/no-deps": "no-deps@2.0.0" },
      });

      await dir.installSavesNothing();
    });

    test("edits only the filtered member and the root catalog", async () => {
      const pkg1 = JSON.stringify({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      const dir = await createDir(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }), pkg1, withPkg2());

      expectOk(await dir.add(dir.packageDir, "a-dep", "--catalog", "--filter", "pkg2"));

      const catalog = { "a-dep": "^1.0.10", "no-deps": "^1.0.0" };
      const pkg2 = { ...pkg2Json, dependencies: { "a-dep": "catalog:" } };
      expect(await dir.pkg2()).toStrictEqual(pkg2);
      expect(await dir.pkg1Text()).toBe(pkg1);
      const root = await dir.root();
      expect(root).toStrictEqual(workspacesObject({ catalog }));
      expect(Object.keys(root.workspaces.catalog)).toStrictEqual(["a-dep", "no-deps"]);
      expect((await dir.installed("a-dep")).version).toBe("1.0.10");
      expect(await dir.lockState()).toStrictEqual({
        catalog,
        workspaces: { ...rootRow, "packages/pkg1": JSON.parse(pkg1), "packages/pkg2": pkg2 },
        resolved: { "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@1.1.0" },
      });

      expectOk(await dir.add(dir.packageDir, "a-dep", "--catalog", "--filter", "*", "--filter", "root"));

      const rootAfter = { ...workspacesObject({ catalog }), dependencies: { "a-dep": "catalog:" } };
      const pkg1After = { name: "pkg1", dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" } };
      expect(await dir.root()).toStrictEqual(rootAfter);
      expect(await dir.pkg1()).toStrictEqual(pkg1After);
      expect(await dir.pkg2()).toStrictEqual(pkg2);
      expect(await dir.lockState()).toStrictEqual({
        catalog,
        workspaces: {
          "": { name: "root", dependencies: { "a-dep": "catalog:" } },
          "packages/pkg1": pkg1After,
          "packages/pkg2": pkg2,
        },
        resolved: { "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@1.1.0" },
      });
    });

    test("--only-missing skips members that already have the package", async () => {
      const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
      const dir = await createDir(workspacesObject({ catalog: {} }), pkg1, withPkg2());

      expectOk(
        await dir.add(dir.packageDir, "no-deps", "--catalog", "--only-missing", "--filter", "pkg1", "--filter", "pkg2"),
      );

      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.pkg2()).toStrictEqual(pkg2OnCatalog);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^2.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1, "packages/pkg2": pkg2OnCatalog },
        resolved: { "no-deps": "no-deps@1.1.0", "pkg2/no-deps": "no-deps@2.0.0" },
      });
    });

    test("--only-missing with every member already having the package leaves the catalog empty", async () => {
      const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
      const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);

      expectOk(await dir.add(dir.packageDir, "no-deps", "--catalog", "--only-missing", "--filter", "pkg1"));

      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: {} }));
      expect(await dir.lockState()).toStrictEqual({
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
        resolved: { "no-deps": "no-deps@1.1.0" },
      });
    });
  });

  test("--only-missing when the target already has the package leaves the catalog empty", async () => {
    const pkg1 = { name: "pkg1", dependencies: { "no-deps": "^1.0.0" } };
    const dir = await createDir(workspacesObject({ catalog: {} }), pkg1);
    const rootBefore = await dir.rootText();

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog", "--only-missing"));

    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.rootText()).toBe(rootBefore);
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");
    expect(await dir.lockState()).toStrictEqual({
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "no-deps": "no-deps@1.1.0" },
    });
  });

  // pnpm #9647: an existing entry is moved to the version given on the command line.
  test("explicit version replaces an entry other members reference", async () => {
    const member = (name: string) => JSON.stringify(onCatalog(name));
    const dir = await createDir(
      workspacesObject({ catalog: { "no-deps": "^2.0.0" } }),
      member("pkg1"),
      withPkg2(member("pkg2")),
    );
    await dir.install();
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");

    expectOk(
      await dir.add(dir.pkg1Dir, "no-deps@1.0.0", "--catalog"),
      'note: catalog entry no-deps changed from "^2.0.0" to "1.0.0" (also used by pkg2)',
    );

    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "1.0.0" } }));
    expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
    expect(await dir.pkg2Text()).toBe(member("pkg2"));
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "1.0.0" },
      workspaces: bothOnCatalog,
      resolved: { "no-deps": "no-deps@1.0.0" },
    });

    await dir.installSavesNothing();
  });

  // Bun deviates from pnpm here: pnpm keeps the entry and writes the version directly into the member.
  describe("an explicit version the entry or the target's range does not cover replaces the entry", () => {
    test("entry other members reference", async () => {
      const member = (name: string) => JSON.stringify(onCatalog(name));
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
        member("pkg1"),
        withPkg2(member("pkg2")),
      );
      await dir.install();
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");

      expectOk(
        await dir.add(dir.pkg1Dir, "no-deps@2.0.0", "--catalog"),
        'note: catalog entry no-deps changed from "^1.0.0" to "2.0.0" (also used by pkg2)',
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect(await dir.pkg2Text()).toBe(member("pkg2"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "2.0.0" },
        workspaces: bothOnCatalog,
        resolved: { "no-deps": "no-deps@2.0.0" },
      });
    });

    test("range declared directly by the target", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }), onCatalog("pkg1", "^1.0.0"));
      await dir.install();
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");

      expectOk(await dir.add(dir.pkg1Dir, "no-deps@2.0.0", "--catalog"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "2.0.0" } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "2.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": onCatalog("pkg1") },
        resolved: { "no-deps": "no-deps@2.0.0" },
      });
    });
  });

  test("other dependencies of the target are left alone", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), {
      name: "pkg1",
      dependencies: { "a-dep": "1.0.1" },
    });

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

    const pkg1 = { name: "pkg1", dependencies: { "a-dep": "1.0.1", "no-deps": "catalog:" } };
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
    expect((await dir.installed("a-dep")).version).toBe("1.0.1");
    expect((await dir.installed("no-deps")).version).toBe("2.0.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "^2.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "a-dep": "a-dep@1.0.1", "no-deps": "no-deps@2.0.0" },
    });
  });

  test("existing direct range is converted in place", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }), onCatalog("pkg1", "^1.0.0"));
    await dir.install();
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

    expect(await dir.pkg1Text()).toBe(pretty(onCatalog("pkg1")));
    expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^1.0.0" } }));
    expect((await dir.installed("no-deps")).version).toBe("1.1.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "^1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": onCatalog("pkg1") },
      resolved: { "no-deps": "no-deps@1.1.0" },
    });

    await dir.installSavesNothing();
  });

  test("re-running the same add is idempotent", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));
    expect(await dir.lockState()).toStrictEqual(seededLock);
    const [rootAfter, pkg1After, lockAfter] = await Promise.all([dir.rootText(), dir.pkg1Text(), dir.lockText()]);

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

    expect(await dir.rootText()).toBe(rootAfter);
    expect(await dir.pkg1Text()).toBe(pkg1After);
    expect(await dir.lockText()).toBe(lockAfter);
  });

  test("named catalog with other entries and other named catalogs present", async () => {
    const dir = await createDir(
      workspacesObject({ catalogs: { other: { "a-dep": "1.0.1" }, testing: { "no-deps": "1.0.0" } } }),
    );

    expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=testing"));

    const catalogs = { other: { "a-dep": "1.0.1" }, testing: { "a-dep": "^1.0.10", "no-deps": "1.0.0" } };
    const root = await dir.root();
    expect(root).toStrictEqual(workspacesObject({ catalogs }));
    expect(Object.keys(root.workspaces.catalogs.testing)).toStrictEqual(["a-dep", "no-deps"]);
    const pkg1 = { ...pkg1Json, dependencies: { "a-dep": "catalog:testing" } };
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect((await dir.installed("a-dep")).version).toBe("1.0.10");
    expect(await dir.lockState()).toStrictEqual({
      catalogs,
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "a-dep": "a-dep@1.0.10" },
    });

    await dir.installSavesNothing();
  });

  test("one package failing to resolve writes nothing", async () => {
    const dir = await createDir(workspacesObject({ catalog: {} }));
    const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

    const { stderr, exitCode } = await dir.add(dir.pkg1Dir, "no-deps", "this-package-does-not-exist-xyz", "--catalog");

    expect(stderr).toContain(`error: GET ${registry.registryUrl()}this-package-does-not-exist-xyz - 404`);
    expect(await dir.rootText()).toBe(rootBefore);
    expect(await dir.pkg1Text()).toBe(pkg1Before);
    expect(await dir.lockExists()).toBeFalse();
    expect(await dir.installedExists("no-deps")).toBeFalse();
    expect(exitCode).toBe(1);
  });

  for (const from of ["member", "root"] as const) {
    test(`--no-save installs but writes neither file (from ${from})`, async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const cwd = from === "member" ? dir.pkg1Dir : dir.packageDir;
      const result = await dir.add(cwd, "no-deps", "--catalog", "--no-save");

      expectOk(result);
      expect(result.stdout).toContain("installed no-deps@2.0.0");
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

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

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
    const member = (name: string, ref = "catalog:") => JSON.stringify(onCatalog(name, ref));

    const reuseRows: { flag: string; root: { catalog?: object; catalogs?: object }; reference: string }[] = [
      { flag: "--catalog", root: { catalogs: { default: { "no-deps": "1.0.0" } } }, reference: "catalog:" },
      { flag: "--catalog=default", root: { catalog: { "no-deps": "1.0.0" } }, reference: "catalog:default" },
    ];
    for (const { flag, root, reference } of reuseRows) {
      test(`${flag} reuses the entry spelled ${Object.keys(root)[0]}`, async () => {
        const otherReference = reference === "catalog:" ? "catalog:default" : "catalog:";
        const dir = await createDir(workspacesObject(root), PKG1, withPkg2(member("pkg2", otherReference)));
        await dir.install();
        expect((await dir.installed("no-deps")).version).toBe("1.0.0");

        expectOk(await dir.add(dir.pkg1Dir, "no-deps", flag));

        expect(await dir.root()).toStrictEqual(workspacesObject(root));
        const pkg1 = { ...pkg1Json, dependencies: { "no-deps": reference } };
        expect(await dir.pkg1()).toStrictEqual(pkg1);
        expect(await dir.pkg2Text()).toBe(member("pkg2", otherReference));
        expect((await dir.installed("no-deps")).version).toBe("1.0.0");
        expect(await dir.lockState()).toStrictEqual({
          ...root,
          workspaces: { ...rootRow, "packages/pkg1": pkg1, "packages/pkg2": onCatalog("pkg2", otherReference) },
          resolved: { "no-deps": "no-deps@1.0.0" },
        });

        await dir.installSavesNothing();
      });
    }

    const bothObjects = workspacesObject({
      catalog: { "a-dep": "1.0.1" },
      catalogs: { default: { "no-deps": "1.0.0" } },
    });

    test("both objects present: the one defining the name is reused", async () => {
      const dir = await createDir(bothObjects, PKG1, withPkg2(member("pkg2")));
      await dir.install();
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

      expect(await dir.root()).toStrictEqual(bothObjects);
      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect(await dir.pkg2Text()).toBe(member("pkg2"));
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "a-dep": "1.0.1" },
        catalogs: { default: { "no-deps": "1.0.0" } },
        workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog, "packages/pkg2": onCatalog("pkg2") },
        resolved: { "no-deps": "no-deps@1.0.0" },
      });

      await dir.installSavesNothing();
    });

    test("both objects present: an explicit version replaces the entry where it is defined", async () => {
      const dir = await createDir(bothObjects, PKG1, withPkg2(member("pkg2")));
      await dir.install();
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");

      expectOk(
        await dir.add(dir.pkg1Dir, "no-deps@2.0.0", "--catalog"),
        'note: catalog entry no-deps changed from "1.0.0" to "2.0.0" (also used by pkg2)',
      );

      expect(await dir.root()).toStrictEqual(
        workspacesObject({ catalog: { "a-dep": "1.0.1" }, catalogs: { default: { "no-deps": "2.0.0" } } }),
      );
      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect(await dir.pkg2Text()).toBe(member("pkg2"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "a-dep": "1.0.1" },
        catalogs: { default: { "no-deps": "2.0.0" } },
        workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog, "packages/pkg2": onCatalog("pkg2") },
        resolved: { "no-deps": "no-deps@2.0.0" },
      });
    });

    test("--catalog with an explicit version replaces the catalogs.default entry instead of adding a second catalog", async () => {
      const dir = await createDir(
        workspacesObject({ catalogs: { default: { "no-deps": "1.0.0" } } }),
        member("pkg1"),
        withPkg2(member("pkg2", "catalog:default")),
      );
      await dir.install();
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");

      expectOk(
        await dir.add(dir.pkg1Dir, "no-deps@2.0.0", "--catalog"),
        'note: catalog entry no-deps changed from "1.0.0" to "2.0.0" (also used by pkg2)',
      );

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { default: { "no-deps": "2.0.0" } } }));
      expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1"));
      expect(await dir.pkg2Text()).toBe(member("pkg2", "catalog:default"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalogs: { default: { "no-deps": "2.0.0" } },
        workspaces: {
          ...rootRow,
          "packages/pkg1": onCatalog("pkg1"),
          "packages/pkg2": onCatalog("pkg2", "catalog:default"),
        },
        resolved: { "no-deps": "no-deps@2.0.0" },
      });
    });

    test("--catalog=default with an explicit range replaces the singular catalog every catalog: reference resolves through", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
        PKG1,
        withPkg2(member("pkg2")),
      );
      await dir.install();
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");

      expectOk(
        await dir.add(dir.pkg1Dir, "no-deps@^2.0.0", "--catalog=default"),
        'note: catalog entry no-deps changed from "^1.0.0" to "^2.0.0" (also used by pkg2)',
      );

      const pkg1 = { ...pkg1Json, dependencies: { "no-deps": "catalog:default" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      expect(await dir.pkg2Text()).toBe(member("pkg2"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "no-deps": "^2.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1, "packages/pkg2": onCatalog("pkg2") },
        resolved: { "no-deps": "no-deps@2.0.0" },
      });
    });

    test("--catalog=default with no catalog defined creates the singular catalog", async () => {
      const dir = await createDir(workspacesObject());

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog=default"));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalog: { "no-deps": "^2.0.0" } }));
      const pkg1 = { ...pkg1Json, dependencies: { "no-deps": "catalog:default" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({ ...seededLock, workspaces: { ...rootRow, "packages/pkg1": pkg1 } });
    });

    test("bun update --latest refreshes a catalogs.default entry referenced as catalog:", async () => {
      const dir = await createDir(workspacesObject({ catalogs: { default: { "no-deps": "^1.0.0" } } }), member("pkg1"));
      await dir.install();
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");

      expectOk(await dir.run(dir.packageDir, ["update", "--latest"]));

      expect(await dir.root()).toStrictEqual(workspacesObject({ catalogs: { default: { "no-deps": "^2.0.0" } } }));
      expect(await dir.pkg1Text()).toBe(member("pkg1"));
      expect((await dir.installed("no-deps")).version).toBe("2.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalogs: { default: { "no-deps": "^2.0.0" } },
        workspaces: { ...rootRow, "packages/pkg1": onCatalog("pkg1") },
        resolved: { "no-deps": "no-deps@2.0.0" },
      });

      await dir.installSavesNothing();
    });

    test("bun pm pack substitutes a catalogs.default entry referenced as catalog:", async () => {
      const dir = await createDir(workspacesObject({ catalogs: { default: { "no-deps": ">=1.0.0" } } }), {
        name: "pkg1",
        version: "1.0.0",
        peerDependencies: { "no-deps": "catalog:" },
      });
      // pack reads the catalog through bun.lock, so the workspace has to be installed first.
      await dir.install();

      expectOk(await dir.run(dir.pkg1Dir, ["pm", "pack"]));

      const tarball = readTarball(join(dir.pkg1Dir, "pkg1-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents)).toStrictEqual({
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

    // pack reads the catalog through bun.lock, which this add writes.
    expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=x"));
    expect(await dir.pkg1()).toStrictEqual({
      ...pkg1Json,
      peerDependencies: { "no-deps": "catalog:" },
      dependencies: { "a-dep": "catalog:x" },
    });

    expectOk(await dir.run(dir.pkg1Dir, ["pm", "pack"]));

    const tarball = readTarball(join(dir.pkg1Dir, "pkg1-1.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents)).toStrictEqual({
      name: "pkg1",
      version: "1.0.0",
      peerDependencies: { "no-deps": ">=1.0.0" },
      dependencies: { "a-dep": "^1.0.10" },
    });
  });

  // pnpm #10456: removing the last reference to an entry does not drop the catalog from bun.lock.
  test("bun remove from members keeps the catalog definitions", async () => {
    const dir = await createDir(
      workspacesObject({ catalog: { "no-deps": "1.0.0" } }),
      onCatalog("pkg1"),
      withPkg2(onCatalog("pkg2")),
    );

    expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog=libs"));
    for (const cwd of [dir.pkg1Dir, dir.pkg2Dir]) {
      const removed = await dir.run(cwd, ["remove", "no-deps"]);
      expectOk(removed);
      expect(removed.stdout).toContain("- no-deps");
    }

    const pkg1 = { name: "pkg1", dependencies: { "a-dep": "catalog:libs" } };
    const pkg2 = { name: "pkg2" };
    expect(await dir.pkg1()).toStrictEqual(pkg1);
    expect(await dir.pkg2()).toStrictEqual(pkg2);
    expect(await dir.root()).toStrictEqual(
      workspacesObject({ catalog: { "no-deps": "1.0.0" }, catalogs: { libs: { "a-dep": "^1.0.10" } } }),
    );
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "1.0.0" },
      catalogs: { libs: { "a-dep": "^1.0.10" } },
      workspaces: { ...rootRow, "packages/pkg1": pkg1, "packages/pkg2": pkg2 },
      resolved: { "a-dep": "a-dep@1.0.10" },
    });

    await dir.installSavesNothing();
  });

  // pnpm #8795: --frozen-lockfile notices a changed catalog entry.
  for (const from of ["member", "root"] as const) {
    test(`--frozen-lockfile passes after the add and fails once the entry is edited (from ${from})`, async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));

      expectOk(await dir.add(from === "member" ? dir.pkg1Dir : dir.packageDir, "no-deps", "--catalog"));

      const frozen = await dir.run(dir.packageDir, ["install", "--frozen-lockfile"]);
      expectOk(frozen);
      expect(frozen.stdout).toContain("(no changes)");

      const root = await dir.root();
      root.workspaces.catalog["no-deps"] = "1.0.0";
      await write(dir.rootPath, JSON.stringify(root));

      const { stderr, exitCode } = await dir.run(dir.packageDir, ["install", "--frozen-lockfile"]);
      expect(stderr).toContain("error: lockfile had changes, but lockfile is frozen");
      expect(stderr).toContain("note: the catalog in package.json changed since bun.lock was saved");
      expect((await dir.lockState()).catalog).toStrictEqual({ "no-deps": "^2.0.0" });
      expect(exitCode).toBe(1);
    });
  }

  // pnpm #12115 / #11591: update never replaces a `catalog:` reference, even with an override or an explicit spec.
  describe("catalog: references with an override", () => {
    const pkg1 = onCatalog("pkg1");
    const overriddenRoot = {
      ...workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
      overrides: { "no-deps": "1.0.0" },
    };
    const overriddenLock = {
      catalog: { "no-deps": "^1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      resolved: { "no-deps": "no-deps@1.0.0" },
    };

    for (const args of [["update"], ["update", "--recursive"], ["update", "no-deps"], ["update", "no-deps@1.1.0"]]) {
      test(`survive bun ${args.join(" ")}`, async () => {
        const dir = await createDir(overriddenRoot, pkg1);
        await dir.install();
        expect((await dir.installed("no-deps")).version).toBe("1.0.0");

        const result = await dir.run(dir.pkg1Dir, args);
        expectOk(result);
        expect(result.stdout).toContain("(no changes)");

        expect(await dir.pkg1()).toStrictEqual(pkg1);
        expect(await dir.root()).toStrictEqual(overriddenRoot);
        expect((await dir.installed("no-deps")).version).toBe("1.0.0");
        expect(await dir.lockState()).toStrictEqual(overriddenLock);
      });
    }

    test("survive bun add --catalog of another package", async () => {
      const dir = await createDir(overriddenRoot, pkg1);

      expectOk(await dir.add(dir.pkg1Dir, "a-dep", "--catalog"));

      const pkg1After = { name: "pkg1", dependencies: { "a-dep": "catalog:", "no-deps": "catalog:" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1After);
      expect(await dir.root()).toStrictEqual({
        ...overriddenRoot,
        ...workspacesObject({ catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" } }),
      });
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");
      expect(await dir.lockState()).toStrictEqual({
        catalog: { "a-dep": "^1.0.10", "no-deps": "^1.0.0" },
        workspaces: { ...rootRow, "packages/pkg1": pkg1After },
        resolved: { "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@1.0.0" },
      });
    });
  });

  // pnpm #9660: overrides win at resolution, so the catalog records the overridden version.
  test("an override decides what --catalog records", async () => {
    const dir = await createDir({ ...workspacesObject({ catalog: {} }), overrides: { "no-deps": "1.0.0" } });

    expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--catalog"));

    expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
    expect(await dir.root()).toStrictEqual({
      ...workspacesObject({ catalog: { "no-deps": "^1.0.0" } }),
      overrides: { "no-deps": "1.0.0" },
    });
    expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    expect(await dir.lockState()).toStrictEqual({
      catalog: { "no-deps": "^1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog },
      resolved: { "no-deps": "no-deps@1.0.0" },
    });

    await dir.installSavesNothing();
  });

  // pnpm: a bare `add <name>` in a workspace whose default catalog lists <name> writes `catalog:`.
  describe("plain bun add uses the default catalog", () => {
    const defaultRoot = workspacesObject({ catalog: { "no-deps": "^1.0.0" } });
    // bun.lock after pkg1 was put on the existing default entry.
    const referencedLock = {
      catalog: { "no-deps": "^1.0.0" },
      workspaces: { ...rootRow, "packages/pkg1": pkg1OnCatalog },
      resolved: { "no-deps": "no-deps@1.1.0" },
    };

    test("bare name from a member", async () => {
      const dir = await createDir(defaultRoot);
      const rootBefore = await dir.rootText();

      expectOk(await dir.add(dir.pkg1Dir, "no-deps"));

      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect(await dir.rootText()).toBe(rootBefore);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
      expect(await dir.lockState()).toStrictEqual(referencedLock);

      await dir.installSavesNothing();
    });

    test("bare name from the root", async () => {
      const dir = await createDir(defaultRoot);

      expectOk(await dir.add(dir.packageDir, "no-deps"));

      expect(await dir.root()).toStrictEqual({ ...defaultRoot, dependencies: { "no-deps": "catalog:" } });
      expect(await dir.pkg1Text()).toBe(PKG1);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
      expect(await dir.lockState()).toStrictEqual({ ...referencedLock, workspaces: rootOnCatalog });
    });

    for (const { title, args } of [
      { title: "bare name", args: ["no-deps"] },
      { title: "a spec equal to the entry text", args: ["no-deps@^1.0.0"] },
    ]) {
      test(`${title} with the default catalog spelled catalogs.default`, async () => {
        const root = pretty(workspacesObject({ catalogs: { default: { "no-deps": "^1.0.0" } } }));
        const dir = await createDir(root);

        expectOk(await dir.add(dir.pkg1Dir, ...args));

        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        expect(await dir.rootText()).toBe(root);
        expect((await dir.installed("no-deps")).version).toBe("1.1.0");
        expect(await dir.lockState()).toStrictEqual({
          catalogs: { default: { "no-deps": "^1.0.0" } },
          workspaces: referencedLock.workspaces,
          resolved: referencedLock.resolved,
        });
      });
    }

    test("--dev writes the reference into devDependencies", async () => {
      const dir = await createDir(defaultRoot);
      const rootBefore = await dir.rootText();

      expectOk(await dir.add(dir.pkg1Dir, "no-deps", "--dev"));

      const pkg1 = { ...pkg1Json, devDependencies: { "no-deps": "catalog:" } };
      expect(await dir.pkg1()).toStrictEqual(pkg1);
      expect(await dir.rootText()).toBe(rootBefore);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
      expect(await dir.lockState()).toStrictEqual({
        ...referencedLock,
        workspaces: { ...rootRow, "packages/pkg1": pkg1 },
      });
    });

    for (const { title, args } of [
      { title: "bun install <pkg>", args: ["install", "no-deps"] },
      { title: "a spec equal to the entry text", args: ["add", "no-deps@^1.0.0"] },
      { title: "--exact", args: ["add", "no-deps", "--exact"] },
      { title: "-E", args: ["add", "no-deps", "-E"] },
    ]) {
      test(`${title} writes the reference like a bare add`, async () => {
        const dir = await createDir(defaultRoot);
        const rootBefore = await dir.rootText();

        expectOk(await dir.run(dir.pkg1Dir, args));

        expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
        expect(await dir.rootText()).toBe(rootBefore);
        expect((await dir.installed("no-deps")).version).toBe("1.1.0");
        expect(await dir.lockState()).toStrictEqual(referencedLock);
      });
    }

    test("--filter writes the reference into every selected member", async () => {
      const dir = await createDir(defaultRoot, PKG1, withPkg2());
      const rootBefore = await dir.rootText();

      expectOk(await dir.add(dir.packageDir, "no-deps", "--filter", "pkg1", "--filter", "pkg2"));

      expect(await dir.pkg1()).toStrictEqual(pkg1OnCatalog);
      expect(await dir.pkg2()).toStrictEqual(pkg2OnCatalog);
      expect(await dir.rootText()).toBe(rootBefore);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
      expect(await dir.lockState()).toStrictEqual({
        ...referencedLock,
        workspaces: { ...referencedLock.workspaces, "packages/pkg2": pkg2OnCatalog },
      });
    });

    test("re-adding a package already on catalog: keeps the reference", async () => {
      const pkg1 = pretty({ name: "pkg1", dependencies: { "no-deps": "catalog:" } });
      const dir = await createDir(defaultRoot, pkg1);
      await dir.install();
      const [rootBefore, lockBefore] = await Promise.all([dir.rootText(), dir.lockText()]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps"));

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.lockText()).toBe(lockBefore);
      expect((await dir.installed("no-deps")).version).toBe("1.1.0");
    });

    test("an existing named reference is kept", async () => {
      const pkg1 = pretty({ name: "pkg1", dependencies: { "no-deps": "catalog:libs" } });
      const dir = await createDir(workspacesObject({ catalogs: { libs: { "no-deps": "1.0.0" } } }), pkg1);
      await dir.install();
      const [rootBefore, lockBefore] = await Promise.all([dir.rootText(), dir.lockText()]);

      expectOk(await dir.add(dir.pkg1Dir, "no-deps"));

      expect(await dir.pkg1Text()).toBe(pkg1);
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.lockText()).toBe(lockBefore);
      expect((await dir.installed("no-deps")).version).toBe("1.0.0");
    });

    describe("explicit versions and unlisted names are added normally", () => {
      for (const { spec, written, installed, resolved } of [
        {
          spec: "no-deps@1.0.0",
          written: { "no-deps": "1.0.0" },
          installed: "1.0.0",
          resolved: { "no-deps": "no-deps@1.0.0" },
        },
        {
          spec: "no-deps@latest",
          written: { "no-deps": "^2.0.0" },
          installed: "2.0.0",
          resolved: { "no-deps": "no-deps@2.0.0" },
        },
        {
          spec: "no-deps@^2.0.0",
          written: { "no-deps": "^2.0.0" },
          installed: "2.0.0",
          resolved: { "no-deps": "no-deps@2.0.0" },
        },
        { spec: "a-dep", written: { "a-dep": "^1.0.10" }, installed: "1.0.10", resolved: { "a-dep": "a-dep@1.0.10" } },
        {
          spec: "@types/no-deps",
          written: { "@types/no-deps": "^2.0.0" },
          installed: "2.0.0",
          resolved: { "@types/no-deps": "@types/no-deps@2.0.0" },
        },
        {
          spec: "foo@npm:no-deps",
          written: { foo: "npm:no-deps@^2.0.0" },
          installed: "2.0.0",
          resolved: { foo: "no-deps@2.0.0" },
        },
      ]) {
        test(`bun add ${spec}`, async () => {
          const dir = await createDir(defaultRoot);
          const rootBefore = await dir.rootText();

          expectOk(await dir.add(dir.pkg1Dir, spec));

          const pkg1 = { ...pkg1Json, dependencies: written };
          expect(await dir.pkg1()).toStrictEqual(pkg1);
          expect(await dir.rootText()).toBe(rootBefore);
          expect((await dir.installed(Object.keys(written)[0])).version).toBe(installed);
          expect(await dir.lockState()).toStrictEqual({
            catalog: { "no-deps": "^1.0.0" },
            workspaces: { ...rootRow, "packages/pkg1": pkg1 },
            resolved,
          });
        });
      }

      test("an explicit version replaces a named reference", async () => {
        const dir = await createDir(
          workspacesObject({ catalogs: { libs: { "no-deps": "1.0.0" } } }),
          onCatalog("pkg1", "catalog:libs"),
        );
        const rootBefore = await dir.rootText();

        expectOk(await dir.add(dir.pkg1Dir, "no-deps@1.1.0"));

        expect(await dir.pkg1()).toStrictEqual(onCatalog("pkg1", "1.1.0"));
        expect(await dir.rootText()).toBe(rootBefore);
        expect((await dir.installed("no-deps")).version).toBe("1.1.0");
        expect(await dir.lockState()).toStrictEqual({
          catalogs: { libs: { "no-deps": "1.0.0" } },
          workspaces: { ...rootRow, "packages/pkg1": onCatalog("pkg1", "1.1.0") },
          resolved: { "no-deps": "no-deps@1.1.0" },
        });
      });

      test("named catalogs are not used without the flag", async () => {
        const dir = await createDir(workspacesObject({ catalogs: { libs: { "no-deps": "1.0.0" } } }));
        const rootBefore = await dir.rootText();

        expectOk(await dir.add(dir.pkg1Dir, "no-deps"));

        const pkg1 = { ...pkg1Json, dependencies: { "no-deps": "^2.0.0" } };
        expect(await dir.pkg1()).toStrictEqual(pkg1);
        expect(await dir.rootText()).toBe(rootBefore);
        expect((await dir.installed("no-deps")).version).toBe("2.0.0");
        expect(await dir.lockState()).toStrictEqual({
          catalogs: { libs: { "no-deps": "1.0.0" } },
          workspaces: { ...rootRow, "packages/pkg1": pkg1 },
          resolved: { "no-deps": "no-deps@2.0.0" },
        });
      });
    });
  });

  describe("errors", () => {
    test("root package.json without workspaces", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted", saveTextLockfile: true },
        files: { "package.json": JSON.stringify({ name: "solo" }) },
      });
      const before = await file(join(packageDir, "package.json")).text();

      const { stderr, exitCode } = await spawnBun(packageDir, ["add", "no-deps", "--catalog"], envFor(packageDir));

      expect(stderr).toContain('error: --catalog requires a "workspaces" field in the root package.json');
      expect(await file(join(packageDir, "package.json")).text()).toBe(before);
      expect(await file(join(packageDir, "bun.lock")).exists()).toBeFalse();
      expect(exitCode).toBe(1);
    });

    test("a root defining a package in both catalog and catalogs.default is rejected before anything is written", async () => {
      const dir = await createDir(
        workspacesObject({ catalog: { "no-deps": "1.0.0" }, catalogs: { default: { "no-deps": "2.0.0" } } }),
      );
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stderr, exitCode } = await dir.add(dir.pkg1Dir, "a-dep", "--catalog");

      expect(stderr).toContain(
        'error: "no-deps" is defined in both "catalog" and "catalogs.default"; keep one of them',
      );
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(await dir.installedExists("a-dep")).toBeFalse();
      expect(exitCode).toBe(1);
    });

    test("bun install --catalog without packages", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);

      const { stdout, stderr, exitCode } = await dir.run(dir.packageDir, ["install", "--catalog"]);

      expect(stdout).toBe("");
      expect(stderr).toBe("error: no package specified to add\n");
      expect(await dir.rootText()).toBe(rootBefore);
      expect(await dir.pkg1Text()).toBe(pkg1Before);
      expect(await dir.lockExists()).toBeFalse();
      expect(exitCode).toBe(1);
    });

    test("--catalog with --global", async () => {
      const dir = await createDir(workspacesObject({ catalog: {} }));
      const [rootBefore, pkg1Before] = await Promise.all([dir.rootText(), dir.pkg1Text()]);
      const globalDir = join(dir.packageDir, ".bun-global");

      const { stderr, exitCode } = await dir.run(dir.pkg1Dir, ["add", "no-deps", "--catalog", "-g"], {
        ...dir.env,
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
