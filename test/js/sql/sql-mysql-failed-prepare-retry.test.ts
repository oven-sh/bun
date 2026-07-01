// Regression test: MySQLConnection cached a prepared statement whose
// COM_STMT_PREPARE failed (status = .failed) in the per-connection statement
// map and never evicted it, so every later execution of the same query text on
// that connection rethrew the stale ErrorPacket without ever re-preparing.
// Transient prepare failures are normal (a table that appears after a
// migration, deadlocks, ER_TOO_MANY_CONCURRENT_STMTS); with pooling this
// poisons a connection for the process lifetime.
//
// The oracle is the number of COM_STMT_PREPARE frames the client emits for one
// query text, so the server here is a scripted mock that observes the client's
// outbound frames directly: the first prepare of the text fails, every later
// prepare of it succeeds. A real container cannot make the same prepare fail
// once and then succeed without an out-of-band DDL racing the client.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

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

test("MySQL: a failed prepare is evicted from the statement cache and retried", async () => {
  // First COM_STMT_PREPARE for a given text answers ERR 1146 (table missing),
  // every later one answers OK. COM_STMT_EXECUTE always answers OK.
  const preparesByText = new Map<string, number>();
  let connections = 0;
  let stmtId = 0;
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
          if (n === 1) {
            socket.write(mysqlErrorPacket(1, 1146, "42S02", "Table 'db.t' doesn't exist"));
          } else {
            socket.write(mysqlStmtPrepareOk(1, ++stmtId, 0, 0));
          }
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

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    const settled = (q: Promise<any>) =>
      q.then(
        value => ({ status: "fulfilled", value }) as const,
        reason => ({ status: "rejected", reason }) as const,
      );

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
      connections,
      prepares: preparesByText.get("SELECT * FROM t"),
      second: second.status,
      third: third.status,
    }).toEqual({
      connections: 1,
      prepares: 2,
      second: "fulfilled",
      third: "fulfilled",
    });
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
