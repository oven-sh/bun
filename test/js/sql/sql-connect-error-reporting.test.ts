// During database-server startup (e.g. a postgres/mysql docker container that
// is still initializing), clients hit two socket-level failures that are not
// protocol errors: the connection is refused outright, or an intermediary
// (like the container port proxy) accepts the TCP connection and closes it
// with no data. Bun previously reported both as a generic
// ERR_POSTGRES_CONNECTION_CLOSED "Connection closed", which is misleading —
// the connection was never established. Both are now reported as
// ERR_*_CONNECTION_FAILED with a message saying what actually happened, while
// real server errors (e.g. 57P03 "the database system is starting up") and
// closes of established connections keep their existing reporting.
// See https://github.com/oven-sh/bun/issues/16691.
//
// Uses plain TCP servers / closed ports so the tests run without Docker.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "node:net";

async function listeningServer(onSocket: (socket: net.Socket) => void): Promise<{ port: number; server: net.Server }> {
  const server = net.createServer(onSocket);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as net.AddressInfo).port, server };
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function connectError(url: string): Promise<any> {
  const db = new SQL({ url, max: 1 });
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
  const authOk = Buffer.alloc(9);
  authOk.write("R", 0);
  authOk.writeInt32BE(8, 1);
  authOk.writeInt32BE(0, 5);
  const ready = Buffer.alloc(6);
  ready.write("Z", 0);
  ready.writeInt32BE(5, 1);
  ready.write("I", 5);
  socket.write(Buffer.concat([authOk, ready]));
}

test("postgres: connection refused is reported as a connect failure, not a closed connection", async () => {
  const port = await closedPort();
  const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`);
  expect(err.message).toBe("Failed to connect");
  expect(err.code).toBe("ERR_POSTGRES_CONNECTION_FAILED");
});

test("postgres: connection closed before handshake completes is a connect failure", async () => {
  // What a docker port proxy does while the database inside is still
  // initializing: accept, then close with no data.
  const { port, server } = await listeningServer(socket => socket.destroy());
  try {
    const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`);
    expect(err.message).toBe("Connection closed before the connection was established");
    expect(err.code).toBe("ERR_POSTGRES_CONNECTION_FAILED");
  } finally {
    server.close();
  }
});

test("postgres: server ErrorResponse during startup is still surfaced (57P03)", async () => {
  // A real postgres that is up but still starting replies to the startup
  // message with FATAL 57P03 and closes. That error must win over the
  // socket close that follows it.
  const { port, server } = await listeningServer(socket => {
    socket.on("data", () => {
      const fields: [string, string][] = [
        ["S", "FATAL"],
        ["V", "FATAL"],
        ["C", "57P03"],
        ["M", "the database system is starting up"],
      ];
      let len = 4;
      for (const [, v] of fields) len += 1 + v.length + 1;
      len += 1;
      const buf = Buffer.alloc(1 + len);
      let o = 0;
      buf.write("E", o++);
      buf.writeInt32BE(len, o);
      o += 4;
      for (const [k, v] of fields) {
        buf.write(k, o++);
        buf.write(v + "\0", o);
        o += v.length + 1;
      }
      buf[o] = 0;
      socket.end(buf);
    });
  });
  try {
    const err = await connectError(`postgres://postgres@127.0.0.1:${port}/postgres`);
    expect(err.message).toBe("the database system is starting up");
    expect(err.code).toBe("ERR_POSTGRES_SERVER_ERROR");
    expect(err.errno).toBe("57P03");
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

test("mysql: connection refused is reported as a connect failure, not a closed connection", async () => {
  const port = await closedPort();
  const err = await connectError(`mysql://root@127.0.0.1:${port}/mysql`);
  expect(err.message).toBe("Failed to connect");
  expect(err.code).toBe("ERR_MYSQL_CONNECTION_FAILED");
});

test("mysql: connection closed before handshake completes is a connect failure", async () => {
  const { port, server } = await listeningServer(socket => socket.destroy());
  try {
    const err = await connectError(`mysql://root@127.0.0.1:${port}/mysql`);
    expect(err.message).toBe("Connection closed before the connection was established");
    expect(err.code).toBe("ERR_MYSQL_CONNECTION_FAILED");
  } finally {
    server.close();
  }
});
