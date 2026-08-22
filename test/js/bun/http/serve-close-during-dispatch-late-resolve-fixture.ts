// The client connection closes while the handler's microtask checkpoint runs
// the event loop (a synchronous wait on a promise), and the Promise<Response>
// the handler returned settles on a later turn of the loop.
//
// Before the fix, the request only subscribed to the close once its dispatch
// was over, so a close dispatched by that nested run was lost: request.signal
// never fired, and the late resolve rendered the response into the socket
// uSockets had freed at the end of the tick (heap-use-after-free under ASAN).
import { expect } from "bun:test";
import { connect } from "node:net";

let abortCount = 0;
const { promise: lateResponse, resolve: resolveLate } = Promise.withResolvers<Response>();
const { promise: dispatchOver, resolve: signalDispatchOver } = Promise.withResolvers<void>();

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch(req) {
    req.signal.addEventListener("abort", () => abortCount++, { once: true });
    queueMicrotask(() => {
      client.end();
      // Runs the event loop until the client sees the server's FIN, so the
      // server side's close is dispatched before this returns.
      expect(clientClosed).resolves.toBeUndefined();
      // An immediate queued here runs once the dispatch has returned and the
      // tick that ran it has ended.
      setImmediate(signalDispatchOver);
    });
    return lateResponse;
  },
});

const client = connect(server.port, "127.0.0.1", () => {
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
});
client.on("error", () => {});
const clientClosed = new Promise<void>(resolve => client.once("close", () => resolve()));

await dispatchOver;
resolveLate(new Response("late"));
// The server subscribed to the promise during the dispatch, so its reaction
// runs (and renders, on an unfixed build) before this continuation.
await lateResponse;
const pendingAfterResolve = server.pendingRequests;
await server.stop();

console.log(JSON.stringify({ abortCount, pendingAfterResolve }));
process.exit(abortCount === 1 && pendingAfterResolve === 0 ? 0 : 1);
