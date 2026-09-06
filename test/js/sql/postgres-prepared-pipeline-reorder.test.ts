// The enqueue-time fast path for an already-prepared statement wrote
// Bind+Execute whenever can_pipeline() was true. can_pipeline() only looked at
// WAITING_TO_PREPARE / backpressure / nonpipelinable counts, none of which are
// set for a request that was queued but whose bytes have not been emitted yet
// (a new statement text enqueued while another query is in flight). A later
// query reusing a prepared statement would therefore write its Bind+Execute
// ahead of that queued request, while reply attribution stays FIFO over the
// request queue: the queued request is silently fulfilled with the next
// query's rows (decoded under an empty column list), and the next query never
// settles, wedging the connection.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  // Before the fix: B's Parse is never sent. C's Bind+Execute is written
  // immediately after A's, so C's row is delivered to B (as [{}]) and C hangs
  // forever along with every later query on the connection.
  test("a prepared-statement execute does not jump a queued unwritten prepare", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    await sql`SELECT ${"warm"}::text AS v`; // SELECT $1::text AS v is now prepared

    const a = sql`SELECT ${"A"}::text AS v`;
    const b = sql`SELECT ${"B"}::text AS v, ${1}::int AS w`;
    const c = sql`SELECT ${"C"}::text AS v`;
    const after = sql`SELECT ${"after"}::text AS v`;

    expect(await Promise.all([a, b, c, after])).toEqual([
      [{ v: "A" }],
      [{ v: "B", w: 1 }],
      [{ v: "C" }],
      [{ v: "after" }],
    ]);
  });

  // Same shape with two distinct new statement texts queued between two
  // prepared-statement executes.
  test("prepared executes do not jump multiple queued unwritten prepares", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    await sql`SELECT ${"warm"}::text AS v`;

    const a = sql`SELECT ${"A"}::text AS v`;
    const b1 = sql`SELECT ${"B1"}::text AS v, ${1}::int AS w`;
    const b2 = sql`SELECT ${"B2"}::text AS v, ${2}::int AS w, ${3}::int AS x`;
    const c = sql`SELECT ${"C"}::text AS v`;

    expect(await Promise.all([a, b1, b2, c])).toEqual([
      [{ v: "A" }],
      [{ v: "B1", w: 1 }],
      [{ v: "B2", w: 2, x: 3 }],
      [{ v: "C" }],
    ]);
  });

  // Larger mixed burst: interleave reuses of one prepared statement with many
  // distinct new statement texts so the enqueue-time gate and advance()'s
  // pending bookkeeping are exercised across a longer queue.
  test("mixed burst of prepared and new statements returns every row in order", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    await sql`SELECT ${"warm"}::text AS v`;

    const queries: Promise<any>[] = [];
    const expected: any[] = [];
    for (let i = 0; i < 20; i++) {
      if (i % 3 === 1) {
        queries.push(sql.unsafe(`SELECT $1::text AS v, ${i}::int AS k${i}`, [String(i)]));
        expected.push([{ v: String(i), [`k${i}`]: i }]);
      } else {
        queries.push(sql`SELECT ${String(i)}::text AS v`);
        expected.push([{ v: String(i) }]);
      }
    }

    expect(await Promise.all(queries)).toEqual(expected);
  });

  // Sibling: a simple-protocol query queued while a prepared execute is in
  // flight also sits Pending without bumping nonpipelinable_requests, so the
  // same fast path would jump it.
  test("a prepared-statement execute does not jump a queued unwritten simple query", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    await sql`SELECT ${"warm"}::text AS v`;

    const a = sql`SELECT ${"A"}::text AS v`;
    const b = sql`SELECT 'B'::text AS v`.simple();
    const c = sql`SELECT ${"C"}::text AS v`;

    expect(await Promise.all([a, b, c])).toEqual([[{ v: "A" }], [{ v: "B" }], [{ v: "C" }]]);
  });
});
