// Fixture for postgres-error-then-datarow.test.ts. Run as a subprocess so a
// debug_assert SIGABRT is observable as a non-zero exit code from the test.
//
// Mock backend that answers the first simple Query with RowDescription +
// ErrorResponse and only afterwards, in a later write, sends the result
// messages for that same exchange. Those late messages must be discarded.
import { SQL } from "bun";
import net from "node:net";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgRaw,
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
      // Reject the first query, hold back the result messages.
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
await new Promise<void>(resolve => setImmediate(resolve));
Bun.gc(true);
Bun.gc(true);

// Late result messages for the already-rejected first query. All four handlers
// that would otherwise dispatch to the request's JS wrapper are exercised:
// DataRow, EmptyQueryResponse, CloseComplete, CommandComplete.
const qsock = await gotFirstQuery.promise;
const late = Buffer.concat([
  dataRow,
  pgRaw("I", Buffer.alloc(0)),
  pgRaw("3", Buffer.alloc(0)),
  pgCommandComplete("SELECT 1"),
  pgReadyForQuery(),
]);
await new Promise<void>((resolve, reject) => qsock.write(late, err => (err ? reject(err) : resolve())));

// The connection must remain usable after the stale exchange closes.
const second: any = await sql.unsafe("select b").simple();
console.log("SECOND", JSON.stringify(second));

await sql.close({ timeout: 0 });
await new Promise<void>(resolve => server.close(() => resolve()));
