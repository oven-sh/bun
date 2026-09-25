// A user-provided onconnect/onclose callback that throws used to abort the
// pool's connection handler mid-way: the connection state stayed pending,
// storedError was never recorded, pending queries were never notified and
// release() never ran, so anything awaiting the pool (queries, connect(),
// end()) hung forever. The callback exception must not abort the pool
// bookkeeping; it still surfaces as an uncaughtException.
// https://github.com/oven-sh/bun/issues/32037
//
// The established-connection scenarios run against the real docker-compose
// postgres/mysql services. The connection-refused scenarios use a real closed
// port and the synchronous-failure scenario never dials, so those run
// everywhere. Each scenario runs in a subprocess because the throwing
// callback is reported as a process-level uncaughtException.
//
// The AsyncLocalStorage section covers the other property of the same two
// callback invocations: they run in the async context the SQL instance was
// created in (see that section's comment). The last section covers pool calls
// made synchronously inside onclose.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { closedPort } from "./wire-frames";

// Fixtures that need closedPort() / neverAnsweringServer() run them in the
// spawned subprocess (not the test process) by importing ./wire-frames via
// this absolute path, so the bind→close→connect window is not widened by
// the subprocess spawn.
const wireFramesPath = path.join(import.meta.dir, "wire-frames.ts");

async function runFixture(code: string, env: Record<string, string> = {}) {
  using dir = tempDir("sql-throwing-hooks", { "fixture.ts": code });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stderr: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Connects to the server at FIXTURE_URL with a throwing hook installed, runs
// a query, then closes the pool. Without the fix the query (throwing
// onconnect) or sql.end() (throwing onclose) never settles and the fixture
// never reaches "ended".
function throwingHookFixture(hook: "onconnect" | "onclose") {
  return /* ts */ `
import { SQL } from "bun";
process.on("uncaughtException", err => console.log("uncaught:", err.message));
const sql = new SQL({
  url: process.env.FIXTURE_URL,
  max: 1,
  ${hook}(err) {
    console.log("${hook}:", err === null || err === undefined ? null : err.message);
    throw new Error("boom from ${hook}");
  },
});
const rows = await sql.unsafe("SELECT 1 as x");
console.log("query:", JSON.stringify(rows));
await sql.end();
console.log("ended");
process.exit(0);
`;
}

if (isDockerEnabled()) {
  describeWithContainer("postgres", { image: "postgres_plain" }, container => {
    test("a throwing onconnect callback does not leave the pool stuck", async () => {
      await container.ready;
      const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, exitCode } = await runFixture(throwingHookFixture("onconnect"), { FIXTURE_URL: url });
      expect(stdout).toBe('onconnect: null\nuncaught: boom from onconnect\nquery: [{"x":1}]\nended\n');
      expect(exitCode).toBe(0);
    });

    test("a throwing onclose callback does not hang sql.end()", async () => {
      await container.ready;
      const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, exitCode } = await runFixture(throwingHookFixture("onclose"), { FIXTURE_URL: url });
      expect(stdout).toBe('query: [{"x":1}]\nonclose: Connection closed\nuncaught: boom from onclose\nended\n');
      expect(exitCode).toBe(0);
    });

    // PostgresSQLQuery.do_run refs the connection's poll_ref KeepAlive (a
    // two-state flag, not a counter). When do_run returns early with a
    // synchronous error before enqueueing — here a boxed Boolean binding
    // rejected inside Signature::generate — the poll_ref must not be left
    // Active, or the event loop stays pinned and the process never exits. The
    // setImmediate forces do_run onto a later turn so on_data's epilogue
    // doesn't mask the leak.
    test("a synchronous do_run failure does not pin the event loop", async () => {
      await container.ready;
      const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
      const fixture = /* ts */ `
const sql = new Bun.SQL({
  url: process.env.FIXTURE_URL,
  max: 1,
  idleTimeout: 0,
  maxLifetime: 0,
  connectionTimeout: 30,
});
await sql.connect();
await new Promise(r => setImmediate(r));
const err = await sql\`SELECT \${new Boolean(true)}\`.catch(e => e);
console.log("rejected:" + (err?.code ?? err?.name ?? String(err)));
`;
      const { stdout, stderr, exitCode } = await runFixture(fixture, { FIXTURE_URL: url });
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "rejected:ERR_INVALID_ARG_TYPE\n",
        stderr: expect.any(String),
        exitCode: 0,
      });
    });
  });

  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("a throwing onconnect callback does not leave the pool stuck", async () => {
      await container.ready;
      const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, exitCode } = await runFixture(throwingHookFixture("onconnect"), { FIXTURE_URL: url });
      expect(stdout).toBe('onconnect: null\nuncaught: boom from onconnect\nquery: [{"x":1}]\nended\n');
      expect(exitCode).toBe(0);
    });

    test("a throwing onclose callback does not hang sql.end()", async () => {
      await container.ready;
      const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, exitCode } = await runFixture(throwingHookFixture("onclose"), { FIXTURE_URL: url });
      expect(stdout).toBe('query: [{"x":1}]\nonclose: Connection closed\nuncaught: boom from onclose\nended\n');
      expect(exitCode).toBe(0);
    });
  });
}

// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// A port with nothing listening on it, so the connection is refused. Refused
// connections fail fast (not retried), so the throwing onclose fires on the
// first attempt; without the fix the pending query is never rejected. The
// fixture allocates the closed port itself (same as forcedCloseFixture below)
// so the bind→close→connect window is not widened by the subprocess spawn,
// during which the concurrent forcedCloseFixture tests are issuing bind(0).
function refusedConnectionFixture(adapter: "postgres" | "mysql") {
  const url = adapter === "postgres" ? "postgres://postgres@127.0.0.1:" : "mysql://root@127.0.0.1:";
  const db = adapter === "postgres" ? "/postgres" : "/db";
  return /* ts */ `
import { SQL } from "bun";
import { closedPort } from ${JSON.stringify(wireFramesPath)};
process.on("uncaughtException", err => console.log("uncaught:", err.message));
const port = await closedPort();
const sql = new SQL({
  url: "${url}" + port + "${db}",
  max: 1,
  onclose(err) {
    console.log("onclose:", err.code);
    throw new Error("boom from onclose");
  },
});
try {
  await sql.unsafe("SELECT 1");
  console.log("query resolved");
} catch (err) {
  console.log("query rejected:", err.code);
}
process.exit(0);
`;
}

for (const [adapter, refusedCode] of [
  ["postgres", "ERR_POSTGRES_CONNECTION_REFUSED"],
  ["mysql", "ERR_MYSQL_CONNECTION_REFUSED"],
] as const) {
  test.concurrent(
    `${adapter}: a throwing onclose callback still rejects pending queries when the connection is refused`,
    async () => {
      const { stdout, exitCode } = await runFixture(refusedConnectionFixture(adapter));
      expect(stdout).toBe(`onclose: ${refusedCode}\nuncaught: boom from onclose\nquery rejected: ${refusedCode}\n`);
      expect(exitCode).toBe(0);
    },
  );
}

// When createConnection fails synchronously (here: a password function that
// throws), onclose used to be invoked while the adapter was still filling
// this.connections, so pool methods that scan that array (flush, isConnected,
// close) threw a TypeError on the holes when called from inside the callback.
// The callback is now deferred until the pool is fully constructed. Nothing
// is dialed: password() throws before the connection is created.
test.concurrent("postgres: pool calls from onclose are safe when connecting fails synchronously", async () => {
  const fixture = /* ts */ `
import { SQL } from "bun";
process.on("uncaughtException", err => console.log("uncaught:", err.message));
const sql = new SQL({
  adapter: "postgres",
  hostname: "127.0.0.1",
  port: 1, // never dialed: password() throws before the connection is created
  username: "postgres",
  database: "postgres",
  max: 2,
  password: () => {
    throw new Error("password error");
  },
  onclose(err) {
    try {
      sql.flush();
      console.log("reentry ok");
    } catch (err2) {
      console.log("reentry threw:", err2.constructor.name);
    }
  },
});
try {
  await sql.unsafe("SELECT 1");
  console.log("query resolved");
} catch (err) {
  console.log("query rejected:", err.message);
}
process.exit(0);
`;
  const { stdout, exitCode } = await runFixture(fixture);
  expect(stdout).toBe("reentry ok\nreentry ok\nquery rejected: password error\n");
  expect(exitCode).toBe(0);
});

// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// The forced-close path (#32095) and the throwing-callback path (#32037) meet
// in the pool connection's close handler: the bookkeeping that settles the
// promise returned by close() must run even when a user callback throws. A
// server that accepts the TCP connection but never answers keeps the
// connection mid-handshake, and connectionTimeout: 0 disables the connect
// timer, so close() is the only teardown path; if the bookkeeping were
// skipped these fixtures would never print "closed". Since #39940 a slot
// that never completed its handshake fired no onconnect, so the forced close
// skips its onclose too; the throwing onclose stays installed to pin that it
// is not invoked. The mock server lives in the fixture process (it must
// observe `accepted` before forcing close) and is imported from ./wire-frames
// by absolute path.
function forcedCloseFixture(adapter: "postgres" | "mysql") {
  const url = adapter === "postgres" ? "postgres://postgres@127.0.0.1:" : "mysql://root@127.0.0.1:";
  const db = adapter === "postgres" ? "/postgres" : "/db";
  return /* ts */ `
import { SQL } from "bun";
import { neverAnsweringServer } from ${JSON.stringify(wireFramesPath)};
process.on("uncaughtException", err => console.log("uncaught:", err.message));
const { port, accepted } = await neverAnsweringServer();
const sql = new SQL({
  url: "${url}" + port + "${db}",
  max: 1,
  connectionTimeout: 0,
  onclose(err) {
    console.log("onclose:", err?.code ?? err);
    throw new Error("boom from onclose");
  },
});
const queryError = sql.unsafe("SELECT 1").catch(err => err);
await accepted;
await sql.close({ timeout: "0" });
console.log("closed");
console.log("query rejected:", (await queryError).code);
process.exit(0);
`;
}

for (const [adapter, closedCode] of [
  ["postgres", "ERR_POSTGRES_CONNECTION_CLOSED"],
  ["mysql", "ERR_MYSQL_CONNECTION_CLOSED"],
] as const) {
  test.concurrent(
    `${adapter}: forced close() mid-handshake resolves and skips onclose for the never-connected slot`,
    async () => {
      const { stdout, exitCode } = await runFixture(forcedCloseFixture(adapter));
      expect(stdout).toBe(`closed\nquery rejected: ${closedCode}\n`);
      expect(exitCode).toBe(0);
    },
  );
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage. onconnect/onclose used to run in whatever context the
// native callback happened to fire in: none for a socket event (onconnect, a
// refused or dropped connection), or the close() caller's when a plaintext
// connection closes synchronously inside close(). They now run in the context
// the SQL instance was created in: pool connections are opened by whichever
// query happens to need one (and re-opened on retry) and closed by close(),
// idle timeouts or the server, so no other context is well defined. Every
// pool below is driven from a context other than the one it was created in,
// so an implementation that inherits the caller's context fails these too.
// ---------------------------------------------------------------------------

const als = new AsyncLocalStorage<string>();

type HookEvent = [hook: "onconnect" | "onclose", store: string | undefined];

/**
 * `new SQL(...)` inside `als.run(createdIn)` (outside any store when `createdIn` is
 * undefined), recording the store each hook observes when it fires.
 */
function poolCreatedIn(createdIn: string | undefined, url: string) {
  const events: HookEvent[] = [];
  const options = {
    url,
    max: 1,
    onconnect() {
      events.push(["onconnect", als.getStore()]);
    },
    onclose() {
      events.push(["onclose", als.getStore()]);
    },
  };
  const create = () => new SQL(options);
  const sql = createdIn === undefined ? als.exit(create) : als.run(createdIn, create);
  return { sql, events };
}

// describeWithContainer skips itself when no postgres service is reachable, so
// this block needs no isDockerEnabled() guard.
describeWithContainer("postgres: AsyncLocalStorage", { image: "postgres_plain" }, container => {
  test("onconnect and onclose observe the store each pool was created in, not the caller's", async () => {
    await container.ready;
    const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
    const a = poolCreatedIn("created-a", url);
    const b = poolCreatedIn("created-b", url);
    try {
      await als.run("caller", () => Promise.all([a.sql.connect(), b.sql.connect()]));
    } finally {
      await als.run("caller", () => Promise.all([a.sql.close(), b.sql.close()]));
    }
    expect({ a: a.events, b: b.events }).toStrictEqual({
      a: [
        ["onconnect", "created-a"],
        ["onclose", "created-a"],
      ],
      b: [
        ["onconnect", "created-b"],
        ["onclose", "created-b"],
      ],
    });
  });

  test("a pool created outside any store does not inherit the caller's store", async () => {
    await container.ready;
    const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
    const { sql, events } = poolCreatedIn(undefined, url);
    try {
      await als.run("caller", () => sql.connect());
    } finally {
      await als.run("caller", () => sql.close());
    }
    expect(events).toStrictEqual([
      ["onconnect", undefined],
      ["onclose", undefined],
    ]);
  });
});

// Fault-injection test (a refused connection), see the DO NOT COPY THIS PATTERN
// note above: anything a real server can produce belongs in describeWithContainer.
// A refused connection reaches onclose through the connect-failure path rather
// than through close(), and since nothing has to be listening it also covers
// the mysql adapter.
for (const [adapter, scheme, refusedCode] of [
  ["postgres", "postgres://postgres@127.0.0.1:", "ERR_POSTGRES_CONNECTION_REFUSED"],
  ["mysql", "mysql://root@127.0.0.1:", "ERR_MYSQL_CONNECTION_REFUSED"],
] as const) {
  test.concurrent(
    `${adapter}: onclose for a refused connection observes the store the pool was created in`,
    async () => {
      const { sql, events } = poolCreatedIn("created-in", `${scheme}${await closedPort()}/db`);
      let code: string | undefined;
      try {
        await als.run("caller", () => sql.connect());
      } catch (err) {
        code = (err as { code?: string }).code;
      } finally {
        await sql.close();
      }
      expect({ code, events }).toStrictEqual({ code: refusedCode, events: [["onclose", "created-in"]] });
    },
  );
}

// ---------------------------------------------------------------------------
// Pool calls made inside onclose. The slot of the connection that closed used
// to stay in the pool's ready set while onclose ran, so query.execute(),
// sql.reserve(), sql.begin(), sql.notify() and sql.connect() made there were
// handed the dead slot. Only an awaited query worked, because a query reaches
// the pool one microtask after it is awaited. The slot now finishes closing
// before onclose runs, so all of them are served like the awaited query.
//
// A second pool makes the server drop the connection of the pool under test
// (pg_terminate_backend / KILL), which a healthy server does on demand.
// ---------------------------------------------------------------------------

type PoolEntry = "execute" | "reserve" | "begin" | "notify" | "connect";
type CloseTrigger = "a server-side disconnect" | "reserved.close()";

type OncloseDriver = {
  /** Selects one row `{ id }`: the server-side session of the connection that runs it. */
  idQuery: string;
  /** Makes the server drop session `$id`. */
  killQuery: string;
  /** What a handle rejects with once its connection is closed. */
  closedCode: string;
  entries: PoolEntry[];
};

const postgresOnclose: OncloseDriver = {
  idQuery: "select pg_backend_pid() as id",
  killQuery: "select pg_terminate_backend($id)",
  closedCode: "ERR_POSTGRES_CONNECTION_CLOSED",
  entries: ["execute", "reserve", "begin", "notify", "connect"],
};

const mysqlOnclose: OncloseDriver = {
  idQuery: "select connection_id() as id",
  killQuery: "kill $id",
  closedCode: "ERR_MYSQL_CONNECTION_CLOSED",
  entries: ["execute", "reserve", "begin", "connect"],
};

async function sessionId(query: PromiseLike<{ id: number | bigint | string }[]>) {
  return Number((await query)[0].id);
}

function errorCode(err: unknown) {
  return (err as { code?: string } | null)?.code ?? String(err);
}

function rejectionCode(promise: PromiseLike<unknown>): Promise<string> {
  return Promise.resolve(promise).then(() => "resolved", errorCode);
}

/**
 * What a user's onclose starts. Each one reaches the pool before it returns. Resolves to the
 * session that served it, when it runs a query.
 */
const enterPool: Record<PoolEntry, (sql: SQL, idQuery: string) => Promise<number | undefined>> = {
  execute: (sql, idQuery) => sessionId(sql.unsafe(idQuery).execute()),
  async reserve(sql, idQuery) {
    using reserved = await sql.reserve();
    return await sessionId(reserved.unsafe(idQuery));
  },
  begin: (sql, idQuery) => sql.begin(tx => sessionId(tx.unsafe(idQuery))),
  notify: sql => sql.notify("onclose_entry", "from onclose").then(() => undefined),
  connect: sql => sql.connect().then(() => undefined),
};

// onclose makes its pool call, then throws. Prints which session served the call.
const throwingOncloseEntryFixture = /* ts */ `
import { SQL } from "bun";
process.on("uncaughtException", err => console.log("uncaught:", err.message));
const { FIXTURE_URL: url, FIXTURE_ID_QUERY: idQuery, FIXTURE_KILL_QUERY: killQuery } = process.env;
const sessionId = async query => Number((await query)[0].id);
const entry = Promise.withResolvers();
let oncloses = 0;
const sql = new SQL({
  url,
  max: 1,
  onclose() {
    if (++oncloses !== 1) return;
    console.log("onclose");
    entry.resolve(sessionId(sql.unsafe(idQuery).execute()));
    throw new Error("boom from onclose");
  },
});
const admin = new SQL({ url, max: 1 });
const killed = await sessionId(sql.unsafe(idQuery));
await admin.unsafe(killQuery.replace("$id", String(killed)));
const served = await entry.promise.catch(err => err.message);
console.log("entry:", served === killed ? "killed session" : typeof served === "number" ? "new session" : served);
await admin.close();
await sql.close();
process.exit(0);
`;

function poolEntryInsideOncloseTests({ idQuery, killQuery, closedCode, entries }: OncloseDriver, url: () => string) {
  const dropSession = (admin: SQL, id: number) => admin.unsafe(killQuery.replace("$id", String(id)));

  /** Closes the only connection of `sql`. Resolves to the session that closed. */
  async function closeConnection(trigger: CloseTrigger, sql: SQL, admin: SQL) {
    if (trigger === "reserved.close()") {
      const reserved = await sql.reserve();
      const closed = await sessionId(reserved.unsafe(idQuery));
      await reserved.close();
      return closed;
    }
    const killed = await sessionId(sql.unsafe(idQuery));
    await dropSession(admin, killed);
    return killed;
  }

  const triggers: CloseTrigger[] = ["a server-side disconnect", "reserved.close()"];
  test.each(entries.flatMap(entry => triggers.map(trigger => [entry, trigger] as const)))(
    "%s inside onclose after %s is served by a new connection",
    async (entry, trigger) => {
      const served = Promise.withResolvers<{ session: number | undefined; onconnects: number }>();
      let onconnects = 0;
      let oncloses = 0;
      await using admin = new SQL({ url: url(), max: 1 });
      await using sql = new SQL({
        url: url(),
        max: 1,
        onconnect() {
          onconnects++;
        },
        onclose() {
          // only for the first close: closing the pool fires onclose again
          if (++oncloses !== 1) return;
          served.resolve(enterPool[entry](sql, idQuery).then(session => ({ session, onconnects })));
        },
      });
      const closed = await closeConnection(trigger, sql, admin);
      // rejects with the error of the pool call when the dead slot served it
      const { session, onconnects: onconnectsWhenServed } = await served.promise;
      expect({ servedByClosedSession: session === closed, onconnectsWhenServed, oncloses }).toEqual({
        servedByClosedSession: false,
        onconnectsWhenServed: 2,
        oncloses: 1,
      });
    },
  );

  // The close must leave nothing to do after onclose: anything it still wrote to the slot
  // would undo the dial that onclose started, and the second query would dial again.
  test("a query awaited inside onclose shares the dial that execute() started there", async () => {
    const served = Promise.withResolvers<number[]>();
    let dials = 0;
    let oncloses = 0;
    await using admin = new SQL({ url: url(), max: 1 });
    await using sql = new SQL({
      url: url(),
      max: 1,
      // the pool calls a password function once for each dial
      password: () => (dials++, ""),
      onclose() {
        if (++oncloses !== 1) return;
        served.resolve(
          Promise.all([
            // reaches the pool inside onclose
            sessionId(sql.unsafe(idQuery).execute()),
            // reaches the pool one microtask after onclose returned
            sessionId(sql.unsafe(idQuery)),
          ]),
        );
      },
    });
    const killed = await closeConnection("a server-side disconnect", sql, admin);
    const [first, second] = await served.promise;
    expect({ dials, sameSession: first === second, servedByKilledSession: first === killed, oncloses }).toEqual({
      dials: 2,
      sameSession: true,
      servedByKilledSession: false,
      oncloses: 1,
    });
  });

  // Both connections are idle, so both slots are in the ready set when one of them is dropped.
  test.each([0, 1])(
    "max 2: execute() inside onclose runs on the live connection when connection %d is dropped",
    async dropped => {
      const served = Promise.withResolvers<number | undefined>();
      let oncloses = 0;
      await using admin = new SQL({ url: url(), max: 1 });
      await using sql = new SQL({
        url: url(),
        max: 2,
        onclose() {
          if (++oncloses !== 1) return;
          served.resolve(enterPool.execute(sql, idQuery));
        },
      });
      // hold both connections to learn their sessions, then hand them back idle
      const reserved = [await sql.reserve(), await sql.reserve()];
      const sessions = await Promise.all(reserved.map(handle => sessionId(handle.unsafe(idQuery))));
      for (const handle of reserved) handle.release();
      await dropSession(admin, sessions[dropped]);
      expect(await served.promise).toBe(sessions[1 - dropped]);
    },
  );

  // A handle belongs to the connection it was made on. It is closed before onclose runs, so a
  // statement sent through it inside onclose cannot reach the connection that onclose dials.
  test.each(
    (["reserved", "transaction"] as const).flatMap(handle =>
      [false, true].map(redial => [handle, redial ? "and a redial" : "alone"] as const),
    ),
  )("a statement on the dropped %s handle inside onclose, %s, rejects", async (handle, redial) => {
    const outcome = Promise.withResolvers<{ unsafe: string; tagged: string }>();
    const oncloseReturned = Promise.withResolvers<void>();
    let held: Bun.ReservedSQL | Bun.TransactionSQL;
    let oncloses = 0;
    await using admin = new SQL({ url: url(), max: 1 });
    await using sql = new SQL({
      url: url(),
      max: 1,
      onclose() {
        if (++oncloses !== 1) return;
        const redialed = redial === "and a redial" ? sql.connect() : undefined;
        outcome.resolve(
          Promise.all([rejectionCode(held.unsafe(idQuery)), rejectionCode(held`select 1`), redialed]).then(
            ([unsafe, tagged]) => ({ unsafe, tagged }),
          ),
        );
        oncloseReturned.resolve();
      },
    });
    let session: number;
    let transaction: Promise<string> | undefined;
    if (handle === "reserved") {
      held = await sql.reserve();
      session = await sessionId(held.unsafe(idQuery));
    } else {
      const inside = Promise.withResolvers<number>();
      transaction = rejectionCode(
        sql.begin(async tx => {
          held = tx;
          inside.resolve(await sessionId(tx.unsafe(idQuery)));
          await oncloseReturned.promise;
        }),
      );
      session = await inside.promise;
    }
    await dropSession(admin, session);
    expect(await outcome.promise).toEqual({ unsafe: closedCode, tagged: closedCode });
    await transaction;
  });

  test("execute() inside an onclose that throws is still served by a new connection", async () => {
    const { stdout, exitCode } = await runFixture(throwingOncloseEntryFixture, {
      FIXTURE_URL: url(),
      FIXTURE_ID_QUERY: idQuery,
      FIXTURE_KILL_QUERY: killQuery,
    });
    expect(stdout).toBe("onclose\nuncaught: boom from onclose\nentry: new session\n");
    expect(exitCode).toBe(0);
  });
}

// Runs wherever a postgres_plain service is reachable.
describeWithContainer(
  "postgres: pool calls inside onclose",
  { image: "postgres_plain", concurrent: true },
  container => {
    poolEntryInsideOncloseTests(
      postgresOnclose,
      () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
    );
  },
);

// Like the other MySQL tests of this file, these run where docker provides the service.
if (isDockerEnabled()) {
  describeWithContainer("mysql: pool calls inside onclose", { image: "mysql_plain", concurrent: true }, container => {
    poolEntryInsideOncloseTests(mysqlOnclose, () => `mysql://root@${container.host}:${container.port}/bun_sql_test`);
  });
}

// Fault-injection test (a refused connection), see the DO NOT COPY THIS PATTERN
// note above: anything a real server can produce belongs in describeWithContainer.
// A refused connection closes the slot through the connect-failure path, and
// since nothing has to be listening it also covers the mysql adapter. The
// close used to reject what onclose had just queued together with the queries
// that were waiting before it. onclose makes its call only once: the redial is
// refused too, and an unguarded onclose would redial forever.
for (const [adapter, scheme, refusedCode] of [
  ["postgres", "postgres://postgres@127.0.0.1:", "ERR_POSTGRES_CONNECTION_REFUSED"],
  ["mysql", "mysql://root@127.0.0.1:", "ERR_MYSQL_CONNECTION_REFUSED"],
] as const) {
  test.concurrent(`${adapter}: execute() inside onclose for a refused connection redials`, async () => {
    const events: string[] = [];
    let entry: Promise<unknown> | undefined;
    const sql = new SQL({
      url: `${scheme}${await closedPort()}/db`,
      max: 1,
      onclose(err) {
        events.push(`onclose: ${errorCode(err)}`);
        entry ??= rejectionCode(sql.unsafe("SELECT 2").execute()).then(code => events.push(`entry: ${code}`));
      },
    });
    try {
      events.push(`query: ${await rejectionCode(sql.unsafe("SELECT 1"))}`);
      await entry;
    } finally {
      await sql.close();
    }
    expect(events).toEqual([
      `onclose: ${refusedCode}`,
      `query: ${refusedCode}`,
      `onclose: ${refusedCode}`,
      `entry: ${refusedCode}`,
    ]);
  });
}

// A connection that cannot be created (here the password function throws) closes the slot
// with no socket event. An onclose that always goes back to the pool then dials again at once.
// The close comes on a later turn of the event loop, so timers and I/O run between the dials.
for (const adapter of ["postgres", "mysql"] as const) {
  test.concurrent.each(["awaited", "execute", "connect"] as const)(
    `${adapter}: an onclose that always makes a pool call (%s) lets the event loop run when no connection can be created`,
    async entry => {
      const stopped = Promise.withResolvers<void>();
      let oncloses = 0;
      let immediateRanAfter: number | undefined;
      const sql = new SQL({
        adapter,
        hostname: "127.0.0.1",
        port: 1, // never dialed: password() throws before the connection is created
        username: "u",
        database: "d",
        max: 1,
        password: () => {
          throw new Error("no password");
        },
        onclose() {
          // stops when the event loop had its turn, or at the cap when it never gets one
          if (++oncloses === 100 || immediateRanAfter !== undefined) return stopped.resolve();
          const call =
            entry === "connect"
              ? sql.connect()
              : entry === "execute"
                ? sql.unsafe("select 1").execute()
                : sql.unsafe("select 1");
          rejectionCode(call);
        },
      });
      setImmediate(() => {
        immediateRanAfter = oncloses;
        stopped.resolve();
      });
      try {
        await rejectionCode(sql.unsafe("select 1"));
        await stopped.promise;
      } finally {
        await sql.close();
      }
      expect({ immediateRanAfter, oncloses }).toEqual({ immediateRanAfter: 0, oncloses: 1 });
    },
  );
}
