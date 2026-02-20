// https://github.com/oven-sh/bun/issues/25752
// Catalog entries with `file:./...` paths should resolve relative to the root
// package.json (where catalogs are defined), not the workspace that references them.

import { file } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, pack, tempDir } from "harness";
import { join } from "path";

test("catalog file: paths resolve relative to root, not workspace", async () => {
  // First create a simple package and pack it to get a tarball
  using pkgDir = tempDir("pkg-for-tarball", {
    "package.json": JSON.stringify({
      name: "catalog-pkg",
      version: "1.0.0",
    }),
    "index.js": "module.exports = 'catalog-pkg';",
  });

  await pack(String(pkgDir), bunEnv);
  const tarballContent = await file(join(String(pkgDir), "catalog-pkg-1.0.0.tgz")).arrayBuffer();

  // Create the monorepo structure
  using monorepoDir = tempDir("monorepo-25752", {
    "package.json": JSON.stringify({
      name: "my-monorepo",
      workspaces: ["packages/*"],
      catalogs: {
        vendored: {
          "catalog-pkg": "file:./vendored/catalog-pkg-1.0.0.tgz",
        },
      },
    }),
    vendored: {
      "catalog-pkg-1.0.0.tgz": new Uint8Array(tarballContent),
    },
    packages: {
      "my-app": {
        "package.json": JSON.stringify({
          name: "my-app",
          dependencies: {
            "catalog-pkg": "catalog:vendored",
          },
        }),
      },
    },
  });

  // Run bun install
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(monorepoDir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The tarball should be resolved relative to the root (where catalogs is defined),
  // not relative to packages/my-app where the dependency is declared
  expect(stderr).not.toContain("ENOENT");
  expect(stderr).not.toContain("failed to resolve");
  expect(exitCode).toBe(0);

  // Verify the package was installed correctly in the workspace's node_modules
  const installedPkg = await file(
    join(String(monorepoDir), "packages", "my-app", "node_modules", "catalog-pkg", "package.json"),
  ).json();
  expect(installedPkg.name).toBe("catalog-pkg");
  expect(installedPkg.version).toBe("1.0.0");
});
