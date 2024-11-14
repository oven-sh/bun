import { Database } from "bun:sqlite";
import { expect, it } from "bun:test";

const dbPath = import.meta.dir + "/northwind.testdb";

it("works with datetime", () => {
  using db = Database.open(dbPath);

  using stmt = db.prepare('SELECT * FROM "Orders" WHERE OrderDate > datetime($date, "gmt")');
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > datetime(NULL, "gmt")`);

  expect(
    stmt.all({
      // do the conversion this way so that this test runs in multiple timezones
      $date: "1996-09-01T07:00:00.000Z",
    }),
  ).toHaveLength(0);

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
  expect(ran).toEqual({
    changes: 0,
    lastInsertRowid: 0,
  });
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > datetime('1997-09-01T07:00:00.000Z', "gmt")`);

  expect(
    stmt.get({
      $date: "1998-09-01T07:00:00.000Z",
    }),
  ).toBe(null);
  expect(stmt.toString()).toBe(`SELECT * FROM "Orders" WHERE OrderDate > datetime('1998-09-01T07:00:00.000Z', "gmt")`);
  expect(stmt.paramsCount).toBe(1);
  expect(stmt.columnNames).toStrictEqual([
    "OrderID",
    "CustomerID",
    "EmployeeID",
    "OrderDate",
    "RequiredDate",
    "ShippedDate",
    "ShipVia",
    "Freight",
    "ShipName",
    "ShipAddress",
    "ShipCity",
    "ShipRegion",
    "ShipPostalCode",
    "ShipCountry",
  ]);
});

it("works with datetime string", () => {
  using handle = new Database(dbPath);
  expect(
    handle.run('SELECT * FROM "Orders" WHERE OrderDate > datetime($date, "gmt")', {
      $date: new Date(1996, 8, 1).toISOString(),
    }),
  ).toEqual({
    changes: 0,
    lastInsertRowid: 0,
  });
});
