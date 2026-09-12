// packages/h3blast is a standalone C program. It does not compile lsquic and
// BoringSSL itself: it links the objects a local Bun build leaves in
// build/<profile>/obj/vendor. Bun compiles those objects for its own binary
// (scripts/build/deps/boringssl.ts), so BoringSSL expects the embedder to
// define its allocator and PEM base64 hooks, and the debug profile is
// ASan-instrumented. h3blast has to keep up with both or its final link fails:
//   undefined reference to `OPENSSL_memory_alloc'
//
// Test-only CI lanes run a prebuilt binary and have no build tree; skip there.
import { Glob, which } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, isLinux, tempDir, tls } from "harness";
import { cpSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const pkg = join(repoRoot, "packages", "h3blast");
const make = which("make");
// h3blast is Linux-only (epoll, timerfd, sendmmsg).
const canBuild = isLinux && make !== null && which("cc") !== null;
// DEPS in the Makefile.
const deps = ["lsquic", "lsqpack", "lshpack", "boringssl", "hdrhistogram", "zlib"];

// Why h3blast cannot be linked against this profile's objects, or null if it can.
// Objects are per profile. vendor/<dep> is shared: the headers h3blast.c compiles
// against, and the .ref stamp a fetch rewrites only when the source changes.
//   - Configure creates all of obj/ before anything compiles, so after an
//     interrupted build the directories exist and the link misses lsquic_*, SSL_*.
//   - A dep bump plus a debug-only rebuild leaves build/release with the old
//     source's objects under the new headers. A patch has already added a field
//     in the middle of struct lsquic_engine_settings.
// Both are the state of the machine, not a broken h3blast, so they skip.
function unusable(profile: string): string | null {
  const buildDir = join(repoRoot, "build", profile);
  // The final link needs every object, so this says the set was complete once.
  const exe = profile === "debug" ? "bun-debug" : "bun-profile";
  if (!existsSync(join(buildDir, exe))) return `no build/${profile}/${exe}`;
  for (const dep of deps) {
    const ref = statSync(join(repoRoot, "vendor", dep, ".ref"), { throwIfNoEntry: false });
    if (!ref) return `no vendor/${dep}/.ref`;
    const objDir = join(buildDir, "obj", "vendor", dep);
    const objects = existsSync(objDir) ? [...new Glob("**/*.o").scanSync({ cwd: objDir, absolute: true })] : [];
    if (objects.length === 0) return `no ${dep} objects in build/${profile}`;
    if (objects.some(o => statSync(o).mtimeMs < ref.mtimeMs)) {
      return `build/${profile} has ${dep} objects older than vendor/${dep}/.ref`;
    }
  }
  return null;
}

describe.concurrent("h3blast", () => {
  for (const profile of ["release", "debug"]) {
    const why = canBuild ? unusable(profile) : "needs Linux, make and cc";

    test.skipIf(why !== null)(
      `links against build/${profile} and completes requests${why === null ? "" : ` (skipped: ${why})`}`,
      async () => {
        // Build a copy so nothing lands in the source tree and a binary left
        // over from a manual `make` cannot satisfy the build.
        using dir = tempDir("h3blast-link", {});
        cpSync(join(pkg, "Makefile"), join(String(dir), "Makefile"));
        cpSync(join(pkg, "src"), join(String(dir), "src"), { recursive: true });

        {
          await using proc = Bun.spawn({
            cmd: [make!, `ROOT=${repoRoot}`, `PROFILE=${profile}`],
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          // ld prints one line per reference, thousands of them when the ASan
          // runtime is missing. Name each missing symbol once instead.
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
            ...["--requests", String(requests)],
            `https://127.0.0.1:${server.port}/`,
          ],
          // An ASan-linked h3blast sets its own defaults (__asan_default_options
          // in h3blast.c). It must not inherit the CI runner's detect_leaks=1.
          env: { ...bunEnv, ASAN_OPTIONS: undefined },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toBe("");
        const [result] = JSON.parse(stdout);
        expect(result).toMatchObject({
          errors: 0,
          status: { "2xx": result.requests, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 },
        });
        // h3blast samples its counters at 10 Hz, so it can overshoot the target.
        expect(result.requests).toBeGreaterThanOrEqual(requests);
        expect(exitCode).toBe(0);
      },
      // A C compile and a link of ~550 objects, not a wait on a condition.
      60_000,
    );
  }
});
