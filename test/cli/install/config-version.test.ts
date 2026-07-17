import { file } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { exists } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunEnv as env, runBunInstall } from "harness";
import { join } from "path";

var registry = new VerdaccioRegistry();

// Two tests below resolve a real package (`no-deps`) from Verdaccio. The
// registry runs as a forked child and, in some sandboxed CI environments, can
// fail to actually serve packages even after `start()` returns. Gate those two
// on whether the registry can serve the `no-deps` manifest — the exact thing
// they install — so they run wherever the registry works and skip (rather than
// fail with `ConnectionRefused`) where it doesn't. The third test is offline
// (workspace-only) and always runs.
// Start fire-and-forget: `start()` only settles on its IPC "ready" message (or
// a spawn error), so a child that exits without signalling — the sandbox case
// this gating handles — would leave an awaited `start()` hanging forever and
// drop every test in this file. The bounded poll below is the sole readiness
// signal.
let registryCanServe = false;
registry.start().catch(() => {});
const registryDeadline = Date.now() + 30_000;
while (Date.now() < registryDeadline) {
  try {
    const res = await fetch(`${registry.registryUrl()}no-deps`, { signal: AbortSignal.timeout(2_000) });
    await res.arrayBuffer();
    if (res.ok) {
      registryCanServe = true;
      break;
    }
  } catch {}
  await Bun.sleep(250);
}

afterAll(() => {
  registry.stop();
});

describe("configVersion", () => {
  test.skipIf(!registryCanServe)("new projects use current config version", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "new-proj",
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(env, packageDir);

    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules/.bun")),
        file(join(packageDir, "node_modules/no-deps/package.json")).json(),
      ]),
    ).toEqual([false, { name: "no-deps", version: "1.0.0" }]);

    const lockfile = await (
      await file(join(packageDir, "bun.lock")).text()
    ).replaceAll(/localhost:\d+/g, "localhost:1234");
    expect(lockfile).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "new-proj",
            "dependencies": {
              "no-deps": "1.0.0",
            },
          },
        },
        "packages": {
          "no-deps": ["no-deps@1.0.0", "http://localhost:1234/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw=="],
        }
      }
      "
    `);
  });

  test.skipIf(!registryCanServe)("new monorepos use isolated linker", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "new-proj",
          workspaces: ["packages/*"],
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      },
    });

    await runBunInstall(env, packageDir);

    expect(
      await Promise.all([
        exists(join(packageDir, "packages/pkg1/node_modules/no-deps")),
        file(join(packageDir, "node_modules/.bun/no-deps@1.0.0/node_modules/no-deps/package.json")).json(),
      ]),
    ).toEqual([true, { name: "no-deps", version: "1.0.0" }]);

    const lockfile = await (
      await file(join(packageDir, "bun.lock")).text()
    ).replaceAll(/localhost:\d+/g, "localhost:1234");
    expect(lockfile).toMatchInlineSnapshot(`
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
              "no-deps": "1.0.0",
            },
          },
        },
        "packages": {
          "no-deps": ["no-deps@1.0.0", "http://localhost:1234/no-deps/-/no-deps-1.0.0.tgz", {}, "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw=="],

          "pkg1": ["pkg1@workspace:packages/pkg1"],
        }
      }
      "
    `);
  });

  test("should add configVersion@v0 to an existing lockfile", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "root-1",
          workspaces: ["packages/*"],
          dependencies: {
            "pkg1": "workspace:*",
          },
        }),
        "packages/pkg1/package.json": JSON.stringify({
          "name": "pkg1",
        }),
        "bun.lock": JSON.stringify({
          "lockfileVersion": 1,
          "workspaces": {
            "": {
              "name": "new-proj",
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
          },
        }),
      },
    });

    await runBunInstall(bunEnv, packageDir);

    // should be hoisted install
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules/.bun")),
        file(join(packageDir, "node_modules/pkg1/package.json")).json(),
      ]),
    ).toEqual([false, { name: "pkg1" }]);

    const lockfile = await (
      await file(join(packageDir, "bun.lock")).text()
    ).replaceAll(/localhost:\d+/g, "localhost:1234");
    // lockfileVersion stays 1 — an existing lockfile is never bumped on re-save.
    // configVersion is backfilled (0) because the loaded lockfile had none.
    expect(lockfile).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 1,
        "configVersion": 0,
        "workspaces": {
          "": {
            "name": "new-proj",
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
