// https://github.com/oven-sh/bun/issues/32734
import { expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

// After an HTTP upgrade is handed to the native WebSocket server (server.upgrade),
// the node:http socket from the 'upgrade' event must still emit 'close' when the
// WebSocket peer closes. Regressed in 1.4.0-canary.1: the raw socket 'close'
// never fired, hanging any code that waits on it (e.g. a WebSocket proxy scope).
test("node:http upgrade socket emits 'close' when the WebSocket peer closes", async () => {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });

  const rawSocketClosed = Promise.withResolvers<void>();
  const wsClosed = Promise.withResolvers<void>();

  server.on("upgrade", (req, socket, head) => {
    socket.once("close", () => rawSocketClosed.resolve());
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on("message", m => ws.send("echo:" + String(m)));
      ws.on("close", () => wsClosed.resolve());
      ws.send("protocol:hi");
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  try {
    const client = new WebSocket(`ws://127.0.0.1:${port}/`);
    const echoed = Promise.withResolvers<void>();
    client.addEventListener("error", echoed.reject);
    client.addEventListener("message", e => {
      if (String(e.data).startsWith("protocol:")) client.send("hello");
      if (e.data === "echo:hello") echoed.resolve();
    });

    await echoed.promise;
    client.close(1000);

    // The ws-level 'close' fires in both 1.3.14 and 1.4; the raw node:http
    // socket 'close' is the one that regressed. Awaiting it hangs without the
    // fix until the test times out.
    await wsClosed.promise;
    await rawSocketClosed.promise;
    expect(wss.clients.size).toBe(0);
  } finally {
    wss.close();
    server.close();
  }
});
