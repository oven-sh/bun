// This test counts the exact commands Bun's MySQL client puts on the wire
// (COM_STMT_PREPARE / COM_STMT_CLOSE), which needs a scripted server; a real
// server only exposes those as status counters shared with every other
// connection. All wire-protocol bytes come from test/js/sql/wire-frames.ts.
//
// Regression test: the client never sent COM_STMT_CLOSE and kept an unbounded
// per-connection prepared-statement cache. Server-side prepared statements
// survive until they are closed or the connection ends, and they count against
// the server-wide `max_prepared_stmt_count` budget (default 16382, shared by
// every client of that server), so one long-lived pooled connection running
// many distinct query texts (what ORMs produce) eventually makes the whole
// server reject prepares for everyone. The client now caps the per-connection
// cache (MAX_CACHED_PREPARED_STATEMENTS in src/sql_jsc/mysql/MySQLConnection.rs)
// and sends COM_STMT_CLOSE for what it evicts.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlColumnDefinition,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_QUIT = 0x01;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const COM_STMT_CLOSE = 0x19;
const MYSQL_TYPE_LONGLONG = 0x08;
const ER_UNKNOWN_STMT_HANDLER = 1243;

// Keep in sync with MAX_CACHED_PREPARED_STATEMENTS in
// src/sql_jsc/mysql/MySQLConnection.rs.
const MAX_CACHED_PREPARED_STATEMENTS = 256;

/**
 * Minimal MySQL server: accepts any auth, answers COM_STMT_PREPARE with a
 * fresh statement id (one `?` parameter, no result columns), COM_STMT_EXECUTE
 * with an empty OK, and records every COM_STMT_CLOSE (which, per protocol, has
 * no response). Executing an id that was closed (or never prepared) answers
 * with ER_UNKNOWN_STMT_HANDLER exactly like a real server, so a client that
 * closes a statement another query still needs fails that query loudly.
 */
async function statementCountingServer() {
  const counters = {
    prepares: 0,
    executes: 0,
    /** statement ids handed out to the client */
    prepared: new Set<number>(),
    /** statement ids the client sent COM_STMT_CLOSE for */
    closed: new Set<number>(),
  };
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let nextStatementId = 1;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        switch (payload[0]) {
          case COM_STMT_PREPARE: {
            counters.prepares++;
            const id = nextStatementId++;
            counters.prepared.add(id);
            // COM_STMT_PREPARE_OK(num_columns = 0, num_params = 1) followed by
            // the single parameter definition. CLIENT_DEPRECATE_EOF is
            // negotiated by the handshake above, so no trailing EOF packet.
            socket.write(
              Buffer.concat([
                mysqlStmtPrepareOk(1, id, 0, 1),
                mysqlColumnDefinition(2, { name: "?", type: MYSQL_TYPE_LONGLONG }),
              ]),
            );
            break;
          }
          case COM_STMT_EXECUTE: {
            // Int<1> command, Int<4> statement_id.
            const id = payload.readUInt32LE(1);
            if (!counters.prepared.has(id) || counters.closed.has(id)) {
              socket.write(
                mysqlErrPacket(
                  1,
                  ER_UNKNOWN_STMT_HANDLER,
                  `Unknown prepared statement handler (${id}) given to mysqld_stmt_execute`,
                ),
              );
              break;
            }
            counters.executes++;
            socket.write(mysqlOkPacket(1));
            break;
          }
          case COM_STMT_CLOSE: {
            // Int<1> command, Int<4> statement_id.
            counters.closed.add(payload.readUInt32LE(1));
            break;
          }
          case COM_QUIT: {
            socket.end();
            break;
          }
        }
      });
    });
    socket.on("error", () => {});
  });
  return { server, port, counters };
}

// Exceeding the cache cap takes MAX_CACHED_PREPARED_STATEMENTS + 1 prepare +
// execute round trips by definition, which outgrows the 5s default per-test
// timeout on debug + ASAN builds, so this test declares its real budget.
test("MySQL: the prepared-statement cache is capped and evicted statements are closed with COM_STMT_CLOSE", async () => {
  const { server, port, counters } = await statementCountingServer();
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // More distinct parameterized query texts than the cache cap (distinct
    // texts are what an ORM interpolating table/column names produces), all
    // in flight at once on the single pooled connection. While a query still
    // references its statement nothing may be evicted or closed: the mock
    // rejects any execute of a closed id, which would reject the Promise.all.
    const DISTINCT = MAX_CACHED_PREPARED_STATEMENTS + 8;
    const results = await Promise.all(Array.from({ length: DISTINCT }, (_, i) => sql.unsafe(`select ? as c${i}`, [i])));
    expect(results).toHaveLength(DISTINCT);
    expect(counters.prepares).toBe(DISTINCT);
    expect(counters.closed.size).toBe(0);

    // A cached statement only becomes evictable once no query object
    // references it anymore, and a query releases its statement when its
    // wrapper is collected. Collect, then keep issuing new distinct texts:
    // every insert past the cap must now evict + COM_STMT_CLOSE
    // least-recently-used statements. Poll the condition (GC decides how many
    // rounds the finalizers take) instead of assuming a fixed iteration count.
    let extra = 0;
    while (counters.prepares - counters.closed.size > MAX_CACHED_PREPARED_STATEMENTS && extra < 64) {
      Bun.gc(true);
      await Bun.sleep(0);
      await sql.unsafe(`select ? as extra${extra}`, [extra]);
      extra++;
    }

    // Without COM_STMT_CLOSE the server-side statement count
    // (prepares - closes) grows monotonically with every distinct query text;
    // the loop above then exhausts its budget with closed.size still 0.
    expect(counters.closed.size).toBeGreaterThan(0);
    expect(counters.prepares - counters.closed.size).toBeLessThanOrEqual(MAX_CACHED_PREPARED_STATEMENTS);
    // Only ids the server actually handed out may be closed.
    expect([...counters.closed].every(id => counters.prepared.has(id))).toBe(true);
    // Every query text was prepared and executed exactly once (an execute of
    // a closed id would have been rejected by the mock and thrown above).
    expect(counters.prepares).toBe(DISTINCT + extra);
    expect(counters.executes).toBe(DISTINCT + extra);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}, 30_000);

test("MySQL: an identical query text keeps reusing one prepared statement and is never closed", async () => {
  const { server, port, counters } = await statementCountingServer();
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // Same text + same parameter type = same statement-cache entry. Collect in
    // between so finalized query wrappers can't take the cached statement (or
    // its server-side id) with them.
    for (let i = 0; i < 50; i++) {
      await sql.unsafe("select ? as reused", [i]);
      if (i % 10 === 0) {
        Bun.gc(true);
        await Bun.sleep(0);
      }
    }

    expect({
      prepares: counters.prepares,
      executes: counters.executes,
      closed: counters.closed.size,
    }).toEqual({
      prepares: 1,
      executes: 50,
      closed: 0,
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
