// What a PostgreSQL value reads as in JS. It has to be the same on every path a result takes, in text or in binary,
// but for float4, int4[] and float4[].
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";

/** One line per value, so that -0, NaN, an Invalid Date, a Buffer and a typed array differ from their look-alikes. */
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return `Date(${Number.isNaN(value.getTime()) ? "Invalid" : value.toISOString()})`;
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${Array.from(value as Uint8Array, show).join(",")})`;
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
  // The bounds are not part of a JS array.
  [`'[0:2]={1,2,3}'::int2[]`, `[1,2,3]`],
  [`'[0:1][2:3]={{1,2},{3,4}}'::int4[]`, `[[1,2],[3,4]]`],
  [`'[-1:0]={a,b}'::text[]`, `["a","b"]`],
  [`(select indkey::int2[] from pg_index where indexrelid = 'pg_class_relname_nsp_index'::regclass)`, `[2,3]`],

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

  // These three read as they always have: by the format that the value arrives in.
  describe("float4, int4[] and float4[]", () => {
    type ByFormat = [expression: string, text: string, binary: string][];
    const values: ByFormat = [
      [`0.1::float4`, `0.1`, `0.10000000149011612`],
      [`0.3::float4`, `0.3`, `0.30000001192092896`],
      [`3.14159::float4`, `3.14159`, `3.141590118408203`],
      [`123456.789::float4`, `123456.79`, `123456.7890625`],
      [`16777217::float4`, `16777216`, `16777216`],
      [`1e-40::float4`, `1e-40`, `9.99994610111476e-41`],
      [`1e-45::float4`, `1e-45`, `1.401298464324817e-45`],
      [`3.4028235e38::float4`, `3.4028235e+38`, `3.4028234663852886e+38`],
      [`1.5::float4`, `1.5`, `1.5`],
      [`'NaN'::float4`, `NaN`, `NaN`],
      [`'-Infinity'::float4`, `-Infinity`, `-Infinity`],
      [`'-0'::float4`, `-0`, `-0`],
      [`null::float4`, `null`, `null`],
      [`'{1,2,3}'::int4[]`, `[1,2,3]`, `Int32Array(1,2,3)`],
      [`'{2147483647,-2147483648,0}'::int4[]`, `[2147483647,-2147483648,0]`, `Int32Array(2147483647,-2147483648,0)`],
      [`'{}'::int4[]`, `[]`, `Int32Array()`],
      [`null::int4[]`, `null`, `null`],
      [`'{1.5,0.1}'::float4[]`, `[1.5,0.1]`, `Float32Array(1.5,0.10000000149011612)`],
      [`'{}'::float4[]`, `[]`, `Float32Array()`],
      [`null::float4[]`, `null`, `null`],
    ];
    // A typed array has one dimension and no place for a NULL.
    const plain: ByFormat = [
      [`'{1,NULL,3}'::int4[]`, `[1,null,3]`, `[1,null,3]`],
      [`'{NULL}'::int4[]`, `[null]`, `[null]`],
      [`'{{1,2},{3,4}}'::int4[]`, `[[1,2],[3,4]]`, `[[1,2],[3,4]]`],
      [`'{{{{{{1}}}}}}'::int4[]`, `[[[[[[1]]]]]]`, `[[[[[[1]]]]]]`],
      [`'{1.5,0.1,NULL}'::float4[]`, `[1.5,0.1,null]`, `[1.5,0.10000000149011612,null]`],
      [`'{{0.1},{0.3}}'::float4[]`, `[[0.1],[0.3]]`, `[[0.10000000149011612],[0.30000001192092896]]`],
    ];
    const typed: ByFormat = [
      // The bounds are not part of a JS array.
      [`'[0:2]={1,2,3}'::int4[]`, `[1,2,3]`, `Int32Array(1,2,3)`],
      [`'[5:6]={1.5,2.5}'::float4[]`, `[1.5,2.5]`, `Float32Array(1.5,2.5)`],
      [`'{NaN,Infinity,-Infinity,-0}'::float4[]`, `[NaN,Infinity,-Infinity,-0]`, `Float32Array(NaN,Infinity,-Infinity,-0)`], // prettier-ignore
      [`array[0.0000001::float4, 1e20::float4]`, `[1e-7,100000000000000000000]`, `Float32Array(1.0000000116860974e-7,100000002004087730000)`], // prettier-ignore
      // The server still says of these that they hold a NULL.
      [`('{1,NULL,3,4}'::int4[])[3:4]`, `[3,4]`, `Int32Array(3,4)`],
      [`('{1.5,NULL}'::float4[])[1:1] || '{0.1}'::float4[]`, `[1.5,0.1]`, `Float32Array(1.5,0.10000000149011612)`],
    ];

    const select = (table: ByFormat) => "select " + table.map(([expression], i) => `${expression} as c${i}`).join(", ");
    type Run = (sql: SQL, text: string) => Promise<Record<string, unknown> | unknown[]>;
    const runs: [name: string, binary: boolean, binaryUnprepared: boolean, run: Run][] = [
      ["the first run", false, false, async (sql, text) => (await template(sql, text))[0]],
      [
        "the second run",
        true,
        false,
        async (sql, text) => {
          await template(sql, text);
          return (await template(sql, text))[0];
        },
      ],
      [
        "values() on the second run",
        true,
        false,
        async (sql, text) => {
          await template(sql, text);
          return (await template(sql, text).values())[0];
        },
      ],
      ["with a parameter", true, false, async (sql, text) => (await sql.unsafe(text + " where $1 = 1", [1]))[0]],
      [
        "with a parameter, the second run",
        true,
        false,
        async (sql, text) => {
          await sql.unsafe(text + " where $1 = 1", [1]);
          return (await sql.unsafe(text + " where $1 = 1", [1]))[0];
        },
      ],
      ["simple()", false, false, async (sql, text) => (await sql.unsafe(text).simple())[0]],
      ["sql.unsafe() without values", false, false, async (sql, text) => (await sql.unsafe(text))[0]],
      [
        "raw().execute().values() on the second run",
        true,
        false,
        async (sql, text) => {
          await template(sql, text);
          return (await template(sql, text).raw().execute().values())[0];
        },
      ],
      [
        "FETCH from a binary cursor",
        true,
        true,
        async (sql, text) =>
          (await sql.unsafe(`begin; declare c binary cursor for ${text}; fetch all from c; commit`).simple())[2][0],
      ],
    ];

    describe.each<[string, ByFormat]>([
      ["values", values],
      ["a NULL or more dimensions make a plain array", plain],
      ["bounds, exponents, names of numbers and a NULL that is gone do not", typed],
    ])("%s", (_, table) => {
      describe.each([true, false])("prepare: %p", prepare => {
        test.each(runs)("%s", async (_, binary, binaryUnprepared, run) => {
          await container.ready;
          await using sql = connect({ prepare });
          const row = await run(sql, select(table));
          expect(Object.values(row).map((value, i) => [table[i][0], show(value)])).toEqual(
            table.map(([expression, text, inBinary]) => [
              expression,
              (prepare ? binary : binaryUnprepared) ? inBinary : text,
            ]),
          );
        });
      });
    });

    test("a float4 that was read in binary finds its row", async () => {
      await container.ready;
      await using sql = connect();
      await sql.unsafe("create temp table readings (id int, r real, a real[])");
      await sql.unsafe("insert into readings values (1, 0.1, '{0.1,0.3}')");
      const found = [];
      for (let run = 0; run < 2; run++) {
        const [row] = await sql`select r, a from readings where id = ${1}`;
        found.push(
          await sql`select count(*)::int as r, count(*) filter (where a[2] = ${row.a[1]})::int as a from readings where r = ${row.r}`,
        );
      }
      expect(found).toEqual([[{ r: 1, a: 1 }], [{ r: 1, a: 1 }]]);
    });
  });

  describe("raw()", () => {
    // [type, literal, the text format, the binary format in hex of a column that raw() asks for in binary]
    const columns: [type: string, literal: string, text: string, binary?: string][] = [
      ["bool", "true", "t", "01"],
      ["int2", "1", "1"],
      ["int4", "1", "1", "00000001"],
      ["int8", "1", "1"],
      ["oid", "1", "1"],
      ["float4", "1.5", "1.5", "3fc00000"],
      ["float8", "1.5", "1.5", "3ff8000000000000"],
      ["numeric", "1.5", "1.5", "000200000000000100011388"],
      ["money", "1.5", "$1.50"],
      ["text", "ab", "ab"],
      ["varchar", "ab", "ab"],
      ["bpchar", "a", "a"],
      ["name", "ab", "ab"],
      ["bytea", "\\x0102ff", "\\x0102ff", "0102ff"],
      ["date", "2024-01-02", "2024-01-02"],
      ["time", "03:04:05", "03:04:05", "0000000292555340"],
      ["timetz", "03:04:05+00", "03:04:05+00"],
      ["timestamp", "2024-01-02 03:04:05", "2024-01-02 03:04:05", "0002b0ec8515f340"],
      ["timestamptz", "2024-01-02 03:04:05+00", "2024-01-02 03:04:05+00", "0002b0ec8515f340"],
      ["interval", "1 day", "1 day"],
      ["uuid", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"],
      ["json", "[1]", "[1]"],
      ["jsonb", "[1]", "[1]"],
      ["inet", "1.2.3.4", "1.2.3.4"],
      ["point", "(1,2)", "(1,2)"],
      ["bool[]", "{t}", "{t}"],
      ["int2[]", "{1,2}", "{1,2}"],
      ["int4[]", "{1,2}", "{1,2}", "000000010000000000000017000000020000000100000004000000010000000400000002"],
      ["int8[]", "{1,2}", "{1,2}"],
      ["float4[]", "{1.5}", "{1.5}", "0000000100000000000002bc0000000100000001000000043fc00000"],
      ["float8[]", "{1.5}", "{1.5}"],
      ["numeric[]", "{1.5}", "{1.5}"],
      ["text[]", "{a}", "{a}"],
      ["bytea[]", '{"\\\\x01"}', '{"\\\\x01"}'],
      ["timestamptz[]", '{"2024-01-02 03:04:05+00"}', '{"2024-01-02 03:04:05+00"}'],
      ["jsonb[]", "{1}", "{1}"],
      ["uuid[]", "{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}", "{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}"],
    ];
    // A mode that decodes asks for these the other way, and execute() writes the Bind of a prepared statement.
    const otherwiseDecoded: Record<string, string> = {
      "numeric": "1.5",
      "time": "03:04:05",
      "int2[]": "0x0000000100000000000000150000000200000001000000020001000000020002",
      "float8[]": "0x0000000100000000000002bd0000000100000001000000083ff8000000000000",
    };
    type Columns = typeof columns;
    const select = (list: Columns) =>
      "select " + list.map(([type, literal], i) => `'${literal}'::${type} as c${i}`).join(", ");
    const inText = (list: Columns) => Object.fromEntries(list.map(([type, , text]) => [type, text]));
    const inBinary = (list: Columns) =>
      Object.fromEntries(list.map(([type, , text, binary]) => [type, binary ? "0x" + binary : text]));
    /** Each cell as its text, or as 0x and its bytes where it is not the text format. */
    const cells = (list: Columns, rows: Uint8Array[][]) =>
      Object.fromEntries(
        list.map(([type, , text], i) => {
          const cell = Buffer.from(rows[0][i]);
          return [type, cell.equals(Buffer.from(text)) ? text : "0x" + cell.toString("hex")];
        }),
      );

    const raw = (query: any, late: boolean): Promise<Uint8Array[][]> => (late ? query.execute().raw() : query.raw());
    type Run = (sql: SQL, text: string, late: boolean) => Promise<Uint8Array[][]>;
    const runs: [name: string, binary: boolean, prepared: boolean, run: Run][] = [
      ["the first run", false, false, (sql, text, late) => raw(template(sql, text), late)],
      [
        "the second run",
        true,
        true,
        async (sql, text, late) => {
          await template(sql, text).raw();
          return await raw(template(sql, text), late);
        },
      ],
      [
        "a run after one that decoded",
        true,
        true,
        async (sql, text, late) => {
          await template(sql, text);
          return await raw(template(sql, text), late);
        },
      ],
      // Its Bind waits for the server's parameter types.
      ["with a parameter", true, false, (sql, text, late) => raw(sql.unsafe(text + " where $1 = 1", [1]), late)],
      [
        "with a parameter, the second run",
        true,
        true,
        async (sql, text, late) => {
          await sql.unsafe(text + " where $1 = 1", [1]);
          return await raw(sql.unsafe(text + " where $1 = 1", [1]), late);
        },
      ],
      ["simple()", false, false, (sql, text, late) => raw(sql.unsafe(text).simple(), late)],
    ];
    async function session(options?: SQL.Options) {
      await container.ready;
      const sql = connect(options);
      await sql.unsafe("set time zone 'UTC'");
      return sql;
    }

    describe.each([
      ["raw()", false],
      ["execute().raw()", true],
    ])("%s", (_, late) => {
      test.each(runs)("%s", async (_, binary, prepared, run) => {
        await using sql = await session();
        const list = late && prepared ? columns.filter(([type]) => !(type in otherwiseDecoded)) : columns;
        expect(cells(list, await run(sql, select(list), late))).toEqual((binary ? inBinary : inText)(list));
      });

      test.each(runs)("prepare: false, %s", async (_, __, ___, run) => {
        await using sql = await session({ prepare: false });
        expect(cells(columns, await run(sql, select(columns), late))).toEqual(inText(columns));
      });
    });

    test.each(runs.filter(([, , prepared]) => prepared))(
      "execute().raw(), %s: the columns that a mode that decodes asks for the other way",
      async (_, __, ___, run) => {
        await using sql = await session();
        const list = columns.filter(([type]) => type in otherwiseDecoded);
        expect(cells(list, await run(sql, select(list), true))).toEqual(otherwiseDecoded);
      },
    );

    const undecodable = ["numeric", "time"];

    test("raw().execute().values() decodes what raw() asked for", async () => {
      await using sql = await session();
      const text = select(columns.filter(([type]) => !undecodable.includes(type)));
      await template(sql, text);
      const values = await template(sql, text).values();
      expect(await template(sql, text).raw().execute().values()).toEqual(values);
    });

    test.each(undecodable)("raw().execute().values() of a %s in binary has no decoder", async type => {
      await using sql = await session();
      const text = select(columns.filter(column => column[0] === type));
      await template(sql, text);
      expect(
        await template(sql, text)
          .raw()
          .execute()
          .values()
          .catch((error: any) => error.code),
      ).toBe("ERR_POSTGRES_UNKNOWN_FORMAT_CODE");
    });
  });

  // An element of an array of numbers is read by other code than a column. Three readers have to agree on every
  // value: the array's, the column's in the same format, and JS's own on the text that the server prints.
  test.each(["float4", "float8", "int4", "int2"])(
    "%s: an element of an array is the number that a column gives",
    async type => {
      await container.ready;
      await using sql = connect();

      let state = 0x2545f491;
      const random = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state >>> 0;
      };
      const edges = {
        int2: "32767 -32768 9999 -10000",
        int4: "2147483647 -2147483648 999999999 1000000000 -999999999 -1000000000",
        // 15 digits are the most that the short way takes
        float4:
          "-0 NaN Infinity -Infinity 0.1 0.2 0.3 -0.5 1e-7 1e15 1e16 1e20 16777216 1e-45 3.4028235e38 " +
          "999999999999999 9999999999999999 0.999999999999999 0.9999999999999999 123456789.012345 " +
          "9007199254740993 0.000000000000001 0.0000000000000001",
        get float8() {
          return this.float4 + " 5e-324 1.7976931348623157e308";
        },
      }[type];
      const values = ["0", "1", "-1", ...edges.split(" ")];
      const bits = new DataView(new ArrayBuffer(8));
      for (let i = 0; i < 2000; i++) {
        bits.setUint32(0, random());
        bits.setUint32(4, random());
        const anyBits = i % 2 ? NaN : type === "float8" && i % 4 ? bits.getFloat64(0) : bits.getFloat32(0);
        if (type === "int4") values.push(String((random() | 0) >> (random() % 32)));
        else if (type === "int2") values.push(String((random() << 16) >> (16 + (random() % 16))));
        else if (Number.isFinite(anyBits)) values.push(String(anyBits));
        // up to nine digits, the point anywhere among them
        else values.push(String(((random() % 10 ** (1 + (i % 9))) / 10 ** (random() % 10)) * (i % 3 ? 1 : -1)));
      }
      const quoted = values.map(value => `'${value}'`).join(",");

      // With a NULL, and without one: an int4[] and a float4[] are a typed array then, in binary.
      for (const list of ["null," + quoted, quoted]) {
        const columns = `select v, v::text as t from unnest(array[${list}]::${type}[]) with ordinality as u(v, i)`;
        for (const binary of [false, true]) {
          const rows = binary
            ? await sql.unsafe(columns + " where $1 = 1 order by i", [1])
            : await sql.unsafe(columns + " order by i").simple();
          const elements = (await paths[binary ? "second run" : "simple"](sql, `array[${list}]::${type}[]`))[0].v;
          const number = type === "float4" && binary ? (text: string) => Math.fround(Number(text)) : Number;
          expect(elements.length).toBeGreaterThan(2000);
          expect(Array.from(elements, show)).toEqual(rows.map(row => show(row.v)));
          expect(Array.from(elements, show)).toEqual(rows.map(row => show(row.t === null ? null : number(row.t))));
        }
      }
    },
  );

  // From then on every array of the realm has another storage. In a process of its own: there is no way back.
  test("an array of numbers when Array.prototype has an indexed accessor", async () => {
    await container.ready;
    const script = `
      Object.defineProperty(Array.prototype, "7", { get: () => "inherited" });
      const sql = new Bun.SQL(process.env.POSTGRES_URL, { max: 1 });
      const [{ a, b }] = await sql\`select '{1,2,3}'::int4[] as a, '{0.5,NULL}'::float8[] as b\`;
      console.log(JSON.stringify([a, b, a[7]]));
      await sql.close();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, POSTGRES_URL: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: '[[1,2,3],[0.5,null],"inherited"]\n', stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("the brackets inside an element of a json[] are not dimensions of the array", async () => {
    await container.ready;
    await using sql = connect();
    const nested = Buffer.alloc(150, "[").toString() + "1" + Buffer.alloc(150, "]").toString();
    const select = `select array['${nested}'::json] as v`;
    for (const rows of [await sql.unsafe(select).simple(), await sql.unsafe(select + " where 1 = $1", [1])]) {
      expect(JSON.stringify(rows[0].v)).toBe(`[${nested}]`);
    }
  });

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
      [`0.1::float4`, `0.10000000149011612`],
      [`'2024-01-02 03:04:05'::timestamp`, `Date(2024-01-02T03:04:05.000Z)`],
      [`'2024-01-02 03:04:05+00'::timestamptz`, `Date(2024-01-02T03:04:05.000Z)`],
      [`'\\xdead'::bytea`, `Buffer(222,173)`],
      // The binary form of these is their text.
      [`'é'::text`, `"é"`],
      [`'a'::char(3)`, `"a  "`],
      [`'{"a":1}'::json`, `{a:1}`],
      [`null::int2`, `null`],
      [`'{1,2}'::int4[]`, `Int32Array(1,2)`],
      [`'{-32768,null,32767}'::int2[]`, `[-32768,null,32767]`],
      [`'{null}'::int4[]`, `[null]`],
      [`'{}'::float8[]`, `[]`],
      [`'{{1,2},{3,null}}'::int4[]`, `[[1,2],[3,null]]`],
      [`'{{{{{{1},{2}}}}}}'::int2[]`, `[[[[[[1],[2]]]]]]`],
      [`'[0:2]={1,2,3}'::int4[]`, `Int32Array(1,2,3)`],
      [`'[-1:0][5:6]={{1,2},{3,4}}'::float8[]`, `[[1,2],[3,4]]`],
      [`'{0.1,-0,NaN,Infinity,-Infinity,1e-45,3.4028235e38,16777216,null}'::float4[]`, `[0.10000000149011612,-0,NaN,Infinity,-Infinity,1.401298464324817e-45,3.4028234663852886e+38,16777216,null]`], // prettier-ignore
      [`'{0.1,-0,NaN,-Infinity,5e-324,1.7976931348623157e308}'::float8[]`, `[0.1,-0,NaN,-Infinity,5e-324,1.7976931348623157e+308]`], // prettier-ignore
      ...[
        `5::int2`,
        `7::int8`,
        `3::oid`,
        `1.50::numeric`,
        `'2024-01-02'::date`,
        `'03:04:05'::time`,
        `'11111111-1111-1111-1111-111111111111'::uuid`,
        `'{"a":1}'::jsonb`,
        `'{1,2}'::int8[]`,
        `'{a}'::text[]`,
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
