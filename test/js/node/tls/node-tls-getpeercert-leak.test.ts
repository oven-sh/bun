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

// Debug builds are ASAN-instrumented; ASAN's default 256MB quarantine retains
// every freed allocation, so RSS grows with total allocation churn regardless
// of leaks and the threshold below cannot distinguish a leak from the
// quarantine. CI's release ASAN lane (isDebug false) still runs.
it.skipIf(isDebug)(
  "server-side getPeerCertificate() should not leak",
  async () => {
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

      // Run in fixed-size rounds with a GC after each so the steady-state heap
      // footprint stays bounded, and track the peak RSS seen across each phase.
      // Since #34181 mimalloc returns freed pages to the OS on a background
      // scavenger thread, so a single post-GC RSS sample can land in a
      // transient scavenger dip; the peak over N rounds is immune to that (the
      // scavenger can only lower RSS), while a real per-call leak still raises
      // the peak every round.
      const perRound = 5_000;
      function spinRounds(rounds: number) {
        let peak = 0;
        for (let round = 0; round < rounds; round++) {
          for (let i = 0; i < perRound; i++) {
            serverSocket.getPeerCertificate();
            serverSocket.getPeerCertificate(false);
          }
          Bun.gc(true);
          Bun.gc(true);
          peak = Math.max(peak, process.memoryUsage.rss());
        }
        return peak;
      }

      // The first few rounds grow the heap regardless of leaks, so take the
      // baseline peak over a warmup phase first.
      const baseline = spinRounds(8);
      const after = spinRounds(15);
      const growth = after - baseline;
      const MB = 1024 * 1024;
      console.log(
        `Peak RSS: warmup ${(baseline / MB) | 0} MB -> measured ${(after / MB) | 0} MB, ` +
          `delta ${(growth / MB) | 0} MB`,
      );

      // Unpatched, the BIO leak alone is ~800 bytes/call; over the 75k
      // abbreviated iterations measured here the peak climbs by ~100MB.
      // With the fix in place the peak is flat within ~3MB across 20 runs,
      // so the threshold sits well above that noise and well below the leak.
      expect(growth).toBeLessThan(MB * (isASAN ? 40 : 32));
    } finally {
      client.end();
      serverSocket.end();
      server.close();
    }
  },
  180_000,
);
