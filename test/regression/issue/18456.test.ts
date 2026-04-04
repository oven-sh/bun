import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

test("named bindings work in non-strict mode", () => {
  const db = new Database();

  db.run(`
    CREATE TABLE test (
      id INTEGER NOT NULL PRIMARY KEY,
      expiresAt TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS test_expiresAt BEFORE INSERT ON test
    BEGIN SELECT CASE WHEN datetime(NEW.expiresAt) IS NULL
      THEN RAISE (ABORT, 'Invalid datetime format') END;
    END;
  `);

  // Positional bindings should work
  const insertPosStmt = db.query("INSERT INTO test(id, expiresAt) VALUES (?, ?);");
  insertPosStmt.run(1, "2025-03-27T09:04:21.412880655Z");
  expect(db.query("SELECT * FROM test WHERE id = 1").get()).toEqual({
    id: 1,
    expiresAt: "2025-03-27T09:04:21.412880655Z",
  });

  // Named bindings with @ prefix should also work in non-strict mode
  const insertObjStmt = db.query("INSERT INTO test(id, expiresAt) VALUES (@id, @expiresAt);");
  insertObjStmt.run({ id: 2, expiresAt: "2025-03-27T09:04:21.412880655Z" });
  expect(db.query("SELECT * FROM test WHERE id = 2").get()).toEqual({
    id: 2,
    expiresAt: "2025-03-27T09:04:21.412880655Z",
  });

  // Named bindings with $ prefix should also work
  const insertDollarStmt = db.query("INSERT INTO test(id, expiresAt) VALUES ($id, $expiresAt);");
  insertDollarStmt.run({ id: 3, expiresAt: "2025-03-27T09:04:21.412880655Z" });
  expect(db.query("SELECT * FROM test WHERE id = 3").get()).toEqual({
    id: 3,
    expiresAt: "2025-03-27T09:04:21.412880655Z",
  });

  // Named bindings with : prefix should also work
  const insertColonStmt = db.query("INSERT INTO test(id, expiresAt) VALUES (:id, :expiresAt);");
  insertColonStmt.run({ id: 4, expiresAt: "2025-03-27T09:04:21.412880655Z" });
  expect(db.query("SELECT * FROM test WHERE id = 4").get()).toEqual({
    id: 4,
    expiresAt: "2025-03-27T09:04:21.412880655Z",
  });
});

test("named bindings work in strict mode", () => {
  const db = new Database(":memory:", { strict: true });

  db.run(`
    CREATE TABLE test (
      id INTEGER NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const stmt = db.query("INSERT INTO test(id, value) VALUES (@id, @value);");
  stmt.run({ id: 1, value: "hello" });
  expect(db.query("SELECT * FROM test WHERE id = 1").get()).toEqual({
    id: 1,
    value: "hello",
  });
});

test("strict mode throws on missing named parameters", () => {
  const db = new Database(":memory:", { strict: true });

  db.run(`CREATE TABLE test (id INTEGER NOT NULL PRIMARY KEY, value TEXT);`);

  const stmt = db.query("INSERT INTO test(id, value) VALUES (@id, @value);");
  expect(() => stmt.run({ id: 1 })).toThrow(/Missing parameter/);
});
