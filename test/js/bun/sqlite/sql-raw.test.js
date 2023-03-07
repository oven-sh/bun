import { expect, it } from "bun:test";

var SQL = globalThis[Symbol.for("Bun.lazy")]("sqlite");
const dbPath = import.meta.dir + "/northwind.testdb";

it("works", () => {
  const handle = SQL.open(dbPath);

  const stmt = SQL.prepare(handle, 'SELECT * FROM "Orders" WHERE OrderDate > date($date)');
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > date(NULL)`);

  expect(
    Array.isArray(
      stmt.all({
        // do the conversion this way so that this test runs in multiple timezones
        $date: new Date(new Date(1996, 8, 1, 0, 0, 0, 0).toUTCString()).toISOString(),
      }),
    ),
  ).toBe(true);
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > date('1996-09-01T07:00:00.000Z')`);

  var ran = stmt.run({
    $date: new Date(new Date(1997, 8, 1, 0, 0, 0, 0).toUTCString()).toISOString(),
  });
  expect(Array.isArray(ran)).toBe(false);
  expect(ran === undefined).toBe(true);
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > date('1997-09-01T07:00:00.000Z')`);

  expect(
    Array.isArray(
      stmt.get({
        $date: new Date(new Date(1998, 8, 1, 0, 0, 0, 0).toUTCString()).toISOString(),
      }),
    ),
  ).toBe(false);
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > date('1998-09-01T07:00:00.000Z')`);
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
    SQL.run(handle, 'SELECT * FROM "Orders" WHERE OrderDate > date($date)', {
      $date: new Date(1996, 8, 1).toISOString(),
    }),
  ).toBe(undefined);

  SQL.close(handle);
});
