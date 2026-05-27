// Regression: a bind-time encoder error on the *first* execution of a MySQL
// prepared statement used to hang the query's promise forever instead of
// rejecting it.
//
// Binding a Date whose year doesn't fit the DATETIME wire format (a `u16`)
// fails inside `Value::from_js`. When the statement hasn't been prepared yet,
// that error surfaces on the prepare-then-execute path through the request
// queue's `on_error` rather than synchronously from the `.run()` call.
// `JSMySQLQuery::run`'s error guard marked the query `Fail` before that async
// reject ran, so `reject_with_js_value`'s "already failed" guard bailed out and
// dropped the rejection — the awaited promise never settled.
//
// Exercised against a real MySQL server: the docker-compose `mysql_plain`
// service in CI, or a locally reachable server (MYSQL_URL / 127.0.0.1:3306)
// otherwise. A year beyond the `u16` range (70000) is out of range for every
// MySQL version, so no server-side DATETIME support is required.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

// A statement whose first execution binds an out-of-range DATETIME parameter.
// No priming query first, so this is the statement's first use and the error
// travels the async prepare-then-execute path the fix repairs.
async function runBindErrorHang(sql: SQL) {
  const farFuture = new Date("+070000-01-01T00:00:00.000Z");
  expect(farFuture.getUTCFullYear()).toBe(70000);

  // A Bun SQL query is a single-consumption thenable, so await it inside a
  // wrapper promise rather than handing the query object straight to
  // `expect().rejects` (which `.then()`s it more than once and would hang).
  // Before the fix this rejection never arrived at all — the promise hung on
  // the prepare-then-execute path.
  await expect(
    (async () => {
      await sql`SELECT ${farFuture} AS dt`;
    })(),
  ).rejects.toThrow(/year 70000 is out of range/i);

  // The connection must stay usable after the rejected bind.
  expect((await sql`SELECT 1 AS ok`)[0].ok).toBe(1);
}

// An Invalid Date (`new Date(NaN)`) is still a `Date`, so it binds as a
// DATETIME. Its timestamp is NaN, which the float->int cast would launder into
// 0 and silently store as 1970-01-01. It must be rejected instead.
async function runInvalidDateReject(sql: SQL) {
  for (const invalid of [new Date("not a date"), new Date(NaN), new Date(Infinity)]) {
    expect(Number.isNaN(invalid.getTime())).toBe(true);
    await expect(
      (async () => {
        await sql`SELECT ${invalid} AS dt`;
      })(),
    ).rejects.toThrow(/invalid date/i);
  }

  // The connection must stay usable after the rejected binds.
  expect((await sql`SELECT 1 AS ok`)[0].ok).toBe(1);
}

// `Signature::generate` and `bind` each iterate the user's param array, so an
// index getter can hand a `Date` to the first pass (making the column a
// DATETIME) and a number to the second. A huge number yields a day count past
// `i32::MAX`; the encoder's `i32::try_from(days)` used to `.expect()`-panic
// (process abort) on that value instead of rejecting.
async function runGetterMutationAbort(sql: SQL) {
  // Prime the prepared-statement cache with a DATETIME signature.
  await sql.unsafe("select ? as d", [new Date(0)]);

  // 1e20 overflows the day count (i32::try_from(days)); 1e22 additionally
  // saturates `ts` to i64::MAX so the sub-second residual cast saturates too,
  // which used to overflow `ms * 1000` and abort a debug build before the day
  // guard ran. Both must surface a catchable error.
  for (const huge of [1e20, 1e22]) {
    let reads = 0;
    const values: unknown[] = [new Date("2020-01-01T00:00:00.000Z")];
    Object.defineProperty(values, "0", {
      enumerable: true,
      configurable: true,
      get() {
        reads++;
        // First pass (signature): a Date -> column bound as DATETIME.
        // Later pass (bind): a number whose day count overflows i32.
        return reads <= 1 ? new Date("2020-01-01T00:00:00.000Z") : huge;
      },
    });

    const result = await sql.unsafe("select ? as d", values).then(
      rows => ({ ok: true, rows }),
      (err: any) => ({ ok: false, code: err?.code, message: String(err?.message ?? err) }),
    );
    expect(result).toMatchObject({ ok: false, code: "ERR_INVALID_ARG_TYPE" });
    expect(reads).toBeGreaterThanOrEqual(2);
  }

  // The connection must still be usable after the rejected binds.
  expect((await sql.unsafe("select ? as x", [2]))[0].x).toBe(2);
}

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    const getUrl = () => `mysql://root@${container.host}:${container.port}/bun_sql_test`;
    test("a bind error on a statement's first use rejects instead of hanging", async () => {
      await container.ready;
      await using sql = new SQL({ url: getUrl(), max: 1 });
      await runBindErrorHang(sql);
    });
    test("an out-of-range DATETIME from an array-index getter rejects instead of aborting", async () => {
      await container.ready;
      await using sql = new SQL({ url: getUrl(), max: 1 });
      await runGetterMutationAbort(sql);
    });
    test("an Invalid Date bound as DATETIME is rejected, not stored as 1970-01-01", async () => {
      await container.ready;
      await using sql = new SQL({ url: getUrl(), max: 1 });
      await runInvalidDateReject(sql);
    });
  });
} else {
  // No docker daemon (e.g. local/sandboxed environments). If a MySQL server is
  // reachable at MYSQL_URL or the conventional local address, exercise the fix
  // there; the docker-gated branch above provides the CI coverage.
  const url = process.env.MYSQL_URL || "mysql://bun@127.0.0.1:3306/bun_sql_test";

  // Probes the connection with a trivial query. Returns true when the server
  // is reachable. Returns false (after a warning) for a soft skip when no MySQL
  // is reachable and MYSQL_URL was not explicitly provided; throws if MYSQL_URL
  // was provided but the server is unreachable.
  async function connectOrSkip(sql: SQL, label: string): Promise<boolean> {
    try {
      await sql`SELECT 1`;
      return true;
    } catch (e) {
      if (process.env.MYSQL_URL) {
        // MYSQL_URL was explicitly provided; failing to connect is a real
        // error, not an environment without MySQL.
        throw new Error(`${label}: MYSQL_URL was provided but the server is unreachable: ${e}`);
      }
      console.warn(`${label}: no MySQL reachable at ${url}; skipping assertions`);
      return false;
    }
  }

  describe("mysql (local)", () => {
    test("a bind error on a statement's first use rejects instead of hanging", async () => {
      await using sql = new SQL({ url, max: 1 });
      if (!(await connectOrSkip(sql, "sql-mysql-bind-error-hang"))) return;
      await runBindErrorHang(sql);
    });
    test("an out-of-range DATETIME from an array-index getter rejects instead of aborting", async () => {
      await using sql = new SQL({ url, max: 1 });
      if (!(await connectOrSkip(sql, "sql-mysql-bind-error-hang"))) return;
      await runGetterMutationAbort(sql);
    });
    test("an Invalid Date bound as DATETIME is rejected, not stored as 1970-01-01", async () => {
      await using sql = new SQL({ url, max: 1 });
      if (!(await connectOrSkip(sql, "sql-mysql-bind-error-hang"))) return;
      await runInvalidDateReject(sql);
    });
  });
}
