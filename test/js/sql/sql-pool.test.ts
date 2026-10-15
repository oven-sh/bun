import { SQL } from "bun";
import { describe, expect, jest, setSystemTime, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import { once } from "node:events";
import net from "node:net";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgCommandComplete,
  pgErrorResponse,
  pgReadyForQuery,
} from "./wire-frames";

type Tag = Pick<SQL, "unsafe">;

/** "resolved", or the code it was rejected with. Calls then() itself, so a lazy query starts in this call. */
const outcome = (promise: PromiseLike<unknown>): PromiseLike<string> =>
  promise.then(
    () => "resolved",
    err => err?.code ?? `${err}`,
  );

const unlessPending = (promise: PromiseLike<string>, later: PromiseLike<unknown>) =>
  Promise.race([promise, later.then(() => "pending")]);

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

class Calls {
  count = 0;
  #waiting = new Map<number, PromiseWithResolvers<void>>();
  hit = () => void this.#waiting.get(++this.count)?.resolve();
  reached(n: number) {
    if (this.count >= n) return Promise.resolve();
    let waiting = this.#waiting.get(n);
    if (!waiting) this.#waiting.set(n, (waiting = Promise.withResolvers<void>()));
    return waiting.promise;
  }
}

/** In a process of its own: bun:test fails a test for each unhandled rejection. */
async function unhandledRejections(url: string) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const sql = new Bun.SQL(process.env.SQL_URL, { max: 1 });
      const reported = [];
      process.on("unhandledRejection", err => reported.push(err.message === "handler" ? "handler" : "query"));
      const bad = (on = sql) => on.unsafe("select * from bun_pool_no_such_table");
      const good = (on = sql) => on.unsafe("select 1");
      const rethrow = () => { throw new Error("handler"); };
      const result = {};
      async function row(name, start, on) {
        reported.length = 0;
        start();
        // Answered after the query of the row.
        await good(on);
        await new Promise(setImmediate);
        result[name] = reported.join();
      }
      await row("execute()", () => bad().execute());
      await row("then(f)", () => bad().then(() => {}));
      await row("finally(f)", () => bad().finally(() => {}));
      await row("catch(f)", () => bad().catch(() => {}));
      await row("then(f, g)", () => bad().then(() => {}, () => {}));
      await row("catch(rethrow)", () => bad().catch(rethrow));
      await row("then(null, rethrow)", () => bad().then(null, rethrow));
      await row("then(rethrow, g) of a query that succeeds", () => good().then(rethrow, () => {}));
      if (sql.options.adapter !== "sqlite") {
        const reserved = await sql.reserve();
        await row("execute() on a reservation", () => bad(reserved).execute(), reserved);
        reserved.release();
      }
      await sql.close();
      console.log(JSON.stringify(result));
      `,
    ],
    env: { ...bunEnv, SQL_URL: url },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { result: stdout && JSON.parse(stdout), exitCode };
}

const reportedLikeAnyPromise = {
  "execute()": "query",
  "then(f)": "query",
  "finally(f)": "query",
  "catch(f)": "",
  "then(f, g)": "",
  "catch(rethrow)": "handler",
  "then(null, rethrow)": "handler",
  "then(rethrow, g) of a query that succeeds": "handler",
};

test.concurrent("sqlite: a failure that nobody handles is reported", async () => {
  expect(await unhandledRejections(":memory:")).toEqual({ result: reportedLikeAnyPromise, exitCode: 0 });
});

const mysqlDialect = {
  url: (host: string, port: number) => `mysql://root@${host}:${port}/bun_sql_test`,
  prefix: "ERR_MYSQL_",
  sessionId: "select connection_id() as id",
  endSession: (id: unknown) => `kill ${id}`,
  lock: (key: number) => `select get_lock('bun_pool_${key}', 60)`,
  unlock: (key: number) => `select release_lock('bun_pool_${key}')`,
  waitForLock: (key: number) =>
    `select connection_id() as id, get_lock('bun_pool_${key}', 60), release_lock('bun_pool_${key}')`,
};

const servers = [
  {
    image: "postgres_plain",
    url: (host: string, port: number) => `postgres://bun_sql_test@${host}:${port}/bun_sql_test`,
    prefix: "ERR_POSTGRES_",
    sessionId: "select pg_backend_pid() as id",
    endSession: (id: unknown) => `select pg_terminate_backend(${id})`,
    lock: (key: number) => `select pg_advisory_lock(${key})`,
    unlock: (key: number) => `select pg_advisory_unlock(${key})`,
    waitForLock: (key: number) => `select pg_backend_pid() as id, pg_advisory_xact_lock(${key})`,
  },
  { image: "mysql_plain", ...mysqlDialect },
  { image: "mariadb_plain", ...mysqlDialect },
];

for (const server of servers) {
  describeWithContainer(server.image, { image: server.image, concurrent: true }, container => {
    const code = (name: string) => server.prefix + name;
    async function pool(options: Bun.SQL.Options = {}) {
      await container.ready;
      return new SQL({ url: server.url(container.host, container.port), max: 1, ...options });
    }
    const sessionId = async (sql: Tag) => (await sql.unsafe(server.sessionId))[0].id;
    async function endSession(id: unknown) {
      await using admin = await pool();
      await admin.unsafe(server.endSession(id));
    }

    /** A lock that another session holds: the server answers `wait(sql)` after `open()`. */
    async function gate() {
      const key = (Math.random() * 2 ** 31) | 0;
      const holder = await pool();
      await holder.unsafe(server.lock(key));
      return {
        wait: (sql: Tag, then = "") => sql.unsafe(server.waitForLock(key) + then),
        open: () => holder.unsafe(server.unlock(key)),
        roundTrip: () => holder.unsafe("select 1"),
        [Symbol.asyncDispose]: () => holder.close({ timeout: 0 }),
      };
    }

    /** The sessions of three queries that the server holds at the same time, once `dialed` has resolved. */
    async function threeSessions(sql: Tag, dialed: () => Promise<void>) {
      await using held = await gate();
      const ids = [1, 2, 3].map(() => held.wait(sql).then(rows => rows[0].id));
      await dialed();
      await held.open();
      return new Set(await Promise.all(ids));
    }

    describe("dials", () => {
      test("queries that follow each other share one connection", async () => {
        const connected = new Calls();
        await using sql = await pool({ max: 5, onconnect: connected.hit });
        const sessions = new Set([await sessionId(sql), await sessionId(sql), await sessionId(sql)]);
        expect({ sessions: sessions.size, dials: connected.count }).toEqual({ sessions: 1, dials: 1 });
      });

      test("queries that run together get a connection each, up to max", async () => {
        const connected = new Calls();
        await using sql = await pool({ max: 3, onconnect: connected.hit });
        await using held = await gate();
        const two = [held.wait(sql), held.wait(sql)].map(outcome);
        await connected.reached(2);
        await held.roundTrip();
        expect(connected.count).toBe(2);

        const five = Array.from({ length: 5 }, () => outcome(held.wait(sql)));
        await connected.reached(3);
        await held.open();
        expect(await Promise.all([...two, ...five])).toEqual(Array(7).fill("resolved"));
        expect(connected.count).toBe(3);
      });

      test("reserve() dials instead of waiting for a busy connection", async () => {
        await using sql = await pool({ max: 2 });
        await using held = await gate();
        const busy = outcome(held.wait(sql));
        using reserved = await sql.reserve();
        expect(await outcome(reserved.unsafe("select 1"))).toBe("resolved");
        await held.open();
        expect(await busy).toBe("resolved");
      });

      test("a pool that lost connections grows back", async () => {
        const connected = new Calls();
        const closed = new Calls();
        await using sql = await pool({ max: 3, onconnect: connected.hit, onclose: closed.hit });
        const [kept, ...lost] = await threeSessions(sql, () => connected.reached(3));
        expect(lost.length).toBe(2);
        for (const id of lost) await endSession(id);
        await closed.reached(2);

        const sessions = await threeSessions(sql, () => connected.reached(5));
        expect({ sessions: sessions.size, kept: sessions.has(kept) }).toEqual({ sessions: 3, kept: true });
      });

      test("a pool that idled out dials once for one query", async () => {
        const connected = new Calls();
        const closed = new Calls();
        await using sql = await pool({ max: 3, idleTimeout: 0.05, onconnect: connected.hit, onclose: closed.hit });
        expect((await threeSessions(sql, () => connected.reached(3))).size).toBe(3);
        await closed.reached(3);
        await sessionId(sql);
        expect(connected.count).toBe(4);
      });
    });

    describe("a connection that closes", () => {
      const causes = [
        ["its holder closes it", (reserved: Bun.ReservedSQL, _id: unknown) => reserved.close()],
        ["the server ends the session", (_reserved: Bun.ReservedSQL, id: unknown) => endSession(id)],
      ] as const;

      test.each(causes)("callers that wait get a new connection when %s", async (_, close) => {
        await using sql = await pool();
        const reserved = await sql.reserve();
        const id = await sessionId(reserved);
        const waiting = [
          sessionId(sql),
          sql.begin(tx => sessionId(tx)),
          sql.reserve().then(async next => {
            using _ = next;
            return await sessionId(next);
          }),
        ].map(session =>
          session.then(
            next => next !== id,
            err => err.code,
          ),
        );
        await close(reserved, id);
        expect(await Promise.all(waiting)).toEqual([true, true, true]);
      });

      test("only the connection that closed is replaced", async () => {
        await using sql = await pool({ max: 2 });
        using kept = await sql.reserve();
        const lost = await sql.reserve();
        const [keptId, lostId] = [await sessionId(kept), await sessionId(lost)];
        const waiting = sessionId(sql);
        await endSession(lostId);
        expect([keptId, lostId]).not.toContain(await waiting);
        expect(await sessionId(kept)).toBe(keptId);
      });

      test("a statement on a closed reservation does not run on the connection that replaced it", async () => {
        await using sql = await pool();
        const reserved = await sql.reserve();
        await reserved.close();
        await sessionId(sql);
        expect(await outcome(reserved.unsafe("select 1"))).toBe(code("CONNECTION_CLOSED"));
      });

      test.each<[string, string[], boolean]>([
        ["in a transaction is given to nobody", ["begin"], false],
        ["in a failed transaction is given to nobody", ["begin", "select * from bun_pool_no_such_table"], false],
        ["after its transaction goes to the next caller", ["begin", "rollback"], true],
      ])("a reserved connection that comes back %s", async (_, statements, kept) => {
        const closed = new Calls();
        await using sql = await pool({ onclose: closed.hit });
        const reserved = await sql.reserve();
        const id = await sessionId(reserved);
        for (const statement of statements) await outcome(reserved.unsafe(statement));
        const next = sessionId(sql);
        reserved.release();
        expect({ kept: (await next) === id, closed: closed.count }).toEqual({ kept, closed: kept ? 0 : 1 });
      });

      test.each([
        ["a transaction", "select 1; begin"],
        ["a failed transaction", "select 1; begin; select * from bun_pool_no_such_table; commit"],
      ])("a connection that a query on the pool leaves in %s is given to nobody", async (_, text) => {
        const closed = new Calls();
        await using sql = await pool({ max: 2, onclose: closed.hit });
        const id = await sessionId(sql);
        await outcome(sql.unsafe(text).simple());
        expect({ kept: (await sessionId(sql)) === id, closed: closed.count }).toEqual({ kept: false, closed: 1 });
      });

      test("it stays when the query that already runs behind ends the transaction", async () => {
        const closed = new Calls();
        await using sql = await pool({ max: 2, onclose: closed.hit });
        await using held = await gate();
        // The pool is full, so the two share the other connection.
        using _ = await sql.reserve();
        const id = await sessionId(sql);
        const begins = sql.unsafe("select 1; begin").simple().execute();
        const commits = held.wait(sql, "; commit").simple().execute();
        await begins;
        await held.open();
        await commits;
        expect({ kept: (await sessionId(sql)) === id, closed: closed.count }).toEqual({ kept: true, closed: 0 });
      });

      test("it stays while it has a prepared distributed transaction", async () => {
        const closed = new Calls();
        await using sql = await pool({ max: 2, onclose: closed.hit });
        const name = `bun_pool_${(Math.random() * 2 ** 31) | 0}`;
        await sql.beginDistributed(name, tx => tx.unsafe("select 1"));
        // One of them runs on that connection.
        await Promise.all([sql.unsafe("select 1"), sql.unsafe("select 2")]);
        expect([await outcome(sql.commitDistributed(name)), closed.count]).toEqual(["resolved", 0]);
      });

      test("a transaction by hand on a pool of one connection keeps it", async () => {
        await using sql = await pool({ max: 1 });
        const id = await sessionId(sql);
        await sql.unsafe("begin");
        const inside = await sessionId(sql);
        await sql.unsafe("rollback");
        expect([inside, await sessionId(sql)]).toEqual([id, id]);
      });

      test.each<[string, (sql: SQL) => PromiseLike<unknown>]>([
        ["execute()", sql => sql.unsafe("select 1").execute()],
        ["reserve()", sql => sql.reserve().then(reserved => reserved.release())],
        ["begin()", sql => sql.begin(tx => tx.unsafe("select 1"))],
        ["connect()", sql => sql.connect()],
      ])("%s inside onclose is served by a new connection", async (_, enter) => {
        const entered = Promise.withResolvers<string>();
        const closed = new Calls();
        await using sql: SQL = await pool({
          onclose() {
            closed.hit();
            if (closed.count === 1) entered.resolve(outcome(enter(sql)));
          },
        });
        await endSession(await sessionId(sql));
        expect(await entered.promise).toBe("resolved");
      });

      test("the dial for a caller that waits belongs to the pool's owner, not to the script that closed the connection", async () => {
        await using sql = await pool();
        const reserved = await sql.reserve();
        const waiting = outcome(sql.unsafe("select 1").execute());
        {
          using graph = new Bun.ModuleGraph();
          graph.run(() => void reserved.close());
        }
        expect(await waiting).toBe("resolved");
      });
    });

    describe("onconnect", () => {
      test("comes before onclose when the first caller is also the last thing close() waits for", async () => {
        const events: string[] = [];
        const sql = await pool({
          onconnect: err => void events.push(`onconnect ${err}`),
          onclose: err => void events.push(`onclose ${(err as any)?.code}`),
        });
        const connecting = outcome(sql.connect());
        await sql.close();
        expect([await connecting, ...events]).toEqual([
          "resolved",
          "onconnect null",
          `onclose ${code("CONNECTION_CLOSED")}`,
        ]);
      });

      test("that closes the pool is still followed by onclose", async () => {
        const events: string[] = [];
        const sql: SQL = await pool({
          onconnect(err) {
            events.push(`onconnect ${err}`);
            sql.close({ timeout: 0 });
          },
          onclose: err => void events.push(`onclose ${(err as any)?.code}`),
        });
        expect([await outcome(sql.unsafe("select 1")), ...events]).toEqual([
          code("CONNECTION_CLOSED"),
          "onconnect null",
          `onclose ${code("CONNECTION_CLOSED")}`,
        ]);
      });

      test("can use the pool", async () => {
        const inner = Promise.withResolvers<string>();
        await using sql: SQL = await pool({ onconnect: () => inner.resolve(outcome(sql.unsafe("select 1"))) });
        expect([await outcome(sql.unsafe("select 1")), await inner.promise]).toEqual(["resolved", "resolved"]);
      });
    });

    describe("who is served first", () => {
      test("a query is not overtaken by the transactions that came after it", async () => {
        await using sql = await pool();
        await sql.connect();
        await using held = await gate();
        const order: string[] = [];
        const finished = [
          sql.begin(tx => held.wait(tx)).then(() => order.push("t1")),
          sql.unsafe("select 1").then(() => order.push("query")),
          ...["t2", "t3"].map(name => sql.begin(tx => tx.unsafe("select 1")).then(() => order.push(name))),
        ];
        await held.open();
        await Promise.all(finished);
        expect(order).toEqual(["t1", "query", "t2", "t3"]);
      });

      test("a reservation is not overtaken by the queries that came after it", async () => {
        await using sql = await pool();
        const first = await sql.reserve();
        const order: string[] = [];
        const finished = [
          sql.unsafe("select 1").then(() => order.push("query 1")),
          sql.reserve().then(reserved => {
            order.push("reserve");
            reserved.release();
          }),
          sql.unsafe("select 1").then(() => order.push("query 2")),
        ];
        first.release();
        await Promise.all(finished);
        expect(order).toEqual(["query 1", "reserve", "query 2"]);
      });

      test("queries use the other connections while a reservation waits for one to drain", async () => {
        await using sql = await pool({ max: 2 });
        await using held = await gate();
        const busy = [held.wait(sql), held.wait(sql)].map(outcome);
        const reserving = sql.reserve();
        // Pipelined behind one of the two held queries: it is answered after the gate opens, and so is reserve().
        const query = outcome(sql.unsafe("select 1"));
        await held.open();
        expect(await Promise.all([...busy, query])).toEqual(["resolved", "resolved", "resolved"]);
        (await reserving).release();
      });
    });

    describe("close()", () => {
      async function poolWithHeldQuery() {
        const sql = await pool();
        await sql.connect();
        const held = await gate();
        return { sql, held, query: outcome(held.wait(sql)) };
      }

      test.each<[string, { timeout?: unknown }?]>([
        ["close()", undefined],
        ["close({})", {}],
        ["close({ timeout: undefined })", { timeout: undefined }],
        ["close({ timeout: null })", { timeout: null }],
        ["close({ timeout: 60 })", { timeout: 60 }],
        // 2 ** 31 seconds do not fit setTimeout(), which would make them 1 ms.
        ["close({ timeout: 2 ** 31 })", { timeout: 2 ** 31 }],
      ])("%s waits for the query", async (_, options) => {
        const { sql, held, query } = await poolWithHeldQuery();
        await using _held = held;
        const closing = outcome(sql.close(options as { timeout?: number }));
        expect(await unlessPending(closing, held.roundTrip())).toBe("pending");
        await held.open();
        expect([await query, await closing]).toEqual(["resolved", "resolved"]);
      });

      test.each<[string, { timeout: unknown }]>([
        ["close({ timeout: 0 })", { timeout: 0 }],
        ['close({ timeout: "0" })', { timeout: "0" }],
        ["close({ timeout: false })", { timeout: false }],
      ])("%s closes at once", async (_, options) => {
        const { sql, held, query } = await poolWithHeldQuery();
        await using _held = held;
        const closing = outcome(sql.close(options as { timeout: number }));
        expect(await unlessPending(closing, held.roundTrip())).toBe("resolved");
        expect(await query).toBe(code("CONNECTION_CLOSED"));
      });

      test.each([-1, NaN, "soon", 2 ** 31 + 1])(
        "close({ timeout: %p }) rejects and the pool stays open",
        async timeout => {
          const { sql, held, query } = await poolWithHeldQuery();
          await using _sql = sql;
          await using _held = held;
          expect(await outcome(sql.close({ timeout: timeout as number }))).toBe("ERR_INVALID_ARG_VALUE");
          await held.open();
          expect([await query, await outcome(sql.unsafe("select 1"))]).toEqual(["resolved", "resolved"]);
        },
      );

      test("a later close() waits with the first one", async () => {
        const { sql, held, query } = await poolWithHeldQuery();
        await using _held = held;
        const closing = [sql.close(), sql.close(), sql.end(), sql[Symbol.asyncDispose]()].map(outcome);
        expect(await unlessPending(Promise.race(closing), held.roundTrip())).toBe("pending");
        await held.open();
        expect([await query, ...(await Promise.all(closing))]).toEqual(Array(5).fill("resolved"));
      });

      test.each<[string, { timeout: number } | undefined, { timeout: number }]>([
        ["close(), then close({ timeout: 0 })", undefined, { timeout: 0 }],
        ["close({ timeout: 60 }), then close({ timeout: 0.01 })", { timeout: 60 }, { timeout: 0.01 }],
        ["close({ timeout: 0.01 }), then close({ timeout: 60 })", { timeout: 0.01 }, { timeout: 60 }],
      ])("%s: the shortest timeout counts", async (_, first, later) => {
        const { sql, held, query } = await poolWithHeldQuery();
        await using _held = held;
        const closing = [sql.close(first), sql.close(later)].map(outcome);
        expect(await Promise.all([...closing, query])).toEqual(["resolved", "resolved", code("CONNECTION_CLOSED")]);
      });

      test("a later close() with an invalid timeout rejects and changes nothing", async () => {
        const { sql, held, query } = await poolWithHeldQuery();
        await using _held = held;
        const closing = outcome(sql.close());
        expect(await outcome(sql.close({ timeout: -1 }))).toBe("ERR_INVALID_ARG_VALUE");
        expect(await unlessPending(closing, held.roundTrip())).toBe("pending");
        await held.open();
        expect([await query, await closing]).toEqual(["resolved", "resolved"]);
      });

      test("close() waits for a reservation, a later close({ timeout: 0 }) ends it", async () => {
        const sql = await pool();
        const reserved = await sql.reserve();
        const closing = outcome(sql.close());
        expect(await unlessPending(closing, reserved.unsafe("select 1"))).toBe("pending");
        await sql.close({ timeout: 0 });
        expect([await closing, await outcome(reserved.unsafe("select 1"))]).toEqual([
          "resolved",
          code("CONNECTION_CLOSED"),
        ]);
      });
    });

    describe("a query starts in the call of", () => {
      test.each<[string, (query: SQL.Query<any>) => PromiseLike<unknown>]>([
        ["then()", query => query.then(rows => rows)],
        ["catch()", query => query.catch(err => err)],
        ["finally()", query => query.finally(() => {})],
        ["execute()", query => query.execute()],
        ["run()", query => (query as any).run()],
      ])("%s: a close() that follows in the same tick waits for it", async (_, start) => {
        const sql = await pool();
        await sql.connect();
        const rows = start(sql.unsafe("select 1 as x"));
        await sql.close();
        expect(await rows).toEqual([{ x: 1 }]);
      });

      test("then() and execute() alike: statements are sent in the order they were started", async () => {
        await using sql = await pool();
        await sql.connect();
        const order: string[] = [];
        const first = sql.unsafe("select 1").then(() => order.push("then()"));
        const second = sql
          .unsafe("select 1")
          .execute()
          .then(() => order.push("execute()"));
        await Promise.all([first, second]);
        expect(order).toEqual(["then()", "execute()"]);
      });
    });

    test("a failure that nobody handles is reported", async () => {
      await container.ready;
      expect(await unhandledRejections(server.url(container.host, container.port))).toEqual({
        result: { ...reportedLikeAnyPromise, "execute() on a reservation": "query" },
        exitCode: 0,
      });
    });

    test("simple() counts after values() and raw()", async () => {
      await using sql = await pool();
      expect(await sql`select 1 as a; select 2 as b`.values().simple()).toEqual([[[1]], [[2]]]);
    });

    test.each(["raw", "values"] as const)("%s() changes nothing once the query has started", async mode => {
      await using sql = await pool();
      // The second time the statement is prepared, and PostgreSQL is asked for binary results.
      for (let i = 0; i < 2; i++) {
        const query = sql`select ${7} + 0 as x, ${"a"} as y`.execute();
        query[mode]();
        expect(await query).toEqual([{ x: 7, y: "a" }]);
      }
    });

    test("the client calls no then(), catch() or finally() of a query that it runs", async () => {
      await using sql = await pool();
      function counted<Q extends object>(query: Q) {
        const calls = { then: 0, catch: 0, finally: 0 };
        for (const name of ["then", "catch", "finally"] as const) {
          const original = (query as any)[name];
          (query as any)[name] = function (this: unknown, ...args: unknown[]) {
            calls[name]++;
            return original.apply(this, args);
          };
        }
        return { query, calls };
      }
      const onPool = counted(sql.unsafe("select 1"));
      await onPool.query;
      using reserved = await sql.reserve();
      const onReservation = counted(reserved.unsafe("select 1"));
      await onReservation.query;
      // The one call is the `await` of this test.
      expect([onPool.calls, onReservation.calls]).toEqual(Array(2).fill({ then: 1, catch: 0, finally: 0 }));
    });

    describe("cancel()", () => {
      test("takes a query that waits for a connection out of the queue", async () => {
        await using sql = await pool();
        const reserved = await sql.reserve();
        const query = sql.unsafe("select 1").execute();
        const result = outcome(query);
        query.cancel();
        expect(await unlessPending(result, reserved.unsafe("select 1"))).toBe(code("QUERY_CANCELLED"));

        // Nothing is left in the queue for close() to wait for.
        reserved.release();
        expect(await outcome(sql.unsafe("select 1"))).toBe("resolved");
      });

      test("the last query that waits lets a pending close() finish", async () => {
        const connecting = Promise.withResolvers<string>();
        const sql = await pool({ password: () => connecting.promise });
        const query = sql.unsafe("select 1");
        const result = outcome(query);
        const closing = outcome(sql.close());
        expect(await unlessPending(closing, nextTurn())).toBe("pending");
        query.cancel();
        expect([await result, await closing]).toEqual([code("QUERY_CANCELLED"), "resolved"]);
      });
    });

    test("active is true while a connection has the query", async () => {
      await using sql = await pool();
      await sql.connect();
      await using held = await gate();
      const query = held.wait(sql);
      const before = query.active;
      const result = outcome(query);
      const during = query.active;
      await held.open();
      await result;
      expect({ before, during, after: query.active }).toEqual({ before: false, during: true, after: false });
    });
  });
}

describeWithContainer("postgres_plain", { image: "postgres_plain" }, container => {
  test("a caller that waits gets its new connection while timers are fake", async () => {
    await container.ready;
    await using sql = new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max: 1 });
    const reserved = await sql.reserve();
    const waiting = outcome(sql.unsafe("select 1").execute());
    jest.useFakeTimers();
    try {
      await reserved.close();
      expect(await waiting).toBe("resolved");
    } finally {
      jest.useRealTimers();
    }
  });
});

// What follows needs a server that refuses, vanishes or closes at a chosen moment, which a healthy container does not.
const scripted = [
  {
    adapter: "postgres",
    url: (port: number) => `postgres://u@127.0.0.1:${port}/db`,
    prefix: "ERR_POSTGRES_",
    ready(socket: net.Socket) {
      socket.once("data", () => socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()])));
    },
    refuseLogin(socket: net.Socket) {
      socket.once("data", () =>
        socket.end(pgErrorResponse({ S: "FATAL", C: "28P01", M: "password authentication failed" })),
      );
    },
    answer: (socket: net.Socket) => socket.write(Buffer.concat([pgCommandComplete("SELECT 0"), pgReadyForQuery()])),
  },
  {
    adapter: "mysql",
    url: (port: number) => `mysql://u@127.0.0.1:${port}/db`,
    prefix: "ERR_MYSQL_",
    ready(socket: net.Socket) {
      let buffered: Buffer = Buffer.alloc(0);
      let authenticated = false;
      socket.write(mysqlHandshakeV10());
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (authenticated) return void mysqlAckSessionSetup(socket, payload);
          authenticated = true;
          socket.write(mysqlOkPacket(seq + 1));
        });
      });
    },
    refuseLogin(socket: net.Socket) {
      socket.write(mysqlHandshakeV10());
      socket.once("data", () => socket.end(mysqlErrPacket(2, 1045, "28000", "Access denied for user")));
    },
    answer: (socket: net.Socket) => socket.write(mysqlOkPacket(1)),
  },
];

describe.each(scripted)("$adapter, scripted server", ({ url, prefix, ready, refuseLogin, answer }) => {
  async function serverOf(onSocket: (socket: net.Socket, nth: number) => void) {
    const sockets: net.Socket[] = [];
    const { port, server } = await listeningServer(socket => {
      socket.on("error", () => {});
      onSocket(socket, sockets.push(socket));
    });
    return {
      port,
      sockets,
      async [Symbol.asyncDispose]() {
        for (const socket of sockets) socket.destroy();
        server.close();
        await once(server, "close");
      },
    };
  }

  /** These servers answer no query: a connection that has one stays busy, and close() would wait for it. */
  const unanswered = (sql: SQL) => ({ [Symbol.asyncDispose]: () => sql.close({ timeout: 0 }) });

  test.concurrent("a query whose login is refused costs one dial", async () => {
    await using server = await serverOf(refuseLogin);
    await using sql = new SQL({ url: url(server.port), max: 5 });
    const dials: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = server.sockets.length;
      expect(await outcome(sql.unsafe("select 1"))).toBe(prefix + "SERVER_ERROR");
      dials.push(server.sockets.length - before);
    }
    expect(dials).toEqual([1, 1, 1]);
  });

  test.concurrent("a login that is refused once does not stay refused", async () => {
    await using server = await serverOf((socket, nth) => (nth === 1 ? refuseLogin(socket) : ready(socket)));
    await using sql = new SQL({ url: url(server.port), max: 1 });
    expect([await outcome(sql.connect()), await outcome(sql.connect())]).toEqual([prefix + "SERVER_ERROR", "resolved"]);
  });

  test.concurrent("callers that wait get the error of the dial that was made for them", async () => {
    const server = await serverOf(ready);
    await using sql = new SQL({ url: url(server.port), max: 1 });
    const reserved = await sql.reserve();
    const waiting = [sql.unsafe("select 1"), sql.reserve()].map(outcome);
    // The connection drops and nothing listens any more.
    await server[Symbol.asyncDispose]();
    expect(await Promise.all(waiting)).toEqual(Array(2).fill(prefix + "CONNECTION_REFUSED"));
    expect(await outcome(reserved.unsafe("select 1"))).toBe(prefix + "CONNECTION_CLOSED");
  });

  test.concurrent("callers that no connection can take get the error of the dial that was made for them", async () => {
    await using server = await serverOf((socket, nth) => (nth === 1 ? ready(socket) : refuseLogin(socket)));
    const closed = new Calls();
    const sql = new SQL({ url: url(server.port), max: 2, onclose: closed.hit });
    await using _ = unanswered(sql);
    using holder = await sql.reserve();
    const [first, second] = [sql.unsafe("select 1").execute(), sql.reserve()].map(outcome);
    expect(await unlessPending(first, closed.reached(1).then(nextTurn))).toBe(prefix + "SERVER_ERROR");
    expect(await second).toBe(prefix + "SERVER_ERROR");
    expect(server.sockets.length).toBe(3);
  });

  test.concurrent("queries on a cold pool wait for the dial on its way when the others are refused", async () => {
    const closed = new Calls();
    // Room for one, which is let in once the client knows of the refusals.
    await using server = await serverOf((socket, nth) =>
      nth === 1 ? void closed.reached(2).then(() => ready(socket)) : refuseLogin(socket),
    );
    const sql = new SQL({ url: url(server.port), max: 3, onclose: closed.hit });
    await using _ = unanswered(sql);
    const queries = [1, 2, 3].map(() => sql.unsafe("select 1").execute());
    const refused = closed.reached(2).then(nextTurn);
    expect(await Promise.all(queries.map(query => unlessPending(outcome(query), refused)))).toEqual(
      Array(3).fill("pending"),
    );
    // With a connection up the pool tries to grow once more, and then makes do.
    await closed.reached(4);
    expect(queries.map(query => query.active)).toEqual([true, true, true]);
    expect(server.sockets.length).toBe(5);
  });

  test.concurrent("queries make do with a connection that is up", async () => {
    await using server = await serverOf((socket, nth) => (nth === 1 ? ready(socket) : refuseLogin(socket)));
    const closed = new Calls();
    const sql = new SQL({ url: url(server.port), max: 2, onclose: closed.hit });
    await using _ = unanswered(sql);
    await sql.connect();
    const queries = [1, 2].map(() => sql.unsafe("select 1").execute());
    queries.forEach(outcome);
    await closed.reached(1);
    expect(queries.map(query => query.active)).toEqual([true, true]);
  });

  test.concurrent("they leave its share to a dial that is on its way", async () => {
    const closed = new Calls();
    const connected = new Calls();
    const letIn = Promise.withResolvers<void>();
    await using server = await serverOf((socket, nth) => {
      if (nth === 2) return refuseLogin(socket);
      if (nth === 3) return void letIn.promise.then(() => ready(socket));
      ready(socket);
    });
    const sql = new SQL({ url: url(server.port), max: 3, onconnect: connected.hit, onclose: closed.hit });
    await using _ = unanswered(sql);
    await sql.connect();
    const queries = [1, 2, 3].map(() => sql.unsafe("select 1").execute());
    queries.forEach(outcome);
    await closed.reached(1);
    expect(queries.map(query => query.active)).toEqual([true, true, false]);
    letIn.resolve();
    await connected.reached(2);
    expect(queries.map(query => query.active)).toEqual([true, true, true]);
  });

  test.concurrent("a reservation whose dial is refused gets the connection that is up: it drains for it", async () => {
    await using server = await serverOf((socket, nth) => (nth === 1 ? ready(socket) : refuseLogin(socket)));
    const closed = new Calls();
    const sql = new SQL({ url: url(server.port), max: 2, onclose: closed.hit });
    await using _ = unanswered(sql);
    await sql.connect();
    const busy = outcome(sql.unsafe("select 1").simple().execute());
    const reservation = outcome(sql.reserve());
    expect(await unlessPending(reservation, closed.reached(1).then(nextTurn))).toBe("pending");
    // Nobody got an answer, so nothing is dialed for the next one. Accepted after whatever the pool would have dialed:
    const probe = net.connect(server.port, "127.0.0.1");
    await once(probe, "connect");
    probe.destroy();
    while (server.sockets.length < 3) await nextTurn();
    expect(server.sockets.length).toBe(3);
    const later = sql.unsafe("select 2").execute();
    outcome(later);
    expect(later.active).toBe(false);
    answer(server.sockets[0]);
    expect([await busy, await reservation]).toEqual(["resolved", "resolved"]);
  });

  test.concurrent("a caller is left to a dial that is on its way when another one is refused", async () => {
    const closed = new Calls();
    await using server = await serverOf((socket, nth) => {
      if (nth === 2) return refuseLogin(socket);
      // Let in once the client knows of the refusal.
      if (nth === 3) return void closed.reached(1).then(() => ready(socket));
      ready(socket);
    });
    const sql = new SQL({ url: url(server.port), max: 3, onclose: closed.hit });
    await using _ = unanswered(sql);
    await sql.connect();
    const left = [sql.unsafe("select 1").execute(), sql.unsafe("select 2").execute()].map(outcome);
    expect(await outcome(sql.reserve())).toBe("resolved");
    expect(server.sockets.length).toBe(3);
    await sql.close({ timeout: 0 });
    await Promise.all(left);
  });

  test.concurrent("a server that refuses everybody is dialed `max` times for callers that wait together", async () => {
    await using server = await serverOf(refuseLogin);
    await using sql = new SQL({ url: url(server.port), max: 2 });
    const waiting = Array.from({ length: 5 }, () => outcome(sql.unsafe("select 1")));
    expect(await Promise.all(waiting)).toEqual(Array(5).fill(prefix + "SERVER_ERROR"));
    expect(server.sockets.length).toBe(2);
  });

  test.concurrent.each([[new Error("no password"), "Error: no password"], [undefined], [""]])(
    "a password function that throws %p rejects the query",
    async (thrown, expected = prefix + "CONNECTION_CLOSED") => {
      await using sql = new SQL({
        url: url(1), // never dialed
        max: 2,
        password() {
          throw thrown;
        },
      });
      expect(await unlessPending(outcome(sql.unsafe("select 1")), nextTurn())).toBe(expected);
    },
  );

  test.concurrent("nothing is dialed after close({ timeout: 0 })", async () => {
    await using server = await serverOf(ready);
    const password = Promise.withResolvers<string>();
    const sql = new SQL({ url: url(server.port), max: 1, password: () => password.promise });
    const connecting = outcome(sql.connect());
    expect(await unlessPending(outcome(sql.close({ timeout: 0 })), nextTurn())).toBe("resolved");
    expect(await connecting).toBe(prefix + "CONNECTION_CLOSED");

    password.resolve("");
    // Accepted after whatever the pool would have dialed.
    const probe = net.connect(server.port, "127.0.0.1");
    await once(probe, "connect");
    probe.destroy();
    while (server.sockets.length === 0) await nextTurn();
    expect(server.sockets.length).toBe(1);
  });

  // Not concurrent: setSystemTime() is for the whole process.
  describe("the budget for dialing a server that accepts and closes", () => {
    test("runs out while setSystemTime() pins Date.now()", async () => {
      await using server = await serverOf(socket => socket.destroy());
      await using sql = new SQL({ url: url(server.port), max: 1, connectionTimeout: 0.1 });
      setSystemTime(new Date("2020-01-01T00:00:00Z"));
      try {
        expect(await outcome(sql.connect())).toBe(prefix + "CONNECTION_FAILED");
      } finally {
        setSystemTime();
      }
    });

    test("does not run out when the system clock jumps ahead", async () => {
      await using server = await serverOf((socket, nth) => {
        if (nth > 1) return ready(socket);
        setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
        socket.destroy();
      });
      await using sql = new SQL({ url: url(server.port), max: 1 });
      try {
        expect(await outcome(sql.connect())).toBe("resolved");
      } finally {
        setSystemTime();
      }
      expect(server.sockets.length).toBe(2);
    });
  });
});
