import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

async function assertOutOfRangeBigIntRejected(url: string) {
  await using sql = new SQL(url);
  await sql`select 1`;
  await expect(sql`select ${2n ** 65n} as v`.execute()).rejects.toMatchObject({ code: "ERR_OUT_OF_RANGE" });
  expect(await sql`select ${-1n} as v`).toEqual([{ v: -1 }]);
}

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  test("an out-of-range BigInt bind parameter is rejected, not truncated", async () => {
    await container.ready;
    await assertOutOfRangeBigIntRejected(`mysql://root@${container.host}:${container.port}/bun_sql_test`);
  });
});
