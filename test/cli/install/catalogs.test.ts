import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, runBunInstall, stderrForInstall } from "harness";
import { join } from "path";

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("basic", () => {
  async function createBasicCatalogMonorepo(packageDir: string, name: string) {
    const packageJson = {
      name,
      workspaces: {
        packages: ["packages/*"],
        catalog: {
          "no-deps": "2.0.0",
        },
        catalogs: {
          a: {
            "a-dep": "1.0.1",
          },
        },
      },
    };

    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify(packageJson)),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "catalog:",
            "a-dep": "catalog:a",
          },
        }),
      ),
    ]);

    return packageJson;
  }
  test("both catalog and catalogs", async () => {
    const { packageDir } = await registry.createTestDir();

    await createBasicCatalogMonorepo(packageDir, "catalog-basic-1");

    await runBunInstall(bunEnv, packageDir);

    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    });

    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
      name: "a-dep",
      version: "1.0.1",
    });

    // another install does not save the lockfile
    await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
  });

  for (const binaryLockfile of [true, false]) {
    test(`detect changes (${binaryLockfile ? "bun.lockb" : "bun.lock"})`, async () => {
      const { packageDir } = await registry.createTestDir({ saveTextLockfile: !binaryLockfile });
      const packageJson = await createBasicCatalogMonorepo(packageDir, "catalog-basic-2");
      let { err } = await runBunInstall(bunEnv, packageDir);
      expect(err).toContain("Saved lockfile");

      const initialLockfile = !binaryLockfile
        ? (await file(join(packageDir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234")
        : undefined;

      if (!binaryLockfile) {
        expect(initialLockfile).toMatchSnapshot();
      } else {
        expect(await exists(join(packageDir, "bun.lockb"))).toBeTrue();
      }

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "2.0.0",
      });
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
        name: "a-dep",
        version: "1.0.1",
      });

      // update catalog
      packageJson.workspaces.catalog["no-deps"] = "1.0.0";
      await write(join(packageDir, "package.json"), JSON.stringify(packageJson));
      ({ err } = await runBunInstall(bunEnv, packageDir, { savesLockfile: true }));
      expect(err).toContain("Saved lockfile");

      if (!binaryLockfile) {
        const newLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
          /localhost:\d+/g,
          "localhost:1234",
        );

        expect(newLockfile).not.toEqual(initialLockfile);
        expect(newLockfile).toMatchSnapshot();
      } else {
        expect(await exists(join(packageDir, "bun.lockb"))).toBeTrue();
      }

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "1.0.0",
      });
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
        name: "a-dep",
        version: "1.0.1",
      });

      // update catalogs
      packageJson.workspaces.catalogs.a["a-dep"] = "1.0.10";
      await write(join(packageDir, "package.json"), JSON.stringify(packageJson));
      ({ err } = await runBunInstall(bunEnv, packageDir, { savesLockfile: true }));
      expect(err).toContain("Saved lockfile");

      if (!binaryLockfile) {
        const newLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
          /localhost:\d+/g,
          "localhost:1234",
        );

        expect(newLockfile).not.toEqual(initialLockfile);
        expect(newLockfile).toMatchSnapshot();
      } else {
        expect(await exists(join(packageDir, "bun.lockb"))).toBeTrue();
      }

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "1.0.0",
      });
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
        name: "a-dep",
        version: "1.0.10",
      });
    });
  }
});

describe("errors", () => {
  test("fails gracefully when no catalog is found for a package", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "catalog-error-1",
        workspaces: {
          // empty, any catalog should fail to resolve
          catalog: {},
          catalogs: {},
        },
        dependencies: {
          "no-deps": "catalog:",

          // longer than 8
          "a-dep": "catalog:aaaaaaaaaaaaaaaaa",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const out = await Bun.readableStreamToText(stdout);
    const err = stderrForInstall(await Bun.readableStreamToText(stderr));

    expect(err).toContain("no-deps@catalog: failed to resolve");
    expect(err).toContain("a-dep@catalog:aaaaaaaaaaaaaaaaa failed to resolve");
  });

  test("invalid dependency version", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "catalog-error-2",
        workspaces: {
          catalog: {
            "no-deps": ".:",
          },
        },
        dependencies: {
          "no-deps": "catalog:",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const out = await Bun.readableStreamToText(stdout);
    const err = stderrForInstall(await Bun.readableStreamToText(stderr));

    expect(err).toContain("no-deps@catalog: failed to resolve");
  });
});
