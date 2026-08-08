import { SQL } from "bun";
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "node:path";

// tx.unsafe()/tx.file() must reject once sql.begin() has settled, the same way the
// tagged-template call and tx.savepoint() already do. Before the fix they reached the
// pooled connection the handle no longer owns and the write was durable.
test("tx.unsafe() and tx.file() reject after begin() settles", async () => {
  const dir = tempDirWithFiles("sql-tx-closed", {
    "q.sql": `INSERT INTO accounts VALUES (98, 0)`,
  });
  const sql = new SQL("sqlite://:memory:");
  try {
    await sql`CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance REAL)`;
    let leaked: any;
    await sql.begin(async tx => {
      leaked = tx;
      await tx.unsafe(`INSERT INTO accounts VALUES (10, 0)`);
    });
    const outcome = async (p: Promise<any>) =>
      p.then(
        () => "fulfilled",
        (e: any) => `rejected: ${e.message}`,
      );
    expect({
      template: await outcome(leaked`SELECT 1`),
      savepoint: await outcome(Promise.resolve().then(() => leaked.savepoint(async () => {}))),
      unsafe: await outcome(leaked.unsafe(`INSERT INTO accounts VALUES (99, 0)`)),
      file: await outcome(leaked.file(join(dir, "q.sql"))),
    }).toEqual({
      template: "rejected: Connection closed",
      savepoint: "rejected: Connection closed",
      unsafe: "rejected: Connection closed",
      file: "rejected: Connection closed",
    });
    const rows = await sql`SELECT id FROM accounts ORDER BY id`;
    expect(rows).toEqual([{ id: 10 }]);
  } finally {
    await sql.close();
  }
});
