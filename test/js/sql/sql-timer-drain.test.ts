import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgRaw,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// Regression test for #30646. Before the fix, idle_timeout / max_lifetime fired
// `failFmt(...)` unconditionally and rejected any in-flight query with
// ERR_POSTGRES_IDLE_TIMEOUT / ERR_POSTGRES_LIFETIME_TIMEOUT — even though the
// query itself was healthy. After the fix:
//
//   - The Postgres idle timer doesn't arm while a query is outstanding (a
//     queued request or `is_ready_for_query == false` drops it).
//   - When max_lifetime fires on a busy connection it reschedules for 1s and
//     retries until the connection is idle, then disconnects gracefully.
//
// The mock server exposes deterministic timing: respond to SELECT only after a
// configurable delay, so we can prove queries complete even when the client-
// side timer interval is much shorter than the server response.

// Startup-phase handshake (no SSL): AuthenticationOk + ReadyForQuery(idle).
const HANDSHAKE = Buffer.concat([pgAuthenticationOk(), pgReadyForQuery("I")]);

// Full response to Bun's extended-query `Parse+Describe+Bind+Execute+Flush+Sync`
// batch for `SELECT 42 as x`: ParseComplete + ParameterDescription (0 params) +
// RowDescription + BindComplete + DataRow + CommandComplete + ReadyForQuery.
// Column type 23 = int4.
const QUERY_RESPONSE = Buffer.concat([
  pgRaw("1", Buffer.alloc(0)), // ParseComplete
  pgRaw("t", Buffer.from([0, 0])), // ParameterDescription, 0 params
  pgRowDescription([{ name: "x", typeOid: 23, typeSize: 4 }]),
  pgRaw("2", Buffer.alloc(0)), // BindComplete
  pgDataRow([Buffer.from("42")]),
  pgCommandComplete("SELECT 1"),
  pgReadyForQuery("I"),
]);

/**
 * Mock Postgres server: on the startup packet, reply with the handshake; on a
 * client query batch, wait `queryDelayMs` then send the minimal result. Buffers
 * inbound bytes and responds once per `Sync`/`Simple Query` so TCP chunking
 * can't produce duplicate responses. `onClose` observes the server-side socket
 * close.
 */
async function startMockServer(
  queryDelayMs: number,
  onClose?: () => void,
): Promise<{ port: number; stop: () => void }> {
  const timers = new Set<Timer>();
  const { port, server } = await listeningServer(socket => {
    // 'startup' -> reply HANDSHAKE to any first packet;
    // 'query' -> parse length-prefixed messages, respond on Sync/Simple Query.
    let state: "startup" | "query" = "startup";
    let buf: Buffer = Buffer.alloc(0);
    socket.on("data", chunk => {
      if (state === "startup") {
        state = "query";
        socket.write(HANDSHAKE);
        return;
      }
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      // Message format: type(1) + length(4 BE, includes the length field).
      while (buf.length >= 5) {
        const len = buf.readInt32BE(1);
        const total = 1 + len;
        if (buf.length < total) break;
        const type = buf[0];
        buf = buf.subarray(total);
        if (type === 0x53 /* 'S' Sync */ || type === 0x51 /* 'Q' Simple Query */) {
          const t = setTimeout(() => {
            timers.delete(t);
            if (!socket.destroyed) socket.write(QUERY_RESPONSE);
          }, queryDelayMs);
          timers.add(t);
        }
        // Other message types (Parse/Bind/Describe/Execute/Flush) need no
        // immediate response — the response batch goes out on Sync.
      }
    });
    socket.on("close", () => {
      onClose?.();
    });
    socket.on("error", () => {});
  });
  return {
    port,
    stop: () => {
      for (const t of timers) clearTimeout(t);
      server.close();
    },
  };
}

test("idleTimeout does not kill an in-flight query (#30646)", async () => {
  // Server takes 2s to respond to the query; client idleTimeout is 1s (in
  // seconds — Bun multiplies by 1000 internally). Pre-fix: rejects with
  // ERR_POSTGRES_IDLE_TIMEOUT. Post-fix: query completes.
  const { port, stop } = await startMockServer(2000);
  try {
    await using sql = new SQL({
      url: `postgres://u@127.0.0.1:${port}/db?sslmode=disable`,
      max: 1,
      idleTimeout: 1,
    });
    const result = await sql`SELECT 42 as x`;
    expect(result[0].x).toBe(42);
  } finally {
    stop();
  }
}, 30_000);

test("maxLifetime does not kill an in-flight query (#30646)", async () => {
  // Server takes 2s to respond; client max_lifetime is 1s. Pre-fix: rejects
  // with ERR_POSTGRES_LIFETIME_TIMEOUT. Post-fix: query completes, then the
  // connection closes after it's idle.
  const { port, stop } = await startMockServer(2000);
  try {
    await using sql = new SQL({
      url: `postgres://u@127.0.0.1:${port}/db?sslmode=disable`,
      max: 1,
      maxLifetime: 1,
    });
    const result = await sql`SELECT 42 as x`;
    expect(result[0].x).toBe(42);
  } finally {
    stop();
  }
}, 30_000);

test("maxLifetime closes an idle connection so the pool can reconnect (#30646)", async () => {
  // After the first query completes the connection is idle. The max_lifetime
  // timer fires, `disconnect()` runs, and the server sees the socket close.
  const { promise: closedOnServer, resolve: onServerClose } = Promise.withResolvers<void>();
  const { port, stop } = await startMockServer(0, onServerClose);
  try {
    await using sql = new SQL({
      url: `postgres://u@127.0.0.1:${port}/db?sslmode=disable`,
      max: 1,
      maxLifetime: 1,
      // Keep the idle timer out of the way — we want to prove maxLifetime
      // alone retires the connection.
      idleTimeout: 0,
    });
    const result = await sql`SELECT 42 as x`;
    expect(result[0].x).toBe(42);

    // Deterministic wait — the test's 30s budget bounds the flake risk.
    await closedOnServer;

    await sql.close({ timeout: 0 }).catch(() => {});
  } finally {
    stop();
  }
}, 30_000);
