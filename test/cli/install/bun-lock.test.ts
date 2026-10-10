import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readlinkSync } from "fs";
import { access, copyFile, cp, exists, open, rm, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isWindows,
  normalizeBunSnapshot,
  readdirSorted,
  runBunInstall,
  tempDir,
  toBeValidBin,
  VerdaccioRegistry,
} from "harness";
import { join } from "path";

expect.extend({
  toBeValidBin,
});

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

it("should write plaintext lockfiles", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  // copy bar-0.0.2.tgz to package_dir
  await copyFile(join(__dirname, "bar-0.0.2.tgz"), join(packageDir, "bar-0.0.2.tgz"));

  // Create a simple package.json
  await writeFile(
    packageJson,
    JSON.stringify({
      name: "test-package",
      version: "1.0.0",
      dependencies: {
        "dummy-package": "file:./bar-0.0.2.tgz",
      },
    }),
  );

  // Run 'bun install' to generate the lockfile
  const installResult = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: packageDir,
    env,
  });
  await installResult.exited;

  // Ensure the lockfile was created
  await access(join(packageDir, "bun.lock"));

  // Assert that the lockfile has the correct permissions
  await using file = await open(join(packageDir, "bun.lock"), "r");
  const stat = await file.stat();

  // in unix, 0o644 == 33188
  let mode = 33188;
  // ..but windows is different
  if (isWindows) {
    mode = 33206;
  }
  expect(stat.mode).toBe(mode);

  expect(await file.readFile({ encoding: "utf8" })).toMatchSnapshot();
});

// won't work on windows, " is not a valid character in a filename
it.skipIf(isWindows)("should escape names", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "quote-in-dependency-name",
        workspaces: ["packages/*"],
      }),
    ),
    write(join(packageDir, "packages", '"', "package.json"), JSON.stringify({ name: '"' })),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        dependencies: {
          '"': "*",
        },
      }),
    ),
  ]);

  const { exited } = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: packageDir,
    stdout: "ignore",
    stderr: "ignore",
    env,
  });

  expect(await exited).toBe(0);

  expect(await file(join(packageDir, "bun.lock")).text()).toMatchSnapshot();
});

it("should be the default save format", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  await write(
    packageJson,
    JSON.stringify({
      name: "jquery-4",
      version: "4.0.0",
      dependencies: {
        "no-deps": "1.0.0",
      },
    }),
  );

  await runBunInstall(env, packageDir);
  expect(await exists(join(packageDir, "bun.lockb"))).toBe(false);
  expect(
    (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"),
  ).toMatchSnapshot();

  // adding a package will add to the text lockfile
  await runBunInstall(env, packageDir, { packages: ["a-dep"] });
  expect(await exists(join(packageDir, "bun.lockb"))).toBe(false);
  expect(
    (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"),
  ).toMatchSnapshot();
});

it("should save the lockfile if --save-text-lockfile and --frozen-lockfile are used", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: false } });
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "test-pkg", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } })),
  ]);

  async function checkLockfiles() {
    return await Promise.all([exists(join(packageDir, "bun.lock")), exists(join(packageDir, "bun.lockb"))]);
  }

  // save a binary lockfile
  await runBunInstall(env, packageDir, {});
  expect(await checkLockfiles()).toEqual([false, true]);

  // --save-text-lockfile with --frozen-lockfile
  await runBunInstall(env, packageDir, { saveTextLockfile: true, frozenLockfile: true });
  expect(await checkLockfiles()).toEqual([true, false]);
  const firstLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
    /localhost:\d+/g,
    "localhost:1234",
  );
  expect(firstLockfile).toMatchSnapshot();

  // adding a package without --save-text-lockfile will continue to use the text lockfile
  await runBunInstall(env, packageDir, { packages: ["a-dep"] });

  expect(await checkLockfiles()).toEqual([true, false]);
  const secondLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
    /localhost:\d+/g,
    "localhost:1234",
  );
  expect(firstLockfile).not.toBe(secondLockfile);
  expect(secondLockfile).toMatchSnapshot();
});

it("should convert a binary lockfile with invalid optional peers", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { npm: true } });
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "pkg1",
        dependencies: {
          "langchain": "^0.0.194",
        },
      }),
    ),
    cp(join(import.meta.dir, "fixtures", "invalid-optional-peer.lockb"), join(packageDir, "bun.lockb")),
  ]);

  let { exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile", "--lockfile-only"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let [out, err] = await Promise.all([stdout.text(), stderr.text()]);
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("Saved bun.lock (69 packages)");

  expect(await exited).toBe(0);

  const [firstLockfile, lockbExists] = await Promise.all([
    await file(join(packageDir, "bun.lock")).text(),
    exists(join(packageDir, "bun.lockb")),
  ]);

  expect(firstLockfile).toMatchSnapshot();
  expect(lockbExists).toBeFalse();

  // running again should not change the lockfile
  ({ exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  }));

  [out, err] = await Promise.all([stdout.text(), stderr.text()]);
  expect(err).not.toContain("Saved lockfile");
  expect(out).toContain("Done! Checked 69 packages (no changes)");

  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(firstLockfile);
});

it("should not deduplicate bundled packages with un-bundled packages", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "bundled-deps",
        dependencies: {
          "debug-1": "4.4.0",
          "npm-1": "10.9.2",
        },
      }),
    ),
  ]);

  let { exited, stdout } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "inherit",
  });

  expect(await exited).toBe(0);

  async function checkModules() {
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["debug-1", "ms-1", "npm-1"]);
  }

  await checkModules();

  const out1 = (await stdout.text())
    .replaceAll(/\s*\[[0-9\.]+m?s\]\s*$/g, "")
    .split(/\r?\n/)
    .slice(1);
  expect(out1).toMatchSnapshot();

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  // running install again will install all packages to node_modules
  ({ exited, stdout } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "inherit",
  }));

  expect(await exited).toBe(0);

  await checkModules();
  const out2 = (await stdout.text())
    .replaceAll(/\s*\[[0-9\.]+m?s\]\s*$/g, "")
    .split(/\r?\n/)
    .slice(1);
  expect(out2).toEqual(out1);

  // force saving a lockfile does not increase the number of packages
  ({ exited, stdout } = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "inherit",
  }));

  expect(await exited).toBe(0);

  await checkModules();
  const out3 = (await stdout.text())
    .replaceAll(/\s*\[[0-9\.]+m?s\]\s*$/g, "")
    .split(/\r?\n/)
    .slice(1);

  ({ exited, stdout } = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "inherit",
  }));

  expect(await exited).toBe(0);
  await checkModules();

  const out4 = (await stdout.text())
    .replaceAll(/\s*\[[0-9\.]+m?s\]\s*$/g, "")
    .split(/\r?\n/)
    .slice(1);
  expect(out4).toEqual(out3);

  expect(out4).toMatchSnapshot();

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  // --frozen-lockfile is successful
  ({ exited, stdout } = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "inherit",
  }));

  expect(await exited).toBe(0);
  await checkModules();
});

it("should not change formatting unexpectedly", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  const patch = `diff --git a/package.json b/package.json
index d156130662798530e852e1afaec5b1c03d429cdc..b4ddf35975a952fdaed99f2b14236519694f850d 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,7 @@
 {
     "name": "optional-peer-deps",
     "version": "1.0.0",
+    "hi": true,
     "peerDependencies": {
         "no-deps": "*"
     },
`;

  // attempt to snapshot most things that can be printed
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "pkg-root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        scripts: {
          preinstall: "echo 'preinstall'",
        },
        overrides: {
          "hoist-lockfile-shared": "1.0.1",
        },
        bin: "index.js",
        optionalDependencies: {
          "optional-native": "1.0.0",
        },
        devDependencies: {
          "optional-peer-deps": "1.0.0",
        },
        dependencies: {
          "uses-what-bin": "1.0.0",
        },
        trustedDependencies: ["uses-what-bin"],
        patchedDependencies: {
          "optional-peer-deps@1.0.0": "patches/optional-peer-deps@1.0.0.patch",
        },
      }),
    ),
    write(join(packageDir, "patches", "optional-peer-deps@1.0.0.patch"), patch),
    write(join(packageDir, "index.js"), "console.log('hello world')"),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "2.2.2",
        peerDependenciesMeta: {
          "a-dep": {
            optional: true,
          },
        },
        peerDependencies: {
          "a-dep": "1.0.1",
        },
        dependencies: {
          "bundled-1": "1.0.0",
        },
        bin: {
          "pkg1-1": "bin-1.js",
          "pkg1-2": "bin-2.js",
          "pkg1-3": "bin-3.js",
        },
        scripts: {
          install: "echo 'install'",
          postinstall: "echo 'postinstall'",
        },
      }),
    ),
    write(join(packageDir, "packages", "pkg1", "bin-1.js"), "console.log('bin-1')"),
    write(join(packageDir, "packages", "pkg1", "bin-2.js"), "console.log('bin-2')"),
    write(join(packageDir, "packages", "pkg1", "bin-3.js"), "console.log('bin-3')"),
    write(
      join(packageDir, "packages", "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        bin: {
          "pkg2-1": "bin-1.js",
        },
        dependencies: {
          "map-bin": "1.0.2",
        },
      }),
    ),
    write(join(packageDir, "packages", "pkg2", "bin-1.js"), "console.log('bin-1')"),
    write(
      join(packageDir, "packages", "pkg3", "package.json"),
      JSON.stringify({
        name: "pkg3",
        directories: {
          bin: "bin",
        },
        devDependencies: {
          "hoist-lockfile-1": "1.0.0",
        },
      }),
    ),
    write(join(packageDir, "packages", "pkg3", "bin", "bin-1.js"), "console.log('bin-1')"),
  ]);

  async function checkInstall() {
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules", "pkg1", "package.json")),
        exists(join(packageDir, "node_modules", "pkg2", "package.json")),
        exists(join(packageDir, "node_modules", "pkg3", "package.json")),
        file(join(packageDir, "node_modules", "hoist-lockfile-shared", "package.json")).json(),
        exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt")),
        file(join(packageDir, "node_modules", "optional-peer-deps", "package.json")).json(),
      ]),
    ).toMatchObject([true, true, true, { name: "hoist-lockfile-shared", version: "1.0.1" }, true, { hi: true }]);
    expect(join(packageDir, "node_modules", ".bin", "bin-1.js")).toBeValidBin(join("..", "pkg3", "bin", "bin-1.js"));
    expect(join(packageDir, "node_modules", ".bin", "map-bin")).toBeValidBin(join("..", "map-bin", "bin", "map-bin"));
    expect(join(packageDir, "node_modules", ".bin", "map_bin")).toBeValidBin(join("..", "map-bin", "bin", "map-bin"));
    expect(join(packageDir, "node_modules", ".bin", "pkg1-1")).toBeValidBin(join("..", "pkg1", "bin-1.js"));
    expect(join(packageDir, "node_modules", ".bin", "pkg1-2")).toBeValidBin(join("..", "pkg1", "bin-2.js"));
    expect(join(packageDir, "node_modules", ".bin", "pkg1-3")).toBeValidBin(join("..", "pkg1", "bin-3.js"));
    expect(join(packageDir, "node_modules", ".bin", "pkg2-1")).toBeValidBin(join("..", "pkg2", "bin-1.js"));
    expect(join(packageDir, "node_modules", ".bin", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  }

  let { exited, stdout } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "inherit",
  });

  expect(await exited).toBe(0);
  const out1 = (await stdout.text())
    .replaceAll(/\s*\[[0-9\.]+m?s\]\s*$/g, "")
    .split(/\r?\n/)
    .slice(1);
  expect(out1).toMatchInlineSnapshot(`
    [
      "preinstall",
      "",
      "+ optional-peer-deps@1.0.0 (v1.0.1 available)",
      "+ optional-native@1.0.0",
      "+ uses-what-bin@1.0.0 (v1.5.0 available)",
      "",
      "13 packages installed",
    ]
  `);

  await checkInstall();

  const lockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234");
  expect(lockfile).toMatchSnapshot();

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ exited, stdout } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "packages", "pkg1"),
    env,
    stdout: "pipe",
    stderr: "inherit",
  }));

  expect(await exited).toBe(0);
  const out2 = (await stdout.text())
    .replaceAll(/\s*\[[0-9\.]+m?s\]\s*$/g, "")
    .split(/\r?\n/)
    .slice(1);
  expect(out2).toMatchInlineSnapshot(`
    [
      "preinstall",
      "",
      "+ bundled-1@1.0.0",
      "",
      "13 packages installed",
    ]
  `);

  await checkInstall();

  expect((await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234")).toBe(
    lockfile,
  );
});

describe("writes trustedDependencies and patchedDependencies in the order earlier versions wrote them", () => {
  // Neither section is sorted: each is written in the iteration order of the
  // map that collects it, so that order is part of the format. The expected
  // blocks below are what bun 1.3.14 writes for these package.json files.
  // Writing a different order would reorder both sections in every existing
  // bun.lock on the next `bun add`/`bun remove`, and the older version would
  // flip them back. The second shape uses a larger trusted map (13 entries
  // instead of 7) and fills the patched map up to its growth threshold (6 of
  // 8 slots), so a change to how the maps size themselves shows up here too.
  const shapes = [
    {
      trusted: ["esbuild", "sharp", "@prisma/client", "prisma", "bcrypt", "core-js", "@prisma/engines"],
      patched: ["esbuild", "sharp", "prisma", "bcrypt", "core-js"],
      expected: `  "trustedDependencies": [
    "bcrypt",
    "esbuild",
    "sharp",
    "@prisma/engines",
    "@prisma/client",
    "core-js",
    "prisma",
  ],
  "patchedDependencies": {
    "prisma@1.0.0": "patches/prisma.patch",
    "bcrypt@1.0.0": "patches/bcrypt.patch",
    "core-js@1.0.0": "patches/core-js.patch",
    "esbuild@1.0.0": "patches/esbuild.patch",
    "sharp@1.0.0": "patches/sharp.patch",
  },
`,
    },
    {
      trusted: [
        "esbuild",
        "sharp",
        "@prisma/client",
        "prisma",
        "bcrypt",
        "core-js",
        "@prisma/engines",
        "puppeteer",
        "playwright",
        "electron",
        "better-sqlite3",
        "fsevents",
        "@swc/core",
      ],
      patched: ["esbuild", "sharp", "prisma", "bcrypt", "core-js", "puppeteer"],
      expected: `  "trustedDependencies": [
    "bcrypt",
    "@swc/core",
    "core-js",
    "playwright",
    "esbuild",
    "sharp",
    "@prisma/engines",
    "fsevents",
    "@prisma/client",
    "electron",
    "better-sqlite3",
    "prisma",
    "puppeteer",
  ],
  "patchedDependencies": {
    "prisma@1.0.0": "patches/prisma.patch",
    "bcrypt@1.0.0": "patches/bcrypt.patch",
    "core-js@1.0.0": "patches/core-js.patch",
    "esbuild@1.0.0": "patches/esbuild.patch",
    "puppeteer@1.0.0": "patches/puppeteer.patch",
    "sharp@1.0.0": "patches/sharp.patch",
  },
`,
    },
  ];

  const trustedAndPatchedSections = (lockfile: string) =>
    lockfile.slice(lockfile.indexOf('  "trustedDependencies"'), lockfile.indexOf('  "packages"'));

  it.each(shapes)("$trusted.length trusted, $patched.length patched", async ({ trusted, patched, expected }) => {
    const scopes = new Set(trusted.filter(name => name.startsWith("@")).map(name => name.split("/")[0]));
    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        name: "trusted-and-patched-order",
        version: "1.0.0",
        workspaces: ["packages/*", ...Array.from(scopes, scope => `packages/${scope}/*`)],
        trustedDependencies: trusted,
        patchedDependencies: Object.fromEntries(patched.map(name => [`${name}@1.0.0`, `patches/${name}.patch`])),
      }),
    };
    for (const name of trusted) {
      files[`packages/${name}/package.json`] = JSON.stringify({ name, version: "1.0.0" });
    }
    for (const name of patched) {
      files[`patches/${name}.patch`] = `diff --git a/index.js b/index.js
new file mode 100644
index 0000000..e69de29
`;
    }

    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });

    await runBunInstall(env, packageDir);
    expect(trustedAndPatchedSections(await file(join(packageDir, "bun.lock")).text())).toBe(expected);

    // Re-saving the lockfile because something else changed must leave both
    // sections untouched.
    await write(
      join(packageDir, "packages", "left-pad", "package.json"),
      JSON.stringify({ name: "left-pad", version: "1.0.0" }),
    );
    await runBunInstall(env, packageDir);
    const resaved = await file(join(packageDir, "bun.lock")).text();
    expect(resaved).toContain('"left-pad": ["left-pad@workspace:packages/left-pad"]');
    expect(trustedAndPatchedSections(resaved)).toBe(expected);
  });
});

it("should sort overrides before comparing", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  const pkg = {
    name: "pkg-with-overrides",
    dependencies: {
      "one-dep": "1.0.0",
      "uses-what-bin": "1.5.0",
    },
    peerDependencies: {
      "what-bin": "1.0.0",
      "no-deps": "2.0.0",
    },
    peerDependenciesMeta: {
      "what-bin": {
        optional: true,
      },
      "no-deps": {
        optional: true,
      },
    },
    resolutions: {
      "what-bin": "1.0.0",
      "no-deps": "2.0.0",
    },
  };

  await write(packageJson, JSON.stringify(pkg));

  await runBunInstall(env, packageDir);

  const lockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234");
  expect(lockfile).toMatchSnapshot();
  await runBunInstall(env, packageDir, { frozenLockfile: true });

  // now swap "what-bin" and "no-deps" in resolutions
  pkg.resolutions = {
    "no-deps": "2.0.0",
    "what-bin": "1.0.0",
  };
  await write(packageJson, JSON.stringify(pkg));

  await runBunInstall(env, packageDir, { frozenLockfile: true });

  // --frozen-lockfile was a success. lockfile will be the same as the first
  const secondLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
    /localhost:\d+/g,
    "localhost:1234",
  );
  expect(secondLockfile).toBe(lockfile);
});

it("should pass frozen lockfile check when a bundled dependency has an optional peer satisfiable from the root", async () => {
  // A bundled dependency's optional peer must not resolve across the bundle
  // hoist root when the lockfile is loaded, otherwise a fresh install and a
  // loaded lockfile disagree about the tree and --frozen-lockfile rejects a
  // lockfile bun itself just wrote (issue #37346).
  const { packageDir, packageJson } = await registry.createTestDir();

  await write(
    packageJson,
    JSON.stringify({
      name: "frozen-bundled-optional-peer",
      dependencies: {
        // bundles `optional-peer-deps`, which has an optional peer on `no-deps`
        "bundled-optional-peer": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  await runBunInstall(env, packageDir);
  const lockfile = await file(join(packageDir, "bun.lock")).text();
  expect(lockfile).toContain('"bundled": true');

  await runBunInstall(env, packageDir, { frozenLockfile: true });

  // and from a cold start with no node_modules
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(env, packageDir, { frozenLockfile: true });

  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
});

it("should include unused resolutions in the lockfile", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  // we need to include unused resolutions in order to detect changes from package.json

  const pkg = {
    name: "pkg-with-unused-override",
    dependencies: {
      "one-dep": "1.0.0",
      "uses-what-bin": "1.5.0",
    },
    peerDependencies: {
      "what-bin": "1.0.0",
      "no-deps": "2.0.0",
    },
    peerDependenciesMeta: {
      "what-bin": {
        optional: true,
      },
      "no-deps": {
        optional: true,
      },
    },
    resolutions: {
      "what-bin": "1.0.0",
      "no-deps": "2.0.0",

      // unused resolution
      "jquery": "4.0.0",
    },
  };

  await write(packageJson, JSON.stringify(pkg));

  await runBunInstall(env, packageDir);

  const lockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234");
  expect(lockfile).toMatchSnapshot();

  // --frozen-lockfile works
  await runBunInstall(env, packageDir, { frozenLockfile: true });
});

it("requires an integrity hash for an off-registry npm tarball URL at lockfileVersion 2", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  // Stand-in for a host that is not the configured registry. Parsing fails
  // before any fetch, so this is never actually contacted.
  let offRegistryRequests = 0;
  await using offRegistry = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      offRegistryRequests++;
      return new Response("not found", { status: 404 });
    },
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "redirected-tarball-url",
      dependencies: {
        "no-deps": "1.0.0",
      },
    }),
  );

  const lockfileWithUrl = (tarballUrl: string) =>
    JSON.stringify({
      lockfileVersion: 2,
      configVersion: 1,
      workspaces: {
        "": {
          name: "redirected-tarball-url",
          dependencies: {
            "no-deps": "1.0.0",
          },
        },
      },
      packages: {
        "no-deps": ["no-deps@1.0.0", tarballUrl, {}, ""],
      },
    });

  // The entry keeps the well-known name and version but points the tarball at a
  // different host and provides no integrity hash. At lockfileVersion 2 this
  // fails closed: parsing rejects it before any fetch. (The v1 backward-compat
  // case — parsing accepts such an entry — is covered in lockfile-version-2.test.ts.)
  await write(
    join(packageDir, "bun.lock"),
    lockfileWithUrl(`http://127.0.0.1:${offRegistry.port}/no-deps/-/no-deps-1.0.0.tgz`),
  );

  let { exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let [out, err] = await Promise.all([stdout.text(), stderr.text()]);
  expect(err).toContain(
    "Missing integrity hash for npm package resolved to a tarball URL outside the configured registry",
  );
  expect(offRegistryRequests).toBe(0);
  expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBe(false);
  expect(await exited).not.toBe(0);

  // The same entry with the tarball URL *under* the configured registry and no
  // integrity hash is accepted even at v2 (the off-registry gate does not apply,
  // so `npm_url_needs_integrity` is false — registry-hosted tarballs may still
  // omit the hash).
  await write(join(packageDir, "bun.lock"), lockfileWithUrl(`${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`));

  ({ exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  }));

  [out, err] = await Promise.all([stdout.text(), stderr.text()]);
  expect(err).not.toContain("Missing integrity hash");
  expect(offRegistryRequests).toBe(0);
  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    name: "no-deps",
    version: "1.0.0",
  });
});

it("escapes double quotes in npm registry tarball URLs when saving bun.lock", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  await write(
    packageJson,
    JSON.stringify({
      name: "registry-url-escaping",
      dependencies: {
        "no-deps": "1.0.0",
      },
    }),
  );

  // A registry-controlled tarball URL containing a double quote and JSON syntax.
  // When the lockfile is saved again, the URL must stay confined to its own
  // string value instead of contributing top-level lockfile structure.
  const tarballUrl = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz?x=", "trustedDependencies": ["no-deps"], "y": "`;

  await write(
    join(packageDir, "bun.lock"),
    JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: {
        "": {
          name: "registry-url-escaping",
          dependencies: {
            "no-deps": "1.0.0",
          },
        },
      },
      packages: {
        "no-deps": ["no-deps@1.0.0", tarballUrl, {}, ""],
      },
    }),
  );

  let { exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let [out, err] = await Promise.all([stdout.text(), stderr.text()]);
  expect(out).toContain("Saved bun.lock");
  expect(await exited).toBe(0);

  const lockfile = await file(join(packageDir, "bun.lock")).text();

  // The embedded quote is escaped, keeping the URL a single JSON string value.
  expect(lockfile).toContain('?x=\\"');
  expect(lockfile).toContain('\\"trustedDependencies\\"');
  // No top-level key can be forged from the URL contents.
  expect(lockfile).not.toContain('"trustedDependencies":');

  // The saved lockfile still parses and is stable on a subsequent install.
  ({ exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  }));

  [out, err] = await Promise.all([stdout.text(), stderr.text()]);
  expect(err).not.toContain("Saved lockfile");
  expect(out).toContain("Done! Checked");
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
  expect(await exited).toBe(0);
});

// --frozen-lockfile compares the tree built from bun.lock with the tree a clean install
// builds, so an entry nothing depends on (the clean drops it) must not change the
// outcome, wherever it sits in the file. The comparison used to skip the loaded side's
// highest package ids once the clean had dropped an entry, so the entries listed after
// the unused one went missing from the comparison.
it("--frozen-lockfile accepts a bun.lock with an entry nothing depends on, wherever it is listed", async () => {
  const noDeps = { "no-deps": ["no-deps@1.0.0", "", {}, ""] };
  const unused = { "a-dep": ["a-dep@1.0.1", "", {}, ""] };
  for (const packages of [
    { ...unused, ...noDeps },
    { ...noDeps, ...unused },
  ]) {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
    const lockfile = JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "foo", dependencies: { "no-deps": "1.0.0" } } },
      packages,
    });
    await write(join(packageDir, "bun.lock"), lockfile);

    await using proc = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ order: Object.keys(packages), err, exitCode }).toEqual({
      order: Object.keys(packages),
      err: expect.not.stringContaining("lockfile had changes"),
      exitCode: 0,
    });
    expect(out).toContain("no-deps@1.0.0");
    expect(await exists(join(packageDir, "node_modules", "no-deps", "package.json"))).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "a-dep"))).toBeFalse();
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
  }
});

it("escapes quotes and newlines in requested version literals when writing yarn.lock", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  // A version range carrying a quote and a newline. The extra characters are
  // skipped by the lenient range parser (it still resolves to 1.0.0), but the
  // stored literal keeps them, so the yarn.lock printer must keep the whole
  // literal inside a single quoted scalar.
  const craftedRange = '1.0.0 "\n  resolved "http://injected.example/forged-by-yarn-printer';

  await write(
    packageJson,
    JSON.stringify({
      name: "yarn-lock-escaping",
      dependencies: {
        "no-deps": craftedRange,
      },
    }),
  );

  const { exited, stderr } = spawn({
    cmd: [bunExe(), "install", "--yarn"],
    cwd: packageDir,
    env,
    stdout: "ignore",
    stderr: "pipe",
  });

  const err = await stderr.text();
  const exitCode = await exited;

  expect(err).toContain("Saved yarn.lock");
  expect(exitCode).toBe(0);

  const yarnLock = await file(join(packageDir, "yarn.lock")).text();
  const lines = yarnLock.split("\n");

  // The package resolves normally and its real resolved URL points at the test registry.
  expect(lines.some(line => /^ {2}resolved "http:\/\/localhost:\d+\//.test(line))).toBe(true);

  // The literal's embedded quote is escaped, so the requested range stays inside one quoted key.
  expect(yarnLock).toContain('\\"http://injected.example');

  // No yarn.lock line is forged from the version literal's contents.
  expect(lines.filter(line => line.trimStart().startsWith('resolved "http://injected.example'))).toEqual([]);
});

it("prints an actionable error for a lockfile version newer than this build supports", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  await write(
    packageJson,
    JSON.stringify({
      name: "future-lockfile",
      dependencies: {},
    }),
  );

  await write(
    join(packageDir, "bun.lock"),
    JSON.stringify({
      lockfileVersion: 99,
      workspaces: {
        "": {
          name: "future-lockfile",
        },
      },
      packages: {},
    }),
  );

  const { exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err] = await Promise.all([stdout.text(), stderr.text()]);

  expect(err).toContain("Unsupported lockfile version 99");
  expect(err).toContain("newer version of Bun");
  expect(err).toMatch(/This is Bun v\d+\.\d+\.\d+/);
  expect(err).toMatch(/supports lockfile versions up to \d+/);
  expect(err).toContain("Run 'bun upgrade'");
  // the old message gave no hint at all
  expect(err).not.toContain("Unknown lockfile version");
  expect(await exited).toBe(0);
});

async function installWithHandEditedOverrides(overrides: Record<string, unknown>) {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = JSON.stringify(
    {
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "invalid-overrides" } },
      overrides,
      packages: {},
    },
    null,
    2,
  );
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "invalid-overrides" })),
    write(join(packageDir, "bun.lock"), lockfile),
  ]);

  await using proc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
  return { out: normalizeBunSnapshot(out, packageDir), err: normalizeBunSnapshot(err, packageDir), exitCode };
}

describe.concurrent("hand-edited bun.lock overrides", () => {
  it("rejects a top-level row whose value is a number", async () => {
    const { out, err, exitCode } = await installWithHandEditedOverrides({ "no-deps": 1 });
    expect(err).toMatchInlineSnapshot(`
      "10 |     "no-deps": 1
                          ^
      error: Expected a string or an object
          at bun.lock:10:16
      InvalidLockfile: failed to parse lockfile: 'bun.lock'

      warn: Ignoring lockfile
      error: lockfile had changes, but lockfile is frozen"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });

  it("rejects a group whose key is a bare scope", async () => {
    const { out, err, exitCode } = await installWithHandEditedOverrides({ "@scope": { ".": "1.0.0" } });
    expect(err).toMatchInlineSnapshot(`
      "10 |     "@scope": {
               ^
      error: Invalid override key
          at bun.lock:10:5
      InvalidLockfile: failed to parse lockfile: 'bun.lock'

      warn: Ignoring lockfile
      error: lockfile had changes, but lockfile is frozen"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });

  it("rejects a group child whose key is a bare scope", async () => {
    const { out, err, exitCode } = await installWithHandEditedOverrides({ "no-deps": { "@scope": "1.0.0" } });
    expect(err).toMatchInlineSnapshot(`
      "11 |       "@scope": "1.0.0"
                 ^
      error: Invalid override key
          at bun.lock:11:7
      InvalidLockfile: failed to parse lockfile: 'bun.lock'

      warn: Ignoring lockfile
      error: lockfile had changes, but lockfile is frozen"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });

  it("rejects a group child whose value is a number", async () => {
    const { out, err, exitCode } = await installWithHandEditedOverrides({ "no-deps": { "a-dep": 1 } });
    expect(err).toMatchInlineSnapshot(`
      "11 |       "a-dep": 1
                          ^
      error: Expected a string
          at bun.lock:11:16
      InvalidLockfile: failed to parse lockfile: 'bun.lock'

      warn: Ignoring lockfile
      error: lockfile had changes, but lockfile is frozen"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });

  it("rejects a group whose key carries a non-npm range", async () => {
    const { out, err, exitCode } = await installWithHandEditedOverrides({
      "no-deps@file:./vendored": { ".": "1.0.0" },
    });
    expect(err).toMatchInlineSnapshot(`
      "11 |       ".": "1.0.0"
                      ^
      error: Invalid override version
          at bun.lock:11:12
      InvalidLockfile: failed to parse lockfile: 'bun.lock'

      warn: Ignoring lockfile
      error: lockfile had changes, but lockfile is frozen"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });

  it("rejects a group child whose value does not parse as a dependency", async () => {
    const { out, err, exitCode } = await installWithHandEditedOverrides({ "no-deps": { "a-dep": "./a:dep" } });
    expect(err).toMatchInlineSnapshot(`
      "error: Unsupported protocol ./a:dep

      11 |       "a-dep": "./a:dep"
                          ^
      error: Invalid override version
          at bun.lock:11:16
      InvalidLockfile: failed to parse lockfile: 'bun.lock'

      warn: Ignoring lockfile
      error: lockfile had changes, but lockfile is frozen"
    `);
    expect(out).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("hand-edited bun.lock that lists workspaces but has no packages object", () => {
  const lockfileWithoutPackages = (lockfileVersion: number) =>
    JSON.stringify(
      {
        lockfileVersion,
        workspaces: {
          "": { name: "no-packages-object" },
          "packages/member": { name: "member", version: "1.0.0" },
        },
      },
      null,
      2,
    );

  const projectFiles = (lockfileVersion: number) => ({
    "package.json": JSON.stringify({ name: "no-packages-object", workspaces: ["packages/*"] }),
    "packages/member/package.json": JSON.stringify({ name: "member", version: "1.0.0" }),
    "bun.lock": lockfileWithoutPackages(lockfileVersion),
  });

  async function install(cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out: normalizeBunSnapshot(out, cwd), err: normalizeBunSnapshot(err, cwd), exitCode };
  }

  it("bun install links the workspace and writes the packages object back", async () => {
    using dir = tempDir("bun-lock-no-packages-object", projectFiles(1));
    const { out, err, exitCode } = await install(String(dir));
    expect(err).toMatchInlineSnapshot(`"Saved lockfile"`);
    expect(out).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    expect(await file(join(String(dir), "node_modules", "member", "package.json")).json()).toEqual({
      name: "member",
      version: "1.0.0",
    });
    expect(await file(join(String(dir), "bun.lock")).text()).toContain(
      `"packages": {\n    "member": ["member@workspace:packages/member"],\n  }`,
    );
  });

  it("bun install --frozen-lockfile treats it like an empty packages object", async () => {
    using dir = tempDir("bun-lock-no-packages-object-frozen", projectFiles(2));
    const { out, err, exitCode } = await install(String(dir), "--frozen-lockfile");
    expect(err).toMatchInlineSnapshot(`""`);
    expect(out).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    expect(await file(join(String(dir), "node_modules", "member", "package.json")).json()).toEqual({
      name: "member",
      version: "1.0.0",
    });
    expect(await file(join(String(dir), "bun.lock")).text()).toBe(lockfileWithoutPackages(2));
  });
});

const makeInstallRunner = (cwd: string) => async (args: string[]) => {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ args, err, code }).toMatchObject({ args, err: expect.not.stringContaining("error:"), code: 0 });
  return { out, err };
};

// https://github.com/oven-sh/bun/issues/8662#issuecomment-3379529330
it("bun remove drops a package that was only otherwise an optional peer", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  // A `packages` entry for `no-deps` serializes as `"no-deps": ["no-deps@...`.
  // (The literal "no-deps" also appears inside optional-peer-deps's
  // peerDependencies/optionalPeers metadata, so match the entry prefix.)
  const noDepsEntry = '"no-deps": ["no-deps@';

  await write(packageJson, JSON.stringify({ name: "foo", version: "1.0.0" }));

  // step 1: optional-peer-deps has an optional peer on no-deps; no-deps is NOT in the lockfile yet.
  await run(["add", "-D", "optional-peer-deps@1.0.0"]);
  const afterStep1 = await file(join(packageDir, "bun.lock")).text();
  expect(afterStep1).not.toContain(noDepsEntry);

  // step 2: add no-deps as a direct dependency; the optional peer slot is now satisfied.
  await run(["add", "no-deps@1.0.0"]);
  const afterStep2 = await file(join(packageDir, "bun.lock")).text();
  expect(afterStep2).toContain(noDepsEntry);

  // step 3: remove no-deps. The lockfile must return to the step-1 state.
  await run(["remove", "no-deps"]);
  const afterStep3 = await file(join(packageDir, "bun.lock")).text();
  expect(afterStep3).not.toContain(noDepsEntry);
  expect(afterStep3).toBe(afterStep1);

  // --frozen-lockfile must accept the result (round-trip).
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
});

it("bun remove keeps an optional peer that is still reachable via a non-peer edge", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  // optional-peer-deps: optional peer on no-deps
  // one-dep:            hard dependency on no-deps@1.0.1
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      devDependencies: { "optional-peer-deps": "1.0.0", "one-dep": "1.0.0" },
    }),
  );
  const noDepsEntry = '"no-deps": ["no-deps@';
  await run(["install"]);
  const baseline = await file(join(packageDir, "bun.lock")).text();
  expect(baseline).toContain(noDepsEntry);

  await run(["add", "no-deps@1.0.1"]);
  await run(["remove", "no-deps"]);

  // no-deps must remain (one-dep still depends on it), and the lockfile must be
  // byte-identical to before the add/remove pair.
  const after = await file(join(packageDir, "bun.lock")).text();
  expect(after).toContain(noDepsEntry);
  expect(after).toBe(baseline);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
});

it("bun install drops a once-resolved optional peer after the providing dependency leaves package.json", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  // Same as the first test but via editing package.json + `bun install` instead
  // of `bun remove`, which is the other path into clean_with_logger.
  const noDepsEntry = '"no-deps": ["no-deps@';
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      devDependencies: { "optional-peer-deps": "1.0.0" },
      dependencies: { "no-deps": "1.0.0" },
    }),
  );
  await run(["install"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toContain(noDepsEntry);

  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      devDependencies: { "optional-peer-deps": "1.0.0" },
    }),
  );
  await run(["install"]);
  expect(await file(join(packageDir, "bun.lock")).text()).not.toContain(noDepsEntry);
});

it("optional peer with a non-wildcard range is idempotent with two versions of the target in the tree", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  // one-optional-peer-dep@1.0.2: optional peer no-deps@^1.0.0
  // one-dep:                      hard dep no-deps@1.0.1 (satisfies ^1.0.0)
  // one-fixed-dep@2.0.0:          hard dep no-deps@2.0.0 (does not satisfy ^1.0.0)
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-optional-peer-dep": "1.0.2",
        "one-dep": "1.0.0",
        "one-fixed-dep": "2.0.0",
      },
    }),
  );

  await run(["install"]);
  const first = await file(join(packageDir, "bun.lock")).text();
  expect(first).toContain('"no-deps": ["no-deps@');

  // A second install over the same lockfile must be a byte-for-byte no-op: the
  // optional peer stays bound to the no-deps the fresh install bound it to.
  await run(["install"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(first);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
});

// Lockfiles saved by versions that did not drop such packages (see the `bun remove`
// tests above) still list packages that only an optional peer slot reaches. The
// committed file is all a frozen install may use, so it has to keep installing them.
// The workspace's lifecycle script is what separates this from a no-op install:
// bun.lock does not record workspace scripts, so this project's package.json diff is
// never empty.
it("--frozen-lockfile keeps a package that an older lockfile lists only as an optional peer", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
  });
  const run = makeInstallRunner(packageDir);
  const noDepsEntry = '"no-deps": ["no-deps@';
  const rootPackageJson = (dependencies: Record<string, string>) =>
    JSON.stringify({ name: "foo", version: "1.0.0", workspaces: ["packages/*"], dependencies });

  await Promise.all([
    write(packageJson, rootPackageJson({ "optional-peer-deps": "1.0.0", "no-deps": "1.0.0" })),
    write(
      join(packageDir, "packages", "pkg", "package.json"),
      JSON.stringify({ name: "pkg", version: "1.0.0", scripts: { postinstall: "exit 0" } }),
    ),
  ]);
  await run(["install", "--ignore-scripts"]);

  // What an older `bun remove no-deps` left behind: the root no longer depends on
  // no-deps, but its entry stayed because optional-peer-deps's peer slot pointed at it.
  const written = await file(join(packageDir, "bun.lock")).text();
  const stale = written.replace(/^ +"no-deps": "1\.0\.0",\n/m, "");
  expect(stale).not.toBe(written);
  expect(stale).toContain(noDepsEntry);
  await Promise.all([
    write(join(packageDir, "bun.lock"), stale),
    write(packageJson, rootPackageJson({ "optional-peer-deps": "1.0.0" })),
    rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
  ]);

  await run(["install", "--frozen-lockfile", "--ignore-scripts"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(stale);
  expect(await exists(join(packageDir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

// The optional-peer-hoist-* fixtures are described in
// registry/packages/create-optional-peer-hoist-packages.ts. In short: consumer
// has an optional peer on target, and deep -> deep-child reaches target@1.0.0
// (which depends on leaf@2.0.0) as well as leaf@1.0.0. Hoisting is
// breadth-first, so leaf@2.0.0 only wins the root slot if consumer's peer is
// already bound to target when the tree is built. A loaded bun.lock always has
// the peer bound, so that is the tree every install has to build, otherwise
// --frozen-lockfile compares two different trees.
const optionalPeerHoistDeps = {
  "optional-peer-hoist-consumer": "1.0.0",
  "optional-peer-hoist-deep": "1.0.0",
};

it("a fresh install hoists around an optional peer the same way a reinstall does", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  await write(packageJson, JSON.stringify({ name: "foo", dependencies: optionalPeerHoistDeps }));
  await run(["install"]);
  const fresh = await file(join(packageDir, "bun.lock")).text();
  expect(fresh).toContain('"optional-peer-hoist-leaf": ["optional-peer-hoist-leaf@2.0.0"');
  expect(fresh).toContain(
    '"optional-peer-hoist-deep-child/optional-peer-hoist-leaf": ["optional-peer-hoist-leaf@1.0.0"',
  );

  await run(["install", "--frozen-lockfile"]);

  // --lockfile-only always writes, so this checks the tree a reload builds
  // prints back to the same text.
  await run(["install", "--lockfile-only"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(fresh);
});

it("a fresh install settles hoisting around a peer that only becomes bindable once another peer is bound", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  // Shape 2 in the fixture generator: binding consumer's peer hoists leaf@3.0.0
  // out from under target, which is what lets target2@1.0.0 reach consumer2's
  // peer, and only with that one bound too does target2's tail@2.0.0 beat
  // deep-child's tail@1.0.0 to the root, the way it does on every reload.
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: {
        "optional-peer-hoist-consumer": "1.0.0",
        "optional-peer-hoist-consumer2": "1.0.0",
        "optional-peer-hoist-deep": "2.0.0",
      },
    }),
  );
  await run(["install"]);
  const fresh = await file(join(packageDir, "bun.lock")).text();
  expect(fresh).toContain('"optional-peer-hoist-tail": ["optional-peer-hoist-tail@2.0.0"');
  expect(fresh).toContain(
    '"optional-peer-hoist-deep-child/optional-peer-hoist-tail": ["optional-peer-hoist-tail@1.0.0"',
  );

  await run(["install", "--frozen-lockfile"]);
  await run(["install", "--lockfile-only"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(fresh);
});

it.each([
  [
    "leaf@2.0.0 hoisted (target placed from consumer)",
    {
      "optional-peer-hoist-leaf": "2.0.0",
      "optional-peer-hoist-deep-child/optional-peer-hoist-leaf": "1.0.0",
    },
  ],
  [
    // What a fresh install wrote before the peer binding was carried over.
    "leaf@1.0.0 hoisted (target placed from deep-child)",
    {
      "optional-peer-hoist-leaf": "1.0.0",
      "optional-peer-hoist-target/optional-peer-hoist-leaf": "2.0.0",
    },
  ],
])("--frozen-lockfile accepts an existing bun.lock with %s", async (_, leafPlacement) => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  const pkg = (name: string, version: string, info: object = {}) => [
    `${name}@${version}`,
    `${registry.registryUrl()}${name}/-/${name}-${version}.tgz`,
    info,
    "",
  ];
  const packages: Record<string, unknown[]> = {
    "optional-peer-hoist-consumer": pkg("optional-peer-hoist-consumer", "1.0.0", {
      peerDependencies: { "optional-peer-hoist-target": "*" },
      optionalPeers: ["optional-peer-hoist-target"],
    }),
    "optional-peer-hoist-deep": pkg("optional-peer-hoist-deep", "1.0.0", {
      dependencies: { "optional-peer-hoist-deep-child": "1.0.0" },
    }),
    "optional-peer-hoist-deep-child": pkg("optional-peer-hoist-deep-child", "1.0.0", {
      dependencies: { "optional-peer-hoist-leaf": "1.0.0", "optional-peer-hoist-target": "1.0.0" },
    }),
    "optional-peer-hoist-target": pkg("optional-peer-hoist-target", "1.0.0", {
      dependencies: { "optional-peer-hoist-leaf": "2.0.0" },
    }),
  };
  for (const [path, version] of Object.entries(leafPlacement)) {
    packages[path] = pkg("optional-peer-hoist-leaf", version);
  }

  await write(packageJson, JSON.stringify({ name: "foo", dependencies: optionalPeerHoistDeps }));
  await write(
    join(packageDir, "bun.lock"),
    JSON.stringify({
      lockfileVersion: 2,
      configVersion: 1,
      workspaces: { "": { name: "foo", dependencies: optionalPeerHoistDeps } },
      packages,
    }),
  );

  await run(["install", "--frozen-lockfile"]);
});

it("adding a dependency keeps an optional peer on the package bun.lock bound it to while that package stays next to it", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  await write(packageJson, JSON.stringify({ name: "foo", dependencies: optionalPeerHoistDeps }));
  await run(["install"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toContain(
    '"optional-peer-hoist-target": ["optional-peer-hoist-target@1.0.0"',
  );

  // provider brings in target@2.0.0, which consumer's peer range would accept
  // too. bun.lock binds consumer to target@1.0.0, and consumer sorts before
  // provider, so target@1.0.0 is placed from consumer first, keeps the root
  // slot and the binding, and target@2.0.0 nests under provider.
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: { ...optionalPeerHoistDeps, "optional-peer-hoist-provider": "1.0.0" },
    }),
  );
  await run(["install"]);
  const lockfile = await file(join(packageDir, "bun.lock")).text();
  expect(lockfile).toContain('"optional-peer-hoist-target": ["optional-peer-hoist-target@1.0.0"');
  expect(lockfile).toContain(
    '"optional-peer-hoist-provider/optional-peer-hoist-target": ["optional-peer-hoist-target@2.0.0"',
  );
  expect(lockfile).toContain('"optional-peer-hoist-leaf": ["optional-peer-hoist-leaf@2.0.0"');

  await run(["install", "--frozen-lockfile"]);
  await run(["install", "--lockfile-only"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
});

it("an optional peer is rebound when another version of its package takes the slot next to it", async () => {
  // The isolated linker is the one consumer of the binding itself: consumer's
  // store entry is keyed by the target it was linked against.
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "isolated" },
  });
  const run = makeInstallRunner(packageDir);
  const consumerLink = () => readlinkSync(join(packageDir, "node_modules", "optional-peer-hoist-consumer"));

  await write(packageJson, JSON.stringify({ name: "foo", dependencies: optionalPeerHoistDeps }));
  await run(["install"]);
  const boundToTarget1 = consumerLink();

  // Same as the previous test, but aliased so the provider sorts before
  // consumer: target@2.0.0 takes the root slot before consumer's bound
  // target@1.0.0 can be placed, and since the peer range accepts it, consumer
  // dedupes onto it. That is what a reload of this bun.lock binds consumer to,
  // so it is also what this install has to link consumer against.
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: { "a-provider": "npm:optional-peer-hoist-provider@1.0.0", ...optionalPeerHoistDeps },
    }),
  );
  await run(["install"]);
  const lockfile = await file(join(packageDir, "bun.lock")).text();
  expect(lockfile).toContain('"optional-peer-hoist-target": ["optional-peer-hoist-target@2.0.0"');
  expect(lockfile).toContain(
    '"optional-peer-hoist-deep-child/optional-peer-hoist-target": ["optional-peer-hoist-target@1.0.0"',
  );
  const linkedByThisInstall = consumerLink();
  expect(linkedByThisInstall).not.toBe(boundToTarget1);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
  expect(consumerLink()).toBe(linkedByThisInstall);

  await run(["install", "--lockfile-only"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
});

/** `name -> version -> extra package.json fields` for `serveRegistry`. */
type Manifests = Record<string, Record<string, Record<string, unknown>>>;

// A registry serving exactly `manifests`, each version as a tarball holding just its package.json.
async function serveRegistry(manifests: Manifests) {
  const tarballs = new Map<string, Uint8Array>();
  for (const [name, versions] of Object.entries(manifests)) {
    for (const [version, extra] of Object.entries(versions)) {
      const archive = new Bun.Archive(
        { "package/package.json": JSON.stringify({ name, version, ...extra }) },
        { compress: "gzip" },
      );
      tarballs.set(`/${name}-${version}.tgz`, await archive.bytes());
    }
  }
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { origin, pathname } = new URL(request.url);
      requests.push(pathname);
      const tarball = tarballs.get(pathname);
      if (tarball) return new Response(tarball);
      const name = pathname.slice(1);
      const entry = manifests[name];
      if (!entry) return new Response("not found", { status: 404 });
      const versions: Record<string, unknown> = {};
      for (const [version, extra] of Object.entries(entry)) {
        versions[version] = { name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` }, ...extra };
      }
      return Response.json(
        { name, versions, "dist-tags": { latest: Object.keys(entry).at(-1) } },
        // Like registry.npmjs.org. Within this window bun resolves from the
        // manifest cache without going back to the registry.
        { headers: { "cache-control": "public, max-age=300" } },
      );
    },
  });
  return {
    url: server.url.href,
    origin: server.url.origin,
    requests,
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

async function installWithOwnCache(cwd: string, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    // Request assertions need a cache of their own per project: the environment's
    // cache dir takes precedence over bunfig, and a package extracted there by one
    // of the concurrent tests is not downloaded again.
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
    // Only matters if an install never returns.
    timeout: 30_000,
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ args, err, code }).toMatchObject({ args, err: expect.not.stringContaining("error:"), code: 0 });
  return { out, err };
}

// https://github.com/oven-sh/bun/issues/26046
// A required peer that nothing in the tree provides and that no published
// version satisfies stays unresolved. The bun.lock written afterwards has to
// load back, and resolving it again with every manifest already in the cache
// has to finish (it used to retry the cached manifest forever).
describe.each(["hoisted", "isolated"] as const)("peer no published version satisfies (%s linker)", linker => {
  const manifests: Manifests = {
    "has-unmet-peer": { "1.0.0": { peerDependencies: { "peer-target": "^1.0.1" } } },
    "peer-target": { "2.0.1": {} },
  };

  const unmetPeerWarning =
    'warn: No version matching "^1.0.1" found for peer dependency "peer-target" (but package exists)';

  function createProject(registryUrl: string, files: Record<string, string>) {
    return tempDir("unmet-peer-", {
      ...files,
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registryUrl, linker } }),
    });
  }

  it.concurrent("declared by a registry package", async () => {
    using registry = await serveRegistry(manifests);
    using dir = createProject(registry.url, {
      "package.json": JSON.stringify({ name: "app", dependencies: { "has-unmet-peer": "1.0.0" } }),
    });
    const lockfilePath = join(String(dir), "bun.lock");

    let { err } = await installWithOwnCache(String(dir));
    expect(err).toContain(unmetPeerWarning);
    expect(err).toContain("Saved lockfile");
    expect(registry.requests.toSorted()).toEqual(["/has-unmet-peer", "/has-unmet-peer-1.0.0.tgz", "/peer-target"]);
    const lockfile = await file(lockfilePath).text();
    expect(lockfile.replaceAll(registry.origin, "<registry>")).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 1,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "app",
            "dependencies": {
              "has-unmet-peer": "1.0.0",
            },
          },
        },
        "packages": {
          "has-unmet-peer": ["has-unmet-peer@1.0.0", "<registry>/has-unmet-peer-1.0.0.tgz", { "peerDependencies": { "peer-target": "^1.0.1" } }, ""],
        }
      }
      "
    `);
    expect(await exists(join(String(dir), "node_modules", "peer-target"))).toBeFalse();

    ({ err } = await installWithOwnCache(String(dir), "--frozen-lockfile"));
    expect(err).not.toContain("Ignoring lockfile");
    expect(await file(lockfilePath).text()).toBe(lockfile);

    // Resolve from scratch again. Both manifests are cached now, so the peer
    // is looked up synchronously instead of through a network task.
    await rm(lockfilePath);
    await rm(join(String(dir), "node_modules"), { recursive: true });
    registry.requests.length = 0;
    ({ err } = await installWithOwnCache(String(dir)));
    expect(err).toContain(unmetPeerWarning);
    expect(registry.requests).toEqual([]);
    expect(await file(lockfilePath).text()).toBe(lockfile);
  });

  it.concurrent("declared by the root package and a workspace", async () => {
    using registry = await serveRegistry(manifests);
    using dir = createProject(registry.url, {
      "package.json": JSON.stringify({
        name: "app",
        workspaces: ["packages/*"],
        peerDependencies: { "peer-target": "^1.0.1" },
      }),
      "packages/ws/package.json": JSON.stringify({ name: "ws", peerDependencies: { "peer-target": "^1.0.1" } }),
    });
    const lockfilePath = join(String(dir), "bun.lock");

    let { err } = await installWithOwnCache(String(dir));
    expect(err).toContain(unmetPeerWarning);
    expect(err).toContain("Saved lockfile");
    expect(registry.requests).toEqual(["/peer-target"]);
    const lockfile = await file(lockfilePath).text();
    expect(lockfile).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "app",
            "peerDependencies": {
              "peer-target": "^1.0.1",
            },
          },
          "packages/ws": {
            "name": "ws",
            "peerDependencies": {
              "peer-target": "^1.0.1",
            },
          },
        },
        "packages": {
          "ws": ["ws@workspace:packages/ws"],
        }
      }
      "
    `);

    ({ err } = await installWithOwnCache(String(dir), "--frozen-lockfile"));
    expect(err).not.toContain("Ignoring lockfile");
    expect(await file(lockfilePath).text()).toBe(lockfile);
  });
});

// A package is printed at more than one path when another version of it holds the slot above
// one of its dependents (here the root holds one version, a parent holds the other, and the
// dependents under that parent get the root's version printed again next to them). Its edges
// are in the file once, so loading binds them once per printed path, and the paths can find
// different copies of a peer; the path printed last used to win, so what an edge loaded as
// depended on how its dependents' parents happened to sort.
describe("loading bun.lock binds the edges of a package printed at several paths", () => {
  /** `path -> "name@version"` for every row of the packages object. */
  const printedPackages = (lockfile: string) =>
    Object.fromEntries(Array.from(lockfile.matchAll(/^ {4}"([^"]+)": \["([^"]+)"/gm), m => [m[1], m[2]]));

  const manifests: Manifests = {
    // star-peer@1.0.0's peer edge is the one being loaded; 2.0.0 exists so mid's copy of 1.0.0 nests.
    "star-peer": { "1.0.0": { peerDependencies: { "peer-target": "*" } }, "2.0.0": {} },
    "peer-target": { "1.0.0": {}, "1.1.0": {} },
    // mid@1.0.0 is the second dependent of star-peer@1.0.0 and holds the other peer-target next to
    // it; mid@2.0.0 at the root is what keeps mid@1.0.0 nested under parent.
    "mid": { "1.0.0": { dependencies: { "star-peer": "1.0.0", "peer-target": "1.1.0" } }, "2.0.0": {} },
    "parent": { "1.0.0": { dependencies: { "star-peer": "2.0.0", "mid": "1.0.0" } } },
  };

  it.concurrent("a `*` peer is read back from the copy its root-level printing placed at the root", async () => {
    using registryServer = await serveRegistry(manifests);
    const packageJson = (dependencies: Record<string, string>) => JSON.stringify({ name: "app", dependencies });
    using dir = tempDir("bun-lock-several-paths-", {
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registryServer.url } }),
      "package.json": packageJson({ "star-peer": "1.0.0", "peer-target": "1.0.0", "mid": "2.0.0" }),
    });
    const cwd = String(dir);
    const lockfilePath = join(cwd, "bun.lock");

    await installWithOwnCache(cwd);
    expect(printedPackages(await file(lockfilePath).text())).toEqual({
      "mid": "mid@2.0.0",
      "peer-target": "peer-target@1.0.0",
      "star-peer": "star-peer@1.0.0",
    });

    // peer-target leaves package.json as parent enters it. star-peer's peer edge is still bound
    // to peer-target@1.0.0, which keeps it in the file: the edge's own copy is placed at the root
    // and mid's 1.1.0 is printed next to mid, which is where star-peer's second printing finds
    // the name first.
    await write(join(cwd, "package.json"), packageJson({ "star-peer": "1.0.0", "mid": "2.0.0", "parent": "1.0.0" }));
    await installWithOwnCache(cwd);
    expect(printedPackages(await file(lockfilePath).text())).toEqual({
      "mid": "mid@2.0.0",
      "parent": "parent@1.0.0",
      "peer-target": "peer-target@1.0.0",
      "star-peer": "star-peer@1.0.0",
      "parent/mid": "mid@1.0.0",
      "parent/star-peer": "star-peer@2.0.0",
      "parent/mid/peer-target": "peer-target@1.1.0",
      "parent/mid/star-peer": "star-peer@1.0.0",
    });

    // Loading used to bind the edge from parent/mid/star-peer, the printing that comes last, to
    // the 1.1.0 next to it. Nothing held peer-target@1.0.0 any more, so the tree built from the
    // file differed from the file: --frozen-lockfile rejected it and an install rewrote it.
    await rm(join(cwd, "node_modules"), { recursive: true });
    await installWithOwnCache(cwd, "--frozen-lockfile");
    expect(await file(join(cwd, "node_modules", "peer-target", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
    expect(
      await file(
        join(cwd, "node_modules", "parent", "node_modules", "mid", "node_modules", "peer-target", "package.json"),
      ).json(),
    ).toMatchObject({ version: "1.1.0" });
  });

  // The shapes below are written by hand so nothing needs to be fetched: every row has an empty
  // registry URL and integrity, which --lockfile-only and --frozen-lockfile --dry-run never read.
  const pkg = (nameAndVersion: string, info: object = {}) => [nameAndVersion, "", info, ""];
  const printedDepth = (path: string) => path.split("/").filter(segment => !segment.startsWith("@")).length;

  async function writeProject(root: Record<string, unknown>, packages: Record<string, unknown[]>) {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
    // Rows in the order bun prints them (depth, then path), since loading reads them in file order.
    const rows = Object.entries(packages).sort(([a], [b]) => printedDepth(a) - printedDepth(b) || a.localeCompare(b));
    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify({ name: "foo", ...root })),
      write(
        join(packageDir, "bun.lock"),
        JSON.stringify({
          lockfileVersion: 1,
          configVersion: 0,
          workspaces: { "": { name: "foo", ...root } },
          packages: Object.fromEntries(rows),
        }),
      ),
    ]);
    return { packageDir, run: makeInstallRunner(packageDir) };
  }

  // dup@1.0.0 is printed under a-parent and under z-parent (the root holds dup@2.0.0). Its
  // optional peer wants no-deps@1.0.0 exactly; the root's no-deps is one-dep's 1.0.1, which the
  // edge cannot be deduped onto (out of range, not a root dependency), so the copy the edge is
  // bound to gets printed next to dup. The file records one such copy, under `holder`; the
  // printing under the other parent walks up to the root's 1.0.1. An entry in a package's own
  // path is only ever there for that package's own edge, so the edge has to load as 1.0.0
  // whichever parent sorts last, and the tree then holds 1.0.0 next to both printings. With the
  // record under a-parent, binding from the last printing read the root's 1.0.1 instead and the
  // re-save dropped the record. (uses-old keeps no-deps@1.0.0 in the file: a version held only
  // by optional peer edges is dropped on save.)
  it.concurrent.each(["a-parent", "z-parent"])(
    "an optional peer's copy printed next to its %s printing is read from there",
    async holder => {
      const dup = pkg("dup@1.0.0", { peerDependencies: { "no-deps": "1.0.0" }, optionalPeers: ["no-deps"] });
      const packages: Record<string, unknown[]> = {
        "a-parent": pkg("a-parent@1.0.0", { dependencies: { "dup": "1.0.0" } }),
        "dup": pkg("dup@2.0.0"),
        "no-deps": pkg("no-deps@1.0.1"),
        "one-dep": pkg("one-dep@1.0.0", { dependencies: { "no-deps": "1.0.1" } }),
        "uses-old": pkg("uses-old@1.0.0", { dependencies: { "no-deps": "1.0.0" } }),
        "z-parent": pkg("z-parent@1.0.0", { dependencies: { "dup": "1.0.0" } }),
        "a-parent/dup": dup,
        "uses-old/no-deps": pkg("no-deps@1.0.0"),
        "z-parent/dup": dup,
        [`${holder}/dup/no-deps`]: pkg("no-deps@1.0.0"),
      };
      const { packageDir, run } = await writeProject(
        {
          dependencies: {
            "a-parent": "1.0.0",
            "dup": "2.0.0",
            "one-dep": "1.0.0",
            "uses-old": "1.0.0",
            "z-parent": "1.0.0",
          },
        },
        packages,
      );

      await run(["install", "--lockfile-only"]);
      const saved = await file(join(packageDir, "bun.lock")).text();
      expect(printedPackages(saved)).toEqual({
        "a-parent": "a-parent@1.0.0",
        "dup": "dup@2.0.0",
        "no-deps": "no-deps@1.0.1",
        "one-dep": "one-dep@1.0.0",
        "uses-old": "uses-old@1.0.0",
        "z-parent": "z-parent@1.0.0",
        "a-parent/dup": "dup@1.0.0",
        "uses-old/no-deps": "no-deps@1.0.0",
        "z-parent/dup": "dup@1.0.0",
        "a-parent/dup/no-deps": "no-deps@1.0.0",
        "z-parent/dup/no-deps": "no-deps@1.0.0",
      });

      await run(["install", "--frozen-lockfile", "--dry-run"]);
      await run(["install", "--lockfile-only"]);
      expect(await file(join(packageDir, "bun.lock")).text()).toBe(saved);
    },
  );

  // Same two printings of dup@1.0.0, but nothing is printed for its optional peer: the printing
  // under a-q walks up to the root's no-deps@1.0.0 (b-old's, out of range), the one under z-p
  // finds z-p's own 1.1.0, which the range accepts. This is the file a fresh install writes, and
  // it has to keep loading from the printing that comes last (z-p's). The hoister rebinds an
  // optional peer to whatever copy a printing dedupes onto, so loading it as the root's copy,
  // the way the `*` peer in the first test is, builds a tree in which a-q's printing dedupes
  // onto the root copy and z-p's then rebinds the edge to 1.1.0; the tree the save rebuilds
  // from that binding nests 1.1.0 under a-q/dup, and --frozen-lockfile reports the difference
  // as a changed lockfile.
  it.concurrent("an optional peer printed nowhere keeps loading from the last printing", async () => {
    const dup = pkg("dup@1.0.0", { peerDependencies: { "no-deps": "^1.1.0" }, optionalPeers: ["no-deps"] });
    const { run } = await writeProject(
      { dependencies: { "a-q": "1.0.0", "b-old": "1.0.0", "dup": "2.0.0", "z-p": "1.0.0" } },
      {
        "a-q": pkg("a-q@1.0.0", { dependencies: { "dup": "1.0.0" } }),
        "b-old": pkg("b-old@1.0.0", { dependencies: { "no-deps": "1.0.0" } }),
        "dup": pkg("dup@2.0.0"),
        "no-deps": pkg("no-deps@1.0.0"),
        "z-p": pkg("z-p@1.0.0", { dependencies: { "dup": "1.0.0", "no-deps": "1.1.0" } }),
        "a-q/dup": dup,
        "z-p/dup": dup,
        "z-p/no-deps": pkg("no-deps@1.1.0"),
      },
    );

    await run(["install", "--frozen-lockfile", "--dry-run"]);
  });
});
