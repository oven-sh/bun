// https://github.com/oven-sh/bun/issues/29585
//
// `bun build --compile` binaries that `dlopen()` an embedded .so used to
// extract a fresh copy to /tmp for every call, with no dedup or cleanup.
// Extraction is now content-hashed in a per-user 0700 subdir of tmpdir,
// so repeated dlopens and repeated Workers share one file.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
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
  "compiled binary deduplicates extracted embedded .so across repeat dlopen + workers (#29585)",
  async () => {
    using dir = tempDir("29585", {
      "libhello.c": "int hello(void) { return 42; }\n",

      // Main thread dlopens N times, then spawns M workers that each dlopen
      // once. Pre-fix produced N+M /tmp files; post-fix it's 1.
      "app.ts": `
        import { dlopen, FFIType } from "bun:ffi";
        import lib from "./libhello.so" with { type: "file" };

        if (Bun.isMainThread) {
          for (let i = 0; i < 5; i++) {
            const { symbols, close } = dlopen(lib, { hello: { args: [], returns: FFIType.i32 } });
            if (symbols.hello() !== 42) { console.error("bad result on main"); process.exit(1); }
            close();
          }
          // Spawn all workers first, then await — concurrent dlopens exercise
          // the atomic write+rename convergence path.
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
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    };

    // First run: 5 main-thread dlopens + 5 workers. Pre-fix: 10 files. Post-fix: 1.
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
