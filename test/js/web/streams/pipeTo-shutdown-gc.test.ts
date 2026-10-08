import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";

// Regression surface for a use-after-GC observed in pipeTo's native shutdown
// path (RELEASE_ASSERT in JSObject::realm() from a swept readyPromise). The
// crash only reproduced under a fault-injected tracer replay; this exercises
// the same shape (native body source, socket fault mid-stream, fire-and-forget
// pipeTo, AbortDestination shutdown arm) under collectContinuously.

const script = `
  "use strict";
  const net = require("node:net");

  const server = net.createServer(sock => {
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

  async function once() {
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
    // No await: drop resp so only the internal pipe graph roots the body stream.
  }

  for (let iter = 0; iter < 8; iter++) {
    const batch = [];
    for (let i = 0; i < 40; i++) batch.push(once());
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
      // collectContinuously is prohibitively slow on Windows CI; the script's
      // explicit Bun.gc(true) storms retain coverage there.
      env: { ...bunEnv, ...(isWindows ? {} : { BUN_JSC_collectContinuously: "1" }) },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "OK", stderr: "", exitCode: 0 });
  },
  isASAN ? 90_000 : 30_000,
);
