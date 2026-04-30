import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS } from "harness";
import path from "node:path";

// The fixture uses mmap/mprotect via bun:ffi to place source bytes immediately
// before a PROT_NONE guard page, so any read past the end of the input faults
// deterministically. The fixture only knows the libc path / mmap flags for
// Linux (glibc + musl) and macOS.
describe.skipIf(!(isLinux || isMacOS))("Bun.Transpiler.transformSync with truncated UTF-8 at end of buffer", () => {
  test("does not read past the end of the input buffer", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "transpiler-truncated-utf8-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On failure the subprocess segfaults before printing DONE and exits
    // with a non-zero code / SIGSEGV signal.
    expect({
      stdout: stdout.trim().split("\n"),
      stderr,
      exitCode,
      signalCode: proc.signalCode,
    }).toEqual({
      stdout: [
        expect.stringContaining("ok: 1@ + 4-byte lead"),
        expect.stringContaining("ok: 1@ + 3-byte lead"),
        expect.stringContaining("ok: 1@ + 2-byte lead"),
        expect.stringContaining("ok: 4-byte lead + 1 continuation"),
        expect.stringContaining("ok: 4-byte lead + 2 continuations"),
        expect.stringContaining("ok: sourceMappingURL pragma + 4-byte lead"),
        "DONE",
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    // ASAN symbolization of the crash in an unfixed debug build is slow;
    // give the subprocess enough headroom so the failure surfaces as a
    // proper assertion diff rather than a timeout.
  }, 30_000);
});
