// https://github.com/oven-sh/bun/issues/29005
// Exercises the zero-`..` relative-path shape between `.bin` and its bin
// target that fires the overly strict assertion in `Bin.Linker`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";

test("bun install handles a bin target inside .bin without panicking", async () => {
  using dir = tempDir("issue-29005", {
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
    // which is the shape that trips the overly strict assertion.
    "node_modules/.bin/foo.js": "#!/usr/bin/env node\nprocess.exit(0);\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // stdout/stderr captured for debug output on failure; we assert behaviour
  // via on-disk artefacts + exit status rather than reporter text.
  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The package itself must be extracted.
  const pkgJson = join(String(dir), "node_modules", "weird", "package.json");
  expect(statSync(pkgJson).isFile()).toBe(true);

  // The lockfile must have been written to disk. Without the fix the install
  // panics before saving the lockfile, so the file simply doesn't exist.
  const lockfile = existsSync(join(String(dir), "bun.lock"))
    ? join(String(dir), "bun.lock")
    : join(String(dir), "bun.lockb");
  expect(existsSync(lockfile)).toBe(true);

  // On POSIX the bin link is a symlink whose target is the bin path we stored
  // in package.json, normalized relative to `.bin`. On Windows it's a `.exe`
  // + `.bunx` shim pair, and the `.bunx` file embeds the bin path as a
  // UTF-16LE prefix terminated by a `"\0` sequence — see the file format at
  // the top of `src/install/windows-shim/BinLinkingShim.zig`.
  if (process.platform === "win32") {
    const exe = join(String(dir), "node_modules", ".bin", "weird.exe");
    const bunx = join(String(dir), "node_modules", ".bin", "weird.bunx");
    expect(statSync(exe).isFile()).toBe(true);
    expect(statSync(bunx).isFile()).toBe(true);

    // Decode the stored bin_path from the .bunx header. The shim's walk-back
    // logic lands at the parent of `.bin` at runtime and appends this string
    // to build the absolute target path, so it must equal `.bin\foo.js` for
    // our fixture — a weaker check wouldn't catch a regression where the
    // retry loop stored the wrong relative form.
    const bunxBytes = await Bun.file(bunx).bytes();
    const decoded = new TextDecoder("utf-16le").decode(bunxBytes);
    const terminator = decoded.indexOf('"\0');
    expect(terminator).toBeGreaterThan(0);
    expect(decoded.slice(0, terminator)).toBe(".bin\\foo.js");
  } else {
    const link = join(String(dir), "node_modules", ".bin", "weird");
    expect(readlinkSync(link)).toBe("foo.js");
  }

  // Without the fix, `createSymlink`/`createWindowsShim` panics with "reached
  // unreachable code" and exits non-zero before any of the above artefacts are
  // produced. Assert exit status last for better failure messages.
  expect(exitCode).toBe(0);
});
