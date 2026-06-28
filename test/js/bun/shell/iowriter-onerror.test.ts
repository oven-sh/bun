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

// IOWriter::on_error iterates the pending writers and drives each callback via the
// Yield trampoline. A callback can start the next shell state (e.g. the right-hand
// side of `||`, or the next statement after `;`) which may enqueue on the SAME
// IOWriter. Previously that re-entrant enqueue found no recorded error, appended a
// writer, and registered a poll; but PosixBufferedWriter::_on_error closes the poll
// handle right after on_error returns, so the new writer never heard back and the
// shell hung. fail_pending_writers now records the error before any callback runs,
// and handle_broken_pipe completes such enqueues with it immediately.
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
    // IOWriter before the first write is attempted (2 pending writers). The
    // first pwritev2 on the RST'd socket fails with
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
    // The regression guard is that the shell completes instead of hanging on
    // a stranded writer (the fixture's execFileSync timeout would surface as
    // "HUNG signal=..." on stderr and a non-zero exit). The specific exit
    // code depends on how the `cd` builtin maps the write error.
    expect(stdout.trim()).toMatch(/^exit:\d+\ndone$/);
    expect(exitCode).toBe(0);
  });

  test("non-pollable stdout (/dev/full, ENOSPC): callback chain does not recurse", async () => {
    // With stdout = /dev/full every write fails with ENOSPC. Each echo's
    // on_io_writer_chunk error callback drives the next statement, which
    // enqueues on the same IOWriter. Previously each enqueue re-entered
    // do_file_write → on_error → Yield::run, one nested level per echo,
    // eventually tripping the Yield depth assertion. on_sync_error now
    // *returns* the failing child's completion so enqueue unwinds first, and
    // the recorded error completes a re-entrant enqueue without another
    // write attempt.
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

    // The regression guard is that the shell completes instead of tripping
    // the Yield depth assertion from recursive do_file_write → on_error →
    // run (which would surface as a panic on stderr and a non-zero exit).
    // The specific exit code depends on how `echo` maps the write error.
    expect(stripAsanWarning(stderr).trim()).toMatch(/^exit:\d+\ndone$/);
    expect(exitCode).toBe(0);
  });
});
