// Regression tests for how a failed COM_STMT_PREPARE is handled, against a
// scripted MySQL server. All wire-protocol bytes come from
// test/js/sql/wire-frames.ts; do not inline Buffer.alloc frame construction.
//
// 1. MySQLConnection cached a prepared statement whose prepare failed
//    (status = .failed) in the per-connection statement map and never evicted
//    it, so every later execution of the same query text on that connection
//    rethrew the stale ErrorPacket without ever re-preparing. Transient
//    prepare failures are normal (a table that appears after a migration,
//    deadlocks, ER_TOO_MANY_CONCURRENT_STMTS); with pooling this poisons a
//    connection for the process lifetime.
// 2. A second identical query started in the same synchronous turn attaches to
//    the first's in-flight statement. When the shared prepare failed, the
//    second query's promise was never settled (see the second test).
//
// The oracle is the number of COM_STMT_PREPARE frames the client emits for one
// query text, so the server is a mock that observes the client's outbound
// frames directly: a real container cannot make the same prepare fail once and
// then succeed without an out-of-band DDL racing the client.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import type { Socket } from "node:net";
import {
  listeningServer,
  mysqlErrorPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_QUIT = 0x01;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const COM_STMT_CLOSE = 0x19;

/**
 * A scripted MySQL server: handshake, OK for the auth response, then routes
 * each COM_STMT_PREPARE through `onPrepare(text, nth)` (nth is 1-based per
 * distinct query text) and answers every COM_STMT_EXECUTE with an OK packet.
 * Call `stop()` in a `finally`.
 */
async function mockMySQLServer(onPrepare: (text: string, nth: number) => Buffer) {
  const preparesByText = new Map<string, number>();
  let connections = 0;
  const sockets = new Set<Socket>();
  const { server, port } = await listeningServer(socket => {
    connections++;
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        const cmd = payload[0];
        if (cmd === COM_STMT_PREPARE) {
          const text = payload.subarray(1).toString("utf-8");
          const n = (preparesByText.get(text) ?? 0) + 1;
          preparesByText.set(text, n);
          socket.write(onPrepare(text, n));
        } else if (cmd === COM_STMT_EXECUTE) {
          socket.write(mysqlOkPacket(1));
        } else if (cmd === COM_STMT_CLOSE) {
          // COM_STMT_CLOSE expects no response.
        } else if (cmd === COM_QUIT) {
          socket.end();
        } else {
          socket.end();
        }
      });
    });
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  return {
    port,
    preparesByText,
    connections: () => connections,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

const tableMissing = () => mysqlErrorPacket(1, 1146, "42S02", "Table 'db.t' doesn't exist");

const settled = (q: Promise<any>) =>
  q.then(
    value => ({ status: "fulfilled", value }),
    reason => ({ status: "rejected", reason }),
  );

test.concurrent("MySQL: a failed prepare is evicted from the statement cache and retried", async () => {
  // First COM_STMT_PREPARE for a given text answers ERR 1146 (table missing),
  // every later one answers OK.
  let stmtId = 0;
  const mock = await mockMySQLServer((_text, nth) =>
    nth === 1 ? tableMissing() : mysqlStmtPrepareOk(1, ++stmtId, 0, 0),
  );

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });

    // 1. The prepare fails with a transient server error.
    const first = await settled(sql`SELECT * FROM t`);
    expect(first.status).toBe("rejected");
    expect((first as any).reason).toMatchObject({ errno: 1146, code: "ERR_MYSQL_SERVER_ERROR" });

    // 2. The same text again on the same connection. Before the fix the stale
    //    ErrorPacket was replayed from the statement cache and the server never
    //    saw a second COM_STMT_PREPARE; after the fix it re-prepares and runs.
    const second = await settled(sql`SELECT * FROM t`);

    // 3. Same text a third time: the now-Prepared statement IS served from the
    //    cache, proving only Failed entries are evicted, not the cache itself.
    const third = await settled(sql`SELECT * FROM t`);

    expect({
      connections: mock.connections(),
      prepares: mock.preparesByText.get("SELECT * FROM t"),
      second: second.status,
      third: third.status,
    }).toEqual({
      connections: 1,
      prepares: 2,
      second: "fulfilled",
      third: "fulfilled",
    });
  } finally {
    await mock.stop();
  }
});

// Two identical queries started in the same synchronous turn share one prepare
// (the second attaches to the first's in-flight statement); a shared failure
// must reject both, not leave one pending forever.
test.concurrent("MySQL: a concurrent query sharing a failed prepare is rejected, not left pending", async () => {
  // Every COM_STMT_PREPARE for the text answers ERR 1146, so the only correct
  // outcome for BOTH queries is a rejection carrying that error.
  const mock = await mockMySQLServer(() => tableMissing());

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });

    const results = await Promise.all(
      [sql`SELECT * FROM t`, sql`SELECT * FROM t`].map(q =>
        q.then(
          () => ({ status: "fulfilled" }),
          (e: any) => ({ status: "rejected", isError: e instanceof Error, errno: e?.errno }),
        ),
      ),
    );

    // `prepares: 1` proves the second query shared the first's prepare attempt
    // instead of issuing its own COM_STMT_PREPARE.
    expect({ results, prepares: mock.preparesByText.get("SELECT * FROM t") }).toEqual({
      results: [
        { status: "rejected", isError: true, errno: 1146 },
        { status: "rejected", isError: true, errno: 1146 },
      ],
      prepares: 1,
    });
  } finally {
    await mock.stop();
  }
});
