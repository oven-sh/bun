import { file, spawn, write } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { cp, exists, mkdir, rm } from "fs/promises";
import {
  assertManifestsPopulated,
  bunEnv as baseEnv,
  bunExe,
  isWindows,
  readdirSorted,
  runBunInstall,
  runBunUpdate,
  toMatchNodeModulesAt,
  VerdaccioRegistry,
} from "harness";
import { join } from "path";

const { parseLockfile } = install_test_helpers;

expect.extend({ toMatchNodeModulesAt });

var verdaccio: VerdaccioRegistry;

setDefaultTimeout(1000 * 60 * 5);

beforeAll(async () => {
  verdaccio = new VerdaccioRegistry();
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

test.concurrent("allowing negative workspace patterns", async () => {
  using ctx = await setupTest();
  const { packageDir, env } = ctx;
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*", "!packages/pkg2"],
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
  ]);

  const { exited } = await runBunInstall(env, packageDir);
  expect(await exited).toBe(0);

  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });
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
  let shouldFail: string[] = ["workspace:@org/b@1.0.0", "workspace:@org/b@1", "workspace:@org/b"];
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
      } else {
        expect(err).toContain(`No matching version for workspace dependency "a1". Version: "${version}"`);
      }
      expect(await exited).toBe(1);
    });
  }
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
