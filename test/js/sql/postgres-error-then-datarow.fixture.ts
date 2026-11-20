// Fixture for postgres-error-then-datarow.test.ts. Run as a subprocess so a
// debug_assert SIGABRT is observable as a non-zero exit code from the test.
//
// Mock backend that answers "select a" with RowDescription, and with
// ErrorResponse if the text says so, and only afterwards, in a later write,
// sends the result messages for that same exchange. The query has failed by
// then, or cancel() has rejected it. Those late messages must be discarded.
import { SQL } from "bun";
import net from "node:net";
import {
  listeningServer,
  loopbackFence,
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

let gotQuery = Promise.withResolvers<net.Socket>();
const { port, server } = await listeningServer(socket => {
  let startup = true;
  socket.on("data", data => {
    if (startup) {
      startup = false;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      return;
    }
    if (data[0] !== 0x51 /* 'Q' simple Query */) return;
    if (data.includes("select a")) {
      // Hold back the result messages.
      const error = data.includes("fails") ? [pgErrorResponse({ S: "ERROR", C: "42000", M: "boom" })] : [];
      socket.write(Buffer.concat([rowDesc, ...error]));
      gotQuery.resolve(socket);
    } else {
      // A normal one-row result.
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

// A query that failed rejects at its ReadyForQuery. The mock sends no BackendKeyData, so there is no CancelRequest and
// cancel() rejects at once.
for (const [text, cancel] of [
  ["select a from t -- fails", false],
  ["select a from t", true],
] as const) {
  let q: Bun.SQL.Query<unknown> | null = sql.unsafe(text).simple().execute();
  const rejected = q.catch(e => e);
  const qsock = await gotQuery.promise;
  gotQuery = Promise.withResolvers();
  await loopbackFence();
  if (cancel) {
    q.cancel();
    await rejected;
  }
  q = null;

  // Let the reject callback's queued cleanup drop the last JS reference to the
  // query so GC can collect the wrapper while the request is still current().
  await new Promise<void>(resolve => setImmediate(resolve));
  Bun.gc(true);
  Bun.gc(true);

  // Late result messages for that query. All four handlers that would otherwise
  // dispatch to the request's JS wrapper are exercised: DataRow,
  // EmptyQueryResponse, CloseComplete, CommandComplete.
  const late = Buffer.concat([
    dataRow,
    pgRaw("I", Buffer.alloc(0)),
    pgRaw("3", Buffer.alloc(0)),
    pgCommandComplete("SELECT 1"),
    pgReadyForQuery(),
  ]);
  await new Promise<void>((resolve, reject) => qsock.write(late, err => (err ? reject(err) : resolve())));
  const err: any = await rejected;
  console.log("REJECTED", err?.code ?? String(err));

  // The connection must remain usable after the stale exchange closes.
  const next: any = await sql.unsafe("select b").simple();
  console.log("NEXT", JSON.stringify(next));
}

await sql.close({ timeout: 0 });
await new Promise<void>(resolve => server.close(() => resolve()));
