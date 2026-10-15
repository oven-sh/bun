// What a PostgreSQL value reads as in JS. It has to be the same on every path a result takes, in text or in binary.
import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

/** One line per value, so that -0, NaN, an Invalid Date, a Buffer and a typed array differ from their look-alikes. */
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return `Date(${Number.isNaN(value.getTime()) ? "Invalid" : value.toISOString()})`;
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${Array.from(value as Uint8Array).join(",")})`;
  if (Array.isArray(value)) return `[${value.map(show).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .map(([key, item]) => key + ":" + show(item))
      .join(",")}}`;
  }
  return String(value);
}

type Table = [expression: string, value: string][];

const scalars: Table = [
  [`true`, `true`],
  [`null::bool`, `null`],
  [`(-32768)::int2`, `-32768`],
  [`(-2147483648)::int4`, `-2147483648`],
  [`9223372036854775807::int8`, `"9223372036854775807"`],
  [`4294967295::oid`, `4294967295`],
  [`'1'::xid`, `1`],
  [`'5'::xid8`, `"5"`],

  // The shortest text that gives the same float4, which is what the server prints.
  [`0.1::float4`, `0.1`],
  [`3.14159::float4`, `3.14159`],
  [`123456.789::float4`, `123456.79`],
  [`16777217::float4`, `16777216`],
  [`1e-40::float4`, `1e-40`],
  [`'NaN'::float4`, `NaN`],
  [`'-Infinity'::float4`, `-Infinity`],
  [`'-0'::float4`, `-0`],
  [`0.1::float8`, `0.1`],
  [`1e-7::float8`, `1e-7`],
  [`5e-324::float8`, `5e-324`],
  [`'NaN'::float8`, `NaN`],
  [`'Infinity'::float8`, `Infinity`],
  [`'-0'::float8`, `-0`],

  [`1.50::numeric`, `"1.50"`],
  [`0::numeric(10,4)`, `"0.0000"`],
  [`0.000000001::numeric`, `"0.000000001"`],
  [`-0.00000000000000012345::numeric`, `"-0.00000000000000012345"`],
  [`12345678.000000009::numeric`, `"12345678.000000009"`],
  [`1e20::numeric`, `"100000000000000000000"`],
  [`'NaN'::numeric`, `"NaN"`],
  [`'-Infinity'::numeric`, `"-Infinity"`],
  [`'$1,000.50'::money`, `"$1,000.50"`],

  [`'03:04:05'::time`, `"03:04:05"`],
  [`'03:04:05.000001'::time`, `"03:04:05.000001"`],
  [`'03:04:05.1'::time`, `"03:04:05.1"`],
  [`'24:00:00'::time`, `"24:00:00"`],
  [`'03:04:05.5-03:30'::timetz`, `"03:04:05.5-03:30"`],
  [`'1 year 2 mons 3 days 04:05:06.789'::interval`, `"1 year 2 mons 3 days 04:05:06.789"`],

  [`'2024-01-02'::date`, `Date(2024-01-02T00:00:00.000Z)`],
  [`'0001-01-01'::date`, `Date(0001-01-01T00:00:00.000Z)`],
  [`'0044-03-15 BC'::date`, `Date(-000043-03-15T00:00:00.000Z)`],
  [`'10000-01-01'::date`, `Date(+010000-01-01T00:00:00.000Z)`],
  [`'294276-12-31'::date`, `Date(Invalid)`],
  [`'infinity'::date`, `Infinity`],
  [`'2024-01-02 03:04:05.678901'::timestamp`, `Date(2024-01-02T03:04:05.678Z)`],
  [`'1969-12-31 23:59:59.9995'::timestamp`, `Date(1969-12-31T23:59:59.999Z)`],
  [`'0044-03-15 12:00:00.5 BC'::timestamp`, `Date(-000043-03-15T12:00:00.500Z)`],
  [`'4713-01-01 00:00:00 BC'::timestamp`, `Date(-004712-01-01T00:00:00.000Z)`],
  [`'10000-01-01 00:00:00'::timestamp`, `Date(+010000-01-01T00:00:00.000Z)`],
  [`'294276-12-31 23:59:59'::timestamp`, `Date(Invalid)`],
  [`'-infinity'::timestamp`, `-Infinity`],
  [`'2024-01-02 03:04:05.678901+00'::timestamptz`, `Date(2024-01-02T03:04:05.678Z)`],
  [`'0044-03-15 12:00:00+00 BC'::timestamptz`, `Date(-000043-03-15T12:00:00.000Z)`],
  [`'10000-01-01 00:00:00+00'::timestamptz`, `Date(+010000-01-01T00:00:00.000Z)`],
  [`'275760-09-13 00:00:00+00'::timestamptz`, `Date(+275760-09-13T00:00:00.000Z)`],
  [`'275760-09-14 00:00:00+00'::timestamptz`, `Date(Invalid)`],
  [`'infinity'::timestamptz`, `Infinity`],

  [`'\\xdeadbeef'::bytea`, `Buffer(222,173,190,239)`],
  [`''::bytea`, `Buffer()`],
  [`''::text`, `""`],
  [`'a'::char(3)`, `"a  "`],
  [`'é😀'::text`, `"é😀"`],
  [`'{"a":[1,null]}'::json`, `{a:[1,null]}`],
  [`'null'::jsonb`, `null`],
  [`'12345678901'::jsonb`, `12345678901`],
  [`'11111111-1111-1111-1111-111111111111'::uuid`, `"11111111-1111-1111-1111-111111111111"`],
  [`'[1,3)'::int4range`, `"[1,3)"`],
  [`row(1,'a',null)`, `"(1,a,)"`],
];

const arrays: Table = [
  [`'{1,2,3}'::int4[]`, `[1,2,3]`],
  [`'{}'::int4[]`, `[]`],
  [`'{1,NULL,3}'::int4[]`, `[1,null,3]`],
  [`'{2147483647,-2147483648}'::int4[]`, `[2147483647,-2147483648]`],
  [`'{{1,2},{3,4}}'::int4[]`, `[[1,2],[3,4]]`],
  [`'{{{{{{1}}}}}}'::int4[]`, `[[[[[[1]]]]]]`],
  // The bounds are not part of a JS array.
  [`'[0:2]={1,2,3}'::int4[]`, `[1,2,3]`],
  [`'[0:1][2:3]={{1,2},{3,4}}'::int4[]`, `[[1,2],[3,4]]`],
  [`'[-1:0]={a,b}'::text[]`, `["a","b"]`],
  [`(select indkey::int2[] from pg_index where indexrelid = 'pg_class_relname_nsp_index'::regclass)`, `[2,3]`],

  [`'{1.5,0.1,NULL}'::float4[]`, `[1.5,0.1,null]`],
  [`'{NaN,Infinity,-Infinity,-0}'::float4[]`, `[NaN,Infinity,-Infinity,-0]`],
  [`array[0.0000001::float4, 1e20::float4]`, `[1e-7,100000000000000000000]`],
  [`'{1.1,-0,NULL}'::float8[]`, `[1.1,-0,null]`],
  [`'{NaN,Infinity,-Infinity}'::float8[]`, `[NaN,Infinity,-Infinity]`],
  [`array[0.0000001::float8, 1e20::float8]`, `[1e-7,100000000000000000000]`],
  [`'{32767,-32768,NULL}'::int2[]`, `[32767,-32768,null]`],
  [`'{9007199254740993,NULL}'::int8[]`, `["9007199254740993",null]`],
  [`'{1,4294967295}'::oid[]`, `[1,4294967295]`],
  [`'{1.50,NaN,NULL,1e-5,Infinity}'::numeric[]`, `["1.50","NaN",null,"0.00001","Infinity"]`],
  [`'{t,f,NULL}'::bool[]`, `[true,false,null]`],

  [
    `'{a,NULL,"NULL","",b c,"x,y","q\\"q","b\\\\s",null}'::text[]`,
    `["a",null,"NULL","","b c","x,y","q\\"q","b\\\\s",null]`,
  ],
  [`'{{a,NULL},{"",b}}'::text[]`, `[["a",null],["","b"]]`],
  [
    `array[' ', 'null', 'a{b}', 'a\\b', E'\\b', E'\\n', 'é', '😀']`,
    `[" ","null","a{b}","a\\\\b","\\b","\\n","é","😀"]`,
  ],
  [`'{a,b}'::char(3)[]`, `["a  ","b  "]`],
  [`array['\\xdead'::bytea, null, ''::bytea]`, `[Buffer(222,173),null,Buffer()]`],

  [`array['2024-01-02'::date, null, 'infinity']`, `[Date(2024-01-02T00:00:00.000Z),null,Infinity]`],
  [
    `array['0044-03-15 BC'::date, '10000-01-01']`,
    `[Date(-000043-03-15T00:00:00.000Z),Date(+010000-01-01T00:00:00.000Z)]`,
  ],
  [
    `array['2024-01-02 03:04:05.678'::timestamp, null, '-infinity', '10000-01-01 00:00:00']`,
    `[Date(2024-01-02T03:04:05.678Z),null,-Infinity,Date(+010000-01-01T00:00:00.000Z)]`,
  ],
  [
    `array['2024-01-02 03:04:05.678+00'::timestamptz, null, '0044-03-15 12:00:00+00 BC']`,
    `[Date(2024-01-02T03:04:05.678Z),null,Date(-000043-03-15T12:00:00.000Z)]`,
  ],
  [`array['03:04:05'::time]`, `["03:04:05"]`],
  [`array['1 day 2 hours'::interval, null]`, `["1 day 02:00:00",null]`],

  // An element of a json[] is any JSON text.
  [`array['1', '12345678901', '1e5', '1E+5', '-0', '1.5']::json[]`, `[1,12345678901,100000,100000,-0,1.5]`],
  [`array['12345678901'::jsonb]`, `[12345678901]`],
  [`array['[null]', '[1,2]', '[]', '[[1]]']::json[]`, `[[null],[1,2],[],[[1]]]`],
  [`array['null'::json, null]`, `[null,null]`],
  [`array['true', 'false', '"a"', '{"a":[1,{"b":null}]}']::json[]`, `[true,false,"a",{a:[1,{b:null}]}]`],
  [`array['"a\\nb\\u00e9\\\\"'::jsonb]`, `["a\\nbé\\\\"]`],
  [`array[array['{"a":[1,2]}'::jsonb], array['null'::jsonb]]`, `[[{a:[1,2]}],[null]]`],

  // `;` separates the elements of a box[].
  [`array['(1,2),(3,4)'::box, '(5,6),(7,8)']`, `["(3,4),(1,2)","(7,8),(5,6)"]`],
  [`array['(1,2)'::point]`, `["(1,2)"]`],
  [`array['1.2.3.4'::inet, null]`, `["1.2.3.4",null]`],
  [`array['$1,000.50'::money]`, `["$1,000.50"]`],
  [`array['(0,1)'::tid]`, `["(0,1)"]`],
  [`array['1'::xid]`, `[1]`],

  [`array['11111111-1111-1111-1111-111111111111'::uuid, null]`, `["11111111-1111-1111-1111-111111111111",null]`],
  [`'{}'::uuid[]`, `[]`],
  [`array['5'::xid8]`, `["5"]`],
  [`array['1 2'::oidvector, '3']`, `["1 2","3"]`],
  [`array['a'::cstring, 'b c']`, `["a","b c"]`],
  [`array['c'::refcursor]`, `["c"]`],
  [`array['1:1:'::txid_snapshot]`, `["1:1:"]`],
  [`array['1:1:'::pg_snapshot]`, `["1:1:"]`],
  [`array['1/0'::pg_lsn]`, `["1/0"]`],
  [`array['$.a'::jsonpath, '$[*]']`, `["$.\\"a\\"","$[*]"]`],
  [`array['a b'::tsvector, 'c']`, `["'a' 'b'","'c'"]`],
  [`array['a & b'::tsquery]`, `["'a' & 'b'"]`],
  [`array['now'::regproc]`, `["now"]`],
  [`array['now()'::regprocedure]`, `["now()"]`],
  [`array['||/'::regoper]`, `["||/"]`],
  [`array['+(integer,integer)'::regoperator]`, `["+(integer,integer)"]`],
  [`array['pg_class'::regclass, null]`, `["pg_class",null]`],
  [`array['int4'::regtype]`, `["integer"]`],
  [`array['english'::regconfig]`, `["english"]`],
  [`array['simple'::regdictionary]`, `["simple"]`],
  [`array['public'::regnamespace]`, `["public"]`],
  [`array['bun_sql_test'::regrole]`, `["bun_sql_test"]`],
  [`array['"C"'::regcollation]`, `["\\"C\\""]`],
  [`array['[1,3)'::int4range, 'empty', null]`, `["[1,3)","empty",null]`],
  [`array['[1,9223372036854775807)'::int8range]`, `["[1,9223372036854775807)"]`],
  [`array['[1.5,3)'::numrange]`, `["[1.5,3)"]`],
  [`array['[2024-01-02,2024-01-05)'::daterange]`, `["[2024-01-02,2024-01-05)"]`],
  [`array['[2024-01-02 03:04:05,)'::tsrange]`, `["[\\"2024-01-02 03:04:05\\",)"]`],
  [`array['[2024-01-02 03:04:05+00,)'::tstzrange]`, `["[\\"2024-01-02 03:04:05+00\\",)"]`],
  [`array['{[1,3),[5,7)}'::int4multirange, '{}']`, `["{[1,3),[5,7)}","{}"]`],
  [`array['{[1,3)}'::int8multirange]`, `["{[1,3)}"]`],
  [`array['{[1.5,3)}'::nummultirange]`, `["{[1.5,3)}"]`],
  [`array['{[2024-01-02,2024-01-05)}'::datemultirange]`, `["{[2024-01-02,2024-01-05)}"]`],
  [`array['{[2024-01-02 03:04:05,)}'::tsmultirange]`, `["{[\\"2024-01-02 03:04:05\\",)}"]`],
  [`array['{[2024-01-02 03:04:05+00,)}'::tstzmultirange]`, `["{[\\"2024-01-02 03:04:05+00\\",)}"]`],
];

const bigints: Table = [
  [`9223372036854775807::int8`, `9223372036854775807n`],
  [`(-9223372036854775808)::int8`, `-9223372036854775808n`],
  [`'{9007199254740993,NULL,-1}'::int8[]`, `[9007199254740993n,null,-1n]`],
  [`'{{1},{2}}'::int8[]`, `[[1n],[2n]]`],
];

// `timestamp` and `date` are UTC whatever the zone of the host is. Under a zone
// with an offset, a decoder that reads one of them as local time shows.
const originalTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = (options: SQL.Options = {}) =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      ...options,
    });

  /** A tagged template with no parameter. The second run is of a statement whose columns the client knows. */
  const template = (sql: SQL, text: string) =>
    sql(Object.defineProperty([text], "raw", { value: [text] }) as unknown as TemplateStringsArray);
  const paths: Record<string, (sql: SQL, expression: string) => Promise<any[]>> = {
    "simple": (sql, expression) => sql.unsafe(`select ${expression} as v`).simple(),
    "first run": (sql, expression) => template(sql, `select ${expression} as v -- first run`),
    "second run": async (sql, expression) => {
      await template(sql, `select ${expression} as v`);
      return await template(sql, `select ${expression} as v`);
    },
    "parameter": (sql, expression) => sql.unsafe(`select ${expression} as v where $1 = 1`, [1]),
  };

  async function read(table: Table, path: string, options?: SQL.Options) {
    await container.ready;
    await using sql = connect(options);
    const values: Table = [];
    for (const [expression] of table) {
      values.push([
        expression,
        await paths[path](sql, expression).then(
          rows => show(rows[0].v),
          error => `rejected: ${error.code ?? error.name}`,
        ),
      ]);
    }
    return values;
  }

  const everyPath: [path: string, options?: SQL.Options][] = [
    ...Object.keys(paths).map(path => [path] as [string]),
    ["parameter", { prepare: false }],
  ];
  const title = ([path, options]: (typeof everyPath)[number]) => path + (options ? ", prepare: false" : "");

  for (const path of everyPath) {
    test(`scalars: ${title(path)}`, async () => {
      expect(await read(scalars, ...path)).toEqual(scalars);
    });
    test(`arrays: ${title(path)}`, async () => {
      expect(await read(arrays, ...path)).toEqual(arrays);
    });
    test(`bigint: true: ${title(path)}`, async () => {
      expect(await read(bigints, path[0], { ...path[1], bigint: true })).toEqual(bigints);
    });
  }

  test("a numeric with more than 32767 base-10000 digits", async () => {
    await container.ready;
    await using sql = connect();
    const digits = Buffer.alloc(131072, "9").toString();
    for (let run = 0; run < 3; run++) {
      const [{ positive, negative, scaled }] =
        await sql`select repeat('9', 131072)::numeric as positive, ('-' || repeat('9', 131072))::numeric as negative, (repeat('9', 131072) || '.12345678')::numeric as scaled`;
      expect(positive === digits && negative === "-" + digits && scaled === digits + ".12345678").toBe(true);
    }
  });

  // FETCH from a binary cursor in a simple query is how a server sends binary that nobody asked for.
  test("a column in binary that the client has no decoder for rejects the query", async () => {
    await container.ready;
    await using sql = connect();
    const fetch = (expression: string) =>
      sql
        .unsafe(`begin; declare c binary cursor for select ${expression} as v; fetch all from c; commit`)
        .simple()
        .then(
          results => show(results[2][0].v),
          async error => {
            await sql.unsafe("rollback").simple();
            return `rejected: ${error.code}`;
          },
        );
    const table: Table = [
      [`true`, `true`],
      [`7::int4`, `7`],
      [`1.5::float8`, `1.5`],
      [`'2024-01-02 03:04:05'::timestamp`, `Date(2024-01-02T03:04:05.000Z)`],
      [`'2024-01-02 03:04:05+00'::timestamptz`, `Date(2024-01-02T03:04:05.000Z)`],
      [`'\\xdead'::bytea`, `Buffer(222,173)`],
      // The binary form of these is their text.
      [`'é'::text`, `"é"`],
      [`'a'::char(3)`, `"a  "`],
      [`'{"a":1}'::json`, `{a:1}`],
      [`null::int2`, `null`],
      ...[
        `5::int2`,
        `7::int8`,
        `3::oid`,
        `1.5::float4`,
        `1.50::numeric`,
        `'2024-01-02'::date`,
        `'03:04:05'::time`,
        `'11111111-1111-1111-1111-111111111111'::uuid`,
        `'{"a":1}'::jsonb`,
        `'{1,2}'::int4[]`,
      ].map(expression => [expression, "rejected: ERR_POSTGRES_UNKNOWN_FORMAT_CODE"] as [string, string]),
    ];
    const values: Table = [];
    for (const [expression] of table) values.push([expression, await fetch(expression)]);
    expect(values).toEqual(table);
  });

  // JSC stores a key as an array index only when it is a canonical integer below
  // 2^32 - 1 ("0", "7", "4294967294"). Every other name of digits is a string key.
  const wide = (...overrides: [index: number, name: string][]) => {
    const names = Array.from({ length: 80 }, (_, i) => `c${i}`);
    for (const [index, name] of overrides) names[index] = name;
    return names;
  };
  test.each([
    ["zero-padded names beside canonical ones", ["id", "01", "02", "10", "007", "7", "0", "00"]],
    ["the edges of the array-index range", ["0", "0000000001", "00000000001", "4294967294", "4294967295", "x"]],
    ["a repeated zero-padded name", ["01", "01", "1"]],
    // Past JSFinalObject::maxInlineCapacity columns the names are put on each row one by one.
    ["a zero-padded name beside its canonical spelling in a wide row", wide([40, "007"], [41, "7"])],
  ])("column names: %s", async (_, names) => {
    await container.ready;
    await using sql = connect();
    const select = "select " + names.map((name, i) => `'v${i}' as "${name}"`).join(", ");
    const expected = Object.fromEntries(names.map((name, i) => [name, `v${i}`]));

    for (const rows of [await sql.unsafe(select).simple(), await sql.unsafe(select + " where 1 = $1", [1])]) {
      expect(rows).toEqual([expected]);
      expect(Object.keys(rows[0])).toEqual(Object.keys(expected));
    }
  });
});
