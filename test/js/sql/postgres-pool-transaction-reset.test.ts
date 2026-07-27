// The pool used to hand a connection out without checking the ReadyForQuery
// transaction-status byte. A connection returned mid-transaction (open 'T' or
// aborted 'E') was given to the next unrelated pooled query, which then ran
// inside the leaked transaction: its writes silently vanish on a later
// ROLLBACK, and an aborted transaction makes every later pooled query fail
// with 25P02 until something happens to roll back. release() now issues
// ROLLBACK before re-pooling when the server reports the connection is still
// inside a transaction block.
import { randomUUIDv7, SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
  const freshTable = async (sql: SQL) => {
    const tbl = "txleak_" + randomUUIDv7("hex").replaceAll("-", "");
    await sql.unsafe(`create table ${tbl} (v int)`);
    return tbl;
  };

  test("reserve() + BEGIN + release() does not leak the open transaction to the next pooled query", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    const tbl = await freshTable(sql);

    const r = await sql.reserve();
    await r`BEGIN`;
    await r.unsafe(`insert into ${tbl} values (100)`);
    r.release();

    // An unrelated caller's pooled write: before the fix this landed inside
    // the leaked transaction and was rolled back below.
    await sql.unsafe(`insert into ${tbl} values (1)`);
    // Whatever held the leaked transaction eventually rolls it back.
    await sql.unsafe("rollback").catch(() => {});

    // A fresh connection sees committed state only.
    await using verify = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    const rows = await verify.unsafe(`select v from ${tbl} order by v`);
    // The reserved transaction's insert (100) was rolled back on release; the
    // pooled insert (1) was autocommitted and survives.
    expect(rows).toEqual([{ v: 1 }]);
  });

  test("an aborted transaction (25P02) is rolled back before the connection is re-pooled", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    const r = await sql.reserve();
    await r`BEGIN`;
    // Force the failed-transaction state: every statement until ROLLBACK now
    // rejects with SQLSTATE 25P02.
    const err = await r`SELECT invalid_column_name`.catch(e => e);
    expect(err).toBeInstanceOf(Error);
    r.release();

    // Before the fix this pooled query landed on the aborted connection and
    // rejected with 25P02 "current transaction is aborted".
    expect(await sql`SELECT 1 AS x`).toEqual([{ x: 1 }]);
  });

  test("a stray BEGIN smuggled through a multi-statement simple query is reset before re-pooling", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    const tbl = await freshTable(sql);

    // checkUnsafeTransaction only matches BEGIN at the start of the text, so a
    // multi-statement simple query can leave the connection in-transaction.
    await sql.unsafe("select 1; begin");

    await sql.unsafe(`insert into ${tbl} values (3)`);
    await sql.unsafe("rollback").catch(() => {});

    await using verify = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    expect(await verify.unsafe(`select v from ${tbl}`)).toEqual([{ v: 3 }]);
  });

  test("reserve() + BEGIN + release() with a multi-slot pool does not leak to the next pool user", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 2, idleTimeout: 30 });
    const tbl = await freshTable(sql);

    // Pin both slots so the next pooled query must land on whichever we
    // release, regardless of the pool's scheduling.
    const r1 = await sql.reserve();
    const r2 = await sql.reserve();
    await r1`BEGIN`;
    await r1.unsafe(`insert into ${tbl} values (400)`);
    r1.release();

    await sql.unsafe(`insert into ${tbl} values (4)`);
    await sql.unsafe("rollback").catch(() => {});
    r2.release();

    await using verify = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    expect(await verify.unsafe(`select v from ${tbl} order by v`)).toEqual([{ v: 4 }]);
  });

  test("sql.begin() leaves the connection idle (no reset round-trip)", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    const tbl = await freshTable(sql);

    await sql.begin(async tx => {
      await tx.unsafe(`insert into ${tbl} values (5)`);
    });
    // The COMMIT left the connection at ReadyForQuery 'I'; the pooled query
    // below must not observe a rolled-back write.
    expect(await sql.unsafe(`select v from ${tbl}`)).toEqual([{ v: 5 }]);

    // And a rolled-back begin() leaves a working connection behind.
    await sql
      .begin(async tx => {
        await tx.unsafe(`insert into ${tbl} values (6)`);
        throw new Error("abort");
      })
      .catch(() => {});
    expect(await sql.unsafe(`select v from ${tbl}`)).toEqual([{ v: 5 }]);
  });
});
