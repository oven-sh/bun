// When a statement inside a PostgreSQL transaction fails, the session enters
// the failed-transaction state (25P02) and COMMIT is answered with the
// CommandComplete tag "ROLLBACK", not "COMMIT": nothing was committed.
// sql.begin() must not resolve that as a successful transaction; the caller
// would otherwise believe their writes landed when the server rolled them
// back.
//
// This test reaches the failed-transaction state by swallowing an error inside
// the begin() callback, so the callback returns normally and begin() sends
// COMMIT.
import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("sql.begin() rejects when COMMIT is answered with the ROLLBACK tag", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    const table = `t_commit_rb_${randomUUIDv7("hex").slice(-12)}`;
    await sql.unsafe(`CREATE TABLE ${table} (a int)`);
    try {
      const result = await sql
        .begin(async tx => {
          await tx.unsafe(`INSERT INTO ${table} VALUES (1)`);
          // Put the session into the failed-transaction state, but swallow
          // the error so the callback returns normally and begin() proceeds
          // to COMMIT.
          await tx.unsafe(`SELECT * FROM does_not_exist_${randomUUIDv7("hex").slice(-12)}`).catch(() => {});
          return "ok";
        })
        .then(
          v => ({ resolved: v }),
          e => ({ rejected: e }),
        );

      expect(result).toEqual({
        rejected: expect.objectContaining({ code: "ERR_POSTGRES_COMMIT_ROLLED_BACK" }),
      });

      // Nothing was committed.
      const rows = await sql.unsafe(`SELECT a FROM ${table}`);
      expect(rows).toEqual([]);
    } finally {
      await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
    }
  });
});
