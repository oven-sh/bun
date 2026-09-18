// Pool slot accounting across the paths that hand a connection back to the pool.
// The mock servers record every statement per connection, so a transaction that
// lands on a connection somebody else still holds shows up in the recorded order.
// They also drop the socket on demand, which a real container will not do.
// Wire bytes come from ./wire-frames.ts.
import { SQL } from "bun";
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

// Ways to hold a pool slot. `use` keeps running after the connection under it closed.
// A transaction rejects when its connection closes. A reservation has nothing to reject.
const slotHolders: Array<{
  name: string;
  rejects: boolean;
  hold: (sql: SQL, use: (handle: SQL) => Promise<void>) => Promise<void>;
}> = [
  { name: "sql.begin() callback", rejects: true, hold: (sql, use) => sql.begin(use) },
  {
    name: "sql.reserve() handle",
    rejects: false,
    hold: async (sql, use) => {
      await using reserved = await sql.reserve();
      await use(reserved);
    },
  },
  {
    name: "reserved.begin() callback",
    rejects: true,
    hold: async (sql, use) => {
      await using reserved = await sql.reserve();
      await reserved.begin(use);
    },
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

  // sql.begin() rejects as soon as its connection closes, but the callback can keep
  // running. The pool's only slot must not stay with it: reserve() and begin() need an
  // idle slot, while a plain query is answered either way.
  test("sql.begin() gives its pool slot back when its connection closes, not when the callback returns", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    const callbackMayReturn = Promise.withResolvers<void>();
    try {
      let callbackReturned = false;
      const abandoned = sql.begin(async tx => {
        await tx.unsafe("SELECT 'KILL'").catch(() => {});
        await callbackMayReturn.promise;
        callbackReturned = true;
      });
      expect(
        await abandoned.then(
          () => null,
          e => e?.code,
        ),
      ).toBe(closedCode);

      const r1 = sql.reserve().then(async reserved => {
        const servedAfterCallbackReturned = callbackReturned;
        await reserved.unsafe("SELECT 'R1'");
        reserved.release();
        return servedAfterCallbackReturned;
      });
      const t2 = sql.begin(async tx => {
        const servedAfterCallbackReturned = callbackReturned;
        await tx.unsafe("SELECT 'T2a'");
        // The abandoned callback returns while this transaction holds the slot. It must
        // not release the slot a second time, or t3 starts inside this transaction.
        callbackMayReturn.resolve();
        await tx.unsafe("SELECT 'T2b'");
        return servedAfterCallbackReturned;
      });
      const t3 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T3a'");
      });
      // Queued last on purpose. A plain query is answered even while reserve() and begin()
      // are stuck, so this await cannot hang. Only then may the abandoned callback return.
      await sql.unsafe("SELECT 'plain'");
      callbackMayReturn.resolve();

      const [reserve, begin] = await Promise.all([r1, t2, t3]);
      expect({ servedAfterCallbackReturned: { reserve, begin }, received }).toEqual({
        servedAfterCallbackReturned: { reserve: false, begin: false },
        received: [
          { conn: 0, sql: beginCommand },
          { conn: 0, sql: "SELECT 'KILL'" },
          { conn: 1, sql: "SELECT 'R1'" },
          { conn: 1, sql: beginCommand },
          { conn: 1, sql: "SELECT 'T2a'" },
          { conn: 1, sql: "SELECT 'T2b'" },
          { conn: 1, sql: "COMMIT" },
          { conn: 1, sql: beginCommand },
          { conn: 1, sql: "SELECT 'T3a'" },
          { conn: 1, sql: "COMMIT" },
          { conn: 1, sql: "SELECT 'plain'" },
        ],
      });
    } finally {
      callbackMayReturn.resolve();
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // A graceful close() waits for the work the pool still counts. The abandoned transaction
  // must not be part of it. Nothing is left to close, so close() settles in microtasks, and
  // one turn of the event loop tells the two outcomes apart without a wait on time.
  test("sql.close() does not wait for a sql.begin() callback that lost its connection", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    const callbackMayReturn = Promise.withResolvers<void>();
    try {
      let callbackReturned = false;
      const abandoned = sql.begin(async tx => {
        await tx.unsafe("SELECT 'KILL'").catch(() => {});
        await callbackMayReturn.promise;
        callbackReturned = true;
      });
      expect(
        await abandoned.then(
          () => null,
          e => e?.code,
        ),
      ).toBe(closedCode);

      const closedAfterCallbackReturned = sql.close().then(() => callbackReturned);
      await new Promise<void>(resolve => setImmediate(resolve));
      callbackMayReturn.resolve();
      expect(await closedAfterCallbackReturned).toBe(false);
    } finally {
      callbackMayReturn.resolve();
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // The slot reconnects and serves other callers. A statement from the holder that lost
  // the connection must not reach the new one: it would run outside its transaction, or
  // inside the transaction of whoever has the slot by then.
  test.each(slotHolders)("a $name that outlives its connection cannot query the next one", async holder => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    using dir = tempDir("sql-pool-stowaway", { "stowaway.sql": "SELECT 'stowaway file'" });
    const connectionLost = Promise.withResolvers<void>();
    const slotReconnected = Promise.withResolvers<void>();
    const stowaways = Promise.withResolvers<PromiseSettledResult<unknown>[]>();
    try {
      let holding = false;
      const holderSettled = holder.hold(sql, async handle => {
        holding = true;
        await handle.unsafe("SELECT 'KILL'").catch(() => {});
        connectionLost.resolve();
        await slotReconnected.promise;
        // allSettled does not reject. The catch turns a synchronous throw into a failure, not a hang.
        try {
          stowaways.resolve(
            await Promise.allSettled([
              handle.unsafe("SELECT 'stowaway'"),
              handle.unsafe("SELECT 'stowaway values'").values(),
              handle.file(path.join(String(dir), "stowaway.sql")),
            ]),
          );
        } catch (err) {
          stowaways.reject(err);
        }
      });
      const held = holderSettled.then(
        () => "fulfilled",
        err => {
          // A rejection before `use` ran is a setup failure. Nothing else would end the wait below.
          if (!holding) connectionLost.reject(err);
          return err?.code;
        },
      );

      await connectionLost.promise;
      await sql.unsafe("SELECT 'reconnect'");
      slotReconnected.resolve();

      const outcomes = (await stowaways.promise).map(result =>
        result.status === "rejected" ? result.reason?.code : "sent",
      );
      expect({ held: await held, outcomes, received: received.filter(({ conn }) => conn === 1) }).toEqual({
        held: holder.rejects ? closedCode : "fulfilled",
        outcomes: [closedCode, closedCode, closedCode],
        received: [{ conn: 1, sql: "SELECT 'reconnect'" }],
      });

      // Each holder gave the slot back exactly once, so the slot is idle and reserve() takes
      // it synchronously. With any other count the reservation is queued, and the abort
      // cancels it before it can wait.
      const controller = new AbortController();
      const reservedAgain = sql.reserve({ signal: controller.signal }).then(
        reserved => {
          reserved.release();
          return true;
        },
        () => false,
      );
      controller.abort();
      expect(await reservedAgain).toBe(true);
    } finally {
      slotReconnected.resolve();
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
