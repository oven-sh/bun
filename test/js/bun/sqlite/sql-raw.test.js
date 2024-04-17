import { expect, it } from "bun:test";
import { SQL } from "bun:internal-for-testing";

const dbPath = import.meta.dir + "/northwind.testdb";

it("works", () => {
  const handle = SQL.open(dbPath);

  const stmt = SQL.prepare(handle, 'SELECT * FROM "Orders" WHERE OrderDate > datetime($date, "gmt")');
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > datetime(NULL, "gmt")`);

  expect(
    Array.isArray(
      stmt.all({
        // do the conversion this way so that this test runs in multiple timezones
        $date: "1996-09-01T07:00:00.000Z",
      }),
    ),
  ).toBe(true);
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > datetime('1996-09-01T07:00:00.000Z', "gmt")`);

  var ran = stmt.run({
    $date: "1997-09-01T07:00:00.000Z",
  });
  expect(Array.isArray(ran)).toBe(false);
  expect(ran === undefined).toBe(true);
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > datetime('1997-09-01T07:00:00.000Z', "gmt")`);

  expect(
    Array.isArray(
      stmt.get({
        $date: "1998-09-01T07:00:00.000Z",
      }),
    ),
  ).toBe(false);
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > datetime('1998-09-01T07:00:00.000Z', "gmt")`);
  expect(stmt.paramsCount).toBe(1);
  expect(stmt.columnsCount).toBe(14);
  expect(stmt.columns.length).toBe(14);
  stmt.finalize();
  SQL.close(handle);
});

it("SQL.run works", () => {
  const handle = SQL.open(dbPath);
  expect(typeof handle).toBe("number");

  expect(
    SQL.run(handle, 'SELECT * FROM "Orders" WHERE OrderDate > datetime($date, "gmt")', {
      $date: new Date(1996, 8, 1).toISOString(),
    }),
  ).toBe(undefined);

  SQL.close(handle);
});
