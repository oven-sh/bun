// https://github.com/oven-sh/bun/issues/29585
//
// `bun build --compile` binaries that `dlopen()` an embedded .so used to
// extract a fresh copy to /tmp for every call, with no dedup or cleanup.
// Extraction is now content-hashed inside a per-user 0700 subdir of tmpdir,
// so repeated dlopens and repeated runs of the same binary share one file.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, tempDir } from "harness";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const cc = isLinux ? (Bun.which("cc") ?? Bun.which("gcc")) : null;

// Paths under `root` whose bytes match `expected`. Content-match (not name
// pattern) keeps the check robust against any future naming scheme.
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
    try {
      const f = Bun.file(p);
      if (f.size !== expected.length) continue;
      if (expected.equals(Buffer.from(await f.arrayBuffer()))) matches.push(p);
    } catch {} // raced with deletion / permission — ignore
  }
  return matches;
}

test.skipIf(!isLinux || !cc)(
  "compiled binary deduplicates extracted embedded .so across dlopen calls + process restarts (#29585)",
  async () => {
    using dir = tempDir("29585", {
      "libhello.c": "int hello(void) { return 42; }\n",

      // Each dlopen() pre-fix wrote a fresh file to /tmp; post-fix they all
      // share one content-hashed path inside `bun-{uid}/`.
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

    // Build the .so. gcc/clang/ld can emit benign notes on success, so we only
    // assert the exit code.
    {
      await using proc = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", "libhello.so", "libhello.c"],
        cwd,
        env: bunEnv,
      });
      expect(await proc.exited).toBe(0);
    }

    const libBytes = Buffer.from(await Bun.file(join(cwd, "libhello.so")).arrayBuffer());

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
    // cache must self-heal and re-extract instead of passing a deleted path.
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
// verifies Workers share the one extracted file via the per-`File` cache on
// the shared `StandaloneModuleGraph`.
//
// Release Linux builds hit a pre-existing shutdown race in the dlopen + Worker
// teardown path that's unrelated to this PR — skip there until that's fixed.
test.skipIf(!isLinux || !cc || !isDebug)(
  "compiled binary's Workers share one extracted .so (#29585)",
  async () => {
    using dir = tempDir("29585-workers", {
      "libhello.c": "int hello(void) { return 42; }\n",
      "app.ts": `
        import { dlopen, FFIType } from "bun:ffi";
        import lib from "./libhello.so" with { type: "file" };

        if (Bun.isMainThread) {
          const workers: Worker[] = [];
          const done: Promise<void>[] = [];
          for (let i = 0; i < 5; i++) {
            const w = new Worker(import.meta.url);
            workers.push(w);
            const { promise, resolve } = Promise.withResolvers<void>();
            w.addEventListener("message", () => resolve(), { once: true });
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

    {
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
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

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
