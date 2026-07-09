import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readlinkSync, statSync } from "fs";
import { mkdir, readlink, rm, symlink } from "fs/promises";
import { TestRegistry, bunEnv, bunExe, readdirSorted, runBunInstall, tempDir } from "harness";
import { dirname, join } from "path";

const registry = new TestRegistry();

// With the global virtual store enabled, dependency symlinks inside a store
// entry point at sibling global-store directories whose names carry a 16-hex
// content-hash suffix (`<name>@<ver>-<hash>/...`). The hash is deterministic
// for a given dependency closure but would make these layout assertions
// brittle, so strip it before comparing.
function withoutEntryHash(link: string): string {
  return link.replace(/(-[0-9a-f]{16})(?=[\\/])/, "");
}

// Extract just the `<storepath>-<hash>` segment from a global-store link
// target. Tests that compare entries across two test dirs need this because
// each `createTestDir` gets its own `.bun-cache/` (so the absolute targets
// always differ) but the hash suffix is what proves sharing/isolation.
function entryStoreName(link: string): string {
  return link.slice(link.lastIndexOf("links") + "links".length + 1);
}

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("basic", () => {
  test("single dependency", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-1",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
      join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("scope package", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-2",
        dependencies: {
          "@types/is-number": "1.0.0",
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    expect(readlinkSync(join(packageDir, "node_modules", "@types", "is-number"))).toBe(
      join("..", ".bun", "@types+is-number@1.0.0", "node_modules", "@types", "is-number"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "@types", "is-number"))).toBe(
      join("..", "..", "@types+is-number@1.0.0", "node_modules", "@types", "is-number"),
    );
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@types+is-number@1.0.0",
          "node_modules",
          "@types",
          "is-number",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@types/is-number",
      version: "1.0.0",
    });
  });

  test("transitive dependencies", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-3",
        dependencies: {
          "two-range-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "two-range-deps"]);
    expect(readlinkSync(join(packageDir, "node_modules", "two-range-deps"))).toBe(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "two-range-deps"))).toBe(
      join("..", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.1.0", "node_modules", "no-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "@types", "is-number"))).toBe(
      join("..", "..", "@types+is-number@2.0.0", "node_modules", "@types", "is-number"),
    );
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "two-range-deps@1.0.0",
          "node_modules",
          "two-range-deps",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "two-range-deps",
      version: "1.0.0",
      dependencies: {
        "no-deps": "^1.0.0",
        "@types/is-number": ">=1.0.0",
      },
    });
    expect(
      await readdirSorted(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules")),
    ).toEqual(["@types", "no-deps", "two-range-deps"]);
    expect(
      withoutEntryHash(
        readlinkSync(
          join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "@types", "is-number"),
        ),
      ),
    ).toBe(join("..", "..", "..", "@types+is-number@2.0.0", "node_modules", "@types", "is-number"));
    expect(
      withoutEntryHash(
        readlinkSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps")),
      ),
    ).toBe(join("..", "..", "no-deps@1.1.0", "node_modules", "no-deps"));
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.1.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.1.0",
    });
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@types+is-number@2.0.0",
          "node_modules",
          "@types",
          "is-number",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@types/is-number",
      version: "2.0.0",
    });
  });
});

test("handles cyclic dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-cyclic",
      dependencies: {
        "a-dep-b": "1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(readlinkSync(join(packageDir, "node_modules", "a-dep-b"))).toBe(
    join(".bun", "a-dep-b@1.0.0", "node_modules", "a-dep-b"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "a-dep-b"))).toBe(
    join("..", "a-dep-b@1.0.0", "node_modules", "a-dep-b"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "b-dep-a"))).toBe(
    join("..", "b-dep-a@1.0.0", "node_modules", "b-dep-a"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "a-dep-b", "package.json"),
    ).json(),
  ).toEqual({
    name: "a-dep-b",
    version: "1.0.0",
    dependencies: {
      "b-dep-a": "1.0.0",
    },
  });

  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "b-dep-a")),
    ),
  ).toBe(join("..", "..", "b-dep-a@1.0.0", "node_modules", "b-dep-a"));
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "b-dep-a", "package.json"),
    ).json(),
  ).toEqual({
    name: "b-dep-a",
    version: "1.0.0",
    dependencies: {
      "a-dep-b": "1.0.0",
    },
  });
});

test("package with dependency on previous self works", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-transitive-self-dep",
      dependencies: {
        "self-dep": "1.0.2",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(
    await Promise.all([
      file(join(packageDir, "node_modules", "self-dep", "package.json")).json(),
      file(join(packageDir, "node_modules", "self-dep", "node_modules", "self-dep", "package.json")).json(),
    ]),
  ).toEqual([
    {
      name: "self-dep",
      version: "1.0.2",
      dependencies: {
        "self-dep": "1.0.1",
      },
    },
    {
      name: "self-dep",
      version: "1.0.1",
    },
  ]);
});

test("can install folder dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-folder-deps",
      dependencies: {
        "folder-dep": "file:./pkg-1",
      },
    }),
  );

  await write(join(packageDir, "pkg-1", "package.json"), JSON.stringify({ name: "folder-dep", version: "1.0.0" }));

  await runBunInstall(bunEnv, packageDir);

  expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
    join(".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep", "package.json"),
    ).json(),
  ).toEqual({
    name: "folder-dep",
    version: "1.0.0",
  });

  await write(join(packageDir, "pkg-1", "index.js"), "module.exports = 'hello from pkg-1';");

  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
  expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
    join(".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep", "index.js"),
    ).text(),
  ).toBe("module.exports = 'hello from pkg-1';");
});

test("can install folder dependencies on root package", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "root-file-dep",
        workspaces: ["packages/*"],
        dependencies: {
          self: "file:.",
        },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        dependencies: {
          root: "file:../..",
        },
      }),
    ),
  ]);

  await runBunInstall(bunEnv, packageDir);

  expect(
    await Promise.all([
      readlink(join(packageDir, "node_modules", "self")),
      readlink(join(packageDir, "packages", "pkg1", "node_modules", "root")),
      file(join(packageDir, "node_modules", "self", "package.json")).json(),
    ]),
  ).toEqual([
    join(".bun", "root-file-dep@root", "node_modules", "root-file-dep"),
    join("..", "..", "..", "node_modules", ".bun", "root-file-dep@root", "node_modules", "root-file-dep"),
    await file(packageJson).json(),
  ]);
});

describe("isolated workspaces", () => {
  test("basic", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-workspaces",
          workspaces: {
            packages: ["pkg-1", "pkg-2"],
          },
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "pkg-1", "package.json"),
        JSON.stringify({
          name: "pkg-1",
          version: "1.0.0",
          dependencies: {
            "a-dep": "1.0.1",
            "pkg-2": "workspace:",
            "@types/is-number": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "pkg-2", "package.json"),
        JSON.stringify({
          name: "pkg-2",
          version: "1.0.0",
          dependencies: {
            "b-dep-a": "1.0.0",
          },
        }),
      ),
    ]);

    await runBunInstall(bunEnv, packageDir);

    expect(existsSync(join(packageDir, "node_modules", "pkg-1"))).toBeFalse();
    expect(readlinkSync(join(packageDir, "pkg-1", "node_modules", "pkg-2"))).toBe(join("..", "..", "pkg-2"));
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps"]);
    expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
      join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
    );

    expect(await readdirSorted(join(packageDir, "pkg-1", "node_modules"))).toEqual(["@types", "a-dep", "pkg-2"]);
    expect(await readdirSorted(join(packageDir, "pkg-2", "node_modules"))).toEqual(["b-dep-a"]);
    expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual([
      "@types+is-number@1.0.0",
      "a-dep-b@1.0.0",
      "a-dep@1.0.1",
      "b-dep-a@1.0.0",
      "no-deps@1.0.0",
      "node_modules",
    ]);

    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("workspace self dependencies create symlinks", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "monorepo-workspace-self-dep",
          workspaces: ["packages/*"],
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          dependencies: {
            pkg1: "workspace:*",
          },
        }),
        "packages/pkg2/package.json": JSON.stringify({
          name: "pkg2",
          dependencies: {
            "pkg1": "workspace:*",
            "pkg2": "workspace:*",
          },
        }),
        "packages/pkg3/package.json": JSON.stringify({
          name: "pkg3",
          dependencies: {
            "different-name": "workspace:.",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        file(join(packageDir, "packages", "pkg1", "node_modules", "pkg1", "package.json")).json(),
        file(join(packageDir, "packages", "pkg2", "node_modules", "pkg1", "package.json")).json(),
        file(join(packageDir, "packages", "pkg2", "node_modules", "pkg2", "package.json")).json(),
        file(join(packageDir, "packages", "pkg3", "node_modules", "different-name", "package.json")).json(),
      ]),
    ).toEqual([
      [".bun"],
      { name: "pkg1", dependencies: { pkg1: "workspace:*" } },
      { name: "pkg1", dependencies: { pkg1: "workspace:*" } },
      { name: "pkg2", dependencies: { pkg1: "workspace:*", pkg2: "workspace:*" } },
      { name: "pkg3", dependencies: { "different-name": "workspace:." } },
    ]);
  });
});

describe("optional peers", () => {
  const tests = [
    // non-optional versions
    {
      name: "non-optional transitive only",
      deps: [{ "one-optional-peer-dep": "1.0.1" }, { "one-optional-peer-dep": "1.0.1" }],
      expected: ["no-deps@1.1.0", "node_modules", "one-optional-peer-dep@1.0.1+7ff199101204a65d"],
    },
    {
      name: "non-optional direct pkg1",
      deps: [{ "one-optional-peer-dep": "1.0.1", "no-deps": "1.0.1" }, { "one-optional-peer-dep": "1.0.1" }],
      expected: ["no-deps@1.0.1", "node_modules", "one-optional-peer-dep@1.0.1+f8a822eca018d0a1"],
    },
    {
      name: "non-optional direct pkg2",
      deps: [{ "one-optional-peer-dep": "1.0.1" }, { "one-optional-peer-dep": "1.0.1", "no-deps": "1.0.1" }],
      expected: ["no-deps@1.0.1", "node_modules", "one-optional-peer-dep@1.0.1+f8a822eca018d0a1"],
    },
    // optional versions
    {
      name: "optional transitive only",
      deps: [{ "one-optional-peer-dep": "1.0.2" }, { "one-optional-peer-dep": "1.0.2" }],
      expected: ["node_modules", "one-optional-peer-dep@1.0.2"],
    },
    {
      name: "optional direct pkg1",
      deps: [{ "one-optional-peer-dep": "1.0.2", "no-deps": "1.0.1" }, { "one-optional-peer-dep": "1.0.2" }],
      expected: ["no-deps@1.0.1", "node_modules", "one-optional-peer-dep@1.0.2+f8a822eca018d0a1"],
    },
    {
      name: "optional direct pkg2",
      deps: [{ "one-optional-peer-dep": "1.0.2" }, { "one-optional-peer-dep": "1.0.2", "no-deps": "1.0.1" }],
      expected: ["no-deps@1.0.1", "node_modules", "one-optional-peer-dep@1.0.2+f8a822eca018d0a1"],
    },
  ];

  for (const { deps, expected, name } of tests) {
    test(`will resolve if available through another importer (${name})`, async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({
            name: "optional-peers",
            workspaces: ["packages/*"],
          }),
          "packages/pkg1/package.json": JSON.stringify({
            name: "pkg1",
            dependencies: deps[0],
          }),
          "packages/pkg2/package.json": JSON.stringify({
            name: "pkg2",
            dependencies: deps[1],
          }),
        },
      });

      async function checkInstall() {
        const { exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          env: bunEnv,
          stdout: "ignore",
          stderr: "ignore",
        });

        expect(await exited).toBe(0);
        expect(await readdirSorted(join(packageDir, "node_modules/.bun"))).toEqual(expected);
      }

      // without lockfile
      // without node_modules
      await checkInstall();

      // with lockfile
      // without node_modules
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await checkInstall();

      // without lockfile
      // with node_modules
      await rm(join(packageDir, "bun.lock"), { force: true });
      await checkInstall();

      // with lockfile
      // with node_modules
      await checkInstall();
    });
  }

  test("successfully resolves optional peer with nested package", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "optional-peer-nested-resolve",
          dependencies: {
            "one-one-dep": "1.0.0",
          },
          peerDependencies: {
            "one-dep": "1.0.0",
          },
          peerDependenciesMeta: {
            "one-dep": {
              optional: true,
            },
          },
        }),
      },
    });

    async function checkInstall() {
      let { exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        env: bunEnv,
      });
      expect(await exited).toBe(0);

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "one-dep", "one-one-dep"]);
      expect(await readdirSorted(join(packageDir, "node_modules/.bun"))).toEqual([
        "no-deps@1.0.1",
        "node_modules",
        "one-dep@1.0.0",
        "one-one-dep@1.0.0",
      ]);
    }

    await checkInstall();
    await checkInstall();
  });
});

// https://github.com/oven-sh/bun/issues/28147
test("patched package shared by multiple peer variants is materialized into the cache once", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  // `peer-deps@1.0.0` has `peerDependencies: { "no-deps": "*" }`. Giving each
  // workspace a different `no-deps` version forces one isolated store variant
  // of `peer-deps` per workspace, all sharing one patched cache directory.
  const noDepsVersions = ["1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  await write(
    packageJson,
    JSON.stringify({
      name: "patched-peer-variants",
      workspaces: ["packages/*"],
      patchedDependencies: {
        "peer-deps@1.0.0": "patches/peer-deps@1.0.0.patch",
      },
    }),
  );
  await write(
    join(packageDir, "patches", "peer-deps@1.0.0.patch"),
    `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`,
  );
  for (const version of noDepsVersions) {
    await write(
      join(packageDir, "packages", `pkg-${version}`, "package.json"),
      JSON.stringify({
        name: `pkg-${version}`,
        version: "1.0.0",
        dependencies: {
          "peer-deps": "1.0.0",
          "no-deps": version,
        },
      }),
    );
  }

  // CI exports BUN_INSTALL_CACHE_DIR, which overrides bunfig's `cache`. Pin it
  // so the patched cache directory is created where the assertions look.
  const cacheDir = join(packageDir, ".bun-cache");

  // Force the hardlink backend so the inode assertions below hold on every
  // platform (macOS defaults to clonefile, which copies).
  async function install() {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--backend", "hardlink"],
      cwd: packageDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("error:");
    expect(out).toContain("packages installed");
    expect(exitCode).toBe(0);
  }

  async function checkInstall() {
    const storeDirs = (await readdirSorted(join(packageDir, "node_modules", ".bun"))).filter(dir =>
      dir.startsWith("peer-deps@1.0.0"),
    );
    expect(storeDirs.length).toBe(noDepsVersions.length);

    // Exactly one patched cache directory exists for the package.
    const cacheDirs = (await readdirSorted(cacheDir)).filter(
      dir => dir.startsWith("peer-deps@1.0.0") && dir.includes("_patch_hash="),
    );
    expect(cacheDirs.length).toBe(1);
    const cacheFile = join(cacheDir, cacheDirs[0], "index.js");

    // The patch is applied in every variant, and every variant is hardlinked
    // from the single patched cache materialization. Before the fix each
    // variant re-applied the patch, replacing the shared cache directory the
    // previous variant was concurrently hardlinking from (EPERM on Windows,
    // divergent inodes on POSIX).
    const inodes = new Set<number>();
    for (const storeDir of storeDirs) {
      const pkgDir = join(packageDir, "node_modules", ".bun", storeDir, "node_modules", "peer-deps");
      expect(await file(join(pkgDir, "patched.txt")).text()).toBe("hello world\n");
      inodes.add(statSync(join(pkgDir, "index.js")).ino);
    }
    inodes.add(statSync(cacheFile).ino);
    expect(inodes.size).toBe(1);
  }

  await install();
  await checkInstall();

  // Reinstall with a warm cache and no node_modules: the patched cache
  // directory already exists and must not be rebuilt per variant.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await install();
  await checkInstall();
});

for (const backend of ["clonefile", "hardlink", "copyfile"]) {
  test(`isolated install with backend: ${backend}`, async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-backend",
          dependencies: {
            "no-deps": "1.0.0",
            "alias-loop-2": "1.0.0",
            "alias-loop-1": "1.0.0",
            "1-peer-dep-a": "1.0.0",
            "basic-1": "1.0.0",
            "is-number": "1.0.0",
            "file-dep": "file:./file-dep",
            "@scoped/file-dep": "file:./scoped-file-dep",
          },
        }),
      ),
      write(join(packageDir, "file-dep", "package.json"), JSON.stringify({ name: "file-dep", version: "1.0.0" })),
      write(
        join(packageDir, "file-dep", "dir1", "dir2", "dir3", "dir4", "dir5", "index.js"),
        "module.exports = 'hello from file-dep';",
      ),
      write(
        join(packageDir, "scoped-file-dep", "package.json"),
        JSON.stringify({ name: "@scoped/file-dep", version: "1.0.0" }),
      ),
    ]);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--backend", backend],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exited).toBe(0);
    const out = await stdout.text();
    const err = await stderr.text();

    expect(err).not.toContain("error");
    expect(err).not.toContain("warning");

    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });

    expect(readlinkSync(join(packageDir, "node_modules", "file-dep"))).toBe(
      join(".bun", "file-dep@file+file-dep", "node_modules", "file-dep"),
    );

    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "file-dep@file+file-dep", "node_modules", "file-dep", "package.json"),
      ).json(),
    ).toEqual({
      name: "file-dep",
      version: "1.0.0",
    });

    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "file-dep@file+file-dep",
          "node_modules",
          "file-dep",
          "dir1",
          "dir2",
          "dir3",
          "dir4",
          "dir5",
          "index.js",
        ),
      ).text(),
    ).toBe("module.exports = 'hello from file-dep';");

    expect(readlinkSync(join(packageDir, "node_modules", "@scoped", "file-dep"))).toBe(
      join("..", ".bun", "@scoped+file-dep@file+scoped-file-dep", "node_modules", "@scoped", "file-dep"),
    );

    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@scoped+file-dep@file+scoped-file-dep",
          "node_modules",
          "@scoped",
          "file-dep",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@scoped/file-dep",
      version: "1.0.0",
    });
  });
}

test("ranged peer dependency resolution is stable across installs from bun.lock", async () => {
  // `peer-deps-fixed` has a peer on `no-deps@^1.0.0`. The graph contains both
  // no-deps@1.0.1 (exact pin via normal-dep-and-dev-dep, hoisted to the root
  // of the saved tree) and no-deps@1.1.0 (via two-range-deps). The fresh
  // resolve binds the peer edge to the highest satisfying version (1.1.0) in
  // its deferred-peer phase; reloading bun.lock used to re-derive the edge
  // from the saved tree paths instead, rebinding it to the hoisted 1.0.1.
  // That silently changed the runtime dependency tree on the second install
  // and re-keyed the isolated store entry (`+<peer hash>` suffix) on every
  // warm install.
  const { packageJson, packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "stable-ranged-peers",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "normal-dep-and-dev-dep": "1.0.0",
        "two-range-deps": "1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  // highest satisfying ^1.0.0 in the graph; `toContain` prints the full
  // listing when the entry is missing or keyed with a different peer hash
  const entryName = "peer-deps-fixed@1.0.0+7ff199101204a65d";
  expect(await readdirSorted(bunDir)).toContain(entryName);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });

  // reinstall from bun.lock: same peer variant, same resolved version
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });

  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"))).toEqual([entryName]);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });
});

test("aliased peer dependency binds to its real package across installs from bun.lock", async () => {
  // The peer alias `no-deps` points at `npm:a-dep@^1.0.2` while the real
  // no-deps package (in two versions) is also in the graph. Loading bun.lock
  // must look the edge up under the aliased *real* name (a-dep) the way the
  // fresh resolver does; a lookup under the alias would find the real
  // no-deps packages, whose versions also satisfy ^1.0.2, and rebind the
  // edge to the wrong package.
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        name: "aliased-peer-root",
        workspaces: ["packages/*"],
        dependencies: {
          "normal-dep-and-dev-dep": "1.0.0",
          "two-range-deps": "1.0.0",
        },
      }),
      "packages/m/package.json": JSON.stringify({
        name: "m",
        version: "1.0.0",
        peerDependencies: { "no-deps": "npm:a-dep@^1.0.2" },
      }),
    },
  });

  await runBunInstall(bunEnv, packageDir);
  const aliasLink = join(packageDir, "packages", "m", "node_modules", "no-deps", "package.json");
  const fresh = await file(aliasLink).json();
  expect(fresh).toMatchObject({ name: "a-dep" });

  // reinstall from bun.lock: still the aliased package, same version
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "packages", "m", "node_modules"), { recursive: true, force: true });
  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
  expect(await file(aliasLink).json()).toEqual(fresh);
});

test("optional ranged peer keeps its hoisted-tree binding across installs from bun.lock", async () => {
  // Optional peers never reach the fresh resolver's deferred-peer phase: it
  // returns before the version scan and the edge is bound to the
  // hoisted-tree sibling during tree resolution, which the printed tree's
  // path walk reproduces exactly. With both no-deps@1.0.1 and no-deps@1.1.0
  // in the graph, binding the optional peer by version on load would pick
  // the highest satisfying (1.1.0) while the fresh install bound the hoisted
  // 1.0.1, re-keying the entry on the first reinstall.
  const { packageJson, packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "stable-optional-peers",
      dependencies: {
        "one-optional-peer-dep": "1.0.2",
        "normal-dep-and-dev-dep": "1.0.0",
        "two-range-deps": "1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  const freshEntries = (await readdirSorted(bunDir)).filter(e => e.startsWith("one-optional-peer-dep@"));
  expect(freshEntries).toHaveLength(1);
  // the hoisted candidate, not the highest satisfying (1.1.0)
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });

  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("one-optional-peer-dep@"))).toEqual(freshEntries);
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });
});

test("overridden peer dependency keeps the override across installs from bun.lock", async () => {
  // `overrides` rewrites the peer range before the fresh resolver's version
  // scan, binding the peer to no-deps@1.0.1 even though the graph also
  // contains no-deps@1.1.0 (via an override-exempt npm: alias). Loading
  // bun.lock must not re-filter candidates with the raw ^1.0.0 manifest
  // range, which the override replaced; that would rebind the edge to 1.1.0
  // and re-key the entry on the first reinstall.
  const { packageJson, packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "stable-overridden-peers",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "nd11": "npm:no-deps@1.1.0",
        // provides no-deps@1.0.1 so the overridden peer range resolves to an
        // installed package
        "normal-dep-and-dev-dep": "1.0.0",
      },
      overrides: { "no-deps": "1.0.1" },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  const entryName = "peer-deps-fixed@1.0.0+f8a822eca018d0a1";
  // the override-exempt alias keeps the competing 1.1.0 candidate in the graph
  const aliasManifest = join(packageDir, "node_modules", "nd11", "package.json");
  expect(await file(aliasManifest).json()).toMatchObject({ name: "no-deps", version: "1.1.0" });
  expect(await readdirSorted(bunDir)).toContain(entryName);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });

  expect(await file(aliasManifest).json()).toMatchObject({ name: "no-deps", version: "1.1.0" });
  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"))).toEqual([entryName]);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });
});

test("peer satisfied by a workspace package keeps the workspace across installs from bun.lock", async () => {
  // The fresh resolver binds an npm-range peer to a same-named workspace
  // package before any deferral when linkWorkspacePackages is on and the
  // workspace version satisfies the range. The graph also contains npm
  // no-deps@1.0.1 (normal-dep-and-dev-dep's exact pin, which the workspace's
  // 1.0.0 cannot satisfy), and that version satisfies the peer's ^1.0.0 too;
  // loading bun.lock must not rebind the peer from the workspace to the npm
  // package through the version scan.
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        name: "workspace-peer-root",
        workspaces: ["packages/*"],
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "normal-dep-and-dev-dep": "1.0.0",
        },
      }),
      "packages/no-deps/package.json": JSON.stringify({
        name: "no-deps",
        version: "1.0.0",
        workspaceMarker: true,
      }),
    },
  });

  await runBunInstall(bunEnv, packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  const freshEntries = (await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"));
  expect(freshEntries).toHaveLength(1);
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.0",
    workspaceMarker: true,
  });

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });

  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"))).toEqual(freshEntries);
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.0",
    workspaceMarker: true,
  });
});

describe("existing node_modules, missing node_modules/.bun", () => {
  test("root and workspace node_modules are reset", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "delete-node-modules",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
            "a-dep": "1.0.1",
          },
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "1.0.1",
          },
        }),
        "packages/pkg2/package.json": JSON.stringify({
          name: "pkg2",
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
        "node_modules/oops": "delete me!",
        "packages/pkg1/node_modules/oops1": "delete me!",
        "packages/pkg2/node_modules/oops2": "delete me!",
      },
    });

    let { exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg1", "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg2", "node_modules")),
      ]),
    ).toEqual([[".bun", expect.stringContaining(".old_modules-"), "a-dep", "no-deps"], ["no-deps"], ["no-deps"]]);
  });
  test("some workspaces don't have node_modules", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "missing-workspace-node_modules",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
        "node_modules/hi": "BUN",
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg-one",
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
        "packages/pkg1/node_modules/foo": "HI",
        "packages/pkg2/package.json": JSON.stringify({
          name: "pkg-two",
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      },
    });

    let { exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg1", "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg2", "node_modules")),
      ]),
    ).toEqual([[".bun", expect.stringContaining(".old_modules-"), "no-deps"], ["no-deps"], ["a-dep"]]);

    // another install will not reset the node_modules

    const entries = await readdirSorted(join(packageDir, "node_modules"));

    for (const entry of entries) {
      if (entry.startsWith(".old_modules-")) {
        await rm(join(packageDir, "node_modules", entry), { recursive: true, force: true });
      }
    }
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps"]);

    // add things to workspace node_modules. these will go undetected
    await Promise.all([
      write(join(packageDir, "packages", "pkg1", "node_modules", "oops1"), "HI1"),
      write(join(packageDir, "packages", "pkg2", "node_modules", "oops2"), "HI2"),
    ]);

    ({ exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg1", "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg2", "node_modules")),
      ]),
    ).toEqual([
      [".bun", "no-deps"],
      ["no-deps", "oops1"],
      ["a-dep", "oops2"],
    ]);
  });
});

describe("--linker flag", () => {
  test("can override linker from bunfig", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-linker",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    let { exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "hoisted"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();
  });

  test("works as the only config option", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-linker",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    let { exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "hoisted"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();
  });
});
test("many transitive dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-many-transitive-deps",
      dependencies: {
        "alias-loop-1": "1.0.0",
        "alias-loop-2": "1.0.0",
        "1-peer-dep-a": "1.0.0",
        "basic-1": "1.0.0",
        "is-number": "1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
    ".bun",
    "1-peer-dep-a",
    "alias-loop-1",
    "alias-loop-2",
    "basic-1",
    "is-number",
  ]);
  expect(readlinkSync(join(packageDir, "node_modules", "alias-loop-1"))).toBe(
    join(".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "alias-loop-1"))).toBe(
    join("..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "alias-loop-2"))).toBe(
    join("..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-1",
    version: "1.0.0",
    dependencies: {
      "alias1": "npm:alias-loop-2@*",
    },
  });
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-2",
    version: "1.0.0",
    dependencies: {
      "alias2": "npm:alias-loop-1@*",
    },
  });
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules"))).toEqual([
    "alias-loop-1",
    "alias1",
  ]);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules"))).toEqual([
    "alias-loop-2",
    "alias2",
  ]);
  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias1")),
    ),
  ).toBe(join("..", "..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"));
  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias2")),
    ),
  ).toBe(join("..", "..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"));
});

test("dependency names are preserved", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-dependency-names",
      dependencies: {
        "alias-loop-1": "1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "alias-loop-1"]);
  expect(readlinkSync(join(packageDir, "node_modules", "alias-loop-1"))).toBe(
    join(".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules"))).toEqual([
    "alias-loop-1",
    "alias1",
  ]);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules"))).toEqual([
    "alias-loop-2",
    "alias2",
  ]);
  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias1")),
    ),
  ).toBe(join("..", "..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"));
  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias2")),
    ),
  ).toBe(join("..", "..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"));
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-1",
    version: "1.0.0",
    dependencies: {
      "alias1": "npm:alias-loop-2@*",
    },
  });
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-2",
    version: "1.0.0",
    dependencies: {
      "alias2": "npm:alias-loop-1@*",
    },
  });
});

test("same resolution, different dependency name", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-same-resolution",
      dependencies: {
        "no-deps-1": "npm:no-deps@1.0.0",
        "no-deps-2": "npm:no-deps@1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps-1", "no-deps-2"]);
  expect(readlinkSync(join(packageDir, "node_modules", "no-deps-1"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", "no-deps-2"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
    ).json(),
  ).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual(["no-deps@1.0.0", "node_modules"]);
});

test("successfully removes and corrects symlinks", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  await Promise.all([
    write(join(packageDir, "old-package", "package.json"), JSON.stringify({ name: "old-package", version: "1.0.0" })),
    mkdir(join(packageDir, "node_modules")),
  ]);
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-dangling-symlinks",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    ),
    symlink(join("..", "old-package"), join(packageDir, "node_modules", "no-deps"), "dir"),
  ]);

  await runBunInstall(bunEnv, packageDir);

  expect(existsSync(join(packageDir, "node_modules", "no-deps"))).toBeTrue();

  expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
});

test("runs lifecycle scripts correctly", async () => {
  // due to binary linking between preinstall and the remaining lifecycle scripts
  // there is special handling for preinstall scripts we should test.
  // 1. only preinstall
  // 2. only postinstall (or any other script that isn't preinstall)
  // 3. preinstall and any other script

  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-lifecycle-scripts",
      dependencies: {
        "lifecycle-preinstall": "1.0.0",
        "lifecycle-postinstall": "1.0.0",
        "all-lifecycle-scripts": "1.0.0",
      },
      trustedDependencies: ["lifecycle-preinstall", "lifecycle-postinstall", "all-lifecycle-scripts"],
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  const [
    preinstallLink,
    postinstallLink,
    allScriptsLink,
    preinstallFile,
    postinstallFile,
    allScriptsPreinstallFile,
    allScriptsInstallFile,
    allScriptsPostinstallFile,
    bunDir,
    lifecyclePreinstallDir,
    lifecyclePostinstallDir,
    allLifecycleScriptsDir,
  ] = await Promise.all([
    readlink(join(packageDir, "node_modules", "lifecycle-preinstall")),
    readlink(join(packageDir, "node_modules", "lifecycle-postinstall")),
    readlink(join(packageDir, "node_modules", "all-lifecycle-scripts")),
    file(join(packageDir, "node_modules", "lifecycle-preinstall", "preinstall.txt")).text(),
    file(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "preinstall.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "install.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "postinstall.txt")).text(),
    readdirSorted(join(packageDir, "node_modules", ".bun")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "lifecycle-preinstall@1.0.0", "node_modules")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "lifecycle-postinstall@1.0.0", "node_modules")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "all-lifecycle-scripts@1.0.0", "node_modules")),
  ]);

  expect(preinstallLink).toBe(join(".bun", "lifecycle-preinstall@1.0.0", "node_modules", "lifecycle-preinstall"));
  expect(postinstallLink).toBe(join(".bun", "lifecycle-postinstall@1.0.0", "node_modules", "lifecycle-postinstall"));
  expect(allScriptsLink).toBe(join(".bun", "all-lifecycle-scripts@1.0.0", "node_modules", "all-lifecycle-scripts"));

  expect(preinstallFile).toBe("preinstall!");
  expect(postinstallFile).toBe("postinstall!");
  expect(allScriptsPreinstallFile).toBe("preinstall!");
  expect(allScriptsInstallFile).toBe("install!");
  expect(allScriptsPostinstallFile).toBe("postinstall!");

  expect(bunDir).toEqual([
    "all-lifecycle-scripts@1.0.0",
    "lifecycle-postinstall@1.0.0",
    "lifecycle-preinstall@1.0.0",
    "node_modules",
  ]);

  expect(lifecyclePreinstallDir).toEqual(["lifecycle-preinstall"]);
  expect(lifecyclePostinstallDir).toEqual(["lifecycle-postinstall"]);
  expect(allLifecycleScriptsDir).toEqual(["all-lifecycle-scripts"]);
});

// When an auto-installed peer dependency has its OWN peer deps, those
// transitive peers get re-queued during peer processing. If all manifest
// loads are synchronous (cached with valid max-age) AND the transitive peer's
// version constraint doesn't match what's already in the lockfile,
// pendingTaskCount() stays at 0 and waitForPeers was skipped — leaving
// the transitive peer's resolution unset (= invalid_package_id → filtered
// from the install).
test("transitive peer deps are resolved when resolution is fully synchronous", async () => {
  // bun's warm-manifest gate is an on-disk cache entry younger than
  // 300 s (`src/install/npm.rs`). On the second install the manifest
  // cache is still fresh, so every resolution is synchronous, which is
  // the bug trigger.
  await using server = await new TestRegistry().start();

  using packageDir = tempDir("transitive-peer-test-", {});
  const packageJson = join(String(packageDir), "package.json");
  const cacheDir = join(String(packageDir), ".bun-cache");
  const bunfig = `[install]\ncache = "${cacheDir.replaceAll("\\", "\\\\")}"\nregistry = "${server.url}"\nlinker = "isolated"\n`;
  await write(join(String(packageDir), "bunfig.toml"), bunfig);

  await write(
    packageJson,
    JSON.stringify({
      name: "test-transitive-peer",
      dependencies: {
        // Chain: uses-strict-peer → (peer) strict-peer-dep → (peer) no-deps@^2.0.0
        // Root has no-deps@1.0.0, which does NOT satisfy ^2.0.0. This forces
        // strict-peer-dep's peer `no-deps` through the full resolution pass
        // (can't reuse root's no-deps via getPackageID).
        "no-deps": "1.0.0",
        "uses-strict-peer": "1.0.0",
      },
    }),
  );

  // First install: populates manifest cache (with max-age=300 from server)
  await runBunInstall(bunEnv, String(packageDir), { allowWarnings: true });

  // Second install with NO lockfile and WARM cache. Manifests are fresh
  // (within max-age) so all loads are synchronous — this is the bug trigger.
  await rm(join(String(packageDir), "node_modules"), { recursive: true, force: true });
  await rm(join(String(packageDir), "bun.lock"), { force: true });
  await runBunInstall(bunEnv, String(packageDir), { allowWarnings: true });

  // Entry names have peer hashes; find them dynamically
  const bunDir = join(String(packageDir), "node_modules", ".bun");
  const entries = await readdirSorted(bunDir);
  const strictPeerEntry = entries.find(e => e.startsWith("strict-peer-dep@1.0.0"));
  const usesStrictEntry = entries.find(e => e.startsWith("uses-strict-peer@1.0.0"));

  // strict-peer-dep must exist (auto-installed via uses-strict-peer's peer)
  expect(strictPeerEntry).toBeDefined();
  expect(usesStrictEntry).toBeDefined();

  // strict-peer-dep's own peer `no-deps` must be resolved and symlinked.
  // Without the fix: this symlink is missing because the transitive peer
  // queue was never drained after drainDependencyList re-queued it.
  expect(existsSync(join(bunDir, strictPeerEntry!, "node_modules", "no-deps"))).toBe(true);

  // Verify the chain is intact
  expect(withoutEntryHash(readlinkSync(join(bunDir, usesStrictEntry!, "node_modules", "strict-peer-dep")))).toBe(
    join("..", "..", strictPeerEntry!, "node_modules", "strict-peer-dep"),
  );
});

describe("global virtual store", () => {
  // The global virtual store is off by default; tests that exercise it opt
  // in via bunfig `install.globalStore = true`.
  const gvsBunfigOpts = { linker: "isolated", globalStore: true } as const;

  test("is disabled by default", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-default-off",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    // With the global store disabled (the default) the entry is a real
    // directory under `node_modules/.bun/` (the pre-global-store layout).
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(existsSync(join(entry, "node_modules", "no-deps", "package.json"))).toBe(true);
  });

  test("can be enabled via BUN_INSTALL_GLOBAL_STORE=1", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-on-env",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall({ ...bunEnv, BUN_INSTALL_GLOBAL_STORE: "1" }, packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(entry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);
  });

  test("can be enabled via bunfig install.globalStore", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-on-bunfig",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(entry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);
  });

  test("survives node_modules wipe", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    // First install: populates `<cache>/links/` and creates project symlinks.
    await runBunInstall(bunEnv, packageDir);

    // `node_modules/.bun/<storepath>` is a symlink (to the global virtual store),
    // not a real directory containing a clonefiled copy of the package.
    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const target = readlinkSync(entry);
    expect(target).toMatch(/links[\/\\]two-range-deps@1\.0\.0-[0-9a-f]{16}$/);
    expect(existsSync(join(target, "node_modules", "two-range-deps", "package.json"))).toBe(true);
    // dep symlink inside the global entry points at a sibling global entry
    expect(readlinkSync(join(target, "node_modules", "no-deps"))).toMatch(
      /^\.\.[\/\\]\.\.[\/\\]no-deps@1\.1\.0-[0-9a-f]{16}[\/\\]node_modules[\/\\]no-deps$/,
    );

    // Second install after wiping node_modules: the global entry persists, so
    // the project entry is re-created as a symlink to the *same* global path
    // without re-materialising package files.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });

    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(entry)).toBe(target);
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "two-range-deps@1.0.0",
          "node_modules",
          "two-range-deps",
          "package.json",
        ),
      ).json(),
    ).toMatchObject({ name: "two-range-deps", version: "1.0.0" });
  });

  test("--force replaces a corrupted global-store entry", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-force-heal",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const gvsTarget = readlinkSync(entry);
    const pkgDir = join(gvsTarget, "node_modules", "no-deps");
    const pkgJsonPath = join(pkgDir, "package.json");
    const indexPath = join(pkgDir, "index.js");
    const original = await file(pkgJsonPath).text();

    // Corrupt the published global-store entry: delete files (the directory
    // still exists, so the warm-hit `directoryExistsAt` check is satisfied
    // and a plain reinstall takes the symlink-only fast path). The
    // extraction cache the entry was hardlinked from keeps its own
    // hardlinks, so the source bytes for --force to rebuild from are intact.
    await rm(pkgJsonPath, { force: true });
    await rm(indexPath, { force: true });

    // Sanity: a non-force reinstall does NOT heal — it sees the directory
    // present and reuses it. (This pins the warm-hit semantics so the
    // assertion below is meaningful.)
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
    expect(existsSync(pkgJsonPath)).toBe(false);

    // --force must rebuild staging and swap it into place over the corrupt
    // final directory instead of discarding the fresh tree on EEXIST.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--force"],
        cwd: packageDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    expect(readlinkSync(entry)).toBe(gvsTarget);
    expect(await file(pkgJsonPath).text()).toBe(original);
    expect(existsSync(indexPath)).toBe(true);

    // The swap-aside `.old-<rand>` tree is removed once publish succeeds, so
    // the links/ directory is left with only final entries (no `.old-` and no
    // `.tmp-` siblings).
    const linksDir = dirname(gvsTarget);
    const siblings = await readdirSorted(linksDir);
    expect(siblings.some(n => n.includes(".old-") || n.includes(".tmp-"))).toBe(false);
  });

  test("BUN_INSTALL_GLOBAL_STORE=0 overrides bunfig globalStore = true", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-off-env",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall({ ...bunEnv, BUN_INSTALL_GLOBAL_STORE: "0" }, packageDir);

    // With the global store disabled the entry is a real directory under
    // `node_modules/.bun/` (the pre-global-store layout).
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(existsSync(join(entry, "node_modules", "no-deps", "package.json"))).toBe(true);
  });

  test("entry hash is deterministic across fresh installs", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-determinism",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    const target1 = readlinkSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));

    // Full reset (lockfile + node_modules + global links). The hash is derived
    // from the resolved dependency closure, so a fresh resolve must reproduce
    // it exactly — otherwise warm-hit reuse across machines/CI is broken.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lock"), { force: true });
    const linksDir = target1.slice(0, target1.lastIndexOf("links") + "links".length);
    await rm(linksDir, { recursive: true, force: true });

    await runBunInstall(bunEnv, packageDir);
    const target2 = readlinkSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));

    expect(target2).toBe(target1);
  });

  test("different resolved transitive dep produces a different entry hash", async () => {
    // Two projects that depend on the same direct package but force different
    // versions of one of its transitive deps must NOT share a global entry —
    // the dep symlink inside the entry would point at the wrong version for
    // one of them.
    const a = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    const b = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      a.packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-hash-a",
        dependencies: { "two-range-deps": "1.0.0" },
        overrides: { "no-deps": "1.0.0" },
      }),
    );
    await write(
      b.packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-hash-b",
        dependencies: { "two-range-deps": "1.0.0" },
        overrides: { "no-deps": "1.1.0" },
      }),
    );

    await runBunInstall(bunEnv, a.packageDir);
    await runBunInstall(bunEnv, b.packageDir);

    const targetA = entryStoreName(readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")));
    const targetB = entryStoreName(readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")));
    expect(targetA).not.toBe(targetB);

    // Each entry's dep symlink resolves to the version that *its* project
    // overrode — proving the entries really are independent on disk.
    expect(
      await file(
        join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toMatchObject({ version: "1.0.0" });
    expect(
      await file(
        join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toMatchObject({ version: "1.1.0" });
  });

  test("two projects with the same closure share one global entry", async () => {
    const a = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    const b = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    for (const { packageJson } of [a, b]) {
      await write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-global-store-share",
          dependencies: { "two-range-deps": "1.0.0" },
        }),
      );
    }

    await runBunInstall(bunEnv, a.packageDir);
    await runBunInstall(bunEnv, b.packageDir);

    const targetA = entryStoreName(readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")));
    const targetB = entryStoreName(readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")));
    expect(targetA).toMatch(/^two-range-deps@1\.0\.0-[0-9a-f]{16}$/);
    expect(targetA).toBe(targetB);
  });

  test("workspace dependency makes the parent entry project-local", async () => {
    // Dep symlinks inside a global entry are sibling-relative within
    // `<cache>/links/`. If one of those siblings were a workspace package
    // (which lives under the project, not the cache) the link would be
    // dangling for any other project that shared the entry. The eligibility
    // check propagates: an entry that links to anything project-local is
    // itself project-local.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await mkdir(join(packageDir, "packages", "ws-pkg"), { recursive: true });
    await write(
      join(packageDir, "packages", "ws-pkg", "package.json"),
      JSON.stringify({ name: "ws-pkg", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
    );
    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-ws",
        workspaces: ["packages/*"],
        dependencies: { "ws-pkg": "workspace:*", "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    // `no-deps` has no project-local deps so it stays global.
    const noDepsEntry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(noDepsEntry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);

    // The workspace itself is always project-local (its source lives in the
    // project tree).
    expect(readlinkSync(join(packageDir, "node_modules", "ws-pkg"))).toBe(join("..", "packages", "ws-pkg"));
  });

  test("packages with trusted lifecycle scripts stay project-local", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-scripts",
        dependencies: { "lifecycle-postinstall": "1.0.0", "no-deps": "1.0.0" },
        trustedDependencies: ["lifecycle-postinstall"],
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    // The script may mutate the install dir, so the entry must not be shared.
    const scriptEntry = join(packageDir, "node_modules", ".bun", "lifecycle-postinstall@1.0.0");
    expect(lstatSync(scriptEntry).isSymbolicLink()).toBe(false);
    expect(lstatSync(scriptEntry).isDirectory()).toBe(true);

    // A neighbouring scriptless package is unaffected and stays global.
    const noDepsEntry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);

    // `meta.hasInstallScript` isn't serialised in `bun.lock`, so a warm
    // install must reach the same conclusion from the trustedDependencies
    // list alone — the cold install above isn't sufficient on its own.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
    expect(lstatSync(scriptEntry).isSymbolicLink()).toBe(false);
    expect(lstatSync(scriptEntry).isDirectory()).toBe(true);
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);
  });

  test("concurrent installs into a cold global store both succeed", async () => {
    // Two `bun install` processes may race to create the same content-addressed
    // global entry; the loser sees EEXIST from clonefile/symlink/bin-link and
    // must treat it as success rather than failing the install.
    const a = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    const b = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    // Both projects must share one cache for the race to be real; the harness
    // gives each test dir its own `.bun-cache/` by default.
    const sharedCache = join(a.packageDir, ".bun-cache");
    await write(
      join(b.packageDir, "bunfig.toml"),
      `[install]\ncache = "${sharedCache.replaceAll("\\", "\\\\")}"\nregistry = "${registry.registryUrl()}"\nlinker = "isolated"\nglobalStore = true\n`,
    );

    for (const { packageJson } of [a, b]) {
      await write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-global-store-concurrent",
          // `what-bin` exercises the `.bin/` symlink race; the others give the
          // clonefile + dep-symlink paths something to fight over.
          dependencies: { "two-range-deps": "1.0.0", "a-dep-b": "1.0.0", "what-bin": "1.0.0" },
        }),
      );
    }

    // Prime the package cache so the parallel installs only race on
    // global-store creation, not network downloads.
    await runBunInstall(bunEnv, a.packageDir);
    const linksDir = join(sharedCache, "links");

    for (let i = 0; i < 3; i++) {
      await rm(linksDir, { recursive: true, force: true });
      await rm(join(a.packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(b.packageDir, "node_modules"), { recursive: true, force: true });

      const [ra, rb] = await Promise.all([
        spawn({ cmd: [bunExe(), "install"], cwd: a.packageDir, env: bunEnv, stderr: "pipe", stdout: "pipe" }).exited,
        spawn({ cmd: [bunExe(), "install"], cwd: b.packageDir, env: bunEnv, stderr: "pipe", stdout: "pipe" }).exited,
      ]);
      expect({ iter: i, a: ra, b: rb }).toEqual({ iter: i, a: 0, b: 0 });
    }

    // Both projects' `.bun/<X>` symlinks point at the same physical directory
    // in the shared cache.
    expect(readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"))).toBe(
      readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")),
    );
    for (const { packageDir } of [a, b]) {
      expect(
        await file(
          join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps", "package.json"),
        ).json(),
      ).toMatchObject({ name: "no-deps" });
      const bin = process.platform === "win32" ? "what-bin.bunx" : "what-bin";
      expect(existsSync(join(packageDir, "node_modules", ".bin", bin))).toBe(true);
    }
  });

  test("a leftover staging directory does not shadow the published entry", async () => {
    // Entries are built under `<entry>.tmp-<suffix>/` and renamed into
    // `<entry>/` as the final step, so a published entry is always complete.
    // A crashed earlier install can leave a staging directory behind; the
    // warm-hit check must look at the final path only.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-staging",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    const target = readlinkSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0"));
    expect(existsSync(join(target, "node_modules", "no-deps", "package.json"))).toBe(true);
    // No stamp file: the directory existing *is* the completeness signal.
    expect(existsSync(join(target, ".bun-ok"))).toBe(false);

    // Fake a leftover staging sibling and re-install — the published entry
    // should warm-hit unchanged.
    await mkdir(`${target}.tmp-deadbeef`, { recursive: true });
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });

    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0"))).toBe(target);
    expect(existsSync(join(target, "node_modules", "no-deps", "package.json"))).toBe(true);
  });

  test("bun's resolver follows the double-hop chain into the global store", async () => {
    // Regression test for the Windows EISDIR: `node_modules/.bun/<pkg>` is a
    // symlink into `<cache>/links/`, and the dep symlinks inside the global
    // entry are *relative* to the entry's physical location. The Windows
    // `RealFS.kind()` symlink walk used to join those relative targets
    // against the *logical* `dirname()` (which still contains the
    // `node_modules/.bun/<pkg>` segment), miss, fall back to `.file`, and the
    // resolver would then `ReadFile` a directory. Exercising an actual
    // `require()` through a transitive dep proves the chain resolves
    // end-to-end on every platform.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-resolver",
        // two-range-deps → no-deps gives a transitive hop inside the GVS.
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );
    await write(
      join(packageDir, "index.js"),
      `console.log(JSON.stringify({
        direct: require("two-range-deps/package.json").name,
        transitive: require(require.resolve("no-deps/package.json", {
          paths: [require("path").dirname(require.resolve("two-range-deps/package.json"))],
        })).name,
      }));`,
    );

    await runBunInstall(bunEnv, packageDir);
    // The entry must actually be a global-store symlink for this test to mean
    // anything (guards against a future default flip silently neutering it).
    expect(lstatSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")).isSymbolicLink()).toBe(true);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "index.js"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("EISDIR");
    expect(code).toBe(0);
    expect(JSON.parse(out.trim())).toEqual({ direct: "two-range-deps", transitive: "no-deps" });
  });

  test("an entry that loses global-store eligibility detaches without mutating the shared entry", async () => {
    // Regression: a previously-GVS entry that becomes project-local on the
    // next install (newly patched, newly trusted, …) used to write its new
    // tree *through* the stale `node_modules/.bun/<storepath>` symlink into
    // the shared cache. On Windows the `.expect_missing` dep-symlink rewrite
    // then baked a project-absolute junction target into the shared entry,
    // which dangled after `rm -rf node_modules`.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-gvs-to-local",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const gvsTarget = readlinkSync(entry);
    const gvsDepLink = readlinkSync(join(gvsTarget, "node_modules", "no-deps"));

    // Flip eligibility: trustedDependencies makes it project-local on the
    // next install regardless of whether it actually has scripts.
    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-gvs-to-local",
        dependencies: { "two-range-deps": "1.0.0" },
        trustedDependencies: ["two-range-deps"],
      }),
    );
    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });

    // The project entry is now a real directory…
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    // …and the shared GVS entry's dep symlink is untouched (still the
    // global-relative target, not a project-absolute path).
    expect(readlinkSync(join(gvsTarget, "node_modules", "no-deps"))).toBe(gvsDepLink);
    expect(gvsDepLink).toMatch(/^\.\.[\/\\]\.\.[\/\\]no-deps@/);
  });

  test("upgrades a pre-global-store node_modules in place", async () => {
    // A project installed before this change has `node_modules/.bun/<X>` as a
    // real directory. Re-running install with the global store enabled must
    // replace that directory with a symlink (not fail with EEXIST or leave the
    // stale tree behind).
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-upgrade",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall({ ...bunEnv, BUN_INSTALL_GLOBAL_STORE: "0" }, packageDir);
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);

    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(existsSync(join(entry, "node_modules", "no-deps", "package.json"))).toBe(true);
  });

  test("disabling the global store detaches entries on the next install", async () => {
    // The reverse of the upgrade test above: a project installed with the
    // global store enabled has `node_modules/.bun/<X>` symlinks into
    // `<cache>/links/`. Re-running install with the store disabled must
    // replace those links with real project-local directories — the
    // warm-path existence check passes *through* a live link, so without
    // stale-link detection the project would silently keep running against
    // (and a later rebuild would write into) the shared store.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-disable",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const globalTarget = readlinkSync(entry);

    await runBunInstall({ ...bunEnv, BUN_INSTALL_GLOBAL_STORE: "0" }, packageDir, { savesLockfile: false });

    // Every entry is detached into a real project-local directory.
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    const depEntry = join(packageDir, "node_modules", ".bun", "no-deps@1.1.0");
    expect(lstatSync(depEntry).isSymbolicLink()).toBe(false);
    expect(lstatSync(depEntry).isDirectory()).toBe(true);

    // The rebuilt project-local tree resolves, including dep links between
    // detached entries.
    expect(await file(join(entry, "node_modules", "two-range-deps", "package.json")).json()).toMatchObject({
      name: "two-range-deps",
      version: "1.0.0",
    });
    expect(await file(join(entry, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      name: "no-deps",
    });
    expect(await file(join(packageDir, "node_modules", "two-range-deps", "package.json")).json()).toMatchObject({
      name: "two-range-deps",
    });

    // The shared global entry is left untouched for other projects.
    expect(existsSync(join(globalTarget, "node_modules", "two-range-deps", "package.json"))).toBe(true);
  });

  test("preserves bun patch workspace when install runs before --commit", async () => {
    // Regression: `bun patch <pkg>` detaches the project store entry from the
    // global virtual store (symlink → real directory) so the user can edit it.
    // A subsequent `bun install` (e.g. to add another dep) before `--commit`
    // must not see that real directory as a stale pre-GVS layout and
    // `deleteTree` the user's in-progress edits.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-patch-preserve",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    const workspace = join(packageDir, "node_modules", "no-deps");
    expect(lstatSync(workspace).isSymbolicLink()).toBe(true);

    await using proc = spawn({
      cmd: [bunExe(), "patch", "no-deps"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error");
    expect(stdout).toContain("To patch");
    expect(exitCode).toBe(0);

    // `bun patch` detached the top-level dep symlink into a real directory
    // for the user to edit. The `.bun/<storepath>` GVS symlink is untouched.
    expect(lstatSync(workspace).isSymbolicLink()).toBe(false);
    expect(lstatSync(workspace).isDirectory()).toBe(true);

    const edited = join(workspace, "index.js");
    await write(edited, "module.exports = 'USER_EDITS';\n");

    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });

    // The real-directory workspace is preserved across the install; before
    // this fix `.expect_existing` would `deleteTree` it on readlink EINVAL
    // and re-symlink, wiping the edits.
    expect(lstatSync(workspace).isSymbolicLink()).toBe(false);
    expect(await file(edited).text()).toBe("module.exports = 'USER_EDITS';\n");
  });
});

test("rejects dependency aliases that traverse outside node_modules", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  // A (transitively) malicious package.json can use an arbitrary string as a
  // dependency alias. The alias becomes a `node_modules/<alias>` path
  // component in the isolated store layout, so a `..` segment lets it plant
  // symlinks outside of node_modules.
  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-unsafe-alias",
      dependencies: {
        "../pwned-by-alias": "npm:no-deps@1.0.0",
      },
    }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("is not a valid install folder name");
  // Nothing may be created outside of node_modules. `lstatSync` instead of
  // `existsSync` because the escaped artifact would be a dangling symlink.
  expect(() => lstatSync(join(packageDir, "pwned-by-alias"))).toThrow();
  expect(exitCode).not.toBe(0);
});

test("rejects a dependency alias with more than one path component", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-nested-alias",
      dependencies: {
        "somepkg/lib": "npm:no-deps@1.0.0",
      },
    }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`"somepkg/lib" is not a valid install folder name`);
  expect(() => lstatSync(join(packageDir, "node_modules", "somepkg", "lib"))).toThrow();
  expect(exitCode).not.toBe(0);
});

test("invalid --linker value is echoed back in the error", async () => {
  using dir = tempDir("install-linker-err", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker=isoalted"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain('--linker: "isoalted"');
  expect(stderr).toContain("'isolated' or 'hoisted'");
  expect(exitCode).toBe(1);
});
