// When the callback of sql.begin() or sql.savepoint() throws, the driver sends
// ROLLBACK (or ROLLBACK TO SAVEPOINT). If that statement itself fails, or the
// connection drops under it, the rejection is the rollback failure. The error
// the callback threw has to stay reachable as its `cause`. The mock servers
// answer every statement with OK, except that a statement starting with
// ROLLBACK gets the configured fault. Wire bytes come from ./wire-frames.ts.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import type net from "node:net";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgCommandComplete,
  pgErrorResponse,
  pgMockServer,
  pgReadyForQuery,
} from "./wire-frames";

type RollbackFault = "error" | "drop" | "none";
type MockServer = (fault: RollbackFault, received: string[]) => Promise<{ port: number; server: net.Server }>;

const pgServer: MockServer = (fault, received) =>
  pgMockServer((type, body, socket) => {
    if (type !== "Q") return;
    const sql = body.subarray(0, body.indexOf(0)).toString("utf8");
    received.push(sql);
    if (sql.startsWith("ROLLBACK")) {
      if (fault === "drop") {
        socket.destroy();
        return;
      }
      if (fault === "error") {
        return [
          pgErrorResponse({ S: "ERROR", C: "25P01", M: "there is no transaction in progress" }),
          pgReadyForQuery("I"),
        ];
      }
    }
    return [pgCommandComplete(sql.split(" ", 1)[0]), pgReadyForQuery(sql.startsWith("BEGIN") ? "T" : "I")];
  });

const mysqlServer: MockServer = (fault, received) => {
  const COM_QUIT = 0x01;
  const COM_QUERY = 0x03;
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
        if (mysqlAckSessionSetup(socket, payload)) return;
        if (payload[0] === COM_QUIT) {
          socket.end();
          return;
        }
        if (payload[0] !== COM_QUERY) return;
        const sql = payload.subarray(1).toString("utf8");
        received.push(sql);
        if (sql.startsWith("ROLLBACK")) {
          if (fault === "drop") {
            socket.destroy();
            return;
          }
          if (fault === "error") {
            socket.write(mysqlErrPacket(1, 1305, "42000", "SAVEPOINT does not exist"));
            return;
          }
        }
        socket.write(mysqlOkPacket(1));
      });
    });
    socket.on("error", () => {});
  });
};

const adapters = [
  {
    adapter: "postgres" as const,
    mockServer: pgServer,
    begin: "BEGIN",
    serverError: "ERR_POSTGRES_SERVER_ERROR",
    connectionClosed: "ERR_POSTGRES_CONNECTION_CLOSED",
  },
  {
    adapter: "mysql" as const,
    mockServer: mysqlServer,
    begin: "START TRANSACTION",
    serverError: "ERR_MYSQL_SERVER_ERROR",
    connectionClosed: "ERR_MYSQL_CONNECTION_CLOSED",
  },
];

describe.each(adapters)("$adapter", ({ adapter, mockServer, begin, serverError, connectionClosed }) => {
  async function withMock(fault: RollbackFault, fn: (sql: SQL, received: string[]) => Promise<void>) {
    const received: string[] = [];
    const { port, server } = await mockServer(fault, received);
    const sql = new SQL({
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
    try {
      await fn(sql, received);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  }

  const appError = () => new Error("APP-ERROR-MARKER");
  const settle = (p: Promise<unknown>) =>
    p.then(
      v => ({ resolved: v }),
      e => e,
    );

  test("begin(): a working ROLLBACK rejects with the callback error itself", async () => {
    await withMock("none", async (sql, received) => {
      const thrown = appError();
      const err = await settle(
        sql.begin(async tx => {
          await tx.unsafe("SELECT 1");
          throw thrown;
        }),
      );
      expect(err).toBe(thrown);
      expect(err.cause).toBeUndefined();
      expect(received).toEqual([begin, "SELECT 1", "ROLLBACK"]);
    });
  });

  test("begin(): a ROLLBACK the server rejects keeps the callback error as cause", async () => {
    await withMock("error", async (sql, received) => {
      const thrown = appError();
      const err = await settle(
        sql.begin(async tx => {
          await tx.unsafe("SELECT 1");
          throw thrown;
        }),
      );
      expect(err).toBeInstanceOf(SQL.SQLError);
      expect(err.code).toBe(serverError);
      expect(err.cause).toBe(thrown);
      expect(received).toEqual([begin, "SELECT 1", "ROLLBACK"]);
      // the connection is still usable
      await sql.unsafe("SELECT 2");
    });
  });

  test("begin(): a connection that drops during ROLLBACK keeps the callback error as cause", async () => {
    await withMock("drop", async (sql, received) => {
      const thrown = appError();
      const err = await settle(
        sql.begin(async tx => {
          await tx.unsafe("SELECT 1");
          throw thrown;
        }),
      );
      expect(err).toBeInstanceOf(SQL.SQLError);
      expect(err.code).toBe(connectionClosed);
      expect(err.cause).toBe(thrown);
      expect(received).toEqual([begin, "SELECT 1", "ROLLBACK"]);
    });
  });

  // The dropped connection rejects a query queued behind the transaction with
  // the same connection error. That query has nothing to do with the callback
  // error, so the cause must not show up on its rejection.
  test("begin(): the cause does not leak to other queries the dropped connection rejects", async () => {
    await withMock("drop", async sql => {
      const thrown = appError();
      const inTransaction = Promise.withResolvers<void>();
      const queued = Promise.withResolvers<void>();
      const transaction = settle(
        sql.begin(async tx => {
          await tx.unsafe("SELECT 1");
          inTransaction.resolve();
          await queued.promise;
          throw thrown;
        }),
      );
      await inTransaction.promise;
      // max is 1, so this query waits in the pool queue for the transaction's connection
      const waiter = settle(sql.unsafe("SELECT 'queued'"));
      queued.resolve();
      const [err, waiterErr] = await Promise.all([transaction, waiter]);
      expect(err.code).toBe(connectionClosed);
      expect(err.cause).toBe(thrown);
      expect(waiterErr).toBeInstanceOf(SQL.SQLError);
      expect(waiterErr.code).toBe(connectionClosed);
      expect(waiterErr.cause).toBeUndefined();
    });
  });

  test("savepoint(): a ROLLBACK TO SAVEPOINT the server rejects keeps the callback error as cause", async () => {
    await withMock("error", async (sql, received) => {
      const thrown = appError();
      let savepointError: any;
      const err = await settle(
        sql.begin(async tx => {
          await tx.unsafe("SELECT 1");
          savepointError = await settle(
            tx.savepoint(async sp => {
              await sp.unsafe("SELECT 2");
              throw thrown;
            }),
          );
          throw savepointError;
        }),
      );
      expect(savepointError).toBeInstanceOf(SQL.SQLError);
      expect(savepointError.code).toBe(serverError);
      expect(savepointError.cause).toBe(thrown);
      // The outer ROLLBACK fails too. Its cause is the error the callback
      // rethrew, so the whole chain stays reachable.
      expect(err).toBeInstanceOf(SQL.SQLError);
      expect(err.code).toBe(serverError);
      expect(err).not.toBe(savepointError);
      expect(err.cause).toBe(savepointError);
      expect(received).toEqual([begin, "SELECT 1", "SAVEPOINT s0", "SELECT 2", "ROLLBACK TO SAVEPOINT s0", "ROLLBACK"]);
    });
  });

  test("savepoint(): a connection that drops during ROLLBACK TO SAVEPOINT keeps the callback error as cause", async () => {
    await withMock("drop", async (sql, received) => {
      const thrown = appError();
      const err = await settle(
        sql.begin(async tx => {
          await tx.unsafe("SELECT 1");
          await tx.savepoint(async sp => {
            await sp.unsafe("SELECT 2");
            throw thrown;
          });
        }),
      );
      expect(err).toBeInstanceOf(SQL.SQLError);
      expect(err.code).toBe(connectionClosed);
      expect(err.cause).toBe(thrown);
      expect(received).toEqual([begin, "SELECT 1", "SAVEPOINT s0", "SELECT 2", "ROLLBACK TO SAVEPOINT s0"]);
    });
  });
});
