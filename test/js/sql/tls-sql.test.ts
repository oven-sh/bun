import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

if (!isDockerEnabled()) {
  test.skip("skipping TLS SQL tests - Docker is not available", () => {});
} else {
  // Test with prepared statements on and off
  for (const prepare of [true, false]) {
    describeWithContainer(
      `PostgreSQL TLS (prepared: ${prepare})`,
      {
        image: "postgres_tls",
        concurrent: true,
      },
      container => {
        const getOptions = (): Bun.SQL.Options => ({
          url: `postgres://postgres@${container.host}:${container.port}/bun_sql_test`,
          tls: true,
          adapter: "postgres",
          max: 1,
          bigint: true,
          prepare,
        });

        test("tls (explicit)", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          const [{ one, two }] = await sql`SELECT 1 as one, '2' as two`;
          expect(one).toBe(1);
          expect(two).toBe("2");
          await sql.close();
        });

        test("Throws on illegal transactions", async () => {
          await container.ready;
          await using sql = new SQL({ ...getOptions(), max: 2 });
          const error = await sql`BEGIN`.catch(e => e);
          expect(error).toBeInstanceOf(SQL.SQLError);
          expect(error).toBeInstanceOf(SQL.PostgresError);
          return expect(error.code).toBe("ERR_POSTGRES_UNSAFE_TRANSACTION");
        });

        test("Transaction throws", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
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

        test("Transaction rolls back", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
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

        test("Transaction throws on uncaught savepoint", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
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

        test("Transaction throws on uncaught named savepoint", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
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
          await container.ready;
          await using sql = new SQL(getOptions());
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
          await container.ready;
          let result;
          await using sql = new SQL(getOptions());
          await sql.begin(async t => {
            result = await t.savepoint(s => s`select 1 as x`);
          });
          expect(result[0]?.x).toBe(1);
        });

        test("Transaction requests are executed implicitly", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
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
          await container.ready;
          await using sql = new SQL(getOptions());
          expect(
            await sql
              .begin(sql => [sql`select wat`, sql`select current_setting('bun_sql.test') as x, ${1} as a`])
              .catch(e => e.errno),
          ).toBe("42703");
        });

        test("Transaction rejects with rethrown error", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
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
          await container.ready;
          await using sql = new SQL({ ...getOptions(), max: 2 });

          expect(
            (await Promise.all([sql.begin(sql => sql`select 1 as count`), sql.begin(sql => sql`select 1 as count`)]))
              .map(x => x[0].count)
              .join(""),
          ).toBe("11");
        });

        test("Many transactions at beginning of connection", async () => {
          await container.ready;
          await using sql = new SQL({ ...getOptions(), max: 2 });
          const xs = await Promise.all(Array.from({ length: 30 }, () => sql.begin(sql => sql`select 1`)));
          return expect(xs.length).toBe(30);
        });

        test("Transactions array", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          expect(
            (await sql.begin(sql => [sql`select 1 as count`, sql`select 1 as count`])).map(x => x[0].count).join(""),
          ).toBe("11");
        });

        test("Transaction waits", async () => {
          await container.ready;
          await using sql = new SQL({ ...getOptions(), max: 2 });
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
}
