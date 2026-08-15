// Run by websocket-close-during-nested-tick.test.ts under `bun test`: it needs
// expect().resolves, which spins the event loop synchronously (a nested tick).
//
// `open` on a client WebSocket is dispatched from inside uSockets' on_data
// dispatch for the client socket (the 101 response). Stopping the server and
// spinning the loop from there closes that same socket in a nested tick. The
// outer dispatch still reads the socket after the handler returns, so the
// nested tick must not free it; before the fix the libuv (Windows) event loop
// did, and this process crashed or hung on the corrupted heap.
import { expect, test } from "bun:test";

test("client socket closed inside a nested tick during open", async () => {
  for (let i = 0; i < 32; i++) {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("expected a websocket upgrade", { status: 400 });
      },
      websocket: {
        open() {},
        message() {},
        close() {},
      },
    });

    const closed = Promise.withResolvers<void>();
    const opened = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    ws.onerror = () => {};
    ws.onclose = () => closed.resolve();
    ws.onopen = () => {
      try {
        // Closes the server side of this connection; the client's EOF is
        // delivered by the nested ticks below, which close (and, before the
        // fix, free) the socket whose on_data dispatch we are running inside.
        server.stop(true);
        expect(closed.promise).resolves.toBeUndefined();
        // The port is closed now, so this connect is refused. Its connecting
        // socket and per-address attempts are allocated and freed inside the
        // nested ticks too, recycling the freed block before the outer
        // dispatch resumes.
        expect(fetch(server.url)).rejects.toThrow();
        expect(ws.readyState).toBe(WebSocket.CLOSED);
        opened.resolve();
      } catch (e) {
        opened.reject(e);
      }
    };
    await opened.promise;
    await closed.promise;
  }
  console.log("fixture done");
});
