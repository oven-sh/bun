import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tls as tlsCerts } from "harness";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

// The tunnel-mode success branch in WebSocketUpgradeClient.processResponse()
// took `outgoing_websocket` without releasing the ref that paired with C++'s
// `m_upgradeClient`. didConnectWithTunnel() nulls m_upgradeClient so C++ never
// calls cancel() to drop it; when the socket later closed, handleClose's single
// deref left the struct at refcount 1 forever — one leaked HTTPUpgradeClient
// per wss://-through-HTTP-proxy connection.
//
// The assertion counts `[alloc] new(…NewHTTPUpgradeClient(…))` vs
// `[alloc] destroy(…NewHTTPUpgradeClient(…))` in the alloc debug scope, which
// is only emitted by debug builds (Environment.allow_assert).
//
// The wss:// endpoint and CONNECT proxy run in THIS process so the debug
// subprocess only pays for the WebSocket client round-trips (no TLS server
// startup, no harness import, no scoped-logger lock contention with the
// server thread under BUN_DEBUG_alloc=1).
test.skipIf(!isDebug)(
  "wss:// through HTTP proxy does not leak HTTPUpgradeClient",
  async () => {
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
    // the upgrade client's handleEnd/handleClose path, which is where the
    // leaked ref would otherwise go unreleased.
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
        cmd: [bunExe(), path.join(import.meta.dir, "websocket-proxy-tunnel-upgrade-leak-fixture.ts")],
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
        ipc(message) {
          // Fixture signals once the tunnel-mode upgrade has completed; tear
          // down the proxy's client socket(s) so handleClose runs.
          if (message === "open") for (const s of clientSockets.splice(0)) s.destroy();
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // `bun.new`/`bun.destroy` log via Output.scoped(.alloc) in debug builds:
      //   [alloc] new(http.websocket_client.WebSocketUpgradeClient.NewHTTPUpgradeClient(false)) = …
      //   [alloc] destroy(http.websocket_client.WebSocketUpgradeClient.NewHTTPUpgradeClient(false)) = …
      // Scoped debug output writes to the raw stdout stream, but search both
      // streams in case that ever changes.
      const lines = (stdout + stderr)
        .split("\n")
        .filter(l => l.startsWith("[alloc] ") && l.includes("NewHTTPUpgradeClient"));
      const created = lines.filter(l => l.startsWith("[alloc] new(")).length;
      const destroyed = lines.filter(l => l.startsWith("[alloc] destroy(")).length;

      // Fixture errors surface here first so the diff in a failure is useful.
      const errors = stderr
        .split("\n")
        .filter(l => l && !l.startsWith("[alloc] "))
        .join("\n");
      expect(errors).toBe("");
      // Must have exercised the tunnel path at all — guards against NO_PROXY or
      // a fixture regression silently skipping the scenario.
      expect({ created, destroyed }).toEqual({ created: 2, destroyed: 2 });
      expect(exitCode).toBe(0);
    } finally {
      await new Promise<void>(r => wss.close(() => r()));
      await new Promise<void>(r => proxy.close(() => r()));
    }
  },
  20_000,
);
