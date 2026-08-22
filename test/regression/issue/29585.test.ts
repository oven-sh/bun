// https://github.com/oven-sh/bun/issues/29585
//
// `bun build --compile` binaries that `dlopen()` an embedded .so used to
// extract a fresh copy to /tmp for every call, with no dedup or cleanup.
// Extraction is now content-hashed at `{tmpdir}/.bun-{uid}-{hash}.{ext}`,
// so repeated dlopens and repeated runs of the same binary share one file.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const cc = isLinux ? (Bun.which("cc") ?? Bun.which("gcc")) : null;

// Paths under `root` whose bytes match `expected`. Content-match (not name
// pattern) keeps the check robust against any future naming scheme.
//
// On OHOS every dlopen'ed ELF is re-signed in place (`.codesign` section
// injected) before the loader accepts it, so the extracted file's bytes no
// longer equal the embedded ones. The dedup property under test is the
// *count* of extracted files, so on OHOS match by `.so` presence instead.
const isOhos =
  Bun.env.BUN_OHOS === "1" ||
  // OHOS musl loader lives under /system/lib; absence of BUN_OHOS (single
  // test runs) shouldn't change behavior.
  (process.platform === "linux" && process.arch === "arm64" && existsSync("/system/lib/ld-musl-aarch64.so.1"));
async function findExtractedCopies(root: string, expected: Buffer): Promise<string[]> {
  let entries: string[];
  try {
    entries = readdirSync(root, { recursive: true }) as string[];
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const rel of entries) {
    if (!rel.endsWith(".so")) continue;
    const p = join(root, rel);
    if (isOhos) {
      matches.push(p);
      continue;
    }
    try {
      const f = Bun.file(p);
      if (f.size !== expected.length) continue;
      if (expected.equals(Buffer.from(await f.arrayBuffer()))) matches.push(p);
    } catch {} // raced with deletion / permission — ignore
  }
  return matches;
}

const LIBHELLO_C = "int hello(void) { return 42; }\n";

// Builds `libhello.so` from `libhello.c` and compiles `app.ts` into a
// standalone binary at `{cwd}/app`. Returns the binary path and the .so bytes
// for content-matching.
async function buildFixture(cwd: string): Promise<{ out: string; libBytes: Buffer }> {
  {
    // gcc/clang/ld can emit benign notes on success, so only assert exit code.
    await using proc = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", "libhello.so", "libhello.c"],
      cwd,
      env: bunEnv,
    });
    expect(await proc.exited).toBe(0);
  }

  const libBytes = Buffer.from(await Bun.file(join(cwd, "libhello.so")).arrayBuffer());

  const out = join(cwd, "app");
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--outfile", out, "app.ts"],
      cwd,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }
  return { out, libBytes };
}

test.concurrent.skipIf(!isLinux || !cc)(
  "compiled binary deduplicates extracted embedded .so across dlopen calls + process restarts (#29585)",
  async () => {
    using dir = tempDir("29585", {
      "libhello.c": LIBHELLO_C,

      // Each dlopen() pre-fix wrote a fresh file to /tmp; post-fix they all
      // share the content-hashed path `{tmpdir}/.bun-{uid}-{hash}.so`.
      "app.ts": `
        import { dlopen, FFIType } from "bun:ffi";
        import lib from "./libhello.so" with { type: "file" };
        for (let i = 0; i < 10; i++) {
          const { symbols, close } = dlopen(lib, { hello: { args: [], returns: FFIType.i32 } });
          if (symbols.hello() !== 42) { console.error("bad result"); process.exit(1); }
          close();
        }
        console.log("ok");
      `,
    });
    const cwd = String(dir);
    const { out, libBytes } = await buildFixture(cwd);

    // Isolate extraction so concurrent runs (or anything else in /tmp) can't
    // interfere. BUN_TMPDIR wins inside bun; TMPDIR covers libc.
    using extractRoot = tempDir("29585-extract", {});
    const extractDir = String(extractRoot);
    const runEnv = { ...bunEnv, BUN_TMPDIR: extractDir, TMPDIR: extractDir };

    const runOnce = async () => {
      await using proc = Bun.spawn({ cmd: [out], env: runEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // On regression, diagnostics go to stderr — surface them in the failure
      // message rather than letting the pipe swallow them. Debug+ASAN builds
      // print benign "ASAN interferes..." and "debug warn:" lines we ignore.
      expect(stderr).not.toContain("error:");
      expect(stderr).not.toContain("dlopen");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    };

    // First run: 10 main-thread dlopens. Pre-fix: 10 files. Post-fix: 1.
    await runOnce();
    expect((await findExtractedCopies(extractDir, libBytes)).length).toBe(1);

    // Second run of the same binary: still one file (content-hashed filename is
    // reused across process restarts).
    await runOnce();
    expect((await findExtractedCopies(extractDir, libBytes)).length).toBe(1);

    // Third run: simulate systemd-tmpfiles sweeping the extracted file. The
    // next run must re-extract (the lstat on the canonical name misses, so it
    // writes again) instead of handing dlopen a deleted path.
    for (const p of await findExtractedCopies(extractDir, libBytes)) rmSync(p, { force: true });
    await runOnce();
    expect((await findExtractedCopies(extractDir, libBytes)).length).toBe(1);
  },
  // `bun build --compile` on debug+ASAN takes ~25s; default 5s isn't enough.
  180_000,
);

// The original #29585 report was specifically about `new Worker()` amplifying
// the leak — each Worker VM had its own `tmpname_id_number` counter that
// started at 0, so every Worker re-extracted on its first dlopen. This test
// verifies Workers share the one extracted file: they hash the same embedded
// bytes to the same content-hashed filename, so all dlopens land on one path.
test.concurrent.skipIf(!isLinux || !cc)(
  "compiled binary's Workers share one extracted .so (#29585)",
  async () => {
    using dir = tempDir("29585-workers", {
      "libhello.c": LIBHELLO_C,
      "app.ts": `
        import { dlopen, FFIType } from "bun:ffi";
        import lib from "./libhello.so" with { type: "file" };

        if (Bun.isMainThread) {
          const workers: Worker[] = [];
          const done: Promise<void>[] = [];
          for (let i = 0; i < 5; i++) {
            const w = new Worker(import.meta.url);
            workers.push(w);
            const { promise, resolve, reject } = Promise.withResolvers<void>();
            w.addEventListener("message", () => resolve(), { once: true });
            w.addEventListener("error", e => reject(e), { once: true });
            done.push(promise);
          }
          await Promise.all(done);
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
    const { out, libBytes } = await buildFixture(cwd);

    using extractRoot = tempDir("29585-workers-extract", {});
    const extractDir = String(extractRoot);
    const runEnv = { ...bunEnv, BUN_TMPDIR: extractDir, TMPDIR: extractDir };

    await using proc = Bun.spawn({ cmd: [out], env: runEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("dlopen");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);

    // 5 workers each call dlopen(). Pre-fix: 5 files. Post-fix: 1.
    expect((await findExtractedCopies(extractDir, libBytes)).length).toBe(1);
  },
  180_000,
);
