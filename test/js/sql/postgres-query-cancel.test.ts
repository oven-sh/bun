// A backend that is running a query reads nothing from its connection until the
// query finishes, so the only way to stop it is the CancelRequest message on a
// *second* connection (protocol §55.2.3). Asserting those bytes, and asserting
// that they are NOT sent for a query the backend never started, needs a server
// that answers on demand, which is why this uses a scripted one instead of
// describeWithContainer. All wire bytes come from test/js/sql/wire-frames.ts.
//
// Query.cancel() used to be a no-op for Postgres: nothing was ever written, so a
// cancelled query ran to completion and resolved with its rows, and a query
// cancelled before it was dispatched never settled at all.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "node:net";
import {
  pgAuthenticationOk,
  pgBackendKeyData,
  pgBindComplete,
  pgCancelRequest,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgParameterDescription,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const PROCESS_ID = 4242;
const SECRET_KEY = 13371337;
// text: its binary and text encodings are the same bytes, so the mock does not
// have to care whether Bun asked for binary results (it does for a statement it
// has already prepared).
const TEXT_OID = 25;

/**
 * Scripted Postgres backend.
 *
 * While `autoReply` is on it answers each query unit with one text row, which is
 * what drives a statement to the Prepared state. With it off, queries are left
 * unanswered the way a backend stuck inside pg_sleep() would leave them, and the
 * test writes every reply itself. A CancelRequest always arrives on the second
 * connection, because the first one is busy running the query.
 */
async function backend() {
  const cancelPacket = Promise.withResolvers<Buffer>();
  const sockets = new Set<net.Socket>();
  const waiters = new Map<number, () => void>();
  let queryConnection: net.Socket | undefined;
  let connections = 0;
  let queryUnits = 0;
  let autoReply = true;

  // Answer a Parse+Describe+Bind+Execute with one text row: ParseComplete and
  // the two Describe replies, then the Execute replies.
  const preparedReply = () =>
    Buffer.concat([
      pgParseComplete(),
      pgParameterDescription([]),
      pgRowDescription([{ name: "v", typeOid: TEXT_OID }]),
      pgBindComplete(),
      pgDataRow([Buffer.from("ok")]),
      pgCommandComplete("SELECT 1"),
      pgReadyForQuery(),
    ]);

  function onQueryUnit() {
    queryUnits++;
    waiters.get(queryUnits)?.();
    if (autoReply) queryConnection!.write(preparedReply());
  }

  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});

    if (++connections > 1) {
      let buffered = Buffer.alloc(0);
      socket.on("data", data => {
        buffered = Buffer.concat([buffered, data]);
        if (buffered.length < 16) return;
        cancelPacket.resolve(buffered);
        // A real backend acts on the CancelRequest and hangs up.
        socket.end();
      });
      return;
    }

    queryConnection = socket;
    let handshaken = false;
    let buffered = Buffer.alloc(0);
    socket.on("data", data => {
      if (!handshaken) {
        handshaken = true;
        socket.write(
          Buffer.concat([pgAuthenticationOk(), pgBackendKeyData(PROCESS_ID, SECRET_KEY), pgReadyForQuery()]),
        );
        return;
      }
      buffered = pgReadFrontendMessages(Buffer.concat([buffered, data]), type => {
        // Sync ends every extended-protocol unit; the simple protocol's Query is
        // its own sync point.
        if (type === "S" || type === "Q") onQueryUnit();
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    cancelPacket: cancelPacket.promise,
    get connections() {
      return connections;
    },
    set autoReply(value: boolean) {
      autoReply = value;
    },
    /** Resolves once the client has sent its `n`th complete query unit. */
    untilQueryUnits(n: number): Promise<void> {
      if (queryUnits >= n) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      waiters.set(n, resolve);
      return promise;
    },
    /** Answer one Bind+Execute of a statement the backend already prepared. */
    answerPrepared(value: string) {
      queryConnection!.write(
        Buffer.concat([
          pgBindComplete(),
          pgDataRow([Buffer.from(value)]),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ]),
      );
    },
    reply(...frames: Buffer[]) {
      queryConnection!.write(Buffer.concat(frames));
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

// Both the extended protocol (the default) and the simple protocol put the
// query on the wire before the backend answers anything, so both are
// cancellable the same way.
const protocols: [name: string, start: (query: any) => any][] = [
  ["extended", query => query.execute()],
  ["simple", query => query.simple().execute()],
];

test.each(protocols)("cancel() on a running %s query sends a CancelRequest", async (_name, start) => {
  await using server = await backend();
  server.autoReply = false;
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  const query = start(sql`select pg_sleep(10)`);
  const settled = query.then(
    (rows: unknown) => rows,
    (err: any) => err,
  );
  await server.untilQueryUnits(1);

  query.cancel();

  // The CancelRequest names the backend by the pid/secret pair it handed out in
  // BackendKeyData, on a connection of its own.
  expect(await server.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));
  expect(server.connections).toBe(2);

  // A real backend answers the cancelled query on its own connection, with
  // SQLSTATE 57014 (query_canceled).
  server.reply(
    pgErrorResponse({ S: "ERROR", C: "57014", M: "canceling statement due to user request" }),
    pgReadyForQuery(),
  );

  const err = await settled;
  expect({ name: err.name, code: err.code, errno: err.errno, message: err.message }).toEqual({
    name: "PostgresError",
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "57014",
    message: "canceling statement due to user request",
  });
});

test("cancel() before the query is dispatched rejects it instead of hanging", async () => {
  await using server = await backend();
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  // Tagged templates are lazy: nothing has been sent, and nothing ever will be,
  // so cancel() has to settle the promise itself.
  const query = sql`select 1`;
  query.cancel();

  const err = await query.catch((e: any) => e);
  expect({ name: err.name, code: err.code, message: err.message }).toEqual({
    name: "PostgresError",
    code: "ERR_POSTGRES_QUERY_CANCELLED",
    message: "Query cancelled",
  });
  // Never even asked the pool for a connection.
  expect(server.connections).toBe(0);
});

test("cancel() on a queued query does not cancel the one the backend is running", async () => {
  await using server = await backend();
  server.autoReply = false;
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  const running = sql`select 'kept'`.simple().execute();
  const runningSettled = running.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);

  // Dispatched onto the same connection, but behind the running query: none of
  // its bytes are on the wire, so a CancelRequest would stop the wrong query.
  const queued = sql`select 'cancelled'`.simple().execute();
  const queuedSettled = queued.then(
    rows => rows,
    err => err,
  );
  queued.cancel();

  const err = await queuedSettled;
  expect({ name: err.name, code: err.code, message: err.message }).toEqual({
    name: "PostgresError",
    code: "ERR_POSTGRES_QUERY_CANCELLED",
    message: "Query cancelled",
  });

  server.reply(
    pgRowDescription([{ name: "v", typeOid: TEXT_OID }]),
    pgDataRow([Buffer.from("kept")]),
    pgCommandComplete("SELECT 1"),
    pgReadyForQuery(),
  );

  expect(await runningSettled).toEqual([{ v: "kept" }]);
  // No second connection was opened, so nothing was cancelled on the server.
  expect(server.connections).toBe(1);
});

// A CancelRequest names the backend process, not a statement. Once a statement is
// prepared, Bun pipelines the next query's Bind/Execute straight onto the wire
// behind the running one (do_run's Prepared arm writes when `can_pipeline()`), so
// the pipelined query's bytes are on the socket while the backend is still busy
// with the query ahead of it. Cancelling it on the server would kill that other
// query instead.
test("cancel() on a pipelined query does not cancel the one the backend is running", async () => {
  await using server = await backend();
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  // Warm both statements so each reaches the Prepared state.
  expect(await sql`select 'a'`).toEqual([{ v: "ok" }]);
  expect(await sql`select 'b'`).toEqual([{ v: "ok" }]);
  server.autoReply = false;

  // `running` is the head of the connection's FIFO and the query the backend is
  // executing; `pipelined` goes onto the wire right behind it.
  const running = sql`select 'a'`.execute();
  const pipelined = sql`select 'b'`.execute();
  const runningSettled = running.then(
    rows => rows,
    err => err,
  );
  const pipelinedSettled = pipelined.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(4);

  pipelined.cancel();

  const err = await pipelinedSettled;
  expect({ name: err.name, code: err.code, message: err.message }).toEqual({
    name: "PostgresError",
    code: "ERR_POSTGRES_QUERY_CANCELLED",
    message: "Query cancelled",
  });
  // No CancelRequest went out, so the running query was left alone.
  expect(server.connections).toBe(1);

  server.answerPrepared("kept");
  expect(await runningSettled).toEqual([{ v: "kept" }]);

  // The pipelined query's Bind/Execute were already on the wire, so the backend
  // answers it too. Those replies have to be consumed in order or the connection
  // desyncs, which the next query proves it did not.
  server.answerPrepared("drained");
  server.autoReply = true;
  expect(await sql`select 'c'`).toEqual([{ v: "ok" }]);
});
