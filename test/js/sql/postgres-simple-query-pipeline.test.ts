// A simple-protocol Query ('Q') is its own sync point: the backend answers it
// with exactly one ReadyForQuery. Bun also appended an extended-protocol Sync
// after every 'Q', so the server replied with a second, unaccounted
// ReadyForQuery per simple query. That spurious ReadyForQuery re-armed the
// connection's "ready" state while the next query's Parse+Describe round trip
// was still in flight, and advance() then pipelined a third query into that
// window, so its replies were delivered to the wrong query.
//
// The simple protocol is used for query.simple(), for sql.unsafe(text) with
// no parameters, and for the BEGIN/COMMIT/ROLLBACK of sql.begin(), so every
// one of those emitted the spurious ReadyForQuery.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

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
});
