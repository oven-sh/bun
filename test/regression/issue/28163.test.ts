// Regression test for https://github.com/oven-sh/bun/issues/28163
//
// Bun v1.3.10 baseline builds linked against non-baseline WebKit (with AVX/AVX2),
// causing SIGILL on pre-Haswell CPUs. The crash manifested during GC when
// computing error stack traces: computeErrorInfo → Bun__remapStackFramePositions
// → displaySourceURLIfNeeded → BunString__fromLatin1 → libpas allocator (AVX).
//
// Two-part test:
// 1. Build system: verify the WebKit download URL includes "-baseline" for
//    baseline x64 builds (the root cause was a missing suffix).
// 2. Runtime: exercise the exact crash code path (error stack trace formatting
//    with source map remapping under GC pressure).

import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("build system: baseline WebKit suffix", () => {
  // The root cause was that the build system did not append "-baseline"
  // when downloading WebKit for x64 baseline builds. Verify both the
  // cmake and TypeScript build systems include the fix.

  test("cmake SetupWebKit.cmake appends -baseline for x64 baseline builds", () => {
    const cmake = readFileSync(resolve(import.meta.dir, "../../../cmake/tools/SetupWebKit.cmake"), "utf-8");
    // The fix: when ENABLE_BASELINE is set and arch is amd64, append -baseline
    expect(cmake).toContain('if(ENABLE_BASELINE AND WEBKIT_ARCH STREQUAL "amd64")');
    expect(cmake).toContain('set(WEBKIT_SUFFIX "${WEBKIT_SUFFIX}-baseline")');
  });

  test("TypeScript webkit.ts appends -baseline for x64 baseline builds", () => {
    const ts = readFileSync(resolve(import.meta.dir, "../../../scripts/build/deps/webkit.ts"), "utf-8");
    // The fix: cfg.baseline && cfg.x64 → suffix includes "-baseline"
    expect(ts).toContain("cfg.baseline && cfg.x64");
    expect(ts).toContain('-baseline"');
  });
});

describe("runtime: error stack trace with source map remapping under GC", () => {
  // Exercises the exact crash path: TypeScript → transpilation + source maps →
  // error thrown → GC → computeErrorInfo → Bun__remapStackFramePositions →
  // displaySourceURLIfNeeded → BunString__fromLatin1 → bmalloc allocator.

  test("stack trace with source map remapping does not crash during GC", async () => {
    using dir = tempDir("issue-28163", {
      "entry.ts": `
        function deepCall(n: number): never {
          if (n <= 0) {
            Bun.gc(true);
            throw new Error("crash-repro");
          }
          return deepCall(n - 1);
        }

        try {
          deepCall(10);
        } catch (err: any) {
          // Accessing .stack triggers computeErrorInfo which calls
          // Bun__remapStackFramePositions with source map lookup.
          const stack = err.stack;

          // Force GC after accessing the stack to exercise the lazy
          // evaluation path that the original bug hit.
          Bun.gc(true);

          // Verify the stack trace was correctly source-mapped
          if (!stack.includes("entry.ts")) {
            process.exit(2);
          }
          if (!stack.includes("deepCall")) {
            process.exit(3);
          }
          if (!stack.includes("crash-repro")) {
            process.exit(4);
          }

          console.log("OK");
          process.exit(0);
        }

        process.exit(1);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("OK\n");
    expect(exitCode).toBe(0);
  });

  test("many errors with source-mapped stacks under GC pressure", async () => {
    using dir = tempDir("issue-28163-gc", {
      "stress.ts": `
        function makeError(label: string): Error {
          return new Error("error-" + label);
        }

        const errors: Error[] = [];
        for (let i = 0; i < 100; i++) {
          errors.push(makeError(String(i)));
        }

        // Force GC to trigger lazy stack trace computation
        Bun.gc(true);

        let count = 0;
        for (const err of errors) {
          const stack = err.stack!;
          if (stack.includes("stress.ts")) {
            count++;
          }
        }

        // Force another GC after all stacks have been materialized
        Bun.gc(true);

        if (count !== 100) {
          console.error("Expected 100 source-mapped stacks, got " + count);
          process.exit(1);
        }

        console.log("OK");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "stress.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("OK\n");
    expect(exitCode).toBe(0);
  });
});
