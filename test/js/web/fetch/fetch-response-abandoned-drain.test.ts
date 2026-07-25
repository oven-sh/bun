// When a fetch() Response is dropped without the body being read, the Weak
// finalizer on the JS Response wrapper reaches
// FetchTasklet::on_response_finalize (scenario 3: Locked body, no stream, no
// promise). Previously that path unconditionally drained the remaining body so
// the connection could be pooled, with no upper bound: an abandoned 32 MB
// response was read in full and the socket reused. Now the drain is capped at
// 256 KiB of remaining Content-Length; anything larger (or chunked/unknown)
// closes the connection instead.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// The server writes the body in 16 KiB chunks, pausing on backpressure so
// `bodyWritten` tracks what the client actually pulled plus at most one kernel
// send buffer. The client fetches, drops the Response, forces GC so the Weak
// finalizer runs, and then waits until the server has either sent the whole
// body or seen the socket close.
function fixture(contentLength: number) {
  return /* js */ `
    const net = require("node:net");

    const contentLength = ${contentLength};
    const chunk = Buffer.alloc(16 * 1024, 0x61);
    let bodyWritten = 0;
    let conn;
    const { promise: done, resolve: onDone } = Promise.withResolvers();

    const server = net.createServer(socket => {
      conn = socket;
      socket.on("error", () => {});
      socket.on("close", onDone);
      let replied = false;
      socket.on("data", () => {
        if (replied) return;
        replied = true;
        socket.write(
          "HTTP/1.1 200 OK\\r\\n" +
            "Content-Length: " + contentLength + "\\r\\n" +
            "Connection: keep-alive\\r\\n" +
            "\\r\\n",
        );
        const writeMore = () => {
          while (bodyWritten < contentLength && !socket.destroyed) {
            const n = Math.min(chunk.length, contentLength - bodyWritten);
            const ok = socket.write(n === chunk.length ? chunk : chunk.subarray(0, n));
            bodyWritten += n;
            if (!ok) return socket.once("drain", writeMore);
          }
          onDone();
        };
        writeMore();
      });
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    let collected = false;
    const reg = new FinalizationRegistry(() => { collected = true; });
    async function once() {
      const res = await fetch("http://127.0.0.1:" + port + "/");
      if (res.status !== 200) throw new Error("status " + res.status);
      reg.register(res, 0);
      // Drop the Response without touching .body / .text() etc.
    }
    await once();
    while (!collected) {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
    }

    await done;
    await new Promise(r => setImmediate(r));

    console.log(bodyWritten + " " + (conn.destroyed ? "closed" : "open"));
    conn.destroy();
    server.close();
  `;
}

async function run(contentLength: number) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(contentLength)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const [bodyWritten, state] = stdout.trim().split(" ");
  return { bodyWritten: Number(bodyWritten), state };
}

// Platform-independent code path; collectContinuously-style GC tests are slow
// on Windows CI so keep this off there (matches fetch-response-finalizer-sweep).
describe.skipIf(isWindows)("fetch: abandoned Response body drain policy", () => {
  test("small body (64 KiB) is drained so the connection stays poolable", async () => {
    const { bodyWritten, state } = await run(64 * 1024);
    expect({ bodyWritten, state }).toEqual({ bodyWritten: 64 * 1024, state: "open" });
  }, 60_000);

  test("large body (32 MiB) is closed instead of drained in full", async () => {
    const total = 32 * 1024 * 1024;
    const { bodyWritten, state } = await run(total);
    // The server front-loads one kernel send buffer before the client ever
    // pauses, so `bodyWritten` includes that window on top of the 256 KiB cap.
    // Without the cap the full 32 MiB is drained; a quarter of that is well
    // above any loopback send buffer and well below the unbounded drain.
    expect(bodyWritten).toBeLessThan(total / 4);
    expect(state).toBe("closed");
  }, 60_000);
});
