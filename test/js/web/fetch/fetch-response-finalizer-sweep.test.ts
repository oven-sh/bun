// fetch(): the JSResponse Weak finalizer (WeakBlock::sweep) reaches
// FetchTasklet::ignore_remaining_response_body. That path used to call
// ResumableSink::detach_js(), which writes the wrapper's cached ondrain/
// oncancel/stream slots via generated *SetCachedValue helpers. Those helpers
// uncheckedDowncast<JSResumableFetchSink>(...) -> JSCell::classInfo(), and
// touching any JSCell while MutatorState == Sweeping trips
// validateIsNotSweeping() (assert builds) or silently corrupts the heap
// (release builds).
//
// Scenario: POST with a user-constructed ReadableStream body (so the sink
// takes the JS route and holds a Strong js_this), server replies with headers
// but leaves the body open (response body = Locked with no promise), drop the
// Response unconsumed, force a synchronous sweep.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const fixture = /* js */ `
  const net = require("node:net");

  let sockets = [];
  const server = net.createServer(socket => {
    sockets.push(socket);
    socket.on("error", () => {});
    // Reply once request headers (and the first body chunk) have arrived so
    // the client has already entered start_request_stream() and created the
    // ResumableSink. Then send response headers + one partial chunk so
    // fetch() resolves with is_waiting_body = true (BodyValue::Locked).
    let replied = false;
    socket.on("data", () => {
      if (replied) return;
      replied = true;
      socket.write(
        "HTTP/1.1 200 OK\\r\\n" +
          "Transfer-Encoding: chunked\\r\\n" +
          "Connection: close\\r\\n" +
          "\\r\\n" +
          "5\\r\\nhello\\r\\n",
      );
      // Do NOT send the terminating 0-chunk; keep the body pending.
    });
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  async function once() {
    let pullAgain;
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("abc"));
      },
      pull() {
        // Never resolve: keep the upload sink alive with a Strong js_this
        // so detach_js() has a live wrapper to downcast.
        return new Promise(r => { pullAgain = r; });
      },
    });
    const res = await fetch("http://127.0.0.1:" + port + "/", {
      method: "POST",
      body,
      duplex: "half",
    });
    if (res.status !== 200) throw new Error("status " + res.status);
    // Drop the Response without touching .body / .text() etc.
    return pullAgain;
  }

  // A few iterations so at least one Response lands in a block that the
  // allocation slow-path sweeps while the collector thread is running.
  const keep = [];
  for (let i = 0; i < 12; i++) {
    keep.push(await once());
    // Allocation between Bun.gc calls gives LocalAllocator::allocateSlowCase
    // a reason to sweep the block the dead Response sits in.
    new Error("alloc");
    Bun.gc(true);
    new Error("alloc");
    Bun.gc(true);
  }

  for (const s of sockets) s.destroy();
  server.close();
  console.log("ok");
`;

// collectContinuously is slow under Windows CI and the code path is identical
// across platforms; the assertion this guards is platform-independent.
describe.skipIf(isWindows)("fetch Response Weak finalizer during GC sweep", () => {
  test("dropping an unconsumed streaming-upload Response does not touch JSCells in the finalizer", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        BUN_JSC_collectContinuously: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // On failure the process aborts inside WeakBlock::sweep before reaching
    // the print; asserting the combined shape gives a readable diff. stderr
    // is included for diagnostics only (debug/ASAN builds emit benign
    // warnings there, so it is not required to be empty).
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: "ok",
      exitCode: 0,
      stderr: expect.any(String),
    });
  }, 120_000);
});
