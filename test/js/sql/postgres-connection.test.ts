// What a real server does on demand runs against the container.
// A mock is used for exact packet boundaries, for frames the container cannot be made to send, and to read the wire.
import { randomUUIDv7, SQL } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  describeWithContainer,
  expiredTls,
  isDebug,
  isLinux,
  isWindows,
  tls as localhostTls,
  tempDir,
} from "harness";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBackendKeyData,
  pgBindComplete,
  pgCancelRequest,
  pgCloseComplete,
  pgCommandComplete,
  pgCopyBothResponse,
  pgDataRow,
  pgDecodeBind,
  pgErrorResponse,
  pgHold,
  pgHoldingProxy,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgParseStartupMessage,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
  pgScramServer,
  pgSSLRequest,
  pgSSLResponse,
} from "./wire-frames";

const settledError = (e: any) => ({ code: e.code, errno: e.errno, message: e.message });
const settled = (promise: PromiseLike<unknown>) => promise.then(rows => [...(rows as unknown[])], settledError);

const adminShutdown = { S: "FATAL", C: "57P01", M: "terminating connection due to administrator command" };
const adminShutdownError = { code: "ERR_POSTGRES_SERVER_ERROR", errno: "57P01", message: adminShutdown.M };

/**
 * Answers every simple query with an empty result. `greeting(n)` is what the n-th connection (from 0) gets for its
 * StartupMessage, in one write.
 */
async function simpleQueryServer(greeting: (connection: number) => Buffer[]) {
  const sockets: net.Socket[] = [];
  const { port, server } = await listeningServer(socket => {
    const connection = sockets.push(socket) - 1;
    let buffered = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.once("data", () => {
      socket.write(Buffer.concat(greeting(connection)));
      socket.on("data", chunk => {
        buffered = pgReadFrontendMessages(Buffer.concat([buffered, chunk]), type => {
          if (type === 0x51 /* 'Q' */) socket.write(Buffer.concat([pgCommandComplete("SELECT 0"), pgReadyForQuery()]));
        });
      });
    });
  });
  return {
    url: `postgres://u@127.0.0.1:${port}/db`,
    port,
    sockets,
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

const ready = [pgAuthenticationOk(), pgReadyForQuery()];

describe.concurrent("a connection that the server ends in the read that established it", () => {
  const killFirst = (connection: number) => (connection === 0 ? [...ready, pgErrorResponse(adminShutdown)] : ready);

  test("is never reported as connected, and the pool goes on", async () => {
    await using server = await simpleQueryServer(killFirst);
    const events: string[] = [];
    await using sql = new SQL(server.url, {
      max: 1,
      onconnect: err => void events.push(err ? "connect failed" : "connected"),
      onclose: () => void events.push("closed"),
    });

    expect(await settled(sql`select 1`.simple())).toEqual(adminShutdownError);
    expect(events).not.toContain("connected");

    expect(await settled(sql`select 1`.simple())).toEqual([]);
    expect(events.filter(event => event === "connected")).toHaveLength(1);
    await sql.close();
  });

  test("rejects listen(), and the next listen() dials again", async () => {
    await using server = await simpleQueryServer(killFirst);
    await using sql = new SQL(server.url, { max: 1 });

    expect(await sql.listen("channel", () => {}).then(() => "subscribed", settledError)).toEqual(adminShutdownError);
    expect(await sql.listen("channel", () => {}).then(() => "subscribed", settledError)).toBe("subscribed");
  });
});

/** The established sockets to 127.0.0.1:`serverPort`, from the kernel's table. Linux. */
function clientSockets(serverPort: number) {
  const server = "0100007F:" + serverPort.toString(16).toUpperCase().padStart(4, "0");
  return readFileSync("/proc/self/net/tcp", "utf8")
    .split("\n")
    .map(line => line.trim().split(/\s+/))
    .filter(([, , remote, state]) => remote === server && state === "01")
    .map(([, local, , , , timer]) => ({ port: parseInt(local.split(":")[1], 16), timer }));
}

test.skipIf(!isLinux)("the socket of a failed connection is closed when onclose runs", async () => {
  await using server = await simpleQueryServer(() => ready);
  const closed = Promise.withResolvers<number>();
  await using sql = new SQL(server.url, {
    max: 1,
    onclose: () => closed.resolve(clientSockets(server.port).length),
  });
  await sql.connect();
  expect(clientSockets(server.port)).toHaveLength(1);

  // The server keeps its end open: only the client can have closed the socket.
  server.sockets[0].write(pgErrorResponse(adminShutdown));
  expect(await closed.promise).toBe(0);
});

describe.skipIf(!isLinux).concurrent("TCP keepalive", () => {
  /**
   * Seconds until the kernel probes the peer: Infinity when keepalive is off. The `tr` column is 02 while the keepalive
   * timer of a socket with nothing to retransmit is armed and 00 when no timer is; `tm->when` is what is left in 1/100 s.
   * It counts down from the idle time, which is 7200 s unless somebody sets it.
   */
  function keepaliveSeconds(serverPort: number) {
    const [{ timer }] = clientSockets(serverPort);
    const [active, when] = timer.split(":");
    if (active === "00") return Infinity;
    if (active === "02") return parseInt(when, 16) / 100;
    throw new Error(`the socket has data in flight (timer ${timer})`);
  }

  test("is on for a pooled connection", async () => {
    await using server = await simpleQueryServer(() => ready);
    await using sql = new SQL(server.url, { max: 1 });
    await sql.connect();
    expect(keepaliveSeconds(server.port)).toBeLessThanOrEqual(60);
  });

  test("is on for a connection that upgraded to TLS", async () => {
    await using server = await pgScramServer({ password: "pw", tls: localhostTls });
    await using sql = new SQL(`postgres://u:pw@127.0.0.1:${server.port}/db?sslmode=require`, { max: 1 });
    await sql.connect();
    expect(keepaliveSeconds(server.port)).toBeLessThanOrEqual(60);
  });
});

test("CopyBothResponse fails the connection", async () => {
  const { port, server } = await pgMockServer(type => (type === "Q" ? pgCopyBothResponse([]) : undefined));
  try {
    const closed = Promise.withResolvers<any>();
    await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1, onclose: closed.resolve });
    const expected = { code: "ERR_POSTGRES_COPY_NOT_SUPPORTED", message: "Streaming replication is not supported" };
    expect(await settled(sql`START_REPLICATION 0/0`.simple())).toMatchObject(expected);
    expect(settledError(await closed.promise)).toMatchObject(expected);
  } finally {
    server.close();
  }
});

// The handle hangs off the query under a symbol, so script can call run() with fewer arguments than the pool does.
test("the native query handle throws when run() misses an argument", async () => {
  const script = `
    const accepted = Promise.withResolvers();
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open: () => accepted.resolve(), data() {} } });
    const sql = new Bun.SQL("postgres://u@127.0.0.1:" + listener.port + "/db", { max: 1 });
    const query = sql\`select 1\`;
    query.execute();
    await accepted.promise;
    const internal = name => query[Object.getOwnPropertySymbols(query).find(symbol => symbol.description === name)];
    const connection = internal("adapter").connections.find(Boolean).connection;
    const thrown = (...args) => {
      try {
        internal("handle").run(...args);
      } catch (error) {
        return error.message;
      }
    };
    console.log(JSON.stringify([thrown(), thrown(connection)]));
    process.exit(0);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      JSON.stringify([
        "connection must be an instance of PostgresSQLConnection",
        "Expected query to be a Query for 'run'.",
      ]) + "\n",
    stderr: expect.any(String),
    exitCode: 0,
  });
});

// The container's messages are English. `S` is the severity in the language of the server, `V` is not translated.
test("a FATAL error for the query that runs closes the connection at once", async () => {
  const { port, server } = await pgMockServer(type =>
    type === "Q"
      ? pgErrorResponse({ ...adminShutdown, S: "FATAL in the language of the server", V: "FATAL" })
      : undefined,
  );
  try {
    const closed = Promise.withResolvers<any>();
    await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1, onclose: closed.resolve });
    expect(await settled(sql`select pg_sleep(10)`.simple())).toEqual(adminShutdownError);
    // The server keeps its end open.
    expect({ ...settledError(await closed.promise), severity: (await closed.promise).severity }).toEqual({
      ...adminShutdownError,
      severity: "FATAL",
    });
  } finally {
    server.close();
  }
});

test.skipIf(isWindows)("a unix socket that is not there rejects with the code of a refused connection", async () => {
  using dir = tempDir("postgres-no-socket", {});
  const socket = path.join(String(dir), "postgres.sock");
  await using sql = new SQL({ adapter: "postgres", path: socket, username: "u", database: "db", max: 1 });
  const err = await sql`select 1`.catch(e => e);
  expect(err).toBeInstanceOf(SQL.PostgresError);
  expect(settledError(err)).toEqual({
    code: "ERR_POSTGRES_CONNECTION_REFUSED",
    errno: undefined,
    message: `Failed to connect to ${socket}`,
  });
});

/**
 * Prepares and binds like a server, and answers a Bind with its first parameter in the column `v`. `bindError` can fail
 * a Bind. `wire` is what it was asked to Parse, Close and Bind. With `hold`, the ReadyForQuery after the first error
 * waits for `release()`.
 */
async function statementServer(
  bindError: (statement: string) => Parameters<typeof pgErrorResponse>[0] | undefined,
  hold = false,
) {
  const wire: string[] = [];
  let failed = false;
  let row: Buffer | null = null;
  const mock = await pgMockServer((type, body) => {
    if (type === "S") {
      const held = failed && hold;
      if (held) hold = false;
      failed = false;
      return held ? [pgHold, pgReadyForQuery()] : pgReadyForQuery();
    }
    // After an error a server skips what comes before the Sync.
    if (failed) return;
    switch (type) {
      case "P":
        wire.push("P " + body.toString("latin1", 0, body.indexOf(0)));
        return pgParseComplete();
      case "C":
        wire.push("C " + body.toString("latin1", 1, body.length - 1));
        return pgCloseComplete();
      case "D":
        return [pgParameterDescription([25]), pgRowDescription([{ name: "v", typeOid: 25 }])];
      case "B": {
        const { statement, params } = pgDecodeBind(body);
        wire.push("B " + statement);
        const error = bindError(statement);
        failed = error !== undefined;
        row = params[0];
        return error ? pgErrorResponse(error) : pgBindComplete();
      }
      case "E":
        return [pgDataRow([row]), pgCommandComplete("SELECT 1")];
    }
  });
  return {
    url: `postgres://u@127.0.0.1:${mock.port}/db`,
    wire,
    release: mock.release,
    [Symbol.dispose]: () => void mock.server.close(),
  };
}

describe.concurrent("a Bind that finds its prepared statement lost", () => {
  const lost = (statement: string) => ({
    S: "ERROR",
    C: "26000",
    M: `prepared statement "${statement}" does not exist`,
  });

  test("is retried once", async () => {
    let forgetful = false;
    using server = await statementServer(statement => (forgetful ? lost(statement) : undefined));
    await using sql = new SQL(server.url, { max: 1 });
    const echo = (v: string) => settled(sql`select ${v} as v`);
    expect(await echo("a")).toEqual([{ v: "a" }]);

    forgetful = true;
    expect(await echo("b")).toMatchObject({ errno: "26000", message: lost("P1").M });
    forgetful = false;
    expect(await echo("c")).toEqual([{ v: "c" }]);
    expect(server.wire).toEqual(["P P0", "B P0", "B P0", "C P0", "P P1", "B P1", "C P1", "P P2", "B P2"]);
  });

  // What is written behind a query runs whatever becomes of that query, so only the last one is written again.
  test("rejects every query of a burst on a server that keeps no statement", async () => {
    let forgetful = false;
    using server = await statementServer(statement => (forgetful ? lost(statement) : undefined));
    await using sql = new SQL(server.url, { max: 1 });
    const echo = (v: string) => settled(sql`select ${v} as v`);
    expect(await echo("a")).toEqual([{ v: "a" }]);

    forgetful = true;
    expect(await Promise.all([echo("b"), echo("c"), echo("d")])).toMatchObject([
      { errno: "26000", message: lost("P0").M },
      { errno: "26000", message: lost("P0").M },
      { errno: "26000", message: lost("P1").M },
    ]);
    forgetful = false;
    expect(await echo("e")).toEqual([{ v: "e" }]);
    expect(server.wire).toEqual([
      "P P0",
      "B P0",
      "B P0",
      "B P0",
      "B P0",
      "C P0",
      "P P1",
      "B P1",
      "C P1",
      "P P2",
      "B P2",
    ]);
  });

  // 0A000 is the code of every feature that is not supported.
  test("is told from another error by the routine that reports 0A000", async () => {
    let error: Parameters<typeof pgErrorResponse>[0] | undefined;
    using server = await statementServer(() => {
      const next = error;
      error = undefined;
      return next;
    });
    await using sql = new SQL(server.url, { max: 1 });
    const echo = (v: string) => settled(sql`select ${v} as v`);
    expect(await echo("a")).toEqual([{ v: "a" }]);

    error = { S: "ERROR", C: "0A000", M: "not supported", R: "exec_bind_message" };
    expect(await echo("b")).toMatchObject({ errno: "0A000", message: "not supported" });
    error = { S: "ERROR", C: "0A000", M: "cached plan must not change result type", R: "RevalidateCachedQuery" };
    expect(await echo("c")).toEqual([{ v: "c" }]);
    expect(server.wire).toEqual(["P P0", "B P0", "B P0", "B P0", "C P0", "P P1", "B P1"]);
  });

  // The server flushes an ErrorResponse, so the ReadyForQuery of the batch can come in a later read.
  test("is retried ahead of a query that is handed over before the ReadyForQuery of the failed batch", async () => {
    let forgotten: string | undefined;
    using server = await statementServer(statement => (statement === forgotten ? lost(statement) : undefined), true);
    await using sql = new SQL(server.url, { max: 1 });
    const echo = (v: string) => sql`select ${v} as v`;
    const other = (v: string) => sql`select ${v}::text as v`;
    expect([await echo("a"), await other("b")]).toEqual([[{ v: "a" }], [{ v: "b" }]]);

    forgotten = "P0";
    const ahead = other("c").execute();
    const retried = echo("d").execute();
    expect(await ahead).toEqual([{ v: "c" }]);
    const between = other("e").execute();
    server.release();
    expect(await Promise.all([retried, between])).toEqual([[{ v: "d" }], [{ v: "e" }]]);
    expect(server.wire.slice(4)).toEqual(["B P1", "B P0", "C P0", "P P2", "B P2", "B P1"]);
  });
});

/**
 * Simple queries only. A text with "nowhere" fails, and its ReadyForQuery waits for `release()`. After "begin" that
 * leaves the session in a failed transaction. A text with "pg_sleep" is answered by `wake()`.
 */
async function sessionsServer() {
  const sockets: net.Socket[] = [];
  const failed = new WeakSet<net.Socket>();
  const asked: number[] = [];
  const asleep = Promise.withResolvers<net.Socket>();
  const mock = await pgMockServer((type, body, socket) => {
    if (type !== "Q") return;
    if (!sockets.includes(socket)) sockets.push(socket);
    asked.push(sockets.indexOf(socket));
    if (body.includes("pg_sleep")) return asleep.resolve(socket);
    if (body.includes("nowhere")) {
      if (body.includes("begin")) failed.add(socket);
      return [pgErrorResponse(noTable), pgHold, pgReadyForQuery(failed.has(socket) ? "E" : "I")];
    }
    return failed.has(socket)
      ? [pgErrorResponse({ S: "ERROR", C: "25P02", M: "current transaction is aborted" }), pgReadyForQuery("E")]
      : [pgCommandComplete("SELECT 0"), pgReadyForQuery()];
  });
  return {
    ...mock,
    url: `postgres://u@127.0.0.1:${mock.port}/db`,
    sockets,
    /** The session, from 0, that each query went to. */
    asked,
    asleep: asleep.promise,
    wake: async () =>
      void (await asleep.promise).write(Buffer.concat([pgCommandComplete("SELECT 1"), pgReadyForQuery()])),
    [Symbol.dispose]: () => void mock.server.close(),
  };
}
const noTable = { S: "ERROR", C: "42P01", M: 'relation "nowhere" does not exist' };
const noTableError = { code: "ERR_POSTGRES_SERVER_ERROR", errno: "42P01", message: noTable.M };

// The server flushes an ErrorResponse, so the ReadyForQuery, which says what became of the transaction, can come in a
// later read.
describe("a query that failed", () => {
  test("rejects at its ReadyForQuery", async () => {
    using server = await sessionsServer();
    await using sql = new SQL(server.url, { max: 1 });
    let rejected = false;
    const query = settled(sql.unsafe("select * from nowhere").simple()).finally(() => (rejected = true));
    await server.held();
    expect(rejected).toBe(false);
    server.release();
    expect(await query).toEqual(noTableError);
  });

  test("rejects with the error of the server when the connection is lost before its ReadyForQuery", async () => {
    using server = await sessionsServer();
    await using sql = new SQL(server.url, { max: 1 });
    const query = settled(sql.unsafe("select * from nowhere").simple());
    await server.held();
    server.sockets[0].destroy();
    expect(await query).toEqual(noTableError);
  });

  test.each([
    [
      "in a transaction that it began leaves a connection that nobody gets",
      "select 1; begin; select * from nowhere",
      1,
    ],
    ["outside a transaction leaves a connection that the next query gets", "select 1; select * from nowhere", 0],
  ])("%s", async (_, text, next) => {
    using server = await sessionsServer();
    await using sql = new SQL(server.url, { max: 2 });
    const query = settled(sql.unsafe(text).simple());
    await server.held();
    server.release();
    expect([await query, await settled(sql.unsafe("select 2").simple()), server.asked]).toEqual([
      noTableError,
      [],
      [0, next],
    ]);
  });
});

// Without BackendKeyData there is no CancelRequest: cancel() rejects and the server goes on with the text.
test.each([1, 2])(
  "a reserved connection that comes back while a cancelled text runs is given to nobody (max: %i)",
  async max => {
    using server = await sessionsServer();
    await using sql = new SQL(server.url, { max });
    const reserved = await sql.reserve();
    const query = reserved.unsafe("begin; select pg_sleep(60)").simple().execute();
    await server.asleep;
    query.cancel();
    expect(await settled(query)).toMatchObject({ code: "ERR_POSTGRES_QUERY_CANCELLED" });
    reserved.release();
    expect([await settled(sql.unsafe("select 2").simple()), server.asked]).toEqual([[], [0, 1]]);
  },
);

test("a connection that is kept back for a cancelled text is given out again when the server has ended the text", async () => {
  using server = await sessionsServer();
  await using sql = new SQL(server.url, { max: 2 });
  // The other connection of the pool. It asks nothing, so the mock does not count it.
  await using _ = await sql.reserve();
  const cancelled: any = sql.unsafe("select pg_sleep(60)").simple().execute();
  const adapter = cancelled[Object.getOwnPropertySymbols(cancelled).find(symbol => symbol.description === "adapter")!];
  const inTransaction = () => adapter.connections.map((pooled: any) => pooled.connection.inTransaction);
  await server.asleep;
  const behind = settled(sql.unsafe("select 2").simple().execute());
  const seen = [inTransaction()];

  cancelled.cancel();
  expect(await settled(cancelled)).toMatchObject({ code: "ERR_POSTGRES_QUERY_CANCELLED" });
  seen.push(inTransaction());
  const waits = settled(sql.unsafe("select 3").simple());
  await server.wake();
  expect([await behind, await waits, server.asked]).toEqual([[], [], [0, 0, 0]]);
  seen.push(inTransaction());
  expect(seen).toEqual([
    [false, false],
    [false, true],
    [false, false],
  ]);
});

const cancelKey = [4242, 13371337] as const;
const canceled = { S: "ERROR", C: "57014", M: "canceling statement due to user request" };
const canceledError = { code: "ERR_POSTGRES_SERVER_ERROR", errno: "57014", message: canceled.M };
/** What cancel() rejects a query with by itself. The hint tells whether the server got the query. */
const cancelledUnsent = { code: "ERR_POSTGRES_QUERY_CANCELLED", message: "Query cancelled", hint: undefined };
const cancelledSent = {
  ...cancelledUnsent,
  hint: "The server has received the query and may still run it. Its result is discarded.",
};
const rejection = (promise: PromiseLike<unknown>) =>
  promise.then(
    () => "resolved",
    e => ({ code: e.code, message: e.message, hint: e.hint }),
  );

const described = (parameters: number) => [
  pgParseComplete(),
  pgParameterDescription(Array(parameters).fill(25)),
  pgRowDescription([{ name: "v", typeOid: 25 }]),
];
const rows = (...values: string[]) => [
  ...values.map(v => pgDataRow([Buffer.from(v)])),
  pgCommandComplete("SELECT " + values.length),
];
const bound = (v: string) => [pgBindComplete(), ...rows(v), pgReadyForQuery()];

/**
 * The first connection is a session. While `auto` is set it answers every batch with the row { v: "ok" }; else it leaves
 * a query unanswered, like a backend inside pg_sleep(), and the test writes the replies. A backend reads nothing while it
 * runs a query, so a CancelRequest comes on another connection: every later one is read for it. A server acts on it and
 * hangs up. `second` is a server that does something else.
 */
async function cancelServer(
  options: {
    /** Every connection has to start with an SSLRequest. */
    tls?: boolean;
    /** false: the session gets no BackendKeyData. */
    key?: boolean;
    socket?: string;
    second?: "answers" | "stays open" | "declines TLS" | "has another certificate" | "holds the SSLRequest";
  } = {},
) {
  const sockets: net.Socket[] = [];
  const requests: PromiseWithResolvers<Buffer>[] = [];
  const request = (n: number) => (requests[n] ??= Promise.withResolvers<Buffer>());
  const secondClosed = Promise.withResolvers<void>();
  const held = Promise.withResolvers<() => void>();
  const arrivals = new Map<number, () => void>();
  let session: net.Socket | undefined;
  let closed: Promise<void> | undefined;

  function serveSession(stream: net.Socket) {
    session = stream;
    let buffered = Buffer.alloc(0);
    let started = false;
    let reply: Buffer[] = [];
    stream.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!started) {
        const startup = pgParseStartupMessage(buffered);
        if (!startup) return;
        started = true;
        buffered = startup.rest;
        const key = options.key === false ? [] : [pgBackendKeyData(...cancelKey)];
        stream.write(Buffer.concat([pgAuthenticationOk(), ...key, pgReadyForQuery()]));
      }
      buffered = pgReadFrontendMessages(buffered, (type, body) => {
        const message = String.fromCharCode(type);
        server.messages += message;
        // Parse: String(statement) String(query) Int16(number of parameter types)
        if (message === "P") reply.push(...described(body.readInt16BE(body.indexOf(0, body.indexOf(0) + 1) + 1)));
        if (message === "B") reply.push(pgBindComplete(), ...rows("ok"));
        if (message === "Q") reply.push(described(0)[2], ...rows("ok"));
        if (message !== "S" && message !== "Q") return;
        if (server.auto) stream.write(Buffer.concat([...reply, pgReadyForQuery()]));
        reply = [];
        arrivals.get(++server.batches)?.();
      });
    });
  }

  function serveOther(stream: net.Socket) {
    let buffered = Buffer.alloc(0);
    stream.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 16) return;
      request(server.requested++).resolve(buffered);
      if (options.second === "answers") stream.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      else if (options.second !== "stays open") stream.end();
    });
  }

  function onSocket(raw: net.Socket) {
    const index = sockets.push(raw) - 1;
    const serve = index === 0 ? serveSession : serveOther;
    const second = index === 0 ? undefined : options.second;
    raw.on("error", () => {});
    if (index === 1) raw.on("close", () => secondClosed.resolve());
    if (!options.tls) return serve(raw);

    const onClear = (chunk: Buffer) => {
      const answered = index in server.clear;
      server.clear[index] = Buffer.concat([server.clear[index] ?? Buffer.alloc(0), chunk]);
      if (answered) return;
      if (second === "declines TLS") return void raw.write(pgSSLResponse("N"));
      const upgrade = () => {
        raw.removeListener("data", onClear);
        raw.pause();
        raw.write(pgSSLResponse("S"));
        const certificate = second === "has another certificate" ? expiredTls : localhostTls;
        const stream = new tls.TLSSocket(raw, { isServer: true, ...certificate });
        stream.on("error", () => {});
        serve(stream);
      };
      if (second === "holds the SSLRequest") held.resolve(upgrade);
      else upgrade();
    };
    raw.on("data", onClear);
  }

  const listener = net.createServer(onSocket);
  if (options.socket) listener.listen(options.socket);
  else listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = options.socket ? 0 : (listener.address() as net.AddressInfo).port;

  const server = {
    url: `postgres://u@127.0.0.1:${port}/db`,
    auto: false,
    sockets,
    /** The type of each message of the session after its StartupMessage. */
    messages: "",
    /** How many of them ended a batch: Sync, and the Query of the simple protocol. */
    batches: 0,
    /** What each connection sent before TLS. */
    clear: [] as Buffer[],
    /** The first 16 bytes or more that the n-th connection to send them sent, inside TLS if there is TLS. */
    request: (n = 0) => request(n).promise,
    requested: 0,
    secondClosed: secondClosed.promise,
    /** "holds the SSLRequest": resolves with the function that answers it. */
    held: held.promise,
    batch(n: number) {
      if (server.batches >= n) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      arrivals.set(n, resolve);
      return promise;
    },
    reply(...frames: Buffer[]) {
      session!.write(Buffer.concat(frames));
    },
    /** Whatever the client wrote before this call has arrived when it resolves. */
    async fence() {
      const socket = net.connect(port, "127.0.0.1", () => socket.end());
      await once(socket, "close");
    },
    /** Takes no more connections. */
    stopListening() {
      closed ??= new Promise<void>(resolve => listener.close(() => resolve()));
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      server.stopListening();
      await closed;
    },
  };
  return server;
}

describe.concurrent("cancel()", () => {
  type Server = Awaited<ReturnType<typeof cancelServer>>;
  /** A query that the server has got and does not answer. */
  async function running(server: Server, sql: SQL, mode = (query: SQL.Query<any>) => query) {
    const query = mode(sql`select pg_sleep(10)`).execute();
    const result = settled(query);
    await server.batch(server.batches + 1);
    return { query, result };
  }
  const stop = (server: Server) => server.reply(pgErrorResponse(canceled), pgReadyForQuery());
  const finish = (server: Server) => server.reply(...described(0), ...bound("done"));

  test.skipIf(isWindows)("reaches a server on a unix socket", async () => {
    using dir = tempDir("postgres-cancel", {});
    const socket = path.join(String(dir), "postgres.sock");
    await using server = await cancelServer({ socket });
    await using sql = new SQL({ adapter: "postgres", path: socket, username: "u", database: "db", max: 1 });
    const { query, result } = await running(server, sql);
    query.cancel();

    expect(await server.request()).toEqual(pgCancelRequest(...cancelKey));
    stop(server);
    expect(await result).toEqual(canceledError);
  });

  // The key of a session that is encrypted stops its queries. It goes to the server that the session trusts, encrypted.
  describe("of a query on a TLS session", () => {
    const verifyFull = { tls: { ca: localhostTls.cert }, max: 1 };

    test.each([
      ["verify-full", verifyFull],
      ["prefer", { max: 1 }],
    ])("sends the CancelRequest through TLS, sslmode=%s", async (sslmode, options) => {
      await using server = await cancelServer({ tls: true });
      await using sql = new SQL(`${server.url}?sslmode=${sslmode}`, options);
      const { query, result } = await running(server, sql);
      query.cancel();

      expect(await server.request()).toEqual(pgCancelRequest(...cancelKey));
      expect(server.clear).toEqual([pgSSLRequest(), pgSSLRequest()]);
      stop(server);
      expect(await result).toEqual(canceledError);
    });

    test.each([
      ["prefer", "declines TLS", { max: 1 }],
      ["verify-full", "has another certificate", verifyFull],
    ] as const)("sends nothing, sslmode=%s, to a server that %s, and rejects", async (sslmode, second, options) => {
      await using server = await cancelServer({ tls: true, second });
      await using sql = new SQL(`${server.url}?sslmode=${sslmode}`, options);
      const { query } = await running(server, sql);
      query.cancel();

      expect(await rejection(query)).toEqual(cancelledSent);
      await server.secondClosed;
      expect({ clear: server.clear[1], requested: server.requested }).toEqual({ clear: pgSSLRequest(), requested: 0 });
      finish(server);
      server.auto = true;
      expect(await sql`select 'next'`).toEqual([{ v: "ok" }]);
    });

    // A CancelRequest that is sent now would stop whatever the backend runs next.
    test("sends nothing when the query ended while the second connection was made", async () => {
      await using server = await cancelServer({ tls: true, second: "holds the SSLRequest" });
      await using sql = new SQL(`${server.url}?sslmode=verify-full`, verifyFull);
      const { query, result } = await running(server, sql);
      query.cancel();
      const answer = await server.held;

      finish(server);
      expect(await result).toEqual([{ v: "done" }]);
      answer();
      await server.secondClosed;
      expect(server.requested).toBe(0);
    });
  });

  test("the second connection does not become a session when the server answers it", async () => {
    await using server = await cancelServer({ second: "answers" });
    await using sql = new SQL(server.url, { max: 1 });
    const { query, result } = await running(server, sql);
    query.cancel();

    await server.secondClosed;
    stop(server);
    expect(await result).toEqual(canceledError);
  });

  // It has the connection timeout of the session, and at most 5 s, from the dial to the end.
  test("the second connection ends when the server neither answers nor hangs up", async () => {
    await using server = await cancelServer({ second: "stays open" });
    await using sql = new SQL(server.url, { max: 1, connectionTimeout: 1 });
    const { query, result } = await running(server, sql);
    query.cancel();

    await server.secondClosed;
    expect(server.requested).toBe(1);
    stop(server);
    expect(await result).toEqual(canceledError);
  });

  // The server deals with a CancelRequest before it hangs up. Until then the request can stop whatever the backend runs,
  // and on a pool that is the query of the next caller. The client waits 5 s for that: a run that needs longer from
  // cancel() to the fence finds the second batch written.
  test("the session writes nothing until the server has closed the second connection", async () => {
    await using server = await cancelServer({ second: "stays open" });
    await using sql = new SQL(server.url, { max: 1 });
    const { query, result } = await running(server, sql);
    query.cancel();
    await server.request();
    stop(server);
    expect(await result).toEqual(canceledError);

    server.auto = true;
    const next = sql`select 'next'`.execute();
    await server.fence();
    expect(server.batches).toBe(1);

    server.sockets[1].end();
    expect(await next).toEqual([{ v: "ok" }]);
  });

  // A CancelRequest stops what the backend runs when it arrives. With both cancelled, nobody waits for that. What is
  // handed over meanwhile is not written behind the second one, or nobody could ask for that one to be stopped.
  test.each(["after", "before"])(
    "of two queries that are written asks for each in its turn, the second connection closes %s the first is answered",
    async order => {
      await using server = await cancelServer({ second: "stays open" });
      await using sql = new SQL(server.url, { max: 1 });
      server.auto = true;
      await Promise.all([sql`select 'a'`, sql`select 'b'`]);
      server.auto = false;

      const [first, second] = [sql`select 'a'`.execute(), sql`select 'b'`.execute()];
      await server.batch(4);
      first.cancel();
      expect(await rejection(first)).toEqual(cancelledSent);
      await server.fence();
      expect(server.requested).toBe(0);
      second.cancel();
      expect(await rejection(second)).toEqual(cancelledSent);
      await server.request(0);
      const asked = server.sockets.at(-1)!;
      const next = sql`select 'a'`.execute();

      const steps = [() => stop(server), () => asked.end()];
      for (const step of order === "after" ? steps : steps.reverse()) {
        step();
        await server.fence();
        expect(server.batches).toBe(4);
      }
      expect(await server.request(1)).toEqual(pgCancelRequest(...cancelKey));
      stop(server);
      server.auto = true;
      server.sockets.at(-1)!.end();
      expect(await next).toEqual([{ v: "ok" }]);
      expect(server.requested).toBe(2);
    },
  );

  // The cancelled query can end by itself, and the signal would find the backend at work on the next one.
  test("of a query with another one written behind it asks for nothing, and that one runs once", async () => {
    await using server = await cancelServer();
    await using sql = new SQL(server.url, { max: 1 });
    server.auto = true;
    await Promise.all([sql`select 'a'`, sql`select 'b'`]);
    server.auto = false;

    const [cancelled, behind] = [sql`select 'a'`.execute(), sql`select 'b'`.execute()];
    await server.batch(4);
    cancelled.cancel();
    expect(await rejection(cancelled)).toEqual(cancelledSent);
    server.reply(...bound("discarded"));
    await server.fence();
    server.reply(...bound("kept"));
    expect(await behind).toEqual([{ v: "kept" }]);
    // The fence is the second connection.
    expect({
      messages: server.messages.slice(10),
      connections: server.sockets.length,
      asked: server.requested,
    }).toEqual({
      messages: "BESBES",
      connections: 2,
      asked: 0,
    });
  });

  // Some poolers send no BackendKeyData.
  test.each([
    ["gave no key", { key: false }],
    ["takes no second connection", {}],
  ])("of a query that runs on a server that %s rejects it and discards its result", async (_, options) => {
    await using server = await cancelServer(options);
    await using sql = new SQL(server.url, { max: 1 });
    const { query } = await running(server, sql);
    server.stopListening();
    query.cancel();
    expect(await rejection(query)).toEqual(cancelledSent);

    finish(server);
    server.auto = true;
    expect(await sql`select 'next'`).toEqual([{ v: "ok" }]);
    expect(server.sockets).toHaveLength(1);
  });

  test("during the Parse of a statement does not fail the query that waits for the statement", async () => {
    await using server = await cancelServer();
    await using sql = new SQL(server.url, { max: 1 });
    const cancelled = sql`select 'shared'`.execute();
    await server.batch(1);
    const waiting = sql`select 'shared'`.execute();
    cancelled.cancel();
    await server.request();

    server.auto = true;
    stop(server);
    expect(await settled(cancelled)).toEqual(canceledError);
    expect(await waiting).toEqual([{ v: "ok" }]);
    expect(server.messages).toBe("PDBESPDBES");
  });

  test("while only the Parse of the query is written rejects it, and the statement is prepared", async () => {
    await using server = await cancelServer();
    await using sql = new SQL(server.url, { max: 1 });
    const statement = (v: string) => sql`select ${v}::text as v`;
    const cancelled = statement("x").execute();
    await server.batch(1);
    cancelled.cancel();
    expect(await rejection(cancelled)).toEqual(cancelledUnsent);
    // A backend that waits for a lock waits inside Parse.
    expect(await server.request()).toEqual(pgCancelRequest(...cancelKey));

    server.reply(...described(1), pgReadyForQuery());
    server.auto = true;
    expect(await statement("y")).toEqual([{ v: "ok" }]);
    expect(server.messages).toBe("PDSBES");
  });

  test("from the code of a parameter rejects the query, and no Bind is written for it", async () => {
    await using server = await cancelServer();
    await using sql = new SQL(server.url, { max: 1 });
    const cancelsItself = () => {
      const query: SQL.Query<any> = sql`select ${{ toString: () => (query.cancel(), "x") }}::text as v`;
      return query.execute();
    };
    // The parameter is converted when the server has said what type it has.
    const first = cancelsItself();
    await server.batch(1);
    server.reply(...described(1), pgReadyForQuery());
    expect(await rejection(first)).toEqual(cancelledUnsent);
    // The statement is prepared: the parameter is converted in the call.
    expect(await rejection(cancelsItself())).toEqual(cancelledUnsent);

    server.auto = true;
    expect(await sql`select ${{ toString: () => "y" }}::text as v`).toEqual([{ v: "ok" }]);
    expect(server.messages).toBe("PDSBES");
  });

  test("of a query that is not written leaves the one that runs alone, and the connection goes on", async () => {
    await using server = await cancelServer();
    await using sql = new SQL(server.url, { max: 1 });
    server.auto = true;
    await sql`select 'prepared'`;
    server.auto = false;

    const { result } = await running(server, sql, query => query.simple());
    const queued = sql`select 'queued'`.simple().execute();
    queued.cancel();
    expect(await rejection(queued)).toEqual(cancelledUnsent);
    server.reply(described(0)[2], ...rows("done"), pgReadyForQuery());
    expect(await result).toEqual([{ v: "done" }]);

    // It still pipelines: both batches arrive before the first is answered.
    const both = [sql`select 'prepared'`.execute(), sql`select 'prepared'`.execute()];
    await server.batch(4);
    server.reply(...bound("first"), ...bound("second"));
    expect(await Promise.all(both)).toEqual([[{ v: "first" }], [{ v: "second" }]]);
    expect({ messages: server.messages, connections: server.sockets.length }).toEqual({
      messages: "PDBESQBESBES",
      connections: 1,
    });
  });

  test.each([
    ["rows", bound("discarded")],
    ["an error", [pgErrorResponse({ S: "ERROR", C: "22012", M: "division by zero" }), pgReadyForQuery()]],
  ])("of a query that is written behind the one that runs leaves that one alone, and skips %s", async (_, answer) => {
    await using server = await cancelServer();
    await using sql = new SQL(server.url, { max: 1 });
    server.auto = true;
    await Promise.all([sql`select 'a'`, sql`select 'b'`]);
    server.auto = false;

    const [head, behind] = [sql`select 'a'`.execute(), sql`select 'b'`.execute()];
    await server.batch(4);
    behind.cancel();
    expect(await rejection(behind)).toEqual(cancelledSent);
    server.reply(...bound("kept"), ...answer);
    expect(await head).toEqual([{ v: "kept" }]);

    const again = sql`select 'b'`.execute();
    await server.batch(5);
    server.reply(...bound("again"));
    expect(await again).toEqual([{ v: "again" }]);
    expect({ messages: server.messages.slice(10), connections: server.sockets.length }).toEqual({
      messages: "BESBESBES",
      connections: 1,
    });
  });
});

// A query knows its connection while it is in the queue of the connection.
test("a query that has settled does not keep its connection", async () => {
  const connections = () => heapStats().objectTypeCounts.PostgresSQLConnection ?? 0;
  Bun.gc(true);
  const before = connections();
  const kept: unknown[] = [];
  for (let round = 0; round < 5; round++) {
    await using server = await cancelServer();
    await using sql = new SQL(server.url, { max: 1 });
    server.auto = true;
    const resolved = sql`select 'a'`.execute();
    await resolved;
    server.auto = false;

    // The one that runs, one that is written behind it, one that is not written.
    const cancelled = [sql`select 'a'`.execute(), sql`select 'a'`.execute(), sql`select 'q'`.simple().execute()];
    const rejections = cancelled.map(rejection);
    await server.batch(3);
    for (const query of cancelled) query.cancel();
    await server.request();
    server.reply(pgErrorResponse(canceled), pgReadyForQuery(), ...bound("discarded"));
    expect(await Promise.all(rejections)).toEqual([cancelledSent, cancelledSent, cancelledUnsent]);
    kept.push(resolved, ...cancelled);
  }

  // Each round made a session and a second connection.
  for (let collections = 0; collections < 50 && connections() > before + 2; collections++) {
    Bun.gc(true);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(connections()).toBeLessThanOrEqual(before + 2);
  expect(kept).toHaveLength(20);
});

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = async (options: Bun.SQL.Options = {}) => {
    await container.ready;
    return new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max: 1, ...options });
  };

  test("a session the server ends while nothing is in flight closes with the server's error", async () => {
    const closed = Promise.withResolvers<any>();
    await using sql = await connect({ onclose: closed.resolve });
    await using other = await connect();
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;

    await other`select pg_terminate_backend(${pid})`;
    const err = await closed.promise;
    expect(err).toBeInstanceOf(SQL.PostgresError);
    expect(settledError(err)).toEqual(adminShutdownError);

    const [{ pid: next }] = await sql`select pg_backend_pid() as pid`;
    expect(next).not.toBe(pid);
  });

  /**
   * Resolves when `option`, 1 s, has closed a connection that is dialed in this call and then left alone. A timer of 1 s
   * that was started before the call has run out by then.
   */
  const outlast = async (option: string) => {
    const closed = Promise.withResolvers<unknown>();
    await using control = await connect({ [option]: 1, onclose: closed.resolve });
    await control.connect();
    await closed.promise;
  };

  const waitEvent = async (observer: SQL, pid: number) =>
    (await observer`select wait_event from pg_stat_activity where pid = ${pid}`)[0]?.wait_event;
  /** Resolves when the backend `pid` is inside pg_sleep(). */
  const asleep = async (observer: SQL, pid: number) => {
    while ((await waitEvent(observer, pid)) !== "PgSleep");
  };

  test.each([
    ["begin()", (sql: SQL) => sql.begin(tx => tx`select pg_backend_pid() as pid`)],
    [
      "reserve()",
      (sql: SQL) =>
        sql.reserve().then(async reserved => {
          using _ = reserved;
          return await reserved`select pg_backend_pid() as pid`;
        }),
    ],
  ])("a session the server ends while it runs a query is not given to the %s that waits for it", async (_, wait) => {
    await using sql = await connect();
    await using other = await connect();
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;
    const running = settled(sql`select pg_sleep(30)`);
    await asleep(other, pid);
    const waiting = settled(wait(sql));

    await other`select pg_terminate_backend(${pid})`;
    expect(await running).toEqual(adminShutdownError);
    expect(await waiting).toEqual([{ pid: expect.any(Number) }]);
    expect(await waiting).not.toEqual([{ pid }]);
  });

  describe("the transaction status", () => {
    test("is what the server said at the end of its last reply", async () => {
      await using sql = await connect();
      await using reserved = await sql.reserve();
      const query: any = reserved`select 1`;
      await query;
      const adapter = query[Object.getOwnPropertySymbols(query).find(symbol => symbol.description === "adapter")!];
      const connection: { inTransaction: boolean } = adapter.connections.find(Boolean).connection;

      const seen: [string, boolean][] = [["connected", connection.inTransaction]];
      for (const text of ["begin", "select 1", "select 1/0", "select 1", "rollback", "begin", "commit"]) {
        await settled(reserved.unsafe(text).simple());
        seen.push([text, connection.inTransaction]);
      }
      await reserved`begin`.simple();
      await reserved`select ${1}::int as x`;
      seen.push(["a prepared statement", connection.inTransaction]);
      await reserved`rollback`.simple();
      expect(seen).toEqual([
        ["connected", false],
        ["begin", true],
        ["select 1", true],
        ["select 1/0", true],
        ["select 1", true],
        ["rollback", false],
        ["begin", true],
        ["commit", false],
        ["a prepared statement", true],
      ]);
    });

    test.each([
      ["an open", "select 1"],
      ["a failed", "select 1/0"],
    ])("a reservation that is released in %s transaction does not leave it to the next caller", async (_, text) => {
      await using sql = await connect();
      const reserved = await sql.reserve();
      const [{ pid }] = await reserved`select pg_backend_pid() as pid`;
      await reserved`begin`.simple();
      await settled(reserved.unsafe(text).simple());
      reserved.release();

      expect((await sql`select pg_backend_pid() as pid`)[0].pid).not.toBe(pid);
    });

    describe("that comes in a later read than the ErrorResponse", () => {
      async function split(max: number) {
        await container.ready;
        const proxy = await pgHoldingProxy(container.host, container.port);
        const sql = new SQL(`postgres://bun_sql_test@127.0.0.1:${proxy.port}/bun_sql_test`, { max });
        return {
          proxy,
          sql,
          async [Symbol.asyncDispose]() {
            await sql.close({ timeout: 0 });
            proxy.server.close();
          },
        };
      }

      test.each([1, 2])(
        "a reserved connection that a cancelled text left in a failed transaction is given to nobody (max: %i)",
        async max => {
          await using session = await split(max);
          const { proxy, sql } = session;
          await using observer = await connect();
          const reserved = await sql.reserve();
          const [{ pid }] = await reserved`select pg_backend_pid() as pid`;
          const query = reserved.unsafe("begin; select pg_sleep(60)").simple().execute();
          const released = settled(query).then(error => (reserved.release(), error));
          await asleep(observer, pid);

          proxy.holdAfterError();
          query.cancel();
          await proxy.held();
          proxy.release();
          expect(await released).toEqual(canceledError);
          for (let caller = 0; caller < 2; caller++) {
            expect(await settled(sql`select 1 as x`)).toEqual([{ x: 1 }]);
          }
        },
      );

      test("a connection that a query on the pool left in a failed transaction is given to nobody", async () => {
        await using session = await split(2);
        const { proxy, sql } = session;
        await sql`select 1`;
        proxy.holdAfterError();
        const query = settled(sql.unsafe("select 1; begin; select * from nowhere; commit").simple());
        await proxy.held();
        proxy.release();
        expect(await query).toEqual(noTableError);
        expect(await settled(sql`select 1 as x`)).toEqual([{ x: 1 }]);
      });
    });
  });

  describe("cancel()", () => {
    test.each([
      ["a prepared statement", (query: SQL.Query<any>) => query],
      ["a simple query", (query: SQL.Query<any>) => query.simple()],
    ])("of %s that the server runs stops it, and the session goes on", async (_, mode) => {
      await using sql = await connect();
      await using other = await connect();
      const [{ pid }] = await sql`select pg_backend_pid() as pid`;
      const query = mode(sql`select pg_sleep(30)`).execute();
      await asleep(other, pid);
      query.cancel();

      expect(await settled(query)).toEqual(canceledError);
      expect(query.cancelled).toBe(true);
      expect(await sql`select pg_backend_pid() as pid`).toEqual([{ pid }]);
    });

    test("of the queries behind the one that runs leaves that one alone", async () => {
      await using sql = await connect();
      await sql`create temporary table marks (who text)`.simple();
      const mark = (who: string) => sql`insert into marks values (${who})`;
      const sleep = () => sql`select 1 as x from pg_sleep(${0.3})`;
      await Promise.all([mark("prepared"), sleep()]);

      const head = sleep().execute();
      const written = mark("written").execute();
      const unwritten = sql`insert into marks values ('unwritten')`.simple().execute();
      written.cancel();
      unwritten.cancel();
      expect(await Promise.all([rejection(written), rejection(unwritten)])).toEqual([cancelledSent, cancelledUnsent]);
      expect(await head).toEqual([{ x: 1 }]);
      expect(await sql`select who from marks where who <> 'written'`).toEqual([{ who: "prepared" }]);
    });

    test("of two queries that are written stops both", async () => {
      await using sql = await connect();
      await using other = await connect();
      const sleep = (seconds: number) => sql`select pg_backend_pid() as pid from pg_sleep(${seconds})`;
      const [{ pid }] = await sleep(0);
      const queries = [sleep(60).execute(), sleep(60).execute()];
      const rejections = queries.map(rejection);
      await asleep(other, pid);
      for (const query of queries) query.cancel();

      expect(await Promise.all(rejections)).toEqual([cancelledSent, cancelledSent]);
      expect(await sleep(0)).toEqual([{ pid }]);
    });

    test("of a query in a transaction rolls the transaction back", async () => {
      await using sql = await connect();
      await using other = await connect();
      await sql`create temporary table kept (x int)`.simple();
      const transaction = sql.begin(async tx => {
        const [{ pid }] = await tx`insert into kept values (1) returning pg_backend_pid() as pid`;
        const query = tx`select pg_sleep(30)`.execute();
        await asleep(other, pid);
        query.cancel();
        await query;
      });
      expect(await settled(transaction)).toEqual(canceledError);
      expect(await sql`select count(*)::int as rows from kept`).toEqual([{ rows: 0 }]);
    });

    // The query ends by itself at about the time the CancelRequest arrives.
    test("does not stop the query that follows on the connection", async () => {
      await using sql = await connect();
      for (let round = 0; round < 10; round++) {
        const query = sql`select 1 as x`.execute();
        query.cancel();
        await settled(query);
        expect(await settled(sql`select 2 as x from pg_sleep(0.01)`)).toEqual([{ x: 2 }]);
      }
    });

    /**
     * In front of the container. The first connection is the session: from `hold()` to `release()` the client does not
     * see what the server answers. Every other connection stops after its first bytes, the CancelRequest: `request`
     * resolves with the function that passes them on.
     */
    async function holdingProxy() {
      await container.ready;
      const sockets: net.Socket[] = [];
      let held: Buffer[] | undefined;
      const { port, server } = await listeningServer(client => {
        const upstream = net.connect(container.port, container.host);
        const isSession = sockets.push(client, upstream) === 2;
        client.on("error", () => {}).on("close", () => upstream.destroy());
        upstream.on("error", () => {}).on("close", () => client.destroy());
        upstream.on("data", chunk => void (held?.push(chunk) ?? client.write(chunk)));
        if (isSession) client.on("data", chunk => upstream.write(chunk));
        else client.once("data", chunk => proxy.request.resolve(() => upstream.write(chunk)));
      });
      const proxy = {
        url: `postgres://bun_sql_test@127.0.0.1:${port}/bun_sql_test`,
        request: Promise.withResolvers<() => void>(),
        hold() {
          held = [];
          proxy.request = Promise.withResolvers();
        },
        release() {
          sockets[0].write(Buffer.concat(held!));
          held = undefined;
        },
        async [Symbol.asyncDispose]() {
          for (const socket of sockets) socket.destroy();
          await new Promise<void>(resolve => server.close(() => resolve()));
        },
      };
      return proxy;
    }

    // To the client the first query still runs. The backend is in the procedure, behind its COMMIT, and a signal would
    // stop it there: what it has committed stays, so nobody can run it again, and nobody asked for it to be stopped.
    test("of a query with a CALL that commits written behind it leaves the CALL to run once", async () => {
      await using proxy = await holdingProxy();
      await using sql = new SQL(proxy.url, { max: 1 });
      await using other = await connect();
      await sql`
        create temporary table committed (tag int);
        create procedure pg_temp.commits(tag int, key bigint) language plpgsql as $$
          begin
            insert into committed values (tag);
            commit;
            perform pg_advisory_lock(key);
            perform pg_advisory_unlock(key);
          end
        $$`.simple();
      const first = () => sql`select pg_backend_pid() as pid`;
      const [{ pid }] = await first();
      const call = (tag: number) => sql`call pg_temp.commits(${tag}, ${pid})`;
      await call(0);

      await other`select pg_advisory_lock(${pid}::bigint)`;
      proxy.hold();
      let passOn: (() => void) | undefined;
      proxy.request.promise.then(pass => (passOn = pass));
      const cancelled = first().execute();
      const behind = settled(call(1).execute());
      cancelled.cancel();
      const rejected = rejection(cancelled);
      while ((await waitEvent(other, pid)) !== "advisory");
      // A CancelRequest that was dialed is at the proxy by now.
      if (passOn) {
        passOn();
        while ((await waitEvent(other, pid)) === "advisory");
      }
      await other`select pg_advisory_unlock(${pid}::bigint)`;
      proxy.release();

      expect({
        cancelled: await rejected,
        behind: await behind,
        committed: await sql`select tag, count(*)::int as rows from committed group by tag order by tag`,
      }).toEqual({
        cancelled: cancelledSent,
        behind: [],
        committed: [
          { tag: 0, rows: 1 },
          { tag: 1, rows: 1 },
        ],
      });
    });

    // The backend does not look at its socket while it runs the query.
    test("by reserved.close() stops the query on the server", async () => {
      await using sql = await connect();
      await using other = await connect();
      const reserved = await sql.reserve();
      const [{ pid }] = await reserved`select pg_backend_pid() as pid`;
      const query = settled(reserved`select pg_sleep(30)`);
      await asleep(other, pid);

      await reserved.close();
      expect(await query).toMatchObject({
        code: expect.stringMatching(/^ERR_POSTGRES_(CONNECTION_CLOSED|SERVER_ERROR)$/),
      });
      while ((await other`select 1 from pg_stat_activity where pid = ${pid}`).length > 0);
    });
  });

  // The timers are 1 s so that a slow build has finished the handshake before maxLifetime, which counts from the dial.
  describe.each([
    ["idleTimeout", "ERR_POSTGRES_IDLE_TIMEOUT"],
    ["maxLifetime", "ERR_POSTGRES_LIFETIME_TIMEOUT"],
  ])("%s", (option, code) => {
    test("lets a query in flight finish, then closes the connection", async () => {
      const closed = Promise.withResolvers<any>();
      await using sql = await connect({ [option]: 1, onclose: closed.resolve });
      const [{ pid }] = await sql`select pg_backend_pid() as pid`;

      expect(await settled(sql`select 42 as x from pg_sleep(1.5)`)).toEqual([{ x: 42 }]);
      const err = await closed.promise;
      expect(err).toBeInstanceOf(SQL.PostgresError);
      expect(err.code).toBe(code);

      const [{ pid: next }] = await sql`select pg_backend_pid() as pid`;
      expect(next).not.toBe(pid);
    });

    test("leaves a reserved connection alone while it is idle on the wire", async () => {
      await using sql = await connect({ [option]: 1 });
      using reserved = await sql.reserve();
      const [{ pid }] = await reserved`select pg_backend_pid() as pid`;
      await outlast(option);
      expect(await settled(reserved`select pg_backend_pid() as pid`)).toEqual([{ pid }]);
    });

    test("leaves a transaction alone while it is idle on the wire", async () => {
      await using sql = await connect({ [option]: 1 });
      const transaction = sql.begin(async tx => {
        const [{ pid }] = await tx`select pg_backend_pid() as pid`;
        await outlast(option);
        return [(await tx`select pg_backend_pid() as pid`)[0].pid === pid];
      });
      expect(await settled(transaction)).toEqual([true]);
    });
  });

  test("maxLifetime runs what is queued on the connection before it closes it", async () => {
    const closed = Promise.withResolvers<any>();
    await using sql = await connect({ maxLifetime: 1, onclose: closed.resolve });
    const early = [sql`select 0 as x from pg_sleep(2)`, sql`select ${1}::int as x`].map(settled);
    // Past the deadline, with the first query still running.
    await outlast("maxLifetime");
    const late = [sql`select ${2}::int + 0 as x`, sql`select 3 as x`.simple(), sql`select 4 as x`].map(settled);

    expect(await Promise.all([...early, ...late])).toEqual([
      [{ x: 0 }],
      [{ x: 1 }],
      [{ x: 2 }],
      [{ x: 3 }],
      [{ x: 4 }],
    ]);
    expect((await closed.promise).code).toBe("ERR_POSTGRES_LIFETIME_TIMEOUT");
  });

  describe("COPY without a stream", () => {
    const notSupported = {
      code: "ERR_POSTGRES_COPY_NOT_SUPPORTED",
      errno: undefined,
      message: "COPY ... FROM STDIN needs query.writable() and COPY ... TO STDOUT needs query.readable()",
    };
    const table = async (sql: SQL) => {
      await sql`create temporary table copied (a int); insert into copied values (1), (2)`.simple();
      return (await sql`select pg_backend_pid() as pid`)[0].pid as number;
    };
    const sameSession = (sql: SQL) => sql`select pg_backend_pid() as pid, count(*)::int as rows from copied`;

    describe.each([
      ["a prepared statement", {}, (query: SQL.Query<unknown>) => query],
      ["prepare: false", { prepare: false }, (query: SQL.Query<unknown>) => query],
      ["a simple query", {}, (query: SQL.Query<unknown>) => query.simple()],
    ])("in %s", (_, options, mode) => {
      // The second run of the prepared statement is a Bind of the cached one.
      test("FROM STDIN rejects and the session goes on", async () => {
        await using sql = await connect(options);
        const pid = await table(sql);
        for (let run = 0; run < 2; run++) {
          expect(await settled(mode(sql`copy copied from stdin`))).toEqual(notSupported);
          expect(await settled(sameSession(sql))).toEqual([{ pid, rows: 2 }]);
        }
      });

      test("TO STDOUT rejects and the session goes on", async () => {
        await using sql = await connect(options);
        const pid = await table(sql);
        for (let run = 0; run < 2; run++) {
          expect(await settled(mode(sql`copy copied to stdout`))).toEqual(notSupported);
          expect(await settled(sameSession(sql))).toEqual([{ pid, rows: 2 }]);
        }
      });
    });

    test("TO STDOUT between two statements of a simple query rejects the query", async () => {
      await using sql = await connect();
      const pid = await table(sql);
      const query = sql`insert into copied values (3); copy copied to stdout; select 7 as x`.simple();
      expect(await settled(query)).toEqual(notSupported);
      expect(await settled(sameSession(sql))).toEqual([{ pid, rows: 3 }]);
    });

    test("FROM STDIN in a transaction rolls it back", async () => {
      await using sql = await connect();
      const pid = await table(sql);
      const transaction = sql.begin(async tx => {
        await tx`insert into copied values (3)`;
        await tx`copy copied from stdin`;
      });
      expect(await settled(transaction)).toEqual(notSupported);
      expect(await settled(sameSession(sql))).toEqual([{ pid, rows: 2 }]);
    });

    test("a query queued behind FROM STDIN runs", async () => {
      await using sql = await connect();
      await table(sql);
      const both = [sql`copy copied from stdin`, sql`select count(*)::int as rows from copied where a > ${0}`];
      expect(await Promise.all(both.map(settled))).toEqual([notSupported, [{ rows: 2 }]]);
    });
  });

  describe("prepared statements", () => {
    // A simple query prepares nothing itself.
    const onServer = async (sql: SQL) =>
      [...(await sql`select name, statement from pg_prepared_statements order by prepare_time`.simple())].map(
        row => [row.name, row.statement] as [string, string],
      );

    test("NULL runs the statement that another value of the parameter prepared", async () => {
      await using sql = await connect();
      await sql`create temporary table nullable (id int, note text, n int, m int, at timestamptz, doc jsonb)`.simple();

      for (const note of ["a", null, "b"]) await sql`insert into nullable (id, note) values (${1}, ${note})`;
      for (const n of [null, 5, null]) await sql`insert into nullable (id, n) values (${2}, ${n})`;
      for (const m of [5, null, 6]) await sql`insert into nullable (id, m) values (${3}, ${m})`;
      for (let bits = 0; bits < 8; bits++) {
        const [note, at, doc] = ["x", new Date(0), { a: 1 }].map((value, i) => (bits & (1 << i) ? value : null));
        await sql`insert into nullable (note, at, doc) values (${note}, ${at}, ${doc})`;
      }
      for (let bits = 0; bits < 16; bits++) {
        const rows = [0, 1].map(i => ({
          id: 10 + i,
          note: bits & (1 << i) ? "x" : null,
          n: bits & (4 << i) ? 1 : null,
        }));
        await sql`insert into nullable ${sql(rows)}`;
      }

      expect(
        (await onServer(sql)).map(([, statement]) => statement.match(/^insert into nullable \((.*?)\)/)![1]),
      ).toEqual(["id, note", "id, n", "id, m", "note, at, doc", '"id", "note", "n"']);
      expect(await sql`select id, note, n, m from nullable where id in (1, 2, 3) order by id, note, n, m`).toEqual([
        { id: 1, note: "a", n: null, m: null },
        { id: 1, note: "b", n: null, m: null },
        { id: 1, note: null, n: null, m: null },
        { id: 2, note: null, n: 5, m: null },
        { id: 2, note: null, n: null, m: null },
        { id: 2, note: null, n: null, m: null },
        { id: 3, note: null, n: null, m: 5 },
        { id: 3, note: null, n: null, m: 6 },
        { id: 3, note: null, n: null, m: null },
      ]);
    });

    test("a text has one statement for each type its values declare", async () => {
      await using sql = await connect();
      const values = [1, "a", true, null, 2, "b", false, undefined];
      const results: unknown[] = [];
      for (const value of values) results.push((await sql`select ${value} as x`)[0].x);

      expect(results).toEqual([1, "a", true, null, 2, "b", false, null]);
      expect((await onServer(sql)).map(([name]) => name)).toEqual(["P0", "P1", "P2"]);
    });

    const numbered = (sql: SQL, i: number) => sql.unsafe(`select $1::int + ${i} as x`, [1]);
    const numbers = (statements: [string, string][]) =>
      statements.map(([, text]) => Number(text.match(/\+ (\d+)/)![1]));
    const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

    // 1,028 first runs take 15 s and more on an unoptimized build. There the MySQL rows at 256 cover the eviction.
    test.skipIf(isDebug)(
      "the connection keeps the 1,024 it used last and closes the others on the server",
      async () => {
        await using sql = await connect();
        // More than it keeps, handed over at once: a statement that a queued query is going to run is not closed.
        const results = await Promise.all(range(0, 1028).map(i => settled(numbered(sql, i))));
        expect(results).toEqual(range(0, 1028).map(i => [{ x: 1 + i }]));
        expect(numbers(await onServer(sql))).toEqual(range(4, 1028));

        await numbered(sql, 4);
        await numbered(sql, 1028);
        expect(numbers(await onServer(sql))).toEqual([4, ...range(6, 1029)]);

        // A closed one is prepared again, in place of the one that is now the oldest.
        expect(await numbered(sql, 0)).toEqual([{ x: 1 }]);
        expect(numbers(await onServer(sql))).toEqual([4, ...range(7, 1029), 0]);
      },
    );

    describe("that the server lost or cannot run any more", () => {
      const altered = async (sql: SQL) => {
        await sql`create temporary table altered (id int, a int); insert into altered values (1, 1)`.simple();
        return () => sql`select * from altered where id = ${1}`;
      };
      const addColumn = (sql: SQL, column: string) =>
        sql.unsafe(`alter table altered add column ${column} int`).simple();

      test("is prepared again after ALTER TABLE, and the old one is closed", async () => {
        await using sql = await connect();
        const select = await altered(sql);
        expect(await select()).toEqual([{ id: 1, a: 1 }]);

        await addColumn(sql, "b");
        expect(await settled(select())).toEqual([{ id: 1, a: 1, b: null }]);
        await addColumn(sql, "c");
        expect(await settled(select().values())).toEqual([[1, 1, null, null]]);
        expect(await settled(select())).toEqual([{ id: 1, a: 1, b: null, c: null }]);
        expect((await onServer(sql)).map(([name]) => name)).toEqual(["P2"]);
      });

      test("is prepared again after DEALLOCATE ALL, for the last query of a burst and for the next burst", async () => {
        await using sql = await connect();
        let conversions = 0;
        const burst = () =>
          Promise.all([
            ...range(0, 12).map(i => settled(sql.unsafe(`select $1::int + ${i % 3} as x`, [i]))),
            settled(sql`select 'no parameter' as x`),
            // One text, two statements: the second leaves the type to the server, which says int4 too.
            settled(sql`select ${7}::int as x`),
            settled(sql`select ${{ toString: () => (conversions++, "8") }}::int as x`),
          ]);
        const expected = [
          ...range(0, 12).map(i => [{ x: i + (i % 3) }]),
          [{ x: "no parameter" }],
          [{ x: 7 }],
          [{ x: 8 }],
        ];
        expect(await burst()).toEqual(expected);

        await sql`deallocate all`.simple();
        expect(await burst()).toEqual([...Array(14).fill(expect.objectContaining({ errno: "26000" })), [{ x: 8 }]]);
        expect(await burst()).toEqual(expected);
        // The last one of the burst before is prepared by now, the server has said int4, and so it takes the 7 too.
        expect(await onServer(sql)).toHaveLength(5);
        expect(conversions).toBe(3);
      });

      test.each([1, 4])("is prepared again for the next burst after ALTER TABLE, max: %i", async max => {
        await using sql = await connect({ max });
        const table = sql("altered_" + randomUUIDv7("hex"));
        await sql`create table ${table} (id int, a int)`;
        try {
          await sql`insert into ${table} values (1, 1)`;
          const burst = () => Promise.all(range(0, 20).map(() => settled(sql`select * from ${table} where id = ${1}`)));
          expect(await burst()).toEqual(Array(20).fill([{ id: 1, a: 1 }]));

          await sql`alter table ${table} add column b int`;
          // On each connection that had prepared it, every query but the last that is written there rejects.
          const results = await burst();
          const rejected = results.filter(result => !Array.isArray(result));
          expect(rejected).toEqual(Array(rejected.length).fill(expect.objectContaining({ errno: "0A000" })));
          expect(results.filter(Array.isArray)).toEqual(Array(20 - rejected.length).fill([{ id: 1, a: 1, b: null }]));
          // 19 on one connection. Of four, one may not have prepared it in the first burst.
          expect(rejected.length).toBeWithin(max === 1 ? 19 : 1, 21 - max);
          expect(await burst()).toEqual(Array(20).fill([{ id: 1, a: 1, b: null }]));
        } finally {
          await sql`drop table ${table}`;
        }
      });

      // A query holds the statement that was current when it was handed over. The last one here binds that, then the
      // one that was prepared for the query in the middle, which is lost or stale too by then.
      test.each([
        ["DEALLOCATE ALL twice", "deallocate all", "deallocate all", {}, {}],
        [
          "ALTER TABLE twice",
          "alter table altered add column b int",
          "alter table altered add column c int",
          { b: null },
          { b: null, c: null },
        ],
        ["DEALLOCATE ALL and ALTER TABLE", "deallocate all", "alter table altered add column b int", {}, { b: null }],
      ])("is prepared again for a query that is handed over before %s", async (_, first, second, middle, last) => {
        await using sql = await connect();
        const select = await altered(sql);
        await select();
        const row = { id: 1, a: 1 };
        expect(
          await Promise.all(
            [select(), sql.unsafe(first).simple(), select(), sql.unsafe(second).simple(), select()].map(settled),
          ),
        ).toEqual([[row], [], [{ ...row, ...middle }], [], [{ ...row, ...last }]]);
        expect(await settled(select())).toEqual([{ ...row, ...last }]);
        expect(await onServer(sql)).toHaveLength(1);
      });

      // The server refuses the Bind, so it has run nothing of the statement that is sent again.
      test("is prepared again for a CALL that commits, which runs once", async () => {
        await using sql = await connect();
        await sql`
          create temporary table committed (tag int);
          create procedure pg_temp.commits(tag int) language plpgsql as $$
            begin
              insert into committed values (tag);
              commit;
            end
          $$`.simple();
        const call = (tag: number) => sql`call pg_temp.commits(${tag})`;
        await call(0);
        expect((await onServer(sql)).map(([name]) => name)).toEqual(["P0"]);

        await sql`deallocate all`.simple();
        expect(await Promise.all([call(1), call(2)].map(settled))).toEqual([
          expect.objectContaining({ errno: "26000" }),
          [],
        ]);
        expect((await onServer(sql)).map(([name]) => name)).toEqual(["P1"]);
        expect(await sql`select tag, count(*)::int as rows from committed group by tag order by tag`.simple()).toEqual([
          { tag: 0, rows: 1 },
          { tag: 2, rows: 1 },
        ]);
      });

      // The second statement is still good. Once it is written, the server runs it whatever becomes of the first, so
      // the first rejects. A simple query is not written behind another one, so there the first is sent again, first.
      test.each([
        [
          "rejects with an UPDATE of the same row written behind it, and does not run after that",
          (sql: SQL) => sql`update altered set a = 2 where id = 1 returning *`,
          (sql: SQL) => sql`update altered set a = 3 where id = 1`,
          expect.objectContaining({ errno: "0A000" }),
          [{ id: 1, a: 3, b: null }],
        ],
        [
          "rejects with an UPDATE of the row that it inserts written behind it, and does not run after that",
          (sql: SQL) => sql`insert into altered (id, a) values (2, 2) returning *`,
          (sql: SQL) => sql`update altered set a = 3 where id = 2`,
          expect.objectContaining({ errno: "0A000" }),
          [{ id: 1, a: 1, b: null }],
        ],
        [
          "is prepared again and runs ahead of an UPDATE of the same row that waits behind it",
          (sql: SQL) => sql`update altered set a = 2 where id = 1 returning *`,
          (sql: SQL) => sql`update altered set a = 3 where id = 1`.simple(),
          [{ id: 1, a: 2, b: null }],
          [{ id: 1, a: 3, b: null }],
        ],
      ])("%s", async (_, stale, good, first, rows) => {
        await using sql = await connect();
        await altered(sql);
        // Both are prepared, and nothing of them stays.
        const prepared = sql.begin(async tx => {
          await Promise.all([stale(tx), good(tx)]);
          throw new Error("rolled back");
        });
        expect(await settled(prepared)).toMatchObject({ message: "rolled back" });
        await addColumn(sql, "b");

        expect(await Promise.all([stale(sql), good(sql)].map(settled))).toEqual([first, []]);
        expect(await sql`select * from altered order by id`.simple()).toEqual(rows);
        expect(await settled(stale(sql))).toHaveLength(1);
      });

      // A retry would get 25P02 in place of the reason.
      test("rejects with the server's error in a transaction, and is prepared again after it", async () => {
        await using sql = await connect();
        const select = await altered(sql);
        await select();
        await addColumn(sql, "b");

        const transaction = sql.begin(tx => tx`select * from altered where id = ${1}`);
        expect(await settled(transaction)).toMatchObject({
          errno: "0A000",
          message: "cached plan must not change result type",
        });
        expect(await settled(select())).toEqual([{ id: 1, a: 1, b: null }]);
      });

      test("is not what a query that raises the code itself gets: it runs once", async () => {
        await using sql = await connect();
        await sql`
          create temporary sequence calls;
          create function pg_temp.raises() returns int language plpgsql as $$
            begin
              perform nextval('calls');
              raise exception 'mine' using errcode = '26000';
            end
          $$`.simple();
        const call = () => settled(sql`select pg_temp.raises() as x`);
        expect([await call(), await call()]).toMatchObject(Array(2).fill({ errno: "26000", message: "mine" }));
        expect(await sql`select last_value::int as calls from calls`.simple()).toEqual([{ calls: 2 }]);
        expect((await onServer(sql)).map(([name]) => name)).toEqual(["P0"]);
      });
    });

    // The first read of values[0] starts another query on the same connection.
    function valuesThatStart(value: string, start: () => void) {
      let reads = 0;
      return Object.defineProperty([] as unknown[], 0, {
        enumerable: true,
        get() {
          if (++reads === 1) start();
          return value;
        },
      });
    }
    const prefix = "select /* forty characters of common prefix, and more */ ";

    test.each([
      ["on the pool", async (sql: SQL, run: (sql: SQL) => Promise<unknown>) => run(sql)],
      ["in a transaction", async (sql: SQL, run: (sql: SQL) => Promise<unknown>) => sql.begin(run)],
    ])("a query started while the values of another are read gets its own statement name, %s", async (_, scope) => {
      await using sql = await connect();
      const result = await scope(sql, async sql => {
        let nested: Promise<unknown> | undefined;
        const start = () => (nested = settled(sql.unsafe(prefix + "$1::text as nested", ["n"]).execute()));
        const outer = await settled(sql.unsafe(prefix + "$1::text as outer", valuesThatStart("o", start)));
        return { outer, nested: await nested };
      });
      expect(result).toEqual({ outer: [{ outer: "o" }], nested: [{ nested: "n" }] });
      expect(await onServer(sql)).toEqual([
        ["P0", prefix + "$1::text as nested"],
        ["P1", prefix + "$1::text as outer"],
      ]);
    });
  });
});

describeWithContainer("postgres_tls", { image: "postgres_tls" }, container => {
  // The second connection dials the address of the peer. The certificate names `localhost`, as for the session.
  test("cancel() stops a query on a verify-full session", async () => {
    await container.ready;
    const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test?sslmode=verify-full`;
    const ca = Bun.file(path.join(import.meta.dir, "docker-tls", "server.crt"));
    await using sql = new SQL(url, { max: 2, tls: { ca, serverName: "localhost" } });
    await using reserved = await sql.reserve();
    const [{ pid }] = await reserved`select pg_backend_pid() as pid`;
    const query = reserved`select pg_sleep(30)`.execute();
    while ((await sql`select wait_event from pg_stat_activity where pid = ${pid}`)[0]?.wait_event !== "PgSleep");
    query.cancel();

    expect(await settled(query)).toEqual(canceledError);
    expect(await reserved`select pg_backend_pid() as pid`).toEqual([{ pid }]);
  });
});
