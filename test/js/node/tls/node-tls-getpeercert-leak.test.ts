import { expect, it } from "bun:test";
import { once } from "events";
import { readFileSync } from "fs";
import { isASAN, isDebug } from "harness";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { join } from "path";
import tls from "tls";

const clientTls = {
  key: readFileSync(join(import.meta.dir, "fixtures", "ec10-key.pem"), "utf8"),
  cert: readFileSync(join(import.meta.dir, "fixtures", "ec10-cert.pem"), "utf8"),
  ca: readFileSync(join(import.meta.dir, "fixtures", "ca5-cert.pem"), "utf8"),
};
const serverTls = {
  key: readFileSync(join(import.meta.dir, "fixtures", "agent10-key.pem"), "utf8"),
  cert: readFileSync(join(import.meta.dir, "fixtures", "agent10-cert.pem"), "utf8"),
  ca: readFileSync(join(import.meta.dir, "fixtures", "ca2-cert.pem"), "utf8"),
};

it("server-side getPeerCertificate() should not leak", async () => {
  // Guards against the SSL_get_peer_certificate X509 ref leak and the
  // computeRaw BIO leak on the server getPeerCertificate() path.
  const { promise: serverSocketPromise, resolve: onServerSocket } = Promise.withResolvers<TLSSocket>();
  const server = tls.createServer(
    {
      key: serverTls.key,
      cert: serverTls.cert,
      ca: [clientTls.ca],
      requestCert: true,
      rejectUnauthorized: false,
    },
    socket => onServerSocket(socket),
  );
  await once(server.listen(0, "127.0.0.1"), "listening");

  const client = tls.connect({
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    key: clientTls.key,
    cert: clientTls.cert,
    ca: [serverTls.ca],
    checkServerIdentity: () => undefined,
  });
  await once(client, "secureConnect");

  const serverSocket = await serverSocketPromise;
  try {
    // Make sure the client actually sent a cert so we exercise the
    // SSL_get_peer_certificate path rather than falling through to the
    // cert-chain branch.
    const first = serverSocket.getPeerCertificate();
    expect(first).toBeDefined();
    expect(first?.subject).toBeDefined();

    function spin(n: number) {
      for (let i = 0; i < n; i++) {
        serverSocket.getPeerCertificate();
        serverSocket.getPeerCertificate(false);
      }
      Bun.gc(true);
      Bun.gc(true);
    }

    // Run in fixed-size rounds with a GC after each so the steady-state
    // heap footprint stays bounded. The first few rounds grow the heap
    // regardless of leaks, so take the baseline after warmup.
    const perRound = isDebug ? 2_500 : 5_000;
    for (let round = 0; round < 4; round++) spin(perRound);
    const baseline = process.memoryUsage.rss();

    for (let round = 0; round < 10; round++) spin(perRound);
    const after = process.memoryUsage.rss();
    const growth = after - baseline;

    // Unpatched, the BIO leak alone is ~800 bytes/call → ~40MB over the
    // 50k abbreviated calls here (~20MB for 25k in debug). Leave slack for
    // allocator/ASAN noise but stay well below that.
    const threshold = 1024 * 1024 * (isDebug ? 10 : isASAN ? 16 : 12);
    expect(growth).toBeLessThan(threshold);
  } finally {
    client.end();
    serverSocket.end();
    server.close();
  }
}, 180_000);
