// Degenerate inputs to the sql() helpers (null/undefined items where objects
// are expected, update objects with no defined values) must surface clear
// validation errors from query normalization rather than raw TypeErrors or
// engine syntax errors. The validation contract is identical across the three
// adapters, so it is tested as one matrix. Normalization runs when a query is
// first awaited, before any connection is attempted, so the postgres and
// mysql rows need no live server: their URLs point at a closed port that is
// never actually dialed. The sqlite row uses an in-memory database.
// https://github.com/oven-sh/bun/issues/32155
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

const adapters: [string, () => SQL][] = [
  ["sqlite", () => new SQL("sqlite://:memory:")],
  ["postgres", () => new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 })],
  ["mysql", () => new SQL("mysql://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 })],
];

describe.each(adapters)("%s helper validation", (_adapter, makeSql) => {
  test("null items in WHERE IN helper with a column are rejected", async () => {
    await using sql = makeSql();
    for (const items of [[null], [{ id: 1 }, null]]) {
      const err = await sql`SELECT * FROM t WHERE id IN ${sql(items as any, "id")}`.catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Cannot use null as an item in WHERE IN helper with a column");
    }
  });

  test("null and undefined items in INSERT helper are rejected", async () => {
    await using sql = makeSql();
    for (const item of [null, undefined]) {
      const err = await sql`INSERT INTO t ${sql([{ id: 1 }, item as any])}`.catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Cannot use null or undefined as an item in INSERT helper");
    }
  });

  test("null and undefined items in UPDATE helper are rejected", async () => {
    await using sql = makeSql();
    const err1 = await sql`UPDATE t SET ${sql(null as any, "name")} WHERE id = 1`.catch(e => e);
    expect(err1).toBeInstanceOf(SyntaxError);
    expect(err1.message).toBe("Cannot use null or undefined as an item in UPDATE helper");

    const err2 = await sql`UPDATE t SET ${sql([undefined as any], "name")} WHERE id = 1`.catch(e => e);
    expect(err2).toBeInstanceOf(SyntaxError);
    expect(err2.message).toBe("Cannot use null or undefined as an item in UPDATE helper");
  });

  test("empty update helper throws regardless of SET casing", async () => {
    await using sql = makeSql();
    for (const query of [
      () => sql`update t set ${sql({ name: undefined })} where id = 1`,
      () => sql`UPDATE t SET ${sql({ name: undefined })} WHERE id = 1`,
      // the helper emits SET itself when the query does not end with one
      () => sql`update t ${sql({ name: undefined })} where id = 1`,
    ]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Update needs to have at least one column");
    }
  });

  test("empty update helper throws even alongside a literal assignment", async () => {
    // sqlite previously allowed the helper-last form of this (it stripped the
    // trailing comma and executed the literal assignment) while throwing for
    // the helper-first form; postgres and mysql throw for both. All three now
    // throw for both orders.
    await using sql = makeSql();
    for (const query of [
      () => sql`UPDATE t SET updated_at = CURRENT_TIMESTAMP, ${sql({ name: undefined })} WHERE id = 1`,
      () => sql`UPDATE t SET ${sql({ name: undefined })}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    ]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Update needs to have at least one column");
    }
  });
});

// Behaviors that must keep working; these execute real queries, so they run
// against sqlite only.
describe("sqlite helper behavior preserved", () => {
  test("update helper with lowercase set and defined values still works", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, age INT)`;
    await sql`INSERT INTO t ${sql({ id: 1, name: "John", age: 30 })}`;

    await sql`update t set ${sql({ name: "Mary", age: undefined })} where id = 1`;
    expect(await sql`SELECT * FROM t`).toEqual([{ id: 1, name: "Mary", age: 30 }]);
  });

  test("update helper alongside a literal assignment still works with defined values", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, flag INT)`;
    await sql`INSERT INTO t (id, name, flag) VALUES (1, 'John', 0)`;

    await sql`UPDATE t SET flag = 1, ${sql({ name: "Mary", age: undefined })} WHERE id = 1`;
    expect(await sql`SELECT * FROM t`).toEqual([{ id: 1, name: "Mary", flag: 1 }]);
  });

  test("undefined items and null column values in WHERE IN helper still bind NULL", async () => {
    await using sql = new SQL("sqlite://:memory:");
    // an undefined item binds NULL
    expect(await sql`SELECT 1 as num WHERE 1 IN ${sql([undefined as any, { id: 1 }], "id")}`).toEqual([{ num: 1 }]);
    // a null value under the column key binds NULL
    expect(await sql`SELECT 1 as num WHERE 1 IN ${sql([{ id: null }, { id: 1 }], "id")}`).toEqual([{ num: 1 }]);
    // a null item without a column binds NULL
    expect(await sql`SELECT 1 as num WHERE 1 IN ${sql([null, 1])}`).toEqual([{ num: 1 }]);
  });
});
