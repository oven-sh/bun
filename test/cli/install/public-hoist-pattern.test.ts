import { spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readlinkSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, readdirSorted, runBunInstall } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("publicHoistPattern", () => {
  test("bunfig string", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: "*typ*" },
      files: {
        "package.json": JSON.stringify({
          name: "include-patterns",
          dependencies: {
            "two-range-deps": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "@types", "two-range-deps"]);
  });

  test("bunfig array", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: ["*types*", "no-deps"] },
      files: {
        "package.json": JSON.stringify({
          name: "array-patterns",
          dependencies: {
            "two-range-deps": "1.0.0",
            "a-dep": "1.0.1",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should hoist @types and no-deps
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bun",
      "@types",
      "a-dep",
      "no-deps",
      "two-range-deps",
    ]);
  });

  test("all exclude pattern", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: "!*" },
      files: {
        "package.json": JSON.stringify({
          name: "exclude-all",
          dependencies: {
            "two-range-deps": "1.0.0",
            "no-deps": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should not hoist any dependencies
    const [nodeModules, hasTypes] = await Promise.all([
      readdirSorted(join(packageDir, "node_modules")),
      Bun.file(join(packageDir, "node_modules", "@types")).exists(),
    ]);

    expect(nodeModules).toEqual([".bun", "no-deps", "two-range-deps"]);
    // Verify transitive deps are not hoisted
    expect(hasTypes).toBeFalse();
  });

  test("all include pattern", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: "*" },
      files: {
        "package.json": JSON.stringify({
          name: "include-all",
          dependencies: {
            "two-range-deps": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should hoist all dependencies including transitive
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bun",
      "@types",
      "no-deps",
      "two-range-deps",
    ]);
  });

  test("mixed include and exclude patterns", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: ["*", "!@types*", "!no-deps"] },
      files: {
        "package.json": JSON.stringify({
          name: "mixed-patterns",
          dependencies: {
            "two-range-deps": "1.0.0",
            "a-dep": "1.0.1",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should hoist everything except @types and no-deps
    const [nodeModules, hasTypes, hasNoDeps] = await Promise.all([
      readdirSorted(join(packageDir, "node_modules")),
      Bun.file(join(packageDir, "node_modules", "@types")).exists(),
      Bun.file(join(packageDir, "node_modules", "no-deps")).exists(),
    ]);

    expect(nodeModules).toEqual([".bun", "a-dep", "two-range-deps"]);
    expect(hasTypes).toBeFalse();
    expect(hasNoDeps).toBeFalse();
  });

  test("npmrc string configuration", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "npmrc-string",
          dependencies: {
            "two-range-deps": "1.0.0",
          },
        }),
        ".npmrc": `public-hoist-pattern=*types*`,
      },
    });

    await runBunInstall(bunEnv, packageDir);

    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "@types", "two-range-deps"]);
  });

  test("npmrc array configuration", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "npmrc-array",
          dependencies: {
            "two-range-deps": "1.0.0",
            "a-dep": "1.0.1",
          },
        }),
        ".npmrc": `public-hoist-pattern[]=*types*
public-hoist-pattern[]=no-deps`,
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should hoist @types and no-deps
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bun",
      "@types",
      "a-dep",
      "no-deps",
      "two-range-deps",
    ]);
  });

  test("npmrc mixed patterns", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "npmrc-mixed",
          dependencies: {
            "two-range-deps": "1.0.0",
            "a-dep": "1.0.1",
          },
        }),
        ".npmrc": `public-hoist-pattern[]=*
public-hoist-pattern[]=!@types*
public-hoist-pattern[]=!no-deps`,
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should hoist everything except @types and no-deps
    const [nodeModules, hasTypes, hasNoDeps] = await Promise.all([
      readdirSorted(join(packageDir, "node_modules")),
      Bun.file(join(packageDir, "node_modules", "@types")).exists(),
      Bun.file(join(packageDir, "node_modules", "no-deps")).exists(),
    ]);

    expect(nodeModules).toEqual([".bun", "a-dep", "two-range-deps"]);
    expect(hasTypes).toBeFalse();
    expect(hasNoDeps).toBeFalse();
  });

  test("exclude specific packages", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: ["*", "!two-range-deps"] },
      files: {
        "package.json": JSON.stringify({
          name: "exclude-specific",
          dependencies: {
            "two-range-deps": "1.0.0",
            "no-deps": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should hoist everything, two-range-deps included because it's a direct dependency
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bun",
      "@types",
      "no-deps",
      "two-range-deps",
    ]);
    // two-range-deps should still be linked
    expect(readlinkSync(join(packageDir, "node_modules", "two-range-deps"))).toBe(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
  });

  test("scoped package patterns", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: "@types/*" },
      files: {
        "package.json": JSON.stringify({
          name: "scoped-patterns",
          dependencies: {
            "two-range-deps": "1.0.0",
            "@types/is-number": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should only hoist @types packages
    const [nodeModules, nodeModulesTypes, hasNoDeps] = await Promise.all([
      readdirSorted(join(packageDir, "node_modules")),
      readdirSorted(join(packageDir, "node_modules", "@types")),
      Bun.file(join(packageDir, "node_modules", "no-deps")).exists(),
    ]);

    expect(nodeModules).toEqual([".bun", "@types", "two-range-deps"]);
    expect(nodeModulesTypes).toEqual(["is-number"]);
    expect(hasNoDeps).toBeFalse();
  });

  test("complex pattern combinations", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: {
        linker: "isolated",
        publicHoistPattern: ["@types/*", "no-*", "!no-deps", "a-*"],
      },
      files: {
        "package.json": JSON.stringify({
          name: "complex-patterns",
          dependencies: {
            "two-range-deps": "1.0.0",
            "a-dep": "1.0.1",
            "basic-1": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Should hoist: @types/*, a-* packages
    // Should not hoist: no-deps (excluded by !no-deps, but matches no-*)
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bun",
      "@types",
      "a-dep",
      "basic-1",
      "two-range-deps",
    ]);
  });

  test("workspaces with publicHoistPattern", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: ["*types*", "no-deps"] },
      files: {
        "package.json": JSON.stringify({
          name: "workspace-root",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          dependencies: {
            "@types/is-number": "1.0.0",
            "a-dep": "1.0.1",
          },
        }),
        "packages/pkg2/package.json": JSON.stringify({
          name: "pkg2",
          dependencies: {
            "two-range-deps": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // Root should have hoisted packages
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "@types", "no-deps"]);

    // Workspace packages should have their dependencies
    expect(await readdirSorted(join(packageDir, "packages", "pkg1", "node_modules"))).toEqual(["@types", "a-dep"]);
    expect(await readdirSorted(join(packageDir, "packages", "pkg2", "node_modules"))).toEqual(["two-range-deps"]);
  });

  describe("error cases", () => {
    test("invalid publicHoistPattern type in bunfig", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({
            name: "invalid-pattern-type",
            dependencies: {
              "no-deps": "1.0.0",
            },
          }),
        },
      });

      // Manually write invalid bunfig
      await write(
        join(packageDir, "bunfig.toml"),
        `[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${registry.registryUrl()}"
linker = "isolated"
publicHoistPattern = 123`,
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await exited).not.toBe(0);
      const err = await stderr.text();
      expect(err).toContain("error: Expected a string or an array of strings");
    });

    test("malformed bunfig with array syntax", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({
            name: "malformed-array",
            dependencies: {
              "no-deps": "1.0.0",
            },
          }),
        },
      });

      // Should error from boolean in the array
      await write(
        join(packageDir, "bunfig.toml"),
        `[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${registry.registryUrl()}"
linker = "isolated"
publicHoistPattern = ["*types*", true]`,
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const err = await stderr.text();
      expect(await exited).toBe(1);
      expect(err).toContain("error: Expected a string");
    });
  });
});
