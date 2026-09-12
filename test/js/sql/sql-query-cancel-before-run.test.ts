// Query.cancel() on a query that has not run yet must settle the promise once
// something consumes it. The rejection is deliberately not issued inside
// cancel() itself: a cancelled query nobody awaits would then be an unhandled
// rejection and exit the process with code 1. This is the shared query.ts path,
// so it is exercised on every adapter; a query that never runs opens no
// connection, so postgres and mysql need no server here.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

// These tests `await` the cancelled query directly. A pending promise inside
// `expect().rejects` does not trip the test timeout, so a hang would stall the file.
function settle(promise: Promise<unknown>) {
  return promise.then(
    () => "resolved",
    (error: Error & { code?: string }) => ({ code: error.code, message: error.message }),
  );
}

describe("sqlite", () => {
  test("cancel() before the query runs rejects when awaited", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const query = sql`SELECT 1 AS x`;
    query.cancel();
    expect(query.cancelled).toBe(true);

    expect(await settle(query)).toEqual({ code: "ERR_SQLITE_QUERY_CANCELLED", message: "Query cancelled" });
    // The connection stays usable.
    expect(await sql`SELECT 2 AS x`).toEqual([{ x: 2 }]);
  });

  test("cancel() before the query runs settles a Promise.all batch", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const cancelled = sql`SELECT 1 AS x`;
    cancelled.cancel();
    const live = sql`SELECT 2 AS x`;

    expect(await settle(Promise.all([cancelled, live]))).toEqual({
      code: "ERR_SQLITE_QUERY_CANCELLED",
      message: "Query cancelled",
    });
    expect(await live).toEqual([{ x: 2 }]);
  });

  test("cancel() before execute() rejects instead of running", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE cancel_before_execute (id INTEGER)`;
    const query = sql`INSERT INTO cancel_before_execute VALUES (1)`;
    query.cancel();
    query.execute();

    expect(await settle(query)).toEqual({ code: "ERR_SQLITE_QUERY_CANCELLED", message: "Query cancelled" });
    expect(await sql`SELECT count(*) AS n FROM cancel_before_execute`).toEqual([{ n: 0 }]);
  });
});

// A query that never runs opens no connection, so the server does not need to exist.
test.each([
  ["postgres://u:p@127.0.0.1:9/db", "ERR_POSTGRES_QUERY_CANCELLED"],
  ["mysql://u:p@127.0.0.1:9/db", "ERR_MYSQL_QUERY_CANCELLED"],
])("cancel() before the query runs rejects for %s", async (url, code) => {
  await using remote = new SQL(url);
  const query = remote`SELECT 1 AS x`;
  query.cancel();

  expect(await settle(query)).toEqual({ code, message: "Query cancelled" });
});
