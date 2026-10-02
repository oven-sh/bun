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
import {
  bunEnv,
  bunExe,
  describeWithContainer,
  expiredTls,
  isIPv6,
  isMusl,
  isWindows,
  tempDir,
  tls as tlsCert,
} from "harness";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
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

// A certificate that names `localhost` and no address: both of its names are DNS entries.
const hostNameOnlyTls = {
  cert: readFileSync(join(import.meta.dir, "docker-tls", "server.crt"), "utf8"),
  key: readFileSync(join(import.meta.dir, "docker-tls", "server.key"), "utf8"),
};

// Int32(8) Int32(80877103): the one message a client sends in plaintext before TLS.
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);

/**
 * Scripted Postgres backend.
 *
 * While `autoReply` is on it answers each query unit with one text row, which is
 * what drives a statement to the Prepared state. With it off, queries are left
 * unanswered the way a backend stuck inside pg_sleep() would leave them, and the
 * test writes every reply itself. A CancelRequest always arrives on the second
 * connection, because the first one is busy running the query.
 *
 * With `tls` every connection has to start with an SSLRequest. The backend answers
 * `S` and reads everything else through TLS, and `plaintext` keeps what each
 * connection sent in the clear.
 *
 * `cancelConnection` makes the second connection meet a server no real backend is:
 * one that answers a CancelRequest like the start of a session and does not hang
 * up, one that declines TLS, one whose certificate the session's CA did not sign,
 * or one that stops in the dial until the test calls `answerCancelConnection()`:
 * before it answers the SSLRequest, or after its `S` and before the TLS handshake.
 */
async function backend(
  options: {
    tls?: boolean;
    certificate?: { cert: string; key: string };
    host?: string;
    socketPath?: string;
    cancelConnection?: "answers" | "declines-tls" | "other-certificate" | "holds-ssl-answer" | "holds-handshake";
  } = {},
) {
  const host = options.host ?? "127.0.0.1";
  const plaintext: Buffer[] = [];
  const cancelPacket = Promise.withResolvers<Buffer>();
  const cancelConnectionClosed = Promise.withResolvers<void>();
  const cancelConnectionWaiting = Promise.withResolvers<() => void>();
  const queryConnectionClosed = Promise.withResolvers<void>();
  const sockets = new Set<net.Socket>();
  const waiters = new Map<number, () => void>();
  let queryConnection: net.Socket | undefined;
  let connections = 0;
  let queryUnits = 0;
  let autoReply = true;
  let cancelPacketSeen = false;

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

  const server = net.createServer(rawSocket => {
    sockets.add(rawSocket);
    rawSocket.on("close", () => sockets.delete(rawSocket));
    rawSocket.on("error", () => {});
    const connection = ++connections;
    if (!options.tls) return serve(connection, rawSocket);

    const cancel = connection > 1 ? options.cancelConnection : undefined;
    if (connection > 1) rawSocket.on("close", () => cancelConnectionClosed.resolve());
    let buffered = Buffer.alloc(0);
    const onPlaintext = (data: Buffer) => {
      const answered = buffered.length >= SSL_REQUEST.length;
      buffered = Buffer.concat([buffered, data]);
      if (buffered.length < SSL_REQUEST.length) return;
      if (cancel === "declines-tls") {
        // Keep everything the client sends in the clear after it was told N.
        plaintext[connection - 1] = buffered;
        if (!answered) rawSocket.write("N");
        return;
      }
      plaintext[connection - 1] = buffered.subarray(0, SSL_REQUEST.length);
      // What follows the SSLRequest is the ClientHello: hand it to the TLS engine.
      rawSocket.removeListener("data", onPlaintext);
      rawSocket.pause();
      const leftover = buffered.subarray(SSL_REQUEST.length);
      if (leftover.length) rawSocket.unshift(leftover);
      const handshake = () => {
        const certificate = cancel === "other-certificate" ? expiredTls : (options.certificate ?? tlsCert);
        const secure = new tls.TLSSocket(rawSocket, { isServer: true, ...certificate });
        secure.on("error", () => {});
        serve(connection, secure);
      };
      if (cancel === "holds-ssl-answer") {
        cancelConnectionWaiting.resolve(() => {
          rawSocket.write("S");
          handshake();
        });
      } else if (cancel === "holds-handshake") {
        rawSocket.write("S");
        // The ClientHello shows that the client is in the handshake now.
        rawSocket.once("data", clientHello => {
          rawSocket.pause();
          rawSocket.unshift(clientHello);
          cancelConnectionWaiting.resolve(handshake);
        });
        rawSocket.resume();
      } else {
        rawSocket.write("S");
        handshake();
      }
    };
    rawSocket.on("data", onPlaintext);
  });

  function serve(connection: number, socket: net.Socket) {
    if (connection > 1) {
      let buffered = Buffer.alloc(0);
      socket.on("close", () => cancelConnectionClosed.resolve());
      socket.on("data", data => {
        buffered = Buffer.concat([buffered, data]);
        if (buffered.length < 16) return;
        cancelPacketSeen = true;
        cancelPacket.resolve(buffered);
        // A real backend acts on the CancelRequest and hangs up.
        if (options.cancelConnection !== "answers") return void socket.end();
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      });
      return;
    }

    queryConnection = socket;
    socket.on("close", () => queryConnectionClosed.resolve());
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
        const message = String.fromCharCode(type);
        if (message === "S" || message === "Q") onQueryUnit();
      });
    });
  }
  await new Promise<void>(resolve =>
    options.socketPath ? server.listen(options.socketPath, resolve) : server.listen(0, host, resolve),
  );
  const port = options.socketPath ? 5432 : (server.address() as net.AddressInfo).port;

  return {
    url: `postgres://postgres@${net.isIPv6(host) ? `[${host}]` : host}:${port}/postgres`,
    /** What each connection sent before TLS, by connection order. */
    plaintext,
    cancelPacket: cancelPacket.promise,
    /** Resolves once the second connection is closed. */
    cancelConnectionClosed: cancelConnectionClosed.promise,
    /** Resolves once the second connection has stopped in its dial, for the two modes that hold it. */
    cancelConnectionWaiting: cancelConnectionWaiting.promise.then(() => {}),
    /** Lets the second connection finish its dial. */
    async answerCancelConnection() {
      (await cancelConnectionWaiting.promise)();
    },
    get cancelPacketSeen() {
      return cancelPacketSeen;
    },
    /** Resolves once the client has closed the connection its queries run on. */
    queryConnectionClosed: queryConnectionClosed.promise,
    get connections() {
      return connections;
    },
    /** How many complete query units the client has sent. */
    get queryUnits() {
      return queryUnits;
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

// The cancel connection has to reach the server the way the session does. A
// plaintext one leaks the cancel key of a TLS session, and a server that only
// accepts TLS never sees it.
test("cancel() on a TLS session sends the CancelRequest through TLS", async () => {
  await using server = await backend({ tls: true });
  server.autoReply = false;
  // `ca` makes the session verify-full, so the cancel connection only gets through
  // the handshake if it uses the same TLS options.
  await using sql = new SQL({ url: server.url, tls: { ca: tlsCert.cert }, max: 1, connectionTimeout: 5 });

  const query = sql`select pg_sleep(10)`.execute();
  const settled = query.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);
  query.cancel();

  expect(await server.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));
  // Both connections sent an SSLRequest in the clear, and nothing else.
  expect(server.plaintext).toEqual([SSL_REQUEST, SSL_REQUEST]);

  server.reply(
    pgErrorResponse({ S: "ERROR", C: "57014", M: "canceling statement due to user request" }),
    pgReadyForQuery(),
  );
  expect((await settled).errno).toBe("57014");
});

// A session that is encrypted must not lose its cancel key to a cancel connection
// that is not. `prefer` counts once the session has negotiated TLS.
test.each(["prefer", "require"])(
  "cancel() on a TLS session (sslmode=%s) sends nothing when TLS is declined",
  async sslmode => {
    await using server = await backend({ tls: true, cancelConnection: "declines-tls" });
    server.autoReply = false;
    await using sql = new SQL({ url: `${server.url}?sslmode=${sslmode}`, max: 1, connectionTimeout: 5 });

    const query = sql`select pg_sleep(10)`.execute();
    const settled = query.then(
      rows => rows,
      err => err,
    );
    await server.untilQueryUnits(1);
    query.cancel();

    await server.cancelConnectionClosed;
    // The SSLRequest, then nothing: no CancelRequest after the N.
    expect(server.plaintext[1]).toEqual(SSL_REQUEST);

    server.reply(
      pgRowDescription([{ name: "v", typeOid: TEXT_OID }]),
      pgCommandComplete("SELECT 0"),
      pgReadyForQuery(),
    );
    expect(await settled).toEqual([]);
  },
);

test("cancel() on a verify-full session sends nothing to a server it cannot verify", async () => {
  await using server = await backend({ tls: true, cancelConnection: "other-certificate" });
  server.autoReply = false;
  await using sql = new SQL({ url: server.url, tls: { ca: tlsCert.cert }, max: 1, connectionTimeout: 5 });

  const query = sql`select pg_sleep(10)`.execute();
  const settled = query.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);
  query.cancel();

  await server.cancelConnectionClosed;
  expect({ plaintext: server.plaintext[1], cancelPacketSeen: server.cancelPacketSeen }).toEqual({
    plaintext: SSL_REQUEST,
    cancelPacketSeen: false,
  });

  server.reply(pgRowDescription([{ name: "v", typeOid: TEXT_OID }]), pgCommandComplete("SELECT 0"), pgReadyForQuery());
  expect(await settled).toEqual([]);
});

// The cancel connection dials the address of the session's peer, not its host
// name. The certificate still has to match the host name. This one names only
// `localhost`, so a check against the dialed address refuses it, as the session
// that is addressed by 127.0.0.1 shows.
test("cancel() on a verify-full session checks the certificate against the host name", async () => {
  const tls = { ca: hostNameOnlyTls.cert };
  {
    await using byAddress = await backend({ tls: true, certificate: hostNameOnlyTls });
    await using sql = new SQL({ url: byAddress.url, tls, max: 1, connectionTimeout: 5 });
    const err = await sql`select 1`.catch((e: any) => e);
    expect(err.message).toBe("Hostname/IP does not match certificate's altnames");
  }

  await using server = await backend({ tls: true, certificate: hostNameOnlyTls, host: "localhost" });
  server.autoReply = false;
  await using sql = new SQL({ url: server.url, tls, max: 1, connectionTimeout: 5 });

  const query = sql`select pg_sleep(10)`.execute();
  const settled = query.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);
  query.cancel();

  expect(await server.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));

  server.reply(
    pgErrorResponse({ S: "ERROR", C: "57014", M: "canceling statement due to user request" }),
    pgReadyForQuery(),
  );
  expect((await settled).errno).toBe("57014");
});

// URL parsing keeps the brackets of an IPv6 literal in the hostname. The session's
// connect strips them, so the cancel connection has to as well.
test.skipIf(!isIPv6())("cancel() reaches a server that is addressed by an IPv6 literal", async () => {
  await using server = await backend({ host: "::1" });
  server.autoReply = false;
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  const query = sql`select pg_sleep(10)`.execute();
  const settled = query.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);
  query.cancel();

  expect(await server.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));

  server.reply(
    pgErrorResponse({ S: "ERROR", C: "57014", M: "canceling statement due to user request" }),
    pgReadyForQuery(),
  );
  expect((await settled).errno).toBe("57014");
});

test.skipIf(isWindows)("cancel() reaches a server on a unix socket", async () => {
  using dir = tempDir("pg-cancel", {});
  const socketPath = join(String(dir), "pg.sock");
  await using server = await backend({ socketPath });
  server.autoReply = false;
  await using sql = new SQL({ adapter: "postgres", path: socketPath, username: "postgres", max: 1 });

  const query = sql`select pg_sleep(10)`.execute();
  const settled = query.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);
  query.cancel();

  expect(await server.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));

  server.reply(
    pgErrorResponse({ S: "ERROR", C: "57014", M: "canceling statement due to user request" }),
    pgReadyForQuery(),
  );
  expect((await settled).errno).toBe("57014");
});

// The cancel connection carries one packet. It must not turn into a session, with
// no timeout and no owner, because a server answers it.
test("the cancel connection closes when the server answers it", async () => {
  await using server = await backend({ cancelConnection: "answers" });
  server.autoReply = false;
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  const query = sql`select pg_sleep(10)`.execute();
  const settled = query.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);
  query.cancel();

  expect(await server.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));
  await server.cancelConnectionClosed;

  server.reply(
    pgErrorResponse({ S: "ERROR", C: "57014", M: "canceling statement due to user request" }),
    pgReadyForQuery(),
  );
  expect((await settled).errno).toBe("57014");
});

// The dial of the cancel connection is a TCP handshake and, for a TLS session, an
// SSLRequest and a TLS handshake. The query can end in that time, and a
// CancelRequest that is sent then stops the query that the backend runs next. So
// the cancel connection looks at its query again when the dial has ended, which
// for TLS is the end of the handshake.
test.each(["holds-ssl-answer", "holds-handshake"] as const)(
  "the cancel connection sends nothing when its query ended during the dial (%s)",
  async cancelConnection => {
    await using server = await backend({ tls: true, cancelConnection });
    server.autoReply = false;
    await using sql = new SQL({ url: server.url, tls: { ca: tlsCert.cert }, max: 1, connectionTimeout: 5 });

    const query = sql`select pg_sleep(10)`.execute();
    await server.untilQueryUnits(1);
    query.cancel();
    await server.cancelConnectionWaiting;

    // The query ends by itself while the cancel connection is held in its dial.
    server.reply(
      pgParseComplete(),
      pgParameterDescription([]),
      pgRowDescription([{ name: "v", typeOid: TEXT_OID }]),
      pgBindComplete(),
      pgDataRow([Buffer.from("done")]),
      pgCommandComplete("SELECT 1"),
      pgReadyForQuery(),
    );
    expect(await query).toEqual([{ v: "done" }]);

    await server.answerCancelConnection();
    await server.cancelConnectionClosed;
    expect(server.cancelPacketSeen).toBe(false);
  },
);

// reserved.close() cancels its running queries and closes the connection in the
// same tick, so the session is gone when the cancel connection is ready to write.
// The backend still runs the query, and nothing else of this client can reach that
// backend, so the CancelRequest has to go out.
test("cancel() still reaches the server when the session closes during the dial", async () => {
  await using server = await backend();
  server.autoReply = false;
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  const query = reserved`select pg_sleep(10)`.execute();
  const settled = query.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);

  await reserved.close();

  expect(await server.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));
  expect((await settled).code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
});

// The timeout of the cancel connection closes a dial that never completes, and
// the process has to exit then.
// Not on Windows and musl: the fixture loads glibc or libSystem for its raw listener.
test.skipIf(isWindows || isMusl)(
  "the process exits when the dial of the cancel connection never completes",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "postgres-pending-dial-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("ERR_POSTGRES_CONNECTION_CLOSED\n");
    expect(exitCode).toBe(0);
  },
);

// The first run of a statement sends its Parse together with the Bind and the
// Execute. A backend that waits for a lock waits inside that Parse, so the error
// of a cancel arrives with no ParseComplete before it. That error belongs to the
// cancelled query. A query with the same text that waits behind it shares the
// statement and has to parse it again.
test("cancel() during the Parse of a statement does not fail the queries that share it", async () => {
  await using server = await backend();
  server.autoReply = false;
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  const cancelled = sql`select 'shared'`.execute();
  const cancelledSettled = cancelled.then(
    rows => rows,
    err => err,
  );
  await server.untilQueryUnits(1);
  const waiting = sql`select 'shared'`.execute();
  const waitingSettled = waiting.then(
    rows => rows,
    err => err,
  );

  cancelled.cancel();
  expect(await server.cancelPacket).toEqual(pgCancelRequest(PROCESS_ID, SECRET_KEY));
  server.autoReply = true;
  server.reply(
    pgErrorResponse({ S: "ERROR", C: "57014", M: "canceling statement due to user request" }),
    pgReadyForQuery(),
  );

  expect((await cancelledSettled).errno).toBe("57014");
  expect(await waitingSettled).toEqual([{ v: "ok" }]);
  // The second unit is the Parse, Bind and Execute of the waiting query.
  expect(server.queryUnits).toBe(2);
});

test("cancel() before the query is dispatched rejects it instead of hanging", async () => {
  await using server = await backend();
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  // Tagged templates are lazy: nothing has been sent, and nothing ever will be,
  // so the first consumer of the promise has to reject it.
  const query = sql`select 1`;
  query.cancel();

  const err = await query.catch((e: any) => e);
  expect({ name: err.name, code: err.code, message: err.message }).toEqual({
    name: "PostgresError",
    code: "ERR_POSTGRES_QUERY_CANCELLED",
    message: "Query cancelled",
  });
  // The cancelled query never reaches the server: after a round trip for the next
  // query, that query is the only one the server has seen.
  expect(await sql`select 'next'`).toEqual([{ v: "ok" }]);
  expect(server.queryUnits).toBe(1);
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

  // No hint: this query never reaches the server.
  const err = await queuedSettled;
  expect({ name: err.name, code: err.code, message: err.message, hint: err.hint }).toEqual({
    name: "PostgresError",
    code: "ERR_POSTGRES_QUERY_CANCELLED",
    message: "Query cancelled",
    hint: undefined,
  });

  server.reply(
    pgRowDescription([{ name: "v", typeOid: TEXT_OID }]),
    pgDataRow([Buffer.from("kept")]),
    pgCommandComplete("SELECT 1"),
    pgReadyForQuery(),
  );

  expect(await runningSettled).toEqual([{ v: "kept" }]);
  // A cancel connection would have arrived by the end of one more round trip.
  server.autoReply = true;
  expect(await sql`select 'next'`).toEqual([{ v: "ok" }]);
  expect(server.connections).toBe(1);
});

// The connection counts queued requests whose bytes are not written yet, and only
// pipelines a prepared query at enqueue time while that count is zero. A queued
// query that is cancelled leaves the queue without ever being written, so it has
// to leave that count too, or the connection stops pipelining for good.
test("a connection still pipelines after a queued query on it was cancelled", async () => {
  await using server = await backend();
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  // Warm the statement so each later run of it is a bare Bind/Execute.
  expect(await sql`select 'p'`).toEqual([{ v: "ok" }]);
  server.autoReply = false;

  const running = sql`select 'kept'`.simple().execute();
  await server.untilQueryUnits(2);
  const queued = sql`select 'cancelled'`.simple().execute();
  const queuedSettled = queued.then(
    rows => rows,
    err => err,
  );
  queued.cancel();
  expect((await queuedSettled).code).toBe("ERR_POSTGRES_QUERY_CANCELLED");
  server.reply(
    pgRowDescription([{ name: "v", typeOid: TEXT_OID }]),
    pgDataRow([Buffer.from("kept")]),
    pgCommandComplete("SELECT 1"),
    pgReadyForQuery(),
  );
  expect(await running).toEqual([{ v: "kept" }]);

  // Both Bind/Execute units must reach the backend before it answers either:
  // the second one rides the wire behind the first instead of waiting for it.
  const first = sql`select 'p'`.execute();
  const second = sql`select 'p'`.execute();
  await server.untilQueryUnits(4);
  server.answerPrepared("first");
  server.answerPrepared("second");
  expect(await Promise.all([first, second])).toEqual([[{ v: "first" }], [{ v: "second" }]]);
});

// A reserved connection keeps its queries in a scope set, and close({ timeout })
// waits on that set. Only the query's own handler takes a cancelled query back out
// of it. A rejected query left in the set ends the wait at once, before the
// connection is closed, and the pool never gets the connection back.
test("a query cancelled before it runs leaves the scope of its reserved connection", async () => {
  await using server = await backend();
  await using sql = new SQL({ url: server.url, max: 1, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  const query = reserved`select 1`;
  query.cancel();
  const err = await query.catch((e: any) => e);
  expect(err.code).toBe("ERR_POSTGRES_QUERY_CANCELLED");

  await reserved.close({ timeout: 1 });
  await server.queryConnectionClosed;
  // Nothing was ever sent for the cancelled query, so there was nothing to cancel.
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

  // The hint tells this case apart from a query that was never sent: the backend
  // still runs this one, so a retry of a write would apply it twice.
  const err = await pipelinedSettled;
  expect({ name: err.name, code: err.code, message: err.message, hint: err.hint }).toEqual({
    name: "PostgresError",
    code: "ERR_POSTGRES_QUERY_CANCELLED",
    message: "Query cancelled",
    hint: "The server already received this query and still runs it. Bun discards the result.",
  });
  server.answerPrepared("kept");
  expect(await runningSettled).toEqual([{ v: "kept" }]);

  // The pipelined query's Bind/Execute were already on the wire, so the backend
  // answers it too. Those replies have to be consumed in order or the connection
  // desyncs, which the next query proves it did not.
  server.answerPrepared("drained");
  server.autoReply = true;
  expect(await sql`select 'c'`).toEqual([{ v: "ok" }]);
  // Two round trips after the cancel, a cancel connection would have arrived.
  expect(server.connections).toBe(1);
});

// The scripted backend compares the packet with `pgCancelRequest`, which this
// change also wrote. Here a real server is the judge of the bytes.
describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test("cancel() stops a query that a real server is running", async () => {
    await container.ready;
    const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
    await using sql = new SQL({ url, max: 1, connectionTimeout: 5 });
    await using observer = new SQL({ url, max: 1, connectionTimeout: 5 });

    const query = sql`select pg_sleep(30) as cancel_running_query`.execute();
    const settled = query.then(
      rows => rows,
      err => err,
    );
    // The backend is inside pg_sleep, so the server runs the query and does not only hold its bytes.
    const deadline = performance.now() + 4_000;
    while (true) {
      const seen = await observer`
        select state, wait_event from pg_stat_activity
        where query like '%cancel_running_query%' and pid <> pg_backend_pid()`;
      if (seen.some((row: any) => row.wait_event === "PgSleep")) break;
      if (performance.now() > deadline) throw new Error(`the query did not reach pg_sleep: ${JSON.stringify(seen)}`);
    }
    query.cancel();

    const err = await settled;
    expect({ code: err.code, errno: err.errno }).toEqual({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57014" });
    // The connection is in sync: the next query runs on it.
    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
  });
});
