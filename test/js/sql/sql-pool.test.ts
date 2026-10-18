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
  pgScramServer,
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
        // Answered after the query of the row. PostgreSQL refuses it in a transaction that failed.
        await good(on).catch(() => {});
        await new Promise(setImmediate);
        result[name] = reported.join();
      }
      await row("execute()", () => bad().execute());
      await row("then(f)", () => bad().then(() => {}));
      await row("finally(f)", () => bad().finally(() => {}));
      await row("finally(rethrow)", () => bad().finally(rethrow));
      await row("finally(rethrow).catch(g)", () => bad().finally(rethrow).catch(() => {}));
      await row("finally(f that returns a rejected promise)", () => bad().finally(() => Promise.reject(new Error("handler"))));
      await row("finally(rethrow) of a query that succeeds", () => good().finally(rethrow));
      await row("finally(f).then(h)", () => bad().finally(() => {}).then(() => {}));
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
      await sql.begin(tx => row("execute() in a transaction", () => bad(tx).execute(), tx)).catch(() => {});
      await row("cancel(), then execute()", () => good().cancel().execute());
      let ended;
      await sql.begin(async tx => { ended = tx; });
      await row("execute() on a transaction that ended", () => good(ended).execute());
      if (sql.options.adapter !== "sqlite") {
        const released = await sql.reserve();
        released.release();
        await row("execute() on a reservation that was released", () => good(released).execute());
        const cold = new Bun.SQL(process.env.SQL_URL, { max: 1 });
        await row("execute(), then close({ timeout: 0 })", () => { good(cold).execute(); cold.close({ timeout: 0 }); });
        const holder = await sql.reserve();
        await row("execute(), then cancel() while it waits for a connection", () => { good().execute().cancel(); holder.release(); });
        async function stillQueued(name, close) {
          const full = new Bun.SQL(process.env.SQL_URL, { max: 1 });
          await full.reserve();
          reported.length = 0;
          good(full).execute();
          await close(full);
          await new Promise(setImmediate);
          result[name] = reported.join();
        }
        // The timer of close() does not keep the process alive.
        const alive = setInterval(() => {}, 2 ** 30);
        await stillQueued("execute(), still queued when the time of close({ timeout }) runs out", full => full.close({ timeout: 0.001 }));
        await stillQueued("execute(), still queued when close({ timeout: 0 }) overtakes close({ timeout })", full => {
          full.close({ timeout: 60 });
          return full.close({ timeout: 0 });
        });
        clearInterval(alive);
      }
      const closed = new Bun.SQL(process.env.SQL_URL, { max: 1 });
      await closed.close();
      await row("execute() on a pool that is closed", () => good(closed).execute());
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

/** Without a listener. Not in a top-level await: while one is pending, Bun reports the rejection and goes on. */
async function outlivesAQueryThatIsOnlyStarted(url: string, closeTimeout?: number) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const sql = new Bun.SQL(process.env.SQL_URL, { max: 1 });
      (async () => {
        // The timer of close() does not keep the process alive.
        const alive = setInterval(() => {}, 2 ** 30);
        if (${closeTimeout} !== undefined) {
          // Behind a reservation the query is still queued when the time runs out.
          if (${closeTimeout} > 0) await sql.reserve();
          sql.unsafe("select 1").execute();
          await sql.close({ timeout: ${closeTimeout} });
        } else {
          await sql.unsafe("select 1");
          sql.unsafe("select * from bun_pool_no_such_table").execute();
          await sql.unsafe("select 1");
        }
        await new Promise(setImmediate);
        console.log("alive");
        clearInterval(alive);
        await sql.close();
      })();
      `,
    ],
    env: { ...bunEnv, SQL_URL: url },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

/** Nothing of the caller's threw, and the query had a connection. */
const onlyStarted = {
  "execute()": "",
  "execute() on a reservation": "",
  "execute() in a transaction": "",
  "finally(f)": "",
};
/** Only started, and rejected before it had a connection. */
const refusedInSilence = {
  "cancel(), then execute()": "",
  "execute() on a transaction that ended": "",
};
const refusedInSilenceByAServer = {
  ...refusedInSilence,
  "execute() on a reservation that was released": "",
  "execute(), then close({ timeout: 0 })": "",
  "execute(), still queued when close({ timeout: 0 }) overtakes close({ timeout })": "",
};
const refusedAloud = { "execute() on a pool that is closed": "query" };
const handled = {
  "catch(f)": "",
  "then(f, g)": "",
  "finally(rethrow).catch(g)": "",
};
/** What then() and catch() return, and what a handler of the caller throws. */
const reportedLikeAnyPromise = {
  "then(f)": "query",
  "finally(f).then(h)": "query",
  "finally(rethrow)": "handler",
  "finally(f that returns a rejected promise)": "handler",
  "finally(rethrow) of a query that succeeds": "handler",
  "catch(rethrow)": "handler",
  "then(null, rethrow)": "handler",
  "then(rethrow, g) of a query that succeeds": "handler",
};

describe.concurrent("sqlite: a failure that nobody handles", () => {
  let rows: ReturnType<typeof unhandledRejections> | undefined;
  const reported = () => (rows ??= unhandledRejections(":memory:"));

  test("of a query that is only started is reported outside a transaction", async () => {
    expect(await reported()).toMatchObject({
      result: { ...handled, "execute()": "query", "execute() in a transaction": "", "finally(f)": "" },
      exitCode: 0,
    });
  });

  test("of a query that is only started and refused before it runs", async () => {
    expect(await reported()).toMatchObject({ result: { ...refusedInSilence, ...refusedAloud }, exitCode: 0 });
  });

  test("of what then() and catch() return, and what a handler throws, is reported as of any promise", async () => {
    expect(await reported()).toMatchObject({ result: reportedLikeAnyPromise, exitCode: 0 });
  });
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
      test.each([
        ["query", (sql: SQL) => sql.unsafe("select 1")],
        ["reserve()", (sql: SQL) => sql.reserve().then(reserved => reserved.release())],
        ["begin()", (sql: SQL) => sql.begin(tx => tx.unsafe("select 1"))],
        ["connect()", (sql: SQL) => sql.connect()],
      ])("the first %s starts the pool until max is reached", async (_, call) => {
        const connected = new Calls();
        await using sql = await pool({ max: 5, onconnect: connected.hit });
        await call(sql);
        await connected.reached(5);
        const sessions = new Set([await sessionId(sql), await sessionId(sql), await sessionId(sql)]);
        expect({ sessions: sessions.size, dials: connected.count }).toEqual({ sessions: 1, dials: 5 });
      });

      test("queries that run together get a connection each, up to max", async () => {
        const connected = new Calls();
        await using sql = await pool({ max: 3, onconnect: connected.hit });
        expect((await threeSessions(sql, () => connected.reached(3))).size).toBe(3);

        await using held = await gate();
        const seven = Array.from({ length: 7 }, () => outcome(held.wait(sql)));
        await held.open();
        expect(await Promise.all(seven)).toEqual(Array(7).fill("resolved"));
        expect(connected.count).toBe(3);
      });

      test("reserve() does not wait for a busy connection", async () => {
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

      test("a pool that idled out is started again until max is reached", async () => {
        const connected = new Calls();
        const closed = new Calls();
        await using sql = await pool({ max: 3, idleTimeout: 0.05, onconnect: connected.hit, onclose: closed.hit });
        expect((await threeSessions(sql, () => connected.reached(3))).size).toBe(3);
        await closed.reached(3);
        await sessionId(sql);
        await connected.reached(6);
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
        let prepared: unknown;
        await sql.beginDistributed(name, async tx => {
          prepared = await sessionId(tx);
        });
        // MariaDB commits it on that connection only, so the other one is kept away from what follows.
        const [first, second] = await Promise.all([sql.reserve(), sql.reserve()]);
        using other = (await sessionId(first)) === prepared ? second : first;
        (other === first ? second : first).release();
        await sql.unsafe("select 1");
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

    describe("a failure that nobody handles", () => {
      let rows: ReturnType<typeof unhandledRejections> | undefined;
      async function reported() {
        await container.ready;
        return (rows ??= unhandledRejections(server.url(container.host, container.port)));
      }

      test("of a query that is only started, by execute() or finally(f), is not reported", async () => {
        expect(await reported()).toMatchObject({ result: { ...onlyStarted, ...handled }, exitCode: 0 });
      });

      test("of a query that is only started does not end the process", async () => {
        await container.ready;
        expect(await outlivesAQueryThatIsOnlyStarted(server.url(container.host, container.port))).toEqual({
          stdout: "alive\n",
          exitCode: 0,
        });
      });

      test("of a query that is only started and refused before it has a connection is not reported", async () => {
        expect(await reported()).toMatchObject({ result: refusedInSilenceByAServer, exitCode: 0 });
      });

      test("of a query that is only started, with close({ timeout: 0 }) behind it, does not end the process", async () => {
        await container.ready;
        expect(await outlivesAQueryThatIsOnlyStarted(server.url(container.host, container.port), 0)).toEqual({
          stdout: "alive\n",
          exitCode: 0,
        });
      });

      test("of a query that is only started and still queued when the time of close({ timeout }) runs out ends the process", async () => {
        await container.ready;
        const { exitCode } = await outlivesAQueryThatIsOnlyStarted(server.url(container.host, container.port), 0.001);
        expect(exitCode).toBe(1);
      });

      test("of a query that is only started is reported for a closed pool and a cancel() while it waits", async () => {
        expect(await reported()).toMatchObject({
          result: { ...refusedAloud, "execute(), then cancel() while it waits for a connection": "query" },
          exitCode: 0,
        });
      });

      test("of a query that is only started is reported when the time of close({ timeout }) runs out", async () => {
        expect(await reported()).toMatchObject({
          result: { "execute(), still queued when the time of close({ timeout }) runs out": "query" },
          exitCode: 0,
        });
      });

      test("of what then() and catch() return, and what a handler throws, is reported as of any promise", async () => {
        expect(await reported()).toMatchObject({ result: reportedLikeAnyPromise, exitCode: 0 });
      });
    });

    test("simple() counts after values() and raw()", async () => {
      await using sql = await pool();
      expect(await sql`select 1 as a; select 2 as b`.values().simple()).toEqual([[[1]], [[2]]]);
    });

    describe("once the query has started", () => {
      const query = (sql: SQL) => sql`select ${7} + 0 as x, ${"a"} as y`;

      test("values() counts", async () => {
        await using sql = await pool();
        // The second time the statement is prepared.
        for (let i = 0; i < 2; i++) {
          const started = query(sql).execute();
          started.values();
          expect([await started, await query(sql).execute().values()]).toEqual([[[7, "a"]], [[7, "a"]]]);
        }
      });

      test("raw() counts", async () => {
        await using sql = await pool();
        // The second time the statement is prepared, and execute() has asked PostgreSQL for the formats.
        for (let i = 0; i < 2; i++) {
          const raw = await query(sql).raw();
          expect({
            chosen: await query(sql).execute().raw(),
            left: await query(sql).raw().execute().values(),
            // simple() comes too late to make it a simple query
            leftAfterSimple: await query(sql).raw().execute().simple().values(),
          }).toEqual({ chosen: raw, left: [[7, "a"]], leftAfterSimple: [[7, "a"]] });
        }
      });

      test("raw() counts for a simple query: it has one format", async () => {
        await using sql = await pool();
        const raw = await sql`select 7 as x, 'a' as y`.simple().raw();
        expect({
          chosen: await sql`select 7 as x, 'a' as y`.simple().execute().raw(),
          unsafe: await sql.unsafe("select 7 as x, 'a' as y").execute().raw(),
          left: await sql`select 7 as x, 'a' as y`.simple().raw().execute().values(),
        }).toEqual({ chosen: raw, unsafe: raw, left: [[7, "a"]] });
      });
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

// A real server does not say how many logins it refused. Not concurrent: a login is 4096 rounds of PBKDF2 on this thread.
describe("a password that SASLprep changes: one login finds out which form the server has", () => {
  const typed = "\u00aa\u2168";
  const prepared = "aIX";
  type Mock = Awaited<ReturnType<typeof pgScramServer>>;

  const client = (port: number, options: Bun.SQL.Options) =>
    new SQL({
      adapter: "postgres",
      hostname: "127.0.0.1",
      port,
      username: "u",
      database: "db",
      tls: false,
      ...options,
    });
  const logins = (mock: Mock) => ({
    logins: mock.exchanges.length,
    failed: mock.exchanges.filter(exchange => !exchange.proofOk).length,
  });
  const query = (sql: SQL) => sql.unsafe("select 1").simple();
  const refused = "ERR_POSTGRES_SERVER_ERROR";

  test.each([
    ["that SASLprep changes, and the server has what it makes of it", prepared, typed, "resolved", 11, 1],
    ["that SASLprep changes, and the server has it as it is", typed, typed, "resolved", 10, 0],
    ["that SASLprep leaves as it is", prepared, prepared, "resolved", 10, 0],
    ["that is wrong and that SASLprep changes", "other", typed, refused, 2, 2],
    ["that is wrong and that SASLprep leaves as it is", "other", prepared, refused, 10, 10],
  ])("a password %s", async (_, stored, password, result, all, failed) => {
    await using mock = await pgScramServer({ password: stored });
    const connected = new Calls();
    await using sql = client(mock.port, { password, max: 10, onconnect: connected.hit });
    expect(await outcome(query(sql))).toBe(result);
    if (result === "resolved") await connected.reached(10);
    expect(logins(mock)).toEqual({ logins: all, failed });
  });

  describe.each([1, 10])("%d in one tick", callers => {
    test.each([
      ["query", query],
      ["reserve()", (sql: SQL) => sql.reserve().then(reserved => reserved.release())],
      ["begin()", (sql: SQL) => sql.begin(tx => tx.unsafe("select 1").simple())],
      ["connect()", (sql: SQL) => sql.connect()],
    ])("%s", async (_, call) => {
      await using mock = await pgScramServer({ password: prepared });
      const connected = new Calls();
      await using sql = client(mock.port, { password: typed, max: 3, onconnect: connected.hit });
      const served = await Promise.all(Array.from({ length: callers }, () => outcome(call(sql))));
      expect(served).toEqual(Array(callers).fill("resolved"));
      await connected.reached(3);
      expect(logins(mock)).toEqual({ logins: 4, failed: 1 });
    });
  });

  test("--sql-preconnect", async () => {
    await using mock = await pgScramServer({ password: prepared });
    await using _ = Bun.spawn({
      cmd: [bunExe(), "--sql-preconnect", "-e", "for await (const _ of Bun.stdin.stream());"],
      env: { ...bunEnv, DATABASE_URL: `postgres://u:${encodeURIComponent(typed)}@127.0.0.1:${mock.port}/db?max=3` },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "inherit",
    });
    while (mock.exchanges.filter(exchange => exchange.proofOk).length < 3) await nextTurn();
    expect(logins(mock)).toEqual({ logins: 4, failed: 1 });
  });

  test("max: 1", async () => {
    await using mock = await pgScramServer({ password: prepared });
    await using sql = client(mock.port, { password: typed, max: 1 });
    expect([await outcome(query(sql)), await outcome(query(sql))]).toEqual(["resolved", "resolved"]);
    expect(logins(mock)).toEqual({ logins: 2, failed: 1 });
  });

  test("a pool that idled out is started again with the form that logged in", async () => {
    await using mock = await pgScramServer({ password: prepared });
    const connected = new Calls();
    const closed = new Calls();
    const options = { password: typed, max: 3, idleTimeout: 0.05, onconnect: connected.hit, onclose: closed.hit };
    await using sql = client(mock.port, options);
    await query(sql);
    await closed.reached(3);
    await query(sql);
    await connected.reached(6);
    expect(logins(mock)).toEqual({ logins: 7, failed: 1 });
  });

  test("and all at once", async () => {
    let dials = 0;
    const tooMany = pgErrorResponse({ S: "FATAL", C: "53300", M: "sorry, too many clients already" });
    // Four for the first three connections. Then nobody gets in.
    await using mock = await pgScramServer({
      password: prepared,
      instead: nth => ((dials = nth) > 4 ? tooMany : undefined),
    });
    const closed = new Calls();
    await using sql = client(mock.port, { password: typed, max: 3, idleTimeout: 0.05, onclose: closed.hit });
    await query(sql);
    await closed.reached(3);
    expect([await outcome(query(sql)), dials]).toEqual([refused, 7]);
  });

  test("both forms are wrong: everybody who waits hears it, and the next query asks the server again", async () => {
    await using mock = await pgScramServer({ password: "other" });
    await using sql = client(mock.port, { password: typed, max: 3 });
    const errno = (promise: PromiseLike<unknown>) => promise.then(String, err => err.errno);
    expect(await Promise.all([query(sql), sql.reserve(), sql.connect()].map(errno))).toEqual(Array(3).fill("28P01"));
    expect(logins(mock)).toEqual({ logins: 2, failed: 2 });
    expect(await errno(query(sql))).toBe("28P01");
    expect(logins(mock)).toEqual({ logins: 4, failed: 4 });
  });

  describe("the next caller is dialed for", () => {
    test("when the first one is canceled while its login is out", async () => {
      await using mock = await pgScramServer({ password: prepared });
      const connected = new Calls();
      await using sql = client(mock.port, { password: typed, max: 3, onconnect: connected.hit });
      const first = query(sql).execute();
      first.cancel();
      expect([await outcome(first), await outcome(query(sql))]).toEqual(["ERR_POSTGRES_QUERY_CANCELLED", "resolved"]);
      await connected.reached(3);
      expect(logins(mock)).toEqual({ logins: 4, failed: 1 });
    });

    test("when that login then fails, with nobody waiting", async () => {
      await using mock = await pgScramServer({ password: "other" });
      const closed = new Calls();
      await using sql = client(mock.port, { password: typed, max: 3, onclose: closed.hit });
      const first = query(sql).execute();
      first.cancel();
      expect(await outcome(first)).toBe("ERR_POSTGRES_QUERY_CANCELLED");
      await closed.reached(1);
      expect(await outcome(query(sql))).toBe(refused);
      expect(logins(mock)).toEqual({ logins: 4, failed: 4 });
    });

    test.each([
      ["refused", pgErrorResponse({ S: "FATAL", C: "53300", M: "sorry, too many clients already" }), refused],
      // Dialed again for the same caller, see "the budget for dialing a server that accepts and closes".
      ["dropped before the login", Buffer.alloc(0), "resolved"],
    ])("when the first dial is %s", async (_, answer, first) => {
      await using mock = await pgScramServer({ password: prepared, instead: nth => (nth === 1 ? answer : undefined) });
      const connected = new Calls();
      await using sql = client(mock.port, { password: typed, max: 3, onconnect: connected.hit });
      expect(await Promise.all([query(sql), sql.connect()].map(outcome))).toEqual([first, first]);
      expect(await outcome(query(sql))).toBe("resolved");
      await connected.reached(3);
      expect(logins(mock)).toEqual({ logins: 4, failed: 1 });
    });
  });

  test.each([
    ["close()", undefined, "resolved", 2],
    // The socket may be gone before the server has read anything.
    ["close({ timeout: 0 })", { timeout: 0 }, "ERR_POSTGRES_CONNECTION_CLOSED", 1],
  ])("%s while that login is out: nothing more is dialed", async (_, options, first, atMost) => {
    await using mock = await pgScramServer({ password: prepared });
    const sql = client(mock.port, { password: typed, max: 3 });
    const waiting = outcome(sql.connect());
    expect([await outcome(sql.close(options)), await waiting]).toEqual(["resolved", first]);
    expect(await outcome(sql.connect())).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
    expect(mock.exchanges.length).toBeLessThanOrEqual(atMost);
  });

  test.each([
    ["postgres", prepared, 10],
    ["postgres", typed, 1],
    ["mysql", typed, 10],
  ] as const)(
    "%s, password %p: %d dials are out before the server has answered one",
    async (adapter, password, dials) => {
      const sockets: net.Socket[] = [];
      const { port, server } = await listeningServer(socket => void sockets.push(socket.on("error", () => {})));
      const sql = client(port, { adapter, password, max: 10 });
      const waiting = outcome(sql.connect());
      // Accepted after whatever the pool has dialed.
      const probe = net.connect(port, "127.0.0.1");
      await once(probe, "connect");
      while (!sockets.some(socket => socket.remotePort === probe.localPort)) await nextTurn();
      expect(sockets.length - 1).toBe(dials);
      await sql.close({ timeout: 0 });
      await waiting;
      probe.destroy();
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  );
});

// What follows needs a server that refuses, vanishes or closes at a chosen moment, which a healthy container does not.
const scripted = [
  {
    adapter: "postgres",
    url: (port: number) => `postgres://u@127.0.0.1:${port}/db`,
    prefix: "ERR_POSTGRES_",
    ready(socket: net.Socket, answers = false) {
      socket.once("data", () => {
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        if (answers) socket.on("data", () => this.answer(socket));
      });
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
    ready(socket: net.Socket, answers = false) {
      let buffered: Buffer = Buffer.alloc(0);
      let authenticated = false;
      socket.write(mysqlHandshakeV10());
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (authenticated) return void (mysqlAckSessionSetup(socket, payload) || (answers && this.answer(socket)));
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

describe.each(scripted)("$adapter, scripted server", script => {
  const { url, prefix, refuseLogin, answer } = script;
  const ready = (socket: net.Socket) => script.ready(socket);
  /** It also answers each simple query. */
  const serving = (socket: net.Socket) => script.ready(socket, true);
  async function serverOf(onSocket: (socket: net.Socket, nth: number) => void) {
    const sockets: net.Socket[] = [];
    let probes = 0;
    const { port, server } = await listeningServer(socket => {
      socket.on("error", () => {});
      onSocket(socket, sockets.push(socket));
    });
    return {
      port,
      sockets,
      /** How many connections the pool has dialed. One of our own is accepted after them. */
      async dials() {
        const probe = net.connect(port, "127.0.0.1");
        await once(probe, "connect");
        while (!sockets.some(socket => socket.remotePort === probe.localPort)) await nextTurn();
        probe.destroy();
        return sockets.length - ++probes;
      },
      async [Symbol.asyncDispose]() {
        for (const socket of sockets) socket.destroy();
        server.close();
        await once(server, "close");
      },
    };
  }

  /** These servers answer no query: a connection that has one stays busy, and close() would wait for it. */
  const unanswered = (sql: SQL) => ({ [Symbol.asyncDispose]: () => sql.close({ timeout: 0 }) });

  test.concurrent("a server that refuses every login is dialed `max` times for each query", async () => {
    await using server = await serverOf(refuseLogin);
    await using sql = new SQL({ url: url(server.port), max: 5 });
    const dials: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = server.sockets.length;
      expect(await outcome(sql.unsafe("select 1"))).toBe(prefix + "SERVER_ERROR");
      dials.push(server.sockets.length - before);
    }
    expect(dials).toEqual([5, 5, 5]);
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

  test.concurrent.each([
    ["query", (sql: SQL) => sql.unsafe("select 1").simple()],
    ["reserve()", (sql: SQL) => sql.reserve().then(reserved => reserved.release())],
    ["begin()", (sql: SQL) => sql.begin(tx => tx.unsafe("select 1").simple())],
  ])("a %s waits for the connection that is reserved when nothing more can be dialed", async (_, call) => {
    await using server = await serverOf((socket, nth) => (nth === 1 ? serving(socket) : refuseLogin(socket)));
    const closed = new Calls();
    await using sql = new SQL({ url: url(server.port), max: 2, onclose: closed.hit });
    const holder = await sql.reserve();
    await closed.reached(1);
    const waiting = outcome(call(sql));
    expect(await unlessPending(waiting, closed.reached(2).then(nextTurn))).toBe("pending");
    holder.release();
    expect(await waiting).toBe("resolved");
    expect(server.sockets.length).toBe(3);
  });

  test.concurrent("queries on a cold pool are served by the one connection that comes up", async () => {
    const closed = new Calls();
    // Room for one, which is let in once the client knows of the refusals.
    await using server = await serverOf((socket, nth) =>
      nth === 1 ? void closed.reached(2).then(() => serving(socket)) : refuseLogin(socket),
    );
    await using sql = new SQL({ url: url(server.port), max: 3, onclose: closed.hit });
    const queries = [1, 2, 3].map(() => outcome(sql.unsafe("select 1").simple()));
    expect(await Promise.all(queries)).toEqual(Array(3).fill("resolved"));
    // And one more if the pause is over when the login comes.
    expect(server.sockets.length).toBeLessThanOrEqual(4);
  });

  test.concurrent("a pool that lost connections grows by one dial for each caller that waits", async () => {
    await using server = await serverOf(ready);
    const connected = new Calls();
    const closed = new Calls();
    const sql = new SQL({ url: url(server.port), max: 3, onconnect: connected.hit, onclose: closed.hit });
    await using _ = unanswered(sql);
    await sql.connect();
    await connected.reached(3);
    server.sockets[1].destroy();
    server.sockets[2].destroy();
    await closed.reached(2);
    [1, 2].forEach(() => outcome(sql.unsafe("select 1").execute()));
    await connected.reached(4);
    expect(await server.dials()).toBe(4);
  });

  test.concurrent("the connection that is up drains for a reservation that nothing can be dialed for", async () => {
    let answerWith = ready;
    await using server = await serverOf(socket => answerWith(socket));
    const connected = new Calls();
    const closed = new Calls();
    await using sql = new SQL({ url: url(server.port), max: 2, onconnect: connected.hit, onclose: closed.hit });
    await sql.connect();
    await connected.reached(2);
    // One is lost, and somebody else takes its place.
    answerWith = refuseLogin;
    server.sockets[1].destroy();
    await closed.reached(1);
    const busy = outcome(sql.unsafe("select 1").simple().execute());
    const reservation = sql.reserve();
    expect(await unlessPending(outcome(reservation), closed.reached(2).then(nextTurn))).toBe("pending");
    const later = sql.unsafe("select 2").simple().execute();
    expect(later.active).toBe(false);
    answer(server.sockets[0]);
    expect(await busy).toBe("resolved");
    (await reservation).release();
    await once(server.sockets[0], "data");
    answer(server.sockets[0]);
    expect(await outcome(later)).toBe("resolved");
  });

  describe("a caller that finds no connection ready is dialed for, whatever the server said before", () => {
    const query = (sql: SQL) => sql.unsafe("select 1").simple();

    describe.each([2, 10])("max: %d, one place when the pool starts, then room", max => {
      test.concurrent.each([
        [
          "reserve()",
          async (sql: SQL) => {
            using _ = await sql.reserve();
            await query(sql);
          },
        ],
        ["begin()", (sql: SQL) => sql.begin(() => query(sql))],
      ])("a query of the pool inside %s", async (_, nested) => {
        let answerWith = (socket: net.Socket, nth: number) => (nth === 1 ? serving(socket) : refuseLogin(socket));
        await using server = await serverOf((socket, nth) => answerWith(socket, nth));
        const closed = new Calls();
        await using sql = new SQL({ url: url(server.port), max, onclose: closed.hit });
        await query(sql);
        await closed.reached(max - 1);
        answerWith = serving;
        expect(await outcome(nested(sql))).toBe("resolved");
      });
    });

    test.concurrent("when one dial of the start was refused and the other gets no answer", async () => {
      await using server = await serverOf((socket, nth) => {
        if (nth === 1) refuseLogin(socket);
        if (nth > 2) serving(socket);
      });
      const closed = new Calls();
      const sql = new SQL({ url: url(server.port), max: 2, connectionTimeout: 0, onclose: closed.hit });
      await using _ = unanswered(sql);
      const first = outcome(query(sql));
      await closed.reached(1);
      expect([await outcome(query(sql)), await first]).toEqual(["resolved", "resolved"]);
      expect(server.sockets.length).toBe(3);
    });

    test.concurrent("when its only connection is reserved and an earlier dial gets no answer", async () => {
      let answerWith = (socket: net.Socket, nth: number) => (nth === 1 ? serving(socket) : refuseLogin(socket));
      await using server = await serverOf((socket, nth) => answerWith(socket, nth));
      const closed = new Calls();
      const sql = new SQL({ url: url(server.port), max: 3, connectionTimeout: 0, onclose: closed.hit });
      await using _ = unanswered(sql);
      using held = await sql.reserve();
      await closed.reached(2);
      // The first caller's dials: one gets no answer, the other is refused.
      const before = server.sockets.length;
      answerWith = (socket, nth) => void (nth > before + 1 && refuseLogin(socket));
      const first = outcome(query(sql));
      await closed.reached(3);
      answerWith = serving;
      expect([await outcome(query(sql)), await first]).toEqual(["resolved", "resolved"]);
    });

    test.concurrent("the callers that wait when every connection is cut get a pool of `max` again", async () => {
      let answerWith = (socket: net.Socket, nth: number) => (nth <= 3 ? ready(socket) : refuseLogin(socket));
      await using server = await serverOf((socket, nth) => answerWith(socket, nth));
      const connected = new Calls();
      const closed = new Calls();
      const sql = new SQL({ url: url(server.port), max: 6, onconnect: connected.hit, onclose: closed.hit });
      await using _ = unanswered(sql);
      await sql.connect();
      await Promise.all([connected.reached(3), closed.reached(3)]);
      answerWith = ready;
      // Two for each connection, six wait.
      for (let i = 0; i < 12; i++) void outcome(sql.unsafe("select 1").execute());
      for (const socket of server.sockets.slice(0, 3)) socket.destroy();
      await connected.reached(9);
      expect(await server.dials()).toBe(12);
    });
  });

  test.concurrent.each([
    [1, true],
    [2, false],
  ])("behind %d reservations that wait for 2 busy connections, a query gets one of them: %p", async (ahead, served) => {
    await using server = await serverOf(ready);
    const connected = new Calls();
    const sql = new SQL({ url: url(server.port), max: 2, onconnect: connected.hit });
    await using _ = unanswered(sql);
    await sql.connect();
    await connected.reached(2);
    for (let i = 0; i < 2; i++) void outcome(sql.unsafe("select 1").execute());
    for (let i = 0; i < ahead; i++) void outcome(sql.reserve());
    const query = sql.unsafe("select 1").execute();
    void outcome(query);
    expect(query.active).toBe(served);
  });

  describe("while a connection is ready, the pool grows with care", () => {
    const waits = (sql: SQL) => void outcome(sql.unsafe("select 1").execute());

    test.concurrent.each([1, 4])("a pool that lost %d of 5 connections has 5 again", async lost => {
      await using server = await serverOf(ready);
      const connected = new Calls();
      const closed = new Calls();
      const sql = new SQL({ url: url(server.port), max: 5, onconnect: connected.hit, onclose: closed.hit });
      await using _ = unanswered(sql);
      await sql.connect();
      await connected.reached(5);
      for (const socket of server.sockets.slice(0, lost)) socket.destroy();
      await closed.reached(lost);
      for (let i = 0; i < 5; i++) waits(sql);
      await connected.reached(5 + lost);
      expect(await server.dials()).toBe(5 + lost);
    });

    test.concurrent("callers that wait at a server without a place do not cost a login each", async () => {
      await using server = await serverOf((socket, nth) => (nth === 1 ? serving(socket) : refuseLogin(socket)));
      await using sql = new SQL({ url: url(server.port), max: 5 });
      for (let i = 0; i < 40; i++) {
        // The second one has to wait.
        await Promise.all([sql.unsafe("select 1").simple(), sql.unsafe("select 1").simple()]);
      }
      // Five for the start of the pool, then one after each pause.
      expect(server.sockets.length).toBeLessThan(25);
    });

    test.concurrent("after a failed dial it asks for one more at a time", async () => {
      let answerWith: (socket: net.Socket) => void = ready;
      await using server = await serverOf(socket => answerWith(socket));
      const connected = new Calls();
      const closed = new Calls();
      const sql = new SQL({ url: url(server.port), max: 5, onconnect: connected.hit, onclose: closed.hit });
      await using _ = unanswered(sql);
      await sql.connect();
      await connected.reached(5);
      // Four are lost, and somebody else takes their places.
      answerWith = refuseLogin;
      for (const socket of server.sockets.slice(1)) socket.destroy();
      await closed.reached(4);
      waits(sql);
      waits(sql);
      await closed.reached(5);
      // The next dial gets no answer.
      answerWith = () => {};
      while (server.sockets.length === 6) {
        waits(sql);
        await nextTurn();
      }
      for (let i = 0; i < 5; i++) waits(sql);
      expect(await server.dials()).toBe(7);
    });

    test.concurrent("a pool that started at a server with one place grows when there is room", async () => {
      let answerWith = (socket: net.Socket, nth: number) => (nth === 1 ? ready(socket) : refuseLogin(socket));
      await using server = await serverOf((socket, nth) => answerWith(socket, nth));
      const connected = new Calls();
      const closed = new Calls();
      const sql = new SQL({ url: url(server.port), max: 4, onconnect: connected.hit, onclose: closed.hit });
      await using _ = unanswered(sql);
      await sql.connect();
      await closed.reached(3);
      answerWith = ready;
      while (connected.count < 4) {
        waits(sql);
        await nextTurn();
      }
      expect(await server.dials()).toBe(7);
    });

    test.concurrent("a login shows that there is room: the callers that already wait are dialed for", async () => {
      let answerWith = (socket: net.Socket, nth: number) => (nth <= 2 ? ready(socket) : refuseLogin(socket));
      await using server = await serverOf((socket, nth) => answerWith(socket, nth));
      const connected = new Calls();
      const closed = new Calls();
      const sql = new SQL({ url: url(server.port), max: 5, onconnect: connected.hit, onclose: closed.hit });
      await using _ = unanswered(sql);
      await sql.connect();
      await Promise.all([connected.reached(2), closed.reached(3)]);
      answerWith = ready;
      waits(sql);
      waits(sql);
      // Nobody releases, and nobody else arrives.
      const waiting = [1, 2, 3, 4].map(() => sql.reserve());
      server.sockets[1].destroy();
      const held = await Promise.all(waiting);
      expect(await server.dials()).toBe(9);
      for (const reserved of held) reserved.release();
    });

    test.concurrent.each(["reserve", "begin"] as const)(
      "the logins of a start do not start the pool again for %s() callers",
      async how => {
        const late: net.Socket[] = [];
        await using server = await serverOf((socket, nth) => (nth <= 2 ? void late.push(socket) : refuseLogin(socket)));
        const connected = new Calls();
        const closed = new Calls();
        const sql = new SQL({ url: url(server.port), max: 5, onconnect: connected.hit, onclose: closed.hit });
        await using _ = unanswered(sql);
        const held: unknown[] = [];
        for (let i = 0; i < 6; i++) {
          void outcome(how === "reserve" ? sql.reserve().then(reserved => held.push(reserved)) : sql.begin(() => {}));
        }
        // The refusals come first, so each login finds the pool below `max`, and a caller takes it for itself at once.
        await closed.reached(3);
        for (const socket of late) ready(socket);
        await Promise.all([connected.reached(2), closed.reached(4)]);
        // Five for the start, and the one more that the last login asks for.
        expect(await server.dials()).toBe(6);
      },
    );

    test.concurrent("a connection that it loses is replaced at once, whatever the server said before", async () => {
      let answerWith = (socket: net.Socket, nth: number) => (nth <= 2 ? ready(socket) : refuseLogin(socket));
      await using server = await serverOf((socket, nth) => answerWith(socket, nth));
      const closed = new Calls();
      const sql = new SQL({ url: url(server.port), max: 12, onclose: closed.hit });
      await using _ = unanswered(sql);
      await sql.connect();
      await closed.reached(10);
      answerWith = ready;
      waits(sql);
      waits(sql);
      const waiting = [1, 2].map(() => outcome(sql.reserve().then(reserved => reserved.release())));
      server.sockets[1].destroy();
      expect(await Promise.all(waiting)).toEqual(["resolved", "resolved"]);
    });
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
    expect(await server.dials()).toBe(0);
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
