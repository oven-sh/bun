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
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgBindParameters,
  pgCommandComplete,
  pgDataRow,
  pgParameterDescription,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

/** One entry per query, in order: its rows, or the error it rejected with. */
async function settle(queries: PromiseLike<any>[]) {
  return (await Promise.allSettled(queries)).map(result =>
    result.status === "fulfilled"
      ? [...result.value]
      : { name: result.reason.name, code: result.reason.code, message: result.reason.message },
  );
}

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
    const rows = (list: string) => sql`select x::int4[] as v from unnest(string_to_array(${list}, ';')) x`;
    await rows("{0}");
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;

    // int4[] arrives in binary, and the binary decoder refuses two dimensions.
    // The row after it belongs to the same query and is dropped with it.
    expect(await settle([rows("{1}"), rows("{2};{{1,2},{3,4}};{5}"), rows("{6};{7}"), rows("{8}")])).toEqual([
      [{ v: new Int32Array([1]) }],
      {
        name: "PostgresError",
        code: "ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET",
        message: "Failed to read data",
      },
      [{ v: new Int32Array([6]) }, { v: new Int32Array([7]) }],
      [{ v: new Int32Array([8]) }],
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
        sql`select 'B' as v; select v::int4[] from (values ('{1}'), ('[0:1]={2,3}'), ('{4}')) t(v); select 'C' as v`.simple(),
        sql`select 'D' as v`.simple(),
      ]),
    ).toEqual([
      [{ v: "A" }],
      { name: "PostgresError", code: "ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT", message: "Failed to read data" },
      [{ v: "D" }],
    ]);
    expect([...(await sql`select pg_backend_pid() as pid`)]).toEqual([{ pid }]);
  });
});

// Fault-injection tests: a healthy server validates json on input, so it never
// sends a jsonb column that is not JSON, and it does not stop in the middle of a
// response on demand. DO NOT COPY THIS PATTERN: anything a real server can
// produce belongs in describeWithContainer. All wire-protocol bytes come from
// test/js/sql/wire-frames.ts.
//
// The mock speaks the extended protocol for one statement shape, `select
// $1::jsonb as v`. It answers an Execute with one DataRow per ';'-separated
// piece of the bound text. The piece "hold" sends no row: the mock keeps back
// everything after it, for every query, until `release()`.
async function jsonbEchoServer() {
  let connections = 0;
  let release = () => {};
  const { port, server } = await listeningServer(socket => {
    connections++;
    let buffered = Buffer.alloc(0);
    let startup = true;
    let bound: string[] = [];
    let held: Buffer[] | undefined;
    const send = (...frames: Buffer[]) => {
      if (held) held.push(...frames);
      else socket.write(Buffer.concat(frames));
    };
    release = () => {
      if (!held) return;
      socket.write(Buffer.concat(held));
      held = undefined;
    };
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (startup) {
        if (buffered.length < 4 || buffered.length < buffered.readInt32BE(0)) return;
        buffered = buffered.subarray(buffered.readInt32BE(0));
        startup = false;
        send(pgAuthenticationOk(), pgReadyForQuery());
      }
      buffered = pgReadFrontendMessages(buffered, (type, body) => {
        switch (String.fromCharCode(type)) {
          case "P":
            return send(pgParseComplete());
          case "D":
            return send(pgParameterDescription([25 /* text */]), pgRowDescription([{ name: "v", typeOid: 3802 }]));
          case "B":
            bound = pgBindParameters(body)[0]!.toString().split(";");
            return send(pgBindComplete());
          case "E":
            for (const piece of bound) {
              if (piece === "hold") held ??= [];
              else send(pgDataRow([Buffer.from(piece)]));
            }
            return send(pgCommandComplete("SELECT " + bound.length));
          case "S":
            return send(pgReadyForQuery());
          case "X":
            return socket.end();
        }
      });
    });
  });
  return { port, server, release: () => release(), connections: () => connections };
}

describe.concurrent("postgres mock", () => {
  test("a pipelined query with a jsonb column that is not JSON rejects alone", async () => {
    const mock = await jsonbEchoServer();
    try {
      await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
      const echo = (text: string) => sql`select ${text}::jsonb as v`;
      await echo("0");

      const results = await settle([echo('{"a":1}'), echo("1;not json;2"), echo('{"b":2}'), echo("3")]);
      results.push([...(await echo("4"))]);
      expect({ results, connections: mock.connections() }).toEqual({
        results: [
          [{ v: { a: 1 } }],
          { name: "SyntaxError", message: 'JSON Parse error: Unexpected identifier "not"' },
          [{ v: { b: 2 } }],
          [{ v: 3 }],
          [{ v: 4 }],
        ],
        connections: 1,
      });
    } finally {
      mock.server.close();
    }
  });

  test("rows that arrive after the rejection stay with the rejected query", async () => {
    const mock = await jsonbEchoServer();
    try {
      await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
      const echo = (text: string) => sql`select ${text}::jsonb as v`;
      await echo("0");

      // execute() sends a query at once, so these three are pipelined in this order.
      const first = echo("1").execute();
      const undecodable = echo("2;not json;hold;3").execute();
      const next = echo("4").execute();
      // `undecodable` rejects while the server still holds the rest of its
      // response: a row, its CommandComplete and its ReadyForQuery. A statement
      // that is not prepared yet cannot be pipelined, so this enqueue makes the
      // connection walk its request queue at exactly that point. The held row
      // must not go to `next`, which is the request behind the rejected one.
      let unprepared!: PromiseLike<any>;
      const rejection = await undecodable.catch((err: Error) => {
        unprepared = sql`select ${"5"}::jsonb as v -- not prepared yet`.execute();
        mock.release();
        return err.message;
      });

      expect({
        rejection,
        results: await settle([first, next, unprepared]),
        connections: mock.connections(),
      }).toEqual({
        rejection: 'JSON Parse error: Unexpected identifier "not"',
        results: [[{ v: 1 }], [{ v: 4 }], [{ v: 5 }]],
        connections: 1,
      });
    } finally {
      mock.server.close();
    }
  });
});
