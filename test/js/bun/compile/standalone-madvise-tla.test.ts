// PR #29320: hintSourcePagesDontNeed() must be reached even when the
// entrypoint has top-level await. loadEntryPoint() returns a promise without
// blocking, so the call site at bun.js.zig:466 is hit synchronously before the
// main event loop spins — TLA resolution happens later in that loop.
// BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE, read by the compiled binary at
// runtime, skips the hint.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isMacOS, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
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

// dyld lists the libraries of DYLD_INSERT_LIBRARIES before the executable, so
// the executable is not always dyld's image 0. The library inserted here
// reports each F_RDADVISE, which shows the prefetch in a release build too.
const cc = Bun.which("cc") || Bun.which("clang");
test.concurrent.skipIf(!isMacOS || !cc)(
  "standalone prefetch reads the executable ahead with a library inserted",
  async () => {
    const marker = "the prefetch covers this text of the entry point";
    using dir = tempDir("standalone-prefetch-inserted", {
      "entry.ts": `console.log(${JSON.stringify(marker)});\n`,
      "reports-read-advice.c": /* c */ `
        #include <fcntl.h>
        #include <stdarg.h>
        #include <stdio.h>
        #include <sys/stat.h>

        static int reporting_fcntl(int fd, int cmd, ...) {
          va_list args;
          va_start(args, cmd);
          void *arg = va_arg(args, void *);
          va_end(args);
          if (cmd == F_RDADVISE) {
            const struct radvisory *advice = arg;
            struct stat file = {0};
            fstat(fd, &file);
            dprintf(2, "F_RDADVISE inode=%llu offset=%lld count=%d\\n", (unsigned long long)file.st_ino,
                    (long long)advice->ra_offset, advice->ra_count);
          }
          return fcntl(fd, cmd, arg);
        }

        __attribute__((used, section("__DATA,__interpose"))) static const struct {
          const void *replacement, *original;
        } interpose = {(const void *)reporting_fcntl, (const void *)fcntl};
      `,
    });

    const library = path.join(String(dir), "reports-read-advice.dylib");
    await using compile = Bun.spawn({
      cmd: [cc!, "-dynamiclib", "-o", library, path.join(String(dir), "reports-read-advice.c")],
      env: bunEnv,
      stdout: "inherit",
      stderr: "pipe",
    });
    const [compileErrors, compileExitCode] = await Promise.all([compile.stderr.text(), compile.exited]);
    if (compileExitCode !== 0) throw new Error(`could not compile reports-read-advice.c: ${compileErrors}`);

    // What the executable loads at startup: the text of the entry point, or
    // with --bytecode its bytecode, which holds the string and not the text.
    const text = `// @bun\n// entry.ts\nconsole.log(${JSON.stringify(marker)});\n`;
    for (const bytecode of [false, true]) {
      const out = path.join(String(dir), bytecode ? "compiled-bytecode" : "compiled");
      const build = Bun.spawnSync({
        cmd: [bunExe(), "build", "--compile", ...(bytecode ? ["--bytecode"] : []), "entry.ts", "--outfile", out],
        cwd: String(dir),
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      expect(build.stderr.toString()).not.toContain("error:");
      expect(build.exitCode).toBe(0);

      const inode = statSync(out, { bigint: true }).ino;
      for (const [flag, advised] of [
        [undefined, true],
        ["1", false],
      ] as const) {
        await using proc = Bun.spawn({
          cmd: [out],
          env: { ...bunEnv, DYLD_INSERT_LIBRARIES: library, BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: flag },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        const reported = /^F_RDADVISE inode=(\d+) offset=(\d+) count=(\d+)\n/gm;
        const advice = await Promise.all(
          Array.from(stderr.matchAll(reported), async ([, file, offset, count]) => {
            const range = Bun.file(out).slice(Number(offset), Number(offset) + Number(count));
            const read = await range.text();
            return {
              ofExecutable: BigInt(file) === inode,
              read: bytecode ? { string: read.includes(marker), text: read.includes(JSON.stringify(marker)) } : read,
            };
          }),
        );
        expect({ bytecode, flag, stdout, advice, stderr: stderr.replace(reported, ""), exitCode }).toEqual({
          bytecode,
          flag,
          stdout: marker + "\n",
          advice: advised ? [{ ofExecutable: true, read: bytecode ? { string: true, text: false } : text }] : [],
          stderr: "",
          exitCode: 0,
        });
      }
    }
  },
  30_000,
);
