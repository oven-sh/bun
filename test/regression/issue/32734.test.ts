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
    socket.once("error", err => rawSocketClosed.reject(err));
    socket.once("close", () => rawSocketClosed.resolve());
    // `ws` is load-bearing, not incidental: only its graceful bidirectional
    // close handshake (close frame -> reply -> both FIN) reaches the native
    // socket-closed callback. A raw client `destroy()` takes the abort path,
    // which already emitted 'close' before the fix, so it does not reproduce.
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on("error", err => {
        echoed.reject(err);
        wsClosed.reject(err);
      });
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
      echoed.reject(err);
      wsClosed.reject(err);
      rawSocketClosed.reject(err);
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

// CONNECT tunnels keep node's half-open semantics: after the peer's FIN the socket
// emits 'end' but stays writable (node v26.3.0 emits no 'close' for a bare peer
// teardown), and 'close' fires once this side finishes too. The tunnel lifecycle
// must complete without hanging.
test("node:http CONNECT tunnel socket emits 'end' on the peer's FIN and 'close' once ended", async () => {
  const server = http.createServer();

  const established = Promise.withResolvers<void>();
  const tunnelEnded = Promise.withResolvers<void>();
  const connectClosed = Promise.withResolvers<void>();

  server.on("connect", (req, socket) => {
    socket.once("error", err => connectClosed.reject(err));
    // Like node: the tunnel is half-open after the peer's FIN, so finish this
    // half once the peer's side ends to complete the socket's lifecycle.
    socket.once("end", () => {
      tunnelEnded.resolve();
      socket.end();
    });
    socket.once("close", () => connectClosed.resolve());
    socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  let client: net.Socket | undefined;
  let tunnelEstablished = false;
  try {
    client = net.connect(port, "127.0.0.1", () => {
      client!.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    });
    client.on("error", err => {
      established.reject(err);
      connectClosed.reject(err);
    });
    client.on("close", () => {
      if (!tunnelEstablished) {
        established.reject(new Error("CONNECT socket closed before the tunnel was established"));
      }
    });

    // Buffer raw TCP chunks until the full CONNECT response header arrives, then
    // inspect the status line instead of searching each chunk independently.
    let response = "";
    client.on("data", d => {
      response += d.toString();
      if (!response.includes("\r\n\r\n")) return;
      const statusLine = response.slice(0, response.indexOf("\r\n"));
      if (statusLine.includes(" 200 ")) {
        tunnelEstablished = true;
        established.resolve();
        client!.destroy(); // peer tears down -> the tunnel gets 'end', then 'close' once we end
      } else {
        established.reject(new Error(`unexpected CONNECT response: ${statusLine}`));
      }
    });

    await established.promise;
    await tunnelEnded.promise; // hangs if the peer's FIN never surfaces on the tunnel
    await connectClosed.promise; // hangs if the completed tunnel never emits 'close'
  } finally {
    client?.destroy();
    server.close();
  }
});
