// https://github.com/oven-sh/bun/issues/29585
//
// `bun build --compile` binaries that `dlopen()` an embedded .so/.dylib
// used to extract a fresh copy to `/tmp` for every single call — no dedup,
// no cleanup. On long-running servers that recreate Workers this filled
// the disk. The extraction path is now content-hash based, so repeated
// dlopens and repeated Workers share a single extracted file.
//
// Checks both dimensions:
//   1. one process calling dlopen() many times leaks O(1) files, not O(N)
//   2. many Workers each calling dlopen() once also leak O(1) files
//
// Skipped on non-Linux: repro needs a platform-native shared library and
// the /tmp extraction path is POSIX-shaped. The underlying fix applies
// on macOS too but we can't rely on cc being present on CI darwin runners.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cc = isLinux ? (Bun.which("cc") ?? Bun.which("gcc")) : null;

// Returns the count of files under /tmp whose contents match `bytes` exactly.
// Matching by content keeps the check robust against any future naming scheme —
// what we care about is "how many copies of this .so live in /tmp", not what
// they're called.
async function countExtractedCopies(bytes: Uint8Array): Promise<number> {
  let n = 0;
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.endsWith(".so")) continue;
    const p = join(tmpdir(), name);
    try {
      const f = Bun.file(p);
      if (f.size !== bytes.length) continue;
      const buf = new Uint8Array(await f.arrayBuffer());
      if (buf.length !== bytes.length) continue;
      let same = true;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== bytes[i]) {
          same = false;
          break;
        }
      }
      if (same) n++;
    } catch {
      // raced with deletion / permission — ignore
    }
  }
  return n;
}

async function removeExtractedCopies(bytes: Uint8Array): Promise<void> {
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".so")) continue;
    const p = join(tmpdir(), name);
    try {
      const f = Bun.file(p);
      if (f.size !== bytes.length) continue;
      const buf = new Uint8Array(await f.arrayBuffer());
      let same = true;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== bytes[i]) {
          same = false;
          break;
        }
      }
      if (same) rmSync(p, { force: true });
    } catch {}
  }
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

    // Build the .so.
    {
      await using proc = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", "libhello.so", "libhello.c"],
        cwd,
        env: bunEnv,
        stderr: "pipe",
      });
      expect(await proc.stderr.text()).toBe("");
      expect(await proc.exited).toBe(0);
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

    await removeExtractedCopies(libBytes);

    // First run: 5 main-thread dlopens + 5 workers (each dlopen once).
    // Pre-fix: 10 /tmp files. Post-fix: 1.
    {
      await using proc = Bun.spawn({ cmd: [out], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    }
    expect(await countExtractedCopies(libBytes)).toBe(1);

    // Second run of the same binary: still one file. Filename is content-hash
    // based, so the existing extraction is reused across process restarts too.
    {
      await using proc = Bun.spawn({ cmd: [out], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    }
    expect(await countExtractedCopies(libBytes)).toBe(1);

    await removeExtractedCopies(libBytes);
  },
  180_000,
);
