import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";

// On Windows, when the initial uv_read_start on a subprocess stdout/stderr
// pipe fails (observed from libuv as UV_EINVAL after a bad FileAccessInformation
// query on the pipe handle), SubprocessPipeReader::start() returned the Err
// straight from start_with_current_pipe(). The caller in the spawn bindings
// then threw and returned without tearing down either pipe: stdout still had
// the extra ref from the top of start(), and stderr had never been start()ed
// at all (refcount 1, process backref set, live uv.Pipe source).
//
// When the killed child's exit callback later fired, on_process_exit resumed
// reads on both pipes; the EOF that arrived on the unstarted stderr reached
// on_reader_done, whose trailing deref assumes the matching start() ref exists,
// so it dereferenced a freed PipeReader. Debug builds hit the RefCount
// MAGIC_VALID assert; release builds wrote through freed memory, which in
// practice manifested as a process stuck idle with no error and no exit.
//
// The fix routes the start_with_current_pipe() error through on_reader_error
// (matching what POSIX already does for register_poll failure), so the pipe is
// torn down and detached from the Subprocess before the exit callback runs.
//
// Triggering a real uv_read_start failure on a freshly-spawned stdio pipe is
// not possible from JS, so this uses a debug-only fault-injection env var.

test.skipIf(!isWindows || !isDebug)(
  "spawn: a failed stdio pipe start is torn down instead of leaving a dangling sibling reader (windows)",
  async () => {
    const fixture = `
try {
  const p = Bun.spawn({
    cmd: [process.execPath, "-e", "1"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_INTERNAL_FAIL_PIPE_READER_START: undefined },
  });
  await p.exited;
  process.stderr.write("OK\\n");
} catch (e) {
  // Before the fix the spawn threw here; printing lets the assertion below
  // name the exact error code when the post-throw crash is the real failure.
  process.stderr.write("THREW " + (e?.code ?? e?.message) + "\\n");
}
`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        // The injection point sits in start_with_current_pipe(), which is the
        // first call the non-lazy Windows start() path makes on the stdout pipe.
        BUN_INTERNAL_FAIL_PIPE_READER_START: "1",
      },
      stdout: "inherit",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Without the fix stderr is "THREW EINVAL" followed by the RefCount
    // MAGIC_VALID debug panic, and exitCode is the debug crash handler's.
    expect(stderr.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
);
