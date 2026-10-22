import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  githubTarball,
  hostedGitRepository,
  isWindows,
  nodeModulesPackages,
  tempDir,
  unprivilegedSpawnOptions,
} from "harness";
import { dirname, join } from "path";
import { TestRegistry } from "registry";
import { yamlAliasChain } from "./migration-harness";

const verdaccio = new TestRegistry();

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
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return { stdout, stderr, exitCode };
}

function migrate(cwd: string, ...flags: string[]) {
  return run(cwd, "pm", "migrate", ...flags);
}

function fixture(name: string) {
  return tempDir(`pnpm-${name}`, join(import.meta.dir, "pnpm", name));
}

async function bunLockOf(dir: string) {
  return await Bun.file(join(dir, "bun.lock")).text();
}

// A migrated bun.lock is complete when the install after it finds nothing to save.
async function expectInstallToLeaveUnchanged(dir: string, migratedBunLock: string) {
  const install = await run(dir, "install");

  expect(install.stderr).not.toContain("Saved lockfile");
  expect(install.stderr).not.toContain("error:");
  expect(install.exitCode).toBe(0);
  expect(await bunLockOf(dir)).toBe(migratedBunLock);
}

function workspacesSection(bunLock: string) {
  const start = bunLock.indexOf(`  "workspaces": {`);
  const end = bunLock.indexOf(`  "packages": {`);
  expect(start).not.toBe(-1);
  expect(end).not.toBe(-1);
  return bunLock.slice(start, end);
}

// bun.lock writes `catalog` and `catalogs` between the workspaces and packages sections.
function catalogSections(bunLock: string) {
  const workspacesEnd = bunLock.indexOf("\n  },\n", bunLock.indexOf(`  "workspaces": {`));
  const packagesStart = bunLock.indexOf(`  "packages": {`);
  expect(workspacesEnd).not.toBe(-1);
  expect(packagesStart).not.toBe(-1);
  return bunLock.slice(workspacesEnd + "\n  },\n".length, packagesStart);
}

function workspaceBlock(bunLock: string, key: string) {
  const start = bunLock.indexOf(`    "${key}": {\n`);
  expect(start).not.toBe(-1);
  const end = bunLock.indexOf("\n    },", start);
  expect(end).not.toBe(-1);
  return bunLock.slice(start, end + "\n    },".length);
}

async function installedPackageJson(root: string, workspace: string, name: string) {
  const nested = Bun.file(join(root, workspace, "node_modules", name, "package.json"));
  return await ((await nested.exists()) ? nested : Bun.file(join(root, "node_modules", name, "package.json"))).json();
}

const PKG_A_GIT = "pkg-a@git+ssh://git@example.com/org/pkg-a.git#0123456789abcdef0123456789abcdef01234567";
const NO_DEPS_1_0_0_INTEGRITY =
  "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==";
const NO_DEPS_1_0_1_INTEGRITY =
  "sha512-3X6cn4+UJdXJuLPu11v8i/fGLe2PdI6v1yKTELam04lY5esCAFdG/qQts6N6rLrL6g1YRq+MKBAwxbmUQk355A==";
const NO_DEPS_1_1_0_INTEGRITY =
  "sha512-ebG2pipYAKINcNI3YxdsiAgFvNGp2gdRwxAKN2LYBm9+YxuH/lHH2sl+GKQTuGiNfCfNZRMHUyyLPEJD6HWm7w==";
const NO_DEPS_2_0_0_INTEGRITY =
  "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g==";
const ONE_DEP_1_0_0_INTEGRITY =
  "sha512-qG6lZjwM1vFmRCHwP+XpOKu6FkrBmwr20+54+qaHGdjZlw/wz8aJrhFqX4dZksqmBLZtj2mzL77Yf04WKs1+Kg==";
const A_DEP_1_0_1_INTEGRITY =
  "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg==";
const PEER_DEPS_1_0_0_INTEGRITY =
  "sha512-CHQ5sQXwUo38G++dkzJ/rJ9Ge98MeMTQjjC9UK2t0frp8Lrhm3zNooOLakFyHW4UcyD3vuTS3Qv324Bj6B5Tjw==";
const PEER_DEPS_FIXED_1_0_0_INTEGRITY =
  "sha512-gVs9cSdy6TAQIEWu1tVEK1mAspCQxYziTGQlv4a2XQpzOBZvoQ/y6lOeu3tqNNrNQnLwdvwAQTlvazV5+HfV7g==";
const PEER_DEPS_TOO_1_0_0_INTEGRITY =
  "sha512-sBx0TKrsB8FkRN2lzkDjMuctPGEKn1TmNUBv3dJOtnZM8nd255o5ZAPRpAI2XFLHZAavBlK/e73cZNwnUxlRog==";
const ONE_OPTIONAL_PEER_DEP_1_0_2_INTEGRITY =
  "sha512-S25U8/QXGIKfn/AWtsce1aVMnDjDL+ykFtAufpsuKGad32NlsCpi9TDuXvzoTQ+MdaZpGV3c4xghUZUsNeMp4A==";
const STRICT_PEER_DEP_1_0_0_INTEGRITY =
  "sha512-bz2RC/Fp4Nvc9aIiHB6Szko9m6sxNy/clIHnTAGeD9VSpQJTvlPAJqJ09lWo7N3q4JNLEqDTf3Mn+zNUsYOKWQ==";
const NORMAL_DEP_AND_DEV_DEP_1_0_1_INTEGRITY =
  "sha512-MzZS9lLNBdqXf/lI+TKlXGeWrcDkOjzdSPJtvkRUN1FUjXg2DcGVldEqx9D8kNwF87Hxf2cRLvLv4a8GqZ6zPg==";
const LOCAL_TARBALL_INTEGRITY =
  "sha512-HP/5Rgt3pVFLzjmN9qJJ6vZMgCwoCIl/m2bPndYT283CUqnmFiMx0GeeIJ7SyK6TYoJM78SEvFEOQie++caHqw==";

function registryLockfileWithTarball(tarball: string) {
  return `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}, tarball: ${tarball}}

snapshots:

  no-deps@1.0.1: {}
`;
}

function registryQualifiedNoDepsLockfile(registry: string) {
  return `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: ${registry}:1.0.1

packages:

  no-deps@${registry}:1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@${registry}:1.0.1: {}
`;
}

// Every case works in its own directory and only reads from the shared registry.
// The two toMatchSnapshot cases are test.serial: snapshot matchers are unsupported inside a concurrent group.
describe.concurrent("pnpm-lock.yaml v9", () => {
  test.serial("v9 git and userinfo-tarball references migrate", async () => {
    using dir = fixture("v9-git-references");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));

    expect(bunLock).toContain(`"pkg-a": "git+ssh://git@example.com/org/pkg-a.git#v1"`);
    expect(bunLock).toContain(`"hue": "github:org/hue#ec3d1d1"`);
    expect(bunLock).toContain(`"${PKG_A_GIT}"`);
    expect(bunLock).toContain(
      `"pkg-b": "git+ssh://git@example.com/org/pkg-b.git#89abcdef0123456789abcdef0123456789abcdef"`,
    );
    expect(bunLock).toContain(
      `"pkg-b@git+ssh://git@example.com/org/pkg-b.git#89abcdef0123456789abcdef0123456789abcdef"`,
    );
    expect(bunLock).toContain(`"hue@git+ssh://git@example.com:org/hue.git#ec3d1d18f73ab023b1fa3e31e1f4316f476566a5"`);
    expect(bunLock).toContain(`"priv@https://token@tarballs.example.com/priv-1.0.0.tgz"`);
    expect(bunLock).toContain(`"priv": "https://token@tarballs.example.com/priv-1.0.0.tgz"`);
    expect(bunLock).not.toContain("npm:");

    expect(bunLock).toMatchSnapshot("bun.lock");
  });

  test("v9 alias in snapshot optionalDependencies gets the npm: prefix", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/v9-alias-in-optional-dependencies"),
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(packageDir);

    expect(bunLock).toContain(`"aliased-no-deps": "npm:no-deps@2.0.0"`);
    expect(bunLock).toContain(`"aliased-no-deps": ["no-deps@2.0.0"`);

    const install = await run(packageDir, "install", "--frozen-lockfile");

    expect(install.stderr).not.toContain("error:");
    expect(install.stdout).toContain("packages installed");
    expect(install.exitCode).toBe(0);

    expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
      "node_modules/aliased-no-deps/no-deps@2.0.0
      node_modules/no-deps/no-deps@1.0.1
      node_modules/one-dep/one-dep@1.0.0"
    `);
  });

  test.concurrent("reports the missing packages entry", async () => {
    using dir = fixture("v9-missing-package-entry");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain(
      "pnpm-lock.yaml has no package entry 'no-deps@1.0.0' for dependency 'no-deps' of importer '.'",
    );
    expect(stderr).toContain("error: failed to migrate lockfile: InvalidLockfile");
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
  });

  test.concurrent("reports the missing packages entry of a workspace importer", async () => {
    using dir = fixture("v9-missing-package-entry-workspace");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain(
      "pnpm-lock.yaml has no package entry 'no-deps@1.0.0' for dependency 'no-deps' of importer 'packages/a'",
    );
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
  });

  test.concurrent("reports the missing packages entry of a transitive dependency", async () => {
    using dir = fixture("v9-missing-package-entry-transitive");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain(
      "pnpm-lock.yaml has no package entry 'no-deps@9.9.9' for dependency 'no-deps' of package 'pkg-a'",
    );
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
  });

  test.concurrent("reports an importer whose package.json is missing", async () => {
    using dir = fixture("v9-missing-importer-package-json");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain(
      "pnpm-lock.yaml lists importer 'packages/gone' but 'packages/gone/package.json' does not exist",
    );
    expect(stderr).toContain("error: failed to migrate lockfile: InvalidLockfile");
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
  });

  // pnpm lists every directory matched by pnpm-workspace.yaml as an importer, including
  // test fixtures whose package.json has no "name" (vite has dozens). Those are not
  // workspace packages to bun; the migration and the later workspace scan both skip them.
  describe("importer whose package.json has no name", () => {
    const fixtureDir = "packages/a/__tests__/fixtures/esm";
    const files = {
      "package.json": JSON.stringify({
        name: "nameless-importer-root",
        private: true,
        dependencies: { a: "workspace:*" },
      }),
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - 'packages/**/__tests__/**'\n",
      "packages/a/package.json": JSON.stringify({ name: "a" }),
    };
    const rootImporter = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      a:
        specifier: workspace:*
        version: link:packages/a

  packages/a: {}
`;

    async function migrateThenFrozenInstall(dir: string) {
      const { stderr, exitCode } = await migrate(dir);
      expect(stderr).toContain("copied pnpm-workspace.yaml to workspaces in package.json");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(stderr).not.toContain("warn:");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(dir);
      expect(workspacesSection(migrated)).toBe(`  "workspaces": {
    "": {
      "name": "nameless-importer-root",
      "dependencies": {
        "a": "workspace:*",
      },
    },
    "packages/a": {
      "name": "a",
    },
  },
`);
      expect((await Bun.file(join(dir, "package.json")).json()).workspaces).toStrictEqual([
        "packages/*",
        "packages/**/__tests__/**",
      ]);

      // The migrated package.json now matches the fixture through the glob; the
      // workspace scan has to agree with the migration for a frozen install to pass.
      const install = await run(dir, "install", "--frozen-lockfile", "--linker", "hoisted");
      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await bunLockOf(dir)).toBe(migrated);
      expect(await installedPackageJson(dir, "", "a")).toStrictEqual({ name: "a" });
      return { migrated, install };
    }

    test.concurrent("is skipped", async () => {
      using dir = tempDir("pnpm-v9-nameless-importer", {
        ...files,
        [`${fixtureDir}/package.json`]: JSON.stringify({ type: "module" }),
        "pnpm-lock.yaml": `${rootImporter}
  ${fixtureDir}: {}
`,
      });

      const { install } = await migrateThenFrozenInstall(String(dir));
      expect(install.stderr).not.toContain("warn:");
    });

    test.concurrent("its dependencies are not migrated, and bun install warns about them", async () => {
      using dir = tempDir("pnpm-v9-nameless-importer-with-deps", {
        ...files,
        [`${fixtureDir}/package.json`]: JSON.stringify({ type: "module", dependencies: { "no-deps": "^1.0.0" } }),
        "pnpm-lock.yaml": `${rootImporter}
  ${fixtureDir}:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}
`,
      });

      const { migrated, install } = await migrateThenFrozenInstall(String(dir));
      expect(migrated).not.toContain("no-deps");
      expect(install.stderr).toContain(`warn: skipping workspace "${fixtureDir}": package.json has no "name"\n`);
    });
  });

  test("registry-qualified dep path resolves from the configured registry with a warning", async () => {
    // shape from pnpm11/deps/path/test/index.ts parse() `foo@work:1.0.0`
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "registry-qualified", dependencies: { "no-deps": "^1.0.0" } }),
        "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work"),
      },
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderr).toContain(
      'warn: skipping pnpm registry "work" from pnpm-lock.yaml: not in namedRegistries of pnpm-workspace.yaml (resolving its packages from the configured registry)',
    );
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(packageDir);
    expect(bunLock).toContain(`"no-deps@1.0.1"`);
    expect(bunLock).not.toContain("work:");
    expect(bunLock).not.toContain("git+ssh");
  });

  describe("named registries", () => {
    // pnpm11/lockfile/utils/src/pkgSnapshotToResolution.ts: named registry -> scope registry -> default
    test("built-in npmjs: entries record the npmjs registry", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "npmjs-qualified", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("npmjs"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain(
        'warn: fetching pnpm registry "npmjs" packages from https://registry.npmjs.org/; add it to bunfig.toml or .npmrc if it needs authentication',
      );
      expect(stderr).not.toContain("not in namedRegistries");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      // bun.lock spells the default registry as "" (bun.lock.rs url_is_under_registry(DEFAULT_URL)).
      expect(bunLock).toContain(`["no-deps@1.0.1", "", {}, "${NO_DEPS_1_0_1_INTEGRITY}"]`);
      expect(bunLock).not.toContain(verdaccio.registryUrl());
      expect(bunLock).not.toContain("npmjs:");
    });

    test("namedRegistries entry pointing at the configured registry needs no warning", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "named-registry-same", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `namedRegistries:\n  work: ${verdaccio.registryUrl()}\n`,
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("pnpm registry");
      expect(stderr).not.toContain("warn:");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"no-deps@1.0.1"`);
      expect(bunLock).not.toContain("work:");

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`"node_modules/no-deps/no-deps@1.0.1"`);
    });

    test.concurrent("credentials in a registry URL are not written to bun.lock", async () => {
      // a registry that comes from an environment variable keeps its `user:password@`
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "registry-credentials", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work").replaceAll("work:", ""),
        },
      });
      const bunfig = join(packageDir, "bunfig.toml");
      await Bun.write(bunfig, (await Bun.file(bunfig).text()).replace(verdaccio.registryUrl(), "$PNPM_TEST_REGISTRY"));
      const withPassword = `http://builder:hunter2secret@localhost:${verdaccio.port}/`;

      const fromBun = await runWithEnv(packageDir, { PNPM_TEST_REGISTRY: withPassword }, "pm", "migrate");
      expect(fromBun.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(await bunLockOf(packageDir)).toContain(
        `"no-deps@1.0.1", "http://localhost:${verdaccio.port}/no-deps/-/no-deps-1.0.1.tgz", {}, "${NO_DEPS_1_0_1_INTEGRITY}"`,
      );
      expect(fromBun.exitCode).toBe(0);

      // and one that pnpm-workspace.yaml names
      const { packageDir: namedDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "registry-credentials", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `namedRegistries:\n  work: http://builder:hunter2secret@127.0.0.1:${verdaccio.port}/\n`,
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work"),
        },
      });
      const named = await migrate(namedDir);
      expect(named.stderr).toContain(
        `warn: fetching pnpm registry "work" packages from http://127.0.0.1:${verdaccio.port}/; add it to bunfig.toml or .npmrc if it needs authentication`,
      );
      expect(named.stderr).not.toContain("hunter2secret");
      expect(await bunLockOf(namedDir)).toContain(
        `"no-deps@1.0.1", "http://127.0.0.1:${verdaccio.port}/no-deps/-/no-deps-1.0.1.tgz", {}, "${NO_DEPS_1_0_1_INTEGRITY}"`,
      );
      expect(named.exitCode).toBe(0);

      // a named registry that is bun's, written with credentials: the same registry, no warning
      const { packageDir: sameDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "registry-credentials", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `namedRegistries:\n  work: http://builder:hunter2secret@localhost:${verdaccio.port}/\n`,
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work"),
        },
      });
      const same = await migrate(sameDir);
      expect(same.stderr).not.toContain("pnpm registry");
      expect(same.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(await bunLockOf(sameDir)).not.toContain("hunter2secret");
      expect(same.exitCode).toBe(0);

      // credentials set beside the URL: the ones in the URL are not used, and not kept either
      const { packageDir: besideDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "registry-credentials", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work").replaceAll("work:", ""),
        },
      });
      const besideBunfig = join(besideDir, "bunfig.toml");
      await Bun.write(
        besideBunfig,
        (await Bun.file(besideBunfig).text()).replace(
          `registry = "${verdaccio.registryUrl()}"`,
          `registry = { url = "$PNPM_TEST_REGISTRY", token = "a-token" }`,
        ),
      );
      expect(await Bun.file(besideBunfig).text()).toContain(`url = "$PNPM_TEST_REGISTRY"`);
      const beside = await runWithEnv(besideDir, { PNPM_TEST_REGISTRY: withPassword }, "pm", "migrate");
      expect(beside.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(await bunLockOf(besideDir)).toContain(
        `"no-deps@1.0.1", "http://localhost:${verdaccio.port}/no-deps/-/no-deps-1.0.1.tgz", {}, "${NO_DEPS_1_0_1_INTEGRITY}"`,
      );
      expect(beside.exitCode).toBe(0);
    });

    // `user:password@`, and a bare username, which is `user:` (some registries accept a token that way).
    test.concurrent.each(["builder:hunter2secret", "hunter2token"])(
      "a registry with its credentials in the URL still installs after migration (%s)",
      async userinfo => {
        // every request has to carry the credentials; the tarball URL in bun.lock has none
        const expected = `Basic ${btoa(userinfo.includes(":") ? userinfo : `${userinfo}:`)}`;
        const requests: { path: string; authorized: boolean }[] = [];
        const packages = join(import.meta.dir, "..", "registry", "packages");
        let origin = "";
        using server = Bun.serve({
          port: 0,
          async fetch(req) {
            const { pathname } = new URL(req.url);
            const authorized = req.headers.get("authorization") === expected;
            requests.push({ path: pathname, authorized });
            if (!authorized) return new Response("unauthorized", { status: 401 });
            if (pathname === "/no-deps/-/no-deps-1.0.1.tgz") {
              return new Response(Bun.file(join(packages, "no-deps", "no-deps-1.0.1.tgz")));
            }
            if (pathname === "/no-deps") {
              const manifest = await Bun.file(join(packages, "no-deps", "package.json")).text();
              return Response.json(JSON.parse(manifest.replaceAll("http://localhost:4873/", origin)));
            }
            return new Response("not found", { status: 404 });
          },
        });
        origin = `http://localhost:${server.port}/`;
        using dir = tempDir("pnpm-registry-url-credentials", {
          "package.json": JSON.stringify({ name: "registry-credentials", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work").replaceAll("work:", ""),
          "bunfig.toml": `[install]\nregistry = "$PNPM_TEST_REGISTRY"\nlinker = "hoisted"\n`,
        });

        const env = { PNPM_TEST_REGISTRY: `http://${userinfo}@localhost:${server.port}/` };
        const { stderr, exitCode } = await runWithEnv(String(dir), env, "install");
        expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect(stderr).not.toContain("error:");
        expect(requests.filter(r => !r.authorized)).toEqual([]);
        expect(requests.map(r => r.path)).toContain("/no-deps/-/no-deps-1.0.1.tgz");
        expect(nodeModulesPackages(String(dir))).toMatchInlineSnapshot(`"node_modules/no-deps/no-deps@1.0.1"`);
        // the whole URL, so that a username left in it fails too
        expect(await bunLockOf(String(dir))).toContain(
          `"no-deps@1.0.1", "http://localhost:${server.port}/no-deps/-/no-deps-1.0.1.tgz", {}, "${NO_DEPS_1_0_1_INTEGRITY}"`,
        );
        expect(exitCode).toBe(0);
      },
    );

    test("namedRegistries entry pointing at another registry is used for the tarballs", async () => {
      const named = `http://127.0.0.1:${verdaccio.port}/`;
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "named-registry-other",
            dependencies: { "no-deps": "^1.0.0", "peer-deps-fixed": "^1.0.0" },
          }),
          "pnpm-workspace.yaml": `namedRegistries:\n  work: ${named}\n`,
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: work:1.0.1
      peer-deps-fixed:
        specifier: ^1.0.0
        version: work:1.0.0(no-deps@work:1.0.1)

packages:

  no-deps@work:1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  peer-deps-fixed@work:1.0.0:
    resolution: {integrity: ${PEER_DEPS_FIXED_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: ^1.0.0

snapshots:

  no-deps@work:1.0.1: {}

  peer-deps-fixed@work:1.0.0(no-deps@work:1.0.1):
    dependencies:
      no-deps: work:1.0.1
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain(
        `warn: fetching pnpm registry "work" packages from ${named}; add it to bunfig.toml or .npmrc if it needs authentication`,
      );
      expect(stderr.split('pnpm registry "work"').length - 1).toBe(1);
      expect(stderr).not.toContain("not in namedRegistries");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(
        `["no-deps@1.0.1", "${named}no-deps/-/no-deps-1.0.1.tgz", {}, "${NO_DEPS_1_0_1_INTEGRITY}"]`,
      );
      expect(bunLock).toContain(
        `["peer-deps-fixed@1.0.0", "${named}peer-deps-fixed/-/peer-deps-fixed-1.0.0.tgz", { "peerDependencies": { "no-deps": "^1.0.0" } }, "${PEER_DEPS_FIXED_1_0_0_INTEGRITY}"]`,
      );
      expect(bunLock).not.toContain(verdaccio.registryUrl());
      expect(bunLock).not.toContain("work:");

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
        "node_modules/no-deps/no-deps@1.0.1
        node_modules/peer-deps-fixed/peer-deps-fixed@1.0.0"
      `);
    });

    test("credentials in a namedRegistries URL aren't written to bun.lock, and a token in its path is masked in the warning", async () => {
      const password = "s3cret";
      const token = "npm_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8";
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "named-registry-secrets", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `namedRegistries:\n  work: http://carol:${password}@127.0.0.1:1/${token}/\n`,
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain(
        'warn: fetching pnpm registry "work" packages from http://127.0.0.1:1/***/; add it to bunfig.toml or .npmrc if it needs authentication',
      );
      expect(stderr).not.toContain(password);
      expect(stderr).not.toContain(token);
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      // The token is part of the tarball location; the credentials are not.
      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(
        `["no-deps@1.0.1", "http://127.0.0.1:1/${token}/no-deps/-/no-deps-1.0.1.tgz", {}, "${NO_DEPS_1_0_1_INTEGRITY}"]`,
      );
      expect(bunLock).not.toContain(password);
    });

    test("namedRegistries entry naming the configured registry with credentials in the URL needs no warning", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "named-registry-same-creds", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `namedRegistries:\n  work: ${verdaccio.registryUrl().replace("http://", "http://carol:s3cret@")}\n`,
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("pnpm registry");
      expect(stderr).not.toContain("warn:");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"no-deps@1.0.1"`);
      expect(bunLock).not.toContain("s3cret");
      expect(bunLock).not.toContain("work:");

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`"node_modules/no-deps/no-deps@1.0.1"`);
    });

    test("two packages from one unknown registry warn once", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "unknown-registry-twice",
            dependencies: { "no-deps": "^1.0.0", "one-dep": "^1.0.0" },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: work:1.0.1
      one-dep:
        specifier: ^1.0.0
        version: work:1.0.0

packages:

  no-deps@work:1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-dep@work:1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

snapshots:

  no-deps@work:1.0.1: {}

  one-dep@work:1.0.0:
    dependencies:
      no-deps: work:1.0.1
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain(
        'warn: skipping pnpm registry "work" from pnpm-lock.yaml: not in namedRegistries of pnpm-workspace.yaml (resolving its packages from the configured registry)',
      );
      expect(stderr.split('pnpm registry "work"').length - 1).toBe(1);
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"no-deps@1.0.1"`);
      expect(bunLock).toContain(`"one-dep@1.0.0"`);
      expect(bunLock).not.toContain("work:");
    });

    test("built-in gh: entries record the GitHub Packages registry", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "gh-qualified", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("gh"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain(
        'warn: fetching pnpm registry "gh" packages from https://npm.pkg.github.com/; add it to bunfig.toml or .npmrc if it needs authentication',
      );
      expect(stderr).not.toContain("not in namedRegistries");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(
        `["no-deps@1.0.1", "https://npm.pkg.github.com/no-deps/-/no-deps-1.0.1.tgz", {}, "${NO_DEPS_1_0_1_INTEGRITY}"]`,
      );
      expect(bunLock).not.toContain(verdaccio.registryUrl());
      expect(bunLock).not.toContain("gh:");
    });

    test("namedRegistries overrides the built-in npmjs entry", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "npmjs-overridden", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `namedRegistries:\n  npmjs: ${verdaccio.registryUrl()}\n`,
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("npmjs"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("pnpm registry");
      expect(stderr).not.toContain("warn:");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"no-deps@1.0.1"`);
      expect(bunLock).not.toContain(`["no-deps@1.0.1", ""`);
      expect(bunLock).not.toContain("registry.npmjs.org");
      expect(bunLock).not.toContain("npmjs:");

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`"node_modules/no-deps/no-deps@1.0.1"`);
    });

    test("aliased snapshot dependency with a registry-qualified dep path drops the registry from the alias", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "alias-registry-qualified",
            dependencies: { app: "file:vendor/app" },
          }),
          "vendor/app/package.json": JSON.stringify({
            name: "app",
            version: "1.0.0",
            dependencies: { nd: "npm:no-deps@^1.0.0" },
          }),
          "pnpm-workspace.yaml": `namedRegistries:\n  work: ${verdaccio.registryUrl()}\n`,
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      app:
        specifier: file:vendor/app
        version: file:vendor/app

packages:

  app@file:vendor/app:
    resolution: {directory: vendor/app, type: directory}
    version: 1.0.0

  no-deps@work:1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  app@file:vendor/app:
    dependencies:
      nd: no-deps@work:1.0.1

  no-deps@work:1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("pnpm registry");
      expect(stderr).not.toContain("no package entry");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`["app@file:vendor/app", { "dependencies": { "nd": "npm:no-deps@1.0.1" } }]`);
      expect(bunLock).toContain(`"nd": ["no-deps@1.0.1", `);
      expect(bunLock).not.toContain("work:");

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await bunLockOf(packageDir)).toBe(bunLock);
      expect(await installedPackageJson(packageDir, "", "nd")).toStrictEqual({ name: "no-deps", version: "1.0.1" });
    });
  });

  test.concurrent("reports a package whose resolution cannot be parsed", async () => {
    using dir = tempDir("pnpm-v9-unsupported-resolution", {
      "package.json": JSON.stringify({ name: "unsupported-resolution", dependencies: { foo: "^1.0.0" } }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      foo:
        specifier: ^1.0.0
        version: '1.0'

packages:

  foo@1.0:
    resolution: {integrity: sha512-foo==}

snapshots:

  foo@1.0: {}
`,
    });

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("pnpm-lock.yaml package 'foo@1.0' has an unsupported resolution");
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
  });

  test.concurrent("warns about a lockfileVersion newer than 9", async () => {
    using dir = tempDir("pnpm-v9-newer-version", {
      "package.json": JSON.stringify({ name: "newer-version" }),
      "pnpm-lock.yaml": `lockfileVersion: '10.0'

importers:

  .: {}
`,
    });

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("warn: pnpm-lock.yaml is lockfileVersion 10; migrating it as 9.0");
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);
  });

  describe("multi-document lockfile", () => {
    // pnpm 11 writes `---<env lockfile>---<lockfile>` (pnpm11/lockfile/fs/src/envLockfile.ts)
    test.concurrent("migrates the last document", async () => {
      using dir = fixture("v9-multi-document");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`"${PKG_A_GIT}"`);
      expect(bunLock).not.toContain("plugin-better-defaults");
    });

    test.concurrent("rejects a file whose main document is empty", async () => {
      using dir = tempDir("pnpm-v9-empty-main-document", {
        "package.json": JSON.stringify({ name: "empty-main-document" }),
        "pnpm-lock.yaml": `---
lockfileVersion: '9.0'

importers:

  .:
    configDependencies: {}

---
`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("pnpm-lock.yaml root must be an object");
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });
  });

  test.concurrent("runtime: entries are skipped with a warning", async () => {
    using dir = fixture("v9-runtime-entries");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain(
      'warn: skipping "node@runtime:22.0.0" from pnpm-lock.yaml: runtime dependencies are not supported',
    );
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(`"${PKG_A_GIT}"`);
    expect(bunLock).not.toContain(`"node"`);
    expect(bunLock).not.toContain("runtime:");
  });

  describe("patchedDependencies", () => {
    // fixture ported from pnpm11/deps/compliance/commands/test/licenses/fixtures/with-git-protocol-patched-deps
    const IS_POSITIVE = "is-positive@github:kevva/is-positive#97edff6f525f192a3f83cea1944765f769ae2678";

    test.concurrent.each(["legacy", "bare"])("%s hash form on a git-hosted package", async form => {
      using dir = fixture(`v9-patched-git-hosted-${form}`);

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`"${IS_POSITIVE}"`);
      expect(bunLock).toContain(`"${IS_POSITIVE}": "patches/is-positive@3.1.0.patch"`);
      expect(bunLock).not.toContain("is-positive@3.1.0@");

      const packageJson = await Bun.file(join(String(dir), "package.json")).json();
      expect(packageJson.patchedDependencies).toStrictEqual({ [IS_POSITIVE]: "patches/is-positive@3.1.0.patch" });
    });

    test.concurrent("bare hash whose patch is not in the config is skipped with a warning", async () => {
      using dir = fixture("v9-patched-git-hosted-bare");
      rmSync(join(String(dir), "pnpm-workspace.yaml"));

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain(
        'warn: skipping patch "is-positive@3.1.0" from pnpm-lock.yaml: not in patchedDependencies of package.json or pnpm-workspace.yaml',
      );
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`"${IS_POSITIVE}"`);
      expect(bunLock).not.toContain("patchedDependencies");
    });

    test("bare hash on a registry package with a bare `name` key in pnpm-workspace.yaml", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/v9-patch-bare-hash-registry"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"no-deps@1.0.1": "patches/no-deps.patch"`);

      const packageJson = await Bun.file(join(packageDir, "package.json")).json();
      expect(packageJson.patchedDependencies).toStrictEqual({ "no-deps@1.0.1": "patches/no-deps.patch" });
    });

    const PATCH_HASH = "2mxqxzgazgkaqoljbgoadrshgq";
    const NO_DEPS_INDEX_PATCH = [
      "diff --git a/index.js b/index.js",
      "--- a/index.js",
      "+++ b/index.js",
      "@@ -1 +1,2 @@",
      "+globalThis.patchedByMigration = true;",
      " module.exports = require(`./package.json`);",
      "",
    ].join("\n");
    const ADD_FILE_PATCH = [
      "diff --git a/patched.txt b/patched.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/patched.txt",
      "@@ -0,0 +1 @@",
      "+patched",
      "",
    ].join("\n");

    function bareHashNoDepsLockfile(patchedKey: string) {
      return `lockfileVersion: '9.0'

patchedDependencies:
  ${patchedKey}: ${PATCH_HASH}

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1(patch_hash=${PATCH_HASH})

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1(patch_hash=${PATCH_HASH}): {}
`;
    }

    test("bare hash whose path is only in package.json pnpm.patchedDependencies", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "patch-path-in-package-json",
            dependencies: { "no-deps": "^1.0.0" },
            pnpm: { patchedDependencies: { "no-deps": "patches/no-deps.patch" } },
          }),
          "patches/no-deps.patch": NO_DEPS_INDEX_PATCH,
          "pnpm-lock.yaml": bareHashNoDepsLockfile("no-deps"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("not in patchedDependencies");
      expect(stderr).toContain("copied pnpm.patchedDependencies to patchedDependencies in package.json");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"patchedDependencies": {\n    "no-deps@1.0.1": "patches/no-deps.patch",\n  }`);

      // The versioned key is only copied to the root. pnpm keeps reading the bare key from its own block.
      const packageJson = await Bun.file(join(packageDir, "package.json")).json();
      expect(packageJson).toStrictEqual({
        name: "patch-path-in-package-json",
        dependencies: { "no-deps": "^1.0.0" },
        pnpm: { patchedDependencies: { "no-deps": "patches/no-deps.patch" } },
        patchedDependencies: { "no-deps@1.0.1": "patches/no-deps.patch" },
      });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await Bun.file(join(packageDir, "node_modules/no-deps/index.js")).text()).toStartWith(
        "globalThis.patchedByMigration = true;\n",
      );
    });

    // `bun update` migrates, then edits the cached root package.json that the migration rewrote, so the cached
    // copy has to be re-read from the rewritten contents (a stale copy pointed into the freed previous contents).
    test("bun update straight from pnpm-lock.yaml edits the package.json the migration rewrote", async () => {
      const pnpm = {
        patchedDependencies: { "no-deps": "patches/no-deps.patch" },
        overrides: { "a-dep": "1.0.1" },
      };
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "update-after-migration",
            dependencies: { "no-deps": "^1.0.0" },
            pnpm,
          }),
          "patches/no-deps.patch": NO_DEPS_INDEX_PATCH,
          "pnpm-lock.yaml": bareHashNoDepsLockfile("no-deps").replace(
            "importers:",
            "overrides:\n  a-dep: 1.0.1\n\nimporters:",
          ),
        },
      });

      const update = await run(packageDir, "update");

      expect(update.stderr).toContain(
        "copied pnpm.overrides to overrides, copied pnpm.patchedDependencies to patchedDependencies in package.json",
      );
      expect(update.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(update.stderr).not.toContain("error:");
      expect(update.stdout).toContain("no-deps@1.0.1");
      expect(update.exitCode).toBe(0);
      expect(await Bun.file(join(packageDir, "package.json")).json()).toStrictEqual({
        name: "update-after-migration",
        dependencies: { "no-deps": "^1.0.1" },
        pnpm,
        overrides: pnpm.overrides,
        patchedDependencies: { "no-deps@1.0.1": "patches/no-deps.patch" },
      });
      expect(await Bun.file(join(packageDir, "node_modules/no-deps/index.js")).text()).toStartWith(
        "globalThis.patchedByMigration = true;\n",
      );

      const frozen = await run(packageDir, "install", "--frozen-lockfile");

      expect(frozen.stderr).not.toContain("error:");
      expect(frozen.exitCode).toBe(0);
    });

    test("versioned lockfile key falls back to the bare config key", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "patch-key-fallback", dependencies: { "no-deps": "^1.0.0" } }),
          "patches/no-deps.patch": NO_DEPS_INDEX_PATCH,
          "pnpm-workspace.yaml": "patchedDependencies:\n  no-deps: patches/no-deps.patch\n",
          "pnpm-lock.yaml": bareHashNoDepsLockfile("no-deps@1.0.1"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("not in patchedDependencies");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"patchedDependencies": {\n    "no-deps@1.0.1": "patches/no-deps.patch",\n  }`);

      const packageJson = await Bun.file(join(packageDir, "package.json")).json();
      expect(packageJson.patchedDependencies).toStrictEqual({ "no-deps@1.0.1": "patches/no-deps.patch" });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await Bun.file(join(packageDir, "node_modules/no-deps/index.js")).text()).toStartWith(
        "globalThis.patchedByMigration = true;\n",
      );
    });

    test("two packages patched by the same patch file share one hash", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "shared-patch",
            dependencies: { "no-deps": "^1.0.0", "one-dep": "^1.0.0" },
          }),
          "patches/shared.patch": ADD_FILE_PATCH,
          "pnpm-workspace.yaml":
            "patchedDependencies:\n  no-deps: patches/shared.patch\n  one-dep: patches/shared.patch\n",
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

patchedDependencies:
  no-deps: ${PATCH_HASH}
  one-dep: ${PATCH_HASH}

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1(patch_hash=${PATCH_HASH})
      one-dep:
        specifier: ^1.0.0
        version: 1.0.0(patch_hash=${PATCH_HASH})

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

snapshots:

  no-deps@1.0.1(patch_hash=${PATCH_HASH}): {}

  one-dep@1.0.0(patch_hash=${PATCH_HASH}):
    dependencies:
      no-deps: 1.0.1(patch_hash=${PATCH_HASH})
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("not in patchedDependencies");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(
        [
          `  "patchedDependencies": {`,
          `    "no-deps@1.0.1": "patches/shared.patch",`,
          `    "one-dep@1.0.0": "patches/shared.patch",`,
          `  }`,
        ].join("\n"),
      );

      const packageJson = await Bun.file(join(packageDir, "package.json")).json();
      expect(packageJson.patchedDependencies).toStrictEqual({
        "no-deps@1.0.1": "patches/shared.patch",
        "one-dep@1.0.0": "patches/shared.patch",
      });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await Bun.file(join(packageDir, "node_modules/no-deps/patched.txt")).text()).toBe("patched\n");
      expect(await Bun.file(join(packageDir, "node_modules/one-dep/patched.txt")).text()).toBe("patched\n");
    });

    // pnpm also takes a version range and a bare name as the key; bun's key is one exact version.
    test.each(["no-deps@^1.0.0", "no-deps@1", "no-deps"])(
      "the key %s becomes one entry for each version it patches",
      async key => {
        const { packageDir } = await verdaccio.createTestDir({
          bunfigOpts: { linker: "hoisted" },
          files: {
            "package.json": JSON.stringify({
              name: "patch-key-covers-two-versions",
              dependencies: { "no-deps": "^1.0.0", older: "npm:no-deps@1.0.0" },
              pnpm: { patchedDependencies: { [key]: "patches/no-deps.patch" } },
            }),
            "patches/no-deps.patch": ADD_FILE_PATCH,
            "pnpm-lock.yaml": `lockfileVersion: '9.0'

patchedDependencies:
  ${key}:
    hash: ${PATCH_HASH}
    path: patches/no-deps.patch

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1(patch_hash=${PATCH_HASH})
      older:
        specifier: npm:no-deps@1.0.0
        version: no-deps@1.0.0(patch_hash=${PATCH_HASH})

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.0(patch_hash=${PATCH_HASH}): {}

  no-deps@1.0.1(patch_hash=${PATCH_HASH}): {}
`,
          },
        });

        const { stderr, exitCode } = await run(packageDir, "install");

        expect(stderr).not.toContain("warn:");
        expect(stderr).not.toContain("error:");
        expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect((await Bun.file(join(packageDir, "package.json")).json()).patchedDependencies).toStrictEqual({
          "no-deps@1.0.0": "patches/no-deps.patch",
          "no-deps@1.0.1": "patches/no-deps.patch",
        });
        expect(await Bun.file(join(packageDir, "node_modules/no-deps/patched.txt")).text()).toBe("patched\n");
        expect(await Bun.file(join(packageDir, "node_modules/older/patched.txt")).text()).toBe("patched\n");
        expect(exitCode).toBe(0);

        await expectInstallToLeaveUnchanged(packageDir, await bunLockOf(packageDir));
      },
    );

    test.each(["hoisted", "isolated"] as const)(
      "the migrated bun.lock patches the installed registry package (%s linker)",
      async linker => {
        const { packageDir } = await verdaccio.createTestDir({
          bunfigOpts: { linker },
          files: {
            "package.json": JSON.stringify({ name: "patch-installs", dependencies: { "no-deps": "^1.0.0" } }),
            "patches/no-deps.patch": NO_DEPS_INDEX_PATCH,
            "pnpm-workspace.yaml": "patchedDependencies:\n  no-deps: patches/no-deps.patch\n",
            "pnpm-lock.yaml": bareHashNoDepsLockfile("no-deps"),
          },
        });

        const { stderr, exitCode } = await migrate(packageDir);

        expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect(exitCode).toBe(0);

        const migrated = await bunLockOf(packageDir);
        expect(migrated).toContain(`"no-deps@1.0.1": "patches/no-deps.patch"`);

        const install = await run(packageDir, "install", "--frozen-lockfile");

        expect(install.stderr).not.toContain("error:");
        expect(install.stdout).toContain("1 package installed");
        expect(install.exitCode).toBe(0);
        expect(await bunLockOf(packageDir)).toBe(migrated);
        expect(await Bun.file(join(packageDir, "node_modules/no-deps/index.js")).text()).toStartWith(
          "globalThis.patchedByMigration = true;\nmodule.exports = require(`./package.json`);\n",
        );
      },
    );

    // `bun patch --commit` loads the lockfile before it edits package.json, so the migration's rewrite of
    // package.json (and of its cache entry) happens underneath the command.
    test("bun patch --commit that has to migrate the lockfile keeps the migration's package.json edits", async () => {
      const packageJson = { name: "patch-commit-migrates", dependencies: { "no-deps": "^1.0.0" } };
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify(packageJson),
          "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
          "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1

  packages/a: {}

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      // `bun patch` installs and unlinks node_modules/no-deps from the cache copy that `--commit` diffs against;
      // the repo is then put back to how it was checked out, so `--commit` is the command that migrates.
      expect((await run(packageDir, "patch", "no-deps")).exitCode).toBe(0);
      rmSync(join(packageDir, "bun.lock"));
      writeFileSync(join(packageDir, "package.json"), JSON.stringify(packageJson));
      appendFileSync(join(packageDir, "node_modules/no-deps/index.js"), "globalThis.patchedAtCommit = true;\n");

      const { stderr, exitCode } = await run(packageDir, "patch", "--commit", "node_modules/no-deps");
      expect(stderr).toContain("copied pnpm-workspace.yaml to workspaces in package.json");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      expect(await Bun.file(join(packageDir, "package.json")).json()).toEqual({
        ...packageJson,
        workspaces: ["packages/*"],
        patchedDependencies: { "no-deps@1.0.1": "patches/no-deps@1.0.1.patch" },
      });
      expect(await Bun.file(join(packageDir, "patches/no-deps@1.0.1.patch")).text()).toContain(
        "+globalThis.patchedAtCommit = true;",
      );
      expect(await bunLockOf(packageDir)).toContain(`"no-deps@1.0.1": "patches/no-deps@1.0.1.patch"`);
    });
  });

  test("catalog:default is the default catalog", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/v9-catalog-default"),
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderr).not.toContain("missing entry");
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(packageDir);
    expect(bunLock).toContain(`"no-deps@1.0.1"`);
  });

  test("reference shapes: scoped + peer suffix, short alias, scoped alias, file: tarball", async () => {
    // reference vectors from pnpm11/deps/path/test/index.ts refToRelative()
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/v9-reference-shapes"),
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderr).not.toContain("no package entry");
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(packageDir);
    expect(bunLock).toContain(`"@types/no-deps@1.0.0"`);
    expect(bunLock).toContain(`"@types/no-deps@2.0.0"`);
    expect(bunLock).toContain(`"@types/is-number@1.0.0"`);
    expect(bunLock).toContain(`"no-deps@1.0.1"`);
    expect(bunLock).toContain(`"tb@tb-1.0.0.tgz"`);
    expect(bunLock).toContain(`"nd": "npm:no-deps@1.0.1"`);
    expect(bunLock).toContain(`"tnd": "npm:@types/no-deps@2.0.0"`);
    expect(bunLock).toContain(`"tb": "file:tb-1.0.0.tgz"`);
  });

  test.serial("snapshot alias whose dep-path version is a file: directory or tarball", async () => {
    using dir = fixture("v9-alias-non-registry-dep-path");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    // as outer/package.json declares it, not pnpm's lockfile-relative `file:shared/config`
    expect(bunLock).toContain(`"config": "file:../shared/config"`);
    expect(bunLock).toContain(
      `"fork": "https://codeload.github.com/o/bar/tar.gz/aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b"`,
    );
    expect(bunLock).toContain(`"hi2@file:shared/config"`);
    expect(bunLock).toContain(`"bar@github:o/bar#aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b"`);
    expect(bunLock).not.toContain("npm:");

    expect(bunLock).toMatchSnapshot("bun.lock");
  });

  describe("local file: tarballs", () => {
    test.concurrent("tarball+integrity, integrity-only .tar.gz, and upper-case / .tar spellings", async () => {
      // tar-pkg entry ported from pnpm11/installing/deps-restorer/test/fixtures/has-local-dep/pkg/pnpm-lock.yaml
      using dir = fixture("v9-local-tarballs");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(
        `["tar-pkg@../tar-pkg-1.0.0.tgz", { "version": "1.0.0" }, "${LOCAL_TARBALL_INTEGRITY}"]`,
      );
      expect(bunLock).toContain(`["tar-gz-pkg@../tar-gz-pkg-1.0.0.tar.gz", { "version": "1.0.0" }, "sha512-`);
      expect(bunLock).toContain(`["plain@../plain-1.0.0.tar", { "version": "1.0.0" }, "sha512-`);
      expect(bunLock).toContain(`["upper@../UPPER-1.0.0.TGZ", { "version": "1.0.0" }, "sha512-`);
      expect(bunLock).not.toContain("tar-gz-pkg@file:");
      expect(bunLock).not.toContain("plain@file:");
      expect(bunLock).not.toContain("upper@file:");
    });

    // pnpm11/lockfile/utils/src/refIsLocalTarball.ts is case-insensitive and accepts .tar
    test.concurrent.each(["up-1.0.0.TGZ", "mixed-1.0.0.Tar.Gz", "plain-1.0.0.tar"])(
      "integrity-only file: entry ending in %s is a tarball, not a folder",
      async file => {
        using dir = tempDir("pnpm-v9-local-tarball-spelling", {
          "package.json": JSON.stringify({ name: "tarball-spelling", dependencies: { pkg: `file:vendor/${file}` } }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      pkg:
        specifier: file:vendor/${file}
        version: file:vendor/${file}

packages:

  pkg@file:vendor/${file}:
    resolution: {integrity: ${LOCAL_TARBALL_INTEGRITY}}
    version: 1.0.0

snapshots:

  pkg@file:vendor/${file}: {}
`,
        });

        const { stderr, exitCode } = await migrate(String(dir));

        expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect(exitCode).toBe(0);

        const bunLock = await bunLockOf(String(dir));
        expect(bunLock).toContain(`["pkg@vendor/${file}", { "version": "1.0.0" }, "${LOCAL_TARBALL_INTEGRITY}"]`);
        expect(bunLock).not.toContain(`pkg@file:vendor/${file}`);
      },
    );
  });

  test.concurrent("file: directory with type: directory and a nested file: dependency", async () => {
    // ported from pnpm11/deps/compliance/commands/test/licenses/fixtures/with-file-protocol
    using dir = fixture("v9-file-directory");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(`"sub-dep": "file:./sub-dep"`);
    // pnpm-lock.yaml has `nested-child: file:sub-dep/child`; bun.lock stores the path relative to
    // sub-dep, the way sub-dep/package.json declares it, and resolves it from there when loaded.
    expect(bunLock).toContain(`["sub-dep@file:sub-dep", { "dependencies": { "nested-child": "file:child" } }]`);
    expect(bunLock).toContain(`["nested-child@file:sub-dep/child", {}]`);

    const update = await run(String(dir), "update", "nested-child");
    expect(update.stderr).not.toContain("error:");
    expect(update.exitCode).toBe(0);
    expect(await bunLockOf(String(dir))).toBe(bunLock);
  });

  test.concurrent("codeload tarballs with and without gitHosted: true", async () => {
    // ported from pnpm11/__fixtures__/with-git-protocol-dep and with-non-package-dep
    using dir = fixture("v9-codeload-tarballs");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(`"is-negative@github:kevva/is-negative#1d7e288222b53a0cab90a331f1865220ec29560c"`);
    expect(bunLock).toContain(`"camelcase@github:denolib/camelcase#aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b"`);
    expect(bunLock).not.toContain("codeload.github.com");
  });

  test.concurrent("git resolutions keep the ssh port and userinfo; orphan packages entries are ignored", async () => {
    using dir = fixture("v9-git-urls-and-orphan");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(`"a@git+ssh://git@example.com:2222/org/a.git#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`);
    expect(bunLock).toContain(
      `"b@git+https://TOKEN:x-oauth-basic@github.com/foo/bar.git#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"`,
    );
    expect(bunLock).not.toContain("orphan");
  });

  describe("injected workspace packages", () => {
    test.concurrent("resolve to the workspace package instead of a folder package", async () => {
      using dir = fixture("v9-injected-workspace");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`"foo": ["foo@workspace:packages/foo"]`);
      expect(bunLock).not.toContain("foo@file:");

      const install = await run(String(dir), "install", "--frozen-lockfile", "--linker", "hoisted");

      expect(install.stderr).not.toContain("error:");
      expect(await installedPackageJson(String(dir), "", "foo")).toStrictEqual({ name: "foo", version: "1.0.0" });
      expect(install.exitCode).toBe(0);
    });

    test.concurrent(
      "pruned lockfile with a peer-suffixed packages key and a directory-typed registry key",
      async () => {
        // ported from pnpm11/installing/deps-restorer/test/fixtures/peer-variant-missing-resolution
        using dir = fixture("v9-peer-variant-missing-resolution");

        const { stderr, exitCode } = await migrate(String(dir));

        expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect(exitCode).toBe(0);

        const bunLock = await bunLockOf(String(dir));
        expect(bunLock).toContain(`"pkg-a": ["pkg-a@workspace:packages/pkg-a"]`);
        expect(bunLock).toContain(`"peer": ["peer@workspace:packages/peer"]`);
        expect(bunLock).not.toContain("pkg-a@file:");
        expect(bunLock).not.toContain("peer@1.0.0");
      },
    );
  });

  describe("pruned snapshots", () => {
    // pnpm11/lockfile/fs convertToLockfileObject rebuilds `file:` directories whose packages: entry turbo prune dropped
    test("file: variants without a packages entry are rebuilt", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/v9-snapshot-only-file-variants"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("no package entry");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"dir": ["dir@workspace:packages/dir"]`);
      expect(bunLock).toContain(`["local@file:vendor/local", { "dependencies": { "no-deps": "1.0.0" } }]`);
      expect(bunLock).not.toContain("dir@file:");
      expect(bunLock).not.toContain("tb@");
    });

    test.concurrent("a lockfile with snapshots but no packages section migrates", async () => {
      using dir = tempDir("pnpm-v9-snapshots-only", {
        "package.json": JSON.stringify({ name: "snapshots-only", dependencies: { local: "file:vendor/local" } }),
        "vendor/local/package.json": JSON.stringify({ name: "local", version: "1.0.0" }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      local:
        specifier: file:vendor/local
        version: file:vendor/local(x@1.0.0)

snapshots:

  local@file:vendor/local(x@1.0.0): {}
`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).not.toContain("no package entry");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`["local@file:vendor/local", {}]`);
    });

    // guard: only directories are rebuilt; a tarball needs the integrity its packages: entry carried
    test.concurrent.each(["tb-1.0.0.tgz", "tb-1.0.0.TGZ", "tb-1.0.0.Tar.Gz"])(
      "a referenced snapshot-only tarball variant (%s) is still reported",
      async file => {
        using dir = tempDir("pnpm-v9-snapshot-only-tarball", {
          "package.json": JSON.stringify({
            name: "snapshot-only-tarball",
            dependencies: { tb: `file:vendor/${file}` },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      tb:
        specifier: file:vendor/${file}
        version: file:vendor/${file}(x@1.0.0)

snapshots:

  tb@file:vendor/${file}(x@1.0.0): {}
`,
        });

        const { stderr, exitCode } = await migrate(String(dir));

        expect(stderr).toContain(
          `pnpm-lock.yaml has no package entry 'tb@file:vendor/${file}' for dependency 'tb' of importer '.'`,
        );
        expect(exitCode).toBe(1);
        expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
      },
    );
  });

  describe("peer dependencies", () => {
    test("packages keep their declared peer ranges and optional peers", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "declared-peers",
            dependencies: {
              "a-dep": "1.0.1",
              "no-deps": "^1.0.0",
              "peer-deps": "^1.0.0",
              "peer-deps-fixed": "^1.0.0",
            },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      a-dep:
        specifier: 1.0.1
        version: 1.0.1
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1
      peer-deps:
        specifier: ^1.0.0
        version: 1.0.0(a-dep@1.0.1)(no-deps@1.0.1)
      peer-deps-fixed:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  a-dep@1.0.1:
    resolution: {integrity: ${A_DEP_1_0_1_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  peer-deps@1.0.0:
    resolution: {integrity: ${PEER_DEPS_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: ^1.0.0
      a-dep: '*'
      d: '>=2'
    peerDependenciesMeta:
      a-dep:
        optional: true
      d:
        optional: true
      e:
        optional: true

  peer-deps-fixed@1.0.0:
    resolution: {integrity: ${PEER_DEPS_FIXED_1_0_0_INTEGRITY}}
    peerDependencies:
      g: ^1

snapshots:

  a-dep@1.0.1: {}

  no-deps@1.0.1: {}

  peer-deps@1.0.0(a-dep@1.0.1)(no-deps@1.0.1):
    dependencies:
      no-deps: 1.0.1
    optionalDependencies:
      a-dep: 1.0.1

  peer-deps-fixed@1.0.0: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(
        `{ "peerDependencies": { "a-dep": "*", "d": ">=2", "e": "*", "no-deps": "^1.0.0" }, "optionalPeers": ["a-dep", "d", "e"] }`,
      );
      expect(bunLock).toContain(`{ "peerDependencies": { "g": "^1" }, "optionalPeers": ["g"] }`);
      expect(bunLock).not.toContain(`"optionalDependencies"`);
      expect(bunLock).not.toContain(`"no-deps": "1.0.1"`);
    });

    // pnpm11/__fixtures__/with-peer: the packages entry declares `ajv: ^6.9.1`, the snapshot resolves 6.10.2
    test("declared ranges win over the snapshot's resolved versions; peers pnpm left out are still emitted", async () => {
      const registry = verdaccio.registryUrl();
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "declared-ranges",
            dependencies: {
              "no-deps": "^1.0.0",
              "one-optional-peer-dep": "1.0.2",
              "peer-deps-fixed": "^1.0.0",
              "peer-deps-too": "^1.0.0",
            },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1
      one-optional-peer-dep:
        specifier: 1.0.2
        version: 1.0.2
      peer-deps-fixed:
        specifier: ^1.0.0
        version: 1.0.0(no-deps@1.0.1)
      peer-deps-too:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-optional-peer-dep@1.0.2:
    resolution: {integrity: ${ONE_OPTIONAL_PEER_DEP_1_0_2_INTEGRITY}}
    peerDependencies:
      no-deps: ^1.0.0
    peerDependenciesMeta:
      no-deps:
        optional: true

  peer-deps-fixed@1.0.0:
    resolution: {integrity: ${PEER_DEPS_FIXED_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: ^1.0.0

  peer-deps-too@1.0.0:
    resolution: {integrity: ${PEER_DEPS_TOO_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: '*'

snapshots:

  no-deps@1.0.1: {}

  one-optional-peer-dep@1.0.2: {}

  peer-deps-fixed@1.0.0(no-deps@1.0.1):
    dependencies:
      no-deps: 1.0.1

  peer-deps-too@1.0.0: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(
        `["peer-deps-fixed@1.0.0", "${registry}peer-deps-fixed/-/peer-deps-fixed-1.0.0.tgz", { "peerDependencies": { "no-deps": "^1.0.0" } }, "${PEER_DEPS_FIXED_1_0_0_INTEGRITY}"]`,
      );
      expect(bunLock).toContain(
        `["one-optional-peer-dep@1.0.2", "${registry}one-optional-peer-dep/-/one-optional-peer-dep-1.0.2.tgz", { "peerDependencies": { "no-deps": "^1.0.0" }, "optionalPeers": ["no-deps"] }, "${ONE_OPTIONAL_PEER_DEP_1_0_2_INTEGRITY}"]`,
      );
      expect(bunLock).toContain(
        `["peer-deps-too@1.0.0", "${registry}peer-deps-too/-/peer-deps-too-1.0.0.tgz", { "peerDependencies": { "no-deps": "*" } }, "${PEER_DEPS_TOO_1_0_0_INTEGRITY}"]`,
      );
      expect(bunLock).not.toContain(`"no-deps": "1.0.1"`);

      const install = await run(packageDir, "install");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
        "node_modules/no-deps/no-deps@1.0.1
        node_modules/one-optional-peer-dep/one-optional-peer-dep@1.0.2
        node_modules/peer-deps-fixed/peer-deps-fixed@1.0.0
        node_modules/peer-deps-too/peer-deps-too@1.0.0"
      `);
    });

    test("a peer range dedupes onto the hoisted version like a fresh install", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/v9-peer-range-dedupe"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"peer-deps": ["peer-deps@1.0.0"`);
      expect(bunLock).toContain(`{ "peerDependencies": { "no-deps": "*" } }`);
      expect(bunLock).toContain(`"provides-peer-deps-1-0-0/no-deps": ["no-deps@1.0.0"`);
      expect(bunLock).not.toContain(`"peer-deps/no-deps"`);

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
        "node_modules/no-deps/no-deps@1.0.1
        node_modules/one-dep/one-dep@1.0.0
        node_modules/peer-deps/peer-deps@1.0.0
        node_modules/provides-peer-deps-1-0-0/node_modules/no-deps/no-deps@1.0.0
        node_modules/provides-peer-deps-1-0-0/provides-peer-deps-1-0-0@1.0.0"
      `);
    });

    test("a peer that nothing in the lockfile satisfies keeps the version that pnpm resolved it to", async () => {
      // strict-peer-dep wants no-deps@^2.0.0; pnpm resolved it to 1.0.0 (the snapshot suffix) while
      // one-dep brings in 1.0.1. Neither satisfies the range, so there is nothing to rebind the
      // peer by; binding it to the highest version present would drop pnpm's 1.0.0 from the tree.
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "unsatisfied-peer",
            dependencies: { "one-dep": "1.0.0", "strict-peer-dep": "1.0.0" },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0
      strict-peer-dep:
        specifier: 1.0.0
        version: 1.0.0(no-deps@1.0.0)

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

  strict-peer-dep@1.0.0:
    resolution: {integrity: ${STRICT_PEER_DEP_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: ^2.0.0

snapshots:

  no-deps@1.0.0: {}

  no-deps@1.0.1: {}

  one-dep@1.0.0:
    dependencies:
      no-deps: 1.0.1

  strict-peer-dep@1.0.0(no-deps@1.0.0):
    dependencies:
      no-deps: 1.0.0
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"no-deps": ["no-deps@1.0.1"`);
      expect(bunLock).toContain(`"strict-peer-dep/no-deps": ["no-deps@1.0.0"`);

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
        "node_modules/no-deps/no-deps@1.0.1
        node_modules/one-dep/one-dep@1.0.0
        node_modules/strict-peer-dep/node_modules/no-deps/no-deps@1.0.0
        node_modules/strict-peer-dep/strict-peer-dep@1.0.0"
      `);
    });

    test("a peer that nothing in the lockfile satisfies and that pnpm left unmet doesn't get a copy of the highest version", async () => {
      // pnpm recorded no resolution for strict-peer-dep's no-deps@^2.0.0 (no snapshot suffix),
      // so in pnpm's layout the package sees whatever no-deps sits at the root: 1.0.1, hoisted
      // there from one-dep. Binding the peer to the highest version present instead (1.1.0,
      // nested under normal-dep-and-dev-dep) would add a strict-peer-dep/no-deps copy to the
      // migrated tree that pnpm's tree does not have. Left unbound, the peer is bound to the
      // root copy when the migrated bun.lock is loaded, like any other peer the file prints
      // nothing for.
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "unmet-peer",
            // one-dep is a devDependency so that its no-deps@1.0.1 takes the root slot.
            dependencies: { "normal-dep-and-dev-dep": "1.0.1", "strict-peer-dep": "1.0.0" },
            devDependencies: { "one-dep": "1.0.0" },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      normal-dep-and-dev-dep:
        specifier: 1.0.1
        version: 1.0.1
      strict-peer-dep:
        specifier: 1.0.0
        version: 1.0.0
    devDependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  no-deps@1.1.0:
    resolution: {integrity: ${NO_DEPS_1_1_0_INTEGRITY}}

  normal-dep-and-dev-dep@1.0.1:
    resolution: {integrity: ${NORMAL_DEP_AND_DEV_DEP_1_0_1_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

  strict-peer-dep@1.0.0:
    resolution: {integrity: ${STRICT_PEER_DEP_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: ^2.0.0

snapshots:

  no-deps@1.0.1: {}

  no-deps@1.1.0: {}

  normal-dep-and-dev-dep@1.0.1:
    dependencies:
      no-deps: 1.1.0

  one-dep@1.0.0:
    dependencies:
      no-deps: 1.0.1

  strict-peer-dep@1.0.0: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"no-deps": ["no-deps@1.0.1"`);
      expect(bunLock).toContain(`"normal-dep-and-dev-dep/no-deps": ["no-deps@1.1.0"`);
      expect(bunLock).not.toContain(`"strict-peer-dep/no-deps"`);

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
        "node_modules/no-deps/no-deps@1.0.1
        node_modules/normal-dep-and-dev-dep/node_modules/no-deps/no-deps@1.1.0
        node_modules/normal-dep-and-dev-dep/normal-dep-and-dev-dep@1.0.1
        node_modules/one-dep/one-dep@1.0.0
        node_modules/strict-peer-dep/strict-peer-dep@1.0.0"
      `);
    });

    // pnpm11/lockfile/fs convertToLockfileObject: every variant joins packages[removeSuffix(key)]
    const peerVariantPackageJsons = {
      "package.json": JSON.stringify({ name: "v9-peer-variants", workspaces: ["apps/*"] }),
      "apps/a/package.json": JSON.stringify({
        name: "a",
        dependencies: { "no-deps": "1.0.1", "peer-deps": "^1.0.0" },
      }),
      "apps/b/package.json": JSON.stringify({
        name: "b",
        dependencies: { "no-deps": "2.0.0", "peer-deps": "^1.0.0" },
      }),
    };
    const peerVariant101 = `  peer-deps@1.0.0(no-deps@1.0.1):
    dependencies:
      no-deps: 1.0.1
`;
    const peerVariant200 = `  peer-deps@1.0.0(no-deps@2.0.0):
    dependencies:
      no-deps: 2.0.0
`;
    const peerVariantLockfile = (variants: string) => `lockfileVersion: '9.0'

importers:

  .: {}

  apps/a:
    dependencies:
      no-deps:
        specifier: 1.0.1
        version: 1.0.1
      peer-deps:
        specifier: ^1.0.0
        version: 1.0.0(no-deps@1.0.1)

  apps/b:
    dependencies:
      no-deps:
        specifier: 2.0.0
        version: 2.0.0
      peer-deps:
        specifier: ^1.0.0
        version: 1.0.0(no-deps@2.0.0)

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  no-deps@2.0.0:
    resolution: {integrity: ${NO_DEPS_2_0_0_INTEGRITY}}

  peer-deps@1.0.0:
    resolution: {integrity: ${PEER_DEPS_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: '*'

snapshots:

  no-deps@1.0.1: {}

  no-deps@2.0.0: {}

${variants}`;

    test("peer variants of one package migrate identically regardless of snapshot order", async () => {
      const { packageDir: forward } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          ...peerVariantPackageJsons,
          "pnpm-lock.yaml": peerVariantLockfile(`${peerVariant101}\n${peerVariant200}`),
        },
      });
      const { packageDir: swapped } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          ...peerVariantPackageJsons,
          "pnpm-lock.yaml": peerVariantLockfile(`${peerVariant200}\n${peerVariant101}`),
        },
      });

      const [forwardResult, swappedResult] = await Promise.all([migrate(forward), migrate(swapped)]);

      expect(forwardResult.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(swappedResult.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(forwardResult.exitCode).toBe(0);
      expect(swappedResult.exitCode).toBe(0);

      const bunLock = await bunLockOf(forward);
      expect(bunLock).toContain(`{ "peerDependencies": { "no-deps": "*" } }`);
      expect(bunLock).toContain(`"no-deps@1.0.1"`);
      expect(bunLock).toContain(`"no-deps@2.0.0"`);
      expect(await bunLockOf(swapped)).toBe(bunLock);

      const install = await run(forward, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await bunLockOf(forward)).toBe(bunLock);
      expect((await installedPackageJson(forward, "apps/a", "no-deps")).version).toBe("1.0.1");
      expect((await installedPackageJson(forward, "apps/b", "no-deps")).version).toBe("2.0.0");

      // pins existing behaviour (not a fix): a variant lockfile migrates to the bun.lock a fresh install writes
      const { packageDir: fresh } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: peerVariantPackageJsons,
      });

      const freshInstall = await run(fresh, "install");

      expect(freshInstall.stderr).not.toContain("error:");
      expect(freshInstall.exitCode).toBe(0);
      expect(await bunLockOf(fresh)).toBe(bunLock);
    });

    test("importers that reference different peer variants get one store entry per peer set with the isolated linker", async () => {
      // pins existing behaviour (not a fix): pnpm's per-importer variants (pnpm/pnpm peers-suffix) are rebuilt by the isolated linker from the single migrated entry
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          ...peerVariantPackageJsons,
          "pnpm-lock.yaml": peerVariantLockfile(`${peerVariant101}\n${peerVariant200}`),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(packageDir);

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await bunLockOf(packageDir)).toBe(migrated);

      const variants = readdirSync(join(packageDir, "node_modules", ".bun")).filter(name =>
        /^peer-deps@1\.0\.0\+[0-9a-f]{16}$/.test(name),
      );
      expect(variants).toBeArrayOfSize(2);

      const peerDepsDirs: string[] = [];
      for (const [app, version] of [
        ["apps/a", "1.0.1"],
        ["apps/b", "2.0.0"],
      ]) {
        const peerDepsDir = realpathSync(join(packageDir, app, "node_modules", "peer-deps"));
        expect(variants.some(variant => peerDepsDir.includes(variant))).toBeTrue();
        expect((await Bun.file(join(dirname(peerDepsDir), "no-deps", "package.json")).json()).version).toBe(version);
        peerDepsDirs.push(peerDepsDir);
      }
      expect(peerDepsDirs[0]).not.toBe(peerDepsDirs[1]);
    });

    test("the migrating install links the peer version its bun.lock reloads with the isolated linker", async () => {
      // pnpm auto-installed no-deps@1.1.0 for peer-deps-fixed's `no-deps: ^1.0.0` while one-dep pins
      // no-deps@1.0.1, so 1.1.0 is only reachable through the peer edge. The hoisted tree dedupes that
      // edge onto 1.0.1, bun.lock never records 1.1.0, and reloading binds the edge to 1.0.1. The
      // migrating install has to link the same binding, or the next install relinks the entry.
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({
            name: "v9-auto-installed-peer",
            dependencies: { "one-dep": "1.0.0", "peer-deps-fixed": "1.0.0" },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0
      peer-deps-fixed:
        specifier: 1.0.0
        version: 1.0.0(no-deps@1.1.0)

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  no-deps@1.1.0:
    resolution: {integrity: ${NO_DEPS_1_1_0_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

  peer-deps-fixed@1.0.0:
    resolution: {integrity: ${PEER_DEPS_FIXED_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: ^1.0.0

snapshots:

  no-deps@1.0.1: {}

  no-deps@1.1.0: {}

  one-dep@1.0.0:
    dependencies:
      no-deps: 1.0.1

  peer-deps-fixed@1.0.0(no-deps@1.1.0):
    dependencies:
      no-deps: 1.1.0
`,
        },
      });

      const migrating = await run(packageDir, "install");

      expect(migrating.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(migrating.stderr).not.toContain("error:");
      expect(migrating.exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"no-deps": ["no-deps@1.0.1"`);
      expect(bunLock).not.toContain("no-deps@1.1.0");

      const storeDir = join(packageDir, "node_modules", ".bun");
      const peerDepsFixedDir = realpathSync(join(packageDir, "node_modules", "peer-deps-fixed"));
      expect((await Bun.file(join(dirname(peerDepsFixedDir), "no-deps", "package.json")).json()).version).toBe("1.0.1");
      const store = readdirSync(storeDir).sort();
      expect(store).not.toContain("no-deps@1.1.0");

      const reinstall = await run(packageDir, "install");

      expect(reinstall.stderr).not.toContain("error:");
      expect(reinstall.stdout).toContain("(no changes)");
      expect(reinstall.exitCode).toBe(0);
      expect(readdirSync(storeDir).sort()).toEqual(store);
      expect(realpathSync(join(packageDir, "node_modules", "peer-deps-fixed"))).toBe(peerDepsFixedDir);
      expect(await bunLockOf(packageDir)).toBe(bunLock);
    });

    test("a peer met in one importer and unmet in another is bound from the met variant", async () => {
      // pnpm sorts the unsuffixed (peer-unmet) variant first; the met variant must still bind the peer
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: join(import.meta.dir, "pnpm/v9-peer-variant-merge"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(packageDir);
      expect(migrated).toContain(
        `"has-peer": ["has-peer@file:vendor/has-peer", { "peerDependencies": { "peer": "*" } }]`,
      );
      expect(migrated).toContain(`"has-peer/peer": ["peer@file:vendor/peer", {}]`);
      expect(migrated).toContain(`"with/peer": ["peer@file:vendor/peer", {}]`);
      // the peer of with/has-peer dedupes against the sibling copy at with/peer
      expect(migrated).not.toContain(`"with/has-peer/peer"`);
      expect(migrated).not.toContain(`"optionalPeers"`);

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await bunLockOf(packageDir)).toBe(migrated);

      const entry = readdirSync(join(packageDir, "node_modules", ".bun")).find(name =>
        /^has-peer@file\+vendor\+has-peer\+[0-9a-f]{16}$/.test(name),
      );
      expect(entry).toBeDefined();
      expect(
        existsSync(join(packageDir, "node_modules", ".bun", entry!, "node_modules", "peer", "package.json")),
      ).toBeTrue();
    });

    describe("a peer that pnpm left unmet is bound by the install that migrates", () => {
      // pnpm records a met peer as a suffix on the dependent's snapshot key; an unmet one (autoInstallPeers
      // off) has no suffix, so the migration has nothing to bind peer-deps-too's `no-deps` edge to. Loading
      // the migrated bun.lock binds it to the no-deps hoisted to the root, and the isolated store keys
      // peer-deps-too by that binding, so the migrating install has to bind it the same way or the next
      // install re-keys the entry (bun.lock itself is identical either way).
      const unmetPeerProject = (importer: string, packageJson: Record<string, unknown>) => ({
        "package.json": JSON.stringify({ name: "unmet-peer", ...packageJson }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
${importer}

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

  peer-deps-too@1.0.0:
    resolution: {integrity: ${PEER_DEPS_TOO_1_0_0_INTEGRITY}}
    peerDependencies:
      no-deps: '*'

snapshots:

  no-deps@1.0.1: {}

  one-dep@1.0.0:
    dependencies:
      no-deps: 1.0.1

  peer-deps-too@1.0.0: {}
`,
      });

      const storeEntries = (dir: string) =>
        readdirSync(join(dir, "node_modules", ".bun"))
          .filter(name => name !== "node_modules")
          .sort();

      // Hoisting places a package's dependencies breadth-first in dependency-group order. With both in
      // `dependencies`, one-dep's no-deps reaches the root before peer-deps-too's peer is looked at; as a
      // devDependency peer-deps-too is processed first, and the peer is bound when no-deps arrives later.
      test.concurrent.each([
        {
          group: "dependencies",
          packageJson: { dependencies: { "one-dep": "1.0.0", "peer-deps-too": "1.0.0" } },
          importer: `    dependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0
      peer-deps-too:
        specifier: 1.0.0
        version: 1.0.0`,
        },
        {
          group: "devDependencies",
          packageJson: { dependencies: { "one-dep": "1.0.0" }, devDependencies: { "peer-deps-too": "1.0.0" } },
          importer: `    dependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0
    devDependencies:
      peer-deps-too:
        specifier: 1.0.0
        version: 1.0.0`,
        },
      ])(
        "peer-deps-too in $group keys its isolated store entry like a reinstall and like a fresh install",
        async ({ packageJson, importer }) => {
          const files = unmetPeerProject(importer, packageJson);
          const { packageDir } = await verdaccio.createTestDir({ bunfigOpts: { linker: "isolated" }, files });

          const install = await run(packageDir, "install");

          expect(install.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
          expect(install.exitCode).toBe(0);
          const migrated = await bunLockOf(packageDir);
          expect(migrated).toContain(`{ "peerDependencies": { "no-deps": "*" } }`);
          const store = storeEntries(packageDir);
          expect(store).toEqual([
            "no-deps@1.0.1",
            "one-dep@1.0.0",
            expect.stringMatching(/^peer-deps-too@1\.0\.0\+[0-9a-f]{16}$/),
          ]);

          const reinstall = await run(packageDir, "install");

          expect(reinstall.stdout).toContain("(no changes)");
          expect(reinstall.exitCode).toBe(0);
          expect(await bunLockOf(packageDir)).toBe(migrated);
          expect(storeEntries(packageDir)).toEqual(store);

          const { packageDir: fresh } = await verdaccio.createTestDir({
            bunfigOpts: { linker: "isolated" },
            files: { "package.json": files["package.json"] },
          });

          const freshInstall = await run(fresh, "install");

          expect(freshInstall.stderr).toContain("Saved lockfile");
          expect(freshInstall.exitCode).toBe(0);
          expect(storeEntries(fresh)).toEqual(store);
        },
      );

      // The root's and a workspace's own peers come from package.json and are unbound the same way; the
      // isolated linker links a bound peer into the importer's node_modules.
      test.concurrent("the root's and a workspace's own peers are linked by the migrating install", async () => {
        const manifests = {
          "package.json": JSON.stringify({
            name: "importer-peers",
            workspaces: ["apps/*"],
            dependencies: { "one-dep": "1.0.0" },
            peerDependencies: { "no-deps": "*" },
          }),
          "apps/a/package.json": JSON.stringify({ name: "a", peerDependencies: { "no-deps": "*" } }),
        };
        const { packageDir } = await verdaccio.createTestDir({
          bunfigOpts: { linker: "isolated" },
          files: {
            ...manifests,
            "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0

  apps/a: {}

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}

  one-dep@1.0.0:
    dependencies:
      no-deps: 1.0.1
`,
          },
        });
        const linked = (dir: string) => ({
          root: readdirSync(join(dir, "node_modules"))
            .filter(name => name !== ".bun")
            .sort(),
          a: existsSync(join(dir, "apps/a/node_modules")) ? readdirSync(join(dir, "apps/a/node_modules")).sort() : [],
        });

        const install = await run(packageDir, "install", "--verbose");

        expect(install.stderr).toContain('skipping peer "no-deps" of the root package');
        expect(install.stderr).toContain('skipping peer "no-deps" of workspace "apps/a"');
        expect(install.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect(install.exitCode).toBe(0);
        const migrated = await bunLockOf(packageDir);
        expect(linked(packageDir)).toEqual({ root: ["no-deps", "one-dep"], a: ["no-deps"] });

        const reinstall = await run(packageDir, "install");

        expect(reinstall.stdout).toContain("(no changes)");
        expect(reinstall.exitCode).toBe(0);
        expect(await bunLockOf(packageDir)).toBe(migrated);
        expect(linked(packageDir)).toEqual({ root: ["no-deps", "one-dep"], a: ["no-deps"] });

        const { packageDir: fresh } = await verdaccio.createTestDir({
          bunfigOpts: { linker: "isolated" },
          files: manifests,
        });

        const freshInstall = await run(fresh, "install");

        expect(freshInstall.stderr).toContain("Saved lockfile");
        expect(freshInstall.exitCode).toBe(0);
        expect(linked(fresh)).toEqual({ root: ["no-deps", "one-dep"], a: ["no-deps"] });
      });
    });

    const linkedPeerFiles = {
      "package.json": JSON.stringify({
        name: "v9-linked-peer",
        workspaces: ["packages/*"],
        dependencies: { "has-peer": "file:vendor/has-peer" },
      }),
      "packages/peer/package.json": JSON.stringify({ name: "peer", version: "1.0.0" }),
      "vendor/has-peer/package.json": JSON.stringify({
        name: "has-peer",
        version: "1.0.0",
        peerDependencies: { peer: "*" },
      }),
    };
    const linkedPeerLockfile = (snapshots: string) => `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      has-peer:
        specifier: file:vendor/has-peer
        version: file:vendor/has-peer

  packages/peer: {}

packages:

  has-peer@file:vendor/has-peer:
    resolution: {directory: vendor/has-peer, type: directory}
    version: 1.0.0
    peerDependencies:
      peer: '*'

snapshots:

${snapshots}`;

    test.concurrent("a declared peer resolved to a link: stays a regular dependency edge", async () => {
      using dir = tempDir("pnpm-v9-peer-resolved-to-link", {
        ...linkedPeerFiles,
        "pnpm-lock.yaml": linkedPeerLockfile(`  has-peer@file:vendor/has-peer:
    dependencies:
      peer: link:packages/peer
`),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).not.toContain("no package entry");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(String(dir));
      expect(migrated).toContain(
        `"has-peer": ["has-peer@file:vendor/has-peer", { "dependencies": { "peer": "link:packages/peer" } }]`,
      );
      expect(migrated).toContain(`"peer": ["peer@workspace:packages/peer"]`);
      expect(migrated).not.toContain(`"peerDependencies"`);

      const install = await run(String(dir), "install", "--frozen-lockfile", "--linker", "hoisted");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await bunLockOf(String(dir))).toBe(migrated);
      expect(await installedPackageJson(String(dir), "", "peer")).toStrictEqual({ name: "peer", version: "1.0.0" });
    });

    test.concurrent("a later variant resolving the peer to a link: leaves the peer for bun install", async () => {
      using dir = tempDir("pnpm-v9-peer-variant-link", {
        ...linkedPeerFiles,
        "pnpm-lock.yaml": linkedPeerLockfile(`  has-peer@file:vendor/has-peer: {}

  has-peer@file:vendor/has-peer(peer@packages+peer):
    dependencies:
      peer: link:packages/peer
`),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).not.toContain("no package entry");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(String(dir));
      expect(migrated).toContain(
        `"has-peer": ["has-peer@file:vendor/has-peer", { "peerDependencies": { "peer": "*" } }]`,
      );
      expect(migrated).toContain(`"peer": ["peer@workspace:packages/peer"]`);
      expect(migrated).not.toContain("link:");

      const install = await run(String(dir), "install", "--linker", "hoisted");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await installedPackageJson(String(dir), "", "peer")).toStrictEqual({ name: "peer", version: "1.0.0" });
    });

    test("root and workspace peerDependencies come from package.json", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/v9-importer-peers"),
      });

      const { stderr, exitCode } = await migrate(packageDir, "--verbose");

      expect(stderr).not.toContain("skipping peer");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(workspaceBlock(bunLock, "")).toBe(
        [
          `    "": {`,
          `      "name": "v9-importer-peers",`,
          `      "dependencies": {`,
          `        "no-deps": "^1.0.0",`,
          `      },`,
          `      "peerDependencies": {`,
          `        "@types/is-number": "*",`,
          `        "@types/no-deps": "*",`,
          `        "no-deps": "^1.0.0",`,
          `        "peer-deps-fixed": "^1.0.0",`,
          `      },`,
          `      "optionalPeers": [`,
          `        "@types/is-number",`,
          `        "@types/no-deps",`,
          `      ],`,
          `    },`,
        ].join("\n"),
      );
      expect(workspaceBlock(bunLock, "packages/a")).toBe(
        [
          `    "packages/a": {`,
          `      "name": "a",`,
          `      "peerDependencies": {`,
          `        "no-deps": "^1.0.0",`,
          `      },`,
          `    },`,
        ].join("\n"),
      );
    });

    test("a name in both devDependencies and peerDependencies gets both entries, like a fresh install", async () => {
      const packageJson = JSON.stringify({
        name: "dev-and-peer",
        devDependencies: { "no-deps": "^1.0.0" },
        peerDependencies: { "no-deps": "^1.0.0" },
      });
      const { packageDir: migrated } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": packageJson,
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(migrated);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migratedRoot = workspaceBlock(await bunLockOf(migrated), "");
      expect(migratedRoot).toContain(`      "devDependencies": {\n        "no-deps": "^1.0.0",\n      },`);
      expect(migratedRoot).toContain(`      "peerDependencies": {\n        "no-deps": "^1.0.0",\n      },`);

      const { packageDir: fresh } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": packageJson },
      });

      const install = await run(fresh, "install");

      expect(install.stderr).toContain("Saved lockfile");
      expect(install.exitCode).toBe(0);
      expect(migratedRoot).toBe(workspaceBlock(await bunLockOf(fresh), ""));
    });

    test("workspace peers pnpm did not auto-install are merged from the member's package.json", async () => {
      // port of pnpm11/installing/deps-installer/test/install/injectLocalPackages.ts 'inject local packages'
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({ name: "v9-workspace-peers", workspaces: ["packages/*"] }),
          "packages/project-1/package.json": JSON.stringify({
            name: "project-1",
            version: "1.0.0",
            dependencies: { "a-dep": "1.0.1" },
            peerDependencies: { "no-deps": ">=1.0.0" },
          }),
          "packages/project-2/package.json": JSON.stringify({
            name: "project-2",
            version: "1.0.0",
            dependencies: { "project-1": "workspace:*" },
            devDependencies: { "no-deps": "1.0.1" },
            dependenciesMeta: { "project-1": { injected: true } },
          }),
          "packages/project-3/package.json": JSON.stringify({
            name: "project-3",
            version: "1.0.0",
            dependencies: { "project-2": "workspace:*" },
            devDependencies: { "no-deps": "2.0.0" },
            dependenciesMeta: { "project-2": { injected: true } },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false
  injectWorkspacePackages: true

importers:

  .: {}

  packages/project-1:
    dependencies:
      a-dep:
        specifier: 1.0.1
        version: 1.0.1

  packages/project-2:
    dependencies:
      project-1:
        specifier: workspace:*
        version: file:packages/project-1(no-deps@1.0.1)
    devDependencies:
      no-deps:
        specifier: 1.0.1
        version: 1.0.1

  packages/project-3:
    dependencies:
      project-2:
        specifier: workspace:*
        version: file:packages/project-2(no-deps@2.0.0)
    devDependencies:
      no-deps:
        specifier: 2.0.0
        version: 2.0.0

packages:

  a-dep@1.0.1:
    resolution: {integrity: ${A_DEP_1_0_1_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  no-deps@2.0.0:
    resolution: {integrity: ${NO_DEPS_2_0_0_INTEGRITY}}

  project-1@file:packages/project-1:
    resolution: {directory: packages/project-1, type: directory}
    version: 1.0.0
    peerDependencies:
      no-deps: '>=1.0.0'

  project-2@file:packages/project-2:
    resolution: {directory: packages/project-2, type: directory}
    version: 1.0.0

snapshots:

  a-dep@1.0.1: {}

  no-deps@1.0.1: {}

  no-deps@2.0.0: {}

  project-1@file:packages/project-1(no-deps@1.0.1):
    dependencies:
      a-dep: 1.0.1
      no-deps: 1.0.1

  project-1@file:packages/project-1(no-deps@2.0.0):
    dependencies:
      a-dep: 1.0.1
      no-deps: 2.0.0

  project-2@file:packages/project-2(no-deps@2.0.0):
    dependencies:
      project-1: file:packages/project-1(no-deps@2.0.0)
    transitivePeerDependencies:
      - no-deps
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir, "--verbose");

      expect(stderr).toContain(
        'warn: skipping peer "no-deps" of workspace "packages/project-1": not in pnpm-lock.yaml, resolving it',
      );
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(workspaceBlock(bunLock, "packages/project-1")).toContain(
        `      "peerDependencies": {\n        "no-deps": ">=1.0.0",\n      },`,
      );
      expect(bunLock).toContain(`"project-1": ["project-1@workspace:packages/project-1"]`);
      expect(bunLock).toContain(`"project-2": ["project-2@workspace:packages/project-2"]`);
      expect(bunLock).not.toContain("@file:packages/");
      // the injected packages: entry declares the same peer; it must not become package-level metadata too
      expect(bunLock.split(`"no-deps": ">=1.0.0"`).length - 1).toBe(1);

      const install = await run(packageDir, "install");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(
        await Bun.file(join(packageDir, "packages/project-2/node_modules/project-1/package.json")).json(),
      ).toStrictEqual({
        name: "project-1",
        version: "1.0.0",
        dependencies: { "a-dep": "1.0.1" },
        peerDependencies: { "no-deps": ">=1.0.0" },
      });
      expect(
        await Bun.file(join(packageDir, "packages/project-3/node_modules/project-2/package.json")).json(),
      ).toStrictEqual({
        name: "project-2",
        version: "1.0.0",
        dependencies: { "project-1": "workspace:*" },
        devDependencies: { "no-deps": "1.0.1" },
        dependenciesMeta: { "project-1": { injected: true } },
      });
    });

    test("an unrecorded required peer is reported and left for bun install", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "unrecorded-peer",
            dependencies: { "no-deps": "^1.0.0" },
            peerDependencies: { "has-peer": "^1.0.0" },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir, "--verbose");

      expect(stderr).toContain(
        'warn: skipping peer "has-peer" of the root package: not in pnpm-lock.yaml, resolving it',
      );
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      // left out, like a dependency added after pnpm-lock.yaml was written
      const locked = [
        `    "": {`,
        `      "name": "unrecorded-peer",`,
        `      "dependencies": {`,
        `        "no-deps": "^1.0.0",`,
        `      },`,
      ];
      expect(workspaceBlock(await bunLockOf(packageDir), "")).toBe([...locked, `    },`].join("\n"));

      const install = await run(packageDir, "install");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      const resolved = await bunLockOf(packageDir);
      expect(workspaceBlock(resolved, "")).toBe(
        [...locked, `      "peerDependencies": {`, `        "has-peer": "^1.0.0",`, `      },`, `    },`].join("\n"),
      );
      expect(resolved).toContain(`"has-peer": ["has-peer@1.0.0"`);
      expect(resolved).toContain(`"no-deps": ["no-deps@1.0.1"`);
      await expectInstallToLeaveUnchanged(packageDir, resolved);
    });

    test.concurrent("bun install resolves the required peers that pnpm-lock.yaml does not record", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "unrecorded-peers",
            workspaces: ["packages/*"],
            dependencies: { "no-deps": "^1.0.0" },
            peerDependencies: { "a-dep": "1.0.1" },
          }),
          "packages/ui/package.json": JSON.stringify({
            name: "ui",
            version: "1.0.0",
            dependencies: { "no-deps": "^1.0.0" },
            peerDependencies: { "what-bin": "1.0.0" },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1

  packages/ui:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.0: {}

  no-deps@1.0.1: {}
`,
        },
      });

      // a frozen install takes pnpm-lock.yaml as it is
      const frozenMigration = await run(packageDir, "install", "--frozen-lockfile");

      expect(frozenMigration.stderr).not.toContain("error:");
      expect(frozenMigration.exitCode).toBe(0);
      expect(existsSync(join(packageDir, "bun.lock"))).toBe(false);

      const install = await run(packageDir, "install", "--verbose");

      expect(install.stderr).toContain('skipping peer "a-dep" of the root package');
      expect(install.stderr).toContain('skipping peer "what-bin" of workspace "packages/ui"');
      expect(install.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(install.exitCode).toBe(0);
      const migrated = await bunLockOf(packageDir);
      const { workspaces, packages } = Bun.JSONC.parse(migrated) as { workspaces: object; packages: object };
      expect(workspaces).toEqual({
        "": {
          name: "unrecorded-peers",
          dependencies: { "no-deps": "^1.0.0" },
          peerDependencies: { "a-dep": "1.0.1" },
        },
        "packages/ui": {
          name: "ui",
          version: "1.0.0",
          dependencies: { "no-deps": "^1.0.0" },
          peerDependencies: { "what-bin": "1.0.0" },
        },
      });
      expect(Object.entries(packages).map(([key, [resolution]]) => [key, resolution])).toEqual([
        ["a-dep", "a-dep@1.0.1"],
        ["no-deps", "no-deps@1.0.1"],
        ["ui", "ui@workspace:packages/ui"],
        ["what-bin", "what-bin@1.0.0"],
        ["ui/no-deps", "no-deps@1.0.0"],
      ]);

      const frozen = await run(packageDir, "install", "--frozen-lockfile");

      expect(frozen.stderr).not.toContain("error:");
      expect(frozen.exitCode).toBe(0);
      await expectInstallToLeaveUnchanged(packageDir, migrated);
    });

    test("peers declared with a catalog: range keep the catalog reference", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "catalog-peer",
            workspaces: { catalog: { "no-deps": "^1.0.0" } },
            peerDependencies: { "no-deps": "catalog:" },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

catalogs:
  default:
    no-deps:
      specifier: ^1.0.0
      version: 1.0.1

importers:

  .:
    dependencies:
      no-deps:
        specifier: 'catalog:'
        version: 1.0.1

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("missing entry");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      const root = workspaceBlock(bunLock, "");
      expect(root).toContain(`      "peerDependencies": {\n        "no-deps": "catalog:",\n      },`);
      expect(root).not.toContain(`"dependencies"`);
      expect(bunLock).toContain(`"catalog": {\n    "no-deps": "^1.0.0",\n  }`);

      const install = await run(packageDir, "install");

      expect(install.stderr).not.toContain("Saved lockfile");
      expect(install.exitCode).toBe(0);
      expect(workspaceBlock(await bunLockOf(packageDir), "")).toBe(root);
    });

    test("bun install after bun pm migrate does not rewrite bun.lock", async () => {
      // real pnpm output: the root's peer-only `a-dep` sits under the importer's dependencies
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/basic"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(packageDir);
      const root = workspaceBlock(migrated, "");
      expect(root).toContain(`      "peerDependencies": {\n        "a-dep": "1.0.1",\n      },`);
      expect(root).toContain(`      "dependencies": {\n        "no-deps": "~1.0.0",\n      },`);
      expect(root.split(`"a-dep"`).length - 1).toBe(1);

      await expectInstallToLeaveUnchanged(packageDir, migrated);
      expect(await installedPackageJson(packageDir, "", "a-dep")).toStrictEqual({ name: "a-dep", version: "1.0.1" });
    });

    test("bun install straight from pnpm-lock.yaml writes the same importers as bun pm migrate", async () => {
      const files = join(import.meta.dir, "pnpm/basic");
      const { packageDir: viaMigrate } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });
      const { packageDir: viaInstall } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });

      const migrated = await migrate(viaMigrate);
      expect(migrated.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(migrated.exitCode).toBe(0);

      const [installAfterMigrate, directInstall] = await Promise.all([
        run(viaMigrate, "install"),
        run(viaInstall, "install"),
      ]);

      expect(installAfterMigrate.stderr).not.toContain("Saved lockfile");
      expect(installAfterMigrate.exitCode).toBe(0);
      expect(directInstall.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(directInstall.stderr.split("Saved lockfile").length - 1).toBe(1);
      expect(directInstall.exitCode).toBe(0);

      const importers = workspacesSection(await bunLockOf(viaMigrate));
      expect(importers).toContain(`      "peerDependencies": {\n        "a-dep": "1.0.1",\n      },`);
      expect(workspacesSection(await bunLockOf(viaInstall))).toBe(importers);
    });
  });

  test("excludeLinksFromLockfile omissions are reported", async () => {
    // pnpm11/installing/deps-installer/test/install/excludeLinksFromLockfile.ts
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "exclude-links",
          dependencies: { "no-deps": "^1.0.0", linked: "link:../linked" },
        }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  excludeLinksFromLockfile: true

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

snapshots:

  no-deps@1.0.0: {}
`,
      },
    });

    const { stderr, exitCode } = await migrate(packageDir, "--verbose");

    expect(stderr).toContain(
      'warn: skipping "linked" from the root package: excluded from pnpm-lock.yaml by excludeLinksFromLockfile',
    );
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(packageDir);
    expect(bunLock).toContain(`"no-deps@1.0.0"`);
    expect(bunLock).not.toContain("linked");
  });

  test.concurrent(
    "excludeLinksFromLockfile omissions name the workspace importer and its devDependencies",
    async () => {
      using dir = tempDir("pnpm-v9-exclude-links-workspace", {
        "package.json": JSON.stringify({ name: "exclude-links-workspace", workspaces: ["packages/*"] }),
        "packages/a/package.json": JSON.stringify({ name: "a", devDependencies: { x: "link:../x" } }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  excludeLinksFromLockfile: true

importers:

  .: {}

  packages/a: {}
`,
      });

      const { stderr, exitCode } = await migrate(String(dir), "--verbose");

      expect(stderr).toContain(
        'warn: skipping "x" from workspace "packages/a": excluded from pnpm-lock.yaml by excludeLinksFromLockfile',
      );
      expect(stderr).not.toContain("from the root package");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(workspaceBlock(bunLock, "packages/a")).toBe(
        [`    "packages/a": {`, `      "name": "a",`, `    },`].join("\n"),
      );
      expect(bunLock).not.toContain(`"x"`);
    },
  );

  test.concurrent("git resolution whose repo already carries the git+ prefix is not prefixed twice", async () => {
    const commit = "cccccccccccccccccccccccccccccccccccccccc";
    const repo = "git+ssh://git@example.com/org/c.git";
    using dir = tempDir("pnpm-v9-git-plus-repo", {
      "package.json": JSON.stringify({ name: "git-plus-repo", dependencies: { c: `${repo}#v1` } }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      c:
        specifier: ${repo}#v1
        version: ${repo}#${commit}

packages:

  c@${repo}#${commit}:
    resolution: {commit: ${commit}, repo: ${repo}, type: git}
    version: 1.0.0

snapshots:

  c@${repo}#${commit}: {}
`,
    });

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(`"c": ["c@${repo}#${commit}", { "version": "1.0.0" }`);
    expect(bunLock).not.toContain("git+git+");
  });

  test.concurrent("bun install checks out the commit of a git resolution", async () => {
    const url = "https://git.example.com/org/c.git";
    using repo = await hostedGitRepository([url], { "package.json": JSON.stringify({ name: "c", version: "1.0.0" }) });
    using dir = tempDir("pnpm-v9-git-install", {
      "package.json": JSON.stringify({ name: "git-install", dependencies: { c: `git+${url}` } }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      c:
        specifier: git+${url}
        version: git+${url}#${repo.sha}

packages:

  c@git+${url}#${repo.sha}:
    resolution: {commit: ${repo.sha}, repo: ${url}, type: git}
    version: 1.0.0

snapshots:

  c@git+${url}#${repo.sha}: {}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...repo.env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(await bunLockOf(String(dir))).toContain(
      `"c": ["c@git+${url}#${repo.sha}", { "version": "1.0.0" }, "${repo.sha}"]`,
    );
    expect(existsSync(join(String(dir), "node_modules", "c", "package.json"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  // [`repo` as pnpm writes it, the version of the importer, the URL in bun.lock]; LOCAL is the repository's file: URL.
  test.concurrent.each([
    ["LOCAL", "git+LOCAL", "git+LOCAL"],
    [
      "https://git.example.com/org/c.git",
      "git+https://git.example.com/org/c.git",
      "git+https://git.example.com/org/c.git",
    ],
    [
      "git+https://git.example.com/org/c.git",
      "git+https://git.example.com/org/c.git",
      "git+https://git.example.com/org/c.git",
    ],
    [
      "ssh://git@git.example.com/org/c.git",
      "git+ssh://git@git.example.com/org/c.git",
      "git+ssh://git@git.example.com/org/c.git",
    ],
    [
      "git@git.example.com:org/c.git",
      "git+ssh://git@git.example.com/org/c.git",
      "git+ssh://git@git.example.com:org/c.git",
    ],
  ])("a git resolution with repo: %s stays at a commit that is not the newest", async (...row) => {
    using dir = tempDir("pnpm-v9-git-pin", {
      repo: { "package.json": JSON.stringify({ name: "c", version: "1.0.0" }), "index.js": "pinned" },
    });
    const repo = join(String(dir), "repo");
    const git = async (...args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [
          "git",
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        cwd: repo,
        env: { ...bunEnv, GIT_CONFIG_NOSYSTEM: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(`git ${args.join(" ")} exited with ${exitCode}: ${stderr}`);
      return stdout.trim();
    };
    await git("-c", "init.defaultBranch=main", "init", "--quiet");
    await git("add", "-A");
    await git("commit", "--quiet", "-m", "pinned");
    const pinned = await git("rev-parse", "HEAD");
    writeFileSync(join(repo, "index.js"), "newer");
    await git("commit", "--quiet", "-a", "-m", "newer");

    const local = Bun.pathToFileURL(repo).href;
    const [repoField, version, inBunLock] = row.map(text => text.replace("LOCAL", local));
    const project = join(String(dir), "project");
    await Bun.write(join(project, "package.json"), JSON.stringify({ name: "git-pin", dependencies: { c: version } }));
    await Bun.write(
      join(project, "pnpm-lock.yaml"),
      `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      c:
        specifier: ${version}
        version: ${version}#${pinned}

packages:

  c@${version}#${pinned}:
    resolution: {commit: ${pinned}, repo: ${repoField}, type: git}
    version: 1.0.0

snapshots:

  c@${version}#${pinned}: {}
`,
    );
    // The two URLs bun clones first; git takes the local repository for them and refuses every other transport.
    const env = {
      GIT_ALLOW_PROTOCOL: "file",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: `url.${local}.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://git.example.com/org/c.git",
      GIT_CONFIG_KEY_1: `url.${local}.insteadOf`,
      GIT_CONFIG_VALUE_1: "https://git@git.example.com/org/c.git",
    };

    const { stderr, exitCode } = await runWithEnv(project, env, "install");

    expect(stderr.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(await Bun.file(join(project, "node_modules", "c", "index.js")).text()).toBe("pinned");
    expect(await bunLockOf(project)).toContain(
      `"c": ["c@${inBunLock}#${pinned}", { "version": "1.0.0" }, "${pinned}"]`,
    );
    expect(exitCode).toBe(0);

    const frozen = await runWithEnv(project, env, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
  });

  test.concurrent("bun install downloads the commit of a codeload tarball resolution", async () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const tarball = await githubTarball(`me-c-${commit.slice(0, 7)}`, {
      "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
    });
    const requests: string[] = [];
    await using github = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname);
        return new Response(tarball);
      },
    });
    const url = `https://codeload.github.com/me/c/tar.gz/${commit}`;
    using dir = tempDir("pnpm-v9-codeload-install", {
      "package.json": JSON.stringify({ name: "codeload-install", dependencies: { c: "github:me/c" } }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      c:
        specifier: github:me/c
        version: ${url}

packages:

  c@${url}:
    resolution: {tarball: ${url}}
    version: 1.0.0

snapshots:

  c@${url}: {}
`,
    });

    const { stderr, exitCode } = await runWithEnv(String(dir), { GITHUB_API_URL: github.url.origin }, "install");

    expect(stderr.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(requests).toEqual([`/repos/me/c/tarball/${commit}`]);
    expect(existsSync(join(String(dir), "node_modules", "c", "package.json"))).toBe(true);
    expect(await bunLockOf(String(dir))).toContain(
      `"c": ["c@github:me/c#${commit}", { "version": "1.0.0" }, "${commit}"`,
    );
    expect(exitCode).toBe(0);
  });

  describe("registry tarball: urls", () => {
    // pnpm/pnpm#13534: GitHub Packages / npm Enterprise tarballs are not on the canonical `/-/` path
    test("recorded under the configured registry is kept", async () => {
      const registry = verdaccio.registryUrl();
      const tarball = `${registry}download/no-deps/1.0.1/0123456789abcdef`;
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "kept-tarball", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryLockfileWithTarball(tarball),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`["no-deps@1.0.1", "${tarball}", {}, "${NO_DEPS_1_0_1_INTEGRITY}"]`);
    });

    // guards for the keep-tarball path above (pnpm/pnpm#5920 / #4361): off-registry urls are rebuilt
    test("recorded on a foreign host is rebuilt from the configured registry", async () => {
      const registry = verdaccio.registryUrl();
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "foreign-tarball", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryLockfileWithTarball("https://evil.example.com/no-deps/-/no-deps-1.0.1.tgz"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(
        `["no-deps@1.0.1", "${registry}no-deps/-/no-deps-1.0.1.tgz", {}, "${NO_DEPS_1_0_1_INTEGRITY}"]`,
      );
      expect(bunLock).not.toContain("evil.example.com");
    });

    test("under a registry whose hostname is a prefix of the recorded url's is rebuilt", async () => {
      const registry = verdaccio.registryUrl();
      const lookalike = `${registry.slice(0, -1)}.evil.example.com/no-deps/-/no-deps-1.0.1.tgz`;
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "lookalike-tarball", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryLockfileWithTarball(lookalike),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"${registry}no-deps/-/no-deps-1.0.1.tgz"`);
      expect(bunLock).not.toContain("evil.example.com");
    });
  });

  // The manifests fetched right after a migration only backfill bins and os/cpu, so one the registry does not serve is a warning whichever group the package is in; what fails the install is a required package's own tarball.
  describe("manifests fetched after the migration", () => {
    const lockfile = (group: string) => `lockfileVersion: '9.0'

importers:

  .:
    ${group}:
      no-deps:
        specifier: 1.0.1
        version: 1.0.1

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}
`;

    const goneRegistry = () => Bun.serve({ port: 0, fetch: () => new Response("gone", { status: 404 }) });
    const project = (registry: Bun.Server<undefined>, group: string) =>
      tempDir("pnpm-v9-manifest-gone", {
        "package.json": JSON.stringify({ name: "manifest-gone", [group]: { "no-deps": "1.0.1" } }),
        "bunfig.toml": `[install]\nregistry = "${registry.url.href}"\n`,
        "pnpm-lock.yaml": lockfile(group),
      });
    const fetchLines = (stderr: string) =>
      stderr.split("\n").filter(line => line.startsWith("warn:") || line.startsWith("error:"));

    test.concurrent.each([
      ["optionalDependencies", "warn", 0],
      ["dependencies", "error", 1],
    ])(
      "installing when the registry no longer serves the %s entry: the manifest line is a warning, the tarball line says %s",
      async (group, tarballSeverity, expectedExitCode) => {
        using registry = goneRegistry();
        using dir = project(registry, group);

        const { stdout, stderr, exitCode } = await run(String(dir), "install");

        expect(stdout).toStartWith("bun install v");
        expect(fetchLines(stderr)).toStrictEqual([
          `warn: GET ${registry.url.origin}/no-deps - 404`,
          `${tarballSeverity}: GET ${registry.url.origin}/no-deps/-/no-deps-1.0.1.tgz - 404`,
        ]);
        expect(existsSync(join(String(dir), "bun.lock"))).toBe(expectedExitCode === 0);
        expect(exitCode).toBe(expectedExitCode);
      },
    );

    // The command's own fetch must not be deduplicated against the migration's failed one, or the failure would stay a warning and the command would exit 0.
    test.concurrent.each<[string, string[]]>([
      ["outdated", ["outdated"]],
      ["update --interactive", ["update", "-i", "--dry-run"]],
    ])(
      "`bun %s` run straight off the pnpm lockfile still fails on the manifest it cannot get",
      async (header, args) => {
        using registry = goneRegistry();
        using dir = project(registry, "dependencies");

        const { stdout, stderr, exitCode } = await run(String(dir), ...args);

        expect(stdout).toMatch(new RegExp(`^bun ${header} v[^\\n]*\\n$`));
        expect(fetchLines(stderr)).toStrictEqual([
          `warn: GET ${registry.url.origin}/no-deps - 404`,
          `error: GET ${registry.url.origin}/no-deps - 404`,
        ]);
        expect(exitCode).toBe(1);
      },
    );
  });

  describe("git sub-directory dependencies", () => {
    // pnpm/pnpm#8243: `repo#commit&path:sub/dir` has no bun equivalent; refuse instead of installing the repo root
    test.concurrent("type: git resolution with path: is rejected naming the package", async () => {
      using dir = fixture("v9-git-subdirectory");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain(
        "pnpm-lock.yaml package 'pkg@git+ssh://git@example.com/org/monorepo.git#cba04669e621b85fbdb33371604de1a2898e68e9&path:packages/pkg' is a git sub-directory dependency",
      );
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });

    test.concurrent("git-hosted tarball resolution with path: is rejected naming the package", async () => {
      // shape from pnpm11/resolving/git-resolver/test/index.ts "with both sub folder and branch"
      const id =
        "https://codeload.github.com/o/mono/tar.gz/777e8a3e78cc89bbf41fb3fd9f6cf922d5463313#path:/packages/pkg";
      using dir = tempDir("pnpm-v9-git-hosted-subdirectory", {
        "package.json": JSON.stringify({
          name: "git-hosted-subdirectory",
          dependencies: { pkg: "github:o/mono#beta&path:/packages/pkg" },
        }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      pkg:
        specifier: github:o/mono#beta&path:/packages/pkg
        version: ${id}

packages:

  pkg@${id}:
    resolution: {gitHosted: true, path: /packages/pkg, tarball: https://codeload.github.com/o/mono/tar.gz/777e8a3e78cc89bbf41fb3fd9f6cf922d5463313}
    version: 1.0.0

snapshots:

  pkg@${id}: {}
`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain(`pnpm-lock.yaml package 'pkg@${id}' is a git sub-directory dependency`);
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });
  });

  // #23694: `bun update -i` migrates once to list the outdated packages, edits the root package.json through the
  // cache, then installs, which migrates again because bun.lock is still not on disk. The editor and the second
  // migration both used the tree the first migration had edited, which pointed into the contents it had freed.
  test("bun update -i in a pnpm workspace migrates twice and keeps package.json intact", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "update-interactive",
          dependencies: { "no-deps": "^1.0.0" },
          pnpm: { overrides: { "a-dep": "1.0.1" } },
        }),
        "packages/a/package.json": JSON.stringify({ name: "a" }),
        "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

overrides:
  a-dep: 1.0.1

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.0

  packages/a: {}

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

snapshots:

  no-deps@1.0.0: {}
`,
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "-i"],
      cwd: packageDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write("a\r");
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("no-deps");
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(packageDir, "package.json")).json()).toStrictEqual({
      name: "update-interactive",
      dependencies: { "no-deps": "^1.1.0" },
      pnpm: { overrides: { "a-dep": "1.0.1" } },
      overrides: { "a-dep": "1.0.1" },
      workspaces: ["packages/*"],
    });
    expect(existsSync(join(packageDir, "bun.lock"))).toBe(true);

    const frozen = await run(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
  });

  describe("overrides", () => {
    function overridesLockfile(overrides: string) {
      return `lockfileVersion: '9.0'

overrides:
${overrides}

importers:

  .: {}
`;
    }

    function overridesSection(bunLock: string) {
      const start = bunLock.indexOf(`  "overrides": {`);
      expect(start).not.toBe(-1);
      const end = bunLock.indexOf("\n  },", start);
      expect(end).not.toBe(-1);
      return bunLock.slice(start, end + "\n  },".length);
    }

    // pnpm/pnpm#5928 (`-` removes the dependency) is warned once, with a location, when bun install reads the copied package.json overrides; pnpm/pnpm#6774 (`name@range` keys) migrates as ranged rules
    test.concurrent("removal values are dropped; name@range keys migrate as ranged rules", async () => {
      const overrides = {
        "left-pad": "-",
        "semver@<7.5.2": "7.5.2",
        "foo>bar": "2.0.0",
        "@scope/pkg@^1": "1.9.0",
        "@scope/plain": "3.0.0",
        "plain": "1.0.0",
      };
      using dir = tempDir("pnpm-v9-overrides-unsupported", {
        "package.json": JSON.stringify({ name: "overrides-unsupported", pnpm: { overrides } }),
        "pnpm-lock.yaml": overridesLockfile(`  left-pad: '-'
  semver@<7.5.2: 7.5.2
  foo>bar: 2.0.0
  '@scope/pkg@^1': 1.9.0
  '@scope/plain': 3.0.0
  plain: 1.0.0`),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).not.toContain("warn:");
      expect(stderr).toContain("copied pnpm.overrides to overrides in package.json");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual({
        name: "overrides-unsupported",
        pnpm: { overrides },
        overrides,
      });

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`"lockfileVersion": 3`);
      expect(bunLock).not.toContain("left-pad");
      expect(overridesSection(bunLock)).toMatchInlineSnapshot(`
        "  "overrides": {
            "@scope/pkg@^1": {
              ".": "1.9.0",
            },
            "@scope/plain": "3.0.0",
            "foo": {
              "bar": "2.0.0",
            },
            "plain": "1.0.0",
            "semver@<7.5.2": {
              ".": "7.5.2",
            },
          },"
      `);

      const install = await run(String(dir), "install");

      expect(install.stderr).toContain(`warn: Removing "left-pad" with "-" is not supported`);
      expect(install.stderr).toMatch(/package\.json:\d+:\d+/);
      expect(install.stderr.split("warn:").length - 1).toBe(1);
      expect(install.exitCode).toBe(0);
    });

    // pnpm reads `pnpm.overrides` and `pnpm.patchedDependencies` from package.json and ignores the root-level
    // fields, so removing them from the `pnpm` block breaks `pnpm install --frozen-lockfile` for everyone still on
    // pnpm (ERR_PNPM_LOCKFILE_CONFIG_MISMATCH). The block has to survive the migration as it was.
    test.concurrent("the pnpm block in package.json is left as it was", async () => {
      const pnpm = {
        overrides: { "no-deps": "1.0.0" },
        patchedDependencies: { "one-dep@1.0.0": "patches/one-dep.patch" },
        onlyBuiltDependencies: ["one-dep"],
      };
      using dir = tempDir("pnpm-v9-pnpm-block-kept", {
        "package.json": JSON.stringify({ name: "pnpm-block-kept", private: true, pnpm }),
        "pnpm-lock.yaml": overridesLockfile("  no-deps: 1.0.0"),
      });
      using onlyMigratedKeys = tempDir("pnpm-v9-pnpm-block-only-migrated-keys", {
        "package.json": JSON.stringify({ name: "pnpm-block-only-migrated-keys", pnpm: { overrides: pnpm.overrides } }),
        "pnpm-lock.yaml": overridesLockfile("  no-deps: 1.0.0"),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).not.toContain("warn:");
      expect(stderr).toContain(
        "copied pnpm.overrides to overrides, copied pnpm.patchedDependencies to patchedDependencies, copied pnpm.onlyBuiltDependencies to trustedDependencies in package.json",
      );
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual({
        name: "pnpm-block-kept",
        private: true,
        pnpm,
        overrides: pnpm.overrides,
        patchedDependencies: pnpm.patchedDependencies,
        trustedDependencies: pnpm.onlyBuiltDependencies,
      });

      const onlyMigrated = await migrate(String(onlyMigratedKeys));

      expect(onlyMigrated.stderr).toContain("copied pnpm.overrides to overrides in package.json");
      expect(onlyMigrated.exitCode).toBe(0);
      expect(await Bun.file(join(String(onlyMigratedKeys), "package.json")).json()).toStrictEqual({
        name: "pnpm-block-only-migrated-keys",
        pnpm: { overrides: pnpm.overrides },
        overrides: pnpm.overrides,
      });
    });

    // pnpm 10 merges `pnpm.overrides` with the `overrides` of pnpm-workspace.yaml, and the lockfile records the
    // merged set. The yaml entries belong in the root-level copy only.
    test.concurrent("pnpm-workspace.yaml overrides go into the root copy, not into the pnpm block", async () => {
      using dir = tempDir("pnpm-v9-overrides-package-json-and-workspace-yaml", {
        "package.json": JSON.stringify({
          name: "overrides-package-json-and-workspace-yaml",
          pnpm: { overrides: { "no-deps": "1.0.0" } },
        }),
        "pnpm-workspace.yaml": "overrides:\n  a-dep: 1.0.1\n",
        "pnpm-lock.yaml": overridesLockfile("  no-deps: 1.0.0\n  a-dep: 1.0.1"),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).not.toContain("warn:");
      expect(stderr).toContain(
        "copied pnpm.overrides to overrides, copied pnpm-workspace.yaml overrides to overrides in package.json",
      );
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual({
        name: "overrides-package-json-and-workspace-yaml",
        pnpm: { overrides: { "no-deps": "1.0.0" } },
        overrides: { "no-deps": "1.0.0", "a-dep": "1.0.1" },
      });
    });

    // Unquoted yaml scalars point into the file contents; quoted ones (the usual spelling for scoped names) are
    // copied into the arena the yaml was parsed with, which has to stay alive until package.json is printed.
    test.concurrent("quoted pnpm-workspace.yaml scalars are written to package.json", async () => {
      using dir = tempDir("pnpm-v9-workspace-yaml-quoted", {
        "package.json": JSON.stringify({ name: "workspace-yaml-quoted" }),
        "pnpm-workspace.yaml": `overrides:
  '@scope/pkg': "1.0.0"
catalog:
  '@scope/other': '^2.0.0'
`,
        "pnpm-lock.yaml": overridesLockfile("  '@scope/pkg': 1.0.0"),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).not.toContain("warn:");
      expect(stderr).toContain(
        "copied pnpm-workspace.yaml to workspaces, copied pnpm-workspace.yaml overrides to overrides in package.json",
      );
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual({
        name: "workspace-yaml-quoted",
        workspaces: { catalog: { "@scope/other": "^2.0.0" } },
        overrides: { "@scope/pkg": "1.0.0" },
      });
    });

    test.concurrent("parent selectors become nested rules", async () => {
      using dir = tempDir("pnpm-v9-overrides-nested", {
        "package.json": JSON.stringify({ name: "overrides-nested" }),
        "pnpm-lock.yaml": overridesLockfile(`  foo>bar: 2.0.0
  foo@^1>baz: 1.0.0
  '@s/a>@t/b': 3.0.0`),
      });
      using tooDeep = tempDir("pnpm-v9-overrides-too-deep", {
        "package.json": JSON.stringify({ name: "overrides-too-deep", pnpm: { overrides: { "a>b>c": "1.0.0" } } }),
        "pnpm-lock.yaml": overridesLockfile("  a>b>c: 1.0.0"),
      });

      const nested = await migrate(String(dir));

      expect(nested.stderr).not.toContain("warn:");
      expect(nested.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(nested.exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`"lockfileVersion": 3`);
      expect(overridesSection(bunLock)).toMatchInlineSnapshot(`
        "  "overrides": {
            "@s/a": {
              "@t/b": "3.0.0",
            },
            "foo": {
              "bar": "2.0.0",
            },
            "foo@^1": {
              "baz": "1.0.0",
            },
          },"
      `);

      const deep = await migrate(String(tooDeep));

      expect(deep.stderr).not.toContain("warn:");
      expect(deep.stderr).toContain("copied pnpm.overrides to overrides in package.json");
      expect(deep.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(deep.exitCode).toBe(0);
      expect(await bunLockOf(String(tooDeep))).not.toContain("a>b");

      const install = await run(String(tooDeep), "install");

      expect(install.stderr).toContain(`warn: Bun currently only supports one level of nested "overrides"`);
      expect(install.stderr).toMatch(/package\.json:\d+:\d+/);
      expect(install.stderr.split("warn:").length - 1).toBe(1);
      expect(install.exitCode).toBe(0);
    });

    test.concurrent("an unparsable value names the override", async () => {
      using dir = tempDir("pnpm-v9-overrides-invalid", {
        "package.json": JSON.stringify({ name: "overrides-invalid" }),
        "pnpm-lock.yaml": overridesLockfile("  foo: ftp://example.com/foo.tgz"),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("pnpm-lock.yaml override 'foo' has an invalid value 'ftp://example.com/foo.tgz'");
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });

    test.concurrent.each([
      ["mapping", "  foo:\n    a: 1"],
      ["number", "  foo: 1"],
    ])("a %s value names the override", async (_, overrides) => {
      using dir = tempDir("pnpm-v9-overrides-non-string", {
        "package.json": JSON.stringify({ name: "overrides-non-string" }),
        "pnpm-lock.yaml": overridesLockfile(overrides),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("pnpm-lock.yaml override 'foo' must be a string");
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });

    // #39785: quoted, block, and escaped scalars from pnpm-workspace.yaml were
    // backed by a parse arena that dropped before package.json was printed.
    // MIMALLOC_PURGE_DELAY=0 makes the freed pages unreadable right away, so
    // the use-after-free is deterministic even in a tiny repo.
    test.concurrent("pnpm-workspace.yaml overrides, catalogs, and patches migrate verbatim", async () => {
      using dir = tempDir("pnpm-v9-workspace-overrides-uaf", {
        "package.json": JSON.stringify({ name: "workspace-overrides-uaf", private: true }),
        "packages/a/package.json": JSON.stringify({ name: "a", private: true }),
        "patches/pkg-g.patch": "",
        "pnpm-workspace.yaml": `packages:
  - 'packages/*'
overrides:
  pkg-a: >-
    7.28.6
  pkg-b: "\\u003e=5.5.9"
  pkg-c: '>=1.19.10'
  pkg-d: |-
    7.15.1
  "pkg\\u002dk": 9.9.9
catalog:
  pkg-e: "\\u003e=1.0.0"
catalogs:
  group-a:
    pkg-f: '2.3.4'
patchedDependencies:
  pkg-g: "patches/pkg\\u002dg.patch"
`,
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .: {}

  packages/a: {}
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "pm", "migrate"],
        cwd: String(dir),
        env: { ...bunEnv, MIMALLOC_PURGE_DELAY: "0" },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual({
        name: "workspace-overrides-uaf",
        private: true,
        workspaces: {
          packages: ["packages/*"],
          catalog: { "pkg-e": ">=1.0.0" },
          catalogs: { "group-a": { "pkg-f": "2.3.4" } },
        },
        overrides: {
          "pkg-a": "7.28.6",
          "pkg-b": ">=5.5.9",
          "pkg-c": ">=1.19.10",
          "pkg-d": "7.15.1",
          "pkg-k": "9.9.9",
        },
        patchedDependencies: { "pkg-g": "patches/pkg-g.patch" },
      });
      expect(exitCode).toBe(0);
    });

    // The copied fields are written before bun.lock, so a read-only package.json fails the migration outright
    // rather than leaving a bun.lock whose overrides the next install cannot see in package.json.
    test.concurrent.skipIf(isWindows)(
      "a read-only package.json fails the migration before bun.lock is written",
      async () => {
        const packageJson = JSON.stringify({ name: "overrides-read-only", pnpm: { overrides: { plain: "1.0.0" } } });
        using dir = tempDir("pnpm-v9-overrides-read-only", {
          "package.json": packageJson,
          "pnpm-lock.yaml": overridesLockfile("  plain: 1.0.0"),
        });
        chmodSync(join(String(dir), "package.json"), 0o444);
        using unprivileged = unprivilegedSpawnOptions(String(dir));

        await using proc = Bun.spawn({
          cmd: [bunExe(), "pm", "migrate"],
          cwd: String(dir),
          env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
          stdout: "pipe",
          stderr: "pipe",
          ...unprivileged,
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toContain("error: failed to write package.json: EACCES");
        expect(stderr).not.toContain("copied");
        expect(stdout).toBe("");
        expect(exitCode).toBe(1);
        expect(await Bun.file(join(String(dir), "package.json")).text()).toBe(packageJson);
        expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
      },
    );
  });

  // The settings moved out of `pnpm` / pnpm-workspace.yaml are edited into package.json in memory while the
  // lockfile loads; the file is only written together with bun.lock.
  describe("package.json edits", () => {
    const packageJson = `{
  "name": "root",
  "private": true,
  "dependencies": {
    "a": "workspace:*",
    "foo": "file:vendor/foo"
  },
  "pnpm": {
    "overrides": {
      "left-pad": "1.3.0"
    }
  }
}
`;
    const migratedPackageJson = {
      name: "root",
      private: true,
      dependencies: { a: "workspace:*", foo: "file:vendor/foo" },
      pnpm: { overrides: { "left-pad": "1.3.0" } },
      overrides: { "left-pad": "1.3.0" },
      workspaces: ["packages/*"],
    };
    const files = {
      "package.json": packageJson,
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
      "vendor/foo/package.json": JSON.stringify({
        name: "foo",
        version: "1.0.0",
        scripts: { postinstall: "echo foo-postinstall" },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

overrides:
  left-pad: 1.3.0

importers:

  .:
    dependencies:
      a:
        specifier: workspace:*
        version: link:packages/a
      foo:
        specifier: file:vendor/foo
        version: file:vendor/foo

  packages/a: {}

packages:

  foo@file:vendor/foo:
    resolution: {directory: vendor/foo, type: directory}
    version: 1.0.0

snapshots:

  foo@file:vendor/foo: {}
`,
    };
    const movedLine = "copied pnpm.overrides to overrides, copied pnpm-workspace.yaml to workspaces in package.json";
    const frozenNote =
      "note: lockfile is frozen, migration from pnpm-lock.yaml not written to bun.lock and package.json; run 'bun install' and commit the result";

    async function expectUntouched(dir: string) {
      expect(await Bun.file(join(dir, "package.json")).text()).toBe(packageJson);
      expect(existsSync(join(dir, "bun.lock"))).toBe(false);
    }

    test.concurrent.each([
      ["install --frozen-lockfile", ["install", "--frozen-lockfile"]],
      ["ci", ["ci"]],
      ["install --production", ["install", "--production"]],
    ])("bun %s installs the migrated lockfile without writing package.json or bun.lock", async (_, args) => {
      using dir = tempDir("pnpm-v9-package-json-frozen", files);

      const { stdout, stderr, exitCode } = await run(String(dir), ...args, "--verbose");

      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(stderr).toContain(frozenNote);
      expect(stderr).not.toContain(movedLine);
      expect(stdout + stderr).not.toContain("Saved");
      await expectUntouched(String(dir));
      expect(await installedPackageJson(String(dir), "", "foo")).toMatchObject({ name: "foo", version: "1.0.0" });
      expect(await installedPackageJson(String(dir), "", "a")).toStrictEqual({ name: "a", version: "1.0.0" });
      expect(exitCode).toBe(0);
    });

    test.concurrent("install --frozen-lockfile fails once the lockfile and package.json disagree", async () => {
      using dir = tempDir("pnpm-v9-package-json-frozen-stale", {
        ...files,
        "pnpm-lock.yaml": files["pnpm-lock.yaml"].replace("left-pad: 1.3.0", "left-pad: 1.2.0"),
      });

      const { stderr, exitCode } = await run(String(dir), "install", "--frozen-lockfile");

      expect(stderr).toContain("error: lockfile had changes, but lockfile is frozen");
      expect(stderr).toContain("note: overrides in package.json changed since pnpm-lock.yaml was saved");
      expect(exitCode).toBe(1);
      expect(await Bun.file(join(String(dir), "package.json")).text()).toBe(packageJson);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });

    test.concurrent.each([
      ["install --dry-run", ["install", "--dry-run"]],
      ["install --no-save", ["install", "--no-save"]],
      ["outdated", ["outdated"]],
      ["pm why a", ["pm", "why", "a"]],
      ["pm untrusted", ["pm", "untrusted"]],
      ["pm migrate --dry-run", ["pm", "migrate", "--dry-run"]],
    ])("bun %s leaves package.json and bun.lock alone", async (_, args) => {
      using dir = tempDir("pnpm-v9-package-json-read-only", files);

      const { stdout, stderr, exitCode } = await run(String(dir), ...args);

      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(stderr).not.toContain("note:");
      expect(stdout + stderr).not.toContain("copied ");
      expect(stdout + stderr).not.toContain("Saved");
      await expectUntouched(String(dir));
      expect(exitCode).toBe(0);
    });

    test.concurrent.each([
      ["install", ["install"]],
      ["install --lockfile-only", ["install", "--lockfile-only"]],
      ["pm migrate", ["pm", "migrate"]],
    ])("bun %s writes the edited package.json together with bun.lock", async (_, args) => {
      using dir = tempDir("pnpm-v9-package-json-written", files);

      const { stderr, exitCode } = await run(String(dir), ...args);

      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(stderr.split(movedLine).length - 1).toBe(1);
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual(migratedPackageJson);
      expect(await bunLockOf(String(dir))).toContain(`"packages/a": {`);
      expect(exitCode).toBe(0);

      const written = await Bun.file(join(String(dir), "package.json")).text();
      const frozen = await run(String(dir), "install", "--frozen-lockfile");

      expect(frozen.stderr).not.toContain("error:");
      expect(frozen.stderr).not.toContain("migrated lockfile");
      expect(frozen.exitCode).toBe(0);
      expect(await Bun.file(join(String(dir), "package.json")).text()).toBe(written);
    });

    test.concurrent("remove keeps the edits the migration made to package.json", async () => {
      using dir = tempDir("pnpm-v9-package-json-remove", files);

      const { stderr, exitCode } = await run(String(dir), "remove", "foo");

      expect(stderr).not.toContain("error:");
      expect(stderr.split(movedLine).length - 1).toBe(1);
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual({
        ...migratedPackageJson,
        dependencies: { a: "workspace:*" },
      });
      expect(await bunLockOf(String(dir))).not.toContain("foo");
      expect(exitCode).toBe(0);

      const frozen = await run(String(dir), "install", "--frozen-lockfile");

      expect(frozen.stderr).not.toContain("error:");
      expect(frozen.exitCode).toBe(0);
    });

    test.concurrent("add writes its own edit and the migration's edits in one package.json", async () => {
      using dir = tempDir("pnpm-v9-package-json-add", {
        ...files,
        "vendor/bar/package.json": JSON.stringify({ name: "bar", version: "1.0.0" }),
      });

      const { stderr, exitCode } = await run(String(dir), "add", "./vendor/bar");

      expect(stderr).not.toContain("error:");
      expect(stderr.split(movedLine).length - 1).toBe(1);
      const written = await Bun.file(join(String(dir), "package.json")).json();
      expect(written).toMatchObject({
        overrides: migratedPackageJson.overrides,
        workspaces: migratedPackageJson.workspaces,
      });
      expect(written.pnpm).toStrictEqual(migratedPackageJson.pnpm);
      expect(Object.keys(written.dependencies).sort()).toStrictEqual(["a", "bar", "foo"]);
      expect(await bunLockOf(String(dir))).toContain(`"bar":`);
      expect(exitCode).toBe(0);

      const frozen = await run(String(dir), "install", "--frozen-lockfile");

      expect(frozen.stderr).not.toContain("error:");
      expect(frozen.exitCode).toBe(0);
    });

    test.concurrent("install --silent writes both files without printing", async () => {
      using dir = tempDir("pnpm-v9-package-json-silent", files);

      const { stdout, stderr, exitCode } = await run(String(dir), "install", "--silent");

      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual(migratedPackageJson);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(true);
      expect(exitCode).toBe(0);
    });

    test.concurrent("pm trust writes the edited package.json along with the lockfile it saves", async () => {
      using dir = tempDir("pnpm-v9-package-json-pm-trust", files);

      const install = await run(String(dir), "install", "--frozen-lockfile");
      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      await expectUntouched(String(dir));

      const { stdout, stderr, exitCode } = await run(String(dir), "pm", "trust", "foo");

      expect(stderr).not.toContain("error:");
      expect(stderr).toContain(movedLine);
      expect(stdout).toContain("1 script ran across 1 package");
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual({
        ...migratedPackageJson,
        trustedDependencies: ["foo"],
      });
      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`"packages/a": {`);
      expect(bunLock).toContain(`"trustedDependencies": [`);
      expect(exitCode).toBe(0);
    });
  });

  // A YAML key can be any node and a value any tree; package.json takes strings.
  describe("pnpm-workspace.yaml fields copied into package.json", () => {
    async function migrateWorkspaceYaml(workspaceYaml: string) {
      using dir = tempDir("pnpm-v9-workspace-yaml-fields", {
        "package.json": JSON.stringify({ name: "workspace-yaml-fields" }),
        "pnpm-workspace.yaml": workspaceYaml,
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n",
      });

      const { stderr, exitCode } = await migrate(String(dir));

      return {
        warnings: stderr.split("\n").filter(line => line.startsWith("warn: ")),
        stderr,
        exitCode,
        packageJson: await Bun.file(join(String(dir), "package.json")).json(),
      };
    }

    const skipped = (field: string, count: number) =>
      `warn: skipping non-string entries of "${field}" in pnpm-workspace.yaml (${count})`;

    const stringFields: [string, (entries: object) => object][] = [
      ["overrides", overrides => ({ overrides })],
      ["catalog", catalog => ({ workspaces: { catalog } })],
      ["patchedDependencies", patchedDependencies => ({ patchedDependencies })],
    ];

    test.concurrent.each(stringFields)(
      "%s: scalars are copied as they are written, everything else is skipped",
      async (field, copied) => {
        const { warnings, stderr, exitCode, packageJson } = await migrateWorkspaceYaml(`${field}:
  number: 5
  decimal: 3.10
  boolean: true
  empty:
  sequence: [a, b]
  mapping: {a: b}
  1: number-key
  ? [a, b]
  : sequence-key
  ok: &ok 1.0.0
  alias: *ok
`);

        expect(warnings).toEqual([skipped(field, 4)]);
        expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect(packageJson).toStrictEqual({
          name: "workspace-yaml-fields",
          ...copied({
            number: "5",
            decimal: "3.10",
            boolean: "true",
            "1": "number-key",
            ok: "1.0.0",
            alias: "1.0.0",
          }),
        });
        expect(exitCode).toBe(0);
      },
    );

    test.concurrent("catalogs: a catalog is a map of scalars under a scalar name", async () => {
      const { warnings, stderr, exitCode, packageJson } = await migrateWorkspaceYaml(`catalogs:
  string: 1.0.0
  sequence: [a, b]
  17:
    react: 17.0.2
  named:
    number: 5
    mapping: {a: b}
    ok: 1.0.0
`);

      expect(warnings).toEqual([skipped("catalogs", 3)]);
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(packageJson).toStrictEqual({
        name: "workspace-yaml-fields",
        workspaces: { catalogs: { "17": { react: "17.0.2" }, named: { number: "5", ok: "1.0.0" } } },
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent("a field with nothing left to copy is not copied", async () => {
      const { warnings, stderr, exitCode, packageJson } = await migrateWorkspaceYaml(`overrides:
  sequence: [a, b]
catalog:
  ok: 1.0.0
`);

      expect(warnings).toEqual([skipped("overrides", 1)]);
      expect(stderr).toContain("copied pnpm-workspace.yaml to workspaces in package.json");
      expect(packageJson).toStrictEqual({
        name: "workspace-yaml-fields",
        workspaces: { catalog: { ok: "1.0.0" } },
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent("aliases and merge keys that resolve to strings are copied", async () => {
      const { warnings, stderr, exitCode, packageJson } = await migrateWorkspaceYaml(`catalog: &base
  pkg-a: &range ^1.0.0
  pkg-b: *range
catalogs:
  same: *base
  merged:
    <<: *base
    pkg-c: "\\u003e=2.0.0"
overrides:
  pkg-d: *range
patchedDependencies:
  pkg-e@1.0.0: &patch patches/pkg-e.patch
  pkg-e@1.0.1: *patch
`);

      expect(warnings).toEqual([]);
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(packageJson).toStrictEqual({
        name: "workspace-yaml-fields",
        workspaces: {
          catalog: { "pkg-a": "^1.0.0", "pkg-b": "^1.0.0" },
          catalogs: {
            same: { "pkg-a": "^1.0.0", "pkg-b": "^1.0.0" },
            merged: { "pkg-a": "^1.0.0", "pkg-b": "^1.0.0", "pkg-c": ">=2.0.0" },
          },
        },
        overrides: { "pkg-d": "^1.0.0" },
        patchedDependencies: { "pkg-e@1.0.0": "patches/pkg-e.patch", "pkg-e@1.0.1": "patches/pkg-e.patch" },
      });
      expect(exitCode).toBe(0);
    });
  });

  // The YAML parser counts an alias as deep as the node it refers to, so these are too deep, like the same tree written
  // out.
  describe("a deep chain of YAML aliases", () => {
    test.concurrent.each([
      ["", undefined],
      // The parser creates no node for `&b`, and what came before it in `&a` still counts.
      [", each link followed by an anchor on an alias", "{&b\n      *scalar : 1}"],
    ])("in pnpm-lock.yaml%s is a parse error", async (_, sibling) => {
      using dir = tempDir("pnpm-v9-alias-chain-lockfile", {
        "package.json": JSON.stringify({ name: "alias-chain" }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\nscalar: &scalar 1\n${yamlAliasChain("unused", sibling)}`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("warn: Failed to parse pnpm-lock.yaml.");
      expect(stderr).toContain("error: failed to migrate lockfile: InvalidLockfile");
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
      expect(exitCode).toBe(1);
    });

    test.concurrent("isn't reported for many aliases that don't nest", async () => {
      const pairs = Array.from({ length: 12_000 }, (_, i) => `  x${i}: &x${i} {z: 1}\n  y${i}: &y${i} {w: *x${i}}\n`);
      using dir = tempDir("pnpm-v9-alias-pairs", {
        "package.json": JSON.stringify({ name: "alias-pairs" }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\nunused:\n${pairs.join("")}`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);
    });

    test.concurrent("in pnpm-workspace.yaml fails the install", async () => {
      const packageJson = JSON.stringify({ name: "alias-chain" });
      using dir = tempDir("pnpm-v9-alias-chain-workspace", {
        "package.json": packageJson,
        "pnpm-workspace.yaml": `${yamlAliasChain("unused")}overrides:\n  deep: *a\n`,
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n",
      });

      const { stderr, exitCode } = await run(String(dir), "install");

      expect(stderr).toContain("error: pnpm-workspace.yaml is nested too deeply");
      expect(await Bun.file(join(String(dir), "package.json")).text()).toBe(packageJson);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
      expect(exitCode).toBe(1);
    });
  });

  // How deep the parser goes depends on the build. The migration has to handle whatever it accepts.
  test.concurrent("pnpm-lock.yaml nested as deep as the YAML parser accepts is migrated", async () => {
    const depths = [250, 500, 750, 1000, 1500, ...Array.from({ length: 17 }, (_, i) => 2000 + 500 * i)];
    // One at a time: a debug build takes 250 MB per process.
    const outcomes: string[] = [];
    for (const depth of depths) {
      using dir = tempDir("pnpm-v9-deep-literal", {
        "package.json": JSON.stringify({ name: "deep-literal" }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\nunused: ${Buffer.alloc(depth * 4, "{a: ")}1${Buffer.alloc(depth, "}")}\n`,
      });
      const { stderr, exitCode } = await migrate(String(dir));
      outcomes.push(
        stderr.includes("migrated lockfile from pnpm-lock.yaml") && exitCode === 0
          ? "migrated"
          : stderr.includes("warn: Failed to parse pnpm-lock.yaml.") && exitCode === 1
            ? "refused"
            : `depth ${depth}: exit ${exitCode}\n${stderr.slice(-600)}`,
      );
    }

    const refusedFrom = outcomes.indexOf("refused");
    expect(outcomes).toEqual(depths.map((_, i) => (refusedFrom === -1 || i < refusedFrom ? "migrated" : "refused")));
  });

  // pnpm wrote the edges its packageExtensions add into the snapshots, so the migrated bun.lock has them.
  // The extensions themselves go where bun reads them when it resolves such a package again.
  test.concurrent("packageExtensions are copied to the root of package.json", async () => {
    const pnpm = { packageExtensions: { "no-deps@1": { dependencies: { "a-dep": "^1.0.1" } } } };
    const { packageDir: dir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "package-extensions", dependencies: { "no-deps": "1.0.0" }, pnpm }),
        "pnpm-workspace.yaml": `packageExtensions:
  a-dep:
    peerDependencies:
      is-number: '*'
  left-pad@1:
    optionalDependencies:
      is-number: 3
    peerDependenciesMeta:
      react:
        optional: true
      vue:
        optional: false
    engines: [1, 2]
  not-a-map: 1
`,
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

packageExtensionsChecksum: sha256-x

importers:

  .:
    dependencies:
      no-deps:
        specifier: 1.0.0
        version: 1.0.0

packages:

  a-dep@1.0.1:
    resolution: {integrity: ${A_DEP_1_0_1_INTEGRITY}}

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

snapshots:

  a-dep@1.0.1: {}

  no-deps@1.0.0:
    dependencies:
      a-dep: 1.0.1
`,
      },
    });

    const { stderr, exitCode } = await migrate(dir);

    expect(stderr).not.toContain("error:");
    expect(stderr).toContain(
      "copied pnpm.packageExtensions to packageExtensions, copied pnpm-workspace.yaml packageExtensions to packageExtensions in package.json",
    );
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(dir, "package.json")).json()).toStrictEqual({
      name: "package-extensions",
      dependencies: { "no-deps": "1.0.0" },
      pnpm,
      packageExtensions: {
        "no-deps@1": { dependencies: { "a-dep": "^1.0.1" } },
        "a-dep": { peerDependencies: { "is-number": "*" } },
        "left-pad@1": {
          optionalDependencies: { "is-number": "3" },
          peerDependenciesMeta: { react: { optional: true } },
        },
      },
    });
    const bunLock = await bunLockOf(dir);
    // The registry's no-deps@1.0.0 doesn't declare a-dep, so the extension added it. It gets the extension's range.
    expect(bunLock).toMatch(
      /"no-deps": \["no-deps@1\.0\.0", "[^"]*", \{ "dependencies": \{ "a-dep": "\^1\.0\.1" \} \}/,
    );
    expect((Bun.JSON5.parse(bunLock) as any).packageExtensions).toEqual({
      "no-deps@1.0.0": { dependencies: ["a-dep"] },
    });
    expect(bunLock).toContain(`"a-dep": ["a-dep@1.0.1"`);
  });

  // pnpm-lock.yaml doesn't separate the dependencies that packageExtensions added from a package's own. The registry
  // does: no-deps@1.0.0 declares nothing, and one-dep@1.0.0 already declares no-deps, so its extension had no effect.
  describe("packageExtensions after the migration", () => {
    const rules = {
      "no-deps@1": { dependencies: { "a-dep": "1.0.1" } },
      "one-dep": { dependencies: { "no-deps": "1.0.1" } },
    };
    async function migrated() {
      const { packageDir: dir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "package-extensions-later",
            dependencies: { "one-dep": "1.0.0" },
            pnpm: { packageExtensions: rules },
          }),
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

packageExtensionsChecksum: sha256-x

importers:

  .:
    dependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0

packages:

  a-dep@1.0.1:
    resolution: {integrity: ${A_DEP_1_0_1_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

snapshots:

  a-dep@1.0.1: {}

  no-deps@1.0.1:
    dependencies:
      a-dep: 1.0.1

  one-dep@1.0.0:
    dependencies:
      no-deps: 1.0.1
`,
        },
      });
      expect(await migrate(dir)).toMatchObject({ stderr: expect.not.stringContaining("error:"), exitCode: 0 });
      return dir;
    }
    async function setRules(dir: string, packageExtensions: object) {
      const { pnpm, ...json } = await Bun.file(join(dir, "package.json")).json();
      await Bun.write(join(dir, "package.json"), JSON.stringify({ ...json, packageExtensions }));
    }
    const locked = async (dir: string) => Object.keys((Bun.JSON5.parse(await bunLockOf(dir)) as any).packages).sort();

    test.concurrent("only undeclared dependencies count as added, and the next install changes nothing", async () => {
      const dir = await migrated();
      const bunLock = await bunLockOf(dir);
      expect((Bun.JSON5.parse(bunLock) as any).packageExtensions).toEqual({
        "no-deps@1.0.1": { dependencies: ["a-dep"] },
      });
      expect(await run(dir, "install", "--frozen-lockfile")).toMatchObject({ exitCode: 0 });
      await expectInstallToLeaveUnchanged(dir, bunLock);
    });

    test.concurrent("an edited extension takes effect", async () => {
      const dir = await migrated();
      await setRules(dir, { ...rules, "no-deps@1": { dependencies: { "a-dep": "1.0.2" } } });
      expect(await run(dir, "install", "--frozen-lockfile")).toMatchObject({
        stderr: expect.stringContaining("note: packageExtensions in package.json changed since bun.lock was saved"),
        exitCode: 1,
      });
      expect(await run(dir, "install")).toMatchObject({ exitCode: 0 });
      expect(await bunLockOf(dir)).toContain(`"a-dep": ["a-dep@1.0.2"`);
    });

    test.concurrent(
      "removing extensions removes what they added, and nothing that a package declares itself",
      async () => {
        const dir = await migrated();
        await setRules(dir, {});
        expect(await run(dir, "install", "--frozen-lockfile")).toMatchObject({
          stderr: expect.stringContaining("note: packageExtensions in package.json changed since bun.lock was saved"),
          exitCode: 1,
        });
        expect(await run(dir, "install")).toMatchObject({ exitCode: 0 });
        expect(await locked(dir)).toEqual(["no-deps", "one-dep"]);
      },
    );
  });

  test.concurrent("link: version with a semver specifier resolves to the workspace (pnpm/pnpm#7712)", async () => {
    // save-workspace-protocol=false / link-workspace-packages shape
    using dir = fixture("v9-link-semver-specifier");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(`"common": ["common@workspace:shared/common"]`);
    expect(bunLock).not.toContain("link:");

    const install = await run(String(dir), "install", "--frozen-lockfile", "--linker", "hoisted");

    expect(install.stderr).not.toContain("error:");
    expect(await installedPackageJson(String(dir), "apps/web", "common")).toStrictEqual({
      name: "common",
      version: "1.2.0",
    });
    expect(install.exitCode).toBe(0);
  });

  test.concurrent("prettier-style multi-line resolution mappings migrate identically", async () => {
    using plain = fixture("v9-git-references");
    using formatted = fixture("v9-git-references");

    const lockfilePath = join(String(formatted), "pnpm-lock.yaml");
    const original = await Bun.file(lockfilePath).text();
    const oneLine = "    resolution: {tarball: https://token@tarballs.example.com/priv-1.0.0.tgz}\n";
    expect(original).toContain(oneLine);
    await Bun.write(
      lockfilePath,
      original.replace(
        oneLine,
        `    resolution:
      {
        tarball: https://token@tarballs.example.com/priv-1.0.0.tgz,
      }
`,
      ),
    );

    const [plainResult, formattedResult] = await Promise.all([migrate(String(plain)), migrate(String(formatted))]);

    expect(formattedResult.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(formattedResult.exitCode).toBe(0);
    expect(plainResult.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(plainResult.exitCode).toBe(0);
    expect(await bunLockOf(String(formatted))).toBe(await bunLockOf(String(plain)));
  });

  // The migration edits the cached root package.json AST in place and then
  // replaces its source text. `bun add` prints that same cache entry again
  // after the install, so the entry has to be re-parsed after the migration
  // or the second print reads freed memory.
  test("bun add migrates pnpm-workspace.yaml and keeps the migrated fields", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "add-after-migration", private: true }),
        "packages/a/package.json": JSON.stringify({ name: "a", private: true }),
        "pnpm-workspace.yaml": `packages:
  - 'packages/*'
overrides:
  pkg-x: 1.2.3
catalog:
  pkg-y: 2.0.0
`,
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .: {}

  packages/a: {}
`,
      },
    });

    const { stderr, exitCode } = await run(packageDir, "add", "no-deps@1.0.0");

    expect(stderr).toContain("copied pnpm-workspace.yaml to workspaces");
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(stderr).not.toContain("error:");
    expect(await Bun.file(join(packageDir, "package.json")).json()).toStrictEqual({
      name: "add-after-migration",
      private: true,
      dependencies: { "no-deps": "1.0.0" },
      workspaces: {
        packages: ["packages/*"],
        catalog: { "pkg-y": "2.0.0" },
      },
      overrides: { "pkg-x": "1.2.3" },
    });
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(packageDir);
    expect(bunLock).toContain(`"no-deps": "1.0.0"`);
    expect(bunLock).toContain(`"packages/a"`);
  });

  // #23694: `bun update -i` migrates once to list the outdated packages, edits
  // package.json through the cache entry, and migrates again when it installs.
  test("bun update -i as the first bun command in a pnpm workspace", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "update-i-after-migration", dependencies: { "no-deps": "^1.0.0" } }),
        "packages/a/package.json": JSON.stringify({ name: "a", private: true }),
        "pnpm-workspace.yaml": `packages:
  - 'packages/*'
`,
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.0

  packages/a: {}

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

snapshots:

  no-deps@1.0.0: {}
`,
      },
    });

    // `a` selects every offered row and `\r` confirms.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "-i"],
      cwd: packageDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write("a\r");
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("no-deps");
    expect(await Bun.file(join(packageDir, "package.json")).json()).toStrictEqual({
      name: "update-i-after-migration",
      dependencies: { "no-deps": "^1.1.0" },
      workspaces: ["packages/*"],
    });
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(packageDir);
    expect(bunLock).toContain(`"no-deps@1.1.0"`);
    expect(bunLock).toContain(`"packages/a"`);
  });

  // The install after a migration diffs each importer's rows against a fresh package.json parse. A row
  // in a different shape re-resolves the whole importer, and a range with two versions in the lockfile
  // then moves: below, the members lock `no-deps` at 1.0.0 while `one-dep` brings in 1.0.1.
  describe("importer rows match a package.json parse", () => {
    const catalogFiles = {
      "pnpm-workspace.yaml": `packages:
  - packages/*

catalog:
  a-dep: ^1.0.1

catalogs:
  tooling:
    one-dep: ^1.0.0
`,
      "package.json": JSON.stringify({
        name: "catalog-rows",
        private: true,
        devDependencies: { "one-dep": "catalog:tooling" },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "a-dep": "catalog:", "no-deps": "^1.0.0" },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

catalogs:
  default:
    a-dep:
      specifier: ^1.0.1
      version: 1.0.1
  tooling:
    one-dep:
      specifier: ^1.0.0
      version: 1.0.0

importers:

  .:
    devDependencies:
      one-dep:
        specifier: catalog:tooling
        version: 1.0.0

  packages/app:
    dependencies:
      a-dep:
        specifier: 'catalog:'
        version: 1.0.1
      no-deps:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  a-dep@1.0.1:
    resolution: {integrity: ${A_DEP_1_0_1_INTEGRITY}}

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

snapshots:

  a-dep@1.0.1: {}

  no-deps@1.0.0: {}

  no-deps@1.0.1: {}

  one-dep@1.0.0:
    dependencies:
      no-deps: 1.0.1
`,
    };

    const workspaceRowFiles = {
      "pnpm-workspace.yaml": `packages:
  - packages/*
`,
      "package.json": JSON.stringify({
        name: "workspace-rows",
        private: true,
        devDependencies: { "one-dep": "^1.0.0" },
      }),
      "packages/lib/package.json": JSON.stringify({ name: "lib", version: "1.2.3" }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { lib: "workspace:*", "no-deps": "^1.0.0" },
      }),
      // link-workspace-packages shape: a plain range pnpm linked to the member; the version is not semver
      "packages/cli/package.json": JSON.stringify({
        name: "cli",
        version: "unversioned",
        dependencies: { lib: "^1.0.0", "no-deps": "^1.0.0" },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      one-dep:
        specifier: ^1.0.0
        version: 1.0.0

  packages/app:
    dependencies:
      lib:
        specifier: workspace:*
        version: link:../lib
      no-deps:
        specifier: ^1.0.0
        version: 1.0.0

  packages/cli:
    dependencies:
      lib:
        specifier: ^1.0.0
        version: link:../lib
      no-deps:
        specifier: ^1.0.0
        version: 1.0.0

  packages/lib: {}

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

  one-dep@1.0.0:
    resolution: {integrity: ${ONE_DEP_1_0_0_INTEGRITY}}

snapshots:

  no-deps@1.0.0: {}

  no-deps@1.0.1: {}

  one-dep@1.0.0:
    dependencies:
      no-deps: 1.0.1
`,
    };

    const noDeps100 = { name: "no-deps", version: "1.0.0" };

    // `bun install` on a pnpm checkout migrates in-process and installs from the migrated rows directly.
    async function installStraightFromPnpmLock(files: Record<string, string>) {
      const { packageDir: viaMigrate } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });
      const { packageDir: viaInstall } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });

      const [migrated, install] = await Promise.all([migrate(viaMigrate), run(viaInstall, "install")]);

      expect(migrated.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(migrated.exitCode).toBe(0);
      expect(install.stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await bunLockOf(viaInstall)).toBe(await bunLockOf(viaMigrate));

      return viaInstall;
    }

    test("catalog: rows keep the reference and a frozen install accepts bun pm migrate's lockfile", async () => {
      const { packageDir } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" }, files: catalogFiles });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(packageDir);
      expect(workspacesSection(migrated)).toMatchInlineSnapshot(`
        "  "workspaces": {
            "": {
              "name": "catalog-rows",
              "devDependencies": {
                "one-dep": "catalog:tooling",
              },
            },
            "packages/app": {
              "name": "app",
              "version": "1.0.0",
              "dependencies": {
                "a-dep": "catalog:",
                "no-deps": "^1.0.0",
              },
            },
          },
          "catalog": {
            "a-dep": "^1.0.1",
          },
          "catalogs": {
            "tooling": {
              "one-dep": "^1.0.0",
            },
          },
        "
      `);

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await bunLockOf(packageDir)).toBe(migrated);
      expect(await installedPackageJson(packageDir, "packages/app", "no-deps")).toStrictEqual(noDeps100);
    });

    test("bun install straight from pnpm-lock.yaml keeps the versions locked for a catalog: user", async () => {
      const dir = await installStraightFromPnpmLock(catalogFiles);

      expect(await installedPackageJson(dir, "packages/app", "no-deps")).toStrictEqual(noDeps100);
      expect(await installedPackageJson(dir, "packages/app", "a-dep")).toStrictEqual({
        name: "a-dep",
        version: "1.0.1",
      });
    });

    test("workspace: and linked rows keep their specifiers; members get their package.json version", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: workspaceRowFiles,
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(workspacesSection(bunLock)).toMatchInlineSnapshot(`
        "  "workspaces": {
            "": {
              "name": "workspace-rows",
              "devDependencies": {
                "one-dep": "^1.0.0",
              },
            },
            "packages/app": {
              "name": "app",
              "version": "1.0.0",
              "dependencies": {
                "lib": "workspace:*",
                "no-deps": "^1.0.0",
              },
            },
            "packages/cli": {
              "name": "cli",
              "dependencies": {
                "lib": "^1.0.0",
                "no-deps": "^1.0.0",
              },
            },
            "packages/lib": {
              "name": "lib",
              "version": "1.2.3",
            },
          },
        "
      `);
      expect(bunLock).toContain(`"lib": ["lib@workspace:packages/lib"]`);
      expect(bunLock).toContain(`"no-deps@1.0.0"`);
      expect(bunLock).toContain(`"no-deps@1.0.1"`);
      expect(bunLock).not.toContain("link:");
    });

    test("bun install straight from pnpm-lock.yaml keeps the versions locked for workspace: and linked users", async () => {
      const dir = await installStraightFromPnpmLock(workspaceRowFiles);

      for (const member of ["packages/app", "packages/cli"]) {
        expect(await installedPackageJson(dir, member, "no-deps")).toStrictEqual(noDeps100);
        expect(await installedPackageJson(dir, member, "lib")).toStrictEqual({ name: "lib", version: "1.2.3" });
      }
    });
  });

  describe("catalogs", () => {
    // pnpm/pnpm#10551: pruned Docker contexts ship the lockfile without pnpm-workspace.yaml
    test("lockfile catalogs: section is enough without pnpm-workspace.yaml", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/v9-catalog-default"),
      });
      rmSync(join(packageDir, "pnpm-workspace.yaml"));

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(packageDir);
      expect(bunLock).toContain(`"catalog": {\n    "no-deps": "^1.0.0",\n  }`);
      expect(bunLock).toContain(`"no-deps@1.0.1"`);
    });

    // pnpm-lock.yaml only records the catalog entries some importer uses; the migration copies the whole
    // pnpm-workspace.yaml catalog into package.json, so bun.lock has to get the whole catalog too or the
    // next `bun install` sees a catalog change and rewrites it.
    test("entries no importer uses are migrated into bun.lock", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "unused-catalog", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `catalog:
  unused-default: ^9.0.0

catalogs:
  tools:
    unused-tool: ^8.0.0
`,
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: 1.0.1

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(packageDir);
      expect(catalogSections(migrated)).toBe(
        [
          `  "catalog": {`,
          `    "unused-default": "^9.0.0",`,
          `  },`,
          `  "catalogs": {`,
          `    "tools": {`,
          `      "unused-tool": "^8.0.0",`,
          `    },`,
          `  },`,
          ``,
        ].join("\n"),
      );
      expect((await Bun.file(join(packageDir, "package.json")).json()).workspaces).toEqual({
        catalog: { "unused-default": "^9.0.0" },
        catalogs: { tools: { "unused-tool": "^8.0.0" } },
      });

      await expectInstallToLeaveUnchanged(packageDir, migrated);
    });

    // Peers keep their catalog: reference through the migration, so the install afterwards is a no-op
    // exactly when the catalog sections match what package.json declares.
    test("declared entries are merged into the groups the lockfile recorded", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({
            name: "merged-catalog",
            peerDependencies: { "a-dep": "catalog:tools", "no-deps": "catalog:" },
          }),
          "pnpm-workspace.yaml": `catalog:
  no-deps: ^1.0.0
  unused-default: ^9.0.0

catalogs:
  tools:
    a-dep: ^1.0.0
    unused-tool: ^8.0.0
`,
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

catalogs:
  default:
    no-deps:
      specifier: ^1.0.0
      version: 1.0.1
  tools:
    a-dep:
      specifier: ^1.0.0
      version: 1.0.1

importers:

  .:
    dependencies:
      a-dep:
        specifier: catalog:tools
        version: 1.0.1
      no-deps:
        specifier: 'catalog:'
        version: 1.0.1

packages:

  a-dep@1.0.1:
    resolution: {integrity: ${A_DEP_1_0_1_INTEGRITY}}

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  a-dep@1.0.1: {}

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("missing entry");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(packageDir);
      expect(catalogSections(migrated)).toBe(
        [
          `  "catalog": {`,
          `    "no-deps": "^1.0.0",`,
          `    "unused-default": "^9.0.0",`,
          `  },`,
          `  "catalogs": {`,
          `    "tools": {`,
          `      "a-dep": "^1.0.0",`,
          `      "unused-tool": "^8.0.0",`,
          `    },`,
          `  },`,
          ``,
        ].join("\n"),
      );
      expect(workspaceBlock(migrated, "")).toContain(
        `      "peerDependencies": {\n        "a-dep": "catalog:tools",\n        "no-deps": "catalog:",\n      },`,
      );

      await expectInstallToLeaveUnchanged(packageDir, migrated);
      expect(await installedPackageJson(packageDir, "", "a-dep")).toStrictEqual({ name: "a-dep", version: "1.0.1" });
    });

    // pnpm-lock.yaml records the default catalog as `catalogs.default` whether pnpm-workspace.yaml spelled it
    // `catalog:` or `catalogs.default:`; bun.lock and package.json keep the two spellings apart.
    test("a default catalog declared as catalogs.default stays catalogs.default", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "catalogs-default", peerDependencies: { "no-deps": "catalog:" } }),
          "pnpm-workspace.yaml": `catalogs:
  default:
    no-deps: ^1.0.0
    unused-default: ^9.0.0
`,
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

catalogs:
  default:
    no-deps:
      specifier: ^1.0.0
      version: 1.0.1

importers:

  .:
    dependencies:
      no-deps:
        specifier: 'catalog:'
        version: 1.0.1

packages:

  no-deps@1.0.1:
    resolution: {integrity: ${NO_DEPS_1_0_1_INTEGRITY}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).not.toContain("missing entry");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(packageDir);
      expect(catalogSections(migrated)).toBe(
        [
          `  "catalogs": {`,
          `    "default": {`,
          `      "no-deps": "^1.0.0",`,
          `      "unused-default": "^9.0.0",`,
          `    },`,
          `  },`,
          ``,
        ].join("\n"),
      );
      expect((await Bun.file(join(packageDir, "package.json")).json()).workspaces).toEqual({
        catalogs: { default: { "no-deps": "^1.0.0", "unused-default": "^9.0.0" } },
      });

      await expectInstallToLeaveUnchanged(packageDir, migrated);
    });

    // The lockfile's specifier is the one its resolutions were made with: taking the yaml's would hide the
    // edit from the next install and leave no-deps@1.0.0 locked under a range it does not satisfy.
    test("an entry edited in pnpm-workspace.yaml after the last pnpm install keeps the lockfile's specifier", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "edited-catalog", dependencies: { "no-deps": "catalog:" } }),
          "pnpm-workspace.yaml": `catalog:
  no-deps: ^1.0.1
`,
          "pnpm-lock.yaml": `lockfileVersion: '9.0'

catalogs:
  default:
    no-deps:
      specifier: ^1.0.0
      version: 1.0.0

importers:

  .:
    dependencies:
      no-deps:
        specifier: 'catalog:'
        version: 1.0.0

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${NO_DEPS_1_0_0_INTEGRITY}}

snapshots:

  no-deps@1.0.0: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const migrated = await bunLockOf(packageDir);
      expect(catalogSections(migrated)).toBe(`  "catalog": {\n    "no-deps": "^1.0.0",\n  },\n`);
      expect(migrated).toContain(`"no-deps@1.0.0"`);

      const install = await run(packageDir, "install");

      expect(install.stderr).toContain("Saved lockfile");
      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      const updated = await bunLockOf(packageDir);
      expect(catalogSections(updated)).toBe(`  "catalog": {\n    "no-deps": "^1.0.1",\n  },\n`);
      expect(updated).toContain(`"no-deps@1.1.0"`);
      expect(updated).not.toContain(`"no-deps@1.0.0"`);
    });

    // pnpm/pnpm#10456: `pnpm remove` can drop the catalogs: section while importers still say catalog:
    test.concurrent("importer catalog: reference without a catalogs: section is reported", async () => {
      using dir = fixture("v9-catalog-default");

      const lockfilePath = join(String(dir), "pnpm-lock.yaml");
      const original = await Bun.file(lockfilePath).text();
      const catalogsBlock = original.slice(original.indexOf("catalogs:"), original.indexOf("importers:"));
      expect(catalogsBlock).toContain("no-deps");
      await Bun.write(lockfilePath, original.replace(catalogsBlock, ""));

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("pnpm-lock.yaml catalog 'default' missing entry for dependency 'no-deps'");
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });

    // The dependency stays `catalog:`, like when package.json is parsed, and is bound to the workspace that pnpm
    // linked.
    test.concurrent.each(
      ["workspace:*", "^1.0.0"].flatMap(range => ["hoisted", "isolated"].map(linker => [range, linker] as const)),
    )("a catalog: dependency (%s) that pnpm linked to a workspace member, %s linker", async (range, linker) => {
      using dir = tempDir("pnpm-v9-catalog-workspace-link", {
        "package.json": JSON.stringify({ name: "root", private: true }),
        "packages/a/package.json": JSON.stringify({ name: "@w/a", version: "1.2.3" }),
        "packages/b/package.json": JSON.stringify({
          name: "@w/b",
          version: "0.0.1",
          dependencies: { "@w/a": "catalog:" },
        }),
        "pnpm-workspace.yaml": `packages:\n  - 'packages/*'\ncatalog:\n  '@w/a': '${range}'\n`,
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

catalogs:
  default:
    '@w/a':
      specifier: ${range}
      version: 1.2.3

importers:

  .: {}

  packages/a: {}

  packages/b:
    dependencies:
      '@w/a':
        specifier: 'catalog:'
        version: link:../a
`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);
      const bunLock = await bunLockOf(String(dir));
      expect(Bun.JSONC.parse(bunLock)).toMatchObject({
        workspaces: { "packages/b": { dependencies: { "@w/a": "catalog:" } } },
        catalog: { "@w/a": range },
        packages: { "@w/a": ["@w/a@workspace:packages/a"], "@w/b": ["@w/b@workspace:packages/b"] },
      });

      const frozen = await run(String(dir), "install", "--frozen-lockfile", "--linker", linker);
      expect(frozen.stderr).not.toContain("error:");
      expect(await installedPackageJson(String(dir), "packages/b", "@w/a")).toStrictEqual({
        name: "@w/a",
        version: "1.2.3",
      });
      expect(frozen.exitCode).toBe(0);
      await expectInstallToLeaveUnchanged(String(dir), bunLock);
    });
  });

  // pnpm's `onlyBuiltDependencies` is the allow-list of packages whose lifecycle
  // scripts may run, which is `trustedDependencies` in bun.
  describe("onlyBuiltDependencies", () => {
    const LIFECYCLE_POSTINSTALL_1_0_0_INTEGRITY =
      "sha512-+frsFSxvy+pkm5fjAsAHptt2NiMMMnU07dan43rZO1yCqxy8vU0X8wNTOYlgkViD7HCHT/bIpPhoki935Nc2pg==";

    // `lifecycle-postinstall`'s postinstall writes postinstall.txt next to itself.
    const lifecyclePostinstallLockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      lifecycle-postinstall:
        specifier: 1.0.0
        version: 1.0.0

packages:

  lifecycle-postinstall@1.0.0:
    resolution: {integrity: ${LIFECYCLE_POSTINSTALL_1_0_0_INTEGRITY}}

snapshots:

  lifecycle-postinstall@1.0.0: {}
`;

    function postinstallRan(dir: string) {
      return existsSync(join(dir, "node_modules", "lifecycle-postinstall", "postinstall.txt"));
    }

    for (const linker of ["hoisted", "isolated"] as const) {
      test.concurrent(`pnpm-workspace.yaml list becomes trustedDependencies (${linker})`, async () => {
        const { packageDir } = await verdaccio.createTestDir({
          bunfigOpts: { linker },
          files: {
            "package.json": JSON.stringify({
              name: "only-built-workspace-yaml",
              dependencies: { "lifecycle-postinstall": "1.0.0" },
            }),
            "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - lifecycle-postinstall\n",
            "pnpm-lock.yaml": lifecyclePostinstallLockfile,
          },
        });

        const { stderr, exitCode } = await migrate(packageDir);

        expect(stderr).toContain("pnpm-workspace.yaml onlyBuiltDependencies to trustedDependencies in package.json");
        expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect(exitCode).toBe(0);

        expect(await Bun.file(join(packageDir, "package.json")).json()).toStrictEqual({
          name: "only-built-workspace-yaml",
          dependencies: { "lifecycle-postinstall": "1.0.0" },
          trustedDependencies: ["lifecycle-postinstall"],
        });
        expect(await bunLockOf(packageDir)).toContain(`"trustedDependencies": [\n    "lifecycle-postinstall",\n  ]`);

        const install = await run(packageDir, "install");

        expect(install.stderr).not.toContain("error:");
        expect(install.stdout).not.toContain("Blocked");
        expect(postinstallRan(packageDir)).toBe(true);
        expect(install.exitCode).toBe(0);
      });

      // Without an allow-list, the scripts stay blocked, and the install has to report that.
      test.concurrent(`blocked scripts are reported after migrating (${linker})`, async () => {
        const { packageDir } = await verdaccio.createTestDir({
          bunfigOpts: { linker },
          files: {
            "package.json": JSON.stringify({
              name: "only-built-missing",
              dependencies: { "lifecycle-postinstall": "1.0.0" },
            }),
            "pnpm-lock.yaml": lifecyclePostinstallLockfile,
          },
        });

        const { stdout, stderr, exitCode } = await run(packageDir, "install");

        expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
        expect(stderr).not.toContain("trustedDependencies");
        expect(stdout).toContain("Blocked 1 postinstall. Run `bun pm untrusted` for details.");
        expect(postinstallRan(packageDir)).toBe(false);
        expect(exitCode).toBe(0);
      });
    }

    test.concurrent("bun install migrates the list and runs the scripts in the same run", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({
            name: "only-built-install",
            dependencies: { "lifecycle-postinstall": "1.0.0" },
          }),
          "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - lifecycle-postinstall\n",
          "pnpm-lock.yaml": lifecyclePostinstallLockfile,
        },
      });

      const { stdout, stderr, exitCode } = await run(packageDir, "install");

      expect(stderr).toContain("pnpm-workspace.yaml onlyBuiltDependencies to trustedDependencies in package.json");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(stdout).not.toContain("Blocked");
      expect(postinstallRan(packageDir)).toBe(true);
      expect(exitCode).toBe(0);
      expect((await Bun.file(join(packageDir, "package.json")).json()).trustedDependencies).toEqual([
        "lifecycle-postinstall",
      ]);
    });

    // pnpm 9 kept the list in package.json. Both sources merge into an existing list, and
    // the pnpm block keeps its copy for anyone still running pnpm on the project.
    test.concurrent("package.json pnpm.onlyBuiltDependencies merges into an existing trustedDependencies", async () => {
      const pnpm = { onlyBuiltDependencies: ["esbuild", "from-package-json"] };
      using dir = tempDir("pnpm-v9-only-built-pnpm-field", {
        "package.json": JSON.stringify({
          name: "only-built-pnpm-field",
          trustedDependencies: ["already-trusted", "esbuild"],
          pnpm,
        }),
        "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - from-workspace-yaml\n  - esbuild\n",
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .: {}
`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain(
        "copied pnpm.onlyBuiltDependencies to trustedDependencies, copied pnpm-workspace.yaml onlyBuiltDependencies to trustedDependencies in package.json",
      );
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual({
        name: "only-built-pnpm-field",
        trustedDependencies: ["already-trusted", "esbuild", "from-package-json", "from-workspace-yaml"],
        pnpm,
      });
    });

    test.concurrent("a list that adds nothing doesn't change package.json", async () => {
      const packageJson = {
        name: "only-built-nothing-new",
        trustedDependencies: ["esbuild"],
        pnpm: { onlyBuiltDependencies: [] },
      };
      using dir = tempDir("pnpm-v9-only-built-nothing-new", {
        "package.json": JSON.stringify(packageJson),
        "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - esbuild\n",
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .: {}
`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).not.toContain("onlyBuiltDependencies");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(String(dir), "package.json")).json()).toStrictEqual(packageJson);
    });

    test.concurrent.each([
      { from: "pnpm-workspace.yaml", yaml: "onlyBuiltDependencies: []\n", pnpm: undefined },
      { from: "pnpm.", yaml: "", pnpm: { onlyBuiltDependencies: [] } },
    ])("an empty list from $from becomes an empty trustedDependencies", async ({ from, yaml, pnpm }) => {
      using dir = tempDir("pnpm-v9-only-built-empty", {
        "package.json": JSON.stringify({ name: "only-built-empty", pnpm }),
        "pnpm-workspace.yaml": `packages: []\n${yaml}`,
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .: {}
`,
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain(
        `${from.replace(/yaml$/, "yaml ")}onlyBuiltDependencies to trustedDependencies in package.json`,
      );
      expect((await Bun.file(join(String(dir), "package.json")).json()).trustedDependencies).toEqual([]);
      expect(exitCode).toBe(0);
    });
  });
});
