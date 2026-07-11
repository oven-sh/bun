// Fixture for postgres-error-then-datarow.test.ts. Run as a subprocess so
// that a debug_assert SIGABRT (and the UAF it guards) is observable as a
// non-zero exit code from the test.
//
// Mock backend that answers the first simple Query with RowDescription +
// ErrorResponse (rejecting the query) and only afterwards, in a later write,
// sends DataRow + CommandComplete + ReadyForQuery for that same exchange.
// After the ErrorResponse the query's JS wrapper is rejected and its GC
// protection dropped while it is still the connection's current() request;
// the late DataRow must be discarded, not routed to the released wrapper.
import { SQL } from "bun";
import net from "node:net";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const rowDesc = pgRowDescription([{ name: "a", typeOid: 25 /* text */ }]);
const dataRow = pgDataRow([Buffer.from("x")]);

let gotFirstQuery = Promise.withResolvers<net.Socket>();
let queryCount = 0;
const { port, server } = await listeningServer(socket => {
  let startup = true;
  socket.on("data", data => {
    if (startup) {
      startup = false;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      return;
    }
    if (data[0] !== 0x51 /* 'Q' simple Query */) return;
    queryCount++;
    if (queryCount === 1) {
      // Reject the first query, hold back DataRow/CommandComplete/ReadyForQuery.
      socket.write(Buffer.concat([rowDesc, pgErrorResponse({ S: "ERROR", C: "42000", M: "boom" })]));
      gotFirstQuery.resolve(socket);
    } else {
      // Second query: a normal one-row result.
      socket.write(
        Buffer.concat([
          pgRowDescription([{ name: "b", typeOid: 25 }]),
          pgDataRow([Buffer.from("ok")]),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ]),
      );
    }
  });
  socket.on("error", () => {});
});

const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });

let q: Promise<unknown> | null = sql.unsafe("select a from t").simple();
const rejected = q.catch(e => e);
q = null;
const firstErr: any = await rejected;
console.log("FIRST", firstErr?.code ?? String(firstErr));

// Let the reject callback's queued cleanup drop the last JS reference to the
// query so GC can collect the wrapper while the request is still current().
await Bun.sleep(1);
Bun.gc(true);
Bun.gc(true);

// Trailing DataRow + CommandComplete + ReadyForQuery for the already-rejected
// first query. A correct build discards them; a broken one routes the DataRow
// to the freed query and either SIGABRTs (debug) or fails the whole connection
// with ERR_POSTGRES_EXPECTED_REQUEST (release).
const qsock = await gotFirstQuery.promise;
const late = Buffer.concat([dataRow, pgCommandComplete("SELECT 1"), pgReadyForQuery()]);
await new Promise<void>((resolve, reject) => qsock.write(late, err => (err ? reject(err) : resolve())));

// The connection must remain usable after the stale exchange closes.
const second: any = await sql.unsafe("select b").simple();
console.log("SECOND", JSON.stringify(second));

await sql.close({ timeout: 0 });
await new Promise<void>(resolve => server.close(() => resolve()));
