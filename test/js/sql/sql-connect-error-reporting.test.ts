// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// During database-server startup (e.g. a postgres/mysql docker container that
// is still initializing), clients hit two socket-level failures that are not
// protocol errors: the connection is refused outright, or an intermediary
// (like the container port proxy) accepts the TCP connection and closes it
// with no data. Bun previously reported both as a generic
// ERR_POSTGRES_CONNECTION_CLOSED "Connection closed", which is misleading —
// the connection was never established. Refused connections are reported as
// ERR_*_CONNECTION_REFUSED and fail fast (nothing is listening; probes and
// healthchecks rely on the immediate error). Pre-handshake closes are
// reported as ERR_*_CONNECTION_FAILED and the pool retries them with backoff
// until connectionTimeout elapses while queries are waiting — so a server
// that becomes ready mid-startup is invisible to the application. Real
// server errors (e.g. 57P03 "the database system is starting up") and closes
// of established connections keep their existing reporting and are not
// retried. See https://github.com/oven-sh/bun/issues/16691.
//
// Uses plain TCP servers / closed ports so the tests run without Docker.

import { SQL } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import type net from "node:net";
import {
  closedPort,
  listeningServer,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgErrorResponse,
  pgReadyForQuery,
} from "./wire-frames";

// connectionTimeout (seconds, fractional allowed) bounds the connect-retry
// budget; keep it short in tests that expect the failure to surface. Tests
// that assert a retry COUNT need enough budget for the 40ms first backoff to
// fire on a slow debug/ASAN runner, so they use a larger value than tests
// that only assert the resulting error.
async function connectError(url: string, connectionTimeout = 1): Promise<any> {
  const db = new SQL({ url, max: 1, connectionTimeout });
  try {
    await db.connect();
    throw new Error("expected connect() to reject");
  } catch (err) {
    return err;
  } finally {
    await db.close({ timeout: 0 });
  }
}

function postgresAuthOkAndReady(socket: net.Socket) {
  socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
}

test("postgres: connection refused is reported distinctly and fails fast", async () => {
  const port = await closedPort();
  // Refused is not retried: with a retry budget this long, a retry would run into the test's timeout.
  const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`, 600);
  expect(err.message).toBe("Failed to connect");
  expect(err.code).toBe("ERR_POSTGRES_CONNECTION_REFUSED");
});

// Native code makes the error with no stack frames, so the print has no source of Bun's own modules.
test.each([
  ["postgres", "PostgresError", "ERR_POSTGRES_CONNECTION_REFUSED"],
  ["mysql", "MySQLError", "ERR_MYSQL_CONNECTION_REFUSED"],
])("%s: connection refused prints as the name, the message and the code", async (adapter, name, code) => {
  const port = await closedPort();
  const err = await connectError(`${adapter}://user@127.0.0.1:${port}/database`);
  expect(err).toBeInstanceOf(SQL.SQLError);
  expect(Bun.inspect(err, { colors: false })).toBe(`${name}: Failed to connect\n code: "${code}"\n\n`);
});

// The first read of `stack` of a native error makes it. To JavaScript it is a data property before and after, like
// the `stack` of every other Error.
describe.each([
  ["postgres", "PostgresError"],
  ["mysql", "MySQLError"],
])("%s: the stack of a connection refused error", (adapter, name) => {
  const stack = `${name}: Failed to connect`;
  // Each call gives an error whose stack nothing has read.
  const refused = async () => connectError(`${adapter}://user@127.0.0.1:${await closedPort()}/database`);

  test("is a data property before the first read", async () => {
    expect(Object.getOwnPropertyDescriptor(await refused(), "stack")).toEqual({
      value: stack,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  test("keeps the attributes that Object.defineProperty() gives it before the first read", async () => {
    const error = await refused();
    Object.defineProperty(error, "stack", { enumerable: true, configurable: false });
    expect({ stack: error.stack, descriptor: Object.getOwnPropertyDescriptor(error, "stack") }).toEqual({
      stack,
      descriptor: { value: stack, writable: true, enumerable: true, configurable: false },
    });
  });

  test("a frozen error stays frozen when the stack is read, printed, cloned or assigned", async () => {
    const errors = await Promise.all([refused(), refused(), refused(), refused()]);
    const [read, printed, cloned, assigned] = errors.map(error => Object.freeze(error));
    const first = read.stack;
    Bun.inspect(printed);
    structuredClone(cloned);
    // A module is strict code.
    expect(() => {
      assigned.stack = "assigned";
    }).toThrow(TypeError);
    expect({
      first,
      frozen: errors.map(error => Object.isFrozen(error)),
      stacks: errors.map(error => error.stack),
    }).toEqual({
      first: stack,
      frozen: [true, true, true, true],
      stacks: [stack, stack, stack, stack],
    });
  });

  test("a sealed error stays sealed when the stack is read or assigned", async () => {
    const errors = await Promise.all([refused(), refused()]);
    const [read, assigned] = errors.map(error => Object.seal(error));
    const first = read.stack;
    assigned.stack = "assigned";
    expect({
      first,
      sealed: errors.map(error => Object.isSealed(error)),
      assigned: assigned.stack,
    }).toEqual({
      first: stack,
      sealed: [true, true],
      assigned: "assigned",
    });
  });

  test("is the same through a Proxy, through an object that inherits from the error and for another receiver", async () => {
    const [proxied, inherited, received] = await Promise.all([refused(), refused(), refused()]);
    expect({
      proxy: new Proxy(proxied, {}).stack,
      inherits: Object.create(inherited).stack,
      receiver: Reflect.get(received, "stack", {}),
    }).toEqual({
      proxy: stack,
      inherits: stack,
      receiver: stack,
    });
  });

  test("an assignment before the first read goes where an assignment to a data property goes", async () => {
    const [direct, proxied, inherited, held] = await Promise.all([refused(), refused(), refused(), refused()]);
    direct.stack = "assigned";
    new Proxy(proxied, {}).stack = "assigned";
    const child = Object.create(inherited);
    child.stack = "assigned";
    const frozenReceiver = Object.freeze({});
    // The property of the error keeps its attributes. A new property of another object is enumerable.
    const assigned = { value: "assigned", writable: true, enumerable: false, configurable: true };
    expect({
      direct: Object.getOwnPropertyDescriptor(direct, "stack"),
      proxied: Object.getOwnPropertyDescriptor(proxied, "stack"),
      child: Object.getOwnPropertyDescriptor(child, "stack"),
      inherited: inherited.stack,
      frozenReceiver: [Reflect.set(held, "stack", "assigned", frozenReceiver), Reflect.ownKeys(frozenReceiver)],
      held: held.stack,
    }).toEqual({
      direct: assigned,
      proxied: assigned,
      child: { ...assigned, enumerable: true },
      inherited: stack,
      frozenReceiver: [false, []],
      held: stack,
    });
  });

  // Not concurrent: Error.prepareStackTrace is global.
  test("Error.prepareStackTrace runs once for each error, with no call sites", async () => {
    const [read, frozen] = await Promise.all([refused(), refused()]);
    const calls: unknown[] = [];
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = (error, callSites) => {
      calls.push([error === read ? "read" : error === frozen ? "frozen" : error, callSites.length]);
      return "prepared";
    };
    let stacks: unknown[];
    try {
      // Object.freeze() reads each property of the error, as it does for every Error. That read makes the stack.
      Object.freeze(frozen);
      stacks = [read.stack, read.stack, frozen.stack, frozen.stack];
    } finally {
      Error.prepareStackTrace = original;
    }
    expect({ calls, stacks, frozen: Object.isFrozen(frozen) }).toEqual({
      calls: [
        ["frozen", 0],
        ["read", 0],
      ],
      stacks: ["prepared", "prepared", "prepared", "prepared"],
      frozen: true,
    });
  });
});

// A store on a WebAssembly GC object aborts the process, so the fixture has a process of its own.
test("Reflect.set() of the stack of a connection refused error returns false for a WebAssembly GC object as the receiver", async () => {
  const fixture = /* js */ `
    // (type $s (struct (field (mut i32))))
    // (func (export "mk") (result (ref null $s)) struct.new_default $s)
    const bytes = new Uint8Array([
      0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
      1, 10, 2, 0x5f, 1, 0x7f, 1, 0x60, 0, 1, 0x63, 0,
      3, 2, 1, 1,
      7, 6, 1, 2, 0x6d, 0x6b, 0, 0,
      10, 7, 1, 5, 0, 0xfb, 1, 0, 0x0b,
    ]);
    const struct = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk();
    const results = [];
    for (const adapter of ["postgres", "mysql"]) {
      const url = adapter + "://user@127.0.0.1:" + process.env.CLOSED_PORT + "/database";
      const sql = new Bun.SQL({ url, max: 1, connectionTimeout: 1 });
      const error = await sql.connect().then(() => "connected", error => error);
      results.push([Reflect.set(error, "stack", "assigned", struct), error.stack]);
      await sql.close({ timeout: 0 });
    }
    console.log(JSON.stringify(results));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, CLOSED_PORT: String(await closedPort()) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // stderr is here so that a failure shows it. A sanitizer build can write to it.
  expect({ stdout: stdout.trim() && JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: [
      [false, "PostgresError: Failed to connect"],
      [false, "MySQLError: Failed to connect"],
    ],
    stderr: expect.any(String),
    exitCode: 0,
  });
});

test("postgres: connection closed before handshake completes is a connect failure", async () => {
  // What a docker port proxy does while the database inside is still
  // initializing: accept, then close with no data.
  const { port, server } = await listeningServer(socket => socket.destroy());
  try {
    // only the error is asserted, not a retry count: the smallest budget works
    const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`, 0.25);
    expect(err.message).toBe("Connection closed before the connection was established");
    expect(err.code).toBe("ERR_POSTGRES_CONNECTION_FAILED");
  } finally {
    server.close();
  }
});

test("postgres: connect failures are retried while queries wait", async () => {
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    connections++;
    socket.destroy();
  });
  try {
    // 0.5s budget: the first retry fires after a 40ms backoff, leaving plenty
    // of headroom for the >= 2 assertion below even on slow debug/ASAN lanes
    const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`, 0.5);
    expect(err.code).toBe("ERR_POSTGRES_CONNECTION_FAILED");
    // at least one retry happened; the exact count depends on machine speed
    expect(connections).toBeGreaterThanOrEqual(2);
  } finally {
    server.close();
  }
});

test("postgres: a server that becomes ready during the retry window is invisible to the application", async () => {
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    connections++;
    if (connections <= 2) {
      // still starting up: accept and close with no data
      socket.destroy();
      return;
    }
    socket.on("data", () => postgresAuthOkAndReady(socket));
  });
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    await db.connect();
    expect(connections).toBeGreaterThanOrEqual(3);
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("postgres: server ErrorResponse during startup is still surfaced (57P03)", async () => {
  // A real postgres that is up but still starting replies to the startup
  // message with FATAL 57P03 and closes. That error must win over the
  // socket close that follows it, and being a real server answer it must
  // not be retried.
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    connections++;
    socket.on("data", () => {
      socket.end(
        pgErrorResponse({
          S: "FATAL",
          V: "FATAL",
          C: "57P03",
          M: "the database system is starting up",
        }),
      );
    });
  });
  try {
    const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`);
    expect(err.message).toBe("the database system is starting up");
    expect(err.code).toBe("ERR_POSTGRES_SERVER_ERROR");
    expect(err.errno).toBe("57P03");
    expect(connections).toBe(1);
  } finally {
    server.close();
  }
});

test("postgres: established connection that closes keeps the plain message", async () => {
  // Minimal handshake: AuthenticationOk + ReadyForQuery, then close on the
  // first query so the failure happens on an established connection.
  const { port, server } = await listeningServer(socket => {
    let handshakeDone = false;
    socket.on("data", () => {
      if (handshakeDone) {
        socket.destroy();
        return;
      }
      handshakeDone = true;
      postgresAuthOkAndReady(socket);
    });
  });
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    await db.connect();
    await db`SELECT 1`;
    throw new Error("expected the query to reject");
  } catch (err: any) {
    expect(err.message).toBe("Connection closed");
    expect(err.code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("mysql: connection refused is reported distinctly and fails fast", async () => {
  const port = await closedPort();
  const err = await connectError(`mysql://root@127.0.0.1:${port}/mysql`, 600);
  expect(err.message).toBe("Failed to connect");
  expect(err.code).toBe("ERR_MYSQL_CONNECTION_REFUSED");
});

test("mysql: connection closed before handshake completes is a connect failure", async () => {
  const { port, server } = await listeningServer(socket => socket.destroy());
  try {
    // only the error is asserted, not a retry count: the smallest budget works
    const err = await connectError(`mysql://root@127.0.0.1:${port}/mysql`, 0.25);
    expect(err.message).toBe("Connection closed before the connection was established");
    expect(err.code).toBe("ERR_MYSQL_CONNECTION_FAILED");
  } finally {
    server.close();
  }
});

test("mysql: connect failures are retried while queries wait", async () => {
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    connections++;
    socket.destroy();
  });
  try {
    // 0.5s budget: the first retry fires after a 40ms backoff, leaving plenty
    // of headroom for the >= 2 assertion below even on slow debug/ASAN lanes
    const err = await connectError(`mysql://root@127.0.0.1:${port}/mysql`, 0.5);
    expect(err.code).toBe("ERR_MYSQL_CONNECTION_FAILED");
    // at least one retry happened; the exact count depends on machine speed
    expect(connections).toBeGreaterThanOrEqual(2);
  } finally {
    server.close();
  }
});

test("postgres: graceful close() resolves while a connect retry is pending", async () => {
  // close() with no timeout waits for pending queries; a query stuck behind
  // a retrying connection must not deadlock it.
  const firstConnection = Promise.withResolvers<void>();
  const { port, server } = await listeningServer(socket => {
    firstConnection.resolve();
    socket.destroy();
  });
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    const query = db`SELECT 1`.catch(err => err);
    await firstConnection.promise;
    await db.close();
    const err = await query;
    expect(["ERR_POSTGRES_CONNECTION_FAILED", "ERR_POSTGRES_CONNECTION_CLOSED"]).toContain(err.code);
  } finally {
    server.close();
  }
});

test("postgres: onclose fires once per closed connection, not per retry attempt", async () => {
  let connections = 0;
  let oncloseCalls = 0;
  const { port, server } = await listeningServer(socket => {
    connections++;
    socket.destroy();
  });
  const db = new SQL({
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    max: 1,
    // 0.5s: enough for the 40ms-backoff first retry (connections >= 2 below)
    // without waiting out a full second once the budget is exhausted
    connectionTimeout: 0.5,
    onclose: () => {
      oncloseCalls++;
    },
  });
  try {
    const err = await db.connect().catch(e => e);
    expect(err.code).toBe("ERR_POSTGRES_CONNECTION_FAILED");
    expect(connections).toBeGreaterThanOrEqual(2);
    expect(oncloseCalls).toBe(1);
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("postgres: connectionTimeout: 0 disables connect retries", async () => {
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    connections++;
    socket.destroy();
  });
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1, connectionTimeout: 0 });
  try {
    const err = await db.connect().catch(e => e);
    expect(err.code).toBe("ERR_POSTGRES_CONNECTION_FAILED");
    expect(connections).toBe(1);
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("mysql: graceful close() resolves while a connect retry is pending", async () => {
  const firstConnection = Promise.withResolvers<void>();
  const { port, server } = await listeningServer(socket => {
    firstConnection.resolve();
    socket.destroy();
  });
  const db = new SQL({ url: `mysql://root@127.0.0.1:${port}/mysql`, max: 1 });
  try {
    const query = db`SELECT 1`.catch(err => err);
    await firstConnection.promise;
    await db.close();
    const err = await query;
    expect(["ERR_MYSQL_CONNECTION_FAILED", "ERR_MYSQL_CONNECTION_CLOSED"]).toContain(err.code);
  } finally {
    server.close();
  }
});

test("mysql: onclose fires once per closed connection, not per retry attempt", async () => {
  let connections = 0;
  let oncloseCalls = 0;
  const { port, server } = await listeningServer(socket => {
    connections++;
    socket.destroy();
  });
  const db = new SQL({
    url: `mysql://root@127.0.0.1:${port}/mysql`,
    max: 1,
    // 0.5s: enough for the 40ms-backoff first retry (connections >= 2 below)
    // without waiting out a full second once the budget is exhausted
    connectionTimeout: 0.5,
    onclose: () => {
      oncloseCalls++;
    },
  });
  try {
    const err = await db.connect().catch(e => e);
    expect(err.code).toBe("ERR_MYSQL_CONNECTION_FAILED");
    expect(connections).toBeGreaterThanOrEqual(2);
    expect(oncloseCalls).toBe(1);
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

// Session setup: after the auth OK the driver sends `SET time_zone = '+00:00'`
// and holds the connection out of the pool until the OK arrives. These three
// tests fault-inject that window: the server errors the statement, closes the
// socket, or never answers.
function mysqlServerUpToAuthOk(onPostAuth: (socket: net.Socket, payload: Buffer) => void) {
  return listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        onPostAuth(socket, payload);
      });
    });
    socket.on("error", () => {});
  });
}

test("mysql: a server error during session setup surfaces the server message", async () => {
  const { port, server } = await mysqlServerUpToAuthOk(socket => {
    socket.write(mysqlErrPacket(1, 1298, "HY000", "Unknown or incorrect time zone: '+00:00'"));
  });
  try {
    const err = await connectError(`mysql://root@127.0.0.1:${port}/db`);
    expect(err.message).toBe("Unknown or incorrect time zone: '+00:00'");
    expect(err.code).toBe("ERR_MYSQL_SERVER_ERROR");
    expect(err.errno).toBe(1298);
    expect(err.sqlState).toBe("HY000");
  } finally {
    server.close();
  }
});

test("mysql: a socket close during session setup is a connect failure", async () => {
  const onconnect = mock();
  const { port, server } = await mysqlServerUpToAuthOk(socket => socket.destroy());
  const db = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0.25, onconnect });
  try {
    const err = await db.connect().catch(e => e);
    // onconnect only fires once the session setup OK arrives, so the close is
    // classified like any other pre-established close and retried.
    expect(err.message).toBe("Connection closed before the connection was established");
    expect(err.code).toBe("ERR_MYSQL_CONNECTION_FAILED");
    expect(onconnect).not.toHaveBeenCalled();
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("mysql: a server that never answers the session setup hits connectionTimeout", async () => {
  const { port, server } = await mysqlServerUpToAuthOk(() => {
    // swallow the SET time_zone query; the connection stays in session setup
  });
  try {
    const err = await connectError(`mysql://root@127.0.0.1:${port}/db`, 0.25);
    expect(err.code).toBe("ERR_MYSQL_CONNECTION_TIMEOUT");
    expect(err.message).toContain("during session setup");
  } finally {
    server.close();
  }
});

test("mysql: connectionTimeout: 0 disables connect retries", async () => {
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    connections++;
    socket.destroy();
  });
  const db = new SQL({ url: `mysql://root@127.0.0.1:${port}/mysql`, max: 1, connectionTimeout: 0 });
  try {
    const err = await db.connect().catch(e => e);
    expect(err.code).toBe("ERR_MYSQL_CONNECTION_FAILED");
    expect(connections).toBe(1);
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});
