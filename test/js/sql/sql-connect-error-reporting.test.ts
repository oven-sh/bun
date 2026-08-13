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
import { expect, setSystemTime, test } from "bun:test";
import type net from "node:net";
import {
  closedPort,
  listeningServer,
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

/** Minimal MySQL server: greet, then answer the HandshakeResponse with OK. */
function mysqlGreetAndAuthOk(socket: net.Socket) {
  let buffered = Buffer.alloc(0);
  let authenticated = false;
  socket.write(mysqlHandshakeV10());
  socket.on("data", chunk => {
    buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), seq => {
      if (authenticated) return;
      authenticated = true;
      socket.write(mysqlOkPacket(seq + 1));
    });
  });
}

test("postgres: connection refused is reported distinctly and fails fast", async () => {
  const port = await closedPort();
  const start = Date.now();
  const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`);
  expect(err.message).toBe("Failed to connect");
  expect(err.code).toBe("ERR_POSTGRES_CONNECTION_REFUSED");
  // refused is not retried: nothing is listening, fail well inside the budget
  expect(Date.now() - start).toBeLessThan(900);
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
  const start = Date.now();
  const err = await connectError(`mysql://root@127.0.0.1:${port}/mysql`);
  expect(err.message).toBe("Failed to connect");
  expect(err.code).toBe("ERR_MYSQL_CONNECTION_REFUSED");
  // refused is not retried: nothing is listening, fail well inside the budget
  expect(Date.now() - start).toBeLessThan(900);
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

// The retry budget is measured on the monotonic clock, so bun:test's
// setSystemTime() (which pins Date.now() at the given instant) neither keeps
// the pool retrying past connectionTimeout nor ends the budget early.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

test("postgres: the retry budget elapses while Date.now() is pinned by setSystemTime()", async () => {
  const { port, server } = await listeningServer(socket => socket.destroy());
  setSystemTime(new Date("2020-01-01T00:00:00Z"));
  try {
    // with the budget measured via Date.now() this never rejects: every
    // attempt sees 0ms elapsed and the pool redials forever
    const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`, 0.25);
    expect(err.code).toBe("ERR_POSTGRES_CONNECTION_FAILED");
  } finally {
    setSystemTime();
    server.close();
  }
});

test("postgres: setSystemTime() jumping ahead during a connect cycle does not end the retry budget", async () => {
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    if (++connections === 1) {
      // the pool recorded the start of this cycle before the jump; a Date.now()
      // budget would now see a day of the default 30s budget gone and give up
      setSystemTime(new Date(Date.now() + ONE_DAY_MS));
      socket.destroy();
      return;
    }
    socket.once("data", () => postgresAuthOkAndReady(socket));
  });
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    await db.connect();
    expect(connections).toBe(2);
  } finally {
    setSystemTime();
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("mysql: the retry budget elapses while Date.now() is pinned by setSystemTime()", async () => {
  const { port, server } = await listeningServer(socket => socket.destroy());
  setSystemTime(new Date("2020-01-01T00:00:00Z"));
  try {
    const err = await connectError(`mysql://root@127.0.0.1:${port}/mysql`, 0.25);
    expect(err.code).toBe("ERR_MYSQL_CONNECTION_FAILED");
  } finally {
    setSystemTime();
    server.close();
  }
});

test("mysql: setSystemTime() jumping ahead during a connect cycle does not end the retry budget", async () => {
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    if (++connections === 1) {
      setSystemTime(new Date(Date.now() + ONE_DAY_MS));
      socket.destroy();
      return;
    }
    mysqlGreetAndAuthOk(socket);
  });
  const db = new SQL({ url: `mysql://root@127.0.0.1:${port}/mysql`, max: 1 });
  try {
    await db.connect();
    expect(connections).toBe(2);
  } finally {
    setSystemTime();
    await db.close({ timeout: 0 });
    server.close();
  }
});
