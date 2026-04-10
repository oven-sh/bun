// Repro for double-free when ws.close() is called on a wss:// WebSocket
// connecting through an HTTP CONNECT proxy while the inner TLS handshake is
// in flight. Before the fix, clearData() re-entered via the tunnel's SSLWrapper
// shutdown callbacks and freed WebSocketProxy.target_host twice, corrupting the
// mimalloc freelist and crashing shortly after in an unrelated allocation.
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { tls as tlsCerts } from "../../../harness";

const wss = Bun.serve({
  port: 0,
  tls: { cert: tlsCerts.cert, key: tlsCerts.key },
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("ok");
  },
  websocket: { open() {}, message() {}, close() {} },
});

const proxy = http.createServer((req, res) => {
  res.writeHead(400);
  res.end();
});
proxy.on("connect", (req, clientSocket, head) => {
  const serverSocket = net.createConnection({ host: "127.0.0.1", port: wss.port }, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) serverSocket.write(head);
    clientSocket.pipe(serverSocket);
    serverSocket.pipe(clientSocket);
  });
  serverSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => serverSocket.destroy());
  clientSocket.on("close", () => serverSocket.destroy());
});
await new Promise<void>(r => proxy.listen(0, "127.0.0.1", () => r()));
const proxyPort = (proxy.address() as net.AddressInfo).port;

for (let round = 0; round < 10; round++) {
  for (let k = 0; k < 8; k++) {
    const ws = new WebSocket(`wss://localhost:${wss.port}/`, {
      // @ts-ignore
      tls: { rejectUnauthorized: false },
      proxy: `http://127.0.0.1:${proxyPort}`,
    });
    ws.onerror = () => {};
    ws.onclose = () => {};
    ws.onopen = () => ws.close();
    // Stagger close() across the CONNECT → TLS handshake window.
    const delay = ((round * 8 + k) * 7919) % 50;
    setTimeout(() => {
      try {
        ws.close();
      } catch {}
    }, delay);
  }
  await new Promise(r => setTimeout(r, 20));
}

// Let in-flight close timers fire before exiting.
await new Promise(r => setTimeout(r, 100));

// Allocate to surface any latent freelist corruption.
for (let i = 0; i < 2000; i++) path.normalize("/a/b/../c/./d/" + i);

process.exit(0);
