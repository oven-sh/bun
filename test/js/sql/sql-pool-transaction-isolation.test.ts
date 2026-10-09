// Pool slot accounting across the paths that hand a connection back to the pool.
// The mock servers record every statement per connection, so a transaction that
// lands on a connection somebody else still holds shows up in the recorded order.
// They also drop the socket on demand, which a real container will not do.
// Wire bytes come from ./wire-frames.ts.
import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import type net from "node:net";
import path from "node:path";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgCommandComplete,
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

  // A reserved connection and a transaction track a query from its start. A query is lazy:
  // an identifier, a fragment and a statement that nothing awaits never start.
  const closedCode = `ERR_${adapter.toUpperCase()}_CONNECTION_CLOSED`;

  // null when the query resolves, the error code when it rejects.
  async function code(query: PromiseLike<unknown>) {
    try {
      await query;
      return null;
    } catch (err: any) {
      return err.code ?? err.message;
    }
  }

  // Runs `run` against a fresh mock server. Returns its result and every statement the server received.
  async function withServer<T>(run: (sql: SQL) => Promise<T>) {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      return { result: await run(sql), sent: received.map(r => r.sql) };
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  }

  // What a handle makes and never starts.
  const neverStarted: Array<(handle: any) => unknown> = [
    handle => void handle("a"), // an identifier
    handle => void handle`a = ${1}`, // a fragment
    handle => void handle.unsafe("a = 1"), // an unsafe() fragment
    handle => handle`SELECT 1 AS ${handle("a")} WHERE ${handle`1 = 1`}`.simple(), // both, in a statement that runs
    handle => handle`SELECT ${handle({ a: 1 })}`.catch(() => {}), // a statement whose text cannot be built
    handle => void handle`SELECT 1`.cancel(), // a statement that is cancelled before it starts
  ];
  const perHandle = 20;
  async function makeNeverStarted(handle: any) {
    for (let i = 0; i < perHandle; i++) {
      for (const make of neverStarted) await make(handle);
    }
  }
  // heapStats() counts a query object as a Promise.
  const liveQueries = () => (Bun.gc(true), heapStats().objectTypeCounts.Promise ?? 0);

  test("a reserved connection and a transaction do not keep what never started", async () => {
    const { result } = await withServer(async sql => {
      await using reserved = await sql.reserve();
      return await reserved.begin(tx =>
        // A savepoint gets the handle of its transaction.
        tx.savepoint(async sp => {
          const before = liveQueries();
          await makeNeverStarted(reserved);
          await makeNeverStarted(sp);
          return liveQueries() - before;
        }),
      );
    });
    // Both handles made seven such objects `perHandle` times: 280 in all. One kind alone is 40.
    expect(result).toBeLessThan(2 * perHandle);
  });

  // How a handle ends, and what that alone sends on a reserved connection and in a transaction.
  const endings: Array<[string, (handle: any) => Promise<unknown>, string[], string[]]> = [
    ["close()", handle => handle.close(), [], ["ROLLBACK"]],
    ["close({ timeout })", handle => handle.close({ timeout: 60 }), [], ["ROLLBACK"]],
    ["a dropped connection", handle => code(handle.unsafe("SELECT 'KILL'")), ["SELECT 'KILL'"], ["SELECT 'KILL'"]],
  ];
  // Starts the queries that were made before the end, then one of each kind that is made after it.
  // Nothing handles the first one: bun:test fails the test if that is reported as an unhandled rejection.
  async function startLate(handle: any, made: PromiseLike<unknown>[]) {
    using dir = tempDir("sql-handle-late-start", { "late.sql": "SELECT 'file'" });
    handle.unsafe("SELECT 'ignored'").execute();
    const late = [handle.unsafe("SELECT 'after'").execute(), handle.file(path.join(String(dir), "late.sql"))];
    return await Promise.all([...made, ...late].map(code));
  }

  // The end of a handle must not start or reject what never started: bun:test fails these tests if an
  // identifier or a query that nothing awaited yet is reported as an unhandled rejection.
  test.each(endings)("%s leaves alone what a reserved connection never started", async (_, end, sentByEnd) => {
    const { result, sent } = await withServer(async sql => {
      const reserved = await sql.reserve();
      const made = [reserved.unsafe("SELECT 'unsafe'"), reserved`SELECT 'tagged'`.simple()];
      reserved("a");
      await end(reserved);
      return startLate(reserved, made);
    });
    expect(result).toEqual([closedCode, closedCode, closedCode, closedCode]);
    expect(sent).toEqual(sentByEnd);
  });

  test("a query that first starts after the connection dropped rejects with the error of the drop", async () => {
    const { result } = await withServer(async sql => {
      const reserved = await sql.reserve();
      const lazy = reserved.unsafe("SELECT 'lazy'");
      const error = (query: PromiseLike<unknown>) =>
        query.then(
          () => null,
          err => err,
        );
      const dropped = await error(reserved.unsafe("SELECT 'KILL'"));
      return [dropped?.code, (await error(lazy)) === dropped];
    });
    expect(result).toEqual([closedCode, true]);
  });

  // How begin() settles, then what its callback returns. begin() can reject before its callback is done.
  async function inTransaction(handle: SQL, body: (tx: any) => Promise<unknown[]>) {
    let ran: Promise<unknown[]> | undefined;
    const settled = await code(handle.begin(tx => (ran = body(tx))));
    return [settled, ...(await ran!)];
  }

  test.each(endings)("%s leaves alone what a transaction never started", async (_, end, __, sentByEnd) => {
    const { result, sent } = await withServer(sql =>
      inTransaction(sql, async tx => {
        const made = [tx.unsafe("SELECT 'unsafe'"), tx`SELECT 'tagged'`.simple()];
        tx("a");
        await end(tx);
        return startLate(tx, made);
      }),
    );
    expect(result).toEqual([closedCode, closedCode, closedCode, closedCode, closedCode]);
    expect(sent).toEqual([beginCommand, ...sentByEnd]);
  });

  // execute() starts a query at once. then() starts it one job later, and a first await calls then() one job
  // later still: both start after close() ran, and the pool rejects them in the same way.
  test("reserved.close({ timeout }) waits for a query in flight and rejects one that starts later", async () => {
    const { result, sent } = await withServer(async sql => {
      const reserved = await sql.reserve();
      const inFlight = code(reserved.unsafe("SELECT 'in flight'").execute());
      const thenBefore = code(reserved.unsafe("SELECT 'then before'").then(rows => rows));
      const sameTick = code(reserved.unsafe("SELECT 'same tick'"));
      const closed = reserved.close({ timeout: 60 });
      const during = code(reserved.unsafe("SELECT 'during'"));
      await closed;
      reserved.release();
      return Promise.all([inFlight, thenBefore, sameTick, during]);
    });
    expect(result).toEqual([null, closedCode, closedCode, closedCode]);
    expect(sent).toEqual(["SELECT 'in flight'"]);
  });

  test("tx.close() lets a query in flight finish and rejects one that starts later", async () => {
    const { result, sent } = await withServer(sql =>
      inTransaction(sql, async tx => {
        const inFlight = code(tx.unsafe("SELECT 'in flight'").execute());
        const thenBefore = code(tx.unsafe("SELECT 'then before'").then(rows => rows));
        const sameTick = code(tx.unsafe("SELECT 'same tick'"));
        await tx.close();
        return Promise.all([inFlight, thenBefore, sameTick]);
      }),
    );
    expect(result).toEqual([closedCode, null, closedCode, closedCode]);
    expect(sent).toEqual([beginCommand, "SELECT 'in flight'", "ROLLBACK"]);
  });

  test("tx.close({ timeout }) rolls back at once when nothing is in flight", async () => {
    const { result, sent } = await withServer(sql =>
      inTransaction(sql, async tx => {
        const thenBefore = code(tx.unsafe("SELECT 'then before'").then(rows => rows));
        const sameTick = code(tx.unsafe("SELECT 'same tick'"));
        await tx.close({ timeout: 60 });
        return Promise.all([thenBefore, sameTick]);
      }),
    );
    expect(result).toEqual([closedCode, closedCode, closedCode]);
    expect(sent).toEqual([beginCommand, "ROLLBACK"]);
  });

  // close() checks its argument before it stops the handle.
  test("a close() that rejects its timeout leaves a reserved connection open", async () => {
    const { result, sent } = await withServer(async sql => {
      const reserved = await sql.reserve();
      const invalid = await code(reserved.close({ timeout: -1 }));
      const open = [await code(reserved.unsafe("SELECT 'unsafe'")), await code(reserved`SELECT 'tagged'`.simple())];
      await reserved.close();
      return [invalid, ...open, await code(reserved.unsafe("SELECT 'closed'"))];
    });
    expect(result).toEqual(["ERR_INVALID_ARG_VALUE", null, null, closedCode]);
    expect(sent).toEqual(["SELECT 'unsafe'", "SELECT 'tagged'"]);
  });

  test("a close() that rejects its timeout leaves a transaction open", async () => {
    const { result, sent } = await withServer(sql =>
      inTransaction(sql, async tx => [
        await code(tx.close({ timeout: -1 })),
        await code(tx.unsafe("SELECT 'unsafe'")),
        await code(tx`SELECT 'tagged'`.simple()),
      ]),
    );
    expect(result).toEqual([null, "ERR_INVALID_ARG_VALUE", null, null]);
    expect(sent).toEqual([beginCommand, "SELECT 'unsafe'", "SELECT 'tagged'", "COMMIT"]);
  });

  // release() and the end of a transaction do not close the handle's connection.
  test("a query that first starts after release() or after COMMIT still runs", async () => {
    const { result, sent } = await withServer(async sql => {
      const reserved = await sql.reserve();
      const afterRelease = reserved.unsafe("SELECT 'after release'");
      await reserved.release();
      let afterCommit: PromiseLike<unknown> | undefined;
      await sql.begin(async tx => {
        afterCommit = tx.unsafe("SELECT 'after commit'");
      });
      return [await code(afterRelease), await code(afterCommit!)];
    });
    expect(result).toEqual([null, null]);
    expect(sent).toEqual([beginCommand, "COMMIT", "SELECT 'after release'", "SELECT 'after commit'"]);
  });

  // close() runs between the call of savepoint() and the start of its SAVEPOINT statement.
  test("tx.close() stops a savepoint that did not start", async () => {
    const { result, sent } = await withServer(sql =>
      inTransaction(sql, async tx => {
        let ran = false;
        const savepoint = code(
          tx.savepoint(async () => {
            ran = true;
          }),
        );
        await tx.close();
        return [await savepoint, ran];
      }),
    );
    expect(result).toEqual([closedCode, closedCode, false]);
    expect(sent).toEqual([beginCommand, "ROLLBACK"]);
  });

  // bun:test fails this test if the wait of close({ timeout }) reports the stopped savepoint as an unhandled rejection.
  test("tx.close({ timeout }) stops a savepoint that did not start", async () => {
    const { result, sent } = await withServer(sql =>
      inTransaction(sql, async tx => {
        let ran = false;
        const savepoint = code(
          tx.savepoint(async () => {
            ran = true;
          }),
        );
        await tx.close({ timeout: 60 });
        return [await savepoint, ran];
      }),
    );
    // How begin() settles after close({ timeout }) is not the subject here.
    expect(result.slice(1)).toEqual([closedCode, false]);
    expect(sent.filter(statement => statement.startsWith("SAVEPOINT"))).toEqual([]);
  });

  // The reserved connection closes after the savepoint made its RELEASE SAVEPOINT statement and before that starts.
  test("a savepoint that ends after its reserved connection closed rejects with connection closed", async () => {
    const { result, sent } = await withServer(async sql => {
      const reserved = await sql.reserve();
      return inTransaction(reserved, async tx => {
        const called = Promise.withResolvers<void>();
        const body = Promise.withResolvers<void>();
        const savepoint = code(
          tx.savepoint(() => {
            called.resolve();
            return body.promise;
          }),
        );
        await called.promise;
        // Runs right after the savepoint's own reaction to `body`, which makes the RELEASE SAVEPOINT statement.
        body.promise.then(() => reserved.close());
        body.resolve();
        return [await savepoint];
      });
    });
    expect(result).toEqual([closedCode, closedCode]);
    expect(sent).toEqual([beginCommand, "SAVEPOINT s0"]);
  });

  // A query that is cancelled before it starts never reaches the server. It rejects when it first starts.
  const cancelledCode = `ERR_${adapter.toUpperCase()}_QUERY_CANCELLED`;

  test("a pool query that is cancelled before it starts rejects when it is awaited or executed", async () => {
    const { result, sent } = await withServer(async sql => {
      const awaited = sql.unsafe("SELECT 'awaited'").cancel();
      const executed = sql.unsafe("SELECT 'executed'").cancel().execute();
      // Promise.prototype.then() does not start a query: execute() alone has to reject this one.
      const executedCode = Promise.prototype.then.call(
        executed,
        () => null,
        (err: any) => err.code,
      );
      return [await code(awaited), await executedCode, await code(sql.unsafe("SELECT 'next'"))];
    });
    expect(result).toEqual([cancelledCode, cancelledCode, null]);
    expect(sent).toEqual(["SELECT 'next'"]);
  });

  test.each(endings)(
    "a query that is cancelled before it starts rejects after %s on a reserved connection",
    async (_, end, sentByEnd) => {
      const { result, sent } = await withServer(async sql => {
        const reserved = await sql.reserve();
        const cancelled = reserved.unsafe("SELECT 'cancelled'").cancel();
        await end(reserved);
        return code(cancelled);
      });
      expect(result).toBe(cancelledCode);
      expect(sent).toEqual(sentByEnd);
    },
  );

  test.each(endings)(
    "a query that is cancelled before it starts rejects after %s in a transaction",
    async (_, end, __, sentByEnd) => {
      const { result, sent } = await withServer(sql =>
        inTransaction(sql, async tx => {
          const cancelled = tx.unsafe("SELECT 'cancelled'").cancel();
          await end(tx);
          return [await code(cancelled)];
        }),
      );
      expect(result).toEqual([closedCode, cancelledCode]);
      expect(sent).toEqual([beginCommand, ...sentByEnd]);
    },
  );
});
