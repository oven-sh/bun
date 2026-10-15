// Pool slot accounting across the paths that hand a connection back to the pool.
// The mock servers record every statement per connection, so a transaction that
// lands on a connection somebody else still holds shows up in the recorded order.
// They also drop the socket on demand, which a real container will not do.
// Wire bytes come from ./wire-frames.ts.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import type net from "node:net";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgCommandComplete,
  pgReadyForQuery,
} from "./wire-frames";

type Received = { conn: number; sql: string };
// `answer` gives the packet that answers a statement. Without it, or when it returns undefined, the answer is OK.
type MockServer = (
  received: Received[],
  answer?: (sql: string) => Buffer | undefined,
) => Promise<{ port: number; server: net.Server }>;

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

const mysqlMockServer: MockServer = (received, answer) => {
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
          socket.write(answer?.(sql) ?? mysqlOkPacket(1));
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

// sql.beginDistributed() on MySQL and MariaDB is an XA branch: XA START, the callback, then XA END
// and XA PREPARE, or XA END and XA ROLLBACK when the callback throws. The server rejects XA END
// when the branch is no longer ACTIVE. When the server rolled the work of the branch back, the
// branch is ROLLBACK ONLY, and only XA ROLLBACK ends it. The cases with a real deadlock are in
// sql-mysql.test.ts.
//
// This mock keeps the XA state of its connection. It answers each XA statement as MySQL 8.4 or
// MariaDB 11.8 does in that state. It shows the statements on the wire, and it gives the answers
// that a real server does not produce on demand.
type XaServer = "mysql" | "mariadb";
type XaState = "NON-EXISTING" | "ACTIVE" | "IDLE" | "PREPARED" | "ROLLBACK ONLY";
type XaRejection = [code: number, sqlState: string, message: string];

// Statements that stand for work that the server rolls back: the error of the statement, and what
// MySQL answers to the XA END after it. MariaDB makes the branch ROLLBACK ONLY at once.
const xaRolledBack: Record<string, { error: XaRejection; end: XaRejection }> = {
  "SELECT 'DEADLOCK'": {
    error: [1213, "40001", "Deadlock found when trying to get lock; try restarting transaction"],
    end: [1614, "XA102", "XA_RBDEADLOCK: Transaction branch was rolled back: deadlock was detected"],
  },
  // With innodb_rollback_on_timeout. Without it the server rolls back the statement only.
  "SELECT 'LOCK WAIT TIMEOUT'": {
    error: [1205, "HY000", "Lock wait timeout exceeded; try restarting transaction"],
    end: [1613, "XA106", "XA_RBTIMEOUT: Transaction branch was rolled back: took too long"],
  },
  "SELECT 'LOCK TABLE FULL'": {
    error: [1206, "HY000", "The total number of locks exceeds the lock table size"],
    end: [1402, "XA100", "XA_RBROLLBACK: Transaction branch was rolled back"],
  },
};

async function xaMockServer(kind: XaServer, faults: { rejectRollbacks?: number } = {}) {
  const received: Received[] = [];
  let state: XaState = "NON-EXISTING";
  // MySQL keeps the branch ACTIVE after the server rolled its work back. XA END gets this answer then.
  let rolledBack: XaRejection | undefined;
  // MySQL detaches a prepared branch from the session. XA ROLLBACK still finds it by name.
  let detached = false;
  let rejectRollbacks = faults.rejectRollbacks ?? 0;

  const rmfail = (): XaRejection => [
    1399,
    "XAE07",
    `XAER_RMFAIL: The command cannot be executed when global transaction is in the  ${state} state`,
  ];

  /** Applies one statement to the branch. Returns the error of a statement that the server rejects. */
  function apply(sql: string): XaRejection | undefined {
    if (sql.startsWith("XA START")) {
      if (state !== "NON-EXISTING") return rmfail();
      state = "ACTIVE";
    } else if (sql in xaRolledBack) {
      if (kind === "mariadb") state = "ROLLBACK ONLY";
      else rolledBack = xaRolledBack[sql].end;
      return xaRolledBack[sql].error;
    } else if (sql.startsWith("XA END")) {
      if (rolledBack) {
        state = "ROLLBACK ONLY";
        return rolledBack;
      }
      if (state !== "ACTIVE") return rmfail();
      state = "IDLE";
    } else if (sql.startsWith("XA PREPARE")) {
      if (state !== "IDLE") return rmfail();
      state = kind === "mysql" ? "NON-EXISTING" : "PREPARED";
      detached = kind === "mysql";
    } else if (sql.startsWith("XA ROLLBACK")) {
      if (state === "ACTIVE") return rmfail();
      if (state === "NON-EXISTING" && !detached) return [1397, "XAE04", "XAER_NOTA: Unknown XID"];
      if (rejectRollbacks > 0) {
        rejectRollbacks--;
        return [
          1401,
          "XAE03",
          "XAER_RMERR: Fatal error occurred in the transaction branch - check your data for consistency",
        ];
      }
      state = "NON-EXISTING";
      rolledBack = undefined;
      detached = false;
    }
    return undefined;
  }

  const { port, server } = await mysqlMockServer(received, sql => {
    const rejection = apply(sql);
    return rejection && mysqlErrPacket(1, ...rejection);
  });
  return {
    port,
    server,
    /** Every statement, in the order of arrival. */
    statements: () => received.map(({ sql }) => sql),
    state: () => state,
    /** True while a prepared branch exists, on the session or detached from it. */
    prepared: () => state === "PREPARED" || detached,
  };
}

describe("mysql distributed transaction, XA END rejected", () => {
  /** The mock, and a pool with one connection to it. */
  async function connect(kind: XaServer, faults?: Parameters<typeof xaMockServer>[1]) {
    const server = await xaMockServer(kind, faults);
    const sql = new SQL({
      adapter: "mysql",
      hostname: "127.0.0.1",
      port: server.port,
      username: "u",
      password: "p",
      database: "db",
      max: 1,
      tls: false,
    });
    return {
      server,
      sql,
      async [Symbol.asyncDispose]() {
        await sql.close({ timeout: 0 }).catch(() => {});
        await new Promise<void>(resolve => server.server.close(() => resolve()));
      },
    };
  }

  /** What a promise settles with: "resolved", or the error. */
  const settled = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      (error: unknown) => error,
    );
  /** The same for an error of the server: "resolved", or its errno and SQLSTATE. */
  const answered = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      (error: any) => ({ errno: error.errno, sqlState: error.sqlState }),
    );

  // The statement that makes the server roll the work of the branch back, and the answer to XA END after it.
  const rollbacks: { how: string; kind: XaServer; statement: string; answer: { errno: number; sqlState: string } }[] = [
    {
      how: "MySQL after a deadlock (XA_RBDEADLOCK)",
      kind: "mysql",
      statement: "SELECT 'DEADLOCK'",
      answer: { errno: 1614, sqlState: "XA102" },
    },
    {
      how: "MySQL after a lock wait timeout that rolled the transaction back (XA_RBTIMEOUT)",
      kind: "mysql",
      statement: "SELECT 'LOCK WAIT TIMEOUT'",
      answer: { errno: 1613, sqlState: "XA106" },
    },
    {
      how: "MySQL after another error that rolled the transaction back (XA_RBROLLBACK)",
      kind: "mysql",
      statement: "SELECT 'LOCK TABLE FULL'",
      answer: { errno: 1402, sqlState: "XA100" },
    },
    {
      how: "MariaDB after a deadlock (XAER_RMFAIL, ROLLBACK ONLY)",
      kind: "mariadb",
      statement: "SELECT 'DEADLOCK'",
      answer: { errno: 1399, sqlState: "XAE07" },
    },
  ];

  describe.each(rollbacks)("$how", ({ kind, statement, answer }) => {
    const rolledBack = ["XA START 'x'", statement, "XA END 'x'", "XA ROLLBACK 'x'"];

    test("the callback throws: XA ROLLBACK follows, begin() rejects with the callback's error", async () => {
      await using xa = await connect(kind);
      const error = new Error("callback error");

      const begin = await settled(
        xa.sql.beginDistributed("x", async tx => {
          await answered(tx.unsafe(statement));
          throw error;
        }),
      );

      expect(begin).toBe(error);
      expect(xa.server.statements()).toEqual(rolledBack);
      expect(xa.server.state()).toBe("NON-EXISTING");
    });

    test("the callback returns: XA END goes out once, XA ROLLBACK follows, begin() rejects with the answer to XA END", async () => {
      await using xa = await connect(kind);

      const begin = await answered(
        xa.sql.beginDistributed("x", async tx => {
          await answered(tx.unsafe(statement));
        }),
      );

      expect(begin).toEqual(answer);
      expect(xa.server.statements()).toEqual(rolledBack);
      expect(xa.server.state()).toBe("NON-EXISTING");
    });
  });

  test("reserved.beginDistributed() sends XA ROLLBACK after a rejected XA END", async () => {
    await using xa = await connect("mysql");
    const error = new Error("callback error");
    const reserved = await xa.sql.reserve();

    const begin = await settled(
      reserved.beginDistributed("x", async tx => {
        await answered(tx.unsafe("SELECT 'DEADLOCK'"));
        throw error;
      }),
    );
    reserved.release();

    expect(begin).toBe(error);
    expect(xa.server.statements()).toEqual(["XA START 'x'", "SELECT 'DEADLOCK'", "XA END 'x'", "XA ROLLBACK 'x'"]);
  });

  test("sql.distributed() sends XA ROLLBACK after a rejected XA END", async () => {
    await using xa = await connect("mariadb");
    const error = new Error("callback error");

    const begin = await settled(
      xa.sql.distributed("x", async tx => {
        await answered(tx.unsafe("SELECT 'DEADLOCK'"));
        throw error;
      }),
    );

    expect(begin).toBe(error);
    expect(xa.server.statements()).toEqual(["XA START 'x'", "SELECT 'DEADLOCK'", "XA END 'x'", "XA ROLLBACK 'x'"]);
  });

  // The rollback did not get through. begin() rejects with the answer to XA END, not with the
  // answer to XA ROLLBACK.
  test("XA END and XA ROLLBACK both rejected: begin() rejects with the answer to XA END", async () => {
    await using xa = await connect("mysql", { rejectRollbacks: 1 });

    const begin = await answered(
      xa.sql.beginDistributed("x", async tx => {
        await answered(tx.unsafe("SELECT 'DEADLOCK'"));
        throw new Error("callback error");
      }),
    );

    expect(begin).toEqual({ errno: 1614, sqlState: "XA102" });
    expect(xa.server.statements()).toEqual(["XA START 'x'", "SELECT 'DEADLOCK'", "XA END 'x'", "XA ROLLBACK 'x'"]);
    expect(xa.server.state()).toBe("ROLLBACK ONLY");
  });

  // XA ROLLBACK works by name. It also removes a prepared branch, and MySQL lets any session do
  // that. So the runner sends it only for a ROLLBACK ONLY branch. After every other rejection of
  // XA END it stops, and begin() rejects with that rejection.
  describe("no XA ROLLBACK from the runner for a branch that is not ROLLBACK ONLY", () => {
    // tx.close() ended the branch and rolls it back itself. The runner sees an IDLE branch.
    test("tx.close() is not awaited: one XA ROLLBACK", async () => {
      await using xa = await connect("mysql");
      let closed: Promise<unknown> | undefined;

      const begin = await answered(
        xa.sql.beginDistributed("x", async tx => {
          closed = settled(tx.close());
          throw new Error("callback error");
        }),
      );

      expect(await closed).toBe("resolved");
      expect(begin).toEqual({ errno: 1399, sqlState: "XAE07" });
      expect(xa.server.statements()).toEqual(["XA START 'x'", "XA END 'x'", "XA END 'x'", "XA ROLLBACK 'x'"]);
    });

    test.each([
      { branch: "IDLE: the callback ended it", kind: "mysql" as const, by: ["XA END 'x'"], prepared: false },
      {
        branch: "gone: the callback rolled it back",
        kind: "mysql" as const,
        by: ["XA END 'x'", "XA ROLLBACK 'x'"],
        prepared: false,
      },
      {
        branch: "prepared by the callback, and detached (MySQL)",
        kind: "mysql" as const,
        by: ["XA END 'x'", "XA PREPARE 'x'"],
        prepared: true,
      },
      {
        branch: "prepared by the callback (MariaDB)",
        kind: "mariadb" as const,
        by: ["XA END 'x'", "XA PREPARE 'x'"],
        prepared: true,
      },
    ])("the branch is $branch", async ({ kind, by, prepared }) => {
      await using xa = await connect(kind);

      const begin = await answered(
        xa.sql.beginDistributed("x", async tx => {
          for (const statement of by) await tx.unsafe(statement);
          throw new Error("callback error");
        }),
      );

      expect(begin).toEqual({ errno: 1399, sqlState: "XAE07" });
      expect(xa.server.statements()).toEqual(["XA START 'x'", ...by, "XA END 'x'"]);
      expect(xa.server.prepared()).toBe(prepared);
    });
  });
});
