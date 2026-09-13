// PR #29320: hintSourcePagesDontNeed() must be reached even when the
// entrypoint has top-level await. loadEntryPoint() returns a promise without
// blocking, so the call site at bun.js.zig:466 is hit synchronously before the
// main event loop spins — TLA resolution happens later in that loop.
// BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE, read by the compiled binary at
// runtime, skips the hint.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import path from "node:path";

// Relies on the StandaloneModuleGraph scoped logger which is compiled out in
// release builds.
test.concurrent.skipIf(isWindows || !isDebug)(
  "standalone madvise hint fires with top-level await entrypoint",
  async () => {
    using dir = tempDir("standalone-madvise-tla", {
      "entry.ts": `
      console.log("before-await");
      await new Promise<void>(r => setTimeout(r, 0));
      console.log("after-await");
    `,
    });

    const out = path.join(String(dir), "compiled");
    const build = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", path.join(String(dir), "entry.ts"), "--outfile", out],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).not.toContain("error:");
    expect(build.exitCode).toBe(0);

    // BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE is read by the compiled
    // executable at runtime (the binary above was built without it); a falsy
    // value leaves the hint enabled. With the flag set, the function returns
    // before logging anything, so the only evidence is the missing line.
    for (const [flag, hinted] of [
      [undefined, true],
      ["0", true],
      ["1", false],
    ] as const) {
      await using proc = Bun.spawn({
        cmd: [out],
        env: {
          ...bunEnv,
          BUN_DEBUG_StandaloneModuleGraph: "1",
          BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: flag,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("before-await");
      expect(stdout).toContain("after-await");
      // Scoped loggers write to the debug-writer stream (stdout by default).
      // Either the success or failure variant proves the call site is reached.
      if (hinted) {
        expect(stdout).toContain("hintSourcePagesDontNeed:");
      } else {
        expect(stdout).not.toContain("hintSourcePagesDontNeed:");
      }
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    }

    // The scope is declared hidden, so without opting in the log must not
    // appear even when BUN_DEBUG_QUIET_LOGS is unset.
    {
      await using proc = Bun.spawn({
        cmd: [out],
        env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).not.toContain("hintSourcePagesDontNeed:");
      expect(stdout).toContain("before-await");
      expect(stdout).toContain("after-await");
      expect(stderr).not.toContain("hintSourcePagesDontNeed:");
      expect(exitCode).toBe(0);
    }
  },
  30_000,
);

// The hint must cover only the source text, not the bytecode JSC keeps
// decoding from. The string literal below lands in both the source and the
// bytecode cache, so a hint spanning both reports at least double its size.
test.concurrent.skipIf(isWindows || !isDebug)(
  "standalone madvise hint covers only the embedded source text",
  async () => {
    const literalBytes = 64 * 1024;
    using dir = tempDir("standalone-madvise-range", {
      "entry.ts": `const s = "${Buffer.alloc(literalBytes, "a").toString()}";\nconsole.log("len=" + s.length);\n`,
    });

    const out = path.join(String(dir), "compiled");
    const build = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", "--bytecode", path.join(String(dir), "entry.ts"), "--outfile", out],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).not.toContain("error:");
    expect(build.exitCode).toBe(0);

    await using proc = Bun.spawn({
      cmd: [out],
      env: { ...bunEnv, BUN_DEBUG_StandaloneModuleGraph: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain(`len=${literalBytes}`);
    const hinted = stdout.match(/hintSourcePagesDontNeed: MADV_DONTNEED (\d+) bytes/);
    expect(hinted).not.toBeNull();
    const bytes = Number(hinted![1]);
    // Whole pages inside the source run: at most the literal plus the small
    // bundler wrapper around it, never the bytecode as well.
    expect(bytes).toBeLessThan(literalBytes + 16 * 1024);
    expect(bytes).toBeGreaterThan(literalBytes / 2);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  30_000,
);
