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

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("a bind error on a statement's first use rejects instead of hanging", async () => {
      await container.ready;
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      await runBindErrorHang(sql);
    });
  });
} else {
  // No docker daemon (e.g. local/sandboxed environments). If a MySQL server is
  // reachable at MYSQL_URL or the conventional local address, exercise the fix
  // there; the docker-gated branch above provides the CI coverage.
  const url = process.env.MYSQL_URL || "mysql://bun@127.0.0.1:3306/bun_sql_test";

  describe("mysql (local)", () => {
    test("a bind error on a statement's first use rejects instead of hanging", async () => {
      await using sql = new SQL({ url, max: 1 });
      try {
        await sql`SELECT 1`;
      } catch (e) {
        if (process.env.MYSQL_URL) {
          // MYSQL_URL was explicitly provided; failing to connect is a real
          // error, not an environment without MySQL.
          throw new Error(`sql-mysql-bind-error-hang: MYSQL_URL was provided but the server is unreachable: ${e}`);
        }
        console.warn(`sql-mysql-bind-error-hang: no MySQL reachable at ${url}; skipping assertions`);
        return;
      }
      await runBindErrorHang(sql);
    });
  });
}
