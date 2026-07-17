// Fixture for proxy.test.ts: fetch through a CONNECT proxy to an HTTPS
// backend where the proxy tears down the outer connection immediately
// after relaying the inner TLS server-handshake flight. The client's
// SSLWrapper completes the inner handshake from buffered bytes and reaches
// on_writable → ProxyHeaders while the outer socket is (or is about to be)
// dead. Previously a debug_assert!(!socket.is_shutdown()/is_closed()) fired
// here (Sentry BUN-2V7Z); now the request fails with a connection error.
//
// Usage: bun proxy-handshake-closed-socket-fixture.ts <"http"|"https"> [iterations]
// Prints one line per iteration: "rejected: <code>" on clean failure.

import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import { tls as tlsCert } from "harness";

const proxyScheme = process.argv[2] === "https" ? "https" : "http";
const iterations = Number(process.argv[3] ?? "20");

// HTTPS backend that completes the TLS handshake but never replies at the
// HTTP layer — the proxy severs the client before any request arrives.
const backend = tls.createServer({ ...tlsCert }, sock => {
  sock.on("error", () => {});
});
backend.listen(0, "127.0.0.1");
await once(backend, "listening");
const backendPort = (backend.address() as net.AddressInfo).port;

function handleClient(client: net.Socket) {
  client.on("error", () => {});
  let upstream: net.Socket | null = null;
  let head = Buffer.alloc(0);

  function killClient() {
    upstream?.destroy();
    try {
      // RST the underlying TCP so the client's next write on the outer
      // socket fails instead of being buffered by the kernel.
      const raw: net.Socket = (client as any)._parent ?? (client as any).socket ?? client;
      if (typeof raw.resetAndDestroy === "function") raw.resetAndDestroy();
      else client.destroy();
    } catch {
      client.destroy();
    }
  }

  client.on("data", chunk => {
    if (!upstream) {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      const leftover = head.subarray(end + 4);
      upstream = net.connect(backendPort, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (leftover.length) upstream!.write(leftover);
      });
      upstream.on("error", () => {});
      // When the backend's ServerHello/Cert/Finished flight arrives, relay
      // it to the client and immediately reset the outer connection. The
      // client completes the inner handshake from these bytes and tries to
      // write the HTTP request into a socket whose TCP peer is gone.
      upstream.on("data", data => {
        client.write(data, () => killClient());
      });
      upstream.on("close", () => client.destroy());
      return;
    }
    upstream.write(chunk);
  });
  client.on("close", () => upstream?.destroy());
}

let proxy: net.Server | tls.Server;
if (proxyScheme === "https") {
  proxy = tls.createServer({ ...tlsCert }, handleClient);
} else {
  proxy = net.createServer(handleClient);
}
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const proxyPort = (proxy.address() as net.AddressInfo).port;

let hung = 0;
for (let i = 0; i < iterations; i++) {
  try {
    const res = await fetch(`https://localhost:${backendPort}/`, {
      proxy: `${proxyScheme}://localhost:${proxyPort}`,
      keepalive: false,
      tls: { ca: tlsCert.cert, rejectUnauthorized: false },
      signal: AbortSignal.timeout(5000),
    });
    console.log(`resolved: ${res.status}`);
  } catch (e: any) {
    const code = typeof e?.code === "string" ? e.code : (e?.name ?? String(e));
    if (code === "TimeoutError" || e?.name === "TimeoutError") hung++;
    console.log(`rejected: ${code}`);
  }
}

proxy.close();
backend.close();
if (hung > 0) {
  console.error(`${hung} request(s) hung until AbortSignal timeout`);
}
process.exit(0);
