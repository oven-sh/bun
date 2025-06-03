import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { rm, writeFile, exists, cp } from "fs/promises";
import { write, file, spawn } from "bun";
import { join } from "path";
import {
  VerdaccioRegistry,
  bunExe,
  bunEnv as env,
  runBunInstall,
  assertManifestsPopulated,
  toBeValidBin,
  isWindows,
} from "harness";

expect.extend({
  toBeValidBin,
});

let registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});
afterAll(() => {
  registry.stop();
});

describe("binaries", () => {
  for (const global of [false, true]) {
    describe(`existing destinations${global ? " (global)" : ""}`, () => {
      test("existing non-symlink", async () => {
        const { packageJson, packageDir } = await registry.createTestDir();
        await Promise.all([
          write(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                "what-bin": "1.0.0",
              },
            }),
          ),
          write(join(packageDir, "node_modules", ".bin", "what-bin"), "hi"),
        ]);

        await runBunInstall(env, packageDir);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

        expect(join(packageDir, "node_modules", ".bin", "what-bin")).toBeValidBin(
          join("..", "what-bin", "what-bin.js"),
        );
      });
    });
  }
  test("it should correctly link binaries after deleting node_modules", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    const json: any = {
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "what-bin": "1.0.0",
        "uses-what-bin": "1.5.0",
      },
    };
    await writeFile(packageJson, JSON.stringify(json));

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      expect.stringContaining("+ uses-what-bin@1.5.0"),
      expect.stringContaining("+ what-bin@1.0.0"),
      "",
      "3 packages installed",
      "",
      "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
      "",
    ]);
    expect(await exited).toBe(0);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).not.toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      expect.stringContaining("+ uses-what-bin@1.5.0"),
      expect.stringContaining("+ what-bin@1.0.0"),
      "",
      "3 packages installed",
      "",
      "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
      "",
    ]);
    expect(await exited).toBe(0);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());
  });

  test("will link binaries for packages installed multiple times", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.5.0",
          },
          workspaces: ["packages/*"],
          trustedDependencies: ["uses-what-bin"],
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
        }),
      ),
    ]);

    // Root dependends on `uses-what-bin@1.5.0` and both packages depend on `uses-what-bin@1.0.0`.
    // This test makes sure the binaries used by `pkg1` and `pkg2` are the correct version (`1.0.0`)
    // instead of using the root version (`1.5.0`).

    await runBunInstall(env, packageDir);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    const results = await Promise.all([
      file(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt")).text(),
      file(join(packageDir, "packages", "pkg1", "node_modules", "uses-what-bin", "what-bin.txt")).text(),
      file(join(packageDir, "packages", "pkg2", "node_modules", "uses-what-bin", "what-bin.txt")).text(),
    ]);

    expect(results).toEqual(["what-bin@1.5.0", "what-bin@1.0.0", "what-bin@1.0.0"]);
  });

  test("it should re-symlink binaries that become invalid when updating package versions", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await writeFile(
      packageJson,
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "bin-change-dir": "1.0.0",
        },
        scripts: {
          postinstall: "bin-change-dir",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      expect.stringContaining("+ bin-change-dir@1.0.0"),
      "",
      "1 package installed",
    ]);
    expect(await exited).toBe(0);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(join(packageDir, "bin-1.0.0.txt")).text()).toEqual("success!");
    expect(await exists(join(packageDir, "bin-1.0.1.txt"))).toBeFalse();

    await writeFile(
      packageJson,
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "bin-change-dir": "1.0.1",
        },
        scripts: {
          postinstall: "bin-change-dir",
        },
      }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      expect.stringContaining("+ bin-change-dir@1.0.1"),
      "",
      "1 package installed",
    ]);
    expect(await exited).toBe(0);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(join(packageDir, "bin-1.0.0.txt")).text()).toEqual("success!");
    expect(await file(join(packageDir, "bin-1.0.1.txt")).text()).toEqual("success!");
  });

  test("will only link global binaries for requested packages", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `
      [install]
      cache = false
      registry = "http://localhost:${registry.port}/"
      globalBinDir = "${join(packageDir, "global-bin-dir").replace(/\\/g, "\\\\")}"
      `,
      ),
      ,
    ]);

    let { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "i", "-g", `--config=${join(packageDir, "bunfig.toml")}`, "uses-what-bin"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL: join(packageDir, "global-install-dir") },
    });

    let err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    let out = await Bun.readableStreamToText(stdout);
    expect(out).toContain("uses-what-bin@1.5.0");
    expect(await exited).toBe(0);

    expect(await exists(join(packageDir, "global-bin-dir", "what-bin"))).toBeFalse();

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "i", "-g", `--config=${join(packageDir, "bunfig.toml")}`, "what-bin"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL: join(packageDir, "global-install-dir") },
    }));

    err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    out = await Bun.readableStreamToText(stdout);

    expect(out).toContain("what-bin@1.5.0");
    expect(await exited).toBe(0);

    // now `what-bin` should be installed in the global bin directory
    if (isWindows) {
      expect(
        await Promise.all([
          exists(join(packageDir, "global-bin-dir", "what-bin.exe")),
          exists(join(packageDir, "global-bin-dir", "what-bin.bunx")),
        ]),
      ).toEqual([true, true]);
    } else {
      expect(await exists(join(packageDir, "global-bin-dir", "what-bin"))).toBeTrue();
    }
  });

  for (const global of [false, true]) {
    test(`bin types${global ? " (global)" : ""}`, async () => {
      const { packageJson, packageDir } = await registry.createTestDir();
      if (global) {
        await write(
          join(packageDir, "bunfig.toml"),
          `
          [install]
          cache = false
          registry = "http://localhost:${registry.port}/"
          globalBinDir = "${join(packageDir, "global-bin-dir").replace(/\\/g, "\\\\")}"
          `,
        );
      } else {
        await write(
          packageJson,
          JSON.stringify({
            name: "foo",
          }),
        );
      }

      const args = [
        bunExe(),
        "install",
        ...(global ? ["-g"] : []),
        ...(global ? [`--config=${join(packageDir, "bunfig.toml")}`] : []),
        "dep-with-file-bin",
        "dep-with-single-entry-map-bin",
        "dep-with-directory-bins",
        "dep-with-map-bins",
      ];
      const { stdout, stderr, exited } = spawn({
        cmd: args,
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: global ? { ...env, BUN_INSTALL: join(packageDir, "global-install-dir") } : env,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).not.toContain("error:");

      const out = await Bun.readableStreamToText(stdout);
      expect(await exited).toBe(0);

      await runBin("dep-with-file-bin", "file-bin\n", global, packageDir);
      await runBin("single-entry-map-bin", "single-entry-map-bin\n", global, packageDir);
      await runBin("directory-bin-1", "directory-bin-1\n", global, packageDir);
      await runBin("directory-bin-2", "directory-bin-2\n", global, packageDir);
      await runBin("map-bin-1", "map-bin-1\n", global, packageDir);
      await runBin("map-bin-2", "map-bin-2\n", global, packageDir);
    });
  }

  test("each type of binary serializes correctly to text lockfile", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.1.1",
          dependencies: {
            "file-bin": "./file-bin",
            "named-file-bin": "./named-file-bin",
            "dir-bin": "./dir-bin",
            "map-bin": "./map-bin",
          },
        }),
      ),
      write(
        join(packageDir, "file-bin", "package.json"),
        JSON.stringify({
          name: "file-bin",
          version: "1.1.1",
          bin: "./file-bin.js",
        }),
      ),
      write(join(packageDir, "file-bin", "file-bin.js"), `#!/usr/bin/env node\nconsole.log("file-bin")`),
      write(
        join(packageDir, "named-file-bin", "package.json"),
        JSON.stringify({
          name: "named-file-bin",
          version: "1.1.1",
          bin: { "named-file-bin": "./named-file-bin.js" },
        }),
      ),
      write(
        join(packageDir, "named-file-bin", "named-file-bin.js"),
        `#!/usr/bin/env node\nconsole.log("named-file-bin")`,
      ),
      write(
        join(packageDir, "dir-bin", "package.json"),
        JSON.stringify({
          name: "dir-bin",
          version: "1.1.1",
          directories: {
            bin: "./bins",
          },
        }),
      ),
      write(join(packageDir, "dir-bin", "bins", "dir-bin-1.js"), `#!/usr/bin/env node\nconsole.log("dir-bin-1")`),
      write(
        join(packageDir, "map-bin", "package.json"),
        JSON.stringify({
          name: "map-bin",
          version: "1.1.1",
          bin: {
            "map-bin-1": "./map-bin-1.js",
            "map-bin-2": "./map-bin-2.js",
          },
        }),
      ),
      write(join(packageDir, "map-bin", "map-bin-1.js"), `#!/usr/bin/env node\nconsole.log("map-bin-1")`),
      write(join(packageDir, "map-bin", "map-bin-2.js"), `#!/usr/bin/env node\nconsole.log("map-bin-2")`),
    ]);

    let { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--save-text-lockfile"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });

    let err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");

    expect(await exited).toBe(0);

    const firstLockfile = (await Bun.file(join(packageDir, "bun.lock")).text()).replaceAll(
      /localhost:\d+/g,
      "localhost:1234",
    );

    expect(join(packageDir, "node_modules", ".bin", "file-bin")).toBeValidBin(join("..", "file-bin", "file-bin.js"));
    expect(join(packageDir, "node_modules", ".bin", "named-file-bin")).toBeValidBin(
      join("..", "named-file-bin", "named-file-bin.js"),
    );
    expect(join(packageDir, "node_modules", ".bin", "dir-bin-1.js")).toBeValidBin(
      join("..", "dir-bin", "bins", "dir-bin-1.js"),
    );
    expect(join(packageDir, "node_modules", ".bin", "map-bin-1")).toBeValidBin(join("..", "map-bin", "map-bin-1.js"));
    expect(join(packageDir, "node_modules", ".bin", "map-bin-2")).toBeValidBin(join("..", "map-bin", "map-bin-2.js"));

    await rm(join(packageDir, "node_modules", ".bin"), { recursive: true, force: true });

    // now install from the lockfile, only linking bins
    ({ stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    }));

    err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    expect(err).not.toContain("Saved lockfile");

    expect(await exited).toBe(0);

    expect(firstLockfile).toBe(
      (await Bun.file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"),
    );
    expect(firstLockfile).toMatchSnapshot();

    expect(join(packageDir, "node_modules", ".bin", "file-bin")).toBeValidBin(join("..", "file-bin", "file-bin.js"));
    expect(join(packageDir, "node_modules", ".bin", "named-file-bin")).toBeValidBin(
      join("..", "named-file-bin", "named-file-bin.js"),
    );
    expect(join(packageDir, "node_modules", ".bin", "dir-bin-1.js")).toBeValidBin(
      join("..", "dir-bin", "bins", "dir-bin-1.js"),
    );
    expect(join(packageDir, "node_modules", ".bin", "map-bin-1")).toBeValidBin(join("..", "map-bin", "map-bin-1.js"));
    expect(join(packageDir, "node_modules", ".bin", "map-bin-2")).toBeValidBin(join("..", "map-bin", "map-bin-2.js"));
  });

  test.todo("text lockfile updates with new bin entry for folder dependencies", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "change-bin": "./change-bin",
          },
        }),
      ),
      write(
        join(packageDir, "change-bin", "package.json"),
        JSON.stringify({
          name: "change-bin",
          version: "1.0.0",
          bin: {
            "change-bin-1": "./change-bin-1.js",
          },
        }),
      ),
      write(join(packageDir, "change-bin", "change-bin-1.js"), `#!/usr/bin/env node\nconsole.log("change-bin-1")`),
    ]);

    let { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--save-text-lockfile"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });

    let err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");

    expect(await exited).toBe(0);

    const firstLockfile = (await Bun.file(join(packageDir, "bun.lock")).text()).replaceAll(
      /localhost:\d+/g,
      "localhost:1234",
    );

    expect(join(packageDir, "node_modules", ".bin", "change-bin-1")).toBeValidBin(
      join("..", "change-bin", "change-bin-1.js"),
    );

    await Promise.all([
      write(
        join(packageDir, "change-bin", "package.json"),
        JSON.stringify({
          name: "change-bin",
          version: "1.0.0",
          bin: {
            "change-bin-1": "./change-bin-1.js",
            "change-bin-2": "./change-bin-2.js",
          },
        }),
      ),
      write(join(packageDir, "change-bin", "change-bin-2.js"), `#!/usr/bin/env node\nconsole.log("change-bin-2")`),
    ]);

    ({ stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    }));

    err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");

    // it should save
    expect(err).toContain("Saved lockfile");

    expect(await exited).toBe(0);

    const secondLockfile = (await Bun.file(join(packageDir, "bun.lock")).text()).replaceAll(
      /localhost:\d+/g,
      "localhost:1234",
    );
    expect(firstLockfile).not.toBe(secondLockfile);

    expect(secondLockfile).toMatchSnapshot();

    expect(join(packageDir, "node_modules", ".bin", "change-bin-1")).toBeValidBin(
      join("..", "change-bin", "change-bin-1.js"),
    );

    expect(join(packageDir, "node_modules", ".bin", "change-bin-2")).toBeValidBin(
      join("..", "change-bin", "change-bin-2.js"),
    );
  });

  test("root resolution bins", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    // As of writing this test, the only way to get a root resolution
    // is to migrate a package-lock.json with a root resolution. For now,
    // we'll just mock the bun.lock.

    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "fooooo",
          version: "2.2.2",
          dependencies: {
            "fooooo": ".",
            "no-deps": "1.0.0",
          },
          bin: "fooooo.js",
        }),
      ),
      write(join(packageDir, "fooooo.js"), `#!/usr/bin/env node\nconsole.log("fooooo")`),
      write(
        join(packageDir, "bun.lock"),
        JSON.stringify({
          "lockfileVersion": 0,
          "workspaces": {
            "": {
              "name": "fooooo",
              "dependencies": {
                "fooooo": ".",
                // out of date, no no-deps
              },
            },
          },
          "packages": {
            "fooooo": ["fooooo@root:", { bin: "fooooo.js" }],
          },
        }),
      ),
    ]);

    let { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    let err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");

    let out = await Bun.readableStreamToText(stdout);
    expect(out).toContain("no-deps@1.0.0");

    expect(await exited).toBe(0);

    const firstLockfile = (await Bun.file(join(packageDir, "bun.lock")).text()).replaceAll(
      /localhost:\d+/g,
      "localhost:1234",
    );

    expect(join(packageDir, "node_modules", ".bin", "fooooo")).toBeValidBin(join("..", "fooooo", "fooooo.js"));

    await rm(join(packageDir, "node_modules", ".bin"), { recursive: true, force: true });

    ({ stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    expect(err).not.toContain("Saved lockfile");

    out = await Bun.readableStreamToText(stdout);
    expect(out).not.toContain("no-deps@1.0.0");

    expect(await exited).toBe(0);

    expect(firstLockfile).toBe(
      (await Bun.file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"),
    );
    expect(firstLockfile).toMatchSnapshot();

    expect(join(packageDir, "node_modules", ".bin", "fooooo")).toBeValidBin(join("..", "fooooo", "fooooo.js"));
  });

  async function runBin(binName: string, expected: string, global: boolean, packageDir: string) {
    const args = global ? [`./global-bin-dir/${binName}`] : [bunExe(), binName];
    const result = Bun.spawn({
      cmd: args,
      stdout: "pipe",
      stderr: "pipe",
      cwd: packageDir,
      env,
    });

    const out = await Bun.readableStreamToText(result.stdout);
    expect(out).toEqual(expected);
    const err = await Bun.readableStreamToText(result.stderr);
    expect(err).toBeEmpty();
    expect(await result.exited).toBe(0);
  }

  test("it will skip (without errors) if a folder from `directories.bin` does not exist", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "missing-directory-bin": "file:missing-directory-bin-1.1.1.tgz",
          },
        }),
      ),
      cp(join(import.meta.dir, "missing-directory-bin-1.1.1.tgz"), join(packageDir, "missing-directory-bin-1.1.1.tgz")),
    ]);

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
  });
});
