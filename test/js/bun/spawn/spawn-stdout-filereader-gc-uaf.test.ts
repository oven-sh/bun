import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Accessing `proc.stdout` on a piped subprocess moves the already-registered
// pipe poll from the subprocess PipeReader into a freshly allocated
// NewSource<FileReader>. The across-read ref (which upgrades the wrapper's
// JsRef to Strong and pins the native box) used to be taken only in
// FileReader::on_start, the first time JS actually pulls from the stream.
// Between from_pipe and that first pull the poll's owner points into a box
// whose only ref is the JS wrapper's own Weak back-reference, so if the
// subprocess and its cached stdout become unreachable before anyone pulls,
// GC can sweep the wrapper and free the box while the poll is still armed.
// The next readability/EOF event then dispatches into freed memory
// (FileReader::on_reader_done reached from PosixBufferedReader::read_socket).
//
// This test asserts the lifetime invariant directly rather than racing for
// the crash: while a subprocess pipe's write end is still held open (by a
// detached grandchild that inherits it), the FileInternalReadableStreamSource
// wrapper must survive GC even though nothing in JS references it. Once the
// grandchild exits and the pipe reaches EOF, on_reader_done releases the ref
// and the wrapper becomes collectable (no leak).
//
// Windows uses libuv for pipe I/O; the from_pipe path under test is POSIX.
test.skipIf(isWindows)(
  "subprocess stdout FileReader is pinned while its pipe poll is live, then collectable after EOF",
  async () => {
    using dir = tempDir("fr-gc-uaf", {});
    const started = join(String(dir), "started");

    const script = /* js */ `
      const { heapStats } = require("bun:jsc");
      const { readdirSync } = require("node:fs");
      const ITERS = 4;
      const startedDir = ${JSON.stringify(started)};
      require("node:fs").mkdirSync(startedDir, { recursive: true });

      // The direct child spawns a detached sleep that inherits stdout,
      // keeping the pipe's write end open past the child's exit so the
      // FileReader's poll is still armed while we GC. The helper records
      // its pid so the fixture can kill it to drive EOF, and the bounded
      // sleep means nothing outlives the test even if that kill never runs.
      const childScript =
        "const { spawn } = require('child_process');" +
        "const c = spawn('/bin/sh', ['-c', 'echo $$ > " + JSON.stringify(startedDir) + "/$$; exec sleep 30']," +
        "  { stdio: ['ignore', 'inherit', 'ignore'], detached: true });" +
        "c.unref();" +
        // Wait one tick so posix_spawn has definitely handed fd 1 to the
        // grandchild before this process closes its own copy on exit.
        "setTimeout(() => {}, 10);";

      const count = () =>
        heapStats().objectTypeCounts.FileInternalReadableStreamSource ?? 0;

      let streams = 0;
      async function once() {
        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", childScript],
          env: process.env,
          stdout: "pipe",
          stderr: "ignore",
          stdin: "ignore",
        });
        // Materialize the ReadableStream so the live poll is re-parented
        // into a NewSource<FileReader>, but never pull from it.
        if (proc.stdout instanceof ReadableStream) streams++;
        await proc.exited;
      }

      // Warm up once so per-class lazy structure allocation is absorbed
      // into the baseline and not counted against ITERS.
      await once();
      for (let i = 0; i < 10; i++) { Bun.gc(true); await Bun.sleep(1); }
      const base = count();

      await Promise.all(Array.from({ length: ITERS }, once));
      const afterSpawn = count() - base;

      // Synchronous full GC with no event-loop yield: if the wrappers survive
      // here they are Strong-rooted (fix engaged); if they are swept only
      // after the sleep loop below, the pipes reached EOF in between.
      Bun.gc(true); Bun.gc(true);
      const afterSyncGC = count() - base;

      // Direct children have exited; grandchildren still hold the write end.
      for (let i = 0; i < 20; i++) { Bun.gc(true); await Bun.sleep(1); }
      const duringLivePipe = count() - base;
      const pids = readdirSync(startedDir);
      const grandchildrenStarted = pids.length;

      // Release the grandchildren (including the warmup one) so the pipes EOF.
      for (const pid of pids) {
        try { process.kill(Number(pid), "SIGTERM"); } catch {}
      }

      let afterEof = -1;
      for (let i = 0; i < 100; i++) {
        Bun.gc(true);
        await Bun.sleep(10);
        afterEof = count() - base;
        if (afterEof <= 0) break;
      }

      console.log(JSON.stringify({
        iters: ITERS, duringLivePipe, afterEof,
        base, afterSpawn, afterSyncGC, streams, grandchildrenStarted,
      }));
    `;

    let stdout = "",
      stderr = "",
      exitCode: number | null = null;
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--smol", "-e", script],
        // The CI runner sets BUN_FEATURE_FLAG_NO_ORPHANS on ASAN lanes, which
        // kills a detached grandchild the moment its intermediate parent exits
        // (PR_SET_CHILD_SUBREAPER). This test needs that grandchild to outlive
        // its parent and hold the pipe open; orphan cleanup is handled
        // explicitly instead (the fixture kills by pid, the finally below
        // reaps survivors).
        env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });

      [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    } finally {
      // Always reap any detached grandchildren so nothing outlives the test
      // even if the fixture crashed before killing them itself.
      for (const pid of (() => {
        try {
          return readdirSync(started);
        } catch {
          return [];
        }
      })()) {
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {}
      }
    }

    let result: { iters: number; duringLivePipe: number; afterEof: number };
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`fixture did not emit JSON (exit ${exitCode})\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    const { iters, duringLivePipe, afterEof } = result;
    // Invariant: every FileReader whose pipe poll is still armed must be
    // pinned by its own Strong ref. Before the fix they were swept here
    // (duringLivePipe ~ 0), which is exactly the UAF precondition. The full
    // result object carries base/afterSpawn/streams for CI diagnostics.
    if (duringLivePipe < iters) {
      expect({ duringLivePipe, ...result, stderr }).toEqual({
        duringLivePipe: `>= ${iters}`,
      });
    }
    expect(duringLivePipe).toBeGreaterThanOrEqual(iters);
    // Once the pipe reaches EOF the ref is released and the wrappers become
    // collectable. One may survive via a conservatively-rooted final
    // Subprocess (same caveat as spawn-ipc-gc.test.ts).
    expect(afterEof).toBeLessThanOrEqual(1);
    expect(exitCode).toBe(0);
  },
  60_000,
);
