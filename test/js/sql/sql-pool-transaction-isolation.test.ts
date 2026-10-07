// Pool slot accounting across the paths that hand a connection back to the pool.
// The mock servers record every statement per connection, so a transaction that
// lands on a connection somebody else still holds shows up in the recorded order.
// They also drop the socket on demand, which a real container will not do.
// Wire bytes come from ./wire-frames.ts.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import type net from "node:net";
import tls from "node:tls";
import {
  listeningServer,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlAckSessionSetup,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgCommandComplete,
  pgErrorResponse,
  pgReadyForQuery,
  pgSSLResponse,
} from "./wire-frames";

type Received = { conn: number; sql: string };
// `onReceived` runs after each statement is recorded. `secure` makes the server accept the
// client's TLS request and speak the protocol over TLS from there on.
type MockOptions = { onReceived?: () => void; secure?: boolean };
type MockServer = (received: Received[], options?: MockOptions) => Promise<{ port: number; server: net.Server }>;

function secureSocket(rawSocket: net.Socket): net.Socket {
  rawSocket.pause();
  const socket = new tls.TLSSocket(rawSocket, { isServer: true, ...tlsCert });
  socket.on("error", () => {});
  return socket;
}

// Both mocks answer every statement at once, except for these markers in the query text:
//   KILL destroys the socket without answering,
//   FAIL answers with an error,
//   HOLD never answers.
const pgMockServer: MockServer = (received, { onReceived, secure } = {}) => {
  let nextConn = 0;
  return listeningServer(rawSocket => {
    const connId = nextConn++;
    rawSocket.on("error", () => {});
    if (secure) {
      // SSLRequest. The client sends nothing more until it has the answer.
      rawSocket.once("data", () => {
        rawSocket.write(pgSSLResponse("S"));
        serve(secureSocket(rawSocket));
      });
    } else {
      serve(rawSocket);
    }

    function serve(socket: net.Socket) {
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
          onReceived?.();
          if (sql.includes("KILL")) {
            socket.destroy();
            return;
          }
          if (sql.includes("HOLD")) continue;
          if (sql.includes("FAIL")) {
            socket.write(
              Buffer.concat([pgErrorResponse({ S: "ERROR", C: "XX000", M: "mock failure" }), pgReadyForQuery()]),
            );
            continue;
          }
          socket.write(Buffer.concat([pgCommandComplete("SELECT 0"), pgReadyForQuery()]));
        }
      });
    }
  });
};

const mysqlMockServer: MockServer = (received, { onReceived, secure } = {}) => {
  const COM_QUIT = 0x01;
  const COM_QUERY = 0x03;
  let nextConn = 0;
  return listeningServer(rawSocket => {
    const connId = nextConn++;
    rawSocket.on("error", () => {});
    rawSocket.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | (secure ? MYSQL_CLIENT_SSL : 0) }));
    if (secure) {
      // One plaintext packet, the SSLRequest. The client starts its ClientHello right after
      // it, so bytes past the packet are TLS records and go back for the TLS socket to read.
      let plain = Buffer.alloc(0);
      const onPlainData = (chunk: Buffer) => {
        plain = Buffer.concat([plain, chunk]);
        if (plain.length < 4) return;
        const end = 4 + plain.readUIntLE(0, 3);
        if (plain.length < end) return;
        rawSocket.removeListener("data", onPlainData);
        rawSocket.pause();
        if (plain.length > end) rawSocket.unshift(plain.subarray(end));
        serve(secureSocket(rawSocket));
      };
      rawSocket.on("data", onPlainData);
    } else {
      serve(rawSocket);
    }

    function serve(socket: net.Socket) {
      let buffered = Buffer.alloc(0);
      let authed = false;
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
            onReceived?.();
            if (sql.includes("KILL")) {
              socket.destroy();
              return;
            }
            if (sql.includes("HOLD")) return;
            if (sql.includes("FAIL")) {
              socket.write(mysqlErrPacket(1, 1105, "HY000", "mock failure"));
              return;
            }
            socket.write(mysqlOkPacket(1));
          } else if (payload[0] === COM_QUIT) {
            socket.end();
          }
        });
      });
    }
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

const adapters: Array<{
  adapter: "postgres" | "mysql";
  mockServer: MockServer;
  beginCommand: string;
  connectionClosedCode: string;
  // What sql.beginDistributed("dtx", fn) sends to start the transaction, and to roll it back once.
  distributed: { begin: string; rollback: string[] };
}> = [
  {
    adapter: "postgres",
    mockServer: pgMockServer,
    beginCommand: "BEGIN",
    connectionClosedCode: "ERR_POSTGRES_CONNECTION_CLOSED",
    distributed: { begin: "BEGIN", rollback: ["ROLLBACK"] },
  },
  {
    adapter: "mysql",
    mockServer: mysqlMockServer,
    beginCommand: "START TRANSACTION",
    connectionClosedCode: "ERR_MYSQL_CONNECTION_CLOSED",
    distributed: { begin: "XA START 'dtx'", rollback: ["XA END 'dtx'", "XA ROLLBACK 'dtx'"] },
  },
];

// A transaction on the reservation whose callback parks after its first statement until
// finish() is called, so a test controls when the transaction settles.
function parkedTransaction(reserved: Bun.ReservedSQL, statement: string) {
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const promise = reserved.begin(async tx => {
    await tx.unsafe(statement);
    started.resolve();
    await gate.promise;
    return "committed";
  });
  return { promise, started: started.promise, finish: gate.resolve };
}

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

describe.each(adapters)("$adapter", ({ adapter, mockServer, beginCommand, connectionClosedCode, distributed }) => {
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

  // reserved.close({ timeout }) waits, up to the timeout (in seconds), for the queries and
  // transactions that are pending on the reservation, then closes the connection. The
  // connection's close handler returns the pool slot. The tests below use a pool whose
  // onclose callback counts the connections the pool has closed so far.
  type CloseTestPool = {
    sql: SQL;
    received: Received[];
    closes: () => number;
    firstClose: Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
  };
  async function closeTestPool(mock: MockOptions = {}, max = 1): Promise<CloseTestPool> {
    const received: Received[] = [];
    const { port, server } = await mockServer(received, mock);
    const firstClose = Promise.withResolvers<void>();
    let closes = 0;
    const sql = new SQL({
      ...options(port),
      max,
      tls: mock.secure ? { rejectUnauthorized: false } : false,
      onclose: () => {
        closes++;
        firstClose.resolve();
      },
    });
    return {
      sql,
      received,
      closes: () => closes,
      firstClose: firstClose.promise,
      async [Symbol.asyncDispose]() {
        await sql.close({ timeout: 0 }).catch(() => {});
        await new Promise<void>(r => server.close(() => r()));
      },
    };
  }

  // The statements of the transaction that expectSlotReturned / expectConnectionKept run.
  const afterTransaction = (conn: number): Received[] => [
    { conn, sql: beginCommand },
    { conn, sql: "SELECT 'after'" },
    { conn, sql: "COMMIT" },
  ];
  const runAfterTransaction = (sql: SQL) =>
    sql.begin(async tx => {
      await tx.unsafe("SELECT 'after'");
      return "after";
    });

  // close() closed the reservation's connection and gave its slot back: the pool's only
  // slot reconnects (conn 1) for the next transaction, and a graceful sql.close() resolves
  // because the pool no longer counts the reservation.
  async function expectSlotReturned(pool: CloseTestPool) {
    await pool.firstClose;
    expect(await runAfterTransaction(pool.sql)).toBe("after");
    await pool.sql.close();
  }

  // close() left the connection alone: nothing was closed, and the next transaction runs
  // on the same connection (conn 0).
  async function expectConnectionKept(pool: CloseTestPool) {
    expect(pool.closes()).toBe(0);
    expect(await runAfterTransaction(pool.sql)).toBe("after");
    await pool.sql.close();
  }

  // The two cases above end with release(). These two check the slot before it: close() alone
  // closes the connection and returns the slot, so the release() after it is a no-op.
  // `await using reserved` ends the same way.
  test("reserved.close({ timeout }) returns the pool slot once a transaction on the reservation commits", async () => {
    await using pool = await closeTestPool();
    const reserved = await pool.sql.reserve();
    const t1 = reserved.begin(async tx => {
      await tx.unsafe("SELECT 'T1a'");
      return "t1";
    });
    const closed = reserved.close({ timeout: 60 });
    expect(await t1).toBe("t1");
    await closed;
    reserved.release();
    await expectSlotReturned(pool);
    expect(pool.received).toEqual([
      { conn: 0, sql: beginCommand },
      { conn: 0, sql: "SELECT 'T1a'" },
      { conn: 0, sql: "COMMIT" },
      ...afterTransaction(1),
    ]);
  });

  test("reserved.close({ timeout }) returns the pool slot once a transaction on the reservation fails", async () => {
    await using pool = await closeTestPool();
    const reserved = await pool.sql.reserve();
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
    await expectSlotReturned(pool);
    expect(pool.received).toEqual([
      { conn: 0, sql: beginCommand },
      { conn: 0, sql: "SELECT 'T1a'" },
      { conn: 0, sql: "ROLLBACK" },
      ...afterTransaction(1),
    ]);
  });

  // A graceful sql.close() waits for the pool's pending work. It hangs if the pool still
  // counts the reservation.
  test("a graceful sql.close() resolves after sql.reserve() is closed explicitly", async () => {
    await using pool = await closeTestPool();
    const reserved = await pool.sql.reserve();
    await reserved.unsafe("SELECT 'inside'");
    await reserved.close();
    await expectSlotReturned(pool);
    expect(pool.received).toEqual([{ conn: 0, sql: "SELECT 'inside'" }, ...afterTransaction(1)]);
  });

  test("reserved.close({ timeout }) closes the connection once the pending query finishes", async () => {
    await using pool = await closeTestPool();
    const reserved = await pool.sql.reserve();
    const inFlight = reserved.unsafe("SELECT 'in flight'").execute();
    const closed = reserved.close({ timeout: 60 });
    await inFlight;
    await closed;
    await expectSlotReturned(pool);
    expect(pool.received).toEqual([{ conn: 0, sql: "SELECT 'in flight'" }, ...afterTransaction(1)]);
  });

  // Neither of these ever reaches the server, and neither leaves the reservation's set of
  // pending queries, so close({ timeout }) takes its wait with nothing in flight. It still
  // has to close the connection. bun:test also fails these tests if the wait reports the
  // entry's rejection as unhandled.
  test.each([
    {
      entry: "an identifier helper",
      make: async (reserved: Bun.ReservedSQL) => {
        reserved("users");
      },
    },
    {
      entry: "a query whose text cannot be built",
      make: async (reserved: Bun.ReservedSQL) => {
        const error = await reserved`INSERT INTO users ${reserved({})}`.then(
          () => null,
          e => e.message,
        );
        expect(error).toBe("Cannot INSERT with no columns");
      },
    },
  ])("reserved.close({ timeout }) closes a reservation whose only pending entry is $entry", async ({ make }) => {
    await using pool = await closeTestPool();
    const reserved = await pool.sql.reserve();
    await make(reserved);
    await reserved.close({ timeout: 60 });
    await expectSlotReturned(pool);
    expect(pool.received).toEqual(afterTransaction(1));
  });

  // A query that fails while close() waits does not end the wait: the transaction that is
  // still open on the same reservation must get to COMMIT before the connection closes.
  // bun:test also fails this test if close()'s wait reports the handled failure as unhandled.
  test("reserved.close({ timeout }) keeps waiting for the other pending work when one query fails", async () => {
    await using pool = await closeTestPool();
    const reserved = await pool.sql.reserve();
    const t1 = parkedTransaction(reserved, "SELECT 'T1a'");
    await t1.started;
    const failed = reserved.unsafe("SELECT 'FAIL'").then(
      () => null,
      e => e.message,
    );
    const closed = reserved.close({ timeout: 60 });
    expect(await failed).toBe("mock failure");
    t1.finish();
    expect(await t1.promise).toBe("committed");
    await closed;
    await expectSlotReturned(pool);
    expect(pool.received).toEqual([
      { conn: 0, sql: beginCommand },
      { conn: 0, sql: "SELECT 'T1a'" },
      { conn: 0, sql: "SELECT 'FAIL'" },
      { conn: 0, sql: "COMMIT" },
      ...afterTransaction(1),
    ]);
  });

  // The query that close() cuts off here rejects, and that rejection belongs to its caller.
  // bun:test fails this test if close()'s own wait reports it as unhandled as well.
  test("reserved.close({ timeout }) closes the connection under a query that outlives the timeout", async () => {
    const held = Promise.withResolvers<void>();
    await using pool = await closeTestPool({ onReceived: () => held.resolve() });
    const reserved = await pool.sql.reserve();
    const neverAnswered = reserved.unsafe("SELECT 'HOLD'").then(
      () => null,
      e => e.code,
    );
    // The server has the query and will not answer it, so only the timer can end close().
    await held.promise;
    await reserved.close({ timeout: 0.05 });
    expect(await neverAnswered).toBe(connectionClosedCode);
    await expectSlotReturned(pool);
    expect(pool.received).toEqual([{ conn: 0, sql: "SELECT 'HOLD'" }, ...afterTransaction(1)]);
  });

  // bun:test fails this test if the queries the server took down are reported as unhandled
  // by close()'s wait. The close handler already returned the slot when the server dropped
  // the connection, so close() has nothing left to do but resolve.
  test("reserved.close({ timeout }) resolves when the server drops the connection while it waits", async () => {
    await using pool = await closeTestPool();
    const reserved = await pool.sql.reserve();
    const dropped = reserved.unsafe("SELECT 'KILL'").then(
      () => null,
      e => e.code,
    );
    const closed = reserved.close({ timeout: 60 });
    expect(await dropped).toBe(connectionClosedCode);
    await closed;
    await expectSlotReturned(pool);
    expect(pool.received).toEqual([{ conn: 0, sql: "SELECT 'KILL'" }, ...afterTransaction(1)]);
  });

  // release() during the wait gives the connection back to the pool, where it may already
  // serve other callers, so neither way of ending the wait may close it. The transaction
  // still open on it is the probe: it can only commit if the connection stayed open.
  test.each([
    { ending: "the pending transaction finishes", timeout: 60, timerEndsTheWait: false },
    { ending: "the timer fires", timeout: 0.05, timerEndsTheWait: true },
  ])(
    "reserved.close({ timeout }) leaves a connection alone that release() gave back before $ending",
    async ({ timeout, timerEndsTheWait }) => {
      await using pool = await closeTestPool();
      const reserved = await pool.sql.reserve();
      const t1 = parkedTransaction(reserved, "SELECT 'T1a'");
      await t1.started;
      const closed = reserved.close({ timeout });
      reserved.release();
      // While t1 is parked, only the timer can end the wait.
      if (timerEndsTheWait) await closed;
      t1.finish();
      expect(await t1.promise).toBe("committed");
      await closed;
      await expectConnectionKept(pool);
      expect(pool.received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'T1a'" },
        { conn: 0, sql: "COMMIT" },
        ...afterTransaction(0),
      ]);
    },
  );

  // Over TLS the socket does not close inside close(): the close handler, which returns the
  // slot, runs only after the peer has answered the close_notify. A release() in between,
  // which is what `await using` does, must not put the closing connection back into the pool.
  // The pool spreads two queries over every connection it holds ready, so one of them would
  // land on it and fail.
  test.each([
    {
      call: "close()",
      close: async (reserved: Bun.ReservedSQL) => {
        await reserved.unsafe("SELECT 'done'");
        await reserved.close();
      },
    },
    {
      call: "close({ timeout })",
      close: async (reserved: Bun.ReservedSQL) => {
        const inFlight = reserved.unsafe("SELECT 'in flight'").execute();
        const closed = reserved.close({ timeout: 60 });
        await inFlight;
        await closed;
      },
    },
  ])(
    "reserved.release() after $call leaves a TLS connection that is still closing to its close handler",
    async ({ close }) => {
      await using pool = await closeTestPool({ secure: true }, 2);
      const reserved = await pool.sql.reserve();
      await close(reserved);
      reserved.release();
      const results = await Promise.allSettled([pool.sql.unsafe("SELECT 'a'"), pool.sql.unsafe("SELECT 'b'")]);
      expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
      await pool.firstClose;
      await pool.sql.close();
    },
  );

  // transaction.close() ends a transaction in a rollback. With { timeout } it first waits, up
  // to the timeout, for the queries and savepoints that are pending on the transaction. Once
  // close() has accepted its arguments, the runner behind begin() and beginDistributed() does
  // not commit, whether or not the callback awaited close(). The connection stays open and
  // goes back to the pool, so the transaction that expectConnectionKept runs lands on conn 0.
  type TransactionCallback = (tx: Bun.TransactionSQL) => Promise<unknown>;
  const transactionKinds = [
    {
      kind: "begin()",
      begin: (sql: SQL, callback: TransactionCallback) => sql.begin(callback),
      started: beginCommand,
      rolledBack: ["ROLLBACK"],
    },
    {
      kind: "beginDistributed()",
      begin: (sql: SQL, callback: TransactionCallback) => sql.beginDistributed("dtx", callback),
      started: distributed.begin,
      rolledBack: distributed.rollback,
    },
  ];
  const onConn0 = (...statements: string[]): Received[] => statements.map(sql => ({ conn: 0, sql }));
  const settledCode = (promise: Promise<unknown>) =>
    promise.then(
      () => "committed",
      error => error.code,
    );

  test.each(transactionKinds)(
    "transaction.close({ timeout }) rolls $kind back once the pending query finishes",
    async ({ begin, started, rolledBack }) => {
      await using pool = await closeTestPool();
      let late: unknown;
      const outcome = await settledCode(
        begin(pool.sql, async tx => {
          const inFlight = tx.unsafe("SELECT 'in flight'").execute();
          await tx.close({ timeout: 60 });
          await inFlight;
          // The closed transaction takes no more statements, and a second close() is a no-op.
          late = await tx`SELECT 'late'`.then(
            () => "sent",
            error => error.code,
          );
          await tx.close();
        }),
      );
      expect({ outcome, late }).toEqual({ outcome: connectionClosedCode, late: connectionClosedCode });
      await expectConnectionKept(pool);
      expect(pool.received).toEqual([...onConn0(started, "SELECT 'in flight'", ...rolledBack), ...afterTransaction(0)]);
    },
  );

  // The callback returns while close({ timeout }) still waits for the query. The runner rolls
  // back at once, and close() resolves when its wait ends.
  test.each(transactionKinds)(
    "transaction.close({ timeout }) that the callback does not await rolls $kind back",
    async ({ begin, started, rolledBack }) => {
      await using pool = await closeTestPool();
      let closed: Promise<unknown> | undefined;
      const outcome = await settledCode(
        begin(pool.sql, async tx => {
          tx.unsafe("SELECT 'pending'").execute();
          closed = tx.close({ timeout: 60 });
        }),
      );
      expect(outcome).toBe(connectionClosedCode);
      await closed;
      await expectConnectionKept(pool);
      expect(pool.received).toEqual([...onConn0(started, "SELECT 'pending'", ...rolledBack), ...afterTransaction(0)]);
    },
  );

  test("transaction.close() that the callback does not await rolls back, and nothing commits after it", async () => {
    await using pool = await closeTestPool();
    let closed: Promise<unknown> | undefined;
    const outcome = await settledCode(
      pool.sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        closed = tx.close();
      }),
    );
    expect(outcome).toBe(connectionClosedCode);
    await closed;
    await expectConnectionKept(pool);
    expect(pool.received).toEqual([...onConn0(beginCommand, "SELECT 'T1a'", "ROLLBACK"), ...afterTransaction(0)]);
  });

  // A second close() resolves at once. The first one still waits when the callback returns.
  test("a second transaction.close() behind a waiting close({ timeout }) does not let the transaction commit", async () => {
    await using pool = await closeTestPool();
    let first: Promise<unknown> | undefined;
    const outcome = await settledCode(
      pool.sql.begin(async tx => {
        tx.unsafe("SELECT 'pending'").execute();
        first = tx.close({ timeout: 60 });
        await tx.close();
      }),
    );
    expect(outcome).toBe(connectionClosedCode);
    await first;
    await expectConnectionKept(pool);
    expect(pool.received).toEqual([...onConn0(beginCommand, "SELECT 'pending'", "ROLLBACK"), ...afterTransaction(0)]);
  });

  // The callback's own error reaches begin(), and the runner and close() share one rollback.
  test("a callback that throws while transaction.close({ timeout }) waits keeps its error", async () => {
    await using pool = await closeTestPool();
    let closed: Promise<unknown> | undefined;
    const outcome = await pool.sql
      .begin(async tx => {
        tx.unsafe("SELECT 'pending'").execute();
        closed = tx.close({ timeout: 60 });
        throw new Error("callback error");
      })
      .then(
        () => "committed",
        error => error.message,
      );
    expect(outcome).toBe("callback error");
    await closed;
    await expectConnectionKept(pool);
    expect(pool.received).toEqual([...onConn0(beginCommand, "SELECT 'pending'", "ROLLBACK"), ...afterTransaction(0)]);
  });

  // close() has its rollback in flight when the failing query rejects the callback. The runner
  // joins that rollback and sends no second one. A second XA END is an error on a real server.
  test.each(transactionKinds)(
    "transaction.close() awaited together with a failing query sends one rollback in $kind",
    async ({ begin, started, rolledBack }) => {
      await using pool = await closeTestPool();
      const outcome = await begin(pool.sql, async tx => {
        const failing = tx.unsafe("SELECT 'FAIL'").execute();
        await Promise.all([tx.close(), failing]);
      }).then(
        () => "committed",
        error => error.message,
      );
      expect(outcome).toBe("mock failure");
      await expectConnectionKept(pool);
      expect(pool.received).toEqual([...onConn0(started, "SELECT 'FAIL'", ...rolledBack), ...afterTransaction(0)]);
    },
  );

  // close() throws before it accepts its arguments, so this transaction is not closing.
  test("transaction.close({ timeout: -1 }) throws and leaves the transaction to commit", async () => {
    await using pool = await closeTestPool();
    const outcome = await pool.sql.begin(async tx => {
      await tx.unsafe("SELECT 'T1a'");
      return await tx.close({ timeout: -1 }).then(
        () => "closed",
        error => error.code,
      );
    });
    expect(outcome).toBe("ERR_INVALID_ARG_VALUE");
    await expectConnectionKept(pool);
    expect(pool.received).toEqual([...onConn0(beginCommand, "SELECT 'T1a'", "COMMIT"), ...afterTransaction(0)]);
  });

  // A savepoint whose callback parks until finish() is called.
  function parkedSavepoint(tx: Bun.TransactionSQL) {
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const promise = tx.savepoint(async () => {
      entered.resolve();
      await gate.promise;
      return "saved";
    });
    return { promise, entered: entered.promise, finish: gate.resolve };
  }

  test("transaction.close({ timeout }) waits for a pending savepoint, its RELEASE included", async () => {
    await using pool = await closeTestPool();
    let saved: unknown;
    const outcome = await settledCode(
      pool.sql.begin(async tx => {
        const savepoint = parkedSavepoint(tx);
        await savepoint.entered;
        const closed = tx.close({ timeout: 60 });
        savepoint.finish();
        saved = await savepoint.promise;
        await closed;
      }),
    );
    expect({ outcome, saved }).toEqual({ outcome: connectionClosedCode, saved: "saved" });
    await expectConnectionKept(pool);
    expect(pool.received).toEqual([
      ...onConn0(beginCommand, "SAVEPOINT s0", "RELEASE SAVEPOINT s0", "ROLLBACK"),
      ...afterTransaction(0),
    ]);
  });

  // The savepoint stays open, so only the timer can end the wait. The rollback closes the
  // transaction, and the savepoint's RELEASE is refused after it.
  test("transaction.close({ timeout }) rolls back when the timeout ends the wait", async () => {
    await using pool = await closeTestPool();
    let savepointCode: unknown;
    const outcome = await settledCode(
      pool.sql.begin(async tx => {
        const savepoint = parkedSavepoint(tx);
        const released = savepoint.promise.then(
          () => null,
          error => error.code,
        );
        await savepoint.entered;
        await tx.close({ timeout: 0.05 });
        savepoint.finish();
        savepointCode = await released;
      }),
    );
    expect({ outcome, savepointCode }).toEqual({ outcome: connectionClosedCode, savepointCode: connectionClosedCode });
    await expectConnectionKept(pool);
    expect(pool.received).toEqual([...onConn0(beginCommand, "SAVEPOINT s0", "ROLLBACK"), ...afterTransaction(0)]);
  });

  // bun:test also fails this test if close()'s wait reports the handled failure as unhandled.
  test("transaction.close({ timeout }) rolls back after a pending query fails, without reporting its handled error", async () => {
    await using pool = await closeTestPool();
    let failure: unknown;
    const outcome = await settledCode(
      pool.sql.begin(async tx => {
        const failed = tx.unsafe("SELECT 'FAIL'").then(
          () => null,
          error => error.message,
        );
        await tx.close({ timeout: 60 });
        failure = await failed;
      }),
    );
    expect({ outcome, failure }).toEqual({ outcome: connectionClosedCode, failure: "mock failure" });
    await expectConnectionKept(pool);
    expect(pool.received).toEqual([...onConn0(beginCommand, "SELECT 'FAIL'", "ROLLBACK"), ...afterTransaction(0)]);
  });

  // The disconnect ends the transaction and rejects begin() while the callback still runs, so
  // close() has nothing left to do but resolve. bun:test also fails this test if the wait
  // reports the query the server took down as unhandled.
  test("transaction.close({ timeout }) resolves when the server drops the connection while it waits", async () => {
    await using pool = await closeTestPool();
    const dropped = Promise.withResolvers<unknown>();
    const outcome = await settledCode(
      pool.sql.begin(async tx => {
        const query = tx.unsafe("SELECT 'KILL'").then(
          () => null,
          error => error.code,
        );
        await tx.close({ timeout: 60 }).then(() => dropped.resolve(query), dropped.reject);
      }),
    );
    expect({ outcome, dropped: await dropped.promise }).toEqual({
      outcome: connectionClosedCode,
      dropped: connectionClosedCode,
    });
    await expectSlotReturned(pool);
    expect(pool.received).toEqual([...onConn0(beginCommand, "SELECT 'KILL'"), ...afterTransaction(1)]);
  });

  test("transaction.close({ timeout }) inside reserved.begin() rolls back and keeps the reservation", async () => {
    await using pool = await closeTestPool();
    const reserved = await pool.sql.reserve();
    const outcome = await settledCode(
      reserved.begin(async tx => {
        const inFlight = tx.unsafe("SELECT 'in flight'").execute();
        await tx.close({ timeout: 60 });
        await inFlight;
      }),
    );
    expect(outcome).toBe(connectionClosedCode);
    await reserved.unsafe("SELECT 'still reserved'");
    reserved.release();
    await expectConnectionKept(pool);
    expect(pool.received).toEqual([
      ...onConn0(beginCommand, "SELECT 'in flight'", "ROLLBACK", "SELECT 'still reserved'"),
      ...afterTransaction(0),
    ]);
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
