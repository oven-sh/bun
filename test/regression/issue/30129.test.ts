// https://github.com/oven-sh/bun/issues/30129
//
// On Windows, `bun install -g <pkg>` panicked at `install/bin.zig:738` with
// "Internal assertion failure" when `BUN_INSTALL_BIN` lived on a different
// physical drive from the global package store. `createWindowsShim` assumed
// the stored `bin_path` could always be expressed as a `..\`-relative walk
// from the shim's `.bin` directory. Windows cannot produce such a walk
// between two volumes, so `path.relative` returned the absolute target
// instead and the assertion fired — after the `.bunx` file had already been
// opened with O_TRUNC, leaving an empty 0-byte `.bunx` behind.
//
// The same assertion family also fires on POSIX (`createSymlink`) and on
// Windows (`createWindowsShim`) for the *zero-`..`* shape, where a package's
// `bin` field resolves to a file *inside* the sibling `.bin` directory. That
// is the shape this test exercises on both Linux and Windows CI. Without the
// fix, `bun install` panics during bin linking and exits non-zero before any
// node_modules artefacts land on disk.
import { expect, test } from "bun:test";
import { existsSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

test("bun install does not panic when bin target's relative path has no `..` prefix", { timeout: 60_000 }, async () => {
  using dir = tempDir("issue-30129", {
    "package.json": JSON.stringify({
      name: "root",
      version: "1.0.0",
      dependencies: { weird: "file:./pkg" },
    }),
    "pkg/package.json": JSON.stringify({
      name: "weird",
      version: "1.0.0",
      bin: "../.bin/foo.js",
    }),
    "pkg/index.js": "module.exports = 1;\n",
    // Pre-create the .bin directory with the file `bin` points at so that
    // `abs_target` resolves to `<node_modules>/.bin/foo.js`. The relative
    // path from `<node_modules>/.bin` to that target is just `foo.js`,
    // which is the shape that trips the overly strict assertion on both
    // POSIX (`createSymlink`) and Windows (`createWindowsShim`).
    "node_modules/.bin/foo.js": "#!/usr/bin/env node\nprocess.exit(0);\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Without the fix the assertion panics with "Internal assertion failure"
  // and the process aborts before the install completes.
  expect(stderr).not.toContain("Internal assertion failure");

  // The package itself must be extracted.
  const pkgJson = join(String(dir), "node_modules", "weird", "package.json");
  expect(statSync(pkgJson).isFile()).toBe(true);

  // The lockfile must have been written to disk. Without the fix the install
  // panics before saving the lockfile, so the file simply doesn't exist.
  const lockfile = existsSync(join(String(dir), "bun.lock"))
    ? join(String(dir), "bun.lock")
    : join(String(dir), "bun.lockb");
  expect(existsSync(lockfile)).toBe(true);

  // Bin-link artefacts differ by platform:
  //   - POSIX: a symlink at `.bin/weird` pointing at the target relative to
  //     `.bin`. For our fixture that path is just `foo.js`.
  //   - Windows: a `.exe` + `.bunx` shim pair. The `.bunx` file encodes the
  //     bin path as a UTF-16LE prefix terminated by a `"\0` sequence; for
  //     this fixture it must resolve to `<node_modules>\.bin\foo.js` at
  //     runtime, which in the parent-of-`.bin`-anchored form is
  //     `.bin\foo.js`.
  if (isWindows) {
    const exe = join(String(dir), "node_modules", ".bin", "weird.exe");
    const bunx = join(String(dir), "node_modules", ".bin", "weird.bunx");
    expect(statSync(exe).isFile()).toBe(true);
    expect(statSync(bunx).isFile()).toBe(true);

    // `.bunx` must not be a truncated zero-byte file left behind by a
    // panic between `O_TRUNC` and the metadata write.
    expect(statSync(bunx).size).toBeGreaterThan(0);

    const bunxBytes = await Bun.file(bunx).bytes();
    const decoded = new TextDecoder("utf-16le").decode(bunxBytes);
    const terminator = decoded.indexOf('"\0');
    expect(terminator).toBeGreaterThan(0);
    expect(decoded.slice(0, terminator)).toBe(".bin\\foo.js");
  } else {
    const link = join(String(dir), "node_modules", ".bin", "weird");
    expect(readlinkSync(link)).toBe("foo.js");
  }

  expect(exitCode).toBe(0);
});
