import { file, spawn, write } from "bun";
import type { BunLockFile, BunLockFilePackageArray } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { access, copyFile, cp, exists, open, rm, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isWindows,
  readdirSorted,
  runBunInstall,
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
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("Saved bun.lock (69 packages)");

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
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("Saved bun.lock");
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);
  expect(await exited).toBe(0);
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

const isInfo = (x: unknown): boolean => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): boolean => typeof x === "string";

// Classify a `packages` tuple by the schema documented in docs/pm/lockfile.mdx.
// Returns null if the tuple matches no documented shape (schema is incomplete).
function classifyLockEntry(entry: BunLockFilePackageArray): string | null {
  if (!Array.isArray(entry) || !isStr(entry[0])) return null;
  const spec = entry[0].slice(entry[0].lastIndexOf("@") + 1);
  if (spec.startsWith("workspace:")) return entry.length === 1 ? "workspace" : null;
  if (spec.startsWith("root:")) return entry.length === 2 && isInfo(entry[1]) ? "root" : null;
  if (spec.startsWith("git+") || spec.startsWith("github:")) {
    const ok =
      (entry.length === 3 || entry.length === 4) &&
      isInfo(entry[1]) &&
      isStr(entry[2]) &&
      (entry.length === 3 || isStr(entry[3]));
    return ok ? "git" : null;
  }
  if (spec.startsWith("link:")) return entry.length === 2 && isInfo(entry[1]) ? "symlink" : null;
  if (spec.startsWith("file:")) return entry.length === 2 && isInfo(entry[1]) ? "folder" : null;
  if (entry.length === 4 && isStr(entry[1]) && isInfo(entry[2]) && isStr(entry[3])) return "npm";
  if ((entry.length === 2 || entry.length === 3) && isInfo(entry[1]) && (entry.length === 2 || isStr(entry[2])))
    return "tarball";
  return null;
}

// Generates a real bun.lock over local resolution kinds (no registry needed) and
// checks every emitted tuple against the documented schema. npm/git/github shapes
// are covered by the bun-types fixture and the snapshot corpus.
it("writes package entries that all match the documented schema", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();

  await copyFile(join(__dirname, "bar-0.0.2.tgz"), join(packageDir, "bar-0.0.2.tgz"));
  await write(
    join(packageDir, "local-folder-dep", "package.json"),
    JSON.stringify({ name: "local-folder-dep", version: "1.0.0" }),
  );
  await write(
    join(packageDir, "packages", "ws-pkg", "package.json"),
    JSON.stringify({ name: "ws-pkg", version: "2.0.0" }),
  );
  await writeFile(
    packageJson,
    JSON.stringify({
      name: "schema-fixture",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: {
        "dummy-tarball": "file:./bar-0.0.2.tgz", // tarball
        "local-folder-dep": "file:./local-folder-dep", // folder
        "ws-pkg": "workspace:*", // workspace
      },
    }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

  const lock = Bun.JSONC.parse(await file(join(packageDir, "bun.lock")).text()) as BunLockFile;

  // Every generated package entry must match a documented shape.
  const unclassified: Record<string, BunLockFilePackageArray> = {};
  const kinds = new Map<string, string>();
  for (const [name, entry] of Object.entries(lock.packages)) {
    const kind = classifyLockEntry(entry);
    if (kind === null) unclassified[name] = entry;
    else kinds.set(name, kind);
  }
  expect(unclassified).toEqual({});

  const observed = new Set(kinds.values());
  expect([...observed].sort()).toEqual(expect.arrayContaining(["folder", "tarball", "workspace"]));

  // The local tarball entry carries a trailing integrity (the 3-element form
  // that neither the docs nor the TypeScript type described before this change).
  const tarballName = [...kinds].find(([, kind]) => kind === "tarball")?.[0];
  expect(tarballName).toBeDefined();
  const tarball = lock.packages[tarballName!] as [string, unknown, string];
  expect(tarball).toHaveLength(3);
  expect(tarball[2]).toMatch(/^sha\d+-/);
});
