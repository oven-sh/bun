// https://github.com/oven-sh/bun/issues/41039
// uuid[] (OID 2951) was missing from the array type table, so a uuid[] result
// came back as the raw Postgres array literal ("{...}") instead of an array.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test("uuid[] results parse into an array of strings", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    const [{ x, y, z, w }] = await sql`select
      array['11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid] as x,
      array[]::uuid[] as y,
      array['11111111-1111-1111-1111-111111111111'::uuid, null] as z,
      array[array['11111111-1111-1111-1111-111111111111'::uuid], array['22222222-2222-2222-2222-222222222222'::uuid]] as w`;
    expect(x).toEqual(["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]);
    expect(y).toEqual([]);
    expect(z).toEqual(["11111111-1111-1111-1111-111111111111", null]);
    expect(w).toEqual([["11111111-1111-1111-1111-111111111111"], ["22222222-2222-2222-2222-222222222222"]]);
  });

  test("round-trip: uuid[] column inserted with sql.array reads back as an array", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    const uuids = ["123e4567-e89b-12d3-a456-426614174000", "550e8400-e29b-41d4-a716-446655440000"];
    const [{ x }] = await sql`select ${sql.array(uuids, "UUID")} as x`;
    expect(x).toEqual(uuids);
  });
});
