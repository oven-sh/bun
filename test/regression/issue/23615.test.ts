// https://github.com/oven-sh/bun/issues/23615
//
// When a workspace package declares a peer dependency using `catalog:`,
// the dependency's version tag is `.catalog` instead of `.npm`. The
// lockfile tree builder only ran the peer `satisfies()` hoist check for
// `.npm` versions, so `catalog:` peers could end up placed at a nested
// tree level (writing an extra `"<pkg>/<peer>"` entry into bun.lock) and
// resolving to a different package than the equivalent npm range would.
// With the isolated linker this surfaces as the workspace package linking
// to a different copy of the peer than its consumer, breaking dedup.

import { file, spawn } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readlinkSync } from "fs";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, readdirSorted } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

async function install(packageDir: string) {
  const { stderr, stdout, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
  return { out, err, code };
}

test("catalog: peer dependency hoists like the equivalent npm range (isolated)", async () => {
  // Two versions of `no-deps` will exist in the lockfile:
  //   - 1.0.0 (direct dependency of workspace `app`)
  //   - 2.0.0 (transitive via root's `one-fixed-dep@2.0.0`)
  //
  // Workspace `lib` declares `peerDependencies: { no-deps: "catalog:" }`
  // where the catalog entry is the range `>=1.0.0`. The peer resolver will
  // pick 2.0.0 (highest satisfying), but when building the lockfile tree
  // under `app` — which already provides `no-deps@1.0.0` and whose range
  // `>=1.0.0` is satisfied by 1.0.0 — the peer should hoist and reuse
  // app's copy. Previously the `.catalog` tag skipped that check and lib
  // got its own nested `no-deps@2.0.0`.
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: {
          packages: ["packages/*"],
          catalog: {
            "no-deps": ">=1.0.0",
          },
        },
        dependencies: {
          "one-fixed-dep": "2.0.0",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        dependencies: {
          "no-deps": "1.0.0",
          "lib": "workspace:*",
        },
      }),
      "packages/lib/package.json": JSON.stringify({
        name: "lib",
        peerDependencies: {
          "no-deps": "catalog:",
        },
      }),
    },
  });

  // fresh install (no lockfile, no node_modules)
  {
    const { err, code } = await install(packageDir);
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
  }

  // The lockfile tree should have hoisted lib's catalog peer the same way
  // it would an npm range: no nested `lib/no-deps` entry.
  const lockfile = await file(join(packageDir, "bun.lock")).text();
  expect(lockfile).not.toContain('"lib/no-deps"');

  async function checkLinks() {
    // Both app (direct dep) and lib (catalog peer) link to the same
    // `no-deps@1.0.0` store entry — no duplicate install.
    const libNoDeps = readlinkSync(join(packageDir, "packages/lib/node_modules/no-deps"));
    const appNoDeps = readlinkSync(join(packageDir, "packages/app/node_modules/no-deps"));
    expect(libNoDeps).toContain(join("no-deps@1.0.0", "node_modules", "no-deps"));
    expect(appNoDeps).toContain(join("no-deps@1.0.0", "node_modules", "no-deps"));

    const store = await readdirSorted(join(packageDir, "node_modules/.bun"));
    expect(store).toEqual(["no-deps@1.0.0", "no-deps@2.0.0", "node_modules", "one-fixed-dep@2.0.0"]);
  }

  // reinstall from lockfile (no node_modules) — this is what runs on
  // every other machine/CI after the lockfile is committed, and where the
  // nested entry caused lib to link `no-deps@2.0.0` instead of the copy
  // its consumer `app` provides.
  {
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    const { err, code } = await install(packageDir);
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
    await checkLinks();
  }

  // reinstall with both lockfile and node_modules present
  {
    const { err, code } = await install(packageDir);
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
    await checkLinks();
  }
}, 60_000);

test("catalog: peer dependency produces same lockfile as equivalent npm range", async () => {
  // Sanity check: the lockfile produced with `catalog:` should be
  // byte-identical (modulo the workspace dep literal and the catalog
  // section itself) to the lockfile produced with the underlying npm
  // range written out directly.
  async function lockfileFor(peerVersion: string, withCatalog: boolean) {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: {
            packages: ["packages/*"],
            ...(withCatalog ? { catalog: { "no-deps": ">=1.0.0" } } : {}),
          },
          dependencies: {
            "one-fixed-dep": "2.0.0",
          },
        }),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: {
            "no-deps": "1.0.0",
            "lib": "workspace:*",
          },
        }),
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          peerDependencies: {
            "no-deps": peerVersion,
          },
        }),
      },
    });

    const { err, code } = await install(packageDir);
    expect(err).not.toContain("error:");
    expect(code).toBe(0);

    const text = await file(join(packageDir, "bun.lock")).text();
    // bun.lock uses trailing commas (not strict JSON); just extract the
    // top-level keys from the "packages" section.
    const idx = text.indexOf('"packages": {');
    expect(idx).toBeGreaterThan(-1);
    const section = text.slice(idx);
    const keys = [...section.matchAll(/^\s{4}"([^"]+)": \[/gm)].map(m => m[1]).sort();
    expect(keys.length).toBeGreaterThan(0);
    return keys;
  }

  const catalogKeys = await lockfileFor("catalog:", true);
  const npmKeys = await lockfileFor(">=1.0.0", false);

  expect(catalogKeys).toEqual(npmKeys);
}, 60_000);
