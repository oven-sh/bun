// Pool slot accounting across the paths that hand a connection back to the pool,
// and what happens to queued work when a connection drops. The mock servers
// record every statement per connection, so a transaction that lands on a
// connection somebody else still holds shows up in the recorded order, and so
// does the connection a re-queued query ends up on. They also drop the socket
// on demand, which a real container will not do. Wire bytes come from
// ./wire-frames.ts.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import type net from "node:net";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgMockServer as pgExtendedMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
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

const adapters: Array<{
  adapter: "postgres" | "mysql";
  mockServer: MockServer;
  beginCommand: string;
  closedCode: string;
}> = [
  {
    adapter: "postgres",
    mockServer: pgMockServer,
    beginCommand: "BEGIN",
    closedCode: "ERR_POSTGRES_CONNECTION_CLOSED",
  },
  {
    adapter: "mysql",
    mockServer: mysqlMockServer,
    beginCommand: "START TRANSACTION",
    closedCode: "ERR_MYSQL_CONNECTION_CLOSED",
  },
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

describe.each(adapters)("$adapter", ({ adapter, mockServer, beginCommand, closedCode }) => {
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

      // Two queries are bound to the slot when the server drops it. The first is
      // on the wire and fails; the second was never sent, so it runs once the
      // slot has dialled again.
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
      expect(e2).toBeNull();

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

  // The query on the wire when the connection drops fails: the server may have run
  // it. The queries queued behind it on that connection were never written, so
  // they run, in order, on the connection the slot dials next.
  test("queries the dropped connection never sent run on the re-dialled connection", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");

      const results = await Promise.allSettled([
        sql.unsafe("SELECT 'KILL'"),
        sql.unsafe("SELECT 'q1'"),
        sql.unsafe("SELECT 'q2'"),
        sql.unsafe("SELECT 'q3'"),
      ]);

      expect(results.map(r => r.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled"]);
      expect((results[0] as PromiseRejectedResult).reason.code).toBe(closedCode);
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'warm'" },
        { conn: 0, sql: "SELECT 'KILL'" },
        { conn: 1, sql: "SELECT 'q1'" },
        { conn: 1, sql: "SELECT 'q2'" },
        { conn: 1, sql: "SELECT 'q3'" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("a query the dropped connection never sent moves to a live connection without a new dial", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL({ ...options(port), max: 2 });
    try {
      // Two concurrent queries only spread across both slots once both are connected.
      do {
        await Promise.all([sql.unsafe("SELECT 'ping'"), sql.unsafe("SELECT 'ping'")]);
      } while (new Set(received.map(r => r.conn)).size < 2);
      received.length = 0;

      // The pool alternates: KILL and q2 share one connection, q1 and q3 the other.
      // q2 is queued behind KILL and not yet written when that connection drops.
      const results = await Promise.allSettled([
        sql.unsafe("SELECT 'KILL'"),
        sql.unsafe("SELECT 'q1'"),
        sql.unsafe("SELECT 'q2'"),
        sql.unsafe("SELECT 'q3'"),
      ]);
      expect(results.map(r => r.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled"]);

      const killedConn = received.find(r => r.sql === "SELECT 'KILL'")!.conn;
      const liveConn = received.find(r => r.sql === "SELECT 'q1'")!.conn;
      expect(liveConn).not.toBe(killedConn);
      expect(received.filter(r => r.sql === "SELECT 'q2'")).toEqual([{ conn: liveConn, sql: "SELECT 'q2'" }]);
      expect([...new Set(received.map(r => r.conn))].sort()).toEqual([killedConn, liveConn].sort());
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // A transaction is bound to its connection, so its unsent queries cannot move.
  test("a transaction's unsent queries fail with the dropped connection", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");

      // begin() rejects as soon as the connection drops, before its callback settles.
      let inner!: Promise<PromiseSettledResult<any>[]>;
      const err = await sql
        .begin(async tx => {
          inner = Promise.allSettled([tx.unsafe("SELECT 'KILL'"), tx.unsafe("SELECT 'in tx, never sent'")]);
          await inner;
        })
        .then(
          () => null,
          e => e,
        );
      expect(err).toBeInstanceOf(Error);
      const settled = await inner;
      expect(settled.map(r => r.status)).toEqual(["rejected", "rejected"]);
      expect((settled[1] as PromiseRejectedResult).reason.code).toBe(closedCode);

      await sql.unsafe("SELECT 'revive'");
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'warm'" },
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'KILL'" },
        { conn: 1, sql: "SELECT 'revive'" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Nothing a pending reservation asked for reached the server either, so the pool
  // dials again for it instead of failing it along with the dropped connection.
  test("a reservation waiting on the dropped connection gets the re-dialled one", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");

      // execute() sends KILL right away, so reserve() finds the pool's only slot busy and waits.
      const killed = sql.unsafe("SELECT 'KILL'").execute();
      const reserving = sql.reserve();
      expect(
        await killed.then(
          () => null,
          e => e,
        ),
      ).toBeInstanceOf(Error);

      const reserved = await reserving;
      await reserved.unsafe("SELECT 'R1'");
      reserved.release();
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'warm'" },
        { conn: 0, sql: "SELECT 'KILL'" },
        { conn: 1, sql: "SELECT 'R1'" },
      ]);
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

// With parameters, postgres prepares a named statement first (Parse/Describe/
// Sync) and sends Bind/Execute once the server has answered. A query whose Parse
// went out already counts as sent: when the connection drops it fails like a
// query mid-flight, even though it never executed. Only the queries behind it,
// with nothing on the wire, move to the next connection.
describe("postgres extended protocol", () => {
  test("a query with its Parse on the wire fails with the dropped connection, the unsent ones behind it move", async () => {
    const parsed: Received[] = [];
    let nextConn = 0;
    const ids = new WeakMap<net.Socket, { conn: number; params: number; stalled: boolean }>();
    const state = (socket: net.Socket) => {
      let s = ids.get(socket);
      if (!s) ids.set(socket, (s = { conn: nextConn++, params: 0, stalled: false }));
      return s;
    };
    // The server answers Parse and Describe of the 'stall' query but never its
    // Sync, so Bind/Execute are never sent; then it drops the connection.
    const { port, server } = await pgExtendedMockServer((type, body, socket) => {
      const s = state(socket);
      switch (type) {
        case "P": {
          const from = body.indexOf(0) + 1;
          const sql = body.toString("utf8", from, body.indexOf(0, from));
          parsed.push({ conn: s.conn, sql });
          s.params = body.readInt16BE(body.indexOf(0, from) + 1);
          if (sql.includes("stall")) s.stalled = true;
          return pgParseComplete();
        }
        case "D":
          return [pgParameterDescription(Array(s.params).fill(23)), pgRowDescription([{ name: "v", typeOid: 25 }])];
        case "B":
          return pgBindComplete();
        case "E":
          return s.stalled ? undefined : [pgDataRow([Buffer.from("7")]), pgCommandComplete("SELECT 1")];
        case "S":
          if (!s.stalled) return pgReadyForQuery();
          socket.destroy();
          return;
      }
    });
    const sql = new SQL({
      url: `postgres://u:p@127.0.0.1:${port}/db`,
      max: 1,
      idleTimeout: 5,
    });
    try {
      await sql`select 'warm' as v`;

      const results = await Promise.allSettled([
        sql`select 'stall' as v, ${0}::int`,
        sql`select ${1}::int as v`,
        sql`select ${2}::int as v`,
        sql`select ${3}::int as v`,
      ]);

      expect(results.map(r => r.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled"]);
      expect((results[0] as PromiseRejectedResult).reason.code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
      // q1..q3 share one prepared statement, so the new connection parses it once.
      expect(parsed.map(p => [p.conn, p.sql.replace(/\s+/g, " ")])).toEqual([
        [0, "select 'warm' as v"],
        [0, "select 'stall' as v, $1 ::int"],
        [1, "select $1 ::int as v"],
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
