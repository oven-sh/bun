// https://github.com/oven-sh/bun/issues/29585
//
// `bun build --compile` binaries that `dlopen()` an embedded .so used to
// extract a fresh copy to /tmp for every call, with no dedup or cleanup.
// Extraction is now content-hashed at `{tmpdir}/.bun-{uid}-{hash}.{ext}`,
// so repeated dlopens and repeated runs of the same binary share one file.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cc = isLinux ? (Bun.which("cc") ?? Bun.which("gcc")) : null;

// Paths under `root` whose bytes match `expected`. Content-match (not name
// pattern) keeps the check robust against any future naming scheme.
async function findExtractedCopies(root: string, expected: Buffer, extension = ".so"): Promise<string[]> {
  let entries: string[];
  try {
    entries = readdirSync(root, { recursive: true }) as string[];
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const rel of entries) {
    if (!rel.endsWith(extension)) continue;
    const p = join(root, rel);
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

    const runOnce = async (env = runEnv) => {
      await using proc = Bun.spawn({ cmd: [out], cwd: extractDir, env, stdout: "pipe", stderr: "pipe" });
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

    // What lies in the working directory is not taken for the extracted file.
    for (const p of await findExtractedCopies(extractDir, libBytes)) writeFileSync(p, Buffer.alloc(libBytes.length));
    await runOnce({ ...runEnv, BUN_TMPDIR: "." });
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

// The library is written to a scratch file and renamed to the shared name. Processes that start together can read the
// same wall clock value. The scratch name was that value and the hash of the library, so the second of two such
// processes failed its exclusive create and `dlopen()` got the `/$bunfs/` path.
describe.skipIf(!isLinux || !cc)("compiled binaries that extract the library", () => {
  const pinnedMilliseconds = 1_700_000_000_123;
  let dir: ReturnType<typeof tempDir> | undefined;
  let app: string;
  let embedded: Record<string, Buffer>;
  const preloaded = (...shims: string[]) => ({
    ...bunEnv,
    LD_PRELOAD: [...shims.map(shim => join(String(dir), shim)), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
  });
  afterAll(() => dir?.[Symbol.dispose]());
  // `bun build --compile` on debug+ASAN takes ~25s; the default limit of a hook is 5s.
  beforeAll(async () => {
    dir = tempDir("29585-extraction", {
      // JavaScriptCore's helper threads compute the deadlines of their waits from this clock, so only the main thread,
      // which names the scratch file, reads the pinned value.
      "pin-clock.c": `#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>
int clock_gettime(clockid_t id, struct timespec *out) {
  static int (*real)(clockid_t, struct timespec *);
  if (id == CLOCK_REALTIME && syscall(SYS_gettid) == getpid()) {
    out->tv_sec = ${Math.floor(pinnedMilliseconds / 1000)};
    out->tv_nsec = ${(pinnedMilliseconds % 1000) * 1_000_000};
    return 0;
  }
  if (!real) real = (int (*)(clockid_t, struct timespec *))dlsym(RTLD_NEXT, "clock_gettime");
  return real(id, out);
}
`,
      // Says which reads would wait for the kernel's entropy pool and which take what it has. Linux before 5.6 does not
      // know GRND_INSECURE.
      "entropy.c": `#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <sys/random.h>
#include <unistd.h>
#ifndef GRND_INSECURE
#define GRND_INSECURE 4
#endif
static void say(const char *text, size_t length) {
  if (write(2, text, length) < 0) abort();
}
ssize_t getrandom(void *buffer, size_t length, unsigned flags) {
  static ssize_t (*real)(void *, size_t, unsigned);
  if (flags & GRND_INSECURE) say("takes what the pool has\\n", 24);
  else if (!(flags & GRND_NONBLOCK)) say("waits for the pool\\n", 19);
  if ((flags & GRND_INSECURE) && getenv("BEFORE_LINUX_5_6")) {
    errno = EINVAL;
    return -1;
  }
  if (!real) real = (ssize_t (*)(void *, size_t, unsigned))dlsym(RTLD_NEXT, "getrandom");
  return real(buffer, length, flags);
}
`,
      "libhello.c": LIBHELLO_C,
      "addon.c": `#include <node_api.h>
NAPI_MODULE_INIT() {
  napi_value hello;
  napi_create_int32(env, 42, &hello);
  napi_set_named_property(env, exports, "hello", hello);
  return exports;
}
`,
      "app.ts": `
        import { dlopen, FFIType } from "bun:ffi";
        import lib from "./libhello.so" with { type: "file" };
        let hello;
        if (process.argv[2] === "addon") {
          hello = require("./addon.node").hello;
        } else {
          const { symbols, close } = dlopen(lib, { hello: { args: [], returns: FFIType.i32 } });
          hello = symbols.hello();
          close();
        }
        console.log(hello, Date.now());
      `,
    });
    const cwd = String(dir);
    for (const args of [
      ["pin-clock.c", "-o", "pin-clock.so", "-ldl"],
      ["entropy.c", "-o", "entropy.so", "-ldl"],
      ["addon.c", "-I" + join(import.meta.dir, "../../../src/runtime/napi"), "-o", "addon.node"],
    ]) {
      await using proc = Bun.spawn({ cmd: [cc!, "-shared", "-fPIC", ...args], cwd, env: bunEnv });
      expect(await proc.exited).toBe(0);
    }
    const { out, libBytes } = await buildFixture(cwd);
    app = out;
    embedded = { ".so": libBytes, ".node": readFileSync(join(cwd, "addon.node")) };
  }, 180_000);

  async function run(kind: string, extractDir: string, env: NodeJS.Dict<string>) {
    await using proc = Bun.spawn({
      cmd: [app, kind],
      env: { ...env, BUN_TMPDIR: extractDir, TMPDIR: extractDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  // The clock value shows that the shim is in effect.
  const loaded = { stdout: `42 ${pinnedMilliseconds}\n`, stderr: "", exitCode: 0 };

  test.concurrent.each([
    ["dlopen() of bun:ffi", "library", ".so"],
    ["require() of an addon", "addon", ".node"],
  ])("each extract it for %s when they read the same clock value", async (_, kind, extension) => {
    using extractRoot = tempDir("29585-same-clock-value", {});
    const extractDir = String(extractRoot);
    const copies = () => findExtractedCopies(extractDir, embedded[extension], extension);
    const start = () => run(kind, extractDir, preloaded("pin-clock.so"));

    expect(await start()).toEqual(loaded);
    const shared = await copies();
    expect(shared.length).toBe(1);
    // With a directory at the shared name each process keeps and loads its scratch file, so the third process meets the
    // scratch file of the second. An empty directory would be removed.
    rmSync(shared[0]);
    mkdirSync(join(shared[0], "not-empty"), { recursive: true });
    expect(await start()).toEqual(loaded);
    expect(await start()).toEqual(loaded);
    expect((await copies()).length).toBe(2);
  });

  // The scratch name holds a random value. A process that starts at boot must not wait for it: nothing else at its
  // start waits.
  test.concurrent.each([
    ["Linux 5.6 or later", {}],
    ["an older Linux", { BEFORE_LINUX_5_6: "1" }],
  ])("read the seed of the scratch name without a wait for the kernel's entropy pool on %s", async (_, kernel) => {
    using extractRoot = tempDir("29585-entropy", {});
    const env = { ...preloaded("entropy.so", "pin-clock.so"), ...kernel };
    expect(await run("library", String(extractRoot), env)).toEqual({ ...loaded, stderr: "takes what the pool has\n" });
  });
});
