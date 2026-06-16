// https://github.com/oven-sh/bun/issues/9410
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

describe("Database options { create: false }", () => {
  test("opens an existing database read-write", () => {
    using dir = tempDir("sqlite-create-false", {});
    const dbPath = join(String(dir), "test.db");

    {
      const db = new Database(dbPath, { create: true });
      db.exec("CREATE TABLE foo (id INTEGER)");
      db.close();
    }

    const db = new Database(dbPath, { create: false });
    try {
      db.exec("INSERT INTO foo (id) VALUES (1)");
      const row = db.query("SELECT id FROM foo").get() as { id: number };
      expect(row).toEqual({ id: 1 });
    } finally {
      db.close();
    }
  });

  test("errors with SQLITE_CANTOPEN when file does not exist", () => {
    using dir = tempDir("sqlite-create-false-missing", {});
    const dbPath = join(String(dir), "does-not-exist.db");

    let error: any;
    try {
      new Database(dbPath, { create: false });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe("SQLITE_CANTOPEN");
  });

  test("with readonly: true opens readonly", () => {
    using dir = tempDir("sqlite-create-false-ro", {});
    const dbPath = join(String(dir), "test.db");

    {
      const db = new Database(dbPath, { create: true });
      db.exec("CREATE TABLE foo (id INTEGER)");
      db.close();
    }

    const db = new Database(dbPath, { create: false, readonly: true });
    try {
      expect(() => db.exec("INSERT INTO foo (id) VALUES (1)")).toThrow();
      expect(db.query("SELECT COUNT(*) as n FROM foo").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});

describe("Database options { readwrite: false }", () => {
  test("opens an existing database readonly", () => {
    using dir = tempDir("sqlite-readwrite-false", {});
    const dbPath = join(String(dir), "test.db");

    {
      const db = new Database(dbPath, { create: true });
      db.exec("CREATE TABLE foo (id INTEGER)");
      db.close();
    }

    const db = new Database(dbPath, { readwrite: false });
    try {
      expect(() => db.exec("INSERT INTO foo (id) VALUES (1)")).toThrow();
      expect(db.query("SELECT COUNT(*) as n FROM foo").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});
