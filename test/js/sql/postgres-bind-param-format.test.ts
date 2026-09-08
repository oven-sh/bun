// The Bind message declares a format code (0 = text, 1 = binary) for every
// parameter and then carries the encoded values. Bun only has binary encoders
// for bool, int4, float8, timestamp(tz) and bytea. Every other parameter type
// the server reports (numeric, real, time, int4[], real[], ...) is sent as
// `String(value)` and must be declared as text so the server parses it.
//
// The mock-server tests pin the exact Bind bytes. The container tests run the
// same cases against a real Postgres with the default `prepare: true`, where
// Bun binds with the parameter types from the server's ParameterDescription.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  type PgBind,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgDecodeBind,
  pgMockServer,
  pgNoData,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// Stand-in for a decimal.js / big.js style value: not a string, but its text
// form is what should reach the server.
class Textual {
  constructor(public text: string) {}
  toString() {
    return this.text;
  }
}

/**
 * Mock backend for one prepared query. Describe is answered with the given
 * parameter OIDs and result columns, Execute with one `row`. Resolves with
 * every Bind the client sent and the rows it decoded.
 */
async function runAgainstMock(opts: {
  paramOids: number[];
  columns?: { name: string; typeOid: number }[];
  row?: (Buffer | null)[];
  query: (sql: SQL) => Promise<any>;
}): Promise<{ binds: PgBind[]; rows: any }> {
  const binds: PgBind[] = [];
  const columns = opts.columns ?? [];
  const { server, port } = await pgMockServer((type, body, socket) => {
    switch (type) {
      case "P":
        return pgParseComplete();
      case "D":
        return [pgParameterDescription(opts.paramOids), columns.length ? pgRowDescription(columns) : pgNoData()];
      case "B":
        binds.push(pgDecodeBind(body));
        return pgBindComplete();
      case "E":
        return opts.row ? [pgDataRow(opts.row), pgCommandComplete("SELECT 1")] : pgCommandComplete("SELECT 0");
      case "S":
        return pgReadyForQuery();
      case "X":
        socket.end();
        break;
    }
  });
  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1 });
    const rows = await opts.query(sql);
    return { binds, rows };
  } finally {
    server.close();
  }
}

describe("Bind format codes (mock server)", () => {
  test("parameters typed numeric, float4, time, int4[] and float4[] are declared and sent as text", async () => {
    const { binds } = await runAgainstMock({
      // numeric, float4, time, int4_array, float4_array
      paramOids: [1700, 700, 1083, 1007, 1021],
      query: sql =>
        sql.unsafe("select $1, $2, $3, $4, $5", [
          new Textual("19.99"),
          new Textual("1234"),
          new Textual("12:34:56"),
          sql.array([1, 2], "INT4"),
          sql.array([1.5], "REAL"),
        ]),
    });
    expect(binds).toHaveLength(1);
    expect({
      paramFormats: binds[0].paramFormats,
      params: binds[0].params.map(p => p?.toString("latin1")),
    }).toEqual({
      paramFormats: [0, 0, 0, 0, 0],
      params: ["19.99", "1234", "12:34:56", `{"1","2"}`, "{1.5}"],
    });
  });

  test("parameters with a binary encoder are declared binary, a string value stays text", async () => {
    const date = new Date("2000-01-01T00:00:01.000Z"); // 1_000_000 us after the Postgres epoch
    const { binds } = await runAgainstMock({
      // bool, int4, float8, timestamptz, bytea, int4 (bound from a string)
      paramOids: [16, 23, 701, 1184, 17, 23],
      query: sql => sql.unsafe("select $1, $2, $3, $4, $5, $6", [true, 7, 1.5, date, Buffer.from([1, 2]), "8"]),
    });
    expect(binds).toHaveLength(1);
    expect({ paramFormats: binds[0].paramFormats, params: binds[0].params }).toEqual({
      paramFormats: [1, 1, 1, 1, 1, 0],
      params: [
        Buffer.from([1]),
        Buffer.from([0, 0, 0, 7]),
        Buffer.from("3ff8000000000000", "hex"),
        Buffer.from("00000000000f4240", "hex"),
        Buffer.from([1, 2]),
        Buffer.from("8"),
      ],
    });
  });

  test("a result column whose OID is above 65535 is requested and decoded as text", async () => {
    // 65552 = 65536 + 16: a user-defined type whose low 16 bits alias `bool`.
    const { binds, rows } = await runAgainstMock({
      paramOids: [23],
      columns: [
        { name: "custom", typeOid: 65552 },
        { name: "n", typeOid: 23 },
      ],
      row: [Buffer.from("(42,t)"), Buffer.from([0, 0, 0, 9])],
      query: sql => sql`select custom, n from t where n = ${9}`,
    });
    expect(binds).toHaveLength(1);
    expect({ resultFormats: binds[0].resultFormats, row: rows[0] }).toEqual({
      resultFormats: [0, 1],
      row: { custom: "(42,t)", n: 9 },
    });
  });
});

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  test("object bound to a numeric, real or time column is sent as its text form", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table t (n numeric, r real, t time)`;

    const rows = await sql`
      insert into t (n, r, t)
      values (${new Textual("19.99")}, ${new Textual("1234")}, ${new Textual("12:34:56")})
      returning n::text as n, r::text as r, t::text as t`;
    expect(rows[0]).toEqual({ n: "19.99", r: "1234", t: "12:34:56" });
  });

  test("object bound to a $1::numeric / $1::real cast is sent as its text form", async () => {
    await container.ready;
    await using sql = connect();
    const rows = await sql`select ${new Textual("0.1")}::numeric::text as n, ${new Textual("2.5")}::real::text as r`;
    expect(rows[0]).toEqual({ n: "0.1", r: "2.5" });
  });

  test("sql.array() in the sql(object) helper works for int4[] and real[] columns", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table t (id int4, ia int4[], ra real[])`;

    const inserted = await sql`
      insert into t ${sql({ id: 1, ia: sql.array([1, 2, 3], "INT4"), ra: sql.array([1.5, 2.5], "REAL") })}
      returning ia::text as ia, ra::text as ra`;
    expect(inserted[0]).toEqual({ ia: "{1,2,3}", ra: "{1.5,2.5}" });

    const updated = await sql`
      update t set ${sql({ ia: sql.array([4], "INT4"), ra: sql.array([0.25], "REAL") })}
      where id = 1
      returning ia::text as ia, ra::text as ra`;
    expect(updated[0]).toEqual({ ia: "{4}", ra: "{0.25}" });
  });

  test("sql.array() passed to sql.unsafe() works for int4[] and real[] parameters", async () => {
    await container.ready;
    await using sql = connect();
    const rows = await sql.unsafe("select $1::int4[]::text as ia, $2::real[]::text as ra", [
      sql.array([7, 8], "INT4"),
      sql.array([1.5], "REAL"),
    ]);
    expect(rows[0]).toEqual({ ia: "{7,8}", ra: "{1.5}" });
  });

  test("parameters with a binary encoder still round-trip", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table t (b bool, i int4, f float8, ts timestamptz, bin bytea, r real, n numeric)`;

    const date = new Date("2024-01-02T03:04:05.678Z");
    const rows = await sql`
      insert into t (b, i, f, ts, bin, r, n)
      values (${true}, ${-123456}, ${1.25}, ${date}, ${Buffer.from([0, 1, 254, 255])}, ${"2.5"}, ${"12345678901234567890.5"})
      returning b, i, f, ts, bin, r::text as r, n::text as n`;
    expect(rows[0]).toEqual({
      b: true,
      i: -123456,
      f: 1.25,
      ts: date,
      bin: Buffer.from([0, 1, 254, 255]),
      r: "2.5",
      n: "12345678901234567890.5",
    });
  });
});
