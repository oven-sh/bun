// Fixture for serve-pending-promise-abort-leak.test.ts. It runs in a child
// process: before the fix, the late settle below corked a uWS response the 413
// had already freed (heap-use-after-free under ASAN), and that crash must not
// take the test runner down with it.
//
// A chunked (no Content-Length) POST that exceeds maxRequestBodySize hits the
// streaming 413 in on_buffered_body_chunk, not the up-front Content-Length
// check. That path used to write the 413 on the raw uWS response without
// detaching ctx.resp or releasing the base ref. uWS markDone() clears
// onAborted, so no abort fired when the socket closed, and a later
// handleResolve()/handleReject() dereferenced the freed response.
import { connect } from "node:net";

// Sends the overflowing POST. Resolves with everything the server wrote once
// it closed the connection: uSockets frees a closed socket at the end of the
// loop iteration that closed it, and the client only sees the close in a later
// one, so by then the uWS response is gone.
async function sendChunkedOverflow(port: number): Promise<string> {
  const sock = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    sock.on("connect", resolve);
    sock.on("error", reject);
  });
  // The server closes with part of the body unread; a reset is expected.
  sock.removeAllListeners("error");
  sock.on("error", () => {});

  let received = "";
  const { promise: closed, resolve: onClose } = Promise.withResolvers<string>();
  sock.on("data", d => (received += d.toString("latin1")));
  sock.on("close", () => onClose(received));

  sock.write("POST / HTTP/1.1\r\n" + `Host: 127.0.0.1:${port}\r\n` + "Transfer-Encoding: chunked\r\n" + "\r\n");
  const chunk = Buffer.alloc(2048, "A");
  sock.write(chunk.length.toString(16) + "\r\n");
  sock.write(chunk);
  sock.write("\r\n0\r\n\r\n");
  return closed;
}

for (const settle of ["resolve", "reject"] as const) {
  let settleLate: (() => void) | undefined;
  let handlerPromise: Promise<Response> | undefined;
  let bodyError = "";
  let errorCalls = 0;
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    maxRequestBodySize: 1024,
    fetch(req) {
      if (req.method !== "POST") return new Response("follow-up");
      req.text().catch(e => (bodyError = (e as Error).message));
      handlerPromise = new Promise<Response>((resolve, reject) => {
        settleLate =
          settle === "resolve" ? () => resolve(new Response("late")) : () => reject(new Error("late reject"));
      });
      return handlerPromise;
    },
    error() {
      errorCalls++;
      return new Response("error-handler", { status: 500 });
    },
  });

  const response = await sendChunkedOverflow(Number(server.port));
  // The 413 tore the context down before its bytes reached the client.
  const pendingAfter413 = server.pendingRequests;

  // handleResolve/handleReject must find no context: nothing is rendered,
  // error() does not run, and nothing touches the freed uWS response. Awaiting
  // the handler promise orders the checks after the native reaction, which was
  // attached first.
  settleLate!();
  const outcome = await handlerPromise!.then(
    () => "resolved",
    (e: Error) => `rejected: ${e.message}`,
  );
  settleLate = undefined;

  // A request on a fresh connection must not see the stale "late" response.
  const followUp = await fetch(server.url);
  console.log(
    JSON.stringify({
      settle,
      response,
      bodyError,
      pendingAfter413,
      outcome,
      pendingAfterSettle: server.pendingRequests,
      errorCalls,
      followUp: [followUp.status, await followUp.text()],
    }),
  );
  await server.stop();
}
