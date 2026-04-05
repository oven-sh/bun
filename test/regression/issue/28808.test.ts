// https://github.com/oven-sh/bun/issues/28808
// `bun update <pkg>@latest` should override a pinned exact version in package.json.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

/**
 * Creates a minimal valid npm tarball (.tgz) containing only package/package.json.
 */
function createMinimalTarball(pkgJson: object): Buffer {
  const content = Buffer.from(JSON.stringify(pkgJson));
  const filename = "package/package.json";

  const header = Buffer.alloc(512, 0);
  header.write(filename, 0);
  header.write("0000644\0", 100);
  header.write("0001000\0", 108);
  header.write("0001000\0", 116);
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124);
  header.write(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0") + "\0",
    136,
  );
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);

  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);

  const dataBlocks = Buffer.alloc(Math.ceil(content.length / 512) * 512, 0);
  content.copy(dataBlocks);

  return Buffer.from(Bun.gzipSync(Buffer.concat([header, dataBlocks, Buffer.alloc(1024, 0)])));
}

test("bun update <pkg>@latest updates past a pinned exact version", async () => {
  const pkgName = "test-pinned-update";
  const oldVersion = "1.0.0";
  const newVersion = "1.0.1";

  const oldTarball = createMinimalTarball({ name: pkgName, version: oldVersion });
  const newTarball = createMinimalTarball({ name: pkgName, version: newVersion });

  const oldShasum = new Bun.CryptoHasher("sha1").update(oldTarball).digest("hex");
  const oldIntegrity = "sha512-" + new Bun.CryptoHasher("sha512").update(oldTarball).digest("base64");
  const newShasum = new Bun.CryptoHasher("sha1").update(newTarball).digest("hex");
  const newIntegrity = "sha512-" + new Bun.CryptoHasher("sha512").update(newTarball).digest("base64");

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith(`${pkgName}-${oldVersion}.tgz`)) {
        return new Response(oldTarball, { headers: { "Content-Type": "application/octet-stream" } });
      }
      if (url.pathname.endsWith(`${pkgName}-${newVersion}.tgz`)) {
        return new Response(newTarball, { headers: { "Content-Type": "application/octet-stream" } });
      }
      if (url.pathname === `/${pkgName}`) {
        const base = `http://localhost:${server.port}/${pkgName}/-/`;
        return Response.json({
          name: pkgName,
          "dist-tags": { latest: newVersion },
          versions: {
            [oldVersion]: {
              name: pkgName,
              version: oldVersion,
              dist: { tarball: `${base}${pkgName}-${oldVersion}.tgz`, shasum: oldShasum, integrity: oldIntegrity },
            },
            [newVersion]: {
              name: pkgName,
              version: newVersion,
              dist: { tarball: `${base}${pkgName}-${newVersion}.tgz`, shasum: newShasum, integrity: newIntegrity },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  using dir = tempDir("issue-28808", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: { [pkgName]: oldVersion }, // pinned exact version
    }),
    "bunfig.toml": `[install]\nregistry = "http://localhost:${server.port}/"\ncache = false\n`,
  });

  const installEnv = {
    ...bunEnv,
    BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
  };

  // Install the pinned version first.
  let installExitCode: number;
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    installExitCode = exitCode;
  }

  // Sanity: installed version is the pinned one.
  const installedBefore = await Bun.file(join(String(dir), "node_modules", pkgName, "package.json")).json();
  expect(installedBefore.version).toBe(oldVersion);
  expect(installExitCode).toBe(0);

  // Run `bun update <pkg>@latest` — should bump past the pinned version.
  let updateExitCode: number;
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", `${pkgName}@latest`],
      cwd: String(dir),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    updateExitCode = exitCode;
  }

  // Installed version on disk should now be the new one.
  const installedAfter = await Bun.file(join(String(dir), "node_modules", pkgName, "package.json")).json();
  expect(installedAfter.version).toBe(newVersion);

  // package.json should have been rewritten to the new version, preserving the exact pinning style.
  const editedPkg = await Bun.file(join(String(dir), "package.json")).json();
  expect(editedPkg.dependencies[pkgName]).toBe(newVersion);
  expect(updateExitCode).toBe(0);
});
