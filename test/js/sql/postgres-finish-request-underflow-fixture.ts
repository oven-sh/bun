// Fixture for postgres-finish-request-underflow.test.ts. Runs in a subprocess
// so a debug_assert panic on the counter invariant is observable as a nonzero
// exit code instead of taking down the test runner.
//
// Drives a single connection through every finish_request call site:
//   - the ReadyForQuery 'Z' arm, for a simple query that completes normally
//   - the ErrorResponse 'E' arm, for a simple query the server rejects
//   - the ErrorResponse arm followed by CommandComplete + ReadyForQuery for the
//     same exchange (the sequence whose second CommandComplete used to flip the
//     request back to PartialResponse and double-decrement the counter)
//
// After each exchange a fresh query must still dispatch: if the per-class
// request counter leaked high or wrapped past zero, advance() would refuse to
// write it and the subprocess would sit idle until the watchdog fires.
import { SQL } from "bun";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgErrorResponse,
  pgReadFrontendMessages,
  pgReadyForQuery,
} from "./wire-frames";

const watchdog = setTimeout(() => {
  console.error("WATCHDOG: a later query never dispatched (request counter leaked or wrapped)");
  process.exit(1);
}, 15_000);

type ConnState = { buf: Buffer; sawStartup: boolean; simpleCount: number };

const { port, server } = await listeningServer(socket => {
  const state: ConnState = { buf: Buffer.alloc(0), sawStartup: false, simpleCount: 0 };
  socket.on("data", data => {
    state.buf = Buffer.concat([state.buf, data]);
    if (!state.sawStartup) {
      if (state.buf.length < 4) return;
      const len = state.buf.readInt32BE(0);
      if (state.buf.length < len) return;
      state.buf = state.buf.subarray(len);
      state.sawStartup = true;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      return;
    }
    state.buf = pgReadFrontendMessages(state.buf, (type, body) => {
      if (type !== 0x51 /* 'Q' simple Query */) return;
      const q = body.toString("utf8", 0, body.indexOf(0));
      state.simpleCount++;
      if (q.includes("reject_once")) {
        socket.write(
          Buffer.concat([pgErrorResponse({ S: "ERROR", C: "XX000", M: "boom" }), pgReadyForQuery()]),
        );
      } else if (q.includes("reject_then_late_result")) {
        // ErrorResponse first, then a late CommandComplete + ReadyForQuery for
        // the same exchange. The late CommandComplete must be discarded; the
        // ReadyForQuery that follows must not decrement a second time.
        socket.write(
          Buffer.concat([
            pgErrorResponse({ S: "ERROR", C: "XX000", M: "boom" }),
            pgCommandComplete("SELECT 0"),
            pgReadyForQuery(),
          ]),
        );
      } else {
        socket.write(
          Buffer.concat([pgCommandComplete(`SELECT ${state.simpleCount}`), pgReadyForQuery()]),
        );
      }
    });
  });
  socket.on("error", () => {});
});

const opts = { url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 } as const;

// 1. normal simple-query completion: finish_request via the 'Z' arm.
{
  const sql = new SQL(opts);
  await sql.unsafe("select ok").simple();
  await sql.unsafe("select still_dispatches").simple();
  await sql.close({ timeout: 0 });
}

// 2. ErrorResponse: finish_request via the 'E' arm, then a follow-up query
//    must still dispatch on the same connection.
{
  const sql = new SQL(opts);
  const err: any = await sql.unsafe("select reject_once").simple().catch(e => e);
  if (err?.code !== "ERR_POSTGRES_SERVER_ERROR") {
    throw new Error(`expected ERR_POSTGRES_SERVER_ERROR, got ${err?.code ?? err}`);
  }
  await sql.unsafe("select still_dispatches").simple();
  await sql.close({ timeout: 0 });
}

// 3. ErrorResponse + late CommandComplete + ReadyForQuery for the same request.
{
  const sql = new SQL(opts);
  const err: any = await sql.unsafe("select reject_then_late_result").simple().catch(e => e);
  if (err?.code !== "ERR_POSTGRES_SERVER_ERROR") {
    throw new Error(`expected ERR_POSTGRES_SERVER_ERROR, got ${err?.code ?? err}`);
  }
  await sql.unsafe("select still_dispatches").simple();
  await sql.close({ timeout: 0 });
}

clearTimeout(watchdog);
await new Promise<void>(resolve => server.close(() => resolve()));
console.log("DONE");
