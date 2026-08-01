// Drives two sequential fetch() requests against a local node:tls server that
// answers with `Connection: close`, so the second request cannot reuse a
// keep-alive socket and must open a fresh TLS connection. The server records
// `isSessionReused()` per connection; the second value is true only when fetch
// offered a cached session via SSL_set_session.
//
// argv[2]: "TLSv1.2" | "TLSv1.3" — pins both ends so the 1.2 and 1.3 ticket
// delivery paths (inside SSL_do_handshake vs post-handshake) are both covered.
//
// argv[3] == "mismatch" overrides the TLS servername to one the cert's SAN
// does not cover. Both fetches must fail ERR_TLS_CERT_ALTNAME_INVALID (proving
// each ran a real handshake against the cert) and the server must never
// observe a resumed handshake. The client may RST before the server's TLS 1.3
// handshake completes, so `reused` can have fewer than two entries there.
import tls from "node:tls";
import type { AddressInfo } from "node:net";
import { tls as cert } from "harness";

const version = (process.argv[2] ?? "TLSv1.3") as tls.SecureVersion;
const mode = process.argv[3] ?? "default";

const reused: boolean[] = [];
const versions: string[] = [];
const connections: tls.TLSSocket[] = [];

const server = tls.createServer({
  key: cert.key,
  cert: cert.cert,
  minVersion: version,
  maxVersion: version,
});
server.on("secureConnection", (socket: tls.TLSSocket) => {
  connections.push(socket);
  reused.push(socket.isSessionReused());
  versions.push(socket.getProtocol() ?? "");
  socket.on("error", () => {});
  socket.once("data", () => {
    socket.end("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok");
  });
});
server.on("tlsClientError", () => {});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = (server.address() as AddressInfo).port;
const url = `https://localhost:${port}/`;
const tlsOpts =
  mode === "mismatch"
    ? ({ ca: cert.cert, serverName: "wrong.example" } as const)
    : ({ ca: cert.cert } as const);

async function attempt(n: number) {
  if (mode === "mismatch") {
    try {
      await fetch(url, { tls: tlsOpts });
      throw new Error(`fetch ${n} resolved; expected ERR_TLS_CERT_ALTNAME_INVALID`);
    } catch (e: any) {
      if (e?.code !== "ERR_TLS_CERT_ALTNAME_INVALID") throw e;
    }
  } else {
    const res = await fetch(url, { tls: tlsOpts });
    if ((await res.text()) !== "ok") throw new Error(`bad body ${n}`);
  }
}

await attempt(1);
await attempt(2);

if (versions.some(v => v !== version)) {
  throw new Error(`negotiated ${JSON.stringify(versions)}, expected ${version}`);
}
console.log(JSON.stringify(reused));

for (const c of connections) c.destroy();
server.close();
