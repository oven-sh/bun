import { SQL } from "bun";
import { beforeEach, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// https://github.com/oven-sh/bun/issues/28819
//
// Pre-stringified JSON values bound as template literal parameters were being
// JSON.stringified a second time before being sent to Postgres, so json/jsonb
// columns always stored the value as a JSON string rather than the intended
// object/array/number.

describeWithContainer(
  "issue 28819",
  {
    image: "postgres_plain",
    env: {},
    concurrent: true,
    args: [],
  },
  container => {
    let databaseUrl: string;
    beforeEach(async () => {
      await container.ready;
      databaseUrl = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
    });

    test("strings bound to ::json are not double-encoded", async () => {
      await using sql = new SQL(databaseUrl);

      await sql`DROP TABLE IF EXISTS test_json_28819`;
      await sql`CREATE TABLE test_json_28819 (id serial PRIMARY KEY, value json)`;

      try {
        await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify({ hello: "world" })}::json)`;
        await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify([1, 2, 3])}::json)`;
        await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify(42)}::json)`;
        await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify("bare string")}::json)`;
        await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify(null)}::json)`;
        await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify(true)}::json)`;

        const rows = await sql`SELECT id, value, json_typeof(value) as type FROM test_json_28819 ORDER BY id`;
        expect(rows).toEqual([
          { id: 1, value: { hello: "world" }, type: "object" },
          { id: 2, value: [1, 2, 3], type: "array" },
          { id: 3, value: 42, type: "number" },
          { id: 4, value: "bare string", type: "string" },
          { id: 5, value: null, type: "null" },
          { id: 6, value: true, type: "boolean" },
        ]);
      } finally {
        await sql`DROP TABLE IF EXISTS test_json_28819`;
      }
    });

    test("strings bound to ::jsonb are not double-encoded", async () => {
      await using sql = new SQL(databaseUrl);

      await sql`DROP TABLE IF EXISTS test_jsonb_28819`;
      await sql`CREATE TABLE test_jsonb_28819 (id serial PRIMARY KEY, value jsonb)`;

      try {
        await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify({ hello: "world" })}::jsonb)`;
        await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify([1, 2, 3])}::jsonb)`;
        await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify(42)}::jsonb)`;
        await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify("bare string")}::jsonb)`;
        await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify(null)}::jsonb)`;
        await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify(true)}::jsonb)`;

        const rows = await sql`SELECT id, value, jsonb_typeof(value) as type FROM test_jsonb_28819 ORDER BY id`;
        expect(rows).toEqual([
          { id: 1, value: { hello: "world" }, type: "object" },
          { id: 2, value: [1, 2, 3], type: "array" },
          { id: 3, value: 42, type: "number" },
          { id: 4, value: "bare string", type: "string" },
          { id: 5, value: null, type: "null" },
          { id: 6, value: true, type: "boolean" },
        ]);
      } finally {
        await sql`DROP TABLE IF EXISTS test_jsonb_28819`;
      }
    });

    test("non-string values bound to ::json are still serialized", async () => {
      await using sql = new SQL(databaseUrl);

      // Objects and arrays should still be JSON.stringified when passed directly.
      const obj = (await sql`SELECT ${{ a: "hello", b: 42 }}::json as x`)[0].x;
      expect(obj).toEqual({ a: "hello", b: 42 });

      const arr = (await sql`SELECT ${[1, 2, 3]}::json as x`)[0].x;
      expect(arr).toEqual([1, 2, 3]);
    });
  },
);
