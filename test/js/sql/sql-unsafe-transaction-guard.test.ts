// A pooled connection (max > 1) rejects a query that starts a transaction
// outside sql.begin() or sql.reserve(). The guard runs before any connection
// is attempted, so these tests need no live server: the URLs point at a closed
// port that is never dialed for a rejected query.
// https://github.com/oven-sh/bun/issues/41740
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

const adapters: [string, string, (max: number) => SQL][] = [
  [
    "postgres",
    "ERR_POSTGRES_UNSAFE_TRANSACTION",
    max => new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max }),
  ],
  ["mysql", "ERR_MYSQL_UNSAFE_TRANSACTION", max => new SQL("mysql://bun_sql_test@127.0.0.1:1/bun_sql_test", { max })],
];

describe.each(adapters)("%s unsafe transaction guard", (_adapter, code, makeSql) => {
  test("rejects BEGIN and START TRANSACTION in any case, after leading whitespace", async () => {
    await using sql = makeSql(2);
    for (const query of [
      "BEGIN",
      "begin",
      "  Begin  ",
      "\n\t begin",
      "\r\nBEGIN TRANSACTION",
      "START TRANSACTION",
      "start transaction",
      "\v\fStart Transaction read only",
      // the servers accept any whitespace between the two keywords
      "START\tTRANSACTION",
      "start  transaction",
      "START\nTRANSACTION",
    ]) {
      const err = await sql.unsafe(query).catch(e => e);
      expect(err.code, JSON.stringify(query)).toBe(code);
    }
  });

  test("does not reject other queries", async () => {
    await using sql = makeSql(2);
    for (const query of [
      "select * from beginners",
      "commit",
      "-- begin\nselect 1",
      "",
      "   ",
      "BEG",
      "start",
      "START ",
      "STARTTRANSACTION",
      "start transactio",
    ]) {
      const err = await sql.unsafe(query).catch(e => e);
      expect(err.code, JSON.stringify(query)).not.toBe(code);
    }
  });

  test("does not reject BEGIN when the pool has a single connection", async () => {
    await using sql = makeSql(1);
    const err = await sql.unsafe("begin").catch(e => e);
    expect(err.code).not.toBe(code);
  });
});
