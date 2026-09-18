// Postgres array_out prints the dimension bounds in front of the body when a
// lower bound is not 1: `[0:2]={1,2,3}`. The system catalogs produce such
// arrays (int2vector and oidvector start at 0, so `pg_index.indkey::int2[]`
// arrives this way), and so does a slice assignment like `a[0:1] = '{1,2}'`.
// The text decoder must skip the `[lo:hi]...=` prefix and return the elements.
// Queries with no parameters use the text format.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = async () => {
    await container.ready;
    return new SQL({ url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, max: 1 });
  };

  test("text[] with explicit bounds", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:2]={a,b,c}'::text[] as v`;
    expect(row.v).toEqual(["a", "b", "c"]);
  });

  test("int4[] with explicit bounds", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:2]={1,2,3}'::int4[] as v`;
    expect(row.v).toEqual([1, 2, 3]);
  });

  test("float8[] with explicit bounds", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:2]={1.5,2,3}'::float8[] as v`;
    expect(row.v).toEqual([1.5, 2, 3]);
  });

  test("multi-dimensional array with explicit bounds", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:1][0:1]={{1,2},{3,4}}'::int4[] as v`;
    expect(row.v).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("bounded and unbounded arrays in one row", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:0]={1}'::int4[] as v, '{4}'::int4[] as w, ARRAY[]::int4[] as e`;
    expect(row).toEqual({ v: [1], w: [4], e: [] });
  });

  test("catalog int2vector column cast to int2[]", async () => {
    await using sql = await connect();
    const [row] = await sql`
      SELECT indkey::int2[] as v
      FROM pg_index
      WHERE indexrelid = 'pg_class_oid_index'::regclass
    `;
    expect(row.v).toEqual([1]);
  });
});
