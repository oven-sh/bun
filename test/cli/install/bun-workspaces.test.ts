import { file, spawn, write } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { cp, exists, mkdir, rm } from "fs/promises";
import {
  assertManifestsPopulated,
  bunEnv as baseEnv,
  bunExe,
  githubTarball,
  isLinux,
  isWindows,
  readdirSorted,
  runBunInstall,
  runBunUpdate,
  tempDir,
  toMatchNodeModulesAt,
} from "harness";
import { dirname, join, resolve } from "path";
import { TestRegistry } from "registry";

const { parseLockfile } = install_test_helpers;

expect.extend({ toMatchNodeModulesAt });

var verdaccio: TestRegistry;

setDefaultTimeout(1000 * 60 * 5);

beforeAll(async () => {
  verdaccio = new TestRegistry();
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

// Each test spawns 1-5 `bun install` child processes. Running every test at once would
// oversubscribe CI (especially the ASAN lanes), so gate concurrency with a small
// semaphore and give each test its own isolated dir + env.
const MAX_CONCURRENT = 12;
let activeSlots = 0;
const slotWaiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeSlots < MAX_CONCURRENT) {
    activeSlots++;
    return Promise.resolve();
  }
  return new Promise(resolve => slotWaiters.push(resolve));
}

function releaseSlot(): void {
  const next = slotWaiters.shift();
  if (next) {
    next();
  } else {
    activeSlots--;
  }
}

type TestCtx = {
  packageDir: string;
  packageJson: string;
  env: Record<string, string>;
  [Symbol.dispose](): void;
};

async function setupTest(): Promise<TestCtx> {
  await acquireSlot();
  let released = false;
  try {
    const { packageDir, packageJson } = await verdaccio.createTestDir();
    const env: Record<string, string> = {
      ...baseEnv,
      BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
      BUN_TMPDIR: join(packageDir, ".bun-tmp"),
      TMPDIR: join(packageDir, ".bun-tmp"),
      TEMP: join(packageDir, ".bun-tmp"),
    };
    return {
      packageDir,
      packageJson,
      env,
      [Symbol.dispose]() {
        if (!released) {
          released = true;
          releaseSlot();
        }
      },
    };
  } catch (e) {
    releaseSlot();
    released = true;
    throw e;
  }
}

// This test and the other `toMatchSnapshot` tests stay serial: snapshots are not
// supported inside concurrent tests.
test("dependency on workspace without version in package.json", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
      }),
    ),

    write(
      join(packageDir, "packages", "mono", "package.json"),
      JSON.stringify({
        name: "no-deps",
      }),
    ),
  ]);

  mkdirSync(join(packageDir, "packages", "bar"), { recursive: true });

  const shouldWork: string[] = [
    "*",
    "*.*.*",
    "=*",
    "kjwoehcojrgjoj", // dist-tag does not exist, should choose local workspace
    "*.1.*",
    "*-pre",
  ];
  const shouldNotWork: string[] = [
    "1",
    "1.*",
    "1.1.*",
    "1.1.0",
    "*-pre+build",
    "*+build",
    "latest", // dist-tag exists, should choose package from npm
    "",
  ];

  for (const version of shouldWork) {
    writeFileSync(
      join(packageDir, "packages", "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        version: "1.0.0",
        dependencies: {
          "no-deps": version,
        },
      }),
    );

    const { out } = await runBunInstall(env, packageDir);
    const lockfile = parseLockfile(packageDir);
    expect(lockfile).toMatchNodeModulesAt(packageDir);
    expect(
      JSON.stringify(lockfile, null, 2).replaceAll(/http:\/\/localhost:\d+/g, "http://localhost:1234"),
    ).toMatchSnapshot(`version: ${version}`);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      "2 packages installed",
    ]);
    rmSync(join(packageDir, "node_modules"), { recursive: true, force: true });
    rmSync(join(packageDir, "bun.lock"), { recursive: true, force: true });
  }

  // downloads the package from the registry instead of
  // using the workspace locally
  for (const version of shouldNotWork) {
    writeFileSync(
      join(packageDir, "packages", "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        version: "1.0.0",
        dependencies: {
          "no-deps": version,
        },
      }),
    );

    const { out } = await runBunInstall(env, packageDir);
    const lockfile = parseLockfile(packageDir);
    expect(lockfile).toMatchNodeModulesAt(packageDir);
    expect(
      JSON.stringify(lockfile, null, 2).replaceAll(/http:\/\/localhost:\d+/g, "http://localhost:1234"),
    ).toMatchSnapshot(`version: ${version}`);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      "3 packages installed",
    ]);
    rmSync(join(packageDir, "node_modules"), { recursive: true, force: true });
    rmSync(join(packageDir, "packages", "bar", "node_modules"), { recursive: true, force: true });
    rmSync(join(packageDir, "bun.lock"), { recursive: true, force: true });
  }
});

// pkg2 depends on a package that does not exist, so the install fails if the negated entry does
// not exclude it. examples/pkg2 has the same basename: a negated entry must never add it.
// Like npm, a negated entry applies wherever it is in the array.
test.concurrent.each(
  [
    ["packages/*", "!packages/pkg2"],
    ["./packages/*", "!./packages/pkg2"],
    ["packages/*", "!./packages/pkg2"],
    ["packages/*", "!packages/pkg2/"],
    ["packages/*", "!././packages/pkg2//"],
    ["!packages/pkg2", "packages/*"],
    ["packages/*", "!packages/pkg2", "packages/pkg*"],
    // Like npm, `dir/**` also removes `dir` itself.
    ["packages/*", "!packages/pkg2/**"],
    ["packages/**", "!**/pkg2/**"],
    ...(isWindows ? [["packages/*", "!.\\packages\\pkg2\\"]] : []),
  ].map(workspaces => [workspaces]),
)("allowing negative workspace patterns: %j", async workspaces => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces,
      }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        dependencies: {
          "doesnt-exist-oops": "1.2.3",
        },
      }),
    ),
    write(
      join(packageDir, "examples", "pkg2", "package.json"),
      JSON.stringify({
        name: "example-pkg2",
        dependencies: {
          "doesnt-exist-oops": "1.2.3",
        },
      }),
    ),
  ]);

  const { exited } = await runBunInstall(env, packageDir);
  expect(await exited).toBe(0);

  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });
  expect(Object.values(parseLockfile(packageDir).workspace_paths)).toEqual(["packages/pkg1"]);
});

test.concurrent("a negative workspace pattern adds no members", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["packages/**", "!packages/**/test/**"],
      }),
    ),
    write(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify({ name: "pkg1" })),
    write(join(packageDir, "packages", "pkg1", "test", "package.json"), JSON.stringify({ name: "pkg1-test" })),
    write(
      join(packageDir, "packages", "pkg1", "test", "fixture", "package.json"),
      JSON.stringify({ name: "pkg1-fixture" }),
    ),
    // Outside `packages/**`. `!packages` is not a glob for "any directory but packages".
    write(join(packageDir, "examples", "test", "fixture", "package.json"), JSON.stringify({ name: "example-fixture" })),
  ]);

  await runBunInstall(env, packageDir);

  expect(Object.values(parseLockfile(packageDir).workspace_paths)).toEqual(["packages/pkg1"]);
  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["pkg1"]);
});

test.concurrent("a negative workspace pattern does not remove a member listed by its path", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/pkg1", "!packages/*"] }),
    ),
    write(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify({ name: "pkg1" })),
  ]);

  await runBunInstall(env, packageDir);

  expect(Object.values(parseLockfile(packageDir).workspace_paths)).toEqual(["packages/pkg1"]);
});

// A `/package.json` is only possible with a private root directory: a chroot in a private user and mount namespace.
// Skipped where those are disabled, like in most containers.
const canChangeRoot =
  isLinux &&
  Bun.which("unshare") !== null &&
  Bun.spawnSync({ cmd: ["unshare", "-Urm", "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

describe.skipIf(!canChangeRoot)("package.json in the filesystem root", () => {
  const changeRoot = `set -e
for dir in /usr /bin /lib /lib64 "$BUN_DIR"; do
  [ -d "$dir" ] || continue
  mkdir -p "$NEW_ROOT$dir"
  mount -o rbind "$dir" "$NEW_ROOT$dir"
  mount -o remount,bind,ro "$NEW_ROOT$dir"
done
mount -o rbind /proc "$NEW_ROOT/proc"
exec chroot "$NEW_ROOT" /bin/sh -c 'cd "$0" && exec "$@"' "$@"`;

  // Members listed by path: a glob is walked from an open directory and never needed the root's path.
  test.concurrent.each([
    { title: "from /", cwd: "/", root: {} },
    { title: "from a member", cwd: "/members/a", root: {} },
    { title: "from below a member", cwd: "/members/a/src", root: {} },
    {
      title: "an override that refers to a dependency of the root",
      cwd: "/",
      root: { dependencies: { b: "workspace:*" }, overrides: { x: "$b" } },
    },
  ])("$title", async ({ cwd, root }) => {
    using dir = tempDir("fs-root", {
      "package.json": JSON.stringify({ name: "fs-root", workspaces: ["members/a", "members/b"], ...root }),
      "members/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", dependencies: { b: "workspace:*" } }),
      "members/a/src/index.js": "",
      "members/b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
      "home/.keep": "",
      "proc/.keep": "",
      "tmp/.keep": "",
    });
    const bun = realpathSync(bunExe());
    await using proc = spawn({
      cmd: ["unshare", "-Urm", "/bin/sh", "-c", changeRoot, "sh", cwd, bun, "install"],
      env: {
        ...baseEnv,
        NEW_ROOT: String(dir),
        BUN_DIR: dirname(bun),
        HOME: "/home",
        TMPDIR: "/tmp",
        BUN_INSTALL_CACHE_DIR: "/tmp/cache",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Saved lockfile");
    expect(Object.values(parseLockfile(String(dir)).workspace_paths).sort()).toEqual(["members/a", "members/b"]);
    expect({
      "/members/a/bun.lock": await exists(join(String(dir), "members", "a", "bun.lock")),
      "/members/a/node_modules/b": await file(
        join(String(dir), "members", "a", "node_modules", "b", "package.json"),
      ).json(),
    }).toEqual({ "/members/a/bun.lock": false, "/members/a/node_modules/b": { name: "b", version: "1.0.0" } });
    expect(exitCode).toBe(0);
  });
});

// pnpm and npm accept workspace members whose package.json has no "name" (vite's
// pnpm-workspace.yaml matches dozens of test fixtures shaped like `{"type":"module"}`).
describe("workspace member package.json without a name", () => {
  const skippedWarning = 'warn: skipping workspace "packages/fixture": package.json has no "name"\n';

  async function setupMonorepo(packageDir: string, workspaces: string[], fixturePackageJson: object) {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "root",
          workspaces,
          dependencies: {
            pkg1: "workspace:*",
          },
        }),
      ),
      write(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.0.0" })),
      write(join(packageDir, "packages", "fixture", "package.json"), JSON.stringify(fixturePackageJson)),
    ]);
  }

  async function expectFixtureSkipped(packageDir: string) {
    expect(await file(join(packageDir, "node_modules", "pkg1", "package.json")).json()).toEqual({
      name: "pkg1",
      version: "1.0.0",
    });
    expect(await exists(join(packageDir, "node_modules", "fixture"))).toBeFalse();
    const lockfile = await file(join(packageDir, "bun.lock")).text();
    expect(lockfile).toContain('"packages/pkg1"');
    expect(lockfile).not.toContain("packages/fixture");
  }

  const patterns = {
    glob: ["packages/*"],
    listed: ["packages/pkg1", "packages/fixture"],
    // The fixture matches three times; it must still be warned about once.
    overlapping: ["packages/fixture", "packages/*", "packages/**"],
  };

  for (const [kind, workspaces] of Object.entries(patterns)) {
    test.concurrent(`is skipped (${kind})`, async () => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      await setupMonorepo(packageDir, workspaces, { type: "module" });

      // runBunInstall asserts nothing was warned about.
      await runBunInstall(env, packageDir);
      await expectFixtureSkipped(packageDir);
    });

    test.concurrent(`is skipped with a warning when it declares dependencies (${kind})`, async () => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      // Resolving this dependency would fail the install, so a successful install
      // proves the fixture's dependencies were never looked at.
      await setupMonorepo(packageDir, workspaces, { devDependencies: { "doesnt-exist-oops": "1.2.3" } });

      const { err } = await runBunInstall(env, packageDir, { allowWarnings: true });
      expect(err).toContain(skippedWarning);
      expect(err.split(skippedWarning)).toHaveLength(2);
      await expectFixtureSkipped(packageDir);
    });
  }

  test.concurrent("an empty name counts as no name", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await setupMonorepo(packageDir, patterns.glob, { name: "", dependencies: { "doesnt-exist-oops": "1.2.3" } });

    const { err } = await runBunInstall(env, packageDir, { allowWarnings: true });
    expect(err).toContain(skippedWarning);
    await expectFixtureSkipped(packageDir);
  });

  test.concurrent("does not stop a member from finding the workspace root", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await setupMonorepo(packageDir, patterns.glob, { dependencies: { "doesnt-exist-oops": "1.2.3" } });

    const { err } = await runBunInstall(env, join(packageDir, "packages", "pkg1"), { allowWarnings: true });

    expect(await exists(join(packageDir, "packages", "pkg1", "bun.lock"))).toBeFalse();
    // Both the root lookup and the root package.json parse scan the workspaces; only the latter warns.
    expect(err.split(skippedWarning)).toHaveLength(2);
    await expectFixtureSkipped(packageDir);
  });
});

test.concurrent("extglob and brace sequence workspace patterns", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  const good = ["packages/pkg1", "packages/pkg2", "apps/web", "apps/api", "libs/lib1", "libs/lib2"];
  // Installing any of these would fail.
  const excluded = ["packages/internal", "apps/other", "libs/lib3"];
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["packages/!(internal)", "apps/@(web|api)", "libs/lib{1..2}"],
      }),
    ),
    ...good.map(dir => write(join(packageDir, dir, "package.json"), JSON.stringify({ name: dir.split("/")[1] }))),
    ...excluded.map(dir =>
      write(
        join(packageDir, dir, "package.json"),
        JSON.stringify({ name: dir.split("/")[1], dependencies: { "doesnt-exist-oops": "1.2.3" } }),
      ),
    ),
  ]);

  const { exited } = await runBunInstall(env, packageDir);
  expect(await exited).toBe(0);

  const lockfile = Bun.JSONC.parse(await file(join(packageDir, "bun.lock")).text()) as { workspaces: object };
  expect(Object.keys(lockfile.workspaces).sort()).toEqual(["", ...good].sort());
});

test("dependency on same name as workspace and dist-tag", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
      }),
    ),

    write(
      join(packageDir, "packages", "mono", "package.json"),
      JSON.stringify({
        name: "no-deps",
        version: "4.17.21",
      }),
    ),

    write(
      join(packageDir, "packages", "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        version: "1.0.0",
        dependencies: {
          "no-deps": "latest",
        },
      }),
    ),
  ]);

  const { out } = await runBunInstall(env, packageDir);
  const lockfile = parseLockfile(packageDir);
  expect(
    JSON.stringify(lockfile, null, 2).replaceAll(/http:\/\/localhost:\d+/g, "http://localhost:1234"),
  ).toMatchSnapshot("with version");
  expect(lockfile).toMatchNodeModulesAt(packageDir);
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "3 packages installed",
  ]);
});

// https://github.com/oven-sh/bun/issues/4830. A name that the registry does have keeps resolving from the registry: see
// "dependency on same name as workspace and dist-tag".
describe.concurrent("dist-tag on the name of a workspace that the registry does not have", () => {
  function project(app: object, root: object = { workspaces: ["packages/*"] }, bunfig = "", published = false) {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname);
        if (!published) return new Response("not found", { status: 404 });
        const sib = { name: "sib", version: "9.0.0", dist: { tarball: `${server.url}sib-9.0.0.tgz` } };
        return Response.json({ name: "sib", "dist-tags": { latest: "9.0.0" }, versions: { "9.0.0": sib } });
      },
    });
    const dir = tempDir("workspace-dist-tag", {
      "package.json": JSON.stringify({ name: "root", ...root }),
      "bunfig.toml": `[install]\nregistry = "${server.url.href}"\n${bunfig}`,
      "packages/sib/package.json": JSON.stringify({ name: "sib", version: "1.0.0" }),
      "packages/app/package.json": JSON.stringify({ name: "app", version: "1.0.0", ...app }),
    });
    async function bun(...args: string[]) {
      requests.length = 0;
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
        env: { ...baseEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const messages = stderr.replaceAll(server.url.href, "/").split("\n");
      return { errors: messages.filter(line => /^(error|warn):/.test(line)), exitCode, requests: [...requests] };
    }
    const dispose = () => (server.stop(true), dir[Symbol.dispose]());
    return { dir: String(dir), bun, [Symbol.dispose]: dispose };
  }
  const linked = { name: "sib", version: "1.0.0" };

  test.each([
    ["latest", "sib", { dependencies: { sib: "latest" } }, undefined],
    ["an empty version", "sib", { dependencies: { sib: "" } }, undefined],
    ["another tag", "sib", { dependencies: { sib: "beta" } }, undefined],
    ["an alias", "alias", { dependencies: { alias: "npm:sib@latest" } }, undefined],
    [
      "a catalog entry",
      "sib",
      { dependencies: { sib: "catalog:" } },
      { workspaces: { packages: ["packages/*"], catalog: { sib: "latest" } } },
    ],
  ])("%s links the workspace", async (_, folder, app, root) => {
    using repo = project(app, root);
    expect(await repo.bun("install")).toEqual({ errors: [], exitCode: 0, requests: ["/sib"] });
    expect(await file(join(repo.dir, "packages", "app", "node_modules", folder, "package.json")).json()).toEqual(
      linked,
    );
    const lockfile = await file(join(repo.dir, "bun.lock")).text();

    // bun.lock has the link: the registry, which never gets to cache a 404, is not asked again
    const unchanged = { errors: [], exitCode: 0, requests: [] };
    expect(await repo.bun("install")).toEqual(unchanged);
    expect(await repo.bun("install", "--frozen-lockfile")).toEqual(unchanged);
    expect(await repo.bun("install", "--offline")).toEqual(unchanged);
    expect(await file(join(repo.dir, "bun.lock")).text()).toBe(lockfile);
  });

  test("a range of another member that the workspace does not satisfy still gets the 404", async () => {
    using repo = project({ dependencies: { sib: "latest" } });
    await write(
      join(repo.dir, "packages", "other", "package.json"),
      JSON.stringify({ name: "other", dependencies: { sib: "^2.0.0" } }),
    );
    expect(await repo.bun("install")).toEqual({
      errors: ["error: GET /sib - 404", "error: sib@^2.0.0 failed to resolve"],
      exitCode: 1,
      requests: ["/sib"],
    });
  });

  test("linkWorkspacePackages = false gets the 404", async () => {
    using repo = project({ dependencies: { sib: "latest" } }, undefined, "linkWorkspacePackages = false\n");
    expect(await repo.bun("install")).toEqual({
      errors: ["error: GET /sib - 404", "error: sib@latest failed to resolve"],
      exitCode: 1,
      requests: ["/sib"],
    });
  });

  test.each(["", "linkWorkspacePackages = false\n"])(
    "a tag that the registry's package with that name doesn't have, with %j in bunfig.toml",
    async bunfig => {
      using repo = project({ dependencies: { sib: "beta" } }, undefined, bunfig, true);
      expect(await repo.bun("install")).toEqual({ errors: [], exitCode: 0, requests: ["/sib"] });
    },
  );
});

// The command installs and locks the same thing as a clean install of the package.json that it wrote. The installed
// registry package has the same name and version as the new workspace.
test.concurrent.each(["hoisted", "isolated"])(
  "links a new workspace that has the same name and version as an installed package (%s)",
  async linker => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    const app = join(packageDir, "packages", "app");
    const appJson = (range: string) =>
      JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": range } });
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: { cache: join(packageDir, ".bun-cache"), registry: verdaccio.registryUrl(), linker },
        }),
      ),
      write(join(packageDir, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
      write(join(app, "package.json"), appJson("1.0.0")),
    ]);
    await runBunInstall(env, packageDir);

    const workspace = { name: "no-deps", version: "1.0.0", description: "the workspace" };
    await Promise.all([
      write(join(packageDir, "packages", "no-deps", "package.json"), JSON.stringify(workspace)),
      write(join(app, "package.json"), appJson("workspace:*")),
    ]);
    await runBunInstall(env, packageDir);

    const nested = join(app, "node_modules", "no-deps", "package.json");
    const loaded = existsSync(nested) ? nested : join(packageDir, "node_modules", "no-deps", "package.json");
    expect(await file(loaded).json()).toEqual(workspace);
  },
);

describe.each(["hoisted", "isolated"] as const)("a member asks for a workspace that is also published (%s)", linker => {
  const registry = { name: "no-deps", version: "2.0.0" };
  test.concurrent.each([
    { cmd: "add no-deps", version: "2.0.0", written: "workspace:*" },
    // The registry's no-deps may be someone else's package.
    { cmd: "add no-deps", version: "0.0.1", written: "workspace:*" },
    { cmd: "add no-deps", version: "none", written: "workspace:*" },
    { cmd: "add no-deps@latest", version: "2.0.0", written: "^2.0.0" },
    { cmd: "add --exact no-deps@latest", version: "2.0.0", written: "2.0.0" },
    { cmd: "update --latest", version: "2.0.0", declared: "^1.0.0", written: "^2.0.0" },
    { cmd: "update --latest no-deps", version: "2.0.0", declared: "^1.0.0", written: "^2.0.0" },
    // These ranges do not link the member.
    { cmd: "add no-deps@latest", version: "1.0.0", written: "^2.0.0", loads: registry },
    { cmd: "add no-deps@latest", version: "none", written: "^2.0.0", loads: registry },
    { cmd: "add no-deps", version: "2.0.0", written: "^2.0.0", loads: registry, linkWorkspacePackages: false },
  ])(
    "bun $cmd writes $written, version of the workspace: $version",
    async ({ cmd, version, declared, written, loads, linkWorkspacePackages }) => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      const app = join(packageDir, "packages", "app");
      const workspace = { name: "no-deps", description: "the workspace", ...(version !== "none" && { version }) };
      await Promise.all([
        write(
          join(packageDir, "bunfig.toml"),
          Bun.TOML.stringify({
            install: {
              cache: join(packageDir, ".bun-cache"),
              registry: verdaccio.registryUrl(),
              linker,
              ...(linkWorkspacePackages === false && { linkWorkspacePackages }),
            },
          }),
        ),
        write(join(packageDir, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
        write(join(packageDir, "packages", "no-deps", "package.json"), JSON.stringify(workspace)),
        write(
          join(app, "package.json"),
          JSON.stringify({ name: "app", version: "1.0.0", dependencies: declared && { "no-deps": declared } }),
        ),
      ]);
      async function state() {
        const nested = join(app, "node_modules", "no-deps", "package.json");
        return {
          written: (await file(join(app, "package.json")).json()).dependencies["no-deps"],
          loads: await file(
            existsSync(nested) ? nested : join(packageDir, "node_modules", "no-deps", "package.json"),
          ).json(),
          locked: (await file(join(packageDir, "bun.lock")).text()).match(/"no-deps@[^"]+"/g),
        };
      }
      const expected = {
        written,
        loads: loads ?? workspace,
        locked: ['"no-deps@workspace:packages/no-deps"', ...(loads ? ['"no-deps@2.0.0"'] : [])],
      };

      await using proc = spawn({ cmd: [bunExe(), ...cmd.split(" ")], cwd: app, stdout: "ignore", stderr: "pipe", env });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("error:");
      expect(await state()).toEqual(expected);
      expect(exitCode).toBe(0);

      await runBunInstall(env, packageDir, { savesLockfile: false });
      expect(await state()).toEqual(expected);

      await Promise.all([
        rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
        rm(join(app, "node_modules"), { recursive: true, force: true }),
      ]);
      await runBunInstall(env, packageDir, { frozenLockfile: true });
      expect(await state()).toEqual(expected);
    },
  );
});

test.concurrent("bun add of an alias for a workspace writes a specifier that links it again", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  const app = join(packageDir, "packages", "app");
  const workspace = { name: "no-deps", version: "2.0.0", description: "the workspace" };
  await Promise.all([
    write(join(packageDir, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
    write(join(packageDir, "packages", "no-deps", "package.json"), JSON.stringify(workspace)),
    write(join(app, "package.json"), JSON.stringify({ name: "app", version: "1.0.0" })),
  ]);

  await using proc = spawn({
    cmd: [bunExe(), "add", "alias@npm:no-deps"],
    cwd: app,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect((await file(join(app, "package.json")).json()).dependencies).toEqual({ alias: "npm:no-deps" });
  expect(exitCode).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(env, packageDir, { frozenLockfile: true });
  expect(await file(join(packageDir, "node_modules", "alias", "package.json")).json()).toEqual(workspace);
});

test.concurrent("successfully installs workspace when path already exists in node_modules", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["pkg1"],
      }),
    ),
    write(
      join(packageDir, "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
      }),
    ),

    // stale package in node_modules
    write(
      join(packageDir, "node_modules", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg2",
      }),
    ),
  ]);

  await runBunInstall(env, packageDir);
  expect(await file(join(packageDir, "node_modules", "pkg1", "package.json")).json()).toEqual({
    name: "pkg1",
  });
});

// A "*" locked to a registry package moves to a workspace of that name once one exists, and back
// to the registry once it is gone: the lockfile edge records which one it linked.
test.concurrent("star dep follows a same-name workspace being added and removed", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  const installed = () => file(join(packageDir, "node_modules", "no-deps", "package.json")).json();
  const writeRoot = (workspaces: string[]) =>
    write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "root", workspaces, dependencies: { "no-deps": "*" } }),
    );

  await Promise.all([
    writeRoot(["app1"]),
    write(join(packageDir, "app1", "package.json"), JSON.stringify({ name: "app1" })),
  ]);
  let { exited } = await runBunInstall(env, packageDir);
  expect(await exited).toBe(0);
  expect((await installed()).version).toBe("2.0.0");

  // versionless, so only the `*` arm of the link rule matches it
  await Promise.all([
    writeRoot(["app1", "no-deps"]),
    write(join(packageDir, "no-deps", "package.json"), JSON.stringify({ name: "no-deps" })),
  ]);
  ({ exited } = await runBunInstall(env, packageDir));
  expect(await exited).toBe(0);
  expect(await installed()).toEqual({ name: "no-deps" });

  await writeRoot(["app1"]);
  ({ exited } = await runBunInstall(env, packageDir));
  expect(await exited).toBe(0);
  expect((await installed()).version).toBe("2.0.0");
});

// The root both lists the workspace and depends on it by `*`; a prerelease version is not
// satisfied by `*`, but `*` links to a same-name workspace regardless of its version.
test.concurrent("root star dep on its own prerelease workspace links the workspace", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["no-deps"], dependencies: { "no-deps": "*" } }),
    ),
    write(join(packageDir, "no-deps", "package.json"), JSON.stringify({ name: "no-deps", version: "1.0.0-alpha" })),
  ]);
  const { exited } = await runBunInstall(env, packageDir);
  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0-alpha",
  });
});

// These name a workspace and no version, like `workspace:^`, so no version of it is the wrong one.
describe.each([
  ["a prerelease version", { version: "2.0.0-rc.1" }],
  ["no version", {}],
])("a workspace with %s", (_, version) => {
  test.concurrent.each([
    ["lib", "workspace:../lib"],
    ["lib", "workspace:lib@^"],
    ["lib", "workspace:lib@~"],
    ["other", "workspace:lib@^"],
  ])("is linked as %s by %s", async (name, spec) => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
      write(join(packageDir, "packages", "lib", "package.json"), JSON.stringify({ name: "lib", ...version })),
      write(
        join(packageDir, "packages", "app", "package.json"),
        JSON.stringify({ name: "app", version: "1.0.0", dependencies: { [name]: spec } }),
      ),
    ]);
    await runBunInstall(env, packageDir);
    expect(await file(join(packageDir, "node_modules", name, "package.json")).json()).toEqual({
      name: "lib",
      ...version,
    });
    await runBunInstall(env, packageDir, { frozenLockfile: true });
  });
});

// The root edge is cloned into the new lockfile when `bun update` re-resolves it; the clone must
// keep the workspace it links to, which for an alias is not recoverable from the alias name.
test.concurrent.each([
  { spec: "npm:package1@*", pkg1: {} },
  { spec: "npm:package1@^1.0.0", pkg1: { version: "1.0.0" } },
])("root alias $spec onto a workspace survives bun update", async ({ spec, pkg1 }) => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["package1"], dependencies: { aliased: spec } }),
    ),
    write(join(packageDir, "package1", "package.json"), JSON.stringify({ name: "package1", ...pkg1 })),
  ]);
  const { exited } = await runBunInstall(env, packageDir);
  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "node_modules", "aliased", "package.json")).json()).toEqual({
    name: "package1",
    ...pkg1,
  });

  await runBunUpdate(env, packageDir);
  expect(await file(join(packageDir, "node_modules", "aliased", "package.json")).json()).toEqual({
    name: "package1",
    ...pkg1,
  });
});

// A member's plain dependency takes the root's `npm:` alias of the same name when the two ranges
// overlap and the member's holds a bound of the alias's. `>1` starts at 2.0.0, the same as a written `>=2.0.0`.
test.concurrent.each([
  { member: "^2.0.0", memberSees: { name: "no-deps", version: "2.0.0" } },
  { member: "^1.0.0", memberSees: { name: "a-dep", version: "1.0.10" } },
])("a member's a-dep@$member next to the root alias npm:no-deps@>1", async ({ member, memberSees }) => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["moo"], dependencies: { "a-dep": "npm:no-deps@>1" } }),
    ),
    write(join(packageDir, "moo", "package.json"), JSON.stringify({ name: "moo", dependencies: { "a-dep": member } })),
  ]);
  await runBunInstall(env, packageDir);
  expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
    name: "no-deps",
    version: "2.0.0",
  });
  const nested = join(packageDir, "moo", "node_modules", "a-dep", "package.json");
  const seenByMember = (await exists(nested)) ? nested : join(packageDir, "node_modules", "a-dep", "package.json");
  expect(await file(seenByMember).json()).toMatchObject(memberSees);
});

// `$name` copies the root's spec for `name`. When that spec is a range linked to a workspace, the
// override is still the range, which is what bun.lock records, so a reload sees no change.
test.concurrent("$ref override of a range linked to a workspace round-trips through bun.lock", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["no-deps"],
        dependencies: { "no-deps": "^1.0.0", "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "$no-deps" },
      }),
    ),
    write(join(packageDir, "no-deps", "package.json"), JSON.stringify({ name: "no-deps", version: "1.0.0" })),
  ]);
  let { exited } = await runBunInstall(env, packageDir);
  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "bun.lock")).text()).toContain('"overrides": {\n    "no-deps": "^1.0.0"');

  ({ exited } = await runBunInstall(env, packageDir, { frozenLockfile: true }));
  expect(await exited).toBe(0);
});

// bun.lock records each workspace's version (`bun pm pack` substitutes `workspace:^` from it), so
// bumping one rewrites the lockfile even though no dependency edge changed.
test.concurrent("bumping a workspace version rewrites bun.lock", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  const writePkg = (version: string) =>
    write(join(packageDir, "pkg", "package.json"), JSON.stringify({ name: "pkg", version }));
  const lockedVersion = async () =>
    (await file(join(packageDir, "bun.lock")).text()).match(/"name": "pkg",\s*"version": "([^"]+)"/)?.[1];

  await Promise.all([
    write(join(packageDir, "package.json"), JSON.stringify({ name: "root", workspaces: ["pkg"] })),
    writePkg("1.0.0"),
  ]);
  let { exited } = await runBunInstall(env, packageDir);
  expect(await exited).toBe(0);
  expect(await lockedVersion()).toBe("1.0.0");

  await writePkg("1.1.0");
  ({ exited } = await runBunInstall(env, packageDir, { savesLockfile: true }));
  expect(await exited).toBe(0);
  expect(await lockedVersion()).toBe("1.1.0");

  // build metadata is part of the recorded version too
  await writePkg("1.1.0+build.2");
  ({ exited } = await runBunInstall(env, packageDir, { savesLockfile: true }));
  expect(await exited).toBe(0);
  expect(await lockedVersion()).toBe("1.1.0+build.2");

  // an empty pre-release is recorded as "1.2.0"; the install after that sees no change
  await writePkg("1.2.0-");
  ({ exited } = await runBunInstall(env, packageDir, { savesLockfile: true }));
  expect(await exited).toBe(0);
  expect(await lockedVersion()).toBe("1.2.0");
  const settled = await runBunInstall(env, packageDir, { savesLockfile: false });
  expect(settled.err).not.toContain("Saved lockfile");
  expect(await settled.exited).toBe(0);
});

test.concurrent("adding workspace in workspace edits package.json with correct version (workspace:*)", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*", "apps/*"],
      }),
    ),

    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
      }),
    ),

    write(
      join(packageDir, "apps", "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        version: "1.0.0",
      }),
    ),
  ]);

  const { stdout, exited } = Bun.spawn({
    cmd: [bunExe(), "add", "pkg2@workspace:*"],
    cwd: join(packageDir, "packages", "pkg1"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  });
  const out = await stdout.text();

  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed pkg2@workspace:apps/pkg2",
    "",
    "2 packages installed",
  ]);

  expect(await exited).toBe(0);

  expect(await Bun.file(join(packageDir, "packages", "pkg1", "package.json")).json()).toEqual({
    name: "pkg1",
    version: "1.0.0",
    dependencies: {
      pkg2: "workspace:*",
    },
  });
});

test.concurrent("workspaces with invalid versions should still install", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "📦",
        workspaces: ["packages/*"],
        dependencies: {
          emoji1: "workspace:*",
          emoji2: "workspace:>=0",
          pre: "*",
          build: "workspace:^",
        },
      }),
    ),
    write(
      join(packageDir, "packages", "emoji1", "package.json"),
      JSON.stringify({
        name: "emoji1",
        version: "😃",
      }),
    ),
    write(
      join(packageDir, "packages", "emoji2", "package.json"),
      JSON.stringify({
        name: "emoji2",
        version: "👀",
      }),
    ),
    write(
      join(packageDir, "packages", "pre", "package.json"),
      JSON.stringify({
        name: "pre",
        version: "3.0.0_pre",
      }),
    ),
    write(
      join(packageDir, "packages", "build", "package.json"),
      JSON.stringify({
        name: "build",
        version: "3.0.0_pre+bui_ld",
      }),
    ),
  ]);

  await runBunInstall(env, packageDir);

  const results = await Promise.all([
    file(join(packageDir, "node_modules", "emoji1", "package.json")).json(),
    file(join(packageDir, "node_modules", "emoji2", "package.json")).json(),
    file(join(packageDir, "node_modules", "pre", "package.json")).json(),
    file(join(packageDir, "node_modules", "build", "package.json")).json(),
  ]);

  expect(results[0]).toEqual({
    name: "emoji1",
    version: "😃",
  });
  expect(results[1]).toEqual({
    name: "emoji2",
    version: "👀",
  });
  expect(results[2]).toEqual({
    name: "pre",
    version: "3.0.0_pre",
  });
  expect(results[3]).toEqual({
    name: "build",
    version: "3.0.0_pre+bui_ld",
  });
});

describe("workspace aliases", async () => {
  test.concurrent("combination", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: {
            "a0": "workspace:@org/a@latest",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "@org/a",
          dependencies: {
            "a1": "workspace:@org/b@     ",
            "a2": "workspace:c@*",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "@org/b",
          dependencies: {
            "a3": "workspace:c@    ",
            "a4": "workspace:@org/a@latest",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg3", "package.json"),
        JSON.stringify({
          name: "c",
          dependencies: {
            "a5": "workspace:@org/a@*",
          },
        }),
      ),
    ]);

    await runBunInstall(env, packageDir);
    const files = await Promise.all(
      ["a0", "a1", "a2", "a3", "a4", "a5"].map(name =>
        file(join(packageDir, "node_modules", name, "package.json")).json(),
      ),
    );

    expect(files).toMatchObject([
      { name: "@org/a" },
      { name: "@org/b" },
      { name: "c" },
      { name: "c" },
      { name: "@org/a" },
      { name: "@org/a" },
    ]);
  });
  var shouldPass: string[] = [
    "workspace:@org/b@latest",
    "workspace:@org/b@*",
    // missing version after `@`
    "workspace:@org/b@",
    // leading whitespace is not part of the specifier
    " workspace:@org/b@*",
  ];
  for (const version of shouldPass) {
    test.concurrent(`version range ${version} and workspace with no version`, async () => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            workspaces: ["packages/*"],
          }),
        ),
        write(
          join(packageDir, "packages", "pkg1", "package.json"),
          JSON.stringify({
            name: "@org/a",
            dependencies: {
              "a1": version,
            },
          }),
        ),
        write(
          join(packageDir, "packages", "pkg2", "package.json"),
          JSON.stringify({
            name: "@org/b",
          }),
        ),
      ]);

      await runBunInstall(env, packageDir);
      const files = await Promise.all([
        file(join(packageDir, "node_modules", "@org", "a", "package.json")).json(),
        file(join(packageDir, "node_modules", "@org", "b", "package.json")).json(),
        file(join(packageDir, "node_modules", "a1", "package.json")).json(),
      ]);

      expect(files).toMatchObject([{ name: "@org/a" }, { name: "@org/b" }, { name: "@org/b" }]);
    });
  }
  let shouldFail: string[] = [
    "workspace:@org/b@1.0.0",
    "workspace:@org/b@1",
    "workspace:@org/b",
    // leading whitespace is not part of the specifier
    " workspace:@org/b@1.0.0",
  ];
  for (const version of shouldFail) {
    test.concurrent(`version range ${version} and workspace with no version (should fail)`, async () => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            workspaces: ["packages/*"],
          }),
        ),
        write(
          join(packageDir, "packages", "pkg1", "package.json"),
          JSON.stringify({
            name: "@org/a",
            dependencies: {
              "a1": version,
            },
          }),
        ),
        write(
          join(packageDir, "packages", "pkg2", "package.json"),
          JSON.stringify({
            name: "@org/b",
          }),
        ),
      ]);

      const { stderr, exited } = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "ignore",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      if (version === "workspace:@org/b") {
        expect(err).toContain('Workspace dependency "a1" not found');
        expect(err).toMatch(/Searched in "\.[\\/]packages[\\/]pkg1[\\/]@org[\\/]b"/);
      } else {
        expect(err).toContain(`No matching version for workspace dependency "a1". Version: "${version}"`);
      }
      expect(await exited).toBe(1);
    });
  }
});

// https://github.com/oven-sh/bun/issues/23264
// With a lockfile, every package.json is first parsed into a temporary lockfile. The target name is
// longer than 8 bytes, so it is an offset into that lockfile's strings and not inline.
// `one-range-dep` depends on `no-deps@^1.0.0`.
describe("a new dependency follows the npm: alias of an unchanged workspace", () => {
  const writeWorkspace = (packageDir: string, name: string, dependencies: Record<string, string>) =>
    write(join(packageDir, "packages", name, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies }));
  const noDepsOf = (packageDir: string, ...owner: string[]) =>
    file(join(packageDir, ...owner, "node_modules", "no-deps", "package.json")).json();

  test.concurrent.each([
    { lockfile: "bun.lock", saveTextLockfile: true },
    { lockfile: "bun.lockb", saveTextLockfile: false },
  ])("bun add with $lockfile", async ({ lockfile, saveTextLockfile }) => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      verdaccio.writeBunfig(packageDir, { saveTextLockfile, linker: "hoisted" }),
      write(packageJson, JSON.stringify({ name: "foo", workspaces: ["packages/*"] })),
      writeWorkspace(packageDir, "pkg1", { "no-deps": "npm:no-deps-bins@1.0.0" }),
    ]);
    await runBunInstall(env, packageDir);
    expect(await exists(join(packageDir, lockfile))).toBeTrue();

    await runBunInstall(env, packageDir, { packages: ["one-range-dep@1.0.0"] });
    expect(await exists(join(packageDir, "node_modules", "one-range-dep", "package.json"))).toBeTrue();
    expect(await noDepsOf(packageDir)).toMatchObject({ name: "no-deps-bins", version: "1.0.0" });
    // Any other resolution of one-range-dep's `no-deps` conflicts with the hoisted alias and nests here.
    expect(await exists(join(packageDir, "node_modules", "one-range-dep", "node_modules"))).toBeFalse();
  });

  // pkg1 (edited) is parsed before pkg2 (the alias): the name it adds moves the alias in the temporary
  // lockfile away from its offset in bun.lock. pkg1's `no-deps@2.0.0` keeps the root folder, so
  // one-range-dep's copy nests and shows which package it resolved to.
  test.concurrent("bun install after a sibling workspace adds the dependency", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "foo", workspaces: ["packages/*"] })),
      writeWorkspace(packageDir, "pkg1", { "no-deps": "2.0.0" }),
      writeWorkspace(packageDir, "pkg2", { "no-deps": "npm:no-deps-bins@1.0.0" }),
    ]);
    await runBunInstall(env, packageDir);

    await writeWorkspace(packageDir, "pkg1", { "no-deps": "2.0.0", "one-range-dep": "1.0.0" });
    await runBunInstall(env, packageDir);
    expect(
      await Promise.all([
        noDepsOf(packageDir),
        noDepsOf(packageDir, "packages", "pkg2"),
        noDepsOf(packageDir, "node_modules", "one-range-dep"),
      ]),
    ).toMatchObject([
      { name: "no-deps", version: "2.0.0" },
      { name: "no-deps-bins", version: "1.0.0" },
      { name: "no-deps-bins", version: "1.0.0" },
    ]);
  });
});

for (const glob of [true, false]) {
  test.concurrent(`does not crash when root package.json is in "workspaces"${glob ? " (glob)" : ""}`, async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: glob ? ["**"] : ["pkg1", "./*"],
        }),
      ),
      write(
        join(packageDir, "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
        }),
      ),
    ]);

    await runBunInstall(env, packageDir);
    expect(await file(join(packageDir, "node_modules", "pkg1", "package.json")).json()).toEqual({
      name: "pkg1",
    });
  });
}

test.concurrent("cwd in workspace script is not the symlink path on windows", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["pkg1"],
      }),
    ),
    write(
      join(packageDir, "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        scripts: {
          postinstall: 'bun -e \'require("fs").writeFileSync("cwd", process.cwd())\'',
        },
      }),
    ),
  ]);

  await runBunInstall(env, packageDir);

  expect(await file(join(packageDir, "node_modules", "pkg1", "cwd")).text()).toBe(join(packageDir, "pkg1"));
});

describe("relative tarballs", async () => {
  test.concurrent("from package.json", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["pkgs/*"],
        }),
      ),
      write(
        join(packageDir, "pkgs", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "qux": "../../qux-0.0.2.tgz",
          },
        }),
      ),
      cp(join(import.meta.dir, "qux-0.0.2.tgz"), join(packageDir, "qux-0.0.2.tgz")),
    ]);

    await runBunInstall(env, packageDir);

    expect(await file(join(packageDir, "node_modules", "qux", "package.json")).json()).toMatchObject({
      name: "qux",
      version: "0.0.2",
    });
  });
  test.concurrent("from cli", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["pkgs/*"],
        }),
      ),
      write(
        join(packageDir, "pkgs", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
        }),
      ),
      cp(join(import.meta.dir, "qux-0.0.2.tgz"), join(packageDir, "qux-0.0.2.tgz")),
    ]);

    const { stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "install", "../../qux-0.0.2.tgz"],
      cwd: join(packageDir, "pkgs", "pkg1"),
      stdout: "ignore",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).not.toContain("failed to resolve");
    expect(await exited).toBe(0);

    const results = await Promise.all([
      file(join(packageDir, "node_modules", "qux", "package.json")).json(),
      file(join(packageDir, "pkgs", "pkg1", "package.json")).json(),
    ]);

    expect(results[0]).toMatchObject({
      name: "qux",
      version: "0.0.2",
    });

    expect(results[1]).toMatchObject({
      name: "pkg1",
      dependencies: {
        qux: "../../qux-0.0.2.tgz",
      },
    });
  });
  // The tarball path is written in the root package.json, so it is relative to
  // the root even though the dependency it ends up satisfying is declared by
  // the workspace (#25835 for overrides, #25752 for catalogs). The workspace
  // gets a different tarball at the same relative path, so reading it relative
  // to the workspace installs `baz` instead of failing.
  for (const [source, root, specifier] of [
    ["override", { overrides: { bar: "file:./bar.tgz" } }, "^0.0.2"],
    ["catalog entry", { catalogs: { vendored: { bar: "file:./bar.tgz" } } }, "catalog:vendored"],
  ] as const) {
    test.concurrent(`from a root ${source} applied to a workspace dependency`, async () => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      await Promise.all([
        write(join(packageDir, "package.json"), JSON.stringify({ name: "foo", workspaces: ["pkgs/*"], ...root })),
        write(
          join(packageDir, "pkgs", "pkg1", "package.json"),
          JSON.stringify({ name: "pkg1", dependencies: { bar: specifier } }),
        ),
        cp(join(import.meta.dir, "bar-0.0.2.tgz"), join(packageDir, "bar.tgz")),
      ]);
      await cp(join(import.meta.dir, "baz-0.0.3.tgz"), join(packageDir, "pkgs", "pkg1", "bar.tgz"));

      // The second install starts from the lockfile and an empty cache, so it
      // reads the tarball again from the path recorded there.
      for (const frozenLockfile of [false, true]) {
        await Promise.all([
          rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
          rm(env.BUN_INSTALL_CACHE_DIR, { recursive: true, force: true }),
        ]);

        await runBunInstall(env, packageDir, { frozenLockfile });

        expect(await file(join(packageDir, "node_modules", "bar", "package.json")).json()).toEqual({
          name: "bar",
          version: "0.0.2",
        });
      }

      expect(await file(join(packageDir, "bun.lock")).text()).toContain('"bar": ["bar@./bar.tgz", {}, "sha512-');
    });
  }

  // Regression test for a data race where the `.local_tarball` task callback
  // (running on a ThreadPool worker) read `lockfile.packages` and
  // `lockfile.buffers.string_bytes` to resolve the workspace-relative tarball
  // path while the main thread was concurrently reallocating those buffers via
  // `appendPackage` / `StringBuilder.allocate` as other tarball tasks completed.
  // Under ASAN this surfaces as a heap-use-after-free; in release it can read
  // a garbage workspace path and fail to open the tarball.
  //
  // The fix moves the lockfile lookup to `enqueueLocalTarball` on the main
  // thread and stores the resolved path in the task request so the worker
  // never touches mutable lockfile state.
  //
  // The race window (iterating `lockfile.packages`) is measured in
  // microseconds while tarball extraction takes milliseconds, so this test
  // does not deterministically reproduce the UAF — it exercises the concurrent
  // path and verifies each workspace-relative tarball resolves correctly.
  test.concurrent("many concurrent local tarballs in workspaces", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    // Enough workspaces that `getWorkspacePkgIfWorkspaceDep` has a non-trivial
    // `lockfile.packages` to iterate, and enough tarballs that several
    // ThreadPool tasks are running while the main thread appends the packages
    // from tarballs that have already finished.
    const workspaceCount = 6;
    const tarballsPerWorkspace = 2;

    const srcTarball = join(import.meta.dir, "bar-0.0.2.tgz");
    const tarballBytes = await file(srcTarball).bytes();

    const writes: Promise<unknown>[] = [
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "root",
          workspaces: ["pkgs/*"],
        }),
      ),
    ];
    for (let i = 0; i < workspaceCount; i++) {
      const deps: Record<string, string> = {};
      for (let j = 0; j < tarballsPerWorkspace; j++) {
        // Each tarball has a unique path so each one gets its own
        // `.local_tarball` ThreadPool task.
        deps[`tarball-${i}-${j}`] = `./tarball-${i}-${j}.tgz`;
        writes.push(write(join(packageDir, "pkgs", `pkg${i}`, `tarball-${i}-${j}.tgz`), tarballBytes));
      }
      writes.push(
        write(
          join(packageDir, "pkgs", `pkg${i}`, "package.json"),
          JSON.stringify({
            name: `pkg${i}`,
            dependencies: deps,
          }),
        ),
      );
    }
    await Promise.all(writes);

    const { stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "install", "--ignore-scripts"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);

    // Verify the workspace-relative path was resolved correctly for every tarball.
    for (let i = 0; i < workspaceCount; i++) {
      for (let j = 0; j < tarballsPerWorkspace; j++) {
        expect(await file(join(packageDir, "node_modules", `tarball-${i}-${j}`, "package.json")).json()).toMatchObject({
          name: "bar",
          version: "0.0.2",
        });
      }
    }
  });
});

test.concurrent("$npm_package_config_ works in root", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      workspaces: ["pkgs/*"],
      config: { foo: "bar" },
      scripts: { sample: "echo $npm_package_config_foo $npm_package_config_qux" },
    }),
  );
  await write(
    join(packageDir, "pkgs", "pkg1", "package.json"),
    JSON.stringify({
      name: "pkg1",
      config: { qux: "tab" },
      scripts: { sample: "echo $npm_package_config_foo $npm_package_config_qux" },
    }),
  );
  const p = Bun.spawn({
    cmd: [bunExe(), "run", "sample"],
    cwd: packageDir,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  expect(await p.exited).toBe(0);
  expect(await new Response(p.stderr).text()).toBe(`$ echo $npm_package_config_foo $npm_package_config_qux\n`);
  expect(await new Response(p.stdout).text()).toBe(`bar\n`);
});
test.concurrent("$npm_package_config_ works in root in subpackage", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      workspaces: ["pkgs/*"],
      config: { foo: "bar" },
      scripts: { sample: "echo $npm_package_config_foo $npm_package_config_qux" },
    }),
  );
  await write(
    join(packageDir, "pkgs", "pkg1", "package.json"),
    JSON.stringify({
      name: "pkg1",
      config: { qux: "tab" },
      scripts: { sample: "echo $npm_package_config_foo $npm_package_config_qux" },
    }),
  );
  const p = Bun.spawn({
    cmd: [bunExe(), "run", "sample"],
    cwd: join(packageDir, "pkgs", "pkg1"),
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  expect(await p.exited).toBe(0);
  expect(await new Response(p.stderr).text()).toBe(`$ echo $npm_package_config_foo $npm_package_config_qux\n`);
  expect(await new Response(p.stdout).text()).toBe(`tab\n`);
});

test.concurrent("adding packages in a subdirectory of a workspace", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await write(
    packageJson,
    JSON.stringify({
      name: "root",
      workspaces: ["foo"],
    }),
  );

  await mkdir(join(packageDir, "folder1"));
  await mkdir(join(packageDir, "foo", "folder2"), { recursive: true });
  await write(
    join(packageDir, "foo", "package.json"),
    JSON.stringify({
      name: "foo",
    }),
  );

  // add package to root workspace from `folder1`
  let { stdout, exited } = spawn({
    cmd: [bunExe(), "add", "no-deps"],
    cwd: join(packageDir, "folder1"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  });
  let out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed no-deps@2.0.0",
    "",
    "2 packages installed",
  ]);
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

  expect(await file(packageJson).json()).toEqual({
    name: "root",
    workspaces: ["foo"],
    dependencies: {
      "no-deps": "^2.0.0",
    },
  });

  // add package to foo from `folder2`
  ({ stdout, exited } = spawn({
    cmd: [bunExe(), "add", "what-bin"],
    cwd: join(packageDir, "foo", "folder2"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  }));
  out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed what-bin@1.5.0 with binaries:",
    " - what-bin",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

  expect(await file(join(packageDir, "foo", "package.json")).json()).toEqual({
    name: "foo",
    dependencies: {
      "what-bin": "^1.5.0",
    },
  });

  // now delete node_modules and bun.lock and install
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "bun.lock"));

  ({ stdout, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "folder1"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  }));
  out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "+ no-deps@2.0.0",
    "",
    "3 packages installed",
  ]);
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "foo", "no-deps", "what-bin"]);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "bun.lock"));

  ({ stdout, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "foo", "folder2"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  }));
  out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "+ what-bin@1.5.0",
    "",
    "3 packages installed",
  ]);
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "foo", "no-deps", "what-bin"]);
});
test.concurrent("adding packages in workspaces", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      workspaces: ["packages/*"],
      dependencies: {
        "bar": "workspace:*",
      },
    }),
  );

  await mkdir(join(packageDir, "packages", "bar"), { recursive: true });
  await mkdir(join(packageDir, "packages", "boba"));
  await mkdir(join(packageDir, "packages", "pkg5"));

  await write(join(packageDir, "packages", "bar", "package.json"), JSON.stringify({ name: "bar" }));
  await write(
    join(packageDir, "packages", "boba", "package.json"),
    JSON.stringify({ name: "boba", version: "1.0.0", dependencies: { "pkg5": "*" } }),
  );
  await write(
    join(packageDir, "packages", "pkg5", "package.json"),
    JSON.stringify({
      name: "pkg5",
      version: "1.2.3",
      dependencies: {
        "bar": "workspace:*",
      },
    }),
  );

  let { stdout, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "inherit",
    env,
  });

  let out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "+ bar@workspace:packages/bar",
    "",
    "3 packages installed",
  ]);
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

  expect(await exists(join(packageDir, "node_modules", "bar"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", "boba"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", "pkg5"))).toBeTrue();

  // add a package to the root workspace
  ({ stdout, exited } = spawn({
    cmd: [bunExe(), "add", "no-deps"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "inherit",
    env,
  }));

  out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed no-deps@2.0.0",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

  expect(await file(packageJson).json()).toEqual({
    name: "foo",
    workspaces: ["packages/*"],
    dependencies: {
      bar: "workspace:*",
      "no-deps": "^2.0.0",
    },
  });

  // add a package in a workspace
  ({ stdout, exited } = spawn({
    cmd: [bunExe(), "add", "two-range-deps"],
    cwd: join(packageDir, "packages", "boba"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  }));

  out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed two-range-deps@1.0.0",
    "",
    "3 packages installed",
  ]);
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

  expect(await file(join(packageDir, "packages", "boba", "package.json")).json()).toEqual({
    name: "boba",
    version: "1.0.0",
    dependencies: {
      "pkg5": "*",
      "two-range-deps": "^1.0.0",
    },
  });
  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
    "@types",
    "bar",
    "boba",
    "no-deps",
    "pkg5",
    "two-range-deps",
  ]);

  // add a dependency to a workspace with the same name as another workspace
  ({ stdout, exited } = spawn({
    cmd: [bunExe(), "add", "bar@0.0.7"],
    cwd: join(packageDir, "packages", "boba"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  }));

  out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@0.0.7",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

  expect(await file(join(packageDir, "packages", "boba", "package.json")).json()).toEqual({
    name: "boba",
    version: "1.0.0",
    dependencies: {
      "pkg5": "*",
      "two-range-deps": "^1.0.0",
      "bar": "0.0.7",
    },
  });
  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
    "@types",
    "bar",
    "boba",
    "no-deps",
    "pkg5",
    "two-range-deps",
  ]);
  expect(await file(join(packageDir, "node_modules", "boba", "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.7",
    description: "not a workspace",
  });
});
test.concurrent("it should detect duplicate workspace dependencies", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      workspaces: ["packages/*"],
    }),
  );

  await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
  await write(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify({ name: "pkg1" }));
  await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
  await write(join(packageDir, "packages", "pkg2", "package.json"), JSON.stringify({ name: "pkg1" }));

  var { stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await stderr.text();
  expect(err).toContain('Workspace name "pkg1" already exists');
  expect(await exited).toBe(1);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "bun.lock"), { force: true });

  ({ stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "packages", "pkg1"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  expect(err).toContain('Workspace name "pkg1" already exists');
  expect(await exited).toBe(1);
});

// Auto-install reads the project from the folder of the script, not from the root.
test.concurrent("a script that imports a missing package reports two workspaces with the same name", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
    write(join(packageDir, "packages", "app", "package.json"), JSON.stringify({ name: "app" })),
    write(join(packageDir, "packages", "app", "index.ts"), `import "not-installed";`),
    write(join(packageDir, "packages", "one", "package.json"), JSON.stringify({ name: "same" })),
    write(join(packageDir, "packages", "two", "package.json"), JSON.stringify({ name: "same" })),
  ]);
  await using proc = spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: join(packageDir, "packages", "app"),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(err).toContain('Workspace name "same" already exists');
  expect(exitCode).toBe(1);
});

// One package of a monorepo copied into an image without its siblings (#15102).
describe("a local devDependency whose target is missing", () => {
  const specs = {
    "workspace:*": 'Workspace dependency "missing-local" not found',
    "link:missing-local": 'Package "missing-local" is not linked',
    "file:../does-not-exist": 'package.json not found for "file:../does-not-exist" dependency "missing-local"',
  } as const;

  async function install(ctx: TestCtx, manifest: object, ...args: string[]) {
    await write(ctx.packageJson, JSON.stringify({ name: "foo", ...manifest }));
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: ctx.packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...ctx.env, BUN_INSTALL_GLOBAL_DIR: join(ctx.packageDir, ".bun-global") },
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err: err.replaceAll("\\", "/"), exitCode };
  }

  describe.each(["hoisted", "isolated"])("%s", linker => {
    describe.each(["--production", "--omit=dev"])("%s", flag => {
      test.concurrent.each([...Object.keys(specs), "link:./does-not-exist"])("%s is skipped", async spec => {
        using ctx = await setupTest();
        const manifest = { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "missing-local": spec } };

        const fresh = await install(ctx, manifest, flag, "--linker", linker);
        expect(fresh.err).not.toContain("error:");
        expect(fresh.err).not.toContain("missing-local");
        expect(fresh.out).toContain("1 package installed");
        expect(fresh.exitCode).toBe(0);
        expect(await exists(join(ctx.packageDir, "node_modules", "no-deps", "package.json"))).toBeTrue();
        expect(await exists(join(ctx.packageDir, "node_modules", "missing-local"))).toBeFalse();
        // A bun.lock that lists the row without a package would not load.
        expect(await exists(join(ctx.packageDir, "bun.lock"))).toBeFalse();

        for (const args of [[], ["--frozen-lockfile"]]) {
          const warm = await install(ctx, manifest, flag, "--linker", linker, ...args);
          expect(warm.err).not.toContain("error:");
          expect(warm.out).toContain("(no changes)");
          expect(warm.exitCode).toBe(0);
        }

        const full = await install(ctx, manifest, "--linker", linker);
        expect(full.err).toContain("missing-local");
        expect(full.exitCode).toBe(1);
      });
    });
  });

  test.concurrent.each(Object.entries(specs))("%s in `dependencies` fails --production", async (spec, message) => {
    using ctx = await setupTest();
    const { err, exitCode } = await install(ctx, { dependencies: { "missing-local": spec } }, "--production");
    expect(err).toContain(message);
    expect(exitCode).toBe(1);
  });
});

// https://github.com/oven-sh/bun/issues/2773
describe.each(["hoisted", "isolated"])("the root package by its name (%s)", linker => {
  async function install(cwd: string, env: Record<string, string>, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", `--linker=${linker}`, ...args],
      cwd,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  // The `bin` is in bun.lock only through the `Foo@root:` entry.
  const root = { name: "Foo", version: "0.0.1", workspaces: ["bar"], bin: { "foo-bin": "index.js" } };

  test.concurrent.each([
    ["Foo", "workspace:*"],
    ["Foo", "workspace:0.0.1"],
    ["Foo", "workspace:^"],
    ["Foo", "workspace:"],
    ["my-foo", "workspace:Foo@*"],
  ])("a member depends on it: %j: %j", async (alias, spec) => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(packageJson, JSON.stringify(root)),
      write(
        join(packageDir, "bar", "package.json"),
        JSON.stringify({ name: "Bar", version: "0.0.2", devDependencies: { [alias]: spec } }),
      ),
      write(join(packageDir, "index.js"), "module.exports = 42;\n"),
    ]);

    expect(await install(packageDir, env)).toEqual({ stderr: "Saved lockfile\n", exitCode: 0 });

    const lock = await file(join(packageDir, "bun.lock")).text();
    expect(lock).toContain(`"${alias}": ["Foo@root:", { "bin": { "foo-bin": "index.js" } }],`);
    expect(Object.values(parseLockfile(packageDir).workspace_paths)).toEqual(["bar"]);

    await using proc = spawn({
      cmd: [bunExe(), "-e", `console.log(require(${JSON.stringify(alias)}))`],
      cwd: join(packageDir, "bar"),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])).toEqual(["42\n", "", 0]);

    expect(await install(packageDir, env, "--frozen-lockfile")).toEqual({ stderr: "", exitCode: 0 });
    expect(await install(packageDir, env)).toEqual({ stderr: "", exitCode: 0 });
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(lock);

    await Promise.all(
      ["node_modules", "bar/node_modules"].map(dir => rm(join(packageDir, dir), { recursive: true, force: true })),
    );
    expect(await install(join(packageDir, "bar"), env, "--frozen-lockfile")).toEqual({ stderr: "", exitCode: 0 });
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(lock);
  });

  test.concurrent("a member gets a link to it, not a copy", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(packageJson, JSON.stringify(root)),
      write(
        join(packageDir, "bar", "package.json"),
        JSON.stringify({ name: "Bar", version: "0.0.2", dependencies: { Foo: "workspace:*" } }),
      ),
      write(join(packageDir, "index.js"), "module.exports = 42;\n"),
    ]);
    expect(await install(packageDir, env)).toEqual({ stderr: "Saved lockfile\n", exitCode: 0 });

    const dependent = linker === "hoisted" ? packageDir : join(packageDir, "bar");
    expect(realpathSync(join(dependent, "node_modules", "Foo"))).toBe(realpathSync(packageDir));

    await using proc = spawn({
      cmd: [bunExe(), "install", `--linker=${linker}`],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toBe("");
    expect(out).toContain("(no changes)");
    expect(exitCode).toBe(0);
  });

  test.concurrent("its version has to match the range, like a member's", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(packageJson, JSON.stringify(root)),
      write(
        join(packageDir, "bar", "package.json"),
        JSON.stringify({ name: "Bar", version: "0.0.2", dependencies: { Foo: "workspace:^9.0.0" } }),
      ),
    ]);

    const { stderr, exitCode } = await install(packageDir, env);
    expect(stderr).toContain('No matching version for workspace dependency "Foo". Version: "workspace:^9.0.0"');
    expect(exitCode).toBe(1);
  });

  test.concurrent("a workspace with that name comes first", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(packageJson, JSON.stringify({ ...root, workspaces: ["bar", "foo"] })),
      write(
        join(packageDir, "bar", "package.json"),
        JSON.stringify({ name: "Bar", version: "0.0.2", dependencies: { Foo: "workspace:*" } }),
      ),
      write(join(packageDir, "foo", "package.json"), JSON.stringify({ name: "Foo", version: "2.0.0" })),
    ]);

    expect(await install(packageDir, env)).toEqual({ stderr: "Saved lockfile\n", exitCode: 0 });
    expect(await file(join(packageDir, "bun.lock")).text()).toContain('"Foo": ["Foo@workspace:foo"],');
  });

  test.concurrent("the root package.json depends on it", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await write(packageJson, JSON.stringify({ name: "Foo", version: "0.0.1", dependencies: { Foo: "workspace:*" } }));

    expect(await install(packageDir, env)).toEqual({ stderr: "Saved lockfile\n", exitCode: 0 });
    expect(await file(join(packageDir, "node_modules", "Foo", "package.json")).json()).toMatchObject({ name: "Foo" });
    expect(await install(packageDir, env, "--frozen-lockfile")).toEqual({ stderr: "", exitCode: 0 });
  });
});

const versions = ["workspace:1.0.0", "workspace:*", "workspace:^1.0.0", "1.0.0", "*"];

for (const rootVersion of versions) {
  for (const packageVersion of versions) {
    test.concurrent(`it should allow duplicates, root@${rootVersion}, package@${packageVersion}`, async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          workspaces: ["packages/*"],
          dependencies: {
            pkg2: rootVersion,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
      await write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          dependencies: {
            pkg2: packageVersion,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
      await write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({ name: "pkg2", version: "1.0.0" }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await stderr.text();
      var out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ pkg2@workspace:packages/pkg2`,
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "pkg1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 2 installs across 3 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lock"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "pkg1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ pkg2@workspace:packages/pkg2`,
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 2 installs across 3 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });
  }
}

for (const version of versions) {
  test.concurrent(
    `it should allow listing workspace as dependency of the root package version ${version}`,
    async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: {
            "workspace-1": version,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "workspace-1"), { recursive: true });
      await write(
        join(packageDir, "packages", "workspace-1", "package.json"),
        JSON.stringify({
          name: "workspace-1",
          version: "1.0.0",
        }),
      );
      // install first from the root, the workspace package
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await stderr.text();
      var out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ workspace-1@workspace:packages/workspace-1`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "node_modules", "workspace-1", "package.json")).json()).toEqual({
        name: "workspace-1",
        version: "1.0.0",
      });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "workspace-1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "node_modules", "workspace-1", "package.json")).json()).toEqual({
        name: "workspace-1",
        version: "1.0.0",
      });

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lock"), { recursive: true, force: true });

      // install from workspace package then from root
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "workspace-1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "workspace-1", "package.json")).json()).toEqual({
        name: "workspace-1",
        version: "1.0.0",
      });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "node_modules", "workspace-1", "package.json")).json()).toEqual({
        name: "workspace-1",
        version: "1.0.0",
      });
    },
  );
}

describe("install --filter", () => {
  test.concurrent("does not run root scripts if root is filtered out", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          scripts: {
            postinstall: `${bunExe()} root.js`,
          },
        }),
      ),
      write(join(packageDir, "root.js"), `require("fs").writeFileSync("root.txt", "")`),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          scripts: {
            postinstall: `${bunExe()} pkg1.js`,
          },
        }),
      ),
      write(join(packageDir, "packages", "pkg1", "pkg1.js"), `require("fs").writeFileSync("pkg1.txt", "")`),
    ]);

    var { exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "pkg1"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "ignore",
      env,
    });

    expect(await exited).toBe(0);

    expect(await exists(join(packageDir, "root.txt"))).toBeFalse();
    expect(await exists(join(packageDir, "packages", "pkg1", "pkg1.txt"))).toBeTrue();

    await rm(join(packageDir, "packages", "pkg1", "pkg1.txt"));

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "root"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "ignore",
      env,
    }));

    expect(await exited).toBe(0);

    expect(await exists(join(packageDir, "root.txt"))).toBeTrue();
    expect(await exists(join(packageDir, "packages", "pkg1.txt"))).toBeFalse();
  });

  test.concurrent("basic", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      ),
    ]);

    var { exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "pkg1"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules", "a-dep")),
        exists(join(packageDir, "node_modules", "no-deps")),
      ]),
    ).toEqual([false, false]);

    // add workspace
    await write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        dependencies: {
          "no-deps": "2.0.0",
        },
      }),
    );

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "pkg1"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    }));

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules", "a-dep")),
        exists(join(packageDir, "node_modules", "no-deps")),
      ]),
    ).toEqual([false, true]);
  });

  test.concurrent("all but one or two", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      ),
    ]);

    var { exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "!pkg2", "--save-text-lockfile"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules", "a-dep")),
        file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
        exists(join(packageDir, "node_modules", "pkg2")),
      ]),
    ).toEqual([true, { name: "no-deps", version: "2.0.0" }, false]);

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    // exclude the root by name
    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "!root"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    }));

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules", "a-dep")),
        exists(join(packageDir, "node_modules", "no-deps")),
        exists(join(packageDir, "node_modules", "pkg1")),
        exists(join(packageDir, "node_modules", "pkg2")),
      ]),
    ).toEqual([false, true, true, true]);
  });

  test.concurrent("matched workspace depends on filtered workspace", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          dependencies: {
            "pkg1": "1.0.0",
          },
        }),
      ),
    ]);

    var { exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "!pkg1"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules", "a-dep")),
        file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
        exists(join(packageDir, "node_modules", "pkg1")),
        exists(join(packageDir, "node_modules", "pkg2")),
      ]),
    ).toEqual([true, { name: "no-deps", version: "2.0.0" }, true, true]);
  });

  test.concurrent("filter with a path", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "path-pattern",
          workspaces: ["packages/*"],
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
      ),
    ]);

    async function checkRoot() {
      expect(
        await Promise.all([
          exists(join(packageDir, "node_modules", "a-dep")),
          exists(join(packageDir, "node_modules", "no-deps", "package.json")),
          exists(join(packageDir, "node_modules", "pkg1")),
        ]),
      ).toEqual([true, false, false]);
    }

    async function checkWorkspace() {
      expect(
        await Promise.all([
          exists(join(packageDir, "node_modules", "a-dep")),
          file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
          exists(join(packageDir, "node_modules", "pkg1")),
        ]),
      ).toEqual([false, { name: "no-deps", version: "2.0.0" }, true]);
    }

    var { exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "./packages/pkg1"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });

    expect(await exited).toBe(0);
    await checkWorkspace();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "./packages/*"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    }));

    expect(await exited).toBe(0);
    await checkWorkspace();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "!./packages/pkg1"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    }));

    expect(await exited).toBe(0);
    await checkRoot();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "!./packages/*"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    }));

    expect(await exited).toBe(0);
    await checkRoot();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "!./"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    }));

    expect(await exited).toBe(0);
    await checkWorkspace();
  });

  test.concurrent("relation selectors walk the workspace graph", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    const pkg = (name: string, deps: Record<string, unknown>) =>
      write(join(packageDir, "packages", name, "package.json"), JSON.stringify({ name, version: "1.0.0", ...deps }));
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { app: "workspace:*", "left-pad": "1.0.0" },
        }),
      ),
      pkg("app", { dependencies: { lib: "workspace:*", "is-number": "1.0.0" } }),
      pkg("lib", { dependencies: { util: "workspace:*", "no-deps": "1.0.0" } }),
      pkg("util", { dependencies: { "a-dep": "1.0.1" } }),
      pkg("tool", { devDependencies: { lib: "1.0.0" }, dependencies: { "no-deps-bins": "1.0.0" } }),
      pkg("lone", { dependencies: { "peer-no-deps": "1.0.0" } }),
    ]);

    const externals = ["a-dep", "no-deps", "is-number", "no-deps-bins", "left-pad", "peer-no-deps"];
    const installed = () => Promise.all(externals.map(name => exists(join(packageDir, "node_modules", name))));

    async function installWithFilter(filter: string) {
      await using proc = spawn({
        cmd: [bunExe(), "install", "--filter", filter],
        cwd: packageDir,
        stdout: "ignore",
        stderr: "pipe",
        env,
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      return exitCode;
    }

    // util and its dependents: lib, app, root (via app), tool (via its devDependency on lib); not lone
    const dependentsExit = await installWithFilter("...util");
    expect(await installed()).toStrictEqual([true, true, true, true, true, false]);
    expect(await file(join(packageDir, "bun.lock")).text()).toContain('"peer-no-deps": "1.0.0"');
    expect(dependentsExit).toBe(0);

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    // only app's dependencies: lib and util
    const dependenciesExit = await installWithFilter("app^...");
    expect(await installed()).toStrictEqual([true, true, false, false, false, false]);
    expect(dependenciesExit).toBe(0);
  });

  test.concurrent("-F is the short form of --filter", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { "a-dep": "1.0.1" },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          dependencies: { "no-deps": "2.0.0" },
        }),
      ),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "install", "-F", "pkg1"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(out).not.toContain("a-dep");
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules", "a-dep")),
        file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
        exists(join(packageDir, "node_modules", "pkg1")),
      ]),
    ).toStrictEqual([false, { name: "no-deps", version: "2.0.0" }, true]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("{dir} selects every workspace under a directory", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*", "apps/*"],
          dependencies: { "a-dep": "1.0.1" },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "2.0.0" } }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({ name: "pkg2", version: "1.0.0", dependencies: { "left-pad": "1.0.0" } }),
      ),
      write(
        join(packageDir, "apps", "app1", "package.json"),
        JSON.stringify({ name: "app1", version: "1.0.0", dependencies: { "is-number": "1.0.0" } }),
      ),
    ]);

    const externals = ["a-dep", "no-deps", "left-pad", "is-number"];
    const installed = () => Promise.all(externals.map(name => exists(join(packageDir, "node_modules", name))));

    async function installWithFilter(filter: string, cwd = packageDir) {
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await using proc = spawn({
        cmd: [bunExe(), "install", "--filter", filter],
        cwd,
        stdout: "ignore",
        stderr: "pipe",
        env,
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stderr).not.toContain("No workspace packages matched");
      return exitCode;
    }

    expect(await installWithFilter("{./packages}")).toBe(0);
    expect(await installed()).toStrictEqual([false, true, true, false]);

    expect(await installWithFilter("{packages}")).toBe(0);
    expect(await installed()).toStrictEqual([false, true, true, false]);

    expect(await installWithFilter("{./packages/pkg1}")).toBe(0);
    expect(await installed()).toStrictEqual([false, true, false, false]);

    // resolved from cwd: `{.}` inside apps/ selects app1 only
    expect(await installWithFilter("{.}", join(packageDir, "apps"))).toBe(0);
    expect(await installed()).toStrictEqual([false, false, false, true]);

    // `{.}` from the root selects the root and everything below it
    expect(await installWithFilter("{.}")).toBe(0);
    expect(await installed()).toStrictEqual([true, true, true, true]);

    expect(await installWithFilter("!{./packages}")).toBe(0);
    expect(await installed()).toStrictEqual([true, false, false, true]);
  });

  test.concurrent("isolated linker honors the same selectors", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    const pkg = (name: string, deps: Record<string, unknown>) =>
      write(join(packageDir, "packages", name, "package.json"), JSON.stringify({ name, version: "1.0.0", ...deps }));
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { "left-pad": "1.0.0" },
        }),
      ),
      pkg("app", { dependencies: { lib: "workspace:*", "is-number": "1.0.0" } }),
      pkg("lib", { dependencies: { "no-deps": "1.0.0" } }),
      pkg("tool", { devDependencies: { lib: "workspace:*" }, dependencies: { "a-dep": "1.0.1" } }),
      pkg("lone", { dependencies: { "peer-no-deps": "1.0.0" } }),
    ]);

    const links = {
      "left-pad": join(packageDir, "node_modules", "left-pad"),
      "is-number": join(packageDir, "packages", "app", "node_modules", "is-number"),
      "no-deps": join(packageDir, "packages", "lib", "node_modules", "no-deps"),
      "a-dep": join(packageDir, "packages", "tool", "node_modules", "a-dep"),
      "peer-no-deps": join(packageDir, "packages", "lone", "node_modules", "peer-no-deps"),
    };
    const stores = {
      "left-pad": "left-pad@1.0.0",
      "is-number": "is-number@1.0.0",
      "no-deps": "no-deps@1.0.0",
      "a-dep": "a-dep@1.0.1",
      "peer-no-deps": "peer-no-deps@1.0.0",
    };
    const names = Object.keys(links) as (keyof typeof links)[];

    async function state() {
      const [linked, stored, workspaceLinks] = await Promise.all([
        Promise.all(names.map(name => exists(join(links[name], "package.json")))),
        Promise.all(names.map(name => exists(join(packageDir, "node_modules", ".bun", stores[name])))),
        Promise.all(["app", "tool"].map(name => exists(join(packageDir, "packages", name, "node_modules", "lib")))),
      ]);
      return {
        linked: Object.fromEntries(names.map((name, i) => [name, linked[i]])),
        stored: Object.fromEntries(names.map((name, i) => [name, stored[i]])),
        workspaceLinks: { app: workspaceLinks[0], tool: workspaceLinks[1] },
      };
    }

    async function installWithFilter(filter: string) {
      await Promise.all([
        rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
        ...["app", "lib", "tool", "lone"].map(name =>
          rm(join(packageDir, "packages", name, "node_modules"), { recursive: true, force: true }),
        ),
      ]);
      await using proc = spawn({
        cmd: [bunExe(), "install", "--linker", "isolated", "--filter", filter],
        cwd: packageDir,
        stdout: "ignore",
        stderr: "pipe",
        env,
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      return exitCode;
    }

    // lib and everything that depends on it (app, tool); not the root or lone
    expect(await installWithFilter("...lib")).toBe(0);
    expect(await state()).toStrictEqual({
      linked: { "left-pad": false, "is-number": true, "no-deps": true, "a-dep": true, "peer-no-deps": false },
      stored: { "left-pad": false, "is-number": true, "no-deps": true, "a-dep": true, "peer-no-deps": false },
      workspaceLinks: { app: true, tool: true },
    });

    // every workspace except the root
    expect(await installWithFilter("!root")).toBe(0);
    expect(await state()).toStrictEqual({
      linked: { "left-pad": false, "is-number": true, "no-deps": true, "a-dep": true, "peer-no-deps": true },
      stored: { "left-pad": false, "is-number": true, "no-deps": true, "a-dep": true, "peer-no-deps": true },
      workspaceLinks: { app: true, tool: true },
    });

    // the root by name: only its own dependencies
    expect(await installWithFilter("root")).toBe(0);
    expect(await state()).toStrictEqual({
      linked: { "left-pad": true, "is-number": false, "no-deps": false, "a-dep": false, "peer-no-deps": false },
      stored: { "left-pad": true, "is-number": false, "no-deps": false, "a-dep": false, "peer-no-deps": false },
      workspaceLinks: { app: false, tool: false },
    });

    // a selected workspace still gets the workspaces it depends on
    expect(await installWithFilter("app")).toBe(0);
    expect(await state()).toStrictEqual({
      linked: { "left-pad": false, "is-number": true, "no-deps": true, "a-dep": false, "peer-no-deps": false },
      stored: { "left-pad": false, "is-number": true, "no-deps": true, "a-dep": false, "peer-no-deps": false },
      workspaceLinks: { app: true, tool: false },
    });
  });
});

test.concurrent("can override npm package with workspace package under a different name", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
        dependencies: {
          "one-dep": "1.0.0",
        },
        overrides: {
          "no-deps": "workspace:packages/pkg1",
        },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "2.2.2",
      }),
    ),
  ]);

  var { exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });

  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "pkg1",
    version: "2.2.2",
  });

  // another install can use the existing bun.lock successfully
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  ({ exited } = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: packageDir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  }));

  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "pkg1",
    version: "2.2.2",
  });
});

// packages/m is a member named no-deps, and the root has `overrides: { "no-deps": "2.0.0" }`. A rule does not apply to
// the member ("overrides do not apply to workspaces"). It does apply to every dependency on that name, as in Bun 1.4,
// also to one that would link the member.
describe.each(["hoisted", "isolated"])("an override for the name of a member, %s linker", linker => {
  type Shape = {
    title: string;
    /** `version` of packages/m */
    member?: string;
    root?: object;
    /** packages/bar */
    bar?: object;
    /** `[from, version]`: the no-deps found from that directory of the project. */
    sees: [string, string | undefined][];
  };
  test.concurrent.each<Shape>([
    {
      title: "applies to a sibling's range that would link it",
      member: "1.0.0",
      bar: { dependencies: { "no-deps": "^1.0.0" } },
      sees: [["packages/bar", "2.0.0"]],
    },
    {
      title: "applies to a sibling's * on a member without a version",
      bar: { dependencies: { "no-deps": "*" } },
      sees: [["packages/bar", "2.0.0"]],
    },
    {
      title: "applies to a sibling's workspace:*",
      member: "1.0.0",
      bar: { dependencies: { "no-deps": "workspace:*" } },
      sees: [["packages/bar", "2.0.0"]],
    },
    {
      title: "applies to a sibling's catalog: range that would link it",
      member: "1.0.0",
      root: { catalog: { "no-deps": "^1.0.0" } },
      bar: { dependencies: { "no-deps": "catalog:" } },
      sees: [["packages/bar", "2.0.0"]],
    },
    {
      title: "gives a sibling's peer no copy: it finds the member at the root",
      member: "1.0.0",
      bar: { peerDependencies: { "no-deps": "^1.0.0" } },
      sees: [["packages/bar", "1.0.0"]],
    },
    {
      title: "applies to the root's range that would link it, and to a registry package",
      member: "1.0.0",
      // one-dep depends on no-deps@1.0.1
      root: { dependencies: { "no-deps": "^1.0.0", "one-dep": "1.0.0" } },
      sees: [
        ["", "2.0.0"],
        ["node_modules/one-dep", "2.0.0"],
      ],
    },
    {
      title: "applies to a sibling's range that does not link it",
      member: "1.0.0",
      bar: { dependencies: { "no-deps": "^3.0.0" } },
      sees: [["packages/bar", "2.0.0"]],
    },
  ])("$title", async ({ member, root, bar, sees }) => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({ name: "root", workspaces: ["packages/*"], overrides: { "no-deps": "2.0.0" }, ...root }),
      ),
      write(join(packageDir, "packages", "m", "package.json"), JSON.stringify({ name: "no-deps", version: member })),
      bar && write(join(packageDir, "packages", "bar", "package.json"), JSON.stringify({ name: "bar", ...bar })),
    ]);
    const install = async (...args: string[]) => {
      await using proc = spawn({
        cmd: [bunExe(), "install", "--linker", linker, ...args],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(exitCode).toBe(0);
      return { out, err };
    };
    const check = async () => {
      for (const [from, version] of sees) {
        let dir = realpathSync(join(packageDir, from));
        while (!existsSync(join(dir, "node_modules", "no-deps", "package.json"))) dir = dirname(dir);
        const found = await file(join(dir, "node_modules", "no-deps", "package.json")).json();
        expect([from, found]).toEqual([from, { name: "no-deps", version }]);
      }
    };

    expect((await install()).err).toContain("Saved lockfile");
    await check();
    const lockfile = await file(join(packageDir, "bun.lock")).text();
    expect((await install()).out).toContain("(no changes)");
    await Promise.all(
      ["", "packages/bar", "packages/m"].map(dir =>
        rm(join(packageDir, dir, "node_modules"), { recursive: true, force: true }),
      ),
    );
    await install("--frozen-lockfile");
    await check();
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
  });

  test.concurrent.each(["workspace:*", "^1.0.0"])(
    "keeps the bun.lock that Bun 1.4 wrote for a sibling's %s",
    async spec => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const install = async (...args: string[]) => {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--linker", linker, ...args],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect({ args, err, exitCode }).toEqual({ args, err: expect.not.stringContaining("error:"), exitCode: 0 });
      };

      // The row of no-deps@2.0.0, with the URL and the hash of this registry.
      await write(packageJson, JSON.stringify({ name: "root", dependencies: { "no-deps": "2.0.0" } }));
      await install("--lockfile-only");
      const published = (await file(join(packageDir, "bun.lock")).text()).match(
        /"no-deps": (\["no-deps@2\.0\.0".*\]),/,
      )![1];

      const lockfile = `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "root",
    },
    "packages/bar": {
      "name": "bar",
      "dependencies": {
        "no-deps": "${spec}",
      },
    },
    "packages/m": {
      "name": "no-deps",
      "version": "1.0.5",
    },
  },
  "overrides": {
    "no-deps": "2.0.0",
  },
  "packages": {
    "bar": ["bar@workspace:packages/bar"],

    "no-deps": ["no-deps@workspace:packages/m"],

    "bar/no-deps": ${published},
  }
}
`;
      await Promise.all([
        write(
          packageJson,
          JSON.stringify({ name: "root", workspaces: ["packages/*"], overrides: { "no-deps": "2.0.0" } }),
        ),
        write(join(packageDir, "packages", "m", "package.json"), JSON.stringify({ name: "no-deps", version: "1.0.5" })),
        write(
          join(packageDir, "packages", "bar", "package.json"),
          JSON.stringify({ name: "bar", dependencies: { "no-deps": spec } }),
        ),
        write(join(packageDir, "bun.lock"), lockfile),
      ]);

      await install("--frozen-lockfile");
      await install();
      expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
      expect(await file(join(packageDir, "packages", "bar", "node_modules", "no-deps", "package.json")).json()).toEqual(
        {
          name: "no-deps",
          version: "2.0.0",
        },
      );
    },
  );
});

test.concurrent("overrides in workspace packages and root pnpm.overrides are ignored", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { "one-range-dep": "1.0.0" },
        pnpm: { overrides: { "no-deps": "1.0.0" } },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "1.0.0" },
        resolutions: { "no-deps": "1.0.0" },
      }),
    ),
  ]);

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
    name: "no-deps",
    version: "1.1.0",
  });
  const lock = Bun.JSONC.parse(await file(join(packageDir, "bun.lock")).text()) as any;
  expect(Object.keys(lock).sort()).toStrictEqual(["configVersion", "lockfileVersion", "packages", "workspaces"]);
  expect(Object.keys(lock.packages).sort()).toStrictEqual(["no-deps", "one-range-dep", "pkg1"]);
  expect(lock.packages["no-deps"][0]).toBe("no-deps@1.1.0");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "workspace: dependencies declared inside a tarball package do not create workspace packages",
  async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    const marker = join(packageDir, "extra-postinstall.txt");
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            lib: "file:./lib.tgz",
          },
        }),
      ),
      Bun.Archive.write(
        join(packageDir, "lib.tgz"),
        {
          "lib/package.json": JSON.stringify({
            name: "lib",
            version: "1.0.0",
            optionalDependencies: {
              extra: "workspace:extra",
            },
          }),
          "lib/extra/package.json": JSON.stringify({
            name: "extra",
            version: "1.0.0",
            scripts: {
              postinstall: `${bunExe()} postinstall.js`,
            },
          }),
          "lib/extra/postinstall.js": `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`,
        },
        { compress: "gzip" },
      ),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).not.toContain("error:");
    expect(out).toContain("1 package installed");
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["lib"]);
    expect(await file(join(packageDir, "node_modules", "lib", "package.json")).json()).toEqual({
      name: "lib",
      version: "1.0.0",
      optionalDependencies: {
        extra: "workspace:extra",
      },
    });
    expect(await exists(marker)).toBeFalse();
    const lockfile = parseLockfile(packageDir);
    expect(lockfile.workspace_paths).toEqual({});
    expect(lockfile.packages.map((pkg: any) => pkg.name).sort()).toEqual(["foo", "lib"]);
    expect(exitCode).toBe(0);
  },
);

describe("LinkWorkspacePackages", () => {
  // Shared setup previously done in a `beforeEach`: each test gets its own dir,
  // a root workspace package.json, and a `no-deps` workspace package.
  async function setupWorkspace(packageDir: string): Promise<string> {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
        }),
      ),

      write(
        join(packageDir, "packages", "mono", "package.json"),
        JSON.stringify({
          name: "no-deps",
          version: "2.0.0",
        }),
      ),
    ]);
    return join(packageDir, "bunfig.toml");
  }

  test.concurrent("linkWorkspacePackages = false uses registry instead of linking workspace packages", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    const bunfigPath = await setupWorkspace(packageDir);
    // Create bunfig.toml with linkWorkspacePackages set to false
    await Promise.all([
      write(
        bunfigPath,
        Bun.TOML.stringify({
          install: {
            linkWorkspacePackages: false,
            registry: verdaccio.registryUrl(),
          },
        }),
      ),

      write(
        join(packageDir, "packages", "bar", "package.json"),
        JSON.stringify({
          name: "bar",
          version: "1.0.0",
          dependencies: {
            "no-deps": "2.0.0", // Use Same version as workspace package and it shouldn't link
          },
        }),
      ),
    ]);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), `-c=${bunfigPath}`, "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    const out = await stdout.text();

    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    const lockfile = parseLockfile(packageDir);

    // Check the resolution tag to ensure it's not a workspace link
    const barPackage = lockfile.packages.find(p => p.name === "bar");
    expect(barPackage.dependencies.length).toEqual(1);
    const barDependency = lockfile.dependencies.find(p => p.id === barPackage.dependencies[0]);
    expect(barDependency).toBeDefined();

    // Verify that the dependency linked to the bar package is the npm version, not the workspace version
    expect(lockfile.packages.find(p => p.id === barDependency?.package_id).resolution.tag).toEqual("npm");
  });

  test.concurrent("linkWorkspacePackages = false but workspace: prefix still links workspace", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    const bunfigPath = await setupWorkspace(packageDir);
    // Create bunfig.toml with linkWorkspacePackages set to false
    await Promise.all([
      write(
        bunfigPath,
        Bun.TOML.stringify({
          install: {
            linkWorkspacePackages: false,
            registry: verdaccio.registryUrl(),
          },
        }),
      ),

      write(
        join(packageDir, "packages", "bar", "package.json"),
        JSON.stringify({
          name: "bar",
          version: "1.0.0",
          dependencies: {
            "no-deps": "workspace:*", // Explicit workspace: prefix should still link
          },
        }),
      ),
    ]);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), `-c=${bunfigPath}`, "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    const out = await stdout.text();

    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
    const lockfile = parseLockfile(packageDir);

    // Check the resolution tag to ensure it's not a workspace link
    const barPackage = lockfile.packages.find(p => p.name === "bar");
    expect(barPackage.dependencies.length).toEqual(1);
    const barDependency = lockfile.dependencies.find(p => p.id === barPackage.dependencies[0]);
    expect(barDependency).toBeDefined();

    // Verify that the dependency linked to the bar package is the workspace version (using the workspace: prefix), not the npm version
    expect(lockfile.packages.find(p => p.id === barDependency?.package_id).resolution.tag).toEqual("workspace");
  });
});

test("matching workspace devDependency and npm peerDependency", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
      }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        devDependencies: {
          "no-deps": "workspace:*", // resolves to ./packages/pkg2
        },
        peerDependencies: {
          "no-deps": "2.0.0", // npm peerDependency
        },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg2", "package.json"),
      JSON.stringify({
        name: "no-deps",
        version: "1.0.0",
      }),
    ),
  ]);

  // first install should resolve both
  let { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  expect(await exited).toBe(0);

  // both dependencies should be included in the lockfile
  expect((await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"))
    .toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "foo",
        },
        "packages/pkg1": {
          "name": "pkg1",
          "version": "1.0.0",
          "devDependencies": {
            "no-deps": "workspace:*",
          },
          "peerDependencies": {
            "no-deps": "2.0.0",
          },
        },
        "packages/pkg2": {
          "name": "no-deps",
          "version": "1.0.0",
        },
      },
      "packages": {
        "no-deps": ["no-deps@workspace:packages/pkg2"],

        "pkg1": ["pkg1@workspace:packages/pkg1"],
      }
    }
    "
  `);

  // another install does not think there's a diff between lockfile and package.jsons
  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--verbose"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(await exited).toBe(0);

  const out = await stdout.text();
  const err = await stderr.text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("updated");
  expect(out).toContain("no changes");
});

// bun.lock stores a workspace's dependencies as the specifiers written in its package.json, so
// loading it has to rebuild exactly the dependencies parsing that package.json produces: on the
// next install the two are diffed, and any dependency that differs makes the install report the
// workspace as updated and re-resolve it, on every install, with nothing changed on disk.
//
// Parsing makes a dependency a workspace dependency (version = the workspace's path) only when its
// specifier links the workspace: `workspace:` or an npm range the workspace's version satisfies.
// Anything else that ends up resolved to the workspace keeps its parsed version. Every entry is
// classified on its own, including a name listed in more than one dependency group.
//
// Peers, overridden entries, catalog entries holding `workspace:` and dist-tags the registry does
// not have are bound to the workspace with linkWorkspacePackages on or off and load as parsed.
describe("dependencies on a workspace load from bun.lock the way package.json parses them", () => {
  const linked = "workspace packages/pkg2";

  // setupTest's bunfig.toml, plus linkWorkspacePackages = false
  async function disableLinking(packageDir: string) {
    await write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: join(packageDir, ".bun-cache"),
          registry: verdaccio.registryUrl(),
          linker: "hoisted",
          linkWorkspacePackages: false,
        },
      }),
    );
  }

  // One line per dependency on `depName` declared by `pkgName`, in lockfile order (dev, optional,
  // prod, peer): the groups it is declared in, the specifier, and what it was loaded as. Every one
  // of them must also resolve to the workspace package.
  function loadedDependencies(packageDir: string, pkgName: string, depName: string): string[] {
    const lockfile = parseLockfile(packageDir);
    const pkg = lockfile.packages.find((p: any) => p.name === pkgName);
    const workspacePkg = lockfile.packages.find((p: any) => p.resolution.value === "workspace:packages/pkg2");
    return pkg.dependencies
      .map((id: number) => lockfile.dependencies[id])
      .filter((dep: any) => dep.name === depName)
      .map((dep: any) => {
        expect(dep.package_id).toBe(workspacePkg.id);
        const loadedAs =
          "workspace" in dep
            ? `workspace ${dep.workspace}`
            : "npm" in dep
              ? "npm"
              : "catalog" in dep
                ? "catalog"
                : "dist_tag" in dep
                  ? "dist-tag"
                  : JSON.stringify(dep);
        return `${Object.keys(dep.behavior).join("+")} ${JSON.stringify(dep.literal)} -> ${loadedAs}`;
      });
  }

  const cases: {
    label: string;
    /** dependency groups of packages/pkg1 */
    pkg1: Record<string, Record<string, string>>;
    /** root `workspaces.catalog` */
    catalog?: Record<string, string>;
    /** root `overrides` */
    overrides?: Record<string, string>;
    linkWorkspacePackages?: false;
    /** the name pkg1 declares the dependency under, when not `no-deps` itself */
    declaredAs?: string;
    loaded: string[];
  }[] = [
    {
      label: "workspace:* in dependencies and devDependencies",
      pkg1: { dependencies: { "no-deps": "workspace:*" }, devDependencies: { "no-deps": "workspace:*" } },
      loaded: [`dev "workspace:*" -> ${linked}`, `prod "workspace:*" -> ${linked}`],
    },
    {
      label: "workspace:* in dependencies and peerDependencies",
      pkg1: { dependencies: { "no-deps": "workspace:*" }, peerDependencies: { "no-deps": "workspace:*" } },
      loaded: [`prod "workspace:*" -> ${linked}`, `peer "workspace:*" -> ${linked}`],
    },
    {
      label: "workspace:* in dependencies and optionalDependencies",
      pkg1: { dependencies: { "no-deps": "workspace:*" }, optionalDependencies: { "no-deps": "workspace:*" } },
      loaded: [`optional "workspace:*" -> ${linked}`, `prod "workspace:*" -> ${linked}`],
    },
    {
      label: "workspace:* in dependencies, devDependencies and peerDependencies",
      pkg1: {
        dependencies: { "no-deps": "workspace:*" },
        devDependencies: { "no-deps": "workspace:*" },
        peerDependencies: { "no-deps": "workspace:*" },
      },
      loaded: [`dev "workspace:*" -> ${linked}`, `prod "workspace:*" -> ${linked}`, `peer "workspace:*" -> ${linked}`],
    },
    {
      label: "a satisfied range in dependencies and devDependencies",
      pkg1: { dependencies: { "no-deps": "^1.0.0" }, devDependencies: { "no-deps": "^1.0.0" } },
      loaded: [`dev "^1.0.0" -> ${linked}`, `prod "^1.0.0" -> ${linked}`],
    },
    {
      // the range names the workspace, the entry does not
      label: "a satisfied range aliased in dependencies and devDependencies",
      pkg1: {
        dependencies: { "deps-alias": "npm:no-deps@^1.0.0" },
        devDependencies: { "deps-alias": "npm:no-deps@^1.0.0" },
      },
      declaredAs: "deps-alias",
      loaded: [`dev "npm:no-deps@^1.0.0" -> ${linked}`, `prod "npm:no-deps@^1.0.0" -> ${linked}`],
    },
    {
      label: "workspace:* in devDependencies and a satisfied range in peerDependencies",
      pkg1: { devDependencies: { "no-deps": "workspace:*" }, peerDependencies: { "no-deps": "^1.0.0" } },
      loaded: [`dev "workspace:*" -> ${linked}`, `peer "^1.0.0" -> ${linked}`],
    },
    {
      label: "workspace:* in devDependencies and an unsatisfied range in peerDependencies",
      pkg1: { devDependencies: { "no-deps": "workspace:*" }, peerDependencies: { "no-deps": "2.0.0" } },
      loaded: [`dev "workspace:*" -> ${linked}`, `peer "2.0.0" -> npm`],
    },
    {
      label: "an unsatisfied range in peerDependencies",
      pkg1: { peerDependencies: { "no-deps": "2.0.0" } },
      loaded: [`peer "2.0.0" -> npm`],
    },
    {
      label: "a catalog entry pointing at the workspace",
      pkg1: { dependencies: { "no-deps": "catalog:" } },
      catalog: { "no-deps": "workspace:*" },
      loaded: [`prod "catalog:" -> catalog`],
    },
    {
      // the registry has no such tag, so the resolver links the workspace
      label: "a dist-tag the registry does not have",
      pkg1: { dependencies: { "no-deps": "no-such-tag" } },
      loaded: [`prod "no-such-tag" -> dist-tag`],
    },
    {
      label: "an override sends an unsatisfied range to the workspace",
      pkg1: { dependencies: { "no-deps": "^5.0.0" } },
      overrides: { "no-deps": "workspace:*" },
      loaded: [`prod "^5.0.0" -> npm`],
    },
    {
      label: "linkWorkspacePackages off: workspace:* in dependencies and devDependencies",
      pkg1: { dependencies: { "no-deps": "workspace:*" }, devDependencies: { "no-deps": "workspace:*" } },
      linkWorkspacePackages: false,
      loaded: [`dev "workspace:*" -> ${linked}`, `prod "workspace:*" -> ${linked}`],
    },
    {
      label: "linkWorkspacePackages off: an unsatisfied range in peerDependencies",
      pkg1: { peerDependencies: { "no-deps": "2.0.0" } },
      linkWorkspacePackages: false,
      loaded: [`peer "2.0.0" -> npm`],
    },
    {
      label: "linkWorkspacePackages off: workspace:* in devDependencies and an unsatisfied range in peerDependencies",
      pkg1: { devDependencies: { "no-deps": "workspace:*" }, peerDependencies: { "no-deps": "2.0.0" } },
      linkWorkspacePackages: false,
      loaded: [`dev "workspace:*" -> ${linked}`, `peer "2.0.0" -> npm`],
    },
    {
      label: "linkWorkspacePackages off: a catalog entry pointing at the workspace",
      pkg1: { dependencies: { "no-deps": "catalog:" } },
      catalog: { "no-deps": "workspace:*" },
      linkWorkspacePackages: false,
      loaded: [`prod "catalog:" -> catalog`],
    },
    {
      label: "linkWorkspacePackages off: a dist-tag the registry does not have",
      pkg1: { dependencies: { "no-deps": "no-such-tag" } },
      linkWorkspacePackages: false,
      loaded: [`prod "no-such-tag" -> dist-tag`],
    },
    {
      label: "linkWorkspacePackages off: an override sends an unsatisfied range to the workspace",
      pkg1: { dependencies: { "no-deps": "^5.0.0" } },
      overrides: { "no-deps": "workspace:*" },
      linkWorkspacePackages: false,
      loaded: [`prod "^5.0.0" -> npm`],
    },
  ];

  for (const { label, pkg1, catalog, overrides, linkWorkspacePackages, declaredAs = "no-deps", loaded } of cases) {
    test.concurrent(label, async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      if (linkWorkspacePackages === false) await disableLinking(packageDir);
      await Promise.all([
        write(
          packageJson,
          JSON.stringify({
            name: "foo",
            workspaces: catalog ? { packages: ["packages/*"], catalog } : ["packages/*"],
            overrides,
          }),
        ),
        write(
          join(packageDir, "packages", "pkg1", "package.json"),
          JSON.stringify({ name: "pkg1", version: "1.0.0", ...pkg1 }),
        ),
        write(
          join(packageDir, "packages", "pkg2", "package.json"),
          JSON.stringify({ name: "no-deps", version: "1.0.0" }),
        ),
      ]);

      // A peer range the workspace does not satisfy is bound to it anyway, with a warning.
      const allowWarnings = label.includes("unsatisfied range in peerDependencies");
      await runBunInstall(env, packageDir, { allowWarnings });
      // parseLockfile loads with this test process's settings (linking on); for the linking-off rows the
      // install below, which reads the fixture's bunfig.toml, is what exercises that setting.
      expect(loadedDependencies(packageDir, "pkg1", declaredAs)).toEqual(loaded);

      // nothing changed, so the second install must not report pkg1 as changed
      // ("Workspace package "packages/pkg1" has added 0 dependencies, removed 0 dependencies, and updated 1 dependencies")
      const { err } = await runBunInstall(env, packageDir, { savesLockfile: false, verbose: true, allowWarnings });
      expect(err).not.toContain('Workspace package "packages/pkg1"');
    });
  }

  test.concurrent("the root lists a workspace in dependencies and devDependencies", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: { "no-deps": "workspace:*" },
          devDependencies: { "no-deps": "workspace:*" },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({ name: "no-deps", version: "1.0.0" }),
      ),
    ]);

    // the root warns "Duplicate dependency" and keeps both entries, next to the entry every
    // workspace gets
    const { err } = await runBunInstall(env, packageDir, { allowWarnings: true });
    expect(err).toContain('Duplicate dependency: "no-deps"');
    expect(loadedDependencies(packageDir, "foo", "no-deps")).toEqual([
      `workspace "" -> ${linked}`,
      `dev "workspace:*" -> ${linked}`,
      `prod "workspace:*" -> ${linked}`,
    ]);

    // (the root has no per-package "has added ..." message; what it loads as, above, is what gets diffed)
    await runBunInstall(env, packageDir, { allowWarnings: true, savesLockfile: false });
  });

  // The range is checked against the version bun.lock recorded, so a workspace that moved out of
  // range is still noticed and the dependency re-resolved.
  test.concurrent("a workspace bumped out of a range is re-resolved", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    const pkg2Json = join(packageDir, "packages", "pkg2", "package.json");
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "foo", workspaces: ["packages/*"] })),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "^1.0.0" } }),
      ),
      write(pkg2Json, JSON.stringify({ name: "no-deps", version: "1.0.0" })),
    ]);

    await runBunInstall(env, packageDir);
    expect(loadedDependencies(packageDir, "pkg1", "no-deps")).toEqual([`prod "^1.0.0" -> ${linked}`]);

    await write(pkg2Json, JSON.stringify({ name: "no-deps", version: "3.0.0" }));
    const { err } = await runBunInstall(env, packageDir, { verbose: true });
    expect(err).toContain(
      'Workspace package "packages/pkg1" has added 0 dependencies, removed 0 dependencies, and updated 1 dependencies',
    );

    // ^1.0.0 now comes from the registry
    expect(pkg1Resolution(packageDir)).toMatchObject({ tag: "npm", value: "1.1.0" });
  });

  /** what pkg1's only dependency resolves to */
  function pkg1Resolution(packageDir: string) {
    const lockfile = parseLockfile(packageDir);
    const pkg1 = lockfile.packages.find((p: any) => p.name === "pkg1");
    expect(pkg1.dependencies).toHaveLength(1);
    const dep = lockfile.dependencies[pkg1.dependencies[0]];
    return lockfile.packages.find((p: any) => p.id === dep.package_id).resolution;
  }
});

// While linking, the hoisted installer formats each package's version label (its
// version, or for tarball/folder/git packages the spec it was resolved from) into a
// 512 byte stack buffer. Labels longer than that used to abort the whole install.
describe("packages whose version label is longer than 512 bytes", () => {
  // Long enough to overflow the buffer, but `x/../` normalizes away, so the tarball
  // still lives at a short path that is valid on every platform. The resolution
  // recorded in the lockfile (and formatted by the installer) is the spec verbatim.
  const longTarballSpec = (tarball: string) => `./${Buffer.alloc(650, "x/../").toString()}${tarball}`;

  async function installHoisted(ctx: TestCtx) {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker", "hoisted"],
      cwd: ctx.packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: ctx.env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(out).toContain("1 package installed");
    expect(exitCode).toBe(0);
  }

  test.concurrent("local tarball", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson } = ctx;
    const spec = longTarballSpec("bar-0.0.2.tgz");
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "foo", dependencies: { bar: spec } })),
      cp(join(import.meta.dir, "bar-0.0.2.tgz"), join(packageDir, "bar-0.0.2.tgz")),
    ]);

    await installHoisted(ctx);

    expect(await file(join(packageDir, "bun.lock")).text()).toContain(`"bar@${spec}"`);
    expect(await file(join(packageDir, "node_modules", "bar", "package.json")).json()).toEqual({
      name: "bar",
      version: "0.0.2",
    });
  });

  test.concurrent("remote tarball", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson } = ctx;
    const tarball = file(join(import.meta.dir, "bar-0.0.2.tgz"));
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(tarball),
    });
    const url = `${server.url}${Buffer.alloc(600, "a").toString()}/bar-0.0.2.tgz`;
    await write(packageJson, JSON.stringify({ name: "foo", dependencies: { bar: url } }));

    await installHoisted(ctx);

    expect(await file(join(packageDir, "bun.lock")).text()).toContain(`"bar@${url}"`);
    expect(await file(join(packageDir, "node_modules", "bar", "package.json")).json()).toEqual({
      name: "bar",
      version: "0.0.2",
    });
  });

  // Workspace packages are labeled with their own version rather than a resolution.
  test.concurrent("workspace package with a long prerelease version", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson } = ctx;
    const version = `1.0.0-${Buffer.alloc(600, "a").toString()}`;
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "foo", workspaces: ["pkgs/*"] })),
      write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version })),
    ]);

    await installHoisted(ctx);

    expect(await file(join(packageDir, "node_modules", "pkg1", "package.json")).json()).toEqual({
      name: "pkg1",
      version,
    });
  });

  // The same label is the version half of the `name@version` patchedDependencies key,
  // so a patch keyed by a long spec has to be found and applied, not just not crash.
  test.concurrent("patchedDependencies keyed by the long label is applied", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson } = ctx;
    const spec = longTarballSpec("baz-0.0.3.tgz");
    const patch = [
      "diff --git a/index.js b/index.js",
      "--- a/index.js",
      "+++ b/index.js",
      "@@ -1,3 +1,3 @@",
      " #! /usr/bin/env node",
      " ",
      '-console.log("run baz");',
      '+console.log("patched baz");',
      "",
    ].join("\n");
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: { baz: spec },
          patchedDependencies: { [`baz@${spec}`]: "patches/baz.patch" },
        }),
      ),
      write(join(packageDir, "patches", "baz.patch"), patch),
      cp(join(import.meta.dir, "baz-0.0.3.tgz"), join(packageDir, "baz-0.0.3.tgz")),
    ]);

    await installHoisted(ctx);

    expect(await file(join(packageDir, "node_modules", "baz", "index.js")).text()).toBe(
      '#! /usr/bin/env node\n\nconsole.log("patched baz");\n',
    );
  });
});

// A hardlink install leaves hardlinks of cache files in each node_modules it writes.
// After only the root node_modules is removed, the next install does not delete
// anything first, so a workspace's own node_modules still holds those hardlinks. A copy
// over them must replace the files. Writing through them empties the cache files.
test.concurrent("a copyfile install over a workspace's hardlinked files does not empty the cache", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({ name: "foo", workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({ name: "pkg1", version: "1.0.0", dependencies: { "no-deps": "2.0.0" } }),
    ),
  ]);

  async function install(backend: "hardlink" | "copyfile") {
    await using proc = spawn({
      cmd: [bunExe(), "install", `--backend=${backend}`],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  const readJson = (path: string) => {
    expect(statSync(path).size).toBeGreaterThan(0);
    return JSON.parse(readFileSync(path, "utf8"));
  };

  const nestedPkgJson = join(packageDir, "packages", "pkg1", "node_modules", "no-deps", "package.json");
  await install("hardlink");
  expect(readJson(nestedPkgJson)).toEqual({ name: "no-deps", version: "2.0.0" });
  if (!isWindows) {
    expect(statSync(nestedPkgJson).nlink).toBeGreaterThan(1);
  }

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await install("copyfile");

  expect(readJson(nestedPkgJson)).toEqual({ name: "no-deps", version: "2.0.0" });
  expect(readJson(join(packageDir, "node_modules", "no-deps", "package.json"))).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });
  if (!isWindows) {
    // a new file, not the cache file's inode
    expect(statSync(nestedPkgJson).nlink).toBe(1);
  }

  const cacheDir = join(packageDir, ".bun-cache");
  const cached = (await readdirSorted(cacheDir)).filter(name => name.startsWith("no-deps@2.0.0@"));
  expect(cached).toHaveLength(1);
  expect(readJson(join(cacheDir, cached[0], "package.json"))).toEqual({ name: "no-deps", version: "2.0.0" });
  expect(statSync(join(cacheDir, cached[0], "index.js")).size).toBeGreaterThan(0);
});

for (const linker of ["hoisted", "isolated"]) {
  // symlinkSync to a directory needs Developer Mode or elevation on Windows.
  test.concurrent.skipIf(isWindows)(`workspace globs match a symlinked member directory (${linker})`, async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    // Its own version of no-deps is installed in its own node_modules, behind the link.
    const member = { name: "s", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } };
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "mono",
          private: true,
          workspaces: ["packages/*"],
          dependencies: { "no-deps": "2.0.0" },
        }),
      ),
      write(join(packageDir, "real", "s", "package.json"), JSON.stringify(member)),
      write(
        join(packageDir, "packages", "b", "package.json"),
        JSON.stringify({ name: "b", version: "1.0.0", dependencies: { s: "workspace:*" } }),
      ),
    ]);
    symlinkSync(join("..", "real", "s"), join(packageDir, "packages", "s"));

    await using proc = spawn({
      cmd: [bunExe(), "install", `--linker=${linker}`],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
    expect(await file(join(packageDir, "bun.lock")).text()).toContain(`"packages/s": {`);
    const linked =
      linker === "hoisted"
        ? join(packageDir, "node_modules", "s", "package.json")
        : join(packageDir, "packages", "b", "node_modules", "s", "package.json");
    expect(await file(linked).json()).toEqual(member);
    expect(await file(join(packageDir, "real", "s", "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
    expect(lstatSync(join(packageDir, "packages", "s")).isSymbolicLink()).toBe(true);
  });
}

// A relative link counts from where it really is, so the real folder is deeper than the link to it.
for (const [link, target] of [
  ["packages/s", "real/deeper/s"],
  ["packages", "real/deeper"],
]) {
  test.concurrent.skipIf(isWindows)(`isolated: a member finds its dependencies when ${link} is a symlink`, async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify({ name: "mono", workspaces: ["packages/*"] })),
      write(
        join(packageDir, "real", "deeper", "s", "package.json"),
        JSON.stringify({ name: "s", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
      ),
    ]);
    mkdirSync(dirname(join(packageDir, link)), { recursive: true });
    symlinkSync(join(packageDir, target), join(packageDir, link));
    const dependency = join(packageDir, "packages", "s", "node_modules", "no-deps", "package.json");

    // The second install finds the links as it would write them.
    for (const expected of ["1 package installed", "(no changes)"]) {
      await using proc = spawn({
        cmd: [bunExe(), "install", "--linker=isolated"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("error:");
      expect(out).toContain(expected);
      expect(await file(dependency).json()).toEqual({ name: "no-deps", version: "1.0.0" });
      expect(exitCode).toBe(0);
    }
  });
}

describe("a workspace outside the project", () => {
  const app = {
    name: "app",
    version: "1.0.0",
    bin: "cli.js",
    scripts: { postinstall: "echo ran > ran.txt" },
    dependencies: { "no-deps": "1.0.0", lib: "^1.0.0" },
  };

  /** `<dir>/project` is the project. `<dir>/app/node_modules/extra` is a folder that Bun didn't install. */
  async function setup(dir: string, root: object, link?: [path: string, target: string]) {
    const project = join(dir, "project");
    await Promise.all([
      verdaccio.writeBunfig(project),
      write(join(project, "package.json"), JSON.stringify({ name: "project", ...root })),
      write(join(project, "packages", "lib", "package.json"), JSON.stringify({ name: "lib", version: "1.2.3" })),
      write(join(dir, "app", "package.json"), JSON.stringify(app)),
      write(join(dir, "app", "cli.js"), "#!/usr/bin/env node\n"),
      write(join(dir, "app", "node_modules", "extra", "package.json"), JSON.stringify({ name: "extra" })),
    ]);
    if (link) {
      const parent = dirname(join(project, link[0]));
      mkdirSync(parent, { recursive: true });
      // A junction needs no privilege on Windows. Its target is absolute.
      symlinkSync(isWindows ? resolve(parent, link[1]) : link[1], join(project, link[0]), "junction");
    }
    return project;
  }

  async function run(cwd: string, env: Record<string, string>, ...args: string[]) {
    await using proc = spawn({ cmd: [bunExe(), ...args], cwd, stdout: "pipe", stderr: "pipe", env });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  // `entry`: in "workspaces". `spec`: of the root's dependency on it. `path`: in bun.lock.
  const layouts: { entry?: string; spec?: string; path: string; link?: [path: string, target: string] }[] = [
    { entry: "../app", path: "../app" },
    { entry: "../*", path: "../app" },
    { entry: "packages/../../app", path: "../app" },
    { entry: "<dir>/app", path: "../app" },
    { spec: "workspace:../app", path: "../app" },
    { entry: "link", path: "link", link: ["link", "../app"] },
    { entry: "up/app", path: "up/app", link: ["up", ".."] },
    { entry: "linked/*", path: "linked/app", link: ["linked/app", "../../app"] },
  ];

  describe.each(["hoisted", "isolated"])("%s linker", linker => {
    const named = layouts.map(layout => [layout.entry ?? layout.spec, layout] as const);
    test.concurrent.each(named)("%s gets its dependencies installed and its scripts run", async (_, layout) => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      const { entry, spec = "workspace:*", path, link } = layout;
      const project = await setup(
        packageDir,
        {
          workspaces: ["packages/*", ...(entry ? [entry.replace("<dir>", packageDir)] : [])],
          dependencies: { "no-deps": "2.0.0", app: spec },
        },
        link,
      );

      const { err, exitCode } = await run(project, env, "install", `--linker=${linker}`);
      expect(err).not.toContain("error:");
      expect(err).not.toContain("failed to");
      expect(err).not.toContain("note:");
      const version = async (...folder: string[]) => (await file(join(...folder, "package.json")).json()).version;
      expect({
        inApp: await version(packageDir, "app", "node_modules", "no-deps"),
        inProject: await version(project, "node_modules", "no-deps"),
        ranScript: existsSync(join(packageDir, "app", "ran.txt")),
        keptExtra: existsSync(join(packageDir, "app", "node_modules", "extra")),
      }).toEqual({ inApp: "1.0.0", inProject: "2.0.0", ranScript: true, keptExtra: true });
      expect(realpathSync(join(project, "node_modules", "app"))).toBe(realpathSync(join(packageDir, "app")));
      expect(exitCode).toBe(0);
      expect(Bun.JSON5.parse(await file(join(project, "bun.lock")).text()).workspaces[path]).toMatchObject({
        name: "app",
        dependencies: app.dependencies,
      });
    });

    // Another project may own the folder.
    test.concurrent("nothing is deleted from its node_modules", async () => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      const project = await setup(packageDir, { workspaces: ["packages/*", "../*"] });

      for (const args of [
        ["install", `--linker=${linker}`],
        ["add", `--linker=${linker}`, "no-deps@2.0.0"],
        ["remove", `--linker=${linker}`, "no-deps"],
        ["prune"],
      ]) {
        const { err, exitCode } = await run(project, env, ...args);
        expect(err).not.toContain("error:");
        expect(err).not.toContain("failed to");
        expect({ args, keptExtra: existsSync(join(packageDir, "app", "node_modules", "extra")) }).toEqual({
          args,
          keptExtra: true,
        });
        expect(exitCode).toBe(0);
      }

      const { out, exitCode } = await run(project, env, "pm", "ls");
      expect(out).toContain(`app@workspace:${join("..", "app")}`);
      expect(exitCode).toBe(0);
    });

    test.concurrent("the project can install a published package of its name", async () => {
      using ctx = await setupTest();
      const { packageDir, env } = ctx;
      const project = await setup(packageDir, {
        workspaces: ["../no-deps"],
        dependencies: { "no-deps": "^2", "a-dep": "1.0.2" },
      });
      const member = { name: "no-deps", version: "0.0.1", dependencies: { "a-dep": "1.0.1" } };
      await write(join(packageDir, "no-deps", "package.json"), JSON.stringify(member));

      const results: Record<string, unknown> = {};
      for (const args of [["install", `--linker=${linker}`], ["pm", "ls"], ["pm", "ls", "--all"], ["prune"]]) {
        const { out, err, exitCode } = await run(project, env, ...args);
        results[args.join(" ")] = {
          errors: err.split("\n").filter(line => /^(error|note):/.test(line)),
          listed: out.split("\n").flatMap(line => line.match(/^[├└]── (.*)$/)?.[1] ?? []),
          exitCode,
        };
      }
      expect(results).toEqual({
        [`install --linker=${linker}`]: { errors: [], listed: [], exitCode: 0 },
        "pm ls": {
          errors: [],
          listed: ["a-dep@1.0.2", `no-deps@workspace:${join("..", "no-deps")}`, "no-deps@2.0.0"],
          exitCode: 0,
        },
        "pm ls --all": { errors: [], listed: ["a-dep@1.0.2", "no-deps@2.0.0"], exitCode: 0 },
        "prune": { errors: [], listed: [], exitCode: 0 },
      });
      expect(await file(join(packageDir, "no-deps", "node_modules", "a-dep", "package.json")).json()).toMatchObject({
        version: "1.0.1",
      });
      const { packages } = Bun.JSON5.parse(await file(join(project, "bun.lock")).text());
      expect(packages["./no-deps/a-dep"][0]).toBe("a-dep@1.0.1");
    });
  });

  test.concurrent.skipIf(isWindows)("a folder with a colon in its name is inside", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    const project = await setup(packageDir, { workspaces: ["a:b/pkg"] });
    const pkg = { name: "pkg", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } };
    await write(join(project, "a:b", "pkg", "package.json"), JSON.stringify(pkg));

    const { err, exitCode } = await run(project, env, "install", "--linker=isolated");
    expect(err).not.toContain("note:");
    expect(await file(join(project, "a:b", "pkg", "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(isWindows)("in a workspace that's a link to a folder somewhere else", () => {
  /** `cwd` and `pwd` are relative to the directory that holds `repo` and `other`. */
  async function install(cwd: string, pwd: string) {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    const app = { name: "app", version: "1.0.0", dependencies: { lib: "workspace:*" } };
    await Promise.all([
      write(join(packageDir, "repo", "package.json"), JSON.stringify({ name: "repo", workspaces: ["packages/*"] })),
      write(join(packageDir, "repo", "packages", "lib", "package.json"), JSON.stringify({ name: "lib" })),
      write(join(packageDir, "other", "package.json"), JSON.stringify({ name: "other", workspaces: ["packages/*"] })),
      write(join(packageDir, "repo", "elsewhere", "app", "package.json"), JSON.stringify(app)),
      write(join(packageDir, "repo", "elsewhere", "app", "src", "index.js"), ""),
    ]);
    symlinkSync(join("..", "elsewhere", "app"), join(packageDir, "repo", "packages", "app"));
    symlinkSync(join("..", "repo", "elsewhere", "app"), join(packageDir, "other", "app"));

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: join(packageDir, cwd),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, PWD: join(packageDir, pwd) },
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const folders = ["repo", "other", "repo/elsewhere/app"];
    const lockfiles = folders.filter(dir => existsSync(join(packageDir, dir, "bun.lock")));
    return { errors: err.split("\n").filter(line => line.startsWith("error:")), lockfiles, exitCode };
  }
  const alone = {
    errors: ['error: Workspace dependency "lib" not found', "error: lib@workspace:* failed to resolve"],
    lockfiles: [],
    exitCode: 1,
  };

  test.concurrent.each(["repo/packages/app", "repo/packages/app/src"])("%s belongs to the project", async cwd => {
    expect(await install(cwd, cwd)).toEqual({ errors: [], lockfiles: ["repo"], exitCode: 0 });
  });

  test.concurrent("bun add and bun remove work", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    const [repo, real] = [join(packageDir, "repo"), "repo/libs/shared"];
    const shared = { name: "shared", version: "1.0.0", dependencies: { "a-dep": "1.0.1" } };
    await Promise.all([
      verdaccio.writeBunfig(repo),
      write(join(repo, "package.json"), JSON.stringify({ name: "repo", workspaces: ["packages/*"] })),
      write(join(packageDir, real, "package.json"), JSON.stringify(shared)),
    ]);
    mkdirSync(join(repo, "packages"));
    symlinkSync(join(packageDir, real), join(repo, "packages", "shared"));

    for (const [cwd, ...args] of [
      [repo, "install"],
      [join(repo, "packages", "shared"), "add", "no-deps"],
      [join(repo, "packages", "shared"), "remove", "a-dep"],
    ]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...env, PWD: cwd, npm_config_registry: verdaccio.registryUrl() },
      });
      const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    const dependencies = { "no-deps": "^2.0.0" };
    expect(await file(join(packageDir, real, "package.json")).json()).toEqual({ ...shared, dependencies });
    const lockfile = Bun.JSON5.parse(await file(join(repo, "bun.lock")).text());
    expect(lockfile.workspaces["packages/shared"]).toEqual({ ...shared, dependencies });
    expect(Object.keys(lockfile.packages).sort()).toEqual(["no-deps", "shared"]);
    expect(existsSync(join(packageDir, real, "bun.lock"))).toBe(false);
  });

  describe.each(["hoisted", "isolated"])("outside the project, with the %s linker", linker => {
    /** `repo/packages/w` is a link to `elsewhere/w`. `at`: where a command is typed, from `dir`. */
    async function setup(dir: string, env: Record<string, string>) {
      const [repo, w] = [join(dir, "repo"), join(dir, "elsewhere", "w")];
      const manifest = {
        name: "w",
        version: "1.0.0",
        scripts: { hi: "echo hi" },
        dependencies: { lib: "workspace:*", "what-bin": "1.0.0" },
      };
      await Promise.all([
        verdaccio.writeBunfig(repo),
        write(join(repo, "package.json"), JSON.stringify({ name: "repo", workspaces: ["packages/*"] })),
        write(join(repo, "packages", "lib", "package.json"), JSON.stringify({ name: "lib", version: "1.0.0" })),
        write(join(w, "package.json"), JSON.stringify(manifest)),
        write(join(w, "src", "index.js"), ""),
      ]);
      symlinkSync(w, join(repo, "packages", "w"));
      const bun = async (at: string, ...args: string[]) => {
        const cwd = join(dir, at);
        await using proc = spawn({
          cmd: [bunExe(), ...args],
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...env, PWD: cwd, npm_config_registry: verdaccio.registryUrl() },
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { out, err, exitCode };
      };
      return { repo, w, bun };
    }

    test.concurrent("commands that install work there, as in any other member", async () => {
      using ctx = await setupTest();
      const { repo, w, bun } = await setup(ctx.packageDir, ctx.env);

      for (const [at, ...args] of [
        ["repo/packages/w", "install", "--linker", linker],
        ["repo/packages/w/src", "install"],
        ["repo/packages/w", "add", "no-deps@1.0.0"],
        ["repo/packages/w", "remove", "what-bin"],
      ]) {
        const { err, exitCode } = await bun(at, ...args);
        expect({ args, err }).toEqual({ args, err: expect.not.stringContaining("error:") });
        expect(exitCode).toBe(0);
      }

      const dependencies = { lib: "workspace:*", "no-deps": "1.0.0" };
      expect((await file(join(w, "package.json")).json()).dependencies).toEqual(dependencies);
      const lockfile = Bun.JSON5.parse(await file(join(repo, "bun.lock")).text());
      expect(lockfile.workspaces["packages/w"].dependencies).toEqual(dependencies);
      expect(existsSync(join(w, "bun.lock"))).toBe(false);
    });

    test.concurrent("a command that only reads works there, as in any other member", async () => {
      using ctx = await setupTest();
      const { repo, bun } = await setup(ctx.packageDir, ctx.env);
      expect((await bun("repo", "install", "--linker", linker)).exitCode).toBe(0);

      for (const [args, printed] of [
        [["pm", "ls"], `${repo} node_modules`],
        [["why", "lib"], "w@workspace (requires workspace:*)"],
        [["outdated"], "what-bin"],
        [["info", "what-bin", "version"], "1.5.0"],
        [["run", "hi"], "hi\n"],
      ] as const) {
        const { out, err, exitCode } = await bun("repo/packages/w", ...args);
        expect({ args, err }).toEqual({ args, err: expect.not.stringContaining("error:") });
        expect(out).toContain(printed);
        expect(exitCode).toBe(0);
      }
    });

    test.concurrent("bun add --filter from the root installs into it", async () => {
      using ctx = await setupTest();
      const { repo, w, bun } = await setup(ctx.packageDir, ctx.env);

      const { out, err, exitCode } = await bun("repo", "add", "no-deps@1.0.0", "--filter", "w", "--linker", linker);
      expect(err).not.toContain("error:");
      expect(err).not.toContain("note:");
      expect(out).toContain("installed no-deps@1.0.0");
      const folder = linker === "hoisted" ? repo : w;
      expect(await file(join(folder, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
        version: "1.0.0",
      });
      expect(exitCode).toBe(0);
    });
  });

  test.concurrent("a $PWD that points to another folder is ignored", async () => {
    expect(await install("repo/elsewhere/app", "repo/packages/lib")).toEqual(alone);
  });

  test.concurrent("a package.json above that does not list the folder is not its project", async () => {
    expect(await install("other/app", "other/app")).toEqual(alone);
  });
});

test.concurrent.skipIf(isWindows)("`**` in a workspace glob does not go through a symlinked directory", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(join(packageDir, "package.json"), JSON.stringify({ name: "mono", workspaces: ["packages/**"] })),
    write(join(packageDir, "packages", "app", "package.json"), JSON.stringify({ name: "app", version: "1.0.0" })),
    write(join(packageDir, "elsewhere", "package.json"), JSON.stringify({ name: "foreign", version: "1.0.0" })),
    write(join(packageDir, "elsewhere", "inner", "package.json"), JSON.stringify({ name: "inner", version: "1.0.0" })),
  ]);
  symlinkSync(join("..", "..", "elsewhere"), join(packageDir, "packages", "app", "vendor"));

  await using proc = spawn({ cmd: [bunExe(), "install"], cwd: packageDir, stdout: "pipe", stderr: "pipe", env });
  const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).not.toContain("error:");
  const members = (await file(join(packageDir, "bun.lock")).text()).matchAll(/^    "([^"]*)": \{$/gm);
  expect(Array.from(members, match => match[1])).toEqual(["", "packages/app"]);
  expect(exitCode).toBe(0);
});

// The npm lockfile migration reads each workspace package.json through the cache of the package manager.
test.concurrent("the package.json cache keeps no mimalloc heap for each file", async () => {
  await acquireSlot();
  using _slot = { [Symbol.dispose]: releaseSlot };
  const files: Record<string, string> = {};
  for (const workspaces of [1, 5, 50]) {
    const packages: Record<string, object> = { "": { name: "root", workspaces: ["packages/*"] } };
    for (let i = 0; i < workspaces; i++) {
      files[`${workspaces}/packages/p${i}/package.json`] = JSON.stringify({ name: `p${i}`, version: "1.0.0" });
      packages[`node_modules/p${i}`] = { resolved: `packages/p${i}`, link: true };
      packages[`packages/p${i}`] = { name: `p${i}`, version: "1.0.0" };
    }
    files[`${workspaces}/package.json`] = JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] });
    files[`${workspaces}/package-lock.json`] = JSON.stringify({ name: "root", lockfileVersion: 3, packages });
  }
  using dir = tempDir("workspace-package-json-heap-count", files);

  const count = `
    const { heapStats } = require("bun:jsc");
    const { parseLockfile } = require("bun:internal-for-testing").install_test_helpers;
    const [root] = process.argv.slice(1);
    const result = {};
    // The call for 1 workspace also creates the heaps of the package manager itself.
    for (const workspaces of [1, 5, 50]) {
      const before = heapStats().mimalloc.heaps;
      const lockfile = parseLockfile(root + "/" + workspaces);
      const after = heapStats().mimalloc.heaps;
      result[workspaces] = { packages: lockfile.packages.length, live: after.current - before.current };
    }
    console.log(JSON.stringify(result));
  `;
  await using proc = spawn({
    cmd: [bunExe(), "-e", count, String(dir)],
    env: baseEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error");
  const result = JSON.parse(stdout.trim().split("\n").at(-1) || "null");
  expect({
    packages: [result[5].packages, result[50].packages],
    liveGrowth: result[50].live - result[5].live,
  }).toEqual({ packages: [6, 51], liveGrowth: 0 });
  expect(exitCode).toBe(0);
});

// The hoisted installer links a workspace package into node_modules under its name. A name
// too long for the buffer that symlink is given (512 bytes on POSIX) used to abort the whole
// install. A name over 255 bytes is refused like that of any other dependency, before
// anything is written.
describe("workspace packages whose name is too long to link", () => {
  const longName = Buffer.alloc(600, "a").toString();

  test.concurrent.each([
    ["unscoped", longName],
    ["scoped", `@scope/${longName}`],
  ])("%s name is refused", async (_, name) => {
    using ctx = await setupTest();
    const { packageDir, packageJson } = ctx;
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "foo", workspaces: ["pkgs/*"] })),
      write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name, version: "1.0.0" })),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker", "hoisted"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: ctx.env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain(`error: invalid dependency name "${name}"`);
    expect(out).not.toContain("installed");
    expect([await exists(join(packageDir, "bun.lock")), await exists(join(packageDir, "node_modules"))]).toEqual([
      false,
      false,
    ]);
    expect(exitCode).toBe(1);
  });
});

// Both linkers only create or repoint the `node_modules/<name>` links the current
// lockfile asks for. When a workspace is renamed or removed, its name leaves the
// lockfile and the links bun had created under that name (in the root's node_modules
// and, with the isolated linker, in the node_modules of the workspaces depending on
// it) used to stay behind, still resolving to the workspace folder.
describe("links of a renamed or removed workspace", () => {
  type Linker = "hoisted" | "isolated";
  const linkers: Linker[] = ["hoisted", "isolated"];

  async function install(ctx: TestCtx, linker: Linker, ...args: string[]): Promise<string> {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker", linker, ...args],
      cwd: ctx.packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: ctx.env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
    return out;
  }

  function writeProject(
    packageDir: string,
    rootDependencies: Record<string, string>,
    packages: Record<string, Record<string, unknown>>,
  ) {
    return Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "foo", workspaces: ["packages/*"], devDependencies: rootDependencies }),
      ),
      ...Object.entries(packages).map(([dir, packageJson]) =>
        write(join(packageDir, "packages", dir, "package.json"), JSON.stringify({ version: "1.0.0", ...packageJson })),
      ),
    ]);
  }

  // Package entries of a node_modules directory (no `.bun`/`.bin`), or [] when it does
  // not exist. A listing (rather than `exists`) also sees links whose target is gone.
  async function entries(nodeModules: string): Promise<string[]> {
    try {
      return (await readdirSorted(nodeModules)).filter(name => !name.startsWith("."));
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
      return [];
    }
  }

  for (const linker of linkers) {
    test.concurrent(`${linker}: renaming a workspace removes the links under its old name`, async () => {
      using ctx = await setupTest();
      const { packageDir } = ctx;
      const rootNodeModules = join(packageDir, "node_modules");
      const bNodeModules = join(packageDir, "packages", "b", "node_modules");

      await writeProject(
        packageDir,
        { a: "*", b: "*" },
        { a: { name: "a" }, b: { name: "b", dependencies: { a: "*" } } },
      );
      await install(ctx, linker);
      expect(await entries(rootNodeModules)).toEqual(["a", "b"]);
      expect(await entries(bNodeModules)).toEqual(linker === "isolated" ? ["a"] : []);

      await writeProject(
        packageDir,
        { "a-renamed": "*", b: "*" },
        { a: { name: "a-renamed" }, b: { name: "b", dependencies: { "a-renamed": "*" } } },
      );
      await install(ctx, linker);
      expect(await entries(rootNodeModules)).toEqual(["a-renamed", "b"]);
      expect(await entries(bNodeModules)).toEqual(linker === "isolated" ? ["a-renamed"] : []);
      expect(await file(join(rootNodeModules, "a-renamed", "package.json")).json()).toMatchObject({
        name: "a-renamed",
      });

      expect(await install(ctx, linker)).toContain("(no changes)");
      expect(await entries(rootNodeModules)).toEqual(["a-renamed", "b"]);
      expect(await entries(bNodeModules)).toEqual(linker === "isolated" ? ["a-renamed"] : []);
    });

    test.concurrent(`${linker}: renaming a scoped workspace removes the link under its old name`, async () => {
      using ctx = await setupTest();
      const { packageDir } = ctx;
      const scopeDir = join(packageDir, "node_modules", "@repo");

      await writeProject(
        packageDir,
        { "@repo/a": "*", "@repo/b": "*" },
        { a: { name: "@repo/a" }, b: { name: "@repo/b" } },
      );
      await install(ctx, linker);
      expect(await entries(scopeDir)).toEqual(["a", "b"]);

      await writeProject(
        packageDir,
        { "@repo/a-renamed": "*", "@repo/b": "*" },
        { a: { name: "@repo/a-renamed" }, b: { name: "@repo/b" } },
      );
      await install(ctx, linker);
      expect(await entries(scopeDir)).toEqual(["a-renamed", "b"]);
      expect(await file(join(scopeDir, "a-renamed", "package.json")).json()).toMatchObject({ name: "@repo/a-renamed" });
    });

    test.concurrent(`${linker}: removing a workspace from the project removes its link`, async () => {
      using ctx = await setupTest();
      const { packageDir } = ctx;
      const rootNodeModules = join(packageDir, "node_modules");

      await writeProject(packageDir, { a: "*", b: "*" }, { a: { name: "a" }, b: { name: "b" } });
      await install(ctx, linker);
      expect(await entries(rootNodeModules)).toEqual(["a", "b"]);

      await rm(join(packageDir, "packages", "a"), { recursive: true });
      await writeProject(packageDir, { b: "*" }, { b: { name: "b" } });
      await install(ctx, linker);
      expect(await entries(rootNodeModules)).toEqual(["b"]);
    });

    // The old name is unlinked before the linker runs, so a dependency that still
    // wants that name (here an alias of the renamed workspace) is linked again.
    test.concurrent(`${linker}: the old name is linked again when a dependency still uses it`, async () => {
      using ctx = await setupTest();
      const { packageDir } = ctx;
      const rootNodeModules = join(packageDir, "node_modules");

      await writeProject(packageDir, { a: "*" }, { a: { name: "a" } });
      await install(ctx, linker);
      expect(await entries(rootNodeModules)).toEqual(["a"]);

      await writeProject(packageDir, { a: "workspace:a-renamed@*" }, { a: { name: "a-renamed" } });
      await install(ctx, linker);
      expect(await entries(rootNodeModules)).toEqual(linker === "isolated" ? ["a"] : ["a", "a-renamed"]);
      expect(await file(join(rootNodeModules, "a", "package.json")).json()).toMatchObject({ name: "a-renamed" });
    });
  }

  // The isolated linker only links the workspaces the root depends on, so nothing is
  // ever linked for `a` here and the directory under its name is not bun's to remove.
  test.concurrent("a directory under the old name isn't touched", async () => {
    using ctx = await setupTest();
    const { packageDir } = ctx;
    const rootNodeModules = join(packageDir, "node_modules");
    const marker = join(rootNodeModules, "a", "marker.txt");

    await writeProject(packageDir, { b: "*" }, { a: { name: "a" }, b: { name: "b" } });
    await install(ctx, "isolated");
    expect(await entries(rootNodeModules)).toEqual(["b"]);

    await write(marker, "not a workspace link");
    await writeProject(packageDir, { b: "*" }, { a: { name: "a-renamed" }, b: { name: "b" } });
    await install(ctx, "isolated");
    expect(await entries(rootNodeModules)).toEqual(["a", "b"]);
    expect(await file(marker).text()).toBe("not a workspace link");
  });

  test.concurrent("--dry-run does not touch the links", async () => {
    using ctx = await setupTest();
    const { packageDir } = ctx;
    const rootNodeModules = join(packageDir, "node_modules");

    await writeProject(packageDir, { a: "*", b: "*" }, { a: { name: "a" }, b: { name: "b" } });
    await install(ctx, "hoisted");
    expect(await entries(rootNodeModules)).toEqual(["a", "b"]);

    await writeProject(packageDir, { "a-renamed": "*", b: "*" }, { a: { name: "a-renamed" }, b: { name: "b" } });
    await install(ctx, "hoisted", "--dry-run");
    expect(await entries(rootNodeModules)).toEqual(["a", "b"]);

    await install(ctx, "hoisted");
    expect(await entries(rootNodeModules)).toEqual(["a-renamed", "b"]);
  });
});

// #39357: `bun install` must identify the project root by the path it was
// invoked through. It used to realpath the root package.json fd, so workspace
// discovery and lockfile keys were computed against a different root than
// `top_level_dir` (the cwd). On Windows a subst drive or cross-drive junction
// put the two roots on different drive letters, where no relative path exists:
// the hoisted linker wrote machine-absolute workspace keys into bun.lock and
// the isolated linker looped forever. On POSIX a symlinked root package.json
// made workspace discovery run in the symlink target's directory.
describe("aliased project root", () => {
  test.concurrent.skipIf(isWindows)("workspaces install when the root package.json is a symlink", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await Promise.all([
      write(
        join(packageDir, "real", "package.json"),
        JSON.stringify({
          name: "ws-root",
          private: true,
          workspaces: ["packages/*"],
          devDependencies: { "pkg-a": "workspace:*" },
        }),
      ),
      write(
        join(packageDir, "ws", "packages", "a", "package.json"),
        JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
      ),
    ]);
    symlinkSync(join("..", "real", "package.json"), join(packageDir, "ws", "package.json"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: join(packageDir, "ws"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stdout).not.toContain("No packages!");
    expect(exitCode).toBe(0);

    const lockfile = await file(join(packageDir, "ws", "bun.lock")).text();
    expect(lockfile).toContain('"packages/a"');
    expect(lockfile).not.toContain("real/packages");
    expect(await exists(join(packageDir, "ws", "node_modules", "pkg-a", "package.json"))).toBe(true);
  });

  test.skipIf(!isWindows)("workspaces install when cwd is a subst drive for the project's real path", async () => {
    using ctx = await setupTest();
    const { packageDir, env } = ctx;
    await Promise.all([
      write(
        join(packageDir, "ws", "package.json"),
        JSON.stringify({
          name: "ws-root",
          private: true,
          workspaces: ["packages/*"],
          devDependencies: { "pkg-a": "workspace:*" },
        }),
      ),
      write(
        join(packageDir, "ws", "packages", "a", "package.json"),
        JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
      ),
    ]);

    // Map a free drive letter onto packageDir so the cwd's drive letter
    // differs from the files' physical drive.
    let drive: string | undefined;
    for (const letter of "ZYXWVUTSRQONMLKJIHGFE") {
      const { exitCode } = Bun.spawnSync({ cmd: ["cmd", "/c", "subst", `${letter}:`, packageDir], env });
      if (exitCode === 0) {
        drive = letter;
        break;
      }
    }
    if (!drive) throw new Error("no free drive letter available for subst");

    try {
      for (const linker of ["hoisted", "isolated"]) {
        rmSync(join(packageDir, "ws", "node_modules"), { recursive: true, force: true });
        rmSync(join(packageDir, "ws", "bun.lock"), { force: true });

        await using proc = Bun.spawn({
          cmd: [bunExe(), "install", `--linker=${linker}`],
          cwd: `${drive}:\\ws`,
          env,
          stdout: "pipe",
          stderr: "pipe",
          // the unfixed isolated linker spins forever; kill instead of hanging the runner
          timeout: 120_000,
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ linker, stderr }).toEqual({ linker, stderr: expect.not.stringContaining("error:") });
        expect({ linker, exitCode }).toEqual({ linker, exitCode: 0 });

        const lockfile = await file(join(packageDir, "ws", "bun.lock")).text();
        // Workspace keys have to stay relative. They're never the absolute real path on this machine.
        expect(lockfile).toContain('"packages/a"');
        expect(lockfile).not.toContain(packageDir.replaceAll("\\", "/"));
        expect(await exists(join(packageDir, "ws", "node_modules", "pkg-a", "package.json"))).toBe(true);
      }
    } finally {
      Bun.spawnSync({ cmd: ["cmd", "/c", "subst", `${drive}:`, "/d"], env });
    }
  });
});

// An edited member is parsed again, and a git / github row parsed from package.json does not know
// the name of its package until that is extracted.
describe("the git and github dependencies that bun.lock has already resolved", () => {
  const member = (name: string, dependencies: Record<string, string>) =>
    JSON.stringify({ name, version: "1.0.0", dependencies });

  async function run(cwd: string, env: Record<string, string | undefined>, ...args: string[]) {
    await using proc = spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  async function githubProject(linker: string) {
    const tarball = await githubTarball("testowner-testrepo-aaaaaaa", {
      "package.json": JSON.stringify({ name: "gh-dep", version: "1.0.0" }),
    });
    const downloads: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        downloads.push(new URL(req.url).pathname);
        return new Response(tarball);
      },
    });
    const dir = tempDir("workspace-locked-github", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
      "packages/a/package.json": member("a", { "gh-dep": "github:testowner/testrepo#aaaaaaa" }),
      "packages/b/package.json": member("b", {}),
      "vendor/package.json": JSON.stringify({ name: "vendor", version: "1.0.0" }),
    });
    const cwd = String(dir);
    return {
      cwd,
      downloads,
      env: {
        ...baseEnv,
        GITHUB_API_URL: server.url.origin,
        BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"),
      },
      [Symbol.dispose]() {
        server.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }
  const download = "/repos/testowner/testrepo/tarball/aaaaaaa";

  test.concurrent.each(["hoisted", "isolated"])("are not downloaded again (%s)", async linker => {
    using project = await githubProject(linker);
    const { cwd, downloads, env } = project;
    await run(cwd, env, "install");
    expect(downloads).toEqual([download]);

    await write(
      join(cwd, "packages", "a", "package.json"),
      member("a", { "gh-dep": "github:testowner/testrepo#aaaaaaa", vendor: "file:../../vendor" }),
    );
    await run(cwd, env, "install");
    expect(downloads).toEqual([download]);

    await write(
      join(cwd, "packages", "b", "package.json"),
      member("b", { "gh-dep": "github:testowner/testrepo#aaaaaaa" }),
    );
    await run(cwd, env, "install");
    expect(downloads).toEqual([download]);
    expect(await file(join(cwd, "bun.lock")).text()).toContain(
      '"gh-dep": ["gh-dep@github:testowner/testrepo#aaaaaaa", {}, "testowner-testrepo-aaaaaaa"',
    );
    for (const name of ["a", "b"]) {
      const from = linker === "hoisted" ? cwd : join(cwd, "packages", name);
      expect(await file(join(from, "node_modules", "gh-dep", "package.json")).json()).toEqual({
        name: "gh-dep",
        version: "1.0.0",
      });
    }
  });

  test.concurrent.each(["update gh-dep", "update"])("are downloaded again by bun %s", async command => {
    using project = await githubProject("hoisted");
    const { cwd, downloads, env } = project;
    await run(cwd, env, "install");
    expect(downloads).toEqual([download]);

    await run(join(cwd, "packages", "a"), env, ...command.split(" "));
    expect(downloads).toEqual([download, download]);
  });

  // An update without names resolves the dependencies of the workspaces it selects again. From the root, that's
  // every dependency in bun.lock.
  test.concurrent.each<[string, string, string[], boolean]>([
    ["aren't downloaded again by a bun update in another workspace", "packages/b", [], false],
    ["aren't downloaded again by a bun update --filter of another workspace", "", ["--filter", "b"], false],
    ["are downloaded again by a bun update in the root", "", [], true],
    ["are downloaded again by bun update -r", "", ["-r"], true],
  ])("%s", async (_, rel, args, isDownloaded) => {
    using project = await githubProject("hoisted");
    const { cwd, downloads, env } = project;
    await run(cwd, env, "install");
    expect(downloads).toEqual([download]);

    await run(join(cwd, rel), env, "update", ...args);
    expect(downloads).toEqual(isDownloaded ? [download, download] : [download]);
  });

  // `main` is aaaaaaa when the project is installed and bbbbbbb afterwards.
  async function movingBranchProject() {
    let head = "aaaaaaa";
    const downloads: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const ref = new URL(req.url).pathname.split("/").at(-1)!;
        downloads.push(ref);
        const commit = ref === "main" ? head : ref;
        return new Response(
          await githubTarball(`testowner-testrepo-${commit}`, {
            "package.json": JSON.stringify({ name: "gh-dep", version: "1.0.0" }),
          }),
        );
      },
    });
    const onMain = { "gh-dep": "github:testowner/testrepo#main" };
    const dir = tempDir("workspace-moving-branch", {
      "vendor/package.json": JSON.stringify({ name: "vendor", version: "1.0.0" }),
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "bunfig.toml": `[install]\nlinker = "hoisted"\nsaveTextLockfile = true\n`,
      "packages/a/package.json": member("a", onMain),
      "packages/b/package.json": member("b", onMain),
    });
    const cwd = String(dir);
    const env = { ...baseEnv, GITHUB_API_URL: server.url.origin, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") };
    const project = {
      cwd,
      env,
      downloads,
      // The commit of every `gh-dep` in bun.lock.
      async commits() {
        const { packages } = Bun.JSONC.parse(await file(join(cwd, "bun.lock")).text()) as any;
        return (Object.values(packages) as [string][])
          .map(([resolution]) => resolution.match(/^gh-dep@github:testowner\/testrepo#(\w+)$/)?.[1])
          .filter(commit => commit !== undefined)
          .sort();
      },
      [Symbol.dispose]() {
        server.stop(true);
        dir[Symbol.dispose]();
      },
    };
    try {
      await run(cwd, env, "install");
      expect(await project.commits()).toEqual(["aaaaaaa"]);
      head = "bbbbbbb";
      downloads.length = 0;
    } catch (e) {
      project[Symbol.dispose]();
      throw e;
    }
    return project;
  }

  // As with `bun install`, each workspace keeps its own commit of a branch.
  test.concurrent.each<[string, string, string[], string[]]>([
    ["only moves for the workspace that bun update runs in", "packages/b", [], ["aaaaaaa", "bbbbbbb"]],
    ["only moves for the workspace that bun update <name> runs in", "packages/b", ["gh-dep"], ["aaaaaaa", "bbbbbbb"]],
    [
      "only moves for the workspace of bun update <name> --filter",
      "",
      ["gh-dep", "--filter", "b"],
      ["aaaaaaa", "bbbbbbb"],
    ],
    ["moves for both under bun update <name> -r", "", ["gh-dep", "-r"], ["bbbbbbb"]],
    ["moves for both under bun update in the root", "", [], ["bbbbbbb"]],
  ])("a branch that two workspaces depend on %s", async (_, rel, args, commits) => {
    using project = await movingBranchProject();
    const { cwd, env, downloads } = project;
    await run(join(cwd, rel), env, "update", ...args);
    expect({ commits: await project.commits(), downloads }).toEqual({ commits, downloads: ["main"] });
    await run(cwd, env, "install", "--frozen-lockfile");
  });

  // A dependency whose package.json entry didn't change keeps what bun.lock has for it, also when another entry of
  // that package.json changes.
  test.concurrent("a branch keeps its commit when bun install reads its package.json again", async () => {
    using project = await movingBranchProject();
    const { cwd, env, downloads } = project;
    await write(
      join(cwd, "packages", "a", "package.json"),
      member("a", { "gh-dep": "github:testowner/testrepo#main", vendor: "file:../../vendor" }),
    );
    await run(cwd, env, "install");
    expect({ commits: await project.commits(), downloads }).toEqual({ commits: ["aaaaaaa"], downloads: [] });
  });

  // Served over git's dumb HTTP protocol: after `git update-server-info` a bare repository is static files.
  async function gitProject() {
    const dir = tempDir("workspace-locked-git", {
      "gitconfig": "[core]\n\tautocrlf = false\n",
      "src/package.json": JSON.stringify({ name: "git-dep", version: "1.0.0" }),
      "ws/package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "ws/vendor/package.json": JSON.stringify({ name: "vendor", version: "1.0.0" }),
    });
    const cwd = join(String(dir), "ws");
    const bare = join(String(dir), "repo.git");
    const env = {
      ...baseEnv,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(String(dir), "gitconfig"),
      GIT_AUTHOR_NAME: "bun-test",
      GIT_AUTHOR_EMAIL: "test@bun.sh",
      GIT_COMMITTER_NAME: "bun-test",
      GIT_COMMITTER_EMAIL: "test@bun.sh",
      BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"),
    };
    async function git(cwd: string, ...args: string[]) {
      await using proc = spawn({ cmd: ["git", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("fatal:");
      expect(exitCode).toBe(0);
      return stdout.trim();
    }
    const src = join(String(dir), "src");
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        requests++;
        const found = file(join(String(dir), new URL(req.url).pathname));
        return (await found.exists()) ? new Response(found) : new Response(null, { status: 404 });
      },
    });
    const project = {
      cwd,
      env,
      url: `git+${server.url}repo.git`,
      requests: () => requests,
      // Commits what is in `src` and makes it the head of the served repository. Returns the commit.
      async push() {
        await git(src, "add", "-A");
        await git(src, "commit", "-qm", "commit");
        await rm(bare, { recursive: true, force: true });
        await git(String(dir), "clone", "-q", "--bare", src, bare);
        await git(bare, "update-server-info");
        return git(src, "rev-parse", "HEAD");
      },
      src,
      [Symbol.dispose]() {
        server.stop(true);
        dir[Symbol.dispose]();
      },
    };
    try {
      await git(src, "init", "-q");
      return Object.assign(project, { sha: await project.push() });
    } catch (e) {
      project[Symbol.dispose]();
      throw e;
    }
  }

  test.concurrent("a git repository is not fetched again, and a cold cache still gets its checkout", async () => {
    using project = await gitProject();
    const { cwd, env, requests } = project;
    const gitDep = { "git-dep": `${project.url}#${project.sha}` };
    const memberJson = join(cwd, "packages", "a", "package.json");

    await write(memberJson, member("a", gitDep));
    await run(cwd, env, "install", "--linker=isolated");
    expect(requests()).toBeGreaterThan(0);

    const afterFirstInstall = requests();
    await write(memberJson, member("a", { ...gitDep, vendor: "file:../../vendor" }));
    await run(cwd, env, "install", "--linker=isolated");
    expect(requests()).toBe(afterFirstInstall);

    // Nothing is fetched to resolve the dependency, so the linker has to clone and check out.
    await Promise.all(
      ["node_modules", "packages/a/node_modules", ".bun-cache"].map(path =>
        rm(join(cwd, path), { recursive: true, force: true }),
      ),
    );
    await write(memberJson, member("a", gitDep));
    await run(cwd, env, "install", "--linker=isolated");
    expect(requests()).toBeGreaterThan(afterFirstInstall);
    expect(await file(join(cwd, "packages", "a", "node_modules", "git-dep", "package.json")).json()).toEqual({
      name: "git-dep",
      version: "1.0.0",
    });
  });

  // The repository gets a second commit after the install. `b` is the dependencies of packages/b. Each case gives
  // the commits in bun.lock after the update: the one that was installed, the new one, or both.
  test.concurrent.each<[string, Record<string, string> | "shared", string, string[], ("installed" | "new")[]]>([
    ["keeps its commit under an update from another workspace", {}, "packages/b", [], ["installed"]],
    ["keeps its commit under an update --filter of another workspace", {}, "", ["--filter", "b"], ["installed"]],
    ["moves to the new commit under an update from the root", {}, "", [], ["new"]],
    ["moves to the new commit under an update from the workspace that depends on it", {}, "packages/a", [], ["new"]],
    [
      "only moves for the workspace that bun update <name> runs in",
      "shared",
      "packages/b",
      ["git-dep"],
      ["installed", "new"],
    ],
  ])("a git dependency %s", async (_, b, rel, args, expected) => {
    using project = await gitProject();
    const { cwd, env } = project;
    const gitDep = { "git-dep": project.url };
    await Promise.all([
      write(join(cwd, "packages", "a", "package.json"), member("a", gitDep)),
      write(join(cwd, "packages", "b", "package.json"), member("b", b === "shared" ? gitDep : b)),
    ]);
    await run(cwd, env, "install");
    const commits = async () =>
      [...(await file(join(cwd, "bun.lock")).text()).matchAll(/"git-dep@git\+[^"#]+#(\w+)"/g)].map(match => match[1]);
    expect(await commits()).toEqual([project.sha]);

    await write(join(project.src, "package.json"), JSON.stringify({ name: "git-dep", version: "1.1.0" }));
    const head = await project.push();
    // packages/a is read again, which doesn't make its dependencies part of an update of packages/b.
    if (b === "shared") {
      await write(join(cwd, "packages", "a", "package.json"), member("a", { ...gitDep, vendor: "file:../../vendor" }));
    }
    await run(join(cwd, rel), env, "update", ...args);
    const commit = { installed: project.sha, new: head };
    expect((await commits()).sort()).toEqual(expected.map(which => commit[which]).sort());
  });
});

// The project's `node_modules` can be gone while a workspace still has its own.
test("a package in the older node_modules of a workspace is replaced, not added to", async () => {
  const app = (version: string) =>
    JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: `file:../../dep-${version}.tgz` } });
  using dir = tempDir("workspace-older-node-modules", {
    "package.json": JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
      dependencies: { dep: "file:./dep-1.0.0.tgz" },
    }),
    "packages/app/package.json": app("2.0.0"),
  });
  const cwd = String(dir);
  for (const version of ["1.0.0", "2.0.0", "3.0.0"]) {
    await Bun.Archive.write(
      join(cwd, `dep-${version}.tgz`),
      { "package/package.json": JSON.stringify({ name: "dep", version }), [`package/only-in-${version}.js`]: "" },
      { compress: "gzip" },
    );
  }
  const install = async () => {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd,
      env: { ...baseEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  };
  const installed = join(cwd, "packages", "app", "node_modules", "dep");

  await install();
  expect(await readdirSorted(installed)).toEqual([".bun-tag", "only-in-2.0.0.js", "package.json"]);

  await write(join(cwd, "packages", "app", "package.json"), app("3.0.0"));
  await rm(join(cwd, "node_modules"), { recursive: true });
  await install();
  expect(await readdirSorted(installed)).toEqual([".bun-tag", "only-in-3.0.0.js", "package.json"]);
});

// The registry in these tests has one version of every name it's asked for. `publish()` adds the newer versions and
// moves `latest`, so a bun.lock written before that is out of date for every dependency, including the ones that use
// a dist-tag.
describe("an update of one workspace doesn't change the dependencies of the others", () => {
  type Json = Record<string, any>;
  // The package.json of each folder. A string is a file with that content.
  type Repo = Record<string, Json | string>;
  // What the registry has of one package. Without `after` it publishes 1.1.0 and 2.0.0. The last version is `latest`,
  // unless `tags` is false: that registry has no dist-tags.
  type Published = { before?: string[]; after?: string[]; dependencies?: (version: string) => Json; tags?: false };

  function serveRegistry(published: Record<string, Published>) {
    let isPublished = false;
    const manifests: string[] = [];
    const tarballRequests: string[] = [];
    const githubDownloads: string[] = [];
    // The status that the registry answers for the manifest and the tarballs of a name.
    const failing = new Map<string, number>();
    const versionsOf = (name: string) => {
      const { before = ["1.0.0"], after = [...before, "1.1.0", "2.0.0"] } = published[name] ?? {};
      return isPublished ? after : before;
    };
    const packageJson = (name: string, version: string) => ({
      name,
      version,
      dependencies: published[name]?.dependencies?.(version),
    });
    // bun.lock records the integrity of the tarball, so a name and version always get the same bytes. The tarball at
    // `/unpublished/` is the exception: its bytes change with `publish()`.
    const tarballs = new Map<string, Promise<Uint8Array>>();
    function tarballOf(name: string, version: string, description = "") {
      const key = `${name}@${version}${description}`;
      let bytes = tarballs.get(key);
      if (!bytes) {
        const files = { "package/package.json": JSON.stringify({ ...packageJson(name, version), description }) };
        tarballs.set(key, (bytes = new Bun.Archive(files, { compress: "gzip" }).bytes()));
      }
      return bytes;
    }
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { origin, pathname } = new URL(request.url);
        const path = decodeURIComponent(pathname).slice(1);
        // `github:testowner/testrepo`. Every ref is the commit aaaaaaa of a package that depends on `leaf`.
        const ref = path.match(/^repos\/testowner\/testrepo\/tarball\/(.+)$/)?.[1];
        if (ref) {
          githubDownloads.push(ref);
          if (failing.has("gh-dep")) return Response.json({}, { status: failing.get("gh-dep") });
          const gitHubPackage = { name: "gh-dep", version: "1.0.0", dependencies: { leaf: "latest" } };
          return new Response(
            await githubTarball("testowner-testrepo-aaaaaaa", { "package.json": JSON.stringify(gitHubPackage) }),
          );
        }
        const tarball = path.match(/^(.+)\/-\/.+-(\d+\.\d+\.\d+)\.tgz$/);
        if (tarball) {
          const [, name, version] = tarball;
          tarballRequests.push(`${name}@${version}`);
          if (failing.has(name)) return Response.json({}, { status: failing.get(name) });
          const unpublished = name.startsWith("unpublished/");
          return new Response(
            await tarballOf(name.replace("unpublished/", ""), version, unpublished && isPublished ? "changed" : ""),
          );
        }
        manifests.push(path);
        if (failing.has(path)) return Response.json({}, { status: failing.get(path) });
        const versions = versionsOf(path);
        const dist = (version: string) => ({ tarball: `${origin}/${path}/-/${path}-${version}.tgz` });
        return Response.json({
          name: path,
          "dist-tags": published[path]?.tags === false ? undefined : { latest: versions.at(-1) },
          versions: Object.fromEntries(
            versions.map(version => [version, { ...packageJson(path, version), dist: dist(version) }]),
          ),
        });
      },
    });
    return {
      url: server.url.href,
      manifests,
      tarballRequests,
      githubDownloads,
      fail: (name: string, status: number) => failing.set(name, status),
      publish() {
        isPublished = true;
      },
      [Symbol.dispose]() {
        server.stop(true);
      },
    };
  }

  const ROOT = { name: "root", private: true, workspaces: ["packages/*"] };
  const member = (name: string, dependencies: Json) => ({ name, version: "1.0.0", dependencies });
  const stringify = (json: Json) => JSON.stringify(json, null, 2) + "\n";

  // The root and a each have a `latest` dependency. a and n share a range.
  const REPO: Record<string, Json> = {
    "": { ...ROOT, dependencies: { rootdep: "^1.0.0", roottag: "latest" } },
    "packages/a": member("a", { tagged: "latest", shared: "^1.0.0", aonly: "^1.0.0" }),
    "packages/n": member("n", { own: "^1.0.0", shared: "^1.0.0" }),
  };

  // Installs `repo` against the first version of everything, then publishes the newer versions.
  async function setup(
    files: Repo | ((registry: string) => Repo) = REPO,
    published: Record<string, Published> = {},
    afterInstall?: (cwd: string) => Promise<unknown>,
    linker = "hoisted",
  ) {
    await acquireSlot();
    using cleanup = new DisposableStack();
    cleanup.defer(releaseSlot);
    const registry = cleanup.use(serveRegistry(published));
    const repo = typeof files === "function" ? files(registry.url) : files;
    const dir = cleanup.use(
      tempDir("update-scope-", {
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, saveTextLockfile: true, linker } }),
        ...Object.fromEntries(
          Object.entries(repo).map(([rel, json]) =>
            typeof json === "string" ? [rel, json] : [rel ? `${rel}/package.json` : "package.json", stringify(json)],
          ),
        ),
      }),
    );
    const cwd = String(dir);
    const folders = Object.keys(repo).filter(rel => typeof repo[rel] !== "string");
    const env = {
      ...baseEnv,
      BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"),
      GITHUB_API_URL: new URL(registry.url).origin,
    };

    async function bun(rel: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: join(cwd, rel),
        env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }
    const lockText = () => file(join(cwd, "bun.lock")).text();

    const { stderr, exitCode } = await bun("", "install");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await afterInstall?.(cwd);
    registry.publish();
    for (const requests of [registry.manifests, registry.tarballRequests, registry.githubDownloads]) {
      requests.length = 0;
    }

    const resources = cleanup.move();
    return {
      cwd,
      registry,
      bun,
      write: (rel: string, json: Json) => write(join(cwd, rel, "package.json"), stringify(json)),
      lockText,
      texts: async () =>
        Object.fromEntries(
          await Promise.all(
            folders.map(async rel => [rel, await file(join(cwd, rel, "package.json")).text()] as const),
          ),
        ),
      // Maps each registry package to every version of it in bun.lock. A workspace, folder, git or tarball entry
      // is under its bun.lock key, which says who depends on it.
      async pins() {
        if (!(await exists(join(cwd, "bun.lock")))) return {};
        const { packages } = Bun.JSONC.parse(await lockText()) as Json;
        const pins: Record<string, string[]> = {};
        for (const [key, [resolution]] of Object.entries(packages) as [string, [string]][]) {
          const registryPackage = resolution.match(/^(.+)@(\d+\.\d+\.\d+)$/);
          if (registryPackage) (pins[registryPackage[1]] ??= []).push(registryPackage[2]);
          else (pins[key] ??= []).push(resolution.slice(resolution.indexOf("@", 1) + 1).replace(registry.url, "/"));
        }
        return Object.fromEntries(Object.entries(pins).map(([name, list]) => [name, list.sort().join(" ")]));
      },
      // Maps each bun.lock entry of the registry package `name` to its version. The key says who gets that version.
      async entriesOf(name: string) {
        const { packages } = Bun.JSONC.parse(await lockText()) as Json;
        return Object.fromEntries(
          (Object.entries(packages) as [string, [string]][])
            .filter(([, [resolution]]) => resolution.startsWith(`${name}@`))
            .map(([key, [resolution]]) => [key, resolution.slice(name.length + 1)]),
        );
      },
      [Symbol.dispose]: () => resources.dispose(),
    };
  }

  type Project = Awaited<ReturnType<typeof setup>>;
  const dependenciesOf = ({ dependencies, devDependencies }: Json) => ({ dependencies, devDependencies });

  // Reports what one command did: the versions in bun.lock of the packages whose versions changed, the dependencies of
  // each package.json that changed, and the manifests it requested from the registry.
  async function ran(project: Project, rel: string, ...command: string[]) {
    const [before, pinsBefore] = [await project.texts(), await project.pins()];
    const { stdout, stderr, exitCode } = await project.bun(rel, ...command);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    const manifests = [...new Set(project.registry.manifests)].sort();
    const pins = await project.pins();
    const moved = Object.fromEntries([
      ...Object.entries(pins).filter(([name, versions]) => versions !== pinsBefore[name]),
      ...Object.keys(pinsBefore)
        .filter(name => !(name in pins))
        .map(name => [name, "removed"]),
    ]);
    const rewritten = Object.fromEntries(
      Object.entries(await project.texts())
        .filter(([at, text]) => text !== before[at])
        .map(([at, text]) => [at, dependenciesOf(JSON.parse(text))]),
    );
    return { stdout, moved, rewritten, manifests };
  }
  const updated = (project: Project, rel: string, ...args: string[]) => ran(project, rel, "update", ...args);

  async function expectFrozenInstallPasses(project: Project) {
    const lockBefore = await project.lockText();
    const { stderr, exitCode } = await project.bun("", "install", "--frozen-lockfile");
    expect(stderr).not.toContain("error:");
    expect(await project.lockText()).toBe(lockBefore);
    expect(exitCode).toBe(0);
  }

  async function expectNoDuplicates(project: Project) {
    const { stdout, stderr, exitCode } = await project.bun("", "dedupe", "--check");
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("No duplicates");
    expect(exitCode).toBe(0);
  }

  async function replaceIn(path: string, from: string, to: string) {
    const text = await file(path).text();
    expect(text).toContain(from);
    await write(path, text.replace(from, to));
  }
  const removeAll = (project: Project, ...paths: string[]) =>
    Promise.all(paths.map(path => rm(join(project.cwd, path), { recursive: true, force: true })));
  // Adds a file, so it applies to every version of a package.
  const PATCH =
    "diff --git a/patched.txt b/patched.txt\nnew file mode 100644\nindex 0000000..a3f5a8a\n--- /dev/null\n+++ b/patched.txt\n@@ -0,0 +1 @@\n+patched\n";

  // What `ran` reports for a rewritten package.json of REPO, with some dependencies replaced.
  const rewrittenIn = (rel: string, entries: Json) => ({
    [rel]: dependenciesOf({ dependencies: { ...REPO[rel].dependencies, ...entries } }),
  });
  const N_IN_RANGE = {
    moved: { own: "1.1.0", shared: "1.1.0" },
    rewritten: rewrittenIn("packages/n", { own: "^1.1.0", shared: "^1.1.0" }),
    manifests: ["own", "shared"],
  };
  // a's `^1.0.0` keeps the version of `shared` that it has.
  const N_LATEST = {
    moved: { own: "2.0.0", shared: "1.0.0 2.0.0" },
    rewritten: rewrittenIn("packages/n", { own: "^2.0.0", shared: "^2.0.0" }),
    manifests: ["own", "shared"],
  };

  test.concurrent.each<[string, string, string[], Json]>([
    ["from a workspace", "packages/n", [], N_IN_RANGE],
    ["--latest from a workspace", "packages/n", ["--latest"], N_LATEST],
    ["--filter of a workspace", "", ["--filter", "./packages/n"], N_IN_RANGE],
    ["--filter --latest of a workspace", "", ["--filter", "./packages/n", "--latest"], N_LATEST],
    // From the root, every dependency in bun.lock is resolved again. A range of a workspace stays on its version
    // when bun.lock has no higher one that it accepts, and only `-r` rewrites it.
    [
      "from the root",
      "",
      [],
      {
        moved: { rootdep: "1.1.0", roottag: "2.0.0", tagged: "2.0.0" },
        rewritten: rewrittenIn("", { rootdep: "^1.1.0" }),
        manifests: ["aonly", "own", "rootdep", "roottag", "shared", "tagged"],
      },
    ],
    [
      "--filter of the root",
      "",
      ["--filter", "root"],
      {
        moved: { rootdep: "1.1.0", roottag: "2.0.0" },
        rewritten: rewrittenIn("", { rootdep: "^1.1.0" }),
        manifests: ["rootdep", "roottag"],
      },
    ],
    [
      "-r",
      "",
      ["-r"],
      {
        moved: {
          aonly: "1.1.0",
          own: "1.1.0",
          rootdep: "1.1.0",
          roottag: "2.0.0",
          shared: "1.1.0",
          tagged: "2.0.0",
        },
        rewritten: {
          ...rewrittenIn("", { rootdep: "^1.1.0" }),
          ...rewrittenIn("packages/a", { shared: "^1.1.0", aonly: "^1.1.0" }),
          ...N_IN_RANGE.rewritten,
        },
        manifests: ["aonly", "own", "rootdep", "roottag", "shared", "tagged"],
      },
    ],
    // A named update only updates the dependencies that it names.
    [
      "<name> from a workspace that also has a `latest` dependency",
      "packages/a",
      ["aonly"],
      {
        moved: { aonly: "1.1.0" },
        rewritten: rewrittenIn("packages/a", { aonly: "^1.1.0" }),
        manifests: ["aonly"],
      },
    ],
    [
      "<pattern> from a workspace that also has a `latest` dependency",
      "packages/a",
      ["aon*"],
      {
        moved: { aonly: "1.1.0" },
        rewritten: rewrittenIn("packages/a", { aonly: "^1.1.0" }),
        manifests: ["aonly"],
      },
    ],
    [
      "<name> -r",
      "",
      ["shared", "-r"],
      {
        moved: { shared: "1.1.0" },
        rewritten: {
          ...rewrittenIn("packages/a", { shared: "^1.1.0" }),
          ...rewrittenIn("packages/n", { shared: "^1.1.0" }),
        },
        manifests: ["shared"],
      },
    ],
  ])("bun update %s", async (_, rel, args, expected) => {
    using project = await setup();
    const { moved, rewritten, manifests } = await updated(project, rel, ...args);
    expect({ moved, rewritten, manifests }).toEqual(expected);
    await expectFrozenInstallPasses(project);
  });

  // Each dependency of a gets to `latest` another way: as declared, through the catalog, and through `overrides`.
  const ROUTES: Repo = {
    "": {
      ...ROOT,
      workspaces: { packages: ["packages/*"], catalog: { cat: "latest", ovrcat: "latest" } },
      overrides: { ovr: "latest", ovrcat: "catalog:" },
    },
    "packages/a": member("a", { tagged: "latest", cat: "catalog:", ovr: "^1.0.0", ovrcat: "^1.0.0" }),
    "packages/n": member("n", { own: "^1.0.0" }),
  };
  const EVERY_ROUTE = { tagged: "2.0.0", cat: "2.0.0", ovr: "2.0.0", ovrcat: "2.0.0" };
  // Only a `catalog:` dependency is resolved again in a workspace that the update doesn't select.
  const ONLY_CATALOG = { cat: "2.0.0", own: "1.1.0" };
  test.concurrent.each<[string, string, string[], Json]>([
    ["from the root", "", [], EVERY_ROUTE],
    ["-r", "", ["-r"], { ...EVERY_ROUTE, own: "1.1.0" }],
    ["from another workspace", "packages/n", [], ONLY_CATALOG],
    ["--filter of another workspace", "", ["--filter", "./packages/n"], ONLY_CATALOG],
  ])("the dependencies of a workspace that follow a dist-tag, bun update %s", async (_, rel, args, expected) => {
    using project = await setup(ROUTES);
    const { moved } = await updated(project, rel, ...args);
    expect(moved).toEqual(expected);
    await expectFrozenInstallPasses(project);
  });

  // The root and a are on one version of `shared`. The update moves it for the root, and a's range accepts it.
  test.concurrent("bun update from the root moves a range of a workspace with the root's", async () => {
    using project = await setup({
      "": { ...ROOT, dependencies: { shared: "^1.0.0" } },
      "packages/a": member("a", { shared: "^1.0.0" }),
    });
    const { moved, rewritten } = await updated(project, "");
    expect({ moved, rewritten: Object.keys(rewritten) }).toEqual({ moved: { shared: "1.1.0" }, rewritten: [""] });
    await expectFrozenInstallPasses(project);
  });

  // c is installed after 1.1.0 is published, so bun.lock has 1.0.0 for a and 1.1.0 for c.
  test.concurrent("bun update from the root moves a range of a workspace to a higher version in bun.lock", async () => {
    using project = await setup({ "": ROOT, "packages/a": member("a", { host: "^1.0.0" }) });
    await project.write("packages/c", member("c", { host: "^1.1.0" }));
    expect((await ran(project, "", "install")).moved).toEqual({ c: "workspace:packages/c", host: "1.0.0 1.1.0" });
    const { moved, rewritten } = await updated(project, "");
    expect({ moved, rewritten }).toEqual({ moved: { host: "1.1.0" }, rewritten: {} });
    await expectNoDuplicates(project);
  });

  // `bun init` writes `"@types/bun": "latest"` into every package.
  const types = { devDependencies: { typesbun: "latest" } };
  const INIT: Record<string, Json> = {
    "": { ...ROOT, ...types },
    "packages/a": { ...member("a", { own: "^1.0.0" }), ...types },
    "packages/b": { ...member("b", {}), ...types },
  };
  const typesbun: Published = { dependencies: version => ({ buntypes: version }) };
  // `latest` is 2.0.0 when the project is installed, and 1.1.0 afterwards.
  const movesBack = { before: ["1.0.0", "2.0.0"], after: ["1.0.0", "2.0.0", "1.1.0"] };
  test.concurrent.each<[string, string, string[], string]>([
    ["from the root", "", [], "2.0.0"],
    ["from a workspace", "packages/a", [], "2.0.0"],
    ["--filter of a workspace", "", ["--filter", "./packages/a"], "2.0.0"],
    ["from a workspace when `latest` moves back", "packages/a", [], "1.1.0"],
    ["--filter of a workspace when `latest` moves back", "", ["--filter", "./packages/a"], "1.1.0"],
  ])("workspaces that share a `latest` dependency stay on one version, bun update %s", async (_, rel, args, latest) => {
    using project = await setup(
      INIT,
      latest === "1.1.0" ? { typesbun: { ...typesbun, ...movesBack }, buntypes: movesBack } : { typesbun },
    );
    const { moved } = await updated(project, rel, ...args);
    expect(moved).toMatchObject({ typesbun: latest, buntypes: latest });
    await expectNoDuplicates(project);
    await expectFrozenInstallPasses(project);
  });

  // The updated workspace has no bun.lock entry for the dependency yet, or the registry has no tag to look up.
  test.concurrent.each<[string, string, Record<string, Published>]>([
    ["a workspace that just got it", "packages/a", { typesbun }],
    ["a new workspace", "packages/c", { typesbun }],
    ["a registry without dist-tags", "packages/a", { typesbun: { ...typesbun, tags: false } }],
  ])("workspaces that share a `latest` dependency stay on one version, with %s", async (which, rel, published) => {
    const justGotIt = which === "a workspace that just got it";
    using project = await setup(
      justGotIt ? { ...INIT, "packages/a": member("a", { own: "^1.0.0" }) } : INIT,
      published,
    );
    if (justGotIt) await project.write("packages/a", INIT["packages/a"]);
    if (rel === "packages/c") await project.write("packages/c", { ...member("c", {}), ...types });
    const { moved } = await updated(project, rel);
    expect(moved).toMatchObject({ typesbun: "2.0.0", buntypes: "2.0.0" });
    await expectNoDuplicates(project);
    await expectFrozenInstallPasses(project);
  });

  test.concurrent("bun update <name> doesn't share a `latest` dependency, and the next bun update does", async () => {
    using project = await setup(INIT, { typesbun });
    expect((await updated(project, "packages/a", "typesbun")).moved).toEqual({
      typesbun: "1.0.0 2.0.0",
      buntypes: "1.0.0 2.0.0",
    });
    expect((await updated(project, "packages/a")).moved).toMatchObject({ typesbun: "2.0.0", buntypes: "2.0.0" });
    await expectFrozenInstallPasses(project);
  });

  test.concurrent.each<[string, string, string[]]>([
    ["from a workspace", "packages/a", []],
    ["--filter of a workspace", "", ["--filter", "./packages/a"]],
  ])("a patched `latest` dependency moves in every workspace that shares it, bun update %s", async (_, rel, args) => {
    using project = await setup(
      {
        ...INIT,
        "": { ...INIT[""], patchedDependencies: { "typesbun@1.0.0": "patches/typesbun@1.0.0.patch" } },
        "patches/typesbun@1.0.0.patch": PATCH,
      },
      { typesbun },
    );
    const { stderr, exitCode } = await project.bun(rel, "update", ...args);
    expect(stderr).toContain("patches/typesbun@1.0.0.patch no longer applies");
    expect(await project.pins()).toMatchObject({ typesbun: "2.0.0", buntypes: "2.0.0" });
    expect(exitCode).toBe(0);
  });

  // `--latest` asks for `latest` in place of n's range, and that's what a's dependency asks for.
  test.concurrent("bun update --latest shares `latest` with the workspaces that depend on the tag", async () => {
    using project = await setup({
      "": ROOT,
      "packages/a": member("a", { host: "latest" }),
      "packages/n": member("n", { host: "^1.0.0" }),
    });
    const { moved } = await updated(project, "packages/n", "--latest");
    expect(moved).toEqual({ host: "2.0.0" });
    await expectFrozenInstallPasses(project);
  });

  // a's peer dependency uses the version that the root has. That isn't what `latest` names, so b keeps its own.
  test.concurrent("a peer dependency on `latest` doesn't share the version of its provider", async () => {
    const versions = ["1.0.0", "1.0.5", "2.0.0"];
    using project = await setup(
      {
        "": { ...ROOT, dependencies: { host: "1.0.5" } },
        "packages/a": { ...member("a", {}), peerDependencies: { host: "latest" } },
        "packages/b": member("b", { host: "latest" }),
      },
      { host: { before: versions, after: versions } },
    );
    expect(await project.pins()).toMatchObject({ host: "1.0.5 2.0.0" });
    const { moved } = await updated(project, "packages/a");
    expect(moved).toEqual({});
  });

  // The root's `overrides` makes both ranges a dependency on `latest`.
  test.concurrent("workspaces whose dependency an override points at `latest` stay on one version", async () => {
    using project = await setup({
      "": { ...ROOT, overrides: { host: "latest" } },
      "packages/a": member("a", { host: "^1.0.0" }),
      "packages/b": member("b", { host: "^1.0.0" }),
    });
    const { moved } = await updated(project, "packages/a");
    expect(moved).toEqual({ host: "2.0.0" });
    await expectFrozenInstallPasses(project);
  });

  // m moves to 1.1.0 and k to 2.0.0. b isn't updated, and `bparent` is a dependency of b alone.
  test.concurrent("a workspace that isn't updated stays on the version that its own dependencies use", async () => {
    using project = await setup(
      {
        "": ROOT,
        "packages/b": member("b", { host: "^1.0.0", bparent: "^1.0.0" }),
        "packages/k": member("k", { host: "latest" }),
        "packages/m": member("m", { host: "^1.0.0" }),
      },
      { bparent: { after: ["1.0.0"], dependencies: () => ({ host: "^1.0.0" }) } },
    );
    const { rewritten } = await updated(project, "", "--filter", "k", "--filter", "m");
    expect({ host: await project.entriesOf("host"), rewritten: Object.keys(rewritten) }).toEqual({
      host: { host: "1.0.0", "k/host": "2.0.0", "m/host": "1.1.0" },
      rewritten: ["packages/m"],
    });
    await expectFrozenInstallPasses(project);
  });

  // a and n accept the same versions of `host`, and bun.lock has 1.0.5 for a and 1.0.0 for n. `bun dedupe` is the
  // command that merges them.
  test.concurrent.each<[string, string, string]>([
    ["the one on the lower version", "packages/n", "1.0.5 1.1.0"],
    ["the one on the higher version", "packages/a", "1.0.0 1.1.0"],
  ])("a workspace keeps a version of its own under an update of %s", async (_, rel, versions) => {
    using project = await setup(
      {
        "": ROOT,
        "packages/a": member("a", { host: "^1.0.0" }),
        "packages/n": member("n", { host: "1.0.0" }),
      },
      { host: { before: ["1.0.0", "1.0.5"], after: ["1.0.0", "1.0.5", "1.1.0"] } },
      cwd =>
        Promise.all(
          ["packages/n/package.json", "bun.lock"].map(path =>
            replaceIn(join(cwd, path), '"host": "1.0.0"', '"host": "^1.0.0"'),
          ),
        ),
    );
    const { moved } = await updated(project, rel);
    expect(moved).toEqual({ host: versions });
    await expectFrozenInstallPasses(project);
  });

  // n reaches `trans` through `parent`. a depends on it by tag, and a isn't updated, so `trans` stays on the version
  // that a has. A version of its own for `parent` would be a duplicate.
  const TRANSITIVE: Record<string, Json> = {
    "": ROOT,
    "packages/a": member("a", { trans: "latest", parent: "^1.0.0" }),
    "packages/n": member("n", { parent: "^1.0.0" }),
  };
  test.concurrent.each<[string, string[]]>([
    ["names a version that `parent` accepts", ["1.0.0", "1.1.0"]],
    ["names a version that `parent` doesn't accept", ["1.0.0", "1.1.0", "2.0.0"]],
  ])("a `latest` dependency of another workspace keeps its version when its tag %s", async (_, after) => {
    using project = await setup(TRANSITIVE, {
      parent: { after: ["1.0.0"], dependencies: () => ({ trans: "^1.0.0" }) },
      trans: { after },
    });
    const { moved } = await updated(project, "packages/n");
    expect(moved).toEqual({});
    await expectNoDuplicates(project);
    await expectFrozenInstallPasses(project);
  });

  // b's `latest` isn't the tag of a dependency that a has, so it keeps its version. In the first three cases a's
  // range is left as written and only bun.lock moves. In the last one `latest` names the version that a moves to.
  test.concurrent.each<[string, string, string[], Json, string, string[]]>([
    ["from the workspace", "packages/a", [], {}, "1.x", ["1.0.0", "1.1.0", "2.0.0"]],
    ["--filter of the workspace", "", ["--filter", "./packages/a"], {}, "1.x", ["1.0.0", "1.1.0", "2.0.0"]],
    [
      "--filter of a workspace that gets the range from the catalog",
      "",
      ["--filter", "./packages/a"],
      { host: "^1.0.0" },
      "catalog:",
      ["1.0.0", "1.1.0", "2.0.0"],
    ],
    ["from a workspace whose range gets what `latest` names", "packages/a", [], {}, "1.x", ["1.0.0", "1.1.0"]],
  ])(
    "the `latest` dependency of another workspace keeps its version next to a range, bun update %s",
    async (_, rel, args, catalog, range, after) => {
      using project = await setup(
        {
          "": { ...ROOT, workspaces: { packages: ["packages/*"], catalog } },
          "packages/a": member("a", { host: range }),
          "packages/b": member("b", { host: "latest" }),
        },
        { host: { after } },
      );
      const { moved, rewritten } = await updated(project, rel, ...args);
      expect({ moved, rewritten }).toEqual({ moved: { host: "1.0.0 1.1.0" }, rewritten: {} });
      await expectFrozenInstallPasses(project);
    },
  );

  test.concurrent(
    "bun update --dev updates the devDependencies of the workspace and not its `latest` dependency",
    async () => {
      using project = await setup({
        "": ROOT,
        "packages/a": { ...member("a", { tagged: "latest" }), devDependencies: { adev: "^1.0.0" } },
      });
      const { moved, manifests } = await updated(project, "packages/a", "--dev");
      expect({ moved, manifests }).toEqual({ moved: { adev: "1.1.0" }, manifests: ["adev"] });
      await expectFrozenInstallPasses(project);
    },
  );

  // The bytes at the URL change after the install. An update that selects a workspace with the dependency reads
  // them again. bun.lock has one entry for a URL, so that's for every workspace that has it.
  test.concurrent.each<[string, string, string[], boolean]>([
    ["keeps its integrity under an update from another workspace", "packages/n", [], false],
    ["keeps its integrity under an update --filter of another workspace", "", ["--filter", "./packages/n"], false],
    ["is read again by an update from the root", "", [], true],
    ["is read again by an update from the workspace that depends on it", "packages/a", [], true],
    ["is read again by an update <name> from a workspace that shares it", "packages/s", ["tar"], true],
  ])("a tarball URL %s", async (_, rel, args, isReadAgain) => {
    using project = await setup(registry => {
      const tar = { tar: `${registry}unpublished/tar/-/tar-1.0.0.tgz` };
      return {
        "": ROOT,
        "packages/a": member("a", tar),
        "packages/n": member("n", { own: "^1.0.0" }),
        "packages/s": member("s", rel === "packages/s" ? tar : {}),
      };
    });
    const integrity = async () => (await project.lockText()).match(/"tar@http[^"]+", \{\}, "(sha512-[^"]+)"/)?.[1];
    const before = await integrity();
    expect(before).toStartWith("sha512-");
    await updated(project, rel, ...args);
    expect({
      downloaded: project.registry.tarballRequests.includes("unpublished/tar@1.0.0"),
      kept: (await integrity()) === before,
    }).toEqual({ downloaded: isReadAgain, kept: !isReadAgain });
  });

  const OTHERS = ["aonly", "rootdep", "roottag", "tagged"];
  test.concurrent.each<[string, number, string[], string[]]>([
    ["bun update", 404, [], OTHERS],
    ["bun update <name>", 404, ["own"], [...OTHERS, "shared"]],
    ["bun update <name>", 401, ["own"], [...OTHERS, "shared"]],
  ])(
    "%s doesn't request a manifest that it doesn't need, so a %d for it doesn't fail",
    async (_, status, args, names) => {
      using project = await setup();
      for (const name of names) project.registry.fail(name, status);
      const { moved, manifests } = await updated(project, "packages/n", ...args);
      expect({ moved, manifests }).toEqual(
        args.length === 0
          ? { moved: N_IN_RANGE.moved, manifests: N_IN_RANGE.manifests }
          : { moved: { own: "1.1.0" }, manifests: ["own"] },
      );
    },
  );

  const EVERYTHING_INSTALLED = [".bun-cache", "node_modules", "packages/a/node_modules", "packages/n/node_modules"];

  // The registry refuses everything that n doesn't depend on. `--lockfile-only` doesn't install, so nothing of the
  // other workspaces is requested.
  test.concurrent("bun update <name> --lockfile-only requests nothing for the other workspaces", async () => {
    using project = await setup();
    for (const name of [...OTHERS, "shared"]) project.registry.fail(name, 401);
    await removeAll(project, ...EVERYTHING_INSTALLED);
    const { moved, manifests } = await updated(project, "packages/n", "own", "--lockfile-only");
    expect({ moved, manifests, tarballs: project.registry.tarballRequests }).toEqual({
      moved: { own: "1.1.0" },
      manifests: ["own"],
      tarballs: [],
    });
  });

  // As with `bun install`, the install step downloads what is in neither the cache nor node_modules, for every
  // workspace. The versions are the ones that bun.lock has.
  test.concurrent("an update from a workspace installs the locked versions of the other workspaces", async () => {
    using project = await setup();
    await removeAll(project, ...EVERYTHING_INSTALLED);
    const { moved, manifests } = await updated(project, "packages/n");
    expect({ moved, manifests, tarballs: project.registry.tarballRequests.toSorted() }).toEqual({
      moved: N_IN_RANGE.moved,
      manifests: N_IN_RANGE.manifests,
      tarballs: ["aonly@1.0.0", "own@1.1.0", "rootdep@1.0.0", "roottag@1.0.0", "shared@1.1.0", "tagged@1.0.0"],
    });
  });

  test.concurrent("--dry-run only prints the dependencies of the targeted workspace and writes nothing", async () => {
    using project = await setup();
    const lockBefore = await project.lockText();
    const { stdout, rewritten } = await updated(project, "packages/n", "--dry-run");
    expect(stdout.match(/^\^ .+$/gm)).toEqual([
      "^ own 1.0.0 -> 1.1.0 (v2.0.0 available)",
      "^ shared 1.0.0 -> 1.1.0 (v2.0.0 available)",
    ]);
    expect(rewritten).toEqual({});
    expect(await project.lockText()).toBe(lockBefore);
  });

  test.concurrent("a second update from the same workspace changes nothing", async () => {
    using project = await setup();
    await updated(project, "packages/n");
    const [lockBefore, textsBefore] = [await project.lockText(), await project.texts()];
    project.registry.manifests.length = 0;
    const { stdout } = await updated(project, "packages/n");
    expect(stdout).toContain("(no changes)");
    expect(await project.lockText()).toBe(lockBefore);
    expect(await project.texts()).toEqual(textsBefore);
  });

  // An update uses the package.json files on disk, so an edit is resolved the way `bun install` resolves it.
  test.concurrent(
    "an update of one workspace resolves a range edited by hand in another workspace, and nothing next to it",
    async () => {
      using project = await setup();
      await project.write("packages/a", member("a", { ...REPO["packages/a"].dependencies, aonly: "^1.1.0" }));
      const { moved, rewritten } = await updated(project, "packages/n");
      expect({ moved, rewritten }).toEqual({
        moved: { ...N_IN_RANGE.moved, aonly: "1.1.0" },
        rewritten: N_IN_RANGE.rewritten,
      });
      await expectFrozenInstallPasses(project);
    },
  );

  test.concurrent("without a bun.lock, an update from a workspace only rewrites its own package.json", async () => {
    using project = await setup();
    await rm(join(project.cwd, "bun.lock"));
    const { rewritten } = await updated(project, "packages/n");
    expect(rewritten).toEqual(N_IN_RANGE.rewritten);
    await expectFrozenInstallPasses(project);
  });

  // The dependencies of a `file:` folder are updated with the workspaces that reach the folder. `fdep` sorts after
  // `aown`, so the folder is still queued when the update waits for the manifest of `aown`.
  const FOLDER: Record<string, Json> = {
    "": ROOT,
    "packages/m": member("m", { aown: "^1.0.0", fdep: "file:../../vendor/fdep" }),
    "packages/n": member("n", { own: "^1.0.0" }),
    "vendor/fdep": member("fdep", { ftag: "latest", frange: "^1.0.0" }),
  };
  const FOLDER_MOVES = { frange: "1.1.0", ftag: "2.0.0" };
  const FOLDER_NAMES = ["frange", "ftag"];
  test.concurrent.each<[string, string, string[], Json, string[]]>([
    ["from another workspace", "packages/n", [], { own: "1.1.0" }, ["own"]],
    ["--filter of another workspace", "", ["--filter", "./packages/n"], { own: "1.1.0" }, ["own"]],
    [
      "from the workspace that depends on it",
      "packages/m",
      [],
      { ...FOLDER_MOVES, aown: "1.1.0" },
      ["aown", ...FOLDER_NAMES],
    ],
    ["from the root", "", [], FOLDER_MOVES, ["aown", ...FOLDER_NAMES, "own"]],
    ["-r", "", ["-r"], { ...FOLDER_MOVES, aown: "1.1.0", own: "1.1.0" }, ["aown", ...FOLDER_NAMES, "own"]],
    ["<name> from the workspace that depends on it", "packages/m", ["aown"], { aown: "1.1.0" }, ["aown"]],
    ["--depth 0 from the workspace that depends on it", "packages/m", ["--depth", "0"], { aown: "1.1.0" }, ["aown"]],
  ])("the dependencies of a `file:` folder, bun update %s", async (_, rel, args, expected, names) => {
    using project = await setup(FOLDER);
    const { moved, manifests } = await updated(project, rel, ...args);
    expect({ moved, manifests }).toEqual({ moved: expected, manifests: names });
    await expectFrozenInstallPasses(project);
  });

  test.concurrent("bun update <name> doesn't request the manifests of a `file:` folder's dependencies", async () => {
    using project = await setup({ ...FOLDER, "vendor/fdep": member("fdep", { frange: "^1.0.0" }) });
    project.registry.fail("frange", 404);
    const { moved, manifests } = await updated(project, "packages/m", "aown");
    expect({ moved, manifests }).toEqual({ moved: { aown: "1.1.0" }, manifests: ["aown"] });
  });

  // n has the same `latest` dependency as the folder, which only m depends on.
  test.concurrent.each<[string, string, string[]]>([
    ["from a workspace", "packages/n", []],
    ["--filter of a workspace", "", ["--filter", "./packages/n"]],
  ])(
    "a `file:` folder shares a `latest` dependency with the workspace that bun update %s selects",
    async (_, rel, args) => {
      using project = await setup({ ...FOLDER, "packages/n": member("n", { own: "^1.0.0", ftag: "latest" }) });
      const { moved } = await updated(project, rel, ...args);
      expect(moved).toEqual({ own: "1.1.0", ftag: "2.0.0" });
      await expectFrozenInstallPasses(project);
    },
  );

  // The folder ships its own copy of `host`.
  test.concurrent("a bundled `latest` dependency of a `file:` folder keeps its version", async () => {
    using project = await setup({
      "": ROOT,
      "packages/k": member("k", { host: "latest" }),
      "packages/m": member("m", { fdep: "file:../../vendor/fdep" }),
      "vendor/fdep": { ...member("fdep", { host: "latest" }), bundledDependencies: ["host"] },
    });
    const { moved } = await updated(project, "packages/k");
    expect(moved).toEqual({ host: "1.0.0 2.0.0" });
  });

  // n links b with `workspace:*`. That doesn't put b's own dependencies in the scope of an update of n. `b` sorts
  // after `aaa`, so b is still queued when the update waits for the manifest of `aaa`.
  test.concurrent("a workspace that the updated workspace depends on keeps its dependencies", async () => {
    using project = await setup({
      "": ROOT,
      "packages/b": member("b", { tagged: "latest", bonly: "^1.0.0" }),
      "packages/n": member("n", { aaa: "^1.0.0", b: "workspace:*" }),
    });
    const { moved, manifests } = await updated(project, "packages/n");
    expect({ moved, manifests }).toEqual({ moved: { aaa: "1.1.0" }, manifests: ["aaa"] });
    await expectFrozenInstallPasses(project);
  });

  // n depends on the workspace b through its folder. That's b itself, and not a second package.
  test.concurrent.each<[string, string, string[]]>([
    ["from the workspace", "packages/n", []],
    ["--filter of the workspace", "", ["--filter", "./packages/n"]],
  ])("a `file:` path to another workspace stays that workspace, bun update %s", async (_, rel, args) => {
    using project = await setup({
      "": ROOT,
      "packages/b": member("b", { tagged: "latest", bonly: "^1.0.0" }),
      "packages/n": member("n", { aaa: "^1.0.0", b: "file:../b" }),
    });
    const { moved, manifests } = await updated(project, rel, ...args);
    expect({ moved, manifests }).toEqual({ moved: { aaa: "1.1.0" }, manifests: ["aaa"] });
    await expectFrozenInstallPasses(project);
  });

  // a links b with `workspace:*`, so an update of a reaches what is below b's own dependencies: what `bparent`
  // depends on, and the `file:` folder with everything in it. b's own dependencies are b's to update.
  test.concurrent.each<[string, string, string[]]>([
    ["from the workspace", "packages/a", []],
    ["--filter of the workspace", "", ["--filter", "./packages/a"]],
  ])(
    "a workspace that is linked with `workspace:*` keeps its own dependencies, bun update %s",
    async (_, rel, args) => {
      using project = await setup(
        registry => ({
          "": ROOT,
          "packages/a": member("a", { aown: "^1.0.0", b: "workspace:*" }),
          "packages/b": member("b", {
            bown: "^1.0.0",
            bparent: "^1.0.0",
            btag: "latest",
            fdep: "file:../../vendor/fdep",
          }),
          "vendor/fdep": member("fdep", {
            frange: "^1.0.0",
            ftag: "latest",
            tar: `${registry}unpublished/tar/-/tar-1.0.0.tgz`,
          }),
        }),
        { bparent: { after: ["1.0.0"], dependencies: () => ({ child: "^1.0.0" }) } },
      );
      const { moved, manifests } = await updated(project, rel, ...args);
      expect({
        moved,
        manifests,
        tarballReadAgain: project.registry.tarballRequests.includes("unpublished/tar@1.0.0"),
      }).toEqual({
        moved: { aown: "1.1.0", child: "1.1.0", frange: "1.1.0", ftag: "2.0.0" },
        manifests: ["aown", "child", "frange", "ftag"],
        tarballReadAgain: true,
      });
      await expectFrozenInstallPasses(project);
    },
  );

  // n also depends on a GitHub branch, whose package depends on `leaf@latest`. The registry refuses `leaf`.
  test.concurrent.each<[string, string[], Json, string[]]>([
    ["another dependency leaves a GitHub branch alone", ["own"], { own: "1.1.0" }, []],
    ["a GitHub branch doesn't resolve again what its package depends on", ["gh-dep"], {}, ["main"]],
  ])("bun update <name> of %s", async (_, names, moved, downloads) => {
    using project = await setup({
      "": ROOT,
      "packages/n": member("n", { own: "^1.0.0", "gh-dep": "github:testowner/testrepo#main" }),
    });
    project.registry.fail("leaf", 401);
    expect((await updated(project, "packages/n", ...names)).moved).toEqual(moved);
    expect(project.registry.githubDownloads).toEqual(downloads);
  });

  // a's `catalog:` dependency is resolved again for every update, and a's GitHub branch keeps its commit: GitHub
  // isn't asked, so its 404 doesn't matter.
  test.concurrent.each<[string, string, string[]]>([
    ["from another workspace", "packages/n", []],
    ["--filter of another workspace", "", ["--filter", "./packages/n"]],
  ])("a GitHub branch next to a `catalog:` dependency isn't downloaded again, bun update %s", async (_, rel, args) => {
    using project = await setup({
      "": { ...ROOT, workspaces: { packages: ["packages/*"], catalog: { cat: "^1.0.0" } } },
      "packages/a": member("a", { cat: "catalog:", "gh-dep": "github:testowner/testrepo#main" }),
      "packages/n": member("n", { own: "^1.0.0" }),
    });
    project.registry.fail("gh-dep", 404);
    const { moved } = await updated(project, rel, ...args);
    expect({ moved, downloads: project.registry.githubDownloads }).toEqual({
      moved: { cat: "1.1.0", own: "1.1.0" },
      downloads: [],
    });
  });

  // The package of `github:testowner/testrepo` depends on `leaf@latest`, and the registry refuses `leaf`. The catalog
  // entry is resolved again for every workspace. What the package depends on is only resolved again for an update
  // that reaches the package. The download still looks ahead to the manifest of `leaf`, and doesn't need it.
  test.concurrent.each<[string, string, string[], number]>([
    ["from another workspace", "packages/n", [], 404],
    ["--filter of another workspace", "", ["--filter", "./packages/n"], 401],
  ])(
    "what a GitHub dependency of another workspace depends on keeps its version, bun update %s",
    async (_, rel, args, status) => {
      using project = await setup({
        "": {
          ...ROOT,
          workspaces: { packages: ["packages/*"], catalog: { "gh-dep": "github:testowner/testrepo#main" } },
        },
        "packages/a": member("a", { "gh-dep": "catalog:" }),
        "packages/n": member("n", { own: "^1.0.0" }),
      });
      project.registry.fail("leaf", status);
      const { moved } = await updated(project, rel, ...args);
      expect({ moved, downloads: project.registry.githubDownloads }).toEqual({
        moved: { own: "1.1.0" },
        downloads: ["main"],
      });
    },
  );

  test.concurrent("bun update --depth 0 keeps what a GitHub dependency depends on", async () => {
    using project = await setup({
      "": { ...ROOT, dependencies: { "gh-dep": "github:testowner/testrepo#main", own: "^1.0.0" } },
    });
    const { moved } = await updated(project, "", "--depth", "0");
    expect({ moved, downloads: project.registry.githubDownloads }).toEqual({
      moved: { own: "1.1.0" },
      downloads: ["main"],
    });
  });

  // Bun 1.4 and older left a workspace out of bun.lock when the root depends on a registry package of its name. Such
  // a bun.lock is the one of a root without the workspace. An update without names from the workspace, from the
  // root, or with `-r` adds it. `--filter` and a name select from bun.lock, so they can't select it before that.
  test.concurrent.each<[string, Json, Json, Json]>([
    ["adds it and updates it", {}, {}, { foo: "2.0.0", own: "1.1.0" }],
    [
      "shares a `latest` dependency with the root",
      {},
      { typesbun: "latest" },
      { foo: "2.0.0", own: "1.1.0", typesbun: "2.0.0" },
    ],
    // The root isn't updated, so it keeps its version of the range that both have.
    [
      "leaves the root on its version of a range",
      { shared: "^1.0.0" },
      {},
      { foo: "2.0.0", own: "1.1.0", shared: "1.0.0 1.1.0" },
    ],
  ])("an update from a workspace that an older bun.lock left out %s", async (_, both, tags, pins) => {
    const rootDependencies = { dependencies: { foo: "^2.0.0", ...both }, devDependencies: tags };
    const foo = { ...member("foo", { own: "^1.0.0", ...both }), devDependencies: tags };
    using project = await setup(
      { "": { name: "root", private: true, ...rootDependencies } },
      { foo: { before: ["2.0.0"], after: ["2.0.0"] } },
      cwd =>
        Promise.all([
          write(join(cwd, "package.json"), stringify({ ...ROOT, ...rootDependencies })),
          write(join(cwd, "packages", "foo", "package.json"), stringify(foo)),
        ]),
    );
    const { stderr, exitCode } = await project.bun("packages/foo", "update");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await project.pins()).toEqual(pins);
    expect((await file(join(project.cwd, "packages", "foo", "package.json")).json()).dependencies).toEqual(
      Object.fromEntries(Object.keys(foo.dependencies).map(name => [name, "^1.1.0"])),
    );
    await expectFrozenInstallPasses(project);
  });
});
