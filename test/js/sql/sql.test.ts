import { $, randomUUIDv7, sql, SQL } from "bun";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, isCI, isDockerEnabled, tempDirWithFiles } from "harness";
import * as net from "node:net";
import path from "path";
const postgres = (...args) => new SQL(...args);

const dir = tempDirWithFiles("sql-test", {
  "select-param.sql": `select $1 as x`,
  "select.sql": `select 1 as x`,
});

function rel(filename: string) {
  return path.join(dir, filename);
}
// Use docker-compose infrastructure
import * as dockerCompose from "../../docker/index.ts";
import { UnixDomainSocketProxy } from "../../unix-domain-socket-proxy.ts";

if (isDockerEnabled()) {
  describe("PostgreSQL tests", async () => {
    let container: { port: number; host: string };
    let socketProxy: UnixDomainSocketProxy;
    let login: Bun.SQL.PostgresOrMySQLOptions;
    let login_domain_socket: Bun.SQL.PostgresOrMySQLOptions;
    let login_md5: Bun.SQL.PostgresOrMySQLOptions;
    let login_scram: Bun.SQL.PostgresOrMySQLOptions;
    let options: Bun.SQL.PostgresOrMySQLOptions;

    const info = await dockerCompose.ensure("postgres_plain");
    console.log("PostgreSQL container ready at:", info.host + ":" + info.ports[5432]);
    container = {
      port: info.ports[5432],
      host: info.host,
    };
    process.env.DATABASE_URL = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

    // Create Unix socket proxy for PostgreSQL
    socketProxy = await UnixDomainSocketProxy.create("PostgreSQL", container.host, container.port);

    login = {
      username: "bun_sql_test",
      host: container.host,
      port: container.port,
      path: socketProxy.path,
    };

    login_domain_socket = {
      username: "bun_sql_test",
      host: container.host,
      port: container.port,
      path: socketProxy.path,
    };

    login_md5 = {
      username: "bun_sql_test_md5",
      password: "bun_sql_test_md5",
      host: container.host,
      port: container.port,
    };

    login_scram = {
      username: "bun_sql_test_scram",
      password: "bun_sql_test_scram",
      host: container.host,
      port: container.port,
    };

    options = {
      db: "bun_sql_test",
      username: login.username,
      password: login.password,
      host: container.host,
      port: container.port,
      max: 1,
    };

    afterAll(async () => {
      // Containers persist - managed by docker-compose
      if (!process.env.BUN_KEEP_DOCKER) {
        await dockerCompose.down();
      }
    });

    // require("./bootstrap.js");

    // macOS location: /opt/homebrew/var/postgresql@14/pg_hba.conf
    // --- Expected pg_hba.conf ---
    // local all ${USERNAME} trust
    // local all postgres trust
    // local all bun_sql_test_scram scram-sha-256
    // local all bun_sql_test trust
    // local all bun_sql_test_md5 md5

    // # IPv4 local connections:
    // host all ${USERNAME} 127.0.0.1/32 trust
    // host all postgres 127.0.0.1/32 trust
    // host all bun_sql_test_scram 127.0.0.1/32 scram-sha-256
    // host all bun_sql_test 127.0.0.1/32 trust
    // host all bun_sql_test_md5 127.0.0.1/32 md5
    // # IPv6 local connections:
    // host all ${USERNAME} ::1/128 trust
    // host all postgres ::1/128 trust
    // host all bun_sql_test ::1/128 trust
    // host all bun_sql_test_scram ::1/128 scram-sha-256
    // host all bun_sql_test_md5 ::1/128 md5
    // # Allow replication connections from localhost, by a user with the
    // # replication privilege.
    // local replication all trust
    // host replication all 127.0.0.1/32 trust
    // host replication all ::1/128 trust
    // --- Expected pg_hba.conf ---

    // Clean up the socket on exit
    afterAll(() => {
      if (socketProxy) {
        socketProxy.stop();
      }
    });
    test("should handle numeric values with many digits", async () => {
      await using sql = postgres(options);
      // handle numbers big than 10,4 with zeros at the end and start, starting with 0. or not
      for (let value of [
        "1234.00005678912345670000",
        "1234.12345678912345670000",
        "1234.12345678912345678912",
        "1234.12345678912345678900",
        "0.00005678912345670000",
        "0.12345678912345670000",
        "0.12345678912345678912",
        "0.12345678912345678900",
      ]) {
        const [{ x }] = await sql`select CAST(${value} as NUMERIC(30,20)) as x`;
        expect(x).toBe(value);
      }
      // zero specifically
      const [{ x }] = await sql`select CAST(${"0.00000000000000000000"} as NUMERIC(30,20)) as x`;
      expect(x).toBe("0");
    });

    describe("Array helpers", () => {
      test("SQL helper should support sql.array", async () => {
        await using sql = postgres(options);
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (
            id SERIAL PRIMARY KEY,
            name VARCHAR NOT NULL,
            roles TEXT[]
        );`;

        const [{ id, name, roles }] =
          await sql`insert into ${sql(random_name)} (name, roles) values (${"test"}, ${sql.array(["a", "b"], "TEXT")}) returning *`;

        expect(id).toBe(1);
        expect(name).toBe("test");
        expect(roles).toEqual(["a", "b"]);

        const [{ id: update_id, name: update_name, roles: update_roles }] =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "test2", roles: sql.array(["c", "d"], "TEXT") })} WHERE id = ${id} RETURNING *`;
        expect(update_id).toBe(1);
        expect(update_name).toBe("test2");
        expect(update_roles).toEqual(["c", "d"]);
      });

      test("sql.array should support jsonb and json", async () => {
        await using sql = postgres(options);
        {
          const [{ x }] = await sql`select ${sql.array([{ a: 1 }, { b: 2 }], "JSONB")} as x`;
          expect(x).toEqual([{ a: 1 }, { b: 2 }]);
        }
        {
          const [{ x }] = await sql`select ${sql.array([{ a: 1 }, { b: 2 }], "JSON")} as x`;
          expect(x).toEqual([{ a: 1 }, { b: 2 }]);
        }

        {
          // should handle most common types properly
          const date = new Date(Date.UTC(2025, 1, 1));
          const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
          const [{ x }] =
            await sql`select ${sql.array([date, 1n, 1, 1.1, true, false, null, undefined, "hello", buffer], "JSON")} as x`;
          expect(x).toEqual([date.toISOString(), 1, 1, 1.1, true, false, null, null, "hello", buffer.toString("hex")]);
        }
      });

      test("should be able to insert array in jsonb fields", async () => {
        await using sql = postgres(options);
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (
            id SERIAL PRIMARY KEY,
            json JSONB
        );`;

        await sql`insert into ${sql(random_name)} (json) values (${["a", "b"]})`;
        const [{ id, json }] = await sql`select * from ${sql(random_name)}`;

        expect(id).toBe(1);
        expect(json).toEqual(["a", "b"]);
      });
      test("should be able to insert array in fields", async () => {
        await using sql = postgres(options);
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (
            id SERIAL PRIMARY KEY,
            json JSON
        );`;

        await sql`insert into ${sql(random_name)} (json) values (${["a", "b"]})`;
        const [{ id, json }] = await sql`select * from ${sql(random_name)}`;
        expect(id).toBe(1);
        expect(json).toEqual(["a", "b"]);
      });

      test("sql.array should support TEXT arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array(["hello", "world", "test"], "TEXT")} as x`;
        expect(x).toEqual(["hello", "world", "test"]);
      });

      test("sql.array should support BOOLEAN arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array([true, false, true], "BOOLEAN")} as x`;
        expect(x).toEqual([true, false, true]);
      });

      test("sql.array should support SMALLINT arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array([1, 2, 3, -32768, 32767], "SMALLINT")} as x`;
        expect(x).toEqual([1, 2, 3, -32768, 32767]);
      });

      test("sql.array should support INTEGER arrays", async () => {
        await using sql = postgres(options);

        {
          const [{ x }] = await sql`select ${sql.array([100000, -2147483648, 2147483647], "INT")} as x`;
          expect(x).toEqual(new Int32Array([100000, -2147483648, 2147483647]));
        }
        {
          const [{ x }] =
            await sql`select ${sql.array(Int32Array.from([100000, -2147483648, 2147483647]), "INT")} as x`;
          expect(x).toEqual(new Int32Array([100000, -2147483648, 2147483647]));
        }
      });

      test("sql.array should support BIGINT arrays", async () => {
        await using sql = postgres(options);

        const bigints = [1n, 9999999999n, -9999999999n, 2147483648n];
        const [{ x }] = await sql`select ${sql.array(bigints, "BIGINT")} as x`;
        expect(x).toEqual(bigints.map(n => n.toString()));
      });

      test("sql.array should support REAL (float4) arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array([1.5, 2.7, -3.14], "REAL")} as x`;
        expect(x[0]).toBeCloseTo(1.5);
        expect(x[1]).toBeCloseTo(2.7);
        expect(x[2]).toBeCloseTo(-3.14);
      });

      test("sql.array should support DOUBLE PRECISION (float8) arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array([1.123456789, 2.987654321, Math.PI], "DOUBLE PRECISION")} as x`;
        expect(x[0]).toBeCloseTo(1.123456789);
        expect(x[1]).toBeCloseTo(2.987654321);
        expect(x[2]).toBeCloseTo(Math.PI);
      });

      test("sql.array should support NUMERIC arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] =
          await sql`select ${sql.array([1.1, 2.22, 333.333, "99999999999999999999.9999"], "NUMERIC")} as x`;
        expect(x).toEqual(["1.1", "2.22", "333.333", "99999999999999999999.9999"]);
      });

      test("sql.array should support DATE arrays", async () => {
        await using sql = postgres(options);

        const date1 = new Date("2025-01-01");
        const date2 = new Date("2025-12-31");
        const [{ x }] = await sql`select ${sql.array([date1, date2], "DATE")} as x`;
        expect(x[0]).toEqual(date1);
        expect(x[1]).toEqual(date2);
      });

      test("sql.array should support TIMESTAMP arrays", async () => {
        await using sql = postgres(options);

        const ts1 = new Date("2025-01-01T12:30:45");
        const ts2 = new Date("2025-06-15T18:45:30");
        const [{ x }] = await sql`select ${sql.array([ts1, ts2], "TIMESTAMP")} as x`;
        expect(new Date(x[0])).toEqual(ts1);
        expect(new Date(x[1])).toEqual(ts2);
      });

      test("sql.array should support TIMESTAMPTZ arrays", async () => {
        await using sql = postgres(options);

        const ts1 = new Date(Date.UTC(2025, 0, 1, 10, 30, 0));
        const ts2 = new Date(Date.UTC(2025, 5, 15, 20, 45, 0));
        const [{ x }] = await sql`select ${sql.array([ts1, ts2], "TIMESTAMPTZ")} as x`;
        expect(new Date(x[0])).toEqual(ts1);
        expect(new Date(x[1])).toEqual(ts2);
      });

      test("sql.array should support TIME arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array(["12:30:45", "18:45:30", "00:00:00"], "TIME")} as x`;
        expect(x).toEqual(["12:30:45", "18:45:30", "00:00:00"]);
      });

      test("sql.array should support INTERVAL arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array(["1 day", "2 hours", "30 minutes"], "INTERVAL")} as x`;
        expect(x).toEqual(["1 day", "02:00:00", "00:30:00"]);
      });

      test("sql.array should support UUID arrays", async () => {
        await using sql = postgres(options);

        const uuids = ["123e4567-e89b-12d3-a456-426614174000", "550e8400-e29b-41d4-a716-446655440000"];
        const [{ x }] = await sql`select ${sql.array(uuids, "UUID")} as x`;
        // TODO: we should parse it as an array of UUIDs
        expect(x).toEqual("{123e4567-e89b-12d3-a456-426614174000,550e8400-e29b-41d4-a716-446655440000}");
      });

      test("sql.array should support INET arrays", async () => {
        await using sql = postgres(options);

        const ips = ["192.168.1.1", "10.0.0.1", "::1", "2001:db8::1"];
        const [{ x }] = await sql`select ${sql.array(ips, "INET")} as x`;
        expect(x).toEqual(ips);
      });

      test("sql.array should support CIDR arrays", async () => {
        await using sql = postgres(options);

        const cidrs = ["192.168.1.0/24", "10.0.0.0/8", "2001:db8::/32"];
        const [{ x }] = await sql`select ${sql.array(cidrs, "CIDR")} as x`;
        expect(x).toEqual(cidrs);
      });

      test("sql.array should support MACADDR arrays", async () => {
        await using sql = postgres(options);

        const macs = ["08:00:27:01:02:03", "aa:bb:cc:dd:ee:ff"];
        const [{ x }] = await sql`select ${sql.array(macs, "MACADDR")} as x`;
        expect(x).toEqual(macs);
      });

      test("sql.array should support BIT arrays", async () => {
        await using sql = postgres(options);

        const bits = ["101", "1111", "0000"];
        const [{ x }] = await sql`select ${sql.array(bits, "BIT")} as x`;
        expect(x).toEqual(["1", "1", "0"]);
      });

      test("sql.array should support VARBIT arrays", async () => {
        await using sql = postgres(options);

        const varbits = ["1", "101010", "11111111"];
        const [{ x }] = await sql`select ${sql.array(varbits, "VARBIT")} as x`;
        expect(x).toEqual(varbits);
      });

      test("sql.array should support MONEY arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array(["$1.50", "$999.99", "-$50.00"], "MONEY")} as x`;
        expect(x).toEqual(["$1.50", "$999.99", "-$50.00"]);
      });

      test("sql.array should support CHAR arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array(["a", "b", "c"], "CHAR")} as x`;
        expect(x).toEqual(["a", "b", "c"]);
      });

      test("sql.array should support VARCHAR arrays", async () => {
        await using sql = postgres(options);

        const [{ x }] = await sql`select ${sql.array(["hello", "world", "test"], "VARCHAR")} as x`;
        expect(x).toEqual(["hello", "world", "test"]);
      });

      test("sql.array should support geometric types", async () => {
        await using sql = postgres(options);

        // POINT arrays
        const points = ["(1,2)", "(3.5,4.5)", "(-1,-2)"];
        const [{ p }] = await sql`select ${sql.array(points, "POINT")} as p`;
        expect(p).toEqual(points);

        // BOX arrays
        const boxes = ["((0,0),(1,1))", "((2,2),(4,4))"];
        const [{ b }] = await sql`select ${sql.array(boxes, "BOX")} as b`;
        expect(b.length).toBe(2);

        // CIRCLE arrays
        const circles = ["<(0,0),5>", "<(10,10),2.5>"];
        const [{ c }] = await sql`select ${sql.array(circles, "CIRCLE")} as c`;
        expect(c.length).toBe(2);
      });

      test("sql.array should handle mixed types with explicit casting", async () => {
        await using sql = postgres(options);

        // Everything gets cast to the specified type
        const date = new Date();
        const mixed = [1, "2", 3.5, date];
        const [{ x }] = await sql`select ${sql.array(mixed, "TEXT")} as x`;
        expect(x).toEqual(["1", "2", "3.5", date.toISOString()]);
      });
    });

    describe("Time/TimeZ", () => {
      test("PostgreSQL TIME and TIMETZ types are handled correctly", async () => {
        const db = postgres(options);

        try {
          // Create test table with time and timetz columns
          await db`DROP TABLE IF EXISTS bun_time_test`;
          await db`
      CREATE TABLE bun_time_test (
        id SERIAL PRIMARY KEY,
        regular_time TIME,
        time_with_tz TIMETZ
      )
    `;

          // Insert test data with various time values
          await db`
      INSERT INTO bun_time_test (regular_time, time_with_tz) VALUES
        ('09:00:00', '09:00:00+00'),
        ('10:30:45.123456', '10:30:45.123456-05'),
        ('23:59:59.999999', '23:59:59.999999+08:30'),
        ('00:00:00', '00:00:00-12:00'),
        (NULL, NULL)
    `;

          // Query the data
          const result = await db`
      SELECT
        id,
        regular_time,
        time_with_tz
      FROM bun_time_test
      ORDER BY id
    `;

          // Verify that time values are returned as strings, not binary data
          expect(result[0].regular_time).toBe("09:00:00");
          expect(result[0].time_with_tz).toBe("09:00:00+00");

          expect(result[1].regular_time).toBe("10:30:45.123456");
          expect(result[1].time_with_tz).toBe("10:30:45.123456-05");

          expect(result[2].regular_time).toBe("23:59:59.999999");
          expect(result[2].time_with_tz).toBe("23:59:59.999999+08:30");

          expect(result[3].regular_time).toBe("00:00:00");
          expect(result[3].time_with_tz).toBe("00:00:00-12");

          // NULL values
          expect(result[4].regular_time).toBeNull();
          expect(result[4].time_with_tz).toBeNull();

          // None of the values should contain null bytes
          for (const row of result) {
            if (row.regular_time) {
              expect(row.regular_time).not.toContain("\u0000");
              expect(typeof row.regular_time).toBe("string");
            }
            if (row.time_with_tz) {
              expect(row.time_with_tz).not.toContain("\u0000");
              expect(typeof row.time_with_tz).toBe("string");
            }
          }

          // Clean up
          await db`DROP TABLE bun_time_test`;
        } finally {
          await db.end();
        }
      });

      test("PostgreSQL TIME array types are handled correctly", async () => {
        const db = postgres(options);

        try {
          // Create test table with time array
          await db`DROP TABLE IF EXISTS bun_time_array_test`;
          await db`
      CREATE TABLE bun_time_array_test (
        id SERIAL PRIMARY KEY,
        time_values TIME[],
        timetz_values TIMETZ[]
      )
    `;

          // Insert test data
          await db`
      INSERT INTO bun_time_array_test (time_values, timetz_values) VALUES
        (ARRAY['09:00:00'::time, '17:00:00'::time], ARRAY['09:00:00+00'::timetz, '17:00:00-05'::timetz]),
        (ARRAY['10:30:00'::time, '18:30:00'::time, '20:00:00'::time], ARRAY['10:30:00+02'::timetz]),
        (NULL, NULL),
        (ARRAY[]::time[], ARRAY[]::timetz[])
    `;

          const result = await db`
      SELECT
        id,
        time_values,
        timetz_values
      FROM bun_time_array_test
      ORDER BY id
    `;

          // Verify array values
          expect(result[0].time_values).toEqual(["09:00:00", "17:00:00"]);
          expect(result[0].timetz_values).toEqual(["09:00:00+00", "17:00:00-05"]);

          expect(result[1].time_values).toEqual(["10:30:00", "18:30:00", "20:00:00"]);
          expect(result[1].timetz_values).toEqual(["10:30:00+02"]);

          expect(result[2].time_values).toBeNull();
          expect(result[2].timetz_values).toBeNull();

          expect(result[3].time_values).toEqual([]);
          expect(result[3].timetz_values).toEqual([]);

          // Ensure no binary data in arrays
          for (const row of result) {
            if (row.time_values && Array.isArray(row.time_values)) {
              for (const time of row.time_values) {
                expect(typeof time).toBe("string");
                expect(time).not.toContain("\u0000");
              }
            }
            if (row.timetz_values && Array.isArray(row.timetz_values)) {
              for (const time of row.timetz_values) {
                expect(typeof time).toBe("string");
                expect(time).not.toContain("\u0000");
              }
            }
          }

          // Clean up
          await db`DROP TABLE bun_time_array_test`;
        } finally {
          await db.end();
        }
      });

      test("PostgreSQL TIME in nested structures (JSONB) works correctly", async () => {
        const db = postgres(options);

        try {
          await db`DROP TABLE IF EXISTS bun_time_json_test`;
          await db`
      CREATE TABLE bun_time_json_test (
        id SERIAL PRIMARY KEY,
        schedule JSONB
      )
    `;

          // Insert test data with times in JSONB
          await db`
      INSERT INTO bun_time_json_test (schedule) VALUES
        ('{"dayOfWeek": 1, "timeBlocks": [{"startTime": "09:00:00", "endTime": "17:00:00"}]}'::jsonb),
        ('{"dayOfWeek": 2, "timeBlocks": [{"startTime": "10:30:00", "endTime": "18:30:00"}]}'::jsonb)
    `;

          const result = await db`
      SELECT
        id,
        schedule
      FROM bun_time_json_test
      ORDER BY id
    `;

          // Verify JSONB with time strings
          expect(result[0].schedule.dayOfWeek).toBe(1);
          expect(result[0].schedule.timeBlocks[0].startTime).toBe("09:00:00");
          expect(result[0].schedule.timeBlocks[0].endTime).toBe("17:00:00");

          expect(result[1].schedule.dayOfWeek).toBe(2);
          expect(result[1].schedule.timeBlocks[0].startTime).toBe("10:30:00");
          expect(result[1].schedule.timeBlocks[0].endTime).toBe("18:30:00");

          // Clean up
          await db`DROP TABLE bun_time_json_test`;
        } finally {
          await db.end();
        }
      });
    });

    test("should handle encoded chars in password and username when using url #17155", () => {
      const sql = new Bun.SQL("postgres://bun%40bunbun:bunbun%40bun@127.0.0.1:5432/bun%40bun");
      expect(sql.options.username).toBe("bun@bunbun");
      expect(sql.options.password).toBe("bunbun@bun");
      expect(sql.options.database).toBe("bun@bun");
    });

    test("Minimal reproduction of Bun.SQL PostgreSQL hang bug (#22395)", async () => {
      for (let i = 0; i < 10; i++) {
        await using sql = new SQL({
          ...options,
          idleTimeout: 10,
          connectionTimeout: 10,
          maxLifetime: 10,
        });

        const random_id = randomUUIDv7() + "test_hang";
        // Setup: Create table with exclusion constraint
        await sql`DROP TABLE IF EXISTS ${sql(random_id)} CASCADE`;
        await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`;
        await sql`
      CREATE TABLE ${sql(random_id)} (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        resource_id INT NOT NULL,
        EXCLUDE USING gist (
          resource_id WITH =,
          tstzrange(start_time, end_time) WITH &&
        )
      )
    `;

        // Step 1: Insert a row (succeeds)
        await sql`
      INSERT INTO ${sql(random_id)} (start_time, end_time, resource_id)
      VALUES ('2024-01-01 10:00:00', '2024-01-01 12:00:00', 1)
    `;

        // Step 2: Try to insert conflicting row (throws expected error)
        try {
          await sql`
        INSERT INTO ${sql(random_id)} (start_time, end_time, resource_id)
        VALUES (${"2024-01-01 11:00:00"}, ${"2024-01-01 13:00:00"}, ${1})
      `;
          expect.unreachable();
        } catch {}

        // Step 3: Try another query - THIS WILL HANG
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("TIMEOUT")), 200);
        });

        try {
          const result = await Promise.race([sql`SELECT COUNT(*) FROM ${sql(random_id)}`, timeoutPromise]);
          expect(result[0].count).toBe("1");
        } catch (err: any) {
          expect(err.message).not.toBe("TIMEOUT");
        }
      }
    });

    test("Connects with no options", async () => {
      // we need at least the usename and port
      await using sql = postgres({ max: 1, host: container.host, port: container.port, username: login.username });

      const result = (await sql`select 1 as x`)[0].x;
      sql.close();
      expect(result).toBe(1);
    });

    describe("should work with more than the max inline capacity", () => {
      const sql = postgres(options);
      afterAll(() => sql.close());

      for (let size of [50, 60, 62, 64, 70, 100]) {
        for (let duplicated of [true, false]) {
          test(`${size} ${duplicated ? "+ duplicated" : "unique"} fields`, async () => {
            const longQuery = `select ${Array.from({ length: size }, (_, i) => {
              if (duplicated) {
                return i % 2 === 0 ? `${i + 1} as f${i}, ${i} as f${i}` : `${i} as f${i}`;
              }
              return `${i} as f${i}`;
            }).join(",\n")}`;
            const result = await sql.unsafe(longQuery);
            let value = 0;
            for (const column of Object.values(result[0])) {
              expect(column).toBe(value);
              value++;
            }
          });
        }
      }
    });

    test("Connection timeout works", async () => {
      const onclose = mock();
      const onconnect = mock();
      await using sql = postgres({
        db: "bun_sql_test",
        username: "bun_sql_test",
        host: "example.com",
        port: 5432,
        connection_timeout: 4,
        onconnect,
        onclose,
        max: 1,
      });
      let error: any;
      try {
        await sql`select pg_sleep(8)`;
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      expect(error.code).toBe(`ERR_POSTGRES_CONNECTION_TIMEOUT`);
      expect(error.message).toContain("Connection timeout after 4s");
      expect(onconnect).not.toHaveBeenCalled();
      expect(onclose).toHaveBeenCalledTimes(1);
    });

    test("Idle timeout works at start", async () => {
      const onclose = mock();
      const onconnect = mock();
      await using sql = postgres({
        ...options,
        idle_timeout: 1,
        onconnect,
        onclose,
      });
      let error: any;
      try {
        await sql`select pg_sleep(2)`;
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      expect(error.code).toBe(`ERR_POSTGRES_IDLE_TIMEOUT`);
      expect(onconnect).toHaveBeenCalled();
      expect(onclose).toHaveBeenCalledTimes(1);
    });

    test("Idle timeout is reset when a query is run", async () => {
      const onClosePromise = Promise.withResolvers();
      const onclose = mock(err => {
        onClosePromise.resolve(err);
      });
      const onconnect = mock();
      await using sql = postgres({
        ...options,
        idle_timeout: 1,
        onconnect,
        onclose,
      });
      expect(await sql`select 123 as x`).toEqual([{ x: 123 }]);
      expect(onconnect).toHaveBeenCalledTimes(1);
      expect(onclose).not.toHaveBeenCalled();
      const err = await onClosePromise.promise;
      expect(err).toBeInstanceOf(SQL.SQLError);
      expect(err).toBeInstanceOf(SQL.PostgresError);
      expect(err.code).toBe(`ERR_POSTGRES_IDLE_TIMEOUT`);
    });

    test("Max lifetime works", async () => {
      const onClosePromise = Promise.withResolvers();
      const onclose = mock(err => {
        onClosePromise.resolve(err);
      });
      const onconnect = mock();
      const sql = postgres({
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
            await sql`select pg_sleep(1)`;
          }
        }
      } catch (e) {
        error = e;
      }

      expect(onclose).toHaveBeenCalledTimes(1);

      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      expect(error.code).toBe(`ERR_POSTGRES_LIFETIME_TIMEOUT`);
    });

    // Last one wins.
    test("Handles duplicate string column names", async () => {
      const result = await sql`select 1 as x, 2 as x, 3 as x`;
      expect(result).toEqual([{ x: 3 }]);
    });

    test("should not timeout in long results", async () => {
      await using db = postgres({ ...options, max: 1, idleTimeout: 5 });
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

    test("query string memory leak test", async () => {
      await using sql = postgres(options);
      Bun.gc(true);
      const rss = process.memoryUsage.rss();
      for (let potato of Array.from({ length: 8 * 1024 }, a => "okkk" + a)) {
        await sql`
    select 1 as abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcde
    , 2 as ${sql(potato)}
    `;
      }

      Bun.gc(true);
      const after = process.memoryUsage.rss();
      console.log({ after, rss });
      // Previously:
      // {
      //   after: 507150336,
      //   rss: 49152000,
      // }
      // ~440 MB.
      expect((after - rss) / 1024 / 1024).toBeLessThan(200);
    });

    // Last one wins.
    test("Handles duplicate numeric column names", async () => {
      const result = await sql`select 1 as "1", 2 as "1", 3 as "1"`;
      expect(result).toEqual([{ "1": 3 }]);
      // Sanity check: ensure iterating through the properties doesn't crash.
      Bun.inspect(result);
    });

    test("Basic handles mixed column names", async () => {
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
      const sql = postgres("postgres://localhost");
      expect(sql.options.username).toBe(sql.options.database);
    });

    test("Uses default database with slash", async () => {
      const sql = postgres("postgres://localhost/");
      expect(sql.options.username).toBe(sql.options.database);
    });

    test("Result is array", async () => {
      expect(await sql`select 1`).toBeArray();
    });

    test("Result has command", async () => {
      expect((await sql`select 1`).command).toBe("SELECT");
    });

    test("Create table", async () => {
      await sql`create table test(int int)`;
      await sql`drop table test`;
    });

    test("Drop table", async () => {
      await sql`create table test(int int)`;
      await sql`drop table test`;
      // Verify that table is dropped
      const result = await sql`select * from pg_catalog.pg_tables where tablename = 'test'`;
      expect(result).toBeArrayOfSize(0);
    });

    test("null", async () => {
      expect((await sql`select ${null} as x`)[0].x).toBeNull();
    });

    test("Unsigned Integer", async () => {
      expect((await sql`select ${0x7fffffff + 2} as x`)[0].x).toBe("2147483649");
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

    test("Boolean false", async () => expect((await sql`select ${false} as x`)[0].x).toBe(false));

    test("Boolean true", async () => expect((await sql`select ${true} as x`)[0].x).toBe(true));

    test("Date (timestamp)", async () => {
      const now = new Date();
      const then = (await sql`select ${now}::timestamp as x`)[0].x;
      expect(then).toEqual(now);
    });

    test("Date (timestamptz)", async () => {
      const now = new Date();
      const then = (await sql`select ${now}::timestamptz as x`)[0].x;
      expect(then).toEqual(now);
    });

    // t("Json", async () => {
    //   const x = (await sql`select ${sql.json({ a: "hello", b: 42 })} as x`)[0].x;
    //   return ["hello,42", [x.a, x.b].join()];
    // });

    test("implicit json", async () => {
      const x = (await sql`select ${{ a: "hello", b: 42 }}::json as x`)[0].x;
      expect(x).toEqual({ a: "hello", b: 42 });
    });

    test("implicit jsonb", async () => {
      const x = (await sql`select ${{ a: "hello", b: 42 }}::jsonb as x`)[0].x;
      expect(x).toEqual({ a: "hello", b: 42 });
    });

    test("bulk insert nested sql()", async () => {
      await sql`create table users (name text, age int)`;
      const users = [
        { name: "Alice", age: 25 },
        { name: "Bob", age: 30 },
      ];
      try {
        const result = await sql`insert into users ${sql(users)} RETURNING *`;
        expect(result).toEqual([
          { name: "Alice", age: 25 },
          { name: "Bob", age: 30 },
        ]);
      } finally {
        await sql`drop table users`;
      }
    });

    // t("Empty array", async () => [true, Array.isArray((await sql`select ${sql.array([], 1009)} as x`)[0].x)]);

    test("string arg with ::int -> Array<int>", async () =>
      expect((await sql`select ${"{1,2,3}"}::int[] as x`)[0].x).toEqual(new Int32Array([1, 2, 3])));

    // t("Array of Integer", async () => ["3", (await sql`select ${sql.array([1, 2, 3])} as x`)[0].x[2]]);

    // t('Array of String', async() =>
    //   ['c', (await sql`select ${ sql.array(['a', 'b', 'c']) } as x`)[0].x[2]]
    // )

    // test("Array of Date", async () => {
    //   const now = new Date();
    //   const result = await sql`select ${sql.array([now, now, now])} as x`;
    //   expect(result[0].x[2].getTime()).toBe(now.getTime());
    // });

    test("Array of Box", async () => {
      const result = await sql`select ${"{(1,2),(3,4);(4,5),(6,7)}"}::box[] as x`;
      // box type will reorder the values and this is correct
      expect(result[0].x).toEqual(["(3,4),(1,2)", "(6,7),(4,5)"]);
    });

    // t('Nested array n2', async() =>
    //   ['4', (await sql`select ${ sql.array([[1, 2], [3, 4]]) } as x`)[0].x[1][1]]
    // )

    // t('Nested array n3', async() =>
    //   ['6', (await sql`select ${ sql.array([[[1, 2]], [[3, 4]], [[5, 6]]]) } as x`)[0].x[2][0][1]]
    // )

    // t('Escape in arrays', async() =>
    //   ['Hello "you",c:\\windows', (await sql`select ${ sql.array(['Hello "you"', 'c:\\windows']) } as x`)[0].x.join(',')]
    // )

    test("Escapes", async () => {
      expect(Object.keys((await sql`select 1 as ${sql('hej"hej')}`)[0])[0]).toBe('hej"hej');
    });

    // test(
    //   "big query body",
    //   async () => {
    //     await sql`create table test (x int)`;
    //     const count = 1000;
    //     const array = new Array(count);
    //     for (let i = 0; i < count; i++) {
    //       array[i] = i;
    //     }
    //     try {
    //       expect((await sql`insert into test SELECT * from UNNEST(${array})`).count).toBe(count);
    //     } finally {
    //       await sql`drop table test`;
    //     }
    //   },
    //   { timeout: 20 * 1000 },
    // );

    test("null for int", async () => {
      const result = await sql`create table test (x int)`;
      expect(result.command).toBe("CREATE TABLE");
      expect(result.count).toBe(0);
      try {
        const result = await sql`insert into test values(${null})`;
        expect(result.command).toBe("INSERT");
        expect(result.count).toBe(1);
      } finally {
        await sql`drop table test`;
      }
    });

    test("Throws on illegal transactions", async () => {
      const sql = postgres({ ...options, max: 2, fetch_types: false });
      const error = await sql`begin`.catch(e => e);
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      return expect(error.code).toBe("ERR_POSTGRES_UNSAFE_TRANSACTION");
    });

    test("Transaction throws", async () => {
      await sql`create table if not exists test (a int)`;
      try {
        const error = await sql
          .begin(async sql => {
            await sql`insert into test values(1)`;
            await sql`insert into test values('hej')`;
          })
          .catch(e => e);
        expect(error).toBeInstanceOf(SQL.SQLError);
        expect(error).toBeInstanceOf(SQL.PostgresError);
        expect(error.errno).toBe("22P02");
      } finally {
        await sql`drop table test`;
      }
    });

    test("Transaction rolls back", async () => {
      await sql`create table if not exists test (a int)`;

      try {
        await sql
          .begin(async sql => {
            await sql`insert into test values(1)`;
            await sql`insert into test values('hej')`;
          })
          .catch(() => {
            /* ignore */
          });

        expect((await sql`select a from test`).count).toBe(0);
      } finally {
        await sql`drop table test`;
      }
    });

    test("Transaction throws on uncaught savepoint", async () => {
      await sql`create table test (a int)`;
      try {
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
      } finally {
        await sql`drop table test`;
      }
    });

    test("Transaction throws on uncaught named savepoint", async () => {
      await sql`create table test (a int)`;
      try {
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
      } finally {
        await sql`drop table test`;
      }
    });

    test("Transaction succeeds on caught savepoint", async () => {
      try {
        await sql`create table test (a int)`;
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
        expect((await sql`select count(1) from test`)[0].count).toBe("2");
      } finally {
        await sql`drop table test`;
      }
    });

    test("Savepoint returns Result", async () => {
      let result;
      await sql.begin(async t => {
        result = await t.savepoint(s => s`select 1 as x`);
      });
      expect(result[0]?.x).toBe(1);
    });

    test("should be able to execute different queries in the same connection #16774", async () => {
      const sql = postgres({ ...options, max: 1, fetch_types: false });
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
              promises.push(sql`select "id", "name" from ${sql(random_table_name)} where "id" = ${i}`.execute());
              break;
            case 1:
              promises.push(sql`select "id" from ${sql(random_table_name)} where "id" = ${i}`.execute());
              break;
            case 2:
              promises.push(sql`select 1, "id", "name" from ${sql(random_table_name)} where "id" = ${i}`.execute());
              break;
          }
        }
        await Promise.all(promises);
      }
    });

    // test("Prepared transaction", async () => {
    //   await sql`create table test (a int)`;

    //   await sql.begin(async sql => {
    //     await sql`insert into test values(1)`;
    //     await sql.prepare("tx1");
    //   });

    //   await sql`commit prepared 'tx1'`;
    //   try {
    //     expect((await sql`select count(1) from test`)[0].count).toBe("1");
    //   } finally {
    //     await sql`drop table test`;
    //   }
    // });

    test("Prepared transaction", async () => {
      await sql`create table test (a int)`;

      try {
        await sql.beginDistributed("tx1", async sql => {
          await sql`insert into test values(1)`;
        });
        await sql.commitDistributed("tx1");
        expect((await sql`select count(1) from test`)[0].count).toBe("1");
      } finally {
        await sql`drop table test`;
      }
    });

    test("Transaction requests are executed implicitly", async () => {
      await using sql = postgres(options);
      expect(
        (
          await sql.begin(sql => [
            sql`select set_config('bun_sql.test', 'testing', true)`,
            sql`select current_setting('bun_sql.test') as x`,
          ])
        )[1][0].x,
      ).toBe("testing");
    });

    test("Idle timeout retry works", async () => {
      await using sql = postgres({ ...options, idleTimeout: 1 });
      await sql`select 1`;
      await Bun.sleep(1100); // 1.1 seconds so it should retry
      await sql`select 1`;
      expect().pass();
    });

    test("Uncaught transaction request errors bubbles to transaction", async () => {
      const sql = postgres(options);
      process.nextTick(() => sql.close({ timeout: 1 }));
      const error = await sql
        .begin(sql => [sql`select wat`, sql`select current_setting('bun_sql.test') as x, ${1} as a`])
        .catch(e => e);
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      expect(error.errno).toBe("42703");
    });

    test("Fragments in transactions", async () => {
      const sql = postgres({ ...options, debug: true, idle_timeout: 1, fetch_types: false });
      expect((await sql.begin(sql => sql`select true as x where ${sql`1=1`}`))[0].x).toBe(true);
    });

    test("Transaction rejects with rethrown error", async () => {
      await using sql = postgres({ ...options });
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
      await sql`create table test (a int)`;
      expect(
        (await Promise.all([sql.begin(sql => sql`select 1 as count`), sql.begin(sql => sql`select 1 as count`)]))
          .map(x => x[0].count)
          .join(""),
      ).toBe("11");
      await sql`drop table test`;
    });

    test("Many transactions at beginning of connection", async () => {
      await using sql = postgres(options);
      const xs = await Promise.all(Array.from({ length: 100 }, () => sql.begin(sql => sql`select 1`)));
      return expect(xs.length).toBe(100);
    });

    test("Transactions array", async () => {
      await using sql = postgres(options);
      await sql`create table test (a int)`;
      try {
        expect(
          (await sql.begin(sql => [sql`select 1 as count`, sql`select 1 as count`])).map(x => x[0].count).join(""),
        ).toBe("11");
      } finally {
        await sql`drop table test`;
      }
    });

    test("Transaction waits", async () => {
      await using sql = postgres({ ...options });
      await sql`create table test (a int)`;
      try {
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
          (await Promise.all([sql.begin(sql => sql`select 1 as count`), sql.begin(sql => sql`select 1 as count`)]))
            .map(x => x[0].count)
            .join(""),
        ).toBe("11");
      } finally {
        await sql`drop table test`;
      }
    });

    test("Helpers in Transaction", async () => {
      const result = await sql.begin(async sql => await sql`select ${sql.unsafe("1 as x")}`);
      expect(result[0].x).toBe(1);
    });

    test("Undefined values throws", async () => {
      // in bun case undefined is null should we fix this? null is a better DX

      // let error;

      // await sql`
      //   select ${undefined} as x
      // `.catch(x => (error = x.code));

      // expect(error).toBe("UNDEFINED_VALUE");

      const result = await sql`select ${undefined} as x`;
      expect(result[0].x).toBeNull();
    });

    // t('Transform undefined', async() => {
    //   const sql = postgres({ ...options, transform: { undefined: null } })
    //   return [null, (await sql`select ${ undefined } as x`)[0].x]
    // })

    // t('Transform undefined in array', async() => {
    //   const sql = postgres({ ...options, transform: { undefined: null } })
    //   return [null, (await sql`select * from (values ${ sql([undefined, undefined]) }) as x(x, y)`)[0].y]
    // })

    test("Null sets to null", async () => expect((await sql`select ${null} as x`)[0].x).toBeNull());

    // Add code property.
    test("Throw syntax error", async () => {
      await using sql = postgres({ ...options, max: 1 });
      const err = await sql`wat 1`.catch(x => x);
      expect(err).toBeInstanceOf(SQL.SQLError);
      expect(err).toBeInstanceOf(SQL.PostgresError);
      expect(err.errno).toBe("42601");
      expect(err.code).toBe("ERR_POSTGRES_SYNTAX_ERROR");
    });

    test("Connect using uri", async () => [
      true,
      await new Promise((resolve, reject) => {
        const sql = postgres(
          "postgres://" +
            login_md5.username +
            ":" +
            (login_md5.password || "") +
            "@localhost:" +
            container.port.toString() +
            "/" +
            options.db,
        );
        sql`select 1`.then(() => resolve(true), reject);
      }),
    ]);

    test("should work with fragments", async () => {
      await using sql = postgres({ ...options, max: 1 });
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
      await using sql = postgres({ ...options, max: 1 });
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

    // t('Options from uri with special characters in user and pass', async() => {
    //   const opt = postgres({ user: 'öla', pass: 'pass^word' }).options
    //   return [[opt.user, opt.pass].toString(), 'öla,pass^word']
    // })

    // t('Fail with proper error on no host', async() =>
    //   ['ECONNREFUSED', (await new Promise((resolve, reject) => {
    //     const sql = postgres('postgres://localhost:33333/' + options.db, {
    //       idle_timeout
    //     })
    //     sql`select 1`.then(reject, resolve)
    //   })).code]
    // )

    // t('Connect using SSL', async() =>
    //   [true, (await new Promise((resolve, reject) => {
    //     postgres({
    //       ssl: { rejectUnauthorized: false },
    //       idle_timeout
    //     })`select 1`.then(() => resolve(true), reject)
    //   }))]
    // )

    // t('Connect using SSL require', async() =>
    //   [true, (await new Promise((resolve, reject) => {
    //     postgres({
    //       ssl: 'require',
    //       idle_timeout
    //     })`select 1`.then(() => resolve(true), reject)
    //   }))]
    // )

    // t('Connect using SSL prefer', async() => {
    //   await exec('psql', ['-c', 'alter system set ssl=off'])
    //   await exec('psql', ['-c', 'select pg_reload_conf()'])

    //   const sql = postgres({
    //     ssl: 'prefer',
    //     idle_timeout
    //   })

    //   return [
    //     1, (await sql`select 1 as x`)[0].x,
    //     await exec('psql', ['-c', 'alter system set ssl=on']),
    //     await exec('psql', ['-c', 'select pg_reload_conf()'])
    //   ]
    // })

    // t('Reconnect using SSL', { timeout: 2 }, async() => {
    //   const sql = postgres({
    //     ssl: 'require',
    //     idle_timeout: 0.1
    //   })

    //   await sql`select 1`
    //   await delay(200)

    //   return [1, (await sql`select 1 as x`)[0].x]
    // })

    test("Login without password", async () => {
      await using sql = postgres({ ...options, ...login });
      expect((await sql`select true as x`)[0].x).toBe(true);
    });

    test("unix domain socket can send query", async () => {
      await using sql = postgres({ ...options, ...login_domain_socket });
      expect((await sql`select true as x`)[0].x).toBe(true);
    });

    test("Login using MD5", async () => {
      await using sql = postgres({ ...options, ...login_md5 });
      expect(await sql`select true as x`).toEqual([{ x: true }]);
    });

    test("Login with bad credentials propagates error from server", async () => {
      const sql = postgres({ ...options, ...login_md5, username: "bad_user", password: "bad_password" });
      let err;
      try {
        await sql`select true as x`;
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SQL.SQLError);
      expect(err).toBeInstanceOf(SQL.PostgresError);
      expect(err.code).toBe("ERR_POSTGRES_SERVER_ERROR");
    });

    test("Login using scram-sha-256", async () => {
      await using sql = postgres({ ...options, ...login_scram });

      // Run it three times to catch any GC
      for (let i = 0; i < 3; i++) {
        expect((await sql`select 1 as x`)[0].x).toBe(1);
      }
    });

    // Promise.all on multiple values in-flight doesn't work currently due to pendingValueGetcached pointing to the wrong value.
    test("Parallel connections using scram-sha-256", async () => {
      await using sql = postgres({ ...options, ...login_scram });
      return [
        true,
        (
          await Promise.all([
            sql`select true as x, pg_sleep(0.01)`,
            sql`select true as x, pg_sleep(0.01)`,
            sql`select true as x, pg_sleep(0.01)`,
          ])
        )[0][0].x,
      ];
    });

    test("Support dynamic password function", async () => {
      await using sql = postgres({ ...options, ...login_scram, password: () => "bun_sql_test_scram", max: 1 });
      return expect((await sql`select true as x`)[0].x).toBe(true);
    });

    test("Support dynamic async resolved password function", async () => {
      await using sql = postgres({
        ...options,
        ...login_scram,
        password: () => Promise.resolve("bun_sql_test_scram"),
        max: 1,
      });
      return expect((await sql`select true as x`)[0].x).toBe(true);
    });

    test("Support dynamic async password function", async () => {
      await using sql = postgres({
        ...options,
        ...login_scram,
        max: 1,
        password: async () => {
          await Bun.sleep(10);
          return "bun_sql_test_scram";
        },
      });
      return expect((await sql`select true as x`)[0].x).toBe(true);
    });
    test("Support dynamic async rejected password function", async () => {
      await using sql = postgres({
        ...options,
        ...login_scram,
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
      await using sql = postgres({
        ...options,
        ...login_scram,
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

    // t('Point type', async() => {
    //   const sql = postgres({
    //     ...options,
    //     types: {
    //       point: {
    //         to: 600,
    //         from: [600],
    //         serialize: ([x, y]) => '(' + x + ',' + y + ')',
    //         parse: (x) => x.slice(1, -1).split(',').map(x => +x)
    //       }
    //     }
    //   })

    //   await sql`create table test (x point)`
    //   await sql`insert into test (x) values (${ sql.types.point([10, 20]) })`
    //   return [20, (await sql`select x from test`)[0].x[1], await sql`drop table test`]
    // })

    // t('Point type array', async() => {
    //   const sql = postgres({
    //     ...options,
    //     types: {
    //       point: {
    //         to: 600,
    //         from: [600],
    //         serialize: ([x, y]) => '(' + x + ',' + y + ')',
    //         parse: (x) => x.slice(1, -1).split(',').map(x => +x)
    //       }
    //     }
    //   })

    //   await sql`create table test (x point[])`
    //   await sql`insert into test (x) values (${ sql.array([sql.types.point([10, 20]), sql.types.point([20, 30])]) })`
    //   return [30, (await sql`select x from test`)[0].x[1][1], await sql`drop table test`]
    // })

    test("sql file", async () => {
      await using sql = postgres(options);
      expect((await sql.file(rel("select.sql")))[0].x).toBe(1);
    });

    test("sql file throws", async () => {
      await using sql = postgres(options);
      expect(await sql.file(rel("selectomondo.sql")).catch(x => x.code)).toBe("ENOENT");
    });
    test("Parameters in file", async () => {
      const result = await sql.file(rel("select-param.sql"), ["hello"]);
      return expect(result[0].x).toBe("hello");
    });

    // this test passes but it's not clear where cached is implemented in postgres.js and this also doesn't seem to be a valid test
    // test("sql file cached", async () => {
    //   await sql.file(rel("select.sql"));
    //   await delay(20);

    //   return [1, (await sql.file(rel("select.sql")))[0].x];
    // });
    // we dont have .forEach yet
    // test("sql file has forEach", async () => {
    //   let result;
    //   await sql.file(rel("select.sql"), { cache: false }).forEach(({ x }) => (result = x));

    //   return expect(result).toBe(1);
    // });

    test("Connection ended promise", async () => {
      const sql = postgres(options);

      await sql.end();

      expect(await sql.end()).toBeUndefined();
    });

    test("Connection ended timeout", async () => {
      const sql = postgres(options);

      await sql.end({ timeout: 10 });

      expect(await sql.end()).toBeUndefined();
    });

    test("Connection ended error", async () => {
      const sql = postgres(options);
      await sql.end();
      const error = await sql``.catch(x => x);
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      return expect(error.code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
    });

    test("Connection end does not cancel query", async () => {
      const sql = postgres(options);

      const promise = sql`select pg_sleep(0.2) as x`.execute();
      await sql.end();
      return expect(await promise).toEqual([{ x: "" }]);
    });

    test("Connection destroyed", async () => {
      const sql = postgres(options);
      process.nextTick(() => sql.end({ timeout: 0 }));
      const error = await sql``.catch(x => x);
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      expect(error.code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
    });

    test("Connection destroyed with query before", async () => {
      const sql = postgres(options);
      const error = sql`select pg_sleep(0.2)`.catch(err => err.code);

      sql.end({ timeout: 0 });
      return expect(await error).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
    });

    // t('transform column', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: { column: x => x.split('').reverse().join('') }
    //   })

    //   await sql`create table test (hello_world int)`
    //   await sql`insert into test values (1)`
    //   return ['dlrow_olleh', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
    // })

    // t('column toPascal', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: { column: postgres.toPascal }
    //   })

    //   await sql`create table test (hello_world int)`
    //   await sql`insert into test values (1)`
    //   return ['HelloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
    // })

    // t('column toCamel', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: { column: postgres.toCamel }
    //   })

    //   await sql`create table test (hello_world int)`
    //   await sql`insert into test values (1)`
    //   return ['helloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
    // })

    // t('column toKebab', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: { column: postgres.toKebab }
    //   })

    //   await sql`create table test (hello_world int)`
    //   await sql`insert into test values (1)`
    //   return ['hello-world', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
    // })

    // t('Transform nested json in arrays', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: postgres.camel
    //   })
    //   return ['aBcD', (await sql`select '[{"a_b":1},{"c_d":2}]'::jsonb as x`)[0].x.map(Object.keys).join('')]
    // })

    // t('Transform deeply nested json object in arrays', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: postgres.camel
    //   })
    //   return [
    //     'childObj_deeplyNestedObj_grandchildObj',
    //     (await sql`
    //       select '[{"nested_obj": {"child_obj": 2, "deeply_nested_obj": {"grandchild_obj": 3}}}]'::jsonb as x
    //     `)[0].x.map(x => {
    //       let result
    //       for (const key in x)
    //         result = [...Object.keys(x[key]), ...Object.keys(x[key].deeplyNestedObj)]
    //       return result
    //     })[0]
    //     .join('_')
    //   ]
    // })

    // t('Transform deeply nested json array in arrays', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: postgres.camel
    //   })
    //   return [
    //     'childArray_deeplyNestedArray_grandchildArray',
    //     (await sql`
    //       select '[{"nested_array": [{"child_array": 2, "deeply_nested_array": [{"grandchild_array":3}]}]}]'::jsonb AS x
    //     `)[0].x.map((x) => {
    //       let result
    //       for (const key in x)
    //         result = [...Object.keys(x[key][0]), ...Object.keys(x[key][0].deeplyNestedArray[0])]
    //       return result
    //     })[0]
    //     .join('_')
    //   ]
    // })

    // t('Bypass transform for json primitive', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: postgres.camel
    //   })

    //   const x = (
    //     await sql`select 'null'::json as a, 'false'::json as b, '"a"'::json as c, '1'::json as d`
    //   )[0]

    //   return [
    //     JSON.stringify({ a: null, b: false, c: 'a', d: 1 }),
    //     JSON.stringify(x)
    //   ]
    // })

    // t('Bypass transform for jsonb primitive', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: postgres.camel
    //   })

    //   const x = (
    //     await sql`select 'null'::jsonb as a, 'false'::jsonb as b, '"a"'::jsonb as c, '1'::jsonb as d`
    //   )[0]

    //   return [
    //     JSON.stringify({ a: null, b: false, c: 'a', d: 1 }),
    //     JSON.stringify(x)
    //   ]
    // })

    test("unsafe", async () => {
      await sql`create table test (x int)`;
      try {
        expect(await sql.unsafe("insert into test values ($1) returning *", [1])).toEqual([{ x: 1 }]);
      } finally {
        await sql`drop table test`;
      }
    });

    test("unsafe simple", async () => {
      expect(await sql.unsafe("select 1 as x")).toEqual([{ x: 1 }]);
    });

    test("simple query with multiple statements", async () => {
      const result = await sql`select 1 as x;select 2 as x`.simple();
      expect(result).toBeDefined();
      expect(result.length).toEqual(2);
      expect(result[0][0].x).toEqual(1);
      expect(result[1][0].x).toEqual(2);
    });

    // t('unsafe simple includes columns', async() => {
    //   return ['x', (await sql.unsafe('select 1 as x').values()).columns[0].name]
    // })

    // t('unsafe describe', async() => {
    //   const q = 'insert into test values (1)'
    //   await sql`create table test(a int unique)`
    //   await sql.unsafe(q).describe()
    //   const x = await sql.unsafe(q).describe()
    //   return [
    //     q,
    //     x.string,
    //     await sql`drop table test`
    //   ]
    // })

    test("simple query using unsafe with multiple statements", async () => {
      const result = await sql.unsafe("select 1 as x;select 2 as x");
      expect(result).toBeDefined();
      expect(result.length).toEqual(2);
      expect(result[0][0].x).toEqual(1);
      expect(result[1][0].x).toEqual(2);
    });

    // t('listen and notify', async() => {
    //   const sql = postgres(options)
    //   const channel = 'hello'
    //   const result = await new Promise(async r => {
    //     await sql.listen(channel, r)
    //     sql.notify(channel, 'works')
    //   })

    //   return [
    //     'works',
    //     result,
    //     sql.end()
    //   ]
    // })

    // t('double listen', async() => {
    //   const sql = postgres(options)
    //       , channel = 'hello'

    //   let count = 0

    //   await new Promise((resolve, reject) =>
    //     sql.listen(channel, resolve)
    //     .then(() => sql.notify(channel, 'world'))
    //     .catch(reject)
    //   ).then(() => count++)

    //   await new Promise((resolve, reject) =>
    //     sql.listen(channel, resolve)
    //     .then(() => sql.notify(channel, 'world'))
    //     .catch(reject)
    //   ).then(() => count++)

    //   // for coverage
    //   sql.listen('weee', () => { /* noop */ }).then(sql.end)

    //   return [2, count]
    // })

    // t('multiple listeners work after a reconnect', async() => {
    //   const sql = postgres(options)
    //       , xs = []

    //   const s1 = await sql.listen('test', x => xs.push('1', x))
    //   await sql.listen('test', x => xs.push('2', x))
    //   await sql.notify('test', 'a')
    //   await delay(50)
    //   await sql`select pg_terminate_backend(${ s1.state.pid })`
    //   await delay(200)
    //   await sql.notify('test', 'b')
    //   await delay(50)
    //   sql.end()

    //   return ['1a2a1b2b', xs.join('')]
    // })

    // t('listen and notify with weird name', async() => {
    //   const sql = postgres(options)
    //   const channel = 'wat-;.ø.§'
    //   const result = await new Promise(async r => {
    //     const { unlisten } = await sql.listen(channel, r)
    //     sql.notify(channel, 'works')
    //     await delay(50)
    //     await unlisten()
    //   })

    //   return [
    //     'works',
    //     result,
    //     sql.end()
    //   ]
    // })

    // t('listen and notify with upper case', async() => {
    //   const sql = postgres(options)
    //   const channel = 'withUpperChar'
    //   const result = await new Promise(async r => {
    //     await sql.listen(channel, r)
    //     sql.notify(channel, 'works')
    //   })

    //   return [
    //     'works',
    //     result,
    //     sql.end()
    //   ]
    // })

    // t('listen reconnects', { timeout: 2 }, async() => {
    //   const sql = postgres(options)
    //       , resolvers = {}
    //       , a = new Promise(r => resolvers.a = r)
    //       , b = new Promise(r => resolvers.b = r)

    //   let connects = 0

    //   const { state: { pid } } = await sql.listen(
    //     'test',
    //     x => x in resolvers && resolvers[x](),
    //     () => connects++
    //   )
    //   await sql.notify('test', 'a')
    //   await a
    //   await sql`select pg_terminate_backend(${ pid })`
    //   await delay(100)
    //   await sql.notify('test', 'b')
    //   await b
    //   sql.end()
    //   return [connects, 2]
    // })

    // t('listen result reports correct connection state after reconnection', async() => {
    //   const sql = postgres(options)
    //       , xs = []

    //   const result = await sql.listen('test', x => xs.push(x))
    //   const initialPid = result.state.pid
    //   await sql.notify('test', 'a')
    //   await sql`select pg_terminate_backend(${ initialPid })`
    //   await delay(50)
    //   sql.end()

    //   return [result.state.pid !== initialPid, true]
    // })

    // t('unlisten removes subscription', async() => {
    //   const sql = postgres(options)
    //       , xs = []

    //   const { unlisten } = await sql.listen('test', x => xs.push(x))
    //   await sql.notify('test', 'a')
    //   await delay(50)
    //   await unlisten()
    //   await sql.notify('test', 'b')
    //   await delay(50)
    //   sql.end()

    //   return ['a', xs.join('')]
    // })

    // t('listen after unlisten', async() => {
    //   const sql = postgres(options)
    //       , xs = []

    //   const { unlisten } = await sql.listen('test', x => xs.push(x))
    //   await sql.notify('test', 'a')
    //   await delay(50)
    //   await unlisten()
    //   await sql.notify('test', 'b')
    //   await delay(50)
    //   await sql.listen('test', x => xs.push(x))
    //   await sql.notify('test', 'c')
    //   await delay(50)
    //   sql.end()

    //   return ['ac', xs.join('')]
    // })

    // t('multiple listeners and unlisten one', async() => {
    //   const sql = postgres(options)
    //       , xs = []

    //   await sql.listen('test', x => xs.push('1', x))
    //   const s2 = await sql.listen('test', x => xs.push('2', x))
    //   await sql.notify('test', 'a')
    //   await delay(50)
    //   await s2.unlisten()
    //   await sql.notify('test', 'b')
    //   await delay(50)
    //   sql.end()

    //   return ['1a2a1b', xs.join('')]
    // })

    // t('responds with server parameters (application_name)', async() =>
    //   ['postgres.js', await new Promise((resolve, reject) => postgres({
    //     ...options,
    //     onparameter: (k, v) => k === 'application_name' && resolve(v)
    //   })`select 1`.catch(reject))]
    // )

    // t('has server parameters', async() => {
    //   return ['postgres.js', (await sql`select 1`.then(() => sql.parameters.application_name))]
    // })

    // t('Throws if more than 65534 parameters', async() => {
    //   await sql`create table test (x int)`
    //   return ['MAX_PARAMETERS_EXCEEDED', (await sql`insert into test ${
    //     sql([...Array(65535).keys()].map(x => ({ x })))
    //   }`.catch(e => e.code)), await sql`drop table test`]
    // })

    test("timestamp with time zone is consistent", async () => {
      await sql`create table test (x timestamp with time zone)`;
      try {
        const date = new Date();
        const [{ x }] = await sql`insert into test values (${date}) returning *`;
        expect(x instanceof Date).toBe(true);
        expect(x.toISOString()).toBe(date.toISOString());
      } finally {
        await sql`drop table test`;
      }
    });

    test("timestamp is consistent", async () => {
      await sql`create table test2 (x timestamp)`;
      try {
        const date = new Date();
        const [{ x }] = await sql`insert into test2 values (${date}) returning *`;
        expect(x instanceof Date).toBe(true);
        expect(x.toISOString()).toBe(date.toISOString());
      } finally {
        await sql`drop table test2`;
      }
    });

    test(
      "let postgres do implicit cast of unknown types",
      async () => {
        await sql`create table test3 (x timestamp with time zone)`;
        try {
          const date = new Date("2024-01-01T00:00:00Z");
          const [{ x }] = await sql`insert into test3 values (${date.toISOString()}) returning *`;
          expect(x instanceof Date).toBe(true);
          expect(x.toISOString()).toBe(date.toISOString());
        } finally {
          await sql`drop table test3`;
        }
      },
      { timeout: 1000000 },
    );

    test("only allows one statement", async () => {
      const error = await sql`select 1; select 2`.catch(e => e);
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      expect(error.errno).toBe("42601");
    });

    test("await sql() throws not tagged error", async () => {
      try {
        await sql("select 1");
        expect.unreachable();
      } catch (e: any) {
        expect(e).toBeInstanceOf(SQL.SQLError);
        expect(e).toBeInstanceOf(SQL.PostgresError);
        expect(e.code).toBe("ERR_POSTGRES_NOT_TAGGED_CALL");
      }
    });

    test("sql().then throws not tagged error", async () => {
      try {
        await sql("select 1").then(() => {
          /* noop */
        });
        expect.unreachable();
      } catch (e: any) {
        expect(e).toBeInstanceOf(SQL.SQLError);
        expect(e).toBeInstanceOf(SQL.PostgresError);
        expect(e.code).toBe("ERR_POSTGRES_NOT_TAGGED_CALL");
      }
    });

    test("sql().catch throws not tagged error", async () => {
      try {
        sql("select 1").catch(() => {
          /* noop */
        });
        expect.unreachable();
      } catch (e: any) {
        expect(e).toBeInstanceOf(SQL.SQLError);
        expect(e).toBeInstanceOf(SQL.PostgresError);
        expect(e.code).toBe("ERR_POSTGRES_NOT_TAGGED_CALL");
      }
    });

    test("sql().finally throws not tagged error", async () => {
      try {
        sql("select 1").finally(() => {
          /* noop */
        });
        expect.unreachable();
      } catch (e: any) {
        expect(e).toBeInstanceOf(SQL.SQLError);
        expect(e).toBeInstanceOf(SQL.PostgresError);
        expect(e.code).toBe("ERR_POSTGRES_NOT_TAGGED_CALL");
      }
    });

    test("little bobby tables", async () => {
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
        const sql = postgres({ host: "localhost", port: 1 });

        await sql.begin(async sql => {
          await sql`insert into test (label, value) values (${1}, ${2})`;
        });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      expect(error.code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
    });

    test("dynamic table name", async () => {
      await sql`create table test(a int)`;
      try {
        return expect((await sql`select * from ${sql("test")}`).length).toBe(0);
      } finally {
        await sql`drop table test`;
      }
    });

    test("dynamic schema name", async () => {
      await sql`create table test(a int)`;
      try {
        return expect((await sql`select * from ${sql("public")}.test`).length).toBe(0);
      } finally {
        await sql`drop table test`;
      }
    });

    test("dynamic schema and table name", async () => {
      await sql`create table test(a int)`;
      try {
        return expect((await sql`select * from ${sql("public.test")}`).length).toBe(0);
      } finally {
        await sql`drop table test`;
      }
    });

    test("dynamic column name", async () => {
      const result = await sql`select 1 as ${sql("!not_valid")}`;
      expect(Object.keys(result[0])[0]).toBe("!not_valid");
    });

    // t('dynamic select as', async() => {
    //   return ['2', (await sql`select ${ sql({ a: 1, b: 2 }) }`)[0].b]
    // })

    // t('dynamic select as pluck', async() => {
    //   return [undefined, (await sql`select ${ sql({ a: 1, b: 2 }, 'a') }`)[0].b]
    // })

    test("dynamic insert", async () => {
      await sql`create table test (a int, b text)`;
      try {
        const x = { a: 42, b: "the answer" };
        expect((await sql`insert into test ${sql(x)} returning *`)[0].b).toBe("the answer");
      } finally {
        await sql`drop table test`;
      }
    });

    test("dynamic insert pluck", async () => {
      try {
        await sql`create table test2 (a int, b text)`;
        const x = { a: 42, b: "the answer" };
        const [{ b, a }] = await sql`insert into test2 ${sql(x, "a")} returning *`;
        expect(b).toBeNull();
        expect(a).toBe(42);
      } finally {
        await sql`drop table test2`;
      }
    });

    // t('dynamic in with empty array', async() => {
    //   await sql`create table test (a int)`
    //   await sql`insert into test values (1)`
    //   return [
    //     (await sql`select * from test where null in ${ sql([]) }`).count,
    //     0,
    //     await sql`drop table test`
    //   ]
    // })

    // t('dynamic in after insert', async() => {
    //   await sql`create table test (a int, b text)`
    //   const [{ x }] = await sql`
    //     with x as (
    //       insert into test values (1, 'hej')
    //       returning *
    //     )
    //     select 1 in ${ sql([1, 2, 3]) } as x from x
    //   `
    //   return [
    //     true, x,
    //     await sql`drop table test`
    //   ]
    // })

    // t('array insert', async() => {
    //   await sql`create table test (a int, b int)`
    //   return [2, (await sql`insert into test (a, b) values ${ sql([1, 2]) } returning *`)[0].b, await sql`drop table test`]
    // })

    // t('where parameters in()', async() => {
    //   await sql`create table test (x text)`
    //   await sql`insert into test values ('a')`
    //   return [
    //     (await sql`select * from test where x in ${ sql(['a', 'b', 'c']) }`)[0].x,
    //     'a',
    //     await sql`drop table test`
    //   ]
    // })

    // t('where parameters in() values before', async() => {
    //   return [2, (await sql`
    //     with rows as (
    //       select * from (values (1), (2), (3), (4)) as x(a)
    //     )
    //     select * from rows where a in ${ sql([3, 4]) }
    //   `).count]
    // })

    // t('dynamic multi row insert', async() => {
    //   await sql`create table test (a int, b text)`
    //   const x = { a: 42, b: 'the answer' }

    //   return [
    //     'the answer',
    //     (await sql`insert into test ${ sql([x, x]) } returning *`)[1].b, await sql`drop table test`
    //   ]
    // })

    // t('dynamic update', async() => {
    //   await sql`create table test (a int, b text)`
    //   await sql`insert into test (a, b) values (17, 'wrong')`

    //   return [
    //     'the answer',
    //     (await sql`update test set ${ sql({ a: 42, b: 'the answer' }) } returning *`)[0].b, await sql`drop table test`
    //   ]
    // })

    // t('dynamic update pluck', async() => {
    //   await sql`create table test (a int, b text)`
    //   await sql`insert into test (a, b) values (17, 'wrong')`

    //   return [
    //     'wrong',
    //     (await sql`update test set ${ sql({ a: 42, b: 'the answer' }, 'a') } returning *`)[0].b, await sql`drop table test`
    //   ]
    // })

    // t('dynamic select array', async() => {
    //   await sql`create table test (a int, b text)`
    //   await sql`insert into test (a, b) values (42, 'yay')`
    //   return ['yay', (await sql`select ${ sql(['a', 'b']) } from test`)[0].b, await sql`drop table test`]
    // })

    // t('dynamic returning array', async() => {
    //   await sql`create table test (a int, b text)`
    //   return [
    //     'yay',
    //     (await sql`insert into test (a, b) values (42, 'yay') returning ${ sql(['a', 'b']) }`)[0].b,
    //     await sql`drop table test`
    //   ]
    // })

    // t('dynamic select args', async() => {
    //   await sql`create table test (a int, b text)`
    //   await sql`insert into test (a, b) values (42, 'yay')`
    //   return ['yay', (await sql`select ${ sql('a', 'b') } from test`)[0].b, await sql`drop table test`]
    // })

    // t('dynamic values single row', async() => {
    //   const [{ b }] = await sql`
    //     select * from (values ${ sql(['a', 'b', 'c']) }) as x(a, b, c)
    //   `

    //   return ['b', b]
    // })

    // t('dynamic values multi row', async() => {
    //   const [, { b }] = await sql`
    //     select * from (values ${ sql([['a', 'b', 'c'], ['a', 'b', 'c']]) }) as x(a, b, c)
    //   `

    //   return ['b', b]
    // })

    // t('connection parameters', async() => {
    //   const sql = postgres({
    //     ...options,
    //     connection: {
    //       'some.var': 'yay'
    //     }
    //   })

    //   return ['yay', (await sql`select current_setting('some.var') as x`)[0].x]
    // })

    // t('Multiple queries', async() => {
    //   const sql = postgres(options)

    //   return [4, (await Promise.all([
    //     sql`select 1`,
    //     sql`select 2`,
    //     sql`select 3`,
    //     sql`select 4`
    //   ])).length]
    // })

    // t('Multiple statements', async() =>
    //   [2, await sql.unsafe(`
    //     select 1 as x;
    //     select 2 as a;
    //   `).then(([, [x]]) => x.a)]
    // )

    // t('throws correct error when authentication fails', async() => {
    //   const sql = postgres({
    //     ...options,
    //     ...login_md5,
    //     pass: 'wrong'
    //   })
    //   return ['28P01', await sql`select 1`.catch(e => e.code)]
    // })

    // t('notice', async() => {
    //   let notice
    //   const log = console.log // eslint-disable-line
    //   console.log = function(x) { // eslint-disable-line
    //     notice = x
    //   }

    //   const sql = postgres(options)

    //   await sql`create table if not exists users()`
    //   await sql`create table if not exists users()`

    //   console.log = log // eslint-disable-line

    //   return ['NOTICE', notice.severity]
    // })

    // t('notice hook', async() => {
    //   let notice
    //   const sql = postgres({
    //     ...options,
    //     onnotice: x => notice = x
    //   })

    //   await sql`create table if not exists users()`
    //   await sql`create table if not exists users()`

    //   return ['NOTICE', notice.severity]
    // })

    // t('bytea serializes and parses', async() => {
    //   const buf = Buffer.from('wat')

    //   await sql`create table test (x bytea)`
    //   await sql`insert into test values (${ buf })`

    //   return [
    //     buf.toString(),
    //     (await sql`select x from test`)[0].x.toString(),
    //     await sql`drop table test`
    //   ]
    // })

    // t('forEach', async() => {
    //   let result
    //   await sql`select 1 as x`.forEach(({ x }) => result = x)
    //   return [1, result]
    // })

    // t('forEach returns empty array', async() => {
    //   return [0, (await sql`select 1 as x`.forEach(() => { /* noop */ })).length]
    // })

    // t('Cursor', async() => {
    //   const order = []
    //   await sql`select 1 as x union select 2 as x`.cursor(async([x]) => {
    //     order.push(x.x + 'a')
    //     await delay(100)
    //     order.push(x.x + 'b')
    //   })
    //   return ['1a1b2a2b', order.join('')]
    // })

    // t('Unsafe cursor', async() => {
    //   const order = []
    //   await sql.unsafe('select 1 as x union select 2 as x').cursor(async([x]) => {
    //     order.push(x.x + 'a')
    //     await delay(100)
    //     order.push(x.x + 'b')
    //   })
    //   return ['1a1b2a2b', order.join('')]
    // })

    // t('Cursor custom n', async() => {
    //   const order = []
    //   await sql`select * from generate_series(1,20)`.cursor(10, async(x) => {
    //     order.push(x.length)
    //   })
    //   return ['10,10', order.join(',')]
    // })

    // t('Cursor custom with rest n', async() => {
    //   const order = []
    //   await sql`select * from generate_series(1,20)`.cursor(11, async(x) => {
    //     order.push(x.length)
    //   })
    //   return ['11,9', order.join(',')]
    // })

    // t('Cursor custom with less results than batch size', async() => {
    //   const order = []
    //   await sql`select * from generate_series(1,20)`.cursor(21, async(x) => {
    //     order.push(x.length)
    //   })
    //   return ['20', order.join(',')]
    // })

    // t('Cursor cancel', async() => {
    //   let result
    //   await sql`select * from generate_series(1,10) as x`.cursor(async([{ x }]) => {
    //     result = x
    //     return sql.CLOSE
    //   })
    //   return [1, result]
    // })

    // t('Cursor throw', async() => {
    //   const order = []
    //   await sql`select 1 as x union select 2 as x`.cursor(async([x]) => {
    //     order.push(x.x + 'a')
    //     await delay(100)
    //     throw new Error('watty')
    //   }).catch(() => order.push('err'))
    //   return ['1aerr', order.join('')]
    // })

    // t('Cursor error', async() => [
    //   '42601',
    //   await sql`wat`.cursor(() => { /* noop */ }).catch((err) => err.code)
    // ])

    // t('Multiple Cursors', { timeout: 2 }, async() => {
    //   const result = []
    //   await sql.begin(async sql => [
    //     await sql`select 1 as cursor, x from generate_series(1,4) as x`.cursor(async([row]) => {
    //       result.push(row.x)
    //       await new Promise(r => setTimeout(r, 20))
    //     }),
    //     await sql`select 2 as cursor, x from generate_series(101,104) as x`.cursor(async([row]) => {
    //       result.push(row.x)
    //       await new Promise(r => setTimeout(r, 10))
    //     })
    //   ])

    //   return ['1,2,3,4,101,102,103,104', result.join(',')]
    // })

    // t('Cursor as async iterator', async() => {
    //   const order = []
    //   for await (const [x] of sql`select generate_series(1,2) as x;`.cursor()) {
    //     order.push(x.x + 'a')
    //     await delay(10)
    //     order.push(x.x + 'b')
    //   }

    //   return ['1a1b2a2b', order.join('')]
    // })

    // t('Cursor as async iterator with break', async() => {
    //   const order = []
    //   for await (const xs of sql`select generate_series(1,2) as x;`.cursor()) {
    //     order.push(xs[0].x + 'a')
    //     await delay(10)
    //     order.push(xs[0].x + 'b')
    //     break
    //   }

    //   return ['1a1b', order.join('')]
    // })

    // t('Async Iterator Unsafe cursor', async() => {
    //   const order = []
    //   for await (const [x] of sql.unsafe('select 1 as x union select 2 as x').cursor()) {
    //     order.push(x.x + 'a')
    //     await delay(10)
    //     order.push(x.x + 'b')
    //   }
    //   return ['1a1b2a2b', order.join('')]
    // })

    // t('Async Iterator Cursor custom n', async() => {
    //   const order = []
    //   for await (const x of sql`select * from generate_series(1,20)`.cursor(10))
    //     order.push(x.length)

    //   return ['10,10', order.join(',')]
    // })

    // t('Async Iterator Cursor custom with rest n', async() => {
    //   const order = []
    //   for await (const x of sql`select * from generate_series(1,20)`.cursor(11))
    //     order.push(x.length)

    //   return ['11,9', order.join(',')]
    // })

    // t('Async Iterator Cursor custom with less results than batch size', async() => {
    //   const order = []
    //   for await (const x of sql`select * from generate_series(1,20)`.cursor(21))
    //     order.push(x.length)
    //   return ['20', order.join(',')]
    // })

    // t('Transform row', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: { row: () => 1 }
    //   })

    //   return [1, (await sql`select 'wat'`)[0]]
    // })

    // t('Transform row forEach', async() => {
    //   let result
    //   const sql = postgres({
    //     ...options,
    //     transform: { row: () => 1 }
    //   })

    //   await sql`select 1`.forEach(x => result = x)

    //   return [1, result]
    // })

    // t('Transform value', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: { value: () => 1 }
    //   })

    //   return [1, (await sql`select 'wat' as x`)[0].x]
    // })

    // t('Transform columns from', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: postgres.fromCamel
    //   })
    //   await sql`create table test (a_test int, b_test text)`
    //   await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
    //   await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
    //   return [
    //     2,
    //     (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].a_test,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Transform columns to', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: postgres.toCamel
    //   })
    //   await sql`create table test (a_test int, b_test text)`
    //   await sql`insert into test ${ sql([{ a_test: 1, b_test: 1 }]) }`
    //   await sql`update test set ${ sql({ a_test: 2, b_test: 2 }) }`
    //   return [
    //     2,
    //     (await sql`select a_test, b_test from test`)[0].aTest,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Transform columns from and to', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: postgres.camel
    //   })
    //   await sql`create table test (a_test int, b_test text)`
    //   await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
    //   await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
    //   return [
    //     2,
    //     (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].aTest,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Transform columns from and to (legacy)', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: {
    //       column: {
    //         to: postgres.fromCamel,
    //         from: postgres.toCamel
    //       }
    //     }
    //   })
    //   await sql`create table test (a_test int, b_test text)`
    //   await sql`insert into test ${ sql([{ aTest: 1, bTest: 1 }]) }`
    //   await sql`update test set ${ sql({ aTest: 2, bTest: 2 }) }`
    //   return [
    //     2,
    //     (await sql`select ${ sql('aTest', 'bTest') } from test`)[0].aTest,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Unix socket', async() => {
    //   const sql = postgres({
    //     ...options,
    //     host: process.env.PGSOCKET || '/tmp' // eslint-disable-line
    //   })

    //   return [1, (await sql`select 1 as x`)[0].x]
    // })

    test.skipIf(isCI)(
      "Big result",
      async () => {
        await using sql = postgres(options);
        const result = await sql`select * from generate_series(1, 100000)`;
        expect(result.count).toBe(100000);
        let i = 1;

        for (const row of result) {
          expect(row.generate_series).toBe(i++);
        }
      },
      10000,
    );

    // t('Debug', async() => {
    //   let result
    //   const sql = postgres({
    //     ...options,
    //     debug: (connection_id, str) => result = str
    //   })

    //   await sql`select 1`

    //   return ['select 1', result]
    // })

    test("bigint is returned as String", async () => {
      expect(typeof (await sql`select 9223372036854777 as x`)[0].x).toBe("string");
    });

    test("bigint is returned as BigInt", async () => {
      await using sql = postgres({
        ...options,
        bigint: true,
      });
      expect((await sql`select 9223372036854777 as x`)[0].x).toBe(9223372036854777n);
    });

    test("int is returned as Number", async () => {
      expect((await sql`select 123 as x`)[0].x).toBe(123);
    });

    test("numeric is returned as string", async () => {
      const result = (await sql`select 1.2 as x`)[0].x;
      expect(result).toBe("1.2");
    });

    test("flush should work", async () => {
      await using sql = postgres(options);
      await sql`select 1`;
      sql.flush();
    });

    // t('Async stack trace', async() => {
    //   const sql = postgres({ ...options, debug: false })
    //   return [
    //     parseInt(new Error().stack.split('\n')[1].match(':([0-9]+):')[1]) + 1,
    //     parseInt(await sql`error`.catch(x => x.stack.split('\n').pop().match(':([0-9]+):')[1]))
    //   ]
    // })

    // t('Debug has long async stack trace', async() => {
    //   const sql = postgres({ ...options, debug: true })

    //   return [
    //     'watyo',
    //     await yo().catch(x => x.stack.match(/wat|yo/g).join(''))
    //   ]

    //   function yo() {
    //     return wat()
    //   }

    //   function wat() {
    //     return sql`error`
    //   }
    // })

    // t('Error contains query string', async() => [
    //   'selec 1',
    //   (await sql`selec 1`.catch(err => err.query))
    // ])

    // t('Error contains query serialized parameters', async() => [
    //   1,
    //   (await sql`selec ${ 1 }`.catch(err => err.parameters[0]))
    // ])

    // t('Error contains query raw parameters', async() => [
    //   1,
    //   (await sql`selec ${ 1 }`.catch(err => err.args[0]))
    // ])

    // t('Query and parameters on errorare not enumerable if debug is not set', async() => {
    //   const sql = postgres({ ...options, debug: false })

    //   return [
    //     false,
    //     (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') || err.propertyIsEnumerable('query')))
    //   ]
    // })

    // t('Query and parameters are enumerable if debug is set', async() => {
    //   const sql = postgres({ ...options, debug: true })

    //   return [
    //     true,
    //     (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') && err.propertyIsEnumerable('query')))
    //   ]
    // })

    test.each(["connect_timeout", "connectTimeout", "connectionTimeout", "connection_timeout"] as const)(
      "connection timeout key %p throws",
      async key => {
        const server = net.createServer().listen();

        const port = (server.address() as import("node:net").AddressInfo).port;

        const sql = postgres({ port, host: "127.0.0.1", [key]: 0.2 });

        try {
          await sql`select 1`;
          throw new Error("should not reach");
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
          expect(e).toBeInstanceOf(SQL.SQLError);
          expect(e).toBeInstanceOf(SQL.PostgresError);
          expect(e.code).toBe("ERR_POSTGRES_CONNECTION_TIMEOUT");
          expect(e.message).toMatch(/Connection timeout after 200ms/);
        } finally {
          sql.close();
          server.close();
        }
      },
      {
        timeout: 1000,
      },
    );

    // t('connect_timeout throws proper error', async() => [
    //   'CONNECT_TIMEOUT',
    //   await postgres({
    //     ...options,
    //     ...login_scram,
    //     connect_timeout: 0.001
    //   })`select 1`.catch(e => e.code)
    // ])

    // t('connect_timeout error message includes host:port', { timeout: 20 }, async() => {
    //   const connect_timeout = 0.2
    //   const server = net.createServer()
    //   server.listen()
    //   const sql = postgres({ port: server.address().port, host: '127.0.0.1', connect_timeout })
    //   const port = server.address().port
    //   let err
    //   await sql`select 1`.catch((e) => {
    //     if (e.code !== 'CONNECT_TIMEOUT')
    //       throw e
    //     err = e.message
    //   })
    //   server.close()
    //   return [['write CONNECT_TIMEOUT 127.0.0.1:', port].join(''), err]
    // })

    // t('requests works after single connect_timeout', async() => {
    //   let first = true

    //   const sql = postgres({
    //     ...options,
    //     ...login_scram,
    //     connect_timeout: { valueOf() { return first ? (first = false, 0.0001) : 1 } }
    //   })

    //   return [
    //     'CONNECT_TIMEOUT,,1',
    //     [
    //       await sql`select 1 as x`.then(() => 'success', x => x.code),
    //       await delay(10),
    //       (await sql`select 1 as x`)[0].x
    //     ].join(',')
    //   ]
    // })

    // t('Postgres errors are of type PostgresError', async() =>
    //   [true, (await sql`bad keyword`.catch(e => e)) instanceof sql.PostgresError]
    // )

    test.todo("Result has columns spec", async () => {
      expect((await sql`select 1 as x`).columns[0].name).toBe("x");
    });

    // t('forEach has result as second argument', async() => {
    //   let x
    //   await sql`select 1 as x`.forEach((_, result) => x = result)
    //   return ['x', x.columns[0].name]
    // })

    // t('Result as arrays', async() => {
    //   const sql = postgres({
    //     ...options,
    //     transform: {
    //       row: x => Object.values(x)
    //     }
    //   })

    //   return ['1,2', (await sql`select 1 as a, 2 as b`)[0].join(',')]
    // })

    // t('Insert empty array', async() => {
    //   await sql`create table tester (ints int[])`
    //   return [
    //     Array.isArray((await sql`insert into tester (ints) values (${ sql.array([]) }) returning *`)[0].ints),
    //     true,
    //     await sql`drop table tester`
    //   ]
    // })

    // t('Insert array in sql()', async() => {
    //   await sql`create table tester (ints int[])`
    //   return [
    //     Array.isArray((await sql`insert into tester ${ sql({ ints: sql.array([]) }) } returning *`)[0].ints),
    //     true,
    //     await sql`drop table tester`
    //   ]
    // })

    // t('Automatically creates prepared statements', async() => {
    //   const sql = postgres(options)
    //   const result = await sql`select * from pg_prepared_statements`
    //   return [true, result.some(x => x.name = result.statement.name)]
    // })

    // t('no_prepare: true disables prepared statements (deprecated)', async() => {
    //   const sql = postgres({ ...options, no_prepare: true })
    //   const result = await sql`select * from pg_prepared_statements`
    //   return [false, result.some(x => x.name = result.statement.name)]
    // })

    // t('prepare: false disables prepared statements', async() => {
    //   const sql = postgres({ ...options, prepare: false })
    //   const result = await sql`select * from pg_prepared_statements`
    //   return [false, result.some(x => x.name = result.statement.name)]
    // })

    // t('prepare: true enables prepared statements', async() => {
    //   const sql = postgres({ ...options, prepare: true })
    //   const result = await sql`select * from pg_prepared_statements`
    //   return [true, result.some(x => x.name = result.statement.name)]
    // })

    // t('prepares unsafe query when "prepare" option is true', async() => {
    //   const sql = postgres({ ...options, prepare: true })
    //   const result = await sql.unsafe('select * from pg_prepared_statements where name <> $1', ['bla'], { prepare: true })
    //   return [true, result.some(x => x.name = result.statement.name)]
    // })

    // t('does not prepare unsafe query by default', async() => {
    //   const sql = postgres({ ...options, prepare: true })
    //   const result = await sql.unsafe('select * from pg_prepared_statements where name <> $1', ['bla'])
    //   return [false, result.some(x => x.name = result.statement.name)]
    // })

    // t('Recreate prepared statements on transformAssignedExpr error', { timeout: 1 }, async() => {
    //   const insert = () => sql`insert into test (name) values (${ '1' }) returning name`
    //   await sql`create table test (name text)`
    //   await insert()
    //   await sql`alter table test alter column name type int using name::integer`
    //   return [
    //     1,
    //     (await insert())[0].name,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Throws correct error when retrying in transactions', async() => {
    //   await sql`create table test(x int)`
    //   const error = await sql.begin(sql => sql`insert into test (x) values (${ false })`).catch(e => e)
    //   return [
    //     error.code,
    //     '42804',
    //     sql`drop table test`
    //   ]
    // })

    // t('Recreate prepared statements on RevalidateCachedQuery error', async() => {
    //   const select = () => sql`select name from test`
    //   await sql`create table test (name text)`
    //   await sql`insert into test values ('1')`
    //   await select()
    //   await sql`alter table test alter column name type int using name::integer`
    //   return [
    //     1,
    //     (await select())[0].name,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Catches connection config errors', async() => {
    //   const sql = postgres({ ...options, user: { toString: () => { throw new Error('wat') } }, database: 'prut' })

    //   return [
    //     'wat',
    //     await sql`select 1`.catch((e) => e.message)
    //   ]
    // })

    // t('Catches connection config errors with end', async() => {
    //   const sql = postgres({ ...options, user: { toString: () => { throw new Error('wat') } }, database: 'prut' })

    //   return [
    //     'wat',
    //     await sql`select 1`.catch((e) => e.message),
    //     await sql.end()
    //   ]
    // })

    // t('Catches query format errors', async() => [
    //   'wat',
    //   await sql.unsafe({ toString: () => { throw new Error('wat') } }).catch((e) => e.message)
    // ])

    // t('Multiple hosts', {
    //   timeout: 1
    // }, async() => {
    //   const s1 = postgres({ idle_timeout })
    //       , s2 = postgres({ idle_timeout, port: 5433 })
    //       , sql = postgres('postgres://localhost:5432,localhost:5433', { idle_timeout, max: 1 })
    //       , result = []

    //   const id1 = (await s1`select system_identifier as x from pg_control_system()`)[0].x
    //   const id2 = (await s2`select system_identifier as x from pg_control_system()`)[0].x

    //   const x1 = await sql`select 1`
    //   result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)
    //   await s1`select pg_terminate_backend(${ x1.state.pid }::int)`
    //   await delay(50)

    //   const x2 = await sql`select 1`
    //   result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)
    //   await s2`select pg_terminate_backend(${ x2.state.pid }::int)`
    //   await delay(50)

    //   result.push((await sql`select system_identifier as x from pg_control_system()`)[0].x)

    //   return [[id1, id2, id1].join(','), result.join(',')]
    // })

    // t('Escaping supports schemas and tables', async() => {
    //   await sql`create schema a`
    //   await sql`create table a.b (c int)`
    //   await sql`insert into a.b (c) values (1)`
    //   return [
    //     1,
    //     (await sql`select ${ sql('a.b.c') } from a.b`)[0].c,
    //     await sql`drop table a.b`,
    //     await sql`drop schema a`
    //   ]
    // })

    // t('Raw method returns rows as arrays', async() => {
    //   const [x] = await sql`select 1`.raw()
    //   return [
    //     Array.isArray(x),
    //     true
    //   ]
    // })

    // t('Raw method returns values unparsed as Buffer', async() => {
    //   const [[x]] = await sql`select 1`.raw()
    //   return [
    //     x instanceof Uint8Array,
    //     true
    //   ]
    // })

    test("Array returns rows as arrays of columns", async () => {
      return [(await sql`select 1`.values())[0][0], 1];
    });

    // t('Copy read', async() => {
    //   const result = []

    //   await sql`create table test (x int)`
    //   await sql`insert into test select * from generate_series(1,10)`
    //   const readable = await sql`copy test to stdout`.readable()
    //   readable.on('data', x => result.push(x))
    //   await new Promise(r => readable.on('end', r))

    //   return [
    //     result.length,
    //     10,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Copy write', { timeout: 2 }, async() => {
    //   await sql`create table test (x int)`
    //   const writable = await sql`copy test from stdin`.writable()

    //   writable.write('1\n')
    //   writable.write('1\n')
    //   writable.end()

    //   await new Promise(r => writable.on('finish', r))

    //   return [
    //     (await sql`select 1 from test`).length,
    //     2,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Copy write as first', async() => {
    //   await sql`create table test (x int)`
    //   const first = postgres(options)
    //   const writable = await first`COPY test FROM STDIN WITH(FORMAT csv, HEADER false, DELIMITER ',')`.writable()
    //   writable.write('1\n')
    //   writable.write('1\n')
    //   writable.end()

    //   await new Promise(r => writable.on('finish', r))

    //   return [
    //     (await sql`select 1 from test`).length,
    //     2,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Copy from file', async() => {
    //   await sql`create table test (x int, y int, z int)`
    //   await new Promise(async r => fs
    //     .createReadStream(rel('copy.csv'))
    //     .pipe(await sql`copy test from stdin`.writable())
    //     .on('finish', r)
    //   )

    //   return [
    //     JSON.stringify(await sql`select * from test`),
    //     '[{"x":1,"y":2,"z":3},{"x":4,"y":5,"z":6}]',
    //     await sql`drop table test`
    //   ]
    // })

    // t('Copy from works in transaction', async() => {
    //   await sql`create table test(x int)`
    //   const xs = await sql.begin(async sql => {
    //     (await sql`copy test from stdin`.writable()).end('1\n2')
    //     await delay(20)
    //     return sql`select 1 from test`
    //   })

    //   return [
    //     xs.length,
    //     2,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Copy from abort', async() => {
    //   const sql = postgres(options)
    //   const readable = fs.createReadStream(rel('copy.csv'))

    //   await sql`create table test (x int, y int, z int)`
    //   await sql`TRUNCATE TABLE test`

    //   const writable = await sql`COPY test FROM STDIN`.writable()

    //   let aborted

    //   readable
    //     .pipe(writable)
    //     .on('error', (err) => aborted = err)

    //   writable.destroy(new Error('abort'))
    //   await sql.end()

    //   return [
    //     'abort',
    //     aborted.message,
    //     await postgres(options)`drop table test`
    //   ]
    // })

    // t('multiple queries before connect', async() => {
    //   const sql = postgres({ ...options, max: 2 })
    //   const xs = await Promise.all([
    //     sql`select 1 as x`,
    //     sql`select 2 as x`,
    //     sql`select 3 as x`,
    //     sql`select 4 as x`
    //   ])

    //   return [
    //     '1,2,3,4',
    //     xs.map(x => x[0].x).join()
    //   ]
    // })

    // t('subscribe', { timeout: 2 }, async() => {
    //   const sql = postgres({
    //     database: 'bun_sql_test',
    //     publications: 'alltables'
    //   })

    //   await sql.unsafe('create publication alltables for all tables')

    //   const result = []

    //   const { unsubscribe } = await sql.subscribe('*', (row, { command, old }) => {
    //     result.push(command, row.name, row.id, old && old.name, old && old.id)
    //   })

    //   await sql`
    //     create table test (
    //       id serial primary key,
    //       name text
    //     )
    //   `

    //   await sql`alter table test replica identity default`
    //   await sql`insert into test (name) values ('Murray')`
    //   await sql`update test set name = 'Rothbard'`
    //   await sql`update test set id = 2`
    //   await sql`delete from test`
    //   await sql`alter table test replica identity full`
    //   await sql`insert into test (name) values ('Murray')`
    //   await sql`update test set name = 'Rothbard'`
    //   await sql`delete from test`
    //   await delay(10)
    //   await unsubscribe()
    //   await sql`insert into test (name) values ('Oh noes')`
    //   await delay(10)
    //   return [
    //     'insert,Murray,1,,,update,Rothbard,1,,,update,Rothbard,2,,1,delete,,2,,,insert,Murray,2,,,update,Rothbard,2,Murray,2,delete,Rothbard,2,,', // eslint-disable-line
    //     result.join(','),
    //     await sql`drop table test`,
    //     await sql`drop publication alltables`,
    //     await sql.end()
    //   ]
    // })

    // t('subscribe with transform', { timeout: 2 }, async() => {
    //   const sql = postgres({
    //     transform: {
    //       column: {
    //         from: postgres.toCamel,
    //         to: postgres.fromCamel
    //       }
    //     },
    //     database: 'bun_sql_test',
    //     publications: 'alltables'
    //   })

    //   await sql.unsafe('create publication alltables for all tables')

    //   const result = []

    //   const { unsubscribe } = await sql.subscribe('*', (row, { command, old }) =>
    //     result.push(command, row.nameInCamel || row.id, old && old.nameInCamel)
    //   )

    //   await sql`
    //     create table test (
    //       id serial primary key,
    //       name_in_camel text
    //     )
    //   `

    //   await sql`insert into test (name_in_camel) values ('Murray')`
    //   await sql`update test set name_in_camel = 'Rothbard'`
    //   await sql`delete from test`
    //   await sql`alter table test replica identity full`
    //   await sql`insert into test (name_in_camel) values ('Murray')`
    //   await sql`update test set name_in_camel = 'Rothbard'`
    //   await sql`delete from test`
    //   await delay(10)
    //   await unsubscribe()
    //   await sql`insert into test (name_in_camel) values ('Oh noes')`
    //   await delay(10)
    //   return [
    //     'insert,Murray,,update,Rothbard,,delete,1,,insert,Murray,,update,Rothbard,Murray,delete,Rothbard,',
    //     result.join(','),
    //     await sql`drop table test`,
    //     await sql`drop publication alltables`,
    //     await sql.end()
    //   ]
    // })

    // t('subscribe reconnects and calls onsubscribe', { timeout: 4 }, async() => {
    //   const sql = postgres({
    //     database: 'bun_sql_test',
    //     publications: 'alltables',
    //     fetch_types: false
    //   })

    //   await sql.unsafe('create publication alltables for all tables')

    //   const result = []
    //   let onsubscribes = 0

    //   const { unsubscribe, sql: subscribeSql } = await sql.subscribe(
    //     '*',
    //     (row, { command, old }) => result.push(command, row.name || row.id, old && old.name),
    //     () => onsubscribes++
    //   )

    //   await sql`
    //     create table test (
    //       id serial primary key,
    //       name text
    //     )
    //   `

    //   await sql`insert into test (name) values ('Murray')`
    //   await delay(10)
    //   await subscribeSql.close()
    //   await delay(500)
    //   await sql`delete from test`
    //   await delay(100)
    //   await unsubscribe()
    //   return [
    //     '2insert,Murray,,delete,1,',
    //     onsubscribes + result.join(','),
    //     await sql`drop table test`,
    //     await sql`drop publication alltables`,
    //     await sql.end()
    //   ]
    // })

    // t('Execute', async() => {
    //   const result = await new Promise((resolve) => {
    //     const sql = postgres({ ...options, fetch_types: false, debug:(id, query) => resolve(query) })
    //     sql`select 1`.execute()
    //   })

    //   return [result, 'select 1']
    // })

    // t('Cancel running query', async() => {
    //   const query = sql`select pg_sleep(2)`
    //   setTimeout(() => query.cancel(), 200)
    //   const error = await query.catch(x => x)
    //   return ['57014', error.code]
    // })

    // t('Cancel piped query', { timeout: 5 }, async() => {
    //   await sql`select 1`
    //   const last = sql`select pg_sleep(1)`.execute()
    //   const query = sql`select pg_sleep(2) as dig`
    //   setTimeout(() => query.cancel(), 500)
    //   const error = await query.catch(x => x)
    //   await last
    //   return ['57014', error.code]
    // })

    // t('Cancel queued query', async() => {
    //   const query = sql`select pg_sleep(2) as nej`
    //   const tx = sql.begin(sql => (
    //     query.cancel(),
    //     sql`select pg_sleep(0.5) as hej, 'hejsa'`
    //   ))
    //   const error = await query.catch(x => x)
    //   await tx
    //   return ['57014', error.code]
    // })

    // t('Fragments', async() => [
    //   1,
    //   (await sql`
    //     ${ sql`select` } 1 as x
    //   `)[0].x
    // ])

    // t('Result becomes array', async() => [
    //   true,
    //   (await sql`select 1`).slice() instanceof Array
    // ])

    // t('Describe', async() => {
    //   const type = (await sql`select ${ 1 }::int as x`.describe()).types[0]
    //   return [23, type]
    // })

    // t('Describe a statement', async() => {
    //   await sql`create table tester (name text, age int)`
    //   const r = await sql`select name, age from tester where name like $1 and age > $2`.describe()
    //   return [
    //     '25,23/name:25,age:23',
    //     `${ r.types.join(',') }/${ r.columns.map(c => `${c.name}:${c.type}`).join(',') }`,
    //     await sql`drop table tester`
    //   ]
    // })

    // t('Include table oid and column number in column details', async() => {
    //   await sql`create table tester (name text, age int)`
    //   const r = await sql`select name, age from tester where name like $1 and age > $2`.describe()
    //   const [{ oid }] = await sql`select oid from pg_class where relname = 'tester'`

    //   return [
    //     `table:${oid},number:1|table:${oid},number:2`,
    //     `${ r.columns.map(c => `table:${c.table},number:${c.number}`).join('|') }`,
    //     await sql`drop table tester`
    //   ]
    // })

    // t('Describe a statement without parameters', async() => {
    //   await sql`create table tester (name text, age int)`
    //   const r = await sql`select name, age from tester`.describe()
    //   return [
    //     '0,2',
    //     `${ r.types.length },${ r.columns.length }`,
    //     await sql`drop table tester`
    //   ]
    // })

    // t('Describe a statement without columns', async() => {
    //   await sql`create table tester (name text, age int)`
    //   const r = await sql`insert into tester (name, age) values ($1, $2)`.describe()
    //   return [
    //     '2,0',
    //     `${ r.types.length },${ r.columns.length }`,
    //     await sql`drop table tester`
    //   ]
    // })

    // t('Large object', async() => {
    //   const file = rel('index.js')
    //       , md5 = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

    //   const lo = await sql.largeObject()
    //   await new Promise(async r => fs.createReadStream(file).pipe(await lo.writable()).on('finish', r))
    //   await lo.seek(0)

    //   const out = crypto.createHash('md5')
    //   await new Promise(r => lo.readable().then(x => x.on('data', x => out.update(x)).on('end', r)))

    //   return [
    //     md5,
    //     out.digest('hex'),
    //     await lo.close()
    //   ]
    // })

    // t('Catches type serialize errors', async() => {
    //   const sql = postgres({
    //     idle_timeout,
    //     types: {
    //       text: {
    //         from: 25,
    //         to: 25,
    //         parse: x => x,
    //         serialize: () => { throw new Error('watSerialize') }
    //       }
    //     }
    //   })

    //   return [
    //     'watSerialize',
    //     (await sql`select ${ 'wat' }`.catch(e => e.message))
    //   ]
    // })

    // t('Catches type parse errors', async() => {
    //   const sql = postgres({
    //     idle_timeout,
    //     types: {
    //       text: {
    //         from: 25,
    //         to: 25,
    //         parse: () => { throw new Error('watParse') },
    //         serialize: x => x
    //       }
    //     }
    //   })

    //   return [
    //     'watParse',
    //     (await sql`select 'wat'`.catch(e => e.message))
    //   ]
    // })

    // t('Catches type serialize errors in transactions', async() => {
    //   const sql = postgres({
    //     idle_timeout,
    //     types: {
    //       text: {
    //         from: 25,
    //         to: 25,
    //         parse: x => x,
    //         serialize: () => { throw new Error('watSerialize') }
    //       }
    //     }
    //   })

    //   return [
    //     'watSerialize',
    //     (await sql.begin(sql => (
    //       sql`select 1`,
    //       sql`select ${ 'wat' }`
    //     )).catch(e => e.message))
    //   ]
    // })

    // t('Catches type parse errors in transactions', async() => {
    //   const sql = postgres({
    //     idle_timeout,
    //     types: {
    //       text: {
    //         from: 25,
    //         to: 25,
    //         parse: () => { throw new Error('watParse') },
    //         serialize: x => x
    //       }
    //     }
    //   })

    //   return [
    //     'watParse',
    //     (await sql.begin(sql => (
    //       sql`select 1`,
    //       sql`select 'wat'`
    //     )).catch(e => e.message))
    //   ]
    // })

    // t('Prevent premature end of connection in transaction', async() => {
    //   const sql = postgres({ max_lifetime: 0.01, idle_timeout })
    //   const result = await sql.begin(async sql => {
    //     await sql`select 1`
    //     await delay(20)
    //     await sql`select 1`
    //     return 'yay'
    //   })

    //   return [
    //     'yay',
    //     result
    //   ]
    // })

    // t('Ensure reconnect after max_lifetime with transactions', { timeout: 5 }, async() => {
    //   const sql = postgres({
    //     max_lifetime: 0.01,
    //     idle_timeout,
    //     max: 1
    //   })

    //   let x = 0
    //   while (x++ < 10) await sql.begin(sql => sql`select 1 as x`)

    //   return [true, true]
    // })

    // t('Custom socket', {}, async() => {
    //   let result
    //   const sql = postgres({
    //     socket: () => new Promise((resolve, reject) => {
    //       const socket = new net.Socket()
    //       socket.connect(5432)
    //       socket.once('data', x => result = x[0])
    //       socket.on('error', reject)
    //       socket.on('connect', () => resolve(socket))
    //     }),
    //     idle_timeout
    //   })

    //   await sql`select 1`

    //   return [
    //     result,
    //     82
    //   ]
    // })

    // t('Ensure drain only dequeues if ready', async() => {
    //   const sql = postgres(options)

    //   const res = await Promise.all([
    //     sql.unsafe('SELECT 0+$1 --' + '.'.repeat(100000), [1]),
    //     sql.unsafe('SELECT 0+$1+$2+$3', [1, 2, 3])
    //   ])

    //   return [res.length, 2]
    // })

    // t('Supports fragments as dynamic parameters', async() => {
    //   await sql`create table test (a int, b bool)`
    //   await sql`insert into test values(1, true)`
    //   await sql`insert into test ${
    //     sql({
    //       a: 2,
    //       b: sql`exists(select 1 from test where b = ${ true })`
    //     })
    //   }`

    //   return [
    //     '1,t2,t',
    //     (await sql`select * from test`.raw()).join(''),
    //     await sql`drop table test`
    //   ]
    // })

    // t('Supports nested fragments with parameters', async() => {
    //   await sql`create table test ${
    //     sql`(${ sql('a') } ${ sql`int` })`
    //   }`
    //   await sql`insert into test values(1)`
    //   return [
    //     1,
    //     (await sql`select a from test`)[0].a,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Supports multiple nested fragments with parameters', async() => {
    //   const [{ b }] = await sql`select * ${
    //     sql`from ${
    //       sql`(values (2, ${ 1 }::int)) as x(${ sql(['a', 'b']) })`
    //     }`
    //   }`
    //   return [
    //     1,
    //     b
    //   ]
    // })

    // t('Supports arrays of fragments', async() => {
    //   const [{ x }] = await sql`
    //     ${ [sql`select`, sql`1`, sql`as`, sql`x`] }
    //   `

    //   return [
    //     1,
    //     x
    //   ]
    // })

    // t('Does not try rollback when commit errors', async() => {
    //   let notice = null
    //   const sql = postgres({ ...options, onnotice: x => notice = x })
    //   await sql`create table test(x int constraint test_constraint unique deferrable initially deferred)`

    //   await sql.begin('isolation level serializable', async sql => {
    //     await sql`insert into test values(1)`
    //     await sql`insert into test values(1)`
    //   }).catch(e => e)

    //   return [
    //     notice,
    //     null,
    //     await sql`drop table test`
    //   ]
    // })

    // t('Last keyword used even with duplicate keywords', async() => {
    //   await sql`create table test (x int)`
    //   await sql`insert into test values(1)`
    //   const [{ x }] = await sql`
    //     select
    //       1 in (1) as x
    //     from test
    //     where x in ${ sql([1, 2]) }
    //   `

    //   return [x, true, await sql`drop table test`]
    // })

    // Hangs with array
    test.todo("Insert array with null", async () => {
      await sql`create table test (x int[])`;
      console.log("here");
      try {
        await sql`insert into test ${sql({ x: [1, null, 3] })}`;
        expect((await sql`select x from test`)[0].x[0]).toBe(1);
      } finally {
        await sql`drop table test`;
      }
    });

    // t('Insert array with undefined throws', async() => {
    //   await sql`create table test (x int[])`
    //   return [
    //     'UNDEFINED_VALUE',
    //     await sql`insert into test ${ sql({ x: [1, undefined, 3] }) }`.catch(e => e.code),
    //     await sql`drop table test`
    //   ]
    // })

    // t('Insert array with undefined transform', async() => {
    //   const sql = postgres({ ...options, transform: { undefined: null } })
    //   await sql`create table test (x int[])`
    //   await sql`insert into test ${ sql({ x: [1, undefined, 3] }) }`
    //   return [
    //     1,
    //     (await sql`select x from test`)[0].x[0],
    //     await sql`drop table test`
    //   ]
    // })

    // t('concurrent cursors', async() => {
    //   const xs = []

    //   await Promise.all([...Array(7)].map((x, i) => [
    //     sql`select ${ i }::int as a, generate_series(1, 2) as x`.cursor(([x]) => xs.push(x.a + x.x))
    //   ]).flat())

    //   return ['12233445566778', xs.join('')]
    // })

    // t('concurrent cursors multiple connections', async() => {
    //   const sql = postgres({ ...options, max: 2 })
    //   const xs = []

    //   await Promise.all([...Array(7)].map((x, i) => [
    //     sql`select ${ i }::int as a, generate_series(1, 2) as x`.cursor(([x]) => xs.push(x.a + x.x))
    //   ]).flat())

    //   return ['12233445566778', xs.sort().join('')]
    // })

    test("limits of types", async () => {
      await sql
        .transaction(async reserved => {
          const table_name = sql(Bun.randomUUIDv7("hex").replaceAll("-", "_"));
          // we need a lot of types
          for (let i = 0; i < 1000; i++) {
            const type_name = sql(`${table_name}${i}`);
            // create a lot of custom types
            await reserved`CREATE TYPE "public".${type_name} AS ENUM('active', 'inactive', 'deleted');`;
          }
          await reserved`
CREATE TABLE ${table_name} (
"id" serial PRIMARY KEY NOT NULL,
"status" ${sql(`${table_name}999`)} DEFAULT 'active' NOT NULL
);`.simple();
          await reserved`insert into ${table_name} values (1, 'active'), (2, 'inactive'), (3, 'deleted')`;
          const result = await reserved`select * from ${table_name}`;
          expect(result).toBeDefined();
          expect(result.length).toBe(3);
          expect(result[0].status).toBe("active");
          expect(result[1].status).toBe("inactive");
          expect(result[2].status).toBe("deleted");
          throw new Error("rollback"); // no need to commit all this
        })
        .catch(e => {
          expect(e.message || e).toBe("rollback");
        });
    });
    test("binary detection of unsupported types", async () => {
      using reserved = await sql.reserve();
      // this test should return the same result in text and binary mode, using text mode for this types
      {
        const table_name = sql(Bun.randomUUIDv7("hex").replaceAll("-", "_"));

        await reserved`
    CREATE TEMPORARY TABLE ${table_name} (
        a smallint NOT NULL,
        b smallint NOT NULL,
        c smallint NOT NULL
    )`;
        await reserved`insert into ${table_name} values (1, 23, 256)`;
        const binary_mode = await reserved`select * from ${table_name} where a = ${1}`;
        expect(binary_mode).toEqual([{ a: 1, b: 23, c: 256 }]);
        const text_mode = await reserved`select * from ${table_name}`;
        expect(text_mode).toEqual([{ a: 1, b: 23, c: 256 }]);
      }
      {
        const table_name = sql(Bun.randomUUIDv7("hex").replaceAll("-", "_"));

        await reserved`
    CREATE TEMPORARY TABLE ${table_name} (
        a numeric NOT NULL,
        b numeric NOT NULL,
        c numeric NOT NULL
    )`;
        await reserved`insert into ${table_name} values (1, 23, 256)`;
        const binary_mode = await reserved`select * from ${table_name} where a = ${1}`;
        expect(binary_mode).toEqual([{ a: "1", b: "23", c: "256" }]);
        const text_mode = await reserved`select * from ${table_name}`;
        expect(text_mode).toEqual([{ a: "1", b: "23", c: "256" }]);
      }

      {
        const table_name = sql(Bun.randomUUIDv7("hex").replaceAll("-", "_"));

        await reserved`
    CREATE TEMPORARY TABLE ${table_name} (
        a bigint NOT NULL,
        b bigint NOT NULL,
        c bigint NOT NULL
    )`;
        await reserved`insert into ${table_name} values (1, 23, 256)`;
        const binary_mode = await reserved`select * from ${table_name} where a = ${1}`;
        expect(binary_mode).toEqual([{ a: "1", b: "23", c: "256" }]);
        const text_mode = await reserved`select * from ${table_name}`;
        expect(text_mode).toEqual([{ a: "1", b: "23", c: "256" }]);
      }

      {
        const table_name = sql(Bun.randomUUIDv7("hex").replaceAll("-", "_"));

        await reserved`
    CREATE TEMPORARY TABLE ${table_name} (
        a date NOT NULL,
        b date NOT NULL,
        c date NOT NULL
    )`;
        await reserved`insert into ${table_name} values ('2025-01-01', '2025-01-02', '2025-01-03')`;
        const binary_mode = await reserved`select * from ${table_name} where a >= ${"2025-01-01"}`;
        expect(binary_mode).toEqual([
          { a: new Date("2025-01-01"), b: new Date("2025-01-02"), c: new Date("2025-01-03") },
        ]);
        const text_mode = await reserved`select * from ${table_name}`;
        expect(text_mode).toEqual([
          { a: new Date("2025-01-01"), b: new Date("2025-01-02"), c: new Date("2025-01-03") },
        ]);
      }
      // this is supported in binary mode and also in text mode
      {
        const table_name = sql(Bun.randomUUIDv7("hex").replaceAll("-", "_"));
        await reserved`CREATE TEMPORARY TABLE ${table_name} (a integer[] null, b smallint not null)`;
        await reserved`insert into ${table_name} values (null, 1), (array[1, 2, 3], 2), (array[4, 5, 6], 3)`;
        const text_mode = await reserved`select * from ${table_name}`;
        expect(text_mode.map(row => row)).toEqual([
          { a: null, b: 1 },
          { a: [1, 2, 3], b: 2 },
          { a: [4, 5, 6], b: 3 },
        ]);
        const binary_mode = await reserved`select * from ${table_name} where b = ${2}`;
        // for now we return a typed array with do not match postgres's array type (this need to accept nulls so will change in future)
        expect(binary_mode.map(row => row)).toEqual([{ a: new Int32Array([1, 2, 3]), b: 2 }]);
      }
    });
    test("reserve connection", async () => {
      const sql = postgres({ ...options, max: 1 });
      const reserved = await sql.reserve();

      setTimeout(() => reserved.release(), 510);

      const xs = await Promise.all([
        reserved`select 1 as x`.then(([{ x }]) => ({ time: Date.now(), x })),
        sql`select 2 as x`.then(([{ x }]) => ({ time: Date.now(), x })),
        reserved`select 3 as x`.then(([{ x }]) => ({ time: Date.now(), x })),
      ]);

      if (xs[1].time - xs[2].time < 500) throw new Error("Wrong time");

      expect(xs.map(x => x.x).join("")).toBe("123");
    });

    test("keeps process alive when it should", async () => {
      const file = path.posix.join(__dirname, "sql-fixture-ref.ts");
      const result = await $`DATABASE_URL=${process.env.DATABASE_URL} ${bunExe()} ${file}`;
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().split("\n")).toEqual(["1", "2", ""]);
    });

    describe("Boolean Array Type", () => {
      test("should handle empty boolean array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::boolean[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("should handle array with single boolean value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[true]::boolean[] as single_value`;
        expect(result[0].single_value).toEqual([true]);
      });

      test("should handle array with multiple boolean values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[true, false, true]::boolean[] as multiple_values`;
        expect(result[0].multiple_values).toEqual([true, false, true]);
      });

      test("should handle array with null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[true, null, false, null]::boolean[] as array_with_nulls`;
        expect(result[0].array_with_nulls).toEqual([true, null, false, null]);
      });

      test("should handle null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::boolean[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("should handle array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY[true, false] @> ARRAY[true]::boolean[] as contains_true,
        ARRAY[true, false] @> ARRAY[false]::boolean[] as contains_false,
        ARRAY[true, false] @> ARRAY[true, false]::boolean[] as contains_both
    `;

        expect(result[0].contains_true).toBe(true);
        expect(result[0].contains_false).toBe(true);
        expect(result[0].contains_both).toBe(true);
      });

      test("should handle array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY[true, false] && ARRAY[true]::boolean[] as overlaps_true,
        ARRAY[true, false] && ARRAY[false]::boolean[] as overlaps_false,
        ARRAY[true, true] && ARRAY[false]::boolean[] as no_overlap
    `;

        expect(result[0].overlaps_true).toBe(true);
        expect(result[0].overlaps_false).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("should handle array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY[true, false] || ARRAY[true]::boolean[] as concatenated,
        ARRAY[true] || ARRAY[false]::boolean[] || ARRAY[true]::boolean[] as triple_concat
    `;

        expect(result[0].concatenated).toEqual([true, false, true]);
        expect(result[0].triple_concat).toEqual([true, false, true]);
      });

      test("should handle array unnesting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT unnest(ARRAY[true, false, true]::boolean[]) as unnested
      ORDER BY unnested DESC
    `;

        expect(result.map(r => r.unnested)).toEqual([true, true, false]);
      });

      test("should handle array aggregation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT array_agg(b ORDER BY b DESC) as agg_result
      FROM (
        SELECT unnest(ARRAY[true, false, true, false]::boolean[]) as b
      ) subquery
    `;

        expect(result[0].agg_result).toEqual([true, true, false, false]);
      });

      test("should handle array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY[true, false] = ARRAY[true, false]::boolean[] as equal_arrays,
        ARRAY[true, false] = ARRAY[false, true]::boolean[] as different_arrays,
        ARRAY[true, true] > ARRAY[true, false]::boolean[] as greater_than,
        ARRAY[false, false] < ARRAY[false, true]::boolean[] as less_than
    `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].different_arrays).toBe(false);
        expect(result[0].greater_than).toBe(true);
        expect(result[0].less_than).toBe(true);
      });

      test("should handle array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        array_dims(ARRAY[true, false]::boolean[]) as one_dim,
        array_dims(ARRAY[[true, false], [false, true]]::boolean[][]) as two_dim
    `;

        expect(result[0].one_dim).toBe("[1:2]");
        expect(result[0].two_dim).toBe("[1:2][1:2]");
      });

      test("should handle array length", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        array_length(ARRAY[true, false]::boolean[], 1) as length_one_dim,
        array_length(ARRAY[[true, false], [false, true]]::boolean[][], 1) as rows_two_dim,
        array_length(ARRAY[[true, false], [false, true]]::boolean[][], 2) as cols_two_dim
    `;

        expect(result[0].length_one_dim).toBe(2);
        expect(result[0].rows_two_dim).toBe(2);
        expect(result[0].cols_two_dim).toBe(2);
      });
    });

    describe("Bytea Array Type", () => {
      test("should handle empty bytea array", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`SELECT ARRAY[]::bytea[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("should handle array with single bytea value", async () => {
        const result = await sql`
      SELECT ARRAY[E'\\x41424344'::bytea]::bytea[] as single_value
    `;
        expect(Buffer.from(result[0].single_value[0]).toString("hex")).toBe("41343234333434");
      });

      test("should handle array with multiple bytea values", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`
      SELECT ARRAY[
        E'\\x41424344'::bytea,
        E'\\x45464748'::bytea
      ]::bytea[] as multiple_values
    `;
        const values = result[0].multiple_values.map(buffer => Buffer.from(buffer).toString("hex"));
        expect(values).toEqual(["41343234333434", "45343634373438"]);
      });

      test("should handle array with null values", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`
      SELECT ARRAY[
        E'\\x41424344'::bytea,
        NULL,
        E'\\x45464748'::bytea,
        NULL
      ]::bytea[] as array_with_nulls
    `;

        const values = result[0].array_with_nulls.map(buffer => (buffer ? Buffer.from(buffer).toString("hex") : null));
        expect(values).toEqual(["41343234333434", null, "45343634373438", null]);
      });

      test("should handle null array", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`SELECT NULL::bytea[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("should handle array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`
      SELECT
        ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea] @>
        ARRAY[E'\\x41424344'::bytea]::bytea[] as contains_first,

        ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea] @>
        ARRAY[E'\\x45464748'::bytea]::bytea[] as contains_second,

        ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea] @>
        ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea]::bytea[] as contains_both
    `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_both).toBe(true);
      });

      test("should handle array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`
      SELECT
        ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea] &&
        ARRAY[E'\\x41424344'::bytea]::bytea[] as overlaps_first,

        ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea] &&
        ARRAY[E'\\x45464748'::bytea]::bytea[] as overlaps_second,

        ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea] &&
        ARRAY[E'\\x49504B4C'::bytea]::bytea[] as no_overlap
    `;

        expect(result[0].overlaps_first).toBe(true);
        expect(result[0].overlaps_second).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("should handle array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`
      SELECT
        ARRAY[E'\\x41424344'::bytea] ||
        ARRAY[E'\\x45464748'::bytea]::bytea[] as concatenated
    `;

        const values = result[0].concatenated.map(buffer => Buffer.from(buffer).toString("hex"));
        expect(values).toEqual(["41343234333434", "45343634373438"]);
      });

      test("should handle array unnesting", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`
      SELECT unnest(ARRAY[
        E'\\x41424344'::bytea,
        E'\\x45464748'::bytea
      ]::bytea[]) as unnested
    `;

        const values = result.map(r => Buffer.from(r.unnested).toString("hex"));
        expect(values).toEqual(["41343234333434", "45343634373438"]);
      });

      test("should handle array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`
      SELECT
        ARRAY[E'\\x41424344'::bytea] =
        ARRAY[E'\\x41424344'::bytea]::bytea[] as equal_arrays,

        ARRAY[E'\\x41424344'::bytea] =
        ARRAY[E'\\x45464748'::bytea]::bytea[] as different_arrays
    `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].different_arrays).toBe(false);
      });

      test("should handle array dimensions and length", async () => {
        await using sql = postgres({ ...options, max: 1 });

        const result = await sql`
      SELECT
        array_length(
          ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea]::bytea[],
          1
        ) as length,
        array_dims(
          ARRAY[E'\\x41424344'::bytea, E'\\x45464748'::bytea]::bytea[]
        ) as dimensions
    `;

        expect(result[0].length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
      });
    });

    describe("char Array Type", () => {
      test("char[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::char[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("char[] - single char", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['A']::char[] as single_value`;
        expect(result[0].single_value[0].trim()).toBe("A");
      });

      test("char[] - multiple chars", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['A', 'B', 'C']::char[] as multiple_values`;
        expect(result[0].multiple_values.map(c => c.trim())).toEqual(["A", "B", "C"]);
      });

      test("char[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['A', NULL, 'C', NULL]::char[] as array_with_nulls`;
        expect(result[0].array_with_nulls.map(c => c?.trim() || null)).toEqual(["A", null, "C", null]);
      });

      test("char[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::char[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("char[] - special characters", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['$', '#', '@', '&']::char[] as special_chars`;
        expect(result[0].special_chars.map(c => c.trim())).toEqual(["$", "#", "@", "&"]);
      });

      test("char[] - numbers as chars", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['1', '2', '3']::char[] as numeric_chars`;
        expect(result[0].numeric_chars.map(c => c.trim())).toEqual(["1", "2", "3"]);
      });

      test("char[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        (ARRAY['A', 'B', 'C']::char[])[1] as first_element,
        (ARRAY['A', 'B', 'C']::char[])[2] as second_element,
        (ARRAY['A', 'B', 'C']::char[])[3] as third_element
    `;

        expect(result[0].first_element.trim()).toBe("A");
        expect(result[0].second_element.trim()).toBe("B");
        expect(result[0].third_element.trim()).toBe("C");
      });

      test("char[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY['A', 'B', 'C']::char[] @> ARRAY['A']::char[] as contains_a,
        ARRAY['A', 'B', 'C']::char[] @> ARRAY['B']::char[] as contains_b,
        ARRAY['A', 'B', 'C']::char[] @> ARRAY['D']::char[] as contains_d,
        ARRAY['A', 'B', 'C']::char[] @> ARRAY['A', 'B']::char[] as contains_ab
    `;

        expect(result[0].contains_a).toBe(true);
        expect(result[0].contains_b).toBe(true);
        expect(result[0].contains_d).toBe(false);
        expect(result[0].contains_ab).toBe(true);
      });

      test("char[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY['A', 'B']::char[] && ARRAY['B', 'C']::char[] as has_overlap,
        ARRAY['A', 'B']::char[] && ARRAY['C', 'D']::char[] as no_overlap
    `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("char[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY['A', 'B']::char[] || ARRAY['C', 'D']::char[] as concatenated,
        ARRAY['A']::char[] || ARRAY['B']::char[] || ARRAY['C']::char[] as triple_concat
    `;

        expect(result[0].concatenated.map(c => c.trim())).toEqual(["A", "B", "C", "D"]);
        expect(result[0].triple_concat.map(c => c.trim())).toEqual(["A", "B", "C"]);
      });

      test("char[] - array unnesting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT unnest(ARRAY['A', 'B', 'C']::char[]) as unnested
      ORDER BY unnested
    `;

        expect(result.map(r => r.unnested.trim())).toEqual(["A", "B", "C"]);
      });

      test("char[] - empty strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['', '', 'C']::char[] as array_with_empty`;
        expect(result[0].array_with_empty.map(c => c.trim())).toEqual(["", "", "C"]);
      });

      test("char[] - case sensitivity", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY['a']::char[] = ARRAY['A']::char[] as case_sensitive,
        ARRAY['a']::char[] = ARRAY['a']::char[] as same_case
    `;

        expect(result[0].case_sensitive).toBe(false);
        expect(result[0].same_case).toBe(true);
      });

      test("char[] - array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        ARRAY['A', 'B']::char[] = ARRAY['A', 'B']::char[] as equal_arrays,
        ARRAY['A', 'B']::char[] = ARRAY['B', 'A']::char[] as different_order,
        ARRAY['A', 'B']::char[] < ARRAY['B', 'B']::char[] as less_than,
        ARRAY['B', 'B']::char[] > ARRAY['A', 'B']::char[] as greater_than
    `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].different_order).toBe(false);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });

      test("char[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      SELECT
        array_length(ARRAY['A', 'B', 'C']::char[], 1) as array_length,
        array_dims(ARRAY['A', 'B', 'C']::char[]) as dimensions,
        array_upper(ARRAY['A', 'B', 'C']::char[], 1) as upper_bound,
        array_lower(ARRAY['A', 'B', 'C']::char[], 1) as lower_bound
    `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("char[] - array aggregation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
      WITH chars AS (
        SELECT unnest(ARRAY['A', 'B', 'A', 'C']::char[]) as char
      )
      SELECT array_agg(char ORDER BY char) as aggregated
      FROM chars
    `;

        expect(result[0].aggregated.map(c => c.trim())).toEqual(["A", "A", "B", "C"]);
      });
    });
    describe("name Array Type", () => {
      test("name[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::name[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("name[] - single name", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['test_name']::name[] as single_value`;
        expect(result[0].single_value).toEqual(["test_name"]);
      });

      test("name[] - multiple names", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['name1', 'name2', 'name3']::name[] as multiple_values`;
        expect(result[0].multiple_values).toEqual(["name1", "name2", "name3"]);
      });

      test("name[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['name1', NULL, 'name3', NULL]::name[] as array_with_nulls`;
        expect(result[0].array_with_nulls).toEqual(["name1", null, "name3", null]);
      });

      test("name[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::name[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("name[] - special characters in names", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['test_name', 'test.name', 'test-name']::name[] as special_chars`;
        expect(result[0].special_chars).toEqual(["test_name", "test.name", "test-name"]);
      });

      test("name[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['name1', 'name2', 'name3']::name[])[1] as first_element,
          (ARRAY['name1', 'name2', 'name3']::name[])[2] as second_element,
          (ARRAY['name1', 'name2', 'name3']::name[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("name1");
        expect(result[0].second_element).toBe("name2");
        expect(result[0].third_element).toBe("name3");
      });

      test("name[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['name1', 'name2', 'name3']::name[] @> ARRAY['name1']::name[] as contains_first,
          ARRAY['name1', 'name2', 'name3']::name[] @> ARRAY['name2']::name[] as contains_second,
          ARRAY['name1', 'name2', 'name3']::name[] @> ARRAY['name4']::name[] as contains_none,
          ARRAY['name1', 'name2', 'name3']::name[] @> ARRAY['name1', 'name2']::name[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("name[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['name1', 'name2']::name[] && ARRAY['name2', 'name3']::name[] as has_overlap,
          ARRAY['name1', 'name2']::name[] && ARRAY['name3', 'name4']::name[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("name[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['name1', 'name2']::name[] || ARRAY['name3', 'name4']::name[] as concatenated,
          ARRAY['name1']::name[] || ARRAY['name2']::name[] || ARRAY['name3']::name[] as triple_concat
      `;

        expect(result[0].concatenated).toEqual(["name1", "name2", "name3", "name4"]);
        expect(result[0].triple_concat).toEqual(["name1", "name2", "name3"]);
      });

      test("name[] - array unnesting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT unnest(ARRAY['name1', 'name2', 'name3']::name[]) as unnested
        ORDER BY unnested
      `;

        expect(result.map(r => r.unnested)).toEqual(["name1", "name2", "name3"]);
      });

      test("name[] - case sensitivity", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['Name1']::name[] = ARRAY['name1']::name[] as case_sensitive,
          ARRAY['name1']::name[] = ARRAY['name1']::name[] as same_case
      `;

        expect(result[0].case_sensitive).toBe(false);
        expect(result[0].same_case).toBe(true);
      });

      test("name[] - array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['name1', 'name2']::name[] = ARRAY['name1', 'name2']::name[] as equal_arrays,
          ARRAY['name1', 'name2']::name[] = ARRAY['name2', 'name1']::name[] as different_order,
          ARRAY['name1', 'name2']::name[] < ARRAY['name2', 'name2']::name[] as less_than,
          ARRAY['name2', 'name2']::name[] > ARRAY['name1', 'name2']::name[] as greater_than
      `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].different_order).toBe(false);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });

      test("name[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['name1', 'name2', 'name3']::name[], 1) as array_length,
          array_dims(ARRAY['name1', 'name2', 'name3']::name[]) as dimensions,
          array_upper(ARRAY['name1', 'name2', 'name3']::name[], 1) as upper_bound,
          array_lower(ARRAY['name1', 'name2', 'name3']::name[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("name[] - array aggregation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH names AS (
          SELECT unnest(ARRAY['name1', 'name2', 'name1', 'name3']::name[]) as name
        )
        SELECT array_agg(name ORDER BY name) as aggregated
        FROM names
      `;

        expect(result[0].aggregated).toEqual(["name1", "name1", "name2", "name3"]);
      });

      test("name[] - maximum name length", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const longName = "a".repeat(64); // Max identifier length in PostgreSQL is 63 bytes
        const result = await sql`
        SELECT ARRAY[${longName}]::name[] as long_name_array
      `;

        // PostgreSQL will truncate the name to 63 bytes
        expect(result[0].long_name_array[0].length).toBe(63);
      });

      test("name[] - identifiers with spaces", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY['My Table', 'Your View']::name[] as quoted_identifiers
      `;

        // In PostgreSQL, names with spaces are typically quoted
        expect(result[0].quoted_identifiers).toEqual(["My Table", "Your View"]);
      });
    });
    for (let bigint of [false, true]) {
      describe(`int8 Array Type ${bigint ? " (BigInt)" : ""}`, () => {
        test("int8[] - empty array", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`SELECT ARRAY[]::int8[] as empty_array`;
          if (bigint) {
            expect(result[0].empty_array).toEqual([]);
          } else {
            expect(result[0].empty_array).toEqual([]);
          }
        });

        test("int8[] - single value", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`SELECT ARRAY[1]::int8[] as single_value`;
          if (bigint) {
            expect(result[0].single_value).toEqual([BigInt(1)]);
          } else {
            expect(result[0].single_value).toEqual(["1"]);
          }
        });

        test("int8[] - multiple values", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`SELECT ARRAY[1, 2, 3]::int8[] as multiple_values`;
          if (bigint) {
            expect(result[0].multiple_values).toEqual([BigInt(1), BigInt(2), BigInt(3)]);
          } else {
            expect(result[0].multiple_values).toEqual(["1", "2", "3"]);
          }
        });

        test("int8[] - null values", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`SELECT ARRAY[1, NULL, 3, NULL]::int8[] as array_with_nulls`;
          if (bigint) {
            expect(result[0].array_with_nulls).toEqual([BigInt(1), null, BigInt(3), null]);
          } else {
            expect(result[0].array_with_nulls).toEqual(["1", null, "3", null]);
          }
        });

        test("int8[] - null array", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`SELECT NULL::int8[] as null_array`;
          expect(result[0].null_array).toBeNull();
        });

        test("int8[] - maximum values", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT ARRAY[
          9223372036854775807,       -- Maximum int8
          -9223372036854775808      -- Minimum int8
        ]::int8[] as extreme_values
      `;
          if (bigint) {
            expect(result[0].extreme_values).toEqual([BigInt("9223372036854775807"), BigInt("-9223372036854775808")]);
          } else {
            expect(result[0].extreme_values).toEqual(["9223372036854775807", "-9223372036854775808"]);
          }
        });

        test("int8[] - array element access", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT
          (ARRAY[1, 2, 3]::int8[])[1] as first_element,
          (ARRAY[1, 2, 3]::int8[])[2] as second_element,
          (ARRAY[1, 2, 3]::int8[])[3] as third_element
      `;
          if (bigint) {
            expect(result[0].first_element).toBe(BigInt(1));
            expect(result[0].second_element).toBe(BigInt(2));
            expect(result[0].third_element).toBe(BigInt(3));
          } else {
            expect(result[0].first_element).toBe("1");
            expect(result[0].second_element).toBe("2");
            expect(result[0].third_element).toBe("3");
          }
        });

        test("int8[] - array contains operator", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT
          ARRAY[1, 2, 3]::int8[] @> ARRAY[1]::int8[] as contains_first,
          ARRAY[1, 2, 3]::int8[] @> ARRAY[2]::int8[] as contains_second,
          ARRAY[1, 2, 3]::int8[] @> ARRAY[4]::int8[] as contains_none,
          ARRAY[1, 2, 3]::int8[] @> ARRAY[1, 2]::int8[] as contains_multiple
      `;

          expect(result[0].contains_first).toBe(true);
          expect(result[0].contains_second).toBe(true);
          expect(result[0].contains_none).toBe(false);
          expect(result[0].contains_multiple).toBe(true);
        });

        test("int8[] - array overlap operator", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT
          ARRAY[1, 2]::int8[] && ARRAY[2, 3]::int8[] as has_overlap,
          ARRAY[1, 2]::int8[] && ARRAY[3, 4]::int8[] as no_overlap
      `;
          expect(result[0].has_overlap).toBe(true);
          expect(result[0].no_overlap).toBe(false);
        });

        test("int8[] - array concatenation", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT
          ARRAY[1, 2]::int8[] || ARRAY[3, 4]::int8[] as concatenated,
          ARRAY[1]::int8[] || ARRAY[2]::int8[] || ARRAY[3]::int8[] as triple_concat
      `;
          if (bigint) {
            expect(result[0].concatenated).toEqual([BigInt(1), BigInt(2), BigInt(3), BigInt(4)]);
            expect(result[0].triple_concat).toEqual([BigInt(1), BigInt(2), BigInt(3)]);
          } else {
            expect(result[0].concatenated).toEqual(["1", "2", "3", "4"]);
            expect(result[0].triple_concat).toEqual(["1", "2", "3"]);
          }
        });

        test("int8[] - array unnesting", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT unnest(ARRAY[1, 2, 3]::int8[]) as unnested
        ORDER BY unnested
      `;
          if (bigint) {
            expect(result.map(r => r.unnested)).toEqual([BigInt(1), BigInt(2), BigInt(3)]);
          } else {
            expect(result.map(r => r.unnested)).toEqual(["1", "2", "3"]);
          }
        });

        test("int8[] - array arithmetic operations", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT
          (SELECT array_agg(val + 1) FROM unnest(ARRAY[1, 2, 3]::int8[]) as val) as addition,
          (SELECT array_agg(val * 2) FROM unnest(ARRAY[1, 2, 3]::int8[]) as val) as multiplication
      `;
          if (bigint) {
            expect(result[0].addition).toEqual([BigInt(2), BigInt(3), BigInt(4)]);
            expect(result[0].multiplication).toEqual([BigInt(2), BigInt(4), BigInt(6)]);
          } else {
            expect(result[0].addition).toEqual(["2", "3", "4"]);
            expect(result[0].multiplication).toEqual(["2", "4", "6"]);
          }
        });

        test("int8[] - array comparison", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT
          ARRAY[1, 2]::int8[] = ARRAY[1, 2]::int8[] as equal_arrays,
          ARRAY[1, 2]::int8[] = ARRAY[2, 1]::int8[] as different_order,
          ARRAY[1, 2]::int8[] < ARRAY[2, 2]::int8[] as less_than,
          ARRAY[2, 2]::int8[] > ARRAY[1, 2]::int8[] as greater_than
      `;
          if (bigint) {
            expect(result[0].equal_arrays).toBe(true);
            expect(result[0].different_order).toBe(false);
            expect(result[0].less_than).toBe(true);
            expect(result[0].greater_than).toBe(true);
          } else {
            expect(result[0].equal_arrays).toBe(true);
            expect(result[0].different_order).toBe(false);
            expect(result[0].less_than).toBe(true);
            expect(result[0].greater_than).toBe(true);
          }
        });

        test("int8[] - array dimensions", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT
          array_length(ARRAY[1, 2, 3]::int8[], 1)::int8 as array_length,
          array_dims(ARRAY[1, 2, 3]::int8[]) as dimensions,
          array_upper(ARRAY[1, 2, 3]::int8[], 1)::int8 as upper_bound,
          array_lower(ARRAY[1, 2, 3]::int8[], 1)::int8 as lower_bound
      `;
          if (bigint) {
            expect(result[0].array_length).toBe(3n);
            expect(result[0].dimensions).toBe("[1:3]");
            expect(result[0].upper_bound).toBe(3n);
            expect(result[0].lower_bound).toBe(1n);
          } else {
            expect(result[0].array_length).toBe("3");
            expect(result[0].dimensions).toBe("[1:3]");
            expect(result[0].upper_bound).toBe("3");
            expect(result[0].lower_bound).toBe("1");
          }
        });

        test("int8[] - array aggregation", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        WITH numbers AS (
          SELECT unnest(ARRAY[1, 2, 1, 3]::int8[]) as num
        )
        SELECT array_agg(num ORDER BY num) as aggregated
        FROM numbers
      `;
          if (bigint) {
            expect(result[0].aggregated).toEqual([BigInt(1), BigInt(1), BigInt(2), BigInt(3)]);
          } else {
            expect(result[0].aggregated).toEqual(["1", "1", "2", "3"]);
          }
        });

        test("int8[] - array mathematical functions", async () => {
          await using sql = postgres({ ...options, max: 1, bigint: bigint });
          const result = await sql`
        SELECT
          (SELECT sum(val) FROM unnest(ARRAY[1, 2, 3]::int8[]) as val)::int8 as total,
          (SELECT avg(val) FROM unnest(ARRAY[1, 2, 3]::int8[]) as val)::int8 as average,
          (SELECT min(val) FROM unnest(ARRAY[1, 2, 3]::int8[]) as val)::int8 as minimum,
          (SELECT max(val) FROM unnest(ARRAY[1, 2, 3]::int8[]) as val)::int8 as maximum
      `;

          if (bigint) {
            expect(result[0].total).toBe(BigInt(6));
            expect(Number(result[0].average)).toBe(2);
            expect(result[0].minimum).toBe(BigInt(1));
            expect(result[0].maximum).toBe(BigInt(3));
          } else {
            expect(result[0].total).toBe("6");
            expect(result[0].average).toBe("2");
            expect(result[0].minimum).toBe("1");
            expect(result[0].maximum).toBe("3");
          }
        });
      });
    }

    describe("int4[] Array Type", () => {
      test("int4[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::int4[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("int4[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1]::int4[] as single_value`;
        expect(result[0].single_value).toEqual([1]);
      });

      test("int4[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1, 2, 3]::int4[] as multiple_values`;
        expect(result[0].multiple_values).toEqual([1, 2, 3]);
      });

      test("int4[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1, NULL, 3, NULL]::int4[] as array_with_nulls`;
        expect(result[0].array_with_nulls).toEqual([1, null, 3, null]);
      });

      test("int4[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::int4[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("int4[] - maximum values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          2147483647,       -- Maximum int4
          -2147483648       -- Minimum int4
        ]::int4[] as extreme_values
      `;
        expect(result[0].extreme_values).toEqual([
          2147483647, // Maximum 32-bit integer
          -2147483648, // Minimum 32-bit integer
        ]);
      });

      test("int4[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY[1, 2, 3]::int4[])[1] as first_element,
          (ARRAY[1, 2, 3]::int4[])[2] as second_element,
          (ARRAY[1, 2, 3]::int4[])[3] as third_element
      `;

        expect(result[0].first_element).toBe(1);
        expect(result[0].second_element).toBe(2);
        expect(result[0].third_element).toBe(3);
      });

      test("int4[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2, 3]::int4[] @> ARRAY[1]::int4[] as contains_first,
          ARRAY[1, 2, 3]::int4[] @> ARRAY[2]::int4[] as contains_second,
          ARRAY[1, 2, 3]::int4[] @> ARRAY[4]::int4[] as contains_none,
          ARRAY[1, 2, 3]::int4[] @> ARRAY[1, 2]::int4[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("int4[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::int4[] && ARRAY[2, 3]::int4[] as has_overlap,
          ARRAY[1, 2]::int4[] && ARRAY[3, 4]::int4[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("int4[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::int4[] || ARRAY[3, 4]::int4[] as concatenated,
          ARRAY[1]::int4[] || ARRAY[2]::int4[] || ARRAY[3]::int4[] as triple_concat
      `;

        expect(result[0].concatenated).toEqual([1, 2, 3, 4]);
        expect(result[0].triple_concat).toEqual([1, 2, 3]);
      });

      test("int4[] - array unnesting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT unnest(ARRAY[1, 2, 3]::int4[]) as unnested
        ORDER BY unnested
      `;

        expect(result.map(r => r.unnested)).toEqual([1, 2, 3]);
      });

      test("int4[] - array arithmetic operations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (SELECT array_agg(val + 1) FROM unnest(ARRAY[1, 2, 3]::int4[]) as val) as addition,
          (SELECT array_agg(val * 2) FROM unnest(ARRAY[1, 2, 3]::int4[]) as val) as multiplication
      `;

        expect(result[0].addition).toEqual([2, 3, 4]);
        expect(result[0].multiplication).toEqual([2, 4, 6]);
      });

      test("int4[] - array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::int4[] = ARRAY[1, 2]::int4[] as equal_arrays,
          ARRAY[1, 2]::int4[] = ARRAY[2, 1]::int4[] as different_order,
          ARRAY[1, 2]::int4[] < ARRAY[2, 2]::int4[] as less_than,
          ARRAY[2, 2]::int4[] > ARRAY[1, 2]::int4[] as greater_than
      `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].different_order).toBe(false);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });

      test("int4[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY[1, 2, 3]::int4[], 1) as array_length,
          array_dims(ARRAY[1, 2, 3]::int4[]) as dimensions,
          array_upper(ARRAY[1, 2, 3]::int4[], 1) as upper_bound,
          array_lower(ARRAY[1, 2, 3]::int4[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("int4[] - array aggregation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH numbers AS (
          SELECT unnest(ARRAY[1, 2, 1, 3]::int4[]) as num
        )
        SELECT array_agg(num ORDER BY num) as aggregated
        FROM numbers
      `;

        expect(result[0].aggregated).toEqual([1, 1, 2, 3]);
      });

      test("int4[] - array mathematical functions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (SELECT sum(val) FROM unnest(ARRAY[1, 2, 3]::int4[]) as val)::int4 as total,
          (SELECT avg(val) FROM unnest(ARRAY[1, 2, 3]::int4[]) as val)::int4 as average,
          (SELECT min(val) FROM unnest(ARRAY[1, 2, 3]::int4[]) as val)::int4 as minimum,
          (SELECT max(val) FROM unnest(ARRAY[1, 2, 3]::int4[]) as val)::int4 as maximum
      `;

        expect(result[0].total).toBe(6);
        expect(result[0].average).toBe(2);
        expect(result[0].minimum).toBe(1);
        expect(result[0].maximum).toBe(3);
      });

      test("int4[] - array type casting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2, 3]::int8[] = ARRAY[1, 2, 3]::int4[]::int8[] as cast_to_int8,
          ARRAY[1, 2, 3]::float8[] = ARRAY[1, 2, 3]::int4[]::float8[] as cast_to_float8
      `;

        expect(result[0].cast_to_int8).toBe(true);
        expect(result[0].cast_to_float8).toBe(true);
      });

      test("int4[] - array with zero values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[0, 0, 0]::int4[] as zero_array,
          ARRAY[-0, 0, +0]::int4[] as signed_zeros
      `;

        expect(result[0].zero_array).toEqual([0, 0, 0]);
        expect(result[0].signed_zeros).toEqual([0, 0, 0]);
      });
    });

    describe("int2[] Array Type", () => {
      test("int2[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::int2[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("int2[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1]::int2[] as single_value`;
        expect(result[0].single_value).toEqual([1]);
      });

      test("int2[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1, 2, 3]::int2[] as multiple_values`;
        expect(result[0].multiple_values).toEqual([1, 2, 3]);
      });

      test("int2[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1, NULL, 3, NULL]::int2[] as array_with_nulls`;
        expect(result[0].array_with_nulls).toEqual([1, null, 3, null]);
      });

      test("int2[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::int2[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("int2[] - maximum values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          32767,        -- Maximum int2
          -32768        -- Minimum int2
        ]::int2[] as extreme_values
      `;
        expect(result[0].extreme_values).toEqual([
          32767, // Maximum 16-bit integer
          -32768, // Minimum 16-bit integer
        ]);
      });

      test("int2[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY[1, 2, 3]::int2[])[1] as first_element,
          (ARRAY[1, 2, 3]::int2[])[2] as second_element,
          (ARRAY[1, 2, 3]::int2[])[3] as third_element
      `;

        expect(result[0].first_element).toBe(1);
        expect(result[0].second_element).toBe(2);
        expect(result[0].third_element).toBe(3);
      });

      test("int2[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2, 3]::int2[] @> ARRAY[1]::int2[] as contains_first,
          ARRAY[1, 2, 3]::int2[] @> ARRAY[2]::int2[] as contains_second,
          ARRAY[1, 2, 3]::int2[] @> ARRAY[4]::int2[] as contains_none,
          ARRAY[1, 2, 3]::int2[] @> ARRAY[1, 2]::int2[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("int2[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::int2[] && ARRAY[2, 3]::int2[] as has_overlap,
          ARRAY[1, 2]::int2[] && ARRAY[3, 4]::int2[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("int2[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::int2[] || ARRAY[3, 4]::int2[] as concatenated,
          ARRAY[1]::int2[] || ARRAY[2]::int2[] || ARRAY[3]::int2[] as triple_concat
      `;

        expect(result[0].concatenated).toEqual([1, 2, 3, 4]);
        expect(result[0].triple_concat).toEqual([1, 2, 3]);
      });

      test("int2[] - array unnesting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT unnest(ARRAY[1, 2, 3]::int2[]) as unnested
        ORDER BY unnested
      `;

        expect(result.map(r => r.unnested)).toEqual([1, 2, 3]);
      });

      test("int2[] - array arithmetic operations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (SELECT array_agg(val + 1) FROM unnest(ARRAY[1, 2, 3]::int2[]) as val) as addition,
          (SELECT array_agg(val * 2) FROM unnest(ARRAY[1, 2, 3]::int2[]) as val) as multiplication
      `;

        expect(result[0].addition).toEqual([2, 3, 4]);
        expect(result[0].multiplication).toEqual([2, 4, 6]);
      });

      test("int2[] - array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::int2[] = ARRAY[1, 2]::int2[] as equal_arrays,
          ARRAY[1, 2]::int2[] = ARRAY[2, 1]::int2[] as different_order,
          ARRAY[1, 2]::int2[] < ARRAY[2, 2]::int2[] as less_than,
          ARRAY[2, 2]::int2[] > ARRAY[1, 2]::int2[] as greater_than
      `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].different_order).toBe(false);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });

      test("int2[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY[1, 2, 3]::int2[], 1) as array_length,
          array_dims(ARRAY[1, 2, 3]::int2[]) as dimensions,
          array_upper(ARRAY[1, 2, 3]::int2[], 1) as upper_bound,
          array_lower(ARRAY[1, 2, 3]::int2[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("int2[] - array aggregation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH numbers AS (
          SELECT unnest(ARRAY[-1, 1, 2, 1, 3]::int2[]) as num
        )
        SELECT array_agg(num ORDER BY num) as aggregated
        FROM numbers
      `;

        expect(result[0].aggregated).toEqual([-1, 1, 1, 2, 3]);
      });

      test("int2[] - array mathematical functions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (SELECT sum(val) FROM unnest(ARRAY[1, 2, 3]::int2[]) as val)::int2 as total,
          (SELECT avg(val) FROM unnest(ARRAY[1, 2, 3]::int2[]) as val)::int2 as average,
          (SELECT min(val) FROM unnest(ARRAY[1, 2, 3]::int2[]) as val)::int2 as minimum,
          (SELECT max(val) FROM unnest(ARRAY[1, 2, 3]::int2[]) as val)::int2 as maximum
      `;

        expect(result[0].total).toBe(6);
        expect(result[0].average).toBe(2);
        expect(result[0].minimum).toBe(1);
        expect(result[0].maximum).toBe(3);
      });

      test("int2[] - array type casting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2, 3]::int4[] = ARRAY[1, 2, 3]::int2[]::int4[] as cast_to_int4,
          ARRAY[1, 2, 3]::int8[] = ARRAY[1, 2, 3]::int2[]::int8[] as cast_to_int8,
          ARRAY[1, 2, 3]::float4[] = ARRAY[1, 2, 3]::int2[]::float4[] as cast_to_float4
      `;

        expect(result[0].cast_to_int4).toBe(true);
        expect(result[0].cast_to_int8).toBe(true);
        expect(result[0].cast_to_float4).toBe(true);
      });

      test("int2[] - overflow behavior", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const error1 = await sql`
        SELECT ARRAY[32768]::int2[] -- One more than maximum int2
      `.catch(e => e);
        expect(error1).toBeInstanceOf(SQL.SQLError);
        expect(error1).toBeInstanceOf(SQL.PostgresError);
        expect(error1.errno).toBe("22003"); //smallint out of range
        const error2 = await sql`
        SELECT ARRAY[-32769]::int2[] -- One less than minimum int2
      `.catch(e => e);
        expect(error2).toBeInstanceOf(SQL.SQLError);
        expect(error2).toBeInstanceOf(SQL.PostgresError);
        expect(error2.errno).toBe("22003"); //smallint out of range
      });
    });
    // old, deprecated not entire documented but we keep the same behavior as postgres.js
    describe("int2vector[] Array Type", () => {
      test("int2vector[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::int2vector[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("int2vector[] - single vector with one value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['1'::int2vector] as single_value_vector`;
        expect(result[0].single_value_vector[0]).toEqual("1");
      });

      test("int2vector[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['1 2'::int2vector, '3 4'::int2vector] @>
          ARRAY['1 2'::int2vector] as contains_first,

          ARRAY['1 2'::int2vector, '3 4'::int2vector] @>
          ARRAY['3 4'::int2vector] as contains_second,

          ARRAY['1 2'::int2vector, '3 4'::int2vector] @>
          ARRAY['5 6'::int2vector] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });
    });

    describe("text[] Array Type", () => {
      test("text[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::text[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("text[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['hello']::text[] as single_value`;
        expect(result[0].single_value).toEqual(["hello"]);
      });

      test("text[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['hello', 'world', 'test']::text[] as multiple_values`;
        expect(result[0].multiple_values).toEqual(["hello", "world", "test"]);
      });

      test("text[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['hello', NULL, 'world', NULL]::text[] as array_with_nulls`;
        expect(result[0].array_with_nulls).toEqual(["hello", null, "world", null]);
      });

      test("text[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::text[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("text[] - empty strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['', '', 'test']::text[] as array_with_empty`;
        expect(result[0].array_with_empty).toEqual(["", "", "test"]);
      });

      test("text[] - special characters", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'special\nline',
          'tab\there',
          'back\\slash',
          'quotes''here'
        ]::text[] as special_chars
      `;
        expect(result[0].special_chars).toEqual(["special\nline", "tab\there", "back\\slash", "quotes'here"]);
      });

      test("text[] - unicode characters", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '你好',
          'こんにちは',
          '안녕하세요',
          '👋 🌍'
        ]::text[] as unicode_chars
      `;
        expect(result[0].unicode_chars).toEqual(["你好", "こんにちは", "안녕하세요", "👋 🌍"]);
      });

      test("text[] - long strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const longString = "a".repeat(1000);
        const result = await sql`SELECT ARRAY[${longString}]::text[] as long_string_array`;
        expect(result[0].long_string_array[0].length).toBe(1000);
      });

      test("text[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['first', 'second', 'third']::text[])[1] as first_element,
          (ARRAY['first', 'second', 'third']::text[])[2] as second_element,
          (ARRAY['first', 'second', 'third']::text[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("first");
        expect(result[0].second_element).toBe("second");
        expect(result[0].third_element).toBe("third");
      });

      test("text[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['a', 'b', 'c']::text[] @> ARRAY['a']::text[] as contains_first,
          ARRAY['a', 'b', 'c']::text[] @> ARRAY['b']::text[] as contains_second,
          ARRAY['a', 'b', 'c']::text[] @> ARRAY['d']::text[] as contains_none,
          ARRAY['a', 'b', 'c']::text[] @> ARRAY['a', 'b']::text[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("text[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['a', 'b']::text[] && ARRAY['b', 'c']::text[] as has_overlap,
          ARRAY['a', 'b']::text[] && ARRAY['c', 'd']::text[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("text[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['a', 'b']::text[] || ARRAY['c', 'd']::text[] as concatenated,
          ARRAY['a']::text[] || ARRAY['b']::text[] || ARRAY['c']::text[] as triple_concat
      `;

        expect(result[0].concatenated).toEqual(["a", "b", "c", "d"]);
        expect(result[0].triple_concat).toEqual(["a", "b", "c"]);
      });

      test("text[] - case sensitivity", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['Test']::text[] = ARRAY['test']::text[] as case_sensitive,
          ARRAY['test']::text[] = ARRAY['test']::text[] as same_case
      `;

        expect(result[0].case_sensitive).toBe(false);
        expect(result[0].same_case).toBe(true);
      });

      test("text[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['a', 'b', 'c']::text[], 1) as array_length,
          array_dims(ARRAY['a', 'b', 'c']::text[]) as dimensions,
          array_upper(ARRAY['a', 'b', 'c']::text[], 1) as upper_bound,
          array_lower(ARRAY['a', 'b', 'c']::text[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("text[] - array string functions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (SELECT array_agg(upper(val)) FROM unnest(ARRAY['a', 'b', 'c']::text[]) as val) as uppercase,
          (SELECT array_agg(length(val)) FROM unnest(ARRAY['a', 'bb', 'ccc']::text[]) as val) as lengths
      `;

        expect(result[0].uppercase).toEqual(["A", "B", "C"]);
        expect(result[0].lengths).toEqual([1, 2, 3]);
      });

      test("text[] - array sorting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH texts AS (
          SELECT unnest(ARRAY['c', 'a', 'b', 'a']::text[]) as txt
        )
        SELECT array_agg(txt ORDER BY txt) as sorted
        FROM texts
      `;

        expect(result[0].sorted).toEqual(["a", "a", "b", "c"]);
      });

      test("text[] - array with json strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"key": "value"}',
          '{"array": [1, 2, 3]}'
        ]::text[] as json_strings
      `;

        expect(result[0].json_strings).toEqual(['{"key": "value"}', '{"array": [1, 2, 3]}']);
      });
      test("text[] - multiple word phrases", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'Hello World',
          'Good Morning',
          'PostgreSQL Database',
          'Multiple Words Here'
        ]::text[] as phrases
      `;
        expect(result[0].phrases).toEqual([
          "Hello World",
          "Good Morning",
          "PostgreSQL Database",
          "Multiple Words Here",
        ]);
      });

      test("text[] - single characters", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'a',
          'b',
          ' ',
          '.',
          '?',
          '1',
          '漢',
          'й'
        ]::text[] as single_chars
      `;
        expect(result[0].single_chars).toEqual(["a", "b", " ", ".", "?", "1", "漢", "й"]);
      });

      test("text[] - very large text values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          repeat('a', 10000),
          repeat('b', 50000),
          repeat('Hello World ', 1000)
        ]::text[] as large_texts
      `;

        expect(result[0].large_texts[0].length).toBe(10000);
        expect(result[0].large_texts[1].length).toBe(50000);
        expect(result[0].large_texts[2].length).toBe(12000); // 'Hello World ' is 12 chars
      });

      test("text[] - mixed length content", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'x',
          'Hello World',
          repeat('a', 1000),
          '漢',
          'Some More Words Here',
          '!'
        ]::text[] as mixed_content
      `;

        expect(result[0].mixed_content).toEqual([
          "x",
          "Hello World",
          "a".repeat(1000),
          "漢",
          "Some More Words Here",
          "!",
        ]);
      });

      test("text[] - spaces and whitespace handling", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '   leading spaces',
          'trailing spaces   ',
          '   both sides   ',
          'multiple   internal    spaces',
          E'tab\there',
          E'new\nline',
          ' '
        ]::text[] as whitespace_cases
      `;

        expect(result[0].whitespace_cases).toEqual([
          "   leading spaces",
          "trailing spaces   ",
          "   both sides   ",
          "multiple   internal    spaces",
          "tab\there",
          "new\nline",
          " ",
        ]);
      });

      test("text[] - mixed case phrases", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'Hello World',
          'HELLO WORLD',
          'hello world',
          'HeLLo WoRLD',
          'hELLO wORLD'
        ]::text[] as mixed_case_phrases
      `;

        expect(result[0].mixed_case_phrases).toEqual([
          "Hello World",
          "HELLO WORLD",
          "hello world",
          "HeLLo WoRLD",
          "hELLO wORLD",
        ]);
      });

      test("text[] - searching within text containing spaces", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH texts AS (
          SELECT unnest(ARRAY[
            'Hello World',
            'Hello Universe',
            'Goodbye World',
            'Hello There'
          ]::text[]) as phrase
        )
        SELECT
          array_agg(phrase ORDER BY phrase) FILTER (WHERE phrase LIKE 'Hello%') as hello_phrases,
          array_agg(phrase ORDER BY phrase) FILTER (WHERE phrase LIKE '%World') as world_phrases
        FROM texts
      `;

        expect(result[0].hello_phrases).toEqual(["Hello There", "Hello Universe", "Hello World"]);
        expect(result[0].world_phrases).toEqual(["Goodbye World", "Hello World"]);
      });

      test("text[] - comparison with spaces", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['Hello World']::text[] @> ARRAY['Hello World']::text[] as exact_match,
          ARRAY['Hello World']::text[] @> ARRAY['Hello']::text[] as partial_match,
          ARRAY['Hello', 'World']::text[] @> ARRAY['Hello World']::text[] as separate_words
      `;

        expect(result[0].exact_match).toBe(true);
        expect(result[0].partial_match).toBe(false);
        expect(result[0].separate_words).toBe(false);
      });

      test("text[] - concatenation with spaces", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['Hello', 'World']::text[] || ARRAY['Good Morning']::text[] as concatenated,
          string_agg(word, ' ') as joined
        FROM unnest(ARRAY['Hello', 'World']::text[]) as word
      `;

        expect(result[0].concatenated).toEqual(["Hello", "World", "Good Morning"]);
        expect(result[0].joined).toBe("Hello World");
      });

      test("text[] - unicode escape sequences", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          E'\\u0041',             -- A
          E'\\u0042',             -- B
          E'\\u00A9',             -- ©
          E'\\u00AE',             -- ®
          E'\\u2122',             -- ™
          E'\\u2764',             -- ❤
          E'\\u0024\\u0025',      -- $%
          E'\\u0048\\u0069'       -- Hi
        ]::text[] as unicode_escapes
      `;

        expect(result[0].unicode_escapes).toEqual(["A", "B", "©", "®", "™", "❤", "$%", "Hi"]);
      });

      test("text[] - hex escape sequences", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          E'\\x41',              -- A
          E'\\x42',              -- B
          E'\\x43',              -- C
          E'\\x414243',          -- A4243
          E'\\x48656C6C6F',      -- H656C6C6F
          E'\\x48\\x69'          -- Hi
        ]::text[] as hex_escapes
      `;

        expect(result[0].hex_escapes).toEqual(["A", "B", "C", "A4243", "H656C6C6F", "Hi"]);
      });

      test("text[] - mixed escape sequences", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          E'\\x41\\u0042\\x43',          -- ABC
          E'\\u0041\\x42\\u0043',        -- ABC
          E'\\x48\\u0069\\x21'           -- Hi!
        ]::text[] as mixed_escapes
      `;

        expect(result[0].mixed_escapes).toEqual(["ABC", "ABC", "Hi!"]);
      });

      test("text[] - special character escaping", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          E'\\b',                -- backspace
          E'\\f',                -- form feed
          E'\\n',                -- newline
          E'\\r',                -- carriage return
          E'\\t',                -- tab
          E'\\v',                -- vertical tab (not in postgres.js)
          E'\\\\',               -- backslash
          E'\"'                  -- quote
        ]::text[] as special_escapes
      `;
        // vertical tab will be just "v"
        expect(result[0].special_escapes).toEqual(["\b", "\f", "\n", "\r", "\t", "v", "\\", '"']);
      });

      test("text[] - octal escape sequences", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          E'\\101',              -- A (octal 101 = 65 decimal)
          E'\\102',              -- B (octal 102 = 66 decimal)
          E'\\103',              -- C (octal 103 = 67 decimal)
          E'\\077',              -- ? (octal 77 = 63 decimal)
          E'\\011'               -- tab (octal 11 = 9 decimal)
        ]::text[] as octal_escapes
      `;

        expect(result[0].octal_escapes).toEqual(["A", "B", "C", "?", "\t"]);
      });

      test("text[] - combined escapes in words", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          E'Hello\\nWorld',
          E'Tab\\tHere',
          E'Quote\\' here',
          E'\\x48\\x69\\u0021',          -- Hi!
          E'\\x48\\145\\u006C\\154\\157' -- Hello (mixed hex, octal, unicode)
        ]::text[] as combined_escapes
      `;

        expect(result[0].combined_escapes).toEqual(["Hello\nWorld", "Tab\tHere", "Quote' here", "Hi!", "Hello"]);
      });

      test("text[] - escape sequences with spaces", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          E'\\u0048\\u0069 \\u0057\\u006F\\u0072\\u006C\\u0064',  -- Hi World
          E'\\x48\\x69\\x20\\x57\\x6F\\x72\\x6C\\x64',            -- Hi World
          E'\\110\\151\\040\\127\\157\\162\\154\\144'             -- Hi World (octal)
        ]::text[] as escaped_phrases
      `;

        expect(result[0].escaped_phrases).toEqual(["Hi World", "Hi World", "Hi World"]);
      });

      test("text[] - nested escapes and quotes", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          E'Escaped \\"quote\\"',
          E'Double \\\\ backslash',
          E'Multiple \\\\\\\ backslashes',
          E'Quote in \\u0022string\\u0022',
          E'Mixed \\u0027\\x27\\047'      -- Three single quotes (unicode, hex, octal)
        ]::text[] as nested_escapes
      `;

        expect(result[0].nested_escapes).toEqual([
          'Escaped "quote"',
          "Double \\ backslash",
          "Multiple \\ backslashes", // this is the right behavior (same in postgres.js)
          'Quote in "string"',
          "Mixed '''",
        ]);
      });

      test("text[] - escape sequence error handling", async () => {
        await using sql = postgres({ ...options, max: 1 });

        // Invalid unicode escape
        const error3 = await sql`
        SELECT ARRAY[E'\\u123']::text[] as invalid_unicode
      `.catch(e => e);
        expect(error3).toBeInstanceOf(SQL.SQLError);
        expect(error3).toBeInstanceOf(SQL.PostgresError);
        expect(error3.errno).toBe("22025");
        // Invalid octal escape
        const error4 = await sql`
        SELECT ARRAY[E'\\400']::text[] as invalid_octal
      `.catch(e => e);
        expect(error4).toBeInstanceOf(SQL.SQLError);
        expect(error4).toBeInstanceOf(SQL.PostgresError);
        expect(error4.errno).toBe("22021");
        // Invalid hex escape
        expect(
          await sql`
        SELECT ARRAY[E'\\xGG']::text[] as invalid_hex`.then(result => result[0].invalid_hex),
        ).toEqual(["xGG"]);
      });
    });

    describe("oid[] Array type", () => {
      test("oid[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::oid[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("oid[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1]::oid[] as single_value`;
        expect(result[0].single_value).toEqual([1]);
      });

      test("oid[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1, 2, 3]::oid[] as multiple_values`;
        expect(result[0].multiple_values).toEqual([1, 2, 3]);
      });

      test("oid[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1, NULL, 3, NULL]::oid[] as array_with_nulls`;
        expect(result[0].array_with_nulls).toEqual([1, null, 3, null]);
      });

      test("oid[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::oid[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("oid[] - system OIDs", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'pg_type'::regclass::oid,
          'pg_class'::regclass::oid,
          'pg_attribute'::regclass::oid
        ]::oid[] as system_oids
      `;
        expect(result[0].system_oids).toEqual(
          expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]),
        );
      });

      test("oid[] - large OID values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          4294967295,  -- Maximum OID value (2^32 - 1)
          0,           -- Minimum OID value
          4294967294   -- Maximum OID value - 1
        ]::oid[] as extreme_values
      `;
        expect(result[0].extreme_values).toEqual([4294967295, 0, 4294967294]);
      });

      test("oid[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY[1, 2, 3]::oid[])[1] as first_element,
          (ARRAY[1, 2, 3]::oid[])[2] as second_element,
          (ARRAY[1, 2, 3]::oid[])[3] as third_element
      `;

        expect(result[0].first_element).toBe(1);
        expect(result[0].second_element).toBe(2);
        expect(result[0].third_element).toBe(3);
      });

      test("oid[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2, 3]::oid[] @> ARRAY[1]::oid[] as contains_first,
          ARRAY[1, 2, 3]::oid[] @> ARRAY[2]::oid[] as contains_second,
          ARRAY[1, 2, 3]::oid[] @> ARRAY[4]::oid[] as contains_none,
          ARRAY[1, 2, 3]::oid[] @> ARRAY[1, 2]::oid[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("oid[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::oid[] && ARRAY[2, 3]::oid[] as has_overlap,
          ARRAY[1, 2]::oid[] && ARRAY[3, 4]::oid[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("oid[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::oid[] || ARRAY[3, 4]::oid[] as concatenated,
          ARRAY[1]::oid[] || ARRAY[2]::oid[] || ARRAY[3]::oid[] as triple_concat
      `;

        expect(result[0].concatenated).toEqual([1, 2, 3, 4]);
        expect(result[0].triple_concat).toEqual([1, 2, 3]);
      });

      test("oid[] - array unnesting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT unnest(ARRAY[1, 2, 3]::oid[]) as unnested
        ORDER BY unnested
      `;

        expect(result.map(r => r.unnested)).toEqual([1, 2, 3]);
      });

      test("oid[] - array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2]::oid[] = ARRAY[1, 2]::oid[] as equal_arrays,
          ARRAY[1, 2]::oid[] = ARRAY[2, 1]::oid[] as different_order,
          ARRAY[1, 2]::oid[] < ARRAY[2, 2]::oid[] as less_than,
          ARRAY[2, 2]::oid[] > ARRAY[1, 2]::oid[] as greater_than
      `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].different_order).toBe(false);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });

      test("oid[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY[1, 2, 3]::oid[], 1) as array_length,
          array_dims(ARRAY[1, 2, 3]::oid[]) as dimensions,
          array_upper(ARRAY[1, 2, 3]::oid[], 1) as upper_bound,
          array_lower(ARRAY[1, 2, 3]::oid[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("oid[] - type casting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1, 2, 3]::int4[] = ARRAY[1, 2, 3]::oid[]::int4[] as cast_to_int4,
          ARRAY[1, 2, 3]::int8[] = ARRAY[1, 2, 3]::oid[]::int8[] as cast_to_int8
      `;

        expect(result[0].cast_to_int4).toBe(true);
        expect(result[0].cast_to_int8).toBe(true);
      });

      test("oid[] - regclass to oid conversion", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          oid,
          relowner::oid,
          relnamespace::oid
        ]::oid[] as class_oids
        FROM pg_class
        WHERE relname = 'pg_class'
      `;

        expect(result[0].class_oids).toEqual(
          expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]),
        );
      });
    });

    describe("tid[] Array type", () => {
      test("tid[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::tid[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("tid[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['(0,1)']::tid[] as single_value`;
        expect(result[0].single_value).toEqual(["(0,1)"]);
      });

      test("tid[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY['(0,1)', '(0,2)', '(1,1)']::tid[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["(0,1)", "(0,2)", "(1,1)"]);
      });

      test("tid[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY['(0,1)', NULL, '(0,2)', NULL]::tid[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["(0,1)", null, "(0,2)", null]);
      });

      test("tid[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::tid[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("tid[] - boundary values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '(0,0)',              -- Minimum possible values
          '(0,1)',              -- First tuple in block 0
          '(4294967295,65535)'  -- Maximum possible values (2^32-1, 2^16-1)
        ]::tid[] as boundary_values
      `;
        expect(result[0].boundary_values).toEqual(["(0,0)", "(0,1)", "(4294967295,65535)"]);
      });

      test("tid[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[])[1] as first_element,
          (ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[])[2] as second_element,
          (ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("(0,1)");
        expect(result[0].second_element).toBe("(0,2)");
        expect(result[0].third_element).toBe("(0,3)");
      });

      test("tid[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[] @> ARRAY['(0,1)']::tid[] as contains_first,
          ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[] @> ARRAY['(0,2)']::tid[] as contains_second,
          ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[] @> ARRAY['(0,4)']::tid[] as contains_none,
          ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[] @> ARRAY['(0,1)', '(0,2)']::tid[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("tid[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['(0,1)', '(0,2)']::tid[] && ARRAY['(0,2)', '(0,3)']::tid[] as has_overlap,
          ARRAY['(0,1)', '(0,2)']::tid[] && ARRAY['(0,3)', '(0,4)']::tid[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("tid[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['(0,1)', '(0,2)']::tid[] || ARRAY['(0,3)', '(0,4)']::tid[] as concatenated,
          ARRAY['(0,1)']::tid[] || ARRAY['(0,2)']::tid[] || ARRAY['(0,3)']::tid[] as triple_concat
      `;

        expect(result[0].concatenated).toEqual(["(0,1)", "(0,2)", "(0,3)", "(0,4)"]);
        expect(result[0].triple_concat).toEqual(["(0,1)", "(0,2)", "(0,3)"]);
      });

      test("tid[] - array unnesting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT unnest(ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[]) as unnested
        ORDER BY unnested
      `;

        expect(result.map(r => r.unnested)).toEqual(["(0,1)", "(0,2)", "(0,3)"]);
      });

      test("tid[] - array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['(0,1)', '(0,2)']::tid[] = ARRAY['(0,1)', '(0,2)']::tid[] as equal_arrays,
          ARRAY['(0,1)', '(0,2)']::tid[] = ARRAY['(0,2)', '(0,1)']::tid[] as different_order,
          ARRAY['(0,1)', '(0,2)']::tid[] < ARRAY['(0,2)', '(0,2)']::tid[] as less_than,
          ARRAY['(0,2)', '(0,2)']::tid[] > ARRAY['(0,1)', '(0,2)']::tid[] as greater_than
      `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].different_order).toBe(false);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });

      test("tid[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[], 1) as array_length,
          array_dims(ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[]) as dimensions,
          array_upper(ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[], 1) as upper_bound,
          array_lower(ARRAY['(0,1)', '(0,2)', '(0,3)']::tid[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("tid[] - comparing tids from actual tuples", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH test_table AS (
          SELECT '(1,2)'::tid as ctid, 'test' as col FROM (VALUES (1), (2), (3)) v(x)
        )
        SELECT array_agg(ctid) as tid_array
        FROM test_table
      `;

        expect(result[0].tid_array).toEqual(expect.arrayContaining([expect.stringMatching(/^\(\d+,\d+\)$/)]));
      });

      test("tid[] - sorting", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH unsorted_tids AS (
          SELECT unnest(ARRAY['(1,1)', '(0,1)', '(0,2)', '(1,0)']::tid[]) as tid
        )
        SELECT array_agg(tid ORDER BY tid) as sorted_tids
        FROM unsorted_tids
      `;

        expect(result[0].sorted_tids).toEqual(["(0,1)", "(0,2)", "(1,0)", "(1,1)"]);
      });
    });

    describe("xid[] Array type", () => {
      test("xid[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::xid[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("xid[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['1'::xid]::xid[] as single_value`;
        expect(result[0].single_value).toEqual([1]);
      });

      test("xid[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[] as multiple_values`;
        expect(result[0].multiple_values).toEqual([1, 2, 3]);
      });

      test("xid[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['1'::xid, NULL, '3'::xid, NULL]::xid[] as array_with_nulls`;
        expect(result[0].array_with_nulls).toEqual([1, null, 3, null]);
      });

      test("xid[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::xid[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("xid[] - boundary values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '0'::xid,                -- Minimum XID
          '1'::xid,                -- First valid XID
          '2147483647'::xid,       -- Maximum XID (2^31 - 1)
          '4294967295'::xid       -- Wrapping point
        ]::xid[] as boundary_values
      `;
        expect(result[0].boundary_values).toEqual([0, 1, 2147483647, 4294967295]);
      });

      test("xid[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[])[1] as first_element,
          (ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[])[2] as second_element,
          (ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[])[3] as third_element
      `;

        expect(result[0].first_element).toBe(1);
        expect(result[0].second_element).toBe(2);
        expect(result[0].third_element).toBe(3);
      });

      test("xid[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[] @> ARRAY['1'::xid]::xid[] as contains_first,
          ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[] @> ARRAY['2'::xid]::xid[] as contains_second,
          ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[] @> ARRAY['4'::xid]::xid[] as contains_none,
          ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[] @> ARRAY['1'::xid, '2'::xid]::xid[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("xid[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['1'::xid, '2'::xid]::xid[] && ARRAY['2'::xid, '3'::xid]::xid[] as has_overlap,
          ARRAY['1'::xid, '2'::xid]::xid[] && ARRAY['3'::xid, '4'::xid]::xid[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("xid[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['1'::xid, '2'::xid]::xid[] || ARRAY['3'::xid, '4'::xid]::xid[] as concatenated,
          ARRAY['1'::xid]::xid[] || ARRAY['2'::xid]::xid[] || ARRAY['3'::xid]::xid[] as triple_concat
      `;

        expect(result[0].concatenated).toEqual([1, 2, 3, 4]);
        expect(result[0].triple_concat).toEqual([1, 2, 3]);
      });

      test("xid[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[], 1) as array_length,
          array_dims(ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[]) as dimensions,
          array_upper(ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[], 1) as upper_bound,
          array_lower(ARRAY['1'::xid, '2'::xid, '3'::xid]::xid[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("xid[] - transaction related operations", async () => {
        await using sql = postgres({ ...options, max: 1, bigint: true });
        // txid is a BigInt
        const result = await sql`
        SELECT ARRAY[
          txid_current()
        ] as transaction_xids
      `;

        expect(result[0].transaction_xids).toEqual(expect.arrayContaining([expect.any(BigInt)]));
      });

      test("xid[] - xid wrapping behavior", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '4294967295'::xid,      -- Maximum uint32
          '0'::xid,               -- Wraps to 0
          '1'::xid                -- First after wrap
        ]::xid[] as wrap_sequence
      `;

        expect(result[0].wrap_sequence).toEqual([4294967295, 0, 1]);
      });
    });

    describe("cid[] Array type", () => {
      test("cid[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::cid[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("cid[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['0'::cid]::cid[] as single_value`;
        expect(result[0].single_value).toEqual([0]);
      });

      test("cid[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[] as multiple_values`;
        expect(result[0].multiple_values).toEqual([0, 1, 2]);
      });

      test("cid[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['0'::cid, NULL, '2'::cid, NULL]::cid[] as array_with_nulls`;
        expect(result[0].array_with_nulls).toEqual([0, null, 2, null]);
      });

      test("cid[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::cid[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("cid[] - boundary values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '0'::cid,                -- First command in transaction
          '1'::cid,                -- Second command
          '4294967295'::cid        -- Maximum possible CID (2^32 - 1)
        ]::cid[] as boundary_values
      `;
        expect(result[0].boundary_values).toEqual([0, 1, 4294967295]);
      });

      test("cid[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[])[1] as first_element,
          (ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[])[2] as second_element,
          (ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[])[3] as third_element
      `;

        expect(result[0].first_element).toBe(0);
        expect(result[0].second_element).toBe(1);
        expect(result[0].third_element).toBe(2);
      });

      test("cid[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[] @> ARRAY['0'::cid]::cid[] as contains_first,
          ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[] @> ARRAY['1'::cid]::cid[] as contains_second,
          ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[] @> ARRAY['3'::cid]::cid[] as contains_none,
          ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[] @> ARRAY['0'::cid, '1'::cid]::cid[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("cid[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['0'::cid, '1'::cid]::cid[] && ARRAY['1'::cid, '2'::cid]::cid[] as has_overlap,
          ARRAY['0'::cid, '1'::cid]::cid[] && ARRAY['2'::cid, '3'::cid]::cid[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("cid[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['0'::cid, '1'::cid]::cid[] || ARRAY['2'::cid, '3'::cid]::cid[] as concatenated,
          ARRAY['0'::cid]::cid[] || ARRAY['1'::cid]::cid[] || ARRAY['2'::cid]::cid[] as triple_concat
      `;

        expect(result[0].concatenated).toEqual([0, 1, 2, 3]);
        expect(result[0].triple_concat).toEqual([0, 1, 2]);
      });

      test("cid[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[], 1) as array_length,
          array_dims(ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[]) as dimensions,
          array_upper(ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[], 1) as upper_bound,
          array_lower(ARRAY['0'::cid, '1'::cid, '2'::cid]::cid[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("json[] Array type", () => {
      test("json[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::json[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("json[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['{"key": "value"}']::json[] as single_value`;
        expect(result[0].single_value).toEqual([{ "key": "value" }]);
      });

      test("json[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"a": 1}',
          '{"b": 2}',
          '{"c": 3}'
        ]::json[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual([{ "a": 1 }, { "b": 2 }, { "c": 3 }]);
      });

      test("json[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"a": 1}',
          NULL,
          '{"c": 3}',
          NULL
        ]::json[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual([{ "a": 1 }, null, { "c": 3 }, null]);
      });

      test("json[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::json[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("json[] - array with different JSON types", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'null'::json,
          'true'::json,
          'false'::json,
          '123'::json,
          '3.14'::json,
          '"string"'::json,
          '[]'::json,
          '{}'::json,
          '[1,2,3]'::json,
          '{"a":1,"b":2}'::json,
          '[{"a":1,"b":2},{"c":3,"d":4}]'::json,
          '[{"a":1,"b":2},{"c":3,"d":4}]'::json
        ]::json[] as json_types
      `;
        expect(result[0].json_types).toEqual([
          null,
          true,
          false,
          123,
          3.14,
          "string",
          [],
          {},
          [1, 2, 3],
          { a: 1, b: 2 },
          [
            { a: 1, b: 2 },
            { c: 3, d: 4 },
          ],
          [
            { a: 1, b: 2 },
            { c: 3, d: 4 },
          ],
        ]);
      });

      test("json[] - nested JSON objects", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"outer": {"inner": "value"}}'::json,
          '{"array": [1, 2, {"key": "value"}]}'::json
        ]::json[] as nested_json
      `;
        expect(result[0].nested_json).toEqual([
          { "outer": { "inner": "value" } },
          { "array": [1, 2, { "key": "value" }] },
        ]);
      });

      test("json[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['{"a": 1}', '{"b": 2}', '{"c": 3}']::json[])[1] as first_element,
          (ARRAY['{"a": 1}', '{"b": 2}', '{"c": 3}']::json[])[2] as second_element,
          (ARRAY['{"a": 1}', '{"b": 2}', '{"c": 3}']::json[])[3] as third_element
      `;

        expect(result[0].first_element).toEqual({ "a": 1 });
        expect(result[0].second_element).toEqual({ "b": 2 });
        expect(result[0].third_element).toEqual({ "c": 3 });
      });

      test("json[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['{"a": 1}', '{"b": 2}']::json[] ||
          ARRAY['{"c": 3}', '{"d": 4}']::json[] as concatenated
      `;

        expect(result[0].concatenated).toEqual([{ "a": 1 }, { "b": 2 }, { "c": 3 }, { "d": 4 }]);
      });

      test("json[] - special characters in JSON", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"special\\nline": "value"}',
          '{"quo\\"te": "value"}',
          '{"unicode\\u0041": "A"}'
        ]::json[] as special_chars
      `;

        expect(result[0].special_chars).toEqual([
          { "special\nline": "value" },
          { 'quo"te': "value" },
          { "unicodeA": "A" },
        ]);
      });

      test("json[] - large JSON objects", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const largeObj = {
          id: 1,
          data: Array(100)
            .fill(0)
            .map((_, i) => ({ key: `key${i}`, value: `value${i}` })),
        };

        const result = await sql`
        SELECT ARRAY[${largeObj}::json]::json[] as large_json
      `;

        expect(result[0].large_json).toEqual([largeObj]);
      });

      test("json[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['{"a": 1}', '{"b": 2}', '{"c": 3}']::json[], 1) as array_length,
          array_dims(ARRAY['{"a": 1}', '{"b": 2}', '{"c": 3}']::json[]) as dimensions,
          array_upper(ARRAY['{"a": 1}', '{"b": 2}', '{"c": 3}']::json[], 1) as upper_bound,
          array_lower(ARRAY['{"a": 1}', '{"b": 2}', '{"c": 3}']::json[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("xml[] Array type", () => {
      test("xml[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::xml[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("xml[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['<root>value</root>']::xml[] as single_value`;
        expect(result[0].single_value).toEqual(["<root>value</root>"]);
      });

      test("xml[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<a>1</a>',
          '<b>2</b>',
          '<c>3</c>'
        ]::xml[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["<a>1</a>", "<b>2</b>", "<c>3</c>"]);
      });

      test("xml[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<a>1</a>',
          NULL,
          '<c>3</c>',
          NULL
        ]::xml[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["<a>1</a>", null, "<c>3</c>", null]);
      });

      test("xml[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::xml[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("xml[] - array with XML attributes", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<element id="1" class="test">content</element>',
          '<tag attr="value" data-test="true">text</tag>'
        ]::xml[] as xml_with_attributes
      `;
        expect(result[0].xml_with_attributes).toEqual([
          '<element id="1" class="test">content</element>',
          '<tag attr="value" data-test="true">text</tag>',
        ]);
      });

      test("xml[] - nested XML elements", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<outer><inner>value</inner></outer>',
          '<parent><child><grandchild>text</grandchild></child></parent>'
        ]::xml[] as nested_xml
      `;
        expect(result[0].nested_xml).toEqual([
          "<outer><inner>value</inner></outer>",
          "<parent><child><grandchild>text</grandchild></child></parent>",
        ]);
      });

      test("xml[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['<a>1</a>', '<b>2</b>', '<c>3</c>']::xml[])[1] as first_element,
          (ARRAY['<a>1</a>', '<b>2</b>', '<c>3</c>']::xml[])[2] as second_element,
          (ARRAY['<a>1</a>', '<b>2</b>', '<c>3</c>']::xml[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("<a>1</a>");
        expect(result[0].second_element).toBe("<b>2</b>");
        expect(result[0].third_element).toBe("<c>3</c>");
      });

      test("xml[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['<a>1</a>', '<b>2</b>']::xml[] ||
          ARRAY['<c>3</c>', '<d>4</d>']::xml[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["<a>1</a>", "<b>2</b>", "<c>3</c>", "<d>4</d>"]);
      });

      test("xml[] - special characters and CDATA", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<elem><![CDATA[Special & chars < > "" '' here]]></elem>',
          '<data value="&quot;quoted&quot;">&amp; ampersand</data>'
        ]::xml[] as special_chars
      `;

        expect(result[0].special_chars).toEqual([
          '<elem><![CDATA[Special & chars < > "" \' here]]></elem>',
          '<data value="&quot;quoted&quot;">&amp; ampersand</data>',
        ]);
      });

      test("xml[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['<a>1</a>', '<b>2</b>', '<c>3</c>']::xml[], 1) as array_length,
          array_dims(ARRAY['<a>1</a>', '<b>2</b>', '<c>3</c>']::xml[]) as dimensions,
          array_upper(ARRAY['<a>1</a>', '<b>2</b>', '<c>3</c>']::xml[], 1) as upper_bound,
          array_lower(ARRAY['<a>1</a>', '<b>2</b>', '<c>3</c>']::xml[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("xml[] - XML declaration and processing instructions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<?xml version="1.0" encoding="UTF-8"?><root>content</root>',
          '<?xml-stylesheet type="text/xsl" href="style.xsl"?><data>styled</data>'
        ]::xml[] as xml_processing
      `;

        expect(result[0].xml_processing).toEqual([
          "<root>content</root>",
          '<?xml-stylesheet type="text/xsl" href="style.xsl"?><data>styled</data>',
        ]);
      });
    });

    describe("point[] Array type", () => {
      test("point[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::point[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("point[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['(1,2)']::point[] as single_value`;
        expect(result[0].single_value).toEqual(["(1,2)"]);
      });

      test("point[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '(1,2)',
          '(3,4)',
          '(5,6)'
        ]::point[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["(1,2)", "(3,4)", "(5,6)"]);
      });

      test("point[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '(1,2)',
          NULL,
          '(5,6)',
          NULL
        ]::point[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["(1,2)", null, "(5,6)", null]);
      });

      test("point[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::point[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("point[] - decimal coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '(1.5,2.7)',
          '(3.14,4.89)',
          '(-1.2,5.6)'
        ]::point[] as decimal_points
      `;
        expect(result[0].decimal_points).toEqual(["(1.5,2.7)", "(3.14,4.89)", "(-1.2,5.6)"]);
      });

      test("point[] - negative coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '(-1,-2)',
          '(-3.5,-4.2)',
          '(-5,-6)'
        ]::point[] as negative_points
      `;
        expect(result[0].negative_points).toEqual(["(-1,-2)", "(-3.5,-4.2)", "(-5,-6)"]);
      });

      test("point[] - zero coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '(0,0)',
          '(0,1)',
          '(1,0)'
        ]::point[] as zero_points
      `;
        expect(result[0].zero_points).toEqual(["(0,0)", "(0,1)", "(1,0)"]);
      });

      test("point[] - large coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '(1000000,2000000)',
          '(-1000000,-2000000)',
          '(999999.999,888888.888)'
        ]::point[] as large_points
      `;
        expect(result[0].large_points).toEqual(["(1000000,2000000)", "(-1000000,-2000000)", "(999999.999,888888.888)"]);
      });

      test("point[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['(1,2)', '(3,4)', '(5,6)']::point[])[1] as first_element,
          (ARRAY['(1,2)', '(3,4)', '(5,6)']::point[])[2] as second_element,
          (ARRAY['(1,2)', '(3,4)', '(5,6)']::point[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("(1,2)");
        expect(result[0].second_element).toBe("(3,4)");
        expect(result[0].third_element).toBe("(5,6)");
      });

      test("point[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['(1,2)', '(3,4)']::point[] || ARRAY['(5,6)', '(7,8)']::point[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["(1,2)", "(3,4)", "(5,6)", "(7,8)"]);
      });

      test("point[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['(1,2)', '(3,4)', '(5,6)']::point[], 1) as array_length,
          array_dims(ARRAY['(1,2)', '(3,4)', '(5,6)']::point[]) as dimensions,
          array_upper(ARRAY['(1,2)', '(3,4)', '(5,6)']::point[], 1) as upper_bound,
          array_lower(ARRAY['(1,2)', '(3,4)', '(5,6)']::point[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("lseg[] Array type", () => {
      test("lseg[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::lseg[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("lseg[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['[(1,2),(3,4)]']::lseg[] as single_value`;
        expect(result[0].single_value).toEqual(["[(1,2),(3,4)]"]);
      });

      test("lseg[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(1,2),(3,4)]',
          '[(5,6),(7,8)]',
          '[(9,10),(11,12)]'
        ]::lseg[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["[(1,2),(3,4)]", "[(5,6),(7,8)]", "[(9,10),(11,12)]"]);
      });

      test("lseg[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(1,2),(3,4)]',
          NULL,
          '[(5,6),(7,8)]',
          NULL
        ]::lseg[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["[(1,2),(3,4)]", null, "[(5,6),(7,8)]", null]);
      });

      test("lseg[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::lseg[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("lseg[] - decimal coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(1.5,2.7),(3.14,4.89)]',
          '[(0.1,0.2),(0.3,0.4)]',
          '[(-1.2,5.6),(7.8,-9.0)]'
        ]::lseg[] as decimal_segments
      `;
        expect(result[0].decimal_segments).toEqual([
          "[(1.5,2.7),(3.14,4.89)]",
          "[(0.1,0.2),(0.3,0.4)]",
          "[(-1.2,5.6),(7.8,-9)]",
        ]);
      });

      test("lseg[] - negative coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(-1,-2),(-3,-4)]',
          '[(-5,-6),(-7,-8)]',
          '[(-9,-10),(-11,-12)]'
        ]::lseg[] as negative_segments
      `;
        expect(result[0].negative_segments).toEqual(["[(-1,-2),(-3,-4)]", "[(-5,-6),(-7,-8)]", "[(-9,-10),(-11,-12)]"]);
      });

      test("lseg[] - zero length segments", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(0,0),(0,0)]',
          '[(1,1),(1,1)]',
          '[(2,2),(2,2)]'
        ]::lseg[] as zero_segments
      `;
        expect(result[0].zero_segments).toEqual(["[(0,0),(0,0)]", "[(1,1),(1,1)]", "[(2,2),(2,2)]"]);
      });

      test("lseg[] - horizontal and vertical segments", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(0,0),(5,0)]',    -- horizontal
          '[(0,0),(0,5)]',    -- vertical
          '[(1,1),(1,6)]'     -- vertical offset
        ]::lseg[] as axis_segments
      `;
        expect(result[0].axis_segments).toEqual(["[(0,0),(5,0)]", "[(0,0),(0,5)]", "[(1,1),(1,6)]"]);
      });

      test("lseg[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['[(1,2),(3,4)]', '[(5,6),(7,8)]', '[(9,10),(11,12)]']::lseg[])[1] as first_element,
          (ARRAY['[(1,2),(3,4)]', '[(5,6),(7,8)]', '[(9,10),(11,12)]']::lseg[])[2] as second_element,
          (ARRAY['[(1,2),(3,4)]', '[(5,6),(7,8)]', '[(9,10),(11,12)]']::lseg[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("[(1,2),(3,4)]");
        expect(result[0].second_element).toBe("[(5,6),(7,8)]");
        expect(result[0].third_element).toBe("[(9,10),(11,12)]");
      });

      test("lseg[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['[(1,2),(3,4)]', '[(5,6),(7,8)]']::lseg[] ||
          ARRAY['[(9,10),(11,12)]', '[(13,14),(15,16)]']::lseg[] as concatenated
      `;

        expect(result[0].concatenated).toEqual([
          "[(1,2),(3,4)]",
          "[(5,6),(7,8)]",
          "[(9,10),(11,12)]",
          "[(13,14),(15,16)]",
        ]);
      });
      test("lseg[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['[(1,2),(3,4)]', '[(5,6),(7,8)]', '[(9,10),(11,12)]']::lseg[], 1) as array_length,
          array_dims(ARRAY['[(1,2),(3,4)]', '[(5,6),(7,8)]', '[(9,10),(11,12)]']::lseg[]) as dimensions,
          array_upper(ARRAY['[(1,2),(3,4)]', '[(5,6),(7,8)]', '[(9,10),(11,12)]']::lseg[], 1) as upper_bound,
          array_lower(ARRAY['[(1,2),(3,4)]', '[(5,6),(7,8)]', '[(9,10),(11,12)]']::lseg[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("path[] Array type", () => {
      test("path[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::path[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("path[] - single open path", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['[(1,2),(3,4),(5,6)]']::path[] as single_open_path`;
        expect(result[0].single_open_path).toEqual(["[(1,2),(3,4),(5,6)]"]);
      });

      test("path[] - single closed path", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['((1,2),(3,4),(5,6))']::path[] as single_closed_path`;
        expect(result[0].single_closed_path).toEqual(["((1,2),(3,4),(5,6))"]);
      });

      test("path[] - multiple mixed paths", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(1,2),(3,4),(5,6)]',
          '((7,8),(9,10),(11,12))',
          '[(13,14),(15,16),(17,18)]'
        ]::path[] as mixed_paths
      `;
        expect(result[0].mixed_paths).toEqual([
          "[(1,2),(3,4),(5,6)]",
          "((7,8),(9,10),(11,12))",
          "[(13,14),(15,16),(17,18)]",
        ]);
      });

      test("path[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(1,2),(3,4)]',
          NULL,
          '((5,6),(7,8))',
          NULL
        ]::path[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["[(1,2),(3,4)]", null, "((5,6),(7,8))", null]);
      });

      test("path[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::path[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("path[] - decimal coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(1.5,2.7),(3.14,4.89),(5.5,6.6)]',
          '((0.1,0.2),(0.3,0.4),(0.5,0.6))'
        ]::path[] as decimal_paths
      `;
        expect(result[0].decimal_paths).toEqual([
          "[(1.5,2.7),(3.14,4.89),(5.5,6.6)]",
          "((0.1,0.2),(0.3,0.4),(0.5,0.6))",
        ]);
      });

      test("path[] - negative coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(-1,-2),(-3,-4),(-5,-6)]',
          '((-7,-8),(-9,-10),(-11,-12))'
        ]::path[] as negative_paths
      `;
        expect(result[0].negative_paths).toEqual(["[(-1,-2),(-3,-4),(-5,-6)]", "((-7,-8),(-9,-10),(-11,-12))"]);
      });

      test("path[] - minimum points (2)", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(0,0),(1,1)]',
          '((2,2),(3,3))'
        ]::path[] as minimum_paths
      `;
        expect(result[0].minimum_paths).toEqual(["[(0,0),(1,1)]", "((2,2),(3,3))"]);
      });

      test("path[] - complex paths", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '[(0,0),(1,1),(2,0),(1,-1),(0,0)]',          -- pentagon
          '((0,0),(2,2),(4,0),(4,-2),(0,-2),(0,0))'    -- hexagon
        ]::path[] as complex_paths
      `;
        expect(result[0].complex_paths).toEqual([
          "[(0,0),(1,1),(2,0),(1,-1),(0,0)]",
          "((0,0),(2,2),(4,0),(4,-2),(0,-2),(0,0))",
        ]);
      });

      test("path[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['[(1,2),(3,4)]', '((5,6),(7,8))', '[(9,10),(11,12)]']::path[])[1] as first_element,
          (ARRAY['[(1,2),(3,4)]', '((5,6),(7,8))', '[(9,10),(11,12)]']::path[])[2] as second_element,
          (ARRAY['[(1,2),(3,4)]', '((5,6),(7,8))', '[(9,10),(11,12)]']::path[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("[(1,2),(3,4)]");
        expect(result[0].second_element).toBe("((5,6),(7,8))");
        expect(result[0].third_element).toBe("[(9,10),(11,12)]");
      });

      test("path[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['[(1,2),(3,4)]', '((5,6),(7,8))']::path[] ||
          ARRAY['[(9,10),(11,12)]']::path[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["[(1,2),(3,4)]", "((5,6),(7,8))", "[(9,10),(11,12)]"]);
      });

      test("path[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['[(1,2),(3,4)]', '((5,6),(7,8))', '[(9,10),(11,12)]']::path[], 1) as array_length,
          array_dims(ARRAY['[(1,2),(3,4)]', '((5,6),(7,8))', '[(9,10),(11,12)]']::path[]) as dimensions,
          array_upper(ARRAY['[(1,2),(3,4)]', '((5,6),(7,8))', '[(9,10),(11,12)]']::path[], 1) as upper_bound,
          array_lower(ARRAY['[(1,2),(3,4)]', '((5,6),(7,8))', '[(9,10),(11,12)]']::path[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });
    });
    describe("box[] Array type", () => {
      test("box[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::box[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("box[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['((0,0),(1,1))']::box[] as single_value`;
        expect(result[0].single_value).toEqual(["(1,1),(0,0)"]); // PostgreSQL normalizes to upper-right, lower-left
      });

      test("box[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((0,0),(1,1))',
          '((2,2),(3,3))',
          '((4,4),(5,5))'
        ]::box[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["(1,1),(0,0)", "(3,3),(2,2)", "(5,5),(4,4)"]);
      });

      test("box[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((0,0),(1,1))',
          NULL,
          '((2,2),(3,3))',
          NULL
        ]::box[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["(1,1),(0,0)", null, "(3,3),(2,2)", null]);
      });

      test("box[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::box[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("box[] - decimal coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((0.5,0.5),(1.5,1.5))',
          '((2.25,2.25),(3.75,3.75))'
        ]::box[] as decimal_boxes
      `;
        expect(result[0].decimal_boxes).toEqual(["(1.5,1.5),(0.5,0.5)", "(3.75,3.75),(2.25,2.25)"]);
      });

      test("box[] - negative coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((-1,-1),(1,1))',
          '((-2,-2),(2,2))'
        ]::box[] as negative_boxes
      `;
        expect(result[0].negative_boxes).toEqual(["(1,1),(-1,-1)", "(2,2),(-2,-2)"]);
      });

      test("box[] - degenerate boxes (point)", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((1,1),(1,1))',
          '((2,2),(2,2))'
        ]::box[] as point_boxes
      `;
        expect(result[0].point_boxes).toEqual(["(1,1),(1,1)", "(2,2),(2,2)"]);
      });

      test("box[] - degenerate boxes (line)", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((0,1),(2,1))',     -- horizontal line
          '((1,0),(1,2))'      -- vertical line
        ]::box[] as line_boxes
      `;
        expect(result[0].line_boxes).toEqual(["(2,1),(0,1)", "(1,2),(1,0)"]);
      });

      test("box[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['((0,0),(1,1))', '((2,2),(3,3))', '((4,4),(5,5))']::box[])[1] as first_element,
          (ARRAY['((0,0),(1,1))', '((2,2),(3,3))', '((4,4),(5,5))']::box[])[2] as second_element,
          (ARRAY['((0,0),(1,1))', '((2,2),(3,3))', '((4,4),(5,5))']::box[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("(1,1),(0,0)");
        expect(result[0].second_element).toBe("(3,3),(2,2)");
        expect(result[0].third_element).toBe("(5,5),(4,4)");
      });

      test("box[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['((0,0),(1,1))', '((2,2),(3,3))']::box[] ||
          ARRAY['((4,4),(5,5))']::box[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["(1,1),(0,0)", "(3,3),(2,2)", "(5,5),(4,4)"]);
      });

      test("box[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['((0,0),(1,1))', '((2,2),(3,3))']::box[], 1) as array_length,
          array_dims(ARRAY['((0,0),(1,1))', '((2,2),(3,3))']::box[]) as dimensions,
          array_upper(ARRAY['((0,0),(1,1))', '((2,2),(3,3))']::box[], 1) as upper_bound,
          array_lower(ARRAY['((0,0),(1,1))', '((2,2),(3,3))']::box[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });

      test("box[] - box operators", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          box '((0,0),(1,1))' = box '((1,1),(0,0))' as same_box,
          box '((0,0),(2,2))' @> box '((1,1),(1.5,1.5))' as contains_box,
          box '((0,0),(2,2))' && box '((1,1),(3,3))' as overlaps_box
      `;

        expect(result[0].same_box).toBe(true);
        expect(result[0].contains_box).toBe(true);
        expect(result[0].overlaps_box).toBe(true);
      });
    });

    describe("polygon[] Array type", () => {
      test("polygon[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::polygon[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("polygon[] - single triangle", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['((0,0),(1,1),(2,0))']::polygon[] as single_triangle`;
        expect(result[0].single_triangle).toEqual(["((0,0),(1,1),(2,0))"]);
      });

      test("polygon[] - multiple polygons", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((0,0),(1,1),(2,0))',              -- triangle
          '((0,0),(0,1),(1,1),(1,0))',        -- square
          '((0,0),(1,1),(2,0),(1,-1))'        -- diamond
        ]::polygon[] as multiple_polygons
      `;
        expect(result[0].multiple_polygons).toEqual([
          "((0,0),(1,1),(2,0))",
          "((0,0),(0,1),(1,1),(1,0))",
          "((0,0),(1,1),(2,0),(1,-1))",
        ]);
      });

      test("polygon[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((0,0),(1,1),(2,0))',
          NULL,
          '((0,0),(0,1),(1,1),(1,0))',
          NULL
        ]::polygon[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["((0,0),(1,1),(2,0))", null, "((0,0),(0,1),(1,1),(1,0))", null]);
      });

      test("polygon[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::polygon[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("polygon[] - decimal coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((0.5,0.5),(1.5,1.5),(2.5,0.5))',
          '((0.1,0.1),(0.1,0.9),(0.9,0.9),(0.9,0.1))'
        ]::polygon[] as decimal_polygons
      `;
        expect(result[0].decimal_polygons).toEqual([
          "((0.5,0.5),(1.5,1.5),(2.5,0.5))",
          "((0.1,0.1),(0.1,0.9),(0.9,0.9),(0.9,0.1))",
        ]);
      });

      test("polygon[] - negative coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((-1,-1),(0,1),(1,-1))',
          '((-2,-2),(-2,2),(2,2),(2,-2))'
        ]::polygon[] as negative_polygons
      `;
        expect(result[0].negative_polygons).toEqual(["((-1,-1),(0,1),(1,-1))", "((-2,-2),(-2,2),(2,2),(2,-2))"]);
      });

      test("polygon[] - common shapes", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '((0,0),(0,1),(1,1),(1,0))',                          -- square
          '((0,0),(1,2),(2,0))',                                -- triangle
          '((0,0),(1,1),(2,0),(1,-1))',                        -- diamond
          '((0,0),(1,1),(2,0),(2,-1),(1,-2),(0,-1))'          -- hexagon
        ]::polygon[] as common_shapes
      `;
        expect(result[0].common_shapes).toEqual([
          "((0,0),(0,1),(1,1),(1,0))",
          "((0,0),(1,2),(2,0))",
          "((0,0),(1,1),(2,0),(1,-1))",
          "((0,0),(1,1),(2,0),(2,-1),(1,-2),(0,-1))",
        ]);
      });

      test("polygon[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['((0,0),(1,1),(2,0))', '((0,0),(0,1),(1,1),(1,0))']::polygon[])[1] as first_element,
          (ARRAY['((0,0),(1,1),(2,0))', '((0,0),(0,1),(1,1),(1,0))']::polygon[])[2] as second_element
      `;

        expect(result[0].first_element).toBe("((0,0),(1,1),(2,0))");
        expect(result[0].second_element).toBe("((0,0),(0,1),(1,1),(1,0))");
      });

      test("polygon[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['((0,0),(1,1),(2,0))']::polygon[] ||
          ARRAY['((0,0),(0,1),(1,1),(1,0))']::polygon[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["((0,0),(1,1),(2,0))", "((0,0),(0,1),(1,1),(1,0))"]);
      });

      test("polygon[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['((0,0),(1,1),(2,0))', '((0,0),(0,1),(1,1),(1,0))']::polygon[], 1) as array_length,
          array_dims(ARRAY['((0,0),(1,1),(2,0))', '((0,0),(0,1),(1,1),(1,0))']::polygon[]) as dimensions,
          array_upper(ARRAY['((0,0),(1,1),(2,0))', '((0,0),(0,1),(1,1),(1,0))']::polygon[], 1) as upper_bound,
          array_lower(ARRAY['((0,0),(1,1),(2,0))', '((0,0),(0,1),(1,1),(1,0))']::polygon[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });

      test("polygon[] - polygon operators", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          '((0,0),(1,1),(1,0))'::polygon @> point '(0.5,0.5)' as contains_point,
          '((0,0),(2,2),(2,0))'::polygon @> '((0.5,0.5),(1.5,1.5),(1.5,0.5))'::polygon as contains_polygon,
          '((0,0),(2,2),(2,0))'::polygon && '((1,1),(3,3),(3,1))'::polygon as overlaps_polygon
      `;

        expect(result[0].contains_point).toBe(true);
        expect(result[0].contains_polygon).toBe(true);
        expect(result[0].overlaps_polygon).toBe(true);
      });
    });
    describe("line[] Array type", () => {
      test("line[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::line[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("line[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['{1,2,3}']::line[] as single_value`; // x + 2y + 3 = 0
        expect(result[0].single_value).toEqual(["{1,2,3}"]);
      });

      test("line[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{1,0,0}',   -- x = 0 (vertical line)
          '{0,1,0}',   -- y = 0 (horizontal line)
          '{1,1,-1}'   -- x + y = 1
        ]::line[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["{1,0,0}", "{0,1,0}", "{1,1,-1}"]);
      });

      test("line[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{1,2,3}',
          NULL,
          '{4,5,6}',
          NULL
        ]::line[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["{1,2,3}", null, "{4,5,6}", null]);
      });

      test("line[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::line[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("line[] - special cases", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{1,0,0}',      -- vertical line: x = 0
          '{0,1,0}',      -- horizontal line: y = 0
          '{1,1,0}',      -- diagonal line: x + y = 0
          '{1,-1,0}'      -- diagonal line: x - y = 0
        ]::line[] as special_lines
      `;
        expect(result[0].special_lines).toEqual(["{1,0,0}", "{0,1,0}", "{1,1,0}", "{1,-1,0}"]);
      });

      test("line[] - decimal coefficients", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{1.5,2.5,3.5}',
          '{0.1,0.2,0.3}'
        ]::line[] as decimal_lines
      `;
        expect(result[0].decimal_lines).toEqual(["{1.5,2.5,3.5}", "{0.1,0.2,0.3}"]);
      });

      test("line[] - negative coefficients", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{-1,-2,-3}',
          '{-1.5,-2.5,-3.5}'
        ]::line[] as negative_lines
      `;
        expect(result[0].negative_lines).toEqual(["{-1,-2,-3}", "{-1.5,-2.5,-3.5}"]);
      });

      test("line[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['{1,2,3}', '{4,5,6}', '{7,8,9}']::line[])[1] as first_element,
          (ARRAY['{1,2,3}', '{4,5,6}', '{7,8,9}']::line[])[2] as second_element,
          (ARRAY['{1,2,3}', '{4,5,6}', '{7,8,9}']::line[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("{1,2,3}");
        expect(result[0].second_element).toBe("{4,5,6}");
        expect(result[0].third_element).toBe("{7,8,9}");
      });

      test("line[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['{1,2,3}', '{4,5,6}']::line[] ||
          ARRAY['{7,8,9}']::line[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["{1,2,3}", "{4,5,6}", "{7,8,9}"]);
      });

      test("line[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['{1,2,3}', '{4,5,6}']::line[], 1) as array_length,
          array_dims(ARRAY['{1,2,3}', '{4,5,6}']::line[]) as dimensions,
          array_upper(ARRAY['{1,2,3}', '{4,5,6}']::line[], 1) as upper_bound,
          array_lower(ARRAY['{1,2,3}', '{4,5,6}']::line[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("cidr[] Array type", () => {
      test("cidr[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::cidr[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("cidr[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['192.168.1.0/24']::cidr[] as single_value`;
        expect(result[0].single_value).toEqual(["192.168.1.0/24"]);
      });

      test("cidr[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '192.168.1.0/24',
          '10.0.0.0/8',
          '172.16.0.0/16'
        ]::cidr[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["192.168.1.0/24", "10.0.0.0/8", "172.16.0.0/16"]);
      });

      test("cidr[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '192.168.1.0/24',
          NULL,
          '10.0.0.0/8',
          NULL
        ]::cidr[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["192.168.1.0/24", null, "10.0.0.0/8", null]);
      });

      test("cidr[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::cidr[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("cidr[] - IPv4 different prefix lengths", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '192.168.1.0/24',    -- Class C size
          '192.168.0.0/16',    -- Class B size
          '192.0.0.0/8',       -- Class A size
          '192.168.1.0/25',    -- Half of Class C
          '192.168.1.0/26',    -- Quarter of Class C
          '192.168.1.0/32'     -- Single host
        ]::cidr[] as prefix_lengths
      `;
        expect(result[0].prefix_lengths).toEqual([
          "192.168.1.0/24",
          "192.168.0.0/16",
          "192.0.0.0/8",
          "192.168.1.0/25",
          "192.168.1.0/26",
          "192.168.1.0/32",
        ]);
      });

      test("cidr[] - IPv6 addresses", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2001:db8::/32',
          'fe80::/10',
          '::1/128',
          '::/0'
        ]::cidr[] as ipv6_networks
      `;
        expect(result[0].ipv6_networks).toEqual(["2001:db8::/32", "fe80::/10", "::1/128", "::/0"]);
      });

      test("cidr[] - special networks", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '127.0.0.0/8',      -- Loopback
          '10.0.0.0/8',       -- Private network
          '172.16.0.0/12',    -- Private network
          '192.168.0.0/16',   -- Private network
          '169.254.0.0/16',   -- Link-local
          '224.0.0.0/4'       -- Multicast
        ]::cidr[] as special_networks
      `;
        expect(result[0].special_networks).toEqual([
          "127.0.0.0/8",
          "10.0.0.0/8",
          "172.16.0.0/12",
          "192.168.0.0/16",
          "169.254.0.0/16",
          "224.0.0.0/4",
        ]);
      });

      test("cidr[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['192.168.1.0/24', '10.0.0.0/8', '172.16.0.0/16']::cidr[])[1] as first_element,
          (ARRAY['192.168.1.0/24', '10.0.0.0/8', '172.16.0.0/16']::cidr[])[2] as second_element,
          (ARRAY['192.168.1.0/24', '10.0.0.0/8', '172.16.0.0/16']::cidr[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("192.168.1.0/24");
        expect(result[0].second_element).toBe("10.0.0.0/8");
        expect(result[0].third_element).toBe("172.16.0.0/16");
      });

      test("cidr[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['192.168.1.0/24', '10.0.0.0/8']::cidr[] ||
          ARRAY['172.16.0.0/16']::cidr[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["192.168.1.0/24", "10.0.0.0/8", "172.16.0.0/16"]);
      });

      test("cidr[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['192.168.1.0/24', '10.0.0.0/8']::cidr[], 1) as array_length,
          array_dims(ARRAY['192.168.1.0/24', '10.0.0.0/8']::cidr[]) as dimensions,
          array_upper(ARRAY['192.168.1.0/24', '10.0.0.0/8']::cidr[], 1) as upper_bound,
          array_lower(ARRAY['192.168.1.0/24', '10.0.0.0/8']::cidr[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("float4[] Array type", () => {
      test("float4[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::float4[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("float4[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1.0]::float4[] as single_value`;
        expect(result[0].single_value).toEqual([1.0]);
      });

      test("float4[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[1.0, 2.0, 3.0]::float4[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual([1.0, 2.0, 3.0]);
      });

      test("float4[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[1.0, NULL, 3.0, NULL]::float4[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual([1.0, null, 3.0, null]);
      });

      test("float4[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::float4[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("float4[] - decimal places", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.23456,
          2.34567,
          3.45678
        ]::float4[] as decimal_values
      `;

        result[0].decimal_values.forEach((value, index) => {
          expect(value).toBeCloseTo([1.23456, 2.34567, 3.45678][index], 5);
        });
      });

      test("float4[] - negative values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          -1.23,
          -2.34,
          -3.45
        ]::float4[] as negative_values
      `;
        expect(result[0].negative_values).toEqual([-1.23, -2.34, -3.45]);
      });

      test("float4[] - zero values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          0.0,
          -0.0,
          0.000
        ]::float4[] as zero_values
      `;
        expect(result[0].zero_values).toEqual([0, 0, 0]);
      });

      test("float4[] - scientific notation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.23e-4,
          1.23e4,
          1.23e+4
        ]::float4[] as scientific_notation
      `;
        expect(result[0].scientific_notation.map(n => Number(n.toExponential()))).toEqual([1.23e-4, 1.23e4, 1.23e4]);
      });

      test("float4[] - special values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'Infinity'::float4,
          '-Infinity'::float4,
          'NaN'::float4
        ]::float4[] as special_values
      `;
        expect(result[0].special_values).toEqual([Infinity, -Infinity, NaN]);
      });

      test("float4[] - boundary values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '3.4028235e+38'::float4,    -- Maximum float4
          '-3.4028235e+38'::float4,   -- Minimum float4
          '1.175494e-38'::float4      -- Smallest positive float4
        ]::float4[] as boundary_values
      `;

        expect(result[0].boundary_values[0]).toBeCloseTo(3.4028235e38);
        expect(result[0].boundary_values[1]).toBeCloseTo(-3.4028235e38);
        expect(result[0].boundary_values[2]).toBeCloseTo(1.175494e-38);
      });

      test("float4[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY[1.1, 2.2, 3.3]::float4[])[1] as first_element,
          (ARRAY[1.1, 2.2, 3.3]::float4[])[2] as second_element,
          (ARRAY[1.1, 2.2, 3.3]::float4[])[3] as third_element
      `;

        expect(result[0].first_element).toBe(1.1);
        expect(result[0].second_element).toBe(2.2);
        expect(result[0].third_element).toBe(3.3);
      });

      test("float4[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.1, 2.2, 3.3]::float4[] @> ARRAY[1.1]::float4[] as contains_first,
          ARRAY[1.1, 2.2, 3.3]::float4[] @> ARRAY[2.2]::float4[] as contains_second,
          ARRAY[1.1, 2.2, 3.3]::float4[] @> ARRAY[4.4]::float4[] as contains_none,
          ARRAY[1.1, 2.2, 3.3]::float4[] @> ARRAY[1.1, 2.2]::float4[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("float4[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.1, 2.2]::float4[] && ARRAY[2.2, 3.3]::float4[] as has_overlap,
          ARRAY[1.1, 2.2]::float4[] && ARRAY[3.3, 4.4]::float4[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("float4[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.1, 2.2]::float4[] || ARRAY[3.3, 4.4]::float4[] as concatenated
      `;

        expect(result[0].concatenated).toEqual([1.1, 2.2, 3.3, 4.4]);
      });

      test("float4[] - mathematical operations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (SELECT array_agg((value * 2)::float4) FROM unnest(ARRAY[1.1, 2.2, 3.3]::float4[]) as value) as multiplication,
          (SELECT array_agg((value + 1)::float4) FROM unnest(ARRAY[1.1, 2.2, 3.3]::float4[]) as value) as addition
      `;

        expect(result[0].multiplication).toEqual([2.2, 4.4, 6.6]);
        expect(result[0].addition).toEqual([2.1, 3.2, 4.3]);
      });

      test("float4[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY[1.1, 2.2, 3.3]::float4[], 1) as array_length,
          array_dims(ARRAY[1.1, 2.2, 3.3]::float4[]) as dimensions,
          array_upper(ARRAY[1.1, 2.2, 3.3]::float4[], 1) as upper_bound,
          array_lower(ARRAY[1.1, 2.2, 3.3]::float4[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("float4[] - precision comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.23456789::float4]::float4[] as high_precision,
          ARRAY[1.23456789::float8::float4]::float4[] as converted_precision
      `;

        // float4 has about 6-7 decimal digits of precision
        expect(result[0].high_precision[0]).toBeCloseTo(result[0].converted_precision[0], 6);
      });
    });

    describe("float8[] Array type", () => {
      test("float8[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::float8[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("float8[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1.0]::float8[] as single_value`;
        expect(result[0].single_value).toEqual([1.0]);
      });

      test("float8[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[1.0, 2.0, 3.0]::float8[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual([1.0, 2.0, 3.0]);
      });

      test("float8[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[1.0, NULL, 3.0, NULL]::float8[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual([1.0, null, 3.0, null]);
      });

      test("float8[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::float8[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("float8[] - high precision decimals", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.2345678901234567,
          2.3456789012345678,
          3.4567890123456789
        ]::float8[] as high_precision_values
      `;

        result[0].high_precision_values.forEach((value, index) => {
          expect(value).toBeCloseTo([1.2345678901234567, 2.3456789012345678, 3.4567890123456789][index], 15);
        });
      });

      test("float8[] - negative values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          -1.2345678901234567,
          -2.3456789012345678,
          -3.4567890123456789
        ]::float8[] as negative_values
      `;

        result[0].negative_values.forEach((value, index) => {
          expect(value).toBeCloseTo([-1.2345678901234567, -2.3456789012345678, -3.4567890123456789][index], 15);
        });
      });

      test("float8[] - zero values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          0.0,
          -0.0,
          0.000000000000000
        ]::float8[] as zero_values
      `;
        expect(result[0].zero_values).toEqual([0, 0, 0]);
      });

      test("float8[] - scientific notation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.23456789e-10,
          1.23456789e10,
          1.23456789e+10
        ]::float8[] as scientific_notation
      `;
        expect(result[0].scientific_notation.map(n => Number(n.toExponential(8)))).toEqual([
          1.23456789e-10, 1.23456789e10, 1.23456789e10,
        ]);
      });

      test("float8[] - special values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'Infinity'::float8,
          '-Infinity'::float8,
          'NaN'::float8
        ]::float8[] as special_values
      `;
        expect(result[0].special_values).toEqual([Infinity, -Infinity, NaN]);
      });

      test("float8[] - boundary values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '1.7976931348623157e+308'::float8,    -- Maximum float8
          '-1.7976931348623157e+308'::float8,   -- Minimum float8
          '2.2250738585072014e-308'::float8     -- Smallest positive normal float8
        ]::float8[] as boundary_values
      `;

        expect(result[0].boundary_values[0]).toBe(1.7976931348623157e308);
        expect(result[0].boundary_values[1]).toBe(-1.7976931348623157e308);
        expect(result[0].boundary_values[2]).toBe(2.2250738585072014e-308);
      });

      test("float8[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY[1.1, 2.2, 3.3]::float8[])[1] as first_element,
          (ARRAY[1.1, 2.2, 3.3]::float8[])[2] as second_element,
          (ARRAY[1.1, 2.2, 3.3]::float8[])[3] as third_element
      `;

        expect(result[0].first_element).toBe(1.1);
        expect(result[0].second_element).toBe(2.2);
        expect(result[0].third_element).toBe(3.3);
      });

      test("float8[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.1, 2.2, 3.3]::float8[] @> ARRAY[1.1]::float8[] as contains_first,
          ARRAY[1.1, 2.2, 3.3]::float8[] @> ARRAY[2.2]::float8[] as contains_second,
          ARRAY[1.1, 2.2, 3.3]::float8[] @> ARRAY[4.4]::float8[] as contains_none,
          ARRAY[1.1, 2.2, 3.3]::float8[] @> ARRAY[1.1, 2.2]::float8[] as contains_multiple
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
        expect(result[0].contains_multiple).toBe(true);
      });

      test("float8[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.1, 2.2]::float8[] && ARRAY[2.2, 3.3]::float8[] as has_overlap,
          ARRAY[1.1, 2.2]::float8[] && ARRAY[3.3, 4.4]::float8[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("float8[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.1, 2.2]::float8[] || ARRAY[3.3, 4.4]::float8[] as concatenated
      `;

        expect(result[0].concatenated).toEqual([1.1, 2.2, 3.3, 4.4]);
      });

      test("float8[] - mathematical operations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (SELECT array_agg((value * 2)::float8) FROM unnest(ARRAY[1.1, 2.2, 3.3]::float8[]) as value) as multiplication,
          (SELECT array_agg((value + 1)::float8) FROM unnest(ARRAY[1.1, 2.2, 3.3]::float8[]) as value) as addition,
          (SELECT array_agg(round(value::numeric, 10)) FROM unnest(ARRAY[1.1111111111, 2.2222222222]::float8[]) as value) as rounding
      `;

        expect(result[0].multiplication).toEqual([2.2, 4.4, 6.6]);
        expect(result[0].addition).toEqual([2.1, 3.2, 4.3]);
        expect(result[0].rounding).toEqual(["1.1111111111", "2.2222222222"]);
      });

      test("float8[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY[1.1, 2.2, 3.3]::float8[], 1) as array_length,
          array_dims(ARRAY[1.1, 2.2, 3.3]::float8[]) as dimensions,
          array_upper(ARRAY[1.1, 2.2, 3.3]::float8[], 1) as upper_bound,
          array_lower(ARRAY[1.1, 2.2, 3.3]::float8[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("float8[] - precision comparison with float4", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.23456789012345::float8]::float8[] as double_precision,
          ARRAY[1.23456789012345::float4::float8]::float8[] as converted_precision
      `;

        // float8 preserves precision that float4 would lose
        expect(result[0].double_precision[0]).not.toBe(result[0].converted_precision[0]);
        // float4 has about 6-7 decimal digits of precision
        expect(result[0].converted_precision[0]).toBeCloseTo(1.23456789012345, 6);
        // float8 has about 15-17 decimal digits of precision
        expect(result[0].double_precision[0]).toBeCloseTo(1.23456789012345, 14);
      });
    });
    describe("circle[] Array type", () => {
      test("circle[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::circle[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("circle[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['<(0,0),1>']::circle[] as single_value`;
        expect(result[0].single_value).toEqual(["<(0,0),1>"]);
      });

      test("circle[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<(0,0),1>',
          '<(1,1),2>',
          '<(2,2),3>'
        ]::circle[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["<(0,0),1>", "<(1,1),2>", "<(2,2),3>"]);
      });

      test("circle[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<(0,0),1>',
          NULL,
          '<(2,2),3>',
          NULL
        ]::circle[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["<(0,0),1>", null, "<(2,2),3>", null]);
      });

      test("circle[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::circle[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("circle[] - decimal coordinates and radius", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<(0.5,0.5),1.5>',
          '<(1.25,1.75),2.25>',
          '<(3.14,2.71),1.41>'
        ]::circle[] as decimal_circles
      `;
        expect(result[0].decimal_circles).toEqual(["<(0.5,0.5),1.5>", "<(1.25,1.75),2.25>", "<(3.14,2.71),1.41>"]);
      });

      test("circle[] - negative coordinates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<(-1,-1),1>',
          '<(-2.5,-3.5),2>',
          '<(-5,-5),3>'
        ]::circle[] as negative_circles
      `;
        expect(result[0].negative_circles).toEqual(["<(-1,-1),1>", "<(-2.5,-3.5),2>", "<(-5,-5),3>"]);
      });

      test("circle[] - zero radius", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '<(0,0),0>',
          '<(1,1),0>',
          '<(2,2),0>'
        ]::circle[] as point_circles
      `;
        expect(result[0].point_circles).toEqual(["<(0,0),0>", "<(1,1),0>", "<(2,2),0>"]);
      });

      test("circle[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['<(0,0),1>', '<(1,1),2>', '<(2,2),3>']::circle[])[1] as first_element,
          (ARRAY['<(0,0),1>', '<(1,1),2>', '<(2,2),3>']::circle[])[2] as second_element,
          (ARRAY['<(0,0),1>', '<(1,1),2>', '<(2,2),3>']::circle[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("<(0,0),1>");
        expect(result[0].second_element).toBe("<(1,1),2>");
        expect(result[0].third_element).toBe("<(2,2),3>");
      });

      test("circle[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['<(0,0),1>', '<(1,1),2>']::circle[] ||
          ARRAY['<(2,2),3>']::circle[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["<(0,0),1>", "<(1,1),2>", "<(2,2),3>"]);
      });

      test("circle[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['<(0,0),1>', '<(1,1),2>']::circle[], 1) as array_length,
          array_dims(ARRAY['<(0,0),1>', '<(1,1),2>']::circle[]) as dimensions,
          array_upper(ARRAY['<(0,0),1>', '<(1,1),2>']::circle[], 1) as upper_bound,
          array_lower(ARRAY['<(0,0),1>', '<(1,1),2>']::circle[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });
    describe("macaddr8[] Array type", () => {
      test("macaddr8[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::macaddr8[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("macaddr8[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['08:00:2b:01:02:03:04:05']::macaddr8[] as single_value`;
        expect(result[0].single_value).toEqual(["08:00:2b:01:02:03:04:05"]);
      });

      test("macaddr8[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '08:00:2b:01:02:03:04:05',
          '08:00:2b:01:02:03:04:06',
          '08:00:2b:01:02:03:04:07'
        ]::macaddr8[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual([
          "08:00:2b:01:02:03:04:05",
          "08:00:2b:01:02:03:04:06",
          "08:00:2b:01:02:03:04:07",
        ]);
      });

      test("macaddr8[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '08:00:2b:01:02:03:04:05',
          NULL,
          '08:00:2b:01:02:03:04:07',
          NULL
        ]::macaddr8[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["08:00:2b:01:02:03:04:05", null, "08:00:2b:01:02:03:04:07", null]);
      });

      test("macaddr8[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::macaddr8[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("macaddr8[] - different input formats", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '08-00-2b-01-02-03-04-05',                    -- with hyphens
          '08:00:2b:01:02:03:04:05',                    -- with colons
          '08002b0102030405',                           -- without separators
          '0800.2b01.0203.0405'                         -- with dots
        ]::macaddr8[] as format_values
      `;
        // PostgreSQL normalizes to colon format
        expect(result[0].format_values).toEqual([
          "08:00:2b:01:02:03:04:05",
          "08:00:2b:01:02:03:04:05",
          "08:00:2b:01:02:03:04:05",
          "08:00:2b:01:02:03:04:05",
        ]);
      });

      test("macaddr8[] - case insensitivity", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '08:00:2B:01:02:03:04:05',
          '08:00:2b:01:02:03:04:05',
          '08:00:2B:01:02:03:04:05'
        ]::macaddr8[] as case_values
      `;
        // PostgreSQL normalizes to lowercase
        expect(result[0].case_values).toEqual([
          "08:00:2b:01:02:03:04:05",
          "08:00:2b:01:02:03:04:05",
          "08:00:2b:01:02:03:04:05",
        ]);
      });

      test("macaddr8[] - broadcast address", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'ff:ff:ff:ff:ff:ff:ff:ff'    -- broadcast address
        ]::macaddr8[] as broadcast_addr
      `;
        expect(result[0].broadcast_addr).toEqual(["ff:ff:ff:ff:ff:ff:ff:ff"]);
      });

      test("macaddr8[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['08:00:2b:01:02:03:04:05', '08:00:2b:01:02:03:04:06']::macaddr8[])[1] as first_element,
          (ARRAY['08:00:2b:01:02:03:04:05', '08:00:2b:01:02:03:04:06']::macaddr8[])[2] as second_element
      `;

        expect(result[0].first_element).toBe("08:00:2b:01:02:03:04:05");
        expect(result[0].second_element).toBe("08:00:2b:01:02:03:04:06");
      });

      test("macaddr8[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['08:00:2b:01:02:03:04:05']::macaddr8[] ||
          ARRAY['08:00:2b:01:02:03:04:06']::macaddr8[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["08:00:2b:01:02:03:04:05", "08:00:2b:01:02:03:04:06"]);
      });

      test("macaddr8[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['08:00:2b:01:02:03:04:05', '08:00:2b:01:02:03:04:06']::macaddr8[], 1) as array_length,
          array_dims(ARRAY['08:00:2b:01:02:03:04:05', '08:00:2b:01:02:03:04:06']::macaddr8[]) as dimensions,
          array_upper(ARRAY['08:00:2b:01:02:03:04:05', '08:00:2b:01:02:03:04:06']::macaddr8[], 1) as upper_bound,
          array_lower(ARRAY['08:00:2b:01:02:03:04:05', '08:00:2b:01:02:03:04:06']::macaddr8[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("money[] Array type", () => {
      test("money[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::money[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("money[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['$100.00']::money[] as single_value`;
        expect(result[0].single_value).toEqual(["$100.00"]);
      });

      test("money[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '$100.00',
          '$200.00',
          '$300.00'
        ]::money[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["$100.00", "$200.00", "$300.00"]);
      });

      test("money[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '$100.00',
          NULL,
          '$300.00',
          NULL
        ]::money[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["$100.00", null, "$300.00", null]);
      });

      test("money[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::money[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("money[] - different input formats", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12345.67'::money,        -- numeric input
          '$12,345.67',            -- with currency symbol and comma
          '12345.67',              -- without currency symbol
          '12345',                 -- integer value
          '.67',                   -- decimal only
          '$0.01',                 -- minimum value
          '$0.00'                  -- zero value
        ]::money[] as format_values
      `;
        expect(result[0].format_values).toEqual([
          "$12,345.67",
          "$12,345.67",
          "$12,345.67",
          "$12,345.00",
          "$0.67",
          "$0.01",
          "$0.00",
        ]);
      });

      test("money[] - negative values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '-12345.67'::money,
          '($12,345.67)',
          '-$12,345.67'
        ]::money[] as negative_values
      `;

        // PostgreSQL normalizes negative money formats
        expect(result[0].negative_values).toEqual(["-$12,345.67", "-$12,345.67", "-$12,345.67"]);
      });

      test("money[] - large values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '92233720368547758.07'::money,   -- Maximum money value
          '-92233720368547758.08'::money   -- Minimum money value
        ]::money[] as boundary_values
      `;
        expect(result[0].boundary_values).toEqual(["$92,233,720,368,547,758.07", "-$92,233,720,368,547,758.08"]);
      });

      test("money[] - rounding behavior", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '1.234'::money,          -- rounds to 1.23
          '1.235'::money,          -- rounds to 1.24
          '1.236'::money,          -- rounds to 1.24
          '-1.234'::money,         -- rounds to -1.23
          '-1.235'::money         -- rounds to -1.24
        ]::money[] as rounded_values
      `;
        expect(result[0].rounded_values).toEqual(["$1.23", "$1.24", "$1.24", "-$1.23", "-$1.24"]);
      });

      test("money[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['$100.00', '$200.00', '$300.00']::money[])[1] as first_element,
          (ARRAY['$100.00', '$200.00', '$300.00']::money[])[2] as second_element,
          (ARRAY['$100.00', '$200.00', '$300.00']::money[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("$100.00");
        expect(result[0].second_element).toBe("$200.00");
        expect(result[0].third_element).toBe("$300.00");
      });

      test("money[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['$100.00', '$200.00']::money[] || ARRAY['$300.00']::money[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["$100.00", "$200.00", "$300.00"]);
      });

      test("money[] - array aggregation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH money_values AS (
          SELECT unnest(ARRAY['$100.00', '$200.00', '$300.00']::money[]) as amount
        )
        SELECT
          sum(amount)::money as total,
          min(amount)::money as minimum,
          max(amount)::money as maximum
        FROM money_values
      `;

        expect(result[0].total).toBe("$600.00");
        expect(result[0].minimum).toBe("$100.00");
        expect(result[0].maximum).toBe("$300.00");
      });

      test("money[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['$100.00', '$200.00']::money[], 1) as array_length,
          array_dims(ARRAY['$100.00', '$200.00']::money[]) as dimensions,
          array_upper(ARRAY['$100.00', '$200.00']::money[], 1) as upper_bound,
          array_lower(ARRAY['$100.00', '$200.00']::money[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("macaddr[] Array type", () => {
      test("macaddr[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::macaddr[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("macaddr[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['08:00:2b:01:02:03']::macaddr[] as single_value`;
        expect(result[0].single_value).toEqual(["08:00:2b:01:02:03"]);
      });

      test("macaddr[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '08:00:2b:01:02:03',
          '08:00:2b:01:02:04',
          '08:00:2b:01:02:05'
        ]::macaddr[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["08:00:2b:01:02:03", "08:00:2b:01:02:04", "08:00:2b:01:02:05"]);
      });

      test("macaddr[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '08:00:2b:01:02:03',
          NULL,
          '08:00:2b:01:02:05',
          NULL
        ]::macaddr[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["08:00:2b:01:02:03", null, "08:00:2b:01:02:05", null]);
      });

      test("macaddr[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::macaddr[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("macaddr[] - different input formats", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '08-00-2b-01-02-03',                    -- with hyphens
          '08:00:2b:01:02:03',                    -- with colons
          '08002b010203',                         -- without separators
          '0800.2b01.0203'                        -- with dots
        ]::macaddr[] as format_values
      `;
        // PostgreSQL normalizes to colon format
        expect(result[0].format_values).toEqual([
          "08:00:2b:01:02:03",
          "08:00:2b:01:02:03",
          "08:00:2b:01:02:03",
          "08:00:2b:01:02:03",
        ]);
      });

      test("macaddr[] - case insensitivity", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '08:00:2B:01:02:03',
          '08:00:2b:01:02:03',
          '08:00:2B:01:02:03'
        ]::macaddr[] as case_values
      `;
        // PostgreSQL normalizes to lowercase
        expect(result[0].case_values).toEqual(["08:00:2b:01:02:03", "08:00:2b:01:02:03", "08:00:2b:01:02:03"]);
      });

      test("macaddr[] - special addresses", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'ff:ff:ff:ff:ff:ff',    -- broadcast address
          '00:00:00:00:00:00',    -- null address
          '01:00:5e:00:00:00'     -- multicast address
        ]::macaddr[] as special_addresses
      `;
        expect(result[0].special_addresses).toEqual(["ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00", "01:00:5e:00:00:00"]);
      });

      test("macaddr[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['08:00:2b:01:02:03', '08:00:2b:01:02:04']::macaddr[])[1] as first_element,
          (ARRAY['08:00:2b:01:02:03', '08:00:2b:01:02:04']::macaddr[])[2] as second_element
      `;

        expect(result[0].first_element).toBe("08:00:2b:01:02:03");
        expect(result[0].second_element).toBe("08:00:2b:01:02:04");
      });

      test("macaddr[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['08:00:2b:01:02:03']::macaddr[] ||
          ARRAY['08:00:2b:01:02:04']::macaddr[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["08:00:2b:01:02:03", "08:00:2b:01:02:04"]);
      });

      test("macaddr[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['08:00:2b:01:02:03', '08:00:2b:01:02:04']::macaddr[], 1) as array_length,
          array_dims(ARRAY['08:00:2b:01:02:03', '08:00:2b:01:02:04']::macaddr[]) as dimensions,
          array_upper(ARRAY['08:00:2b:01:02:03', '08:00:2b:01:02:04']::macaddr[], 1) as upper_bound,
          array_lower(ARRAY['08:00:2b:01:02:03', '08:00:2b:01:02:04']::macaddr[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });

      test("macaddr[] - trunc operation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          trunc('08:00:2b:01:02:03'::macaddr),  -- Set last 3 bytes to zero
          trunc('12:34:56:78:9a:bc'::macaddr)   -- Set last 3 bytes to zero
        ]::macaddr[] as truncated_macs
      `;

        expect(result[0].truncated_macs).toEqual(["08:00:2b:00:00:00", "12:34:56:00:00:00"]);
      });
    });

    describe("inet[] Array type", () => {
      test("inet[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::inet[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("inet[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['192.168.1.1']::inet[] as single_value`;
        expect(result[0].single_value).toEqual(["192.168.1.1"]);
      });

      test("inet[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '192.168.1.1',
          '10.0.0.1',
          '172.16.0.1'
        ]::inet[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["192.168.1.1", "10.0.0.1", "172.16.0.1"]);
      });

      test("inet[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '192.168.1.1',
          NULL,
          '10.0.0.1',
          NULL
        ]::inet[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["192.168.1.1", null, "10.0.0.1", null]);
      });

      test("inet[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::inet[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("inet[] - IPv4 addresses with CIDR", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '192.168.1.1/24',       -- Class C network
          '10.0.0.1/8',           -- Class A network
          '172.16.0.1/16',        -- Class B network
          '192.168.1.1/32'        -- Single host
        ]::inet[] as ipv4_with_cidr
      `;
        expect(result[0].ipv4_with_cidr).toEqual(["192.168.1.1/24", "10.0.0.1/8", "172.16.0.1/16", "192.168.1.1"]);
      });

      test("inet[] - IPv6 addresses", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2001:db8::1',                  -- Standard IPv6
          '::1',                          -- Localhost
          'fe80::1',                      -- Link-local
          '2001:db8::1/64',              -- With network prefix
          '::ffff:192.168.1.1'           -- IPv4-mapped IPv6
        ]::inet[] as ipv6_addresses
      `;
        expect(result[0].ipv6_addresses).toEqual([
          "2001:db8::1",
          "::1",
          "fe80::1",
          "2001:db8::1/64",
          "::ffff:192.168.1.1",
        ]);
      });

      test("inet[] - special addresses", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '0.0.0.0',              -- IPv4 unspecified
          '255.255.255.255',      -- IPv4 broadcast
          '127.0.0.1',            -- IPv4 localhost
          '::',                   -- IPv6 unspecified
          '::1'                   -- IPv6 localhost
        ]::inet[] as special_addresses
      `;
        expect(result[0].special_addresses).toEqual(["0.0.0.0", "255.255.255.255", "127.0.0.1", "::", "::1"]);
      });

      test("inet[] - private network addresses", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '10.0.0.0/8',          -- Class A private network
          '172.16.0.0/12',       -- Class B private network
          '192.168.0.0/16',      -- Class C private network
          'fc00::/7'             -- IPv6 unique local addresses
        ]::inet[] as private_networks
      `;
        expect(result[0].private_networks).toEqual(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"]);
      });

      test("inet[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['192.168.1.1', '10.0.0.1']::inet[])[1] as first_element,
          (ARRAY['192.168.1.1', '10.0.0.1']::inet[])[2] as second_element
      `;

        expect(result[0].first_element).toBe("192.168.1.1");
        expect(result[0].second_element).toBe("10.0.0.1");
      });

      test("inet[] - network containment operators", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          '192.168.1.0/24'::inet << '192.168.1.1'::inet as network_contains_address,
          '192.168.1.0/24'::inet <<= '192.168.1.0/24'::inet as network_contains_equals,
          '192.168.1.1'::inet >> '192.168.1.0/24'::inet as address_contained_by,
          '192.168.1.0/24'::inet >>= '192.168.1.0/24'::inet as network_contained_equals
      `;

        expect(result[0].network_contains_address).toBe(false);
        expect(result[0].network_contains_equals).toBe(true);
        expect(result[0].address_contained_by).toBe(false);
        expect(result[0].network_contained_equals).toBe(true);
      });

      test("inet[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['192.168.1.1', '10.0.0.1']::inet[] ||
          ARRAY['172.16.0.1']::inet[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["192.168.1.1", "10.0.0.1", "172.16.0.1"]);
      });

      test("inet[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['192.168.1.1', '10.0.0.1']::inet[], 1) as array_length,
          array_dims(ARRAY['192.168.1.1', '10.0.0.1']::inet[]) as dimensions,
          array_upper(ARRAY['192.168.1.1', '10.0.0.1']::inet[], 1) as upper_bound,
          array_lower(ARRAY['192.168.1.1', '10.0.0.1']::inet[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("bpchar[] Array type", () => {
      test("bpchar[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::bpchar[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("bpchar[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['A']::bpchar[] as single_value`;
        expect(result[0].single_value[0].trim()).toBe("A");
      });

      test("bpchar[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'A',
          'B',
          'C'
        ]::bpchar[] as multiple_values
      `;
        expect(result[0].multiple_values.map(v => v.trim())).toEqual(["A", "B", "C"]);
      });

      test("bpchar[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'A',
          NULL,
          'C',
          NULL
        ]::bpchar[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls.map(v => v?.trim() ?? null)).toEqual(["A", null, "C", null]);
      });

      test("bpchar[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::bpchar[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("bpchar[] - fixed length strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'abc'::char(5),
          'def'::char(5),
          'ghi'::char(5)
        ]::bpchar[] as fixed_length
      `;

        const values = result[0].fixed_length;
        // Each value should be padded to length 5
        expect(values[0].length).toBe(5);
        expect(values[1].length).toBe(5);
        expect(values[2].length).toBe(5);
        // Trimmed values should match original
        expect(values.map(v => v.trim())).toEqual(["abc", "def", "ghi"]);
      });

      test("bpchar[] - space padding behavior", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'x'::char(3),
          'xy'::char(3),
          'xyz'::char(3)
        ]::bpchar[] as padding_test
      `;

        const values = result[0].padding_test;
        // All values should be padded to length 3
        expect(values.every(v => v.length === 3)).toBe(true);
        // Original values should be preserved when trimmed
        expect(values.map(v => v.trim())).toEqual(["x", "xy", "xyz"]);
      });

      test("bpchar[] - mixed case strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'Abc'::char(3),
          'DEF'::char(3),
          'gHi'::char(3)
        ]::bpchar[] as mixed_case
      `;

        expect(result[0].mixed_case.map(v => v.trim())).toEqual(["Abc", "DEF", "gHi"]);
      });

      test("bpchar[] - special characters", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          ' x '::char(3),    -- spaces
          '$y$'::char(3),    -- symbols
          '#z#'::char(3)     -- hash
        ]::bpchar[] as special_chars
      `;
        //bpchar trims whitespace
        expect(result[0].special_chars.map(v => v.trim())).toEqual(["x", "$y$", "#z#"]);
      });

      test("bpchar[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['A', 'B', 'C']::bpchar[])[1] as first_element,
          (ARRAY['A', 'B', 'C']::bpchar[])[2] as second_element,
          (ARRAY['A', 'B', 'C']::bpchar[])[3] as third_element
      `;

        expect(result[0].first_element.trim()).toBe("A");
        expect(result[0].second_element.trim()).toBe("B");
        expect(result[0].third_element.trim()).toBe("C");
      });

      test("bpchar[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['A', 'B', 'C']::bpchar[], 1) as array_length,
          array_dims(ARRAY['A', 'B', 'C']::bpchar[]) as dimensions,
          array_upper(ARRAY['A', 'B', 'C']::bpchar[], 1) as upper_bound,
          array_lower(ARRAY['A', 'B', 'C']::bpchar[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("bpchar[] - string comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['abc'::char(5)] = ARRAY['abc  '::char(5)]::bpchar[] as equal_with_padding,
          ARRAY['abc'::char(5)] = ARRAY['def  '::char(5)]::bpchar[] as not_equal,
          ARRAY['abc'::char(5)] < ARRAY['def  '::char(5)]::bpchar[] as less_than,
          ARRAY['def'::char(5)] > ARRAY['abc  '::char(5)]::bpchar[] as greater_than
      `;

        expect(result[0].equal_with_padding).toBe(true);
        expect(result[0].not_equal).toBe(false);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });
    });

    describe("varchar[] Array type", () => {
      test("varchar[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::varchar[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("varchar[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['test']::varchar[] as single_value`;
        expect(result[0].single_value).toEqual(["test"]);
      });

      test("varchar[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'first',
          'second',
          'third'
        ]::varchar[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["first", "second", "third"]);
      });

      test("varchar[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'first',
          NULL,
          'third',
          NULL
        ]::varchar[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["first", null, "third", null]);
      });

      test("varchar[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::varchar[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("varchar[] - strings of different lengths", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '',                   -- empty string
          'a',                  -- single character
          'ab',                 -- two characters
          'test string',        -- with space
          'longer test string'  -- longer string
        ]::varchar[] as varying_lengths
      `;
        expect(result[0].varying_lengths).toEqual(["", "a", "ab", "test string", "longer test string"]);
      });

      test("varchar[] - with length specification", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'short'::varchar(10),
          'exactlyten'::varchar(10),
          'truncated_string'::varchar(10)
        ]::varchar[] as length_limited
      `;
        expect(result[0].length_limited).toEqual(["short", "exactlyten", "truncated_"]);
      });

      test("varchar[] - special characters", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          ' leading space',
          'trailing space ',
          '  multiple  spaces  ',
          'tab\there',
          'new\nline',
          'special@#$%chars'
        ]::varchar[] as special_chars
      `;
        expect(result[0].special_chars).toEqual([
          " leading space",
          "trailing space ",
          "  multiple  spaces  ",
          "tab\there",
          "new\nline",
          "special@#$%chars",
        ]);
      });

      test("varchar[] - unicode characters", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '你好',              -- Chinese
          'こんにちは',        -- Japanese
          'αβγ',              -- Greek
          'привет',           -- Russian
          '👋 🌍'             -- Emojis
        ]::varchar[] as unicode_chars
      `;
        expect(result[0].unicode_chars).toEqual(["你好", "こんにちは", "αβγ", "привет", "👋 🌍"]);
      });

      test("varchar[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['first', 'second', 'third']::varchar[])[1] as first_element,
          (ARRAY['first', 'second', 'third']::varchar[])[2] as second_element,
          (ARRAY['first', 'second', 'third']::varchar[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("first");
        expect(result[0].second_element).toBe("second");
        expect(result[0].third_element).toBe("third");
      });

      test("varchar[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['first', 'second']::varchar[] ||
          ARRAY['third']::varchar[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["first", "second", "third"]);
      });

      test("varchar[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['first', 'second', 'third']::varchar[], 1) as array_length,
          array_dims(ARRAY['first', 'second', 'third']::varchar[]) as dimensions,
          array_upper(ARRAY['first', 'second', 'third']::varchar[], 1) as upper_bound,
          array_lower(ARRAY['first', 'second', 'third']::varchar[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(3);
        expect(result[0].dimensions).toBe("[1:3]");
        expect(result[0].upper_bound).toBe(3);
        expect(result[0].lower_bound).toBe(1);
      });

      test("varchar[] - text pattern matching", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH test_array AS (
          SELECT ARRAY['test1', 'test2', 'other', 'test3']::varchar[] as values
        )
        SELECT
          array_agg(v ORDER BY v) FILTER (WHERE v LIKE 'test%') as filtered
        FROM test_array, unnest(values) as v
      `;

        expect(result[0].filtered).toEqual(["test1", "test2", "test3"]);
      });

      test("varchar[] - large strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const longString = "a".repeat(1000);
        const result = await sql`
        SELECT ARRAY[${longString}]::varchar[] as long_string_array
      `;

        expect(result[0].long_string_array[0].length).toBe(1000);
      });
    });

    describe("date[] Array type", () => {
      test("date[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::date[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("date[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['2024-01-01']::date[] as single_value`;
        expect(result[0].single_value.map(d => d.toISOString().split("T")[0])).toEqual(["2024-01-01"]);
      });

      test("date[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01',
          '2024-01-02',
          '2024-01-03'
        ]::date[] as multiple_values
      `;
        expect(result[0].multiple_values.map(d => d.toISOString().split("T")[0])).toEqual([
          "2024-01-01",
          "2024-01-02",
          "2024-01-03",
        ]);
      });

      test("date[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01',
          NULL,
          '2024-01-03',
          NULL
        ]::date[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls.map(d => (d ? d.toISOString().split("T")[0] : null))).toEqual([
          "2024-01-01",
          null,
          "2024-01-03",
          null,
        ]);
      });

      test("date[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::date[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("date[] - different date formats", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-15',                    -- ISO format
          '15-Jan-2024',                   -- Postgres format
          'Jan 15 2024',                   -- Postgres format
          'January 15 2024',               -- Postgres format
          '01/15/2024'                     -- US format (if DateStyle allows)
        ]::date[] as date_formats
      `;
        expect(result[0].date_formats.map(d => d.toISOString().split("T")[0])).toEqual([
          "2024-01-15",
          "2024-01-15",
          "2024-01-15",
          "2024-01-15",
          "2024-01-15",
        ]);
      });

      test("date[] - special dates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'infinity'::date,
          '-infinity'::date,
          'today'::date,
          'yesterday'::date,
          'tomorrow'::date
        ]::date[] as special_dates
      `;

        const values = result[0].special_dates;
        expect(values[0].toString()).toBe("Invalid Date");
        expect(values[1].toString()).toBe("Invalid Date");
        // Skip testing today/yesterday/tomorrow as they depend on current date
      });

      test("date[] - date calculations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-15'::date + '1 day'::interval,
          '2024-01-15'::date + '1 month'::interval,
          '2024-01-15'::date + '1 year'::interval,
          '2024-01-15'::date - '1 day'::interval
        ]::date[] as date_calcs
      `;
        expect(result[0].date_calcs.map(d => d.toISOString().split("T")[0])).toEqual([
          "2024-01-16",
          "2024-02-15",
          "2025-01-15",
          "2024-01-14",
        ]);
      });

      test("date[] - boundary dates", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '4713-01-01 BC',                 -- Earliest possible date
          '5874897-01-01',                 -- Latest possible date
          '1970-01-01',                    -- Unix epoch
          '2000-01-01',                    -- Y2K
          '9999-12-31'                     -- End of common range
        ]::date[] as boundary_dates
      `;

        expect(result[0].boundary_dates.map(d => (isNaN(d) ? "Invalid Date" : d.toISOString().split("T")[0]))).toEqual([
          "Invalid Date",
          "Invalid Date",
          "1970-01-01",
          "2000-01-01",
          "9999-12-31",
        ]);
      });

      test("date[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['2024-01-01', '2024-01-02', '2024-01-03']::date[])[1] as first_element,
          (ARRAY['2024-01-01', '2024-01-02', '2024-01-03']::date[])[2] as second_element,
          (ARRAY['2024-01-01', '2024-01-02', '2024-01-03']::date[])[3] as third_element
      `;

        expect(result[0].first_element.toISOString().split("T")[0]).toBe("2024-01-01");
        expect(result[0].second_element.toISOString().split("T")[0]).toBe("2024-01-02");
        expect(result[0].third_element.toISOString().split("T")[0]).toBe("2024-01-03");
      });

      test("date[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['2024-01-01', '2024-01-02']::date[] @>
          ARRAY['2024-01-01']::date[] as contains_first,

          ARRAY['2024-01-01', '2024-01-02']::date[] @>
          ARRAY['2024-01-02']::date[] as contains_second,

          ARRAY['2024-01-01', '2024-01-02']::date[] @>
          ARRAY['2024-01-03']::date[] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });

      test("date[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['2024-01-01', '2024-01-02']::date[] &&
          ARRAY['2024-01-02', '2024-01-03']::date[] as has_overlap,

          ARRAY['2024-01-01', '2024-01-02']::date[] &&
          ARRAY['2024-01-03', '2024-01-04']::date[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("date[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['2024-01-01', '2024-01-02']::date[] ||
          ARRAY['2024-01-03']::date[] as concatenated
      `;

        expect(result[0].concatenated.map(d => d.toISOString().split("T")[0])).toEqual([
          "2024-01-01",
          "2024-01-02",
          "2024-01-03",
        ]);
      });

      test("date[] - array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['2024-01-01', '2024-01-02']::date[] =
          ARRAY['2024-01-01', '2024-01-02']::date[] as equal_arrays,

          ARRAY['2024-01-01', '2024-01-02']::date[] <
          ARRAY['2024-01-02', '2024-01-02']::date[] as less_than,

          ARRAY['2024-01-02', '2024-01-02']::date[] >
          ARRAY['2024-01-01', '2024-01-02']::date[] as greater_than
      `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });

      test("date[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['2024-01-01', '2024-01-02']::date[], 1) as array_length,
          array_dims(ARRAY['2024-01-01', '2024-01-02']::date[]) as dimensions,
          array_upper(ARRAY['2024-01-01', '2024-01-02']::date[], 1) as upper_bound,
          array_lower(ARRAY['2024-01-01', '2024-01-02']::date[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("time[] Array type", () => {
      test("time[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::time[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("time[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['12:34:56']::time[] as single_value`;
        expect(result[0].single_value).toEqual(["12:34:56"]);
      });

      test("time[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:34:56',
          '15:45:32',
          '23:59:59'
        ]::time[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["12:34:56", "15:45:32", "23:59:59"]);
      });

      test("time[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:34:56',
          NULL,
          '15:45:32',
          NULL
        ]::time[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["12:34:56", null, "15:45:32", null]);
      });

      test("time[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::time[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("time[] - different time formats", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:34:56',              -- HH:MM:SS
          '12:34',                 -- HH:MM (defaults to 00 seconds)
          '12:34:56.789',          -- With milliseconds
          '12:34:56.789123',       -- With microseconds
          '1:2:3'                  -- Single digits (normalized to HH:MM:SS)
        ]::time[] as time_formats
      `;
        expect(result[0].time_formats).toEqual(["12:34:56", "12:34:00", "12:34:56.789", "12:34:56.789123", "01:02:03"]);
      });

      test("time[] - boundary times", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '00:00:00',              -- Midnight
          '23:59:59.999999',       -- Just before midnight
          '12:00:00',              -- Noon
          '00:00:00.000001'        -- Just after midnight
        ]::time[] as boundary_times
      `;
        expect(result[0].boundary_times).toEqual(["00:00:00", "23:59:59.999999", "12:00:00", "00:00:00.000001"]);
      });

      test("time[] - precision handling", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:34:56'::time(0),          -- Second precision
          '12:34:56.7'::time(1),        -- Decisecond precision
          '12:34:56.78'::time(2),       -- Centisecond precision
          '12:34:56.789'::time(3),      -- Millisecond precision
          '12:34:56.789123'::time(6)    -- Microsecond precision
        ]::time[] as time_precisions
      `;
        expect(result[0].time_precisions).toEqual([
          "12:34:56",
          "12:34:56.7",
          "12:34:56.78",
          "12:34:56.789",
          "12:34:56.789123",
        ]);
      });

      test("time[] - interval arithmetic", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:34:56'::time + '1 hour'::interval,
          '12:34:56'::time + '1 minute'::interval,
          '12:34:56'::time + '1 second'::interval,
          '12:34:56'::time - '1 hour'::interval
        ]::time[] as time_calculations
      `;
        expect(result[0].time_calculations).toEqual(["13:34:56", "12:35:56", "12:34:57", "11:34:56"]);
      });

      test("time[] - military time", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '00:00:00',     -- 24:00 normalizes to 00:00
          '13:00:00',     -- 1 PM
          '23:00:00'      -- 11 PM
        ]::time[] as military_times
      `;
        expect(result[0].military_times).toEqual(["00:00:00", "13:00:00", "23:00:00"]);
      });

      test("time[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['12:34:56', '15:45:32', '23:59:59']::time[])[1] as first_element,
          (ARRAY['12:34:56', '15:45:32', '23:59:59']::time[])[2] as second_element,
          (ARRAY['12:34:56', '15:45:32', '23:59:59']::time[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("12:34:56");
        expect(result[0].second_element).toBe("15:45:32");
        expect(result[0].third_element).toBe("23:59:59");
      });

      test("time[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['12:34:56', '15:45:32']::time[] ||
          ARRAY['23:59:59']::time[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["12:34:56", "15:45:32", "23:59:59"]);
      });

      test("time[] - array comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['12:34:56', '15:45:32']::time[] =
          ARRAY['12:34:56', '15:45:32']::time[] as equal_arrays,

          ARRAY['12:34:56', '15:45:32']::time[] <
          ARRAY['15:45:32', '15:45:32']::time[] as less_than,

          ARRAY['15:45:32', '15:45:32']::time[] >
          ARRAY['12:34:56', '15:45:32']::time[] as greater_than
      `;

        expect(result[0].equal_arrays).toBe(true);
        expect(result[0].less_than).toBe(true);
        expect(result[0].greater_than).toBe(true);
      });

      test("time[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['12:34:56', '15:45:32']::time[], 1) as array_length,
          array_dims(ARRAY['12:34:56', '15:45:32']::time[]) as dimensions,
          array_upper(ARRAY['12:34:56', '15:45:32']::time[], 1) as upper_bound,
          array_lower(ARRAY['12:34:56', '15:45:32']::time[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("timestamp[] Array type", () => {
      test("timestamp[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::timestamp[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("timestamp[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['2024-01-01 12:00:00']::timestamp[] as single_value`;
        expect(result[0].single_value[0].toISOString()).toBe("2024-01-01T12:00:00.000Z");
      });

      test("timestamp[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01 12:00:00',
          '2024-01-02 13:30:45',
          '2024-01-03 23:59:59'
        ]::timestamp[] as multiple_values
      `;
        expect(result[0].multiple_values.map(d => d.toISOString())).toEqual([
          "2024-01-01T12:00:00.000Z",
          "2024-01-02T13:30:45.000Z",
          "2024-01-03T23:59:59.000Z",
        ]);
      });

      test("timestamp[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01 12:00:00',
          NULL,
          '2024-01-03 23:59:59',
          NULL
        ]::timestamp[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls.map(d => d?.toISOString() || null)).toEqual([
          "2024-01-01T12:00:00.000Z",
          null,
          "2024-01-03T23:59:59.000Z",
          null,
        ]);
      });

      test("timestamp[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::timestamp[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("timestamp[] - different input formats", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-15 14:30:00',                   -- ISO format
          'January 15 2024 14:30:00',              -- Verbose format
          'Jan 15 2024 14:30:00',                  -- Abbreviated format
          '15-Jan-2024 14:30:00',                  -- Alternative format
          '01/15/2024 14:30:00'                    -- US format (if DateStyle allows)
        ]::timestamp[] as timestamp_formats
      `;

        // All should be normalized to the same timestamp
        const expected = "2024-01-15T14:30:00.000Z";
        expect(result[0].timestamp_formats.every(d => d.toISOString() === expected)).toBe(true);
      });

      test("timestamp[] - precision handling", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01 12:00:00',                    -- Second precision
          '2024-01-01 12:00:00.1',                  -- Decisecond precision
          '2024-01-01 12:00:00.12',                 -- Centisecond precision
          '2024-01-01 12:00:00.123',                -- Millisecond precision
          '2024-01-01 12:00:00.123456'              -- Microsecond precision
        ]::timestamp[] as timestamp_precisions
      `;

        expect(result[0].timestamp_precisions.map(d => d.toISOString())).toEqual([
          "2024-01-01T12:00:00.000Z",
          "2024-01-01T12:00:00.100Z",
          "2024-01-01T12:00:00.120Z",
          "2024-01-01T12:00:00.123Z",
          "2024-01-01T12:00:00.123Z", // JS Date only supports millisecond precision
        ]);
      });

      test("timestamp[] - special values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'infinity'::timestamp,
          '-infinity'::timestamp,
          'epoch'::timestamp                        -- 1970-01-01 00:00:00
        ]::timestamp[] as special_timestamps
      `;

        expect(result[0].special_timestamps[0].toString()).toBe("Invalid Date");
        expect(result[0].special_timestamps[1].toString()).toBe("Invalid Date");
        expect(result[0].special_timestamps[2].toISOString()).toBe("1970-01-01T00:00:00.000Z");
      });

      test("timestamp[] - interval arithmetic", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01 12:00:00'::timestamp + '1 day'::interval,
          '2024-01-01 12:00:00'::timestamp + '1 hour'::interval,
          '2024-01-01 12:00:00'::timestamp + '1 minute'::interval,
          '2024-01-01 12:00:00'::timestamp - '1 day'::interval
        ]::timestamp[] as timestamp_calcs
      `;

        expect(result[0].timestamp_calcs.map(d => d.toISOString())).toEqual([
          "2024-01-02T12:00:00.000Z",
          "2024-01-01T13:00:00.000Z",
          "2024-01-01T12:01:00.000Z",
          "2023-12-31T12:00:00.000Z",
        ]);
      });

      test("timestamp[] - boundary values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '4713-01-01 00:00:00 BC'::timestamp,     -- Earliest finite timestamp
          '294276-12-31 23:59:59.999999'::timestamp, -- Latest finite timestamp
          '1970-01-01 00:00:00'::timestamp,        -- Unix epoch
          '2000-01-01 00:00:00'::timestamp,        -- Y2K
          '9999-12-31 23:59:59.999999'::timestamp  -- End of common range
        ]::timestamp[] as boundary_timestamps
      `;

        expect(result[0].boundary_timestamps[2].toISOString()).toBe("1970-01-01T00:00:00.000Z"); // Unix epoch
        expect(result[0].boundary_timestamps[3].toISOString()).toBe("2000-01-01T00:00:00.000Z"); // Y2K
      });

      test("timestamp[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['2024-01-01 12:00:00', '2024-01-02 13:00:00']::timestamp[])[1] as first_element,
          (ARRAY['2024-01-01 12:00:00', '2024-01-02 13:00:00']::timestamp[])[2] as second_element
      `;

        expect(result[0].first_element.toISOString()).toBe("2024-01-01T12:00:00.000Z");
        expect(result[0].second_element.toISOString()).toBe("2024-01-02T13:00:00.000Z");
      });

      test("timestamp[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['2024-01-01 12:00:00', '2024-01-02 13:00:00']::timestamp[] ||
          ARRAY['2024-01-03 14:00:00']::timestamp[] as concatenated
      `;

        expect(result[0].concatenated.map(d => d.toISOString())).toEqual([
          "2024-01-01T12:00:00.000Z",
          "2024-01-02T13:00:00.000Z",
          "2024-01-03T14:00:00.000Z",
        ]);
      });

      test("timestamp[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['2024-01-01 12:00:00', '2024-01-02 13:00:00']::timestamp[], 1) as array_length,
          array_dims(ARRAY['2024-01-01 12:00:00', '2024-01-02 13:00:00']::timestamp[]) as dimensions,
          array_upper(ARRAY['2024-01-01 12:00:00', '2024-01-02 13:00:00']::timestamp[], 1) as upper_bound,
          array_lower(ARRAY['2024-01-01 12:00:00', '2024-01-02 13:00:00']::timestamp[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("timestamptz[] Array type", () => {
      test("timestamptz[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::timestamptz[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("timestamptz[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['2024-01-01 12:00:00+00']::timestamptz[] as single_value`;
        expect(result[0].single_value[0].toISOString()).toBe("2024-01-01T12:00:00.000Z");
      });

      test("timestamptz[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01 12:00:00+00',
          '2024-01-02 13:30:45+00',
          '2024-01-03 23:59:59+00'
        ]::timestamptz[] as multiple_values
      `;
        expect(result[0].multiple_values.map(d => d.toISOString())).toEqual([
          "2024-01-01T12:00:00.000Z",
          "2024-01-02T13:30:45.000Z",
          "2024-01-03T23:59:59.000Z",
        ]);
      });

      test("timestamptz[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01 12:00:00+00',
          NULL,
          '2024-01-03 23:59:59+00',
          NULL
        ]::timestamptz[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls.map(d => d?.toISOString() || null)).toEqual([
          "2024-01-01T12:00:00.000Z",
          null,
          "2024-01-03T23:59:59.000Z",
          null,
        ]);
      });

      test("timestamptz[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::timestamptz[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("timestamptz[] - different timezone inputs", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-15 12:00:00+00',                -- UTC
          '2024-01-15 12:00:00+05:30',             -- UTC+5:30 (India)
          '2024-01-15 12:00:00-05:00',             -- UTC-5 (Eastern)
          '2024-01-15 12:00:00+01:00',             -- UTC+1 (Central European)
          '2024-01-15 12:00:00+09:00'              -- UTC+9 (Japan)
        ]::timestamptz[] as timezone_formats
      `;

        expect(result[0].timezone_formats.map(d => d.toISOString())).toEqual([
          "2024-01-15T12:00:00.000Z",
          "2024-01-15T06:30:00.000Z", // UTC+5:30 converted to UTC
          "2024-01-15T17:00:00.000Z", // UTC-5 converted to UTC
          "2024-01-15T11:00:00.000Z", // UTC+1 converted to UTC
          "2024-01-15T03:00:00.000Z", // UTC+9 converted to UTC
        ]);
      });

      test("timestamptz[] - timezone conversions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-15 12:00:00 America/New_York'::timestamptz,
          '2024-01-15 17:00:00+00'::timestamptz
        ] as times
      `;

        // Both should represent the same moment in time
        expect(result[0].times[0].toISOString()).toBe("2024-01-15T17:00:00.000Z");
        expect(result[0].times[1].toISOString()).toBe("2024-01-15T17:00:00.000Z");
      });

      test("timestamptz[] - precision handling", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01 12:00:00+00',                    -- Second precision
          '2024-01-01 12:00:00.1+00',                  -- Decisecond precision
          '2024-01-01 12:00:00.12+00',                 -- Centisecond precision
          '2024-01-01 12:00:00.123+00',                -- Millisecond precision
          '2024-01-01 12:00:00.123456+00'              -- Microsecond precision
        ]::timestamptz[] as timestamp_precisions
      `;

        expect(result[0].timestamp_precisions.map(d => d.toISOString())).toEqual([
          "2024-01-01T12:00:00.000Z",
          "2024-01-01T12:00:00.100Z",
          "2024-01-01T12:00:00.120Z",
          "2024-01-01T12:00:00.123Z",
          "2024-01-01T12:00:00.123Z", // JS Date only supports millisecond precision
        ]);
      });

      test("timestamptz[] - special values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'infinity'::timestamptz,
          '-infinity'::timestamptz,
          '1970-01-01 00:00:00+00'::timestamptz        -- Unix epoch
        ]::timestamptz[] as special_timestamps
      `;

        expect(result[0].special_timestamps[0].toString()).toBe("Invalid Date");
        expect(result[0].special_timestamps[1].toString()).toBe("Invalid Date");
        expect(result[0].special_timestamps[2].toISOString()).toBe("1970-01-01T00:00:00.000Z");
      });

      test("timestamptz[] - interval arithmetic", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-01-01 12:00:00+00'::timestamptz + '1 day'::interval,
          '2024-01-01 12:00:00+00'::timestamptz + '1 hour'::interval,
          '2024-01-01 12:00:00+00'::timestamptz + '1 minute'::interval,
          '2024-01-01 12:00:00+00'::timestamptz - '1 day'::interval
        ]::timestamptz[] as timestamp_calcs
      `;

        expect(result[0].timestamp_calcs.map(d => d.toISOString())).toEqual([
          "2024-01-02T12:00:00.000Z",
          "2024-01-01T13:00:00.000Z",
          "2024-01-01T12:01:00.000Z",
          "2023-12-31T12:00:00.000Z",
        ]);
      });

      test("timestamptz[] - boundary values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '4713-01-01 00:00:00 BC+00'::timestamptz,     -- Earliest finite timestamp
          '294276-12-31 23:59:59.999999+00'::timestamptz, -- Latest finite timestamp
          '1970-01-01 00:00:00+00'::timestamptz,        -- Unix epoch
          '2000-01-01 00:00:00+00'::timestamptz         -- Y2K
        ]::timestamptz[] as boundary_timestamps
      `;

        expect(result[0].boundary_timestamps[2].toISOString()).toBe("1970-01-01T00:00:00.000Z"); // Unix epoch
        expect(result[0].boundary_timestamps[3].toISOString()).toBe("2000-01-01T00:00:00.000Z"); // Y2K
      });

      test("timestamptz[] - daylight saving time handling", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '2024-03-10 06:59:59+00',  -- 1:59:59 EST
          '2024-03-10 07:00:00+00',  -- 3:00:00 EDT (after spring forward)
          '2024-11-03 05:59:59+00',  -- 1:59:59 EDT
          '2024-11-03 06:00:00+00'   -- 1:00:00 EST (after fall back)
        ]::timestamptz[] as dst_times
      `;

        // Verify timestamps are in correct sequence
        const timestamps = result[0].dst_times.map(d => d.toISOString());
        expect(timestamps[1].localeCompare(timestamps[0])).toBe(1); // Second time should be later
        expect(timestamps[3].localeCompare(timestamps[2])).toBe(1); // Fourth time should be later
      });

      test("timestamptz[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[])[1] as first_element,
          (ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[])[2] as second_element
      `;

        expect(result[0].first_element.toISOString()).toBe("2024-01-01T12:00:00.000Z");
        expect(result[0].second_element.toISOString()).toBe("2024-01-02T13:00:00.000Z");
      });

      test("timestamptz[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[] @>
          ARRAY['2024-01-01 12:00:00+00']::timestamptz[] as contains_first,

          ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[] @>
          ARRAY['2024-01-02 13:00:00+00']::timestamptz[] as contains_second,

          ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[] @>
          ARRAY['2024-01-03 14:00:00+00']::timestamptz[] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });

      test("timestamptz[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[], 1) as array_length,
          array_dims(ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[]) as dimensions,
          array_upper(ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[], 1) as upper_bound,
          array_lower(ARRAY['2024-01-01 12:00:00+00', '2024-01-02 13:00:00+00']::timestamptz[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("timetz[] Array type", () => {
      test("timetz[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::timetz[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("timetz[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['12:00:00+00']::timetz[] as single_value`;
        expect(result[0].single_value).toEqual(["12:00:00+00"]);
      });

      test("timetz[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:00:00+00',
          '13:30:45+00',
          '23:59:59+00'
        ]::timetz[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["12:00:00+00", "13:30:45+00", "23:59:59+00"]);
      });

      test("timetz[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:00:00+00',
          NULL,
          '23:59:59+00',
          NULL
        ]::timetz[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["12:00:00+00", null, "23:59:59+00", null]);
      });

      test("timetz[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::timetz[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("timetz[] - different timezone offsets", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:00:00+00',                -- UTC
          '12:00:00+05:30',             -- UTC+5:30 (India)
          '12:00:00-05:00',             -- UTC-5 (Eastern)
          '12:00:00+01:00',             -- UTC+1 (Central European)
          '12:00:00+09:00'              -- UTC+9 (Japan)
        ]::timetz[] as timezone_formats
      `;
        expect(result[0].timezone_formats).toEqual([
          "12:00:00+00",
          "12:00:00+05:30",
          "12:00:00-05",
          "12:00:00+01",
          "12:00:00+09",
        ]);
      });

      test("timetz[] - precision handling", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '12:00:00+00',                    -- Second precision
          '12:00:00.1+00',                  -- Decisecond precision
          '12:00:00.12+00',                 -- Centisecond precision
          '12:00:00.123+00',                -- Millisecond precision
          '12:00:00.123456+00'              -- Microsecond precision
        ]::timetz[] as time_precisions
      `;
        expect(result[0].time_precisions).toEqual([
          "12:00:00+00",
          "12:00:00.1+00",
          "12:00:00.12+00",
          "12:00:00.123+00",
          "12:00:00.123456+00",
        ]);
      });

      test("timetz[] - boundary times", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '00:00:00+00',              -- Midnight UTC
          '23:59:59.999999+00',       -- Just before midnight UTC
          '12:00:00+00',              -- Noon UTC
          '00:00:00.000001+00'        -- Just after midnight UTC
        ]::timetz[] as boundary_times
      `;
        expect(result[0].boundary_times).toEqual([
          "00:00:00+00",
          "23:59:59.999999+00",
          "12:00:00+00",
          "00:00:00.000001+00",
        ]);
      });

      test("timetz[] - interval arithmetic", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          ('12:00:00+00'::timetz + '1 hour'::interval)::timetz,
          ('12:00:00+00'::timetz + '1 minute'::interval)::timetz,
          ('12:00:00+00'::timetz + '1 second'::interval)::timetz,
          ('12:00:00+00'::timetz - '1 hour'::interval)::timetz
        ] as time_calculations
      `;
        expect(result[0].time_calculations).toEqual(["13:00:00+00", "12:01:00+00", "12:00:01+00", "11:00:00+00"]);
      });

      test("timetz[] - military time", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '00:00:00+00',     -- 00:00 (midnight)
          '13:00:00+00',     -- 13:00 (1 PM)
          '23:00:00+00'      -- 23:00 (11 PM)
        ]::timetz[] as military_times
      `;
        expect(result[0].military_times).toEqual(["00:00:00+00", "13:00:00+00", "23:00:00+00"]);
      });

      test("timetz[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['12:00:00+00', '13:00:00+00']::timetz[])[1] as first_element,
          (ARRAY['12:00:00+00', '13:00:00+00']::timetz[])[2] as second_element
      `;

        expect(result[0].first_element).toBe("12:00:00+00");
        expect(result[0].second_element).toBe("13:00:00+00");
      });

      test("timetz[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['12:00:00+00', '13:00:00+00']::timetz[] @>
          ARRAY['12:00:00+00']::timetz[] as contains_first,

          ARRAY['12:00:00+00', '13:00:00+00']::timetz[] @>
          ARRAY['13:00:00+00']::timetz[] as contains_second,

          ARRAY['12:00:00+00', '13:00:00+00']::timetz[] @>
          ARRAY['14:00:00+00']::timetz[] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });

      test("timetz[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['12:00:00+00', '13:00:00+00']::timetz[] &&
          ARRAY['13:00:00+00', '14:00:00+00']::timetz[] as has_overlap,

          ARRAY['12:00:00+00', '13:00:00+00']::timetz[] &&
          ARRAY['14:00:00+00', '15:00:00+00']::timetz[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("timetz[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['12:00:00+00', '13:00:00+00']::timetz[] ||
          ARRAY['14:00:00+00']::timetz[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["12:00:00+00", "13:00:00+00", "14:00:00+00"]);
      });

      test("timetz[] - comparison of same time different zones", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['12:00:00+00', '13:00:00+00']::timetz[] =
          ARRAY['12:00:00+01', '13:00:00+01']::timetz[] as equal_arrays,

          ARRAY['12:00:00+00']::timetz[] =
          ARRAY['13:00:00+01']::timetz[] as different_times
      `;

        // Times with different zones are considered different even if they represent the same moment
        expect(result[0].equal_arrays).toBe(false);
        expect(result[0].different_times).toBe(false);
      });

      test("timetz[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['12:00:00+00', '13:00:00+00']::timetz[], 1) as array_length,
          array_dims(ARRAY['12:00:00+00', '13:00:00+00']::timetz[]) as dimensions,
          array_upper(ARRAY['12:00:00+00', '13:00:00+00']::timetz[], 1) as upper_bound,
          array_lower(ARRAY['12:00:00+00', '13:00:00+00']::timetz[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("interval[] Array type", () => {
      test("interval[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::interval[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("interval[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['1 year']::interval[] as single_value`;
        expect(result[0].single_value).toEqual(["1 year"]);
      });

      test("interval[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '1 year',
          '2 months',
          '3 days'
        ]::interval[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["1 year", "2 mons", "3 days"]);
      });

      test("interval[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '1 year',
          NULL,
          '3 days',
          NULL
        ]::interval[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["1 year", null, "3 days", null]);
      });

      test("interval[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::interval[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("interval[] - different units", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '1 year',
          '1 month',
          '1 week',
          '1 day',
          '1 hour',
          '1 minute',
          '1 second',
          '1 millisecond',
          '1 microsecond'
        ]::interval[] as different_units
      `;
        expect(result[0].different_units).toEqual([
          "1 year",
          "1 mon",
          "7 days",
          "1 day",
          "01:00:00",
          "00:01:00",
          "00:00:01",
          "00:00:00.001",
          "00:00:00.000001",
        ]);
      });

      test("interval[] - combined intervals", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '1 year 2 months 3 days',
          '1 day 2 hours 3 minutes 4 seconds',
          '2 weeks 3 days',
          '1 year 6 months'
        ]::interval[] as combined_intervals
      `;
        expect(result[0].combined_intervals).toEqual([
          "1 year 2 mons 3 days",
          "1 day 02:03:04",
          "17 days",
          "1 year 6 mons",
        ]);
      });

      test("interval[] - negative intervals", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '-1 year',
          '-2 months',
          '-3 days',
          '-1 hour',
          '-1 year -2 months -3 days'
        ]::interval[] as negative_intervals
      `;
        expect(result[0].negative_intervals).toEqual([
          "-1 years",
          "-2 mons",
          "-3 days",
          "-01:00:00",
          "-1 years -2 mons -3 days",
        ]);
      });

      test("interval[] - ISO 8601 format", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'P1Y',              -- 1 year
          'P1M',              -- 1 month
          'P1D',              -- 1 day
          'PT1H',             -- 1 hour
          'P1Y2M3DT4H5M6S'    -- Combined
        ]::interval[] as iso_intervals
      `;
        expect(result[0].iso_intervals).toEqual([
          "1 year",
          "1 mon",
          "1 day",
          "01:00:00",
          "1 year 2 mons 3 days 04:05:06",
        ]);
      });

      test("interval[] - arithmetic operations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '1 year'::interval + '2 months'::interval,
          '1 day'::interval * 2,
          '1 hour'::interval / 2,
          '2 hours'::interval - '1 hour'::interval
        ]::interval[] as interval_math
      `;
        expect(result[0].interval_math).toEqual(["1 year 2 mons", "2 days", "00:30:00", "01:00:00"]);
      });

      test("interval[] - justification", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          justify_hours('25:00:00'::interval),        -- Convert to days
          justify_days('30 days'::interval),          -- Convert to months
          justify_interval('1 year 25 months'::interval)  -- Normalize years and months
        ]::interval[] as justified_intervals
      `;
        expect(result[0].justified_intervals).toEqual(["1 day 01:00:00", "1 mon", "3 years 1 mon"]);
      });

      test("interval[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['1 year', '2 months']::interval[])[1] as first_element,
          (ARRAY['1 year', '2 months']::interval[])[2] as second_element
      `;

        expect(result[0].first_element).toBe("1 year");
        expect(result[0].second_element).toBe("2 mons");
      });

      test("interval[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['1 year', '2 months']::interval[] @>
          ARRAY['1 year']::interval[] as contains_first,

          ARRAY['1 year', '2 months']::interval[] @>
          ARRAY['2 months']::interval[] as contains_second,

          ARRAY['1 year', '2 months']::interval[] @>
          ARRAY['3 months']::interval[] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });

      test("interval[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['1 year', '2 months']::interval[] &&
          ARRAY['2 months', '3 months']::interval[] as has_overlap,

          ARRAY['1 year', '2 months']::interval[] &&
          ARRAY['3 months', '4 months']::interval[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("interval[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['1 year', '2 months']::interval[] ||
          ARRAY['3 days']::interval[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["1 year", "2 mons", "3 days"]);
      });

      test("interval[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['1 year', '2 months']::interval[], 1) as array_length,
          array_dims(ARRAY['1 year', '2 months']::interval[]) as dimensions,
          array_upper(ARRAY['1 year', '2 months']::interval[], 1) as upper_bound,
          array_lower(ARRAY['1 year', '2 months']::interval[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("bit[] Array type", () => {
      test("bit[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::bit[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("bit[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['1']::bit[] as single_value`;
        expect(result[0].single_value).toEqual(["1"]);
      });

      test("bit[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'1',
          B'0',
          B'1'
        ]::bit[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["1", "0", "1"]);
      });

      test("bit[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'1',
          NULL,
          B'0',
          NULL
        ]::bit[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["1", null, "0", null]);
      });

      test("bit[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::bit[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("bit[] - fixed length bits", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'000'::bit(3),
          B'111'::bit(3),
          B'101'::bit(3)
        ]::bit(3)[] as fixed_length_bits
      `;
        expect(result[0].fixed_length_bits).toEqual(["000", "111", "101"]);
      });

      test("bit[] - single bits in different formats", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '1'::bit(1),            -- String syntax
          B'1',                   -- Binary syntax
          '0'::bit(1),
          B'0'
        ]::bit(1)[] as single_bits
      `;
        expect(result[0].single_bits).toEqual(["1", "1", "0", "0"]);
      });

      test("bit[] - longer bit strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'10101010',              -- 8 bits
          B'1111000011110000',      -- 16 bits
          B'11111111111111111111'   -- 20 bits
        ]::bit(20)[] as long_bits
      `;
        // PostgreSQL pads shorter bit strings with zeros to match the declared length
        expect(result[0].long_bits).toEqual(["10101010000000000000", "11110000111100000000", "11111111111111111111"]);
      });

      test("bit[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY[B'101', B'111', B'000']::bit(3)[])[1] as first_element,
          (ARRAY[B'101', B'111', B'000']::bit(3)[])[2] as second_element,
          (ARRAY[B'101', B'111', B'000']::bit(3)[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("101");
        expect(result[0].second_element).toBe("111");
        expect(result[0].third_element).toBe("000");
      });

      test("bit[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[B'101', B'111']::bit(3)[] @> ARRAY[B'101']::bit(3)[] as contains_first,
          ARRAY[B'101', B'111']::bit(3)[] @> ARRAY[B'111']::bit(3)[] as contains_second,
          ARRAY[B'101', B'111']::bit(3)[] @> ARRAY[B'000']::bit(3)[] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });

      test("bit[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[B'101', B'111']::bit(3)[] &&
          ARRAY[B'111', B'000']::bit(3)[] as has_overlap,

          ARRAY[B'101', B'111']::bit(3)[] &&
          ARRAY[B'000', B'010']::bit(3)[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("bit[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[B'101', B'111']::bit(3)[] ||
          ARRAY[B'000']::bit(3)[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["101", "111", "000"]);
      });

      test("bit[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY[B'101', B'111']::bit(3)[], 1) as array_length,
          array_dims(ARRAY[B'101', B'111']::bit(3)[]) as dimensions,
          array_upper(ARRAY[B'101', B'111']::bit(3)[], 1) as upper_bound,
          array_lower(ARRAY[B'101', B'111']::bit(3)[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("varbit[] Array type", () => {
      test("varbit[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::varbit[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("varbit[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['1']::varbit[] as single_value`;
        expect(result[0].single_value).toEqual(["1"]);
      });

      test("varbit[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'1',
          B'0',
          B'1'
        ]::varbit[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["1", "0", "1"]);
      });

      test("varbit[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'1',
          NULL,
          B'0',
          NULL
        ]::varbit[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["1", null, "0", null]);
      });

      test("varbit[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::varbit[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("varbit[] - varying length bits", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'0',                -- 1 bit
          B'10',              -- 2 bits
          B'101',             -- 3 bits
          B'1010',            -- 4 bits
          B'10101'            -- 5 bits
        ]::varbit[] as varying_length_bits
      `;
        expect(result[0].varying_length_bits).toEqual(["0", "10", "101", "1010", "10101"]);
      });

      test("varbit[] - different input formats", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '101'::varbit,          -- String cast
          B'101',                 -- Binary literal
          varbit '101',           -- Explicit type
          '101'::bit VARYING      -- Alternative syntax
        ]::varbit[] as format_variations
      `;
        expect(result[0].format_variations).toEqual(["101", "101", "101", "101"]);
      });

      test("varbit[] - longer bit strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'10101010',                      -- 8 bits
          B'1111000011110000',              -- 16 bits
          B'11111111111111111111',          -- 20 bits
          B'1010101010101010101010101010'   -- 28 bits
        ]::varbit[] as long_bits
      `;
        expect(result[0].long_bits).toEqual([
          "10101010",
          "1111000011110000",
          "11111111111111111111",
          "1010101010101010101010101010",
        ]);
      });

      test("varbit[] - bit string operations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'101' & B'100',      -- AND
          B'101' | B'010',      -- OR
          B'101' # B'110',      -- XOR
          ~B'101'::varbit,      -- NOT
          B'101' << 1,          -- Left shift
          B'101' >> 1           -- Right shift
        ]::varbit[] as bit_operations
      `;
        expect(result[0].bit_operations).toEqual(["100", "111", "011", "010", "010", "010"]);
      });

      test("varbit[] - concatenation of bits", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          B'101' || B'111',           -- Direct concatenation
          B'000' || B'1',             -- Different lengths
          B'1' || B'0' || B'1'        -- Multiple concatenation
        ]::varbit[] as bit_concatenation
      `;
        expect(result[0].bit_concatenation).toEqual(["101111", "0001", "101"]);
      });

      test("varbit[] - substring operations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          substring(B'10101' from 1 for 3),    -- First 3 bits
          substring(B'10101' from 2),          -- From position 2 to end
          substring(B'10101' from 3 for 2)     -- 2 bits from position 3
        ]::varbit[] as bit_substrings
      `;
        expect(result[0].bit_substrings).toEqual(["101", "0101", "10"]);
      });

      test("varbit[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY[B'101', B'11', B'1']::varbit[])[1] as first_element,
          (ARRAY[B'101', B'11', B'1']::varbit[])[2] as second_element,
          (ARRAY[B'101', B'11', B'1']::varbit[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("101");
        expect(result[0].second_element).toBe("11");
        expect(result[0].third_element).toBe("1");
      });

      test("varbit[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[B'101', B'11']::varbit[] @> ARRAY[B'101']::varbit[] as contains_first,
          ARRAY[B'101', B'11']::varbit[] @> ARRAY[B'11']::varbit[] as contains_second,
          ARRAY[B'101', B'11']::varbit[] @> ARRAY[B'1111']::varbit[] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });

      test("varbit[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[B'101', B'11']::varbit[] &&
          ARRAY[B'11', B'1']::varbit[] as has_overlap,

          ARRAY[B'101', B'11']::varbit[] &&
          ARRAY[B'000', B'0000']::varbit[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("varbit[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[B'101', B'11']::varbit[] ||
          ARRAY[B'1']::varbit[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["101", "11", "1"]);
      });

      test("varbit[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY[B'101', B'11']::varbit[], 1) as array_length,
          array_dims(ARRAY[B'101', B'11']::varbit[]) as dimensions,
          array_upper(ARRAY[B'101', B'11']::varbit[], 1) as upper_bound,
          array_lower(ARRAY[B'101', B'11']::varbit[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });
    });

    describe("numeric[] Array type", () => {
      test("numeric[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::numeric[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("numeric[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[1.23]::numeric[] as single_value`;
        expect(result[0].single_value).toEqual(["1.23"]);
      });

      test("numeric[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.23,
          4.56,
          7.89
        ]::numeric[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual(["1.23", "4.56", "7.89"]);
      });

      test("numeric[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.23,
          NULL,
          4.56,
          NULL
        ]::numeric[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual(["1.23", null, "4.56", null]);
      });

      test("numeric[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::numeric[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("numeric[] - different precisions and scales", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.23::numeric(5,2),              -- 5 total digits, 2 decimal places
          123.456::numeric(6,3),           -- 6 total digits, 3 decimal places
          1.2345678::numeric(10,7),        -- 10 total digits, 7 decimal places
          12345::numeric(5,0)              -- 5 digits, no decimal places
        ]::numeric[] as different_precisions
      `;
        expect(result[0].different_precisions).toEqual(["1.23", "123.456", "1.2345678", "12345"]);
      });

      test("numeric[] - integer values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          0,
          123,
          -456,
          789012345678901234567890        -- Very large integer
        ]::numeric[] as integer_values
      `;
        expect(result[0].integer_values).toEqual(["0", "123", "-456", "789012345678901234567890"]);
      });

      test("numeric[] - decimal values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          0.0,
          1.23,
          -4.56,
          0.000000001,                     -- Very small decimal
          123456789.987654321              -- Large decimal
        ]::numeric[] as decimal_values
      `;
        expect(result[0].decimal_values).toEqual(["0.0", "1.23", "-4.56", "0.000000001", "123456789.987654321"]);
      });

      test("numeric[] - special representations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          0.00001,                         -- Scientific notation in output
          1e-5,                           -- Scientific notation input
          1.23e5,                         -- Positive exponent
          1.23e-5                         -- Negative exponent
        ]::numeric[] as special_formats
      `;
        expect(result[0].special_formats).toEqual(["0.00001", "0.00001", "123000", "0.0000123"]);
      });

      test("numeric[] - rounding behavior", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.234::numeric(3,2),            -- Rounds to 1.23
          1.235::numeric(3,2),            -- Rounds to 1.24
          -1.234::numeric(3,2),           -- Rounds to -1.23
          -1.235::numeric(3,2)            -- Rounds to -1.24
        ]::numeric[] as rounded_values
      `;
        expect(result[0].rounded_values).toEqual(["1.23", "1.24", "-1.23", "-1.24"]);
      });

      test("numeric[] - arithmetic operations", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          1.23 + 4.56,
          1.23 - 4.56,
          1.23 * 4.56,
          5.00 / 2.00,
          5.00 % 2.00,                     -- Modulo
          abs(-1.23),                      -- Absolute value
          round(1.23456, 2)               -- Round to 2 decimal places
        ]::numeric[] as arithmetic_results
      `;
        expect(result[0].arithmetic_results).toEqual([
          "5.79",
          "-3.33",
          "5.6088",
          "2.5000000000000000",
          "1.00",
          "1.23",
          "1.23",
        ]);
      });

      test("numeric[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY[1.23, 4.56, 7.89]::numeric[])[1] as first_element,
          (ARRAY[1.23, 4.56, 7.89]::numeric[])[2] as second_element,
          (ARRAY[1.23, 4.56, 7.89]::numeric[])[3] as third_element
      `;

        expect(result[0].first_element).toBe("1.23");
        expect(result[0].second_element).toBe("4.56");
        expect(result[0].third_element).toBe("7.89");
      });

      test("numeric[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.23, 4.56]::numeric[] @> ARRAY[1.23]::numeric[] as contains_first,
          ARRAY[1.23, 4.56]::numeric[] @> ARRAY[4.56]::numeric[] as contains_second,
          ARRAY[1.23, 4.56]::numeric[] @> ARRAY[7.89]::numeric[] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });

      test("numeric[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.23, 4.56]::numeric[] &&
          ARRAY[4.56, 7.89]::numeric[] as has_overlap,

          ARRAY[1.23, 4.56]::numeric[] &&
          ARRAY[7.89, 0.12]::numeric[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("numeric[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY[1.23, 4.56]::numeric[] ||
          ARRAY[7.89]::numeric[] as concatenated
      `;

        expect(result[0].concatenated).toEqual(["1.23", "4.56", "7.89"]);
      });

      test("numeric[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY[1.23, 4.56]::numeric[], 1) as array_length,
          array_dims(ARRAY[1.23, 4.56]::numeric[]) as dimensions,
          array_upper(ARRAY[1.23, 4.56]::numeric[], 1) as upper_bound,
          array_lower(ARRAY[1.23, 4.56]::numeric[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });

      test("numeric[] - aggregate functions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        WITH numbers AS (
          SELECT unnest(ARRAY[1.23, 4.56, 7.89]::numeric[]) as num
        )
        SELECT
          sum(num) as total,
          avg(num) as average,
          min(num) as minimum,
          max(num) as maximum,
          count(num) as count
        FROM numbers
      `;

        expect(result[0].total).toBe("13.68");
        expect(result[0].average).toBe("4.5600000000000000");
        expect(result[0].minimum).toBe("1.23");
        expect(result[0].maximum).toBe("7.89");
        expect(result[0].count).toBe("3");
      });
    });

    describe("jsonb[] Array type", () => {
      test("jsonb[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::jsonb[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("jsonb[] - single value", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY['{"key": "value"}']::jsonb[] as single_value`;
        expect(result[0].single_value).toEqual([{ "key": "value" }]);
      });

      test("jsonb[] - multiple values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"a": 1}',
          '{"b": 2}',
          '{"c": 3}'
        ]::jsonb[] as multiple_values
      `;
        expect(result[0].multiple_values).toEqual([{ "a": 1 }, { "b": 2 }, { "c": 3 }]);
      });

      test("jsonb[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"a": 1}'::jsonb,
          NULL,
          '{"c": 3}'::jsonb,
          NULL
        ]::jsonb[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls).toEqual([{ "a": 1 }, null, { "c": 3 }, null]);
      });

      test("jsonb[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::jsonb[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });

      test("jsonb[] - different json types", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          'null'::jsonb,                          -- null
          'true'::jsonb,                          -- boolean
          '123'::jsonb,                           -- number
          '"string"'::jsonb,                      -- string
          '{"key": "value"}'::jsonb,              -- object
          '[1, 2, 3]'::jsonb                      -- array
        ]::jsonb[] as json_types
      `;
        expect(result[0].json_types).toEqual([null, true, 123, "string", { "key": "value" }, [1, 2, 3]]);
      });

      test("jsonb[] - nested structures", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"outer": {"inner": "value"}}'::jsonb,
          '{"array": [1, {"nested": "object"}, [1, 2, 3]]}'::jsonb,
          '{"mixed": {"array": [1, 2], "object": {"key": "value"}}}'::jsonb
        ]::jsonb[] as nested_structures
      `;
        expect(result[0].nested_structures).toEqual([
          { "outer": { "inner": "value" } },
          { "array": [1, { "nested": "object" }, [1, 2, 3]] },
          { "mixed": { "array": [1, 2], "object": { "key": "value" } } },
        ]);
      });

      test("jsonb[] - key ordering", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"b": 2, "a": 1}'::jsonb,             -- Keys in reverse order
          '{"a": 1, "b": 2}'::jsonb              -- Keys in normal order
        ]::jsonb[] as ordered_keys
      `;
        // JSONB normalizes key order
        expect(result[0].ordered_keys[0]).toEqual(result[0].ordered_keys[1]);
      });

      test("jsonb[] - whitespace handling", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"key" :   "value"}'::jsonb,          -- Extra spaces
          '{\n"key"\n:\n"value"\n}'::jsonb,      -- Newlines
          '{ "key" : "value" }'::jsonb           -- Spaces around braces
        ]::jsonb[] as whitespace_variants
      `;
        // JSONB normalizes whitespace
        expect(result[0].whitespace_variants).toEqual([{ "key": "value" }, { "key": "value" }, { "key": "value" }]);
      });

      test("jsonb[] - array operators", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          '{"a": 1, "b": 2}'::jsonb ? 'a' as has_key_a,
          '{"a": 1, "b": 2}'::jsonb ? 'c' as has_key_c,
          '{"a": 1, "b": 2}'::jsonb @> '{"a": 1}'::jsonb as contains_object,
          '{"a": 1, "b": 2}'::jsonb <@ '{"a": 1, "b": 2, "c": 3}'::jsonb as contained_by
      `;

        expect(result[0].has_key_a).toBe(true);
        expect(result[0].has_key_c).toBe(false);
        expect(result[0].contains_object).toBe(true);
        expect(result[0].contained_by).toBe(true);
      });

      test("jsonb[] - json path expressions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"a": {"b": {"c": "value"}}}'::jsonb -> 'a' -> 'b' ->> 'c',
          '{"array": [1, 2, 3]}'::jsonb -> 'array' -> 0,
          '{"nested": {"array": [{"key": "value"}]}}'::jsonb #> '{nested,array,0}' ->> 'key'
        ]::text[] as path_expressions
      `;

        expect(result[0].path_expressions).toEqual(["value", "1", "value"]);
      });

      test("jsonb[] - array element access", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          (ARRAY['{"a": 1}', '{"b": 2}']::jsonb[])[1] as first_element,
          (ARRAY['{"a": 1}', '{"b": 2}']::jsonb[])[2] as second_element
      `;

        expect(result[0].first_element).toEqual({ "a": 1 });
        expect(result[0].second_element).toEqual({ "b": 2 });
      });

      test("jsonb[] - array contains operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['{"a": 1}', '{"b": 2}']::jsonb[] @>
          ARRAY['{"a": 1}']::jsonb[] as contains_first,

          ARRAY['{"a": 1}', '{"b": 2}']::jsonb[] @>
          ARRAY['{"b": 2}']::jsonb[] as contains_second,

          ARRAY['{"a": 1}', '{"b": 2}']::jsonb[] @>
          ARRAY['{"c": 3}']::jsonb[] as contains_none
      `;

        expect(result[0].contains_first).toBe(true);
        expect(result[0].contains_second).toBe(true);
        expect(result[0].contains_none).toBe(false);
      });

      test("jsonb[] - array overlap operator", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['{"a": 1}', '{"b": 2}']::jsonb[] &&
          ARRAY['{"b": 2}', '{"c": 3}']::jsonb[] as has_overlap,

          ARRAY['{"a": 1}', '{"b": 2}']::jsonb[] &&
          ARRAY['{"c": 3}', '{"d": 4}']::jsonb[] as no_overlap
      `;

        expect(result[0].has_overlap).toBe(true);
        expect(result[0].no_overlap).toBe(false);
      });

      test("jsonb[] - array concatenation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          ARRAY['{"a": 1}', '{"b": 2}']::jsonb[] ||
          ARRAY['{"c": 3}']::jsonb[] as concatenated
      `;

        expect(result[0].concatenated).toEqual([{ "a": 1 }, { "b": 2 }, { "c": 3 }]);
      });

      test("jsonb[] - array dimensions", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          array_length(ARRAY['{"a": 1}', '{"b": 2}']::jsonb[], 1) as array_length,
          array_dims(ARRAY['{"a": 1}', '{"b": 2}']::jsonb[]) as dimensions,
          array_upper(ARRAY['{"a": 1}', '{"b": 2}']::jsonb[], 1) as upper_bound,
          array_lower(ARRAY['{"a": 1}', '{"b": 2}']::jsonb[], 1) as lower_bound
      `;

        expect(result[0].array_length).toBe(2);
        expect(result[0].dimensions).toBe("[1:2]");
        expect(result[0].upper_bound).toBe(2);
        expect(result[0].lower_bound).toBe(1);
      });

      test("jsonb[] - unicode characters in strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"text": "Hello 世界"}'::jsonb,
          '{"text": "Привет мир"}'::jsonb,
          '{"text": "안녕하세요"}'::jsonb,
          '{"text": "مرحبا بالعالم"}'::jsonb,
          '{"text": "👋 🌍 😊"}'::jsonb
        ]::jsonb[] as unicode_strings
      `;

        expect(result[0].unicode_strings).toEqual([
          { "text": "Hello 世界" },
          { "text": "Привет мир" },
          { "text": "안녕하세요" },
          { "text": "مرحبا بالعالم" },
          { "text": "👋 🌍 😊" },
        ]);
      });

      test("jsonb[] - unicode escape sequences", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"text": "\\u0041\\u0042\\u0043"}'::jsonb,                -- ABC
          '{"text": "\\u00A9\\u00AE\\u2122"}'::jsonb,                -- ©®™
          '{"text": "\\u0048\\u0065\\u006C\\u006C\\u006F"}'::jsonb,  -- Hello
          '{"text": "\\uD83D\\uDC4B"}'::jsonb                        -- 👋 (surrogate pair)
        ]::jsonb[] as escaped_unicode
      `;

        expect(result[0].escaped_unicode).toEqual([
          { "text": "ABC" },
          { "text": "©®™" },
          { "text": "Hello" },
          { "text": "👋" },
        ]);
      });

      test("jsonb[] - mixed unicode and escape sequences", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"hello\\u4E16\\u754C": "你好世界"}'::jsonb,              -- Mixed escaped and raw
          '{"text": "Hello\\u0020世界"}'::jsonb,                     -- Escaped space with unicode
          '{"\\u0041\\u0042\\u0043": "エービーシー"}'::jsonb         -- Escaped key with unicode value
        ]::jsonb[] as mixed_unicode
      `;

        expect(result[0].mixed_unicode).toEqual([
          { "hello世界": "你好世界" },
          { "text": "Hello 世界" },
          { "ABC": "エービーシー" },
        ]);
      });

      test("jsonb[] - unicode in nested structures", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          '{"outer": {"世界": {"内部": "value"}}}'::jsonb,
          '{"array": ["你好", {"키": "값"}, ["สวัสดี"]]}'::jsonb,
          '{"mixed": {"配列": ["こんにちは", "안녕"], "オブジェクト": {"키": "값"}}}'::jsonb
        ]::jsonb[] as nested_unicode
      `;

        expect(result[0].nested_unicode).toEqual([
          { "outer": { "世界": { "内部": "value" } } },
          { "array": ["你好", { "키": "값" }, ["สวัสดี"]] },
          { "mixed": { "配列": ["こんにちは", "안녕"], "オブジェクト": { "키": "값" } } },
        ]);
      });

      test("jsonb[] - unicode objects comparison", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT
          '{"键": "值", "キー": "値"}'::jsonb =
          '{"キー": "値", "键": "值"}'::jsonb as equal_objects,

          '{"配列": [1, 2]}'::jsonb @>
          '{"配列": [1]}'::jsonb as contains_check
      `;

        expect(result[0].equal_objects).toBe(true);
        expect(result[0].contains_check).toBe(true);
      });

      test("jsonb[] - large unicode content", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          json_build_object(
            '長いテキスト', repeat('あ', 1000),
            '긴텍스트', repeat('가', 1000),
            '长文本', repeat('好', 1000)
          )::jsonb
        ]::jsonb[] as large_unicode
      `;

        expect(result[0].large_unicode[0]["長いテキスト"].length).toBe(1000);
        expect(result[0].large_unicode[0]["긴텍스트"].length).toBe(1000);
        expect(result[0].large_unicode[0]["长文本"].length).toBe(1000);
      });
    });

    describe("pg_database[] Array type", () => {
      test("pg_database[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::pg_database[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("pg_database[] - system databases", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT array_agg(d.*)::pg_database[] FROM pg_database d;`;
        expect(result[0].array_agg[0]).toContain(",postgres,");
      });

      test("pg_database[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          NULL,
          '(5,postgres,10,6,c,f,t,-1,716,1,1663,C,C,,,)'::pg_database,
          NULL
        ]::pg_database[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls[0]).toBeNull();
        expect(result[0].array_with_nulls[1]).toBe("(5,postgres,10,6,c,f,t,-1,716,1,1663,C,C,,,)");
        expect(result[0].array_with_nulls[2]).toBeNull();
      });

      test("pg_database[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::pg_database[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });
    });

    describe("aclitem[] Array type", () => {
      test("aclitem[] - empty array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT ARRAY[]::aclitem[] as empty_array`;
        expect(result[0].empty_array).toEqual([]);
      });

      test("aclitem[] system databases", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT datacl FROM pg_database ORDER BY datname;`;
        // Find the bun_sql_test database - it should be near the end
        const bunDb = result.find(
          (r: any) => r.datacl && r.datacl.some((acl: string) => acl.includes("bun_sql_test=CTc/bun_sql_test")),
        );
        expect(bunDb).toBeDefined();
        // Check that it has the expected ACL entries (may have additional users in postgres_auth)
        expect(bunDb.datacl).toContain("=Tc/bun_sql_test");
        expect(bunDb.datacl).toContain("bun_sql_test=CTc/bun_sql_test");
      });

      test("aclitem[] - null values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`
        SELECT ARRAY[
          NULL,
          '=c/postgres'::aclitem,
          NULL
        ]::aclitem[] as array_with_nulls
      `;
        expect(result[0].array_with_nulls[0]).toBeNull();
        expect(result[0].array_with_nulls[1]).toBe("=c/postgres");
        expect(result[0].array_with_nulls[2]).toBeNull();
      });

      test("aclitem[] - null array", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const result = await sql`SELECT NULL::aclitem[] as null_array`;
        expect(result[0].null_array).toBeNull();
      });
    });

    describe("numeric", () => {
      test("handles standard decimal numbers", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (area text, price NUMERIC(10,4))`;

        const body = [
          { area: "D", price: "0.00001" }, // should collapse to 0
          { area: "D", price: "0.0001" },
          { area: "D", price: "0.0010" },
          { area: "D", price: "0.0100" },
          { area: "D", price: "0.1000" },
          { area: "D", price: "1.0000" },
          { area: "D", price: "10.0000" },
          { area: "D", price: "100.0000" },
          { area: "D", price: "1000.0000" },
          { area: "D", price: "10000.0000" },
          { area: "D", price: "100000.0000" },

          { area: "D", price: "1.1234" },
          { area: "D", price: "10.1234" },
          { area: "D", price: "100.1234" },
          { area: "D", price: "1000.1234" },
          { area: "D", price: "10000.1234" },
          { area: "D", price: "100000.1234" },

          { area: "D", price: "1.1234" },
          { area: "D", price: "10.1234" },
          { area: "D", price: "101.1234" },
          { area: "D", price: "1010.1234" },
          { area: "D", price: "10100.1234" },
          { area: "D", price: "101000.1234" },

          { area: "D", price: "999999.9999" }, // limit of NUMERIC(10,4)

          // negative numbers
          { area: "D", price: "-0.00001" }, // should collapse to 0
          { area: "D", price: "-0.0001" },
          { area: "D", price: "-0.0010" },
          { area: "D", price: "-0.0100" },
          { area: "D", price: "-0.1000" },
          { area: "D", price: "-1.0000" },
          { area: "D", price: "-10.0000" },
          { area: "D", price: "-100.0000" },
          { area: "D", price: "-1000.0000" },
          { area: "D", price: "-10000.0000" },
          { area: "D", price: "-100000.0000" },

          { area: "D", price: "-1.1234" },
          { area: "D", price: "-10.1234" },
          { area: "D", price: "-100.1234" },
          { area: "D", price: "-1000.1234" },
          { area: "D", price: "-10000.1234" },
          { area: "D", price: "-100000.1234" },

          { area: "D", price: "-1.1234" },
          { area: "D", price: "-10.1234" },
          { area: "D", price: "-101.1234" },
          { area: "D", price: "-1010.1234" },
          { area: "D", price: "-10100.1234" },
          { area: "D", price: "-101000.1234" },

          { area: "D", price: "-999999.9999" }, // limit of NUMERIC(10,4)

          // NaN
          { area: "D", price: "NaN" },
        ];
        const results = await sql`INSERT INTO ${sql(random_name)} ${sql(body)} RETURNING *`;
        expect(results[0].price).toEqual("0");
        expect(results[1].price).toEqual("0.0001");
        expect(results[2].price).toEqual("0.0010");
        expect(results[3].price).toEqual("0.0100");
        expect(results[4].price).toEqual("0.1000");
        expect(results[5].price).toEqual("1.0000");
        expect(results[6].price).toEqual("10.0000");
        expect(results[7].price).toEqual("100.0000");
        expect(results[8].price).toEqual("1000.0000");
        expect(results[9].price).toEqual("10000.0000");
        expect(results[10].price).toEqual("100000.0000");

        expect(results[11].price).toEqual("1.1234");
        expect(results[12].price).toEqual("10.1234");
        expect(results[13].price).toEqual("100.1234");
        expect(results[14].price).toEqual("1000.1234");
        expect(results[15].price).toEqual("10000.1234");
        expect(results[16].price).toEqual("100000.1234");

        expect(results[17].price).toEqual("1.1234");
        expect(results[18].price).toEqual("10.1234");
        expect(results[19].price).toEqual("101.1234");
        expect(results[20].price).toEqual("1010.1234");
        expect(results[21].price).toEqual("10100.1234");
        expect(results[22].price).toEqual("101000.1234");

        expect(results[23].price).toEqual("999999.9999");

        // negative numbers
        expect(results[24].price).toEqual("0");
        expect(results[25].price).toEqual("-0.0001");
        expect(results[26].price).toEqual("-0.0010");
        expect(results[27].price).toEqual("-0.0100");
        expect(results[28].price).toEqual("-0.1000");
        expect(results[29].price).toEqual("-1.0000");
        expect(results[30].price).toEqual("-10.0000");
        expect(results[31].price).toEqual("-100.0000");
        expect(results[32].price).toEqual("-1000.0000");
        expect(results[33].price).toEqual("-10000.0000");
        expect(results[34].price).toEqual("-100000.0000");

        expect(results[35].price).toEqual("-1.1234");
        expect(results[36].price).toEqual("-10.1234");
        expect(results[37].price).toEqual("-100.1234");
        expect(results[38].price).toEqual("-1000.1234");
        expect(results[39].price).toEqual("-10000.1234");
        expect(results[40].price).toEqual("-100000.1234");

        expect(results[41].price).toEqual("-1.1234");
        expect(results[42].price).toEqual("-10.1234");
        expect(results[43].price).toEqual("-101.1234");
        expect(results[44].price).toEqual("-1010.1234");
        expect(results[45].price).toEqual("-10100.1234");
        expect(results[46].price).toEqual("-101000.1234");

        expect(results[47].price).toEqual("-999999.9999");

        expect(results[48].price).toEqual("NaN");
      });
      test("handle different scales", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (area text, price NUMERIC(20,10))`;
        const body = [{ area: "D", price: "1010001010.1234" }];
        const results = await sql`INSERT INTO ${sql(random_name)} ${sql(body)} RETURNING *`;
        expect(results[0].price).toEqual("1010001010.1234000000");
      });
      test("handles leading zeros", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (area text, price NUMERIC(10,4))`;
        const body = [
          { area: "A", price: "00001.00045" }, // should collapse to 1.0005
          { area: "B", price: "0000.12345" }, // should collapse to 0.1235
        ];
        const results = await sql`INSERT INTO ${sql(random_name)} ${sql(body)} RETURNING *`;
        expect(results[0].price).toBe("1.0005");
        expect(results[1].price).toBe("0.1235");
      });

      test("handles numbers at scale boundaries", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (area text, price NUMERIC(10,4))`;
        const body = [
          { area: "C", price: "999999.9999" }, // Max for NUMERIC(10,4)
          { area: "D", price: "0.0001" }, // Min positive for 4 decimals
        ];
        const results = await sql`INSERT INTO ${sql(random_name)} ${sql(body)} RETURNING *`;
        expect(results[0].price).toBe("999999.9999");
        expect(results[1].price).toBe("0.0001");
      });

      test("handles zero values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (area text, price NUMERIC(10,4))`;
        const body = [
          { area: "E", price: "0" },
          { area: "F", price: "0.0000" },
          { area: "G", price: "00000.0000" },
        ];
        const results = await sql`INSERT INTO ${sql(random_name)} ${sql(body)} RETURNING *`;
        results.forEach(row => {
          expect(row.price).toBe("0");
        });
      });

      test("handles negative numbers", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (area text, price NUMERIC(10,4))`;
        const body = [
          { area: "H", price: "-1.2345" },
          { area: "I", price: "-0.0001" },
          { area: "J", price: "-9999.9999" },
        ];
        const results = await sql`INSERT INTO ${sql(random_name)} ${sql(body)} RETURNING *`;
        expect(results[0].price).toBe("-1.2345");
        expect(results[1].price).toBe("-0.0001");
        expect(results[2].price).toBe("-9999.9999");
      });

      test("handles scientific notation", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (area text, price NUMERIC(10,4))`;
        const body = [
          { area: "O", price: "1.2345e1" }, // 12.345
          { area: "P", price: "1.2345e-2" }, // 0.012345
        ];
        const results = await sql`INSERT INTO ${sql(random_name)} ${sql(body)} RETURNING *`;
        expect(results[0].price).toBe("12.3450");
        expect(results[1].price).toBe("0.0123");
      });
    });

    describe("helpers", () => {
      test("insert helper", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const result = await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })} RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("John");
        expect(result[0].age).toBe(30);
      });

      test("insert into with select helper using where IN", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        {
          await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
          const result =
            await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })} RETURNING *`;
          expect(result[0].id).toBe(1);
          expect(result[0].name).toBe("John");
          expect(result[0].age).toBe(30);
        }
        {
          const result =
            await sql`INSERT INTO ${sql(random_name)} (id, name, age) SELECT id, name, age FROM ${sql(random_name)} WHERE id IN ${sql([1, 2])} RETURNING *`;
          expect(result[0].id).toBe(1);
          expect(result[0].name).toBe("John");
          expect(result[0].age).toBe(30);
        }
      });

      test("select helper with IN using fragment", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
        const fragment = sql`id IN ${sql([1, 2])}`;
        const result = await sql`SELECT * FROM ${sql(random_name)} WHERE ${fragment}`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("John");
        expect(result[0].age).toBe(30);
      });
      test("update helper", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
        const result =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE id = 1 RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("Mary");
        expect(result[0].age).toBe(18);
      });

      test("update helper with IN", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        const result =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE id IN ${sql([1, 2])} RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("Mary");
        expect(result[0].age).toBe(18);
        expect(result[1].id).toBe(2);
        expect(result[1].name).toBe("Mary");
        expect(result[1].age).toBe(18);
      });

      test("update helper with undefined values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        const result =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: undefined })} WHERE id IN ${sql([1, 2])} RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("Mary");
        expect(result[0].age).toBe(30);
        expect(result[1].id).toBe(2);
        expect(result[1].name).toBe("Mary");
        expect(result[1].age).toBe(25);
      });
      test("update helper that starts with undefined values", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        const result =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: undefined, age: 19 })} WHERE id IN ${sql([1, 2])} RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("John");
        expect(result[0].age).toBe(19);
        expect(result[1].id).toBe(2);
        expect(result[1].name).toBe("Jane");
        expect(result[1].age).toBe(19);
      });

      test("update helper with undefined values and no columns", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        try {
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: undefined, age: undefined })} WHERE id IN ${sql([1, 2])} RETURNING *`;
          expect.unreachable();
        } catch (e) {
          expect(e).toBeInstanceOf(SyntaxError);
          expect(e.message).toBe("Update needs to have at least one column");
        }
      });

      test("upsert helper", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`
        CREATE TABLE IF NOT EXISTS ${sql(random_name)} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
            foo text NOT NULL DEFAULT '',
            email text NOT NULL UNIQUE
        )
      `;
        {
          const { email, ...data } = { email: "bunny@bun.com", foo: "hello" };
          await sql`
        INSERT INTO ${sql(random_name)}
        ${sql({ ...data, email })}
        ON CONFLICT (email) DO UPDATE
        SET ${sql(data)}
      `;
          const result = await sql`SELECT * FROM ${sql(random_name)}`;
          expect(result[0].id).toBeDefined();
          expect(result[0].foo).toBe("hello");
          expect(result[0].email).toBe("bunny@bun.com");
        }

        {
          const { email, ...data } = { email: "bunny@bun.com", foo: "hello2" };
          await sql`
        INSERT INTO ${sql(random_name)}
        ${sql({ ...data, email })}
        ON CONFLICT (email) DO UPDATE
        SET ${sql(data)}
      `;
          const result = await sql`SELECT * FROM ${sql(random_name)}`;
          expect(result[0].id).toBeDefined();
          expect(result[0].foo).toBe("hello2");
          expect(result[0].email).toBe("bunny@bun.com");
        }
      });

      test("update helper with AND IN", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        const result =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE 1=1 AND id IN ${sql([1, 2])} RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("Mary");
        expect(result[0].age).toBe(18);
        expect(result[1].id).toBe(2);
        expect(result[1].name).toBe("Mary");
        expect(result[1].age).toBe(18);
      });

      test("update helper with ANY", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        const result =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE id  = ANY (${sql.array([1, 2], "int")}) RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("Mary");
        expect(result[0].age).toBe(18);
        expect(result[1].id).toBe(2);
        expect(result[1].name).toBe("Mary");
        expect(result[1].age).toBe(18);
      });

      test("update helper with IN for strings", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
          { id: 3, name: "Bob", age: 35 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        const result =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ age: 40 })} WHERE name IN ${sql(["John", "Jane"])} RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("John");
        expect(result[0].age).toBe(40);
        expect(result[1].id).toBe(2);
        expect(result[1].name).toBe("Jane");
        expect(result[1].age).toBe(40);
      });

      test("update helper with IN and column name", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        const result =
          await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE id IN ${sql(users, "id")} RETURNING *`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("Mary");
        expect(result[0].age).toBe(18);
        expect(result[1].id).toBe(2);
        expect(result[1].name).toBe("Mary");
        expect(result[1].age).toBe(18);
      });

      test("update multiple values no helper", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
        await sql`UPDATE ${sql(random_name)} SET ${sql("name")} = ${"Mary"}, ${sql("age")} = ${18} WHERE id = 1`;
        const result = await sql`SELECT * FROM ${sql(random_name)} WHERE id = 1`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("Mary");
        expect(result[0].age).toBe(18);
      });

      test("SELECT with IN and NOT IN", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];
        await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

        const result =
          await sql`SELECT * FROM ${sql(random_name)} WHERE id IN ${sql(users, "id")} and id NOT IN ${sql([3, 4, 5])}`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("John");
        expect(result[0].age).toBe(30);
        expect(result[1].id).toBe(2);
        expect(result[1].name).toBe("Jane");
        expect(result[1].age).toBe(25);
      });

      test("syntax error", async () => {
        await using sql = postgres({ ...options, max: 1 });
        const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
        const users = [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 },
        ];

        expect(() => sql`DELETE FROM ${sql(random_name)} ${sql(users, "id")}`.execute()).toThrow(SyntaxError);
      });
    });

    describe("connection options", () => {
      test("connection", async () => {
        await using sql = postgres({ ...options, max: 1, connection: { search_path: "information_schema" } });
        const [item] = await sql`SELECT COUNT(*)::INT FROM columns LIMIT 1`.values();
        expect(item[0]).toBeGreaterThan(0);
      });
      test("query string", async () => {
        await using sql = postgres(process.env.DATABASE_URL + "?search_path=information_schema", {
          max: 1,
        });
        const [item] = await sql`SELECT COUNT(*)::INT FROM columns LIMIT 1`.values();
        expect(item[0]).toBeGreaterThan(0);
      });
    });

    describe("should proper handle connection errors", () => {
      test("should not crash if connection fails", async () => {
        const result = Bun.spawnSync([bunExe(), path.join(import.meta.dirname, "socket.fail.fixture.ts")], {
          cwd: import.meta.dir,
          env: bunEnv,
          stdin: "ignore",
          stdout: "inherit",
          stderr: "pipe",
        });
        expect(result.stderr?.toString()).toBeFalsy();
      });
    });

    describe("Misc", () => {
      test("The Bun.SQL.*Error classes exist", () => {
        expect(Bun.SQL.SQLError).toBeDefined();
        expect(Bun.SQL.PostgresError).toBeDefined();
        expect(Bun.SQL.SQLiteError).toBeDefined();

        expect(Bun.SQL.SQLError.name).toBe("SQLError");
        expect(Bun.SQL.PostgresError.name).toBe("PostgresError");
        expect(Bun.SQL.SQLiteError.name).toBe("SQLiteError");

        expect(Bun.SQL.SQLError.prototype).toBeInstanceOf(Error);
        expect(Bun.SQL.PostgresError.prototype).toBeInstanceOf(Bun.SQL.SQLError);
        expect(Bun.SQL.SQLiteError.prototype).toBeInstanceOf(Bun.SQL.SQLError);
      });

      describe("Adapter override URL parsing", () => {
        test("explicit adapter='sqlite' overrides postgres:// URL", async () => {
          // Even though URL suggests postgres, explicit adapter should win
          const sql = new Bun.SQL("postgres://localhost:5432/testdb", {
            adapter: "sqlite",
            filename: ":memory:",
          });

          // Verify it's actually SQLite by checking the adapter type
          expect(sql.options.adapter).toBe("sqlite");

          // SQLite-specific operation should work
          await sql`CREATE TABLE test_adapter (id INTEGER PRIMARY KEY)`;
          await sql`INSERT INTO test_adapter (id) VALUES (1)`;
          const result = await sql`SELECT * FROM test_adapter`;
          expect(result).toHaveLength(1);

          await sql.close();
        });

        test("explicit adapter='postgres' with sqlite:// URL should throw as invalid url", async () => {
          let sql: Bun.SQL | undefined;
          let error: unknown;

          try {
            sql = new Bun.SQL("sqlite://:memory:", {
              adapter: "postgres",
              hostname: "localhost",
              port: 5432,
              username: "postgres",
              password: "",
              database: "testdb",
              max: 1,
            });

            expect(false).toBeTrue();
          } catch (e) {
            error = e;
          }

          expect(error).toBeInstanceOf(Error);
          expect(error.message).toMatchInlineSnapshot(
            `"Invalid URL 'sqlite://:memory:' for postgres. Did you mean to specify \`{ adapter: "sqlite" }\`?"`,
          );
          expect(sql).toBeUndefined();
        });

        test("explicit adapter='sqlite' with sqlite:// URL works", async () => {
          // Both URL and adapter agree on sqlite
          const sql = new Bun.SQL("sqlite://:memory:", {
            adapter: "sqlite",
          });

          expect(sql.options.adapter).toBe("sqlite");

          await sql`CREATE TABLE test_consistent (id INTEGER)`;
          await sql`INSERT INTO test_consistent VALUES (42)`;
          const result = await sql`SELECT * FROM test_consistent`;
          expect(result).toHaveLength(1);
          expect(result[0].id).toBe(42);

          await sql.close();
        });

        test("explicit adapter='postgres' with postgres:// URL works", async () => {
          // Skip if no postgres available
          if (!process.env.DATABASE_URL) {
            return;
          }

          // Both URL and adapter agree on postgres
          const sql = new Bun.SQL(process.env.DATABASE_URL, {
            adapter: "postgres",
            max: 1,
          });

          expect(sql.options.adapter).toBe("postgres");

          const randomTable = "test_consistent_" + Math.random().toString(36).substring(7);
          await sql`CREATE TEMP TABLE ${sql(randomTable)} (value INT)`;
          await sql`INSERT INTO ${sql(randomTable)} VALUES (42)`;
          const result = await sql`SELECT * FROM ${sql(randomTable)}`;
          expect(result).toHaveLength(1);
          expect(result[0].value).toBe(42);

          await sql.close();
        });

        test("explicit adapter overrides even with conflicting connection string patterns", async () => {
          // Test that adapter explicitly set to sqlite works even with postgres-like connection info
          const sql = new Bun.SQL(undefined as never, {
            adapter: "sqlite",
            filename: ":memory:",
            hostname: "localhost", // These would normally suggest postgres
            port: 5432,
            username: "postgres",
            password: "password",
            database: "testdb",
          });

          expect(sql.options.adapter).toBe("sqlite");

          // Should still work as SQLite
          await sql`CREATE TABLE override_test (name TEXT)`;
          await sql`INSERT INTO override_test VALUES ('test')`;
          const result = await sql`SELECT * FROM override_test`;
          expect(result).toHaveLength(1);
          expect(result[0].name).toBe("test");

          await sql.close();
        });
      });

      describe("SQL Error Classes", () => {
        describe("SQLError base class", () => {
          test("SQLError should be a constructor", () => {
            expect(typeof SQL.SQLError).toBe("function");
            expect(SQL.SQLError.name).toBe("SQLError");
          });

          test("SQLError should extend Error", () => {
            const error = new SQL.SQLError("Test error");
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(SQL.SQLError);
            expect(error.message).toBe("Test error");
            expect(error.name).toBe("SQLError");
          });

          test("SQLError should have proper stack trace", () => {
            const error = new SQL.SQLError("Test error");
            expect(error.stack).toContain("SQLError");
            expect(error.stack).toContain("Test error");
          });

          test("SQLError should be catchable as base class", () => {
            try {
              throw new SQL.SQLError("Test error");
            } catch (e) {
              expect(e).toBeInstanceOf(SQL.SQLError);
              expect(e).toBeInstanceOf(Error);
            }
          });
        });

        describe("PostgresError class", () => {
          test("PostgresError should be a constructor", () => {
            expect(typeof SQL.PostgresError).toBe("function");
            expect(SQL.PostgresError.name).toBe("PostgresError");
          });

          test("PostgresError should extend SQLError", () => {
            const error = new SQL.PostgresError("Postgres error", {
              code: "00000",
              detail: "",
              hint: "",
              severity: "ERROR",
            });
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(SQL.SQLError);
            expect(error).toBeInstanceOf(SQL.PostgresError);
            expect(error.message).toBe("Postgres error");
            expect(error.name).toBe("PostgresError");
          });

          test("PostgresError should have Postgres-specific properties", () => {
            // Test with common properties that we'll definitely have
            const error = new SQL.PostgresError("Postgres error", {
              code: "23505",
              detail: "Key (id)=(1) already exists.",
              hint: "Try using a different ID.",
              severity: "ERROR",
            });

            expect(error.code).toBe("23505");
            expect(error.detail).toBe("Key (id)=(1) already exists.");
            expect(error.hint).toBe("Try using a different ID.");
            expect(error.severity).toBe("ERROR");
          });

          test("PostgresError should support extended properties when available", () => {
            // Test that we can include additional properties when they're provided by Postgres
            const error = new SQL.PostgresError("Postgres error", {
              code: "23505",
              detail: "Duplicate key value",
              hint: "",
              severity: "ERROR",
              schema: "public",
              table: "users",
              constraint: "users_pkey",
            });

            expect(error.code).toBe("23505");
            expect(error.detail).toBe("Duplicate key value");
            expect(error.schema).toBe("public");
            expect(error.table).toBe("users");
            expect(error.constraint).toBe("users_pkey");
          });

          test("PostgresError should be catchable as SQLError", () => {
            try {
              throw new SQL.PostgresError("Postgres error", {
                code: "00000",
                detail: "",
                hint: "",
                severity: "ERROR",
              });
            } catch (e) {
              if (e instanceof SQL.SQLError) {
                expect(e).toBeInstanceOf(SQL.PostgresError);
              } else {
                throw new Error("Should be catchable as SQLError");
              }
            }
          });

          test("PostgresError with minimal properties", () => {
            const error = new SQL.PostgresError("Connection failed", {
              code: "",
              detail: "",
              hint: "",
              severity: "ERROR",
            });
            expect(error.message).toBe("Connection failed");
            expect(error.code).toBe("");
            expect(error.detail).toBe("");
          });
        });

        describe("SQLiteError class", () => {
          test("SQLiteError should be a constructor", () => {
            expect(typeof SQL.SQLiteError).toBe("function");
            expect(SQL.SQLiteError.name).toBe("SQLiteError");
          });

          test("SQLiteError should extend SQLError", () => {
            const error = new SQL.SQLiteError("SQLite error", {
              code: "SQLITE_ERROR",
              errno: 1,
            });
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(SQL.SQLError);
            expect(error).toBeInstanceOf(SQL.SQLiteError);
            expect(error.message).toBe("SQLite error");
            expect(error.name).toBe("SQLiteError");
          });

          test("SQLiteError should have SQLite-specific properties", () => {
            const error = new SQL.SQLiteError("UNIQUE constraint failed: users.email", {
              code: "SQLITE_CONSTRAINT_UNIQUE",
              errno: 2067,
            });

            expect(error.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
            expect(error.errno).toBe(2067);
            expect(error.message).toBe("UNIQUE constraint failed: users.email");
          });

          test("SQLiteError should be catchable as SQLError", () => {
            try {
              throw new SQL.SQLiteError("SQLite error", {
                code: "SQLITE_ERROR",
                errno: 1,
              });
            } catch (e) {
              if (e instanceof SQL.SQLError) {
                expect(e).toBeInstanceOf(SQL.SQLiteError);
              } else {
                throw new Error("Should be catchable as SQLError");
              }
            }
          });

          test("SQLiteError with minimal properties", () => {
            const error = new SQL.SQLiteError("Database locked", {
              code: "SQLITE_BUSY",
              errno: 5,
            });
            expect(error.message).toBe("Database locked");
            expect(error.code).toBe("SQLITE_BUSY");
            expect(error.errno).toBe(5);
          });
        });

        describe("Error hierarchy and instanceof checks", () => {
          test("can differentiate between PostgresError and SQLiteError", () => {
            const pgError = new SQL.PostgresError("pg error", {
              code: "00000",
              detail: "",
              hint: "",
              severity: "ERROR",
            });
            const sqliteError = new SQL.SQLiteError("sqlite error", {
              code: "SQLITE_ERROR",
              errno: 1,
            });

            expect(pgError instanceof SQL.PostgresError).toBe(true);
            expect(pgError instanceof SQL.SQLiteError).toBe(false);
            expect(pgError instanceof SQL.SQLError).toBe(true);

            expect(sqliteError instanceof SQL.SQLiteError).toBe(true);
            expect(sqliteError instanceof SQL.PostgresError).toBe(false);
            expect(sqliteError instanceof SQL.SQLError).toBe(true);
          });

          test("can catch all SQL errors with base class", () => {
            const errors = [
              new SQL.PostgresError("pg error", {
                code: "00000",
                detail: "",
                hint: "",
                severity: "ERROR",
              }),
              new SQL.SQLiteError("sqlite error", {
                code: "SQLITE_ERROR",
                errno: 1,
              }),
              new SQL.SQLError("generic sql error"),
            ];

            for (const error of errors) {
              try {
                throw error;
              } catch (e) {
                expect(e).toBeInstanceOf(SQL.SQLError);
              }
            }
          });

          test("error.toString() returns proper format", () => {
            const pgError = new SQL.PostgresError("connection failed", {
              code: "08001",
              detail: "",
              hint: "",
              severity: "ERROR",
            });
            const sqliteError = new SQL.SQLiteError("database locked", {
              code: "SQLITE_BUSY",
              errno: 5,
            });
            const sqlError = new SQL.SQLError("generic error");

            expect(pgError.toString()).toContain("PostgresError");
            expect(pgError.toString()).toContain("connection failed");

            expect(sqliteError.toString()).toContain("SQLiteError");
            expect(sqliteError.toString()).toContain("database locked");

            expect(sqlError.toString()).toContain("SQLError");
            expect(sqlError.toString()).toContain("generic error");
          });
        });

        describe("Integration with actual database operations", () => {
          describe("SQLite errors", () => {
            test("SQLite constraint violation throws SQLiteError", async () => {
              const dir = tempDirWithFiles("sqlite-error-test", {});
              const dbPath = path.join(dir, "test.db");

              const db = new SQL({ filename: dbPath, adapter: "sqlite" });

              await db`
            CREATE TABLE users (
              id INTEGER PRIMARY KEY,
              email TEXT UNIQUE NOT NULL
            )
          `;

              await db`INSERT INTO users (email) VALUES ('test@example.com')`;

              try {
                await db`INSERT INTO users (email) VALUES ('test@example.com')`;
                throw new Error("Should have thrown an error");
              } catch (e) {
                expect(e).toBeInstanceOf(SQL.SQLiteError);
                expect(e).toBeInstanceOf(SQL.SQLError);
                expect(e.message).toContain("UNIQUE constraint failed");
                expect(e.code).toContain("SQLITE_CONSTRAINT");
              }

              await db.close();
            });

            test("SQLite syntax error throws SQLiteError", async () => {
              const dir = tempDirWithFiles("sqlite-syntax-error-test", {});
              const dbPath = path.join(dir, "test.db");

              const db = new SQL({ filename: dbPath, adapter: "sqlite" });

              try {
                await db`SELCT * FROM nonexistent`;
                throw new Error("Should have thrown an error");
              } catch (e) {
                expect(e).toBeInstanceOf(SQL.SQLiteError);
                expect(e).toBeInstanceOf(SQL.SQLError);
                expect(e.message).toContain("syntax error");
                expect(e.code).toBe("SQLITE_ERROR");
              }

              await db.close();
            });

            test("SQLite database locked throws SQLiteError", async () => {
              const dir = tempDirWithFiles("sqlite-locked-test", {});
              const dbPath = path.join(dir, "test.db");

              await using db1 = new SQL({ filename: dbPath, adapter: "sqlite" });
              await using db2 = new SQL({ filename: dbPath, adapter: "sqlite" });

              await db1`CREATE TABLE test (id INTEGER PRIMARY KEY)`;

              await db1`BEGIN EXCLUSIVE TRANSACTION`;
              await db1`INSERT INTO test (id) VALUES (1)`;

              try {
                await db2`INSERT INTO test (id) VALUES (2)`;
                throw new Error("Should have thrown an error");
              } catch (e) {
                expect(e).toBeInstanceOf(SQL.SQLiteError);
                expect(e).toBeInstanceOf(SQL.SQLError);
                expect(e.code).toBe("SQLITE_BUSY");
              }

              await db1`COMMIT`;
            });
          });
        });

        describe("Type guards", () => {
          test("can use instanceof for type narrowing", () => {
            function handleError(e: unknown) {
              if (e instanceof SQL.PostgresError) {
                return `PG: ${e.code}`;
              } else if (e instanceof SQL.SQLiteError) {
                return `SQLite: ${e.errno}`;
              } else if (e instanceof SQL.SQLError) {
                return `SQL: ${e.message}`;
              }
              return "Unknown error";
            }

            expect(
              handleError(
                new SQL.PostgresError("test", {
                  code: "23505",
                  detail: "",
                  hint: "",
                  severity: "ERROR",
                }),
              ),
            ).toBe("PG: 23505");
            expect(
              handleError(
                new SQL.SQLiteError("test", {
                  code: "SQLITE_BUSY",
                  errno: 5,
                }),
              ),
            ).toBe("SQLite: 5");
            expect(handleError(new SQL.SQLError("test"))).toBe("SQL: test");
            expect(handleError(new Error("test"))).toBe("Unknown error");
          });
        });
      });
    }); // Close "Misc" describe
    test("Handles empty integer array stored as {}", async () => {
      await using db = postgres(options);
      const tableName = `test_${randomUUIDv7("hex").replaceAll("-", "")}`;

      await db`CREATE TEMPORARY TABLE ${db(tableName)} (id SERIAL PRIMARY KEY, numbers INTEGER[])`;

      // Inserting using the SQL array constructor triggers the "Failed to read data" error on SELECT.
      await db`INSERT INTO ${db(tableName)} (numbers) VALUES (ARRAY[]::integer[])`;

      // Read back - this succeeds on the first try
      const result1 = await db`SELECT * FROM ${db(tableName)}`;
      expect(result1).toBeArray();
      expect(Array.from(result1[0].numbers)).toEqual([]);

      // Second read to trigger connection reuse issue
      // This is where it fails with ERR_POSTGRES_INVALID_BINARY_DATA in bun 1.3.5
      const result2 = await db`SELECT * FROM ${db(tableName)}`;
      expect(result2).toBeArray();
      expect(Array.from(result2[0].numbers)).toEqual([]);
    });
  }); // Close "PostgreSQL tests" describe
} // Close if (isDockerEnabled())
