import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// Regression guard for a use-after-GC in pipeTo's native shutdown path.
// JSNativeStreamSourceAdapter::m_controller was a JSC::Weak<>, so an adapter
// queued as a microtask reaction context did not root the controller. When a
// socket error rejected the native pull promise and FetchTasklet released its
// Strong<>s before the microtask drain, a GC in between could leave the whole
// consumer graph (controller -> stream -> reader -> pipe op -> destination ->
// writer -> readyPromise) white. The subsequent onNativePullRejected errored
// the stream through a stale Weak read, cascading into a deferred pipe
// shutdown that called writableStreamAbort on a corpse destination and
// dereferenced a swept readyPromise (RELEASE_ASSERT in JSObject::realm();
// silent heap write on builds without the assert).
//
// The crash is timing-dependent (observed ~1/3 under a fault-injected tracer
// replay; 0/1800 under best-effort in-memory GC storms). This test exercises
// the shape (native body source, socket fault mid-stream, fire-and-forget
// pipeTo under collectContinuously, AbortDestination shutdown arm) as a
// regression surface, not a deterministic reproducer.

const script = `
  "use strict";
  const net = require("node:net");

  let connId = 0;
  const server = net.createServer(sock => {
    const id = connId++;
    sock.on("error", () => {});
    sock.write(
      "HTTP/1.1 200 OK\\r\\n" +
        "Content-Type: application/octet-stream\\r\\n" +
        "Transfer-Encoding: chunked\\r\\n" +
        "Connection: close\\r\\n" +
        "\\r\\n",
    );
    sock.write("3\\r\\nabc\\r\\n");
    setTimeout(() => {
      try {
        sock.write("3\\r\\ndef\\r\\n");
      } catch {}
      setTimeout(() => {
        try {
          // socket fault: abrupt destroy mid-chunk (no terminating 0\\r\\n)
          sock.write("5\\r\\ngh");
          sock.destroy();
        } catch {}
      }, 1);
    }, 1);
  });

  await new Promise(r => server.listen(0, r));
  const url = "http://127.0.0.1:" + server.address().port + "/";

  function makeSink() {
    return new WritableStream(
      { write() {}, close() {}, abort() {} },
      new CountQueuingStrategy({ highWaterMark: 0 }),
    );
  }

  async function once(i) {
    let resp;
    try {
      resp = await fetch(url);
    } catch {
      return;
    }
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("iter-abort")), 3);
    // preventAbort=false: source error -> AbortDestination shutdown arm
    resp.body.pipeTo(makeSink(), { signal: ac.signal }).catch(() => {});
    // No await: drop resp / ws so only the internal pipe graph roots them.
  }

  for (let iter = 0; iter < 8; iter++) {
    const batch = [];
    for (let i = 0; i < 40; i++) batch.push(once(i));
    await Promise.all(batch);
    for (let k = 0; k < 6; k++) {
      Bun.gc(true);
      await Bun.sleep(1);
    }
  }
  server.close();
  for (let k = 0; k < 6; k++) {
    Bun.gc(true);
    await Bun.sleep(1);
  }
  console.log("OK");
`;

test(
  "abandoned pipeTo over a faulting native body does not re-enter a swept pipe graph",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "OK", stderr: "", exitCode: 0 });
  },
  isASAN ? 90_000 : 30_000,
);
