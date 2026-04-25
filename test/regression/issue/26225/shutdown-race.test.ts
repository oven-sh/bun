import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Regression test for the "ThreadLock is locked by thread X, not thread Y" panic
// seen on process exit after a fetch() with a streaming request body (originally
// flaked in test/regression/issue/26225.test.ts on x64-asan).
//
// Root cause: FetchTasklet.derefFromThread() runs on the HTTP thread. If the JS
// thread has already dropped its ref and set `is_shutting_down`, the old code
// called `this.deinit()` directly from the HTTP thread. `deinit()` → `clearData()`
// → `clearSink()` then derefs the ResumableSink, whose single-threaded RefCount
// was ThreadLock-bound to the JS thread in `startRequestStream()` — triggering
// the assertion.
//
// The race window (between the HTTP thread's `mutex.unlock()` and
// `derefFromThread()`) is too narrow to hit without help, so this test uses a
// ci_assert-gated sleep hook (`BUN_DEBUG_FETCH_TASKLET_DEREF_SLEEP_MS`) to widen
// it, plus `BUN_DESTRUCT_VM_ON_EXIT=1` so the JS thread's VM teardown keeps the
// process alive long enough for the HTTP thread to wake and observe
// `isShuttingDown() == true`.
//
// The ThreadLock assertion and the sleep hook only exist in ci_assert builds.
test.skipIf(!isDebug && !isASAN)(
  "fetch with streaming body: HTTP thread does not run FetchTasklet.deinit on shutdown",
  async () => {
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const bytes = await req.arrayBuffer();
        return Response.json({ ok: true, bytesReceived: bytes.byteLength });
      },
    });

    const client = /* js */ `
      const { Readable } = require("node:stream");
      async function* gen() {
        yield Buffer.alloc(1024 * 50, 0x42);
        yield Buffer.alloc(1024 * 50, 0x42);
      }
      fetch("http://127.0.0.1:${server.port}", {
        method: "POST",
        body: Readable.from(gen()),
        headers: { "content-type": "application/octet-stream" },
      })
        .then(r => r.json())
        .then(r => { console.log(JSON.stringify(r)); })
        .catch(e => { console.error(e); process.exit(1); });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", client],
      env: {
        ...bunEnv,
        // Widen the HTTP-thread race window so the JS thread reliably reaches
        // `is_shutting_down = true` first.
        BUN_DEBUG_FETCH_TASKLET_DEREF_SLEEP_MS: "50",
        // Keep the process alive past `is_shutting_down` long enough for the
        // HTTP thread to wake from its sleep and hit the shutdown branch.
        BUN_DESTRUCT_VM_ON_EXIT: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Precondition: the sleep hook must be compiled in for this test to be
    // meaningful. Without it the race is effectively unreachable and this test
    // would pass for the wrong reason.
    expect(stderr).toContain("[FetchTasklet.derefFromThread sleep 50ms]");

    // The actual regression check: the subprocess must complete cleanly. Before
    // the fix, `deinit()` ran on the HTTP thread here and touched JS-thread-only
    // state (ResumableSink ThreadLock, jsc.Strong/Weak) while the main thread was
    // concurrently tearing down the JSC VM — crashing with a ThreadLock
    // assertion or a WTF::AtomStringImpl assertion depending on which landed first.
    expect(stdout.trim()).toBe(JSON.stringify({ ok: true, bytesReceived: 1024 * 100 }));
    expect(exitCode).toBe(0);
  },
);
