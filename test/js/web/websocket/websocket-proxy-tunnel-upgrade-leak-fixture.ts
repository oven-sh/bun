// Repro for HTTPUpgradeClient leak on wss:// through an HTTP CONNECT proxy
// (tunnel mode). The tunnel-mode success branch in processResponse() took
// `outgoing_websocket` without releasing the ref that paired with C++'s
// `m_upgradeClient`. C++ nulls `m_upgradeClient` inside didConnectWithTunnel()
// and therefore never calls cancel() to drop it, so when the socket finally
// closed, handleClose's single deref left the struct at refcount 1 forever.
//
// The wss:// endpoint and the CONNECT proxy are both node:net/tls-based so
// everything stays on the JS thread — using Bun.serve here races the debug
// scoped logger's per-scope mutex against the server's own allocations and
// sporadically deadlocks the fixture (unrelated to the leak under test).
//
// Runs under BUN_DEBUG_alloc=1 so the test can count
//   new(…NewHTTPUpgradeClient(…))   vs   destroy(…NewHTTPUpgradeClient(…))
// emitted by `bun.new`/`bun.destroy` on debug builds.
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { tls as tlsCerts } from "../../../harness";

// Minimal wss:// endpoint: completes the RFC 6455 handshake and then idles.
// The proxy force-closes the client socket right after `onopen`, so no
// data frames are needed.
const wss = tls.createServer({ cert: tlsCerts.cert, key: tlsCerts.key }, sock => {
  let buf = Buffer.alloc(0);
  sock.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf("\r\n\r\n");
    if (end === -1) return;
    const head = buf.subarray(0, end).toString("latin1");
    const m = /Sec-WebSocket-Key:\s*([A-Za-z0-9+/=]+)/i.exec(head);
    if (!m) {
      sock.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(m[1] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        "\r\n",
    );
    sock.removeAllListeners("data");
    sock.on("data", () => {});
  });
  sock.on("error", () => {});
});
await new Promise<void>(r => wss.listen(0, "127.0.0.1", () => r()));
const wssPort = (wss.address() as net.AddressInfo).port;

// HTTP CONNECT proxy that holds onto the client sockets so we can
// hard-close them once the WebSocket upgrade has completed — that drives
// the upgrade client's handleEnd/handleClose path, which is where the leaked
// ref would otherwise go unreleased.
const clientSockets: net.Socket[] = [];
const proxy = net.createServer(clientSocket => {
  clientSockets.push(clientSocket);
  let buf = Buffer.alloc(0);
  let serverSocket: net.Socket | null = null;
  clientSocket.on("data", chunk => {
    if (serverSocket) {
      serverSocket.write(chunk);
      return;
    }
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf("\r\n\r\n");
    if (end === -1) return;
    const m = /^CONNECT\s+([^:]+):(\d+)\s+HTTP/.exec(buf.toString("latin1"));
    if (!m) {
      clientSocket.destroy();
      return;
    }
    const rest = buf.subarray(end + 4);
    serverSocket = net.createConnection({ host: m[1], port: Number(m[2]) }, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (rest.length) serverSocket!.write(rest);
      serverSocket!.on("data", d => clientSocket.write(d));
    });
    serverSocket.on("error", () => clientSocket.destroy());
    serverSocket.on("close", () => clientSocket.destroy());
    clientSocket.on("close", () => serverSocket?.destroy());
  });
  clientSocket.on("error", () => serverSocket?.destroy());
});
await new Promise<void>(r => proxy.listen(0, "127.0.0.1", () => r()));
const proxyPort = (proxy.address() as net.AddressInfo).port;

async function roundTrip() {
  const ws = new WebSocket(`wss://127.0.0.1:${wssPort}/`, {
    // @ts-ignore Bun-specific options
    tls: { rejectUnauthorized: false },
    proxy: `http://127.0.0.1:${proxyPort}`,
  });
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  ws.onopen = () => opened.resolve();
  ws.onclose = () => closed.resolve();
  // Errors are expected once we hard-close the proxy socket; onclose still fires.
  ws.onerror = () => {};
  await opened.promise;
  // Tunnel-mode upgrade has completed (state == .done). Tear down the proxy
  // connection so handleEnd/handleClose run on the upgrade client.
  for (const s of clientSockets.splice(0)) s.destroy();
  await closed.promise;
}

for (let i = 0; i < 3; i++) {
  await roundTrip();
}

// JS `onclose` fires from inside the upgrade client's handleClose(), before
// that function's trailing deref runs. Yield to the event loop so the final
// destroy is emitted before we exit.
await new Promise(r => setImmediate(r));
await new Promise(r => setImmediate(r));

process.exit(0);
