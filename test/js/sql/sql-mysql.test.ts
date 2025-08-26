import { SQL, randomUUIDv7 } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { describeWithContainer, tempDirWithFiles } from "harness";
import net from "net";
import path from "path";
const dir = tempDirWithFiles("sql-test", {
  "select-param.sql": `select ? as x`,
  "select.sql": `select CAST(1 AS SIGNED) as x`,
});
function rel(filename: string) {
  return path.join(dir, filename);
}
describeWithContainer(
  "mysql",
  {
    image: "mysql:8",
    env: {
      MYSQL_ROOT_PASSWORD: "bun",
    },
  },
  (port: number) => {
    const options = {
      url: `mysql://root:bun@localhost:${port}`,
      max: 1,
    };
    const sql = new SQL(options);
    describe("should work with more than the max inline capacity", () => {
      for (let size of [50, 60, 62, 64, 70, 100]) {
        for (let duplicated of [true, false]) {
          test(`${size} ${duplicated ? "+ duplicated" : "unique"} fields`, async () => {
            await using sql = new SQL(options);
            const longQuery = `select ${Array.from({ length: size }, (_, i) => {
              if (duplicated) {
                return i % 2 === 0 ? `${i + 1} as f${i}, ${i} as f${i}` : `${i} as f${i}`;
              }
              return `${i} as f${i}`;
            }).join(",\n")}`;
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
        ...options,
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
      const onclose = mock();
      const onconnect = mock();
      await using sql = new SQL({
        ...options,
        idle_timeout: 1,
        onconnect,
        onclose,
      });
      let error: any;
      try {
        await sql`select SLEEP(2)`;
      } catch (e) {
        error = e;
      }
      expect(error.code).toBe(`ERR_MYSQL_IDLE_TIMEOUT`);
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
        ...options,
        idle_timeout: 1,
        onconnect,
        onclose,
      });
      expect(await sql`select 123 as x`).toEqual([{ x: 123 }]);
      expect(onconnect).toHaveBeenCalledTimes(1);
      expect(onclose).not.toHaveBeenCalled();
      const err = await onClosePromise.promise;
      expect(err.code).toBe(`ERR_MYSQL_IDLE_TIMEOUT`);
    });

    test("Max lifetime works", async () => {
      const onClosePromise = Promise.withResolvers();
      const onclose = mock(err => {
        onClosePromise.resolve(err);
      });
      const onconnect = mock();
      const sql = new SQL({
        ...options,
        max_lifetime: 1,
        onconnect,
        onclose,
      });
      let error: any;
      expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
      expect(onconnect).toHaveBeenCalledTimes(1);
      try {
        while (true) {
          for (let i = 0; i < 100; i++) {
            await sql`select SLEEP(1)`;
          }
        }
      } catch (e) {
        error = e;
      }

      expect(onclose).toHaveBeenCalledTimes(1);

      expect(error.code).toBe(`ERR_MYSQL_LIFETIME_TIMEOUT`);
    });

    // Last one wins.
    test("Handles duplicate string column names", async () => {
      const result = await sql`select 1 as x, 2 as x, 3 as x`;
      expect(result).toEqual([{ x: 3 }]);
    });

    test("should not timeout in long results", async () => {
      await using db = new SQL({ ...options, max: 1, idleTimeout: 5 });
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
      await sql`create table test(id int)`;
      await sql`drop table test`;
    });

    test("Drop table", async () => {
      await sql`create table test(id int)`;
      await sql`drop table test`;
      // Verify that table is dropped
      const result = await sql`select * from information_schema.tables where table_name = 'test'`;
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

    test("Boolean", async () => {
      // Protocol will always return 0 or 1 for TRUE and FALSE when not using a table.
      expect((await sql`select ${false} as x`)[0].x).toBe(0);
      expect((await sql`select ${true} as x`)[0].x).toBe(1);
      const random_name = ("t_" + Bun.randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a bool)`;
      const values = [{ a: true }, { a: false }];
      await sql`INSERT INTO ${sql(random_name)} ${sql(values)}`;
      const [[a], [b]] = await sql`select * from ${sql(random_name)}`.values();
      expect(a).toBe(true);
      expect(b).toBe(false);
    });

    test("Date", async () => {
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

    test("JSON", async () => {
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

    test("bulk insert nested sql()", async () => {
      await sql`create table users (name text, age int)`;
      const users = [
        { name: "Alice", age: 25 },
        { name: "Bob", age: 30 },
      ];
      try {
        await sql`insert into users ${sql(users)}`;
        const result = await sql`select * from users`;
        expect(result).toEqual([
          { name: "Alice", age: 25 },
          { name: "Bob", age: 30 },
        ]);
      } finally {
        await sql`drop table users`;
      }
    });

    test("Escapes", async () => {
      expect(Object.keys((await sql`select 1 as ${sql('hej"hej')}`)[0])[0]).toBe('hej"hej');
    });

    test("null for int", async () => {
      const result = await sql`create table test (x int)`;
      expect(result.count).toBe(0);
      try {
        await sql`insert into test values(${null})`;
        const result2 = await sql`select * from test`;
        expect(result2).toEqual([{ x: null }]);
      } finally {
        await sql`drop table test`;
      }
    });

    test("should be able to execute different queries in the same connection #16774", async () => {
      const sql = new SQL({ ...options, max: 1 });
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
      await using sql = new SQL(options);
      await sql`create table test (a int)`;

      try {
        await sql.beginDistributed("tx1", async sql => {
          await sql`insert into test values(1)`;
        });
        await sql.commitDistributed("tx1");
        expect((await sql`select count(*) from test`).count).toBe(1);
      } finally {
        await sql`drop table test`;
      }
    });

    test("Idle timeout retry works", async () => {
      await using sql = new SQL({ ...options, idleTimeout: 1 });
      await sql`select 1`;
      await Bun.sleep(1100); // 1.1 seconds so it should retry
      await sql`select 1`;
      expect().pass();
    });

    test("Fragments in transactions", async () => {
      const sql = new SQL({ ...options, debug: true, idle_timeout: 1, fetch_types: false });
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

    test("Null sets to null", async () => expect((await sql`select ${null} as x`)[0].x).toBeNull());

    // Add code property.
    test("Throw syntax error", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const err = await sql`wat 1`.catch(x => x);
      expect(err.code).toBe("ERR_MYSQL_SYNTAX_ERROR");
    });

    test("should work with fragments", async () => {
      await using sql = new SQL({ ...options, max: 1 });
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
      await using sql = new SQL({ ...options, max: 1 });
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
      await using sql = new SQL({ ...options, password: () => "bun", max: 1 });
      return expect((await sql`select 1 as x`)[0].x).toBe(1);
    });

    test("Support dynamic async resolved password function", async () => {
      await using sql = new SQL({
        ...options,
        password: () => Promise.resolve("bun"),
        max: 1,
      });
      return expect((await sql`select 1 as x`)[0].x).toBe(1);
    });

    test("Support dynamic async password function", async () => {
      await using sql = new SQL({
        ...options,
        max: 1,
        password: async () => {
          await Bun.sleep(10);
          return "bun";
        },
      });
      return expect((await sql`select 1 as x`)[0].x).toBe(1);
    });
    test("Support dynamic async rejected password function", async () => {
      await using sql = new SQL({
        ...options,
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
        ...options,
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
      await using sql = new SQL(options);
      expect((await sql.file(rel("select.sql")))[0].x).toBe(1);
    });

    test("sql file throws", async () => {
      await using sql = new SQL(options);
      expect(await sql.file(rel("selectomondo.sql")).catch(x => x.code)).toBe("ENOENT");
    });
    test("Parameters in file", async () => {
      await using sql = new SQL(options);
      const result = await sql.file(rel("select-param.sql"), ["hello"]);
      return expect(result[0].x).toBe("hello");
    });

    test("Connection ended promise", async () => {
      const sql = new SQL(options);

      await sql.end();

      expect(await sql.end()).toBeUndefined();
    });

    test("Connection ended timeout", async () => {
      const sql = new SQL(options);

      await sql.end({ timeout: 10 });

      expect(await sql.end()).toBeUndefined();
    });

    test("Connection ended error", async () => {
      const sql = new SQL(options);
      await sql.end();
      return expect(await sql``.catch(x => x.code)).toBe("ERR_MYSQL_CONNECTION_CLOSED");
    });

    test("Connection end does not cancel query", async () => {
      const sql = new SQL(options);

      const promise = sql`select SLEEP(1) as x`.execute();
      await sql.end();
      return expect(await promise).toEqual([{ x: 0 }]);
    });

    test("Connection destroyed", async () => {
      const sql = new SQL(options);
      process.nextTick(() => sql.end({ timeout: 0 }));
      expect(await sql``.catch(x => x.code)).toBe("ERR_MYSQL_CONNECTION_CLOSED");
    });

    test("Connection destroyed with query before", async () => {
      const sql = new SQL(options);
      const error = sql`select SLEEP(0.2)`.catch(err => err.code);

      sql.end({ timeout: 0 });
      return expect(await error).toBe("ERR_MYSQL_CONNECTION_CLOSED");
    });

    test("unsafe", async () => {
      await sql`create table test (x int)`;
      try {
        await sql.unsafe("insert into test values (?)", [1]);
        const [{ x }] = await sql`select * from test`;
        expect(x).toBe(1);
      } finally {
        await sql`drop table test`;
      }
    });

    test("unsafe simple", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      expect(await sql.unsafe("select 1 as x")).toEqual([{ x: 1 }]);
    });

    test("simple query with multiple statements", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const result = await sql`select 1 as x;select 2 as x`.simple();
      expect(result).toBeDefined();
      expect(result.length).toEqual(2);
      expect(result[0][0].x).toEqual(1);
      expect(result[1][0].x).toEqual(2);
    });

    test("simple query using unsafe with multiple statements", async () => {
      await using sql = new SQL({ ...options, max: 1 });
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
      await using sql = new SQL({ ...options, max: 1 });
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
          await sql`insert into test (label, value) values (${1}, ${2})`;
        });
      } catch (err) {
        error = err;
      }
      expect(error.code).toBe("ERR_MYSQL_CONNECTION_CLOSED");
    });

    test("dynamic table name", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      await sql`create table test(a int)`;
      try {
        return expect((await sql`select * from ${sql("test")}`).length).toBe(0);
      } finally {
        await sql`drop table test`;
      }
    });

    test("dynamic column name", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const result = await sql`select 1 as ${sql("!not_valid")}`;
      expect(Object.keys(result[0])[0]).toBe("!not_valid");
    });

    test("dynamic insert", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      await sql`create table test (a int, b text)`;
      try {
        const x = { a: 42, b: "the answer" };
        await sql`insert into test ${sql(x)}`;
        const [{ b }] = await sql`select * from test`;
        expect(b).toBe("the answer");
      } finally {
        await sql`drop table test`;
      }
    });

    test("dynamic insert pluck", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      try {
        await sql`create table test2 (a int, b text)`;
        const x = { a: 42, b: "the answer" };
        await sql`insert into test2 ${sql(x, "a")}`;
        const [{ b, a }] = await sql`select * from test2`;
        expect(b).toBeNull();
        expect(a).toBe(42);
      } finally {
        await sql`drop table test2`;
      }
    });

    test("bigint is returned as String", async () => {
      await using sql = new SQL(options);
      expect(typeof (await sql`select 9223372036854777 as x`)[0].x).toBe("string");
    });

    test("bigint is returned as BigInt", async () => {
      await using sql = new SQL({
        ...options,
        bigint: true,
      });
      expect((await sql`select 9223372036854777 as x`)[0].x).toBe(9223372036854777n);
    });

    test("int is returned as Number", async () => {
      await using sql = new SQL(options);
      expect((await sql`select CAST(123 AS SIGNED) as x`)[0].x).toBe(123);
    });

    test("flush should work", async () => {
      await using sql = new SQL(options);
      await sql`select 1`;
      sql.flush();
    });

    test.each(["connect_timeout", "connectTimeout", "connectionTimeout", "connection_timeout"] as const)(
      "connection timeout key %p throws",
      async key => {
        const server = net.createServer().listen();

        const port = (server.address() as import("node:net").AddressInfo).port;

        const sql = new SQL({ adapter: "mysql", port, host: "127.0.0.1", [key]: 0.2 });

        try {
          await sql`select 1`;
          throw new Error("should not reach");
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
          expect(e.code).toBe("ERR_MYSQL_CONNECTION_TIMEOUT");
          expect(e.message).toMatch(/Connection timed out after 200ms/);
        } finally {
          sql.close();
          server.close();
        }
      },
      {
        timeout: 1000,
      },
    );
    test("Array returns rows as arrays of columns", async () => {
      await using sql = new SQL(options);
      return [(await sql`select CAST(1 AS SIGNED) as x`.values())[0][0], 1];
    });
  },
);
