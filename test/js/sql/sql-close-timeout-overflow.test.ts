// close({ timeout }) takes seconds but arms its deadline timer in
// milliseconds. The upper bound used to be checked against the seconds value
// (2 ** 31), so timeouts in (2147483.647, 2 ** 31] seconds passed validation,
// overflowed setTimeout's 32-bit millisecond range (which clamps to 1 ms) and
// force-closed after ~1 ms, cancelling in-flight queries. On reserved
// connections and transactions, validation also ran after acceptQueries was
// already cleared, so a rejected close left the handle refusing all further
// queries.
// https://github.com/oven-sh/bun/issues/32096

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

// setTimeout's maximum delay is 2 ** 31 - 1 milliseconds.
const MAX_TIMEOUT_SECONDS = (2 ** 31 - 1) / 1000; // 2147483.647

// Pool connections are created lazily and close() validates its options
// before touching any connection, so no database server is needed here.
const adapters = [
  ["postgres", "postgres://bun_sql_test@localhost:5432/bun_sql_test"],
  ["mysql", "mysql://bun_sql_test@localhost:3306/bun_sql_test"],
] as const;

for (const [adapter, url] of adapters) {
  test.each([2 ** 31, 2147483.648, Infinity])(
    `${adapter}: close() rejects timeout %p, whose millisecond value overflows setTimeout`,
    async timeout => {
      await using sql = new SQL(url, { max: 1 });
      const err = await sql.close({ timeout }).then(
        () => null,
        e => e,
      );
      expect(err?.code).toBe("ERR_INVALID_ARG_VALUE");
    },
  );

  test.each([MAX_TIMEOUT_SECONDS, 60, 0.5])(`${adapter}: close() accepts timeout %p`, async timeout => {
    await using sql = new SQL(url, { max: 1 });
    await sql.close({ timeout });
  });

  // Values the old bound already rejected must stay rejected.
  test.each([-1, "not a number"])(`${adapter}: close() still rejects timeout %p`, async timeout => {
    await using sql = new SQL(url, { max: 1 });
    const err = await sql.close({ timeout: timeout as number }).then(
      () => null,
      e => e,
    );
    expect(err?.code).toBe("ERR_INVALID_ARG_VALUE");
  });
}

test("close() rejection names the real bound", async () => {
  await using sql = new SQL("postgres://bun_sql_test@localhost:5432/bun_sql_test", { max: 1 });
  const err = await sql.close({ timeout: 2 ** 31 }).then(
    () => null,
    e => e,
  );
  expect(err?.message).toBe(
    "The property 'options.timeout' must be a non-negative number no greater than 2147483.647 seconds. Received 2147483648",
  );
});

// transaction_sql.close() shares the same validation. SQLite transactions run
// in-process, so this exercises it without a server. Before the fix the
// overflowing timeout was accepted: the transaction was rolled back, queries
// after the close rejected with ERR_SQLITE_CONNECTION_CLOSED, and the commit
// rejected the begin() promise.
test("sqlite: transaction close() rejects an overflowing timeout and leaves the transaction usable", async () => {
  await using sql = new SQL("sqlite://:memory:");
  let closeError: any = null;
  let rowsAfterRejectedClose: any = null;
  const result = await sql
    .begin(async tx => {
      closeError = await tx.close({ timeout: 2 ** 31 }).then(
        () => null,
        e => e,
      );
      rowsAfterRejectedClose = await tx`select 1 as x`.then(
        rows => rows[0],
        e => `query failed: ${e.code}`,
      );
      return "callback completed";
    })
    .then(
      value => value,
      e => `begin rejected: ${e.code}`,
    );
  expect(closeError?.code).toBe("ERR_INVALID_ARG_VALUE");
  expect(rowsAfterRejectedClose).toEqual({ x: 1 });
  expect(result).toBe("callback completed");
});

// reserved_sql.close() is the remaining variant; it needs a real connection,
// so it runs against the docker postgres service when available.
if (isDockerEnabled()) {
  describeWithContainer("postgres", { image: "postgres_plain" }, container => {
    test("reserved connection close() rejects an overflowing timeout and stays usable", async () => {
      await container.ready;
      const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
      await using sql = new SQL(url, { max: 2 });
      // disposal calls release(); it runs before the pool's own disposal
      await using reserved = await sql.reserve();
      const err = await reserved.close({ timeout: 2 ** 31 }).then(
        () => null,
        e => e,
      );
      expect(err?.code).toBe("ERR_INVALID_ARG_VALUE");
      // the rejected close must leave the reserved connection untouched
      const rows = await reserved`select 1 as x`;
      expect(rows[0]).toEqual({ x: 1 });
    });
  });
}
