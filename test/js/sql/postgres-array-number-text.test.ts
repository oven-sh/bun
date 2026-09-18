// The text array decoder rejected number elements that a healthy server sends,
// with ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT:
// - float8out and float4out print 1e-07 and 1e+20 with no decimal point.
// - An unquoted json[]/jsonb[] element is JSON text. A JSON number has no int32
//   range, json keeps the exponent as typed (1e5, 1E+5), and [null] has no quotes.
//
// Each test opens its own connection and only reads, so the tests run concurrently.
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import type net from "node:net";
import { pgCommandComplete, pgDataRow, pgMockServer, pgReadyForQuery, pgRowDescription } from "./wire-frames";

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  // float8[], json[] and jsonb[] are text on every path. float4[] is text unless Bun knows the
  // result columns before it sends Bind. Then it asks for float4[] in binary.
  // - simple: the simple protocol. sql.unsafe(query) with no values uses it too.
  // - extended: the first run of a tagged template with no parameter. Bind goes out before the columns are known.
  // - parameter: Bun waits for the statement description, so it knows the columns before Bind.
  const textPaths = ["simple", "extended"] as const;
  const paths = [...textPaths, "parameter"] as const;

  function run(sql: SQL, query: string, path: (typeof paths)[number]) {
    if (path === "simple") return sql.unsafe(query).simple();
    if (path === "extended") return sql`${sql.unsafe(query)}`;
    return sql.unsafe(`${query} where $1 = 1`, [1]);
  }

  // Returns the decoded array next to the text the server sends for it.
  async function decode(sql: SQL, array: string, path: (typeof paths)[number]) {
    const [row] = await run(sql, `select v, v::text as wire from (select ${array} as v) t`, path);
    return row;
  }

  // Only the simple protocol accepts two statements in one query, so this tells the two paths apart.
  test("the extended path does not use the simple protocol", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await run(sql, "select 1 as a; select 2 as b", "simple")).toEqual([[{ a: 1 }], [{ b: 2 }]]);
    expect(
      await run(sql, "select 1 as a; select 2 as b", "extended").then(
        rows => ({ rows }),
        err => ({ errno: err.errno }),
      ),
    ).toEqual({ errno: "42601" });
  });

  test.each(paths)("float8[] exponent form with no decimal point (%s)", async path => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(
      await decode(sql, "array[0.0000001, 1e20, -1e20, 5e-324, 1.5e300, 1.5, '-0', NULL]::float8[]", path),
    ).toEqual({
      v: [1e-7, 1e20, -1e20, 5e-324, 1.5e300, 1.5, -0, null],
      wire: "{1e-07,1e+20,-1e+20,5e-324,1.5e+300,1.5,-0,NULL}",
    });
    expect(await decode(sql, "array[array[1e-7], array[1e20]]::float8[]", path)).toEqual({
      v: [[1e-7], [1e20]],
      wire: "{{1e-07},{1e+20}}",
    });
  });

  test.each(textPaths)("float4[] exponent form with no decimal point, and -0 (%s)", async path => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await decode(sql, "array[0.0000001, 1e20, -1e20, 1.5, '-0', NULL]::float4[]", path)).toEqual({
      v: [1e-7, 1e20, -1e20, 1.5, -0, null],
      wire: "{1e-07,1e+20,-1e+20,1.5,-0,NULL}",
    });
  });

  // The decoded values are what JSON.parse gives for each element.
  test.each(paths)("json[] number past int32 or in exponent form (%s)", async path => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(
      await decode(
        sql,
        "array['12345678901', '-2147483649', '1e5', '1E+5', '1e-5', '1.5E-5', '-0', '[12345678901]', '[[1e5]]']::json[]",
        path,
      ),
    ).toEqual({
      v: [12345678901, -2147483649, 100000, 100000, 0.00001, 0.000015, -0, [12345678901], [[100000]]],
      wire: "{12345678901,-2147483649,1e5,1E+5,1e-5,1.5E-5,-0,[12345678901],[[1e5]]}",
    });
  });

  // jsonb prints a number as numeric text: every digit, no exponent.
  test.each(paths)("jsonb[] number past int32 (%s)", async path => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await decode(sql, "array['12345678901', '1e20', '1e-5', '[12345678901]']::jsonb[]", path)).toEqual({
      v: [12345678901, 1e20, 0.00001, [12345678901]],
      wire: "{12345678901,100000000000000000000,0.00001,[12345678901]}",
    });
  });

  // array_out quotes a JSON array only when it has a comma or a space, and a null only at the top level.
  test.each(paths)("json[] and jsonb[] null inside an unquoted JSON array (%s)", async path => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await decode(sql, "array['[null]', '[[null]]', 'null', NULL]::json[]", path)).toEqual({
      v: [[null], [[null]], null, null],
      wire: '{[null],[[null]],"null",NULL}',
    });
    expect(await decode(sql, "array['[null]', '[[null]]']::jsonb[]", path)).toEqual({
      v: [[null], [[null]]],
      wire: "{[null],[[null]]}",
    });
  });
});

// Fault-injection test: a healthy server never sends a malformed number or JSON keyword, so a
// mock pins the bytes. The element must reject. It must not decode as its valid prefix ("1e" as 1).
describe.concurrent("malformed element in a text array", () => {
  const OID = {
    json_array: 199,
    int4_array: 1007,
    int8_array: 1016,
    float4_array: 1021,
    float8_array: 1022,
    oid_array: 1028,
  } as const;
  let mock: { port: number; server: net.Server };

  // Answers a simple query `{"type": ..., "text": ...}` with one row: one column of that array type with that text.
  beforeAll(async () => {
    mock = await pgMockServer((type, body) => {
      if (type !== "Q") return;
      const { type: arrayType, text } = JSON.parse(body.toString("utf8", 0, body.length - 1));
      return [
        pgRowDescription([{ name: "v", typeOid: OID[arrayType as keyof typeof OID] }]),
        pgDataRow([Buffer.from(text)]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ];
    });
  });
  afterAll(() => mock.server.close());

  // Settles to the error code. If the text decodes instead, settles to the rows, so the failed assertion shows them.
  async function decode(type: keyof typeof OID, text: string) {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
    return await sql
      .unsafe(JSON.stringify({ type, text }))
      .simple()
      .then(
        rows => ({ rows: [...rows] }),
        err => ({ code: err.code }),
      );
  }

  test("the mock serves a well-formed element", async () => {
    expect(await decode("float8_array", "{1e-07,1.5}")).toEqual({ rows: [{ v: [1e-7, 1.5] }] });
  });

  test.each([
    ["float8_array", "{1e}"],
    ["float8_array", "{1.5e+-5}"],
    ["float8_array", "{1e5.5}"],
    ["float8_array", "{-}"],
    ["float4_array", "{1e}"],
    ["int4_array", "{1e5}"],
    ["int8_array", "{1e5}"],
    ["oid_array", "{1e5}"],
    ["json_array", "{1e}"],
    ["json_array", "{-}"],
    ["json_array", "{[null5]}"],
    ["json_array", "{truetrue}"],
  ] as const)("%s %s rejects", async (type, text) => {
    expect(await decode(type, text)).toEqual({ code: "ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT" });
  });
});
