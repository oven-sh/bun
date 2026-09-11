// packages/h3blast is a standalone C program. It does not compile lsquic and
// BoringSSL itself: it links the objects a local Bun build leaves in
// build/<profile>/obj/vendor. Bun compiles those objects for its own binary
// (scripts/build/deps/boringssl.ts), so BoringSSL expects the embedder to
// define its allocator and PEM base64 hooks, and the debug profile is
// ASan-instrumented. h3blast has to keep up with both or its final link fails:
//   undefined reference to `OPENSSL_memory_alloc'
//
// Test-only CI lanes run a prebuilt binary and have no build tree; skip there.
import { which } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, isLinux, tempDir, tls } from "harness";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const pkg = join(repoRoot, "packages", "h3blast");
const make = which("make");
// h3blast is Linux-only (epoll, timerfd, sendmmsg).
const canBuild = isLinux && make !== null && which("cc") !== null;

describe.concurrent("h3blast", () => {
  for (const profile of ["release", "debug"]) {
    const hasObjects = existsSync(join(repoRoot, "build", profile, "obj", "vendor", "lsquic"));

    test.skipIf(!canBuild || !hasObjects)(
      `links against build/${profile} and completes requests`,
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
