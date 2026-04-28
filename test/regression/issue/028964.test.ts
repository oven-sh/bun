// https://github.com/oven-sh/bun/issues/28964
//
// `bun install <pkg>` to replace a linked package did not update the symlink
// in node_modules. The install would rewrite package.json / bun.lock but leave
// `node_modules/<pkg>` as a symlink to the original `bun link`ed clone.
//
// Root cause: PackageInstall.verify() read the installed package's package.json
// through `openat` (which follows symlinks). If the symlinked clone's name and
// version matched the new resolution, verify returned true and the install was
// skipped. The fix is to lstat the existing entry and force a reinstall when
// its form (symlink vs. real directory) doesn't match the new resolution tag.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PKG_NAME = "reg-28964-pkg";

async function run(cmd: string[], cwd: string, env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(
      `bun ${cmd.join(" ")} (cwd=${cwd}) exited with ${exitCode}\n` + `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    );
  }
  return { stdout, stderr };
}

// Minimal local npm-style registry that hands back a single version of
// `PKG_NAME` whose tarball points back to the same server.
function startRegistry(tarballPath: string, version: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === `/${PKG_NAME}`) {
        return Response.json({
          name: PKG_NAME,
          "dist-tags": { latest: version },
          versions: {
            [version]: {
              name: PKG_NAME,
              version,
              dist: {
                tarball: `http://localhost:${this.port}/${PKG_NAME}-${version}.tgz`,
              },
            },
          },
        });
      }
      if (url.pathname === `/${PKG_NAME}-${version}.tgz`) {
        return new Response(Bun.file(tarballPath));
      }
      return new Response("not found", { status: 404 });
    },
  });
}

// `bun link --save` creates directory junctions on Windows, whose POSIX stat
// form (junction vs. symlink) trips up `lstatSync(...).isSymbolicLink()`. The
// install code path being fixed here is platform-independent — the assertions
// are the Windows-unfriendly piece — so skip on Windows rather than weaken the
// checks everywhere.
test.concurrent.skipIf(isWindows)(
  "bun install <pkg> after `bun link --save <pkg>` replaces the symlink in node_modules",
  async () => {
    const globalDir = tmpdirSync();

    // The "linked" clone: a local directory that `bun link`s globally. It carries
    // a LINKED marker file so we can tell it apart from a tarball install.
    using linked = tempDir("028964-linked-", {
      "package.json": JSON.stringify({ name: PKG_NAME, version: "1.0.0" }),
      "marker.txt": "LINKED",
    });

    // A separate source with the exact same name and version that we pack into
    // a tarball served by our local registry. Same name+version is exactly the
    // case that tricked verify() before: reading the linked clone's package.json
    // through the symlink produced a matching (name, version) so the install
    // was skipped and the symlink was never replaced.
    using tarballSrc = tempDir("028964-tarball-", {
      "package.json": JSON.stringify({ name: PKG_NAME, version: "1.0.0" }),
      "marker.txt": "TARBALL",
    });

    const isolatedEnv = {
      ...bunEnv,
      BUN_INSTALL_GLOBAL_DIR: globalDir,
    };

    await run(["pm", "pack"], String(tarballSrc), isolatedEnv);
    const tarballPath = join(String(tarballSrc), `${PKG_NAME}-1.0.0.tgz`);

    await using server = startRegistry(tarballPath, "1.0.0");

    const consumerDir = tmpdirSync();
    await Bun.write(join(consumerDir, "package.json"), JSON.stringify({ name: "consumer", version: "0.0.0" }));
    // Point bun at our local registry + isolate the install cache.
    await Bun.write(
      join(consumerDir, "bunfig.toml"),
      `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"\nsaveTextLockfile = true\n`,
    );

    // 1. Register the linked clone globally, then link it into the consumer.
    await run(["link"], String(linked), isolatedEnv);
    await run(["link", "--save", PKG_NAME], consumerDir, isolatedEnv);

    // Sanity: the consumer's node_modules entry is a symlink to the linked clone
    // so the LINKED marker shows through.
    const pkgPath = join(consumerDir, "node_modules", PKG_NAME);
    expect(lstatSync(pkgPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(pkgPath, "marker.txt"), "utf8")).toBe("LINKED");

    // 2. Now run `bun install <name>` to replace the link with the npm version.
    await run(["install", PKG_NAME], consumerDir, isolatedEnv);

    // package.json should be rewritten off of the link.
    const pkgJson = JSON.parse(readFileSync(join(consumerDir, "package.json"), "utf8"));
    expect(pkgJson.dependencies[PKG_NAME]).not.toContain("link:");

    // Before the fix: node_modules/<pkg> was still a symlink into the linked
    // clone, so marker.txt still read "LINKED". After the fix it's a real
    // directory extracted from the tarball.
    expect(lstatSync(pkgPath).isSymbolicLink()).toBe(false);
    expect(lstatSync(pkgPath).isDirectory()).toBe(true);
    expect(readFileSync(join(pkgPath, "marker.txt"), "utf8")).toBe("TARBALL");
  },
);

test.concurrent.skipIf(isWindows)(
  "bun link --save <pkg> after an npm install replaces the real directory with a symlink",
  async () => {
    // The reverse direction: start with a real extracted package from the
    // registry, then switch to a `bun link`. Before the fix, verify() would see
    // the real directory with a matching package.json and skip the install —
    // leaving node_modules as a real directory instead of the expected symlink.
    const globalDir = tmpdirSync();
    const REV_NAME = "reg-28964-rev";

    using tarballSrc = tempDir("028964-rev-tarball-", {
      "package.json": JSON.stringify({ name: REV_NAME, version: "1.0.0" }),
      "marker.txt": "TARBALL",
    });

    using linked = tempDir("028964-rev-linked-", {
      "package.json": JSON.stringify({ name: REV_NAME, version: "1.0.0" }),
      "marker.txt": "LINKED",
    });

    const isolatedEnv = {
      ...bunEnv,
      BUN_INSTALL_GLOBAL_DIR: globalDir,
    };

    await run(["pm", "pack"], String(tarballSrc), isolatedEnv);
    const tarballPath = join(String(tarballSrc), `${REV_NAME}-1.0.0.tgz`);

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === `/${REV_NAME}`) {
          return Response.json({
            name: REV_NAME,
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: REV_NAME,
                version: "1.0.0",
                dist: { tarball: `http://localhost:${this.port}/${REV_NAME}-1.0.0.tgz` },
              },
            },
          });
        }
        if (url.pathname === `/${REV_NAME}-1.0.0.tgz`) {
          return new Response(Bun.file(tarballPath));
        }
        return new Response("not found", { status: 404 });
      },
    });

    const consumerDir = tmpdirSync();
    await Bun.write(join(consumerDir, "package.json"), JSON.stringify({ name: "consumer", version: "0.0.0" }));
    await Bun.write(
      join(consumerDir, "bunfig.toml"),
      `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"\nsaveTextLockfile = true\n`,
    );

    // Install from the registry first — this lays down a real directory.
    await run(["install", REV_NAME], consumerDir, isolatedEnv);
    const pkgPath = join(consumerDir, "node_modules", REV_NAME);
    expect(lstatSync(pkgPath).isDirectory()).toBe(true);
    expect(lstatSync(pkgPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(pkgPath, "marker.txt"), "utf8")).toBe("TARBALL");

    // Now register and link the clone. The real directory must be replaced by
    // the symlink — without the fix, verify() saw the real package.json and
    // skipped the reinstall.
    await run(["link"], String(linked), isolatedEnv);
    await run(["link", "--save", REV_NAME], consumerDir, isolatedEnv);

    expect(lstatSync(pkgPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(pkgPath, "marker.txt"), "utf8")).toBe("LINKED");
  },
);
