// A DataRow can be framed correctly and still hold a value this client cannot
// turn into a JS value: a binary int4[] with two dimensions, a text array with
// explicit bounds, and so on. That is the failure of the query that asked for
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

/** One entry per query, in order: its rows, or the error it rejected with. */
async function settle(queries: PromiseLike<any>[]) {
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
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      idleTimeout: 30,
    });

  test("a pipelined query with a row the client cannot decode rejects alone", async () => {
    await container.ready;
    await using sql = connect();
    // One statement text. After this first run it is prepared, so the four
    // executions below are all written before the first reply arrives.
    const rows = (list: string) => sql`select x::int4[] as v, 'tail' as t from unnest(string_to_array(${list}, ';')) x`;
    await rows("{0}");
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;

    // int4[] arrives in binary, and the binary decoder refuses two dimensions.
    // The bad cell is in the first row and has a cell after it. The row after
    // it belongs to the same query and is dropped with it.
    expect(await settle([rows("{1}"), rows("{{1,2},{3,4}};{5}"), rows("{6};{7}"), rows("{8}")])).toEqual([
      [{ v: new Int32Array([1]), t: "tail" }],
      undecodable("ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET"),
      [
        { v: new Int32Array([6]), t: "tail" },
        { v: new Int32Array([7]), t: "tail" },
      ],
      [{ v: new Int32Array([8]), t: "tail" }],
    ]);
    expect([...(await sql`select pg_backend_pid() as pid`)]).toEqual([{ pid }]);
  });

  test("a simple query with a row the client cannot decode rejects alone", async () => {
    await container.ready;
    await using sql = connect();
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;

    // The text array decoder refuses explicit bounds. The failing row is in the
    // second of three result sets, after a result set that was already delivered.
    expect(
      await settle([
        sql`select 'A' as v`.simple(),
        sql`select 'B' as v; select v::int4[] as v, 'tail' as t from (values ('{1}'), ('[0:1]={2,3}'), ('{4}')) t(v); select 'C' as v`.simple(),
        sql`select 'D' as v`.simple(),
      ]),
    ).toEqual([[{ v: "A" }], undecodable("ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT"), [{ v: "D" }]]);
    expect([...(await sql`select pg_backend_pid() as pid`)]).toEqual([{ pid }]);
  });

  test("the rest of a rejected query's rows arrives in later reads", async () => {
    await container.ready;
    await using sql = connect();
    // The first row is the parameter. Each further row is about 2 KB in binary.
    const rows = (first: string, count: number) =>
      sql`select case when i = 1 then ${first}::int4[] else array_fill(7, array[250]) end as v from generate_series(1, ${count}::int) i`;
    await rows("{0}", 1);
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;

    // 600 rows are more than one socket read holds, so the rejection is seen
    // while the server still sends the rest: `next` is pending at that point.
    // execute() sends a query at once, so these three are pipelined in this order.
    const first = rows("{1}", 1).execute();
    let rejected: PromiseLike<any> | null = rows("{{1,2},{3,4}}", 600).execute();
    const next = rows("{2}", 2).execute();
    let unprepared!: PromiseLike<any>;
    const rejection = rejected.then(undefined, (err: Error) => {
      // Nothing refers to the rejected query now, so its wrapper can go while its rows still arrive.
      Bun.gc(true);
      const nextStatus = Bun.peek.status(next as unknown as Promise<unknown>);
      // Not prepared yet, so it cannot be pipelined: the connection walks its request queue here.
      unprepared = sql`select ${"late"}::text as v`.execute();
      return { ...describeError(err), nextStatus };
    });
    rejected = null;

    expect(await rejection).toEqual({
      ...undecodable("ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET"),
      nextStatus: "pending",
    });
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
    expect(await settle([first, next, unprepared])).toEqual([
      [{ v: new Int32Array([1]) }],
      [{ v: new Int32Array([2]) }, { v: new Int32Array(250).fill(7) }],
      [{ v: "late" }],
    ]);
    expect([...(await sql`select pg_backend_pid() as pid`)]).toEqual([{ pid }]);
  });

  test("a wide row with a cell the client cannot decode rejects alone", async () => {
    await container.ready;
    await using sql = connect();
    // 70 columns do not fit the inline cell buffer of the row decoder. The int4[] is in the middle.
    const names = Array.from({ length: 70 }, (_, i) => "c" + i);
    const text = "select " + names.map((name, i) => (i === 35 ? "$1::int4[]" : i) + " as " + name).join(", ");
    const wide = (array: string) => sql.unsafe(text, [array]);
    const row = (array: Int32Array) => Object.fromEntries(names.map((name, i) => [name, i === 35 ? array : i]));
    await wide("{0}");

    expect(await settle([wide("{1}"), wide("{{1,2},{3,4}}"), wide("{2}")])).toEqual([
      [row(new Int32Array([1]))],
      undecodable("ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET"),
      [row(new Int32Array([2]))],
    ]);
  });

  test("a rejected INSERT ... RETURNING is stored", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table row_decode_error (v int4[])`;
    const insert = (array: string) =>
      sql`insert into row_decode_error (v) values (${array}::int4[]) returning v, 'tail' as t`;
    await insert("{0}");

    expect(await settle([insert("{1}"), insert("{{1,2},{3,4}}"), insert("{2}")])).toEqual([
      [{ v: new Int32Array([1]), t: "tail" }],
      undecodable("ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET"),
      [{ v: new Int32Array([2]), t: "tail" }],
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
  "text[] with explicit bounds": {
    typeOid: 1009,
    cell: (piece: string) => (piece === "bad" ? "[0:1]={a,b}" : `{${piece}}`),
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
