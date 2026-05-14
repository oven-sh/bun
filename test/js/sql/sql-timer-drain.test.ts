import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

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

// Minimal Postgres protocol bytes we need to hand-roll.
// Startup-phase handshake (no SSL): AuthenticationOk + ReadyForQuery(idle).
const HANDSHAKE = Buffer.from([
  0x52,
  0,
  0,
  0,
  8,
  0,
  0,
  0,
  0, // AuthenticationOk
  0x5a,
  0,
  0,
  0,
  5,
  0x49, // ReadyForQuery 'I' (idle)
]);

// Full response to Bun's extended-query `Parse+Describe+Bind+Execute+Flush+Sync`
// batch for `SELECT 42 as x`: ParseComplete + ParameterDescription (empty) +
// RowDescription + BindComplete + DataRow + CommandComplete + ReadyForQuery.
// Column type 23 = int4.
function buildQueryResponse(): Buffer {
  // ParseComplete: '1' + len(4) -> no body
  const parseComplete = Buffer.from([0x31, 0, 0, 0, 4]);

  // ParameterDescription: 't' + len + int16 numParams(0)
  const paramDesc = Buffer.from([0x74, 0, 0, 0, 6, 0, 0]);

  // RowDescription: 'T' + len + fieldCount(1) + name("x\0") + tableOID(0) +
  //   columnAttrNum(0) + typeOID(23) + typeSize(4) + typeMod(-1) + format(0)
  const name = Buffer.from("x\0");
  const rowDescBody = Buffer.alloc(2 + name.length + 4 + 2 + 4 + 2 + 4 + 2);
  let o = 0;
  rowDescBody.writeInt16BE(1, o);
  o += 2;
  name.copy(rowDescBody, o);
  o += name.length;
  rowDescBody.writeInt32BE(0, o);
  o += 4; // table OID
  rowDescBody.writeInt16BE(0, o);
  o += 2; // col attr
  rowDescBody.writeInt32BE(23, o);
  o += 4; // typeOID int4
  rowDescBody.writeInt16BE(4, o);
  o += 2; // type size
  rowDescBody.writeInt32BE(-1, o);
  o += 4; // typeMod
  rowDescBody.writeInt16BE(0, o);
  o += 2; // format = text
  const rowDesc = Buffer.alloc(5 + rowDescBody.length);
  rowDesc[0] = 0x54; // 'T'
  rowDesc.writeInt32BE(4 + rowDescBody.length, 1);
  rowDescBody.copy(rowDesc, 5);

  // BindComplete: '2' + len(4) -> no body
  const bindComplete = Buffer.from([0x32, 0, 0, 0, 4]);

  // DataRow: 'D' + len + fieldCount(1) + valueLen(2) + value("42")
  const val = Buffer.from("42");
  const drBody = Buffer.alloc(2 + 4 + val.length);
  drBody.writeInt16BE(1, 0);
  drBody.writeInt32BE(val.length, 2);
  val.copy(drBody, 6);
  const dr = Buffer.alloc(5 + drBody.length);
  dr[0] = 0x44; // 'D'
  dr.writeInt32BE(4 + drBody.length, 1);
  drBody.copy(dr, 5);

  // CommandComplete: 'C' + len + "SELECT 1\0"
  const tag = Buffer.from("SELECT 1\0");
  const cc = Buffer.alloc(5 + tag.length);
  cc[0] = 0x43; // 'C'
  cc.writeInt32BE(4 + tag.length, 1);
  tag.copy(cc, 5);

  // ReadyForQuery: 'Z' + len + 'I'
  const rfq = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);

  return Buffer.concat([parseComplete, paramDesc, rowDesc, bindComplete, dr, cc, rfq]);
}

const QUERY_RESPONSE = buildQueryResponse();

/**
 * Simple mock server: on first data (startup message) sends the handshake; on
 * subsequent data (client query) waits `queryDelayMs` then sends a minimal
 * result. `onClose` lets the test observe the socket close.
 */
function startMockServer(queryDelayMs: number, onClose?: () => void): Promise<{ port: number; stop: () => void }> {
  return new Promise(resolve => {
    const timers = new Set<Timer>();
    const server = net.createServer(socket => {
      // State: 'startup' -> accepting any data and replying with HANDSHAKE
      //        'query' -> buffering inbound bytes until we see a complete 'Q' message,
      //                   then scheduling one response (guards against TCP chunking).
      let state: "startup" | "query" = "startup";
      let buf: Buffer = Buffer.alloc(0);
      socket.on("data", chunk => {
        if (state === "startup") {
          state = "query";
          socket.write(HANDSHAKE);
          return;
        }
        buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
        // Parse out complete messages; respond once per 'S' (Sync — end of a
        // Parse+Bind+Execute batch) or 'Q' (Simple Query). Message format:
        // type(1) + length(4 BE, includes the length field itself).
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
          // Other message types (Parse/Bind/Describe/Execute/Flush) don't need
          // an immediate response — the response batch goes out on Sync.
        }
      });
      socket.on("close", () => {
        onClose?.();
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        stop: () => {
          for (const t of timers) clearTimeout(t);
          server.close();
        },
      });
    });
  });
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
  // reschedule loop terminates, `disconnect()` runs, and the server sees the
  // socket close.
  let socketCloses = 0;
  const { port, stop } = await startMockServer(0, () => socketCloses++);
  try {
    const sql = new SQL({
      url: `postgres://u@127.0.0.1:${port}/db?sslmode=disable`,
      max: 1,
      maxLifetime: 1,
      // Keep the idle timer out of the way — we want to prove maxLifetime
      // alone retires the connection.
      idleTimeout: 0,
    });
    const result = await sql`SELECT 42 as x`;
    expect(result[0].x).toBe(42);

    // Wait up to 3s for the server to see the socket close.
    const deadline = Date.now() + 3000;
    while (socketCloses === 0 && Date.now() < deadline) {
      await Bun.sleep(50);
    }
    expect(socketCloses).toBeGreaterThanOrEqual(1);

    await sql.close({ timeout: 0 }).catch(() => {});
  } finally {
    stop();
  }
}, 30_000);
