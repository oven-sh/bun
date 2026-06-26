// https://github.com/oven-sh/bun/issues/32734
import { expect, test } from "bun:test";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

// After an HTTP upgrade is handed to the native WebSocket server (server.upgrade),
// the node:http socket from the 'upgrade' event must still emit 'close' when the
// WebSocket peer closes. Regressed in 1.4.0-canary.1: the raw socket 'close'
// never fired, hanging any code that waits on it (e.g. a WebSocket proxy scope).
test("node:http upgrade socket emits 'close' when the WebSocket peer closes", async () => {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });

  const echoed = Promise.withResolvers<void>();
  const wsClosed = Promise.withResolvers<void>();
  const rawSocketClosed = Promise.withResolvers<void>();

  server.on("upgrade", (req, socket, head) => {
    socket.once("error", rawSocketClosed.reject);
    socket.once("close", () => rawSocketClosed.resolve());
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on("error", err => (wsClosed.reject(err), echoed.reject(err)));
      ws.on("message", m => ws.send("echo:" + String(m)));
      ws.on("close", () => wsClosed.resolve());
      ws.send("protocol:hi");
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  let client: WebSocket | undefined;
  try {
    client = new WebSocket(`ws://127.0.0.1:${port}/`);
    client.addEventListener("error", () => {
      const err = new Error("client WebSocket error");
      echoed.reject(err), wsClosed.reject(err), rawSocketClosed.reject(err);
    });
    client.addEventListener("message", e => {
      if (String(e.data).startsWith("protocol:")) client!.send("hello");
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
    client?.close();
    wss.close();
    server.close();
  }
});

// The same fix covers CONNECT tunnels: a detached node:http CONNECT socket must
// emit 'close' when the peer tears down the connection.
test("node:http CONNECT tunnel socket emits 'close' when the peer closes", async () => {
  const server = http.createServer();

  const established = Promise.withResolvers<void>();
  const connectClosed = Promise.withResolvers<void>();

  server.on("connect", (req, socket) => {
    socket.once("error", connectClosed.reject);
    socket.once("close", () => connectClosed.resolve());
    socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  let client: net.Socket | undefined;
  try {
    client = net.connect(port, "127.0.0.1", () => {
      client!.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    });
    client.on("error", err => (established.reject(err), connectClosed.reject(err)));
    client.on("data", d => {
      if (d.toString().includes("200")) {
        established.resolve();
        client!.destroy(); // peer tears down -> server tunnel socket must 'close'
      }
    });

    await established.promise;
    await connectClosed.promise; // hangs without the fix
  } finally {
    client?.destroy();
    server.close();
  }
});
