// Verifies src/runtime/test_runner/harness/recover.rs does not reference
// setcontext()/getcontext() when compiled for Android. bionic never
// implemented the ucontext family (obsoleted in POSIX.1-2008), so linking
// against it would fail. The fix routes Android through the setjmp/longjmp
// path already used for musl.
//
// This test builds the `bun_runtime` crate as an rlib for
// aarch64-linux-android and inspects the undefined symbols it emits.

import { describe, expect, test } from "bun:test";
import { isLinux } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

function hasAndroidTarget(rustup: string): boolean {
  const r = Bun.spawnSync({
    cmd: [rustup, "target", "list", "--installed"],
    stdout: "pipe",
    stderr: "pipe",
  });
  return r.exitCode === 0 && r.stdout.toString().includes("aarch64-linux-android");
}

// CI test runners ship a stripped checkout without vendor/ path deps
// (e.g. vendor/lolhtml/c-api). `cargo metadata` (without --no-deps) fails
// fast when any workspace path dep is missing, so use it as the "is the
// workspace buildable here" probe. A timeout bounds the module-scope
// probe in case cargo blocks on the global package-cache lock or a slow
// registry fetch — on timeout, exitCode is null and we skip. (--offline
// would over-skip: it fails when any transitive registry crate isn't in
// the local cache, even when `cargo build -p bun_runtime` has everything
// it needs.)
function workspaceResolvable(cargo: string): boolean {
  const r = Bun.spawnSync({
    cmd: [cargo, "metadata", "--format-version=1", "--locked"],
    cwd: repoRoot,
    stdout: "ignore",
    stderr: "ignore",
    timeout: 30_000,
  });
  return r.exitCode === 0;
}

const cargo = Bun.which("cargo");
// rustup is checked separately — distro-packaged cargo (apt/dnf) ships
// without it, and Bun.spawnSync throws ENOENT (it does not return a
// non-zero exitCode) when the executable is missing.
const rustup = Bun.which("rustup");
const skip = !isLinux || cargo == null || rustup == null || !hasAndroidTarget(rustup) || !workspaceResolvable(cargo);

describe.skipIf(skip)("recover.rs on Android", () => {
  // Building bun_runtime for aarch64-linux-android can be slow on a cold
  // cargo cache; warm incremental rebuilds are ~40s.
  test(
    "does not reference setcontext/getcontext (bionic lacks them)",
    async () => {
      // Build bun_runtime as an rlib for Android. Reuses the workspace
      // target dir so cached dependency builds aren't thrown away — only
      // bun_runtime itself is rebuilt if its sources changed. Pin
      // --target-dir so an ambient CARGO_TARGET_DIR doesn't redirect
      // output away from the rlib path checked below.
      await using build = Bun.spawn({
        cmd: [
          cargo!,
          "build",
          "-p",
          "bun_runtime",
          "--target",
          "aarch64-linux-android",
          "--target-dir",
          "target",
          "--message-format=short",
        ],
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CARGO_TERM_COLOR: "never" },
      });
      const [buildOut, buildErr, buildExit] = await Promise.all([
        build.stdout.text(),
        build.stderr.text(),
        build.exited,
      ]);
      if (buildExit !== 0) {
        // Surface the cargo output so the failure is actionable.
        expect(buildErr + buildOut).toBe("");
      }
      expect(buildExit).toBe(0);

      const rlib = join(repoRoot, "target", "aarch64-linux-android", "debug", "libbun_runtime.rlib");
      expect(existsSync(rlib)).toBe(true);

      await using nm = Bun.spawn({
        cmd: ["nm", "-u", rlib],
        stdout: "pipe",
        stderr: "pipe",
      });
      const [nmOut, nmErr, nmExit] = await Promise.all([nm.stdout.text(), nm.stderr.text(), nm.exited]);
      // nm on an .rlib prints "no symbols" for some archive members; that's
      // expected noise on stderr.
      void nmErr;

      const undef = new Set(
        nmOut
          .split("\n")
          .map(l => l.trim().replace(/^U\s+/, "").split(/\s+/).pop())
          .filter(Boolean),
      );

      // bionic does not provide setcontext/getcontext; referencing them
      // makes the crate unlinkable on Android.
      expect(undef.has("setcontext")).toBe(false);
      expect(undef.has("getcontext")).toBe(false);

      // It should instead go through setjmp/longjmp, which bionic has.
      expect(undef.has("setjmp")).toBe(true);
      expect(undef.has("longjmp")).toBe(true);
      expect(nmExit).toBe(0);
    },
    10 * 60 * 1000,
  );
});
