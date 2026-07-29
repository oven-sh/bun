// MySQL sibling of postgres-pool-transaction-reset.test.ts: the pool must roll
// back a connection whose OK/EOF status_flags still carry
// SERVER_STATUS_IN_TRANS before handing it to the next pooled query.
import { randomUUIDv7, SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  const url = () => `mysql://root@${container.host}:${container.port}/bun_sql_test`;
  const createdTables: string[] = [];
  const freshTable = async (sql: SQL) => {
    const tbl = "txleak_" + randomUUIDv7("hex").replaceAll("-", "");
    await sql.unsafe(`create table ${tbl} (v int) engine=InnoDB`);
    createdTables.push(tbl);
    return tbl;
  };

  afterAll(async () => {
    if (createdTables.length === 0) return;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5 });
    for (const tbl of createdTables) {
      await sql.unsafe(`drop table if exists ${tbl}`).catch(() => {});
    }
  });

  test("reserve() + START TRANSACTION + release() does not leak the open transaction to the next pooled query", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    const tbl = await freshTable(sql);

    const r = await sql.reserve();
    await r.unsafe("start transaction");
    await r.unsafe(`insert into ${tbl} values (100)`);
    r.release();

    await sql.unsafe(`insert into ${tbl} values (1)`);
    await sql.unsafe("rollback").catch(() => {});

    await using verify = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    expect(await verify.unsafe(`select v from ${tbl} order by v`)).toEqual([{ v: 1 }]);
  });

  test("sql.begin() leaves the connection idle (no reset round-trip)", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });
    const tbl = await freshTable(sql);

    await sql.begin(async tx => {
      await tx.unsafe(`insert into ${tbl} values (5)`);
    });
    expect(await sql.unsafe(`select v from ${tbl}`)).toEqual([{ v: 5 }]);

    await sql
      .begin(async tx => {
        await tx.unsafe(`insert into ${tbl} values (6)`);
        throw new Error("abort");
      })
      .catch(() => {});
    expect(await sql.unsafe(`select v from ${tbl}`)).toEqual([{ v: 5 }]);
  });
});
