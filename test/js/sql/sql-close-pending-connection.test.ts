// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

// https://github.com/oven-sh/bun/issues/32095
//
// A forced pool close (`close({ timeout: "0" })`) must resolve even when a
// pool connection has been accepted at the TCP level but the database
// handshake has not completed yet (a database that is still starting up).
// Previously the pending queries were rejected but the promise returned by
// close() stayed pending forever: the native close path emitted no socket
// event for in-flight connects, so the JS onclose callback never fired.
//
// connectionTimeout: 0 disables the connect timer, so close() is the only
// thing that can tear the connection down — without the fix these tests hang.

import { SQL } from "bun";
import { expect, mock, test } from "bun:test";
import { blackholePortSource, bunEnv, bunExe, isMusl, isWindows, tls as tlsCert } from "harness";
import net from "node:net";
import tls from "node:tls";
import {
  listeningServer,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlErrPacket,
  mysqlHandshakeV10,
  neverAnsweringServer,
  pgAuthenticationOk,
  pgErrorResponse,
  pgReadyForQuery,
  pgSSLResponse,
} from "./wire-frames";

const drivers = [
  ["postgres", "postgres://postgres@", "ERR_POSTGRES_CONNECTION_CLOSED", "ERR_POSTGRES_CONNECTION_TIMEOUT"],
  ["mysql", "mysql://root@", "ERR_MYSQL_CONNECTION_CLOSED", "ERR_MYSQL_CONNECTION_TIMEOUT"],
] as const;

// How each protocol gets to TLS: what the server says first, how long the client's plaintext
// request for TLS is, and what the server answers it with. `refusal` turns the client's first
// message over TLS down.
const startTls = {
  postgres: {
    greeting: undefined,
    requestLength: 8,
    answer: pgSSLResponse("S"),
    refusal: pgErrorResponse({ S: "FATAL", C: "53300", M: "too many connections" }),
    refusalCode: "ERR_POSTGRES_SERVER_ERROR",
  },
  mysql: {
    greeting: mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }),
    requestLength: 36,
    answer: undefined,
    refusal: mysqlErrPacket(3, 1040, "08004", "Too many connections"),
    refusalCode: "ERR_MYSQL_SERVER_ERROR",
  },
} as const;

/**
 * A server that completes the TLS handshake, takes the client's first message and from then on
 * reads nothing: a close_notify gets no answer. `silent` resolves once it has stopped reading,
 * to a function that sends the client `refusal`.
 */
async function silentAfterFirstMessageTlsServer(name: keyof typeof startTls) {
  const { greeting, requestLength, answer, refusal } = startTls[name];
  const silent = Promise.withResolvers<() => void>();
  const terminator = tls.createServer(tlsCert, socket => {
    socket.on("error", () => {});
    socket.once("data", () => silent.resolve(() => void socket.write(refusal)));
  });
  await new Promise<void>(resolve => terminator.listen(0, "127.0.0.1", resolve));
  const { port, server } = await listeningServer(client => {
    client.on("error", () => {});
    if (greeting) client.write(greeting);
    client.once("data", (chunk: Buffer) => {
      if (answer) client.write(answer);
      const upstream = net.connect((terminator.address() as net.AddressInfo).port, "127.0.0.1");
      upstream.on("error", () => {});
      upstream.write(chunk.subarray(requestLength));
      client.pipe(upstream).pipe(client);
      silent.promise.then(() => {
        client.unpipe(upstream);
        client.pause();
      });
    });
  });
  return {
    port,
    silent: silent.promise,
    close() {
      server.close();
      terminator.close();
    },
  };
}

for (const [name, scheme, closedCode, timeoutCode] of drivers) {
  test(`${name}: forced close() resolves while a connection is mid-handshake`, async () => {
    const { port, server, accepted } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const queryError = sql`SELECT 1`.catch(e => e);
      // the server holds the connection open without ever completing the
      // handshake, so the pool connection stays mid-handshake from here on
      await accepted;
      await sql.close({ timeout: "0" as any });
      expect((await queryError).code).toBe(closedCode);
    } finally {
      server.close();
    }
  });

  // https://github.com/oven-sh/bun/issues/39940
  //
  // close() used to fire the user's onclose callback once per pool slot in
  // the pending state, even when that slot's handshake never completed and
  // onconnect never fired, so onconnect/onclose pairing drifted by up to
  // `max` per pool close.
  test(`${name}: close() does not fire onclose for slots that never connected`, async () => {
    const { port, server, accepted } = await neverAnsweringServer();
    try {
      const onconnect = mock();
      const onclose = mock();
      const sql = new SQL({
        url: `${scheme}127.0.0.1:${port}/db`,
        max: 5,
        connectionTimeout: 0,
        onconnect,
        onclose,
      });
      const queryError = sql`SELECT 1`.catch(e => e);
      await accepted;
      await sql.close({ timeout: "0" as any });
      expect((await queryError).code).toBe(closedCode);
      expect(onconnect).not.toHaveBeenCalled();
      expect(onclose).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  test(`${name}: forced close() resolves when called before the native handle is stored`, async () => {
    const { port, server } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const connectError = sql.connect().catch(e => e);
      // close in the same tick: the pool slot exists but its native handle
      // has not been assigned yet
      await sql.close({ timeout: "0" as any });
      expect((await connectError).code).toBe(closedCode);
    } finally {
      server.close();
    }
  });

  // The timeout closes a socket whose TCP connect is still in flight. The event loop ref the
  // connection holds is released by the socket event that close raises.
  test.skipIf(isWindows || isMusl)(
    `${name}: the process exits after the connection timeout of a dial that never completes`,
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          ${blackholePortSource}
          const sql = new Bun.SQL({ url: "${scheme}127.0.0.1:" + port + "/db", max: 1, connectionTimeout: 0.05 });
          console.log(await sql\`SELECT 1\`.catch(err => err.code));
          filler.destroy();
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: timeoutCode + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );

  // A graceful TLS close waits for the peer's close_notify. A connection that failed does not.
  test.each([
    ["close()", `await sql.close({ timeout: "0" });`, closedCode],
    ["the server's refusal", "", startTls[name].refusalCode],
  ])(`${name}: the process exits after %s of a TLS connection whose peer reads nothing more`, async (_, act, code) => {
    const server = await silentAfterFirstMessageTlsServer(name);
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const sql = new Bun.SQL({
              url: "${scheme}127.0.0.1:${server.port}/db",
              max: 1,
              tls: { rejectUnauthorized: false },
              connectionTimeout: 0,
            });
            const query = sql\`SELECT 1\`.catch(err => err.code);
            // The peer reads nothing more.
            await Bun.stdin.text();
            ${act}
            console.log(await query);
            `,
        ],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      const refuse = await server.silent;
      if (!act) refuse();
      proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: code + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    } finally {
      server.close();
    }
  });
}

// https://github.com/oven-sh/bun/issues/39940
//
// The per-slot "fired onconnect" marker is per connect cycle. A slot that
// connected once, closed, and is now redialing must not reuse the marker from
// the previous cycle: a forced close() that lands mid-reconnect used to fire
// a second onclose for a cycle whose onconnect never fired.
test("postgres: close() mid-reconnect does not fire onclose for the unfinished cycle", async () => {
  const firstClose = Promise.withResolvers<void>();
  const onconnect = mock();
  const onclose = mock(() => firstClose.resolve());
  const secondAccepted = Promise.withResolvers<void>();
  let firstSocket: import("node:net").Socket;
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    if (++connections === 1) {
      firstSocket = socket;
      // complete the handshake so the slot fires onconnect
      socket.once("data", () => socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()])));
    } else {
      // the reconnect stays mid-handshake
      secondAccepted.resolve();
    }
  });
  try {
    const sql = new SQL({
      url: `postgres://postgres@127.0.0.1:${port}/postgres`,
      max: 1,
      connectionTimeout: 0,
      onconnect,
      onclose,
    });
    await sql.connect();
    expect(onconnect).toHaveBeenCalledTimes(1);
    // drop the connection from the server side; onclose pairs with onconnect
    firstSocket!.destroy();
    await firstClose.promise;
    expect(onclose).toHaveBeenCalledTimes(1);
    // a new query redials the closed slot, then close() lands mid-handshake
    const queryError = sql`SELECT 1`.catch(e => e);
    await secondAccepted.promise;
    await sql.close({ timeout: "0" as any });
    expect((await queryError).code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
    expect(onconnect).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledTimes(1);
  } finally {
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/32198
//
// The pool's connection array is allocated as `new Array(max)` and filled one
// slot at a time when the pool starts. A function-valued `password` option
// runs synchronously during that fill, so pool methods re-entered from it
// used to dereference unassigned slots and throw a raw TypeError.
test("pool scans tolerate unassigned connection slots during pool start", async () => {
  const { port, server } = await neverAnsweringServer();
  let passwordCalls = 0;
  const errors: unknown[] = [];
  const sql = new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port,
    username: "u",
    database: "d",
    max: 2,
    connectionTimeout: 0,
    password: () => {
      passwordCalls++;
      try {
        sql.flush();
      } catch (e) {
        errors.push(e);
      }
      try {
        sql.connect().catch(() => {});
      } catch (e) {
        errors.push(e);
      }
      return "";
    },
  });
  try {
    sql.connect().catch(() => {});
    // the pool-start fill loop runs synchronously inside connect(), invoking
    // password() once per pool slot
    expect(passwordCalls).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    // force an immediate close even with waiters queued
    await sql.close({ timeout: "0" as any });
    server.close();
  }
});
