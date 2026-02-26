import { expect, test } from "bun:test";
import { tls as tlsCerts } from "harness";
import http from "node:http";
import net from "node:net";

// Regression test: sendBuffer() was writing directly to this.tcp (which is
// detached in proxy tunnel mode) instead of routing through the tunnel's TLS
// layer. Under bidirectional traffic, backpressure pushes writes through the
// sendBuffer slow path, corrupting the TLS stream and killing the connection
// (close code 1006) within seconds.
test("bidirectional ping/pong through TLS proxy", async () => {
  const intervals: ReturnType<typeof setInterval>[] = [];
  const clearIntervals = () => {
    for (const i of intervals) clearInterval(i);
    intervals.length = 0;
  };

  using server = Bun.serve({
    port: 0,
    tls: { key: tlsCerts.key, cert: tlsCerts.cert },
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Expected WebSocket", { status: 400 });
    },
    websocket: {
      message(ws, msg) {
        ws.send("echo:" + msg);
      },
      open(ws) {
        // Server pings periodically (like session-ingress's 54s interval, sped up)
        intervals.push(
          setInterval(() => {
            if (ws.readyState === 1) ws.ping();
          }, 500),
        );
        // Server pushes data continuously
        intervals.push(
          setInterval(() => {
            if (ws.readyState === 1) ws.send("push:" + Date.now());
          }, 100),
        );
      },
      close() {
        clearIntervals();
      },
    },
  });

  // HTTP CONNECT proxy
  const proxy = http.createServer((req, res) => {
    res.writeHead(400);
    res.end();
  });
  proxy.on("connect", (req, clientSocket, head) => {
    const [host, port] = req.url!.split(":");
    const serverSocket = net.createConnection({ host: host!, port: parseInt(port!) }, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
      if (head.length > 0) serverSocket.write(head);
    });
    serverSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => serverSocket.destroy());
  });

  const { promise: proxyReady, resolve: proxyReadyResolve } = Promise.withResolvers<void>();
  proxy.listen(0, "127.0.0.1", () => proxyReadyResolve());
  await proxyReady;
  const proxyPort = (proxy.address() as net.AddressInfo).port;

  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const ws = new WebSocket(`wss://localhost:${server.port}`, {
    proxy: `http://127.0.0.1:${proxyPort}`,
    tls: { rejectUnauthorized: false },
  } as any);

  const REQUIRED_PONGS = 5;
  let pongReceived = true;
  let closeCode: number | undefined;

  ws.addEventListener("open", () => {
    // Client sends pings (like Claude Code's 10s interval, sped up)
    intervals.push(
      setInterval(() => {
        if (!pongReceived) {
          reject(new Error("Pong timeout - connection dead"));
          return;
        }
        pongReceived = false;
        (ws as any).ping?.();
      }, 400),
    );
    // Client writes data continuously (bidirectional traffic triggers the bug)
    intervals.push(
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("data:" + Date.now());
      }, 50),
    );
  });

  // Resolve as soon as enough pongs arrive (condition-based, not timer-gated)
  let pongCount = 0;
  ws.addEventListener("pong", () => {
    pongCount++;
    pongReceived = true;
    if (pongCount >= REQUIRED_PONGS) resolve();
  });

  ws.addEventListener("close", e => {
    closeCode = (e as CloseEvent).code;
    clearIntervals();
    if (pongCount < REQUIRED_PONGS) {
      reject(new Error(`Connection closed (${closeCode}) after only ${pongCount}/${REQUIRED_PONGS} pongs`));
    }
  });

  try {
    await promise;
    expect(pongCount).toBeGreaterThanOrEqual(REQUIRED_PONGS);
    ws.close();
  } finally {
    clearIntervals();
    proxy.close();
  }
}, 10000);
