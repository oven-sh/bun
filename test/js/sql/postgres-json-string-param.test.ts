import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// https://github.com/oven-sh/bun/issues/40942
// A string parameter bound to a json/jsonb placeholder carries the JSON text
// itself and must be sent verbatim, not re-stringified into a JSON string
// scalar. This matches node-postgres and postgres.js.
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
