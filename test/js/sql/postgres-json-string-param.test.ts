import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// https://github.com/oven-sh/bun/issues/28819
// A string parameter bound to a json/jsonb placeholder carries the JSON text
// itself and must be sent verbatim, not re-stringified into a JSON string
// scalar. This matches node-postgres. postgres.js stringifies the string again.
describeWithContainer("postgres json string parameters", { image: "postgres_plain" }, container => {
  const options = () =>
    ({
      db: "bun_sql_test",
      username: "bun_sql_test",
      host: container.host,
      port: container.port,
      max: 1,
    }) as const;

  test("string parameter bound to ::json is sent as the JSON text itself", async () => {
    await container.ready;
    await using sql = new SQL(options());
    const payload = JSON.stringify([{ id: 1, name: "a" }]);
    const [row] = await sql`select json_typeof(${payload}::json) as kind, ${payload}::json as value`;
    expect(row).toEqual({ kind: "array", value: [{ id: 1, name: "a" }] });
  });

  test("string parameter bound to ::jsonb is sent as the JSON text itself", async () => {
    await container.ready;
    await using sql = new SQL(options());
    const payload = JSON.stringify({ a: "hello", b: 42 });
    const [row] = await sql`select jsonb_typeof(${payload}::jsonb) as kind, ${payload}::jsonb as value`;
    expect(row).toEqual({ kind: "object", value: { a: "hello", b: 42 } });
  });

  // A JS string is 8-bit or 16-bit as a whole, so two documents cover both
  // transcode arms: "café" stays Latin-1, the emoji/CJK one forces UTF-16.
  test.each([
    ["Latin-1", { name: "caf\u00e9" }],
    ["UTF-16", { name: "\u{1F680}", text: "\u4e16\u754c" }],
  ])("non-ASCII JSON text (%s) round-trips through the verbatim path", async (_label, doc) => {
    await container.ready;
    await using sql = new SQL(options());
    const payload = JSON.stringify(doc);
    const [row] = await sql`select jsonb_typeof(${payload}::jsonb) as kind, ${payload}::jsonb as value`;
    expect(row).toEqual({ kind: "object", value: doc });
  });

  test("json_to_recordset accepts a stringified array parameter", async () => {
    await container.ready;
    await using sql = new SQL(options());
    const payload = JSON.stringify([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    const rows = await sql.unsafe("select * from json_to_recordset($1::json) as x(id int, name text)", [payload]);
    expect(rows).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });

  // No cast: the column type alone makes the server report json/jsonb for the
  // parameter. This is the statement shape ORMs such as drizzle send.
  test("stringified values inserted into json and jsonb columns keep their JSON type", async () => {
    await container.ready;
    await using sql = new SQL(options());
    await sql`create temp table json_string_param (id serial primary key, j json, jb jsonb)`;
    for (const value of [{ hello: "world" }, [1, 2, 3], 42, "text", null]) {
      const text = JSON.stringify(value);
      await sql`insert into json_string_param (j, jb) values (${text}, ${text})`;
    }
    const rows = await sql`
      select json_typeof(j) as j_kind, jsonb_typeof(jb) as jb_kind, j, jb
      from json_string_param order by id`;
    expect(rows).toEqual([
      { j_kind: "object", jb_kind: "object", j: { hello: "world" }, jb: { hello: "world" } },
      { j_kind: "array", jb_kind: "array", j: [1, 2, 3], jb: [1, 2, 3] },
      { j_kind: "number", jb_kind: "number", j: 42, jb: 42 },
      { j_kind: "string", jb_kind: "string", j: "text", jb: "text" },
      { j_kind: "null", jb_kind: "null", j: null, jb: null },
    ]);
  });

  test("sql() insert helper sends stringified values verbatim", async () => {
    await container.ready;
    await using sql = new SQL(options());
    await sql`create temp table json_string_param_helper (j json, jb jsonb)`;
    const row = { j: JSON.stringify([1, 2, 3]), jb: JSON.stringify({ a: 1 }) };
    const [inserted] = await sql`insert into json_string_param_helper ${sql(row)} returning j, jb`;
    expect(inserted).toEqual({ j: [1, 2, 3], jb: { a: 1 } });
  });

  test("object parameter bound to ::json is still stringified", async () => {
    await container.ready;
    await using sql = new SQL(options());
    const [row] = await sql`select json_typeof(${{ a: 1 }}::json) as kind, ${{ a: 1 }}::json as value`;
    expect(row).toEqual({ kind: "object", value: { a: 1 } });
  });

  test("string parameter bound to ::json with prepare: false", async () => {
    await container.ready;
    await using sql = new SQL({ ...options(), prepare: false });
    const payload = JSON.stringify([{ id: 1 }]);
    const [row] = await sql`select json_typeof(${payload}::json) as kind`;
    expect(row).toEqual({ kind: "array" });
  });

  test("non-JSON string bound to ::json fails on the server", async () => {
    await container.ready;
    await using sql = new SQL(options());
    // .execute() because `expect(query).rejects` on the lazy Query hangs:
    // https://github.com/oven-sh/bun/issues/40949
    await expect(sql`select ${"not json"}::json as x`.execute()).rejects.toThrow(/invalid input syntax for type json/);
  });
});
