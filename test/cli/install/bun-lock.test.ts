import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readlinkSync, realpathSync, statSync } from "fs";
import { access, copyFile, cp, exists, open, rm, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isLinux,
  isWindows,
  normalizeBunSnapshot,
  readdirSorted,
  runBunInstall,
  tempDir,
  toBeValidBin,
} from "harness";
import { delimiter, dirname, join } from "path";
import { TestRegistry } from "registry";

expect.extend({
  toBeValidBin,
});

var registry = new TestRegistry();

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

  // Run 'bun install' to generate the lockfile. Its mode is 0o666 less the umask.
  const installResult = spawn({
    cmd: isWindows
      ? [bunExe(), "install", "--save-text-lockfile"]
      : ["sh", "-c", `umask 022 && exec "$0" install --save-text-lockfile`, bunExe()],
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
  // optional-native depends on native-libc-glibc and native-libc-musl; on Linux only the one
  // matching the host libc is installed, elsewhere libc is not filtered. The lockfile is the
  // same everywhere.
  const installedLine = `${isLinux ? 12 : 13} packages installed`;
  expect(out1.pop()).toBe(installedLine);
  expect(out1).toMatchInlineSnapshot(`
    [
      "preinstall",
      "",
      "+ optional-peer-deps@1.0.0 (v1.0.1 available)",
      "+ optional-native@1.0.0",
      "+ uses-what-bin@1.0.0 (v1.5.0 available)",
      "",
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
  expect(out2.pop()).toBe(installedLine);
  expect(out2).toMatchInlineSnapshot(`
    [
      "preinstall",
      "",
      "+ bundled-1@1.0.0",
      "",
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

// None of the `zz-` names are in the registry, so requesting one fails the install.
describe.each(["hoisted", "isolated"])("a peer that a file: dependency provides, %s linker", linker => {
  const host = (name: string, version = "1.0.0") => ({ name, version });
  type Shape = {
    title: string;
    files: Record<string, object>;
    /** Where bun.lock has each host. */
    keys: Record<string, string[]>;
    /** `[from, name, version]`: the package in `from`, a path below the project, loads `name` at `version`. */
    loads: [string, string, string][];
  };

  it.concurrent.each<Shape>([
    {
      title: "the root's",
      files: {
        "package.json": {
          name: "foo",
          dependencies: { "zz-plugin": "file:./vendor/zz-plugin", "zz-host": "file:./vendor/zz-host" },
        },
        "vendor/zz-host/package.json": host("zz-host"),
        "vendor/zz-plugin/package.json": { ...host("zz-plugin"), peerDependencies: { "zz-host": ">=1.0.0" } },
      },
      keys: { "zz-host": ["zz-host"] },
      loads: [["node_modules/zz-plugin", "zz-host", "1.0.0"]],
    },
    {
      title: "the root's, for a workspace",
      files: {
        "package.json": {
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: { "zz-host": "file:./vendor/zz-host" },
        },
        "vendor/zz-host/package.json": host("zz-host"),
        "packages/zz-plugin/package.json": { ...host("zz-plugin"), peerDependencies: { "zz-host": "*" } },
      },
      keys: { "zz-host": ["zz-host"] },
      loads: [["packages/zz-plugin", "zz-host", "1.0.0"]],
    },
    {
      title: "the one its own package.json has in another group",
      files: {
        "package.json": {
          name: "foo",
          dependencies: { "zz-plugin-c": "file:./vendor/zz-plugin-c", "zz-plugin-d": "file:./vendor/zz-plugin-d" },
        },
        "vendor/zz-host-c/package.json": host("zz-host-c"),
        "vendor/zz-host-d/package.json": host("zz-host-d"),
        "vendor/zz-plugin-c/package.json": {
          ...host("zz-plugin-c"),
          peerDependencies: { "zz-host-c": "*" },
          optionalDependencies: { "zz-host-c": "file:../zz-host-c" },
        },
        "vendor/zz-plugin-d/package.json": {
          ...host("zz-plugin-d"),
          peerDependencies: { "zz-host-d": ">=1.0.0" },
          dependencies: { "zz-host-d": "file:../zz-host-d" },
        },
      },
      keys: { "zz-host-c": ["zz-plugin-c/zz-host-c"], "zz-host-d": ["zz-plugin-d/zz-host-d"] },
      loads: [
        ["node_modules/zz-plugin-c", "zz-host-c", "1.0.0"],
        ["node_modules/zz-plugin-d", "zz-host-d", "1.0.0"],
      ],
    },
    {
      title: "its own rather than the root's",
      files: {
        "package.json": {
          name: "foo",
          dependencies: { "zz-plugin": "file:./vendor/zz-plugin", "zz-host": "file:./vendor/zz-host" },
        },
        "vendor/zz-host/package.json": host("zz-host", "2.0.0"),
        "vendor/zz-host-vendored/package.json": host("zz-host", "1.0.0"),
        "vendor/zz-plugin/package.json": {
          ...host("zz-plugin"),
          peerDependencies: { "zz-host": "*" },
          optionalDependencies: { "zz-host": "file:../zz-host-vendored" },
        },
      },
      keys: { "zz-host": ["zz-host", "zz-plugin/zz-host"] },
      loads: [
        ["", "zz-host", "2.0.0"],
        ["node_modules/zz-plugin", "zz-host", "1.0.0"],
      ],
    },
  ])("$title", async ({ files, keys, loads }) => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
    });
    const installEnv = { ...env, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };
    const check = async () => {
      const { packages } = Bun.JSONC.parse(await file(join(packageDir, "bun.lock")).text()) as {
        packages: Record<string, [string]>;
      };
      const found = Object.keys(keys).map(name => [
        name,
        Object.keys(packages).filter(key => packages[key][0].startsWith(`${name}@`)),
      ]);
      expect(Object.fromEntries(found)).toEqual(keys);
      for (const [from, name, version] of loads) {
        // The files of a folder dependency can be links to their sources, so only the directory is followed.
        let dir = realpathSync(join(packageDir, from));
        while (dir !== dirname(dir) && !existsSync(join(dir, "node_modules", name, "package.json"))) dir = dirname(dir);
        const found = await file(join(dir, "node_modules", name, "package.json")).json();
        expect([from, name, found.version]).toEqual([from, name, version]);
      }
    };

    await runBunInstall(installEnv, packageDir);
    await check();
    const lockfile = await file(join(packageDir, "bun.lock")).text();

    await runBunInstall(installEnv, packageDir, { savesLockfile: false });
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(installEnv, packageDir, { frozenLockfile: true });
    await check();
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
  });

  // peer-deps-fixed has the peer no-deps@^1.0.0, which is in the registry.
  it.concurrent("is not downloaded from the registry next to it", async () => {
    const manifest = (group: string) => ({
      name: "foo",
      optionalDependencies: { "peer-deps-fixed": "1.0.0" },
      [group]: { "no-deps": "file:./vendor/no-deps" },
    });
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify(manifest("dependencies")),
        "vendor/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "1.0.5" }),
      },
    });
    const cache = join(packageDir, ".bun-cache");
    const downloaded = async () => (await readdirSorted(cache)).filter(entry => entry.startsWith("no-deps"));

    await runBunInstall({ ...env, BUN_INSTALL_CACHE_DIR: cache }, packageDir);
    expect(await downloaded()).toEqual([]);
    expect(await file(join(packageDir, "bun.lock")).text()).not.toContain('"no-deps@1.1.0"');

    // The peer still uses the folder when this install omits the group that lists it.
    await Promise.all([
      write(packageJson, JSON.stringify(manifest("devDependencies"))),
      rm(join(packageDir, "bun.lock")),
      rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
    ]);
    await using proc = spawn({
      cmd: [bunExe(), "install", "--omit=dev"],
      cwd: packageDir,
      env: { ...env, BUN_INSTALL_CACHE_DIR: cache },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(await downloaded()).toEqual([]);
    let dir = realpathSync(join(packageDir, "node_modules", "peer-deps-fixed"));
    while (dir !== dirname(dir) && !existsSync(join(dir, "node_modules", "no-deps", "package.json")))
      dir = dirname(dir);
    expect((await file(join(dir, "node_modules", "no-deps", "package.json")).json()).version).toBe("1.0.5");
    expect(exitCode).toBe(0);
  });
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

// bun.lock stores every package as "<name>@<resolution>" and splits the name back off at the
// first "@" after an optional scope, so a package without a name cannot be stored. A folder or
// tarball package whose package.json had no name used to be written as e.g. "@file:../dir", which
// the next install could not parse: it printed "Ignoring lockfile", and --frozen-lockfile always
// failed. Such packages are now named after their folder or tarball. The git variant lives in
// bun-install-git-deps.test.ts, the isolated store layout in isolated-install.test.ts.
it("names folder and tarball packages without a package.json name after their folder or tarball", async () => {
  const noName = JSON.stringify({ version: "1.0.0" });
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: {
      "pkgs/folder-pkg/package.json": noName,
      "pkgs/empty-name-pkg/package.json": JSON.stringify({ name: "", version: "1.0.0" }),
      // "odd@folder" cannot be stored as a name either, so this one gets the generic name.
      "pkgs/odd@folder/package.json": noName,
      // "#" and "?" end the path of a URL only.
      "pkgs/c#-utils/package.json": noName,
    },
  });
  await Bun.Archive.write(
    join(packageDir, "tarball-pkg.tgz"),
    { "package/package.json": noName },
    { compress: "gzip" },
  );
  // Serves that tarball under other file names, because remote packages are named after the URL.
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Response(file(join(packageDir, "tarball-pkg.tgz"))),
  });
  const dependencies: Record<string, string> = {
    "folder-dep": "file:./pkgs/folder-pkg",
    "empty-name-dep": "file:./pkgs/empty-name-pkg",
    "odd-folder-dep": "file:./pkgs/odd@folder",
    "hash-folder-dep": "file:./pkgs/c#-utils",
    "tarball-dep": "file:./tarball-pkg.tgz",
    "remote-dep": `http://localhost:${server.port}/remote-pkg.tgz`,
    "signed-url-dep": `http://localhost:${server.port}/signed-pkg.tgz?token=abc/def`,
    "fragment-url-dep": `http://localhost:${server.port}/pinned-pkg.tgz#abc/def`,
  };
  await write(packageJson, JSON.stringify({ name: "deps-without-names", dependencies }));

  await runBunInstall(env, packageDir);
  const lockfile = await file(join(packageDir, "bun.lock")).text();
  expect(lockfile.replaceAll(/localhost:\d+/g, "localhost:1234").replaceAll(/"sha512-[^"]*"/g, '"<integrity>"'))
    .toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "deps-without-names",
          "dependencies": {
            "empty-name-dep": "file:./pkgs/empty-name-pkg",
            "folder-dep": "file:./pkgs/folder-pkg",
            "fragment-url-dep": "http://localhost:1234/pinned-pkg.tgz#abc/def",
            "hash-folder-dep": "file:./pkgs/c#-utils",
            "odd-folder-dep": "file:./pkgs/odd@folder",
            "remote-dep": "http://localhost:1234/remote-pkg.tgz",
            "signed-url-dep": "http://localhost:1234/signed-pkg.tgz?token=abc/def",
            "tarball-dep": "file:./tarball-pkg.tgz",
          },
        },
      },
      "packages": {
        "empty-name-dep": ["empty-name-pkg@file:pkgs/empty-name-pkg", {}],

        "folder-dep": ["folder-pkg@file:pkgs/folder-pkg", {}],

        "fragment-url-dep": ["pinned-pkg@http://localhost:1234/pinned-pkg.tgz#abc/def", {}, "<integrity>"],

        "hash-folder-dep": ["c#-utils@file:pkgs/c#-utils", {}],

        "odd-folder-dep": ["unnamed-package@file:pkgs/odd@folder", {}],

        "remote-dep": ["remote-pkg@http://localhost:1234/remote-pkg.tgz", {}, "<integrity>"],

        "signed-url-dep": ["signed-pkg@http://localhost:1234/signed-pkg.tgz?token=abc/def", {}, "<integrity>"],

        "tarball-dep": ["tarball-pkg@./tarball-pkg.tgz", {}, "<integrity>"],
      }
    }
    "
  `);
  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
    "empty-name-dep",
    "folder-dep",
    "fragment-url-dep",
    "hash-folder-dep",
    "odd-folder-dep",
    "remote-dep",
    "signed-url-dep",
    "tarball-dep",
  ]);

  // runBunInstall rejects any warning, which includes "warn: Ignoring lockfile".
  await runBunInstall(env, packageDir, { savesLockfile: false });
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
  await runBunInstall(env, packageDir, { frozenLockfile: true });

  // The name comes from the folder, not from the alias, so a second alias for the same folder
  // resolves to the package already in the lockfile.
  dependencies["folder-dep-again"] = "file:./pkgs/folder-pkg";
  await write(packageJson, JSON.stringify({ name: "deps-without-names", dependencies }));
  await runBunInstall(env, packageDir);
  expect(await file(join(packageDir, "bun.lock")).text()).toContain(
    '"folder-dep-again": ["folder-pkg@file:pkgs/folder-pkg", {}]',
  );
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

describe.concurrent("yarn.lock and --dry-run", () => {
  // The ways to ask for a yarn.lock: flags, an environment variable, or bunfig.
  type Route = { flags: string[]; env?: Record<string, string>; bunfig?: string };
  const yarnBunfig = '\n[install.lockfile]\nprint = "yarn"\n';

  async function setup(route: Pick<Route, "env" | "bunfig"> = {}) {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "yarn-lock-dry-run",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );
    if (route.bunfig) {
      const bunfig = join(packageDir, "bunfig.toml");
      await write(bunfig, (await file(bunfig).text()) + route.bunfig);
    }
    const yarnLock = join(packageDir, "yarn.lock");

    async function run(args: string[]) {
      const { exited, stderr } = spawn({
        cmd: [bunExe(), ...args],
        cwd: packageDir,
        env: { ...env, ...route.env },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [err, exitCode] = await Promise.all([stderr.text(), exited]);
      return { err, result: { args, wrote: await exists(yarnLock), exitCode } };
    }

    return { yarnLock, run };
  }

  describe.each([
    ["--yarn before --dry-run", { flags: ["--yarn", "--dry-run"] }],
    ["--yarn after --dry-run", { flags: ["--dry-run", "--yarn"] }],
    ["BUN_CONFIG_YARN_LOCKFILE", { flags: ["--dry-run"], env: { BUN_CONFIG_YARN_LOCKFILE: "1" } }],
    ['bunfig print = "yarn"', { flags: ["--dry-run"], bunfig: yarnBunfig }],
  ] as [string, Route][])("%s", (_, route) => {
    it("a dry run does not write it", async () => {
      const { run } = await setup(route);
      const args = ["install", ...route.flags];
      const { err, result } = await run(args);
      expect(err).not.toContain("error:");
      expect(result).toEqual({ args, wrote: false, exitCode: 0 });
    });
  });

  describe.each(["add a-dep", "update"])("%s", command => {
    it("a dry run does not write it", async () => {
      const { run } = await setup();
      const args = [...command.split(" "), "--yarn", "--dry-run"];
      const { err, result } = await run(args);
      expect(err).not.toContain("error:");
      expect(result).toEqual({ args, wrote: false, exitCode: 0 });
    });
  });

  it("a dry run leaves an existing yarn.lock unchanged", async () => {
    const { yarnLock, run } = await setup();
    const install = await run(["install", "--yarn"]);
    expect(install.err).toContain("Saved yarn.lock");
    expect(install.result).toEqual({ args: ["install", "--yarn"], wrote: true, exitCode: 0 });
    const before = await file(yarnLock).text();
    expect(before).toContain("no-deps@1.0.0");

    const args = ["add", "a-dep", "--yarn", "--dry-run"];
    const { err, result } = await run(args);
    expect(err).not.toContain("error:");
    expect({ ...result, unchanged: (await file(yarnLock).text()) === before }).toEqual({
      args,
      wrote: true,
      exitCode: 0,
      unchanged: true,
    });
  });

  describe.each([
    ["BUN_CONFIG_YARN_LOCKFILE", { flags: [], env: { BUN_CONFIG_YARN_LOCKFILE: "1" } }],
    ['bunfig print = "yarn"', { flags: [], bunfig: yarnBunfig }],
  ] as [string, Route][])("%s", (_, route) => {
    it("an install that is not a dry run writes it", async () => {
      const { run } = await setup(route);
      const { err, result } = await run(["install"]);
      expect(err).toContain("Saved yarn.lock");
      expect(result).toEqual({ args: ["install"], wrote: true, exitCode: 0 });
    });
  });
});

describe.concurrent.each([
  ["022", "644"],
  ["077", "600"],
])("umask %s", (umask, expectedMode) => {
  it.skipIf(isWindows)("bun.lock and yarn.lock honor umask", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({ name: "umask", workspaces: ["pkg1"], dependencies: { pkg1: "workspace:*" } }),
        "pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.0.0" }),
      },
    });
    await using proc = spawn({
      cmd: ["sh", "-c", `umask ${umask} && exec "$0" install --yarn`, bunExe()],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("Saved lockfile");
    expect(err).toContain("Saved yarn.lock");
    expect(exitCode).toBe(0);

    const modes = Object.fromEntries(
      ["bun.lock", "yarn.lock"].map(name => [name, (statSync(join(packageDir, name)).mode & 0o777).toString(8)]),
    );
    expect(modes).toEqual({ "bun.lock": expectedMode, "yarn.lock": expectedMode });
  });
});

// The first install prints what it resolved, and the second prints what it loaded from bun.lock.
it.concurrent.each([true, false])(
  "an install that changes nothing doesn't touch yarn.lock (saveTextLockfile = %p)",
  async saveTextLockfile => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { saveTextLockfile },
      files: {
        "package.json": JSON.stringify({
          name: "yarn-lock-twice",
          workspaces: ["packages/*", "zz/*"],
          scripts: { postinstall: "exit 0" },
          // its manifest lists `no-deps` before `@types/is-number`
          dependencies: { "two-range-deps": "1.0.0", "duplicate-optional": "1.0.1", a: "workspace:*" },
        }),
        "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
        "packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0", dependencies: { a: "workspace:^" } }),
        "zz/c/package.json": JSON.stringify({ name: "c", version: "1.0.0", dependencies: { c: "workspace:*" } }),
      },
    });
    const yarnLock = join(packageDir, "yarn.lock");
    const states = [];
    for (let i = 0; i < 2; i++) {
      await using proc = spawn({
        cmd: [bunExe(), "install", "--yarn"],
        cwd: packageDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
      states.push({ text: await file(yarnLock).text(), inode: statSync(yarnLock).ino });
    }
    expect(states[0].text).toContain('"a@packages/a", "a@workspace:*", "a@workspace:^":');
    expect(states[0].text).not.toContain("--hash: 0000000000000000-");
    expect(states[1]).toEqual(states[0]);
  },
);

// one-dep depends on no-deps@1.0.1. An `npm:` alias that bun knows sends a plain dependency of that name to its target.
describe.concurrent("an npm: alias that's only in the lockfile", () => {
  const overrides = { "no-deps": "npm:a-dep@1.0.1" };
  const app = { name: "app", dependencies: { "one-dep": "1.0.0" } };
  const installedAsNoDeps = async (dir: string) =>
    (await file(join(dir, "node_modules", "no-deps", "package.json")).json()).name;

  it.each([true, false])("stops applying with the override (saveTextLockfile = %p)", async saveTextLockfile => {
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { saveTextLockfile },
      files: { "package.json": JSON.stringify({ ...app, overrides }) },
    });
    await runBunInstall(env, packageDir);
    expect(await installedAsNoDeps(packageDir)).toBe("a-dep");

    await write(packageJson, JSON.stringify(app));
    await runBunInstall(env, packageDir);
    expect(await installedAsNoDeps(packageDir)).toBe("no-deps");
  });

  it("redirects nothing when bun.lock is refused", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify(app),
        "bun.lock": JSON.stringify({
          lockfileVersion: 2,
          configVersion: 1,
          workspaces: { "": app },
          overrides,
          // Refused, because it isn't from the registry and has no integrity.
          packages: { "one-dep": ["one-dep@1.0.0", "http://elsewhere.invalid/one-dep-1.0.0.tgz", {}, ""] },
        }),
      },
    });
    await using proc = spawn({ cmd: [bunExe(), "install"], cwd: packageDir, env, stdout: "pipe", stderr: "pipe" });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("warn: Ignoring lockfile");
    expect(await installedAsNoDeps(packageDir)).toBe("no-deps");
    expect(exitCode).toBe(0);
  });

  it("redirects nothing when bun.lockb fails to load after its rows", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { saveTextLockfile: false },
      files: { "package.json": JSON.stringify({ name: "app", dependencies: overrides }) },
    });
    await runBunInstall(env, packageDir);
    expect(await installedAsNoDeps(packageDir)).toBe("a-dep");

    // The 8 zero bytes between the buffers and the first tagged section.
    const lockb = Buffer.from(await file(join(packageDir, "bun.lockb")).arrayBuffer());
    lockb[lockb.indexOf("cNfGvRsN") - 8] = 1;
    await Promise.all([
      write(join(packageDir, "bun.lockb"), lockb),
      write(packageJson, JSON.stringify(app)),
      rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
    ]);
    await using proc = spawn({ cmd: [bunExe(), "install"], cwd: packageDir, env, stdout: "pipe", stderr: "pipe" });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("warn: Ignoring lockfile");
    expect(await installedAsNoDeps(packageDir)).toBe("no-deps");
    expect(exitCode).toBe(0);
  });
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

// The parse errors of an ignored lockfile are dropped even when nothing prints them.
it.concurrent("--silent ignores a bun.lock that fails to parse and writes a new one", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "broken-lockfile", dependencies: { "no-deps": "1.0.0" } })),
    write(join(packageDir, "bun.lock"), "{ this is not json"),
  ]);

  for (const args of [["--lockfile-only"], []]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--silent", ...args],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(out).toBe("");
    expect(err).toBe("");
    expect(await file(join(packageDir, "bun.lock")).text()).toContain('"no-deps": ["no-deps@1.0.0"');
    expect(exitCode).toBe(0);
    await write(join(packageDir, "bun.lock"), "{ this is not json");
  }
});

// An error from the environment is printed and fails the install at every log level, before the lockfile is touched.
it.concurrent.each([[[]], [["--silent"]], [["--lockfile-only", "--silent"]]])(
  "bun install %p fails on an invalid BUN_CONFIG_MAX_HTTP_REQUESTS",
  async args => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "bad-env", dependencies: { "no-deps": "1.0.0" } })),
      write(join(packageDir, "bun.lock"), "{ this is not json"),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: packageDir,
      env: { ...env, BUN_CONFIG_MAX_HTTP_REQUESTS: "abc" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain('BUN_CONFIG_MAX_HTTP_REQUESTS value "abc" is not a valid integer');
    expect(out).not.toContain("Saved");
    expect(await file(join(packageDir, "bun.lock")).text()).toBe("{ this is not json");
    expect(await exists(join(packageDir, "node_modules"))).toBe(false);
    expect(exitCode).toBe(1);
  },
);

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

// The commands that only read the lockfile name the step that failed and stop, without touching the registry.
describe.concurrent("a bun.lock that does not parse", () => {
  const projectFiles = {
    "package.json": JSON.stringify({ name: "unparsable-lockfile", dependencies: { "no-deps": "1.0.0" } }),
    "bun.lock": "this is not a lockfile\n",
  };

  async function run(prefix: string, ...args: string[]) {
    using dir = tempDir(prefix, projectFiles);
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out: normalizeBunSnapshot(out, String(dir)), err: normalizeBunSnapshot(err, String(dir)), exitCode };
  }

  it("bun outdated", async () => {
    const { out, err, exitCode } = await run("unparsable-lockfile-outdated", "outdated");
    expect(err).toMatchInlineSnapshot(`
      "1 | this is not a lockfile
          ^
      error: Unexpected this
          at bun.lock:1:1
      error: failed to parse lockfile: ParserError"
    `);
    expect(out).toMatchInlineSnapshot(`"bun outdated <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });

  it("bun update --interactive", async () => {
    const { out, err, exitCode } = await run("unparsable-lockfile-update-interactive", "update", "--interactive");
    expect(err).toMatchInlineSnapshot(`
      "1 | this is not a lockfile
          ^
      error: Unexpected this
          at bun.lock:1:1
      error: failed to parse lockfile: ParserError"
    `);
    expect(out).toMatchInlineSnapshot(`"bun update --interactive <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });

  it("bun pm ls", async () => {
    const { out, err, exitCode } = await run("unparsable-lockfile-pm-ls", "pm", "ls");
    expect(err).toMatchInlineSnapshot(`
      "1 | this is not a lockfile
          ^
      error: Unexpected this
          at bun.lock:1:1
      error: failed to parse lockfile: ParserError"
    `);
    expect(out).toMatchInlineSnapshot(`""`);
    expect(exitCode).toBe(1);
  });

  // Some of these commands print their name first, on stdout or on stderr. The error is the same for all of them.
  it.each([
    "audit",
    "why no-deps",
    "pm hash",
    "pm licenses",
    "pm untrusted",
    "pm trust --all",
    "pm cache pack cache.pack",
    "prune",
    "dedupe",
  ])("bun %s", async command => {
    const { err, exitCode } = await run("unparsable-lockfile-" + command.replaceAll(" ", "-"), ...command.split(" "));
    expect(err).toEndWith(
      "1 | this is not a lockfile\n    ^\nerror: Unexpected this\n    at bun.lock:1:1\nerror: failed to parse lockfile: ParserError",
    );
    expect(exitCode).toBe(1);
  });
});

// The same `dependencies` line can be in the lockfile twice. A merge that was resolved by hand can keep it from both
// sides, and Bun saves it that way if package.json repeats the line.
describe.concurrent("a new dependency next to a lockfile that repeats a dependency line", () => {
  async function exec(projectDir: string, cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(projectDir, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, code };
  }

  async function run(projectDir: string, cwd: string, ...args: string[]) {
    const { out, err, code } = await exec(projectDir, cwd, ...args);
    expect({ args, err, code }).toMatchObject({ args, err: expect.not.stringContaining("error:"), code: 0 });
    return { out, err };
  }

  const line = /^ *"no-deps": "1\.0\.0",\n/gm;

  // Installs `no-deps` for the root or for the workspace member, then repeats its bun.lock line.
  async function projectWithRepeatedLine(member: "" | "packages/a") {
    const { packageDir, packageJson } = await registry.createTestDir();
    const manifestPath = join(packageDir, member, "package.json");
    const manifest = { name: member ? "a" : "foo", dependencies: { "no-deps": "1.0.0" } };
    if (member) await write(packageJson, JSON.stringify({ name: "foo", workspaces: ["packages/*"] }));
    await write(manifestPath, JSON.stringify(manifest));
    await run(packageDir, packageDir, "install");

    const lockfilePath = join(packageDir, "bun.lock");
    const lockfile = await file(lockfilePath).text();
    expect(lockfile.match(line)).toHaveLength(1);
    const repeated = lockfile.replace(line, row => row + row);
    await write(lockfilePath, repeated);
    return { packageDir, manifestPath, manifest, lockfilePath, repeated };
  }

  async function expectInstalled(packageDir: string) {
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      name: "a-dep",
      version: "1.0.10",
    });
  }

  // "" is the key of the root in the `workspaces` object of bun.lock.
  describe.each(["", "packages/a"] as const)(
    'bun.lock with the line repeated by hand in the block of workspace "%s"',
    member => {
      it("bun add installs the new dependency", async () => {
        const { packageDir, manifestPath, manifest, lockfilePath, repeated } = await projectWithRepeatedLine(member);

        // The repeated line alone doesn't count as a change.
        await run(packageDir, packageDir, "install", "--frozen-lockfile");
        expect(await file(lockfilePath).text()).toBe(repeated);

        const { err } = await run(packageDir, join(packageDir, member), "add", "a-dep");
        expect(err).toContain('warn: Duplicate key "no-deps" in object literal');
        expect(await file(manifestPath).json()).toEqual({
          ...manifest,
          dependencies: { "no-deps": "1.0.0", "a-dep": "^1.0.10" },
        });
        await expectInstalled(packageDir);
        const saved = await file(lockfilePath).text();
        expect(saved).toContain('"a-dep": ["a-dep@1.0.10"');
        expect(saved.match(line)).toHaveLength(1);
      });
    },
  );

  it("bun install sees a dependency written into package.json by hand", async () => {
    const { packageDir, manifestPath, manifest, lockfilePath, repeated } = await projectWithRepeatedLine("");
    await write(
      manifestPath,
      JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, "a-dep": "1.0.10" } }),
    );

    expect(await exec(packageDir, packageDir, "install", "--frozen-lockfile")).toMatchObject({
      err: expect.stringContaining("error: lockfile had changes, but lockfile is frozen"),
      code: 1,
    });
    expect(await file(lockfilePath).text()).toBe(repeated);

    await run(packageDir, packageDir, "install");
    await expectInstalled(packageDir);
    expect(await file(lockfilePath).text()).toContain('"a-dep": ["a-dep@1.0.10"');
  });

  describe.each(["bun.lock", "bun.lockb"] as const)(
    "%s that bun saved while package.json repeated the line",
    lockfile => {
      it("bun add installs the new dependency", async () => {
        const { packageDir, packageJson } = await registry.createTestDir({
          bunfigOpts: { saveTextLockfile: lockfile === "bun.lock", linker: "hoisted" },
        });
        await write(packageJson, `{ "name": "foo", "dependencies": { "no-deps": "1.0.0", "no-deps": "1.0.0" } }`);
        const { err } = await run(packageDir, packageDir, "install");
        expect(err).toContain('warn: Duplicate dependency: "no-deps" specified in package.json');
        expect(await exists(join(packageDir, lockfile))).toBeTrue();

        // Any tool that reads package.json with JSON.parse writes the key back once.
        await write(packageJson, JSON.stringify(await file(packageJson).json()));
        await run(packageDir, packageDir, "add", "a-dep");
        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: { "no-deps": "1.0.0", "a-dep": "^1.0.10" },
        });
        await expectInstalled(packageDir);
      });
    },
  );
});

it.concurrent("a workspace that bun.lock lists twice is one workspace", async () => {
  const { packageDir } = await registry.createTestDir({
    files: {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
      "packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0", dependencies: { a: "workspace:*" } }),
    },
  });
  await runBunInstall(env, packageDir);
  const lockfilePath = join(packageDir, "bun.lock");
  const block = /^    "packages\/a": \{\n(?:      .*\n)*    \},\n/m;
  const twice = (await file(lockfilePath).text()).replace(block, member => member + member);
  expect(twice.match(/"packages\/a": \{/g)).toHaveLength(2);
  await write(lockfilePath, twice);

  await using proc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toContain('warn: Duplicate key "packages/a" in object literal');
  expect(err).not.toContain("error:");
  expect(out).toContain("(no changes)");
  expect(await file(lockfilePath).text()).toBe(twice);
  expect(exitCode).toBe(0);
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
// The workspace's new bin is what separates this from a no-op install: it makes this
// project's package.json diff not empty, and it is not a dependency, so a frozen
// install accepts it.
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
    write(
      join(packageDir, "packages", "pkg", "package.json"),
      JSON.stringify({ name: "pkg", version: "1.0.0", bin: "./cli.js", scripts: { postinstall: "exit 0" } }),
    ),
    rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
  ]);

  await run(["install", "--frozen-lockfile", "--ignore-scripts"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(stale);
  expect(await exists(join(packageDir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

// Same entries, but the install that re-resolves and saves: a package.json change
// unrelated to them (here a dependency bun.lock already has) must not prune them
// either. Only a package whose real dependent leaves is dropped (the tests above).
it("an install that resolves again keeps the packages that an older lockfile only has through optional peers", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
  });
  const run = makeInstallRunner(packageDir);
  const noDepsEntry = '"no-deps": ["no-deps@1.0.0"';
  const locked = { "optional-peer-deps": "1.0.0", "uses-a-dep-1": "1.0.0" };
  await Promise.all([
    // a-dep is already in bun.lock through uses-a-dep-1, so nothing resolves differently.
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { ...locked, "a-dep": "1.0.1" } })),
    write(
      join(packageDir, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "foo", dependencies: locked } },
        packages: {
          "a-dep": ["a-dep@1.0.1", "", {}, ""],
          // only optional-peer-deps's optional peer refers to this entry
          "no-deps": ["no-deps@1.0.0", "", {}, ""],
          "optional-peer-deps": [
            "optional-peer-deps@1.0.0",
            "",
            { peerDependencies: { "no-deps": "*" }, optionalPeers: ["no-deps"] },
            "",
          ],
          "uses-a-dep-1": ["uses-a-dep-1@1.0.0", "", { dependencies: { "a-dep": "1.0.1" } }, ""],
        },
      }),
    ),
  ]);

  await run(["install"]);
  const saved = await file(join(packageDir, "bun.lock")).text();
  expect(saved).toContain('"a-dep": "1.0.1"');
  expect(saved).toContain(noDepsEntry);
  expect(await exists(join(packageDir, "node_modules", "no-deps", "package.json"))).toBeTrue();

  await run(["install", "--frozen-lockfile"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(saved);
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

// When no version in the lockfile satisfies a required peer's range, the resolver binds the
// edge to whichever version it saw first and later installs keep that binding, so the only
// record of it is the tree: the version is printed next to the dependent when it conflicts
// with the version hoisted above, and otherwise the edge was deduped onto the hoisted one.
// Loading has to read that record. Picking the highest version in the file instead moved
// the edge whenever the file held another out-of-range version, and the re-save then
// printed a different tree: the recorded copy dropped, or a new nested copy added. These
// shapes are what a lockfile looks like once the package that provided the version the
// peer was first bound to has left the project. The record only holds while nothing in the
// file satisfies the range: once a satisfying version enters the file, loading binds the peer
// to it by version (as a fresh install would) and the next save drops the recorded copy.
describe("loading bun.lock keeps a peer that no version in the file satisfies on the version that the file records", () => {
  const pkg = (nameAndVersion: string, info: object = {}) => [nameAndVersion, "", info, ""];
  const oneDep = pkg("one-dep@1.0.0", { dependencies: { "no-deps": "1.0.1" } });
  const strictPeerDep = pkg("strict-peer-dep@1.0.0", { peerDependencies: { "no-deps": "^2.0.0" } });

  type Shape = {
    root: Record<string, unknown>;
    workspaces?: Record<string, Record<string, unknown>>;
    packages: Record<string, unknown[]>;
    saved: string[];
    absent?: string[];
    /** Set when the shape names packages the test registry does not have, so only `--lockfile-only` can run. */
    unpublished?: true;
  };

  const shapes: [string, Shape][] = [
    [
      "a package's peer on the copy printed next to it",
      {
        root: { dependencies: { "one-dep": "1.0.0", "strict-peer-dep": "1.0.0" } },
        packages: {
          "no-deps": pkg("no-deps@1.0.1"),
          "one-dep": oneDep,
          "strict-peer-dep": strictPeerDep,
          "strict-peer-dep/no-deps": pkg("no-deps@1.0.0"),
        },
        saved: ['"no-deps": ["no-deps@1.0.1"', '"strict-peer-dep/no-deps": ["no-deps@1.0.0"'],
      },
    ],
    [
      "a package's peer on the copy hoisted above it",
      {
        // one-dep is a devDependency so that its no-deps@1.0.1 is hoisted first and holds the
        // root slot; the higher 1.1.0 is nested, and the peer was deduped onto the root copy.
        root: {
          devDependencies: { "one-dep": "1.0.0" },
          dependencies: { "normal-dep-and-dev-dep": "1.0.1", "strict-peer-dep": "1.0.0" },
        },
        packages: {
          "no-deps": pkg("no-deps@1.0.1"),
          "normal-dep-and-dev-dep": pkg("normal-dep-and-dev-dep@1.0.1", { dependencies: { "no-deps": "1.1.0" } }),
          "normal-dep-and-dev-dep/no-deps": pkg("no-deps@1.1.0"),
          "one-dep": oneDep,
          "strict-peer-dep": strictPeerDep,
        },
        saved: ['"no-deps": ["no-deps@1.0.1"', '"normal-dep-and-dev-dep/no-deps": ["no-deps@1.1.0"'],
        absent: ['"strict-peer-dep/no-deps"'],
      },
    ],
    [
      "a workspace's peer on the copy printed next to it",
      {
        // workspace `a` is hoisted before `w`, so its no-deps holds the root slot
        root: { workspaces: ["packages/*"] },
        workspaces: {
          "packages/a": { name: "a", version: "1.0.0", dependencies: { "no-deps": "1.0.1" } },
          "packages/w": { name: "w", version: "1.0.0", peerDependencies: { "no-deps": "^2.0.0" } },
        },
        packages: {
          "a": ["a@workspace:packages/a"],
          "w": ["w@workspace:packages/w"],
          "no-deps": pkg("no-deps@1.0.1"),
          "w/no-deps": pkg("no-deps@1.0.0"),
        },
        saved: ['"no-deps": ["no-deps@1.0.1"', '"w/no-deps": ["no-deps@1.0.0"'],
      },
    ],
    [
      "the root's own peer on the copy at the root",
      {
        root: { dependencies: { "one-dep": "1.0.0" }, peerDependencies: { "no-deps": "^2.0.0" } },
        packages: {
          "no-deps": pkg("no-deps@1.0.0"),
          "one-dep": oneDep,
          "one-dep/no-deps": pkg("no-deps@1.0.1"),
        },
        saved: ['"no-deps": ["no-deps@1.0.0"', '"one-dep/no-deps": ["no-deps@1.0.1"'],
      },
    ],
    [
      "a package printed at two paths on the copy printed next to its last path",
      {
        // dup@1.0.0 is printed under both parents because the root holds dup@2.0.0. Its peer's
        // copy is printed under z-parent/dup only: under a-parent/dup it was deduped onto the
        // root's own no-deps, which root dependencies do regardless of range. The loader binds
        // the package's edges once per printed path and the last path wins, so the record is
        // read back here because z-parent sorts after a-parent; were the parents named the
        // other way round, the root's copy would win and the next save would rewrite the entry to it.
        root: {
          dependencies: { "a-parent": "1.0.0", "dup": "2.0.0", "no-deps": "1.0.1", "z-parent": "1.0.0" },
        },
        packages: {
          "a-parent": pkg("a-parent@1.0.0", { dependencies: { dup: "1.0.0" } }),
          "dup": pkg("dup@2.0.0"),
          "no-deps": pkg("no-deps@1.0.1"),
          "z-parent": pkg("z-parent@1.0.0", { dependencies: { "dup": "1.0.0", "no-deps": "1.1.0" } }),
          "a-parent/dup": pkg("dup@1.0.0", { peerDependencies: { "no-deps": "^2.0.0" } }),
          "z-parent/dup": pkg("dup@1.0.0", { peerDependencies: { "no-deps": "^2.0.0" } }),
          "z-parent/no-deps": pkg("no-deps@1.1.0"),
          "z-parent/dup/no-deps": pkg("no-deps@1.0.0"),
        },
        saved: ['"z-parent/dup/no-deps": ["no-deps@1.0.0"'],
        absent: ['"a-parent/dup/no-deps"'],
        unpublished: true,
      },
    ],
  ];

  async function writeProject(packageDir: string, shape: Pick<Shape, "root" | "workspaces" | "packages">) {
    await write(join(packageDir, "package.json"), JSON.stringify({ name: "foo", ...shape.root }));
    for (const [path, manifest] of Object.entries(shape.workspaces ?? {})) {
      await write(join(packageDir, path, "package.json"), JSON.stringify(manifest));
    }
    await write(
      join(packageDir, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        configVersion: 0,
        workspaces: { "": { name: "foo", ...shape.root, workspaces: undefined }, ...shape.workspaces },
        packages: shape.packages,
      }),
    );
  }

  // Re-saves the shape once, checks the entries it must and must not print, and checks that
  // the result is a fixed point: a further re-save leaves it alone and a frozen install accepts it.
  async function resave(shape: Shape) {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
    const run = makeInstallRunner(packageDir);
    await writeProject(packageDir, shape);

    await run(["install", "--lockfile-only"]);
    const saved = await file(join(packageDir, "bun.lock")).text();
    for (const entry of shape.saved) {
      expect(saved).toContain(entry);
    }
    for (const entry of shape.absent ?? []) {
      expect(saved).not.toContain(entry);
    }

    await run(["install", "--lockfile-only"]);
    if (!shape.unpublished) await run(["install", "--frozen-lockfile"]);
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(saved);
  }

  it.each(shapes)("re-saving keeps %s", (_, shape) => resave(shape));

  const [, nestedCopy] = shapes[0];

  it("re-saving rebinds the peer once a version satisfying its range enters the file", () =>
    resave({
      // The first shape after `bun add one-fixed-dep@2.0.0` brought in no-deps@2.0.0: the
      // recorded 1.0.0 is no longer the binding, so the re-save replaces it instead of keeping it.
      root: { dependencies: { ...(nestedCopy.root.dependencies as object), "one-fixed-dep": "2.0.0" } },
      packages: {
        ...nestedCopy.packages,
        "one-fixed-dep": pkg("one-fixed-dep@2.0.0", { dependencies: { "no-deps": "2.0.0" } }),
        "one-fixed-dep/no-deps": pkg("no-deps@2.0.0"),
      },
      saved: [
        '"no-deps": ["no-deps@1.0.1"',
        '"one-fixed-dep/no-deps": ["no-deps@2.0.0"',
        '"strict-peer-dep/no-deps": ["no-deps@2.0.0"',
      ],
      absent: ["no-deps@1.0.0"],
    }));

  it("a package's peer binds to the root's own out-of-range copy, not to the higher version nested elsewhere", async () => {
    // Nothing is printed for this edge: either binding dedupes onto the root's copy when the
    // tree is built, so the file is the same both ways and both linkers install the root's copy.
    // The binding itself is what `pm why` reports (and what a tree built without the root's
    // copy, such as `--production` when it is a devDependency, installs next to the dependent).
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
    await writeProject(packageDir, {
      root: { dependencies: { "no-deps": "1.0.0", "one-dep": "1.0.0", "strict-peer-dep": "1.0.0" } },
      packages: {
        "no-deps": pkg("no-deps@1.0.0"),
        "one-dep": oneDep,
        "one-dep/no-deps": pkg("no-deps@1.0.1"),
        "strict-peer-dep": strictPeerDep,
      },
    });

    const { out } = await makeInstallRunner(packageDir)(["pm", "why", "no-deps"]);
    expect(out).toMatchInlineSnapshot(`
      "no-deps@1.0.0
        ├─ foo (requires 1.0.0)
        └─ peer strict-peer-dep@1.0.0 (requires ^2.0.0)
           └─ foo (requires 1.0.0)

      no-deps@1.0.1
        └─ one-dep@1.0.0 (requires 1.0.1)
           └─ foo (requires 1.0.0)

      "
    `);
  });

  it("the hoisted linker installs the recorded copy next to the dependent", async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true, linker: "hoisted" } });
    const run = makeInstallRunner(packageDir);
    await writeProject(packageDir, nestedCopy);

    await run(["install", "--frozen-lockfile"]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
    expect(
      await file(join(packageDir, "node_modules", "strict-peer-dep", "node_modules", "no-deps", "package.json")).json(),
    ).toMatchObject({ version: "1.0.0" });
  });

  it("the isolated linker links the dependent against the recorded copy", async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true, linker: "isolated" } });
    const run = makeInstallRunner(packageDir);
    await writeProject(packageDir, nestedCopy);

    await run(["install", "--frozen-lockfile"]);
    const bunDir = join(packageDir, "node_modules", ".bun");
    const entries = (await readdirSorted(bunDir)).filter(entry => entry.startsWith("strict-peer-dep@"));
    expect(entries).toHaveLength(1);
    expect(await file(join(bunDir, entries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
  });

  // An out-of-range binding records what the dependent was given. It isn't a reason to keep that version: once the
  // dependency that really needed the version leaves package.json, the version is removed too.
  describe("after package.json changes", () => {
    const twoPeers = pkg("2-peer-deps-c@1.0.0", { peerDependencies: { "a-dep": "1.0.10", "no-deps": "1.0.0" } });
    const fixedDep = pkg("one-fixed-dep@2.0.0", { dependencies: { "no-deps": "2.0.0" } });
    const printed = (lockfile: string) =>
      Object.fromEntries(Array.from(lockfile.matchAll(/^ {4}"([^"]+)": \["([^"]+)"/gm), m => [m[1], m[2]]));

    // Loads `shape`, saves it for a package.json that now holds `root`, and checks that the result is a fixed point.
    async function resaveFor(
      root: Shape["root"],
      shape: Pick<Shape, "root" | "packages">,
      expected: Record<string, string>,
    ) {
      const { packageDir } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
      const run = makeInstallRunner(packageDir);
      await writeProject(packageDir, shape);
      await write(join(packageDir, "package.json"), JSON.stringify({ name: "foo", ...root }));

      await run(["install", "--lockfile-only"]);
      const saved = await file(join(packageDir, "bun.lock")).text();
      expect(printed(saved)).toEqual(expected);

      await run(["install", "--lockfile-only"]);
      await run(["install", "--frozen-lockfile"]);
      expect(await file(join(packageDir, "bun.lock")).text()).toBe(saved);
    }

    // The dependent is placed before or after one-fixed-dep, which is what places no-deps@2.0.0.
    it.each([
      ["2-peer-deps-c", "1.0.0"],
      ["z-two-peers", "npm:2-peer-deps-c@1.0.0"],
    ])("the peer of %s does not keep the root's version once the root drops it", async (name, spec) => {
      const dependencies = { [name]: spec, "one-fixed-dep": "2.0.0" };
      await resaveFor(
        { dependencies },
        {
          root: { dependencies, devDependencies: { "no-deps": "~1.1.0" } },
          packages: {
            [name]: twoPeers,
            "a-dep": pkg("a-dep@1.0.10"),
            "no-deps": pkg("no-deps@1.1.0"),
            "one-fixed-dep": fixedDep,
            "one-fixed-dep/no-deps": pkg("no-deps@2.0.0"),
          },
        },
        {
          [name]: "2-peer-deps-c@1.0.0",
          "a-dep": "a-dep@1.0.10",
          "no-deps": "no-deps@2.0.0",
          "one-fixed-dep": "one-fixed-dep@2.0.0",
        },
      );
    });

    it("the peer keeps the root's version while the root keeps it", async () => {
      const root = {
        dependencies: { "2-peer-deps-c": "1.0.0", "one-fixed-dep": "2.0.0" },
        devDependencies: { "no-deps": "~1.1.0" },
      };
      await resaveFor(
        { ...root, dependencies: { ...root.dependencies, "one-dep": "1.0.0" } },
        {
          root,
          packages: {
            "2-peer-deps-c": twoPeers,
            "a-dep": pkg("a-dep@1.0.10"),
            "no-deps": pkg("no-deps@1.1.0"),
            "one-fixed-dep": fixedDep,
            "one-fixed-dep/no-deps": pkg("no-deps@2.0.0"),
          },
        },
        {
          "2-peer-deps-c": "2-peer-deps-c@1.0.0",
          "a-dep": "a-dep@1.0.10",
          "no-deps": "no-deps@1.1.0",
          "one-dep": "one-dep@1.0.0",
          "one-fixed-dep": "one-fixed-dep@2.0.0",
          "one-dep/no-deps": "no-deps@1.0.1",
          "one-fixed-dep/no-deps": "no-deps@2.0.0",
        },
      );
    });

    it("the peer keeps a version that nothing else used when the file was loaded", async () => {
      const dependencies = { "one-dep": "1.0.0", "strict-peer-dep": "1.0.0" };
      await resaveFor(
        { dependencies: { ...dependencies, "a-dep": "1.0.1" } },
        {
          root: { dependencies },
          packages: {
            "no-deps": pkg("no-deps@1.0.1"),
            "one-dep": oneDep,
            "strict-peer-dep": strictPeerDep,
            "strict-peer-dep/no-deps": pkg("no-deps@1.1.0"),
          },
        },
        {
          "a-dep": "a-dep@1.0.1",
          "no-deps": "no-deps@1.0.1",
          "one-dep": "one-dep@1.0.0",
          "strict-peer-dep": "strict-peer-dep@1.0.0",
          "strict-peer-dep/no-deps": "no-deps@1.1.0",
        },
      );
    });

    // Nothing ever resolves an unbound peer again, so dropping the only copy would leave the dependent without one for
    // good.
    it("the peer keeps the root's version once the root drops it if no other version is left", async () => {
      const dependencies = { "2-peer-deps-c": "1.0.0" };
      await resaveFor(
        { dependencies },
        {
          root: { dependencies, devDependencies: { "no-deps": "~1.1.0" } },
          packages: { "2-peer-deps-c": twoPeers, "a-dep": pkg("a-dep@1.0.10"), "no-deps": pkg("no-deps@1.1.0") },
        },
        { "2-peer-deps-c": "2-peer-deps-c@1.0.0", "a-dep": "a-dep@1.0.10", "no-deps": "no-deps@1.1.0" },
      );
    });
  });
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

  function cacheDir(cwd: string) {
    return join(cwd, ".bun-cache");
  }

  // How many manifests the project's installs have written to its cache. The
  // entries are written by a thread pool task that bun install does not wait
  // for before exiting (`save_async` in src/install/npm.rs), so the last
  // manifest an install fetches is occasionally missing. An install that has
  // to fetch it again writes it again.
  function cachedManifests(cwd: string) {
    return Array.from(new Bun.Glob("*.npm").scanSync(cacheDir(cwd))).length;
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

    // The resolve below needs both manifests cached. peer-target's was the last
    // thing the first install fetched, and nothing was left to do after it, so
    // its entry is the one that is occasionally missing (see cachedManifests);
    // resolving without the lockfile fetches and writes it again.
    for (let retries = 5; retries > 0 && cachedManifests(String(dir)) < 2; retries--) {
      await rm(lockfilePath);
      await installWithOwnCache(String(dir));
    }
    expect(cachedManifests(String(dir))).toBe(2);

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

// The install that writes bun.lock leaves such a dependency unresolved. plugin@3.0.0 is in the
// tree for mid's peer only, and loading bun.lock used to hand it to the optional dependency too.
describe.each(["hoisted", "isolated"] as const)(
  "optional dependency no published version satisfies, with another version in the tree (%s linker)",
  linker => {
    const manifests: Manifests = {
      lib: { "2.0.0": {}, "3.0.0": {} },
      plugin: { "3.0.0": { peerDependencies: { lib: "^2.0.0" } } },
      mid: { "1.0.0": { peerDependencies: { plugin: "^3.0.0" } } },
      wrap: { "1.0.0": { dependencies: { mid: "1.0.0" } } },
      host: {
        "1.0.0": { dependencies: { wrap: "1.0.0", lib: "^2.0.0" }, optionalDependencies: { plugin: "~1.0.0" } },
      },
    };

    const declaredBy = {
      "a registry package": {
        "package.json": JSON.stringify({ name: "app", dependencies: { lib: "^3.0.0", host: "1.0.0" } }),
      },
      "a workspace": {
        "package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"], dependencies: { lib: "^3.0.0" } }),
        "packages/ws/package.json": JSON.stringify({ name: "ws", ...manifests.host["1.0.0"] }),
      },
      "the root package": {
        "package.json": JSON.stringify({ name: "app", ...manifests.host["1.0.0"] }),
      },
    };

    it.concurrent.each(Object.keys(declaredBy) as (keyof typeof declaredBy)[])("declared by %s", async declarer => {
      using registry = await serveRegistry(manifests);
      using dir = tempDir("unmet-optional-", {
        ...declaredBy[declarer],
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
      });
      const lockfilePath = join(String(dir), "bun.lock");
      const installed = () =>
        Array.from(
          new Bun.Glob("**/node_modules/*").scanSync({ cwd: String(dir), onlyFiles: false, dot: true }),
        ).toSorted();

      await installWithOwnCache(String(dir));
      const lockfile = await file(lockfilePath).text();
      const fresh = installed();
      expect(fresh.filter(path => path.endsWith("plugin"))).not.toBeEmpty();

      const { out } = await installWithOwnCache(String(dir));
      expect(installed()).toEqual(fresh);
      expect(out).toContain("(no changes)");

      await installWithOwnCache(String(dir), "--lockfile-only");
      expect(await file(lockfilePath).text()).toBe(lockfile);
    });
  },
);

// Handed the root's x@1.2.0 on load, x@2.0.0 nested a copy of it that hid x@2.0.0 from the peer of
// the y@3.0.0 below, so the two nested inside each other without end and bun.lock was refused.
it.concurrent(
  "bun.lock loads back when two packages that peer on each other have an unmet optional dependency",
  async () => {
    using registry = await serveRegistry({
      x: { "1.2.0": {}, "2.0.0": { optionalDependencies: { x: "~1.0.0" }, peerDependencies: { y: "~2.1.0" } } },
      y: {
        "1.0.0": {},
        "1.1.0": { dependencies: { y: "latest" } },
        "3.0.0": { peerDependencies: { x: "^3.0.0", y: "1.0.0" } },
      },
      app: { "1.0.0": { dependencies: { x: "^1.1.0", y1: "npm:y@~1.1.0", x2: "npm:x@latest" } } },
    });
    using dir = tempDir("unmet-optional-peer-cycle-", {
      "package.json": JSON.stringify({ name: "root", dependencies: { y: "~1.0.0", app: "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url } }),
    });
    const lockfilePath = join(String(dir), "bun.lock");

    await installWithOwnCache(String(dir));
    const lockfile = await file(lockfilePath).text();

    const { out } = await installWithOwnCache(String(dir));
    expect(out).toContain("(no changes)");

    await installWithOwnCache(String(dir), "--frozen-lockfile");
    expect(await file(lockfilePath).text()).toBe(lockfile);
  },
);

// p2@2.1.0 is in bun.lock for p1 only, and the root's own range refuses it.
it.concurrent("the isolated linker never links an unmet optional dependency of the root", async () => {
  using registry = await serveRegistry({
    p1: { "1.0.0": { dependencies: { p2: "^2.0.0" } } },
    p2: { "2.1.0": {} },
  });
  using dir = tempDir("unmet-optional-root-link-", {
    "package.json": JSON.stringify({
      name: "root",
      dependencies: { p1: "1.0.0" },
      optionalDependencies: { p2: "^1.0.0" },
    }),
    "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker: "isolated" } }),
  });
  const nodeModules = join(String(dir), "node_modules");

  await installWithOwnCache(String(dir));
  expect(await readdirSorted(nodeModules)).toEqual([".bun", "p1"]);

  await installWithOwnCache(String(dir));
  expect(await readdirSorted(nodeModules)).toEqual([".bun", "p1"]);

  await rm(nodeModules, { recursive: true });
  await installWithOwnCache(String(dir), "--frozen-lockfile");
  expect(await readdirSorted(nodeModules)).toEqual([".bun", "p1"]);
});

// On load, host was given the root's plugin@2.0.0. It then got its own copy, because plugin's peer resolves to a
// different lib under host than at the root, and the next save printed that copy as "host/plugin".
it.concurrent.each(["hoisted", "isolated"] as const)(
  "an unmet optional dependency gets no copy of the version the root depends on (%s linker)",
  async linker => {
    using registry = await serveRegistry({
      lib: { "1.1.0": {}, "3.0.0": {} },
      plugin: { "2.0.0": { peerDependencies: { lib: "^1.0.0" } } },
      host: { "1.0.0": { dependencies: { lib: "^1.1.0" }, optionalDependencies: { plugin: "1.0.0" } } },
      extra: { "1.0.0": {} },
    });
    using dir = tempDir("unmet-optional-root-version-", {
      "package.json": JSON.stringify({ name: "app", dependencies: { host: "1.0.0", lib: "3.0.0", plugin: "2.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });
    const lockfilePath = join(String(dir), "bun.lock");
    const installed = () =>
      Array.from(
        new Bun.Glob("**/node_modules/*").scanSync({ cwd: String(dir), onlyFiles: false, dot: true }),
      ).toSorted();

    await installWithOwnCache(String(dir));
    const lockfile = await file(lockfilePath).text();
    const fresh = installed();
    expect(lockfile).not.toContain('"host/plugin"');

    await installWithOwnCache(String(dir));
    expect(installed()).toEqual(fresh);

    await installWithOwnCache(String(dir), "--lockfile-only");
    expect(await file(lockfilePath).text()).toBe(lockfile);

    await installWithOwnCache(String(dir), "extra@1.0.0");
    expect(await file(lockfilePath).text()).not.toContain('"host/plugin"');
  },
);

// `*` takes the version `latest` points at, though no range is satisfied by a prerelease.
it.concurrent.each(["hoisted", "isolated"] as const)(
  "an optional dependency on * keeps the prerelease that latest points at (%s linker)",
  async linker => {
    using registry = await serveRegistry({ foo: { "1.0.0-beta.1": {} } });
    using dir = tempDir("optional-star-prerelease-", {
      "package.json": JSON.stringify({ name: "root", optionalDependencies: { foo: "*" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });
    const installedVersion = async () =>
      (await file(join(String(dir), "node_modules/foo/package.json")).json()).version;

    await installWithOwnCache(String(dir));
    expect(await installedVersion()).toBe("1.0.0-beta.1");

    await rm(join(String(dir), "node_modules"), { recursive: true });
    await installWithOwnCache(String(dir), "--frozen-lockfile");
    expect(await installedVersion()).toBe("1.0.0-beta.1");
  },
);

// Only the registry can resolve a range, so the install that writes bun.lock leaves this one unresolved. Loading
// bun.lock used to bind it to the root's package with that name. That gave a second copy of a folder, which never
// hoists, or (with the isolated linker) a link that the first install didn't create.
describe.each(["hoisted", "isolated"] as const)(
  "optional dependency the registry does not have, with a local package of that name at the root (%s linker)",
  linker => {
    const local = { "a folder": "file:vendor/local", "a tarball": "file:vendor/local-1.0.0.tgz" };
    const dependent = JSON.stringify({ name: "dependent", version: "1.0.0", optionalDependencies: { local: "*" } });
    const declaredBy = {
      "a folder": {
        "package.json": { name: "app", dependencies: { dependent: "file:vendor/dependent" } },
        "vendor/dependent/package.json": dependent,
      },
      "a workspace": {
        "package.json": { name: "app", workspaces: ["packages/*"], dependencies: {} },
        "packages/dependent/package.json": dependent,
      },
    };

    it.concurrent.each([
      ["a folder", "a folder"],
      ["a folder", "a workspace"],
      ["a tarball", "a folder"],
      ["a tarball", "a workspace"],
    ] as const)("%s, declared by %s", async (kind, declarer) => {
      using registry = await serveRegistry({});
      const localPackageJson = JSON.stringify({ name: "local", version: "1.0.0" });
      const tarball = new Bun.Archive({ "package/package.json": localPackageJson }, { compress: "gzip" });
      const { "package.json": root, ...files } = declaredBy[declarer];
      using dir = tempDir("optional-range-local-package-", {
        ...files,
        "package.json": JSON.stringify({ ...root, dependencies: { ...root.dependencies, local: local[kind] } }),
        "vendor/local/package.json": localPackageJson,
        "vendor/local-1.0.0.tgz": Buffer.from(await tarball.bytes()),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
      });
      const lockfilePath = join(String(dir), "bun.lock");
      const installed = () =>
        Array.from(
          new Bun.Glob("**/node_modules/*").scanSync({ cwd: String(dir), onlyFiles: false, dot: true }),
        ).toSorted();

      await installWithOwnCache(String(dir));
      expect(registry.requests).toEqual(["/local"]);
      const lockfile = await file(lockfilePath).text();
      const fresh = installed();
      expect(fresh.filter(path => path.endsWith("local"))).not.toBeEmpty();

      await installWithOwnCache(String(dir), "--frozen-lockfile");
      expect(installed()).toEqual(fresh);

      await installWithOwnCache(String(dir), "--lockfile-only");
      expect(await file(lockfilePath).text()).toBe(lockfile);
    });
  },
);

// npm lets the root's folder answer the range. The migration keeps that, and a folder never hoists,
// so bun.lock has a row for the dependent's own copy.
it.concurrent.each(["hoisted", "isolated"] as const)(
  "an optional dependency keeps the folder bun.lock prints under its dependent (%s linker)",
  async linker => {
    using registry = await serveRegistry({});
    const dependencies = { local: "file:vendor/local", dependent: "file:vendor/dependent" };
    const dependent = { version: "1.0.0", optionalDependencies: { local: "*" } };
    using dir = tempDir("optional-range-own-folder-row-", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies }),
      "vendor/local/package.json": JSON.stringify({ name: "local", version: "1.0.0" }),
      "vendor/dependent/package.json": JSON.stringify({ name: "dependent", ...dependent }),
      "package-lock.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "app", version: "1.0.0", dependencies },
          "node_modules/dependent": { resolved: "vendor/dependent", link: true },
          "node_modules/local": { resolved: "vendor/local", link: true },
          "vendor/dependent": dependent,
          "vendor/local": { version: "1.0.0" },
        },
      }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });
    const installed = () =>
      Array.from(
        new Bun.Glob("**/node_modules/*").scanSync({ cwd: String(dir), onlyFiles: false, dot: true }),
      ).toSorted();

    await installWithOwnCache(String(dir));
    expect(await file(join(String(dir), "bun.lock")).text()).toContain('"dependent/local": ["local@file:vendor/local"');
    const migrated = installed();

    await rm(join(String(dir), "node_modules"), { recursive: true });
    await installWithOwnCache(String(dir), "--frozen-lockfile");
    expect(installed()).toEqual(migrated);
  },
);

describe.each(["hoisted", "isolated"] as const)("optional dependencies of every kind (%s linker)", linker => {
  const packageJson = (name: string, version: string) => JSON.stringify({ name, version });
  const tarball = async (name: string, version: string) =>
    Buffer.from(
      await new Bun.Archive({ "package/package.json": packageJson(name, version) }, { compress: "gzip" }).bytes(),
    );
  const installedIn = (dir: string) =>
    Array.from(new Bun.Glob("**/node_modules/*").scanSync({ cwd: dir, onlyFiles: false, dot: true }), path =>
      path.replaceAll("\\", "/"),
    ).toSorted();

  // Each of these has the name of a package that is in bun.lock for someone else:
  // `<who has the name>-<how the row asks>`. bun.lock lists them as "unresolved".
  it.concurrent("one that doesn't resolve isn't bound to the package with the same name", async () => {
    const kinds = ["range", "alias", "catalog", "tarball", "url", "folder", "link", "workspace", "tag"] as const;
    const named = (holder: string) => kinds.map(kind => `${holder}-${kind}`);
    const each = <T>(names: string[], value: (name: string) => T) =>
      Object.fromEntries(names.map(name => [name, value(name)]));

    using registry = await serveRegistry({
      other: { "1.0.0": {} },
      brings: { "1.0.0": { dependencies: each(named("registry"), () => "^2.0.0") } },
      ...each(named("registry"), () => ({ "2.0.0": {} })),
    });
    const unresolvable = {
      range: "^1.0.0",
      alias: "npm:other@^2.0.0",
      catalog: "catalog:",
      tarball: "file:./missing.tgz",
      url: `${registry.url}missing.tgz`,
      folder: "file:./missing",
      link: "link:./missing",
      workspace: "workspace:*",
      tag: "missing-tag",
    };
    const rows = (...holders: string[]) =>
      Object.fromEntries(holders.flatMap(holder => kinds.map(kind => [`${holder}-${kind}`, unresolvable[kind]])));
    const holders = ["registry", "folder", "tarball", "member"];

    using dir = tempDir("unresolved-optional-kinds-", {
      "package.json": JSON.stringify({
        name: "app",
        workspaces: {
          packages: ["packages/*"],
          catalog: each(
            holders.map(holder => `${holder}-catalog`),
            () => "^1.0.0",
          ),
        },
        dependencies: {
          brings: "1.0.0",
          ...each(named("folder"), name => `file:./vendor/${name}`),
          ...each(named("tarball"), name => `file:./vendor/${name}.tgz`),
        },
        optionalDependencies: rows("registry", "member"),
      }),
      "packages/declarer/package.json": JSON.stringify({ name: "declarer", optionalDependencies: rows(...holders) }),
      ...Object.fromEntries(named("member").map(name => [`packages/${name}/package.json`, packageJson(name, "2.0.0")])),
      ...Object.fromEntries(named("folder").map(name => [`vendor/${name}/package.json`, packageJson(name, "2.0.0")])),
      ...Object.fromEntries(
        await Promise.all(named("tarball").map(async name => [`vendor/${name}.tgz`, await tarball(name, "2.0.0")])),
      ),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });
    const lockfilePath = join(String(dir), "bun.lock");

    await installWithOwnCache(String(dir));
    const lockfile = await file(lockfilePath).text();
    const fresh = installedIn(String(dir));
    expect(fresh).toContain("node_modules/brings");
    expect(lockfile).toContain('"unresolved": [');

    await installWithOwnCache(String(dir), "--frozen-lockfile");
    expect(installedIn(String(dir))).toEqual(fresh);

    await installWithOwnCache(String(dir), "--lockfile-only");
    expect(await file(lockfilePath).text()).toBe(lockfile);
  });

  // Up to Bun 1.4 the yarn.lock migration wrote a registry package whose `resolved` ends in .tgz this way.
  it.concurrent("one that an older bun.lock has as a tarball entry is installed and kept", async () => {
    using registry = await serveRegistry({
      tool: { "1.0.0": { optionalDependencies: { "tool-native": "1.0.0" } } },
      "tool-native": { "1.0.0": {} },
      other: { "1.0.0": {} },
    });
    const entry = async (name: string, info: string) => {
      const url = `${registry.url}${name}-1.0.0.tgz`;
      const integrity = new Bun.CryptoHasher("sha512").update(await (await fetch(url)).bytes()).digest("base64");
      return `    "${name}": ["${name}@${url}", ${info}, "sha512-${integrity}"],\n`;
    };
    using dir = tempDir("optional-older-tarball-entry-", {
      "package.json": JSON.stringify({ name: "app", dependencies: { tool: "^1.0.0" } }),
      "bun.lock": `{
  "lockfileVersion": 2,
  "configVersion": 0,
  "workspaces": {
    "": {
      "name": "app",
      "dependencies": {
        "tool": "^1.0.0",
      },
    },
  },
  "packages": {
${await entry("tool", '{ "optionalDependencies": { "tool-native": "1.0.0" } }')}
${await entry("tool-native", "{}")}  }
}
`,
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });

    await installWithOwnCache(String(dir), "--frozen-lockfile");
    expect(installedIn(String(dir)).filter(path => path.endsWith("/tool-native"))).not.toBeEmpty();

    await installWithOwnCache(String(dir), "other@1.0.0");
    expect(await file(join(String(dir), "bun.lock")).text()).toContain('"tool-native": ["tool-native@');
  });

  // A trusted name that is not installed makes every plain install write bun.lock again.
  it.concurrent("a plain install does not add the list to an older bun.lock", async () => {
    using registry = await serveRegistry({
      a: { "1.0.0": { optionalDependencies: { b: "^2.0.0" } } },
      b: { "1.0.0": {} },
    });
    using dir = tempDir("optional-older-lockfile-bytes-", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { a: "^1.0.0", b: "^1.0.0" },
        trustedDependencies: ["a", "gone"],
      }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });
    const lockfilePath = join(String(dir), "bun.lock");

    await installWithOwnCache(String(dir));
    const lockfile = await file(lockfilePath).text();
    expect(lockfile).toContain(', "unresolved": ["b"]');
    const older = lockfile.replace(', "unresolved": ["b"]', "");
    await write(lockfilePath, older);

    await installWithOwnCache(String(dir), "--frozen-lockfile");
    await installWithOwnCache(String(dir));
    expect(await file(lockfilePath).text()).toBe(older);
  });

  // `gone` needs no entry. No package has its name, so loading can't bind it to anything.
  it.concurrent("bun.lock lists the ones that don't resolve where they're declared", async () => {
    using registry = await serveRegistry({
      host: { "1.0.0": { optionalDependencies: { gone: "^1.0.0", p2: "missing-tag" } } },
      p1: { "1.0.0": { dependencies: { p2: "^2.0.0" } } },
      p2: { "2.1.0": {} },
    });
    const root = (p2: string) =>
      JSON.stringify({
        name: "root",
        dependencies: { host: "1.0.0", p1: "1.0.0" },
        optionalDependencies: { gone: "*", p2 },
      });
    using dir = tempDir("unresolved-optional-list-", {
      "package.json": root("missing-tag"),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });
    const lockfilePath = join(String(dir), "bun.lock");
    const listedByHost = '"optionalDependencies": { "gone": "^1.0.0", "p2": "missing-tag" }, "unresolved": ["p2"] }';

    await installWithOwnCache(String(dir));
    const lockfile = await file(lockfilePath).text();
    expect(lockfile).toContain(
      `      "optionalDependencies": {
        "gone": "*",
        "p2": "missing-tag",
      },
      "unresolved": [
        "p2",
      ],
    },`,
    );
    expect(lockfile).toContain(listedByHost);

    // Only an optional dependency can be left out.
    const needsP2 = '{ "dependencies": { "p2": "^2.0.0" } }';
    expect(lockfile).toContain(needsP2);
    await write(lockfilePath, lockfile.replace(needsP2, needsP2.replace(" }", ' }, "unresolved": ["p2"]')));
    await rm(join(String(dir), "node_modules"), { recursive: true });
    await installWithOwnCache(String(dir), "--frozen-lockfile");
    expect(installedIn(String(dir)).filter(path => path.endsWith("/p2"))).not.toBeEmpty();

    await write(join(String(dir), "package.json"), root("^2.0.0"));
    await installWithOwnCache(String(dir));
    expect(installedIn(String(dir))).toContain("node_modules/p2");
    const [workspaces, packages] = (await file(lockfilePath).text()).split('"packages": {');
    expect(workspaces).not.toContain('"unresolved"');
    expect(packages).toContain(listedByHost);
  });

  it.concurrent("one that resolves is installed again from bun.lock", async () => {
    using registry = await serveRegistry({ real: { "2.0.0": {} }, tagged: { "2.0.0": {} } });
    const optionalDependencies = {
      alias: "npm:real@^2.0.0",
      cataloged: "catalog:",
      tagged: "latest",
      tarball: "file:./vendor/tarball.tgz",
      url: `${registry.url}real-2.0.0.tgz`,
      folder: "file:./vendor/folder",
      link: "link:./vendor/folder",
      member: "workspace:*",
      "linked-member": "^2.0.0",
    };
    using dir = tempDir("resolved-optional-kinds-", {
      "package.json": JSON.stringify({
        name: "app",
        workspaces: { packages: ["packages/*"], catalog: { cataloged: "npm:real@^2.0.0" } },
        optionalDependencies,
      }),
      "packages/declarer/package.json": JSON.stringify({ name: "declarer", optionalDependencies }),
      "packages/declarer/vendor/folder/package.json": packageJson("folder", "2.0.1"),
      "packages/member/package.json": packageJson("member", "2.0.0"),
      "packages/linked-member/package.json": packageJson("linked-member", "2.0.0"),
      "vendor/folder/package.json": packageJson("folder", "2.0.0"),
      "vendor/tarball.tgz": await tarball("tarball", "2.0.0"),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });

    await installWithOwnCache(String(dir));
    const fresh = installedIn(String(dir));
    for (const name of Object.keys(optionalDependencies)) {
      expect(fresh).toContain(`node_modules/${name}`);
    }
    expect(await file(join(String(dir), "bun.lock")).text()).not.toContain('"unresolved"');

    await rm(join(String(dir), "node_modules"), { recursive: true });
    await rm(join(String(dir), "packages/declarer/node_modules"), { recursive: true, force: true });
    await installWithOwnCache(String(dir), "--frozen-lockfile");
    expect(installedIn(String(dir))).toEqual(fresh);
  });

  // Like npm: the registry has no alpha, and beta@1.0.0 is in both ranges. A tag is always looked up in the registry.
  it.concurrent("a range uses the package that the project's npm: alias installed under its name", async () => {
    using registry = await serveRegistry({
      beta: { "1.0.0": {} },
      ranged: { "1.0.0": { optionalDependencies: { alpha: "*" } } },
      tagged: { "1.0.0": { optionalDependencies: { alpha: "latest" } } },
    });
    using dir = tempDir("optional-range-takes-alias-", {
      "package.json": JSON.stringify({
        name: "app",
        workspaces: ["packages/*"],
        dependencies: { alpha: "npm:beta@1.0.0", ranged: "1.0.0", tagged: "1.0.0" },
      }),
      "packages/member/package.json": JSON.stringify({ name: "member", optionalDependencies: { alpha: "^1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });

    await installWithOwnCache(String(dir));
    const fresh = installedIn(String(dir));
    if (linker === "isolated") {
      expect(fresh.filter(path => path.endsWith("/alpha"))).toEqual([
        "node_modules/.bun/node_modules/alpha",
        "node_modules/.bun/ranged@1.0.0/node_modules/alpha",
        "node_modules/alpha",
        "packages/member/node_modules/alpha",
      ]);
    }

    await rm(join(String(dir), "node_modules"), { recursive: true });
    await rm(join(String(dir), "packages/member/node_modules"), { recursive: true, force: true });
    await installWithOwnCache(String(dir), "--frozen-lockfile");
    expect(installedIn(String(dir))).toEqual(fresh);
  });

  // Bound to p2@2.1.0 on load, the root's row kept it in bun.lock after the only package that needs it.
  it.concurrent.each([
    ["a range", "^1.0.0", "is removed"],
    ["a range", "^1.0.0", "is upgraded"],
    ["a tarball", "file:./missing.tgz", "is removed"],
    ["a tarball", "file:./missing.tgz", "is upgraded"],
  ])("one that asks for %s (%s) does not keep the package when what brought it %s", async (_, row, step) => {
    using registry = await serveRegistry({
      p1: { "1.0.0": { dependencies: { p2: "^2.0.0" } }, "2.0.0": {} },
      p2: { "2.1.0": {} },
    });
    const root = (dependencies: object) =>
      JSON.stringify({ name: "root", dependencies, optionalDependencies: { p2: row } });
    using dir = tempDir("unresolved-optional-outlives-", {
      "package.json": root({ p1: "1.0.0" }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
    });
    const lockfilePath = join(String(dir), "bun.lock");

    await installWithOwnCache(String(dir));
    expect(await file(lockfilePath).text()).toContain('"p2@2.1.0"');

    await write(join(String(dir), "package.json"), root(step === "is removed" ? {} : { p1: "2.0.0" }));
    await installWithOwnCache(String(dir));
    expect(await file(lockfilePath).text()).not.toContain('"p2@2.1.0"');
    expect(installedIn(String(dir))).not.toContain("node_modules/p2");
  });
});

// An optional peer isn't bound until the tree is built, which binds it to the copy found above the peer's package. The
// installer and every load of bun.lock build the tree with the peer already bound.
describe("the tree a fresh install saves is the tree built with its optional peers bound", () => {
  const optionalPeer = (name: string, range: string) => ({
    peerDependencies: { [name]: range },
    peerDependenciesMeta: { [name]: { optional: true } },
  });
  const installedIn = (cwd: string) =>
    Array.from(new Bun.Glob("**/node_modules/*").scanSync({ cwd, onlyFiles: false, dot: true })).toSorted();

  // plugin's own peer wants the lib@2.0.0 that host has, and the root's lib@1.1.0 hides it from the
  // root's plugin. So host's peer, once bound, gets a copy of plugin next to that lib@2.0.0.
  it.concurrent.each(["hoisted", "isolated"] as const)(
    "a copy next to the version its own peer wants (%s linker)",
    async linker => {
      using registry = await serveRegistry({
        lib: { "1.1.0": {}, "2.0.0": {} },
        plugin: { "1.0.0": { peerDependencies: { lib: "^2.0.0" } } },
        host: { "1.0.0": { dependencies: { lib: "^2.0.0" }, ...optionalPeer("plugin", "*") } },
      });
      using dir = tempDir("optional-peer-copy-next-to-peer-", {
        "package.json": JSON.stringify({
          name: "app",
          dependencies: { host: "1.0.0", lib: "^1.0.0", plugin: "1.0.0" },
        }),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
      });
      const cwd = String(dir);
      const lockfilePath = join(cwd, "bun.lock");

      await installWithOwnCache(cwd);
      const lockfile = await file(lockfilePath).text();
      const fresh = installedIn(cwd);
      expect(lockfile).toContain('"host/plugin": ["plugin@1.0.0"');

      await installWithOwnCache(cwd, "--frozen-lockfile");
      expect(installedIn(cwd)).toEqual(fresh);

      await installWithOwnCache(cwd, "--lockfile-only");
      expect(await file(lockfilePath).text()).toBe(lockfile);
    },
  );

  // The next commands should accept what the install just wrote and installed.
  async function expectSettled(cwd: string) {
    const lockfile = await file(join(cwd, "bun.lock")).text();
    const installed = installedIn(cwd);

    await installWithOwnCache(cwd, "--frozen-lockfile");
    expect(installedIn(cwd)).toEqual(installed);

    await installWithOwnCache(cwd, "--lockfile-only");
    expect(await file(join(cwd, "bun.lock")).text()).toBe(lockfile);
  }

  // dup@2.0.0 has one peer dependency and is placed twice. It's placed under `unmet` first, where the nearest
  // peer-target is the root's 2.0.0, and that placement binds the peer. The dup under met shares the 1.0.0 next to it,
  // which the range accepts, and doesn't rebind the peer. Rebinding it gave the dup under `unmet` a copy of 1.0.0 that
  // bun.lock didn't list. `unmet` is read first or last.
  describe.each(["a-unmet", "z-unmet"])("the first placement of a package binds its optional peer, under %s", unmet => {
    const manifests: Manifests = {
      "peer-target": { "1.0.0": {}, "2.0.0": {} },
      "dup": { "1.0.0": {}, "2.0.0": optionalPeer("peer-target", "^1.0.0") },
      "met": {
        "1.0.0": { dependencies: { "dup": "2.0.0" } },
        "2.0.0": { dependencies: { "dup": "2.0.0", "peer-target": "1.0.0" } },
      },
      [unmet]: { "1.0.0": { dependencies: { "dup": "2.0.0", "peer-target": "2.0.0" } } },
    };
    const packageJson = (met: string) =>
      JSON.stringify({ name: "app", devDependencies: { [unmet]: "1.0.0" }, dependencies: { "dup": "1.0.0", met } });
    const copy = join("node_modules", unmet, "node_modules", "dup", "node_modules", "peer-target");

    it.concurrent("in a fresh install", async () => {
      using registry = await serveRegistry(manifests);
      using dir = tempDir("optional-peer-first-place-", {
        "package.json": packageJson("2.0.0"),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker: "hoisted" } }),
      });

      await installWithOwnCache(String(dir));
      expect(installedIn(String(dir))).not.toContain(copy);
      await expectSettled(String(dir));
    });

    it.concurrent("when an upgrade brings the version in range", async () => {
      using registry = await serveRegistry(manifests);
      using dir = tempDir("optional-peer-first-place-", {
        "package.json": packageJson("1.0.0"),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker: "hoisted" } }),
      });

      await installWithOwnCache(String(dir));
      await write(join(String(dir), "package.json"), packageJson("2.0.0"));
      await installWithOwnCache(String(dir));
      expect(installedIn(String(dir))).not.toContain(copy);
      await expectSettled(String(dir));
    });
  });

  // 0j@1.0.0 is at the root and twice below a@2.5.0, next to k@1.0.0 and below k@1.1.0, and `*` takes
  // either. Its row is also what puts k at the root. Moved from place to place, it changed the root's
  // k after a@2.5.0 had taken it for its own `^1.1.0`, and the tree built from bun.lock was never the
  // tree built from that one. The names decide the order of the walk.
  it.concurrent("a dependency that placed its package in the tree isn't rebound by a later placement", async () => {
    using registry = await serveRegistry({
      "a": {
        "1.1.0": {},
        "2.5.0": { dependencies: { "0i": "^1.0.0", "k": "^1.1.0" }, optionalDependencies: { "g": "^1.0.0" } },
      },
      "d": { "2.5.0": { dependencies: { "g": "2.5.0", "f": "^1.1.0" } } },
      "f": { "1.1.0": { dependencies: { "0j": "^1.1.0" } } },
      "g": { "1.1.0": { dependencies: { "0j": "~1.0.0" } }, "2.5.0": {} },
      "0i": { "1.1.0": { dependencies: { "k": "~1.0.0", "0j": "1.0.0" } }, "3.0.0": {} },
      "0j": { "1.0.0": optionalPeer("k", "*"), "1.1.0": { dependencies: { "m": "1.x" } } },
      "k": { "1.0.0": {}, "1.1.0": {} },
      "m": { "1.0.0": { dependencies: { "a": "^2.0.0" } }, "2.5.0": {} },
    });
    using dir = tempDir("optional-peer-placed-row-", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "m": "*", "a": "^1.0.0", "d": "*" },
        devDependencies: { "0j": "1.0.0" },
        optionalDependencies: { "0i": "3.0.0" },
      }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker: "hoisted" } }),
    });

    await installWithOwnCache(String(dir));
    await expectSettled(String(dir));
  });

  // one is placed at the root first, where nothing provides host, so its peer stays unbound. The copy below al shares
  // the host next to it. Binding the peer there used to put a host at the root that nobody needed, without the inner
  // that it bundles. With no "host/inner", bun.lock didn't load.
  it.concurrent.each(["hoisted", "isolated"] as const)(
    "an optional peer stays unbound if nothing provides it where its package is placed first (%s linker)",
    async linker => {
      using registry = await serveRegistry({
        one: { "1.0.0": optionalPeer("host", "*") },
        three: { "1.0.0": optionalPeer("one", "*") },
        host: { "1.0.0": { dependencies: { inner: "*" }, bundleDependencies: ["inner"] } },
        inner: { "1.0.0": { dependencies: { three: "*", host: "*" } } },
      });
      using dir = tempDir("optional-peer-bundling-package-", {
        "package.json": JSON.stringify({ name: "app", dependencies: { one: "*", three: "*", al: "npm:host@*" } }),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
      });

      await installWithOwnCache(String(dir));
      expect(await file(join(String(dir), "bun.lock")).text()).not.toContain('\n    "host": [');
      expect(installedIn(String(dir))).not.toContain(join("node_modules", "host"));
      await expectSettled(String(dir));
    },
  );

  // plugin is at the root and, for inner, below host, next to the inner that host bundles. That placement bound
  // plugin's peer, which turned the dependency waiting at the root into an inner whose dependencies were never walked.
  // bun.lock then listed "inner" with no leaf for it to find, and didn't load. Nobody needed either of them.
  it.concurrent.each(["hoisted", "isolated"] as const)(
    "bun.lock loads when a bundled package needs a plugin that has an optional peer on it (%s linker)",
    async linker => {
      using registry = await serveRegistry({
        host: { "1.0.0": { dependencies: { inner: "*" }, bundledDependencies: ["inner"] } },
        inner: { "1.0.0": { dependencies: { plugin: "*", leaf: "*" } } },
        leaf: { "1.0.0": {} },
        plugin: { "1.0.0": optionalPeer("inner", "*") },
      });
      using dir = tempDir("optional-peer-on-bundled-package-", {
        "package.json": JSON.stringify({ name: "app", dependencies: { host: "1.0.0", plugin: "1.0.0" } }),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
      });

      await installWithOwnCache(String(dir));
      const lockfile = await file(join(String(dir), "bun.lock")).text();
      expect(lockfile).not.toContain('\n    "inner": [');
      expect(lockfile).not.toContain('\n    "leaf": [');
      expect(await readdirSorted(join(String(dir), "node_modules"))).toEqual(
        linker === "hoisted" ? ["host", "plugin"] : [".bun", "host", "plugin"],
      );
      await expectSettled(String(dir));
    },
  );

  // Only nested@1.0.0 is below the copy of shipped that bundler ships. first and second wait at the
  // root for a shipped that never comes, and binding them to that copy installed one at the root.
  it.concurrent.each(["hoisted", "isolated"] as const)(
    "a bundled copy serves the optional peers below it and no other (%s linker)",
    async linker => {
      using registry = await serveRegistry({
        shipped: { "1.0.0": {} },
        first: { "1.0.0": optionalPeer("shipped", "*") },
        second: { "1.0.0": optionalPeer("shipped", "*") },
        nested: { "1.0.0": optionalPeer("shipped", "*"), "2.0.0": {} },
        bundler: { "1.0.0": { dependencies: { shipped: "*", nested: "1.0.0" }, bundledDependencies: ["shipped"] } },
      });
      using dir = tempDir("optional-peer-bundled-copy-", {
        "package.json": JSON.stringify({
          name: "app",
          dependencies: { bundler: "1.0.0", first: "1.0.0", nested: "2.0.0", second: "1.0.0" },
        }),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker } }),
      });
      const cwd = String(dir);

      await installWithOwnCache(cwd);
      const fresh = installedIn(cwd);
      expect(fresh).not.toContain(join("node_modules", "shipped"));

      const { out } = await installWithOwnCache(cwd);
      expect(installedIn(cwd)).toEqual(fresh);
      expect(out).toContain("(no changes)");
    },
  );
});

// A package is printed at more than one path when another version of it holds the slot above
// one of its dependents (here the root holds one version, a parent holds the other, and the
// dependents under that parent get the root's version printed again next to them). Its edges
// are in the file once, so loading binds them once per printed path, and the paths can find
// different copies of a peer; the path printed last used to win, so what an edge loaded as
// depended on how its dependents' parents happened to sort.
describe("loading bun.lock binds the dependencies of a package that's printed at several paths", () => {
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

    // peer-target leaves package.json as parent enters it. Nothing but star-peer's `*` peer holds
    // peer-target@1.0.0 any more, so the peer pass re-resolves the edge onto mid's 1.1.0, the only
    // copy a dependency still holds, and that copy hoists to the root for both printings.
    await write(join(cwd, "package.json"), packageJson({ "star-peer": "1.0.0", "mid": "2.0.0", "parent": "1.0.0" }));
    await installWithOwnCache(cwd);
    expect(printedPackages(await file(lockfilePath).text())).toEqual({
      "mid": "mid@2.0.0",
      "parent": "parent@1.0.0",
      "peer-target": "peer-target@1.1.0",
      "star-peer": "star-peer@1.0.0",
      "parent/mid": "mid@1.0.0",
      "parent/star-peer": "star-peer@2.0.0",
      "parent/mid/star-peer": "star-peer@1.0.0",
    });

    // Both printings of star-peer load the edge as the root copy, so the tree built from the
    // file is the file's own and --frozen-lockfile accepts it.
    await rm(join(cwd, "node_modules"), { recursive: true });
    await installWithOwnCache(cwd, "--frozen-lockfile");
    expect(await file(join(cwd, "node_modules", "peer-target", "package.json")).json()).toMatchObject({
      version: "1.1.0",
    });
    expect(
      await exists(join(cwd, "node_modules", "parent", "node_modules", "mid", "node_modules", "peer-target")),
    ).toBe(false);
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
  // finds z-p's own 1.1.0, which the range accepts. This is the file a fresh install writes. Bound
  // to 1.1.0, the dup under a-q would have a copy of it printed, so the edge is bound to the root's
  // 1.0.0: a-q's dup is laid out first and binds it, and z-p's shares z-p's copy without moving it.
  it.concurrent("an optional peer printed nowhere loads from the printing that shares a refused copy", async () => {
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

  // Nothing meets dup@1.0.0's peer, and the install that writes the file binds it to the holder's
  // 1.1.0. The printing under plain takes the root's own 1.0.0 all the same, as a peer takes any
  // dependency of the root, so it says nothing about the binding. Loading the peer as 1.0.0 nested
  // a copy of 1.0.0 under the holder's dup, at a path the file does not have.
  it.concurrent.each(["a-holder", "z-holder"])(
    "a peer nothing satisfies is read from its printing under %s, not from the root's own dependency",
    async holder => {
      using registryServer = await serveRegistry({
        "dup": { "1.0.0": { peerDependencies: { "peer-target": "^2.0.0" } }, "2.0.0": {} },
        "peer-target": { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} },
        "plain": { "1.0.0": { dependencies: { "dup": "1.0.0" } } },
        [holder]: { "1.0.0": { dependencies: { "dup": "1.0.0", "peer-target": "1.1.0" } } },
      });
      using dir = tempDir("bun-lock-several-paths-", {
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: registryServer.url, linker: "hoisted" } }),
        "package.json": JSON.stringify({
          name: "app",
          dependencies: { "dup": "2.0.0", "peer-target": "1.0.0", "plain": "1.0.0", [holder]: "1.0.0" },
        }),
      });
      const cwd = String(dir);
      const lockfilePath = join(cwd, "bun.lock");

      await installWithOwnCache(cwd);
      const lockfile = await file(lockfilePath).text();
      expect(printedPackages(lockfile)).toEqual({
        "dup": "dup@2.0.0",
        "peer-target": "peer-target@1.0.0",
        "plain": "plain@1.0.0",
        [holder]: `${holder}@1.0.0`,
        "plain/dup": "dup@1.0.0",
        [`${holder}/dup`]: "dup@1.0.0",
        [`${holder}/peer-target`]: "peer-target@1.1.0",
      });

      const { out } = await installWithOwnCache(cwd);
      expect(await exists(join(cwd, "node_modules", holder, "node_modules", "dup", "node_modules"))).toBe(false);
      expect(out).toContain("(no changes)");

      await installWithOwnCache(cwd, "--lockfile-only");
      expect(await file(lockfilePath).text()).toBe(lockfile);
    },
  );
});

// Manifests come back from the registry in any order, and a fresh install has to
// resolve the same versions whichever comes first. Once everything is resolved, the
// versions the install added collapse onto the fewest that satisfy every range;
// of those, a range takes the one the project itself depends on if it accepts
// it, else the highest it accepts. Each shape below is installed
// under arrival orders forced by holding one manifest back until another request
// has come in. Where there is one, that is a request bun can only make once it has
// read the other parent's manifest: for the manifest of what that parent depends
// on, or for the parent's tarball. Every order has to write the same
// bun.lock. `z`, the package the rows disagree on, has 1.0.0, 1.0.5, 1.1.0 and 2.0.0.
type OrderedManifests = Record<string, Record<string, Record<string, Record<string, string> | string[]>>>;
// `manifest` is the name of a package, or the file name of a tarball such as "a-1.0.0.tgz".
type Hold = { manifest: string; until: string };
type OrderedShape = {
  shape: string;
  manifests: OrderedManifests;
  files: Record<string, object>;
  orders: Record<string, Hold[]>;
  z: Record<string, string>;
};
const zVersions = { "1.0.0": {}, "1.0.5": {}, "1.1.0": {}, "2.0.0": {} };

// The manifests of the packages in `broken` are not JSON.
async function registryWithHolds(manifests: OrderedManifests, broken: string[] = []) {
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
  let gates = new Map<string, PromiseWithResolvers<void>>();
  let heldUntil = new Map<string, string>();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { origin, pathname } = new URL(request.url);
      gates.get(pathname)?.resolve();
      const name = pathname.slice(1);
      const until = heldUntil.get(name);
      if (until) await gates.get(until)!.promise;
      const tarball = tarballs.get(pathname);
      if (tarball) return new Response(tarball);
      const entry = manifests[name];
      if (!entry) return new Response("not found", { status: 404 });
      if (broken.includes(name)) return new Response('{ "name": ');
      const versions: Record<string, unknown> = {};
      for (const [version, extra] of Object.entries(entry)) {
        versions[version] = { name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` }, ...extra };
      }
      const latest = Object.keys(entry).sort(Bun.semver.order).at(-1);
      return Response.json({ name, versions, "dist-tags": { latest } });
    },
  });
  return {
    server,
    hold(holds: Hold[]) {
      gates = new Map(holds.map(({ until }) => [until, Promise.withResolvers<void>()]));
      heldUntil = new Map(holds.map(({ manifest, until }) => [manifest, until]));
    },
  };
}

function projectOn(server: Bun.Server, files: Record<string, object>) {
  return tempDir("lock-arrival-order", {
    ...Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
    "bunfig.toml": `[install]\nregistry = "${server.url.href}"\nlinker = "hoisted"\nsaveTextLockfile = true\n`,
  });
}

async function installAndReadLock(cwd: string) {
  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out, err, code }).toMatchObject({ err: expect.stringContaining("Saved lockfile"), code: 0 });
  return await file(join(cwd, "bun.lock")).text();
}

async function freshInstallLock(server: Bun.Server, files: Record<string, object>) {
  using dir = projectOn(server, files);
  return await installAndReadLock(String(dir));
}

// Returns every instance of `name`, keyed by where it's placed, e.g. `{ "z": "z@1.0.0", "b/z": "z@1.1.0" }`.
function instancesOf(lock: string, name: string): Record<string, string> {
  const { packages } = Bun.JSONC.parse(lock) as { packages: Record<string, [string, ...unknown[]]> };
  return Object.fromEntries(
    Object.entries(packages)
      .filter(([key]) => key === name || key.endsWith(`/${name}`))
      .map(([key, [resolution]]) => [key, resolution]),
  );
}

async function writesTheSameLockInEveryOrder({ manifests, files, orders, z }: OrderedShape) {
  const ordered = await registryWithHolds(manifests);
  using server = ordered.server;
  let expected: string | undefined;
  for (const [order, holds] of Object.entries(orders)) {
    ordered.hold(holds);
    const lock = await freshInstallLock(server, files);
    expected ??= lock;
    expect({ order, lock }).toEqual({ order, lock: expected });
  }
  expect(instancesOf(expected!, "z")).toEqual(z);
}

it.each<OrderedShape>([
  {
    shape: "a -> z@1.0.0 next to b -> z@^1.0.0",
    manifests: {
      a: { "1.0.0": { dependencies: { z: "1.0.0" } } },
      b: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/z" }],
      "b's manifest last": [{ manifest: "b", until: "/z" }],
    },
    z: { "z": "z@1.0.0" },
  },
  {
    shape: "a -> z@~1.0.0 next to b -> z@^1.0.0",
    manifests: {
      a: { "1.0.0": { dependencies: { z: "~1.0.0" } } },
      b: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/z" }],
      "b's manifest last": [{ manifest: "b", until: "/z" }],
    },
    z: { "z": "z@1.0.5" },
  },
  {
    shape: "a -> z@* next to b -> z@~1.0.0",
    manifests: {
      a: { "1.0.0": { dependencies: { z: "*" } } },
      b: { "1.0.0": { dependencies: { z: "~1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/z" }],
      "b's manifest last": [{ manifest: "b", until: "/z" }],
    },
    z: { "z": "z@1.0.5" },
  },
  {
    // No version covers all three, so two stay; a's range accepts both and takes the higher one, whichever
    // of them was in place when a's row was resolved.
    shape: "a -> z@^1.0.0, b -> z@~1.0.0, c -> z@~1.1.0",
    manifests: {
      a: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      b: { "1.0.0": { dependencies: { z: "~1.0.0" } } },
      c: { "1.0.0": { dependencies: { z: "~1.1.0" } } },
      z: { "1.0.5": {}, "1.1.3": {}, "1.2.0": {} },
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0", c: "1.0.0" } } },
    orders: {
      "a's manifest first": [
        { manifest: "b", until: "/z" },
        { manifest: "c", until: "/z" },
      ],
      // a's tarball is requested once a's manifest has been read.
      "b's, then a's, then c's": [
        { manifest: "a", until: "/z" },
        { manifest: "c", until: "/a-1.0.0.tgz" },
      ],
      "c's, then a's, then b's": [
        { manifest: "a", until: "/z" },
        { manifest: "b", until: "/a-1.0.0.tgz" },
      ],
    },
    z: { "z": "z@1.1.3", "b/z": "z@1.0.5" },
  },
  {
    // b's range accepts the root's pin; c puts b's own best match in place, which must not change what b gets.
    shape: "root z@1.0.0, b -> z@^1.0.0, c -> z@~1.1.0",
    manifests: {
      b: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      c: { "1.0.0": { dependencies: { z: "~1.1.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { b: "1.0.0", c: "1.0.0", z: "1.0.0" } } },
    orders: {
      "b's manifest last": [{ manifest: "b", until: "/z" }],
      // b's tarball is requested once b's manifest has been read.
      "c's manifest last": [
        { manifest: "b", until: "/z" },
        { manifest: "c", until: "/b-1.0.0.tgz" },
      ],
    },
    z: { "z": "z@1.0.0", "c/z": "z@1.1.0" },
  },
  {
    // a and b resolve to the same z, so either of them may be the one that appends it; p (installed as a's peer
    // after every regular row) brings a range from another major, and shares that z either way.
    shape: "a -> z@1.1.0 and b -> z@^1.0.0 share a z that absorbs peer p -> z@*",
    manifests: {
      a: { "1.0.0": { dependencies: { z: "1.1.0" }, peerDependencies: { p: "1.0.0" } } },
      b: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      p: { "1.0.0": { dependencies: { z: "*" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/z" }],
      "b's manifest last": [{ manifest: "b", until: "/z" }],
    },
    z: { "z": "z@1.1.0" },
  },
  {
    shape: "root z@1.0.0 absorbs b -> z@^1.0.0",
    manifests: { b: { "1.0.0": { dependencies: { z: "^1.0.0" } } }, z: zVersions },
    files: { "package.json": { name: "foo", dependencies: { b: "1.0.0", z: "1.0.0" } } },
    orders: {
      "b's manifest last": [{ manifest: "b", until: "/z" }],
      "z's manifest last": [{ manifest: "z", until: "/b-1.0.0.tgz" }],
    },
    z: { "z": "z@1.0.0" },
  },
  {
    shape: "workspace z@1.0.0 absorbs b -> z@^1.0.0",
    manifests: { b: { "1.0.0": { dependencies: { z: "^1.0.0" } } }, z: zVersions },
    files: {
      "package.json": { name: "foo", workspaces: ["pkg"], dependencies: { b: "1.0.0" } },
      "pkg/package.json": { name: "pkg", dependencies: { z: "1.0.0" } },
    },
    orders: {
      "b's manifest last": [{ manifest: "b", until: "/z" }],
      "z's manifest last": [{ manifest: "z", until: "/b-1.0.0.tgz" }],
    },
    z: { "z": "z@1.0.0" },
  },
  {
    shape: "root z@~1.0.0 absorbs b -> z@^1.0.0",
    manifests: { b: { "1.0.0": { dependencies: { z: "^1.0.0" } } }, z: zVersions },
    files: { "package.json": { name: "foo", dependencies: { b: "1.0.0", z: "~1.0.0" } } },
    orders: {
      "b's manifest last": [{ manifest: "b", until: "/z" }],
      "z's manifest last": [{ manifest: "z", until: "/b-1.0.0.tgz" }],
    },
    z: { "z": "z@1.0.5" },
  },
  {
    // The root's z stays whatever else is resolved, so c's `*` ends up on it (across the major, as
    // every `@types/*` package's `@types/node: *` ends up on the project's own `@types/node`)
    // whether a's row is resolved before c's or after.
    shape: "the root's z@~1.0.0 absorbs c -> z@* whether or not a -> z@1.0.5 has pinned it yet",
    manifests: {
      a: { "1.0.0": { dependencies: { z: "1.0.5" } } },
      c: { "1.0.0": { dependencies: { z: "*" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", c: "1.0.0", z: "~1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/c" }],
      "c's manifest last": [
        { manifest: "a", until: "/z" },
        { manifest: "c", until: "/a-1.0.0.tgz" },
      ],
    },
    z: { "z": "z@1.0.5" },
  },
  {
    shape: "root z@^1.0.0 absorbs c -> z@* from another major",
    manifests: { c: { "1.0.0": { dependencies: { z: "*" } } }, z: zVersions },
    files: { "package.json": { name: "foo", dependencies: { c: "1.0.0", z: "^1.0.0" } } },
    orders: {
      "c's manifest last": [{ manifest: "c", until: "/z" }],
      "z's manifest last": [{ manifest: "z", until: "/c-1.0.0.tgz" }],
    },
    z: { "z": "z@1.1.0" },
  },
  {
    // p is installed as a's peer once every regular row is resolved; by then a's z is in place on every install.
    shape: "a -> z@1.0.0 absorbs peer p -> z@^1.0.0",
    manifests: {
      a: { "1.0.0": { dependencies: { z: "1.0.0" }, peerDependencies: { p: "1.0.0" } } },
      p: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0" } } },
    orders: {
      "z's manifest last": [{ manifest: "z", until: "/a-1.0.0.tgz" }],
      "p's manifest last": [{ manifest: "p", until: "/z-1.0.0.tgz" }],
    },
    z: { "z": "z@1.0.0" },
  },
  // Workspace rows resolve in workspace order, so either the range row or the exact row puts z in place:
  // c gets that z either way.
  ...[
    ["wa", "wb"],
    ["wb", "wa"],
  ].map(([range, exact]) => ({
    shape: `workspace ${range} -> z@^1.0.0 and workspace ${exact} -> z@1.1.0 hold what c -> z@* takes`,
    manifests: { c: { "1.0.0": { dependencies: { z: "*" } } }, z: zVersions },
    files: {
      "package.json": { name: "foo", workspaces: ["wa", "wb"], dependencies: { c: "1.0.0" } },
      [`${range}/package.json`]: { name: range, dependencies: { z: "^1.0.0" } },
      [`${exact}/package.json`]: { name: exact, dependencies: { z: "1.1.0" } },
    },
    orders: {
      "c's manifest last": [{ manifest: "c", until: "/z" }],
      "z's manifest last": [{ manifest: "z", until: "/c-1.0.0.tgz" }],
    },
    z: { "z": "z@1.1.0" },
  })),
  // Peers that nothing provides are installed once every regular dependency is resolved. They get the newest version
  // that every package with that peer dependency accepts.
  {
    shape: "a peers z@>=1.0.0 next to b peers z@^1.0.0",
    manifests: {
      a: { "1.0.0": { peerDependencies: { z: ">=1.0.0" } } },
      b: { "1.0.0": { peerDependencies: { z: "^1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/b" }],
      "b's manifest last": [{ manifest: "b", until: "/a-1.0.0.tgz" }],
    },
    z: { "z": "z@1.1.0" },
  },
  {
    shape: "a peers z@<=1.1.0, b peers z@<=1.0.5, c peers z@1.0.0",
    manifests: {
      a: { "1.0.0": { peerDependencies: { z: "<=1.1.0" } } },
      b: { "1.0.0": { peerDependencies: { z: "<=1.0.5" } } },
      c: { "1.0.0": { peerDependencies: { z: "1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0", c: "1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/c" }],
      "c's manifest last": [{ manifest: "c", until: "/a-1.0.0.tgz" }],
    },
    z: { "z": "z@1.0.0" },
  },
  {
    // No version satisfies both, so they share one copy. The first package in declaration order decides which one, not
    // the first manifest to arrive.
    shape: "a peers z@^1.0.0 next to b peers z@^2.0.0",
    manifests: {
      a: { "1.0.0": { peerDependencies: { z: "^1.0.0" } } },
      b: { "1.0.0": { peerDependencies: { z: "^2.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/b" }],
      "b's manifest last": [{ manifest: "b", until: "/a-1.0.0.tgz" }],
    },
    z: { "z": "z@1.1.0" },
  },
  {
    // m is itself installed as a peer, so its range may not be known yet when z is first picked. Once it is, all three
    // packages settle on the one version that satisfies them all.
    shape: "a peers m@1.0.0 and z@>=1.0.0, b peers z@>=1.0.5, m peers z@~1.0.0",
    manifests: {
      a: { "1.0.0": { peerDependencies: { m: "1.0.0", z: ">=1.0.0" } } },
      b: { "1.0.0": { peerDependencies: { z: ">=1.0.5" } } },
      m: { "1.0.0": { peerDependencies: { z: "~1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } } },
    orders: {
      "m's manifest last": [{ manifest: "m", until: "/z" }],
      "z's manifest last": [{ manifest: "z", until: "/m-1.0.0.tgz" }],
    },
    z: { "z": "z@1.0.5" },
  },
  {
    shape: "a peers z@^1.0.0 next to b peers z@>=1.0.0",
    manifests: {
      a: { "1.0.0": { peerDependencies: { z: "^1.0.0" } } },
      b: { "1.0.0": { peerDependencies: { z: ">=1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } } },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/b" }],
      "b's manifest last": [{ manifest: "b", until: "/a-1.0.0.tgz" }],
    },
    z: { "z": "z@1.1.0" },
  },
  // The project's own peer ranges come before those of its dependencies, whatever the names.
  {
    shape: "the root peers z@^1.0.0, a peers z@>=1.0.0",
    manifests: { a: { "1.0.0": { peerDependencies: { z: ">=1.0.0" } } }, z: zVersions },
    files: { "package.json": { name: "foo", dependencies: { a: "1.0.0" }, peerDependencies: { z: "^1.0.0" } } },
    orders: { "as they come": [] },
    z: { "z": "z@1.1.0" },
  },
  {
    shape: "workspace w peers z@^1.0.0, a peers z@>=1.0.0",
    manifests: { a: { "1.0.0": { peerDependencies: { z: ">=1.0.0" } } }, z: zVersions },
    files: {
      "package.json": { name: "foo", workspaces: ["w"], dependencies: { a: "1.0.0" } },
      "w/package.json": { name: "w", peerDependencies: { z: "^1.0.0" } },
    },
    orders: { "as they come": [] },
    z: { "z": "z@1.1.0" },
  },
  {
    // a isn't below w, so w's z doesn't provide a's peer. No installed version satisfies it, so it gets its own.
    shape: "workspace w peers z@latest, a peers z@1.0.0, o -> z@1.0.5",
    manifests: {
      a: { "1.0.0": { peerDependencies: { z: "1.0.0" } } },
      o: { "1.0.0": { dependencies: { z: "1.0.5" } } },
      z: zVersions,
    },
    files: {
      "package.json": { name: "foo", workspaces: ["w"], dependencies: { a: "1.0.0", o: "1.0.0" } },
      "w/package.json": { name: "w", peerDependencies: { z: "latest" } },
    },
    orders: {
      "a's manifest last": [{ manifest: "a", until: "/z" }],
      "o's manifest last": [{ manifest: "o", until: "/a-1.0.0.tgz" }],
    },
    z: { "z": "z@2.0.0", "a/z": "z@1.0.0", "o/z": "z@1.0.5" },
  },
  {
    // No version satisfies both kit and its dependency r, so r follows kit. o's z@1.0.5 satisfies kit's range.
    shape: "kit peers z@~1.0.0 and -> r, r peers z@^2.0.0, o -> z@1.0.5",
    manifests: {
      kit: { "1.0.0": { dependencies: { r: "1.0.0" }, peerDependencies: { z: "~1.0.0" } } },
      o: { "1.0.0": { dependencies: { z: "1.0.5" } } },
      r: { "1.0.0": { peerDependencies: { z: "^2.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { kit: "1.0.0", o: "1.0.0" } } },
    orders: {
      "r's manifest last": [{ manifest: "r", until: "/z" }],
      "o's manifest last": [{ manifest: "o", until: "/kit-1.0.0.tgz" }],
    },
    z: { "z": "z@1.0.5" },
  },
  {
    // p and r depend on each other and have the same peer range. o's z doesn't satisfy it, so neither uses it.
    shape: "p peers z@^2.0.0 and -> r, r peers z@^2.0.0 and p, o -> z@1.0.5",
    manifests: {
      o: { "1.0.0": { dependencies: { z: "1.0.5" } } },
      p: { "1.0.0": { dependencies: { r: "1.0.0" }, peerDependencies: { z: "^2.0.0" } } },
      r: { "1.0.0": { peerDependencies: { p: "1.0.0", z: "^2.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { o: "1.0.0", p: "1.0.0" } } },
    orders: {
      "r's manifest last": [{ manifest: "r", until: "/z" }],
      "o's manifest last": [{ manifest: "o", until: "/p" }],
    },
    z: { "z": "z@1.0.5", "p/z": "z@2.0.0", "r/z": "z@2.0.0" },
  },
  {
    // p gets a z in its range. b stays next to s, so it keeps loading the same z as s.
    shape: "s -> z@^1.0.0 and b, b peers z@>=1.0.0, p peers z@^2.0.0",
    manifests: {
      b: { "1.0.0": { peerDependencies: { z: ">=1.0.0" } } },
      p: { "1.0.0": { peerDependencies: { z: "^2.0.0" } } },
      s: { "1.0.0": { dependencies: { b: "1.0.0", z: "^1.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { p: "1.0.0", s: "1.0.0" } } },
    orders: {
      "s's manifest last": [{ manifest: "s", until: "/p-1.0.0.tgz" }],
      "p's manifest last": [{ manifest: "p", until: "/s" }],
    },
    z: { "z": "z@2.0.0", "s/z": "z@1.1.0" },
  },
  {
    // t depends on r and has the same peer range. o's z doesn't satisfy either of them.
    shape: "r peers z@^2.0.0, t peers z@^2.0.0 and -> r, o -> z@1.0.5",
    manifests: {
      o: { "1.0.0": { dependencies: { z: "1.0.5" } } },
      r: { "1.0.0": { peerDependencies: { z: "^2.0.0" } } },
      t: { "1.0.0": { dependencies: { r: "1.0.0" }, peerDependencies: { z: "^2.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { o: "1.0.0", r: "1.0.0", t: "1.0.0" } } },
    orders: {
      "t's manifest last": [{ manifest: "t", until: "/r-1.0.0.tgz" }],
      "r's manifest last": [{ manifest: "r", until: "/t" }],
    },
    z: { "z": "z@1.0.5", "r/z": "z@2.0.0", "t/z": "z@2.0.0" },
  },
  {
    // Nothing that depends on r also depends on z, so r doesn't use o's z.
    shape: "r peers z@^2.0.0, o -> z@1.0.5",
    manifests: {
      o: { "1.0.0": { dependencies: { z: "1.0.5" } } },
      r: { "1.0.0": { peerDependencies: { z: "^2.0.0" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { o: "1.0.0", r: "1.0.0" } } },
    orders: {
      "r's manifest last": [{ manifest: "r", until: "/z" }],
      "o's manifest last": [{ manifest: "o", until: "/r" }],
    },
    z: { "z": "z@1.0.5", "r/z": "z@2.0.0" },
  },
  {
    // h ships z@1.0.0, y and y's z@1.0.5 in its own tarball. Sharing one of those versions saves no copy, so r
    // and p get what they would get without h, whether or not h's rows are resolved first.
    shape: "h bundles z@1.0.0 and y -> z@1.0.5, r -> z@^1.0.0, p peers z@*",
    manifests: {
      h: { "1.0.0": { dependencies: { y: "1.0.0", z: "1.0.0" }, bundleDependencies: ["y", "z"] } },
      p: { "1.0.0": { peerDependencies: { z: "*" } } },
      r: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      y: { "1.0.0": { dependencies: { z: "1.0.5" } } },
      z: zVersions,
    },
    files: { "package.json": { name: "foo", dependencies: { h: "1.0.0", p: "1.0.0", r: "1.0.0" } } },
    orders: {
      "h's manifest last": [{ manifest: "h", until: "/z" }],
      // Only h leads to y.
      "r's manifest last": [{ manifest: "r", until: "/y" }],
    },
    z: { "z": "z@1.1.0", "h/z": "z@1.0.0", "h/y/z": "z@1.0.5" },
  },
])("a fresh install writes the same bun.lock whichever manifest arrives last: $shape", writesTheSameLockInEveryOrder);

// The collapse chooses among the versions the install added, and j's row adds its own best match (1.5.0) only
// when it is resolved before k's 1.0.9 is in place. With 1.5.0 the two versions kept are 1.5.0 and 1.0.9,
// without it 2.0.0 and 1.0.9.
it.todo("a fresh install writes the same bun.lock whichever manifest arrives last: two covers of the same size", () =>
  writesTheSameLockInEveryOrder({
    shape: "j -> z@^1.0.0, k -> z@~1.0.0, m -> z@>=1.2.0, n -> z@*",
    manifests: {
      j: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      k: { "1.0.0": { dependencies: { z: "~1.0.0" } } },
      m: { "1.0.0": { dependencies: { z: ">=1.2.0" } } },
      n: { "1.0.0": { dependencies: { z: "*" } } },
      z: { "1.0.9": {}, "1.5.0": {}, "2.0.0": {} },
    },
    files: { "package.json": { name: "foo", dependencies: { j: "1.0.0", k: "1.0.0", m: "1.0.0", n: "1.0.0" } } },
    orders: {
      "j's manifest first": [
        { manifest: "k", until: "/z-1.5.0.tgz" },
        { manifest: "m", until: "/z-1.0.9.tgz" },
        { manifest: "n", until: "/z-1.0.9.tgz" },
      ],
      "k's manifest first": [
        { manifest: "j", until: "/z-1.0.9.tgz" },
        { manifest: "m", until: "/j-1.0.0.tgz" },
        { manifest: "n", until: "/j-1.0.0.tgz" },
      ],
    },
    z: { "z": "z@1.5.0", "k/z": "z@1.0.9" },
  }),
);

it("an install that only adds packages leaves the versions bun.lock already has where they are", async () => {
  using server = (
    await registryWithHolds({
      a: { "1.0.0": { dependencies: { z: "*" } } },
      b: { "1.0.0": { dependencies: { z: "~1.0.0" } } },
      z: zVersions,
    })
  ).server;
  using dir = projectOn(server, { "package.json": { name: "foo", dependencies: { a: "1.0.0" } } });
  const before = await installAndReadLock(String(dir));
  expect(instancesOf(before, "z")).toEqual({ "z": "z@2.0.0" });

  // 1.0.5 would cover a's `*` too, and does on a fresh install ("a -> z@* next to b -> z@~1.0.0" above).
  await write(
    join(String(dir), "package.json"),
    JSON.stringify({ name: "foo", dependencies: { a: "1.0.0", b: "1.0.0" } }),
  );
  const after = await installAndReadLock(String(dir));
  expect(instancesOf(after, "z")).toEqual({ "z": "z@2.0.0", "b/z": "z@1.0.5" });
});

// b's range accepts the z bun.lock already has; whether c's 1.1.0 is in place when b's row is resolved must not matter.
it("an install that adds packages to a bun.lock writes the same bun.lock whichever manifest arrives last", async () => {
  const ordered = await registryWithHolds({
    a: { "1.0.0": { dependencies: { z: "1.0.0" } } },
    b: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
    c: { "1.0.0": { dependencies: { z: "~1.1.0" } } },
    z: zVersions,
  });
  using server = ordered.server;
  let expected: string | undefined;
  for (const [order, holds] of Object.entries<Hold[]>({
    "b's manifest last": [{ manifest: "b", until: "/c" }],
    "c's manifest last": [{ manifest: "c", until: "/b-1.0.0.tgz" }],
  })) {
    ordered.hold([]);
    using dir = projectOn(server, { "package.json": { name: "foo", dependencies: { a: "1.0.0" } } });
    await installAndReadLock(String(dir));

    ordered.hold(holds);
    await write(
      join(String(dir), "package.json"),
      JSON.stringify({ name: "foo", dependencies: { a: "1.0.0", b: "1.0.0", c: "1.0.0" } }),
    );
    const lock = await installAndReadLock(String(dir));
    expected ??= lock;
    expect({ order, lock }).toEqual({ order, lock: expected });
  }
  expect(instancesOf(expected!, "z")).toEqual({ "z": "z@1.0.0", "c/z": "z@1.1.0" });
});

// What a tarball dependency depends on is only known once it is downloaded, and how long that takes
// must not decide which versions its dependencies share with the rest of the tree. p's peer keeps
// z@2.0.0 in the tree once something has picked it, so the collapse cannot even the orders out.
const pinAndPeer = { dependencies: { p: "1.0.0", z: "1.0.0" } };
const peerOnZ2 = { "1.0.0": { peerDependencies: { z: "^2.0.0" } } };

function dependenciesOnTarballs(server: Bun.Server, names: string[]) {
  return Object.fromEntries(names.map(name => [name, `${server.url.origin}/${name}-1.0.0.tgz`]));
}

it.each<Omit<OrderedShape, "files"> & { tarballs: string[]; dependencies: Record<string, string> }>([
  {
    shape: "the tarball a -> z@* next to b -> z@1.0.0",
    manifests: { a: { "1.0.0": { dependencies: { z: "*" } } }, b: { "1.0.0": pinAndPeer }, p: peerOnZ2, z: zVersions },
    tarballs: ["a"],
    dependencies: { b: "1.0.0" },
    orders: {
      // While b's manifest is held, only a's package.json leads to z.
      "a's tarball first": [{ manifest: "b", until: "/z" }],
      "a's tarball last": [{ manifest: "a-1.0.0.tgz", until: "/z-1.0.0.tgz" }],
    },
    z: { "z": "z@1.0.0" },
  },
  {
    shape: "the tarball a -> z@* next to the tarball c -> z@1.0.0",
    manifests: { a: { "1.0.0": { dependencies: { z: "*" } } }, c: { "1.0.0": pinAndPeer }, p: peerOnZ2, z: zVersions },
    tarballs: ["a", "c"],
    dependencies: {},
    orders: {
      "a's tarball first": [{ manifest: "c-1.0.0.tgz", until: "/z" }],
      // Only c's package.json leads to p.
      "c's tarball first": [{ manifest: "a-1.0.0.tgz", until: "/p" }],
    },
    z: { "z": "z@2.0.0", "c/z": "z@1.0.0" },
  },
])(
  "a fresh install writes the same bun.lock whichever tarball dependency arrives last: $shape",
  async ({ manifests, tarballs, dependencies, orders, z }) => {
    const ordered = await registryWithHolds(manifests);
    using server = ordered.server;
    const files = {
      "package.json": { name: "foo", dependencies: { ...dependenciesOnTarballs(server, tarballs), ...dependencies } },
    };
    let expected: string | undefined;
    for (const [order, holds] of Object.entries(orders)) {
      ordered.hold(holds);
      const lock = await freshInstallLock(server, files);
      expected ??= lock;
      expect({ order, lock }).toEqual({ order, lock: expected });
    }
    expect(instancesOf(expected!, "z")).toEqual(z);
  },
);

it("a tarball dependency is installed when the one before it cannot be downloaded", async () => {
  const ordered = await registryWithHolds({ c: { "1.0.0": { dependencies: { z: "~1.0.0" } } }, z: zVersions });
  using server = ordered.server;
  // c is downloaded, and read, while the answer for `a` is still out. Only c's package.json leads to z.
  ordered.hold([{ manifest: "a-1.0.0.tgz", until: "/z" }]);
  const lock = await freshInstallLock(server, {
    "package.json": {
      name: "foo",
      dependencies: dependenciesOnTarballs(server, ["c"]),
      optionalDependencies: dependenciesOnTarballs(server, ["a"]),
    },
  });
  expect(instancesOf(lock, "a")).toEqual({});
  expect(instancesOf(lock, "c")).toEqual({ "c": `c@${server.url.origin}/c-1.0.0.tgz` });
  expect(instancesOf(lock, "z")).toEqual({ "z": "z@1.0.5" });
});

// While `a` is held, bun requests ahead what c's `x@^1.0.0` will most likely need: x@1.1.0 and so `junk`.
// In the end c shares b's x@1.0.0, which does not depend on `junk`.
it("a broken manifest that no dependency needs in the end does not fail the install", async () => {
  const ordered = await registryWithHolds(
    {
      a: { "1.0.0": {} },
      b: { "1.0.0": { dependencies: { x: "1.0.0" } } },
      c: { "1.0.0": { dependencies: { x: "^1.0.0" } } },
      x: { "1.0.0": {}, "1.1.0": { dependencies: { junk: "^1.0.0" } } },
      junk: { "1.0.0": {} },
    },
    ["junk"],
  );
  using server = ordered.server;
  ordered.hold([
    { manifest: "a", until: "/junk" },
    { manifest: "b", until: "/x" },
  ]);
  const lock = await freshInstallLock(server, {
    "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0", c: "1.0.0" } },
  });
  expect(instancesOf(lock, "x")).toEqual({ "x": "x@1.0.0" });
  expect(instancesOf(lock, "junk")).toEqual({});
});

// Dependencies are resolved in a fixed order, but none of them waits for its turn to start its requests.
it("a tarball dependency is downloaded while the dependency before it waits for its manifest", async () => {
  const ordered = await registryWithHolds({ a: { "1.0.0": {} }, x: { "1.0.0": {} } });
  using server = ordered.server;
  ordered.hold([{ manifest: "a", until: "/x-1.0.0.tgz" }]);
  const lock = await freshInstallLock(server, {
    "package.json": { name: "foo", dependencies: { a: "1.0.0", ...dependenciesOnTarballs(server, ["x"]) } },
  });
  expect(instancesOf(lock, "x")).toEqual({ "x": `x@${server.url.origin}/x-1.0.0.tgz` });
});

it("the dependencies of a file: folder are requested while the dependency before it waits for its manifest", async () => {
  const ordered = await registryWithHolds({ a: { "1.0.0": {} }, y: { "1.0.0": {} } });
  using server = ordered.server;
  ordered.hold([{ manifest: "a", until: "/y" }]);
  const lock = await freshInstallLock(server, {
    "package.json": { name: "foo", dependencies: { a: "1.0.0", w: "file:./w" } },
    "w/package.json": { name: "w", version: "1.0.0", dependencies: { y: "1.0.0" } },
  });
  expect(instancesOf(lock, "y")).toEqual({ "y": "y@1.0.0" });
});

it("an override that no version of an installed peer matches is a warning, as on a fresh install", async () => {
  using registry = await serveRegistry({
    a: { "1.0.0": { peerDependencies: { p: "1.x" } } },
    p: { "1.0.0": {}, "2.0.0": {} },
  });
  const packageJson = { name: "foo", dependencies: { a: "1.0.0" } };
  using dir = tempDir("override-unmet-peer", {
    "package.json": JSON.stringify(packageJson),
    "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, linker: "hoisted" } }),
  });
  const lockfile = () => file(join(String(dir), "bun.lock")).text();
  await installWithOwnCache(String(dir));
  expect(instancesOf(await lockfile(), "p")).toEqual({ "p": "p@1.0.0" });

  await write(join(String(dir), "package.json"), JSON.stringify({ ...packageJson, overrides: { p: "^9.0.0" } }));
  const { err } = await installWithOwnCache(String(dir));
  expect(err).toContain('warn: No version matching "^9.0.0" found for peer dependency "p" (but package exists)');
  const overLockfile = await lockfile();
  expect(instancesOf(overLockfile, "p")).toEqual({});

  await rm(join(String(dir), "bun.lock"));
  await installWithOwnCache(String(dir));
  expect(await lockfile()).toBe(overLockfile);
});

it("a peer that no version in the tree satisfies stays on the version it was bound to", async () => {
  using server = (
    await registryWithHolds({
      a: { "1.0.0": { dependencies: { z: "1.0.0" } } },
      b: { "1.0.0": { dependencies: { z: "2.0.0" } } },
      p: { "1.0.0": { peerDependencies: { z: "^3.0.0" } } },
      z: zVersions,
    })
  ).server;
  using dir = projectOn(server, {
    "package.json": { name: "foo", dependencies: { a: "1.0.0", b: "1.0.0", p: "1.0.0" } },
  });
  const lock = await installAndReadLock(String(dir));
  expect(instancesOf(lock, "z")).toEqual({ "z": "z@1.0.0", "b/z": "z@2.0.0", "p/z": "z@2.0.0" });
  await expectNothingToDedupe(String(dir));
});

async function expectNothingToDedupe(cwd: string) {
  await using proc = spawn({
    cmd: [bunExe(), "dedupe", "--check"],
    cwd,
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out, err, code }).toEqual({ out: expect.stringContaining("No duplicates"), err: "", code: 0 });
}

// The lower z is in the tree only because the higher z depends on it. The range that brought the higher one in
// accepts both, but moving it down removes the higher z, and with it the only reason the lower one is there.
it.each<{
  shape: string;
  manifests: OrderedManifests;
  dependencies: Record<string, string>;
  z: Record<string, string>;
}>([
  {
    shape: "c peers z@*, z@3.0.0 -> z@2.0.0",
    manifests: {
      c: { "1.0.0": { peerDependencies: { z: "*" } } },
      z: { "2.0.0": {}, "3.0.0": { dependencies: { z: "2.0.0" } } },
    },
    dependencies: { c: "1.0.0" },
    z: { "z": "z@3.0.0", "z/z": "z@2.0.0" },
  },
  {
    shape: "c -> z@*, z@3.0.0 -> z@2.0.0",
    manifests: {
      c: { "1.0.0": { dependencies: { z: "*" } } },
      z: { "2.0.0": {}, "3.0.0": { dependencies: { z: "2.0.0" } } },
    },
    dependencies: { c: "1.0.0" },
    z: { "z": "z@3.0.0", "z/z": "z@2.0.0" },
  },
  {
    shape: "c -> z@^1.0.0, z@1.5.0 -> z@~1.2.0",
    manifests: {
      c: { "1.0.0": { dependencies: { z: "^1.0.0" } } },
      z: { "1.2.0": {}, "1.5.0": { dependencies: { z: "~1.2.0" } } },
    },
    dependencies: { c: "1.0.0" },
    z: { "z": "z@1.5.0", "z/z": "z@1.2.0" },
  },
  {
    shape: "c -> z@*, z@2.0.0 -> y -> z@1.0.0",
    manifests: {
      c: { "1.0.0": { dependencies: { z: "*" } } },
      y: { "1.0.0": { dependencies: { z: "1.0.0" } } },
      z: { "1.0.0": {}, "2.0.0": { dependencies: { y: "1.0.0" } } },
    },
    dependencies: { c: "1.0.0" },
    z: { "z": "z@2.0.0", "y/z": "z@1.0.0" },
  },
  {
    shape: "root z@*, z@2.0.0 -> z@1.0.0",
    manifests: { z: { "1.0.0": {}, "2.0.0": { dependencies: { z: "1.0.0" } } } },
    dependencies: { z: "*" },
    z: { "z": "z@2.0.0", "z/z": "z@1.0.0" },
  },
  {
    // d holds the lower z whatever happens to the higher one, so c shares it.
    shape: "c -> z@*, z@3.0.0 -> z@2.0.0, d -> z@^2.0.0",
    manifests: {
      c: { "1.0.0": { dependencies: { z: "*" } } },
      d: { "1.0.0": { dependencies: { z: "^2.0.0" } } },
      z: { "2.0.0": {}, "3.0.0": { dependencies: { z: "2.0.0" } } },
    },
    dependencies: { c: "1.0.0", d: "1.0.0" },
    z: { "z": "z@2.0.0" },
  },
])("a version is not dropped for one that only it depends on: $shape", async ({ manifests, dependencies, z }) => {
  using server = (await registryWithHolds(manifests)).server;
  using dir = projectOn(server, { "package.json": { name: "foo", dependencies } });
  expect(instancesOf(await installAndReadLock(String(dir)), "z")).toEqual(z);
  await expectNothingToDedupe(String(dir));
});

// The bundled-shadow-* fixtures are described in
// registry/packages/create-bundled-shadow-packages.ts. In short: host depends
// on shared@1.0.0, which is hoisted to the root, and bundles inner, which
// depends on shared@2.0.0. A bundle's dependencies hoist no further than the
// bundling package's node_modules, but `host/shared` in bun.lock is also what
// host's own `shared` edge resolves to when the lockfile is loaded again, and
// likewise for anything nested under host that resolves shared from the root.
// https://github.com/oven-sh/bun/issues/29263
it("a bundled dependency's dependency does not take a slot the bundling package resolves through", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
  });
  const run = makeInstallRunner(packageDir);
  const hostNodeModules = join(packageDir, "node_modules", "bundled-shadow-host", "node_modules");

  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: { "bundled-shadow-host": "1.0.0", "bundled-shadow-shared": "1.0.0" },
    }),
  );
  await run(["install"]);
  const fresh = await file(join(packageDir, "bun.lock")).text();
  expect(fresh).toContain('"bundled-shadow-shared": ["bundled-shadow-shared@1.0.0"');
  expect(fresh).toContain(
    '"bundled-shadow-host/bundled-shadow-inner/bundled-shadow-shared": ["bundled-shadow-shared@2.0.0"',
  );
  expect(fresh).not.toContain('"bundled-shadow-host/bundled-shadow-shared"');

  // inner's shared@2.0.0 ships inside host's tarball; host itself uses the root copy.
  const layout = async () => ({
    root: (await file(join(packageDir, "node_modules", "bundled-shadow-shared", "package.json")).json()).version,
    host: await readdirSorted(hostNodeModules),
    inner: (
      await file(
        join(hostNodeModules, "bundled-shadow-inner", "node_modules", "bundled-shadow-shared", "package.json"),
      ).json()
    ).version,
  });
  const expectedLayout = { root: "1.0.0", host: ["bundled-shadow-inner"], inner: "2.0.0" };
  expect(await layout()).toEqual(expectedLayout);

  // Every install that starts from the lockfile has to give host the same
  // shared as the install that wrote it.
  await run(["install"]);
  expect(await layout()).toEqual(expectedLayout);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
  expect(await layout()).toEqual(expectedLayout);

  await run(["install", "--lockfile-only"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(fresh);
});

it("the isolated linker links the bundling package against the same dependency on a reinstall", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "isolated" },
  });
  const run = makeInstallRunner(packageDir);
  const hostStoreEntry = join(packageDir, "node_modules", ".bun", "bundled-shadow-host@1.0.0", "node_modules");
  const sharedVersion = async (...dir: string[]) =>
    (await file(join(...dir, "bundled-shadow-shared", "package.json")).json()).version;
  // `host` is what gets linked next to host in its store entry; `inner` is the
  // copy that came out of host's tarball.
  const layout = async () => ({
    host: await sharedVersion(hostStoreEntry),
    inner: await sharedVersion(
      hostStoreEntry,
      "bundled-shadow-host",
      "node_modules",
      "bundled-shadow-inner",
      "node_modules",
    ),
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: { "bundled-shadow-host": "1.0.0", "bundled-shadow-shared": "1.0.0" },
    }),
  );
  await run(["install"]);
  expect(await layout()).toEqual({ host: "1.0.0", inner: "2.0.0" });

  // The store is rebuilt from the resolutions bun.lock loads, which come from
  // the saved paths.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
  expect(await layout()).toEqual({ host: "1.0.0", inner: "2.0.0" });
});

it("a bundled dependency's dependency does not take a slot a dependency nested under the bundling package resolves through", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
  });
  const run = makeInstallRunner(packageDir);

  // deep-host itself does not depend on shared. consumer@1.0.0 nests under it
  // (consumer@2.0.0 holds the root), mid@1.0.0 nests under consumer (mid@2.0.0
  // holds the root), and mid's shared@1.0.0 is hoisted to the root, up through
  // deep-host's node_modules. deep-host bundles wrapper, whose inner depends on
  // shared@2.0.0, and that is hoisted after mid's shared is already at the root.
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: {
        "bundled-shadow-deep-host": "1.0.0",
        "bundled-shadow-consumer": "2.0.0",
        "bundled-shadow-mid": "2.0.0",
      },
    }),
  );
  await run(["install"]);
  const fresh = await file(join(packageDir, "bun.lock")).text();
  expect(fresh).toContain('"bundled-shadow-shared": ["bundled-shadow-shared@1.0.0"');
  expect(fresh).toContain(
    '"bundled-shadow-deep-host/bundled-shadow-consumer/bundled-shadow-mid": ["bundled-shadow-mid@1.0.0"',
  );
  expect(fresh).toContain(
    '"bundled-shadow-deep-host/bundled-shadow-inner/bundled-shadow-shared": ["bundled-shadow-shared@2.0.0"',
  );
  expect(fresh).not.toContain('"bundled-shadow-deep-host/bundled-shadow-shared"');

  // mid@1.0.0 has to keep finding shared@1.0.0 at the root on a reinstall.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
  expect({
    root: (await file(join(packageDir, "node_modules", "bundled-shadow-shared", "package.json")).json()).version,
    deepHost: await readdirSorted(join(packageDir, "node_modules", "bundled-shadow-deep-host", "node_modules")),
  }).toEqual({ root: "1.0.0", deepHost: ["bundled-shadow-consumer", "bundled-shadow-wrapper"] });

  await run(["install", "--lockfile-only"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(fresh);
});

it("a bundled dependency's optional peer bound late does not take a slot the bundling package resolves through", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
  });
  const run = makeInstallRunner(packageDir);

  // peer-inner (bundled) has an optional peer on shared and depends on
  // peer-leaf, which depends on shared@2.0.0. The peer is still unbound when
  // peer-inner is hoisted and gets bound to peer-leaf's shared@2.0.0 inside the
  // bundle; peer-host's own shared@1.0.0 at the root must not be shadowed by
  // either of them.
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "bundled-shadow-peer-host": "1.0.0" } }));
  await run(["install"]);
  const fresh = await file(join(packageDir, "bun.lock")).text();
  expect(fresh).toContain('"bundled-shadow-shared": ["bundled-shadow-shared@1.0.0"');
  expect(fresh).toContain(
    '"bundled-shadow-peer-host/bundled-shadow-peer-inner/bundled-shadow-shared": ["bundled-shadow-shared@2.0.0"',
  );
  expect(fresh).toContain(
    '"bundled-shadow-peer-host/bundled-shadow-peer-leaf/bundled-shadow-shared": ["bundled-shadow-shared@2.0.0"',
  );
  expect(fresh).not.toContain('"bundled-shadow-peer-host/bundled-shadow-shared"');

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
  expect(await readdirSorted(join(packageDir, "node_modules", "bundled-shadow-peer-host", "node_modules"))).toEqual([
    "bundled-shadow-peer-inner",
  ]);

  await run(["install", "--lockfile-only"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(fresh);
});

// A lockfile stores the `file:` path of a dependency exactly as the declaring
// package.json wrote it, i.e. relative to that package.json, while a fresh parse
// of the same package.json stores it relative to the project. The rows below
// only get resolved again from the loaded lockfile (an override for their name
// went away, or `bun update <name>` targets them), which is when the two forms
// have to agree.
describe.concurrent("re-resolving file: dependencies declared by a file: package or a workspace", () => {
  const pkg = (name: string, version: string, dependencies?: Record<string, string>) =>
    JSON.stringify({ name, version, dependencies });
  const app = (overrides?: Record<string, string>) =>
    JSON.stringify({ name: "app", dependencies: { a: "file:./vendor/a" }, overrides });
  const installedVersion = async (packageDir: string, ...segments: string[]) =>
    (await file(join(packageDir, ...segments, "package.json")).json()).version;

  // `a` declares `b` relative to itself; the override redirects `b` elsewhere.
  const vendored = {
    "vendor/a/package.json": pkg("a", "1.0.0", { b: "file:../b" }),
    "vendor/b/package.json": pkg("b", "1.0.0"),
    "vendor/b2/package.json": pkg("b", "2.0.0"),
  };

  it.each([
    ["bun.lock", true],
    ["bun.lockb", false],
  ])("removing an override resolves the file: package's dependency next to it again (%s)", async (_, text) => {
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted", saveTextLockfile: text },
      files: { ...vendored, "package.json": app({ b: "file:./vendor/b2" }) },
    });
    const run = makeInstallRunner(packageDir);

    await run(["install"]);
    expect(await installedVersion(packageDir, "node_modules", "a", "node_modules", "b")).toBe("2.0.0");
    expect(await exists(join(packageDir, text ? "bun.lock" : "bun.lockb"))).toBe(true);

    await write(packageJson, app());
    await run(["install"]);
    expect(await installedVersion(packageDir, "node_modules", "a", "node_modules", "b")).toBe("1.0.0");
    await run(["install", "--frozen-lockfile"]);

    await run(["install", "--save-text-lockfile", "--lockfile-only"]);
    const lockfile = await file(join(packageDir, "bun.lock")).text();
    expect(lockfile).toContain('"a": ["a@file:vendor/a", { "dependencies": { "b": "file:../b" } }]');
    expect(lockfile).toContain('"a/b": ["b@file:vendor/b", {}]');
  });

  it("a path without .. is resolved from the declaring package, not from the project root", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "vendor/a/package.json": pkg("a", "1.0.0", { b: "file:./b" }),
        "vendor/a/b/package.json": pkg("b", "1.0.0"),
        // same relative path from the project root
        "b/package.json": pkg("b", "9.9.9"),
        "vendor/b2/package.json": pkg("b", "2.0.0"),
        "package.json": app({ b: "file:./vendor/b2" }),
      },
    });
    const run = makeInstallRunner(packageDir);

    await run(["install"]);
    await write(packageJson, app());
    await run(["install"]);
    expect(await file(join(packageDir, "bun.lock")).text()).toContain('"a/b": ["b@file:vendor/a/b", {}]');
    expect(await installedVersion(packageDir, "node_modules", "a", "node_modules", "b")).toBe("1.0.0");
  });

  it("bun update <name> re-resolves the file: package's dependency", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: { ...vendored, "package.json": app() },
    });
    const run = makeInstallRunner(packageDir);

    await run(["install"]);
    const lockfile = await file(join(packageDir, "bun.lock")).text();
    expect(lockfile).toContain('"a/b": ["b@file:vendor/b", {}]');

    await run(["update", "b"]);
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
    expect(await installedVersion(packageDir, "node_modules", "a", "node_modules", "b")).toBe("1.0.0");
  });

  it("removing an override resolves a workspace's file: dependency relative to the workspace again", async () => {
    const workspaceRoot = (overrides?: Record<string, string>) =>
      JSON.stringify({ name: "app", workspaces: ["packages/*"], overrides });
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "packages/ws1/package.json": pkg("ws1", "1.0.0", { b: "file:../../vendor/b" }),
        "vendor/b/package.json": pkg("b", "1.0.0"),
        "vendor/b2/package.json": pkg("b", "2.0.0"),
        "package.json": workspaceRoot({ b: "file:./vendor/b2" }),
      },
    });
    const run = makeInstallRunner(packageDir);

    await run(["install"]);
    expect(await file(join(packageDir, "bun.lock")).text()).toContain('"ws1/b": ["b@file:vendor/b2", {}]');

    await write(packageJson, workspaceRoot());
    await run(["install"]);
    const lockfile = await file(join(packageDir, "bun.lock")).text();
    expect(lockfile).toContain('"b": "file:../../vendor/b"');
    expect(lockfile).toContain('"ws1/b": ["b@file:vendor/b", {}]');
    expect(await installedVersion(packageDir, "packages", "ws1", "node_modules", "b")).toBe("1.0.0");
    await run(["install", "--frozen-lockfile"]);
  });
});

it("re-saving bun.lock keeps a bundled peer on the version its own entry records", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: true } });
  const run = makeInstallRunner(packageDir);

  const dependencies = { "no-deps": "1.1.0", "peer-deps-fixed": "1.0.0" };
  await write(packageJson, JSON.stringify({ name: "foo", dependencies }));

  // peer-deps-fixed's peer on no-deps (^1.0.0) has a bundled entry of its own,
  // the shape bundled subtrees have in existing lockfiles (for example
  // @napi-rs/wasm-runtime's peer on @emnapi/core inside
  // @tailwindcss/oxide-wasm32-wasi). It stays on the no-deps@1.0.0 recorded
  // there even though the root has since moved on to no-deps@1.1.0, which the
  // range would also accept. Without a configVersion the install re-saves the
  // file, as it does for every lockfile written before configVersion existed.
  await write(
    join(packageDir, "bun.lock"),
    JSON.stringify({
      lockfileVersion: 1,
      workspaces: { "": { name: "foo", dependencies } },
      packages: {
        "no-deps": ["no-deps@1.1.0", "", {}, ""],
        "peer-deps-fixed": ["peer-deps-fixed@1.0.0", "", { peerDependencies: { "no-deps": "^1.0.0" } }, ""],
        "peer-deps-fixed/no-deps": ["no-deps@1.0.0", "", { bundled: true }, ""],
      },
    }),
  );

  await run(["install"]);
  const lockfile = await file(join(packageDir, "bun.lock")).text();
  expect(lockfile).toContain('"configVersion": 0,');
  expect(lockfile).toContain('"no-deps": ["no-deps@1.1.0", ');
  expect(lockfile).toContain('"peer-deps-fixed/no-deps": ["no-deps@1.0.0", ');
});

// https://github.com/oven-sh/bun/issues/42381
// --frozen-lockfile resolves package.json from scratch and compares that tree
// with the one it rebuilt from bun.lock. A bun.lock that bun itself just wrote
// has to pass that comparison unchanged, whatever command wrote it. Each
// project below puts a different resolver feature on the lockfile boundary.
describe.each(["hoisted", "isolated"] as const)(
  "a bun.lock bun writes passes --frozen-lockfile (%s linker)",
  linker => {
    const pkg = (name: string, extra: object) => JSON.stringify({ name, version: "1.0.0", ...extra });

    // `shape` lists lockfile entries which show that the graph is what the name says.
    const projects: Record<string, { files: Record<string, string>; shape: string[] }> = {
      "multiple versions of one transitive dependency": {
        files: {
          "package.json": pkg("app", {
            dependencies: {
              "no-deps": "1.1.0",
              "one-dep": "1.0.0",
              "one-fixed-dep": "2.0.0",
              "one-fixed-dep-v1": "npm:one-fixed-dep@1.0.0",
              "one-range-dep": "1.0.0",
            },
          }),
        },
        shape: [
          '"no-deps": ["no-deps@1.1.0"',
          '"one-dep/no-deps": ["no-deps@1.0.1"',
          '"one-fixed-dep/no-deps": ["no-deps@2.0.0"',
          '"one-fixed-dep-v1/no-deps": ["no-deps@1.0.0"',
        ],
      },
      "peer dependencies": {
        // peer-deps-lvl0 depends on no-deps@1.0.0 and on lvl1, which has a peer
        // on no-deps and depends on lvl2, which has the same peer.
        // provides-peer-deps-2-0-0 brings no-deps@2.0.0 next to peer-deps.
        files: {
          "package.json": pkg("app", {
            dependencies: {
              "no-deps": "^1.0.0",
              "peer-deps-fixed": "1.0.0",
              "peer-deps-lvl0": "1.0.0",
              "provides-peer-deps-2-0-0": "1.0.0",
            },
          }),
        },
        shape: [
          '"no-deps": ["no-deps@1.1.0"',
          '"peer-deps-lvl2": ["peer-deps-lvl2@1.0.0"',
          '"peer-deps-lvl0/no-deps": ["no-deps@1.0.0"',
          '"provides-peer-deps-2-0-0/no-deps": ["no-deps@2.0.0"',
        ],
      },
      "optional dependencies": {
        // has-missing-optional-dep: an optional dependency the registry does not have.
        // duplicate-optional: no-deps in dependencies and optionalDependencies with
        // different versions, plus a peer on two-range-deps.
        files: {
          "package.json": pkg("app", {
            dependencies: {
              "duplicate-optional": "1.0.1",
              "has-missing-optional-dep": "1.0.0",
              "two-range-deps": "1.0.0",
            },
            optionalDependencies: { "no-deps": "2.0.0" },
          }),
        },
        // two-range-deps wants no-deps@^1.0.0. That resolves to 1.1.0, unless
        // duplicate-optional's no-deps@1.0.1 was appended first, in which case
        // the range reuses it (the order depends on manifest arrival). Both
        // trees have to round-trip, so the shape only pins the major.
        shape: [
          '"no-deps": ["no-deps@2.0.0"',
          '"duplicate-optional/no-deps": ["no-deps@1.0.1"',
          '"two-range-deps/no-deps": ["no-deps@1.',
          '"optionalDependencies": { "this-package-does-not-exist-in-the-registry": "||" }',
        ],
      },
      "platform-specific dependencies": {
        // optional-native's optional dependencies are gated on os, cpu, and libc.
        // No os value matches a real host, so those are skipped everywhere. Which
        // libc one is installed depends on the host.
        files: {
          "package.json": pkg("app", { dependencies: { "optional-native": "1.0.0" } }),
        },
        shape: [
          '"native-foo-x64": ["native-foo-x64@1.0.0"',
          '{ "os": "none", "cpu": "x64" }',
          '{ "os": "none", "cpu": "none" }',
          '"native-libc-musl": ["native-libc-musl@1.0.0"',
        ],
      },
      "workspaces": {
        files: {
          "package.json": pkg("app", {
            workspaces: ["packages/*"],
            dependencies: { "no-deps": "^1.0.0", "pkg-b": "workspace:*" },
          }),
          "packages/pkg-a/package.json": pkg("pkg-a", {
            dependencies: { "no-deps": "1.0.0", "peer-deps": "1.0.0" },
          }),
          "packages/pkg-b/package.json": pkg("pkg-b", {
            dependencies: { "no-deps": "2.0.0", "one-dep": "1.0.0", "pkg-a": "workspace:*" },
            devDependencies: { "peer-deps-fixed": "1.0.0" },
          }),
        },
        shape: [
          '"pkg-a": ["pkg-a@workspace:packages/pkg-a"]',
          '"pkg-b": ["pkg-b@workspace:packages/pkg-b"]',
          '"no-deps": ["no-deps@1.1.0"',
          '"pkg-a/no-deps": ["no-deps@1.0.0"',
          '"pkg-b/no-deps": ["no-deps@2.0.0"',
        ],
      },
      // Decides who owns the root's `node_modules/<name>` when a workspace has that name. It's the root's own
      // dependency with that name if that's a registry range that the workspace doesn't satisfy, and the workspace
      // otherwise. An alias is installed under a different name.
      "a root dependency on the published version of a workspace": {
        files: {
          "package.json": pkg("app", { workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } }),
          // one-dep needs no-deps@1.0.1, which fits neither the root's 1.0.0 nor the workspace.
          "packages/no-deps/package.json": JSON.stringify({
            name: "no-deps",
            version: "3.0.0",
            dependencies: { "a-dep": "1.0.1", "one-dep": "1.0.0" },
          }),
          "packages/pkg-a/package.json": pkg("pkg-a", { dependencies: { "no-deps": "workspace:*" } }),
          "packages/pkg-b/package.json": pkg("pkg-b", { devDependencies: { "no-deps": "^3.0.0" } }),
        },
        shape: [
          '"packages/no-deps": {',
          '"no-deps": ["no-deps@1.0.0"',
          '"pkg-a/no-deps": ["no-deps@workspace:packages/no-deps"]',
          '"pkg-b/no-deps": ["no-deps@workspace:packages/no-deps"]',
          '"a-dep": ["a-dep@1.0.1"',
        ],
      },
      "a root alias of the registry package that has the name of a workspace": {
        files: {
          "package.json": pkg("app", { workspaces: ["packages/*"], dependencies: { published: "npm:no-deps@1.0.0" } }),
          "packages/no-deps/package.json": JSON.stringify({
            name: "no-deps",
            version: "3.0.0",
            dependencies: { "a-dep": "1.0.1" },
          }),
        },
        shape: [
          '"no-deps": ["no-deps@workspace:packages/no-deps"]',
          '"published": ["no-deps@1.0.0"',
          '"a-dep": ["a-dep@1.0.1"',
        ],
      },
      "a file: folder that has the name of a workspace": {
        files: {
          "package.json": pkg("app", { workspaces: ["packages/*"], dependencies: { alpha: "file:./vendor/alpha" } }),
          "packages/alpha/package.json": pkg("alpha", { dependencies: { "no-deps": "1.0.0" } }),
          "vendor/alpha/package.json": JSON.stringify({ name: "alpha", version: "2.0.0" }),
        },
        shape: ['"alpha": "file:./vendor/alpha"', '"alpha": ["alpha@workspace:packages/alpha"]', '"no-deps@1.0.0"'],
      },
      "a file: folder in two dependency groups": {
        files: {
          "package.json": pkg("app", {
            dependencies: { vdir: "file:./vendor/vdir" },
            devDependencies: { vdir: "file:./vendor/vdir" },
          }),
          "vendor/vdir/package.json": pkg("vdir", {}),
        },
        shape: ['"vdir": ["vdir@file:vendor/vdir"'],
      },
      "file: folders with dependencies, a bin and scripts": {
        files: {
          "package.json": pkg("app", { workspaces: ["packages/*"], dependencies: { vdir: "file:./vendor/vdir" } }),
          "packages/pkg-a/package.json": pkg("pkg-a", { dependencies: { other: "file:../../vendor/other" } }),
          "vendor/vdir/package.json": pkg("vdir", {
            bin: { vdir: "./cli.js", "vdir-2": "./cli.js" },
            scripts: { postinstall: "exit 0" },
            dependencies: { "no-deps": "^1.0.0" },
            devDependencies: { "a-dep": "1.0.1" },
            optionalDependencies: { "one-dep": "1.0.0" },
            peerDependencies: { "peer-deps-fixed": "*" },
            peerDependenciesMeta: { "peer-deps-fixed": { optional: true }, "only-in-meta": { optional: true } },
            bundledDependencies: ["no-deps"],
          }),
          "vendor/vdir/cli.js": "#!/usr/bin/env node\n",
          "vendor/other/package.json": pkg("other", { bin: "./cli.js", dependencies: { "no-deps": "2.0.0" } }),
          "vendor/other/cli.js": "#!/usr/bin/env node\n",
        },
        shape: ['"vdir": ["vdir@file:vendor/vdir", {', '["other@file:vendor/other", {'],
      },
      "workspaces with install scripts, bins and names only peerDependenciesMeta lists": {
        files: {
          "package.json": pkg("app", {
            workspaces: ["packages/*"],
            peerDependenciesMeta: { "only-in-meta": { optional: true } },
          }),
          "packages/pkg-a/package.json": pkg("pkg-a", {
            bin: "./cli.js",
            scripts: { preinstall: "exit 0", postinstall: "exit 0", prepare: "exit 0" },
            dependencies: { "no-deps": "latest", "a-dep": "^1.0.1" },
            peerDependenciesMeta: { "only-in-meta": { optional: true } },
          }),
          "packages/pkg-a/cli.js": "#!/usr/bin/env node\n",
          // Neither of the two scripts runs for a workspace.
          "packages/pkg-b/package.json": pkg("pkg-b", {
            directories: { bin: "./bin" },
            scripts: { preprepare: "exit 0", postprepare: "exit 0" },
            dependencies: { "pkg-a": "^1.0.0" },
          }),
          "packages/pkg-b/bin/pkg-b-cli": "#!/usr/bin/env node\n",
        },
        shape: [
          '"no-deps": "latest"',
          '"bin": "./cli.js"',
          '"binDir": "./bin"',
          '"optionalPeers": [\n        "only-in-meta"',
        ],
      },
    };
    const cases = Object.entries(projects).map(([name, { files, shape }]) => [name, files, shape] as const);

    function createProject(name: string, files: Record<string, string>, saveTextLockfile = true) {
      return tempDir(`frozen-roundtrip-${linker}-${name.replace(/\W+/g, "-")}-`, {
        ...files,
        "bunfig.toml": Bun.TOML.stringify({
          install: { registry: registry.registryUrl(), linker, saveTextLockfile },
        }),
      });
    }

    async function run(cwd: string, args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd,
        env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ args, err, code }).toMatchObject({ args, err: expect.not.stringContaining("error:"), code: 0 });
      return { out, err };
    }

    const lockfileText = (cwd: string) => file(join(cwd, "bun.lock")).text();

    // The frozen install over the node_modules the last command left, then over
    // none, and finally a --lockfile-only install, which always writes bun.lock
    // and so checks that the tree loaded from bun.lock prints back to the same text.
    async function expectFrozenInstallKeeps(cwd: string, lockfile: string) {
      await run(cwd, ["install", "--frozen-lockfile"]);
      expect(await lockfileText(cwd)).toBe(lockfile);

      await run(cwd, ["ci"]);
      expect(await lockfileText(cwd)).toBe(lockfile);

      await rm(join(cwd, "node_modules"), { recursive: true, force: true });
      await run(cwd, ["install", "--frozen-lockfile"]);
      expect(await lockfileText(cwd)).toBe(lockfile);

      await run(cwd, ["install", "--lockfile-only"]);
      expect(await lockfileText(cwd)).toBe(lockfile);
    }

    it.concurrent.each(cases)("bun.lockb written by bun install: %s", async (name, files) => {
      using dir = createProject(name, files, false);
      const cwd = String(dir);
      const lockfileBytes = () => file(join(cwd, "bun.lockb")).bytes();

      await run(cwd, ["install"]);
      const lockfile = await lockfileBytes();
      expect(await exists(join(cwd, "bun.lock"))).toBeFalse();

      for (const args of [["install"], ["install", "--frozen-lockfile"], ["ci"]]) {
        await run(cwd, args);
        expect(await lockfileBytes()).toEqual(lockfile);
      }
      await rm(join(cwd, "node_modules"), { recursive: true, force: true });
      await run(cwd, ["install", "--frozen-lockfile"]);
      expect(await lockfileBytes()).toEqual(lockfile);
    });

    it.concurrent.each(cases)("written by bun install: %s", async (name, files, shape) => {
      using dir = createProject(name, files);
      const cwd = String(dir);

      await run(cwd, ["install"]);
      const lockfile = await lockfileText(cwd);
      for (const entry of shape) expect(lockfile).toContain(entry);

      await expectFrozenInstallKeeps(cwd, lockfile);
    });

    it.concurrent.each(cases)("written by bun install --lockfile-only: %s", async (name, files) => {
      using dir = createProject(name, files);
      const cwd = String(dir);

      await run(cwd, ["install", "--lockfile-only"]);
      expect(await exists(join(cwd, "node_modules"))).toBeFalse();
      const lockfile = await lockfileText(cwd);

      await expectFrozenInstallKeeps(cwd, lockfile);
    });

    it.concurrent.each(cases)("written by a repeated bun install: %s", async (name, files) => {
      using dir = createProject(name, files);
      const cwd = String(dir);

      await run(cwd, ["install"]);
      const lockfile = await lockfileText(cwd);
      for (let i = 0; i < 2; i++) {
        await run(cwd, ["install"]);
        expect(await lockfileText(cwd)).toBe(lockfile);
      }

      await expectFrozenInstallKeeps(cwd, lockfile);
    });

    // https://github.com/oven-sh/bun/issues/31748: the ranges are widened after
    // the first install, so `bun update` has versions to move and package.json
    // to rewrite, the way an "update dependencies" bot uses it.
    it.concurrent("written by bun update", async () => {
      const manifests = (prefix: "" | "^") => ({
        "package.json": pkg("app", {
          workspaces: ["packages/*"],
          dependencies: {
            "a-dep": `${prefix}1.0.1`,
            "no-deps": `${prefix}1.0.0`,
            "peer-deps-fixed": "1.0.0",
            "pkg-a": "workspace:*",
          },
          devDependencies: { "one-fixed-dep": `${prefix}1.0.0` },
          overrides: { "no-deps": "$no-deps" },
        }),
        "packages/pkg-a/package.json": pkg("pkg-a", {
          dependencies: { "a-dep": `${prefix}1.0.1`, "one-dep": `${prefix}1.0.0` },
        }),
      });
      using dir = createProject("update", manifests(""));
      const cwd = String(dir);

      await run(cwd, ["install"]);
      const pinned = await lockfileText(cwd);
      expect(pinned).toContain('"a-dep": ["a-dep@1.0.1"');

      for (const [path, contents] of Object.entries(manifests("^"))) {
        await write(join(cwd, path), contents);
      }
      await run(cwd, ["update"]);
      const updated = await lockfileText(cwd);
      expect(updated).not.toBe(pinned);
      expect(updated).toContain('"a-dep": ["a-dep@1.0.10"');
      expect(updated).toContain('"no-deps": ["no-deps@1.1.0"');
      // bun update rewrote the root ranges, and the $ref override follows them.
      expect(updated).toContain('"overrides": {\n    "no-deps": "^1.1.0",\n  }');

      await expectFrozenInstallKeeps(cwd, updated);
    });
  },
);

describe.concurrent("a file: folder listed in both dependencies and devDependencies", () => {
  async function install(cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // the duplicate dependency warning is expected, an error is not
    expect({ args, err, code }).toEqual({ args, err: expect.not.stringContaining("error:"), code: 0 });
    return { out, err };
  }

  // every key of the "packages" object (only package entries have an array value)
  const packageKeys = (lockfile: string) => lockfile.match(/^ {4}"[^"]*": \[/gm);

  it.each(["hoisted", "isolated"] as const)(
    "writes one packages entry and --frozen-lockfile accepts it (%s linker)",
    async linker => {
      using dir = tempDir("dup-folder-dep-", {
        "vendor/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
        "package.json": JSON.stringify({
          name: "app",
          dependencies: { a: "file:./vendor/a" },
          devDependencies: { a: "file:./vendor/a" },
        }),
        "bunfig.toml": Bun.TOML.stringify({ install: { linker } }),
      });
      const lockfilePath = join(String(dir), "bun.lock");

      let { err } = await install(String(dir));
      expect(err).toContain("Saved lockfile");
      const lockfile = await file(lockfilePath).text();
      // One key, not two, because Bun's own lockfile parser rejects a duplicate object key.
      expect(packageKeys(lockfile)).toEqual(['    "a": [']);

      ({ err } = await install(String(dir), "--frozen-lockfile"));
      expect(err).not.toContain("Ignoring lockfile");
      expect(await file(lockfilePath).text()).toBe(lockfile);
    },
  );

  it("keeps one entry when the two groups point at different folders", async () => {
    using dir = tempDir("dup-folder-dep-", {
      "v1/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
      "v2/a/package.json": JSON.stringify({ name: "a", version: "2.0.0" }),
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { a: "file:./v1/a" },
        devDependencies: { a: "file:./v2/a" },
      }),
    });
    const lockfilePath = join(String(dir), "bun.lock");

    await install(String(dir));
    const lockfile = await file(lockfilePath).text();
    expect(packageKeys(lockfile)).toEqual(['    "a": [']);

    const { err } = await install(String(dir), "--frozen-lockfile");
    expect(err).not.toContain("Ignoring lockfile");
    expect(await file(lockfilePath).text()).toBe(lockfile);
  });

  // Installing it twice into the same node_modules folder made the second pass hit EEXIST.
  it("a folder outside the project is installed once", async () => {
    using dir = tempDir("dup-folder-dep-", {
      "a/package.json": JSON.stringify({ name: "a", version: "1.0.0", main: "index.js" }),
      "a/index.js": `module.exports = "a from outside the project";`,
      "app/package.json": JSON.stringify({
        name: "app",
        dependencies: { a: "file:../a" },
        devDependencies: { a: "file:../a" },
      }),
      "app/bunfig.toml": Bun.TOML.stringify({ install: { linker: "hoisted" } }),
    });
    const appDir = join(String(dir), "app");

    await install(appDir);
    expect(packageKeys(await file(join(appDir, "bun.lock")).text())).toEqual(['    "a": [']);

    await using proc = spawn({
      cmd: [bunExe(), "-p", `require("a")`],
      cwd: appDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: out.trim(), err, code }).toEqual({ out: "a from outside the project", err: "", code: 0 });
  });
});

// The dependency lists and `bin` of a `file:` directory dependency are recorded in bun.lock when
// it is first resolved. Later edits to that directory's package.json are diffed against the
// lockfile entry on every install, as they are for workspace packages.
describe.each(["hoisted", "isolated"] as const)(
  "file: directory dependency edited after bun.lock was written (%s linker)",
  linker => {
    const vdir = (extra: Record<string, unknown>) => JSON.stringify({ name: "vdir", version: "1.0.0", ...extra });
    // Reports which version of each package `vdir` resolves from wherever the linker placed it.
    const vdirIndexJs = `module.exports = Object.fromEntries(["no-deps", "a-dep", "no-deps-bins", "basic-1"].map(name => {
    try {
      return [name, require(name + "/package.json").version];
    } catch {
      return [name, null];
    }
  }));`;

    async function createProject(
      declaredBy: "root" | "workspace" | "override",
      vdirExtra: Record<string, unknown> = {},
    ) {
      const { packageDir, packageJson } = await registry.createTestDir({
        bunfigOpts: { saveTextLockfile: true, linker },
        files: {
          "vendor/vdir/package.json": vdir({ dependencies: { "no-deps": "1.0.0" }, ...vdirExtra }),
          "vendor/vdir/index.js": vdirIndexJs,
          ...(declaredBy === "workspace"
            ? {
                "packages/app/package.json": JSON.stringify({
                  name: "app",
                  dependencies: { vdir: "file:../../vendor/vdir" },
                }),
              }
            : {}),
        },
      });
      await write(
        packageJson,
        JSON.stringify(
          {
            root: { name: "root", dependencies: { vdir: "file:./vendor/vdir" } },
            // The root diff visits workspaces first; its other dependencies are compared after the
            // workspace (and the file: package inside it) were parsed into the same buffers.
            workspace: {
              name: "root",
              workspaces: ["packages/*"],
              dependencies: { "basic-1": "1.0.0" },
              devDependencies: { "no-deps-bins": "1.0.0" },
            },
            override: { name: "root", dependencies: { vdir: "1.0.0" }, overrides: { vdir: "file:./vendor/vdir" } },
          }[declaredBy],
        ),
      );
      const lock = () => file(join(packageDir, "bun.lock")).text();
      const bun = async (...args: string[]) => {
        await using proc = spawn({
          cmd: [bunExe(), ...args],
          cwd: packageDir,
          // One cache per project, because the cache directory in the environment takes precedence over bunfig.
          env: { ...env, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { out, err, code };
      };
      const project = {
        packageDir,
        lock,
        editVdir: (extra: Record<string, unknown>) =>
          write(join(packageDir, "vendor", "vdir", "package.json"), vdir(extra)),
        async expectInstallToSaveLockfile() {
          const { out, err, code } = await bun("install");
          expect(err).not.toContain("error:");
          expect(err).toContain("Saved lockfile");
          expect({ out, err, code }).toMatchObject({ code: 0 });
        },
        // No earlier version read the directory again, so lockfiles that are behind it are common. It isn't a failure.
        async expectFrozenLockfileToWarn() {
          const before = await lock();
          const { out, err, code } = await bun("install", "--frozen-lockfile");
          expect(err.split("\n").filter(Boolean)).toEqual([
            "warn: dependencies in vendor/vdir/package.json changed since lockfile was saved (run 'bun install')",
          ]);
          expect(await lock()).toBe(before);
          expect({ out, err, code }).toMatchObject({ code: 0 });
        },
        async expectInstallToBeANoop() {
          const before = await lock();
          for (const args of [["install", "--frozen-lockfile"], ["install"]]) {
            const { out, err, code } = await bun(...args);
            expect(err).not.toContain("error:");
            expect(err).not.toContain("Saved lockfile");
            expect({ out, err, code }).toMatchObject({ code: 0 });
          }
          expect(await lock()).toBe(before);
        },
        async versionsResolvedByVdir() {
          const { out, err, code } = await bun("-p", `JSON.stringify(require("vdir"))`);
          expect({ out, err, code }).toMatchObject({ err: "", code: 0 });
          return JSON.parse(out);
        },
      };

      await project.expectInstallToSaveLockfile();
      expect(await lock()).toContain(
        `"vdir@file:vendor/vdir", { "dependencies": { "no-deps": "1.0.0" }${"scripts" in vdirExtra ? `, "hasInstallScript": true` : ""} }]`,
      );
      return project;
    }

    it.concurrent("an added dependency is installed", async () => {
      const project = await createProject("root");
      expect(await project.versionsResolvedByVdir()).toEqual({
        "no-deps": "1.0.0",
        "a-dep": null,
        "no-deps-bins": null,
        "basic-1": null,
      });

      await project.editVdir({ dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.2" } });
      await project.expectFrozenLockfileToWarn();
      await project.expectInstallToSaveLockfile();

      expect(await project.lock()).toContain(
        `"vdir@file:vendor/vdir", { "dependencies": { "a-dep": "1.0.2", "no-deps": "1.0.0" } }`,
      );
      expect(await project.lock()).toContain(`"a-dep@1.0.2"`);
      expect(await project.versionsResolvedByVdir()).toEqual({
        "no-deps": "1.0.0",
        "a-dep": "1.0.2",
        "no-deps-bins": null,
        "basic-1": null,
      });
      await project.expectInstallToBeANoop();
    });

    it.concurrent("removed, re-ranged, optional and peer dependencies are picked up", async () => {
      const project = await createProject("root");

      await project.editVdir({
        dependencies: { "a-dep": "^1.0.3" },
        optionalDependencies: { "no-deps-bins": "1.0.0" },
        peerDependencies: { "basic-1": "^1.0.0" },
      });
      await project.expectFrozenLockfileToWarn();
      await project.expectInstallToSaveLockfile();

      expect(await project.lock()).toContain(
        `"vdir@file:vendor/vdir", { "dependencies": { "a-dep": "^1.0.3" }, "optionalDependencies": { "no-deps-bins": "1.0.0" }, "peerDependencies": { "basic-1": "^1.0.0" } }`,
      );
      expect(await project.lock()).not.toContain(`"no-deps@`);
      expect(await project.versionsResolvedByVdir()).toMatchObject({
        "a-dep": "1.0.10",
        "no-deps-bins": "1.0.0",
        "basic-1": "1.0.0",
      });
      await project.expectInstallToBeANoop();
    });

    // It isn't a dependency, so a frozen install accepts it.
    it.concurrent("an added bin is recorded and linked", async () => {
      const project = await createProject("root");

      await project.editVdir({ bin: { "vdir-cli": "index.js" }, dependencies: { "no-deps": "1.0.0" } });
      await project.expectInstallToSaveLockfile();

      expect(await project.lock()).toContain(
        `"vdir@file:vendor/vdir", { "dependencies": { "no-deps": "1.0.0" }, "bin": { "vdir-cli": "index.js" } }`,
      );
      expect(Bun.which("vdir-cli", { PATH: join(project.packageDir, "node_modules", ".bin") })).not.toBeNull();
      await project.expectInstallToBeANoop();
    });

    it.concurrent("when declared by a workspace package", async () => {
      const project = await createProject("workspace");

      await project.editVdir({ bin: "index.js", dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.2" } });
      await project.expectFrozenLockfileToWarn();
      await project.expectInstallToSaveLockfile();

      expect(await project.lock()).toContain(
        `"vdir@file:vendor/vdir", { "dependencies": { "a-dep": "1.0.2", "no-deps": "1.0.0" }, "bin": "index.js" }`,
      );
      expect(await project.lock()).toContain(`"a-dep@1.0.2"`);
      // the hoisted linker hoists vdir and its bin to the root, the isolated linker links them into the workspace
      const binDirs = [
        join(project.packageDir, "node_modules", ".bin"),
        join(project.packageDir, "packages", "app", "node_modules", ".bin"),
      ];
      expect(Bun.which("vdir", { PATH: binDirs.join(delimiter) })).not.toBeNull();
      await project.expectInstallToBeANoop();
    });

    it.concurrent("when an override routes a registry dependency to the directory", async () => {
      const project = await createProject("override");

      await project.editVdir({ dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.2" } });
      await project.expectFrozenLockfileToWarn();
      await project.expectInstallToSaveLockfile();

      expect(await project.lock()).toContain(
        `"vdir@file:vendor/vdir", { "dependencies": { "a-dep": "1.0.2", "no-deps": "1.0.0" } }`,
      );
      expect(await project.lock()).toContain(`"a-dep@1.0.2"`);
      await project.expectInstallToBeANoop();
    });

    // bun.lock does not record lifecycle scripts, so they do not count as a difference.
    it.concurrent("an unchanged package.json with a lifecycle script is not resolved again", async () => {
      const project = await createProject("root", { scripts: { postinstall: "echo postinstall" } });

      await project.expectInstallToBeANoop();
    });
  },
);
