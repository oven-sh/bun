import { file, write, spawn } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { beforeEach, describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { cp, mkdir, rm, exists } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  runBunInstall,
  toMatchNodeModulesAt,
  assertManifestsPopulated,
  VerdaccioRegistry,
  readdirSorted,
} from "harness";
import { join } from "path";
const { parseLockfile } = install_test_helpers;

expect.extend({ toMatchNodeModulesAt });

// not necessary, but verdaccio will be added to this file in the near future

var verdaccio: VerdaccioRegistry;
var packageDir: string;
var packageJson: string;

beforeAll(async () => {
  verdaccio = new VerdaccioRegistry();
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

beforeEach(async () => {
  ({ packageDir, packageJson } = await verdaccio.createTestDir());
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
});

test("dependency on workspace without version in package.json", async () => {
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
    rmSync(join(packageDir, "bun.lockb"), { recursive: true, force: true });
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
    rmSync(join(packageDir, "bun.lockb"), { recursive: true, force: true });
  }
}, 20_000);

test("dependency on same name as workspace and dist-tag", async () => {
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

test("successfully installs workspace when path already exists in node_modules", async () => {
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

test("adding workspace in workspace edits package.json with correct version (workspace:*)", async () => {
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
  const out = await Bun.readableStreamToText(stdout);

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

test("workspaces with invalid versions should still install", async () => {
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
  test("combination", async () => {
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
    test(`version range ${version} and workspace with no version`, async () => {
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
    test(`version range ${version} and workspace with no version (should fail)`, async () => {
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

      const err = await Bun.readableStreamToText(stderr);
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
  test(`does not crash when root package.json is in "workspaces"${glob ? " (glob)" : ""}`, async () => {
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

test("cwd in workspace script is not the symlink path on windows", async () => {
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
  test("from package.json", async () => {
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
  test("from cli", async () => {
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

    const err = await Bun.readableStreamToText(stderr);
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
});

test("$npm_package_config_ works in root", async () => {
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
test("$npm_package_config_ works in root in subpackage", async () => {
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

test("adding packages in a subdirectory of a workspace", async () => {
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
  let out = await Bun.readableStreamToText(stdout);
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
  out = await Bun.readableStreamToText(stdout);
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

  // now delete node_modules and bun.lockb and install
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "bun.lockb"));

  ({ stdout, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "folder1"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  }));
  out = await Bun.readableStreamToText(stdout);
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
  await rm(join(packageDir, "bun.lockb"));

  ({ stdout, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "foo", "folder2"),
    stdout: "pipe",
    stderr: "inherit",
    env,
  }));
  out = await Bun.readableStreamToText(stdout);
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
test("adding packages in workspaces", async () => {
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

  let out = await Bun.readableStreamToText(stdout);
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

  out = await Bun.readableStreamToText(stdout);
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

  out = await Bun.readableStreamToText(stdout);
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

  out = await Bun.readableStreamToText(stdout);
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
test("it should detect duplicate workspace dependencies", async () => {
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

  var err = await new Response(stderr).text();
  expect(err).toContain('Workspace name "pkg1" already exists');
  expect(await exited).toBe(1);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "bun.lockb"), { force: true });

  ({ stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "packages", "pkg1"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  expect(err).toContain('Workspace name "pkg1" already exists');
  expect(await exited).toBe(1);
});

const versions = ["workspace:1.0.0", "workspace:*", "workspace:^1.0.0", "1.0.0", "*"];

for (const rootVersion of versions) {
  for (const packageVersion of versions) {
    test(`it should allow duplicates, root@${rootVersion}, package@${packageVersion}`, async () => {
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

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
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

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
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
      await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "pkg1"),
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

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
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
  test(`it should allow listing workspace as dependency of the root package version ${version}`, async () => {
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

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
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

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
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
    await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });

    // install from workspace package then from root
    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: join(packageDir, "packages", "workspace-1"),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
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

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
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
  });
}

describe("install --filter", () => {
  test("does not run root scripts if root is filtered out", async () => {
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

  test("basic", async () => {
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

  test("all but one or two", async () => {
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

  test("matched workspace depends on filtered workspace", async () => {
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

  test("filter with a path", async () => {
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
});
