import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import net from "net";

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
// any TLS handshake. A minimal mock server refuses SSL ('N') but then
// immediately sends AuthenticationOk + ReadyForQuery so the client reaches
// `.connected`, letting close() -> disconnect() -> GC -> finalize() ->
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
  // 'N' (SSL refused) + AuthenticationOk ('R', len=8, type=0) + ReadyForQuery ('Z', len=5, 'I')
  const handshake = Buffer.from([0x4e, 0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]);

  const server = net.createServer(socket => {
    socket.once("data", () => socket.write(handshake));
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

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
  const server = net.createServer(socket => {
    socket.once("data", () => socket.write("N"));
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

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
