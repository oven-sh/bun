import { afterAll, expect, test } from "bun:test";
import { tls as tlsCerts } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

// NO_PROXY applies to explicit proxies too; an ambient
// NO_PROXY=localhost,127.0.0.1,... would silently bypass the proxy below.
const prevNoProxy = process.env.NO_PROXY;
const prevNoProxyLower = process.env.no_proxy;
process.env.NO_PROXY = "";
process.env.no_proxy = "";
afterAll(() => {
  if (prevNoProxy === undefined) delete process.env.NO_PROXY;
  else process.env.NO_PROXY = prevNoProxy;
  if (prevNoProxyLower === undefined) delete process.env.no_proxy;
  else process.env.no_proxy = prevNoProxyLower;
});

// Regression test for #27433: send_buffer_out() was writing directly to
// this.tcp (detached in proxy tunnel mode) instead of routing through the
// tunnel's TLS layer, so a frame that took the send-buffer path on a wss://
// connection through an HTTP CONNECT proxy never reached the peer. A frame
// takes that path when its encoded size >= STACK_FRAME_SIZE (1024 B); the 2 KB
// payloads below guarantee it on every client send.
test("bidirectional traffic through TLS proxy routes large frames via the tunnel", async () => {
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
        // Server pushes data and pings so traffic is bidirectional.
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
  let proxyConnects = 0;
  const proxy = http.createServer((req, res) => {
    res.writeHead(400);
    res.end();
  });
  proxy.on("connect", (req, clientSocket, head) => {
    proxyConnects++;
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
  // Payloads >= ~1016 bytes skip the inline fast path and go through
  // send_buffer_out(); 2 KB keeps us clearly above that threshold.
  const PADDING = Buffer.alloc(2048, "x").toString();
  const payload = (i: number) => `data:${i}:${PADDING}`;
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
    intervals.push(
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          (ws as any).ping?.();
          ws.send(payload(seq++));
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
    reject(
      new Error(
        `Connection closed (${code}) after ${pongs}/${REQUIRED} pongs, ${echoes.length} echoes, ${pushes} pushes`,
      ),
    );
  });

  try {
    await ready;
    clearIntervals();

    // Guard against a silent proxy bypass (ambient NO_PROXY or a future change
    // that short-circuits loopback targets).
    expect(proxyConnects).toBe(1);
    // Every large frame that round-tripped must carry the exact payload we
    // sent, in order: the tunnel's TLS stream stayed intact.
    expect(echoes.slice(0, REQUIRED)).toEqual(Array.from({ length: REQUIRED }, (_, i) => payload(i)));
    expect(pongs).toBeGreaterThanOrEqual(REQUIRED);
    expect(pushes).toBeGreaterThanOrEqual(REQUIRED);

    ws.close();
    expect(await closed).toBe(1000);
  } finally {
    clearIntervals();
    ws.close();
    proxy.close();
  }
});
