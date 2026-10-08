// A simple-protocol Query ('Q') is its own sync point: the backend answers it
// with exactly one ReadyForQuery, and Bun writes nothing behind it.
// - A Sync would elicit a second ReadyForQuery. It re-arms the connection's
//   "ready" state while the Parse+Describe round trip of the next query is in
//   flight, advance() then pipelines a third query into that window, and its
//   replies go to the wrong query.
// - A Flush reaches the server after the ReadyForQuery. PostgreSQL starts
//   idle_in_transaction_session_timeout and idle_session_timeout when it sends
//   ReadyForQuery and stops them at the next message of any kind, so the session
//   then idles with no limit.
//
// The simple protocol is used for query.simple(), for sql.unsafe(text) with no
// parameters, for LISTEN, and for the BEGIN/COMMIT/ROLLBACK/SAVEPOINT statements
// that Bun sends itself.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, tempDir } from "harness";
import type { Socket } from "node:net";
import { join } from "node:path";
import { pgCommandComplete, pgMockServer, pgReadyForQuery } from "./wire-frames";

// A real server does not show what it received, so these use a mock.
describe("a simple query is one Query message and nothing else", () => {
  // Runs `statements` on a client of a mock server. The result is every frontend
  // message of each connection, as its type and its body.
  async function frames(statements: (sql: SQL) => Promise<unknown>): Promise<string[][]> {
    const received = new Map<Socket, string[]>();
    const mock = await pgMockServer((type, body, socket) => {
      if (!received.has(socket)) received.set(socket, []);
      received.get(socket)!.push(`${type} ${body.toString("latin1")}`);
      if (type === "Q") return [pgCommandComplete("SELECT 0"), pgReadyForQuery()];
    });
    try {
      await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
      await statements(sql);
      return Array.from(received.values(), messages => [...messages]);
    } finally {
      mock.server.close();
    }
  }
  // PostgreSQL FE/BE protocol §55.7 Query: Byte1('Q') Int32(len) String(query)
  const query = (text: string) => `Q ${text}\0`;
  const fail = async () => {
    throw new Error("roll back");
  };

  test("unsafe(), simple(), file(), a queued query and a reservation", async () => {
    using dir = tempDir("pg-simple-query", { "query.sql": "select 4" });
    const sent = await frames(async sql => {
      await sql.unsafe("select 1");
      await sql.unsafe("select 2", []);
      await sql`select 3`.simple();
      await sql.file(join(String(dir), "query.sql"));
      // The second query waits for the first, so advance() writes it.
      await Promise.all([sql.unsafe("select 5"), sql.unsafe("select 6")]);
      await using reserved = await sql.reserve();
      await reserved.unsafe("select 7");
      // The length of a frame counts a terminator, also behind a text that ends in NUL.
      await reserved.unsafe("select 8\0");
    });

    expect(sent).toEqual([
      [
        query("select 1"),
        query("select 2"),
        query("select 3"),
        query("select 4"),
        query("select 5"),
        query("select 6"),
        query("select 7"),
        query("select 8\0"),
      ],
    ]);
  });

  test("the statements of begin(), savepoint() and a distributed transaction", async () => {
    const sent = await frames(async sql => {
      await sql.begin(async tx => {
        await tx.unsafe("select 1");
        await tx.savepoint(async () => {});
        await tx.savepoint(fail).catch(() => {});
      });
      await sql.begin(fail).catch(() => {});
      await sql.beginDistributed("a", async () => {});
      await sql.commitDistributed("a");
      await sql.beginDistributed("b", async () => {});
      await sql.rollbackDistributed("b");
    });

    expect(sent).toEqual([
      [
        query("BEGIN"),
        query("select 1"),
        query("SAVEPOINT s0"),
        query("RELEASE SAVEPOINT s0"),
        query("SAVEPOINT s1"),
        query("ROLLBACK TO SAVEPOINT s1"),
        query("COMMIT"),
        query("BEGIN"),
        query("ROLLBACK"),
        query("BEGIN"),
        query("PREPARE TRANSACTION 'a'"),
        query("COMMIT PREPARED 'a'"),
        query("BEGIN"),
        query("PREPARE TRANSACTION 'b'"),
        query("ROLLBACK PREPARED 'b'"),
      ],
    ]);
  });

  test("LISTEN and UNLISTEN of sql.listen()", async () => {
    const sent = await frames(async sql => {
      const listening = await sql.listen("one", () => {});
      await sql.listen("two", () => {});
      // Not the last channel: for that one Bun closes the connection and sends no UNLISTEN.
      await listening.unlisten();
    });

    expect(sent).toEqual([[query('LISTEN "one"'), query('LISTEN "two"'), query('UNLISTEN "one"')]]);
  });
});

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  // Before the fix: the second ReadyForQuery from A's redundant Sync lets C's
  // 'Q' go out inside B's Parse+Describe window. C's result set then arrives
  // while B is still the current query, so B resolves with C's row and C
  // resolves with B's (field-less) Bind+Execute row: b = [{v:"CCCC"}], c = [{}].
  test("a simple query does not steal the rows of an in-flight prepare", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });

    const [a, b, c] = await Promise.all([
      sql`SELECT 'AAAA'::text AS v`.simple(),
      sql`SELECT ${"BBBB"}::text AS v`,
      sql`SELECT 'CCCC'::text AS v`.simple(),
    ]);

    expect({ a, b, c }).toEqual({
      a: [{ v: "AAAA" }],
      b: [{ v: "BBBB" }],
      c: [{ v: "CCCC" }],
    });
  });

  // sql.unsafe(text) with no parameters routes through the same simple ('Q')
  // protocol, so the same misattribution happens without the caller ever
  // opting into simple mode.
  test("unsafe() with no parameters does not steal the rows of an in-flight prepare", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });

    const [a, b, c] = await Promise.all([
      sql.unsafe(`SELECT 'AAAA'::text AS v`),
      sql.unsafe(`SELECT $1::text AS v`, ["BBBB"]),
      sql.unsafe(`SELECT 'CCCC'::text AS v`),
    ]);

    expect({ a, b, c }).toEqual({
      a: [{ v: "AAAA" }],
      b: [{ v: "BBBB" }],
      c: [{ v: "CCCC" }],
    });
  });

  // Same root, different symptom: when the third query needs its own Parse, the
  // spurious ReadyForQuery also clears the waiting-to-prepare state, so C's
  // Parse+Describe is pipelined inside B's. C's describe reply is then consumed
  // under B, C's statement never leaves the Parsing state, and C never settles.
  test("a second prepare queued behind an in-flight prepare still settles", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });

    const [a, b, c] = await Promise.all([
      sql`SELECT 'AAAA'::text AS v`.simple(),
      sql`SELECT ${"BBBB"}::text AS v`,
      sql`SELECT ${"CCCC"}::text AS x`,
    ]);

    expect({ a, b, c }).toEqual({
      a: [{ v: "AAAA" }],
      b: [{ v: "BBBB" }],
      c: [{ x: "CCCC" }],
    });
  });

  // The length of a frame counts a terminator. A text that ends in NUL got none, so the
  // next byte of the stream completed the frame and the rest of it broke the connection.
  describe("a text that ends in NUL is rejected and the connection stays usable", () => {
    const cases: [string, { prepare?: boolean }, (sql: SQL) => Promise<unknown>][] = [
      ["sql.unsafe(text)", {}, sql => sql.unsafe("select 1 as x\0")],
      ["sql.unsafe(text, [parameter])", {}, sql => sql.unsafe("select $1::int as x\0", [1])],
      ["a tagged template", {}, sql => sql`select ${1}::int as x\0`],
      ["a tagged template, prepare: false", { prepare: false }, sql => sql`select ${1}::int as x\0`],
    ];
    test.each(cases)("%s", async (_, options, statement) => {
      await container.ready;
      await using sql = new SQL({ url: url(), max: 1, ...options });
      const session = async () => (await sql`select pg_backend_pid() as pid`)[0].pid;

      const before = await session();
      const errno = await statement(sql).then(
        () => "resolved",
        err => err.errno,
      );
      const next = await session().then(
        pid => (pid === before ? "ran in the same session" : "ran in another session"),
        err => err.code,
      );

      expect({ errno, next }).toEqual({ errno: "08P01", next: "ran in the same session" });
    });
  });

  describe.concurrent("after a simple query the server still ends an idle session", () => {
    const ended = "ended by the server";

    // Resolves once the server has ended the backend `pid`, or has left it in
    // one state for 2 seconds by its own clock. No limit below is over 500 ms.
    async function sessionOutcome(watch: SQL, pid: number): Promise<string> {
      while (true) {
        // pg_sleep runs only while the backend is there. It paces the poll.
        const [session] = await watch`
          select state, clock_timestamp() - state_change > interval '2 seconds' as overdue, pg_sleep(0.01)
          from pg_stat_activity where pid = ${pid}`;
        if (!session) return ended;
        if (session.overdue) return session.state;
      }
    }

    // `run` calls `idle` where it waits. `session` stays undefined if `run` never gets there.
    type Run = (sql: SQL, idle: () => Promise<void>) => Promise<unknown>;
    async function idleOutcome(run: Run) {
      // A slow client can lose its session before it gets to the wait. That run proves nothing, so it runs again.
      let outcome = await attempt(run);
      for (let again = 0; outcome.session === undefined && again < 2; again++) outcome = await attempt(run);
      return outcome;
    }
    async function attempt(run: Run) {
      await container.ready;
      const closed = Promise.withResolvers<void>();
      let closeError: unknown = "the connection is open";
      await using watch = new SQL({ url: url(), max: 1 });
      await using sql = new SQL({
        url: url(),
        max: 1,
        onclose(err) {
          closeError = err;
          closed.resolve();
        },
      });
      const [{ pid }] = await sql`select pg_backend_pid() as pid`;

      let session: string | undefined;
      let waiting: Promise<void> | undefined;
      const idle = () =>
        (waiting ??= (async () => {
          session = await sessionOutcome(watch, pid);
          // What follows the wait runs on a client that has seen the end of the session too.
          if (session === ended) await closed.promise;
        })());
      const settled = await run(sql, idle).then(
        () => "resolved",
        err => (err === closeError ? "rejected with the error that closed the connection" : err),
      );
      // begin() rejects when the client sees the end of its session. `idle` can still be waiting then.
      await waiting;
      return { session, run: settled };
    }

    // The server applies a limit from the ReadyForQuery of the statement that sets it, so a case
    // sets the limit with the statement it waits after where it can. BEGIN, SAVEPOINT and a failed
    // statement cannot set it. Those cases take a limit for the whole session, which does not apply
    // outside a transaction. It is 500 ms, so that a debug build sends its next statement in time.
    const limitTransactions = (sql: SQL) => sql`select set_config('idle_in_transaction_session_timeout', '500', false)`;
    // The state of the session after it: idle in transaction (aborted).
    const divisionByZero = (tx: { unsafe(text: string): Promise<unknown> }) =>
      tx.unsafe("select 1/0").then(
        () => Promise.reject(new Error("select 1/0 did not fail")),
        err => (err.errno === "22012" ? undefined : Promise.reject(err)),
      );
    const inTransaction: [string, Run][] = [
      ["the BEGIN of sql.begin()", (sql, idle) => limitTransactions(sql).then(() => sql.begin(idle))],
      [
        "tx.unsafe(text) with no parameters",
        (sql, idle) => sql.begin(tx => tx.unsafe("set idle_in_transaction_session_timeout = 50").then(idle)),
      ],
      [
        "a tx.unsafe(text) that fails",
        (sql, idle) => limitTransactions(sql).then(() => sql.begin(tx => divisionByZero(tx).then(idle))),
      ],
      [
        "a .simple() query",
        (sql, idle) => sql.begin(tx => tx`set idle_in_transaction_session_timeout = 50`.simple().then(idle)),
      ],
      [
        "the SAVEPOINT of tx.savepoint()",
        (sql, idle) => limitTransactions(sql).then(() => sql.begin(tx => tx.savepoint(idle))),
      ],
    ];
    test.each(inTransaction)("idle_in_transaction_session_timeout, idle after %s", async (_, run) => {
      expect(await idleOutcome(run)).toEqual({
        session: ended,
        run: "rejected with the error that closed the connection",
      });
    });

    // Outside a transaction the limit is idle_session_timeout. begin() rejects if its session ends
    // before the client has read the reply to COMMIT, so that case gets 500 ms too.
    const outsideTransaction: [string, Run][] = [
      ["sql.unsafe(text) with no parameters", (sql, idle) => sql.unsafe("set idle_session_timeout = 50").then(idle)],
      ["a .simple() query", (sql, idle) => sql`set idle_session_timeout = 50`.simple().then(idle)],
      [
        "reserved.unsafe(text)",
        async (sql, idle) => {
          await using reserved = await sql.reserve();
          await reserved.unsafe("set idle_session_timeout = 50").then(idle);
        },
      ],
      [
        "the COMMIT of sql.begin()",
        (sql, idle) => sql.begin(tx => tx`select set_config('idle_session_timeout', '500', false)`).then(idle),
      ],
    ];
    test.each(outsideTransaction)("idle_session_timeout, idle after %s", async (_, run) => {
      expect(await idleOutcome(run)).toEqual({ session: ended, run: "resolved" });
    });
  });
});
