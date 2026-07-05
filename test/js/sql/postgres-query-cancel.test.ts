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
  pgCancelRequest,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const PROCESS_ID = 4242;
const SECRET_KEY = 13371337;
const TEXT_OID = 25;

/**
 * Completes the handshake (advertising BackendKeyData) and then leaves every
 * query unanswered, the way a backend stuck inside pg_sleep() would. The test
 * drives the reply itself. The connection a CancelRequest arrives on is always
 * the second one, because the first is busy running the query.
 */
async function hangingBackend() {
  const queryReceived = Promise.withResolvers<void>();
  const cancelPacket = Promise.withResolvers<Buffer>();
  const sockets = new Set<net.Socket>();
  let queryConnection: net.Socket | undefined;
  let connections = 0;

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
    socket.on("data", () => {
      if (!handshaken) {
        handshaken = true;
        socket.write(
          Buffer.concat([pgAuthenticationOk(), pgBackendKeyData(PROCESS_ID, SECRET_KEY), pgReadyForQuery()]),
        );
        return;
      }
      queryReceived.resolve();
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    queryReceived: queryReceived.promise,
    cancelPacket: cancelPacket.promise,
    get connections() {
      return connections;
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
  await using backend = await hangingBackend();
  await using sql = new SQL({ url: backend.url, max: 1, connectionTimeout: 5 });

  const query = start(sql`select pg_sleep(10)`);
  const settled = query.then(
    (rows: unknown) => rows,
    (err: any) => err,
  );
  await backend.queryReceived;

  query.cancel();

  // The CancelRequest names the backend by the pid/secret pair it handed out in
  // BackendKeyData, on a connection of its own.
  expect(await backend.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));
  expect(backend.connections).toBe(2);

  // A real backend answers the cancelled query on its own connection, with
  // SQLSTATE 57014 (query_canceled).
  backend.reply(
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
  await using backend = await hangingBackend();
  await using sql = new SQL({ url: backend.url, max: 1, connectionTimeout: 5 });

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
  expect(backend.connections).toBe(0);
});

test("cancel() on a queued query does not cancel the one the backend is running", async () => {
  await using backend = await hangingBackend();
  await using sql = new SQL({ url: backend.url, max: 1, connectionTimeout: 5 });

  const running = sql`select 'kept'`.simple().execute();
  const runningSettled = running.then(
    rows => rows,
    err => err,
  );
  await backend.queryReceived;

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

  backend.reply(
    pgRowDescription([{ name: "v", typeOid: TEXT_OID }]),
    pgDataRow([Buffer.from("kept")]),
    pgCommandComplete("SELECT 1"),
    pgReadyForQuery(),
  );

  expect(await runningSettled).toEqual([{ v: "kept" }]);
  // No second connection was opened, so nothing was cancelled on the server.
  expect(backend.connections).toBe(1);
});
