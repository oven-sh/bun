// Repro for NewWebSocketClient(false) leak on wss:// through an HTTP CONNECT
// proxy (tunnel mode). initWithTunnel() starts the struct at ref_count=1 (the
// I/O-layer ref, analogous to the adopted-socket ref in the non-tunnel path)
// and then ws.ref() brings it to 2 for C++'s m_connectedWebSocket. Only the
// C++ ref was ever released (dispatchClose / dispatchAbruptClose / finalize);
// nothing dropped the I/O ref because tcp is .detached so handleClose() never
// fires. Every tunnel-mode connection leaked the full WebSocket client struct
// (send/receive FIFOs + deflate state + poll_ref).
//
// The wss:// endpoint and CONNECT proxy run in-process on node:net/tls so
// everything stays single-threaded — using Bun.serve here races the debug
// scoped logger's per-scope mutex against the server's own allocations and
// sporadically deadlocks the fixture.
//
// Runs under BUN_DEBUG_alloc=1 so the test can count
//   new(…NewWebSocketClient(…))   vs   destroy(…NewWebSocketClient(…))
// emitted by `bun.new`/`bun.destroy` on debug builds.
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { tls as tlsCerts } from "../../../harness";

// Minimal wss:// endpoint: completes the RFC 6455 handshake, echoes the
// client's close frame (unmasked) so the clean-close path runs end-to-end,
// and idles otherwise.
const wss = tls.createServer({ cert: tlsCerts.cert, key: tlsCerts.key }, sock => {
  let buf = Buffer.alloc(0);
  let upgraded = false;
  sock.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
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
      upgraded = true;
      buf = buf.subarray(end + 4);
      if (buf.length === 0) return;
    }
    // Upgraded: look for a masked client close frame (FIN + opcode 0x8,
    // mask bit set) and reply with an unmasked server close so the client's
    // sendCloseWithBody → clearData → dispatchClose path runs.
    if (buf.length >= 2 && (buf[0] & 0x0f) === 0x8 && buf[1] & 0x80) {
      const payloadLen = buf[1] & 0x7f;
      if (buf.length >= 2 + 4 + payloadLen) {
        const mask = buf.subarray(2, 6);
        const payload = Buffer.from(buf.subarray(6, 6 + payloadLen));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        const reply = Buffer.alloc(2 + payloadLen);
        reply[0] = 0x88; // FIN + Close
        reply[1] = payloadLen; // no mask from server
        payload.copy(reply, 2);
        sock.write(reply);
        sock.end();
      }
    }
  });
  sock.on("error", () => {});
});
await new Promise<void>(r => wss.listen(0, "127.0.0.1", () => r()));
const wssPort = (wss.address() as net.AddressInfo).port;

// HTTP CONNECT proxy — plain bidirectional tunnel. We also track the client
// sockets so the abrupt-close variant can hard-close them.
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

async function roundTrip(mode: "clean" | "terminate" | "abrupt") {
  const ws = new WebSocket(`wss://127.0.0.1:${wssPort}/`, {
    // @ts-ignore Bun-specific options
    tls: { rejectUnauthorized: false },
    proxy: `http://127.0.0.1:${proxyPort}`,
  });
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  let isOpen = false;
  ws.onopen = () => {
    isOpen = true;
    opened.resolve();
  };
  ws.onclose = ev => {
    if (!isOpen) opened.reject(new Error(`closed before open: ${ev.code} ${ev.reason}`));
    closed.resolve();
  };
  ws.onerror = ev => {
    if (!isOpen) opened.reject(new Error(`error before open: ${(ev as ErrorEvent).message ?? ev.type}`));
  };
  await opened.promise;
  if (mode === "clean") {
    // Client-initiated close → sendCloseWithBody → clearData → dispatchClose.
    ws.close();
    await closed.promise;
  } else if (mode === "terminate") {
    // C++ WebSocket::terminate() → cancel() → clearData. terminate() then
    // sets m_connectedWebSocketKind = None so the destructor's finalize()
    // never runs — cancel() must drop the C++ ref itself. On the unfixed
    // path onclose never fired, so don't block on it here; the alloc-log
    // new/destroy count still proves the leak.
    // @ts-ignore Bun-specific method
    ws.terminate();
    // Tear down the proxy side so the upgrade client's socket ref drops too.
    for (const s of clientSockets.splice(0)) s.destroy();
    closed.promise.catch(() => {});
  } else {
    // Proxy-socket teardown → HTTPClient.handleClose → tunnel.onClose → ws.fail
    // → cancel → clearData.
    for (const s of clientSockets.splice(0)) s.destroy();
    await closed.promise;
  }
}

// Exercise all three close paths; each leaked before the fix.
for (let i = 0; i < 3; i++) await roundTrip("clean");
for (let i = 0; i < 3; i++) await roundTrip("terminate");
for (let i = 0; i < 3; i++) await roundTrip("abrupt");

// dispatchClose/dispatchAbruptClose fire `onclose` from inside the ref-drop
// path; yield so the trailing deref/destroy is emitted before we exit.
await new Promise(r => setImmediate(r));
await new Promise(r => setImmediate(r));

process.exit(0);
