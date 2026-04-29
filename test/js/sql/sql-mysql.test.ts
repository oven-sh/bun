import { SQL, randomUUIDv7 } from "bun";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunRun, describeWithContainer, isDockerEnabled, tempDirWithFiles } from "harness";
import net from "net";
import path from "path";
const dir = tempDirWithFiles("sql-test", {
  "select-param.sql": `select ? as x`,
  "select.sql": `select CAST(1 AS SIGNED) as x`,
});
function rel(filename: string) {
  return path.join(dir, filename);
}
if (isDockerEnabled()) {
  const images = [
    {
      name: "MySQL with TLS",
      image: "mysql_tls",
    },
    {
      name: "MySQL",
      image: "mysql_plain",
    },
    // This image only works on x64.
    process.arch === "x64" && {
      name: "MySQL 9",
      image: "mysql:9",
      env: {
        MYSQL_ROOT_PASSWORD: "bun",
      },
    },
  ].filter(Boolean);

  for (const image of images) {
    describeWithContainer(
      image.name,
      {
        image: image.image,
        env: image.env,
        concurrent: true,
      },
      container => {
        let sql: SQL;
        const password = image.image === "mysql_plain" ? "" : "bun";
        const getOptions = (): Bun.SQL.Options => ({
          url: `mysql://root:${password}@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
          tls:
            image.name === "MySQL with TLS"
              ? Bun.file(path.join(import.meta.dir, "mysql-tls", "ssl", "ca.pem"))
              : undefined,
        });

        beforeAll(async () => {
          await container.ready;
          sql = new SQL(getOptions());
        });

        test("process should exit when idle", async () => {
          const { stderr } = bunRun(path.join(import.meta.dir, "sql-idle-exit-fixture.ts"), {
            ...bunEnv,
            MYSQL_URL: getOptions().url,
            CA_PATH: image.name === "MySQL with TLS" ? path.join(import.meta.dir, "mysql-tls", "ssl", "ca.pem") : "",
          });
          expect(stderr).toBe("");
        });
        test("should return lastInsertRowid and affectedRows", async () => {
          await using db = new SQL({ ...getOptions(), max: 1, idleTimeout: 5 });
          using sql = await db.reserve();
          const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");

          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, name text)`;

          const { lastInsertRowid } = await sql`INSERT INTO ${sql(random_name)} (name) VALUES (${"test"})`;
          expect(lastInsertRowid).toBe(1);
          const { affectedRows } =
            await sql`UPDATE ${sql(random_name)} SET name = "test2" WHERE id = ${lastInsertRowid}`;
          expect(affectedRows).toBe(1);
        });
        describe("should work with more than the max inline capacity", () => {
          for (let size of [50, 60, 62, 64, 70, 100]) {
            for (let duplicated of [true, false]) {
              test(`${size} ${duplicated ? "+ duplicated" : "unique"} fields`, async () => {
                const longQuery = `select ${Array.from({ length: size }, (_, i) => {
                  if (duplicated) {
                    return i % 2 === 0 ? `${i + 1} as f${i}, ${i} as f${i}` : `${i} as f${i}`;
                  }
                  return `${i} as f${i}`;
                }).join(",\n")}`;
                await using sql = new SQL({ ...getOptions(), max: 1 });

                const result = await sql.unsafe(longQuery);
                let value = 0;
                for (const column of Object.values(result[0])) {
                  expect(column?.toString()).toEqual(value.toString());
                  value++;
                }
              });
            }
          }
        });

        test("Connection timeout works", async () => {
          const onclose = mock();
          const onconnect = mock();
          await using sql = new SQL({
            ...getOptions(),
            hostname: "example.com",
            connection_timeout: 4,
            onconnect,
            onclose,
            max: 1,
          });
          let error: any;
          try {
            await sql`select SLEEP(8)`;
          } catch (e) {
            error = e;
          }
          expect(error.code).toBe(`ERR_MYSQL_CONNECTION_TIMEOUT`);
          expect(error.message).toContain("Connection timeout after 4s");
          expect(onconnect).not.toHaveBeenCalled();
          expect(onclose).toHaveBeenCalledTimes(1);
        });

        test("Idle timeout works at start", async () => {
          const onClosePromise = Promise.withResolvers();
          const onclose = mock(err => {
            onClosePromise.resolve(err);
          });
          const onconnect = mock();
          await using sql = new SQL({
            ...getOptions(),
            idle_timeout: 1,
            onconnect,
            onclose,
            max: 1,
          });
          await sql.connect();
          const err = await onClosePromise.promise;
          expect(err).toBeInstanceOf(SQL.SQLError);
          expect(err).toBeInstanceOf(SQL.MySQLError);
          expect((err as SQL.MySQLError).code).toBe(`ERR_MYSQL_IDLE_TIMEOUT`);
          expect(onconnect).toHaveBeenCalled();
          expect(onclose).toHaveBeenCalledTimes(1);
        });

        test("Idle timeout is reset when a query is run", async () => {
          const onClosePromise = Promise.withResolvers();
          const onclose = mock(err => {
            onClosePromise.resolve(err);
          });
          const onconnect = mock();
          await using sql = new SQL({
            ...getOptions(),
            idle_timeout: 1,
            connection_timeout: 5,
            onconnect,
            onclose,
            max: 1,
          });
          expect<[{ x: number }]>(await sql`select 123 as x`).toEqual([{ x: 123 }]);
          expect(onconnect).toHaveBeenCalledTimes(1);
          expect(onclose).not.toHaveBeenCalled();
          const err = await onClosePromise.promise;
          expect(err).toBeInstanceOf(SQL.SQLError);
          expect(err).toBeInstanceOf(SQL.MySQLError);
          expect((err as SQL.MySQLError).code).toBe(`ERR_MYSQL_IDLE_TIMEOUT`);
        });

        test("Max lifetime works", async () => {
          const onClosePromise = Promise.withResolvers();
          const onclose = mock(err => {
            onClosePromise.resolve(err);
          });
          const onconnect = mock();
          await using sql = new SQL({
            ...getOptions(),
            max_lifetime: 1,
            onconnect,
            onclose,
            max: 1,
          });
          let error: unknown;

          try {
            expect<[{ x: number }]>(await sql`select 1 as x`).toEqual([{ x: 1 }]);

            while (true) {
              for (let i = 0; i < 100; i++) {
                await sql`select SLEEP(1)`;
              }
            }
          } catch (e) {
            error = e;
          }

          expect(onclose).toHaveBeenCalledTimes(1);
          expect(onconnect).toHaveBeenCalledTimes(1);

          expect(error).toBeInstanceOf(SQL.SQLError);
          expect(error).toBeInstanceOf(SQL.MySQLError);
          expect((error as SQL.MySQLError).code).toBe(`ERR_MYSQL_LIFETIME_TIMEOUT`);
        });

        // Last one wins.
        test("Handles duplicate string column names", async () => {
          const result = await sql`select 1 as x, 2 as x, 3 as x`;
          expect(result).toEqual([{ x: 3 }]);
        });

        test("should not timeout in long results", async () => {
          await using db = new SQL({ ...getOptions(), max: 1, idleTimeout: 5 });
          using sql = await db.reserve();
          const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");

          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text)`;
          const promises: Promise<any>[] = [];
          for (let i = 0; i < 10_000; i++) {
            promises.push(sql`INSERT INTO ${sql(random_name)} VALUES (${i}, ${"test" + i})`);
            if (i % 50 === 0 && i > 0) {
              await Promise.all(promises);
              promises.length = 0;
            }
          }
          await Promise.all(promises);
          await sql`SELECT * FROM ${sql(random_name)}`;
          await sql`SELECT * FROM ${sql(random_name)}`;
          await sql`SELECT * FROM ${sql(random_name)}`;

          expect().pass();
        }, 10_000);

        test("Handles numeric column names", async () => {
          // deliberately out of order
          const result = await sql`select 1 as "1", 2 as "2", 3 as "3", 0 as "0"`;
          expect(result).toEqual([{ "1": 1, "2": 2, "3": 3, "0": 0 }]);

          expect(Object.keys(result[0])).toEqual(["0", "1", "2", "3"]);
          // Sanity check: ensure iterating through the properties doesn't crash.
          Bun.inspect(result);
        });

        // Last one wins.
        test("Handles duplicate numeric column names", async () => {
          const result = await sql`select 1 as "1", 2 as "1", 3 as "1"`;
          expect(result).toEqual([{ "1": 3 }]);
          // Sanity check: ensure iterating through the properties doesn't crash.
          Bun.inspect(result);
        });

        test("Handles mixed column names", async () => {
          const result = await sql`select 1 as "1", 2 as "2", 3 as "3", 4 as x`;
          expect(result).toEqual([{ "1": 1, "2": 2, "3": 3, x: 4 }]);
          // Sanity check: ensure iterating through the properties doesn't crash.
          Bun.inspect(result);
        });

        test("Handles mixed column names with duplicates", async () => {
          const result = await sql`select 1 as "1", 2 as "2", 3 as "3", 4 as "1", 1 as x, 2 as x`;
          expect(result).toEqual([{ "1": 4, "2": 2, "3": 3, x: 2 }]);
          // Sanity check: ensure iterating through the properties doesn't crash.
          Bun.inspect(result);

          // Named columns are inserted first, but they appear from JS as last.
          expect(Object.keys(result[0])).toEqual(["1", "2", "3", "x"]);
        });

        test("Handles mixed column names with duplicates at the end", async () => {
          const result = await sql`select 1 as "1", 2 as "2", 3 as "3", 4 as "1", 1 as x, 2 as x, 3 as x, 4 as "y"`;
          expect(result).toEqual([{ "1": 4, "2": 2, "3": 3, x: 3, y: 4 }]);

          // Sanity check: ensure iterating through the properties doesn't crash.
          Bun.inspect(result);
        });

        test("Handles mixed column names with duplicates at the start", async () => {
          const result = await sql`select 1 as "1", 2 as "1", 3 as "2", 4 as "3", 1 as x, 2 as x, 3 as x`;
          expect(result).toEqual([{ "1": 2, "2": 3, "3": 4, x: 3 }]);
          // Sanity check: ensure iterating through the properties doesn't crash.
          Bun.inspect(result);
        });

        test("Uses default database without slash", async () => {
          const sql = new SQL("mysql://localhost");
          expect("mysql").toBe(sql.options.database);
        });

        test("Uses default database with slash", async () => {
          const sql = new SQL("mysql://localhost/");
          expect("mysql").toBe(sql.options.database);
        });

        test("Result is array", async () => {
          expect(await sql`select 1`).toBeArray();
        });

        test("Create table", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          await sql`create table test_my_table(id int)`;
          await sql`drop table test_my_table`;
        });

        test("Drop table", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          await sql`create table drop_table_test(id int)`;
          await sql`drop table drop_table_test`;
          // Verify that table is dropped
          const result = await sql`select * from information_schema.tables where table_name = 'drop_table_test'`;
          expect(result).toBeArrayOfSize(0);
        });

        test("null", async () => {
          expect((await sql`select ${null} as x`)[0].x).toBeNull();
        });

        test("Unsigned Integer", async () => {
          expect((await sql`select ${0x7fffffff + 2} as x`)[0].x).toBe(2147483649);
        });

        test("Signed Integer", async () => {
          expect((await sql`select ${-1} as x`)[0].x).toBe(-1);
          expect((await sql`select ${1} as x`)[0].x).toBe(1);
        });

        test("Double", async () => {
          expect((await sql`select ${1.123456789} as x`)[0].x).toBe(1.123456789);
        });

        test("String", async () => {
          expect((await sql`select ${"hello"} as x`)[0].x).toBe("hello");
        });

        test("MediumInt/Int24", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          let random_name = ("t_" + Bun.randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a mediumint unsigned)`;
          await sql`INSERT INTO ${sql(random_name)} VALUES (${1})`;
          const result = await sql`select * from ${sql(random_name)}`;
          expect(result[0].a).toBe(1);
          const result2 = await sql`select * from ${sql(random_name)}`.simple();
          expect(result2[0].a).toBe(1);
        });

        test("Boolean/TinyInt/BIT", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          // Protocol will always return 0 or 1 for TRUE and FALSE when not using a table.
          expect((await sql`select ${false} as x`)[0].x).toBe(0);
          expect((await sql`select ${true} as x`)[0].x).toBe(1);
          let random_name = ("t_" + Bun.randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a bool)`;
          const values = [{ a: true }, { a: false }, { a: 8 }, { a: -1 }];
          await sql`INSERT INTO ${sql(random_name)} ${sql(values)}`;
          const [[a], [b], [c], [d]] = await sql`select * from ${sql(random_name)}`.values();
          expect(a).toBe(1);
          expect(b).toBe(0);
          expect(c).toBe(8);
          expect(d).toBe(-1);
          {
            random_name += "2";
            await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a tinyint(1) unsigned)`;
            try {
              const values = [{ a: -1 }];
              await sql`INSERT INTO ${sql(random_name)} ${sql(values)}`;
              expect.unreachable();
            } catch (e: any) {
              expect(e.code).toBe("ERR_MYSQL_SERVER_ERROR");
              expect(e.message).toContain("Out of range value for column 'a'");
            }

            const values = [{ a: 255 }];
            await sql`INSERT INTO ${sql(random_name)} ${sql(values)}`;
            const [[a]] = await sql`select * from ${sql(random_name)}`.values();
            expect(a).toBe(255);
          }

          {
            random_name += "3";
            await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a bit(1), b bit(2))`;
            const values = [
              { a: true, b: 1 },
              { a: false, b: 2 },
            ];
            await sql`INSERT INTO ${sql(random_name)} ${sql(values)}`;
            const results = await sql`select * from ${sql(random_name)}`;
            // return true or false for BIT(1) and buffer for BIT(n)
            expect(results[0].a).toBe(true);
            expect(results[0].b).toEqual(Buffer.from([1]));
            expect(results[1].a).toBe(false);
            expect(results[1].b).toEqual(Buffer.from([2]));
            // text protocol should behave the same
            const results2 = await sql`select * from ${sql(random_name)}`.simple();
            expect(results2[0].a).toBe(true);
            expect(results2[0].b).toEqual(Buffer.from([1]));
            expect(results2[1].a).toBe(false);
            expect(results2[1].b).toEqual(Buffer.from([2]));
          }
        });

        test("Date", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const now = new Date();
          const then = (await sql`select ${now}  as x`)[0].x;
          expect(then).toEqual(now);
        });

        test("Timestamp", async () => {
          {
            const result = (await sql`select DATE_ADD(FROM_UNIXTIME(0), INTERVAL -25 SECOND) as x`)[0].x;
            expect(result.getTime()).toBe(-25000);
          }
          {
            const result = (await sql`select DATE_ADD(FROM_UNIXTIME(0), INTERVAL 25 SECOND) as x`)[0].x;
            expect(result.getSeconds()).toBe(25);
          }
          {
            const result = (await sql`select DATE_ADD(FROM_UNIXTIME(0), INTERVAL 251000 MICROSECOND) as x`)[0].x;
            expect(result.getMilliseconds()).toBe(251);
          }
          {
            const result = (await sql`select DATE_ADD(FROM_UNIXTIME(0), INTERVAL -251000 MICROSECOND) as x`)[0].x;
            expect(result.getTime()).toBe(-251);
          }
        });
        test("time", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a TIME)`;
          const times = [
            { a: "00:00:00" },
            { a: "01:01:01" },
            { a: "10:10:10" },
            { a: "12:12:59" },
            { a: "-838:59:59" },
            { a: "838:59:59" },
            { a: null },
          ];
          await sql`INSERT INTO ${sql(random_name)} ${sql(times)}`;
          const result = await sql`SELECT * FROM ${sql(random_name)}`;
          expect(result).toEqual(times);
          const result2 = await sql`SELECT * FROM ${sql(random_name)}`.simple();
          expect(result2).toEqual(times);
        });

        test("date", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a DATE)`;
          const dates = [{ a: "2024-01-01" }, { a: "2024-01-02" }, { a: "2024-01-03" }, { a: null }];
          await sql`INSERT INTO ${sql(random_name)} ${sql(dates)}`;
          const result = await sql`SELECT * FROM ${sql(random_name)}`;
          expect(result).toEqual([
            { a: new Date("2024-01-01") },
            { a: new Date("2024-01-02") },
            { a: new Date("2024-01-03") },
            { a: null },
          ]);
          const result2 = await sql`SELECT * FROM ${sql(random_name)}`.simple();
          expect(result2).toEqual([
            { a: new Date("2024-01-01") },
            { a: new Date("2024-01-02") },
            { a: new Date("2024-01-03") },
            { a: null },
          ]);
        });

        test("JSON", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const x = (await sql`select CAST(${{ a: "hello", b: 42 }} AS JSON) as x`)[0].x;
          expect(x).toEqual({ a: "hello", b: 42 });

          const y = (await sql`select CAST('{"key": "value", "number": 123}' AS JSON) as x`)[0].x;
          expect(y).toEqual({ key: "value", number: 123 });

          const random_name = ("t_" + Bun.randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a json)`;
          const values = [{ a: { b: 1 } }, { a: { b: 2 } }];
          await sql`INSERT INTO ${sql(random_name)} ${sql(values)}`;
          const [[a], [b]] = await sql`select * from ${sql(random_name)}`.values();
          expect(a).toEqual({ b: 1 });
          expect(b).toEqual({ b: 2 });
        });

        test("Binary", async () => {
          const random_name = ("t_" + Bun.randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a binary(1), b varbinary(1), c blob)`;
          const values = [
            { a: Buffer.from([1]), b: Buffer.from([2]), c: Buffer.from([3]) },
          ];
          await sql`INSERT INTO ${sql(random_name)} ${sql(values)}`;
          const results = await sql`select * from ${sql(random_name)}`;
          // return buffers
          expect(results[0].a).toEqual(Buffer.from([1]));
          expect(results[0].b).toEqual(Buffer.from([2]));
          expect(results[0].c).toEqual(Buffer.from([3]));
          // text protocol should behave the same
          const results2 = await sql`select * from ${sql(random_name)}`.simple();
          expect(results2[0].a).toEqual(Buffer.from([1]));
          expect(results2[0].b).toEqual(Buffer.from([2]));
          expect(results2[0].c).toEqual(Buffer.from([3]));
        })

        test("bulk insert nested sql()", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          await sql`create temporary table test_users (name text, age int)`;
          const users = [
            { name: "Alice", age: 25 },
            { name: "Bob", age: 30 },
          ];
          try {
            await sql`insert into test_users ${sql(users)}`;
            const result = await sql`select * from test_users`;
            expect(result).toEqual([
              { name: "Alice", age: 25 },
              { name: "Bob", age: 30 },
            ]);
          } finally {
            await sql`drop table test_users`;
          }
        });

        test("Escapes", async () => {
          expect(Object.keys((await sql`select 1 as ${sql('hej"hej')}`)[0])[0]).toBe('hej"hej');
        });

        test("null for int", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const result = await sql`create temporary table test_null_for_int (x int)`;
          expect(result.count).toBe(0);
          try {
            await sql`insert into test_null_for_int values(${null})`;
            const result2 = await sql`select * from test_null_for_int`;
            expect(result2).toEqual([{ x: null }]);
          } finally {
            await sql`drop table test_null_for_int`;
          }
        });

        test("should be able to execute different queries in the same connection #16774", async () => {
          const sql = new SQL({ ...getOptions(), max: 1 });
          const random_table_name = `test_user_${Math.random().toString(36).substring(2, 15)}`;
          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_table_name)}  (id int, name text)`;

          const promises: Array<Promise<any>> = [];
          // POPULATE TABLE
          for (let i = 0; i < 1_000; i++) {
            promises.push(sql`insert into ${sql(random_table_name)} values (${i}, ${`test${i}`})`.execute());
          }
          await Promise.all(promises);

          // QUERY TABLE using execute() to force executing the query immediately
          {
            for (let i = 0; i < 1_000; i++) {
              // mix different parameters
              switch (i % 3) {
                case 0:
                  promises.push(sql`select id, name from ${sql(random_table_name)} where id = ${i}`.execute());
                  break;
                case 1:
                  promises.push(sql`select id from ${sql(random_table_name)} where id = ${i}`.execute());
                  break;
                case 2:
                  promises.push(sql`select 1, id, name from ${sql(random_table_name)} where id = ${i}`.execute());
                  break;
              }
            }
            await Promise.all(promises);
          }
        });

        test("Prepared transaction", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          await sql`create table test_prepared_transaction (a int)`;

          try {
            await sql.beginDistributed("tx1", async sql => {
              await sql`insert into test_prepared_transaction values(1)`;
            });
            await sql.commitDistributed("tx1");
            expect((await sql`select count(*) from test_prepared_transaction`).count).toBe(1);
          } finally {
            await sql`drop table test_prepared_transaction`;
          }
        });

        test("Idle timeout retry works", async () => {
          await using sql = new SQL({ ...getOptions(), idleTimeout: 1 });
          await sql`select 1`;
          await Bun.sleep(1100); // 1.1 seconds so it should retry
          await sql`select 1`;
          expect().pass();
        });

        test("Fragments in transactions", async () => {
          const sql = new SQL({ ...getOptions(), debug: true, idle_timeout: 1, fetch_types: false });
          expect((await sql.begin(sql => sql`select 1 as x where ${sql`1=1`}`))[0].x).toBe(1);
        });

        test("Helpers in Transaction", async () => {
          const result = await sql.begin(async sql => await sql`select ${sql.unsafe("1 as x")}`);
          expect(result[0].x).toBe(1);
        });

        test("Undefined values throws", async () => {
          const result = await sql`select ${undefined} as x`;
          expect(result[0].x).toBeNull();
        });

        test("Null sets to null", async () => {
          expect((await sql`select ${null} as x`)[0].x).toBeNull();
        });

        // Add code property.
        test("Throw syntax error", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const err = await sql`wat 1`.catch(x => x);
          expect(err.code).toBe("ERR_MYSQL_SYNTAX_ERROR");
        });

        // Regression test for: panic: A JavaScript exception was thrown, but it was cleared before it could be read.
        // This happened when FieldType.fromJS returned error.JSError without throwing an exception first.
        test("should throw error for NumberObject parameter", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          // new Number(42) creates a NumberObject (not a primitive number)
          // This used to cause a panic because FieldType.fromJS returned error.JSError without throwing
          const numberObject = new Number(42);
          const err = await sql`SELECT ${numberObject} as value`.catch(x => x);
          expect(err).toBeInstanceOf(Error);
          expect(err.message).toContain("Cannot bind NumberObject to query parameter");
        });

        test("should throw error for BooleanObject parameter", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          // new Boolean(true) creates a BooleanObject (not a primitive boolean)
          const booleanObject = new Boolean(true);
          const err = await sql`SELECT ${booleanObject} as value`.catch(x => x);
          expect(err).toBeInstanceOf(Error);
          expect(err.message).toContain("Cannot bind BooleanObject to query parameter");
        });

        test("should work with fragments", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const random_name = sql("test_" + randomUUIDv7("hex").replaceAll("-", ""));
          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${random_name} (id int, hotel_id int, created_at timestamp)`;
          await sql`INSERT INTO ${random_name} VALUES (1, 1, '2024-01-01 10:00:00')`;
          // single escaped identifier
          {
            const results = await sql`SELECT * FROM ${random_name}`;
            expect(results).toEqual([{ id: 1, hotel_id: 1, created_at: new Date("2024-01-01T10:00:00.000Z") }]);
          }
          // multiple escaped identifiers
          {
            const results = await sql`SELECT ${random_name}.* FROM ${random_name}`;
            expect(results).toEqual([{ id: 1, hotel_id: 1, created_at: new Date("2024-01-01T10:00:00.000Z") }]);
          }
          // even more complex fragment
          {
            const results =
              await sql`SELECT ${random_name}.* FROM ${random_name} WHERE ${random_name}.hotel_id = ${1} ORDER BY ${random_name}.created_at DESC`;
            expect(results).toEqual([{ id: 1, hotel_id: 1, created_at: new Date("2024-01-01T10:00:00.000Z") }]);
          }
        });
        test("should handle nested fragments", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const random_name = sql("test_" + randomUUIDv7("hex").replaceAll("-", ""));

          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${random_name} (id int, hotel_id int, created_at timestamp)`;
          await sql`INSERT INTO ${random_name} VALUES (1, 1, '2024-01-01 10:00:00')`;
          await sql`INSERT INTO ${random_name} VALUES (2, 1, '2024-01-02 10:00:00')`;
          await sql`INSERT INTO ${random_name} VALUES (3, 2, '2024-01-03 10:00:00')`;

          // fragment containing another scape fragment for the field name
          const orderBy = (field_name: string) => sql`ORDER BY ${sql(field_name)} DESC`;

          // dynamic information
          const sortBy = { should_sort: true, field: "created_at" };
          const user = { hotel_id: 1 };

          // query containing the fragments
          const results = await sql`
    SELECT ${random_name}.*
    FROM ${random_name}
    WHERE ${random_name}.hotel_id = ${user.hotel_id} 
    ${sortBy.should_sort ? orderBy(sortBy.field) : sql``}`;
          expect(results).toEqual([
            { id: 2, hotel_id: 1, created_at: new Date("2024-01-02T10:00:00.000Z") },
            { id: 1, hotel_id: 1, created_at: new Date("2024-01-01T10:00:00.000Z") },
          ]);
        });

        test("Support dynamic password function", async () => {
          await using sql = new SQL({ ...getOptions(), password: () => password, max: 1 });
          return expect((await sql`select 1 as x`)[0].x).toBe(1);
        });

        test("Support dynamic async resolved password function", async () => {
          await using sql = new SQL({
            ...getOptions(),
            password: () => Promise.resolve(password),
            max: 1,
          });
          return expect((await sql`select 1 as x`)[0].x).toBe(1);
        });

        test("Support dynamic async password function", async () => {
          await using sql = new SQL({
            ...getOptions(),
            max: 1,
            password: async () => {
              await Bun.sleep(10);
              return password;
            },
          });
          return expect((await sql`select 1 as x`)[0].x).toBe(1);
        });
        test("Support dynamic async rejected password function", async () => {
          await using sql = new SQL({
            ...getOptions(),
            password: () => Promise.reject(new Error("password error")),
            max: 1,
          });
          try {
            await sql`select true as x`;
            expect.unreachable();
          } catch (e: any) {
            expect(e.message).toBe("password error");
          }
        });

        test("Support dynamic async password function that throws", async () => {
          await using sql = new SQL({
            ...getOptions(),
            max: 1,
            password: async () => {
              await Bun.sleep(10);
              throw new Error("password error");
            },
          });
          try {
            await sql`select true as x`;
            expect.unreachable();
          } catch (e: any) {
            expect(e).toBeInstanceOf(Error);
            expect(e.message).toBe("password error");
          }
        });

        test("sql file", async () => {
          expect((await sql.file(rel("select.sql")))[0].x).toBe(1);
        });

        test("sql file throws", async () => {
          expect(await sql.file(rel("selectomondo.sql")).catch(x => x.code)).toBe("ENOENT");
        });
        test("Parameters in file", async () => {
          const result = await sql.file(rel("select-param.sql"), ["hello"]);
          return expect(result[0].x).toBe("hello");
        });

        test("Connection ended promise", async () => {
          const sql = new SQL(getOptions());

          await sql.end();

          expect(await sql.end()).toBeUndefined();
        });

        test("Connection ended timeout", async () => {
          const sql = new SQL(getOptions());

          await sql.end({ timeout: 10 });

          expect(await sql.end()).toBeUndefined();
        });

        test("Connection ended error", async () => {
          const sql = new SQL(getOptions());
          await sql.end();
          return expect(await sql``.catch(x => x.code)).toBe("ERR_MYSQL_CONNECTION_CLOSED");
        });

        test("Connection end does not cancel query", async () => {
          const sql = new SQL(getOptions());

          const promise = sql`select SLEEP(1) as x`.execute();
          await sql.end();
          return expect(await promise).toEqual([{ x: 0 }]);
        });

        test("Connection destroyed", async () => {
          const sql = new SQL(getOptions());
          process.nextTick(() => sql.end({ timeout: 0 }));
          expect(await sql``.catch(x => x.code)).toBe("ERR_MYSQL_CONNECTION_CLOSED");
        });

        test("Connection destroyed with query before", async () => {
          const sql = new SQL(getOptions());
          const error = sql`select SLEEP(0.2)`.catch(err => err.code);

          sql.end({ timeout: 0 });
          return expect(await error).toBe("ERR_MYSQL_CONNECTION_CLOSED");
        });

        test("unsafe", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          await sql`create temporary table test_unsafe (x int)`;
          try {
            await sql.unsafe("insert into test_unsafe values (?)", [1]);
            const [{ x }] = await sql`select * from test_unsafe`;
            expect(x).toBe(1);
          } finally {
            await sql`drop table test_unsafe`;
          }
        });

        test("unsafe simple", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          expect(await sql.unsafe("select 1 as x")).toEqual([{ x: 1 }]);
        });

        test("simple query with multiple statements", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const result = await sql`select 1 as x;select 2 as x`.simple();
          expect(result).toBeDefined();
          expect(result.length).toEqual(2);
          expect(result[0][0].x).toEqual(1);
          expect(result[1][0].x).toEqual(2);
        });

        test("simple query using unsafe with multiple statements", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const result = await sql.unsafe("select 1 as x;select 2 as x");
          expect(result).toBeDefined();
          expect(result.length).toEqual(2);
          expect(result[0][0].x).toEqual(1);
          expect(result[1][0].x).toEqual(2);
        });

        test("only allows one statement", async () => {
          expect(await sql`select 1; select 2`.catch(e => e.message)).toBe(
            "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'select 2' at line 1",
          );
        });

        test("await sql() throws not tagged error", async () => {
          try {
            await sql("select 1");
            expect.unreachable();
          } catch (e: any) {
            expect(e.code).toBe("ERR_MYSQL_NOT_TAGGED_CALL");
          }
        });

        test("sql().then throws not tagged error", async () => {
          try {
            await sql("select 1").then(() => {
              /* noop */
            });
            expect.unreachable();
          } catch (e: any) {
            expect(e.code).toBe("ERR_MYSQL_NOT_TAGGED_CALL");
          }
        });

        test("sql().catch throws not tagged error", async () => {
          try {
            sql("select 1").catch(() => {
              /* noop */
            });
            expect.unreachable();
          } catch (e: any) {
            expect(e.code).toBe("ERR_MYSQL_NOT_TAGGED_CALL");
          }
        });

        test("sql().finally throws not tagged error", async () => {
          try {
            sql("select 1").finally(() => {
              /* noop */
            });
            expect.unreachable();
          } catch (e: any) {
            expect(e.code).toBe("ERR_MYSQL_NOT_TAGGED_CALL");
          }
        });

        test("little bobby tables", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const name = "Robert'); DROP TABLE students;--";

          try {
            await sql`create table students (name text, age int)`;
            await sql`insert into students (name) values (${name})`;

            expect((await sql`select name from students`)[0].name).toBe(name);
          } finally {
            await sql`drop table students`;
          }
        });

        test("Connection errors are caught using begin()", async () => {
          let error;
          try {
            const sql = new SQL({ host: "localhost", port: 1, adapter: "mysql" });

            await sql.begin(async sql => {
              await sql`insert into test_connection_errors (label, value) values (${1}, ${2})`;
            });
          } catch (err) {
            error = err;
          }
          expect(error.code).toBe("ERR_MYSQL_CONNECTION_CLOSED");
        });

        test("dynamic table name", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          await sql`create table test_dynamic_table_name(a int)`;
          try {
            return expect((await sql`select * from ${sql("test_dynamic_table_name")}`).length).toBe(0);
          } finally {
            await sql`drop table test_dynamic_table_name`;
          }
        });

        test("dynamic column name", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const result = await sql`select 1 as ${sql("!not_valid")}`;
          expect(Object.keys(result[0])[0]).toBe("!not_valid");
        });

        test("dynamic insert", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          await sql`create table test_dynamic_insert (a int, b text)`;
          try {
            const x = { a: 42, b: "the answer" };
            await sql`insert into test_dynamic_insert ${sql(x)}`;
            const [{ b }] = await sql`select * from test_dynamic_insert`;
            expect(b).toBe("the answer");
          } finally {
            await sql`drop table test_dynamic_insert`;
          }
        });

        test("dynamic insert pluck", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          try {
            await sql`create table test_dynamic_insert_pluck (a int, b text)`;
            const x = { a: 42, b: "the answer" };
            await sql`insert into test_dynamic_insert_pluck ${sql(x, "a")}`;
            const [{ b, a }] = await sql`select * from test_dynamic_insert_pluck`;
            expect(b).toBeNull();
            expect(a).toBe(42);
          } finally {
            await sql`drop table test_dynamic_insert_pluck`;
          }
        });

        test("bigint is returned as String", async () => {
          expect(typeof (await sql`select 9223372036854777 as x`)[0].x).toBe("string");
        });

        test("bigint is returned as BigInt", async () => {
          await using sql = new SQL({
            ...getOptions(),
            bigint: true,
          });
          expect((await sql`select 9223372036854777 as x`)[0].x).toBe(9223372036854777n);
        });

        test("int is returned as Number", async () => {
          expect((await sql`select CAST(123 AS SIGNED) as x`)[0].x).toBe(123);
        });

        test("flush should work", async () => {
          await sql`select 1`;
          sql.flush();
        });

        describe("timeouts", () => {
          test.each(["connect_timeout", "connectTimeout", "connectionTimeout", "connection_timeout"] as const)(
            "connection timeout key %p throws",
            async key => {
              const server = net.createServer().listen();

              const port = (server.address() as import("node:net").AddressInfo).port;

              const sql = new SQL({ adapter: "mysql", port, host: "127.0.0.1", max: 1, [key]: 0.2 });

              try {
                await sql`select 1`;
                throw new Error("should not reach");
              } catch (e) {
                expect(e).toBeInstanceOf(Error);
                expect(e.code).toBe("ERR_MYSQL_CONNECTION_TIMEOUT" as any);
                expect(e.message).toMatch(/Connection time(d out|out) after 200ms/);
              } finally {
                sql.close();
                server.close();
              }
            },
            {
              timeout: 1000,
            },
          );
        });
        test("Array returns rows as arrays of columns", async () => {
          return [(await sql`select CAST(1 AS SIGNED) as x`.values())[0][0], 1];
        });
      },
    );
  }
}
