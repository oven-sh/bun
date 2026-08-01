// Drives two sequential fetch() requests against a local node:tls server that
// answers with `Connection: close`, so the second request cannot reuse a
// keep-alive socket and must open a fresh TLS connection. The server records
// `isSessionReused()` on each secure connection; the second value is true only
// when fetch offered a cached session via SSL_set_session.
import tls from "node:tls";
import type { AddressInfo } from "node:net";
import { tls as cert } from "harness";

const reused: boolean[] = [];
const connections: tls.TLSSocket[] = [];

const server = tls.createServer({ key: cert.key, cert: cert.cert });
server.on("secureConnection", (socket: tls.TLSSocket) => {
  connections.push(socket);
  reused.push(socket.isSessionReused());
  socket.once("data", () => {
    socket.end("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok");
  });
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = (server.address() as AddressInfo).port;
const url = `https://localhost:${port}/`;
const tlsOpts = { ca: cert.cert } as const;

const res1 = await fetch(url, { tls: tlsOpts });
if ((await res1.text()) !== "ok") throw new Error("bad body 1");

const res2 = await fetch(url, { tls: tlsOpts });
if ((await res2.text()) !== "ok") throw new Error("bad body 2");

console.log(JSON.stringify(reused));

for (const c of connections) c.destroy();
server.close();
