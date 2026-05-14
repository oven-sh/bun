// https://github.com/oven-sh/bun/issues/30717
//
// Regression: `bun build --compile` of a script that embeds a native library
// with `{ type: "file" }` and opens it via `bun:ffi`'s `dlopen()` broke in the
// Rust rewrite (1.3.14-canary, commit 23427dbc12). The Rust port at
// `src/runtime/ffi/ffi_body.rs` shipped a stub where the Zig original called
// `ModuleLoader.resolveEmbeddedFile` to materialize the bunfs-embedded library
// to an on-disk tmpfile; the raw `/$bunfs/...` path fell through to libc
// `dlopen(2)`, which can't see the bunfs virtual filesystem, and the load
// failed with `ERR_DLOPEN_FAILED`. Last known-good was 1.3.13 (final Zig).
//
// `process.dlopen` for `.node` addons was unaffected — that path still
// reaches the working `Bun__resolveEmbeddedNodeFile` hook. The ffi path
// needed the same extraction with the platform extname (`so`/`dylib`/`dll`).

import { expect, test } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { bunEnv, bunExe, isPosix, isWindows, tempDir } from "harness";
import { join } from "path";

const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");

// Skip on Windows for now — the repro uses clang/gcc to build a shared lib.
// The fix is platform-independent (same stub in Rust ran for .dll too) but
// building a .dll on Windows CI would need a different toolchain wrapper.
test.skipIf(isWindows || !cc)(
  'bun:ffi dlopen() works on an embedded `with { type: "file" }` shared library after `bun build --compile`',
  async () => {
    // `bun build --compile` reads + rewrites the entire executable (~100 MB
    // debug, ~500 MB profile) via ELF-section inject on Linux, so the test
    // is dominated by that single I/O step. 60 s matches `compile/HelloWorld`
    // and other compile tests in `bundler_compile.test.ts`.
    const libSuffix = isPosix ? (process.platform === "darwin" ? "dylib" : "so") : "dll";

    using dir = tempDir("issue-30717", {
      "hello.c": `
        #include <stdint.h>
        int32_t hello(void) { return 42; }
      `,
      "repro.js": `
        import libpath from "./libhello.${libSuffix}" with { type: "file" };
        import { dlopen, FFIType } from "bun:ffi";
        const lib = dlopen(libpath, { hello: { args: [], returns: FFIType.i32 } });
        console.log("loaded:", lib.symbols.hello());
      `,
    });
    const dirPath = String(dir);

    // Compile hello.c -> shared library.
    const libPath = join(dirPath, `libhello.${libSuffix}`);
    await using ccProc = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", libPath, join(dirPath, "hello.c")],
      env: bunEnv,
      cwd: dirPath,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [ccStderr, ccExit] = await Promise.all([ccProc.stderr.text(), ccProc.exited]);
    expect(ccStderr).toBe("");
    expect(existsSync(libPath)).toBe(true);
    // CLAUDE.md: assert exit code last so stderr/output diffs are the first
    // failure the reader sees.
    expect(ccExit).toBe(0);

    // `bun build --compile` — bundles the .so into the standalone binary.
    const outBin = join(dirPath, isWindows ? "repro.exe" : "repro");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "repro.js", "--outfile", outBin],
      env: bunEnv,
      cwd: dirPath,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [buildStdout, buildStderr, buildExit] = await Promise.all([
      build.stdout.text(),
      build.stderr.text(),
      build.exited,
    ]);
    if (buildExit !== 0) {
      console.error("build stdout:", buildStdout);
      console.error("build stderr:", buildStderr);
    }
    expect(existsSync(outBin)).toBe(true);
    expect(buildExit).toBe(0);

    // Delete the on-disk library so the compiled binary must use the
    // embedded copy — otherwise a passing test might just be hitting the
    // backup `FileSystem::instance().abs(&[name])` path in `dlopen` (spec
    // ffi.zig:1068-1073) which resolves `./libhello.so` relative to cwd.
    unlinkSync(libPath);

    // Run from a different cwd so cwd-relative resolution can't find the
    // library on disk either.
    await using run = Bun.spawn({
      cmd: [outBin],
      env: bunEnv,
      cwd: "/",
      stderr: "pipe",
      stdout: "pipe",
    });
    const [runStdout, runStderr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    // Helpful diagnostic if it fails.
    if (runExit !== 0) {
      console.error("run stdout:", runStdout);
      console.error("run stderr:", runStderr);
    }

    // Before the fix stderr was `ERR_DLOPEN_FAILED` on the raw
    // `/$bunfs/root/libhello-<hash>.so` path (libc `dlopen(2)` can't see
    // the bunfs virtual FS); after the fix the lib is extracted to a real
    // tmpfile under `RealFS.tmpdirPath()` and loaded cleanly.
    expect(runStderr).not.toContain("ERR_DLOPEN_FAILED");
    expect(runStdout).toContain("loaded: 42");
    expect(runExit).toBe(0);
  },
  60_000,
);
