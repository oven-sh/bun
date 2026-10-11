import { SQL, randomUUIDv7 } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "mysql",
  {
    image: "mysql_plain",
    env: {},
    args: [],
  },
  container => {
    // Use a getter to avoid reading port/host at define time
    const getOptions = () => ({
      url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      bigint: true,
    });

    beforeEach(async () => {
      await container.ready;
    });

    test("Transaction works", async () => {
      await using sql = new SQL(getOptions());
      const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
      await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;

      await sql.begin(async sql => {
        await sql`insert into ${sql(random_name)} values(1)`;
        await sql`insert into ${sql(random_name)} values(2)`;
      });

      expect((await sql`select a from ${sql(random_name)}`).count).toBe(2);
      await sql.close();
    });

    test("Throws on illegal transactions", async () => {
      await using sql = new SQL({ ...getOptions(), max: 2 });
      try {
        await sql`BEGIN`;
        expect.unreachable();
      } catch (error: any) {
        expect(error.code).toBe("ERR_MYSQL_UNSAFE_TRANSACTION");
      }
    });

    test(".catch suppresses uncaught promise rejection", async () => {
      await using sql = new SQL({ ...getOptions(), max: 2 });
      const error = await sql`BEGIN`.catch(e => e);
      return expect(error.code).toBe("ERR_MYSQL_UNSAFE_TRANSACTION");
    });

    test("Transaction throws", async () => {
      await using sql = new SQL(getOptions());
      const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
      await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
      expect(
        await sql
          .begin(async sql => {
            await sql`insert into ${sql(random_name)} values(1)`;
            await sql`insert into ${sql(random_name)} values('hej')`;
          })
          .catch(e => e.message),
      ).toBe("Incorrect integer value: 'hej' for column 'a' at row 1");
    });

    test("Transaction rolls back", async () => {
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

    // A statement that reaches the server behind ROLLBACK runs in autocommit mode, or inside the
    // next transaction on the connection. The client has one connection, and a temporary table on it.
    describe("a statement behind the end of its transaction", () => {
      const ended = "ERR_MYSQL_INVALID_TRANSACTION_STATE";
      const emptyTable = async (sql: SQL) => {
        const table = "t_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql.unsafe(`CREATE TEMPORARY TABLE ${table} (a int)`);
        return table;
      };
      const rowsOf = async (sql: SQL, table: string) =>
        (await sql.unsafe(`SELECT a FROM ${table} ORDER BY a`)).map((row: { a: number | bigint }) => Number(row.a));
      const outcome = (work: PromiseLike<unknown>) =>
        work.then(
          () => "resolved",
          err => err.code ?? err.message,
        );
      // Three awaited inserts. An invalid item fails behind its first insert.
      const insertThree = async (handle: Bun.SQL, table: string, item: number, invalid: boolean) => {
        await handle`INSERT INTO ${handle(table)} VALUES (${item * 10 + 1})`;
        if (invalid) throw new Error(`item ${item} is invalid`);
        await handle`INSERT INTO ${handle(table)} VALUES (${item * 10 + 2})`;
        await handle`INSERT INTO ${handle(table)} VALUES (${item * 10 + 3})`;
      };

      test("a rejected transaction keeps no row of the tasks that go on after one failed", async () => {
        await using sql = new SQL(getOptions());
        const table = await emptyTable(sql);
        const tasks: Promise<void>[] = [];
        const begun = sql.begin(tx =>
          Promise.all(
            [3, 4, 5].map(item => {
              tasks.push(insertThree(tx, table, item, item === 3));
              return tasks.at(-1);
            }),
          ),
        );
        expect({
          transaction: await outcome(begun),
          tasks: await Promise.all(tasks.map(outcome)),
          rows: await rowsOf(sql, table),
        }).toEqual({ transaction: "item 3 is invalid", tasks: ["item 3 is invalid", ended, ended], rows: [] });
      });

      test("a rolled-back savepoint keeps no row of the tasks that go on after one failed", async () => {
        await using sql = new SQL(getOptions());
        const table = await emptyTable(sql);
        const tasks: Promise<void>[] = [];
        const outcomes = await sql.begin(async tx => {
          await tx`INSERT INTO ${tx(table)} VALUES (1)`;
          const savepoint = tx.savepoint(sp =>
            Promise.all(
              [3, 4, 5].map(item => {
                tasks.push(insertThree(sp, table, item, item === 3));
                return tasks.at(-1);
              }),
            ),
          );
          const outcomes = { savepoint: await outcome(savepoint), tasks: await Promise.all(tasks.map(outcome)) };
          await tx`INSERT INTO ${tx(table)} VALUES (2)`;
          return outcomes;
        });
        expect({ ...outcomes, rows: await rowsOf(sql, table) }).toEqual({
          savepoint: "item 3 is invalid",
          tasks: ["item 3 is invalid", ended, ended],
          rows: [1, 2],
        });
      });

      // A timeout wrapper rejects the transaction and does not stop the job. The job goes on with the
      // client of the transaction that rolled back, while the next transaction has the connection.
      test("a job that outlives its transaction writes nothing inside the next transaction", async () => {
        await using sql = new SQL(getOptions());
        const table = await emptyTable(sql);
        const timeout = Promise.withResolvers<never>();
        const nextHasTheConnection = Promise.withResolvers<void>();
        let job!: Promise<void>;
        const timedOut = sql.begin(tx => {
          job = (async () => {
            await tx.unsafe(`INSERT INTO ${table} VALUES (1)`);
            timeout.reject(new Error("timed out"));
            await nextHasTheConnection.promise;
            await tx.unsafe(`INSERT INTO ${table} VALUES (2)`);
          })();
          return Promise.race([job, timeout.promise]);
        });
        const next = sql.begin(async tx => {
          await tx.unsafe(`INSERT INTO ${table} VALUES (10)`);
          nextHasTheConnection.resolve();
          const late = await outcome(job);
          await tx.unsafe(`INSERT INTO ${table} VALUES (11)`);
          return late;
        });
        expect({
          transaction: await outcome(timedOut),
          job: await next,
          rows: await rowsOf(sql, table),
        }).toEqual({ transaction: "timed out", job: ended, rows: [10, 11] });
      });
    });

    test("Transaction throws on uncaught savepoint", async () => {
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
        expect((await sql`select count(1) as count from ${sql(random_name)}`)[0].count).toBe(2);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(random_name)}`;
      }
    });

    test("Savepoint returns Result", async () => {
      let result;
      await using sql = new SQL(getOptions());
      await sql.begin(async t => {
        result = await t.savepoint(s => s`select 1 as x`);
      });
      expect(result[0]?.x).toBe(1);
    });

    test("Uncaught transaction request errors bubbles to transaction", async () => {
      await using sql = new SQL(getOptions());
      expect(await sql.begin(sql => [sql`select wat`, sql`select 1 as x, ${1} as a`]).catch(e => e.message)).toBe(
        "Unknown column 'wat' in 'field list'",
      );
    });

    test("Transaction rejects with rethrown error", async () => {
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
      await using sql = new SQL({ ...getOptions(), max: 2 });

      expect(
        (await Promise.all([sql.begin(sql => sql`select 1 as count`), sql.begin(sql => sql`select 1 as count`)]))
          .map(x => x[0].count)
          .join(""),
      ).toBe("11");
    });

    test("Many transactions at beginning of connection", async () => {
      await using sql = new SQL({ ...getOptions(), max: 2 });
      const xs = await Promise.all(Array.from({ length: 30 }, () => sql.begin(sql => sql`select 1`)));
      return expect(xs.length).toBe(30);
    });

    test("Transactions array", async () => {
      await using sql = new SQL(getOptions());
      expect(
        (await sql.begin(sql => [sql`select 1 as count`, sql`select 1 as count`])).map(x => x[0].count).join(""),
      ).toBe("11");
    });
  },
);
