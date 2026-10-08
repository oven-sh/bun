import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunExe, bunEnv as env, isLinux, isWindows, nodeModulesPackages, tempDir, VerdaccioRegistry } from "harness.js";
import { join } from "path";

let verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

test("basic", async () => {
  const { packageDir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: join(import.meta.dir, "pnpm/basic"),
  });

  let proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(err).toContain("Saved lockfile");

  expect(nodeModulesPackages(packageDir)).toMatchInlineSnapshot(`
    "node_modules/a-dep-b/a-dep-b@1.0.0
    node_modules/a-dep/a-dep@1.0.1
    node_modules/b-dep-a/b-dep-a@1.0.0
    node_modules/no-deps/no-deps@1.0.1"
  `);

  expect(
    (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"),
  ).toMatchSnapshot("bun.lock");

  proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(err).not.toContain("Saved lockfile");
});

test("version is number with dot", async () => {
  const { packageDir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: join(import.meta.dir, "pnpm/version-number-dot"),
  });

  let proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(err).toContain(
    "warn: pnpm-lock.yaml is lockfileVersion 5.4, which bun cannot migrate; resolving from package.json instead\nnote: pnpm install --lockfile-only\n",
  );
  expect(err).not.toContain("Ignoring lockfile");
  expect(err).not.toContain("failed to migrate lockfile");
  expect(exitCode).toBe(0);
});

describe.todo("bin", () => {
  test("manifests are fetched for bins", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/bin-manifest-fetching"),
    });
  });
});

describe.todo("peers", () => {
  test("peers basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/peers-basic"),
    });
  });
  test("workspaces with peers", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/peers-workspaces"),
    });
  });
});

describe.todo("patched packages", () => {
  test("patches are detected and migrated correctly", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/patched-packages"),
    });
  });
});

describe("folder dependencies", () => {
  test.todo("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/folder-dependencies-basic"),
    });
  });
  test("links to the root package are resolved correctly", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/root-package-link-resolution"),
    });

    let proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(err).toContain("Saved lockfile");

    expect(
      await Promise.all([
        file(join(packageDir, "node_modules", "two-range-deps", "package.json")).json(),
        file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "dependencies": {
            "@types/is-number": ">=1.0.0",
            "no-deps": "^1.0.0",
          },
          "name": "two-range-deps",
          "version": "1.0.0",
        },
        {
          "dependencies": {
            "two-range-deps": "1.0.0",
          },
          "name": "transitive-root-link-pkg",
        },
      ]
    `);
  });
});

// The migration joins each `link:` and `file:` path onto the project directory in a path buffer of
// MAX_PATH_BYTES: 4096 bytes on Linux, 1024 on macOS, 32767 * 3 + 1 on Windows.
describe.concurrent("link: and file: paths longer than the path buffer", () => {
  const POSIX_PATH_BUFFER_BYTES = isLinux ? 4096 : 1024;
  // Longer than the buffer on every platform.
  const longPath = Buffer.alloc(100_000, "a").toString();

  const dependency = (name: string, specifier: string, version: string) => `
    dependencies:
      ${name}:
        specifier: ${specifier}
        version: ${version}`;

  type Project = {
    rootDependencies?: Record<string, string>;
    aDependencies?: Record<string, string>;
    rootImporter?: string;
    aImporter?: string;
    packages?: string;
  };

  // Runs `bun pm migrate` in a root with the workspaces packages/a and packages/b and the folder vendor/c.
  async function migrate(project: Project | ((dir: string) => Project)) {
    using dir = tempDir("pnpm-migrate-long-path", {});
    const { rootDependencies, aDependencies, rootImporter, aImporter, packages } =
      typeof project === "function" ? project(String(dir)) : project;
    const files = {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: rootDependencies }),
      "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", dependencies: aDependencies }),
      "packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
      "vendor/c/package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:${rootImporter ?? " {}"}

  packages/a:${aImporter ?? " {}"}

  packages/b: {}
${packages ?? ""}`,
    };
    await Promise.all(Object.entries(files).map(([path, content]) => write(join(String(dir), path), content)));

    await using proc = spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const bunLock = file(join(String(dir), "bun.lock"));
    return {
      stderr: stderr.replaceAll(longPath, "<long path>"),
      bunLock: (await bunLock.exists()) ? await bunLock.text() : "",
      exitCode,
    };
  }

  const linkTooLong = "error: pnpm-lock.yaml dependency 'b' of importer 'packages/a' has a link path that is too long";

  test.each<Project & { name: string; expected: string }>([
    {
      name: "the link: of a workspace: dependency",
      aDependencies: { b: "workspace:*" },
      aImporter: dependency("b", "workspace:*", `link:${longPath}`),
      expected: "warn: Workspace link dependencies to non-existent folders aren't supported yet",
    },
    {
      name: "the link: of a file: dependency",
      aDependencies: { b: "file:../b" },
      aImporter: dependency("b", "file:../b", `link:${longPath}`),
      expected: linkTooLong,
    },
    {
      name: "the link: of a range dependency of a workspace",
      aDependencies: { b: "^1.0.0" },
      aImporter: dependency("b", "^1.0.0", `link:${longPath}`),
      expected:
        "error: pnpm-lock.yaml has no package entry 'b@link:<long path>' for dependency 'b' of importer 'packages/a'",
    },
    {
      name: "the link: of a range dependency of the root",
      rootDependencies: { b: "^1.0.0" },
      rootImporter: dependency("b", "^1.0.0", `link:${longPath}`),
      expected: "error: pnpm-lock.yaml has no package entry 'b@link:<long path>' for dependency 'b' of importer '.'",
    },
    {
      name: "the link: of a dependency of a package",
      rootDependencies: { c: "file:vendor/c" },
      rootImporter: dependency("c", "file:vendor/c", "file:vendor/c"),
      packages: `
packages:

  c@file:vendor/c:
    resolution: {directory: vendor/c, type: directory}

snapshots:

  c@file:vendor/c:
    dependencies:
      b: link:${longPath}
`,
      expected: "error: pnpm-lock.yaml has no package entry 'b@link:<long path>' for dependency 'b' of package 'c'",
    },
    {
      name: "the directory of a file: package",
      rootDependencies: { c: "file:vendor/c" },
      rootImporter: dependency("c", "file:vendor/c", `file:${longPath}`),
      packages: `
packages:

  c@file:${longPath}:
    resolution: {directory: ${longPath}, type: directory}

snapshots:

  c@file:${longPath}: {}
`,
      expected: "error: pnpm-lock.yaml package 'c' has a directory path that is too long",
    },
  ])("$name fails the migration", async project => {
    const { stderr, exitCode } = await migrate(project);

    expect(stderr).toContain(project.expected);
    expect(stderr).toContain("error: failed to migrate lockfile: InvalidLockfile");
    expect(exitCode).toBe(1);
  });

  // A relative path of exactly `bytes` bytes made of one letter directory names.
  function pathOfLength(bytes: number) {
    const tail = bytes % 2 === 0 ? "dd" : "d";
    return Buffer.alloc(bytes - tail.length, "d/").toString() + tail;
  }

  // The link resolves to `${dir}/packages/a/${link}`. A path of the buffer size leaves no room
  // for the NUL that ends it, so that is the first length that does not fit.
  test.skipIf(isWindows).each([
    ["one byte below", -1, "migrated lockfile from pnpm-lock.yaml", 0],
    ["exactly", 0, linkTooLong, 1],
    ["one byte above", 1, linkTooLong, 1],
  ])("link: that resolves to a path %s the path buffer size", async (_, offset, message, code) => {
    const { stderr, exitCode } = await migrate(dir => {
      const prefixBytes = Buffer.byteLength(dir) + "/packages/a/".length;
      const link = pathOfLength(POSIX_PATH_BUFFER_BYTES + offset - prefixBytes);
      return { aDependencies: { b: "file:../b" }, aImporter: dependency("b", "file:../b", `link:${link}`) };
    });

    expect(stderr).toContain(message);
    expect(exitCode).toBe(code);
  });

  // What has to fit the buffer is the resolved path, not the link as written. The unchecked join did the same.
  test("link: that only fits the path buffer once resolved still names its workspace", async () => {
    const linkToB = "../b" + Buffer.alloc(100_000, "/../b").toString();
    const { stderr, bunLock, exitCode } = await migrate({
      aDependencies: { b: "workspace:*" },
      aImporter: dependency("b", "workspace:*", `link:${linkToB}`),
    });

    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(bunLock).toContain(`"b": ["b@workspace:packages/b"],`);
    expect(exitCode).toBe(0);
  });
});

describe.todo("overrides", () => {
  test("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/overrides-basic"),
    });
  });
  test("accross workspaces", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/overrides-workspaces"),
    });
  });
});

test.todo("from npm", async () => {
  using testDir = tempDir("pnpm-migration-from-npm-registry", join(import.meta.dir, "pnpm/from-npm"));
});

describe.todo("workspaces", async () => {
  test("basic", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/workspaces-basic"),
    });
  });
  test("workspace dependencies", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/workspaces-dependencies"),
    });
  });
  test("catalogs, peers, and workspaces", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: join(import.meta.dir, "pnpm/workspaces-catalogs-peers"),
    });
  });
});
