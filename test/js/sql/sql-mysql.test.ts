import { SQL, randomUUIDv7 } from "bun";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { once } from "events";
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

// Assertions for the NEWDECIMAL decoder against a real server, used by the
// docker-backed suite below. (The non-docker mock-server suite at the end of
// this file drives a single canned column, so it asserts inline instead.)
//
// MySQL reports computed/aggregate NEWDECIMAL columns (SUM/AVG/CAST/arithmetic/
// ROUND/literals, and SUM of an INT column) with the BINARY flag and charset
// 63. The binary-charset heuristic used for STRING/BLOB types wrongly returned
// these as Buffers; NEWDECIMAL is always ASCII decimal text.
async function assertComputedDecimalsAreStrings(sql: SQL) {
  const t = "dec_" + randomUUIDv7("hex").replaceAll("-", "");
  await sql`CREATE TEMPORARY TABLE ${sql(t)} (id INT, balance DECIMAL(12,2), qty INT)`;
  await sql`INSERT INTO ${sql(t)} VALUES (1, 100.50, 3), (2, 250.25, 4)`;

  // Aggregate decimals, plus a decimal literal and SUM of an INT column (which
  // MySQL also returns as NEWDECIMAL). Kept separate from the per-row
  // expressions below so the query has no non-aggregated columns and stays
  // valid under ONLY_FULL_GROUP_BY (the MySQL 8+ default).
  const aggExpected = { total: "350.75", avg_bal: "175.375000", sum_int: "7", lit: "1.23" };
  // Binary protocol (prepared statement).
  const [aggRow] = await sql`
    SELECT SUM(balance) AS total, AVG(balance) AS avg_bal, SUM(qty) AS sum_int, 1.23 AS lit
    FROM ${sql(t)}`;
  expect(aggRow).toEqual(aggExpected);
  // Text protocol (`.simple()`) must decode the same way.
  const [aggSimple] = await sql`
    SELECT SUM(balance) AS total, AVG(balance) AS avg_bal, SUM(qty) AS sum_int, 1.23 AS lit
    FROM ${sql(t)}`.simple();
  expect(aggSimple).toEqual(aggExpected);

  // Per-row computed decimals: CAST, arithmetic, ROUND, and a plain stored
  // column. A single row is selected so the result is deterministic.
  const rowExpected = { casted: "100.5000", mul2: "201.00", rounded: "100.5", plain: "100.50" };
  const [row] = await sql`
    SELECT CAST(balance AS DECIMAL(20,4)) AS casted, balance*2 AS mul2, ROUND(balance,1) AS rounded, balance AS plain
    FROM ${sql(t)} WHERE id = ${1}`;
  expect(row).toEqual(rowExpected);
  const [simpleRow] = await sql`
    SELECT CAST(balance AS DECIMAL(20,4)) AS casted, balance*2 AS mul2, ROUND(balance,1) AS rounded, balance AS plain
    FROM ${sql(t)} WHERE id = 1`.simple();
  expect(simpleRow).toEqual(rowExpected);

  // `.raw()` must still return raw bytes.
  const [rawRow] = await sql`SELECT SUM(balance) AS total FROM ${sql(t)}`.raw();
  expect(rawRow[0]).toEqual(new Uint8Array(Buffer.from("350.75")));
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
        test("rejects a bind parameter that cannot be framed in a single wire packet", async () => {
          await using db = new SQL({ ...getOptions(), max: 1 });

          // A large but representable payload round-trips normally.
          const ok = Buffer.alloc(1024 * 1024, 0x42);
          expect((await db`select length(${ok}) as n`)[0].n).toBe(ok.length);

          // The MySQL packet header stores the payload length in 24 bits. A
          // payload of >= 0xFFFFFF cannot be framed as a single packet; the
          // client must refuse to send it instead of emitting a truncated
          // length that the server would reparse as additional, independently
          // framed client packets.
          const oversized = Buffer.alloc(0xffffff + 64, 0x41);
          const err = await db`select length(${oversized}) as n`.then(
            () => ({ code: "UNEXPECTED_SUCCESS" }),
            e => ({ code: (e as any)?.code ?? String(e) }),
          );
          expect(err).toEqual({ code: "ERR_MYSQL_OVERFLOW" });
        });

        let sql: SQL;
        const password = image.image === "mysql_plain" ? "" : "bun";
        const getOptions = (): Bun.SQL.Options => ({
          url: `mysql://root:${password}@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
          allowPublicKeyRetrieval: true,
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
        test("MEDIUMINT not in the last column reads following columns correctly", async () => {
          // MySQL's binary protocol sends MYSQL_TYPE_INT24 as a fixed 4-byte
          // field. Reading only 3 left the cursor 1 byte behind, silently
          // corrupting every following column (and hanging forever if a
          // length-prefixed column like VARCHAR followed).
          await using db = new SQL({ ...getOptions(), max: 1, idleTimeout: 5 });
          using sql = await db.reserve();
          const t = "mi_" + randomUUIDv7("hex").replaceAll("-", "");
          await sql`CREATE TEMPORARY TABLE ${sql(t)} (id INT PRIMARY KEY, uviews MEDIUMINT UNSIGNED, sviews MEDIUMINT, balance BIGINT, ratio DOUBLE, name VARCHAR(64))`;
          await sql`INSERT INTO ${sql(t)} VALUES (1, 100, -50, 5000, 3.5, ${"alice"})`;
          const [row] = await sql`SELECT id, uviews, sviews, balance, ratio, name FROM ${sql(t)} WHERE id = ${1}`;
          expect(row).toEqual({ id: 1, uviews: 100, sviews: -50, balance: 5000, ratio: 3.5, name: "alice" });
          // `.raw()` takes a separate branch that must also consume 4 bytes.
          const [rawRow] =
            await sql`SELECT id, uviews, sviews, balance, ratio, name FROM ${sql(t)} WHERE id = ${1}`.raw();
          expect(rawRow).toHaveLength(6);
          expect(rawRow[2]).toEqual(new Uint8Array([0xce, 0xff, 0xff])); // -50 as i24 LE
          expect(Buffer.from(rawRow[5]).toString("utf-8")).toBe("alice");
        });
        test("YEAR not in the last column reads following columns correctly", async () => {
          // MySQL's binary protocol sends MYSQL_TYPE_YEAR as a fixed 2-byte
          // field, but the column definition reports column_length = 4 (display
          // width). Reading column_length bytes left the cursor 2 bytes ahead,
          // returning YEAR as a Buffer and corrupting every following column.
          await using db = new SQL({ ...getOptions(), max: 1, idleTimeout: 5 });
          using sql = await db.reserve();
          const t = "yr_" + randomUUIDv7("hex").replaceAll("-", "");
          await sql`CREATE TEMPORARY TABLE ${sql(t)} (id INT PRIMARY KEY, yr YEAR, followup INT, control SMALLINT, yr_last YEAR)`;
          await sql`INSERT INTO ${sql(t)} VALUES (1, 2024, 12345, 42, 2001)`;
          const [row] = await sql`SELECT id, yr, followup, control, yr_last FROM ${sql(t)} WHERE id = ${1}`;
          expect(row).toEqual({ id: 1, yr: 2024, followup: 12345, control: 42, yr_last: 2001 });
          // `.raw()` takes a separate branch that must also consume 2 bytes.
          const [rawRow] = await sql`SELECT id, yr, followup, control, yr_last FROM ${sql(t)} WHERE id = ${1}`.raw();
          expect(rawRow).toHaveLength(5);
          expect(rawRow[1]).toEqual(new Uint8Array([0xe8, 0x07])); // 2024 as u16 LE
          expect(rawRow[2]).toEqual(new Uint8Array([0x39, 0x30, 0x00, 0x00])); // 12345 as u32 LE
          expect(rawRow[4]).toEqual(new Uint8Array([0xd1, 0x07])); // 2001 as u16 LE
          // The text protocol (`.simple()`) must decode YEAR as the same number.
          const [simpleRow] = await sql`SELECT id, yr, followup, control, yr_last FROM ${sql(t)} WHERE id = 1`.simple();
          expect(simpleRow).toEqual({ id: 1, yr: 2024, followup: 12345, control: 42, yr_last: 2001 });
        });
        test("computed DECIMAL columns return strings, not Buffers", async () => {
          await using db = new SQL({ ...getOptions(), max: 1, idleTimeout: 5 });
          using sql = await db.reserve();
          await assertComputedDecimalsAreStrings(sql);
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

        test("rebuilds row object shape when a reused statement's result columns change", async () => {
          // Result-set column metadata is re-read from the wire on every execution
          // of a cached prepared statement. When the column count stays the same
          // but the names change (e.g. ALTER TABLE between executions of the same
          // query text), the cached row-object structure must be rebuilt so values
          // are written under the current column names and never past the end of
          // the previously-shaped object.
          await using db = new SQL({ ...getOptions(), max: 1, idleTimeout: 5 });
          using sql = await db.reserve();

          // Same column count, different names across two executions of the same query text.
          const t = "rs_" + randomUUIDv7("hex").replaceAll("-", "");
          await sql`CREATE TEMPORARY TABLE ${sql(t)} (a INT, b INT)`;
          await sql`INSERT INTO ${sql(t)} VALUES (1, 2)`;
          const first = await sql`SELECT * FROM ${sql(t)}`;
          expect(first[0]).toEqual({ a: 1, b: 2 });
          await sql`ALTER TABLE ${sql(t)} CHANGE a c INT, CHANGE b d INT`;
          const second = await sql`SELECT * FROM ${sql(t)}`;
          expect(second[0]).toEqual({ c: 1, d: 2 });

          // Duplicate column names collapse into a single property on the first
          // execution; once a rename makes them distinct, the same cached
          // statement must produce every property of the new column list.
          const ta = "rsa_" + randomUUIDv7("hex").replaceAll("-", "");
          const tb = "rsb_" + randomUUIDv7("hex").replaceAll("-", "");
          await sql`CREATE TEMPORARY TABLE ${sql(ta)} (x INT, y INT)`;
          await sql`CREATE TEMPORARY TABLE ${sql(tb)} (x INT, y INT)`;
          await sql`INSERT INTO ${sql(ta)} VALUES (1, 2)`;
          await sql`INSERT INTO ${sql(tb)} VALUES (3, 4)`;
          const dupFirst = await sql`SELECT * FROM ${sql(ta)} CROSS JOIN ${sql(tb)}`;
          // Last one wins for duplicate names, so only x and y exist.
          expect(Object.keys(dupFirst[0]).sort()).toEqual(["x", "y"]);
          await sql`ALTER TABLE ${sql(tb)} CHANGE x z INT, CHANGE y w INT`;
          const dupSecond = await sql`SELECT * FROM ${sql(ta)} CROSS JOIN ${sql(tb)}`;
          expect(dupSecond[0]).toEqual({ x: 1, y: 2, z: 3, w: 4 });
        });

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

        test("time with fractional seconds", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (a TIME(6))`;
          const times = [
            { a: "02:03:04" },
            { a: "02:03:04.5" },
            { a: "02:03:04.123456" },
            { a: "-02:03:04.123456" },
            { a: "838:59:58.999999" },
            { a: null },
          ];
          await sql`INSERT INTO ${sql(random_name)} ${sql(times)}`;

          // Binary protocol: matches the mysql2 driver — fractional part with trailing
          // zeros stripped, omitted entirely when zero.
          const result = await sql`SELECT * FROM ${sql(random_name)}`;
          expect(result).toEqual([
            { a: "02:03:04" },
            { a: "02:03:04.5" },
            { a: "02:03:04.123456" },
            { a: "-02:03:04.123456" },
            { a: "838:59:58.999999" },
            { a: null },
          ]);

          // Text protocol: server sends the column at its declared precision, passed
          // through as-is.
          const result2 = await sql`SELECT * FROM ${sql(random_name)}`.simple();
          expect(result2).toEqual([
            { a: "02:03:04.000000" },
            { a: "02:03:04.500000" },
            { a: "02:03:04.123456" },
            { a: "-02:03:04.123456" },
            { a: "838:59:58.999999" },
            { a: null },
          ]);
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
          const values = [{ a: Buffer.from([1]), b: Buffer.from([2]), c: Buffer.from([3]) }];
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
        });

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

        // Regression: the error_message stored on a cached failed prepared statement
        // was a .temporary slice into the socket read buffer. Re-running the same
        // failing query after other queries overwrote the buffer would read garbage
        // (or crash under ASAN) when constructing the error from the cached statement.
        test("Cached failed prepared statement returns stable error message", async () => {
          await using sql = new SQL({ ...getOptions(), max: 1 });
          // Need a parameter so it goes through the prepared-statement cache path.
          const err1 = await sql`wat ${1}`.catch(x => x);
          expect(err1.code).toBe("ERR_MYSQL_SYNTAX_ERROR");
          expect(typeof err1.message).toBe("string");
          expect(err1.message.length).toBeGreaterThan(0);

          // Run several successful queries on the same connection to overwrite the
          // socket read buffer that the dangling error_message slice pointed into.
          const filler = Buffer.alloc(1024, "Z").toString();
          for (let i = 0; i < 8; i++) {
            const rows = await sql`select ${filler} as x`;
            expect(rows[0].x).toBe(filler);
          }

          // Hitting the cached .failed statement must reproduce the same error.
          const err2 = await sql`wat ${1}`.catch(x => x);
          expect({
            code: err2.code,
            errno: err2.errno,
            sqlState: err2.sqlState,
            message: err2.message,
          }).toEqual({
            code: err1.code,
            errno: err1.errno,
            sqlState: err1.sqlState,
            message: err1.message,
          });
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

// The docker-backed suite above only runs where a docker daemon is available.
// Decoder-level behavior does not need a real server to exercise, though: a
// minimal mock MySQL server replying with a canned single-column result set
// can drive the decode paths offline, with no docker and no external database.
// These suites run everywhere.

function u16le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}
function u24le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}
function u32le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}
function packet(seq: number, payload: Buffer): Buffer {
  return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]);
}
function lenenc(n: number): Buffer {
  if (n < 0xfb) return Buffer.from([n]);
  if (n < 0xffff) return Buffer.concat([Buffer.from([0xfc]), u16le(n)]);
  throw new Error("lenenc: not needed for these tests");
}
function lenencStr(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  return Buffer.concat([lenenc(buf.length), buf]);
}

const CLIENT_PROTOCOL_41 = 1 << 9;
const CLIENT_SECURE_CONNECTION = 1 << 15;
const CLIENT_PLUGIN_AUTH = 1 << 19;
const CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 1 << 21;
const CLIENT_DEPRECATE_EOF = 1 << 24;
const SERVER_CAPS =
  CLIENT_PROTOCOL_41 |
  CLIENT_SECURE_CONNECTION |
  CLIENT_PLUGIN_AUTH |
  CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA |
  CLIENT_DEPRECATE_EOF;

function handshakeV10(): Buffer {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  return packet(
    0,
    Buffer.concat([
      Buffer.from([10]),
      Buffer.from("mock-5.7.0\0"),
      u32le(1),
      authData1,
      Buffer.from([0]),
      u16le(SERVER_CAPS & 0xffff),
      Buffer.from([0x2d]),
      u16le(0x0002),
      u16le((SERVER_CAPS >>> 16) & 0xffff),
      Buffer.from([21]),
      Buffer.alloc(10, 0),
      authData2,
      Buffer.from("mysql_native_password\0"),
    ]),
  );
}
function okPacket(seq: number, header = 0x00): Buffer {
  return packet(seq, Buffer.from([header, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

const BINARY_FLAG = 1 << 7; // ColumnFlags::BINARY
const BINARY_CHARSET = 63; // the "binary" pseudo-charset

function columnDef(
  name: string,
  type: number,
  opts: { charset: number; length: number; flags: number; decimals: number },
): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr(name),
    lenencStr(name),
    Buffer.from([0x0c]),
    u16le(opts.charset),
    u32le(opts.length),
    Buffer.from([type]),
    u16le(opts.flags),
    Buffer.from([opts.decimals]),
    Buffer.from([0, 0]),
  ]);
}

// Serves one canned single-column result set over both protocols. binaryRows
// are the per-row value bytes for COM_STMT_EXECUTE responses (all rows
// non-NULL, so each row packet is the 0x00 header + empty NULL bitmap + the
// value); textRows are the complete per-row payloads for COM_QUERY responses.
function startMockServer(rs: { column: Buffer; binaryRows: Buffer[]; textRows: Buffer[] }): net.Server {
  function stmtPrepareOK(startSeq: number, stmtId: number): Buffer {
    let seq = startSeq;
    return Buffer.concat([
      packet(
        seq++,
        Buffer.concat([Buffer.from([0x00]), u32le(stmtId), u16le(1), u16le(0), Buffer.from([0x00]), u16le(0)]),
      ),
      packet(seq++, rs.column),
    ]);
  }
  function binaryResultSet(startSeq: number): Buffer {
    let seq = startSeq;
    const packets = [packet(seq++, Buffer.from([1])), packet(seq++, rs.column)];
    for (const value of rs.binaryRows) {
      packets.push(packet(seq++, Buffer.concat([Buffer.from([0x00, 0x00]), value])));
    }
    packets.push(okPacket(seq++, 0xfe));
    return Buffer.concat(packets);
  }
  function textResultSet(startSeq: number): Buffer {
    let seq = startSeq;
    const packets = [packet(seq++, Buffer.from([1])), packet(seq++, rs.column)];
    for (const row of rs.textRows) {
      packets.push(packet(seq++, row));
    }
    packets.push(okPacket(seq++, 0xfe));
    return Buffer.concat(packets);
  }

  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let stmtId = 0;
    socket.write(handshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
        if (buffered.length < 4 + len) break;
        const seq = buffered[3];
        const payload = buffered.subarray(4, 4 + len);
        buffered = buffered.subarray(4 + len);
        if (!authed) {
          authed = true;
          socket.write(okPacket(seq + 1));
          continue;
        }
        const cmd = payload[0];
        if (cmd === 0x16 /* COM_STMT_PREPARE */) {
          socket.write(stmtPrepareOK(seq + 1, ++stmtId));
        } else if (cmd === 0x17 /* COM_STMT_EXECUTE */) {
          socket.write(binaryResultSet(seq + 1));
        } else if (cmd === 0x03 /* COM_QUERY */) {
          socket.write(textResultSet(seq + 1));
        } else if (cmd === 0x19 /* COM_STMT_CLOSE */) {
          // no response expected
        } else {
          socket.end();
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  return server;
}

describe("NEWDECIMAL decodes as a string (mock server, no docker)", () => {
  const MYSQL_TYPE_NEWDECIMAL = 0xf6;
  // The exact wire metadata MySQL attaches to a computed/aggregate DECIMAL
  // (SUM/AVG/CAST/arithmetic/ROUND/literal). Without the NEWDECIMAL
  // special-case in the decoder, `BINARY_FLAG && charset == 63` routes this to
  // a Buffer.
  const DECIMAL_VALUE = "350.75";
  const column = columnDef("total", MYSQL_TYPE_NEWDECIMAL, {
    charset: BINARY_CHARSET,
    length: 1024,
    flags: BINARY_FLAG,
    decimals: 2,
  });

  test("computed DECIMAL columns return strings, not Buffers", async () => {
    // NEWDECIMAL is framed as a length-encoded string in both protocols.
    const server = startMockServer({
      column,
      binaryRows: [lenencStr(DECIMAL_VALUE)],
      textRows: [lenencStr(DECIMAL_VALUE)],
    });
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

      // Binary protocol (prepared statement).
      const [row] = await sql`SELECT SUM(balance) AS total FROM t`;
      expect(row).toEqual({ total: DECIMAL_VALUE });

      // Text protocol (`.simple()`) must decode the same way.
      const [simpleRow] = await sql`SELECT SUM(balance) AS total FROM t`.simple();
      expect(simpleRow).toEqual({ total: DECIMAL_VALUE });

      // `.raw()` must still return the raw bytes.
      const [rawRow] = await sql`SELECT SUM(balance) AS total FROM t`.raw();
      expect(rawRow[0]).toEqual(new Uint8Array(Buffer.from(DECIMAL_VALUE)));
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

// The binary TIME decoder parsed the 12-byte form's microseconds field but
// never wrote it, so TIME(6) values lost their fractional part ("02:03:04.5"
// decoded as "02:03:04"). The fractional part is emitted zero-padded to 6
// digits with trailing zeros stripped, matching the mysql2 driver; the
// docker-backed "time with fractional seconds" test above asserts the same
// values against a real server.
describe("binary TIME keeps fractional seconds (mock server, no docker)", () => {
  const MYSQL_TYPE_TIME = 0x0b;
  const column = columnDef("t", MYSQL_TYPE_TIME, {
    charset: BINARY_CHARSET,
    length: 17,
    flags: BINARY_FLAG,
    decimals: 6,
  });

  // Binary TIME wire value: length byte (8 or 12), then is_negative(1),
  // days(4 LE), hours(1), minutes(1), seconds(1), and for the 12-byte form
  // microseconds(4 LE).
  function binaryTime(t: { negative?: boolean; days?: number; h: number; m: number; s: number; us?: number }): Buffer {
    const head = Buffer.concat([
      Buffer.from([t.us === undefined ? 8 : 12, t.negative ? 1 : 0]),
      u32le(t.days ?? 0),
      Buffer.from([t.h, t.m, t.s]),
    ]);
    return t.us === undefined ? head : Buffer.concat([head, u32le(t.us)]);
  }

  test("fractional seconds survive binary decoding", async () => {
    const server = startMockServer({
      column,
      binaryRows: [
        binaryTime({ h: 2, m: 3, s: 4 }), // 8-byte form, no microseconds field
        binaryTime({ h: 2, m: 3, s: 4, us: 500000 }),
        binaryTime({ h: 2, m: 3, s: 4, us: 123456 }),
        binaryTime({ negative: true, h: 2, m: 3, s: 4, us: 123456 }),
        binaryTime({ days: 34, h: 22, m: 59, s: 58, us: 999999 }), // 838:59:58.999999
        binaryTime({ h: 2, m: 3, s: 4, us: 500 }), // sub-millisecond
        binaryTime({ h: 2, m: 3, s: 4, us: 0 }), // 12-byte form, zero microseconds
      ],
      textRows: [
        lenencStr("02:03:04.000000"),
        lenencStr("02:03:04.500000"),
        lenencStr("02:03:04.123456"),
        lenencStr("-02:03:04.123456"),
        lenencStr("838:59:58.999999"),
        lenencStr("02:03:04.000500"),
        lenencStr("02:03:04.000000"),
      ],
    });
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

      // Binary protocol (prepared statement).
      expect(await sql`SELECT t FROM times`).toEqual([
        { t: "02:03:04" },
        { t: "02:03:04.5" },
        { t: "02:03:04.123456" },
        { t: "-02:03:04.123456" },
        { t: "838:59:58.999999" },
        { t: "02:03:04.0005" },
        { t: "02:03:04" },
      ]);

      // Text protocol (`.simple()`) passes the server's string through verbatim.
      expect(await sql`SELECT t FROM times`.simple()).toEqual([
        { t: "02:03:04.000000" },
        { t: "02:03:04.500000" },
        { t: "02:03:04.123456" },
        { t: "-02:03:04.123456" },
        { t: "838:59:58.999999" },
        { t: "02:03:04.000500" },
        { t: "02:03:04.000000" },
      ]);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
