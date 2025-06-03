import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  VerdaccioRegistry,
  runBunUpdate,
  assertManifestsPopulated,
  runBunInstall,
  bunEnv as env,
  toMatchNodeModulesAt,
} from "harness";
import { write, file } from "bun";
import { join } from "path";
import { rm } from "fs/promises";
import { install_test_helpers } from "bun:internal-for-testing";

const { parseLockfile } = install_test_helpers;

expect.extend({
  toMatchNodeModulesAt,
});

let registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("update", () => {
  test("duplicate peer dependency (one package is invalid_package_id)", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "^1.0.0",
        },
        peerDependencies: {
          "no-deps": "^1.0.0",
        },
      }),
    );

    await runBunUpdate(env, packageDir);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "no-deps": "^1.1.0",
      },
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    });

    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.1.0",
    });
  });
  test("dist-tags", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "a-dep": "latest",
        },
      }),
    );

    await runBunInstall(env, packageDir);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      name: "a-dep",
      version: "1.0.10",
    });

    // Update without args, `latest` should stay
    await runBunUpdate(env, packageDir);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "latest",
      },
    });

    // Update with `a-dep` and `--latest`, `latest` should be replaced with the installed version
    await runBunUpdate(env, packageDir, ["a-dep"]);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "^1.0.10",
      },
    });
    await runBunUpdate(env, packageDir, ["--latest"]);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "^1.0.10",
      },
    });
  });
  test("exact versions stay exact", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const runs = [
      { version: "1.0.1", dependency: "a-dep" },
      { version: "npm:a-dep@1.0.1", dependency: "aliased" },
    ];
    for (const { version, dependency } of runs) {
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            [dependency]: version,
          },
        }),
      );
      async function check(version: string) {
        assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

        expect(await file(join(packageDir, "node_modules", dependency, "package.json")).json()).toMatchObject({
          name: "a-dep",
          version: version.replace(/.*@/, ""),
        });

        expect(await file(packageJson).json()).toMatchObject({
          dependencies: {
            [dependency]: version,
          },
        });
      }
      await runBunInstall(env, packageDir);
      await check(version);

      await runBunUpdate(env, packageDir);
      await check(version);

      await runBunUpdate(env, packageDir, [dependency]);
      await check(version);

      // this will actually update the package, but the version should remain exact
      await runBunUpdate(env, packageDir, ["--latest"]);
      await check(dependency === "aliased" ? "npm:a-dep@1.0.10" : "1.0.10");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));
    }
  });
  describe("tilde", () => {
    test("without args", async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "no-deps": "~1.0.0",
          },
        }),
      );

      await runBunInstall(env, packageDir);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.0.1",
      });

      let { out } = await runBunUpdate(env, packageDir);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(out).toEqual([
        expect.stringContaining("bun update v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await file(packageJson).json()).toEqual({
        name: "foo",
        dependencies: {
          "no-deps": "~1.0.1",
        },
      });

      // another update does not change anything (previously the version would update because it was changed to `^1.0.1`)
      ({ out } = await runBunUpdate(env, packageDir));
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(out).toEqual([
        expect.stringContaining("bun update v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await file(packageJson).json()).toEqual({
        name: "foo",
        dependencies: {
          "no-deps": "~1.0.1",
        },
      });
    });

    for (const latest of [true, false]) {
      test(`update no args${latest ? " --latest" : ""}`, async () => {
        const { packageDir, packageJson } = await registry.createTestDir();
        await write(
          packageJson,
          JSON.stringify({
            name: "foo",
            dependencies: {
              "a1": "npm:no-deps@1",
              "a10": "npm:no-deps@~1.0",
              "a11": "npm:no-deps@^1.0",
              "a12": "npm:no-deps@~1.0.1",
              "a13": "npm:no-deps@^1.0.1",
              "a14": "npm:no-deps@~1.1.0",
              "a15": "npm:no-deps@^1.1.0",
              "a2": "npm:no-deps@1.0",
              "a3": "npm:no-deps@1.1",
              "a4": "npm:no-deps@1.0.1",
              "a5": "npm:no-deps@1.1.0",
              "a6": "npm:no-deps@~1",
              "a7": "npm:no-deps@^1",
              "a8": "npm:no-deps@~1.1",
              "a9": "npm:no-deps@^1.1",
            },
          }),
        );

        if (latest) {
          await runBunUpdate(env, packageDir, ["--latest"]);
          assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "a1": "npm:no-deps@^2.0.0",
              "a10": "npm:no-deps@~2.0.0",
              "a11": "npm:no-deps@^2.0.0",
              "a12": "npm:no-deps@~2.0.0",
              "a13": "npm:no-deps@^2.0.0",
              "a14": "npm:no-deps@~2.0.0",
              "a15": "npm:no-deps@^2.0.0",
              "a2": "npm:no-deps@~2.0.0",
              "a3": "npm:no-deps@~2.0.0",
              "a4": "npm:no-deps@2.0.0",
              "a5": "npm:no-deps@2.0.0",
              "a6": "npm:no-deps@~2.0.0",
              "a7": "npm:no-deps@^2.0.0",
              "a8": "npm:no-deps@~2.0.0",
              "a9": "npm:no-deps@^2.0.0",
            },
          });
        } else {
          await runBunUpdate(env, packageDir);
          assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "a1": "npm:no-deps@^1.1.0",
              "a10": "npm:no-deps@~1.0.1",
              "a11": "npm:no-deps@^1.1.0",
              "a12": "npm:no-deps@~1.0.1",
              "a13": "npm:no-deps@^1.1.0",
              "a14": "npm:no-deps@~1.1.0",
              "a15": "npm:no-deps@^1.1.0",
              "a2": "npm:no-deps@~1.0.1",
              "a3": "npm:no-deps@~1.1.0",
              "a4": "npm:no-deps@1.0.1",
              "a5": "npm:no-deps@1.1.0",
              "a6": "npm:no-deps@~1.1.0",
              "a7": "npm:no-deps@^1.1.0",
              "a8": "npm:no-deps@~1.1.0",
              "a9": "npm:no-deps@^1.1.0",
            },
          });
        }
        const files = await Promise.all(
          ["a1", "a10", "a11", "a12", "a13", "a14", "a15", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"].map(alias =>
            file(join(packageDir, "node_modules", alias, "package.json")).json(),
          ),
        );

        if (latest) {
          // each version should be "2.0.0"
          expect(files).toMatchObject(Array(15).fill({ version: "2.0.0" }));
        } else {
          expect(files).toMatchObject([
            { version: "1.1.0" },
            { version: "1.0.1" },
            { version: "1.1.0" },
            { version: "1.0.1" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.0.1" },
            { version: "1.1.0" },
            { version: "1.0.1" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.1.0" },
          ]);
        }
      });
    }

    test("with package name in args", async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "a-dep": "1.0.3",
            "no-deps": "~1.0.0",
          },
        }),
      );

      await runBunInstall(env, packageDir);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.0.1",
      });

      let { out } = await runBunUpdate(env, packageDir, ["no-deps"]);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(out).toEqual([
        expect.stringContaining("bun update v1."),
        "",
        "installed no-deps@1.0.1",
        "",
        expect.stringContaining("done"),
        "",
      ]);
      expect(await file(packageJson).json()).toEqual({
        name: "foo",
        dependencies: {
          "a-dep": "1.0.3",
          "no-deps": "~1.0.1",
        },
      });

      // update with --latest should only change the update request and keep `~`
      ({ out } = await runBunUpdate(env, packageDir, ["no-deps", "--latest"]));
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(out).toEqual([
        expect.stringContaining("bun update v1."),
        "",
        "installed no-deps@2.0.0",
        "",
        "1 package installed",
      ]);
      expect(await file(packageJson).json()).toEqual({
        name: "foo",
        dependencies: {
          "a-dep": "1.0.3",
          "no-deps": "~2.0.0",
        },
      });
    });
  });
  describe("alises", () => {
    test("update all", async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "aliased-dep": "npm:no-deps@^1.0.0",
          },
        }),
      );

      await runBunUpdate(env, packageDir);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(await file(packageJson).json()).toEqual({
        name: "foo",
        dependencies: {
          "aliased-dep": "npm:no-deps@^1.1.0",
        },
      });
      expect(await file(join(packageDir, "node_modules", "aliased-dep", "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.1.0",
      });
    });
    test("update specific aliased package", async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "aliased-dep": "npm:no-deps@^1.0.0",
          },
        }),
      );

      await runBunUpdate(env, packageDir, ["aliased-dep"]);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(await file(packageJson).json()).toEqual({
        name: "foo",
        dependencies: {
          "aliased-dep": "npm:no-deps@^1.1.0",
        },
      });
      expect(await file(join(packageDir, "node_modules", "aliased-dep", "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.1.0",
      });
    });
    test("with pre and build tags", async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "aliased-dep": "npm:prereleases-3@5.0.0-alpha.150",
          },
        }),
      );

      await runBunUpdate(env, packageDir);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(await file(packageJson).json()).toMatchObject({
        name: "foo",
        dependencies: {
          "aliased-dep": "npm:prereleases-3@5.0.0-alpha.150",
        },
      });

      expect(await file(join(packageDir, "node_modules", "aliased-dep", "package.json")).json()).toMatchObject({
        name: "prereleases-3",
        version: "5.0.0-alpha.150",
      });

      const { out } = await runBunUpdate(env, packageDir, ["--latest"]);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

      expect(out).toEqual([
        expect.stringContaining("bun update v1."),
        "",
        "^ aliased-dep 5.0.0-alpha.150 -> 5.0.0-alpha.153",
        "",
        "1 package installed",
      ]);
      expect(await file(packageJson).json()).toMatchObject({
        name: "foo",
        dependencies: {
          "aliased-dep": "npm:prereleases-3@5.0.0-alpha.153",
        },
      });
    });
  });
  test("--no-save will update packages in node_modules and not save to package.json", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "a-dep": "1.0.1",
        },
      }),
    );

    let { out } = await runBunUpdate(env, packageDir, ["--no-save"]);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      expect.stringContaining("+ a-dep@1.0.1"),
      "",
      "1 package installed",
    ]);
    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "1.0.1",
      },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "a-dep": "^1.0.1",
        },
      }),
    );

    ({ out } = await runBunUpdate(env, packageDir, ["--no-save"]));
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      expect.stringContaining("+ a-dep@1.0.10"),
      "",
      "1 package installed",
    ]);
    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "^1.0.1",
      },
    });

    // now save
    ({ out } = await runBunUpdate(env, packageDir));
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      "Checked 1 install across 2 packages (no changes)",
    ]);
    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "^1.0.10",
      },
    });
  });
  test("update won't update beyond version range unless the specified version allows it", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "dep-with-tags": "^1.0.0",
        },
      }),
    );

    await runBunUpdate(env, packageDir);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "dep-with-tags": "^1.0.1",
      },
    });
    expect(await file(join(packageDir, "node_modules", "dep-with-tags", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
    // update with package name does not update beyond version range
    await runBunUpdate(env, packageDir, ["dep-with-tags"]);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "dep-with-tags": "^1.0.1",
      },
    });
    expect(await file(join(packageDir, "node_modules", "dep-with-tags", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });

    // now update with a higher version range
    await runBunUpdate(env, packageDir, ["dep-with-tags@^2.0.0"]);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      dependencies: {
        "dep-with-tags": "^2.0.1",
      },
    });
    expect(await file(join(packageDir, "node_modules", "dep-with-tags", "package.json")).json()).toMatchObject({
      version: "2.0.1",
    });
  });
  test("update should update all packages in the current workspace", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
        dependencies: {
          "what-bin": "^1.0.0",
          "uses-what-bin": "^1.0.0",
          "optional-native": "^1.0.0",
          "peer-deps-too": "^1.0.0",
          "two-range-deps": "^1.0.0",
          "one-fixed-dep": "^1.0.0",
          "no-deps-bins": "^2.0.0",
          "left-pad": "^1.0.0",
          "native": "1.0.0",
          "dep-loop-entry": "1.0.0",
          "dep-with-tags": "^2.0.0",
          "dev-deps": "1.0.0",
          "a-dep": "^1.0.0",
        },
      }),
    );

    const originalWorkspaceJSON = {
      name: "pkg1",
      version: "1.0.0",
      dependencies: {
        "what-bin": "^1.0.0",
        "uses-what-bin": "^1.0.0",
        "optional-native": "^1.0.0",
        "peer-deps-too": "^1.0.0",
        "two-range-deps": "^1.0.0",
        "one-fixed-dep": "^1.0.0",
        "no-deps-bins": "^2.0.0",
        "left-pad": "^1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "^2.0.0",
        "dev-deps": "1.0.0",
        "a-dep": "^1.0.0",
      },
    };

    await write(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify(originalWorkspaceJSON));

    // initial install, update root
    let { out } = await runBunUpdate(env, packageDir);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      "+ a-dep@1.0.10",
      "+ dep-loop-entry@1.0.0",
      expect.stringContaining("+ dep-with-tags@2.0.1"),
      "+ dev-deps@1.0.0",
      "+ left-pad@1.0.0",
      "+ native@1.0.0",
      "+ no-deps-bins@2.0.0",
      expect.stringContaining("+ one-fixed-dep@1.0.0"),
      "+ optional-native@1.0.0",
      "+ peer-deps-too@1.0.0",
      "+ two-range-deps@1.0.0",
      expect.stringContaining("+ uses-what-bin@1.5.0"),
      expect.stringContaining("+ what-bin@1.5.0"),
      "",
      // Due to optional-native dependency, this can be either 20 or 19 packages
      expect.stringMatching(/(?:20|19) packages installed/),
      "",
      "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
      "",
    ]);

    let lockfile = parseLockfile(packageDir);
    // make sure this is valid
    expect(lockfile).toMatchNodeModulesAt(packageDir);
    expect(await file(packageJson).json()).toEqual({
      name: "foo",
      workspaces: ["packages/*"],
      dependencies: {
        "what-bin": "^1.5.0",
        "uses-what-bin": "^1.5.0",
        "optional-native": "^1.0.0",
        "peer-deps-too": "^1.0.0",
        "two-range-deps": "^1.0.0",
        "one-fixed-dep": "^1.0.0",
        "no-deps-bins": "^2.0.0",
        "left-pad": "^1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "^2.0.1",
        "dev-deps": "1.0.0",
        "a-dep": "^1.0.10",
      },
    });
    // workspace hasn't changed
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).json()).toEqual(originalWorkspaceJSON);

    // now update the workspace, first a couple packages, then all
    ({ out } = await runBunUpdate(env, join(packageDir, "packages", "pkg1"), [
      "what-bin",
      "uses-what-bin",
      "a-dep@1.0.5",
    ]));
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      "installed what-bin@1.5.0 with binaries:",
      " - what-bin",
      "installed uses-what-bin@1.5.0",
      "installed a-dep@1.0.5",
      "",
      "3 packages installed",
    ]);
    // lockfile = parseLockfile(packageDir);
    // expect(lockfile).toMatchNodeModulesAt(packageDir);
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).json()).toMatchObject({
      dependencies: {
        "what-bin": "^1.5.0",
        "uses-what-bin": "^1.5.0",
        "optional-native": "^1.0.0",
        "peer-deps-too": "^1.0.0",
        "two-range-deps": "^1.0.0",
        "one-fixed-dep": "^1.0.0",
        "no-deps-bins": "^2.0.0",
        "left-pad": "^1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "^2.0.0",
        "dev-deps": "1.0.0",

        // a-dep should keep caret
        "a-dep": "^1.0.5",
      },
    });

    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      name: "a-dep",
      version: "1.0.10",
    });

    expect(
      await file(join(packageDir, "packages", "pkg1", "node_modules", "a-dep", "package.json")).json(),
    ).toMatchObject({
      name: "a-dep",
      version: "1.0.5",
    });

    ({ out } = await runBunUpdate(env, join(packageDir, "packages", "pkg1"), ["a-dep@^1.0.5"]));
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      "installed a-dep@1.0.10",
      "",
      expect.stringMatching(/(\[\d+\.\d+m?s\])/),
      "",
    ]);
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      name: "a-dep",
      version: "1.0.10",
    });
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).json()).toMatchObject({
      dependencies: {
        "what-bin": "^1.5.0",
        "uses-what-bin": "^1.5.0",
        "optional-native": "^1.0.0",
        "peer-deps-too": "^1.0.0",
        "two-range-deps": "^1.0.0",
        "one-fixed-dep": "^1.0.0",
        "no-deps-bins": "^2.0.0",
        "left-pad": "^1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "^2.0.0",
        "dev-deps": "1.0.0",
        "a-dep": "^1.0.10",
      },
    });
  });
  test("update different dependency groups", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    for (const args of [true, false]) {
      for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        await write(
          packageJson,
          JSON.stringify({
            name: "foo",
            [group]: {
              "a-dep": "^1.0.0",
            },
          }),
        );

        const { out } = args ? await runBunUpdate(env, packageDir, ["a-dep"]) : await runBunUpdate(env, packageDir);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

        expect(out).toEqual([
          expect.stringContaining("bun update v1."),
          "",
          args ? "installed a-dep@1.0.10" : expect.stringContaining("+ a-dep@1.0.10"),
          "",
          "1 package installed",
        ]);
        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          [group]: {
            "a-dep": "^1.0.10",
          },
        });

        await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
        await rm(join(packageDir, "bun.lockb"));
      }
    }
  });
  test("it should update packages from update requests", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "1.0.0",
        },
        workspaces: ["packages/*"],
      }),
    );

    await write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        dependencies: {
          "a-dep": "^1.0.0",
        },
      }),
    );

    await write(
      join(packageDir, "packages", "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        dependencies: {
          "pkg1": "*",
          "is-number": "*",
        },
      }),
    );

    await runBunInstall(env, packageDir);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.10",
    });
    expect(await file(join(packageDir, "node_modules", "pkg1", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });

    // update no-deps, no range, no change
    let { out } = await runBunUpdate(env, packageDir, ["no-deps"]);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      "installed no-deps@1.0.0",
      "",
      expect.stringMatching(/(\[\d+\.\d+m?s\])/),
      "",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });

    // update package that doesn't exist to workspace, should add to package.json
    ({ out } = await runBunUpdate(env, join(packageDir, "packages", "pkg1"), ["no-deps"]));
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      "installed no-deps@2.0.0",
      "",
      "1 package installed",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).json()).toMatchObject({
      name: "pkg1",
      version: "1.0.0",
      dependencies: {
        "a-dep": "^1.0.0",
        "no-deps": "^2.0.0",
      },
    });

    // update root package.json no-deps to ^1.0.0 and update it
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "^1.0.0",
        },
        workspaces: ["packages/*"],
      }),
    );

    ({ out } = await runBunUpdate(env, packageDir, ["no-deps"]));
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    expect(out).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      "installed no-deps@1.1.0",
      "",
      "1 package installed",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.1.0",
    });
  });

  test("--latest works with packages from arguments", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await runBunUpdate(env, packageDir, ["no-deps", "--latest"]);
    assertManifestsPopulated(join(packageDir, ".bun-cache"), registry.registryUrl());

    const files = await Promise.all([
      file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
      file(packageJson).json(),
    ]);

    expect(files).toMatchObject([{ version: "2.0.0" }, { dependencies: { "no-deps": "2.0.0" } }]);
  });
});
