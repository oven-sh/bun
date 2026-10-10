// Pool slot accounting across the paths that hand a connection back to the pool.
// The mock servers record every statement per connection, so a transaction that
// lands on a connection somebody else still holds shows up in the recorded order.
// They also drop the socket on demand, which a real container will not do.
// Wire bytes come from ./wire-frames.ts.
import { SQL } from "bun";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isCI, isDockerEnabled } from "harness";
import { once } from "node:events";
import type net from "node:net";
import { connect } from "node:net";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgCommandComplete,
  pgInt32,
  pgRaw,
  pgReadyForQuery,
} from "./wire-frames";

type Received = { conn: number; sql: string };
type MockServer = (received: Received[]) => Promise<{ port: number; server: net.Server }>;

// Query text containing "KILL" destroys the socket without answering.
const pgMockServer: MockServer = received => {
  let nextConn = 0;
  return listeningServer(socket => {
    const connId = nextConn++;
    let buffered = Buffer.alloc(0);
    let startup = true;
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (startup) {
        if (buffered.length < 4) return;
        const len = buffered.readInt32BE(0);
        if (buffered.length < len) return;
        buffered = buffered.subarray(len);
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      }
      while (buffered.length >= 5) {
        const type = String.fromCharCode(buffered[0]);
        const len = buffered.readInt32BE(1);
        if (buffered.length < 1 + len) return;
        const body = buffered.subarray(5, 1 + len);
        buffered = buffered.subarray(1 + len);
        if (type !== "Q") continue;
        const sql = body.subarray(0, body.indexOf(0)).toString("utf8");
        received.push({ conn: connId, sql });
        if (sql.includes("KILL")) {
          socket.destroy();
          return;
        }
        socket.write(Buffer.concat([pgCommandComplete("SELECT 0"), pgReadyForQuery()]));
      }
    });
    socket.on("error", () => {});
  });
};

const mysqlMockServer: MockServer = received => {
  const COM_QUIT = 0x01;
  const COM_QUERY = 0x03;
  let nextConn = 0;
  return listeningServer(socket => {
    const connId = nextConn++;
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
        if (mysqlAckSessionSetup(socket, payload)) return;
        if (payload[0] === COM_QUERY) {
          const sql = payload.subarray(1).toString("utf8");
          received.push({ conn: connId, sql });
          if (sql.includes("KILL")) {
            socket.destroy();
            return;
          }
          socket.write(mysqlOkPacket(1));
        } else if (payload[0] === COM_QUIT) {
          socket.end();
        }
      });
    });
    socket.on("error", () => {});
  });
};

// Returns the first nested BEGIN or unmatched COMMIT/ROLLBACK per connection, or null.
function firstInterleaving(received: Received[]): string | null {
  const depth = new Map<number, number>();
  for (const { conn, sql } of received) {
    const word = sql.split(/\s+/, 1)[0].toUpperCase();
    const d = depth.get(conn) ?? 0;
    if (word === "BEGIN" || word === "START") {
      if (d !== 0) return `${word} inside an open transaction on conn ${conn}: ${JSON.stringify(received)}`;
      depth.set(conn, 1);
    } else if (word === "COMMIT" || word === "ROLLBACK") {
      if (d !== 1) return `${word} with no open transaction on conn ${conn}: ${JSON.stringify(received)}`;
      depth.set(conn, 0);
    }
  }
  return null;
}

const adapters: Array<{ adapter: "postgres" | "mysql"; mockServer: MockServer; beginCommand: string }> = [
  { adapter: "postgres", mockServer: pgMockServer, beginCommand: "BEGIN" },
  { adapter: "mysql", mockServer: mysqlMockServer, beginCommand: "START TRANSACTION" },
];

// reserved.begin() / beginDistributed() calls that reject before anything is sent.
const rejectedBeforeBegin = [
  {
    name: "begin() with invalid options",
    begin: (reserved: Bun.ReservedSQL) => reserved.begin("read-only", async () => "unreachable"),
    message: "Transaction options can only contain letters, spaces, and commas.",
  },
  {
    name: "beginDistributed() with an invalid name",
    begin: (reserved: Bun.ReservedSQL) => reserved.beginDistributed("bad'name", async () => "unreachable"),
    message: "This adapter doesn't support distributed transactions.",
  },
];

describe.each(adapters)("$adapter", ({ adapter, mockServer, beginCommand }) => {
  const options = (port: number): Bun.SQL.Options => ({
    adapter,
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "p",
    database: "db",
    max: 1,
    tls: false,
    idleTimeout: 5,
  });

  test("concurrent sql.begin() stays serialized after a server-side disconnect with queries in flight", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");

      // Two queries are bound to the slot when the server drops it.
      const die1 = sql.unsafe("SELECT 'KILL'").execute();
      const die2 = sql.unsafe("SELECT 'never sent'").execute();
      const [e1, e2] = await Promise.all([
        die1.then(
          () => null,
          e => e,
        ),
        die2.then(
          () => null,
          e => e,
        ),
      ]);
      expect(e1).toBeInstanceOf(Error);
      expect(e2).toBeInstanceOf(Error);

      await sql.unsafe("SELECT 'revive'");

      const pa = sql.unsafe("SELECT 'Pa'").execute();
      const pb = sql.unsafe("SELECT 'Pb'").execute();
      const t1 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        await tx.unsafe("SELECT 'T1b'");
        return "t1";
      });
      const t2 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T2a'");
        throw new Error("t2-app-error");
      });
      const t3 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T3a'");
        await tx.unsafe("SELECT 'T3b'");
        return "t3";
      });

      const results = await Promise.allSettled([pa, pb, t1, t2, t3]);

      expect(results[2]).toEqual({ status: "fulfilled", value: "t1" });
      expect(results[3].status).toBe("rejected");
      expect((results[3] as PromiseRejectedResult).reason?.message).toBe("t2-app-error");
      expect(results[4]).toEqual({ status: "fulfilled", value: "t3" });

      expect(firstInterleaving(received)).toBeNull();
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("a pool slot is reusable after a server-side disconnect during sql.reserve()", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const err = await (async () => {
        await using r = await sql.reserve();
        await r.unsafe("SELECT 'KILL'");
      })().then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(Error);

      await sql.unsafe("SELECT 'revive'");
      const t1 = await sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        return "t1";
      });
      expect(t1).toBe("t1");
      expect(firstInterleaving(received)).toBeNull();
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("a pool slot is reusable after sql.reserve() is closed explicitly", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const r = await sql.reserve();
      await r.unsafe("SELECT 'inside'");
      await r.close();

      const t1 = await sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        return "t1";
      });
      expect(t1).toBe("t1");
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("concurrent sql.begin() stays serialized after a server-side disconnect during a transaction", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");

      const err = await sql
        .begin(async tx => {
          await tx.unsafe("SELECT 'KILL'");
        })
        .catch(e => e);
      expect(err).toBeInstanceOf(Error);

      await sql.unsafe("SELECT 'revive'");

      const pa = sql.unsafe("SELECT 'Pa'").execute();
      const t1 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        await tx.unsafe("SELECT 'T1b'");
        return "t1";
      });
      const t2 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T2a'");
        return "t2";
      });

      const results = await Promise.allSettled([pa, t1, t2]);
      expect(results[1]).toEqual({ status: "fulfilled", value: "t1" });
      expect(results[2]).toEqual({ status: "fulfilled", value: "t2" });

      expect(firstInterleaving(received)).toBeNull();
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // A transaction started on a reserved connection runs on the reservation's own
  // slot. When it rejects before BEGIN is sent, the slot has to stay with the
  // reservation. bun:test also fails these tests if the rejected begin() leaves an
  // unhandled rejection behind.
  test.each(rejectedBeforeBegin)(
    "the reservation keeps its pool slot after reserved $name rejects",
    async ({ begin, message }) => {
      const received: Received[] = [];
      const { port, server } = await mockServer(received);
      const sql = new SQL(options(port));
      try {
        const reserved = await sql.reserve();
        const err = await begin(reserved).then(
          () => null,
          e => e,
        );
        expect(err?.message).toBe(message);

        // The reservation holds the pool's only slot, so this has to wait for release().
        const t1 = sql.begin(async tx => {
          await tx.unsafe("SELECT 'T1a'");
          return "t1";
        });
        await reserved.unsafe("SELECT 'R1'");
        await reserved.unsafe("SELECT 'R2'");
        expect(received).toEqual([
          { conn: 0, sql: "SELECT 'R1'" },
          { conn: 0, sql: "SELECT 'R2'" },
        ]);

        reserved.release();
        expect(await t1).toBe("t1");

        // release() brought the slot back to zero queries, so it can be reserved again.
        const reservedAgain = await sql.reserve();
        await reservedAgain.unsafe("SELECT 'R3'");
        reservedAgain.release();

        expect(received).toEqual([
          { conn: 0, sql: "SELECT 'R1'" },
          { conn: 0, sql: "SELECT 'R2'" },
          { conn: 0, sql: beginCommand },
          { conn: 0, sql: "SELECT 'T1a'" },
          { conn: 0, sql: "COMMIT" },
          { conn: 0, sql: "SELECT 'R3'" },
        ]);
      } finally {
        await sql.close({ timeout: 0 }).catch(() => {});
        await new Promise<void>(r => server.close(() => r()));
      }
    },
  );

  test("reserved.close({ timeout }) waits for a transaction started on the reservation", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const t1 = reserved.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        return "t1";
      });
      // The timeout is in seconds. close() resolves as soon as t1 settles; without the
      // transaction being tracked it would close the connection under t1 instead.
      const closed = reserved.close({ timeout: 60 });
      expect(await t1).toBe("t1");
      await closed;
      reserved.release();
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'T1a'" },
        { conn: 0, sql: "COMMIT" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Same overlap with a transaction that fails. close() must wait for the ROLLBACK, and
  // the failure is the caller's to handle: bun:test fails this test if close()'s wait
  // reports it as an unhandled rejection as well.
  test("reserved.close({ timeout }) waits for a failing transaction without reporting its handled error", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const failing = reserved
        .begin(async tx => {
          await tx.unsafe("SELECT 'T1a'");
          throw new Error("t1-app-error");
        })
        .catch(err => err.message);
      const closed = reserved.close({ timeout: 60 });
      expect(await failing).toBe("t1-app-error");
      await closed;
      reserved.release();
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'T1a'" },
        { conn: 0, sql: "ROLLBACK" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Runs in a child process: bun:test would turn any unhandled rejection into a test
  // failure, and the second half of this contract is that one rejection IS reported.
  test("a rejected reserved begin() is reported as unhandled only when the caller ignores it", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const reported = [];
            process.on("unhandledRejection", err => reported.push(err.message));
            const sql = new Bun.SQL(${JSON.stringify(options(port))});
            const reserved = await sql.reserve();
            const handled = await reserved
              .begin(async () => {
                throw new Error("handled by the caller");
              })
              .catch(err => err.message);
            reserved.begin("read-only", async () => {});
            await reserved.unsafe("SELECT 'still reserved'");
            reserved.release();
            await sql.close();
            console.log(JSON.stringify({ handled, reported }));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        handled: "handled by the caller",
        reported: ["Transaction options can only contain letters, spaces, and commas."],
      });
      expect(exitCode).toBe(0);
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "ROLLBACK" },
        { conn: 0, sql: "SELECT 'still reserved'" },
      ]);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

// A query, sql.reserve() or sql.begin() that is still in the pool's queue never used the
// connection whose slot it waits for. When an established connection closes, the pool dials
// that slot again for the callers in its queue. Work that was assigned to the closed
// connection fails with it and is not run again.
//
// Fault-injection tests: the mocks lose sockets without a word, refuse or half-open
// connections, reject authentication, and count the connections they accept. A healthy
// container does none of that on demand. DO NOT COPY THIS PATTERN: anything a real server
// can produce belongs in describeWithContainer, see the block at the end of this file.
describe.each(adapters)("$adapter: queued callers", ({ adapter, mockServer, beginCommand }) => {
  const options = (port: number, extra: Partial<Bun.SQL.Options> = {}): Bun.SQL.Options => ({
    adapter,
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "p",
    database: "db",
    max: 1,
    tls: false,
    ...extra,
  });
  const code = (name: string) => `ERR_${adapter.toUpperCase()}_${name}`;
  const outcome = (promise: PromiseLike<unknown>): Promise<string> =>
    Promise.resolve(promise).then(
      () => "resolved",
      err => err?.code ?? String(err),
    );
  const stopped = (server: net.Server) => new Promise<void>(resolve => server.close(() => resolve()));
  // sql.close({ timeout: 0 }) waits for pending work, and a failed assertion can leave work
  // pending. A timeout above zero ends that work, so the failure is reported and not a hang.
  const closeNow = (sql: SQL) => sql.close({ timeout: 0.001 }).catch(() => {});
  // The pool dials a closed slot again on the next event loop turn (the old socket closes
  // first), from an immediate. An immediate that is queued later runs after it. This is an
  // order, not a wait.
  const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

  // Gives the connections for which `takeOver` returns true to the test instead of the mock.
  // `index` counts the connections in the order the server accepted them. Call intercept()
  // before connectionLog(): it takes the first listener, which is the mock's own handler.
  function intercept(server: net.Server, takeOver: (socket: net.Socket, index: number) => boolean) {
    const [serve] = server.listeners("connection") as Array<(socket: net.Socket) => void>;
    let index = 0;
    server.off("connection", serve).on("connection", socket => {
      socket.on("error", () => {});
      if (!takeOver(socket, index++)) serve(socket);
    });
  }

  // The connections that the pool opened, in the order the server accepted them. opened()
  // resolves once the server accepted every connection that was dialed before the call: it
  // accepts in order, so it has once it accepted a connection that opened() dials itself.
  function connectionLog(server: net.Server, port: number) {
    const accepted: Array<{ socket: net.Socket; remotePort: number }> = [];
    const own = new Set<number>();
    let onAccept = () => {};
    // The first listener: a socket that another listener destroys has no remotePort left.
    server.prependListener("connection", socket => {
      accepted.push({ socket, remotePort: socket.remotePort! });
      onAccept();
    });
    return async function opened(): Promise<net.Socket[]> {
      await nextTurn();
      const marker = connect(port, "127.0.0.1").on("error", () => {});
      await once(marker, "connect");
      const markerPort = marker.localPort!;
      own.add(markerPort);
      while (!accepted.some(entry => entry.remotePort === markerPort)) {
        await new Promise<void>(resolve => (onAccept = resolve));
      }
      marker.destroy();
      return accepted.filter(entry => !own.has(entry.remotePort)).map(entry => entry.socket);
    };
  }

  const waiters = [
    {
      name: "pool query",
      wait: (sql: SQL) => sql.unsafe("SELECT 'queued'").execute(),
      statements: ["SELECT 'queued'"],
    },
    {
      name: "sql.reserve()",
      wait: async (sql: SQL) => {
        using second = await sql.reserve();
        await second.unsafe("SELECT 'queued'");
      },
      statements: ["SELECT 'queued'"],
    },
    {
      name: "sql.begin()",
      wait: (sql: SQL) => sql.begin(tx => tx.unsafe("SELECT 'queued'")),
      statements: [beginCommand, "SELECT 'queued'", "COMMIT"],
    },
  ];

  test.each(waiters)("a waiting $name gets a new connection after reserved.close()", async ({ wait, statements }) => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      await reserved.unsafe("SELECT 'reserved'");
      const queued = wait(sql);
      await reserved.close();
      await queued;
      expect(received).toEqual([{ conn: 0, sql: "SELECT 'reserved'" }, ...statements.map(sql => ({ conn: 1, sql }))]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  test("a waiting pool query gets a new connection after the socket of a reserved connection is lost", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const queued = sql.unsafe("SELECT 'queued'").execute();
      // The statement was assigned to the connection that went away, so it fails with it.
      expect(await outcome(reserved.unsafe("SELECT 'KILL'"))).toBe(code("CONNECTION_CLOSED"));
      await queued;
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'KILL'" },
        { conn: 1, sql: "SELECT 'queued'" },
      ]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  test("waiting callers get a new connection after the socket is lost during sql.begin()", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");
      const dropped = sql.begin(tx => tx.unsafe("SELECT 'KILL'"));
      const queued = sql.unsafe("SELECT 'queued'").execute();
      const queuedBegin = sql.begin(tx => tx.unsafe("SELECT 'T2a'"));
      expect(await outcome(dropped)).toBe(code("CONNECTION_CLOSED"));
      await Promise.all([queued, queuedBegin]);
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'warm'" },
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'KILL'" },
        { conn: 1, sql: beginCommand },
        { conn: 1, sql: "SELECT 'T2a'" },
        { conn: 1, sql: "COMMIT" },
        { conn: 1, sql: "SELECT 'queued'" },
      ]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // The callback of a transaction whose connection was lost still runs. It has no connection,
  // so it holds no pool slot: `max` limits connections, not callbacks. The next sql.begin() or
  // sql.reserve() does not wait for it, and a statement on the dead transaction handle does
  // not reach the connection that the next caller uses.
  const nextCallers = [
    {
      name: "sql.begin() that was queued before",
      queuedBefore: true,
      start: (sql: SQL) => sql.begin(tx => tx.unsafe("SELECT 'next'")),
      statements: [beginCommand, "SELECT 'next'", "COMMIT"],
    },
    {
      name: "sql.begin() that starts after",
      queuedBefore: false,
      start: (sql: SQL) => sql.begin(tx => tx.unsafe("SELECT 'next'")),
      statements: [beginCommand, "SELECT 'next'", "COMMIT"],
    },
    {
      name: "sql.reserve() that starts after",
      queuedBefore: false,
      start: async (sql: SQL) => {
        using next = await sql.reserve();
        await next.unsafe("SELECT 'next'");
      },
      statements: ["SELECT 'next'"],
    },
  ];

  test.each(nextCallers)(
    "a $name the loss does not wait for the callback of the dead transaction",
    async ({ queuedBefore, start, statements }) => {
      const received: Received[] = [];
      const { port, server } = await mockServer(received);
      const sql = new SQL(options(port));
      const callbackMayEnd = Promise.withResolvers<void>();
      try {
        await sql.unsafe("SELECT 'warm'");
        const stale = Promise.withResolvers<string>();
        const dropped = sql.begin(async tx => {
          await tx.unsafe("SELECT 'KILL'").catch(() => {});
          await callbackMayEnd.promise;
          stale.resolve(await outcome(tx.unsafe("SELECT 'stale'")));
        });
        const queued = queuedBefore ? start(sql) : undefined;
        expect(await outcome(dropped)).toBe(code("CONNECTION_CLOSED"));
        await (queued ?? start(sql));
        callbackMayEnd.resolve();
        expect(await stale.promise).not.toBe("resolved");
        // A round trip on the new connection: a stale statement would have arrived before it.
        await sql.unsafe("SELECT 'after'");
        expect(received).toEqual([
          { conn: 0, sql: "SELECT 'warm'" },
          { conn: 0, sql: beginCommand },
          { conn: 0, sql: "SELECT 'KILL'" },
          ...statements.map(sql => ({ conn: 1, sql })),
          { conn: 1, sql: "SELECT 'after'" },
        ]);
      } finally {
        callbackMayEnd.resolve();
        await closeNow(sql);
        await stopped(server);
      }
    },
  );

  // A plain pool query is assigned to a connection as soon as one is free, also behind a query
  // that still runs. From then on it is that connection's work, sent or not.
  test("a pool query that was assigned to the connection fails with it and is not run again", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");
      const results = Promise.all([
        outcome(sql.unsafe("SELECT 'KILL'").execute()),
        outcome(sql.unsafe("SELECT 'behind'").execute()),
      ]);
      expect(await results).toEqual([code("CONNECTION_CLOSED"), code("CONNECTION_CLOSED")]);
      expect((await opened()).length).toBe(1);
      expect(received.filter(({ conn }) => conn !== 0)).toEqual([]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  test("a waiting sql.reserve() gets a new connection after the socket is lost with a query in flight", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");
      // Assigned to the slot. The reservation waits for the slot to go idle and holds the query behind it.
      const inFlight = sql.unsafe("SELECT 'KILL'").execute();
      const queuedReserve = sql.reserve();
      const queued = sql.unsafe("SELECT 'queued'").execute();
      expect(await outcome(inFlight)).toBe(code("CONNECTION_CLOSED"));
      {
        using second = await queuedReserve;
        await second.unsafe("SELECT 'second'");
      }
      await queued;
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'warm'" },
        { conn: 0, sql: "SELECT 'KILL'" },
        { conn: 1, sql: "SELECT 'second'" },
        { conn: 1, sql: "SELECT 'queued'" },
      ]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // The reservation handle outlives its connection. It must not reach the connection that
  // replaced it in the pool slot, which by then serves other callers.
  test.each([
    { name: "a waiting query", queueBeforeClose: true },
    { name: "a later query", queueBeforeClose: false },
  ])("a closed reservation cannot run a statement on the connection opened for $name", async ({ queueBeforeClose }) => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const queued = queueBeforeClose ? sql.unsafe("SELECT 'next'").execute() : undefined;
      await reserved.close();
      await (queued ?? sql.unsafe("SELECT 'next'"));
      expect(await outcome(reserved.unsafe("SELECT 'stale'"))).not.toBe("resolved");
      // A round trip on the new connection: a stale statement would have arrived before it.
      await sql.unsafe("SELECT 'after'");
      expect(received).toEqual([
        { conn: 1, sql: "SELECT 'next'" },
        { conn: 1, sql: "SELECT 'after'" },
      ]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  test("waiting callers get the connect error when nothing listens for the new connection", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const results = Promise.all([outcome(sql.unsafe("SELECT 'queued'").execute()), outcome(sql.reserve())]);
      // Stops listening. The reserved connection stays open.
      const stoppedListening = stopped(server);
      await reserved.close();
      expect(await results).toEqual([code("CONNECTION_REFUSED"), code("CONNECTION_REFUSED")]);
      expect(received).toEqual([]);
      await stoppedListening;
    } finally {
      await closeNow(sql);
    }
  });

  // The server accepts the new connection and closes it before the handshake. That is a connect
  // failure, which the pool retries until connectionTimeout ends. A connectionTimeout of 0 turns
  // the retries off, so the callers fail after exactly one new connection.
  test("waiting callers get the connect error when the new connection does not complete", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    intercept(server, (socket, index) => index > 0 && (socket.destroy(), true));
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port, { connectionTimeout: 0 }));
    try {
      using reserved = await sql.reserve();
      const results = Promise.all([outcome(sql.unsafe("SELECT 'queued'").execute()), outcome(sql.reserve())]);
      await reserved.close();
      expect(await results).toEqual([code("CONNECTION_FAILED"), code("CONNECTION_FAILED")]);
      expect((await opened()).length).toBe(2);
      expect(received).toEqual([]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // The same connect failure with the retries on: the second attempt completes. The failed
  // attempt is part of one connect cycle, so onclose does not report it.
  test.each([
    { name: "waiting callers are", queueBeforeClose: true },
    { name: "a later query is", queueBeforeClose: false },
  ])("$name served when the first attempt of the new connection fails", async ({ queueBeforeClose }) => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    intercept(server, (socket, index) => index === 1 && (socket.destroy(), true));
    const opened = connectionLog(server, port);
    const events: string[] = [];
    const sql = new SQL(
      options(port, {
        onconnect: (err: any) => void events.push(err ? `connect failed ${err.code}` : "connected"),
        onclose: (err: any) => void events.push(`closed ${err?.code}`),
      }),
    );
    try {
      using reserved = await sql.reserve();
      const queued = queueBeforeClose ? sql.unsafe("SELECT 'next'").execute() : undefined;
      await reserved.close();
      await (queued ?? sql.unsafe("SELECT 'next'"));
      expect(events).toEqual(["connected", `closed ${code("CONNECTION_CLOSED")}`, "connected"]);
      expect(received).toEqual([{ conn: 1, sql: "SELECT 'next'" }]);
      expect((await opened()).length).toBe(3);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // A password function that throws a falsy value ends the dial with no error object. The
  // callers test `if (err)`, so they must still get an error.
  test.each([undefined, ""])("waiting callers get an error when the dial fails with %p", async thrown => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    let passwordCalls = 0;
    const sql = new SQL(
      options(port, {
        password: () => {
          if (++passwordCalls > 1) throw thrown;
          return "p";
        },
      }),
    );
    try {
      using reserved = await sql.reserve();
      const queued = outcome(sql.unsafe("SELECT 'queued'").execute());
      await reserved.close();
      expect(await queued).toBe(code("CONNECTION_CLOSED"));
      expect(passwordCalls).toBe(2);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  test.each([undefined, ""])("the first query gets an error when the first dial fails with %p", async thrown => {
    // The password function throws before the pool dials, so no server is needed.
    const sql = new SQL(
      options(0, {
        password: () => {
          throw thrown;
        },
      }),
    );
    try {
      const query = sql.unsafe("SELECT 'first'").execute();
      const result = outcome(query);
      // The pool reports the failed dial on the next tick, and rejects the query in that tick.
      await new Promise<void>(resolve => process.nextTick(resolve));
      expect(Bun.peek.status(query)).toBe("rejected");
      expect(await result).toBe(code("CONNECTION_CLOSED"));
    } finally {
      await closeNow(sql);
    }
  });

  test("a pool that is closing does not open a connection for waiting callers", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const query = sql.unsafe("SELECT 'queued'").execute();
      const queued = outcome(query);
      // Graceful: waits for the reservation and for the queued query.
      const closed = sql.close();
      await reserved.close();
      // The queued query fails in the close event of the connection, not a turn later.
      expect(Bun.peek.status(query)).toBe("rejected");
      expect(await queued).toBe(code("CONNECTION_CLOSED"));
      await closed;
      expect((await opened()).length).toBe(1);
      expect(received).toEqual([]);
    } finally {
      await stopped(server);
    }
  });

  // The dial for the queued sql.reserve() waits for the next event loop turn. The caller leaves
  // and the pool closes before that turn, so nothing is dialed.
  test("a pool that closes before the new connection is dialed does not dial it", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const leaving = new AbortController();
      const queued = sql.reserve({ signal: leaving.signal }).then(
        () => "resolved",
        err => err.name,
      );
      await reserved.close();
      leaving.abort();
      await sql.close();
      expect(await queued).toBe("AbortError");
      expect((await opened()).length).toBe(1);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // sql.close() comes after the connection closed and before the turn of that dial. A pool
  // that is closing starts no dial, so the queued query fails, as it does when sql.close()
  // comes first.
  test("a pool that starts to close before the new connection is dialed does not dial it", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const queued = outcome(sql.unsafe("SELECT 'queued'").execute());
      await reserved.close();
      // Graceful: the queued query is still pending.
      const closed = sql.close();
      expect(await queued).toBe(code("CONNECTION_CLOSED"));
      await closed;
      expect((await opened()).length).toBe(1);
      expect(received).toEqual([]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // The caller leaves before the turn of that dial, and the pool stays open. Nothing is dialed
  // until the next caller comes.
  test("the new connection is not dialed when the waiting caller leaves before the dial", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const leaving = new AbortController();
      const queued = sql.reserve({ signal: leaving.signal }).then(
        () => "resolved",
        err => err.name,
      );
      await reserved.close();
      leaving.abort();
      expect(await queued).toBe("AbortError");
      expect((await opened()).length).toBe(1);
      await sql.unsafe("SELECT 'later'");
      expect((await opened()).length).toBe(2);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  describe("with fake timers", () => {
    // A test that times out does not reach its finally block.
    afterEach(() => void jest.useRealTimers());

    // That dial does not wait in a timer, so a program that uses fake timers gets it too.
    test("a waiting pool query gets a new connection after reserved.close()", async () => {
      const received: Received[] = [];
      const { port, server } = await mockServer(received);
      const sql = new SQL(options(port));
      try {
        using reserved = await sql.reserve();
        const queued = sql.unsafe("SELECT 'queued'").execute();
        jest.useFakeTimers();
        await reserved.close();
        await queued;
        expect(received).toEqual([{ conn: 1, sql: "SELECT 'queued'" }]);
      } finally {
        jest.useRealTimers();
        await closeNow(sql);
        await stopped(server);
      }
    });
  });

  test("a connection that closes with nobody waiting is not replaced until the next query", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      await reserved.close();
      expect((await opened()).length).toBe(1);
      await sql.unsafe("SELECT 'later'");
      expect((await opened()).length).toBe(2);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // The other slot is open, but a reservation holds it. The caller does not wait for that
  // reservation: the slot that closed is free, and the pool dials it again.
  test.each(waiters)(
    "with max: 2, a waiting $name gets a new connection while the other slot is held",
    async ({ wait, statements }) => {
      const received: Received[] = [];
      const { port, server } = await mockServer(received);
      const opened = connectionLog(server, port);
      const sql = new SQL(options(port, { max: 2 }));
      try {
        using a = await sql.reserve();
        using b = await sql.reserve();
        const queued = wait(sql);
        await a.close();
        expect((await opened()).length).toBe(3);
        await queued;
        // The reservation that was not closed still has its connection.
        await b.unsafe("SELECT 'held'");
        expect(received.slice(0, -1)).toEqual(statements.map(sql => ({ conn: 2, sql })));
        expect(received.at(-1)!.sql).toBe("SELECT 'held'");
        expect(received.at(-1)!.conn).toBeLessThan(2);
      } finally {
        await closeNow(sql);
        await stopped(server);
      }
    },
  );

  test("with max: 2, every slot that closes with a caller queued is dialed again", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port, { max: 2 }));
    try {
      using a = await sql.reserve();
      using b = await sql.reserve();
      const queued = sql.unsafe("SELECT 'queued'").execute();
      await a.close();
      await b.close();
      await queued;
      expect((await opened()).length).toBe(4);
      expect(received).toHaveLength(1);
      expect(received[0].sql).toBe("SELECT 'queued'");
      expect(received[0].conn).toBeGreaterThanOrEqual(2);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // The dial for the slot of `a` is the third call of the password function, and it fails.
  // That slot then waits for the next caller that finds no connection ready, as a closed slot
  // does on a pool with nobody queued. The close of `b` dials the slot of `b` and no other.
  test("with max: 2, a slot whose new connection failed is not dialed again when the other slot closes", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    let passwordCalls = 0;
    const sql = new SQL(
      options(port, {
        max: 2,
        password: () => {
          if (++passwordCalls === 3) throw new Error("no password this time");
          return "p";
        },
      }),
    );
    try {
      using a = await sql.reserve();
      using b = await sql.reserve();
      const queued = sql.unsafe("SELECT 'queued'").execute();
      await a.close();
      await nextTurn();
      expect(passwordCalls).toBe(3);
      // The pool reports the failed dial on the next tick.
      await new Promise<void>(resolve => process.nextTick(resolve));
      await b.close();
      await queued;
      expect((await opened()).length).toBe(3);
      expect(passwordCalls).toBe(4);
      expect(received).toEqual([{ conn: 2, sql: "SELECT 'queued'" }]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // Every new connection goes to one queued caller at once. So when the server drops each new
  // connection, each dial fails one caller, and the pool stops dialing when its queue is empty.
  test("a server that drops every new connection costs one dial for each queued sql.begin()", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const queued = [1, 2, 3].map(n => outcome(sql.begin(tx => tx.unsafe(`SELECT 'KILL ${n}'`))));
      await reserved.close();
      expect(await Promise.all(queued)).toEqual(Array(3).fill(code("CONNECTION_CLOSED")));
      expect((await opened()).length).toBe(4);
      expect(received).toEqual(
        [1, 2, 3].flatMap(n => [
          { conn: n, sql: beginCommand },
          { conn: n, sql: `SELECT 'KILL ${n}'` },
        ]),
      );
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // Native code runs the close event of an idle connection before it closes the socket. The
  // pool dials after that, so the server never has more than `max` connections of the pool.
  test("the new connection for a caller queued behind an idle reservation is dialed after the old socket closed", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const open = new Set<net.Socket>();
    const openAtAccept: number[] = [];
    server.prependListener("connection", socket => {
      openAtAccept.push(open.size);
      open.add(socket);
      socket.on("end", () => open.delete(socket)).on("close", () => open.delete(socket));
    });
    const sql = new SQL(options(port, { idleTimeout: 0.1 }));
    try {
      using reserved = await sql.reserve();
      // Waits until idleTimeout closes the reserved connection.
      using second = await sql.reserve();
      expect(openAtAccept).toEqual([0, 0]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // The script of a Bun.ModuleGraph closes the reservation, and the graph is disposed at once.
  // The dial that the pool has parked is the pool owner's work, so it does not go with the graph.
  test("the dial for a queued caller outlives the ModuleGraph whose script closed the reservation", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      using reserved = await sql.reserve();
      const queued = sql.unsafe("SELECT 'queued'").execute();
      {
        using graph = new Bun.ModuleGraph();
        graph.run(() => void reserved.close());
      }
      expect((await opened()).length).toBe(2);
      await queued;
      expect(received).toEqual([{ conn: 1, sql: "SELECT 'queued'" }]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // The second call of the password function is the dial that replaces the closed connection.
  // It closes the pool at that moment. sql.close() waits for that dial, and the connection that
  // the dial opens has no pool to join, so it does not stay open.
  test("a pool that is closed while a closed slot is dialed again waits for the dial and leaves no connection open", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    const password = Promise.withResolvers<string>();
    let passwordCalls = 0;
    let closed: Promise<void> | undefined;
    const sql = new SQL(
      options(port, {
        password: () => {
          if (++passwordCalls !== 2) return "p";
          closed = sql.close();
          return password.promise;
        },
      }),
    );
    try {
      using reserved = await sql.reserve();
      await reserved.close();
      const later = outcome(sql.unsafe("SELECT 'later'").execute());
      expect(passwordCalls).toBe(2);
      await nextTurn();
      expect(Bun.peek.status(closed!)).toBe("pending");
      password.resolve("p");
      await closed;
      expect(await later).toBe(code("CONNECTION_CLOSED"));
      const sockets = await opened();
      // Not once(socket, "close"): it rejects when the client ends the connection with a reset.
      await Promise.all(
        sockets.map(socket => socket.destroyed || new Promise<void>(resolve => socket.once("close", () => resolve()))),
      );
      expect(received).toEqual([]);
    } finally {
      password.resolve("p");
      await closeNow(sql);
      await stopped(server);
    }
  });

  // A query that the password function starts finds the slot already being dialed. It waits
  // for that connection and does not dial a second one.
  test("a query started while a closed slot is dialed again waits for that connection", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const opened = connectionLog(server, port);
    let passwordCalls = 0;
    let started: Promise<string> | undefined;
    const sql = new SQL(
      options(port, {
        password: () => {
          if (++passwordCalls === 2) started = outcome(sql.unsafe("SELECT 'from password'").execute());
          return "p";
        },
      }),
    );
    try {
      using reserved = await sql.reserve();
      await reserved.close();
      await sql.unsafe("SELECT 'later'");
      expect(await started).toBe("resolved");
      expect(passwordCalls).toBe(2);
      expect((await opened()).length).toBe(2);
      expect(received).toEqual([
        { conn: 1, sql: "SELECT 'from password'" },
        { conn: 1, sql: "SELECT 'later'" },
      ]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  // An authentication-class error is final for a slot that never connected: another dial cannot
  // fix it. A slot that connected before is dialed again, whatever its last error was.
  const rejectAuthentication = {
    // AuthenticationRequest with a type that the client does not know.
    postgres: (socket: net.Socket) => void socket.once("data", () => socket.write(pgRaw("R", pgInt32(99)))),
    mysql: (socket: net.Socket) => void socket.write(mysqlHandshakeV10({ authPlugin: "mock_unknown_plugin" })),
  }[adapter];
  const authenticationCode = {
    postgres: "ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD",
    mysql: "ERR_MYSQL_UNSUPPORTED_AUTH_PLUGIN",
  }[adapter];

  test("a slot that never connected is not dialed again after an authentication-class error", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    intercept(server, socket => (rejectAuthentication(socket), true));
    const opened = connectionLog(server, port);
    const sql = new SQL(options(port));
    try {
      expect(await outcome(sql.unsafe("SELECT 'first'"))).toBe(authenticationCode);
      expect(await outcome(sql.unsafe("SELECT 'second'"))).toBe(authenticationCode);
      expect((await opened()).length).toBe(1);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });

  test("a slot that connected before is dialed again after an authentication-class error", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    // The second connection, the one that replaces the dropped one, is the one that fails.
    intercept(server, (socket, index) => index === 1 && (rejectAuthentication(socket), true));
    const sql = new SQL(options(port));
    try {
      expect(await outcome(sql.unsafe("SELECT 'KILL'"))).toBe(code("CONNECTION_CLOSED"));
      expect(await outcome(sql.unsafe("SELECT 'second'"))).toBe(authenticationCode);
      await sql.unsafe("SELECT 'third'");
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'KILL'" },
        { conn: 1, sql: "SELECT 'third'" },
      ]);
    } finally {
      await closeNow(sql);
      await stopped(server);
    }
  });
});

// The same rule against real servers. Here the server ends a session the way a server does:
// with an error message first, then the close. Sessions are told apart by the id that the
// server gives them. describeWithContainer skips a server that is not reachable.
const servers = [
  {
    name: "PostgreSQL",
    image: "postgres_plain",
    provided: true,
    options: (host: string, port: number): Bun.SQL.Options => ({
      url: `postgres://bun_sql_test@${host}:${port}/bun_sql_test`,
    }),
    sessionId: "SELECT pg_backend_pid() AS id",
    endSession: (id: number) => `SELECT pg_terminate_backend(${id})`,
  },
  {
    name: "MySQL",
    image: "mysql_plain",
    // These cases log in as root with an empty password over TCP. The container allows that.
    // A local server that BUN_TEST_SERVICE_mysql_plain points at usually does not, so only
    // the CI container counts.
    provided: !!process.env.BUN_DOCKER_COORDINATOR || (isCI && isDockerEnabled()),
    options: (host: string, port: number): Bun.SQL.Options => ({
      url: `mysql://root:@${host}:${port}/bun_sql_test`,
      allowPublicKeyRetrieval: true,
    }),
    sessionId: "SELECT CONNECTION_ID() AS id",
    endSession: (id: number) => `KILL CONNECTION ${id}`,
  },
];

for (const { name, image, provided, options, sessionId, endSession } of servers) {
  if (!provided) {
    describe.todo(`${name}: queued callers`);
    continue;
  }
  describeWithContainer(`${name}: queued callers`, { image }, container => {
    const connect = (max: number) => new SQL({ ...options(container.host, container.port), max });
    const idOf = async (client: { unsafe: SQL["unsafe"] }) => Number((await client.unsafe(sessionId))[0].id);
    // Each waiter resolves with the id of the session that served it.
    const waiters = [
      {
        name: "pool query",
        wait: (sql: SQL) =>
          sql
            .unsafe(sessionId)
            .execute()
            .then(rows => Number(rows[0].id)),
      },
      {
        name: "sql.reserve()",
        wait: async (sql: SQL) => {
          using second = await sql.reserve();
          return await idOf(second);
        },
      },
      { name: "sql.begin()", wait: (sql: SQL) => sql.begin(tx => idOf(tx)) },
    ];

    test.each(waiters)("a waiting $name gets a new session after reserved.close()", async ({ wait }) => {
      await container.ready;
      await using sql = connect(1);
      using reserved = await sql.reserve();
      const closedSession = await idOf(reserved);
      const queued = wait(sql);
      await reserved.close();
      const servedBy = await queued;
      expect(servedBy).toBeInteger();
      expect(servedBy).not.toBe(closedSession);
    });

    test.each(waiters)(
      "a waiting $name gets a new session after the server ends the session of a reservation",
      async ({ wait }) => {
        await container.ready;
        await using admin = connect(1);
        await using sql = connect(1);
        using reserved = await sql.reserve();
        const endedSession = await idOf(reserved);
        const queued = wait(sql);
        await admin.unsafe(endSession(endedSession));
        const servedBy = await queued;
        expect(servedBy).toBeInteger();
        expect(servedBy).not.toBe(endedSession);
      },
    );

    test.each(waiters)(
      "with max: 2, a waiting $name gets a new session while the other session is held",
      async ({ wait }) => {
        await container.ready;
        await using sql = connect(2);
        using a = await sql.reserve();
        using b = await sql.reserve();
        const closedSession = await idOf(a);
        const heldSession = await idOf(b);
        const queued = wait(sql);
        await a.close();
        const servedBy = await queued;
        expect(servedBy).toBeInteger();
        expect([closedSession, heldSession]).not.toContain(servedBy);
        // The reservation that was not closed still has its session.
        expect(await idOf(b)).toBe(heldSession);
      },
    );
  });
}
