import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { join } from "node:path";

// Debug ASAN builds print a WebKit Options.cpp banner to stderr at JSC init
// when ASAN_OPTIONS lacks allow_user_segv_handler=1. bunEnv sets it on the ASAN
// CI shard (isASAN), but a local `bun bd` run may not have it — filter it out.
function stripAsanWarning(s: string): string {
  return s
    .split("\n")
    .filter(l => !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
}

// IOWriter.onError iterates the pending writers and drives each callback via the
// Yield trampoline. A callback can start the next shell state (e.g. the right-hand
// side of `||`, or the next statement after `;`) which may enqueue on the SAME
// IOWriter. Previously:
//   - onError captured writers.slice() and iterated it; a re-entrant append could
//     promote SmolList inlined→heap or realloc the heap backing, leaving the captured
//     slice dangling.
//   - Re-entrant enqueues appended to this.writers and registered a poll, but
//     PosixBufferedWriter._onError closes the poll handle immediately after onError
//     returns — the new writer was stranded and the shell hung.
//
// These tests require a write error that is *not* EPIPE (EPIPE sets flags.broken_pipe
// which already short-circuits re-entrant enqueues), so they use Linux-specific
// primitives: /dev/full for ENOSPC, and SO_LINGER{1,0} for a TCP RST → ECONNRESET.
describe.skipIf(!isLinux)("IOWriter.onError with re-entrant enqueue", () => {
  test("pollable stderr (ECONNRESET): pending writers + callback that enqueues", async () => {
    // A helper process creates a loopback TCP connection via raw FFI (so the event
    // loop never touches the fd), RSTs the server side, then spawns the shell under
    // test with stderr = the RST'd client socket. The shell runs:
    //
    //   (cd /neA || cd /neB) | cd /ne2
    //
    // Both `cd /neA` and `cd /ne2` enqueue error messages on the shared stderr
    // IOWriter before the first write is attempted (2 pending writers, SmolList
    // inlined at capacity). The first pwritev2 on the RST'd socket fails with
    // ECONNRESET → onError iterates [cdA, cd2]. cdA's callback runs the `||` branch
    // and starts `cd /neB`, which enqueues on the same IOWriter while onError is
    // mid-iteration.
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "iowriter-onerror-rst-fixture.ts"), bunExe()],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stripAsanWarning(stderr).trim()).toBe("");
    // ECONNRESET errno is 104 on Linux.
    expect(stdout.trim()).toBe("exit:104\ndone");
    expect(exitCode).toBe(0);
  });

  test("non-pollable stdout (/dev/full, ENOSPC): callback chain does not recurse", async () => {
    // With stdout = /dev/full every write fails with ENOSPC. Each echo's
    // onIOWriterChunk error callback drives the next statement, which enqueues
    // on the same IOWriter. Previously each enqueue re-entered doFileWrite →
    // onError → .run(), one nested Yield.run per echo; the stored error now
    // short-circuits the re-entrant enqueue so the chain stays flat.
    const full = Bun.file("/dev/full");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { $ } = require("bun");
          $.throws(false);
          const result = await $\`echo a; echo b; echo c; echo d; echo e\`;
          process.stderr.write("exit:" + result.exitCode + "\\n");
          process.stderr.write("done\\n");
        `,
      ],
      env: bunEnv,
      stdout: full,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // ENOSPC errno is 28 on Linux.
    expect(stripAsanWarning(stderr).trim()).toBe("exit:28\ndone");
    expect(exitCode).toBe(0);
  });
});
