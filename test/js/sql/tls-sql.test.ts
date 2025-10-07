import { postgres, randomUUIDv7, SQL, sql } from "bun";
import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";

const TLS_POSTGRES_DATABASE_URL = getSecret("TLS_POSTGRES_DATABASE_URL");
const PG_TRANSACTION_POOL_SUPABASE_URL = getSecret("PG_TRANSACTION_POOL_SUPABASE_URL");

for (const options of [
  {
    url: TLS_POSTGRES_DATABASE_URL,
    tls: true,
    adapter: "postgres",
    max: 1,
    bigint: true,
    prepare: true,
    transactionPool: false,
  },
  {
    url: PG_TRANSACTION_POOL_SUPABASE_URL,
    tls: true,
    adapter: "postgres",
    max: 1,
    bigint: true,
    prepare: false,
    transactionPool: true,
  },
  {
    url: TLS_POSTGRES_DATABASE_URL,
    tls: true,
    adapter: "postgres",
    max: 1,
    bigint: true,
    prepare: false,
    transactionPool: false,
  },
] satisfies (Bun.SQL.Options & { transactionPool?: boolean })[]) {
  if (options.url === undefined) {
    console.log("SKIPPING TEST", JSON.stringify(options), "BECAUSE MISSING THE URL SECRET");
    continue;
  }

  describe.concurrent(
    `${options.transactionPool ? "Transaction Pooling" : `Prepared Statements (${options.prepare ? "on" : "off"})`}`,
    () => {
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
        expect(error).toBeInstanceOf(SQL.SQLError);
        expect(error).toBeInstanceOf(SQL.PostgresError);
        return expect(error.code).toBe("ERR_POSTGRES_UNSAFE_TRANSACTION");
      });

      test.skipIf(options.transactionPool)("Transaction throws", async () => {
        await using sql = new SQL(options);
        const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

        await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
        expect(
          await sql
            .begin(async sql => {
              await sql`insert into ${sql(random_name)} values(1)`;
              await sql`insert into ${sql(random_name)} values('hej')`;
            })
            .catch(e => e.errno),
        ).toBe("22P02");
      });

      test.skipIf(options.transactionPool)("Transaction rolls back", async () => {
        await using sql = new SQL(options);
        const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

        await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;

        await sql
          .begin(async sql => {
            await sql`insert into ${sql(random_name)} values(1)`;
            await sql`insert into ${sql(random_name)} values('hej')`;
          })
          .catch(() => {
            /* ignore */
          });

        expect((await sql`select a from ${sql(random_name)}`).count).toBe(0);
      });

      test.skipIf(options.transactionPool)("Transaction throws on uncaught savepoint", async () => {
        await using sql = new SQL(options);
        const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
        await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
        expect(
          await sql
            .begin(async sql => {
              await sql`insert into ${sql(random_name)} values(1)`;
              await sql.savepoint(async sql => {
                await sql`insert into ${sql(random_name)} values(2)`;
                throw new Error("fail");
              });
            })
            .catch(err => err.message),
        ).toBe("fail");
      });

      test.skipIf(options.transactionPool)("Transaction throws on uncaught named savepoint", async () => {
        await using sql = new SQL(options);
        const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
        await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
        expect(
          await sql
            .begin(async sql => {
              await sql`insert into ${sql(random_name)} values(1)`;
              await sql.savepoint("watpoint", async sql => {
                await sql`insert into ${sql(random_name)} values(2)`;
                throw new Error("fail");
              });
            })
            .catch(() => "fail"),
        ).toBe("fail");
      });

      test("Transaction succeeds on caught savepoint", async () => {
        await using sql = new SQL(options);
        const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
        await sql`CREATE TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
        try {
          await sql.begin(async sql => {
            await sql`insert into ${sql(random_name)} values(1)`;
            await sql
              .savepoint(async sql => {
                await sql`insert into ${sql(random_name)} values(2)`;
                throw new Error("please rollback");
              })
              .catch(() => {
                /* ignore */
              });
            await sql`insert into ${sql(random_name)} values(3)`;
          });
          expect((await sql`select count(1) from ${sql(random_name)}`)[0].count).toBe(2n);
        } finally {
          await sql`DROP TABLE IF EXISTS ${sql(random_name)}`;
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
            .catch(e => e.errno),
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
        expect(
          (await sql.begin(sql => [sql`select 1 as count`, sql`select 1 as count`])).map(x => x[0].count).join(""),
        ).toBe("11");
      });

      test.skipIf(options.transactionPool)("Transaction waits", async () => {
        await using sql = new SQL({ ...options, max: 2 });
        const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
        await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
        await sql.begin(async sql => {
          await sql`insert into ${sql(random_name)} values(1)`;
          await sql
            .savepoint(async sql => {
              await sql`insert into ${sql(random_name)} values(2)`;
              throw new Error("please rollback");
            })
            .catch(() => {
              /* ignore */
            });
          await sql`insert into ${sql(random_name)} values(3)`;
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
    },
  );
}
