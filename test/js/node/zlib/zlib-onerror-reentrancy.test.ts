import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for a re-entrancy bug in the native zlib/brotli/zstd
// handle's emitError(): it used to clear `write_in_progress = false`
// *after* invoking the onerror callback. If that callback issued a new
// async write() (which sets write_in_progress=true and schedules a
// WorkPool task) followed by close(), the post-callback clear clobbered
// the flag and let closeInternal() free the native stream state while a
// task was still queued — the worker thread then ran doWork() on freed
// brotli/zstd/zlib state (use-after-free / `unreachable` panic).
//
// Correct behaviour: the close is deferred until the pending write
// completes, and the second (re-entrant) write's error is delivered, so
// onerror fires exactly twice.

describe("zlib native handle onerror re-entrancy", () => {
  const fixture = /* js */ `
    const zlib = require("zlib");

    const stream = zlib.createBrotliDecompress();
    const handle = stream._handle;

    const badInput = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const out = Buffer.alloc(1024);
    const FINISH = zlib.constants.BROTLI_OPERATION_FINISH;

    let calls = 0;
    handle.onerror = function (msg, errno, code) {
      calls++;
      if (calls > 1) return;
      // Re-entrant async write from inside onerror.
      this.write(FINISH, badInput, 0, badInput.length, out, 0, out.length);
      // Request close while the re-entrant write is pending. closeInternal()
      // must defer until that write completes.
      this.close();
    };

    handle.write(FINISH, badInput, 0, badInput.length, out, 0, out.length);

    process.on("exit", () => {
      process.stdout.write("calls=" + calls + "\\n");
    });
  `;

  // Run as a subprocess so a crash/SIGILL/SIGSEGV shows up as a non-zero
  // exit code rather than taking down the test runner. The behaviour was
  // timing-dependent (sometimes a worker-thread panic, sometimes a silently
  // dropped write), so exercise it a few times.
  for (let i = 0; i < 3; i++) {
    test.concurrent(`re-entrant write()+close() from onerror completes both writes (iteration ${i})`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      // Both writes error, so onerror must fire twice. Before the fix the
      // second write's completion was swallowed (or the process crashed) and
      // this was "calls=1" at best.
      expect(stdout).toBe("calls=2\n");
      expect(exitCode).toBe(0);
    });
  }
});
