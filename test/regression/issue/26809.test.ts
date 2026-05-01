// https://github.com/oven-sh/bun/issues/26809
// Expose column type metadata (OIDs) on PostgreSQL query results.
import { randomUUIDv7, SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { isDockerEnabled } from "harness";
import * as dockerCompose from "../../docker/index.ts";

async function getPostgresURL(): Promise<string | null> {
  if (isDockerEnabled()) {
    const info = await dockerCompose.ensure("postgres_plain");
    return `postgres://bun_sql_test@${info.host}:${info.ports[5432]}/bun_sql_test`;
  }
  return process.env.DATABASE_URL || null;
}

const url = await getPostgresURL();

describe.skipIf(!url)("issue #26809: expose column metadata on SQL results", () => {
  const sql = new SQL(url!, { max: 1 });

  afterAll(async () => {
    await sql.end();
  });

  test("columns has name and type OID", async () => {
    const result = await sql`select 1::int4 as id, 'hi'::text as msg`;
    expect(result.columns).toEqual([
      { name: "id", type: 23, table: 0, number: 0 },
      { name: "msg", type: 25, table: 0, number: 0 },
    ]);
  });

  test("distinguishes jsonb from text[]", async () => {
    const result = await sql`select '["a","b"]'::jsonb as data, ARRAY['a','b']::text[] as tags`;
    // Both JS values are arrays, but the type OIDs differ:
    expect(result[0].data).toEqual(["a", "b"]);
    expect(result[0].tags).toEqual(["a", "b"]);
    expect(result.columns.map(c => ({ name: c.name, type: c.type }))).toEqual([
      { name: "data", type: 3802 }, // jsonb
      { name: "tags", type: 1009 }, // text[]
    ]);
  });

  test("unsafe() result has columns", async () => {
    const result = await sql.unsafe("select 1 as x");
    expect(result.columns[0]).toEqual({ name: "x", type: 23, table: 0, number: 0 });
  });

  test(".values() result has columns", async () => {
    const result = await sql`select 1 as x, 2 as y`.values();
    expect(result.columns.map(c => c.name)).toEqual(["x", "y"]);
  });

  test(".raw() result has columns", async () => {
    const result = await sql`select 1 as x`.raw();
    expect(result.columns[0].name).toBe("x");
  });

  test(".simple() result has columns", async () => {
    const result = await sql`select 1 as x`.simple();
    expect(result.columns[0]).toEqual({ name: "x", type: 23, table: 0, number: 0 });
  });

  test("multi-statement simple() has per-result columns", async () => {
    const results = await sql`select 1 as a; select 'x'::text as b, 2::int4 as c`.simple();
    expect(results[0].columns.map(c => c.name)).toEqual(["a"]);
    expect(results[1].columns.map(c => c.name)).toEqual(["b", "c"]);
    expect(results[1].columns.map(c => c.type)).toEqual([25, 23]);
  });

  test("columns is populated for table columns with table OID", async () => {
    const table = "columns_meta_" + randomUUIDv7("hex").replaceAll("-", "");
    await sql`create table ${sql(table)} (id int4 primary key, name text)`;
    try {
      await sql`insert into ${sql(table)} values (1, 'a')`;
      const result = await sql`select id, name from ${sql(table)}`;
      expect(result.columns.map(c => c.name)).toEqual(["id", "name"]);
      expect(result.columns[0].type).toBe(23);
      expect(result.columns[1].type).toBe(25);
      expect(result.columns[0].table).toBeGreaterThan(0);
      expect(result.columns[0].table).toBe(result.columns[1].table);
      expect(result.columns[0].number).toBe(1);
      expect(result.columns[1].number).toBe(2);
    } finally {
      await sql`drop table ${sql(table)}`;
    }
  });

  test("duplicate column names are preserved in columns", async () => {
    const result = await sql`select 1 as x, 2 as x`.values();
    expect(result.columns.map(c => c.name)).toEqual(["x", "x"]);
    expect(result.columns.map(c => c.type)).toEqual([23, 23]);
    expect(result[0]).toEqual([1, 2]);
  });

  test("columns is an empty array for commands with no columns", async () => {
    const table = "columns_empty_" + randomUUIDv7("hex").replaceAll("-", "");
    const result = await sql`create table ${sql(table)} (id int)`;
    try {
      expect(result.columns).toEqual([]);
    } finally {
      await sql`drop table ${sql(table)}`;
    }
  });

  test("statement has string and columns", async () => {
    const result = await sql`select 1 as x`;
    expect(result.statement.string).toBe("select 1 as x");
    expect(result.statement.columns).toBe(result.columns);
  });

  test("statement.string reflects parameterized query", async () => {
    const result = await sql`select ${"TEST"}::text as x`;
    expect(result.statement.string).toBe("select $1 ::text as x");
    expect(result.columns[0].type).toBe(25);
  });

  test("columns and statement don't break Array iteration", async () => {
    const result = await sql`select 1 as x`;
    // .map() / iteration should not produce extra entries from metadata
    expect(result.map(r => r.x)).toEqual([1]);
    expect(Array.from(result)).toEqual([{ x: 1 }]);
    expect(result.length).toBe(1);
  });
});
