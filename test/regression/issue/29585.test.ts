// https://github.com/oven-sh/bun/issues/29585
//
// `bun build --compile` binaries that `dlopen()` an embedded .so/.dylib
// used to extract a fresh copy to `/tmp` for every single call — no dedup,
// no cleanup. On long-running servers that recreate Workers this filled
// the disk. The extraction path is now content-hash based and lives in a
// per-user 0700 subdirectory of the tmpdir, so repeated dlopens and
// repeated Workers share a single extracted file.
//
// Checks both dimensions:
//   1. one process calling dlopen() many times leaks O(1) files, not O(N)
//   2. many Workers each calling dlopen() once also leak O(1) files
//
// Skipped on non-Linux: repro needs a platform-native shared library and
// we can't rely on cc being present on CI darwin runners. The underlying
// fix applies on all POSIX platforms.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const cc = isLinux ? (Bun.which("cc") ?? Bun.which("gcc")) : null;

// Returns paths inside `tmpdir` whose contents match `bytes` exactly. Matching
// by content (not by name pattern) keeps the check robust against any future
// naming scheme — what we care about is "how many copies of this .so live
// here", not what they're called.
async function findExtractedCopies(tmpdir: string, bytes: Uint8Array): Promise<string[]> {
  const expected = Buffer.from(bytes);
  const matches: string[] = [];
  // Walk one level deep because the compiled binary extracts into
  // `{tmpdir}/bun-{uid}/` rather than `{tmpdir}/` directly.
  const roots = [tmpdir];
  try {
    for (const name of readdirSync(tmpdir)) {
      const p = join(tmpdir, name);
      try {
        if (statSync(p).isDirectory()) roots.push(p);
      } catch {}
    }
  } catch {
    return matches;
  }
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".so")) continue;
      const p = join(root, name);
      try {
        const f = Bun.file(p);
        if (f.size !== bytes.length) continue;
        const buf = Buffer.from(await f.arrayBuffer());
        if (expected.equals(buf)) matches.push(p);
      } catch {
        // raced with deletion / permission — ignore
      }
    }
  }
  return matches;
}

test.skipIf(!isLinux || !cc)(
  "compiled binary deduplicates extracted embedded .so across repeat dlopen + workers (#29585)",
  async () => {
    using dir = tempDir("29585", {
      "libhello.c": "int hello(void) { return 42; }\n",

      // Exercise both axes in one compiled binary: the main thread dlopens N
      // times, then spawns M workers that each dlopen once. Pre-fix this
      // produced N+M files; post-fix it's 1.
      "app.ts": `
        import { dlopen, FFIType } from "bun:ffi";
        import lib from "./libhello.so" with { type: "file" };

        if (Bun.isMainThread) {
          for (let i = 0; i < 5; i++) {
            const { symbols, close } = dlopen(lib, { hello: { args: [], returns: FFIType.i32 } });
            if (symbols.hello() !== 42) { console.error("bad result on main"); process.exit(1); }
            close();
          }
          const workers: Worker[] = [];
          for (let i = 0; i < 5; i++) {
            const w = new Worker(import.meta.url);
            workers.push(w);
            const { promise, resolve } = Promise.withResolvers<void>();
            w.addEventListener("message", () => resolve(), { once: true });
            await promise;
          }
          for (const w of workers) w.terminate();
          console.log("ok");
        } else {
          const { symbols, close } = dlopen(lib, { hello: { args: [], returns: FFIType.i32 } });
          if (symbols.hello() !== 42) { console.error("bad result in worker"); process.exit(1); }
          postMessage("done");
          close();
        }
      `,
    });
    const cwd = String(dir);

    // Build the .so. Don't assert stderr is empty — gcc/clang/ld can emit
    // benign notes on success depending on toolchain version (see e.g.
    // binutils .note.GNU-stack warnings).
    {
      await using proc = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", "libhello.so", "libhello.c"],
        cwd,
        env: bunEnv,
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      if (stderr) console.log("cc stderr:", stderr);
      expect(exitCode).toBe(0);
    }

    const libBytes = new Uint8Array(await Bun.file(join(cwd, "libhello.so")).arrayBuffer());

    // Build the compiled binary.
    const out = join(cwd, "app");
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--outfile", out, "app.ts"],
        cwd,
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    // Isolate extraction into a fresh directory so concurrent runs (or
    // unrelated processes that happen to have a byte-identical `.so` in
    // `/tmp`) can't interfere with us. `BUN_TMPDIR` is checked first by
    // `FileSystem.RealFS.tmpdirPath()` and `TMPDIR` is honored by everything
    // else.
    using extractRoot = tempDir("29585-extract", {});
    const extractDir = String(extractRoot);
    const runEnv = { ...bunEnv, BUN_TMPDIR: extractDir, TMPDIR: extractDir };

    // First run: 5 main-thread dlopens + 5 workers (each dlopen once).
    // Pre-fix: 10 /tmp files. Post-fix: 1.
    {
      await using proc = Bun.spawn({ cmd: [out], env: runEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    }
    expect((await findExtractedCopies(extractDir, libBytes)).length).toBe(1);

    // Second run of the same binary: still one file. Filename is content-hash
    // based, so the existing extraction is reused across process restarts.
    {
      await using proc = Bun.spawn({ cmd: [out], env: runEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    }
    expect((await findExtractedCopies(extractDir, libBytes)).length).toBe(1);

    // Third run: simulate systemd-tmpfiles sweeping the extracted file. The
    // next invocation must re-extract instead of handing a deleted path to
    // dlopen (cache self-heal).
    for (const p of await findExtractedCopies(extractDir, libBytes)) rmSync(p, { force: true });
    {
      await using proc = Bun.spawn({ cmd: [out], env: runEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    }
    expect((await findExtractedCopies(extractDir, libBytes)).length).toBe(1);
  },
  // `bun build --compile` on a debug+ASAN host takes ~25s; the default 5s
  // timeout is not enough. Matches the pattern in 24742.test.ts, 29290.test.ts,
  // and 25628.test.ts for compile-heavy regression tests.
  180_000,
);
