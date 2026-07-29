// Sentry BUN-3KKD / BUN-3GMS: segfault in us_internal_ssl_close when a
// Postgres TLS connection's refAndClose re-enters via the on_handshake /
// on_close callbacks that a TLS close dispatches synchronously.
//
// Closing a Connected TLS connection goes through disconnect() which sets
// status = Disconnected (not Failed), so fail_with_js_value's status == Failed
// guard does not trip when on_close re-enters, and a nested ref_and_close runs
// on the same us_socket_t. On the reported platform the on_handshake dispatch
// (which runs before the C layer flips is_closed) lets the nested close reach
// us_internal_ssl_close on a socket that is already being torn down.
//
// These tests exercise both re-entry shapes under ASAN without needing a live
// Postgres server: a mock server that speaks just enough of the protocol to
// drive the client through TLS upgrade and (for the disconnect path) into the
// Connected state.

import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

const certDir = path.join(import.meta.dir, "docker-tls");
const cert = fs.readFileSync(path.join(certDir, "server.crt"));
const key = fs.readFileSync(path.join(certDir, "server.key"));

// 'R' AuthenticationOk (len=8, type=0) + 'Z' ReadyForQuery (len=5, 'I')
const readyHandshake = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]);

function mockPostgresTLSServer(afterUpgrade: (s: tls.TLSSocket) => void) {
  const secureContext = tls.createSecureContext({ cert, key });
  const server = net.createServer(raw => {
    raw.once("data", () => {
      // Reply 'S' to the 8-byte SSLRequest, then upgrade the raw socket.
      raw.write("S", () => {
        const s = new tls.TLSSocket(raw, { isServer: true, secureContext });
        s.on("error", () => {});
        afterUpgrade(s);
      });
    });
    raw.on("error", () => {});
  });
  return server;
}

async function listen(server: net.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
}

async function remainingConnectionsAfterGC(maxWait = 5000): Promise<number> {
  Bun.gc(true);
  let count = heapStats().objectTypeCounts["PostgresSQLConnection"] || 0;
  const deadline = performance.now() + maxWait;
  while (count > 2 && performance.now() < deadline) {
    await Bun.sleep(20);
    Bun.gc(true);
    count = heapStats().objectTypeCounts["PostgresSQLConnection"] || 0;
  }
  return count;
}

// disconnect() path: the connection reaches Connected over TLS, then close()
// tears it down. on_close re-enters fail_with_js_value with status ==
// Disconnected, which proceeds to a nested ref_and_close.
test("Postgres TLS connection close() after Connected survives re-entrant on_close", async () => {
  const server = mockPostgresTLSServer(s => {
    s.once("data", () => s.write(readyHandshake));
  });
  const port = await listen(server);

  try {
    const iterations = 15;
    let closes = 0;
    for (let i = 0; i < iterations; i++) {
      const sql = new SQL({
        url: `postgres://u@127.0.0.1:${port}/db?sslmode=require`,
        tls: { rejectUnauthorized: false },
        max: 1,
        connectionTimeout: 10,
        idleTimeout: 0,
        onclose: () => void closes++,
      });
      await sql.connect();
      await sql.close({ timeout: 0 }).catch(() => {});
      Bun.gc(true);
    }
    // Every connection that reached Connected must have fired onclose exactly
    // once on the way down; the nested ref_and_close must not have produced a
    // second onclose or left the wrapper uncollectable.
    expect(closes).toBe(iterations);
    expect(await remainingConnectionsAfterGC()).toBeLessThanOrEqual(2);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

// Timer path: the TLS handshake never completes, so connectionTimeout fires
// with status == SentStartupMessage. ref_and_close → socket.close() dispatches
// on_handshake(0, ECONNRESET) and then on_close synchronously; both re-enter
// fail_with_js_value.
test("Postgres TLS connectionTimeout during pending handshake survives re-entrant on_handshake/on_close", async () => {
  // Server accepts the SSLRequest and replies 'S', then swallows the TLS
  // ClientHello so the handshake never completes.
  const server = net.createServer(raw => {
    raw.once("data", () => raw.write("S"));
    raw.on("data", () => {});
    raw.on("error", () => {});
  });
  const port = await listen(server);

  try {
    const iterations = 3;
    const seen: string[] = [];
    for (let i = 0; i < iterations; i++) {
      const sql = new SQL({
        url: `postgres://u@127.0.0.1:${port}/db?sslmode=require`,
        tls: { rejectUnauthorized: false },
        max: 1,
        connectionTimeout: 1,
        idleTimeout: 0,
      });
      const err = await sql`select 1`.catch(e => e);
      seen.push(err?.code);
      await sql.close({ timeout: 0 }).catch(() => {});
      Bun.gc(true);
    }
    // Every attempt must surface the connection-timeout error (not a crash,
    // not a generic ConnectionClosed from the re-entrant path swallowing it).
    expect(seen).toEqual(Array(iterations).fill("ERR_POSTGRES_CONNECTION_TIMEOUT"));
    expect(await remainingConnectionsAfterGC()).toBeLessThanOrEqual(2);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
