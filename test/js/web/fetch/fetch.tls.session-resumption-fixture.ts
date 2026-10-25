// Observes server-side `isSessionReused()` across two sequential fetch()
// requests that each answer with `Connection: close`, so the second cannot
// reuse a keep-alive socket and must open a fresh TLS connection. A second
// value of `true` means fetch offered a cached session via SSL_set_session.
//
// argv[2]: "TLSv1.2" | "TLSv1.3" — pins both ends so the 1.2 and 1.3 ticket
// delivery paths (inside SSL_do_handshake vs post-handshake) are both covered.
//
// All scenarios run in one process; each uses its own server (fresh port), so
// the per-`(hostname, port, hash)` cache key keeps them isolated.
import tls from "node:tls";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tls as cert } from "harness";

const version = (process.argv[2] ?? "TLSv1.3") as tls.SecureVersion;

function makeServer(unixPath?: string) {
  const reused: boolean[] = [];
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
    if (socket.getProtocol() !== version) {
      process.stderr.write(`negotiated ${socket.getProtocol()}, expected ${version}\n`);
      process.exit(1);
    }
    socket.on("error", () => {});
    socket.once("data", () => {
      socket.end("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok");
    });
  });
  server.on("tlsClientError", () => {});
  const listening = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    if (unixPath) server.listen(unixPath, () => resolve(0));
    else server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
  const close = () => {
    for (const c of connections) c.destroy();
    server.close();
  };
  return { reused, listening, close };
}

const ca = { ca: cert.cert } as const;
async function ok(res: Response) {
  if ((await res.text()) !== "ok") throw new Error("bad body");
}

const out: Record<string, unknown> = {};

// default: second connect resumes.
{
  const a = makeServer();
  const url = `https://localhost:${await a.listening}/`;
  await ok(await fetch(url, { tls: ca }));
  await ok(await fetch(url, { tls: ca }));
  out.default = a.reused;
  a.close();
}

// mismatch: trusted chain, wrong SAN. Both fetches fail
// ERR_TLS_CERT_ALTNAME_INVALID (proving each ran a real handshake) and no
// resumption is observed. A TLS 1.3 client may RST before the server
// completes its side, so `reused` can have fewer than two entries.
{
  const a = makeServer();
  const url = `https://localhost:${await a.listening}/`;
  const bad = { ca: cert.cert, serverName: "wrong.example" } as const;
  for (let i = 0; i < 2; i++) {
    try {
      await fetch(url, { tls: bad });
      throw new Error(`mismatch fetch ${i} resolved; expected ERR_TLS_CERT_ALTNAME_INVALID`);
    } catch (e: any) {
      if (e?.code !== "ERR_TLS_CERT_ALTNAME_INVALID") throw e;
    }
  }
  out.mismatch = a.reused;
  a.close();
}

// check-server-identity: a JS checkServerIdentity callback bypasses the cache
// (verification completes off-thread after on_handshake). The first fetch
// succeeds but never installs a sink, so the second sees an empty cache.
{
  const a = makeServer();
  const url = `https://localhost:${await a.listening}/`;
  let callbackRan = false;
  await ok(
    await fetch(url, {
      tls: {
        ca: cert.cert,
        checkServerIdentity: (host: string, peer: tls.PeerCertificate) => {
          callbackRan = true;
          return tls.checkServerIdentity(host, peer);
        },
      },
    }),
  );
  if (!callbackRan) throw new Error("checkServerIdentity callback did not run");
  await ok(await fetch(url, { tls: ca }));
  out.checkServerIdentity = a.reused;
  a.close();
}

// port-isolation: same hostname + SSLConfig, different port — the cache key
// includes the port, so A's ticket must never be offered to B.
{
  const a = makeServer();
  const b = makeServer();
  await ok(await fetch(`https://localhost:${await a.listening}/`, { tls: ca }));
  await ok(await fetch(`https://localhost:${await b.listening}/`, { tls: ca }));
  out.portIsolation = { a: a.reused, b: b.reused };
  a.close();
  b.close();
}

// host-isolation: same port + SSLConfig, different connect hostname
// (127.0.0.1 vs localhost) — the cache key includes the hostname.
{
  const a = makeServer();
  const port = await a.listening;
  await ok(await fetch(`https://localhost:${port}/`, { tls: ca }));
  await ok(await fetch(`https://127.0.0.1:${port}/`, { tls: ca }));
  out.hostIsolation = a.reused;
  a.close();
}

// unix: a second fresh connect over the same socket path resumes.
if (process.platform !== "win32") {
  const dir = mkdtempSync(join(tmpdir(), "fetch-tls-resume-unix-"));
  const a = makeServer(join(dir, "a.sock"));
  await a.listening;
  await ok(await fetch("https://localhost/", { unix: join(dir, "a.sock"), tls: ca }));
  await ok(await fetch("https://localhost/", { unix: join(dir, "a.sock"), tls: ca }));
  out.unix = a.reused;
  a.close();

  // unix-path-isolation: same URL, different socket path — the cache key
  // includes the path, so A's ticket must never be offered to B.
  const b = makeServer(join(dir, "b.sock"));
  const c = makeServer(join(dir, "c.sock"));
  await Promise.all([b.listening, c.listening]);
  await ok(await fetch("https://localhost/", { unix: join(dir, "b.sock"), tls: ca }));
  await ok(await fetch("https://localhost/", { unix: join(dir, "c.sock"), tls: ca }));
  out.unixPathIsolation = { b: b.reused, c: c.reused };
  b.close();
  c.close();
}

console.log(JSON.stringify(out));
