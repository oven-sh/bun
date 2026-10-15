// In a text-format array, an element with no quotes is the text that the element type prints.
// array_out quotes an element only when it is empty, spells NULL, or has a quote, a backslash,
// a brace, the separator or whitespace. The decoder reads each unquoted element with the parser
// of its type.
//
// Before, the decoder guessed the kind of an element from its first byte and scanned it with a
// number grammar of its own. That rejected text a healthy server sends, with
// ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT:
// - float8out and float4out print 1e-07 and 1e+20 with no decimal point.
// - An unquoted json[]/jsonb[] element is JSON text. A JSON number has no int32 range, json keeps
//   the exponent as typed (1e5, 1E+5), and [null] has no quotes.
//
// Each test opens its own connection and only reads, so the tests run concurrently.
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import type net from "node:net";
import { pgCommandComplete, pgDataRow, pgMockServer, pgReadyForQuery, pgRowDescription } from "./wire-frames";

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  // int4[] and float4[] are text unless Bun knows the result columns before it sends Bind. Then
  // it asks for them in binary. Every other array type is text on every path.
  // - simple: the simple protocol. sql.unsafe(query) with no values uses it too.
  // - extended: the first run of a tagged template with no parameter. Bind goes out before the columns are known.
  // - prepared: the second run of that template on the same connection. Bun has the statement and its columns.
  // - parameter: Bun waits for the statement description, so it knows the columns before Bind.
  const textPaths = ["simple", "extended"] as const;
  const paths = [...textPaths, "prepared", "parameter"] as const;

  async function run(sql: SQL, query: string, path: (typeof paths)[number]) {
    if (path === "simple") return await sql.unsafe(query).simple();
    if (path === "parameter") return await sql.unsafe(`${query} where $1 = 1`, [1]);
    if (path === "prepared") await sql`${sql.unsafe(query)}`;
    return await sql`${sql.unsafe(query)}`;
  }

  // Returns the decoded array next to the text the server sends for it.
  async function decode(sql: SQL, array: string, path: (typeof paths)[number]) {
    const [row] = await run(sql, `select v, v::text as wire from (select ${array} as v) t`, path);
    return row;
  }

  // Only the simple protocol accepts two statements in one query, so this tells the paths apart.
  // Only a path that knows the columns before Bind gets an int4[] in binary, as an Int32Array.
  test("the four paths differ in protocol and in result format", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await run(sql, "select 1 as a; select 2 as b", "simple")).toEqual([[{ a: 1 }], [{ b: 2 }]]);
    expect(
      await run(sql, "select 1 as a; select 2 as b", "extended").then(
        rows => ({ rows }),
        err => ({ errno: err.errno }),
      ),
    ).toEqual({ errno: "42601" });

    const kinds: Record<string, string> = {};
    for (const path of paths) {
      const [{ v }] = await run(sql, "select array[1, 2]::int4[] as v", path);
      kinds[path] = v.constructor.name;
    }
    expect(kinds).toEqual({ simple: "Array", extended: "Array", prepared: "Int32Array", parameter: "Int32Array" });
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

    expect(await decode(sql, "array[0.0000001, 1000000, 1e20, -1e20, 1.5, '-0', NULL]::float4[]", path)).toEqual({
      v: [1e-7, 1e6, 1e20, -1e20, 1.5, -0, null],
      wire: "{1e-07,1e+06,1e+20,-1e+20,1.5,-0,NULL}",
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

  // An unquoted JSON array goes to the JSON parser as one element. It has no depth limit of its own.
  test.each(paths)("json[] unquoted JSON array nested 150 deep (%s)", async path => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    const json = Buffer.alloc(150, "[").toString() + "1" + Buffer.alloc(150, "]").toString();
    expect(await decode(sql, `array['${json}']::json[]`, path)).toEqual({ v: [JSON.parse(json)], wire: `{${json}}` });
  });

  // bytea_output=escape prints a printable byte as itself, so 'abc', 't' and '123' have no quotes.
  // Bun reads the hex output only. The element rejects as a scalar bytea in that output does.
  test.each(["abc", "t", "123"])("bytea[] element %p in escape output rejects with the bytea error", async bytes => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await decode(sql, `array['${bytes}'::bytea, NULL]`, "simple")).toEqual({
      v: [Buffer.from(bytes), null],
      wire: `{"\\\\x${Buffer.from(bytes).toString("hex")}",NULL}`,
    });
    await sql`set bytea_output = 'escape'`.simple();
    expect(
      await decode(sql, `array['${bytes}'::bytea, NULL]`, "simple").then(
        row => ({ row }),
        err => ({ code: err.code }),
      ),
    ).toEqual({ code: "ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT" });
  });

  // The element types below decoded before this change too. Each row pins the value next to the text it comes from.
  const unchanged: [array: string, wire: string, v: unknown[], on?: readonly (typeof paths)[number][]][] = [
    ["array[true, false, NULL]", "{t,f,NULL}", [true, false, null]],
    [
      "array[array[true, NULL], array[false, true]]",
      "{{t,NULL},{f,t}}",
      [
        [true, null],
        [false, true],
      ],
    ],
    ["array[1, -2, 32767, NULL]::int2[]", "{1,-2,32767,NULL}", [1, -2, 32767, null]],
    ["array[1, -2, 2147483647, NULL]::int4[]", "{1,-2,2147483647,NULL}", [1, -2, 2147483647, null], textPaths],
    [
      "array[1, -2, 9223372036854775807, NULL]::int8[]",
      "{1,-2,9223372036854775807,NULL}",
      ["1", "-2", "9223372036854775807", null],
    ],
    [
      "array[array[1, 2], array[3, NULL]]::int8[]",
      "{{1,2},{3,NULL}}",
      [
        ["1", "2"],
        ["3", null],
      ],
    ],
    ["array[1, 4294967295]::oid[]", "{1,4294967295}", [1, 4294967295]],
    ["array['1', '4294967295']::xid[]", "{1,4294967295}", [1, 4294967295]],
    ["array['1', '4294967295']::cid[]", "{1,4294967295}", [1, 4294967295]],
    [
      "array['NaN', 'Infinity', '-Infinity', 1.5, -0.5, 3, NULL]::float8[]",
      "{NaN,Infinity,-Infinity,1.5,-0.5,3,NULL}",
      [NaN, Infinity, -Infinity, 1.5, -0.5, 3, null],
    ],
    [
      "array['NaN', 'Infinity', '-Infinity', 1.5, -0.5, 3, NULL]::float4[]",
      "{NaN,Infinity,-Infinity,1.5,-0.5,3,NULL}",
      [NaN, Infinity, -Infinity, 1.5, -0.5, 3, null],
      textPaths,
    ],
    [
      "array['infinity', '-infinity', NULL, '2024-01-02 03:04:05']::timestamp[]",
      '{infinity,-infinity,NULL,"2024-01-02 03:04:05"}',
      [Infinity, -Infinity, null, new Date("2024-01-02T03:04:05Z")],
    ],
    ["array['infinity', '-infinity', NULL]::timestamptz[]", "{infinity,-infinity,NULL}", [Infinity, -Infinity, null]],
    [
      "array['2024-01-02', 'infinity', '-infinity', NULL]::date[]",
      "{2024-01-02,infinity,-infinity,NULL}",
      [new Date("2024-01-02T00:00:00Z"), Infinity, -Infinity, null],
    ],
    [
      "array['true', 'false', '1', '1.5', '[1]', '[]', '[[true]]', 'null', '\"a\"', '{\"a\":1}']::jsonb[]",
      '{true,false,1,1.5,[1],[],[[true]],"null","\\"a\\"","{\\"a\\": 1}"}',
      [true, false, 1, 1.5, [1], [], [[true]], null, "a", { a: 1 }],
    ],
    ["array['\\x00ff'::bytea, NULL]", '{"\\\\x00ff",NULL}', [Buffer.from([0x00, 0xff]), null]],
    ["array[1.5, 'NaN', NULL]::numeric[]", "{1.5,NaN,NULL}", ["1.5", "NaN", null]],
    ["array['abc', 'NULL', NULL, '', 'a b']::text[]", '{abc,"NULL",NULL,"","a b"}', ["abc", "NULL", null, "", "a b"]],
    ["array['12:00:00']::time[]", "{12:00:00}", ["12:00:00"]],
    ["array['1 day', '01:00:00']::interval[]", '{"1 day",01:00:00}', ["1 day", "01:00:00"]],
    ["array['127.0.0.1']::inet[]", "{127.0.0.1}", ["127.0.0.1"]],
    ["array['(1,1),(0,0)', '(3,3),(2,2)']::box[]", "{(1,1),(0,0);(3,3),(2,2)}", ["(1,1),(0,0)", "(3,3),(2,2)"]],
    ["array['(0,1)']::tid[]", '{"(0,1)"}', ["(0,1)"]],
  ];

  test.each(paths)("element types that decoded before keep their values (%s)", async path => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    const expected: Record<string, unknown> = {};
    const actual: Record<string, unknown> = {};
    for (const [array, wire, v, on = paths] of unchanged) {
      if (!on.includes(path)) continue;
      expected[array] = { v, wire };
      actual[array] = await decode(sql, array, path);
    }
    expect(actual).toEqual(expected);
  });

  test.each(paths)("int8[] with the bigint option (%s)", async path => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, bigint: true });

    expect(await decode(sql, "array[1, -2, 9223372036854775807, NULL]::int8[]", path)).toEqual({
      v: [1n, -2n, 9223372036854775807n, null],
      wire: "{1,-2,9223372036854775807,NULL}",
    });
  });
});

// Fault-injection test: a healthy server never sends these elements, so a mock pins the bytes.
describe.concurrent("element text that no server prints", () => {
  const OID = {
    json_array: 199,
    bool_array: 1000,
    bytea_array: 1001,
    int4_array: 1007,
    tid_array: 1010,
    xid_array: 1011,
    cid_array: 1012,
    int8_array: 1016,
    float4_array: 1021,
    float8_array: 1022,
    oid_array: 1028,
    timestamp_array: 1115,
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

  // Settles to the decoded array, or to the error code (the error name when the error has no code).
  async function decode(type: keyof typeof OID, text: string) {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
    return await sql
      .unsafe(JSON.stringify({ type, text }))
      .simple()
      .then(
        ([row]) => ({ v: row.v }),
        err => ({ error: err.code ?? err.name }),
      );
  }

  test("the mock serves a well-formed element", async () => {
    expect(await decode("float8_array", "{1e-07,1.5}")).toEqual({ v: [1e-7, 1.5] });
    expect(await decode("json_array", "{0,-0,0.5,-1.5e+300,1E5,[1]}")).toEqual({ v: [0, -0, 0.5, -1.5e300, 1e5, [1]] });
  });

  // The parser of the element type refuses the text. The element must not decode as a prefix of
  // it ("1e" as 1), and not as a value of another type (a bool in an int4[]).
  test.each([
    ["float8_array", "{1e}"],
    ["float8_array", "{1.5e+-5}"],
    ["float8_array", "{1e5.5}"],
    ["float8_array", "{-}"],
    ["float4_array", "{1e}"],
    ["int4_array", "{1e5}"],
    ["int4_array", "{1.5}"],
    ["int4_array", "{t}"],
    ["int8_array", "{1e5}"],
    ["int8_array", "{1.5}"],
    ["int8_array", "{-}"],
    ["oid_array", "{1e5}"],
    ["oid_array", "{-1}"],
    ["oid_array", "{4294967296}"],
    ["xid_array", "{4294967296}"],
    ["cid_array", "{4294967296}"],
    ["bool_array", "{tf}"],
    ["bool_array", "{true}"],
    ["json_array", "{1e}"],
    ["json_array", "{-}"],
    ["json_array", "{truetrue}"],
    ["json_array", "{falsy}"],
    // JSON has no NaN, no Infinity, no sign `+`, no leading zero and no bare `.`
    ["json_array", "{NaN}"],
    ["json_array", "{Infinity}"],
    ["json_array", "{-Infinity}"],
    ["json_array", "{-inf}"],
    ["json_array", "{+1}"],
    ["json_array", "{01}"],
    ["json_array", "{1.}"],
    ["json_array", "{.5}"],
  ] as const)("%s %s rejects", async (type, text) => {
    expect(await decode(type, text)).toEqual({ error: "ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT" });
  });

  test("an unquoted bytea[] element rejects with the bytea error", async () => {
    expect(await decode("bytea_array", "{t}")).toEqual({ error: "ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT" });
  });

  // An unquoted JSON array is one element for the JSON parser, as a quoted one is.
  test("a json[] element that is not JSON rejects with the error of the JSON parser", async () => {
    expect(await decode("json_array", "{[null5]}")).toEqual({ error: "SyntaxError" });
    expect(await decode("json_array", '{"[null5]"}')).toEqual({ error: "SyntaxError" });
  });

  // A timestamp has a space, so the server quotes it. Text with no quotes reads as the quoted text does.
  test("an unquoted timestamp[] element reads as the quoted one does", async () => {
    expect(await decode("timestamp_array", "{2024-01-02}")).toEqual({ v: [new Date("2024-01-02T00:00:00Z")] });
    expect(await decode("timestamp_array", '{"2024-01-02"}')).toEqual({ v: [new Date("2024-01-02T00:00:00Z")] });
  });

  // A tid has a comma, so the server quotes it. Text with no quotes is a string, as for every type Bun reads as text.
  test("an unquoted tid[] element is a string", async () => {
    expect(await decode("tid_array", "{abc}")).toEqual({ v: ["abc"] });
  });
});
