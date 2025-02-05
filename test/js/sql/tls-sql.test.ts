import { test, expect, mock } from "bun:test";
import { getSecret } from "harness";
import { SQL, sql, postgres } from "bun";

const TLS_POSTGRES_DATABASE_URL = getSecret("TLS_POSTGRES_DATABASE_URL");
const options = {
  url: TLS_POSTGRES_DATABASE_URL,
  tls: true,
  adapter: "postgresql",
  max: 1,
  bigint: true,
};

if (TLS_POSTGRES_DATABASE_URL) {
  test("default sql", async () => {
    expect(sql.reserve).toBeDefined();
    expect(sql.options).toBeDefined();
    expect(sql[Symbol.asyncDispose]).toBeDefined();
    expect(sql.begin).toBeDefined();
    expect(sql.beginDistributed).toBeDefined();
    expect(sql.distributed).toBeDefined();
    expect(sql.unsafe).toBeDefined();
    expect(sql.end).toBeDefined();
    expect(sql.close).toBeDefined();
    expect(sql.transaction).toBeDefined();
    expect(sql.distributed).toBeDefined();
    expect(sql.unsafe).toBeDefined();
    expect(sql.commitDistributed).toBeDefined();
    expect(sql.rollbackDistributed).toBeDefined();
  });
  test("default postgres", async () => {
    expect(postgres.reserve).toBeDefined();
    expect(postgres.options).toBeDefined();
    expect(postgres[Symbol.asyncDispose]).toBeDefined();
    expect(postgres.begin).toBeDefined();
    expect(postgres.beginDistributed).toBeDefined();
    expect(postgres.distributed).toBeDefined();
    expect(postgres.unsafe).toBeDefined();
    expect(postgres.end).toBeDefined();
    expect(postgres.close).toBeDefined();
    expect(postgres.transaction).toBeDefined();
    expect(postgres.distributed).toBeDefined();
    expect(postgres.unsafe).toBeDefined();
    expect(postgres.commitDistributed).toBeDefined();
    expect(postgres.rollbackDistributed).toBeDefined();
  });
  test("tls (explicit)", async () => {
    await using sql = new SQL(options);
    const [{ one, two }] = await sql`SELECT 1 as one, '2' as two`;
    expect(one).toBe(1);
    expect(two).toBe("2");
    await sql.close();
  });

  test("Throws on illegal transactions", async () => {
    await using sql = new SQL({ ...options, max: 2 });
    const error = await sql`BEGIN`.catch(e => e);
    return expect(error.code).toBe("ERR_POSTGRES_UNSAFE_TRANSACTION");
  });

  test("Transaction throws", async () => {
    await using sql = new SQL(options);
    await sql`CREATE TEMPORARY TABLE IF NOT EXISTS test (a int)`;
    expect(
      await sql
        .begin(async sql => {
          await sql`insert into test values(1)`;
          await sql`insert into test values('hej')`;
        })
        .catch(e => e.errno),
    ).toBe("22P02");
  });

  test("Transaction rolls back", async () => {
    await using sql = new SQL(options);
    await sql`CREATE TEMPORARY TABLE IF NOT EXISTS test (a int)`;

    await sql
      .begin(async sql => {
        await sql`insert into test values(1)`;
        await sql`insert into test values('hej')`;
      })
      .catch(() => {
        /* ignore */
      });

    expect((await sql`select a from test`).count).toBe(0);
  });

  test("Transaction throws on uncaught savepoint", async () => {
    await using sql = new SQL(options);
    await sql`CREATE TEMPORARY TABLE IF NOT EXISTS test (a int)`;
    expect(
      await sql
        .begin(async sql => {
          await sql`insert into test values(1)`;
          await sql.savepoint(async sql => {
            await sql`insert into test values(2)`;
            throw new Error("fail");
          });
        })
        .catch(err => err.message),
    ).toBe("fail");
  });

  test("Transaction throws on uncaught named savepoint", async () => {
    await using sql = new SQL(options);
    await sql`CREATE TEMPORARY TABLE IF NOT EXISTS test (a int)`;
    expect(
      await sql
        .begin(async sql => {
          await sql`insert into test values(1)`;
          await sql.savepoit("watpoint", async sql => {
            await sql`insert into test values(2)`;
            throw new Error("fail");
          });
        })
        .catch(() => "fail"),
    ).toBe("fail");
  });

  test("Transaction succeeds on caught savepoint", async () => {
    await using sql = new SQL(options);
    const table_id = `test_random${Bun.randomUUIDv7().toString().replace(/-/g, "_")}`;
    await sql`CREATE TABLE IF NOT EXISTS ${sql(table_id)} (a int)`;
    try {
      await sql.begin(async sql => {
        await sql`insert into ${sql(table_id)} values(1)`;
        await sql
          .savepoint(async sql => {
            await sql`insert into ${sql(table_id)} values(2)`;
            throw new Error("please rollback");
          })
          .catch(() => {
            /* ignore */
          });
        await sql`insert into ${sql(table_id)} values(3)`;
      });
      expect((await sql`select count(1) from ${sql(table_id)}`)[0].count).toBe(2n);
    } finally {
      await sql`DROP TABLE IF EXISTS ${sql(table_id)}`;
    }
  });

  test("Savepoint returns Result", async () => {
    let result;
    await using sql = new SQL(options);
    await sql.begin(async t => {
      result = await t.savepoint(s => s`select 1 as x`);
    });
    expect(result[0]?.x).toBe(1);
  });

  test("Transaction requests are executed implicitly", async () => {
    await using sql = new SQL(options);
    expect(
      (
        await sql.begin(sql => [
          sql`select set_config('bun_sql.test', 'testing', true)`,
          sql`select current_setting('bun_sql.test') as x`,
        ])
      )[1][0].x,
    ).toBe("testing");
  });

  test("Uncaught transaction request errors bubbles to transaction", async () => {
    await using sql = new SQL(options);
    expect(
      await sql
        .begin(sql => [sql`select wat`, sql`select current_setting('bun_sql.test') as x, ${1} as a`])
        .catch(e => e.errno || e),
    ).toBe("42703");
  });

  test("Transaction rejects with rethrown error", async () => {
    await using sql = new SQL(options);
    expect(
      await sql
        .begin(async sql => {
          try {
            await sql`select exception`;
          } catch (ex) {
            throw new Error("WAT");
          }
        })
        .catch(e => e.message),
    ).toBe("WAT");
  });

  test("Parallel transactions", async () => {
    await using sql = new SQL({ ...options, max: 2 });

    expect(
      (await Promise.all([sql.begin(sql => sql`select 1 as count`), sql.begin(sql => sql`select 1 as count`)]))
        .map(x => x[0].count)
        .join(""),
    ).toBe("11");
  });

  test("Many transactions at beginning of connection", async () => {
    await using sql = new SQL({ ...options, max: 2 });
    const xs = await Promise.all(Array.from({ length: 30 }, () => sql.begin(sql => sql`select 1`)));
    return expect(xs.length).toBe(30);
  });

  test("Transactions array", async () => {
    await using sql = new SQL(options);
    await sql`CREATE TEMPORARY TABLE IF NOT EXISTS test (a int)`;
    expect(
      (await sql.begin(sql => [sql`select 1 as count`, sql`select 1 as count`])).map(x => x[0].count).join(""),
    ).toBe("11");
  });

  test("Transaction waits", async () => {
    await using sql = new SQL({ ...options, max: 2 });
    await sql`CREATE TEMPORARY TABLE IF NOT EXISTS test (a int)`;
    await sql.begin(async sql => {
      await sql`insert into test values(1)`;
      await sql
        .savepoint(async sql => {
          await sql`insert into test values(2)`;
          throw new Error("please rollback");
        })
        .catch(() => {
          /* ignore */
        });
      await sql`insert into test values(3)`;
    });
    expect(
      (
        await Promise.all([
          sql.begin(async sql => await sql`select 1 as count`),
          sql.begin(async sql => await sql`select 1 as count`),
        ])
      )
        .map(x => x[0].count)
        .join(""),
    ).toBe("11");
  });
}
