import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// BUN-2Z94: on Windows (clang-cl + USE_MIMALLOC), BCRASH() in bmalloc's
// BAssert.h was gated on defined(__GNUC__), which clang-cl does not define,
// so it fell back to `((void(*)())0)()`. Clang treats that as unconditional
// UB and deletes the surrounding branch, so every RELEASE_BASSERT in bmalloc
// compiled to nothing at -O2 and WTF::fastMalloc/fastCompactMalloc became a
// bare `jmp mi_malloc`. On OOM mi_malloc returned nullptr and callers
// placement-newed into 0x0 (std::_Atomic_storage in StringImpl via JSON.parse).
//
// With the fix, BCRASH() under clang-cl uses __builtin_trap() preceded by a
// store to 0xbbadbeef, so an OOM inside fastMalloc is a segfault at
// 0xBBADBEEF at the allocation site instead of a null deref at some downstream
// caller.
//
// Windows-only: the miscompile is specific to clang-cl's predefined macros,
// and MIMALLOC_DISALLOW_OS_ALLOC is the only reliable way to force a fast
// mi_malloc failure (Linux/macOS use overcommit / direct mmap for huge
// allocations so the same knobs do not produce a prompt failure there).
test.skipIf(!isWindows)(
  "fastMalloc OOM on Windows crashes at the allocator, not at a downstream null deref",
  async () => {
    const script = `
    const held = [];
    const bigVal = Buffer.alloc(1024 * 1024, "x").toString();
    const json = JSON.stringify([bigVal, bigVal, bigVal]);
    while (true) {
      held.push(JSON.parse(json));
    }
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        // Constrain mimalloc to a single small reserved arena so the ~1MB
        // StringImpl allocations inside JSON.parse fail within a few hundred
        // iterations instead of after exhausting the whole machine.
        MIMALLOC_RESERVE_OS_MEMORY: "256MiB",
        MIMALLOC_DISALLOW_OS_ALLOC: "1",
        MIMALLOC_RETRY_ON_OOM: "0",
        // Make sure no crash report is posted anywhere.
        BUN_CRASH_REPORTER_URL: "",
        BUN_ENABLE_CRASH_REPORTING: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The child is expected to crash (there is no catchable OOM error here yet),
    // but the crash must originate at the RELEASE_BASSERT inside fastMalloc,
    // which writes to 0xbbadbeef, not at a downstream consumer of a null
    // StringImpl.
    expect(stderr).toMatch(/BBADBEEF/i);
    expect(stderr).not.toMatch(/at address 0x0\b/);

    // And it must actually have crashed (not silently looped or exited 0).
    expect(exitCode).not.toBe(0);

    void stdout;
  },
);
