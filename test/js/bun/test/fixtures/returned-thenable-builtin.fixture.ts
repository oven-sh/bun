import { SQL } from "bun";
import { expect, test } from "bun:test";
import { notAwaited, startUnlessAwaited } from "./returned-thenable";

// Both return a Promise subclass that starts its work in the first then().
const sql = new SQL("sqlite://:memory:");

test("a Bun.$ command runs", () => startUnlessAwaited(Bun.$`echo shell`.quiet()));
test("a Bun.$ command that fails", () => startUnlessAwaited(Bun.$`exit 3`.quiet()));

test("a Bun.SQL query runs", () => startUnlessAwaited(sql`create table returned (x integer)`));
test("a Bun.SQL query that fails", () => startUnlessAwaited(sql`select * from missing`));
test("the returned query created the table", async () => {
  expect(await sql`select count(*) as rows from returned`).toEqual([{ rows: 0 }]);
});

test("the runner started every command and query", () => {
  expect(notAwaited.count).toBe(0);
});
