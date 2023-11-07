import { file, spawn } from "bun";
import { bunExe, bunEnv as env } from "harness";
import { join } from "path";
import { mkdtempSync, realpathSync } from "fs";
import { rm, writeFile, mkdir, exists } from "fs/promises";
import { readdirSorted } from "../dummy.registry";
import { tmpdir } from "os";
import { fork, ChildProcess } from "child_process";
import { beforeAll, afterAll, beforeEach, afterEach, test, expect, describe } from "bun:test";

var verdaccioServer: ChildProcess;
var testCounter: number = 0;
var port: number = 4784;
var packageDir: string;

beforeAll(async done => {
  verdaccioServer = fork(
    await import.meta.resolve("verdaccio/bin/verdaccio"),
    ["-c", join(import.meta.dir, "verdaccio.yaml"), "-l", `${port}`],
    { silent: true, execPath: "bun" },
  );

  verdaccioServer.on("message", (msg: { verdaccio_started: boolean }) => {
    if (msg.verdaccio_started) {
      done();
    }
  });
});

afterAll(() => {
  verdaccioServer.kill();
});

beforeEach(async () => {
  packageDir = mkdtempSync(join(realpathSync(tmpdir()), "bun-install-registry-" + testCounter++ + "-"));
  await writeFile(
    join(packageDir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:${port}/"
`,
  );
});

afterEach(async () => {
  await rm(packageDir, { force: true, recursive: true });
});

test("basic 1", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "basic-1": "1.0.0",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + basic-1@1.0.0",
    "",
    " 1 package installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "basic-1", "package.json")).json()).toEqual({
    name: "basic-1",
    version: "1.0.0",
  } as any);
  expect(await exited).toBe(0);
});

test("dependency from root satisfies range from dependency", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + no-deps@1.0.0",
    " + one-range-dep@1.0.0",
    "",
    " 2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  } as any);
  expect(await exited).toBe(0);
});

test("package added after install", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + one-range-dep@1.0.0",
    "",
    " 2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.1.0",
  } as any);
  expect(await exited).toBe(0);

  // add `no-deps` to root package.json with a smaller but still compatible
  // version for `one-range-dep`.
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + no-deps@1.0.0",
    "",
    " 2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  } as any);
  expect(
    await file(join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps", "package.json")).json(),
  ).toEqual({
    name: "no-deps",
    version: "1.1.0",
  } as any);
  expect(await exited).toBe(0);
});

describe("semver", () => {
  const taggedVersionTests = [
    {
      title: "tagged version last in range",
      depVersion: "1 || 2 || pre-3",
      expected: "2.0.1",
    },
    {
      title: "tagged version in middle of range",
      depVersion: "1 || pre-3 || 2",
      expected: "2.0.1",
    },
    {
      title: "tagged version first in range",
      depVersion: "pre-3 || 2 || 1",
      expected: "2.0.1",
    },
    {
      title: "multiple tagged versions in range",
      depVersion: "pre-3 || 2 || pre-1 || 1 || 3 || pre-3",
      expected: "3.0.0",
    },
    {
      title: "start with ||",
      depVersion: "|| 1",
      expected: "1.0.1",
    },
    {
      title: "start with || no space",
      depVersion: "||2",
      expected: "2.0.1",
    },
    {
      title: "|| with no space on both sides",
      depVersion: "1||2",
      expected: "2.0.1",
    },
    {
      title: "no version is latest",
      depVersion: "",
      expected: "3.0.0",
    },
    {
      title: "tagged version works",
      depVersion: "pre-2",
      expected: "2.0.1",
    },
    {
      title: "tagged above latest",
      depVersion: "pre-3",
      expected: "3.0.1",
    },
    {
      title: "'||'",
      depVersion: "||",
      expected: "3.0.0",
    },
    {
      title: "'|'",
      depVersion: "|",
      expected: "3.0.0",
    },
    {
      title: "'|||'",
      depVersion: "|||",
      expected: "3.0.0",
    },
    {
      title: "'|| ||'",
      depVersion: "|| ||",
      expected: "3.0.0",
    },
    {
      title: "'|| 1 ||'",
      depVersion: "|| 1 ||",
      expected: "1.0.1",
    },
    {
      title: "'| | |'",
      depVersion: "| | |",
      expected: "3.0.0",
    },
    {
      title: "'|||||||||||||||||||||||||'",
      depVersion: "|||||||||||||||||||||||||",
      expected: "3.0.0",
    },
    {
      title: "'2 ||| 1'",
      depVersion: "2 ||| 1",
      expected: "2.0.1",
    },
    {
      title: "'2 |||| 1'",
      depVersion: "2 |||| 1",
      expected: "2.0.1",
    },
  ];

  for (const { title, depVersion, expected } of taggedVersionTests) {
    test(title, async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "dep-with-tags": depVersion,
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      expect(stderr).toBeDefined();
      var err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        ` + dep-with-tags@${expected}`,
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);
    });
  }

  test("only tagged versions in range errors", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "dep-with-tags": "pre-1 || pre-2",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    var err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    var out = await new Response(stdout).text();
    expect(err).toContain('InvalidDependencyVersion parsing version "pre-1 || pre-2"');
    expect(await exited).toBe(1);
    expect(out).toBeEmpty();
  });
});

describe("prereleases", () => {
  const prereleaseTests = [
    [
      { title: "specific", depVersion: "1.0.0-future.1", expected: "1.0.0-future.1" },
      { title: "latest", depVersion: "latest", expected: "1.0.0-future.4" },
      { title: "range starting with latest", depVersion: "^1.0.0-future.4", expected: "1.0.0-future.4" },
      { title: "range above latest", depVersion: "^1.0.0-future.5", expected: "1.0.0-future.7" },
    ],
    [
      { title: "#6683", depVersion: "^1.0.0-next.23", expected: "1.0.0-next.23" },
      {
        title: "greater than or equal to",
        depVersion: ">=1.0.0-next.23",
        expected: "1.0.0-next.23",
      },
      { title: "latest", depVersion: "latest", expected: "0.5.0" },
      { title: "greater than or equal to latest", depVersion: ">=0.5.0", expected: "0.5.0" },
    ],
  ];
  for (let i = 0; i < prereleaseTests.length; i++) {
    const tests = prereleaseTests[i];
    const depName = `prereleases-${i + 1}`;
    describe(`${i}`, () => {
      for (const { title, depVersion, expected } of tests) {
        test(title, async () => {
          await writeFile(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
              version: "1.0.0",
              dependencies: {
                [`${depName}`]: depVersion,
              },
            }),
          );

          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: packageDir,
            stdout: null,
            stdin: "pipe",
            stderr: "pipe",
            env,
          });

          expect(stderr).toBeDefined();
          const err = await new Response(stderr).text();
          expect(stdout).toBeDefined();
          const out = await new Response(stdout).text();
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            ` + ${depName}@${expected}`,
            "",
            " 1 package installed",
          ]);
          expect(await file(join(packageDir, "node_modules", depName, "package.json")).json()).toEqual({
            name: depName,
            version: expected,
          } as any);
          expect(await exited).toBe(0);
        });
      }
    });
  }
});

describe("yarn tests", () => {
  test("dragon test 1", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-1",
        version: "1.0.0",
        dependencies: {
          "dragon-test-1-d": "1.0.0",
          "dragon-test-1-e": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + dragon-test-1-d@1.0.0",
      " + dragon-test-1-e@1.0.0",
      "",
      " 6 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-1-a",
      "dragon-test-1-b",
      "dragon-test-1-c",
      "dragon-test-1-d",
      "dragon-test-1-e",
    ]);
    expect(await file(join(packageDir, "node_modules", "dragon-test-1-b", "package.json")).json()).toEqual({
      name: "dragon-test-1-b",
      version: "2.0.0",
    } as any);
    expect(await readdirSorted(join(packageDir, "node_modules", "dragon-test-1-c", "node_modules"))).toEqual([
      "dragon-test-1-b",
    ]);
    expect(
      await file(
        join(packageDir, "node_modules", "dragon-test-1-c", "node_modules", "dragon-test-1-b", "package.json"),
      ).json(),
    ).toEqual({
      name: "dragon-test-1-b",
      version: "1.0.0",
      dependencies: {
        "dragon-test-1-a": "1.0.0",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 2", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-2",
        version: "1.0.0",
        workspaces: ["dragon-test-2-a", "dragon-test-2-b"],
        dependencies: {
          "dragon-test-2-a": "1.0.0",
        },
      }),
    );

    await mkdir(join(packageDir, "dragon-test-2-a"));
    await mkdir(join(packageDir, "dragon-test-2-b"));

    await writeFile(
      join(packageDir, "dragon-test-2-a", "package.json"),
      JSON.stringify({
        name: "dragon-test-2-a",
        version: "1.0.0",
        dependencies: {
          "dragon-test-2-b": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    await writeFile(
      join(packageDir, "dragon-test-2-b", "package.json"),
      JSON.stringify({
        name: "dragon-test-2-b",
        version: "1.0.0",
        dependencies: {
          "no-deps": "*",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + dragon-test-2-b@workspace:dragon-test-2-b",
      " + dragon-test-2-a@workspace:dragon-test-2-a",
      "",
      " 4 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-2-a",
      "dragon-test-2-b",
      "no-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    } as any);
    expect(await readdirSorted(join(packageDir, "dragon-test-2-a", "node_modules"))).toEqual(["no-deps"]);
    expect(await file(join(packageDir, "dragon-test-2-a", "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 3", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-3",
        version: "1.0.0",
        dependencies: {
          "dragon-test-3-a": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + dragon-test-3-a@1.0.0",
      "",
      " 3 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-3-a",
      "dragon-test-3-b",
      "no-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "dragon-test-3-a", "package.json")).json()).toEqual({
      name: "dragon-test-3-a",
      version: "1.0.0",
      dependencies: {
        "dragon-test-3-b": "1.0.0",
      },
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 4", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-4",
        "version": "1.0.0",
        "workspaces": ["my-workspace"],
      }),
    );

    await mkdir(join(packageDir, "my-workspace"));
    await writeFile(
      join(packageDir, "my-workspace", "package.json"),
      JSON.stringify({
        "name": "my-workspace",
        "version": "1.0.0",
        "peerDependencies": {
          "no-deps": "*",
          "peer-deps": "*",
        },
        "devDependencies": {
          "no-deps": "1.0.0",
          "peer-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + my-workspace@workspace:my-workspace",
      "",
      " 3 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "my-workspace",
      "no-deps",
      "peer-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 5", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-5",
        "version": "1.0.0",
        "workspaces": ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        "name": "a",
        "peerDependencies": {
          "various-requires": "*",
        },
        "devDependencies": {
          "no-deps": "1.0.0",
          "peer-deps": "1.0.0",
        },
      }),
    );

    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        "name": "b",
        "devDependencies": {
          "a": "workspace:*",
          "various-requires": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + a@workspace:packages/a",
      " + b@workspace:packages/b",
      "",
      " 5 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "a",
      "b",
      "no-deps",
      "peer-deps",
      "various-requires",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await file(join(packageDir, "node_modules", "various-requires", "package.json")).json()).toEqual({
      name: "various-requires",
      version: "1.0.0",
    } as any);
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 6", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-6",
        "version": "1.0.0",
        "workspaces": ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });
    await mkdir(join(packageDir, "packages", "c"), { recursive: true });
    await mkdir(join(packageDir, "packages", "u"), { recursive: true });
    await mkdir(join(packageDir, "packages", "v"), { recursive: true });
    await mkdir(join(packageDir, "packages", "y"), { recursive: true });
    await mkdir(join(packageDir, "packages", "z"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        name: `a`,
        dependencies: {
          [`z`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        name: `b`,
        dependencies: {
          [`u`]: `workspace:*`,
          [`v`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "c", "package.json"),
      JSON.stringify({
        name: `c`,
        dependencies: {
          [`u`]: `workspace:*`,
          [`v`]: `workspace:*`,
          [`y`]: `workspace:*`,
          [`z`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "u", "package.json"),
      JSON.stringify({
        name: `u`,
      }),
    );
    await writeFile(
      join(packageDir, "packages", "v", "package.json"),
      JSON.stringify({
        name: `v`,
        peerDependencies: {
          [`u`]: `*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "y", "package.json"),
      JSON.stringify({
        name: `y`,
        peerDependencies: {
          [`v`]: `*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "z", "package.json"),
      JSON.stringify({
        name: `z`,
        dependencies: {
          [`y`]: `workspace:*`,
        },
        peerDependencies: {
          [`v`]: `*`,
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + a@workspace:packages/a",
      " + b@workspace:packages/b",
      " + c@workspace:packages/c",
      " + u@workspace:packages/u",
      " + v@workspace:packages/v",
      " + y@workspace:packages/y",
      " + z@workspace:packages/z",
      "",
      " 7 packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 7", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-7",
        "version": "1.0.0",
        "dependencies": {
          "dragon-test-7-a": "1.0.0",
          "dragon-test-7-d": "1.0.0",
          "dragon-test-7-b": "2.0.0",
          "dragon-test-7-c": "3.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    var err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + dragon-test-7-a@1.0.0",
      " + dragon-test-7-b@2.0.0",
      " + dragon-test-7-c@3.0.0",
      " + dragon-test-7-d@1.0.0",
      "",
      " 7 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(require("dragon-test-7-a"), require("dragon-test-7-d"));`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    expect(stderr).toBeDefined();
    err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    out = await new Response(stdout).text();
    expect(err).toBeEmpty();
    expect(out).toBe("1.0.0 1.0.0\n");

    expect(
      await exists(
        join(
          packageDir,
          "node_modules",
          "dragon-test-7-a",
          "node_modules",
          "dragon-test-7-b",
          "node_modules",
          "dragon-test-7-c",
        ),
      ),
    ).toBeTrue();
    expect(
      await exists(
        join(packageDir, "node_modules", "dragon-test-7-d", "node_modules", "dragon-test-7-b", "node_modules"),
      ),
    ).toBeFalse();
    expect(await exited).toBe(0);
  });

  test("dragon test 8", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-8",
        version: "1.0.0",
        dependencies: {
          "dragon-test-8-a": "1.0.0",
          "dragon-test-8-b": "1.0.0",
          "dragon-test-8-c": "1.0.0",
          "dragon-test-8-d": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + dragon-test-8-a@1.0.0",
      " + dragon-test-8-b@1.0.0",
      " + dragon-test-8-c@1.0.0",
      " + dragon-test-8-d@1.0.0",
      "",
      " 4 packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test("dragon test 9", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-9",
        version: "1.0.0",
        dependencies: {
          [`first`]: `npm:peer-deps@1.0.0`,
          [`second`]: `npm:peer-deps@1.0.0`,
          [`no-deps`]: `1.0.0`,
        },
      }),
    );
    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    var err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + first@1.0.0",
      " + no-deps@1.0.0",
      " + second@1.0.0",
      "",
      " 2 packages installed",
    ]);
    expect(await file(join(packageDir, "node_modules", "first", "package.json")).json()).toEqual(
      await file(join(packageDir, "node_modules", "second", "package.json")).json(),
    );
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 10", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-10",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });
    await mkdir(join(packageDir, "packages", "c"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        name: "a",
        devDependencies: {
          b: "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        name: "b",
        peerDependencies: {
          c: "*",
        },
        devDependencies: {
          c: "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "c", "package.json"),
      JSON.stringify({
        name: "c",
        peerDependencies: {
          "no-deps": "*",
        },
        depedencies: {
          b: "workspace:*",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + a@workspace:packages/a",
      " + b@workspace:packages/b",
      " + c@workspace:packages/c",
      "",
      " 3 packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test("dragon test 12", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-12",
        version: "1.0.0",
        workspaces: ["pkg-a", "pkg-b"],
      }),
    );

    await mkdir(join(packageDir, "pkg-a"), { recursive: true });
    await mkdir(join(packageDir, "pkg-b"), { recursive: true });

    await writeFile(
      join(packageDir, "pkg-a", "package.json"),
      JSON.stringify({
        name: "pkg-a",
        dependencies: {
          "pkg-b": "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "pkg-b", "package.json"),
      JSON.stringify({
        name: "pkg-b",
        dependencies: {
          "peer-deps": "1.0.0",
          "fake-peer-deps": "npm:peer-deps@1.0.0",
        },
        peerDependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + pkg-a@workspace:pkg-a",
      " + pkg-b@workspace:pkg-b",
      "",
      " 4 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "no-deps",
      "peer-deps",
      "pkg-a",
      "pkg-b",
    ]);
    expect(await file(join(packageDir, "pkg-b", "node_modules", "fake-peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("it should not warn when the peer dependency resolution is compatible", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "compatible-peer-deps",
        version: "1.0.0",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + no-deps@1.0.0",
      " + peer-deps-fixed@1.0.0",
      "",
      " 2 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".cache", "no-deps", "peer-deps-fixed"]);
    expect(await exited).toBe(0);
  });

  test("it should warn when the peer dependency resolution is incompatible", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "incompatible-peer-deps",
        version: "1.0.0",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "2.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + no-deps@2.0.0",
      " + peer-deps-fixed@1.0.0",
      "",
      " 2 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".cache", "no-deps", "peer-deps-fixed"]);
    expect(await exited).toBe(0);
  });

  test.todo(
    "it should install in such a way that two identical packages with different peer dependencies are different instances",
    async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "provides-peer-deps-1-0-0": "1.0.0",
            "provides-peer-deps-2-0-0": "1.0.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("incorrect peer dependency");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        " + provides-peer-deps-1-0-0@1.0.0",
        " + provides-peer-deps-2-0-0@1.0.0",
        "",
        " 5 packages installed",
      ]);
      expect(await exited).toBe(0);

      await writeFile(
        join(packageDir, "test.js"),
        `console.log(
        require("provides-peer-deps-1-0-0").dependencies["peer-deps"] ===
          require("provides-peer-deps-2-0-0").dependencies["peer-deps"]
      );
      console.log(
        Bun.deepEquals(require("provides-peer-deps-1-0-0"), {
          name: "provides-peer-deps-1-0-0",
          version: "1.0.0",
          dependencies: {
            "peer-deps": {
              name: "peer-deps",
              version: "1.0.0",
              peerDependencies: {
                "no-deps": {
                  name: "no-deps",
                  version: "1.0.0",
                },
              },
            },
            "no-deps": {
              name: "no-deps",
              version: "1.0.0",
            },
          },
        })
      );
      console.log(
        Bun.deepEquals(require("provides-peer-deps-2-0-0"), {
          name: "provides-peer-deps-2-0-0",
          version: "1.0.0",
          dependencies: {
            "peer-deps": {
              name: "peer-deps",
              version: "1.0.0",
              peerDependencies: {
                "no-deps": {
                  name: "no-deps",
                  version: "2.0.0",
                },
              },
            },
            "no-deps": {
              name: "no-deps",
              version: "2.0.0",
            },
          },
        })
      );`,
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "test.js"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(out).toBe("true\ntrue\ntrue");
      expect(err).toBeEmpty();
      expect(await exited).toBe(0);
    },
  );

  test("it should install in such a way that two identical packages with the same peer dependencies are the same instances (simple)", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "provides-peer-deps-1-0-0": "1.0.0",
          "provides-peer-deps-1-0-0-too": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + provides-peer-deps-1-0-0@1.0.0",
      " + provides-peer-deps-1-0-0-too@1.0.0",
      "",
      " 4 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(
        require("provides-peer-deps-1-0-0").dependencies["peer-deps"] ===
          require("provides-peer-deps-1-0-0-too").dependencies["peer-deps"]
      );`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("true\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });
  test("it should install in such a way that two identical packages with the same peer dependencies are the same instances (complex)", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "forward-peer-deps": "1.0.0",
          "forward-peer-deps-too": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + forward-peer-deps@1.0.0",
      " + forward-peer-deps-too@1.0.0",
      " + no-deps@1.0.0",
      "",
      " 4 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(
        require("forward-peer-deps").dependencies["peer-deps"] ===
          require("forward-peer-deps-too").dependencies["peer-deps"]
      );`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("true\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });

  test("it shouldn't deduplicate two packages with similar peer dependencies but different names", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "peer-deps": "1.0.0",
          "peer-deps-too": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      " + no-deps@1.0.0",
      " + peer-deps@1.0.0",
      " + peer-deps-too@1.0.0",
      "",
      " 3 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(join(packageDir, "test.js"), `console.log(require('peer-deps') === require('peer-deps-too'));`);

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("false\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });
});
