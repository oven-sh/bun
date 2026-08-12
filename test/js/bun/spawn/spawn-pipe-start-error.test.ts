import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import path from "node:path";

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

// The writer behind a Buffer/Blob stdin (StaticPipeWriter) issues its single
// uv_write from start(). On Windows that uv_write fails synchronously when the
// child's end of the pipe is already gone, and the writer closes itself inside
// start(): on_close runs before start() has recorded its own ref, so it releases
// nothing, and the owner (Subprocess, ShellSubprocess) drops its ref and forgets
// the writer. start() has to release its own ref when it finds the writer closed
// underneath it; without that the writer stays allocated for the rest of the
// process (created 3, freed 0 below).
//
// The security scanner's JSON writer is the third owner. It releases start()'s
// ref itself right after start() returns, and must not when start() already
// has; otherwise the release in start() is one release too many for it.
//
// The failing uv_write cannot be arranged from JS either, so the same kind of
// debug-only fault injection is used; the writers are counted through the
// create()/deinit() lines of the StaticPipeWriter debug scope. The non-injected
// variants check the counting itself and the ordinary path of the same code.
describe.skipIf(!isWindows || !isDebug)("buffer stdin writer whose uv_write fails synchronously (windows)", () => {
  function writerCounts(output: string) {
    return {
      created: output.match(/StaticPipeWriter\(0x[0-9a-f]+\) create\(\)/g)?.length ?? 0,
      freed: output.match(/StaticPipeWriter\(0x[0-9a-f]+\) deinit\(\)/g)?.length ?? 0,
    };
  }

  function env(failWrite: boolean) {
    return failWrite
      ? { ...bunEnv, BUN_DEBUG_StaticPipeWriter: "1", BUN_INTERNAL_FAIL_PIPE_WRITER_WRITE: "1" }
      : { ...bunEnv, BUN_DEBUG_StaticPipeWriter: "1" };
  }

  test.concurrent.each([true, false])(
    "Bun.spawn, Bun.spawnSync and the shell free the writer (write fails: %p)",
    async failWrite => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "buffer-stdin-owners-fixture.ts")],
        env: env(failWrite),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // With the write failing the child only ever sees EOF; this also proves the
      // injection fired. The fixture's Buffer is 4096 bytes.
      const child = { stdout: failWrite ? "0" : "4096", exitCode: 0 };
      const result = stdout.split(/\r?\n/).find(line => line.startsWith("RESULT "));
      expect(result, stderr).toBeDefined();
      expect(JSON.parse(result!.slice("RESULT ".length))).toEqual({ spawn: child, spawnSync: child, shell: child });
      // Scoped debug logging goes to stdout; search both streams anyway.
      expect(writerCounts(stdout + stderr)).toEqual({ created: 3, freed: 3 });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent.each([true, false])(
    "bun install frees the security scanner's JSON writer (write fails: %p)",
    async failWrite => {
      using dir = tempDir("scanner-json-writer", {
        "package.json": JSON.stringify({ name: "scanner-json-writer", version: "1.0.0" }),
        "bunfig.toml": `[install.security]\nscanner = "./scanner.js"\n`,
        // bun install runs the scanner even with nothing to scan, so no registry is needed.
        "scanner.js": `module.exports = {
          scanner: {
            version: "1",
            scan: async ({ packages }) => {
              console.log("scanner received " + packages.length + " packages");
              return [];
            },
          },
        };`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: env(failWrite),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      if (failWrite) {
        // The scanner reads its package list from the pipe the failed write closed,
        // so it gets an empty document; this also proves the injection fired.
        expect(stderr).toContain("Failed to parse packages JSON");
      } else {
        expect(stdout).toContain("scanner received 0 packages");
      }
      expect(writerCounts(stdout + stderr)).toEqual({ created: 1, freed: 1 });
      expect(exitCode).toBe(failWrite ? 1 : 0);
    },
  );
});
