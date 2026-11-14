// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { expectRssDeltaBelow } from "harness";
import { listeningServer, pgAuthenticationOk, pgReadyForQuery, pgSSLResponse } from "./wire-frames";

// PostgresSQLConnection.deinit() must free the per-connection SSL SocketContext
// (tls_ctx). Previously it freed tls_config but leaked tls_ctx, so every
// TLS-enabled Postgres connection that reached deinit() leaked the SSL_CTX
// plus the uSockets context wrapper. In addition, updateHasPendingActivity()
// never dropped to zero for `.failed` connections (and the socket-close path
// overwrites `.disconnected` -> `.failed`), so the JS wrapper was kept alive
// forever and deinit() was never reached — leaking the entire native
// connection (tls_ctx included) on every close.
//
// This test doesn't need a real Postgres server: the tls_ctx is allocated up
// front in PostgresSQLConnection.call() as soon as sslmode != disable, before
// any TLS handshake. A minimal mock server refuses SSL ('N'), then answers the
// plaintext StartupMessage with AuthenticationOk + ReadyForQuery so the client
// reaches `.connected`, letting close() -> disconnect() -> GC -> finalize() ->
// deinit() exercise the teardown path.

async function countPostgresConnectionsAfterGC(maxWait = 3000): Promise<number> {
  Bun.gc(true);
  let count = heapStats().objectTypeCounts["PostgresSQLConnection"] || 0;
  // Use wall-clock time — Bun.gc(true) under ASAN can take >100ms per call,
  // so a fixed-iteration loop would wildly overshoot maxWait.
  const deadline = performance.now() + maxWait;
  while (count > 2 && performance.now() < deadline) {
    await Bun.sleep(20);
    Bun.gc(true);
    count = heapStats().objectTypeCounts["PostgresSQLConnection"] || 0;
  }
  return count;
}

test("Postgres connections with sslmode != disable are finalized after close", async () => {
  const { server, port } = await listeningServer(socket => {
    socket.once("data", () => {
      socket.write(pgSSLResponse("N"));
      socket.once("data", () => socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery("I")])));
    });
    socket.on("error", () => {});
  });

  try {
    async function once() {
      const sql = new SQL({
        url: `postgres://u@127.0.0.1:${port}/db?sslmode=prefer`,
        max: 1,
        idleTimeout: 0,
        connectionTimeout: 5,
      });
      try {
        await sql.connect();
      } catch {}
      await sql.close({ timeout: 0 }).catch(() => {});
    }

    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      await once();
    }

    // Without the fix, hasPendingActivity stays true for every closed
    // connection and none of the PostgresSQLConnection wrappers are ever
    // collected, so objectTypeCounts["PostgresSQLConnection"] stays at
    // `iterations` (plus any baseline). With the fix they are all finalized
    // and the count drops to at most a couple still pending finalization.
    const remaining = await countPostgresConnectionsAfterGC();
    expect(remaining).toBeLessThanOrEqual(2);
  } finally {
    server.close();
  }
}, 60_000);

// Same scenario but with the server refusing SSL while the client requires it,
// so the connection fails before ever reaching `.connected`. Previously these
// failed connections also stayed alive forever via hasPendingActivity.
test("Postgres connections that fail TLS negotiation are finalized", async () => {
  const { server, port } = await listeningServer(socket => {
    socket.once("data", () => socket.write(pgSSLResponse("N")));
    socket.on("error", () => {});
  });

  try {
    async function once() {
      const sql = new SQL({
        url: `postgres://u@127.0.0.1:${port}/db?sslmode=require`,
        tls: true,
        max: 1,
        idleTimeout: 0,
        connectionTimeout: 5,
      });
      try {
        await sql`select 1`;
      } catch {}
      await sql.close({ timeout: 0 }).catch(() => {});
    }

    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      await once();
    }

    const remaining = await countPostgresConnectionsAfterGC();
    expect(remaining).toBeLessThanOrEqual(2);
  } finally {
    server.close();
  }
}, 60_000);

// Every connection kept its own copy of the parsed `tls` options, `ca` included, until the GC
// finalized it. The connections stay pending here (the server never answers the SSLRequest), so
// what they hold is measured while they are alive.
test("Postgres connections do not keep their own copy of the tls options", async () => {
  await expectRssDeltaBelow(
    [
      "-e",
      `
      import { SQL } from "bun";
      import { rootCertificates } from "node:tls";

      // About 700 KB of PEM text.
      const ca = Array.from({ length: 4 }, () => rootCertificates).flat();
      let requests = 0;
      let onRequest = () => {};
      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { data() { requests++; onRequest(); } },
      });
      const requested = n => new Promise(resolve => {
        onRequest = () => requests >= n && resolve();
        onRequest();
      });
      const connect = () => {
        const sql = new SQL({ url: "postgres://u@127.0.0.1:" + server.port + "/db", tls: { ca }, max: 1, connectionTimeout: 60 });
        sql\`select 1\`.catch(() => {});
        return sql;
      };

      // The first connection builds the SSL_CTX that the others share.
      const clients = [connect()];
      await requested(1);
      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();
      for (let i = 0; i < 32; i++) clients.push(connect());
      await requested(33);
      const deltaMiB = (process.memoryUsage.rss() - rssBefore) / 1024 / 1024;
      for (const sql of clients) sql.close({ timeout: 0 }).catch(() => {});
      server.stop(true);
      console.log(JSON.stringify({ deltaMiB }));
      process.exit(0);
      `,
    ],
    { release: 10, debug: 12 },
  );
}, 60_000);
