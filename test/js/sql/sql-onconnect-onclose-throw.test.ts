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

import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled, tempDir } from "harness";
import path from "node:path";

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
// in the pool connection's close handler: the user's onclose runs first and
// may throw, and the bookkeeping that follows it must still settle the
// promise returned by close(). A server that accepts the TCP connection but
// never answers keeps the connection mid-handshake, and connectionTimeout: 0
// disables the connect timer, so close() is the only teardown path; if the
// throw skipped the bookkeeping these fixtures would never print "closed".
// The mock server lives in the fixture process (it must observe `accepted`
// before forcing close) and is imported from ./wire-frames by absolute path.
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
    `${adapter}: a throwing onclose does not prevent forced close() from resolving mid-handshake`,
    async () => {
      const { stdout, exitCode } = await runFixture(forcedCloseFixture(adapter));
      expect(stdout).toBe(
        `onclose: ${closedCode}\nuncaught: boom from onclose\nclosed\nquery rejected: ${closedCode}\n`,
      );
      expect(exitCode).toBe(0);
    },
  );
}
