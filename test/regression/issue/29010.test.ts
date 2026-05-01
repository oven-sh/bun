// Regression test for https://github.com/oven-sh/bun/issues/29010
//
// Bun.SQL must serialize JavaScript `Date` parameters as ISO 8601 / RFC 3339
// (`Date.prototype.toISOString()`), not the locale-dependent output of
// `Date.prototype.toString()`. PostgreSQL-compatible databases reject the
// latter (`"Mon Jan 15 2024 12:30:45 GMT+0000 (Coordinated Universal Time)"`)
// with an "invalid input syntax for type timestamp" error.
//
// The bug was specific to text-format serialization: with `prepare: false`
// (and more generally whenever the parameter type tag is 0 / server-decided),
// `writeBind` fell through to `bun.String.fromJS(value)`, which returns the
// JS `toString()` representation. The binary-format path for
// `.timestamp` / `.timestamptz` was already correct because it goes through
// `types.date.fromJS` → `getUnixTimestamp()`.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import * as dockerCompose from "../../docker/index.ts";

// Resolve a reachable PostgreSQL instance. Prefer the docker-compose
// `postgres_plain` service (what CI uses); fall back to a local
// PostgreSQL listening on 127.0.0.1:5432 with the same credentials
// as the init script (`bun_sql_test` / `bun_sql_test`).
//
// This test is a *consumer* of the shared `bun-test-services` compose
// project — it must never call `dockerCompose.down()`, because that
// would tear down every service in the project and break other suites
// running concurrently against postgres_tls / mysql_* / redis_* / etc.
async function resolvePostgres(): Promise<{ host: string; port: number } | null> {
  try {
    const info = await dockerCompose.ensure("postgres_plain");
    return { host: info.host, port: info.ports[5432] };
  } catch {}

  try {
    await using probe = new SQL({
      host: "127.0.0.1",
      port: 5432,
      username: "bun_sql_test",
      db: "bun_sql_test",
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 2,
    });
    await probe`SELECT 1`;
    return { host: "127.0.0.1", port: 5432 };
  } catch {}

  return null;
}

describe("issue #29010 — Date parameters serialize as ISO 8601", async () => {
  const target = await resolvePostgres();
  if (!target) {
    test.skip("PostgreSQL not available", () => {});
    return;
  }

  const baseOptions = {
    db: "bun_sql_test",
    username: "bun_sql_test",
    host: target.host,
    port: target.port,
    max: 1,
  };

  // With `prepare: false` (unnamed prepared statements), parameter types
  // are not learned from Describe responses, so the Bind message sends
  // parameters in text format with the server-decided type. This is where
  // the bug lived: the fallthrough branch called `String.fromJS` on a
  // `Date`, which produces the locale string rather than ISO 8601.
  describe("prepare: false (text format, server-decided type)", () => {
    const options = { ...baseOptions, prepare: false };
    const t = new Date("2024-01-15T12:30:45.000Z");

    test("Date in SELECT parameter does not produce a parse error", async () => {
      await using db = new SQL(options);
      // Casting to ::timestamptz forces the server to parse the parameter
      // as a timestamp. The old locale-string serialization fails this
      // parse with an "invalid input syntax for type timestamp" error.
      const [{ x }] = await db`SELECT ${t}::timestamptz AS x`;
      expect(x).toEqual(t);
    });

    test("Date in INSERT via sql(rows) does not produce a parse error", async () => {
      await using db = new SQL(options);
      const table = `issue_29010_rows_${Date.now()}`;
      try {
        await db`CREATE TABLE ${db(table)} (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ)`;
        await db`INSERT INTO ${db(table)} ${db([{ created_at: t }])}`;
        const rows = await db`SELECT created_at FROM ${db(table)}`;
        expect(rows).toEqual([{ created_at: t }]);
      } finally {
        await db`DROP TABLE IF EXISTS ${db(table)}`;
      }
    });

    test("Date in INSERT as a plain parameter does not produce a parse error", async () => {
      await using db = new SQL(options);
      const table = `issue_29010_param_${Date.now()}`;
      try {
        await db`CREATE TABLE ${db(table)} (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ)`;
        await db`INSERT INTO ${db(table)} (created_at) VALUES (${t})`;
        const rows = await db`SELECT created_at FROM ${db(table)}`;
        expect(rows).toEqual([{ created_at: t }]);
      } finally {
        await db`DROP TABLE IF EXISTS ${db(table)}`;
      }
    });

    test("Date with a timezone offset also round-trips as UTC", async () => {
      // A Date constructed from a non-UTC ISO string is stored as a UTC
      // instant. The serializer must emit the UTC instant with a trailing
      // `Z`, not the local-time string that `toString()` would emit.
      await using db = new SQL(options);
      const localDate = new Date("2024-07-04T16:00:00.000-04:00"); // 20:00:00Z
      const [{ x }] = await db`SELECT ${localDate}::timestamptz AS x`;
      expect(x).toEqual(localDate);
    });
  });

  // Sanity check: the default (prepared) path was already correct, make
  // sure we didn't regress it. On the *first* execution of a prepared
  // statement, `statement.parameters` is still empty (the server hasn't
  // sent a ParameterDescription yet) so `writeBind` uses the ISO text
  // path added in this change. On the *second* execution the cached OID
  // (`timestamptz` = 1184) is present and `writeBind` takes the binary
  // `types.date.fromJS` path. Exercise both.
  describe("prepare: true", () => {
    const options = { ...baseOptions, prepare: true };
    const t = new Date("2024-01-15T12:30:45.000Z");

    test("Date round-trips on first and subsequent executions", async () => {
      await using db = new SQL(options);
      // First execution: OID 0 (server-decided) → text-format ISO 8601.
      const [{ x: first }] = await db`SELECT ${t}::timestamptz AS x`;
      expect(first).toEqual(t);
      // Second execution of the same prepared statement: OID 1184 →
      // binary microseconds-since-2000 via `types.date.fromJS`.
      const [{ x: second }] = await db`SELECT ${t}::timestamptz AS x`;
      expect(second).toEqual(t);
    });
  });

  // Invalid `Date` objects (`new Date(NaN)`, `new Date("bad")`) are real
  // `DateInstance`s whose internal value is NaN. Both serialization paths
  // must reject them cleanly rather than crashing or sending garbage:
  // - text path: `toISOString()` returns "" for non-finite dates →
  //   `error.InvalidQueryBinding` in the new `writeBind` `else` branch.
  // - binary path: `types.date.fromJS` previously did an unguarded
  //   `@intFromFloat(NaN)` (Illegal Behavior — panic in safe builds,
  //   silent UB in release). Now guarded with `std.math.isFinite`.
  describe("invalid Date (NaN internal value)", () => {
    const invalid = new Date("this is not a date");

    test("prepare: false rejects with a bind error, not a server parse error", async () => {
      await using db = new SQL({ ...baseOptions, prepare: false });
      expect(invalid.getTime()).toBeNaN();
      // `.execute()` returns a real Promise; the bare tagged-template
      // query is a lazy thenable that `expect().rejects` won't drive.
      await expect(db`SELECT ${invalid}::timestamptz AS x`.execute()).rejects.toThrow(
        expect.objectContaining({ code: "ERR_POSTGRES_INVALID_QUERY_BINDING" }),
      );
    });

    test("prepare: true binary path rejects without crashing", async () => {
      await using db = new SQL({ ...baseOptions, prepare: true });
      // Prime the statement so `statement.parameters` is populated with
      // OID 1184 and the second execution takes the binary path.
      const good = new Date("2024-01-15T12:30:45.000Z");
      const [{ x }] = await db`SELECT ${good}::timestamptz AS x`;
      expect(x).toEqual(good);
      // Second execution with an invalid Date reaches `types.date.fromJS`,
      // which must reject the non-finite timestamp rather than hitting
      // `@intFromFloat(NaN)`.
      await expect(db`SELECT ${invalid}::timestamptz AS x`.execute()).rejects.toThrow(
        expect.objectContaining({ code: "ERR_POSTGRES_INVALID_QUERY_BINDING" }),
      );
    });
  });
});
