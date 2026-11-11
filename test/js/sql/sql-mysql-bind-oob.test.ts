import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

for (const image of ["mysql_plain", "mariadb_plain"]) {
  describeWithContainer(image, { image, concurrent: true }, container => {
    test.each([
      ["too few values", "select ? as x, ? as y", [1]],
      ["too many values", "select ? as x", [1, 2]],
      ["more values than a statement can have placeholders", "select ? as x", new Array(70_000).fill(1)],
    ])("%s", async (_name, text, values) => {
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      const [{ id }] = await sql`select connection_id() as id`;
      const attempt = () =>
        sql.unsafe(text, values).then(
          () => "resolved",
          e => e.code,
        );
      expect({
        whilePreparing: await attempt(),
        onTheCachedStatement: await attempt(),
        after: [...(await sql.unsafe("select ? as x, connection_id() = ? as same", ["in sync", id]))],
      }).toEqual({
        whilePreparing: "ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
        onTheCachedStatement: "ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
        after: [{ x: "in sync", same: 1 }],
      });
    });
  });
}
