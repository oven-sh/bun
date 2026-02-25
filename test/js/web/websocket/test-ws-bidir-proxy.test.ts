import { test } from "bun:test";
import { tls as tlsCerts } from "harness";
import http from "node:http";
import net from "node:net";

test("bidirectional ping/pong through TLS proxy", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = Bun.serve({
    port: 0,
    tls: { key: tlsCerts.key, cert: tlsCerts.cert },
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("no", { status: 400 });
    },
    websocket: {
      message(ws, msg) {
        ws.send("echo:" + msg);
      },
      open(ws) {
        // Server pings every 500ms (like tunnel client's 54s interval, sped up)
        const pingTimer = setInterval(() => {
          if (ws.readyState === 1) ws.ping();
          else clearInterval(pingTimer);
        }, 500);
        // Server pushes data continuously
        const dataTimer = setInterval(() => {
          if (ws.readyState === 1) ws.send("push:" + Date.now());
          else clearInterval(dataTimer);
        }, 100);
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
  });
  const { promise: proxyReady, resolve: proxyReadyResolve } = Promise.withResolvers<void>();
  proxy.listen(0, "127.0.0.1", () => proxyReadyResolve());
  await proxyReady;
  const proxyPort = (proxy.address() as any).port;

  const ws = new WebSocket(`wss://localhost:${server.port}`, {
    proxy: `http://127.0.0.1:${proxyPort}`,
    tls: { rejectUnauthorized: false },
  } as any);

  let clientPongCount = 0;
  let messageCount = 0;
  let clientPongReceived = true;
  let clientPingInterval: ReturnType<typeof setInterval>;

  ws.addEventListener("open", () => {
    // Client sends pings (like Claude Code's 10s interval, sped up)
    clientPingInterval = setInterval(() => {
      if (!clientPongReceived) {
        console.log(`FAIL: No pong after ${clientPongCount} pongs, ${messageCount} msgs`);
        clearInterval(clientPingInterval);
        reject(new Error("Pong timeout"));
        return;
      }
      clientPongReceived = false;
      (ws as any).ping?.();
    }, 500);
    // Client writes data (bidirectional traffic)
    const writeInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("data:" + Date.now());
      else clearInterval(writeInterval);
    }, 50);
  });

  ws.addEventListener("pong", () => {
    clientPongCount++;
    clientPongReceived = true;
  });
  ws.addEventListener("message", () => {
    messageCount++;
  });
  ws.addEventListener("close", e => {
    console.log(`close: ${(e as CloseEvent).code}, pongs: ${clientPongCount}, msgs: ${messageCount}`);
    clearInterval(clientPingInterval);
  });

  setTimeout(() => {
    console.log(`DONE: pongs=${clientPongCount}, msgs=${messageCount}`);
    if (clientPongCount >= 5) resolve();
    else reject(new Error(`Only ${clientPongCount} pongs in 5s`));
  }, 5000);

  await promise;
  ws.close();
  server.stop();
  proxy.close();
}, 10000);
