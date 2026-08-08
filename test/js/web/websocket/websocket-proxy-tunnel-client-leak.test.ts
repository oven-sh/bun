import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tls as tlsCerts } from "harness";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

// initWithTunnel() creates the WebSocket client with ref_count=1 (I/O-layer
// ref, analogous to the adopted-socket ref that handleClose() releases in the
// non-tunnel path) and then ws.ref() → 2 for C++'s m_connectedWebSocket. The
// C++ ref is released by dispatchClose/dispatchAbruptClose/finalize, but
// nothing released the I/O ref because tcp is .detached in tunnel mode so
// handleClose() never fires. Every wss://-through-HTTP-proxy connection leaked
// the entire NewWebSocketClient(false) struct.
//
// The assertion counts `[alloc] new(…NewWebSocketClient(…))` vs
// `[alloc] destroy(…NewWebSocketClient(…))` in the alloc debug scope, which
// is only emitted by debug builds.
//
// The wss:// endpoint and CONNECT proxy run in THIS process so the debug
// subprocess only pays for the WebSocket client round-trips (no TLS server
// startup and no harness import inside the BUN_DEBUG_alloc=1 child).
test.skipIf(!isDebug)(
  "wss:// through HTTP proxy does not leak NewWebSocketClient",
  async () => {
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
        // mask bit set) and reply with an unmasked server close so the
        // client's sendCloseWithBody → clearData → dispatchClose path runs.
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

    // HTTP CONNECT proxy: plain bidirectional tunnel. We track the client
    // sockets so the terminate/abrupt variants can hard-close them on IPC
    // signal from the fixture.
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

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "websocket-proxy-tunnel-client-leak-fixture.ts")],
        env: {
          ...bunEnv,
          BUN_DEBUG_alloc: "1",
          WSS_PORT: String(wssPort),
          PROXY_PORT: String(proxyPort),
          // NO_PROXY in CI environments short-circuits the explicit `proxy:`
          // option for 127.0.0.1, so the fixture would bypass tunnel mode.
          NO_PROXY: undefined,
          no_proxy: undefined,
          HTTP_PROXY: undefined,
          HTTPS_PROXY: undefined,
        },
        stderr: "pipe",
        stdout: "pipe",
        ipc(message, child) {
          // Fixture signals after `onopen` when it needs the proxy's client
          // socket(s) torn down (terminate / abrupt close paths). Ack back so
          // the fixture doesn't start the next round-trip until the teardown
          // has actually happened.
          if (message === "destroy-sockets") {
            for (const s of clientSockets.splice(0)) s.destroy();
            child.send("ack");
          }
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Surface fixture errors before the counts so a handshake failure reads
      // as the actual error instead of a confusing {created, destroyed} diff.
      const errOut = (stdout + stderr)
        .split("\n")
        .filter(l => l && !l.startsWith("[alloc] "))
        .join("\n");
      expect(errOut).toBe("");

      // `bun.new`/`bun.destroy` log via Output.scoped(.alloc) in debug builds:
      //   [alloc] new(http.websocket_client.NewWebSocketClient(false)) = …
      //   [alloc] destroy(http.websocket_client.NewWebSocketClient(false)) = …
      // Tunnel mode always uses the non-TLS client (TLS is handled by the
      // tunnel itself), so match the (false) variant explicitly.
      const lines = (stdout + stderr)
        .split("\n")
        .filter(l => l.startsWith("[alloc] ") && l.includes("NewWebSocketClient(false)"));
      const created = lines.filter(l => l.startsWith("[alloc] new(")).length;
      const destroyed = lines.filter(l => l.startsWith("[alloc] destroy(")).length;

      // Pin the exact counts: two round-trips per close path (clean /
      // terminate / abrupt). Must have exercised the tunnel path; guards
      // against NO_PROXY or a fixture regression silently skipping a mode.
      expect({ created, destroyed }).toEqual({ created: 6, destroyed: 6 });
      expect(exitCode).toBe(0);
    } finally {
      proxy.close();
      wss.close();
    }
  },
  30_000,
);
