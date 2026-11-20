// A DataRow can be framed correctly and still hold a value this client cannot
// turn into a JS value: a bytea in the `escape` output format, a jsonb that is
// not JSON, and so on. That is the failure of the query that asked for
// the value. The connection treated it as its own failure: it closed the socket
// and rejected every other query on it with the first query's error. With
// pipelining the server had already executed those other queries, so the
// application was told that a statement failed which in fact ran.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  pgBindComplete,
  pgBindParameters,
  pgCommandComplete,
  pgDataRow,
  pgHold,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

type Rejection = { name: string; code?: string; message: string; hint?: string };
/** One entry per query, in order: its rows, or the error it rejected with. */
async function settle(queries: PromiseLike<any>[]): Promise<(any[] | Rejection)[]> {
  return (await Promise.allSettled(queries)).map(result =>
    result.status === "fulfilled" ? [...result.value] : describeError(result.reason),
  );
}
const describeError = (err: any) => ({ name: err.name, code: err.code, message: err.message, hint: err.hint });

// The rejected query may be an INSERT that the server stored, so the error says
// that only the decoding failed.
const undecodable = (code: string) => ({
  name: "PostgresError",
  code,
  message: "Failed to read data",
  hint: "The query may have run on the server. The client could not decode a value in its result. Cast that column to text, or use .raw().",
});

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  // An array arrives as text, and the client decodes only the `hex` form of a bytea.
  // So with this setting a bytea[] decodes when it is empty or holds only NULLs.
  const connect = async () => {
    const sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      idleTimeout: 30,
    });
    await sql`set bytea_output = 'escape'`;
    return sql;
  };
  const bad = '{"a b"}';
  const rejection = undecodable("ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT");

  test("a pipelined query with a row the client cannot decode rejects alone", async () => {
    await container.ready;
    await using sql = await connect();
    // One statement text. After this first run it is prepared, so the four
    // executions below are all written before the first reply arrives.
    const rows = (list: string) =>
      sql`select x::bytea[] as v, 'tail' as t from unnest(string_to_array(${list}, ';')) x`;
    await rows("{}");
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;

    // The bad cell is in the first row and has a cell after it. The row after
    // it belongs to the same query and is dropped with it.
    expect(await settle([rows("{NULL}"), rows(bad + ";{NULL}"), rows("{};{NULL,NULL}"), rows("{}")])).toEqual([
      [{ v: [null], t: "tail" }],
      rejection,
      [
        { v: [], t: "tail" },
        { v: [null, null], t: "tail" },
      ],
      [{ v: [], t: "tail" }],
    ]);
    expect([...(await sql`select pg_backend_pid() as pid`)]).toEqual([{ pid }]);
  });

  test("a simple query with a row the client cannot decode rejects alone", async () => {
    await container.ready;
    await using sql = await connect();
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;

    // The failing row is in the second of three result sets, after a result set
    // that was already delivered.
    expect(
      await settle([
        sql`select 'A' as v`.simple(),
        sql`select 'B' as v; select v::bytea[] as v, 'tail' as t from (values ('{NULL}'), ('{"a b"}'), ('{}')) t(v); select 'C' as v`.simple(),
        sql`select 'D' as v`.simple(),
      ]),
    ).toEqual([[{ v: "A" }], rejection, [{ v: "D" }]]);
    expect([...(await sql`select pg_backend_pid() as pid`)]).toEqual([{ pid }]);
  });

  // The server quotes an element only where it has to: these arrive as {abc}, {t} and {123}.
  test.each(["abc", "t", "123"])(
    "an element of a bytea[] without quotes is no boolean and no number: %s",
    async text => {
      await container.ready;
      await using sql = await connect();
      expect(await settle([sql.unsafe(`select array['${text}'::bytea] as v`)])).toEqual([rejection]);
    },
  );

  test("the rest of a rejected query's rows arrives in later reads", async () => {
    await container.ready;
    await using sql = await connect();
    // The first row is the parameter. Each further row is about 2 KB.
    const rows = (first: string, count: number) =>
      sql`select case when i = 1 then ${first}::bytea[] else array_fill(null::bytea, array[400]) end as v from generate_series(1, ${count}::int) i`;
    await rows("{}", 1);
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;

    // 600 rows are more than one socket read holds, so the rejection is seen
    // while the server still sends the rest: `next` is pending at that point.
    // execute() sends a query at once, so these three are pipelined in this order.
    const first = rows("{NULL}", 1).execute();
    let rejected: PromiseLike<any> | null = rows(bad, 600).execute();
    const next = rows("{}", 2).execute();
    let unprepared!: PromiseLike<any>;
    const seen = rejected.then(undefined, (err: Error) => {
      // Nothing refers to the rejected query now, so its wrapper can go while its rows still arrive.
      Bun.gc(true);
      const nextStatus = Bun.peek.status(next as unknown as Promise<unknown>);
      // Not prepared yet, so it cannot be pipelined: the connection walks its request queue here.
      unprepared = sql`select ${"late"}::text as v`.execute();
      return { ...describeError(err), nextStatus };
    });
    rejected = null;

    expect(await seen).toEqual({ ...rejection, nextStatus: "pending" });
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
    expect(await settle([first, next, unprepared])).toEqual([
      [{ v: [null] }],
      [{ v: [] }, { v: Array(400).fill(null) }],
      [{ v: "late" }],
    ]);
    expect([...(await sql`select pg_backend_pid() as pid`)]).toEqual([{ pid }]);
  });

  test("a wide row with a cell the client cannot decode rejects alone", async () => {
    await container.ready;
    await using sql = await connect();
    // 70 columns do not fit the inline cell buffer of the row decoder. The bytea[] is in the middle.
    const names = Array.from({ length: 70 }, (_, i) => "c" + i);
    const text = "select " + names.map((name, i) => (i === 35 ? "$1::bytea[]" : i) + " as " + name).join(", ");
    const wide = (array: string) => sql.unsafe(text, [array]);
    const row = (array: null[]) => Object.fromEntries(names.map((name, i) => [name, i === 35 ? array : i]));
    await wide("{}");

    expect(await settle([wide("{NULL}"), wide(bad), wide("{NULL,NULL}")])).toEqual([
      [row([null])],
      rejection,
      [row([null, null])],
    ]);
  });

  test("a rejected INSERT ... RETURNING is stored", async () => {
    await container.ready;
    await using sql = await connect();
    await sql`create temp table row_decode_error (v bytea[])`;
    const insert = (array: string) =>
      sql`insert into row_decode_error (v) values (${array}::bytea[]) returning v, 'tail' as t`;
    await insert("{}");

    expect(await settle([insert("{NULL}"), insert(bad), insert("{NULL,NULL}")])).toEqual([
      [{ v: [null], t: "tail" }],
      rejection,
      [{ v: [null, null], t: "tail" }],
    ]);
    // The hint is about this: the server stored all four rows.
    expect([...(await sql`select count(*)::int as stored from row_decode_error`)]).toEqual([{ stored: 4 }]);
  });
});

// Fault-injection tests: a healthy server validates json on input, so it never
// sends a jsonb column that is not JSON, and it does not stop in the middle of a
// response on demand. DO NOT COPY THIS PATTERN: anything a real server can
// produce belongs in describeWithContainer. All wire-protocol bytes come from
// test/js/sql/wire-frames.ts.
//
// The mock speaks the extended protocol for one statement shape, `select $1 as
// v`. It answers an Execute with one DataRow per ';'-separated piece of the
// bound text. The piece "bad" becomes the cell the client cannot decode. The
// piece "hold" sends no row: the mock keeps back everything after it, for every
// query, until `release()`.
//
// The two column kinds fail in the two places a row can fail: a text[] cell is
// decoded while the DataRow is read, a jsonb cell when the row becomes a JS object.
const columnKinds = {
  "text[] that does not end": {
    typeOid: 1009,
    cell: (piece: string) => (piece === "bad" ? "{a,b" : `{${piece}}`),
    value: (piece: string): unknown => [piece],
    rejection: undecodable("ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT"),
  },
  "jsonb that is not JSON": {
    typeOid: 3802,
    cell: (piece: string) => (piece === "bad" ? "not json" : piece),
    value: (piece: string): unknown => JSON.parse(piece),
    rejection: { name: "SyntaxError", message: 'JSON Parse error: Unexpected identifier "not"' },
  },
};
type ColumnKind = (typeof columnKinds)[keyof typeof columnKinds];

async function echoServer(kind: ColumnKind) {
  const bound = new WeakMap<object, string[]>();
  let connections = 0;
  const mock = await pgMockServer((type, body, socket) => {
    switch (type) {
      case "P":
        return pgParseComplete();
      case "D":
        return [pgParameterDescription([25 /* text */]), pgRowDescription([{ name: "v", typeOid: kind.typeOid }])];
      case "B":
        bound.set(socket, pgBindParameters(body)[0]!.toString().split(";"));
        return pgBindComplete();
      case "E": {
        const pieces = bound.get(socket)!;
        const rows = pieces.map(piece => (piece === "hold" ? pgHold : pgDataRow([Buffer.from(kind.cell(piece))])));
        return [...rows, pgCommandComplete("SELECT " + pieces.length)];
      }
      case "S":
        return pgReadyForQuery();
      case "X":
        socket.end();
    }
  });
  mock.server.on("connection", () => connections++);
  return { ...mock, connections: () => connections };
}

for (const [name, kind] of Object.entries(columnKinds)) {
  describe.concurrent("postgres mock, " + name, () => {
    const row = (piece: string) => ({ v: kind.value(piece) });

    test("a pipelined query with a row the client cannot decode rejects alone", async () => {
      const mock = await echoServer(kind);
      try {
        await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
        const echo = (text: string) => sql`select ${text} as v`;
        await echo("0");

        const results = await settle([echo("1"), echo("2;bad;3"), echo("4;5"), echo("6")]);
        results.push([...(await echo("7"))]);
        expect({ results, connections: mock.connections() }).toEqual({
          results: [[row("1")], kind.rejection, [row("4"), row("5")], [row("6")], [row("7")]],
          connections: 1,
        });
      } finally {
        mock.server.close();
      }
    });

    test("rows that arrive after the rejection stay with the rejected query", async () => {
      const mock = await echoServer(kind);
      try {
        await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
        const echo = (text: string) => sql`select ${text} as v`;
        await echo("0");

        // execute() sends a query at once, so these three are pipelined in this order.
        const first = echo("1").execute();
        const rejected = echo("2;bad;hold;3").execute();
        const next = echo("4").execute();
        // `rejected` rejects while the server still holds the rest of its
        // response: a row, its CommandComplete and its ReadyForQuery. A statement
        // that is not prepared yet cannot be pipelined, so this enqueue makes the
        // connection walk its request queue at exactly that point. The held row
        // must not go to `next`, which is the request behind the rejected one.
        let unprepared!: PromiseLike<any>;
        const rejection = await rejected.catch((err: Error) => {
          unprepared = sql`select ${"5"} as v -- not prepared yet`.execute();
          mock.release();
          return describeError(err);
        });

        expect({
          rejection,
          results: await settle([first, next, unprepared]),
          connections: mock.connections(),
        }).toEqual({
          rejection: kind.rejection,
          results: [[row("1")], [row("4")], [row("5")]],
          connections: 1,
        });
      } finally {
        mock.server.close();
      }
    });
  });
}
