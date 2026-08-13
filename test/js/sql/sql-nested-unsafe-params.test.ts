// A sql.unsafe(text, params) fragment numbers its placeholders from $1, as if it
// ran on its own. When it is spliced into a tagged template its values are
// appended after whatever the enclosing query bound before it, so on postgres
// every $k in its text has to move up by that many. It used to be spliced in
// verbatim: `owner = ${7} and ${sql.unsafe("id = $1", [99])}` was sent as
// `owner = $1 and id = $1` with [7, 99] bound, i.e. it compared id against the
// owner and never used 99 at all (and failed outright for text parameters,
// whose type postgres cannot infer when nothing references them).
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      idleTimeout: 5,
      connectionTimeout: 5,
    });

  test("fragment spliced after an outer parameter binds its own values", async () => {
    await container.ready;
    await using sql = connect();

    const rows = await sql`
      select owner, id
      from (values (7, 7), (7, 99), (8, 99)) as docs(owner, id)
      where owner = ${7} and ${sql.unsafe("id = $1", [99])}
    `;
    expect(rows).toEqual([{ owner: 7, id: 99 }]);
  });

  test("text parameters of a spliced fragment are referenced, so postgres can type them", async () => {
    await container.ready;
    await using sql = connect();

    const rows = await sql`
      select owner, id
      from (values ('7', '7'), ('7', '99'), ('8', '99')) as docs(owner, id)
      where owner = ${"7"} and ${sql.unsafe("id = $1", ["99"])}
    `;
    expect(rows).toEqual([{ owner: "7", id: "99" }]);
  });

  test("every reference moves, including repeated ones and ones followed by a cast", async () => {
    await container.ready;
    await using sql = connect();

    const rows = await sql`
      select ${1}::int as a, ${sql.unsafe("$2::int as b, $1::int as c, $1::int + $2::int as d", [10, 20])}, ${5}::int as e
    `;
    expect(rows).toEqual([{ a: 1, b: 20, c: 10, d: 30, e: 5 }]);
  });

  test("two fragments each bind their own values", async () => {
    await container.ready;
    await using sql = connect();

    const rows = await sql`
      select ${sql.unsafe("$1::int as a", [1])}, ${2}::int as b, ${sql.unsafe("$1::int as c", [3])}
    `;
    expect(rows).toEqual([{ a: 1, b: 2, c: 3 }]);
  });

  test("fragment nested inside a template fragment", async () => {
    await container.ready;
    await using sql = connect();

    const inner = sql`${sql.unsafe("$1::int as b", [2])}, ${3}::int as c`;
    const rows = await sql`select ${1}::int as a, ${inner}`;
    expect(rows).toEqual([{ a: 1, b: 2, c: 3 }]);
  });

  test("fragment built with the transaction's unsafe()", async () => {
    await container.ready;
    await using sql = connect();

    const rows = await sql.begin(tx => tx`select ${1}::int as a, ${tx.unsafe("$1::int as b", [2])}`);
    expect(rows).toEqual([{ a: 1, b: 2 }]);
  });

  test("a fragment without parameters is spliced verbatim", async () => {
    await container.ready;
    await using sql = connect();

    const rows = await sql`select ${1}::int as a, ${sql.unsafe("2 as b")}, ${3}::int as c`;
    expect(rows).toEqual([{ a: 1, b: 2, c: 3 }]);
  });

  test("$1 inside literals, quoted identifiers, comments and identifiers is left as written", async () => {
    await container.ready;
    await using sql = connect();

    const fragment = [
      "'$1' as lit",
      "E'it\\'s $1' as esc",
      "$q$ it's $1 $q$ as dq",
      '$1::text as "$1"',
      "5 as col$1",
      "-- don't rewrite: $1\n      $1::text as after_line_comment",
      // the server also ends a line comment at a bare carriage return
      "-- don't rewrite: $1\r$1::text as after_cr_comment",
      "/* don't /* nested $1 */ here */ $1::text as after_block_comment",
    ].join(",\n      ");

    const rows = await sql`select ${"outer"}::text as o, ${sql.unsafe(fragment, ["inner"])}`;
    expect(rows).toEqual([
      {
        o: "outer",
        lit: "$1",
        esc: "it's $1",
        dq: " it's $1 ",
        $1: "inner",
        col$1: 5,
        after_line_comment: "inner",
        after_cr_comment: "inner",
        after_block_comment: "inner",
      },
    ]);
  });
});

// Normalization runs when the query is first awaited, before a connection is
// attempted, so these never dial the (closed) port in the URL.
describe("postgres fragment referencing a parameter it was not given", () => {
  const cases: [name: string, query: (sql: SQL) => Promise<unknown>, message: string][] = [
    [
      "after an outer parameter",
      sql => sql`select ${1}::int as a, ${sql.unsafe("$2::int as b", [2])}`,
      "Nested sql.unsafe fragment references $2 but was given 1 parameter",
    ],
    [
      "ahead of an outer parameter it would otherwise alias",
      sql => sql`select ${sql.unsafe("$2::int as a", [1])}, ${2}::int as b`,
      "Nested sql.unsafe fragment references $2 but was given 1 parameter",
    ],
    [
      "$0",
      sql => sql`select ${1}::int as a, ${sql.unsafe("$0::int as b", [2, 3])}`,
      "Nested sql.unsafe fragment references $0 but was given 2 parameters",
    ],
  ];

  test.each(cases)("%s", async (_name, query, message) => {
    await using sql = new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 });
    const err = (await query(sql).catch(e => e)) as Error;
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err.message).toBe(message);
  });
});

describe("sqlite", () => {
  test("positional fragment parameters bind by position and need no rewriting", async () => {
    await using sql = new SQL("sqlite://:memory:");

    const rows = await sql`
      select owner, id
      from (select 7 as owner, 7 as id union all select 7, 99 union all select 8, 99)
      where owner = ${7} and ${sql.unsafe("id = ?", [99])}
    `;
    expect(rows).toEqual([{ owner: 7, id: 99 }]);
  });
});
