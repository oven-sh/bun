import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { spawn, write } from "bun";
import { join } from "path";
import { VerdaccioRegistry, bunExe, bunEnv as env, assertManifestsPopulated, runBunInstall } from "harness";

let registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});
afterAll(() => {
  registry.stop();
});

describe("outdated", () => {
  const edgeCaseTests = [
    {
      description: "normal dep, smaller than column title",
      packageJson: {
        dependencies: {
          "no-deps": "1.0.0",
        },
      },
    },
    {
      description: "normal dep, larger than column title",
      packageJson: {
        dependencies: {
          "prereleases-1": "1.0.0-future.1",
        },
      },
    },
    {
      description: "dev dep, smaller than column title",
      packageJson: {
        devDependencies: {
          "no-deps": "1.0.0",
        },
      },
    },
    {
      description: "dev dep, larger than column title",
      packageJson: {
        devDependencies: {
          "prereleases-1": "1.0.0-future.1",
        },
      },
    },
    {
      description: "peer dep, smaller than column title",
      packageJson: {
        peerDependencies: {
          "no-deps": "1.0.0",
        },
      },
    },
    {
      description: "peer dep, larger than column title",
      packageJson: {
        peerDependencies: {
          "prereleases-1": "1.0.0-future.1",
        },
      },
    },
    {
      description: "optional dep, smaller than column title",
      packageJson: {
        optionalDependencies: {
          "no-deps": "1.0.0",
        },
      },
    },
    {
      description: "optional dep, larger than column title",
      packageJson: {
        optionalDependencies: {
          "prereleases-1": "1.0.0-future.1",
        },
      },
    },
  ];

  for (const { description, packageJson } of edgeCaseTests) {
    test(description, async () => {
      const { packageDir } = await registry.createTestDir();
      await write(join(packageDir, "package.json"), JSON.stringify(packageJson));
      await runBunInstall(env, packageDir);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      const testEnv = { ...env, FORCE_COLOR: "1" };
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "outdated"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(await exited).toBe(0);

      const err = await Bun.readableStreamToText(stderr);
      expect(err).not.toContain("error:");
      expect(err).not.toContain("panic:");
      const out = await Bun.readableStreamToText(stdout);
      const first = out.slice(0, out.indexOf("\n"));
      expect(first).toEqual(expect.stringContaining("bun outdated "));
      expect(first).toEqual(expect.stringContaining("v1."));
      const rest = out.slice(out.indexOf("\n") + 1);
      expect(rest).toMatchSnapshot();
    });
  }
  test("in workspace", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          workspaces: ["pkg1"],
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      ),
    ]);

    await runBunInstall(env, packageDir);

    let { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "outdated"],
      cwd: join(packageDir, "pkg1"),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    expect(err).not.toContain("panic:");
    let out = await Bun.readableStreamToText(stdout);
    expect(out).toContain("a-dep");
    expect(out).not.toContain("no-deps");
    expect(await exited).toBe(0);

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "outdated"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    }));

    const err2 = await Bun.readableStreamToText(stderr);
    expect(err2).not.toContain("error:");
    expect(err2).not.toContain("panic:");
    let out2 = await Bun.readableStreamToText(stdout);
    expect(out2).toContain("no-deps");
    expect(out2).not.toContain("a-dep");
    expect(await exited).toBe(0);
  });

  test("NO_COLOR works", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "a-dep": "1.0.1",
        },
      }),
    );

    await runBunInstall(env, packageDir);

    const testEnv = { ...env, NO_COLOR: "1" };
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "outdated"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: testEnv,
    });

    const err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    expect(err).not.toContain("panic:");

    const out = await Bun.readableStreamToText(stdout);
    expect(out).toContain("a-dep");
    const first = out.slice(0, out.indexOf("\n"));
    expect(first).toEqual(expect.stringContaining("bun outdated "));
    expect(first).toEqual(expect.stringContaining("v1."));
    const rest = out.slice(out.indexOf("\n") + 1);
    expect(rest).toMatchSnapshot();

    expect(await exited).toBe(0);
  });

  async function setupWorkspace(packageJson: string, packageDir: string) {
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2222222222222",
          dependencies: {
            "prereleases-1": "1.0.0-future.1",
          },
        }),
      ),
    ]);
  }

  async function runBunOutdated(env: any, cwd: string, ...args: string[]): Promise<string> {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "outdated", ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("error:");
    expect(err).not.toContain("panic:");
    const out = await Bun.readableStreamToText(stdout);
    const exitCode = await exited;
    expect(exitCode).toBe(0);
    return out;
  }

  test("--filter with workspace names and paths", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await setupWorkspace(packageJson, packageDir);
    await runBunInstall(env, packageDir);

    let out = await runBunOutdated(env, packageDir, "--filter", "*");
    expect(out).toContain("foo");
    expect(out).toContain("pkg1");
    expect(out).toContain("pkg2222222222222");

    out = await runBunOutdated(env, join(packageDir, "packages", "pkg1"), "--filter", "./");
    expect(out).toContain("pkg1");
    expect(out).not.toContain("foo");
    expect(out).not.toContain("pkg2222222222222");

    // in directory that isn't a workspace
    out = await runBunOutdated(env, join(packageDir, "packages"), "--filter", "./*", "--filter", "!pkg1");
    expect(out).toContain("pkg2222222222222");
    expect(out).not.toContain("pkg1");
    expect(out).not.toContain("foo");

    out = await runBunOutdated(env, join(packageDir, "packages", "pkg1"), "--filter", "../*");
    expect(out).not.toContain("foo");
    expect(out).toContain("pkg2222222222222");
    expect(out).toContain("pkg1");
  });

  test("dependency pattern args", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await setupWorkspace(packageJson, packageDir);
    await runBunInstall(env, packageDir);

    let out = await runBunOutdated(env, packageDir, "no-deps", "--filter", "*");
    expect(out).toContain("no-deps");
    expect(out).not.toContain("a-dep");
    expect(out).not.toContain("prerelease-1");

    out = await runBunOutdated(env, packageDir, "a-dep");
    expect(out).not.toContain("a-dep");
    expect(out).not.toContain("no-deps");
    expect(out).not.toContain("prerelease-1");

    out = await runBunOutdated(env, packageDir, "*", "--filter", "*");
    expect(out).toContain("no-deps");
    expect(out).toContain("a-dep");
    expect(out).toContain("prereleases-1");
  });

  test("scoped workspace names", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "@foo/bar",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "@scope/pkg1",
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      ),
    ]);

    await runBunInstall(env, packageDir);

    let out = await runBunOutdated(env, packageDir, "--filter", "*");
    expect(out).toContain("@foo/bar");
    expect(out).toContain("@scope/pkg1");

    out = await runBunOutdated(env, packageDir, "--filter", "*", "--filter", "!@foo/*");
    expect(out).not.toContain("@foo/bar");
    expect(out).toContain("@scope/pkg1");
  });

  test("catalog dependencies", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "catalog-outdated-test",
          workspaces: {
            packages: ["packages/*"],
            catalog: {
              "no-deps": "1.0.0",
            },
            catalogs: {
              dev: {
                "a-dep": "1.0.1",
              },
            },
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "catalog:",
          },
          devDependencies: {
            "a-dep": "catalog:dev",
          },
        }),
      ),
    ]);

    await runBunInstall(env, packageDir);

    const out = await runBunOutdated(env, packageDir, "--filter", "*");
    expect(out).toContain("no-deps");
    expect(out).toContain("a-dep");
  });
});
