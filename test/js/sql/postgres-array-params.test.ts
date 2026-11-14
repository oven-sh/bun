// Every row reads back `x::text`, so the expectation is what the server stored and not how Bun decodes it.
import { SQL, randomUUIDv7 } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

const raw = String.raw;

// label, array type, value, what the server stores
const cases: [string, string, any, string][] = [
  ["text", "text[]", ["a", "b"], "{a,b}"],
  ["text, null", "text[]", ["a", null, "b"], "{a,NULL,b}"],
  ["text, undefined", "text[]", ["a", undefined, "b"], "{a,NULL,b}"],
  ["text, hole", "text[]", ["a", , "b"], "{a,NULL,b}"],
  ["text, the word null", "text[]", ["null", "NULL"], '{"null","NULL"}'],
  [
    "text, specials",
    "text[]",
    ['q"uote', "back\\slash", "com,ma", "{brace}", "", " sp ", "é中\u{1f600}"],
    raw`{"q\"uote","back\\slash","com,ma","{brace}",""," sp ",` + "é中\u{1f600}}",
  ],
  ["text, empty", "text[]", [], "{}"],
  [
    "text, nested",
    "text[]",
    [
      ["a", "b"],
      ["c", "d"],
    ],
    "{{a,b},{c,d}}",
  ],
  ["text, numbers", "text[]", [1, 2.5], "{1,2.5}"],
  ["int4", "int4[]", [1, 2, 3], "{1,2,3}"],
  ["int4, null", "int4[]", [1, null, 3], "{1,NULL,3}"],
  [
    "int4, nested",
    "int4[]",
    [
      [1, 2],
      [3, 4],
    ],
    "{{1,2},{3,4}}",
  ],
  ["int4, empty", "int4[]", [], "{}"],
  ["int4, strings", "int4[]", ["1", "2"], "{1,2}"],
  ["int2", "int2[]", [1, 2], "{1,2}"],
  ["int8, numbers", "int8[]", [1, 9007199254740991], "{1,9007199254740991}"],
  ["int8, bigint", "int8[]", [1n, 9223372036854775807n], "{1,9223372036854775807}"],
  ["float4", "float4[]", [1.5, 2.25], "{1.5,2.25}"],
  ["float8, specials", "float8[]", [1.5, NaN, Infinity, -Infinity, -0], "{1.5,NaN,Infinity,-Infinity,0}"],
  ["numeric", "numeric[]", [1.5, "123456789012345678901234567890.5"], "{1.5,123456789012345678901234567890.5}"],
  ["bool", "bool[]", [true, false, null], "{t,f,NULL}"],
  ["uuid", "uuid[]", ["a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"], "{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}"],
  ["date", "date[]", ["2024-01-02"], "{2024-01-02}"],
  [
    "timestamptz, Date",
    "timestamptz[]",
    [new Date(0), new Date(1700000000123)],
    '{"1970-01-01 00:00:00+00","2023-11-14 22:13:20.123+00"}',
  ],
  ["timestamp, Date", "timestamp[]", [new Date(0)], '{"1970-01-01 00:00:00"}'],
  ["bytea, Buffer", "bytea[]", [Buffer.from([0, 1, 255, 92, 34])], raw`{"\\x0001ff5c22"}`],
  ["bytea, Uint8Array", "bytea[]", [new Uint8Array([1, 2, 44])], raw`{"\\x01022c"}`],
  ["bytea, DataView", "bytea[]", [new DataView(new Uint8Array([1, 2, 3]).buffer, 1)], raw`{"\\x0203"}`],
  ["bytea, ArrayBuffer", "bytea[]", [new Uint8Array([7]).buffer], raw`{"\\x07"}`],
  ["json", "json[]", [{ a: 1 }, "s", 1, true, null, undefined], raw`{"{\"a\":1}","\"s\"",1,true,"null",NULL}`],
  [
    "json, nested",
    "json[]",
    [
      [1, "a"],
      [{ b: 2 }, null],
    ],
    raw`{{1,"\"a\""},{"{\"b\":2}","null"}}`,
  ],
  ["jsonb", "jsonb[]", [{ a: 'q"' }, "s"], raw`{"{\"a\": \"q\\\"\"}","\"s\""}`],
  ["Int32Array", "int4[]", new Int32Array([100, 200]), "{100,200}"],
  ["Float32Array", "float4[]", new Float32Array([1.5, 2.5]), "{1.5,2.5}"],
  ["Float64Array", "float8[]", new Float64Array([1.5, 2.5]), "{1.5,2.5}"],
  ["BigInt64Array", "int8[]", new BigInt64Array([1n, 2n]), "{1,2}"],
  ["Int32Array into text", "text[]", new Int32Array([100, 200]), "{100,200}"],
  ["inet", "inet[]", ["127.0.0.1", "10.0.0.0/8"], "{127.0.0.1,10.0.0.0/8}"],
  ["box", "box[]", ["(1,1),(0,0)", "(3,3),(2,2)"], "{(1,1),(0,0);(3,3),(2,2)}"],
  ["interval", "interval[]", ["1 day", "2 hours"], '{"1 day",02:00:00}'],
  ["varchar(3)", "varchar(3)[]", ["abc"], "{abc}"],
];
const expected = Object.fromEntries(cases.map(([label, , , stored]) => [label, stored]));
// Every typed array but Int32Array is its bytes: sql.array() makes an array of it.
const bytes = ["Float32Array", "Float64Array", "BigInt64Array"];
const bare = cases.filter(([label]) => !bytes.includes(label));
const expectedBare = Object.fromEntries(bare.map(([label, , , stored]) => [label, stored]));
const elementType = (type: string) => type.slice(0, -2);

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  beforeAll(() => container.ready);

  async function connect(options: Bun.SQL.Options = {}) {
    const sql = new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, {
      max: 1,
      ...options,
    });
    await sql`set time zone 'UTC'`;
    return { sql, [Symbol.asyncDispose]: () => sql.close() };
  }

  // One statement binds every case, each as its own parameter and column: a table costs one round trip.
  type Case = (typeof cases)[number];
  const byLabel = (rows: any[], list: Case[] = cases) =>
    Object.fromEntries(list.map(([label], i) => [label, rows[0]["c" + i]]));
  const selectEach = (sql: SQL, expression: (type: string, value: any) => any, list: Case[] = cases) =>
    sql`select ${list.reduce(
      (columns, [, type, value], i) =>
        sql`${columns}${i === 0 ? sql`` : sql`,`} (${expression(type, value)})::text as ${sql("c" + i)}`,
      sql``,
    )}`;

  async function tableWithOneColumnPerCase(sql: SQL) {
    const name = "arr_" + randomUUIDv7("hex").replaceAll("-", "");
    await sql.unsafe(`create temporary table ${name} (${cases.map(([, type], i) => `c${i} ${type}`).join(", ")})`);
    return name;
  }
  const everyColumnAsText = cases.map((_, i) => `c${i}::text`).join(", ");

  describe("every element type", () => {
    test("sql.array(values, type)", async () => {
      await using db = await connect();
      const { sql } = db;
      expect(byLabel(await selectEach(sql, (type, value) => sql.array(value, elementType(type))))).toEqual(expected);
    });

    test("sql.array(values): the context gives the type", async () => {
      await using db = await connect();
      const { sql } = db;
      const cast = (type: string, value: any) => sql`${sql.array(value)}::${sql.unsafe(type)}`;
      // these three are written differently when the type is known
      const needTheType = ["json", "json, nested", "jsonb", "box"];
      const others = cases.filter(([label]) => !needTheType.includes(label));
      expect(byLabel(await selectEach(sql, cast, others), others)).toEqual(
        Object.fromEntries(others.map(([label, , , stored]) => [label, stored])),
      );
      for (const one of cases.filter(([label]) => needTheType.includes(label))) {
        expect(await selectEach(sql, cast, [one]).catch(e => e.errno)).toBe("22P02");
      }
    });

    test.each([
      ["prepared", {}],
      ["prepare: false", { prepare: false }],
    ])("a plain array, %s", async (_, options) => {
      await using db = await connect(options);
      const { sql } = db;
      expect(byLabel(await selectEach(sql, (type, value) => sql`${value}::${sql.unsafe(type)}`, bare), bare)).toEqual(
        expectedBare,
      );
    });

    test.each(cases.filter(([label]) => bytes.includes(label)))("a %s is bytea", async (_, type, value) => {
      await using db = await connect();
      const { sql } = db;
      expect(await sql`select ${value} as x`).toEqual([{ x: Buffer.from(value.buffer) }]);
      expect(await sql`select ${value}::${sql.unsafe(type)} as x`.catch(error => error.errno)).toBe("42846");
    });

    test("a plain array in sql.unsafe()", async () => {
      await using db = await connect();
      const { sql } = db;
      const text = "select " + bare.map(([, type], i) => `($${i + 1}::${type})::text as c${i}`).join(", ");
      expect(
        byLabel(
          await sql.unsafe(
            text,
            bare.map(([, , value]) => value),
          ),
          bare,
        ),
      ).toEqual(expectedBare);
    });

    test("sql({ column: values })", async () => {
      await using db = await connect();
      const { sql } = db;
      const table = sql(await tableWithOneColumnPerCase(sql));
      const row = Object.fromEntries(
        cases.map(([label, , value], i) => ["c" + i, bytes.includes(label) ? null : value]),
      );
      expect(byLabel(await sql`insert into ${table} ${sql(row)} returning ${sql.unsafe(everyColumnAsText)}`)).toEqual({
        ...expected,
        ...Object.fromEntries(bytes.map(label => [label, null])),
      });
    });

    test("sql({ column: sql.array(values, type) })", async () => {
      await using db = await connect();
      const { sql } = db;
      const table = sql(await tableWithOneColumnPerCase(sql));
      await sql`insert into ${table} (c0) values (null)`;
      const row = Object.fromEntries(cases.map(([, type, value], i) => ["c" + i, sql.array(value, elementType(type))]));
      expect(byLabel(await sql`update ${table} set ${sql(row)} returning ${sql.unsafe(everyColumnAsText)}`)).toEqual(
        expected,
      );
    });
  });

  describe("an array of JSON", () => {
    test.each<[unknown[], string]>([
      [[1, null], '{1,"null"}'],
      [[undefined], "{NULL}"],
      [[[null]], '{{"null"}}'],
      [[[1]], "{{1}}"],
      [[[1], [2]], "{{1},{2}}"],
      [[[{ a: 1 }]], raw`{{"{\"a\": 1}"}}`],
    ])("%p: null is a JSON value, a nested array a dimension", async (values, stored) => {
      await using db = await connect();
      expect(await db.sql`select ${db.sql.array(values, "JSONB")}::text as x`).toEqual([{ x: stored }]);
    });

    test.each<[unknown[]]>([[[[1], [2, 3]]], [[[1], 2]], [[[]]]])("%p has no dimensions", async values => {
      await using db = await connect();
      expect(await db.sql`select ${db.sql.array(values, "JSONB")} as x`.catch(error => error.errno)).toBe("22P02");
    });

    test("sql.json() makes one element of an array", async () => {
      await using db = await connect();
      const { sql } = db;
      expect(await sql`select ${sql.array([sql.json([1, 2]), sql.json([]), { a: 1 }], "JSONB")}::text as x`).toEqual([
        { x: raw`{"[1, 2]",[],"{\"a\": 1}"}` },
      ]);
    });

    test("a plain array is written the same way", async () => {
      await using db = await connect();
      expect(
        await db.sql`select ${[1, null, undefined]}::jsonb[]::text as flat, ${[[1], [null]]}::jsonb[]::text as nested`,
      ).toEqual([{ flat: '{1,"null",NULL}', nested: '{{1},{"null"}}' }]);
    });
  });

  test("the type argument", async () => {
    await using db = await connect();
    const { sql } = db;
    const describeParameter = ({ serializedValues, arrayType }: any) => ({ serializedValues, arrayType });
    expect({
      name: describeParameter(sql.array(["a", null, 'q"'], "text")),
      none: describeParameter(sql.array([1, 2])),
      arrayOid: describeParameter(sql.array([1, 2], 1007)),
      uuidOid: describeParameter(sql.array([], 2951)),
      // an element OID, or any number that is no array type, says nothing
      elementOid: describeParameter(sql.array([1, 2], 23)),
    }).toEqual({
      name: { serializedValues: raw`{"a",NULL,"q\""}`, arrayType: "TEXT" },
      none: { serializedValues: '{"1","2"}', arrayType: undefined },
      arrayOid: { serializedValues: '{"1","2"}', arrayType: "INTEGER" },
      uuidOid: { serializedValues: "{}", arrayType: "UUID" },
      elementOid: { serializedValues: '{"1","2"}', arrayType: undefined },
    });
  });

  test("an untyped sql.array() takes the type of the column or of the other operand", async () => {
    await using db = await connect();
    const { sql } = db;
    const mood = "mood_" + randomUUIDv7("hex").replaceAll("-", "");
    await sql.unsafe(`create type ${mood} as enum ('sad', 'ok', 'happy')`);
    try {
      await sql.unsafe(
        `create temporary table tags (id int, items text[], ints int[], ids uuid[], days date[], moods ${mood}[])`,
      );
      const uuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
      await sql`insert into tags (id, items, ints, ids, days, moods) values (
        2,
        ${sql.array(["red", "blue", "green"])},
        ${sql.array([1, 2])},
        ${sql.array([uuid])},
        ${sql.array(["2024-01-02"])},
        ${sql.array(["ok", "happy"])}
      )`;
      expect(
        await sql`select items::text, ints::text, ids::text, days::text, moods::text from tags
          where id = any(${sql.array([1, 2, 3])}) and ${uuid}::uuid = any(ids) and 'red' = any(items)`,
      ).toEqual([
        { items: "{red,blue,green}", ints: "{1,2}", ids: `{${uuid}}`, days: "{2024-01-02}", moods: "{ok,happy}" },
      ]);

      // a plain array goes by the server's type too, when that is a built-in array type
      await sql`update tags set ${sql({ moods: sql.array(["sad"]), items: ["x"] })}`;
      expect(await sql`select moods::text, items::text from tags where id = any(${[2, 3]})`).toEqual([
        { moods: "{sad}", items: "{x}" },
      ]);
      // the OID of any other type does not say whether it is one: String(value)
      expect(await sql`update tags set ${sql({ moods: ["sad"] })}`.catch(error => error.errno)).toBe("22P02");
    } finally {
      await sql.unsafe(`drop table if exists tags; drop type ${mood}`);
    }
  });

  test("an untyped sql.array() without any context is text, or an error that asks for the type", async () => {
    await using db = await connect();
    const { sql } = db;
    expect(await sql`select ${sql.array([1, 2])} as x`).toEqual([{ x: '{"1","2"}' }]);
    expect(await sql`select unnest(${sql.array([1, 2])}) as x`.catch(e => e.message)).toBe(
      "function unnest(unknown) is not unique",
    );
    expect(await sql`select unnest(${sql.array([1, 2], "int")}) as x`).toEqual([{ x: 1 }, { x: 2 }]);
  });

  test("what cannot be written is an error, never a wrong value", async () => {
    await using db = await connect();
    const { sql } = db;
    expect(() => sql.array([new Date(NaN)], "timestamptz")).toThrow(RangeError);
    const cyclic: any[] = [];
    cyclic.push(cyclic);
    expect(() => sql.array(cyclic, "int")).toThrow(RangeError);
    expect(await sql`select ${[new Date(NaN)]}::timestamptz[] as x`.catch(e => e)).toBeInstanceOf(RangeError);
    expect(await sql`select ${cyclic}::int[] as x`.catch(e => e)).toBeInstanceOf(RangeError);
    // seven dimensions: the server's own limit is six
    expect(await sql`select ${sql.array([[[[[[[1]]]]]]], "int")} as x`.catch(e => e.errno)).toBe("54000");
    expect(await sql`select ${sql.array([Buffer.from("a")], "int")} as x`.catch(e => e.errno)).toBe("22P02");
    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
  });
});
