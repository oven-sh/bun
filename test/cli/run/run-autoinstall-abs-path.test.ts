import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// dirInfoForResolution stored DirInfo.abs_path as a slice into the threadlocal
// bufs(.path_in_global_disk_cache) buffer. After auto-installing a second package, that
// buffer is overwritten and the first package's cached DirInfo.abs_path points at stale
// bytes. When a module inside the first package then resolves its own name (package
// self-reference), loadNodeModules reads dir_info.abs_path directly and looks up a
// garbage path. With global_cache=.auto the auto-install fallback is skipped because
// any_node_modules_folder was set by the self-reference branch, so resolution fails with
// "Cannot find module". With the fix, abs_path is interned in DirnameStore and stays
// valid. A debug assertion in dirInfoUncached additionally guards the invariant.
test("auto-install: DirInfo.abs_path survives threadlocal buffer reuse across resolutions", async () => {
  const packages: Record<string, { manifest: object; tarball: Uint8Array }> = {};
  for (const [name, fields, files] of [
    [
      "nanoid",
      { exports: { ".": "./index.js", "./non-secure": "./non-secure/index.js" } },
      { "index.js": "", "non-secure/index.js": "" },
    ],
    ["left-pad", {}, { "index.js": "" }],
  ] as [string, object, Record<string, string>][]) {
    const manifest = { name, version: "1.0.0", ...fields };
    const tarball = await new Bun.Archive(
      Object.fromEntries(
        Object.entries({ "package.json": JSON.stringify(manifest), ...files }).map(([k, v]) => [`package/${k}`, v]),
      ),
      { compress: "gzip" },
    ).bytes();
    packages[name] = { manifest, tarball };
  }
  using registry = Bun.serve({
    port: 0,
    fetch(req) {
      const { origin, pathname } = new URL(req.url);
      const [, name, tgz] = pathname.split("/");
      const pkg = packages[name];
      if (!pkg) return new Response("not found", { status: 404 });
      if (tgz) return new Response(pkg.tarball);
      return Response.json({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { ...pkg.manifest, dist: { tarball: `${origin}/${name}/1.0.0.tgz` } } },
      });
    },
  });

  using dir = tempDir("autoinstall-abs-path", {
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
    // No package.json / node_modules so global_cache defaults to .auto (resolver.zig canUse).
    // nanoid has `exports` with a `./non-secure` subpath, enabling the self-reference
    // branch at resolver.zig:1807. left-pad's cache folder name is longer than nanoid's,
    // so nanoid's cached abs_path slice becomes a truncated prefix of left-pad's path
    // once left-pad is resolved. Both are stand-ins for the packages on npm.
    "index.js": `
      const path = require("path");
      const { createRequire } = require("module");

      const nanoidPath = require.resolve("nanoid");
      const nanoidDir = path.dirname(nanoidPath);
      require.resolve("left-pad");

      const innerRequire = createRequire(nanoidPath);
      const nonSecure = innerRequire.resolve("nanoid/non-secure");
      if (!nonSecure.startsWith(nanoidDir)) {
        throw new Error("self-reference resolved outside package dir: " + nonSecure + " vs " + nanoidDir);
      }
      console.log("resolved");
    `,
  });

  await using proc = Bun.spawn({
    // Deliberately no -i / --install flag: default .auto prevents the auto-install
    // fallback from masking the corrupted abs_path.
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    // Use a per-test cache dir: a shared cache can be left half-populated (extracted dir
    // present, name/version symlink missing) if a prior run is killed mid-install, which
    // makes pathForCachedNPMPath's readlinkat return ENOENT before auto-install kicks in.
    env: {
      ...bunEnv,
      BUN_INSTALL: undefined,
      BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout.trim()).toBe("resolved");
  expect(exitCode).toBe(0);
});
