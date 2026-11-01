import { file, spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { exists } from "fs/promises";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

// These tests cover the `configVersion` field in bun.lock and the linker
// selection it gates. They run fully offline using file:/workspace: deps so no
// registry process is spawned; see lockfile-version-2.test.ts for the same
// pattern. All three spawn into independent tempdirs and run concurrently.

async function install(cwd: string) {
  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

describe.concurrent("configVersion", () => {
  test("new projects use current config version", async () => {
    using dir = tempDir("config-version-new-proj", {
      "package.json": JSON.stringify({
        name: "new-proj",
        dependencies: { dep: "file:./dep" },
      }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
    const packageDir = String(dir);

    const { out, err, exitCode } = await install(packageDir);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + dep@dep

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    // non-monorepo: hoisted linker, no .bun store
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules/.bun")),
        file(join(packageDir, "node_modules/dep/package.json")).json(),
      ]),
    ).toEqual([false, { name: "dep", version: "1.0.0" }]);

    expect(await file(join(packageDir, "bun.lock")).text()).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "new-proj",
            "dependencies": {
              "dep": "file:./dep",
            },
          },
        },
        "packages": {
          "dep": ["dep@file:dep", {}],
        }
      }
      "
    `);
  });

  test("new monorepos use isolated linker", async () => {
    using dir = tempDir("config-version-new-monorepo", {
      "package.json": JSON.stringify({
        name: "new-proj",
        workspaces: ["packages/*"],
      }),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        dependencies: { dep: "file:../../dep" },
      }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
    const packageDir = String(dir);

    const { out, err, exitCode } = await install(packageDir);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    // monorepo: isolated linker, dep lives in the .bun store and is linked into pkg1
    expect(
      await Promise.all([
        exists(join(packageDir, "packages/pkg1/node_modules/dep")),
        file(join(packageDir, "node_modules/.bun/dep@file+dep/node_modules/dep/package.json")).json(),
      ]),
    ).toEqual([true, { name: "dep", version: "1.0.0" }]);

    expect(await file(join(packageDir, "bun.lock")).text()).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "new-proj",
          },
          "packages/pkg1": {
            "name": "pkg1",
            "dependencies": {
              "dep": "file:../../dep",
            },
          },
        },
        "packages": {
          "pkg1": ["pkg1@workspace:packages/pkg1"],

          "pkg1/dep": ["dep@file:dep", {}],
        }
      }
      "
    `);
  });

  test.each([true, false])("bun pm trust keeps the lockfile's configVersion (text = %p)", async text => {
    using dir = tempDir("config-version-pm-trust", {
      "bunfig.toml": `[install]\nsaveTextLockfile = ${text}\n`,
      "package.json": JSON.stringify({
        name: "root-1",
        dependencies: { dep: "file:./dep" },
      }),
      "dep/package.json": JSON.stringify({
        name: "dep",
        version: "1.0.0",
        scripts: { postinstall: "echo postinstall" },
      }),
    });
    const packageDir = String(dir);

    const { out, err, exitCode } = await install(packageDir);
    expect(err).toContain("Saved lockfile");
    expect(out).toContain("Blocked 1 postinstall");
    expect(exitCode).toBe(0);

    // A project that predates configVersion 1, or one migrated from npm or yarn.
    const lockfile = join(packageDir, text ? "bun.lock" : "bun.lockb");
    const v0 = Buffer.from(await file(lockfile).arrayBuffer());
    const at = text ? v0.indexOf(`"configVersion": 1,`) + `"configVersion": `.length : v0.indexOf("cNfGvRsN") + 8;
    expect(v0[at]).toBe(text ? "1".charCodeAt(0) : 1);
    v0[at] -= 1;
    await Bun.write(lockfile, v0);

    await using trust = spawn({
      cmd: [bunExe(), "pm", "trust", "dep"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [trustErr, trustExitCode] = await Promise.all([trust.stderr.text(), trust.exited]);
    expect(trustErr).not.toContain("error:");
    expect(trustExitCode).toBe(0);

    const saved = Buffer.from(await file(lockfile).arrayBuffer());
    expect(saved.equals(v0)).toBe(false);
    if (text) {
      expect(saved.toString()).toBe(
        v0.toString().replace(`  "packages": {`, `  "trustedDependencies": [\n    "dep",\n  ],\n  "packages": {`),
      );
    } else {
      expect(saved[saved.indexOf("cNfGvRsN") + 8]).toBe(0);
    }
  });

  // None of the three has a `configVersion`, `trustedDependencies` or bun's `patchedDependencies`.
  test.each([
    [
      "package-lock.json",
      JSON.stringify({
        name: "app",
        lockfileVersion: 3,
        packages: {
          "": { name: "app", dependencies: { dep: "file:dep" } },
          "dep": { version: "1.0.0" },
          "node_modules/dep": { resolved: "dep", link: true },
        },
      }),
    ],
    ["yarn.lock", `# yarn lockfile v1\n\n\n"dep@file:dep":\n  version "1.0.0"\n`],
    [
      "pnpm-lock.yaml",
      `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      dep:
        specifier: file:dep
        version: file:dep
packages:
  dep@file:dep:
    resolution: {directory: dep, type: directory}
snapshots:
  dep@file:dep: {}
`,
    ],
  ])("bun pm migrate writes the bun.lock of an install that migrates %s", async (name, foreign) => {
    const results = [];
    for (const args of [
      ["pm", "migrate"],
      ["install", "--lockfile-only"],
    ]) {
      using dir = tempDir("config-version-pm-migrate", {
        "package.json": JSON.stringify({
          name: "app",
          dependencies: { dep: "file:dep" },
          trustedDependencies: ["dep"],
          patchedDependencies: { "dep@1.0.0": "dep.patch" },
        }),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        "dep.patch": "diff --git a/index.js b/index.js\n",
        [name]: foreign,
      });
      await using proc = spawn({ cmd: [bunExe(), ...args], cwd: String(dir), env: bunEnv, stderr: "pipe" });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(err).toContain(`migrated lockfile from ${name}`);
      expect(exitCode).toBe(0);
      results.push(await file(join(String(dir), "bun.lock")).text());
    }
    expect(results[0]).toContain(`"trustedDependencies"`);
    expect(results[0]).toBe(results[1]);
  });

  test("should add configVersion@v0 to an existing lockfile", async () => {
    using dir = tempDir("config-version-existing-lockfile", {
      "package.json": JSON.stringify({
        name: "root-1",
        workspaces: ["packages/*"],
        dependencies: { pkg1: "workspace:*" },
      }),
      "packages/pkg1/package.json": JSON.stringify({ name: "pkg1" }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "new-proj",
            dependencies: { pkg1: "workspace:*" },
          },
          "packages/pkg1": { name: "pkg1" },
        },
        packages: {
          pkg1: ["pkg1@workspace:packages/pkg1"],
        },
      }),
    });
    const packageDir = String(dir);

    const { out, err, exitCode } = await install(packageDir);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    expect(normalizeBunSnapshot(out, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + pkg1@workspace:packages/pkg1

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    // should be hoisted install
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules/.bun")),
        file(join(packageDir, "node_modules/pkg1/package.json")).json(),
      ]),
    ).toEqual([false, { name: "pkg1" }]);

    // lockfileVersion stays 1 — an existing lockfile is never bumped on re-save.
    // configVersion is backfilled (0) because the loaded lockfile had none.
    expect(await file(join(packageDir, "bun.lock")).text()).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 1,
        "configVersion": 0,
        "workspaces": {
          "": {
            "name": "root-1",
            "dependencies": {
              "pkg1": "workspace:*",
            },
          },
          "packages/pkg1": {
            "name": "pkg1",
          },
        },
        "packages": {
          "pkg1": ["pkg1@workspace:packages/pkg1"],
        }
      }
      "
    `);
  });
});
