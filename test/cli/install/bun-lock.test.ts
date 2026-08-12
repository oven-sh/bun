import { file, spawn, write } from "bun";
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
  // cleared optional-peer slot re-derives to the same value hoist produced on
  // fresh install.
  await run(["install"]);
  expect(await file(join(packageDir, "bun.lock")).text()).toBe(first);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await run(["install", "--frozen-lockfile"]);
});

// Minimal gzipped tarball with a single root folder wrapping the files, the
// shape of both github codeload tarballs and npm pack tarballs.
function makeTarball(rootDir: string, files: Record<string, string>): Uint8Array {
  function tarHeader(name: string, size: number, isDir: boolean): Uint8Array {
    const header = new Uint8Array(512);
    const encoder = new TextEncoder();
    header.set(encoder.encode(name), 0);
    header.set(encoder.encode(isDir ? "0000755 " : "0000644 "), 100);
    header.set(encoder.encode("0000000 "), 108);
    header.set(encoder.encode("0000000 "), 116);
    header.set(encoder.encode(size.toString(8).padStart(11, "0") + " "), 124);
    header.set(encoder.encode("00000000000 "), 136);
    header.set(encoder.encode("        "), 148);
    header[156] = (isDir ? "5" : "0").charCodeAt(0);
    header.set(encoder.encode("ustar"), 257);
    header.set(encoder.encode("00"), 263);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.set(encoder.encode(checksum.toString(8).padStart(6, "0") + "\0 "), 148);
    return header;
  }
  const blocks: Uint8Array[] = [];
  blocks.push(tarHeader(`${rootDir}/`, 0, true));
  for (const [name, contents] of Object.entries(files)) {
    const bytes = new TextEncoder().encode(contents);
    blocks.push(tarHeader(`${rootDir}/${name}`, bytes.length, false));
    blocks.push(bytes);
    if (bytes.length % 512 !== 0) blocks.push(new Uint8Array(512 - (bytes.length % 512)));
  }
  blocks.push(new Uint8Array(1024));
  return Bun.gzipSync(Buffer.concat(blocks));
}

// Isolate git from system/global config (e.g. core.autocrlf on Windows).
async function makeGitFixture(packageDir: string) {
  const gitEnv = {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(packageDir, "gitconfig"),
    GIT_AUTHOR_NAME: "bun-test",
    GIT_AUTHOR_EMAIL: "test@bun.sh",
    GIT_COMMITTER_NAME: "bun-test",
    GIT_COMMITTER_EMAIL: "test@bun.sh",
  };
  async function git(args: string[], cwd: string): Promise<string> {
    await using proc = spawn({ cmd: ["git", ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("fatal:");
    expect(code).toBe(0);
    return out;
  }
  await write(join(packageDir, "gitconfig"), "[core]\n\tautocrlf = false\n");
  return { gitEnv, git };
}

// The text lockfile writes the resolved commit in the committish position of a
// git/github resolution string ("git+url#<sha>"), so after a lockfile round
// trip a dependency naming a branch or tag (or no ref at all) never matches the
// loaded committish again. Re-resolving (any edit that re-parses a workspace
// member's dependency list) then fetched every such dependency from the remote
// on every install. The identical dependency literal already bound in the
// loaded lockfile must be reused instead.
it("re-resolving reuses branch and bare ref git dependencies from the lockfile instead of re-fetching", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const { gitEnv, git } = await makeGitFixture(packageDir);

  // Bare repos served over git's dumb HTTP protocol: after
  // `git update-server-info`, a bare repo is plain static files.
  async function makeBareRepo(name: string): Promise<string> {
    const srcDir = join(packageDir, `${name}-src`);
    await write(join(srcDir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    await write(join(srcDir, "index.js"), `module.exports = '${name}';\n`);
    await git(["init", "-q", "-b", "main"], srcDir);
    await git(["add", "-A"], srcDir);
    await git(["commit", "-qm", "init"], srcDir);
    const sha = (await git(["rev-parse", "HEAD"], srcDir)).trim();
    await git(["clone", "-q", "--bare", srcDir, join(packageDir, `${name}.git`)], packageDir);
    await git(["update-server-info"], join(packageDir, `${name}.git`));
    return sha;
  }
  const bareSha = await makeBareRepo("bare-dep");
  const branchSha = await makeBareRepo("branch-dep");

  let bareRequests = 0;
  let branchRequests = 0;
  await using gitServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      const match = pathname.match(/^\/((?:bare|branch)-dep\.git)\/(.+)$/);
      if (!match) return new Response("not found", { status: 404 });
      if (match[1] === "bare-dep.git") bareRequests++;
      else branchRequests++;
      const f = file(join(packageDir, match[1], match[2]));
      return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
    },
  });

  const ghTarball = makeTarball("testowner-testrepo-aaaaaaa", {
    "package.json": JSON.stringify({ name: "gh-dep", version: "1.0.0" }),
    "index.js": "module.exports = 'gh';\n",
  });
  let githubDownloads = 0;
  await using ghServer = Bun.serve({
    port: 0,
    fetch() {
      githubDownloads++;
      return new Response(ghTarball, { headers: { "Content-Type": "application/gzip" } });
    },
  });

  const installEnv = {
    ...gitEnv,
    GITHUB_API_URL: `http://localhost:${ghServer.port}`,
    // CI exports BUN_INSTALL_CACHE_DIR; pin it so this test's cache is its own.
    BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
  };
  async function install(retries = 1) {
    const bareRequestsBefore = bareRequests;
    const branchRequestsBefore = branchRequests;
    const githubDownloadsBefore = githubDownloads;
    await using proc = spawn({
      // Explicit linker: the cold-cache stage below regresses only under the
      // isolated linker's store (its entry waits on the locked commit's
      // checkout id).
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [err, code] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    // A loaded CI machine can OOM-kill the spawned git child (SIGKILL); that
    // is environmental, not the behavior under test. A kill between git clone
    // and git checkout leaves a half-created cache folder the next attempt
    // would trust, so retry from a clean cache, with the counters restored to
    // the aborted attempt's baseline.
    if (retries > 0 && err.includes("git failed with signal 9")) {
      await rm(installEnv.BUN_INSTALL_CACHE_DIR, { recursive: true, force: true });
      bareRequests = bareRequestsBefore;
      branchRequests = branchRequestsBefore;
      githubDownloads = githubDownloadsBefore;
      return install(retries - 1);
    }
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
  }

  // The installs are staged so at most one git clone runs at a time: loaded
  // CI machines reliably OOM-kill one of two concurrent git children under an
  // ASAN build. Each stage edits the member, which re-parses its whole
  // dependency list and re-resolves the dependencies added by earlier stages.
  await write(packageJson, JSON.stringify({ name: "ws-root", workspaces: ["packages/*"] }));
  const memberPackageJson = join(packageDir, "packages", "member", "package.json");
  const memberDeps: Record<string, string> = {
    "bare-dep": `git+http://127.0.0.1:${gitServer.port}/bare-dep.git`,
  };
  async function writeMember() {
    await write(memberPackageJson, JSON.stringify({ name: "member", version: "1.0.0", dependencies: memberDeps }));
  }
  await writeMember();
  await write(
    join(packageDir, "packages", "member", "dummy", "package.json"),
    JSON.stringify({ name: "dummy", version: "1.0.0" }),
  );

  await install();
  expect(bareRequests).toBeGreaterThan(0);
  const lock = await file(join(packageDir, "bun.lock")).text();
  expect(lock).toContain(`bare-dep@git+http://127.0.0.1:${gitServer.port}/bare-dep.git#${bareSha}`);

  // Adding dependencies to the member re-resolves bare-dep; its bare ref must
  // bind to the loaded package without contacting the remote again.
  memberDeps["branch-dep"] = `git+http://127.0.0.1:${gitServer.port}/branch-dep.git#main`;
  memberDeps["gh-dep"] = "github:testowner/testrepo#main";
  await writeMember();
  const bareRequestsAfterFirstInstall = bareRequests;
  await install();
  expect(bareRequests).toBe(bareRequestsAfterFirstInstall);
  expect(branchRequests).toBeGreaterThan(0);
  expect(githubDownloads).toBeGreaterThan(0);
  const lockSecond = await file(join(packageDir, "bun.lock")).text();
  expect(lockSecond).toContain(`branch-dep@git+http://127.0.0.1:${gitServer.port}/branch-dep.git#${branchSha}`);

  // Another member edit re-resolves all three; none may go to the network.
  memberDeps["dummy"] = "file:./dummy";
  await writeMember();
  const snapshot = { bareRequests, branchRequests, githubDownloads };
  await install();
  expect({ bareRequests, branchRequests, githubDownloads }).toEqual(snapshot);

  // The locked commits did not move.
  const lockAfter = await file(join(packageDir, "bun.lock")).text();
  expect(lockAfter).toContain(`bare-dep@git+http://127.0.0.1:${gitServer.port}/bare-dep.git#${bareSha}`);
  expect(lockAfter).toContain(`branch-dep@git+http://127.0.0.1:${gitServer.port}/branch-dep.git#${branchSha}`);
  const memberModules = join(packageDir, "packages", "member", "node_modules");
  expect(await file(join(memberModules, "bare-dep", "index.js")).text()).toBe("module.exports = 'bare-dep';\n");
  expect(await file(join(memberModules, "branch-dep", "index.js")).text()).toBe("module.exports = 'branch-dep';\n");
  expect(await file(join(memberModules, "gh-dep", "index.js")).text()).toBe("module.exports = 'gh';\n");

  // Changing a dependency's ref is the boundary the reuse must not cross: a
  // different literal consults the remote again (here the same commit wins,
  // so only the request counter moves).
  memberDeps["branch-dep"] = `git+http://127.0.0.1:${gitServer.port}/branch-dep.git`;
  await writeMember();
  const beforeRefChange = { bareRequests, branchRequests, githubDownloads };
  await install();
  expect(branchRequests).toBeGreaterThan(beforeRefChange.branchRequests);
  expect({ bareRequests, githubDownloads }).toEqual({
    bareRequests: beforeRefChange.bareRequests,
    githubDownloads: beforeRefChange.githubDownloads,
  });
  expect(await file(join(packageDir, "bun.lock")).text()).toContain(`branch-dep.git#${branchSha}`);

  // Cold cache with a moved branch head: the lockfile pin must win and the
  // install must terminate. The isolated store waits on the locked commit's
  // checkout; a re-enqueued dependency that follows the moved ref instead of
  // the bound package's commit starves it forever (and without the reuse the
  // pin silently floats to the new head).
  const branchSrc = join(packageDir, "branch-dep-src");
  await write(join(branchSrc, "index.js"), "module.exports = 'branch-dep-v2';\n");
  await git(["add", "-A"], branchSrc);
  await git(["commit", "-qm", "move"], branchSrc);
  const movedSha = (await git(["rev-parse", "HEAD"], branchSrc)).trim();
  await git(["fetch", "-q", branchSrc, "+refs/heads/*:refs/heads/*"], join(packageDir, "branch-dep.git"));
  await git(["update-server-info"], join(packageDir, "branch-dep.git"));

  // Drop every git dependency except the one under test so the cold install
  // runs a single clone chain (see the staging note above).
  delete memberDeps["dummy"];
  delete memberDeps["bare-dep"];
  await writeMember();
  await rm(installEnv.BUN_INSTALL_CACHE_DIR, { recursive: true, force: true });
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(memberModules, { recursive: true, force: true });
  await install();
  const lockCold = await file(join(packageDir, "bun.lock")).text();
  expect(lockCold).toContain(`branch-dep.git#${branchSha}`);
  expect(lockCold).not.toContain(movedSha);
  expect(await file(join(memberModules, "branch-dep", "index.js")).text()).toBe("module.exports = 'branch-dep';\n");
  // Five staged installs plus a git-child-kill retry exceed the 5s default;
  // this also bounds the cold-cache starvation mode to a fast failure.
}, 90_000);

// `bun update` must keep going to the remote for a branch-tracking ref: the
// reuse above is explicitly skipped for update targets.
it("`bun update` still re-resolves a branch ref git dependency against the remote", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const { gitEnv, git } = await makeGitFixture(packageDir);

  const srcDir = join(packageDir, "git-src");
  const bareDir = join(packageDir, "repo.git");
  await write(join(srcDir, "package.json"), JSON.stringify({ name: "git-dep", version: "1.0.0" }));
  await git(["init", "-q", "-b", "main"], srcDir);
  await git(["add", "-A"], srcDir);
  await git(["commit", "-qm", "init"], srcDir);
  await git(["clone", "-q", "--bare", srcDir, bareDir], packageDir);
  await git(["update-server-info"], bareDir);

  let gitRequests = 0;
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      gitRequests++;
      const { pathname } = new URL(req.url);
      if (!pathname.startsWith("/repo.git/")) return new Response("not found", { status: 404 });
      const f = file(join(bareDir, pathname.slice("/repo.git/".length)));
      return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
    },
  });

  const installEnv = {
    ...gitEnv,
    BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
  };
  async function run(args: string[], retries = 1) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: packageDir,
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [err, code] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    // A loaded CI machine can OOM-kill the spawned git child (SIGKILL); retry
    // from a clean cache (a kill between clone and checkout leaves a
    // half-created folder the next attempt would trust). Retrying only ever
    // adds requests, so the requests-increase assertion holds.
    if (retries > 0 && err.includes("git failed with signal 9")) {
      await rm(installEnv.BUN_INSTALL_CACHE_DIR, { recursive: true, force: true });
      return run(args, retries - 1);
    }
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
  }

  await write(
    packageJson,
    JSON.stringify({
      name: "git-update-root",
      dependencies: { "git-dep": `git+http://127.0.0.1:${server.port}/repo.git#main` },
    }),
  );

  await run(["install"]);
  const requestsAfterInstall = gitRequests;
  expect(requestsAfterInstall).toBeGreaterThan(0);

  await run(["update", "git-dep"]);
  expect(gitRequests).toBeGreaterThan(requestsAfterInstall);
}, 60_000);

// A changed override or catalog entry that moves a git dependency to a
// different ref of the same repository must re-resolve every dependent.
// Several dependencies sharing one name is the interesting case: the reuse
// above must not rebind a cleared dependency to a sibling's not-yet-cleared
// binding from the old entry.
async function changedEntryReResolves(mode: "overrides" | "catalog") {
  const { packageDir, packageJson } = await registry.createTestDir();
  const { gitEnv, git } = await makeGitFixture(packageDir);

  const srcDir = join(packageDir, "git-src");
  const bareDir = join(packageDir, "repo.git");
  await write(join(srcDir, "package.json"), JSON.stringify({ name: "over-dep", version: "1.0.0" }));
  await write(join(srcDir, "index.js"), "module.exports = 'V1';\n");
  await git(["init", "-q", "-b", "main"], srcDir);
  await git(["add", "-A"], srcDir);
  await git(["commit", "-qm", "v1"], srcDir);
  await git(["tag", "v1"], srcDir);
  const sha1 = (await git(["rev-parse", "HEAD"], srcDir)).trim();
  await write(join(srcDir, "index.js"), "module.exports = 'V2';\n");
  await git(["add", "-A"], srcDir);
  await git(["commit", "-qm", "v2"], srcDir);
  await git(["tag", "v2"], srcDir);
  const sha2 = (await git(["rev-parse", "HEAD"], srcDir)).trim();
  await git(["clone", "-q", "--bare", srcDir, bareDir], packageDir);
  await git(["update-server-info"], bareDir);

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (!pathname.startsWith("/repo.git/")) return new Response("not found", { status: 404 });
      const f = file(join(bareDir, pathname.slice("/repo.git/".length)));
      return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
    },
  });

  const installEnv = {
    ...gitEnv,
    BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
  };
  async function install(retries = 1) {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [err, code] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    // See the retry note in the re-resolving test above.
    if (retries > 0 && err.includes("git failed with signal 9")) {
      await rm(installEnv.BUN_INSTALL_CACHE_DIR, { recursive: true, force: true });
      return install(retries - 1);
    }
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
  }

  const repoUrl = `git+http://127.0.0.1:${server.port}/repo.git`;
  function rootPackageJson(ref: string) {
    return JSON.stringify(
      mode === "overrides"
        ? {
            name: "ws-root",
            workspaces: ["packages/*"],
            overrides: { "over-dep": `${repoUrl}#${ref}` },
          }
        : {
            name: "ws-root",
            workspaces: { packages: ["packages/*"], catalog: { "over-dep": `${repoUrl}#${ref}` } },
          },
    );
  }
  const memberSpec = mode === "overrides" ? "^1.0.0" : "catalog:";
  await write(packageJson, rootPackageJson("v1"));
  for (const member of ["member-a", "member-b"]) {
    await write(
      join(packageDir, "packages", member, "package.json"),
      JSON.stringify({ name: member, version: "1.0.0", dependencies: { "over-dep": memberSpec } }),
    );
  }

  await install();
  expect(await file(join(packageDir, "bun.lock")).text()).toContain(`#${sha1}`);
  expect(await file(join(packageDir, "node_modules", "over-dep", "index.js")).text()).toBe("module.exports = 'V1';\n");

  await write(packageJson, rootPackageJson("v2"));
  await install();
  const lockAfter = await file(join(packageDir, "bun.lock")).text();
  expect(lockAfter).toContain(`#${sha2}`);
  expect(lockAfter).not.toContain(`#${sha1}`);
  expect(await file(join(packageDir, "node_modules", "over-dep", "index.js")).text()).toBe("module.exports = 'V2';\n");
}

it(
  "a changed git override re-resolves every dependent instead of reusing the old pin",
  () => changedEntryReResolves("overrides"),
  60_000,
);

it(
  "a changed git catalog entry re-resolves every dependent instead of reusing the old pin",
  () => changedEntryReResolves("catalog"),
  60_000,
);
