import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

test("db.close(true) works after db.transaction()", () => {
  const db = new Database(":memory:");
  db.transaction(() => {})();
  expect(() => db.close(true)).not.toThrow();
});

test("db.close(true) works after db.transaction() with actual work", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
  const insert = db.transaction((items: string[]) => {
    const stmt = db.query("INSERT INTO test (value) VALUES (?)");
    for (const item of items) {
      stmt.run(item);
    }
  });
  insert(["a", "b", "c"]);
  expect(db.query("SELECT COUNT(*) as count FROM test").get()).toEqual({ count: 3 });
  expect(() => db.close(true)).not.toThrow();
});

test("using declaration works with db.transaction()", () => {
  using db = new Database(":memory:");
  db.transaction(() => {})();
  // Symbol.dispose calls close(true), should not throw
});

test("db.close(true) works after multiple transaction types", () => {
  const db = new Database(":memory:");
  db.transaction(() => {})();
  db.transaction(() => {}).deferred();
  db.transaction(() => {}).immediate();
  db.transaction(() => {}).exclusive();
  expect(() => db.close(true)).not.toThrow();
});

test("db.close(true) works after nested transactions", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY)");
  const outer = db.transaction(() => {
    db.run("INSERT INTO test (id) VALUES (1)");
    const inner = db.transaction(() => {
      db.run("INSERT INTO test (id) VALUES (2)");
    });
    inner();
  });
  outer();
  expect(() => db.close(true)).not.toThrow();
});
