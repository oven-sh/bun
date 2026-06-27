import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
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
      // FileReader's poll is still armed while we GC. It records its pid so
      // the fixture can kill it to drive EOF, and the bounded sleep means
      // nothing outlives the test even if that kill never runs.
      const childScript =
        "const { spawn } = require('child_process');" +
        "const { existsSync } = require('node:fs');" +
        "const c = spawn('/bin/sh', ['-c', ': > " + JSON.stringify(startedDir) + "/$$; exec sleep 30']," +
        "  { stdio: ['ignore', 'inherit', 'ignore'], detached: true });" +
        "c.unref();" +
        // Exit only once the grandchild has recorded its pid. That proves it
        // is past posix_spawn and owns fd 1, and it guarantees the fixture's
        // readdirSync below sees every grandchild, so the kill loop is
        // deterministic instead of racing a timer. Bounded so a failed spawn
        // still lets the child exit and surface as grandchildrenStarted < 5.
        "const f = " + JSON.stringify(startedDir) + " + '/' + c.pid;" +
        "for (let i = 0; i < 5000 && !existsSync(f); i++) Bun.sleepSync(1);";

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

// FileReader::on_read_chunk resolves the pending read promise from inside
// PosixBufferedReader::read_with_fn, while that function still holds `&mut`
// into the NewSource<FileReader> box. Resolving it drains microtasks, so user
// JS runs mid-dispatch; if it calls reader.cancel() there, on_reader_done
// releases the across-read ref (taken in from_pipe) and the box's count drops
// to the JS wrapper's own ref, downgrading the wrapper's native Strong to
// Weak. A GC in that same microtask drain then sweeps the wrapper, whose
// finalizer frees the box, and the io caller's next access to it
// (register_poll / on_error / _offset) is a heap-use-after-free.
//
// This asserts the lifetime invariant directly rather than racing for the
// crash (which needs a GC to land in the short window before read_with_fn
// returns, and conservative stack scanning makes that non-deterministic):
// the source wrapper must still be Strong-protected immediately after the
// re-entrant cancel, because on_read_chunk holds its own ref across p.run()
// so the re-entrant release never reaches the downgrade-at-one threshold.
// The from_pipe pin from the test above is what makes it Strong to begin
// with; protectedBefore proves that precondition held.
//
// The chunk must exceed the 128 KiB mid-loop flush threshold in read_with_fn,
// otherwise the flush happens on the tail retry path and nothing touches the
// reader afterwards. A detached grandchild fills the stdout socketpair buffer
// while the fixture is blocked in sleepSync so the whole payload arrives in
// one poll dispatch, and keeps the write end open so received_hup stays false.
//
// Windows uses libuv for pipe I/O; the read_with_fn path under test is POSIX.
test.skipIf(isWindows)(
  "re-entrant cancel inside a subprocess stdout read keeps the FileReader pinned for the rest of the dispatch",
  async () => {
    using dir = tempDir("fr-cancel-uaf", {});
    const flag = join(String(dir), "go");
    const pidFile = join(String(dir), "gcpid");

    const script = /* js */ `
      const { heapStats } = require("bun:jsc");
      const fs = require("node:fs");
      const FLAG = ${JSON.stringify(flag)};
      const PIDFILE = ${JSON.stringify(pidFile)};

      const protectedSrc = () =>
        heapStats().protectedObjectTypeCounts.FileInternalReadableStreamSource ?? 0;

      globalThis.__done = Promise.withResolvers();

      globalThis.__onchunk = function __onchunk({ value, done }) {
        const chunkLen = done ? 0 : value.byteLength;
        const protectedBefore = protectedSrc();
        // cancel() synchronously reaches FileReader::on_reader_done, which
        // drops the across-read ref while read_with_fn is still on the stack.
        globalThis.__r.cancel().catch(() => {});
        const protectedAfter = protectedSrc();
        fs.writeSync(1, JSON.stringify({ chunkLen, protectedBefore, protectedAfter }) + "\\n");
        globalThis.__done.resolve();
      };

      // sh backgrounds a subshell that inherits stdout, writes its pid, and
      // exits immediately; the grandchild waits for FLAG, blasts 512 KiB at
      // the socketpair, then idles holding fd 1 so received_hup stays false.
      const proc = Bun.spawn({
        cmd: [
          "/bin/sh",
          "-c",
          '( while [ ! -e "$0" ]; do sleep 0.02; done; ' +
            'dd if=/dev/zero bs=65536 count=8 2>/dev/null; exec sleep 15 ) & ' +
            'echo $! > "$1"',
          FLAG,
          PIDFILE,
        ],
        stdin: "ignore",
        stdout: "pipe", // from_pipe: FileReader created, across-read ref taken
        stderr: "ignore",
      });
      globalThis.__s = proc.stdout;
      await proc.exited; // sh has exited; only the grandchild holds the pipe
      globalThis.__r = globalThis.__s.getReader();
      globalThis.__r.read().then(globalThis.__onchunk);

      // Release the grandchild, then block without ticking the event loop so
      // it fills the socketpair buffer past the 128 KiB flush threshold
      // before the readable poll can dispatch.
      fs.writeFileSync(FLAG, "");
      Bun.sleepSync(800);

      await globalThis.__done.promise;
      try { process.kill(Number(fs.readFileSync(PIDFILE, "utf8").trim()), "SIGKILL"); } catch {}
    `;

    let stdout = "",
      stderr = "",
      exitCode: number | null = null;
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--smol", "-e", script],
        // The CI runner sets BUN_FEATURE_FLAG_NO_ORPHANS on ASAN lanes, which
        // kills a detached grandchild the moment its intermediate parent
        // exits. This test needs it to outlive sh and keep the pipe's write
        // end open; cleanup is explicit (the fixture and the finally below).
        env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    } finally {
      // Always reap the detached grandchild; the fixture's own kill is
      // skipped if it crashes first.
      try {
        process.kill(Number(readFileSync(pidFile, "utf8").trim()), "SIGKILL");
      } catch {}
    }

    let result: { chunkLen: number; protectedBefore: number; protectedAfter: number };
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`fixture did not emit JSON (exit ${exitCode})\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    // Precondition: the delivered chunk exceeded read_with_fn's mid-loop
    // flush threshold (stack_buffer_len/2 = 128 KiB), so on_read_chunk's
    // p.run() ran with more of read_with_fn's loop still ahead of it.
    expect(result.chunkLen).toBeGreaterThan(128 * 1024);
    // Precondition: the from_pipe pin made the wrapper Strong before cancel.
    expect(result.protectedBefore).toBeGreaterThanOrEqual(1);
    // Invariant: the re-entrant cancel must not downgrade the wrapper while
    // read_with_fn is still on the stack. Before the fix, protectedAfter is 0
    // here, and a GC in this window frees the box read_with_fn is using.
    expect(result.protectedAfter).toBeGreaterThanOrEqual(1);
    expect(exitCode).toBe(0);
  },
  30_000,
);
