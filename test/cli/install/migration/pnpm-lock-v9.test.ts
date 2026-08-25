import type { BunLockFile, BunLockFilePackageInfo } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, realpathSync, rmSync } from "fs";
import { bunEnv, bunExe, nodeModulesPackages, normalizeBunSnapshot, tempDir, VerdaccioRegistry } from "harness";
import { dirname, join } from "path";

const verdaccio = new VerdaccioRegistry();
const registry = verdaccio.registryUrl();

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
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return { stdout, stderr, exitCode };
}

function migrate(cwd: string) {
  return run(cwd, "pm", "migrate");
}

function fixture(name: string) {
  return tempDir(`pnpm-${name}`, join(import.meta.dir, "pnpm", name));
}

/** bun.lock as Bun.JSONC.parse returns it. bun-types' BunLockFile predates lockfileVersion 3 and its nested overrides. */
type Lockfile = Omit<BunLockFile, "lockfileVersion" | "overrides"> & {
  lockfileVersion: number;
  overrides?: Record<string, string | Record<string, string>>;
};

function parseLock(text: string) {
  return Bun.JSONC.parse(text) as Lockfile;
}

async function bunLockText(dir: string) {
  return await Bun.file(join(dir, "bun.lock")).text();
}

async function bunLock(dir: string) {
  return parseLock(await bunLockText(dir));
}

async function packageJsonOf(dir: string) {
  return await Bun.file(join(dir, "package.json")).json();
}

/**
 * stderr as a list of lines, without the `[12.34ms] ` prefix of the migration
 * summary and without the download progress lines of `bun install`.
 */
function stderrLines(stderr: string) {
  return stderr
    .replace(/^\[[\d.]+m?s\] /gm, "")
    .split("\n")
    .filter(
      line =>
        line !== "" && line !== "Resolving dependencies" && !line.startsWith("Resolved, downloaded and extracted ["),
    );
}

/** `bun install` stdout with the version header and timings removed, for inline snapshots. */
function installOutput(stdout: string) {
  return normalizeBunSnapshot(stdout).replace(/^bun (install|add) <version> \(<revision>\)\n\n/, "");
}

async function installedPackageJson(root: string, workspace: string, name: string) {
  const nested = Bun.file(join(root, workspace, "node_modules", name, "package.json"));
  return await ((await nested.exists()) ? nested : Bun.file(join(root, "node_modules", name, "package.json"))).json();
}

const MIGRATED = "migrated lockfile from pnpm-lock.yaml";
const FAILED = "error: failed to migrate lockfile: InvalidLockfile";

const PKG_A_GIT = "pkg-a@git+ssh://git@example.com/org/pkg-a.git#0123456789abcdef0123456789abcdef01234567";
const PKG_B_GIT = "pkg-b@git+ssh://git@example.com/org/pkg-b.git#89abcdef0123456789abcdef0123456789abcdef";

/** integrity of the packages served by the verdaccio fixture registry, by `name@version` */
const INTEGRITY = {
  "no-deps@1.0.0": "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
  "no-deps@1.0.1": "sha512-3X6cn4+UJdXJuLPu11v8i/fGLe2PdI6v1yKTELam04lY5esCAFdG/qQts6N6rLrL6g1YRq+MKBAwxbmUQk355A==",
  "no-deps@1.1.0": "sha512-ebG2pipYAKINcNI3YxdsiAgFvNGp2gdRwxAKN2LYBm9+YxuH/lHH2sl+GKQTuGiNfCfNZRMHUyyLPEJD6HWm7w==",
  "no-deps@2.0.0": "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g==",
  "one-dep@1.0.0": "sha512-qG6lZjwM1vFmRCHwP+XpOKu6FkrBmwr20+54+qaHGdjZlw/wz8aJrhFqX4dZksqmBLZtj2mzL77Yf04WKs1+Kg==",
  "a-dep@1.0.1": "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg==",
  "a-dep-b@1.0.0": "sha512-PW1l4ruYaxcIw4rMkOVzb9zcR2srZhTPv2H2aH7QFc7vVxkD7EEMGHg1GPT8ycLFb8vriydUXEPwOy1FcbodaQ==",
  "b-dep-a@1.0.0": "sha512-1owp4Wy5QE893BGgjDQGZm9Oayk38MA++fXmPTQA1WY/NFQv7CcCVpK2Ht/4mU4KejDeHOxaAj7qbzv1dSQA2w==",
  "peer-deps@1.0.0": "sha512-CHQ5sQXwUo38G++dkzJ/rJ9Ge98MeMTQjjC9UK2t0frp8Lrhm3zNooOLakFyHW4UcyD3vuTS3Qv324Bj6B5Tjw==",
  "peer-deps-fixed@1.0.0":
    "sha512-gVs9cSdy6TAQIEWu1tVEK1mAspCQxYziTGQlv4a2XQpzOBZvoQ/y6lOeu3tqNNrNQnLwdvwAQTlvazV5+HfV7g==",
  "peer-deps-too@1.0.0":
    "sha512-sBx0TKrsB8FkRN2lzkDjMuctPGEKn1TmNUBv3dJOtnZM8nd255o5ZAPRpAI2XFLHZAavBlK/e73cZNwnUxlRog==",
  "one-optional-peer-dep@1.0.2":
    "sha512-S25U8/QXGIKfn/AWtsce1aVMnDjDL+ykFtAufpsuKGad32NlsCpi9TDuXvzoTQ+MdaZpGV3c4xghUZUsNeMp4A==",
  "provides-peer-deps-1-0-0@1.0.0":
    "sha512-DSOgqUXTkw06FqE/14D5KvaGbl3e3Rri71F9UeSRGV1CtQE84mO69ZXE1QhSed5zM0EQy1n/zkwDdtwsmOaFsA==",
  "@types/is-number@1.0.0":
    "sha512-v7Teha9FjTcou+/dtF3KLYGcrEl3j5gbY7kIEF1LrwP4fjiiWUOh5qJbPc4tK2nB5pJ0O9cexMAZZ1ushh3GGQ==",
  "@types/no-deps@1.0.0":
    "sha512-quthzD2O04AlTaZLJGf4a6/6aD7lf4Qa4HS7ViRWnTFdSbRbof20GFoq9YRCD3YQxd/HKI83YBAAiZ4ewoy+0Q==",
  "@types/no-deps@2.0.0":
    "sha512-Zue3tPSS7wGh0k4QA1JyRHZSW9RJWTJxWllThag+zGm+3Ny3UNiOG6xt0OcX8yKaaRymhf9G1qGGOFLQdyEOpA==",
};
const LOCAL_TARBALL_INTEGRITY =
  "sha512-HP/5Rgt3pVFLzjmN9qJJ6vZMgCwoCIl/m2bPndYT283CUqnmFiMx0GeeIJ7SyK6TYoJM78SEvFEOQie++caHqw==";

/** the tarball url bun.lock records for a package served by the configured registry */
function tarballUrl(nameAtVersion: string, registryUrl = registry) {
  const at = nameAtVersion.lastIndexOf("@");
  const name = nameAtVersion.slice(0, at);
  const version = nameAtVersion.slice(at + 1);
  return `${registryUrl}${name}/-/${name.slice(name.indexOf("/") + 1)}-${version}.tgz`;
}

/** the bun.lock packages row of a registry package served by verdaccio */
function npm(
  nameAtVersion: keyof typeof INTEGRITY,
  info: BunLockFilePackageInfo = {},
): [string, string, BunLockFilePackageInfo, string] {
  return [nameAtVersion, tarballUrl(nameAtVersion), info, INTEGRITY[nameAtVersion]];
}

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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}, tarball: ${tarball}}

snapshots:

  no-deps@1.0.1: {}
`;
}

function registryQualifiedNoDepsLockfile(registryName: string) {
  return `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: ${registryName}:1.0.1

packages:

  no-deps@${registryName}:1.0.1:
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

snapshots:

  no-deps@${registryName}:1.0.1: {}
`;
}

// Every case works in its own directory and only reads from the shared registry, so the whole file runs concurrently.
describe.concurrent("pnpm-lock.yaml v9", () => {
  test("v9 git and userinfo-tarball references migrate", async () => {
    using dir = fixture("v9-git-references");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    expect(await bunLock(String(dir))).toEqual({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: {
        "": {
          name: "v9-git-references",
          dependencies: {
            hue: "github:org/hue#ec3d1d1",
            "pkg-a": "git+ssh://git@example.com/org/pkg-a.git#v1",
            priv: "https://token@tarballs.example.com/priv-1.0.0.tgz",
          },
        },
      },
      packages: {
        hue: [
          "hue@git+ssh://git@example.com:org/hue.git#ec3d1d18f73ab023b1fa3e31e1f4316f476566a5",
          { dependencies: { priv: "https://token@tarballs.example.com/priv-1.0.0.tgz" } },
          "",
        ],
        "pkg-a": [
          PKG_A_GIT,
          {
            dependencies: {
              "pkg-b": "git+ssh://git@example.com/org/pkg-b.git#89abcdef0123456789abcdef0123456789abcdef",
            },
          },
          "",
        ],
        "pkg-b": [PKG_B_GIT, {}, ""],
        priv: ["priv@https://token@tarballs.example.com/priv-1.0.0.tgz", {}],
      },
    });
  });

  test("v9 alias in snapshot optionalDependencies gets the npm: prefix", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/v9-alias-in-optional-dependencies"),
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(packageDir);
    expect(lock.workspaces).toEqual({
      "": { name: "v9-alias-in-optional-dependencies", dependencies: { "one-dep": "^1.0.0" } },
    });
    expect(lock.packages).toEqual({
      "aliased-no-deps": npm("no-deps@2.0.0"),
      "no-deps": npm("no-deps@1.0.1"),
      "one-dep": npm("one-dep@1.0.0", {
        dependencies: { "no-deps": "1.0.1" },
        optionalDependencies: { "aliased-no-deps": "npm:no-deps@2.0.0" },
      }),
    });

    const install = await run(packageDir, "install", "--frozen-lockfile");

    expect(stderrLines(install.stderr)).toEqual([]);
    expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
      "+ one-dep@1.0.0

      3 packages installed"
    `);
    expect(install.exitCode).toBe(0);

    expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
      "node_modules/aliased-no-deps/no-deps@2.0.0
      node_modules/no-deps/no-deps@1.0.1
      node_modules/one-dep/one-dep@1.0.0"
    `);
  });

  test.each([
    ["v9-missing-package-entry", "'no-deps@1.0.0' for dependency 'no-deps' of importer '.'"],
    ["v9-missing-package-entry-workspace", "'no-deps@1.0.0' for dependency 'no-deps' of importer 'packages/a'"],
    ["v9-missing-package-entry-transitive", "'no-deps@9.9.9' for dependency 'no-deps' of package 'pkg-a'"],
  ])("reports the missing packages entry (%s)", async (name, entry) => {
    using dir = fixture(name);

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([`error: pnpm-lock.yaml has no package entry ${entry}`, FAILED]);
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
  });

  test("reports an importer whose package.json is missing", async () => {
    using dir = fixture("v9-missing-importer-package-json");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([
      "error: pnpm-lock.yaml lists importer 'packages/gone' but 'packages/gone/package.json' does not exist",
      FAILED,
    ]);
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
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

    expect(stderrLines(stderr)).toEqual([
      'warn: skipped pnpm registry "work" from pnpm-lock.yaml: not in namedRegistries of pnpm-workspace.yaml (resolving its packages from the configured registry)',
      MIGRATED,
    ]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(packageDir);
    expect(lock.workspaces).toEqual({ "": { name: "registry-qualified", dependencies: { "no-deps": "^1.0.0" } } });
    expect(lock.packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });
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

      expect(stderrLines(stderr)).toEqual([
        'warn: fetching pnpm registry "npmjs" packages from https://registry.npmjs.org/; add it to bunfig.toml or .npmrc if it needs authentication',
        MIGRATED,
      ]);
      expect(exitCode).toBe(0);

      // bun.lock spells the default registry as "" (bun.lock.rs url_is_under_registry(DEFAULT_URL)).
      expect((await bunLock(packageDir)).packages).toEqual({
        "no-deps": ["no-deps@1.0.1", "", {}, INTEGRITY["no-deps@1.0.1"]],
      });
    });

    test("namedRegistries entry pointing at the configured registry needs no warning", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "named-registry-same", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `namedRegistries:\n  work: ${registry}\n`,
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("work"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      expect((await bunLock(packageDir)).packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ no-deps@1.0.1

        1 package installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`"node_modules/no-deps/no-deps@1.0.1"`);
    });

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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

  peer-deps-fixed@work:1.0.0:
    resolution: {integrity: ${INTEGRITY["peer-deps-fixed@1.0.0"]}}
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

      // the registry is reported once, not once per package
      expect(stderrLines(stderr)).toEqual([
        `warn: fetching pnpm registry "work" packages from ${named}; add it to bunfig.toml or .npmrc if it needs authentication`,
        MIGRATED,
      ]);
      expect(exitCode).toBe(0);

      expect((await bunLock(packageDir)).packages).toEqual({
        "no-deps": ["no-deps@1.0.1", tarballUrl("no-deps@1.0.1", named), {}, INTEGRITY["no-deps@1.0.1"]],
        "peer-deps-fixed": [
          "peer-deps-fixed@1.0.0",
          tarballUrl("peer-deps-fixed@1.0.0", named),
          { peerDependencies: { "no-deps": "^1.0.0" } },
          INTEGRITY["peer-deps-fixed@1.0.0"],
        ],
      });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ no-deps@1.0.1
        + peer-deps-fixed@1.0.0

        2 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
        "node_modules/no-deps/no-deps@1.0.1
        node_modules/peer-deps-fixed/peer-deps-fixed@1.0.0"
      `);
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

  one-dep@work:1.0.0:
    resolution: {integrity: ${INTEGRITY["one-dep@1.0.0"]}}

snapshots:

  no-deps@work:1.0.1: {}

  one-dep@work:1.0.0:
    dependencies:
      no-deps: work:1.0.1
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([
        'warn: skipped pnpm registry "work" from pnpm-lock.yaml: not in namedRegistries of pnpm-workspace.yaml (resolving its packages from the configured registry)',
        MIGRATED,
      ]);
      expect(exitCode).toBe(0);

      expect((await bunLock(packageDir)).packages).toEqual({
        "no-deps": npm("no-deps@1.0.1"),
        "one-dep": npm("one-dep@1.0.0", { dependencies: { "no-deps": "1.0.1" } }),
      });
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

      expect(stderrLines(stderr)).toEqual([
        'warn: fetching pnpm registry "gh" packages from https://npm.pkg.github.com/; add it to bunfig.toml or .npmrc if it needs authentication',
        MIGRATED,
      ]);
      expect(exitCode).toBe(0);

      expect((await bunLock(packageDir)).packages).toEqual({
        "no-deps": [
          "no-deps@1.0.1",
          "https://npm.pkg.github.com/no-deps/-/no-deps-1.0.1.tgz",
          {},
          INTEGRITY["no-deps@1.0.1"],
        ],
      });
    });

    test("namedRegistries overrides the built-in npmjs entry", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "npmjs-overridden", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": `namedRegistries:\n  npmjs: ${registry}\n`,
          "pnpm-lock.yaml": registryQualifiedNoDepsLockfile("npmjs"),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      expect((await bunLock(packageDir)).packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ no-deps@1.0.1

        1 package installed"
      `);
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
          "pnpm-workspace.yaml": `namedRegistries:\n  work: ${registry}\n`,
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

snapshots:

  app@file:vendor/app:
    dependencies:
      nd: no-deps@work:1.0.1

  no-deps@work:1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migrated = await bunLockText(packageDir);
      expect(parseLock(migrated).packages).toEqual({
        app: ["app@file:vendor/app", { dependencies: { nd: "npm:no-deps@1.0.1" } }],
        nd: npm("no-deps@1.0.1"),
      });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ app@vendor/app

        2 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(packageDir)).toBe(migrated);
      expect(await installedPackageJson(packageDir, "", "nd")).toStrictEqual({ name: "no-deps", version: "1.0.1" });
    });
  });

  test("reports a package whose resolution cannot be parsed", async () => {
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

    expect(stderrLines(stderr)).toEqual([
      "error: pnpm-lock.yaml package 'foo@1.0' has an unsupported resolution",
      FAILED,
    ]);
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
  });

  test("warns about a lockfileVersion newer than 9", async () => {
    using dir = tempDir("pnpm-v9-newer-version", {
      "package.json": JSON.stringify({ name: "newer-version" }),
      "pnpm-lock.yaml": `lockfileVersion: '10.0'

importers:

  .: {}
`,
    });

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual(["warn: pnpm-lock.yaml is lockfileVersion 10; migrating it as 9.0", MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(String(dir));
    expect(lock.workspaces).toEqual({ "": { name: "newer-version" } });
    expect(lock.packages).toEqual({});
  });

  describe("multi-document lockfile", () => {
    // pnpm 11 writes `---<env lockfile>---<lockfile>` (pnpm11/lockfile/fs/src/envLockfile.ts)
    test("migrates the last document", async () => {
      using dir = fixture("v9-multi-document");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(String(dir));
      expect(lock.workspaces).toEqual({
        "": { name: "v9-multi-document", dependencies: { "pkg-a": "git+ssh://git@example.com/org/pkg-a.git#v1" } },
      });
      // the env lockfile's plugin-better-defaults entry is not a package
      expect(lock.packages).toEqual({ "pkg-a": [PKG_A_GIT, {}, ""] });
    });

    test("rejects a file whose main document is empty", async () => {
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

      expect(stderrLines(stderr)).toEqual(["error: pnpm-lock.yaml root must be an object, got null", FAILED]);
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });
  });

  test("runtime: entries are skipped with a warning", async () => {
    using dir = fixture("v9-runtime-entries");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([
      'warn: skipped "node@runtime:22.0.0" from pnpm-lock.yaml: runtime dependencies are not supported',
      MIGRATED,
    ]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(String(dir));
    expect(lock.workspaces).toEqual({
      "": { name: "v9-runtime-entries", dependencies: { "pkg-a": "git+ssh://git@example.com/org/pkg-a.git#v1" } },
    });
    expect(lock.packages).toEqual({ "pkg-a": [PKG_A_GIT, {}, ""] });
  });

  describe("patchedDependencies", () => {
    // fixture ported from pnpm11/deps/compliance/commands/test/licenses/fixtures/with-git-protocol-patched-deps
    const IS_POSITIVE = "is-positive@github:kevva/is-positive#97edff6f525f192a3f83cea1944765f769ae2678";
    const MOVED_PATCHES = "moved pnpm-workspace.yaml patchedDependencies to patchedDependencies in package.json";

    test.each(["legacy", "bare"])("%s hash form on a git-hosted package", async form => {
      using dir = fixture(`v9-patched-git-hosted-${form}`);

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([MOVED_PATCHES, MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(String(dir));
      expect(lock.workspaces).toEqual({
        "": { name: "v9-patched-git-hosted", dependencies: { "is-positive": "github:kevva/is-positive" } },
      });
      // keyed by the resolved package, not by the `is-positive@3.1.0` config key
      expect(lock.patchedDependencies).toEqual({ [IS_POSITIVE]: "patches/is-positive@3.1.0.patch" });
      expect(lock.packages).toEqual({ "is-positive": [IS_POSITIVE, {}, ""] });

      expect(await packageJsonOf(String(dir))).toStrictEqual({
        name: "v9-patched-git-hosted",
        version: "1.0.0",
        dependencies: { "is-positive": "github:kevva/is-positive" },
        patchedDependencies: { "is-positive@3.1.0": "patches/is-positive@3.1.0.patch" },
      });
    });

    test("bare hash whose patch is not in the config is skipped with a warning", async () => {
      using dir = fixture("v9-patched-git-hosted-bare");
      rmSync(join(String(dir), "pnpm-workspace.yaml"));

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([
        'warn: skipped patch "is-positive@3.1.0" from pnpm-lock.yaml: not in patchedDependencies of package.json or pnpm-workspace.yaml',
        MIGRATED,
      ]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(String(dir));
      expect(lock.patchedDependencies).toBeUndefined();
      expect(lock.packages).toEqual({ "is-positive": [IS_POSITIVE, {}, ""] });
    });

    test("bare hash on a registry package with a bare `name` key in pnpm-workspace.yaml", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/v9-patch-bare-hash-registry"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MOVED_PATCHES, MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      expect(lock.patchedDependencies).toEqual({ "no-deps@1.0.1": "patches/no-deps.patch" });
      expect(lock.packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });

      expect(await packageJsonOf(packageDir)).toStrictEqual({
        name: "v9-patch-bare-hash-registry",
        version: "1.0.0",
        dependencies: { "no-deps": "^1.0.0" },
        patchedDependencies: { "no-deps@1.0.1": "patches/no-deps.patch" },
      });
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

snapshots:

  no-deps@1.0.1(patch_hash=${PATCH_HASH}): {}
`;
    }

    // the same migrated no-deps@1.0.1 patched with NO_DEPS_INDEX_PATCH, from a package.json or a pnpm-workspace.yaml config key
    test.each([
      [
        "bare hash whose path is only in package.json pnpm.patchedDependencies",
        {
          "package.json": JSON.stringify({
            name: "patch-path-in-package-json",
            dependencies: { "no-deps": "^1.0.0" },
            pnpm: { patchedDependencies: { "no-deps": "patches/no-deps.patch" } },
          }),
          "pnpm-lock.yaml": bareHashNoDepsLockfile("no-deps"),
        },
        "moved pnpm.patchedDependencies to patchedDependencies in package.json",
        { name: "patch-path-in-package-json", dependencies: { "no-deps": "^1.0.0" } },
      ],
      [
        "versioned lockfile key falls back to the bare config key",
        {
          "package.json": JSON.stringify({ name: "patch-key-fallback", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-workspace.yaml": "patchedDependencies:\n  no-deps: patches/no-deps.patch\n",
          "pnpm-lock.yaml": bareHashNoDepsLockfile("no-deps@1.0.1"),
        },
        MOVED_PATCHES,
        { name: "patch-key-fallback", dependencies: { "no-deps": "^1.0.0" } },
      ],
    ])("%s", async (_, files, moved, packageJson) => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { ...files, "patches/no-deps.patch": NO_DEPS_INDEX_PATCH },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([moved, MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      expect(lock.patchedDependencies).toEqual({ "no-deps@1.0.1": "patches/no-deps.patch" });
      expect(lock.packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });
      expect(await packageJsonOf(packageDir)).toStrictEqual({
        ...packageJson,
        patchedDependencies: { "no-deps@1.0.1": "patches/no-deps.patch" },
      });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ no-deps@1.0.1

        1 package installed"
      `);
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

  one-dep@1.0.0:
    resolution: {integrity: ${INTEGRITY["one-dep@1.0.0"]}}

snapshots:

  no-deps@1.0.1(patch_hash=${PATCH_HASH}): {}

  one-dep@1.0.0(patch_hash=${PATCH_HASH}):
    dependencies:
      no-deps: 1.0.1(patch_hash=${PATCH_HASH})
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MOVED_PATCHES, MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      expect(lock.patchedDependencies).toEqual({
        "no-deps@1.0.1": "patches/shared.patch",
        "one-dep@1.0.0": "patches/shared.patch",
      });
      expect(lock.packages).toEqual({
        "no-deps": npm("no-deps@1.0.1"),
        "one-dep": npm("one-dep@1.0.0", { dependencies: { "no-deps": "1.0.1" } }),
      });
      expect((await packageJsonOf(packageDir)).patchedDependencies).toStrictEqual({
        "no-deps@1.0.1": "patches/shared.patch",
        "one-dep@1.0.0": "patches/shared.patch",
      });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ no-deps@1.0.1
        + one-dep@1.0.0

        2 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await Bun.file(join(packageDir, "node_modules/no-deps/patched.txt")).text()).toBe("patched\n");
      expect(await Bun.file(join(packageDir, "node_modules/one-dep/patched.txt")).text()).toBe("patched\n");
    });

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

        expect(stderrLines(stderr)).toEqual([MOVED_PATCHES, MIGRATED]);
        expect(exitCode).toBe(0);

        const migrated = await bunLockText(packageDir);
        expect(parseLock(migrated).patchedDependencies).toEqual({
          "no-deps@1.0.1": "patches/no-deps.patch",
        });

        const install = await run(packageDir, "install", "--frozen-lockfile");

        expect(stderrLines(install.stderr)).toEqual([]);
        expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
          "+ no-deps@1.0.1

          1 package installed"
        `);
        expect(install.exitCode).toBe(0);
        expect(await bunLockText(packageDir)).toBe(migrated);
        expect(await Bun.file(join(packageDir, "node_modules/no-deps/index.js")).text()).toStartWith(
          "globalThis.patchedByMigration = true;\nmodule.exports = require(`./package.json`);\n",
        );
      },
    );
  });

  test("catalog:default is the default catalog", async () => {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/v9-catalog-default"),
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderrLines(stderr)).toEqual(["moved pnpm-workspace.yaml to workspaces in package.json", MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(packageDir);
    expect(lock.workspaces).toEqual({ "": { name: "v9-catalog-default", dependencies: { "no-deps": "^1.0.0" } } });
    expect(lock.catalog).toEqual({ "no-deps": "^1.0.0" });
    expect(lock.packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });
  });

  test("reference shapes: scoped + peer suffix, short alias, scoped alias, file: tarball", async () => {
    // reference vectors from pnpm11/deps/path/test/index.ts refToRelative()
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/v9-reference-shapes"),
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(packageDir);
    expect(lock.workspaces).toEqual({
      "": {
        name: "v9-reference-shapes",
        dependencies: {
          "@types/no-deps": "^1.0.0",
          nd: "npm:no-deps@1.0.1",
          "one-dep": "^1.0.0",
          tb: "file:tb-1.0.0.tgz",
          tnd: "npm:@types/no-deps@2.0.0",
        },
      },
    });
    expect(lock.packages).toEqual({
      "@types/is-number": npm("@types/is-number@1.0.0"),
      "@types/no-deps": npm("@types/no-deps@1.0.0", { peerDependencies: { "@types/is-number": "*" } }),
      nd: npm("no-deps@1.0.1"),
      "one-dep": npm("one-dep@1.0.0", {
        dependencies: {
          "@types/no-deps": "1.0.0",
          nd: "npm:no-deps@1.0.1",
          tb: "file:tb-1.0.0.tgz",
          tnd: "npm:@types/no-deps@2.0.0",
        },
      }),
      tb: ["tb@tb-1.0.0.tgz", {}],
      tnd: npm("@types/no-deps@2.0.0"),
    });
  });

  test("snapshot alias whose dep-path version is a file: directory or tarball", async () => {
    using dir = fixture("v9-alias-non-registry-dep-path");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    expect(await bunLock(String(dir))).toEqual({
      lockfileVersion: 2,
      configVersion: 1,
      workspaces: {
        "": { name: "v9-alias-non-registry-dep-path", dependencies: { outer: "file:outer" } },
      },
      packages: {
        fork: ["bar@github:o/bar#aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b", {}, ""],
        outer: [
          "outer@file:outer",
          {
            dependencies: {
              config: "file:shared/config",
              fork: "https://codeload.github.com/o/bar/tar.gz/aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b",
            },
          },
        ],
        "outer/config": ["hi2@file:shared/config", {}],
      },
    });
  });

  describe("local file: tarballs", () => {
    test("tarball+integrity, integrity-only .tar.gz, and upper-case / .tar spellings", async () => {
      // tar-pkg entry ported from pnpm11/installing/deps-restorer/test/fixtures/has-local-dep/pkg/pnpm-lock.yaml
      using dir = fixture("v9-local-tarballs");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(String(dir));
      expect(lock.workspaces).toEqual({
        "": {
          name: "v9-local-tarballs",
          dependencies: {
            plain: "file:../plain-1.0.0.tar",
            "tar-gz-pkg": "file:../tar-gz-pkg-1.0.0.tar.gz",
            "tar-pkg": "file:../tar-pkg-1.0.0.tgz",
            upper: "file:../UPPER-1.0.0.TGZ",
          },
        },
      });
      expect(lock.packages).toEqual({
        plain: ["plain@../plain-1.0.0.tar", {}, LOCAL_TARBALL_INTEGRITY],
        "tar-gz-pkg": ["tar-gz-pkg@../tar-gz-pkg-1.0.0.tar.gz", {}, LOCAL_TARBALL_INTEGRITY],
        "tar-pkg": ["tar-pkg@../tar-pkg-1.0.0.tgz", {}, LOCAL_TARBALL_INTEGRITY],
        upper: ["upper@../UPPER-1.0.0.TGZ", {}, LOCAL_TARBALL_INTEGRITY],
      });
    });

    // pnpm11/lockfile/utils/src/refIsLocalTarball.ts is case-insensitive and accepts .tar
    test.each(["up-1.0.0.TGZ", "mixed-1.0.0.Tar.Gz", "plain-1.0.0.tar"])(
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

        expect(stderrLines(stderr)).toEqual([MIGRATED]);
        expect(exitCode).toBe(0);

        const lock = await bunLock(String(dir));
        expect(lock.workspaces).toEqual({
          "": { name: "tarball-spelling", dependencies: { pkg: `file:vendor/${file}` } },
        });
        expect(lock.packages).toEqual({ pkg: [`pkg@vendor/${file}`, {}, LOCAL_TARBALL_INTEGRITY] });
      },
    );
  });

  test("file: directory with type: directory and a nested file: dependency", async () => {
    // ported from pnpm11/deps/compliance/commands/test/licenses/fixtures/with-file-protocol
    using dir = fixture("v9-file-directory");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(String(dir));
    expect(lock.workspaces).toEqual({
      "": { name: "v9-file-directory", dependencies: { "sub-dep": "file:./sub-dep" } },
    });
    expect(lock.packages).toEqual({
      "sub-dep": ["sub-dep@file:sub-dep", { dependencies: { "nested-child": "file:sub-dep/child" } }],
      "sub-dep/nested-child": ["nested-child@file:sub-dep/child", {}],
    });
  });

  test("codeload tarballs with and without gitHosted: true", async () => {
    // ported from pnpm11/__fixtures__/with-git-protocol-dep and with-non-package-dep
    using dir = fixture("v9-codeload-tarballs");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(String(dir));
    expect(lock.workspaces).toEqual({
      "": {
        name: "v9-codeload-tarballs",
        dependencies: {
          camelcase: "denolib/camelcase#aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b",
          "is-negative": "github:kevva/is-negative#master",
        },
      },
    });
    expect(lock.packages).toEqual({
      camelcase: ["camelcase@github:denolib/camelcase#aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b", {}, ""],
      "is-negative": ["is-negative@github:kevva/is-negative#1d7e288222b53a0cab90a331f1865220ec29560c", {}, ""],
    });
  });

  test("git resolutions keep the ssh port and userinfo; orphan packages entries are ignored", async () => {
    using dir = fixture("v9-git-urls-and-orphan");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(String(dir));
    expect(lock.workspaces).toEqual({
      "": {
        name: "v9-git-urls",
        dependencies: {
          a: "git+ssh://git@example.com:2222/org/a.git",
          b: "git+https://TOKEN:x-oauth-basic@github.com/foo/bar.git",
        },
      },
    });
    expect(lock.packages).toEqual({
      a: ["a@git+ssh://git@example.com:2222/org/a.git#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {}, ""],
      b: ["b@git+https://TOKEN:x-oauth-basic@github.com/foo/bar.git#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {}, ""],
    });
  });

  describe("injected workspace packages", () => {
    test("resolve to the workspace package instead of a folder package", async () => {
      using dir = fixture("v9-injected-workspace");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(String(dir));
      expect(lock.workspaces).toEqual({
        "": { name: "v9-injected-workspace", dependencies: { foo: "workspace:*" } },
        "packages/foo": { name: "foo" },
      });
      expect(lock.packages).toEqual({ foo: ["foo@workspace:packages/foo"] });

      const install = await run(String(dir), "install", "--frozen-lockfile", "--linker", "hoisted");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ foo@workspace:packages/foo

        1 package installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await installedPackageJson(String(dir), "", "foo")).toStrictEqual({ name: "foo", version: "1.0.0" });
    });

    test("pruned lockfile with a peer-suffixed packages key and a directory-typed registry key", async () => {
      // ported from pnpm11/installing/deps-restorer/test/fixtures/peer-variant-missing-resolution
      using dir = fixture("v9-peer-variant-missing-resolution");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([
        'warn: skipped peer "peer" of workspace "packages/pkg-a": not recorded in pnpm-lock.yaml (bun install will resolve it)',
        MIGRATED,
      ]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(String(dir));
      expect(lock.workspaces).toEqual({
        "": { name: "v9-peer-variant-missing-resolution", dependencies: { "pkg-a": "workspace:*" } },
        "packages/peer": { name: "peer" },
        "packages/pkg-a": { name: "pkg-a", peerDependencies: { peer: "1.0.0" } },
      });
      expect(lock.packages).toEqual({
        peer: ["peer@workspace:packages/peer"],
        "pkg-a": ["pkg-a@workspace:packages/pkg-a"],
      });
    });
  });

  describe("pruned snapshots", () => {
    // pnpm11/lockfile/fs convertToLockfileObject rebuilds `file:` directories whose packages: entry turbo prune dropped
    test("file: variants without a packages entry are rebuilt", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/v9-snapshot-only-file-variants"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      expect(lock.workspaces).toEqual({
        "": {
          name: "v9-snapshot-only-file-variants",
          dependencies: { dir: "workspace:*", local: "file:vendor/local" },
        },
        "packages/dir": { name: "dir" },
      });
      // the workspace member wins over the `dir@file:` snapshot; the snapshot-only `tb@` tarball variant is not referenced
      expect(lock.packages).toEqual({
        dir: ["dir@workspace:packages/dir"],
        local: ["local@file:vendor/local", { dependencies: { "no-deps": "1.0.0" } }],
        "no-deps": npm("no-deps@1.0.0"),
      });
    });

    test("a lockfile with snapshots but no packages section migrates", async () => {
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

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(String(dir));
      expect(lock.workspaces).toEqual({ "": { name: "snapshots-only", dependencies: { local: "file:vendor/local" } } });
      expect(lock.packages).toEqual({ local: ["local@file:vendor/local", {}] });
    });

    // guard: only directories are rebuilt; a tarball needs the integrity its packages: entry carried
    test.each(["tb-1.0.0.tgz", "tb-1.0.0.TGZ", "tb-1.0.0.Tar.Gz"])(
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

        expect(stderrLines(stderr)).toEqual([
          `error: pnpm-lock.yaml has no package entry 'tb@file:vendor/${file}' for dependency 'tb' of importer '.'`,
          FAILED,
        ]);
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
    resolution: {integrity: ${INTEGRITY["a-dep@1.0.1"]}}

  no-deps@1.0.1:
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

  peer-deps@1.0.0:
    resolution: {integrity: ${INTEGRITY["peer-deps@1.0.0"]}}
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
    resolution: {integrity: ${INTEGRITY["peer-deps-fixed@1.0.0"]}}
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

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      // the snapshot's resolved `no-deps: 1.0.1` and `optionalDependencies` stay peer edges; a peer with no snapshot (g) is optional
      expect((await bunLock(packageDir)).packages).toEqual({
        "a-dep": npm("a-dep@1.0.1"),
        "no-deps": npm("no-deps@1.0.1"),
        "peer-deps": npm("peer-deps@1.0.0", {
          peerDependencies: { "a-dep": "*", d: ">=2", e: "*", "no-deps": "^1.0.0" },
          optionalPeers: ["a-dep", "d", "e"],
        }),
        "peer-deps-fixed": npm("peer-deps-fixed@1.0.0", { peerDependencies: { g: "^1" }, optionalPeers: ["g"] }),
      });
    });

    // pnpm11/__fixtures__/with-peer: the packages entry declares `ajv: ^6.9.1`, the snapshot resolves 6.10.2
    test("declared ranges win over the snapshot's resolved versions; peers pnpm left out are still emitted", async () => {
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

  one-optional-peer-dep@1.0.2:
    resolution: {integrity: ${INTEGRITY["one-optional-peer-dep@1.0.2"]}}
    peerDependencies:
      no-deps: ^1.0.0
    peerDependenciesMeta:
      no-deps:
        optional: true

  peer-deps-fixed@1.0.0:
    resolution: {integrity: ${INTEGRITY["peer-deps-fixed@1.0.0"]}}
    peerDependencies:
      no-deps: ^1.0.0

  peer-deps-too@1.0.0:
    resolution: {integrity: ${INTEGRITY["peer-deps-too@1.0.0"]}}
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

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migrated = await bunLockText(packageDir);
      expect(parseLock(migrated).packages).toEqual({
        "no-deps": npm("no-deps@1.0.1"),
        "one-optional-peer-dep": npm("one-optional-peer-dep@1.0.2", {
          peerDependencies: { "no-deps": "^1.0.0" },
          optionalPeers: ["no-deps"],
        }),
        "peer-deps-fixed": npm("peer-deps-fixed@1.0.0", { peerDependencies: { "no-deps": "^1.0.0" } }),
        "peer-deps-too": npm("peer-deps-too@1.0.0", { peerDependencies: { "no-deps": "*" } }),
      });

      const install = await run(packageDir, "install");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ no-deps@1.0.1
        + one-optional-peer-dep@1.0.2
        + peer-deps-fixed@1.0.0
        + peer-deps-too@1.0.0

        4 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(packageDir)).toBe(migrated);
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

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      expect(lock.workspaces).toEqual({
        "": { name: "v9-peer-range-dedupe", dependencies: { "one-dep": "1.0.0", "provides-peer-deps-1-0-0": "1.0.0" } },
      });
      // peer-deps' `no-deps: *` binds to the hoisted no-deps@1.0.1, not to a nested copy of 1.0.0
      expect(lock.packages).toEqual({
        "no-deps": npm("no-deps@1.0.1"),
        "one-dep": npm("one-dep@1.0.0", { dependencies: { "no-deps": "1.0.1" } }),
        "peer-deps": npm("peer-deps@1.0.0", { peerDependencies: { "no-deps": "*" } }),
        "provides-peer-deps-1-0-0": npm("provides-peer-deps-1-0-0@1.0.0", {
          dependencies: { "no-deps": "1.0.0", "peer-deps": "1.0.0" },
        }),
        "provides-peer-deps-1-0-0/no-deps": npm("no-deps@1.0.0"),
      });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ one-dep@1.0.0
        + provides-peer-deps-1-0-0@1.0.0

        5 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
        "node_modules/no-deps/no-deps@1.0.1
        node_modules/one-dep/one-dep@1.0.0
        node_modules/peer-deps/peer-deps@1.0.0
        node_modules/provides-peer-deps-1-0-0/node_modules/no-deps/no-deps@1.0.0
        node_modules/provides-peer-deps-1-0-0/provides-peer-deps-1-0-0@1.0.0"
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

  no-deps@2.0.0:
    resolution: {integrity: ${INTEGRITY["no-deps@2.0.0"]}}

  peer-deps@1.0.0:
    resolution: {integrity: ${INTEGRITY["peer-deps@1.0.0"]}}
    peerDependencies:
      no-deps: '*'

snapshots:

  no-deps@1.0.1: {}

  no-deps@2.0.0: {}

${variants}`;
    // one peer-deps entry for both variants; b keeps its own no-deps@2.0.0 under the hoisted 1.0.1
    const peerVariantPackages: Lockfile["packages"] = {
      a: ["a@workspace:apps/a"],
      b: ["b@workspace:apps/b"],
      "no-deps": npm("no-deps@1.0.1"),
      "peer-deps": npm("peer-deps@1.0.0", { peerDependencies: { "no-deps": "*" } }),
      "b/no-deps": npm("no-deps@2.0.0"),
    };

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

      expect(stderrLines(forwardResult.stderr)).toEqual([MIGRATED]);
      expect(stderrLines(swappedResult.stderr)).toEqual([MIGRATED]);
      expect(forwardResult.exitCode).toBe(0);
      expect(swappedResult.exitCode).toBe(0);

      const migrated = await bunLockText(forward);
      expect(parseLock(migrated).packages).toEqual(peerVariantPackages);
      expect(await bunLockText(swapped)).toBe(migrated);

      const install = await run(forward, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`"5 packages installed"`);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(forward)).toBe(migrated);
      expect((await installedPackageJson(forward, "apps/a", "no-deps")).version).toBe("1.0.1");
      expect((await installedPackageJson(forward, "apps/b", "no-deps")).version).toBe("2.0.0");

      // pins existing behaviour (not a fix): a variant lockfile migrates to the bun.lock a fresh install writes
      const { packageDir: fresh } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: peerVariantPackageJsons,
      });

      const freshInstall = await run(fresh, "install");

      expect(stderrLines(freshInstall.stderr)).toEqual(["Saved lockfile"]);
      expect(freshInstall.exitCode).toBe(0);
      expect(await bunLockText(fresh)).toBe(migrated);
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

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migrated = await bunLockText(packageDir);
      expect(parseLock(migrated).packages).toEqual(peerVariantPackages);

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`"3 packages installed"`);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(packageDir)).toBe(migrated);

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

    test("a peer met in one importer and unmet in another is bound from the met variant", async () => {
      // pnpm sorts the unsuffixed (peer-unmet) variant first; the met variant must still bind the peer
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: join(import.meta.dir, "pnpm/v9-peer-variant-merge"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migrated = await bunLockText(packageDir);
      const lock = parseLock(migrated);
      expect(lock.workspaces).toEqual({
        "": { name: "v9-peer-variant-merge", dependencies: { "has-peer": "file:vendor/has-peer" } },
        "packages/with": {
          name: "with",
          dependencies: { "has-peer": "file:../../vendor/has-peer", peer: "file:../../vendor/peer" },
        },
      });
      // the root's has-peer has no peer of its own, but the `with` importer's variant binds one
      expect(lock.packages).toEqual({
        "has-peer": ["has-peer@file:vendor/has-peer", { peerDependencies: { peer: "*" } }],
        with: ["with@workspace:packages/with"],
        "has-peer/peer": ["peer@file:vendor/peer", {}],
        "with/has-peer": ["has-peer@file:vendor/has-peer", { peerDependencies: { peer: "*" } }],
        "with/peer": ["peer@file:vendor/peer", {}],
        "with/has-peer/peer": ["peer@file:vendor/peer", {}],
      });

      const install = await run(packageDir, "install", "--frozen-lockfile");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ has-peer@vendor/has-peer

        2 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(packageDir)).toBe(migrated);

      const entry = readdirSync(join(packageDir, "node_modules", ".bun")).find(name =>
        /^has-peer@file\+vendor\+has-peer\+[0-9a-f]{16}$/.test(name),
      );
      expect(entry).toBeDefined();
      expect(
        existsSync(join(packageDir, "node_modules", ".bun", entry!, "node_modules", "peer", "package.json")),
      ).toBeTrue();
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
    const linkedPeerWorkspaces = {
      "": { name: "v9-linked-peer", dependencies: { "has-peer": "file:vendor/has-peer" } },
      "packages/peer": { name: "peer" },
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

    test("a declared peer resolved to a link: stays a regular dependency edge", async () => {
      using dir = tempDir("pnpm-v9-peer-resolved-to-link", {
        ...linkedPeerFiles,
        "pnpm-lock.yaml": linkedPeerLockfile(`  has-peer@file:vendor/has-peer:
    dependencies:
      peer: link:packages/peer
`),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migrated = await bunLockText(String(dir));
      const lock = parseLock(migrated);
      expect(lock.workspaces).toEqual(linkedPeerWorkspaces);
      expect(lock.packages).toEqual({
        "has-peer": ["has-peer@file:vendor/has-peer", { dependencies: { peer: "link:packages/peer" } }],
        peer: ["peer@workspace:packages/peer"],
      });

      const install = await run(String(dir), "install", "--frozen-lockfile", "--linker", "hoisted");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ has-peer@vendor/has-peer

        2 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(String(dir))).toBe(migrated);
      expect(await installedPackageJson(String(dir), "", "peer")).toStrictEqual({ name: "peer", version: "1.0.0" });
    });

    test("a later variant resolving the peer to a link: leaves the peer for bun install", async () => {
      using dir = tempDir("pnpm-v9-peer-variant-link", {
        ...linkedPeerFiles,
        "pnpm-lock.yaml": linkedPeerLockfile(`  has-peer@file:vendor/has-peer: {}

  has-peer@file:vendor/has-peer(peer@packages+peer):
    dependencies:
      peer: link:packages/peer
`),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migrated = await bunLockText(String(dir));
      const lock = parseLock(migrated);
      expect(lock.workspaces).toEqual(linkedPeerWorkspaces);
      expect(lock.packages).toEqual({
        "has-peer": ["has-peer@file:vendor/has-peer", { peerDependencies: { peer: "*" } }],
        peer: ["peer@workspace:packages/peer"],
      });

      // the workspace package satisfies the peer, so the install neither fails nor rewrites bun.lock
      const install = await run(String(dir), "install", "--linker", "hoisted");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ has-peer@vendor/has-peer

        2 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(String(dir))).toBe(migrated);
      expect(await installedPackageJson(String(dir), "", "peer")).toStrictEqual({ name: "peer", version: "1.0.0" });
    });

    test("root and workspace peerDependencies come from package.json", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/v9-importer-peers"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      expect(lock.workspaces).toEqual({
        "": {
          name: "v9-importer-peers",
          dependencies: { "no-deps": "^1.0.0" },
          peerDependencies: {
            "@types/is-number": "*",
            "@types/no-deps": "*",
            "no-deps": "^1.0.0",
            "peer-deps-fixed": "^1.0.0",
          },
          optionalPeers: ["@types/is-number", "@types/no-deps"],
        },
        "packages/a": { name: "a", peerDependencies: { "no-deps": "^1.0.0" } },
      });
      expect(lock.packages).toEqual({
        a: ["a@workspace:packages/a"],
        "no-deps": npm("no-deps@1.0.1"),
        "peer-deps-fixed": npm("peer-deps-fixed@1.0.0", { peerDependencies: { "no-deps": "^1.0.0" } }),
      });
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(migrated);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migratedLock = await bunLock(migrated);
      expect(migratedLock.workspaces).toEqual({
        "": {
          name: "dev-and-peer",
          devDependencies: { "no-deps": "^1.0.0" },
          peerDependencies: { "no-deps": "^1.0.0" },
        },
      });
      expect(migratedLock.packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });

      const { packageDir: fresh } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": packageJson },
      });

      const install = await run(fresh, "install");

      expect(stderrLines(install.stderr)).toEqual(["Saved lockfile"]);
      expect(install.exitCode).toBe(0);
      expect((await bunLock(fresh)).workspaces).toEqual(migratedLock.workspaces);
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
    resolution: {integrity: ${INTEGRITY["a-dep@1.0.1"]}}

  no-deps@1.0.1:
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

  no-deps@2.0.0:
    resolution: {integrity: ${INTEGRITY["no-deps@2.0.0"]}}

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

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([
        'warn: skipped peer "no-deps" of workspace "packages/project-1": not recorded in pnpm-lock.yaml (bun install will resolve it)',
        MIGRATED,
      ]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      // the peer lives on the workspace entry only; the injected `project-1@file:` packages entry does not become package-level metadata
      expect(lock.workspaces).toEqual({
        "": { name: "v9-workspace-peers" },
        "packages/project-1": {
          name: "project-1",
          dependencies: { "a-dep": "1.0.1" },
          peerDependencies: { "no-deps": ">=1.0.0" },
        },
        "packages/project-2": {
          name: "project-2",
          dependencies: { "project-1": "workspace:*" },
          devDependencies: { "no-deps": "1.0.1" },
        },
        "packages/project-3": {
          name: "project-3",
          dependencies: { "project-2": "workspace:*" },
          devDependencies: { "no-deps": "2.0.0" },
        },
      });
      expect(lock.packages).toEqual({
        "a-dep": npm("a-dep@1.0.1"),
        "no-deps": npm("no-deps@2.0.0"),
        "project-1": ["project-1@workspace:packages/project-1"],
        "project-2": ["project-2@workspace:packages/project-2"],
        "project-2/no-deps": npm("no-deps@1.0.1"),
        "project-3": ["project-3@workspace:packages/project-3"],
      });

      const install = await run(packageDir, "install");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`"3 packages installed"`);
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([
        'warn: skipped peer "has-peer" of the root package: not recorded in pnpm-lock.yaml (bun install will resolve it)',
        MIGRATED,
      ]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      expect(lock.workspaces).toEqual({
        "": {
          name: "unrecorded-peer",
          dependencies: { "no-deps": "^1.0.0" },
          peerDependencies: { "has-peer": "^1.0.0" },
          optionalPeers: ["has-peer"],
        },
      });
      expect(lock.packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

snapshots:

  no-deps@1.0.1: {}
`,
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migrated = await bunLockText(packageDir);
      const lock = parseLock(migrated);
      // the importer's `dependencies` row is pnpm's auto-installed peer, not a dependency of the root
      expect(lock.workspaces).toEqual({ "": { name: "catalog-peer", peerDependencies: { "no-deps": "catalog:" } } });
      expect(lock.catalog).toEqual({ "no-deps": "^1.0.0" });
      expect(lock.packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });

      const install = await run(packageDir, "install");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ no-deps@1.0.1

        1 package installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(packageDir)).toBe(migrated);
    });

    // real pnpm output: the root's peer-only `a-dep` sits under the importer's dependencies
    const basicWorkspaces = {
      "": {
        name: "worky3",
        dependencies: { "no-deps": "~1.0.0" },
        devDependencies: { "a-dep-b": "1.0.0" },
        optionalDependencies: { "b-dep-a": "1.0.0" },
        peerDependencies: { "a-dep": "1.0.1" },
      },
    };
    const basicPackages = {
      "a-dep": npm("a-dep@1.0.1"),
      "a-dep-b": npm("a-dep-b@1.0.0", { dependencies: { "b-dep-a": "1.0.0" } }),
      "b-dep-a": npm("b-dep-a@1.0.0", { dependencies: { "a-dep-b": "1.0.0" } }),
      "no-deps": npm("no-deps@1.0.1"),
    };

    test("bun install after bun pm migrate does not rewrite bun.lock", async () => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: join(import.meta.dir, "pnpm/basic"),
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const migrated = await bunLockText(packageDir);
      const lock = parseLock(migrated);
      expect(lock.workspaces).toEqual(basicWorkspaces);
      expect(lock.packages).toEqual(basicPackages);

      const install = await run(packageDir, "install");

      expect(stderrLines(install.stderr)).toEqual([]);
      expect(installOutput(install.stdout)).toMatchInlineSnapshot(`
        "+ a-dep-b@1.0.0
        + b-dep-a@1.0.0
        + no-deps@1.0.1
        + a-dep@1.0.1

        4 packages installed"
      `);
      expect(install.exitCode).toBe(0);
      expect(await bunLockText(packageDir)).toBe(migrated);
      expect(await installedPackageJson(packageDir, "", "a-dep")).toStrictEqual({ name: "a-dep", version: "1.0.1" });
    });

    test("bun install straight from pnpm-lock.yaml writes the same importers as bun pm migrate", async () => {
      const files = join(import.meta.dir, "pnpm/basic");
      const { packageDir: viaMigrate } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });
      const { packageDir: viaInstall } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });

      const migrated = await migrate(viaMigrate);
      expect(stderrLines(migrated.stderr)).toEqual([MIGRATED]);
      expect(migrated.exitCode).toBe(0);

      const [installAfterMigrate, directInstall] = await Promise.all([
        run(viaMigrate, "install"),
        run(viaInstall, "install"),
      ]);

      expect(stderrLines(installAfterMigrate.stderr)).toEqual([]);
      expect(installAfterMigrate.exitCode).toBe(0);
      expect(stderrLines(directInstall.stderr)).toEqual([MIGRATED, "Saved lockfile"]);
      expect(installOutput(directInstall.stdout)).toMatchInlineSnapshot(`
        "+ a-dep-b@1.0.0
        + b-dep-a@1.0.0
        + no-deps@1.0.1 (v2.0.0 available)
        + a-dep@1.0.1 (v1.0.10 available)

        4 packages installed"
      `);
      expect(directInstall.exitCode).toBe(0);

      const direct = await bunLock(viaInstall);
      expect(direct.workspaces).toEqual(basicWorkspaces);
      expect(direct).toEqual(await bunLock(viaMigrate));
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.0"]}}

snapshots:

  no-deps@1.0.0: {}
`,
      },
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderrLines(stderr)).toEqual([
      'warn: skipped "linked" from the root package: excluded from pnpm-lock.yaml by excludeLinksFromLockfile',
      MIGRATED,
    ]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(packageDir);
    expect(lock.workspaces).toEqual({ "": { name: "exclude-links", dependencies: { "no-deps": "^1.0.0" } } });
    expect(lock.packages).toEqual({ "no-deps": npm("no-deps@1.0.0") });
  });

  test("excludeLinksFromLockfile omissions name the workspace importer and its devDependencies", async () => {
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

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([
      'warn: skipped "x" from workspace "packages/a": excluded from pnpm-lock.yaml by excludeLinksFromLockfile',
      MIGRATED,
    ]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(String(dir));
    expect(lock.workspaces).toEqual({ "": { name: "exclude-links-workspace" }, "packages/a": { name: "a" } });
    expect(lock.packages).toEqual({ a: ["a@workspace:packages/a"] });
  });

  test("git resolution whose repo already carries the git+ prefix is not prefixed twice", async () => {
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

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(String(dir));
    expect(lock.workspaces).toEqual({ "": { name: "git-plus-repo", dependencies: { c: `${repo}#v1` } } });
    expect(lock.packages).toEqual({ c: [`c@${repo}#${commit}`, {}, ""] });
  });

  describe("registry tarball: urls", () => {
    // pnpm/pnpm#13534: GitHub Packages / npm Enterprise tarballs are not on the canonical `/-/` path
    test("recorded under the configured registry is kept", async () => {
      const tarball = `${registry}download/no-deps/1.0.1/0123456789abcdef`;
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "kept-tarball", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryLockfileWithTarball(tarball),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      expect((await bunLock(packageDir)).packages).toEqual({
        "no-deps": ["no-deps@1.0.1", tarball, {}, INTEGRITY["no-deps@1.0.1"]],
      });
    });

    // guards for the keep-tarball path above (pnpm/pnpm#5920 / #4361): off-registry urls are rebuilt
    test.each([
      ["on a foreign host", "https://evil.example.com/no-deps/-/no-deps-1.0.1.tgz"],
      [
        "under a registry whose hostname is a prefix of the recorded url's",
        `${registry.slice(0, -1)}.evil.example.com/no-deps/-/no-deps-1.0.1.tgz`,
      ],
    ])("recorded %s is rebuilt from the configured registry", async (_, tarball) => {
      const { packageDir } = await verdaccio.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify({ name: "foreign-tarball", dependencies: { "no-deps": "^1.0.0" } }),
          "pnpm-lock.yaml": registryLockfileWithTarball(tarball),
        },
      });

      const { stderr, exitCode } = await migrate(packageDir);

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      expect((await bunLock(packageDir)).packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.1"]}}

snapshots:

  no-deps@1.0.1: {}
`;

    const goneRegistry = () => Bun.serve({ port: 0, fetch: () => new Response("gone", { status: 404 }) });
    const project = (registry: ReturnType<typeof goneRegistry>, group: string) =>
      tempDir("pnpm-v9-manifest-gone", {
        "package.json": JSON.stringify({ name: "manifest-gone", [group]: { "no-deps": "1.0.1" } }),
        "bunfig.toml": `[install]\nregistry = "${registry.url.href}"\n`,
        "pnpm-lock.yaml": lockfile(group),
      });
    const fetchLines = (stderr: string) =>
      stderr.split("\n").filter(line => line.startsWith("warn:") || line.startsWith("error:"));

    test.each([
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
    test.each<[string, string[]]>([
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
    test("type: git resolution with path: is rejected naming the package", async () => {
      using dir = fixture("v9-git-subdirectory");

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([
        "error: pnpm-lock.yaml package 'pkg@git+ssh://git@example.com/org/monorepo.git#cba04669e621b85fbdb33371604de1a2898e68e9&path:packages/pkg' is a git sub-directory dependency (resolution.path), which bun does not support",
        FAILED,
      ]);
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });

    test("git-hosted tarball resolution with path: is rejected naming the package", async () => {
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

      expect(stderrLines(stderr)).toEqual([
        `error: pnpm-lock.yaml package 'pkg@${id}' is a git sub-directory dependency (resolution.path), which bun does not support`,
        FAILED,
      ]);
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });
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

    // pnpm/pnpm#5928 (`-` removes the dependency) is warned once, with a location, when bun install reads the moved package.json overrides; pnpm/pnpm#6774 (`name@range` keys) migrates as ranged rules
    test("removal values are dropped; name@range keys migrate as ranged rules", async () => {
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

      expect(stderrLines(stderr)).toEqual(["moved pnpm.overrides to overrides in package.json", MIGRATED]);
      expect(exitCode).toBe(0);

      expect(await packageJsonOf(String(dir))).toStrictEqual({
        name: "overrides-unsupported",
        overrides,
      });

      // scoped rules need lockfileVersion 3; the `left-pad: -` removal is not written
      expect(await bunLock(String(dir))).toEqual({
        lockfileVersion: 3,
        configVersion: 1,
        workspaces: { "": { name: "overrides-unsupported" } },
        overrides: {
          "@scope/pkg@^1": { ".": "1.9.0" },
          "@scope/plain": "3.0.0",
          foo: { bar: "2.0.0" },
          plain: "1.0.0",
          "semver@<7.5.2": { ".": "7.5.2" },
        },
        packages: {},
      });

      const install = await run(String(dir), "install");

      expect(normalizeBunSnapshot(install.stderr, String(dir))).toMatchInlineSnapshot(`
        "4 |     "left-pad": "-",
                            ^
        warn: Removing "left-pad" with "-" is not supported
           at <dir>/package.json:4:17
        No packages! Deleted empty lockfile"
      `);
      expect(install.exitCode).toBe(0);
    });

    test("parent selectors become nested rules", async () => {
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

      expect(stderrLines(nested.stderr)).toEqual([MIGRATED]);
      expect(nested.exitCode).toBe(0);

      expect(await bunLock(String(dir))).toEqual({
        lockfileVersion: 3,
        configVersion: 1,
        workspaces: { "": { name: "overrides-nested" } },
        overrides: {
          "@s/a": { "@t/b": "3.0.0" },
          foo: { bar: "2.0.0" },
          "foo@^1": { baz: "1.0.0" },
        },
        packages: {},
      });

      const deep = await migrate(String(tooDeep));

      expect(stderrLines(deep.stderr)).toEqual(["moved pnpm.overrides to overrides in package.json", MIGRATED]);
      expect(deep.exitCode).toBe(0);
      // `a>b>c` is two levels deep: dropped from bun.lock, reported by bun install from package.json
      expect(await bunLock(String(tooDeep))).toEqual({
        lockfileVersion: 2,
        configVersion: 1,
        workspaces: { "": { name: "overrides-too-deep" } },
        packages: {},
      });

      const install = await run(String(tooDeep), "install");

      expect(normalizeBunSnapshot(install.stderr, String(tooDeep))).toMatchInlineSnapshot(`
        "4 |     "a>b>c": "1.0.0"
                ^
        warn: Bun currently only supports one level of nested "overrides"
           at <dir>/package.json:4:5
        No packages! Deleted empty lockfile"
      `);
      expect(install.exitCode).toBe(0);
    });

    test("an unparsable value names the override", async () => {
      using dir = tempDir("pnpm-v9-overrides-invalid", {
        "package.json": JSON.stringify({ name: "overrides-invalid" }),
        "pnpm-lock.yaml": overridesLockfile("  foo: ftp://example.com/foo.tgz"),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([
        'error: invalid or unsupported dependency "ftp://example.com/foo.tgz"',
        "error: pnpm-lock.yaml override 'foo' has an invalid value 'ftp://example.com/foo.tgz'",
        FAILED,
      ]);
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });

    test.each([
      ["mapping", "  foo:\n    a: 1"],
      ["number", "  foo: 1"],
    ])("a %s value names the override", async (_, overrides) => {
      using dir = tempDir("pnpm-v9-overrides-non-string", {
        "package.json": JSON.stringify({ name: "overrides-non-string" }),
        "pnpm-lock.yaml": overridesLockfile(overrides),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual(["error: pnpm-lock.yaml override 'foo' must be a string", FAILED]);
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });

    // #39785: quoted, block, and escaped scalars from pnpm-workspace.yaml were
    // backed by a parse arena that dropped before package.json was printed.
    // MIMALLOC_PURGE_DELAY=0 makes the freed pages unreadable right away, so
    // the use-after-free is deterministic even in a tiny repo.
    test("pnpm-workspace.yaml overrides, catalogs, and patches migrate verbatim", async () => {
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

      expect(stderrLines(stderr)).toEqual([
        "moved pnpm-workspace.yaml to workspaces, pnpm-workspace.yaml overrides to overrides, pnpm-workspace.yaml patchedDependencies to patchedDependencies in package.json",
        MIGRATED,
      ]);
      expect(await packageJsonOf(String(dir))).toStrictEqual({
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

      // nothing in pnpm-lock.yaml uses them, so none of the moved sections reach bun.lock
      expect(await bunLock(String(dir))).toEqual({
        lockfileVersion: 2,
        configVersion: 1,
        workspaces: { "": { name: "workspace-overrides-uaf" }, "packages/a": { name: "a" } },
        packages: { a: ["a@workspace:packages/a"] },
      });
    });
  });

  test("link: version with a semver specifier resolves to the workspace (pnpm/pnpm#7712)", async () => {
    // save-workspace-protocol=false / link-workspace-packages shape
    using dir = fixture("v9-link-semver-specifier");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderrLines(stderr)).toEqual([MIGRATED]);
    expect(exitCode).toBe(0);

    const lock = await bunLock(String(dir));
    expect(lock.workspaces).toEqual({
      "": { name: "v9-link-semver-specifier" },
      "apps/web": { name: "web", dependencies: { common: "^1.0.0" } },
      "shared/common": { name: "common" },
    });
    expect(lock.packages).toEqual({
      common: ["common@workspace:shared/common"],
      web: ["web@workspace:apps/web"],
    });

    const install = await run(String(dir), "install", "--frozen-lockfile", "--linker", "hoisted");

    expect(stderrLines(install.stderr)).toEqual([]);
    expect(installOutput(install.stdout)).toMatchInlineSnapshot(`"2 packages installed"`);
    expect(install.exitCode).toBe(0);
    expect(await installedPackageJson(String(dir), "apps/web", "common")).toStrictEqual({
      name: "common",
      version: "1.2.0",
    });
  });

  test("prettier-style multi-line resolution mappings migrate identically", async () => {
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

    expect(stderrLines(formattedResult.stderr)).toEqual([MIGRATED]);
    expect(formattedResult.exitCode).toBe(0);
    expect(stderrLines(plainResult.stderr)).toEqual([MIGRATED]);
    expect(plainResult.exitCode).toBe(0);
    expect((await bunLock(String(plain))).packages).toHaveProperty("priv");
    expect(await bunLockText(String(formatted))).toBe(await bunLockText(String(plain)));
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

    const { stdout, stderr, exitCode } = await run(packageDir, "add", "no-deps@1.0.0");

    expect(stderrLines(stderr)).toEqual([
      "moved pnpm-workspace.yaml to workspaces, pnpm-workspace.yaml overrides to overrides in package.json",
      MIGRATED,
      "Saved lockfile",
    ]);
    expect(installOutput(stdout)).toMatchInlineSnapshot(`
      "installed no-deps@1.0.0

      2 packages installed"
    `);
    expect(await packageJsonOf(packageDir)).toStrictEqual({
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

    const lock = await bunLock(packageDir);
    expect(lock.workspaces).toEqual({
      "": { name: "add-after-migration", dependencies: { "no-deps": "1.0.0" } },
      "packages/a": { name: "a" },
    });
    expect(lock.overrides).toEqual({ "pkg-x": "1.2.3" });
    expect(lock.catalog).toEqual({ "pkg-y": "2.0.0" });
    expect(lock.packages).toEqual({ a: ["a@workspace:packages/a"], "no-deps": npm("no-deps@1.0.0") });
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
    resolution: {integrity: ${INTEGRITY["no-deps@1.0.0"]}}

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

    const moved = "moved pnpm-workspace.yaml to workspaces in package.json";
    expect(stderrLines(stderr)).toEqual([moved, MIGRATED, moved, MIGRATED, "Saved lockfile"]);
    expect(stdout).toContain("^ no-deps 1.0.0 -> 1.1.0 (v2.0.0 available)");
    expect(stdout).toContain("2 packages installed");
    expect(await packageJsonOf(packageDir)).toStrictEqual({
      name: "update-i-after-migration",
      dependencies: { "no-deps": "^1.1.0" },
      workspaces: ["packages/*"],
    });
    expect(exitCode).toBe(0);

    const lock = await bunLock(packageDir);
    expect(lock.workspaces).toEqual({
      "": { name: "update-i-after-migration", dependencies: { "no-deps": "^1.1.0" } },
      "packages/a": { name: "a" },
    });
    expect(lock.packages).toEqual({ a: ["a@workspace:packages/a"], "no-deps": npm("no-deps@1.1.0") });
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

      expect(stderrLines(stderr)).toEqual([MIGRATED]);
      expect(exitCode).toBe(0);

      const lock = await bunLock(packageDir);
      expect(lock.workspaces).toEqual({ "": { name: "v9-catalog-default", dependencies: { "no-deps": "^1.0.0" } } });
      expect(lock.catalog).toEqual({ "no-deps": "^1.0.0" });
      expect(lock.packages).toEqual({ "no-deps": npm("no-deps@1.0.1") });
    });

    // pnpm/pnpm#10456: `pnpm remove` can drop the catalogs: section while importers still say catalog:
    test("importer catalog: reference without a catalogs: section is reported", async () => {
      using dir = fixture("v9-catalog-default");

      const lockfilePath = join(String(dir), "pnpm-lock.yaml");
      const original = await Bun.file(lockfilePath).text();
      const catalogsBlock = original.slice(original.indexOf("catalogs:"), original.indexOf("importers:"));
      expect(catalogsBlock).toContain("no-deps");
      await Bun.write(lockfilePath, original.replace(catalogsBlock, ""));

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderrLines(stderr)).toEqual([
        "error: pnpm-lock.yaml catalog 'default' missing entry for dependency 'no-deps'",
        FAILED,
      ]);
      expect(exitCode).toBe(1);
      expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
    });
  });
});
