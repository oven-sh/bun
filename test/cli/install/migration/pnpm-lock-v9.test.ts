import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { bunEnv, bunExe, nodeModulesPackages, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

const verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

async function migrate(cwd: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "migrate"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return { stdout, stderr, exitCode };
}

function fixture(name: string) {
  return tempDir(`pnpm-${name}`, join(import.meta.dir, "pnpm", name));
}

async function bunLockOf(dir: string) {
  return await Bun.file(join(dir, "bun.lock")).text();
}

const PKG_A_GIT = "pkg-a@git+ssh://git@example.com/org/pkg-a.git#0123456789abcdef0123456789abcdef01234567";
const NO_DEPS_1_0_1_INTEGRITY =
  "sha512-3X6cn4+UJdXJuLPu11v8i/fGLe2PdI6v1yKTELam04lY5esCAFdG/qQts6N6rLrL6g1YRq+MKBAwxbmUQk355A==";

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

describe("pnpm-lock.yaml v9", () => {
  // Cases using toMatchSnapshot are sequential: snapshot matchers are unsupported inside a concurrent group.
  test("v9 git and userinfo-tarball references migrate", async () => {
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

    await using install = Bun.spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [installStdout, installStderr, installExitCode] = await Promise.all([
      install.stdout.text(),
      install.stderr.text(),
      install.exited,
    ]);

    expect(installStderr).not.toContain("error:");
    expect(installStdout).toContain("packages installed");
    expect(installExitCode).toBe(0);

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
    expect(stderr).toContain("Error loading lockfile");
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
    expect(stderr).toContain("Error loading lockfile");
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "bun.lock"))).toBe(false);
  });

  test("registry-qualified dep path resolves from the configured registry with a warning", async () => {
    // shape from pnpm11/deps/path/test/index.ts parse() `foo@work:1.0.0`
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "registry-qualified", dependencies: { "no-deps": "^1.0.0" } }),
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      no-deps:
        specifier: ^1.0.0
        version: work:1.0.1

packages:

  no-deps@work:1.0.1:
    resolution: {integrity: sha512-3X6cn4+UJdXJuLPu11v8i/fGLe2PdI6v1yKTELam04lY5esCAFdG/qQts6N6rLrL6g1YRq+MKBAwxbmUQk355A==}

snapshots:

  no-deps@work:1.0.1: {}
`,
      },
    });

    const { stderr, exitCode } = await migrate(packageDir);

    expect(stderr).toContain(
      "pnpm-lock.yaml package 'no-deps@work:1.0.1' is from pnpm registry 'work', resolving it from the configured registry instead",
    );
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(packageDir);
    expect(bunLock).toContain(`"no-deps@1.0.1"`);
    expect(bunLock).not.toContain("work:");
    expect(bunLock).not.toContain("git+ssh");
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

    expect(stderr).toContain("lockfileVersion 10 is newer than the supported 9.0");
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

    expect(stderr).toContain("pnpm-lock.yaml runtime dependency 'node@runtime:22.0.0' is not migrated");
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
      expect(packageJson.patchedDependencies).toEqual({ "is-positive@3.1.0": "patches/is-positive@3.1.0.patch" });
    });

    test.concurrent("bare hash whose patch is not in the config is skipped with a warning", async () => {
      using dir = fixture("v9-patched-git-hosted-bare");
      rmSync(join(String(dir), "pnpm-workspace.yaml"));

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("pnpm-lock.yaml patch for 'is-positive@3.1.0' is not in patchedDependencies");
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
      expect(packageJson.patchedDependencies).toEqual({ "no-deps@1.0.1": "patches/no-deps.patch" });
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

  test("snapshot alias whose dep-path version is a file: directory or tarball", async () => {
    using dir = fixture("v9-alias-non-registry-dep-path");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(`"config": "file:shared/config"`);
    expect(bunLock).toContain(
      `"fork": "https://codeload.github.com/o/bar/tar.gz/aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b"`,
    );
    expect(bunLock).toContain(`"hi2@file:shared/config"`);
    expect(bunLock).toContain(`"bar@github:o/bar#aeb6b15f9c9957c8fa56f9731e914c4d8a6d2f2b"`);
    expect(bunLock).not.toContain("npm:");

    expect(bunLock).toMatchSnapshot("bun.lock");
  });

  test.concurrent("local file: tarballs with tarball+integrity and integrity-only .tar.gz resolutions", async () => {
    // tar-pkg entry ported from pnpm11/installing/deps-restorer/test/fixtures/has-local-dep/pkg/pnpm-lock.yaml
    using dir = fixture("v9-local-tarballs");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(
      `["tar-pkg@../tar-pkg-1.0.0.tgz", {}, "sha512-HP/5Rgt3pVFLzjmN9qJJ6vZMgCwoCIl/m2bPndYT283CUqnmFiMx0GeeIJ7SyK6TYoJM78SEvFEOQie++caHqw=="]`,
    );
    expect(bunLock).toContain(`["tar-gz-pkg@../tar-gz-pkg-1.0.0.tar.gz", {}, "sha512-`);
    expect(bunLock).not.toContain("tar-gz-pkg@file:");
  });

  test.concurrent("file: directory with type: directory and a nested file: dependency", async () => {
    // ported from pnpm11/deps/compliance/commands/test/licenses/fixtures/with-file-protocol
    using dir = fixture("v9-file-directory");

    const { stderr, exitCode } = await migrate(String(dir));

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    const bunLock = await bunLockOf(String(dir));
    expect(bunLock).toContain(`"sub-dep": "file:./sub-dep"`);
    expect(bunLock).toContain(`["sub-dep@file:sub-dep", { "dependencies": { "nested-child": "file:sub-dep/child" } }]`);
    expect(bunLock).toContain(`["nested-child@file:sub-dep/child", {}]`);
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

      await using install = Bun.spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile", "--linker", "hoisted"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [installStderr, installExitCode] = await Promise.all([install.stderr.text(), install.exited]);
      expect(installStderr).not.toContain("error:");
      expect(installExitCode).toBe(0);
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

    // pnpm/pnpm#5920 / #4361: a stale or injected off-registry tarball is rebuilt from the configured registry
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

  describe("overrides", () => {
    function overridesLockfile(overrides: string) {
      return `lockfileVersion: '9.0'

overrides:
${overrides}

importers:

  .: {}
`;
    }

    // pnpm/pnpm#5928 (`-` removes the dependency) and pnpm/pnpm#6774 (`name@range` / `parent>child` keys)
    test.concurrent("unsupported removal and selector keys warn but migrate", async () => {
      using dir = tempDir("pnpm-v9-overrides-unsupported", {
        "package.json": JSON.stringify({ name: "overrides-unsupported" }),
        "pnpm-lock.yaml": overridesLockfile(`  left-pad: '-'
  semver@<7.5.2: 7.5.2
  foo>bar: 2.0.0
  '@scope/pkg@^1': 1.9.0
  '@scope/plain': 3.0.0
  plain: 1.0.0`),
      });

      const { stderr, exitCode } = await migrate(String(dir));

      expect(stderr).toContain("pnpm-lock.yaml override 'left-pad' removes the dependency ('-')");
      expect(stderr).toContain(
        "pnpm-lock.yaml override 'semver@<7.5.2' is scoped to a version range or parent package",
      );
      expect(stderr).toContain("pnpm-lock.yaml override 'foo>bar' is scoped to a version range or parent package");
      expect(stderr).toContain(
        "pnpm-lock.yaml override '@scope/pkg@^1' is scoped to a version range or parent package",
      );
      expect(stderr).not.toContain("override '@scope/plain'");
      expect(stderr).not.toContain("override 'plain'");
      expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
      expect(exitCode).toBe(0);

      const bunLock = await bunLockOf(String(dir));
      expect(bunLock).toContain(`"plain": "1.0.0"`);
      expect(bunLock).toContain(`"@scope/plain": "3.0.0"`);
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

    await using install = Bun.spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile", "--linker", "hoisted"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [installStderr, installExitCode] = await Promise.all([install.stderr.text(), install.exited]);
    expect(installStderr).not.toContain("error:");
    expect(installExitCode).toBe(0);
  });

  test.concurrent("prettier-style multi-line resolution mappings migrate identically (pnpm/pnpm#4084)", async () => {
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
    expect(plainResult.exitCode).toBe(0);
    expect(await bunLockOf(String(formatted))).toBe(await bunLockOf(String(plain)));
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
  });
});
