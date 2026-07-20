import { connect } from "node:net";

// A chunked (no Content-Length) POST that exceeds maxRequestBodySize hits the
// streaming 413 in onBufferedBodyChunk, not the up-front server.zig check.
// That path previously wrote the 413 directly on the raw uWS response without
// detaching ctx.resp or releasing the base ref — uWS markDone() nulls
// onAborted, so when the socket closed no abort fired. If the fetch handler's
// Promise then settled, handleResolve()/handleReject() dereferenced the
// already-freed response (heap-use-after-free under ASAN) and the
// RequestContext leaked.

async function sendChunkedOverflow(port: number) {
  const sock = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    sock.on("connect", resolve);
    sock.on("error", reject);
  });

  sock.write(
    "POST / HTTP/1.1\r\n" + //
      `Host: 127.0.0.1:${port}\r\n` +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n",
  );
  const chunk = Buffer.alloc(2048, "A");
  sock.write(chunk.length.toString(16) + "\r\n");
  sock.write(chunk);
  sock.write("\r\n0\r\n\r\n");

  let received = "";
  const { promise, resolve: done } = Promise.withResolvers<void>();
  sock.on("data", d => {
    received += d.toString();
    if (received.includes("\r\n\r\n")) done();
  });
  sock.on("close", () => done());
  await promise;
  sock.destroy();
  return received.split("\r\n")[0];
}

async function waitForPending(server: ReturnType<typeof Bun.serve>, n: number) {
  for (let i = 0; i < 100 && server.pendingRequests !== n; i++) {
    Bun.gc(true);
    await Bun.sleep(10);
  }
  return server.pendingRequests;
}

// --- resolve path ---
{
  let capturedResolve: ((r: Response) => void) | undefined;
  let bodyErr = "";
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    maxRequestBodySize: 1024,
    fetch(req) {
      if (req.method !== "POST") return new Response("follow-up");
      req.text().catch(e => (bodyErr = String(e?.message ?? e)));
      return new Promise<Response>(resolve => {
        capturedResolve = resolve;
      });
    },
  });

  const status = await sendChunkedOverflow(Number(server.port));
  // Let the closed socket's memory be reclaimed before the late resolve so a
  // stale ctx.resp is a real dangling pointer, not just a done-but-live one.
  await waitForPending(server, 1);
  await Bun.sleep(10);

  // handleResolve must observe isAbortedOrEnded() and drop the Response; it
  // must not cork/write on the freed uWS socket.
  capturedResolve!(new Response("late"));
  capturedResolve = undefined;
  const pending = await waitForPending(server, 0);

  // A follow-up request must still work and must not see the stale "late".
  const ok = await fetch(server.url, { method: "GET" });
  const okText = await ok.text();

  console.log(
    JSON.stringify({
      case: "resolve",
      status,
      bodyErr,
      pendingAfterResolve: pending,
      followUp: { status: ok.status, text: okText },
    }),
  );
  server.stop(true);
}

// --- reject path ---
{
  let capturedReject: ((e: unknown) => void) | undefined;
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    maxRequestBodySize: 1024,
    fetch(req) {
      req.text().catch(() => {});
      return new Promise<Response>((_resolve, reject) => {
        capturedReject = reject;
      });
    },
    error() {
      // A late reject after the 413 should be a no-op for this request; the
      // error handler only renders when it can still respond.
      return new Response("error-handler", { status: 500 });
    },
  });

  const status = await sendChunkedOverflow(Number(server.port));
  await waitForPending(server, 1);
  await Bun.sleep(10);

  capturedReject!(new Error("late reject"));
  capturedReject = undefined;
  const pending = await waitForPending(server, 0);

  console.log(
    JSON.stringify({
      case: "reject",
      status,
      pendingAfterReject: pending,
    }),
  );
  server.stop(true);
}
