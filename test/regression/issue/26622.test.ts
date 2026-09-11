import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26622
// When parameters are omitted from .get(), .all(), etc., the statement should
// run with the last bound values (or no parameters if there are none)

test("Statement.get() uses last bound value when called without parameters", () => {
  using db = new Database(":memory:");
  db.run("CREATE TABLE foo (bar TEXT)");
  db.run("INSERT INTO foo VALUES ('baz')");
  db.run("INSERT INTO foo VALUES ('foo')");

  using stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");

  // First call without binding returns null (no match with empty/no parameter)
  expect(stmt.get()).toBe(null);

  // Bind and get a value
  expect(stmt.get("baz")).toEqual({ bar: "baz" });

  // Call without parameters should use last bound value ("baz")
  expect(stmt.get()).toEqual({ bar: "baz" });

  // Bind a different value
  expect(stmt.get("foo")).toEqual({ bar: "foo" });

  // Call without parameters should now use "foo"
  expect(stmt.get()).toEqual({ bar: "foo" });
});

test("Statement.all() uses last bound value when called without parameters", () => {
  using db = new Database(":memory:");
  db.run("CREATE TABLE foo (bar TEXT)");
  db.run("INSERT INTO foo VALUES ('baz')");
  db.run("INSERT INTO foo VALUES ('foo')");

  using stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");

  // First call without binding returns empty array (no match)
  expect(stmt.all()).toEqual([]);

  // Bind and get values
  expect(stmt.all("baz")).toEqual([{ bar: "baz" }]);

  // Call without parameters should use last bound value ("baz")
  expect(stmt.all()).toEqual([{ bar: "baz" }]);

  // Bind a different value
  expect(stmt.all("foo")).toEqual([{ bar: "foo" }]);

  // Call without parameters should now use "foo"
  expect(stmt.all()).toEqual([{ bar: "foo" }]);
});
