import { expect, test } from "bun:test";
import { spawnSync } from "bun";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

function createTarball(baseDir: string, pkgName: string, version: string): string {
  const tmpPkg = join(baseDir, "_tarballs", `${pkgName}-${version}`);
  mkdirSync(join(tmpPkg, "package"), { recursive: true });
  writeFileSync(join(tmpPkg, "package", "package.json"), JSON.stringify({ name: pkgName, version }));
  writeFileSync(join(tmpPkg, "package", "index.js"), `module.exports = '${pkgName}';`);
  const tgzPath = join(baseDir, "_tarballs", `${pkgName}-${version}.tgz`);
  const result = spawnSync(["tar", "czf", tgzPath, "package"], { cwd: tmpPkg });
  if (result.exitCode !== 0) throw new Error(`tar failed: ${result.stderr.toString()}`);
  return tgzPath;
}

test("bun install does not corrupt package names when workspace uses npm alias", async () => {
  using dir = tempDir("28674", {});
  const cwd = String(dir);

  // Create tarballs for mock packages
  const realPkgTgz = createTarball(cwd, "real-pkg", "1.0.0");
  const myPkgTgz = createTarball(cwd, "my-pkg", "1.0.0");
  const extraDepTgz = createTarball(cwd, "extra-dep", "1.0.0");

  // Mock registry server - runs in this process so we need concurrent I/O
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      const packages: Record<string, string> = {
        "real-pkg": realPkgTgz,
        "my-pkg": myPkgTgz,
        "extra-dep": extraDepTgz,
      };

      // Serve package manifests
      for (const [name, tgzPath] of Object.entries(packages)) {
        if (path === `/${name}`) {
          return Response.json({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name,
                version: "1.0.0",
                dist: {
                  tarball: `http://127.0.0.1:${server.port}/${name}/-/${name}-1.0.0.tgz`,
                  integrity: "",
                },
              },
            },
          });
        }
        if (path === `/${name}/-/${name}-1.0.0.tgz`) {
          return new Response(Bun.file(tgzPath));
        }
      }

      return new Response("not found", { status: 404 });
    },
  });

  const registryUrl = `http://127.0.0.1:${server.port}/`;

  // Write bunfig to point to mock registry
  writeFileSync(join(cwd, "bunfig.toml"), `[install]\nregistry = "${registryUrl}"\n`);

  // Create workspace structure
  mkdirSync(join(cwd, "packages", "workspace-a"), { recursive: true });
  mkdirSync(join(cwd, "packages", "workspace-b"), { recursive: true });

  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
  );
  writeFileSync(
    join(cwd, "packages", "workspace-a", "package.json"),
    JSON.stringify({
      name: "workspace-a",
      dependencies: {
        // npm alias: "my-pkg" resolves to "real-pkg@1.0.0"
        "my-pkg": "npm:real-pkg@1.0.0",
      },
    }),
  );
  writeFileSync(
    join(cwd, "packages", "workspace-b", "package.json"),
    JSON.stringify({
      name: "workspace-b",
      dependencies: {
        "my-pkg": "1.0.0",
      },
    }),
  );

  const spawnEnv = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") };

  // First install
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd,
      env: spawnEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  // Add a new dependency to workspace-b
  writeFileSync(
    join(cwd, "packages", "workspace-b", "package.json"),
    JSON.stringify({
      name: "workspace-b",
      dependencies: {
        "my-pkg": "1.0.0",
        "extra-dep": "1.0.0",
      },
    }),
  );

  // Second install — this previously caused corrupted package names due to
  // stale string buffer offsets in known_npm_aliases
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd,
      env: spawnEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("405");
    expect(exitCode).toBe(0);
  }

  // Read the lockfile and verify workspace-b's "my-pkg" resolved to the
  // actual "my-pkg" package, not "real-pkg" (the alias target).
  // The old code's known_npm_aliases incorrectly substituted the name.
  const lockContent = readFileSync(join(cwd, "bun.lock"), "utf8");

  // The packages section must contain a resolution "my-pkg@1.0.0" (the real
  // package), not just "real-pkg@1.0.0". With the old buggy code, my-pkg was
  // incorrectly resolved as real-pkg so "my-pkg@1.0.0" never appeared.
  expect(lockContent).toContain('"my-pkg@1.0.0"');
  expect(lockContent).toContain('"real-pkg@1.0.0"');
});
