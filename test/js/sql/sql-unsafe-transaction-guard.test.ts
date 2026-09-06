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
    ]) {
      const err = await sql.unsafe(query).catch(e => e);
      expect(err.code, JSON.stringify(query)).toBe(code);
    }
  });

  test("does not reject other queries", async () => {
    await using sql = makeSql(2);
    for (const query of ["select * from beginners", "commit", "-- begin\nselect 1", "", "   ", "BEG", "start"]) {
      const err = await sql.unsafe(query).catch(e => e);
      expect(err.code, JSON.stringify(query)).not.toBe(code);
    }
  });

  test("does not reject BEGIN when the pool has a single connection", async () => {
    await using sql = makeSql(1);
    const err = await sql.unsafe("begin").catch(e => e);
    expect(err.code).not.toBe(code);
  });

  test("cost does not grow with the query length", async () => {
    await using sql = makeSql(2);
    // Both queries reject at the guard. The long one carries 1 MiB of
    // trailing comment that the guard has no reason to read.
    const short = "begin";
    const long = "begin -- " + Buffer.alloc(1 << 20, "x").toString();
    const reject = async (query: string) => {
      const err = await sql.unsafe(query).catch(e => e);
      expect(err.code).toBe(code);
    };
    for (let i = 0; i < 20; i++) {
      await reject(short);
      await reject(long);
    }

    let shortNs = Infinity;
    let longNs = Infinity;
    for (let round = 0; round < 5; round++) {
      let start = Bun.nanoseconds();
      for (let i = 0; i < 50; i++) await reject(short);
      shortNs = Math.min(shortNs, Bun.nanoseconds() - start);

      start = Bun.nanoseconds();
      for (let i = 0; i < 50; i++) await reject(long);
      longNs = Math.min(longNs, Bun.nanoseconds() - start);
    }
    // Before the fix the guard uppercased the whole query, so the long
    // query cost around 100x the short one.
    expect(longNs / shortNs).toBeLessThan(8);
  });
});
