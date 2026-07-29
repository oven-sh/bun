import { expect, test } from "bun:test";
import { tls as tlsCerts } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

// Regression test: sendBuffer() was writing directly to this.tcp (which is
// detached in proxy tunnel mode) instead of routing through the tunnel's TLS
// layer. Under bidirectional traffic, backpressure pushes writes through the
// sendBuffer slow path, corrupting the TLS stream and killing the connection
// (close code 1006) before a single pong arrived.
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
        // Server pushes data and pings continuously so traffic is bidirectional.
        intervals.push(
          setInterval(() => {
            if (ws.readyState === 1) {
              ws.ping();
              ws.send("push");
            }
          }, 20),
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
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const proxyPort = (proxy.address() as net.AddressInfo).port;

  const ws = new WebSocket(`wss://localhost:${server.port}`, {
    proxy: `http://127.0.0.1:${proxyPort}`,
    tls: { rejectUnauthorized: false },
  } as any);

  const REQUIRED = 5;
  const echoes: string[] = [];
  let pushes = 0;
  let pongs = 0;
  let seq = 0;

  const { promise: ready, resolve, reject } = Promise.withResolvers<void>();
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<number>();
  const maybeResolve = () => {
    if (pongs >= REQUIRED && echoes.length >= REQUIRED && pushes >= REQUIRED) resolve();
  };

  ws.addEventListener("open", () => {
    // Client pings and writes data continuously (bidirectional traffic drives
    // writes through the sendBuffer slow path, which is the code under test).
    intervals.push(
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          (ws as any).ping?.();
          ws.send("data:" + seq++);
        }
      }, 20),
    );
  });
  ws.addEventListener("message", e => {
    const data = String(e.data);
    if (data.startsWith("echo:")) echoes.push(data.slice(5));
    else if (data === "push") pushes++;
    maybeResolve();
  });
  ws.addEventListener("pong", () => {
    pongs++;
    maybeResolve();
  });
  ws.addEventListener("error", e => reject((e as ErrorEvent).error ?? new Error("WebSocket error")));
  ws.addEventListener("close", e => {
    const code = (e as CloseEvent).code;
    clearIntervals();
    resolveClosed(code);
    reject(new Error(`Connection closed (${code}) after ${pongs}/${REQUIRED} pongs, ${echoes.length} echoes, ${pushes} pushes`));
  });

  try {
    await ready;
    clearIntervals();

    // Every data frame that round-tripped must carry the exact payload we sent,
    // in order: the tunnel's TLS stream stayed intact under bidirectional load.
    expect(echoes.slice(0, REQUIRED)).toEqual(Array.from({ length: REQUIRED }, (_, i) => `data:${i}`));
    expect(pongs).toBeGreaterThanOrEqual(REQUIRED);
    expect(pushes).toBeGreaterThanOrEqual(REQUIRED);

    ws.close();
    expect(await closed).toBe(1000);
  } finally {
    clearIntervals();
    ws.close();
    proxy.close();
  }
}, 10000);
