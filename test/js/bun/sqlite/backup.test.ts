import { Database, constants } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { gcTick, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Database.backupTo", () => {
  it("backs up in-memory database to file", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    source.run("INSERT INTO test VALUES (1, 'foo')");
    source.run("INSERT INTO test VALUES (2, 'bar')");

    using dir = tempDir("sqlite-backup", {});
    const destPath = path.join(String(dir), "backup.db");

    source.backupTo(destPath);

    using restored = new Database(destPath);
    expect(restored.query("SELECT * FROM test ORDER BY id").all()).toEqual([
      { id: 1, name: "foo" },
      { id: 2, name: "bar" },
    ]);
  });

  it("backs up file database to another file", () => {
    using dir = tempDir("sqlite-backup-file", {
      "source.db": "",
    });

    const sourcePath = path.join(String(dir), "source.db");
    const destPath = path.join(String(dir), "dest.db");

    using source = new Database(sourcePath);
    source.run("CREATE TABLE data (val INTEGER)");
    source.run("INSERT INTO data VALUES (42)");
    source.run("INSERT INTO data VALUES (100)");

    source.backupTo(destPath);

    using dest = new Database(destPath);
    expect(dest.query("SELECT * FROM data ORDER BY val").all()).toEqual([{ val: 42 }, { val: 100 }]);
  });

  it("backs up to another Database instance", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE data (val INTEGER)");
    source.run("INSERT INTO data VALUES (42)");

    using dest = new Database(":memory:");

    source.backupTo(dest);

    expect(dest.query("SELECT * FROM data").all()).toEqual([{ val: 42 }]);
  });

  it("preserves multiple tables and data types", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE nums (i INTEGER, f REAL, b BLOB)");
    source.run("CREATE TABLE texts (t TEXT)");
    source.run("INSERT INTO nums VALUES (1, 3.14, X'DEADBEEF')");
    source.run("INSERT INTO texts VALUES ('hello')");

    using dest = new Database(":memory:");

    source.backupTo(dest);

    expect(dest.query("SELECT i, f FROM nums").get()).toEqual({ i: 1, f: 3.14 });
    expect(dest.query("SELECT t FROM texts").get()).toEqual({ t: "hello" });

    // Verify BLOB
    const blob = dest.query("SELECT b FROM nums").get() as { b: Uint8Array };
    expect(Buffer.from(blob.b).toString("hex")).toBe("deadbeef");
  });

  it("backs up empty database (no tables)", () => {
    using source = new Database(":memory:");
    using dest = new Database(":memory:");

    source.backupTo(dest);

    const tables = dest.query("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables).toEqual([]);
  });

  it("backs up to non-empty destination (overwrites)", () => {
    using dest = new Database(":memory:");
    dest.run("CREATE TABLE old (x INTEGER)");
    dest.run("INSERT INTO old VALUES (999)");

    using source = new Database(":memory:");
    source.run("CREATE TABLE new_table (y TEXT)");
    source.run("INSERT INTO new_table VALUES ('fresh')");

    source.backupTo(dest);

    expect(dest.query("SELECT * FROM new_table").all()).toEqual([{ y: "fresh" }]);
    // Old table should be gone
    expect(() => dest.query("SELECT * FROM old").all()).toThrow("no such table: old");
  });

  it("throws with no arguments", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    expect(() => (source as any).backupTo()).toThrow("Expected 'destination' to be a string or Database");
  });

  it("backs up from a readonly database", () => {
    using dir = tempDir("sqlite-backup-readonly", {});
    const dbPath = path.join(String(dir), "source.db");
    {
      using db = new Database(dbPath);
      db.run("CREATE TABLE t (id INTEGER)");
      db.run("INSERT INTO t VALUES (1)");
    }
    using source = new Database(dbPath, { readonly: true });
    using dest = new Database(":memory:");
    source.backupTo(dest);
    expect(dest.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });
});

describe("returned result object", () => {
  it("has pageCount, remaining, toJSON, toString", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");

    const result = source.backupTo(dest);
    expect(typeof result.pageCount).toBe("number");
    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.remaining).toBe(0);
    expect(result.toJSON()).toEqual({
      finished: true,
      success: true,
      pageCount: result.pageCount,
      remaining: 0,
    });
    expect(result.toString()).toBe("[DatabaseBackup finished=true success=true]");
  });
});

describe("error handling", () => {
  it("throws when source database is closed", () => {
    const source = new Database(":memory:");
    source.close();

    expect(() => source.backupTo(":memory:")).toThrow("Cannot backup a closed database");
  });

  it("throws when destination Database instance is closed", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    const dest = new Database(":memory:");
    dest.close();

    expect(() => source.backupTo(dest)).toThrow("Cannot backup to a closed database");
  });

  it("throws when backing up a database to itself", () => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (id INTEGER)");

    expect(() => db.backupTo(db)).toThrow("Cannot backup a database to itself");
  });

  it("throws when destination opened with numeric SQLITE_OPEN_READONLY flag", () => {
    using dir = tempDir("sqlite-backup-numeric-readonly", {});
    const destPath = path.join(String(dir), "dest.db");

    {
      using db = new Database(destPath);
      db.run("CREATE TABLE t (id INTEGER)");
    }

    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(destPath, constants.SQLITE_OPEN_READONLY);
    expect(() => source.backupTo(dest)).toThrow("Cannot backup to a readonly database");
  });

  it("throws with invalid destination type", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    expect(() => (source as any).backupTo(123)).toThrow("Expected 'destination' to be a string or Database");
    expect(() => (source as any).backupTo(null)).toThrow("Expected 'destination' to be a string or Database");
    expect(() => (source as any).backupTo(undefined)).toThrow("Expected 'destination' to be a string or Database");
  });

  it("backup to invalid path throws", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dir = tempDir("sqlite-backup-badpath", {});
    const badPath = path.join(String(dir), "deeply", "nested", "missing", "backup.db");
    expect(() => source.backupTo(badPath)).toThrow("unable to open database file");
  });

  it("backup to readonly Database destination throws", () => {
    using dir = tempDir("sqlite-backup-readonly-dest", {});
    const destPath = path.join(String(dir), "dest.db");

    {
      using db = new Database(destPath);
      db.run("CREATE TABLE t (id INTEGER)");
    }

    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(destPath, { readonly: true });
    expect(() => source.backupTo(dest)).toThrow("Cannot backup to a readonly database");
  });
});

describe("large data", () => {
  it("backs up database with many rows", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE large (id INTEGER, data TEXT)");

    using insert = source.prepare("INSERT INTO large VALUES (?, ?)");
    const data = Buffer.alloc(100, "x").toString();
    for (let i = 0; i < 500; i++) {
      insert.run(i, data);
    }

    using dest = new Database(":memory:");

    source.backupTo(dest);

    const count = dest.query("SELECT COUNT(*) as count FROM large").get() as { count: number };
    expect(count.count).toBe(500);

    const first = dest.query("SELECT * FROM large WHERE id = 0").get() as { id: number; data: string };
    expect(first.id).toBe(0);
    expect(first.data).toBe(data);
  });
});

describe("file management", () => {
  it("backup overwrites an existing destination file", () => {
    using dir = tempDir("sqlite-backup-overwrite", {});
    const destPath = path.join(String(dir), "dest.db");

    {
      using old = new Database(destPath);
      old.run("CREATE TABLE old_table (x INTEGER)");
      old.run("INSERT INTO old_table VALUES (999)");
    }

    using source = new Database(":memory:");
    source.run("CREATE TABLE new_table (y TEXT)");
    source.run("INSERT INTO new_table VALUES ('fresh')");

    source.backupTo(destPath);

    using dest = new Database(destPath, { readonly: true });
    expect(dest.query("SELECT * FROM new_table").all()).toEqual([{ y: "fresh" }]);
    expect(() => dest.query("SELECT * FROM old_table").all()).toThrow("no such table: old_table");
  });

  it("backup destination is a valid SQLite file", () => {
    using dir = tempDir("sqlite-backup-header", {});
    const destPath = path.join(String(dir), "backup.db");

    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    source.backupTo(destPath);

    const header = readFileSync(destPath);
    expect(header.subarray(0, 15).toString("ascii")).toBe("SQLite format 3");
  });
});

describe("resource lifecycle", () => {
  it("source database remains fully usable after backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");

    source.backupTo(dest);

    expect(source.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
    source.run("INSERT INTO t VALUES (2)");
    expect(source.query("SELECT COUNT(*) as c FROM t").get()).toEqual({ c: 2 });
  });

  it("destination Database instance remains usable after backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");

    source.backupTo(dest);

    dest.run("INSERT INTO t VALUES (2)");
    expect(dest.query("SELECT * FROM t ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("multiple sequential backups from same source", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest1 = new Database(":memory:");
    source.backupTo(dest1);

    source.run("INSERT INTO t VALUES (2)");

    using dest2 = new Database(":memory:");
    source.backupTo(dest2);

    expect(dest1.query("SELECT COUNT(*) as c FROM t").get()).toEqual({ c: 1 });
    expect(dest2.query("SELECT COUNT(*) as c FROM t").get()).toEqual({ c: 2 });
  });

  it("GC cleans up abandoned backup without crash", async () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    (() => {
      using dest = new Database(":memory:");
      source.backupTo(dest);
    })();

    Bun.gc(true);
    await gcTick();
    Bun.gc(true);

    expect(source.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });
});
