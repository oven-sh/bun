// packages/h3blast is a standalone C program. It does not compile lsquic and
// BoringSSL itself: it links the objects a local Bun build leaves in
// build/<profile>/obj/vendor. Bun compiles those objects for its own binary
// (scripts/build/deps/boringssl.ts), so BoringSSL expects the embedder to
// define its allocator and PEM base64 hooks. h3blast has to keep up or its
// final link fails:
//   undefined reference to `OPENSSL_memory_alloc'
// Bun's debug profile also builds them with ASan. `make` refuses those.
//
// Test-only CI lanes run a prebuilt binary and have no build tree; skip there.
import { Glob, which } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, isLinux, tempDir, tls } from "harness";
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const pkg = join(repoRoot, "packages", "h3blast");
const make = which("make");
// h3blast is Linux-only (epoll, timerfd, sendmmsg).
const canBuild = isLinux && make !== null && which("cc") !== null;
// DEPS in the Makefile.
const deps = ["lsquic", "lsqpack", "lshpack", "boringssl", "hdrhistogram", "zlib"];
// A C compile and an archive of ~550 objects, not a wait on a condition.
const buildTimeout = 60_000;

// crypto/mem.cc is where BoringSSL calls the allocator hooks. One build compiles
// every object the same way, so this one tells how all of them were compiled.
const probeObject = (profile: string) =>
  join(repoRoot, "build", profile, "obj", "vendor", "boringssl", "crypto", "mem.cc.o");

// Why h3blast cannot be linked against this profile's objects, or null if it can.
// Objects are per profile. vendor/<dep> is shared: the headers h3blast.c compiles
// against, and the .ref stamp a fetch rewrites only when the source changes.
//   - Configure creates all of obj/ before anything compiles, so after an
//     interrupted build the directories exist and the link misses lsquic_*, SSL_*.
//   - A dep bump plus a debug-only rebuild leaves build/release with the old
//     source's objects under the new headers. A patch has already added a field
//     in the middle of struct lsquic_engine_settings.
//   - An LTO build (CI, or --lto=on) leaves LLVM bitcode in the .o files. ld
//     rejects the archive: "error adding symbols: file format not recognized".
// All are the state of the machine, not a broken h3blast, so they skip.
function unusable(profile: string): string | null {
  const buildDir = join(repoRoot, "build", profile);
  // ninja links this last, after every object is up to date. Its age stands for
  // theirs: obj/ also keeps objects of sources a dep has dropped, which never
  // get rebuilt and would look stale forever.
  const exeName = profile === "debug" ? "bun-debug" : "bun-profile";
  const exe = statSync(join(buildDir, exeName), { throwIfNoEntry: false });
  if (!exe) return `no build/${profile}/${exeName}`;
  for (const dep of deps) {
    const ref = statSync(join(repoRoot, "vendor", dep, ".ref"), { throwIfNoEntry: false });
    if (!ref) return `no vendor/${dep}/.ref`;
    if (exe.mtimeMs < ref.mtimeMs) return `build/${profile}/${exeName} is older than vendor/${dep}/.ref`;
    const objDir = join(buildDir, "obj", "vendor", dep);
    if (!existsSync(objDir) || new Glob("**/*.o").scanSync({ cwd: objDir }).next().done) {
      return `no ${dep} objects in build/${profile}`;
    }
  }
  if (!existsSync(probeObject(profile))) return `no boringssl/crypto/mem.cc.o in build/${profile}`;
  if (!readFileSync(probeObject(profile)).subarray(0, 4).equals(Buffer.from("\x7fELF", "latin1"))) {
    return `build/${profile} objects are not ELF (LTO)`;
  }
  return null;
}

// Copies the package so that nothing lands in the source tree and a binary left
// over from a manual `make` cannot satisfy the build. Then runs `make` in the copy.
async function runMake(dir: string, profile: string) {
  cpSync(join(pkg, "Makefile"), join(dir, "Makefile"));
  cpSync(join(pkg, "src"), join(dir, "src"), { recursive: true });
  await using proc = Bun.spawn({
    cmd: [make!, `ROOT=${repoRoot}`, `PROFILE=${profile}`],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("h3blast", () => {
  for (const profile of ["release", "debug"]) {
    const why = canBuild ? unusable(profile) : "needs Linux, make and cc";
    // Every instrumented object references the ASan runtime's init function.
    const asan = why === null && readFileSync(probeObject(profile)).includes("__asan_init");
    const skipped = (reason: string | null) => (reason === null ? "" : ` (skipped: ${reason})`);

    test.skipIf(why !== null || asan)(
      `links against build/${profile} and completes requests${skipped(why ?? (asan ? "ASan-instrumented objects" : null))}`,
      async () => {
        using dir = tempDir("h3blast-link", {});
        {
          const { stdout, stderr, exitCode } = await runMake(String(dir), profile);
          // ld prints one line per reference. Name each missing symbol once instead.
          // GNU ld: "undefined reference to `sym'", lld: "undefined symbol: sym".
          const missing = new Set(
            Array.from(stderr.matchAll(/undefined (?:reference to `|symbol: )([^'\s]+)/g), m => m[1]),
          );
          expect([...missing].sort()).toEqual([]);
          expect({ stdout, stderr: stderr.slice(-4096), exitCode }).toMatchObject({ exitCode: 0 });
        }

        await using server = Bun.serve({
          port: 0,
          tls,
          http3: true,
          http1: false,
          fetch: () => new Response("Hello, World!"),
        });

        const requests = 32;
        await using proc = Bun.spawn({
          cmd: [
            join(String(dir), "h3blast"),
            "--json",
            ...["--threads", "1", "--connections", "1", "--streams", "4"],
            // --requests clears the time limit, so --duration comes after it. A
            // run that stalls then ends with its counters printed.
            ...["--requests", String(requests), "--duration", "10"],
            `https://127.0.0.1:${server.port}/`,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toBe("");
        const [result] = JSON.parse(stdout);
        // h3blast samples its counters at 10 Hz, so it can overshoot the target.
        expect({ ...result, enough: result.requests >= requests }).toMatchObject({
          enough: true,
          errors: 0,
          status: { "2xx": result.requests, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 },
        });
        expect(exitCode).toBe(0);
      },
      buildTimeout,
    );

    test.skipIf(why !== null || !asan)(
      `refuses build/${profile}, whose objects are ASan-instrumented${skipped(why ?? (asan ? null : "objects are not ASan-instrumented"))}`,
      async () => {
        using dir = tempDir("h3blast-link", {});
        const { stdout, stderr, exitCode } = await runMake(String(dir), profile);
        // The archive must not stay behind: LIBDEPS is not keyed by profile, so a
        // later plain `make` would link it and fail on every __asan_* symbol.
        const archive = existsSync(join(String(dir), "build", "libdeps.a"));
        expect({ stdout, stderr: stderr.slice(-4096), exitCode, archive }).toMatchObject({
          stdout: expect.stringContaining(
            `error: the dep objects under ${repoRoot}/build/${profile}/obj/vendor are ASan-instrumented`,
          ),
          exitCode: 2,
          archive: false,
        });
      },
      buildTimeout,
    );
  }
});
