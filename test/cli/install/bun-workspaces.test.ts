import { spawnSync, write, file } from "bun";
import { bunExe, bunEnv as env, runBunInstall, tmpdirSync, toMatchNodeModulesAt } from "harness";
import { join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { beforeEach, test, expect, describe } from "bun:test";
import { install_test_helpers } from "bun:internal-for-testing";
const { parseLockfile } = install_test_helpers;

expect.extend({ toMatchNodeModulesAt });

var testCounter: number = 0;

// not necessary, but verdaccio will be added to this file in the near future
var port: number = 4873;
var packageDir: string;

beforeEach(() => {
  packageDir = tmpdirSync();
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
  writeFileSync(
    join(packageDir, "bunfig.toml"),
    `
[install]
cache = false
`,
  );
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
        name: "lodash",
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
    "1.1.1",
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
          lodash: version,
        },
      }),
    );

    const { out } = await runBunInstall(env, packageDir);
    const lockfile = parseLockfile(packageDir);
    expect(lockfile).toMatchNodeModulesAt(packageDir);
    expect(lockfile).toMatchSnapshot(`version: ${version}`);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "2 packages installed"]);
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
          lodash: version,
        },
      }),
    );

    const { out } = await runBunInstall(env, packageDir);
    const lockfile = parseLockfile(packageDir);
    expect(lockfile).toMatchNodeModulesAt(packageDir);
    expect(lockfile).toMatchSnapshot(`version: ${version}`);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "3 packages installed"]);
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
        name: "lodash",
        version: "4.17.21",
      }),
    ),

    write(
      join(packageDir, "packages", "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        version: "1.0.0",
        dependencies: {
          lodash: "latest",
        },
      }),
    ),
  ]);

  const { out } = await runBunInstall(env, packageDir);
  const lockfile = parseLockfile(packageDir);
  expect(lockfile).toMatchSnapshot("with version");
  expect(lockfile).toMatchNodeModulesAt(packageDir);
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "3 packages installed"]);
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

    console.log({ packageDir });

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
