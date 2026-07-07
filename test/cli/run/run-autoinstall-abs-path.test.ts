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
//
// Kept in its own file because the sibling run-autoinstall.test.ts cases mutate the
// shared bunEnv and routinely time out on debug/ASAN builds when hitting the live
// registry, which would otherwise mask this test's pass/fail signal.
test("auto-install: DirInfo.abs_path survives threadlocal buffer reuse across resolutions", async () => {
  using dir = tempDir("autoinstall-abs-path", {
    // No package.json / node_modules so global_cache defaults to .auto (resolver.zig canUse).
    // nanoid has `exports` with a `./non-secure` subpath, enabling the self-reference
    // branch at resolver.zig:1807. left-pad's cache folder name is longer than nanoid's,
    // so nanoid's cached abs_path slice becomes a truncated prefix of left-pad's path
    // once left-pad is resolved. left-pad is archived so its version string is stable.
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
  // Cold-cache download of two packages from the live registry on a debug/ASAN build
  // routinely exceeds the 5s default; other registry-hitting tests (bun-add.test.ts,
  // bun-create.test.ts) use the same pattern.
}, 30_000);
