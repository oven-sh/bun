// query.wait(ms), query.executeSync(ms), query.cancelSync(ms) and sql.reserveSync(ms).
//
//   query.wait(ms)         block until the query has settled: true, false when
//                          `ms` passed, null when only the event loop can settle it
//   query.executeSync(ms)  the result, or a throw, where it is called
//   query.cancelSync(ms)   cancel(), sent before the caller goes on
//   sql.reserveSync(ms)    a connection of the caller's own, where it is called
//
// None of them lets the event loop turn. Most of this file is about that:
// nothing else of the program may run in the middle of the caller's statement.

import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer, isWindows } from "harness";
import path from "node:path";

const isPromise = (value: unknown): boolean =>
  value !== null && typeof value === "object" && typeof (value as { then?: unknown }).then === "function";

describe("sqlite", () => {
  test("a query has run when it is asked, so wait() is true and executeSync() is its rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const query = sql`select 1 as one`;
    expect(query.wait(100)).toBe(true);
    const rows = sql`select 2 as two`.executeSync();
    expect(isPromise(rows)).toBe(false);
    expect(rows).toEqual([{ two: 2 }]);
    expect(() => sql.unsafe("select * from no_such_table").executeSync()).toThrow(SQL.SQLError);
  });

  test("reserveSync() throws as reserve() rejects: there are no connections to reserve", async () => {
    await using sql = new SQL("sqlite://:memory:");
    expect(() => sql.reserveSync()).toThrow("This adapter doesn't support connection reservation");
  });
});

type Server = {
  image: string;
  dialect: "postgres" | "mysql";
  options: (host: string, port: number) => Bun.SQL.PostgresOrMySQLOptions;
};

const servers: Server[] = [
  {
    image: "postgres_plain",
    dialect: "postgres",
    options: (host, port) => ({ url: `postgres://bun_sql_test@${host}:${port}/bun_sql_test` }),
  },
  {
    image: "postgres_tls",
    dialect: "postgres",
    options: (host, port) => ({
      url: `postgres://postgres@${host}:${port}/bun_sql_test`,
      tls: { ca: Bun.file(path.join(import.meta.dir, "docker-tls", "server.crt")), serverName: "localhost" },
    }),
  },
  {
    image: "mysql_plain",
    dialect: "mysql",
    options: (host, port) => ({ url: `mysql://root@${host}:${port}/bun_sql_test` }),
  },
  {
    image: "mysql_tls",
    dialect: "mysql",
    options: (host, port) => ({
      url: `mysql://root:bun@${host}:${port}/bun_sql_test`,
      allowPublicKeyRetrieval: true,
      tls: Bun.file(path.join(import.meta.dir, "mysql-tls", "ssl", "ca.pem")),
    }),
  },
];

const dialects = {
  postgres: {
    /** A statement that takes about `seconds` on the server. */
    sleep: (seconds: number) => `select pg_sleep(${seconds})`,
    /** `count` rows of about a kilobyte each. */
    wide: (count: number) => `select n, repeat('x', 1000) as pad from generate_series(1, ${count}) as s(n)`,
    /** The server's id for the connection that asks, as `id`. */
    connectionId: "select pg_backend_pid() as id",
    /** Closes the connection with that id. */
    kill: (id: number) => `select pg_terminate_backend(${id})`,
    syncTimeout: "ERR_POSTGRES_SYNC_TIMEOUT",
  },
  mysql: {
    sleep: (seconds: number) => `select sleep(${seconds})`,
    wide: (count: number) =>
      `with recursive s(n) as (select 1 union all select n + 1 from s where n < ${count}) select n, repeat('x', 1000) as pad from s`,
    connectionId: "select connection_id() as id",
    kill: (id: number) => `kill ${id}`,
    syncTimeout: "ERR_MYSQL_SYNC_TIMEOUT",
  },
};

// Under libuv the calls have nothing to wait on: see the test for Windows at the end.
for (const server of isWindows ? [] : servers) {
  describeWithContainer(server.image, { image: server.image }, container => {
    const dialect = dialects[server.dialect];
    const table = `sync_sql_${server.image}_${process.pid}`;
    const clients: SQL[] = [];
    let sql: SQL;

    /** Another pool on the same server, closed with the rest. */
    const client = (options: Bun.SQL.PostgresOrMySQLOptions = {}, host = container.host, port = container.port) => {
      const made = new SQL({ ...server.options(host, port), ...options });
      clients.push(made);
      return made;
    };

    beforeAll(async () => {
      await container.ready;
      sql = client({ max: 4 });
      await sql.unsafe(`drop table if exists ${table}`);
      await sql.unsafe(`create table ${table} (id int primary key, name varchar(64))`);
    });

    afterAll(async () => {
      if (!sql) return;
      await sql.unsafe(`drop table if exists ${table}`);
      await Promise.all(clients.map(each => each.close({ timeout: 1 })));
    });

    test("the first statement of a pool is its rows, with nothing awaited before it", () => {
      const fresh = client({ max: 2 });
      const rows = fresh.unsafe("select 1 as one").executeSync();
      expect(isPromise(rows)).toBe(false);
      expect(Array.isArray(rows)).toBe(true);
      expect(Number(rows[0].one)).toBe(1);
      expect(rows.count).toBe(1);
    });

    test("a tagged statement, its parameters and its result modes", () => {
      const rows = sql`select ${41} + 1 as answer, lower(${"TEXT"}) as word`.executeSync();
      expect(Number(rows[0].answer)).toBe(42);
      expect(rows[0].word).toBe("text");
      const values = sql.unsafe("select 1 as a, 2 as b").values().executeSync();
      expect(values[0].map(Number)).toEqual([1, 2]);
    });

    test("a failing statement throws where it is called, and the connection goes on", () => {
      expect(() => sql.unsafe("select * from sync_sql_no_such_table").executeSync()).toThrow(SQL.SQLError);
      expect(Number(sql.unsafe("select 2 as two").executeSync()[0].two)).toBe(2);
    });

    test("nothing else of the program runs while a statement is waited for", async () => {
      const order: string[] = [];
      queueMicrotask(() => order.push("microtask"));
      const timer = new Promise<void>(resolve =>
        setTimeout(() => {
          order.push("timer");
          resolve();
        }, 0),
      );
      // A statement of somebody else, on its own connection, that answers long before the one below.
      const other = client({ max: 1 });
      const background = other.unsafe("select 1 as one").execute();
      background.then(() => order.push("other query"));

      sql.unsafe(dialect.sleep(0.2)).executeSync();
      order.push("after the statement");
      expect(order).toEqual(["after the statement"]);

      await timer;
      await background;
      expect(order.slice(0, 2)).toEqual(["after the statement", "microtask"]);
      expect(order).toContain("timer");
      expect(order).toContain("other query");
    });

    test("wait() says whether the statement has settled, and one that has not can be awaited", async () => {
      const slow = sql.unsafe(dialect.sleep(0.4));
      expect(slow.wait(50)).toBe(false);
      await slow;
      expect(slow.wait()).toBe(true);

      const late = sql.unsafe(dialect.sleep(0.4));
      expect(() => late.executeSync(50)).toThrow(expect.objectContaining({ code: dialect.syncTimeout }));
      // It was not cancelled.
      await late;
    });

    test("a statement that failed has settled: wait() is true, and executeSync() throws what it failed with", () => {
      const failing = sql.unsafe("select * from sync_sql_no_such_table");
      expect(failing.wait()).toBe(true);
      expect(() => failing.executeSync()).toThrow(SQL.SQLError);
    });

    test("more statements in a row than the pool has connections, then a connection of its own", () => {
      for (let i = 0; i < 25; i++) expect(Number(sql.unsafe(`select ${i} as n`).executeSync()[0].n)).toBe(i);

      // Needs an idle connection: every statement above gave its own back when it returned.
      const reserved = sql.reserveSync();
      expect(reserved).toBeDefined();
      expect(isPromise(reserved)).toBe(false);
      expect(Number(reserved!.unsafe("select 7 as n").executeSync()[0].n)).toBe(7);
      reserved!.release();
    });

    test("a transaction on a reserved connection, committed and rolled back in place", () => {
      sql.unsafe(`delete from ${table}`).executeSync();

      const committed = sql.reserveSync()!;
      committed.unsafe("BEGIN").executeSync();
      committed.unsafe(`insert into ${table} (id, name) values (1, 'kept')`).executeSync();
      // Not visible to another connection until the commit.
      expect(Number(sql.unsafe(`select count(*) as n from ${table}`).executeSync()[0].n)).toBe(0);
      committed.unsafe("COMMIT").executeSync();
      committed.release();

      const rolledBack = sql.reserveSync()!;
      rolledBack.unsafe("BEGIN").executeSync();
      rolledBack.unsafe(`insert into ${table} (id, name) values (2, 'dropped')`).executeSync();
      rolledBack.unsafe("ROLLBACK").executeSync();
      rolledBack.release();

      const names = sql
        .unsafe(`select name from ${table} order by id`)
        .executeSync()
        .map((row: { name: string }) => row.name);
      expect(names).toEqual(["kept"]);
    });

    test("a result and a parameter larger than a socket buffer", () => {
      const rows = sql.unsafe(dialect.wide(900)).executeSync();
      expect(rows.length).toBe(900);
      expect(rows[899].pad.length).toBe(1000);

      const big = Buffer.alloc(2 * 1024 * 1024, "y").toString();
      const echoed = sql`select lower(${big}) as big`.executeSync();
      expect(echoed[0].big.length).toBe(big.length);
    });

    test("a statement started the usual way is not disturbed by one that is waited for", async () => {
      const pending = sql.unsafe("select 11 as n").execute();
      expect(Number(sql.unsafe("select 12 as n").executeSync()[0].n)).toBe(12);
      expect(Number((await pending)[0].n)).toBe(11);
      // And the awaited API is what it was.
      const inside = await sql.begin(async tx => Number((await tx.unsafe("select 13 as n"))[0].n));
      expect(inside).toBe(13);
    });

    test("a server that is not there fails where the statement is, and does not hang", () => {
      const nowhere = client({ max: 1, connectionTimeout: 5 }, "127.0.0.1", 1);
      // What the dial failed with, not that the wait ran out.
      expect(() => nowhere.unsafe("select 1").executeSync(10_000)).toThrow(
        expect.objectContaining({ code: expect.stringContaining("CONNECTION") }),
      );
    });

    test("a server that accepts and then says nothing fails with the connection timeout", () => {
      // The kernel completes the connection; nothing ever accepts it or answers. The connection timeout is a
      // timer of the event loop, which does not turn while the statement is waited for without a limit.
      using silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const unanswered = client({ max: 1, connectionTimeout: 1 }, "127.0.0.1", silent.port);
      expect(() => unanswered.unsafe("select 1").executeSync()).toThrow(
        expect.objectContaining({ code: expect.stringContaining("CONNECTION_TIMEOUT") }),
      );
    });

    test.skipIf(server.dialect !== "postgres")(
      "a COPY stream is read and fed by this program, so wait() is null and does not block",
      async () => {
        sql.unsafe(`delete from ${table}`).executeSync();

        // The server waits for rows that only the caller can write.
        const into = sql.unsafe(`COPY ${table} (id, name) FROM STDIN`);
        const writer = into.writable().getWriter();
        expect(into.wait()).toBe(null);
        await writer.write("7\tcopied\n");
        await writer.close();
        expect(sql.unsafe(`select name from ${table} where id = 7`).executeSync()[0].name).toBe("copied");

        // The rows wait for a reader that is this program.
        const out = sql.unsafe(`COPY (select name from ${table} where id = 7) TO STDOUT`);
        const stream = out.readable();
        expect(out.wait()).toBe(null);
        expect(await new Response(stream).text()).toBe("copied\n");
        sql.unsafe(`delete from ${table}`).executeSync();
      },
    );

    test("what only the event loop can free is reported, not waited for", async () => {
      const single = client({ max: 1 });
      expect(Number(single.unsafe("select 1 as n").executeSync()[0].n)).toBe(1);
      // The one connection is in the hands of a caller that awaits.
      const holder = await single.reserve();
      expect(single.reserveSync(2000)).toBeUndefined();
      const queued = single.unsafe("select 5 as n");
      // Not false: no amount of waiting on this thread would help.
      expect(queued.wait(2000)).toBe(null);
      holder.release();
      expect(Number((await queued)[0].n)).toBe(5);
      // The reservation that was given up left nothing behind in the queue.
      const again = single.reserveSync();
      expect(again).toBeDefined();
      again!.release();
    });

    test("a connection the server closed while the program did not yield is not the one a statement gets", () => {
      const single = client({ max: 1 });
      const id = Number(single.unsafe(dialect.connectionId).executeSync()[0].id);
      expect(id).toBeGreaterThan(0);
      // Closed from another connection. The pool of `single` only learns of it when it reads its socket,
      // which a waiting call does for idle connections at most once a second.
      sql.unsafe(dialect.kill(id)).executeSync();
      Bun.sleepSync(1200);
      // Without the event loop having turned: the statement leaves the dead connection where it finds it.
      const after = Number(single.unsafe(dialect.connectionId).executeSync()[0].id);
      expect(after).toBeGreaterThan(0);
      expect(after).not.toBe(id);
    });

    test("a statement waited for inside a request handler leaves the rest of the request alone", async () => {
      // The handler runs in the middle of the read that brought the request: the body behind the headers is
      // still in the event loop's receive buffer when the statement's own rows are read.
      const body = new Uint8Array(300 * 1024);
      for (let i = 0; i < body.length; i++) body[i] = 65 + (i % 23);
      await using listening = Bun.serve({
        port: 0,
        async fetch(request) {
          const rows = sql.unsafe(dialect.wide(600)).executeSync();
          const received = await request.arrayBuffer();
          return Response.json({ rows: rows.length, length: received.byteLength, hash: String(Bun.hash(received)) });
        },
      });
      for (let round = 0; round < 3; round++) {
        const response = await fetch(listening.url, { method: "POST", body });
        expect(await response.json()).toEqual({ rows: 600, length: body.byteLength, hash: String(Bun.hash(body)) });
      }
    });

    test("a statement that is given up on is stopped before the caller goes on", () => {
      sql.unsafe(`delete from ${table}`).executeSync();
      sql.unsafe(`insert into ${table} (id, name) values (50, 'before')`).executeSync();
      const holder = sql.reserveSync()!;
      holder.unsafe("BEGIN").executeSync();
      holder.unsafe(`update ${table} set name = 'held' where id = 50`).executeSync();

      // Waits for the row the holder has.
      const blocked = sql.unsafe(`update ${table} set name = 'late' where id = 50`);
      expect(blocked.wait(150)).toBe(false);
      expect(blocked.cancelSync(3000)).toBe(blocked);

      // What it waited for, without the event loop having turned since the cancel.
      holder.unsafe("ROLLBACK").executeSync();
      holder.release();
      // PostgreSQL stops the statement. MySQL has no request for that: there it runs when it can.
      if (server.dialect === "postgres") {
        expect(() => blocked.executeSync(2000)).toThrow();
        expect(sql.unsafe(`select name from ${table} where id = 50`).executeSync()[0].name).toBe("before");
      } else {
        blocked.executeSync(2000);
        expect(sql.unsafe(`select name from ${table} where id = 50`).executeSync()[0].name).toBe("late");
      }
    });

    test("a statement waited for inside an awaited transaction of the same program", async () => {
      const result = await sql.begin(async tx => {
        await tx.unsafe("select 1");
        // Its own connection: waited for in place, inside the open transaction.
        return Number(tx.unsafe("select 21 as n").executeSync()[0].n);
      });
      expect(result).toBe(21);
    });
  });
}

test.skipIf(!isWindows)("under libuv a query has nothing to wait on: wait() is null, and executeSync() throws", async () => {
  // A server that accepts and says nothing, so that the query stays pending whatever the dial does.
  using silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  await using sql = new SQL({ url: `postgres://bun_sql_test@127.0.0.1:${silent.port}/bun_sql_test`, max: 1 });
  const query = sql.unsafe("select 1");
  query.catch(() => {});
  expect(query.wait(1000)).toBe(null);
  const second = sql.unsafe("select 1");
  second.catch(() => {});
  expect(() => second.executeSync(1000)).toThrow(expect.objectContaining({ code: "ERR_POSTGRES_SYNC_TIMEOUT" }));
});
