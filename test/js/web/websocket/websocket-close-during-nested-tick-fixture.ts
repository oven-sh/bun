// Run by websocket-close-during-nested-tick.test.ts under `bun test`: the
// nested event loop that this exercises is bun:test's synchronous wait for
// `expect(promise).resolves`.
import { expect, test } from "bun:test";

test("server closes the socket while a nested event loop runs inside the open callback", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 500 });
    },
    websocket: { message() {} },
  });

  const ws = new WebSocket(server.url);
  const closeCode = new Promise<number>(resolve => {
    ws.onclose = e => {
      // Keep the nested run going for two more loop iterations after the
      // close event. Closing the socket leaves a cancelled poll request in
      // flight; libuv completes the close (and unfixed builds freed the
      // socket) when the next iteration collects it.
      setImmediate(() => setImmediate(() => resolve(e.code)));
    };
  });
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WebSocket failed to connect"));
  });

  // The open event is dispatched from inside the native read callback of the
  // socket that received the 101 response, and this continuation runs in that
  // same frame. Close the connection from the server side, then wait for the
  // client to observe it with a synchronous `.resolves`: bun:test runs the
  // event loop inline here, nested inside that read callback. The nested run
  // closes the client socket that the outer frame is still dispatching.
  server.stop(true);
  expect(closeCode).resolves.toBe(1006);

  expect(ws.readyState).toBe(WebSocket.CLOSED);
});
