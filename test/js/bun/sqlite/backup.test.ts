import { Database, constants } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

describe("Database.backupTo", () => {
  it("backs up in-memory database to file", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    source.run("INSERT INTO test VALUES (1, 'foo')");
    source.run("INSERT INTO test VALUES (2, 'bar')");

    using dir = tempDir("sqlite-backup", {});
    const destPath = path.join(String(dir), "backup.db");

    using backup = source.backupTo(destPath);

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

    using backup = source.backupTo(destPath);

    using dest = new Database(destPath);
    expect(dest.query("SELECT * FROM data ORDER BY val").all()).toEqual([{ val: 42 }, { val: 100 }]);
  });

  it("backs up to another Database instance", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE data (val INTEGER)");
    source.run("INSERT INTO data VALUES (42)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    expect(dest.query("SELECT * FROM data").all()).toEqual([{ val: 42 }]);
  });

  it("preserves multiple tables and data types", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE nums (i INTEGER, f REAL, b BLOB)");
    source.run("CREATE TABLE texts (t TEXT)");
    source.run("INSERT INTO nums VALUES (1, 3.14, X'DEADBEEF')");
    source.run("INSERT INTO texts VALUES ('hello')");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    expect(dest.query("SELECT i, f FROM nums").get()).toEqual({ i: 1, f: 3.14 });
    expect(dest.query("SELECT t FROM texts").get()).toEqual({ t: "hello" });

    // Verify BLOB
    const blob = dest.query("SELECT b FROM nums").get() as { b: Uint8Array };
    expect(Buffer.from(blob.b).toString("hex")).toBe("deadbeef");
  });

  it("backs up empty database (no tables)", () => {
    using source = new Database(":memory:");
    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

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

    using backup = source.backupTo(dest);

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
    using backup = source.backupTo(dest);
    expect(dest.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });

  it("backup after rollback captures only committed data", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");
    source.run("BEGIN");
    source.run("INSERT INTO t VALUES (2)");
    source.run("ROLLBACK");
    // Row 2 was rolled back

    using dest = new Database(":memory:");
    using backup = source.backupTo(dest);

    // Backup should only see the committed row
    const count = dest.query("SELECT COUNT(*) as c FROM t").get() as { c: number };
    expect(count.c).toBe(1);
  });
});

describe("DatabaseBackup.finish", () => {
  it("finish() is idempotent (can be called multiple times)", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);
    expect(backup.finish()).toBe(true);
    expect(backup.finish()).toBe(true); // second call is no-op
    expect(backup.finish()).toBe(true); // third call is no-op

    // Verify data was actually copied
    expect(dest.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });

  it("finish() returns boolean true on success", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);
    const result = backup.finish();
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });
});

describe("DatabaseBackup.step", () => {
  it("step returns false on completed backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    // backupTo auto-completes, so step returns false
    expect(backup.step(10)).toBe(false);
    expect(backup.step(100)).toBe(false);
    expect(backup.step()).toBe(false);
  });
});

describe("DatabaseBackup.abort", () => {
  it("abort is a no-op on already completed backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);
    // Already finished via backupTo, abort should be no-op
    backup.abort();
    // Data should still be in dest since backup was already completed
    expect(dest.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });

  it("abort is idempotent", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);
    backup.abort();
    backup.abort(); // second call is no-op
    backup.abort(); // third call is no-op
  });
});

describe("Symbol.dispose", () => {
  it("using statement properly disposes backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");

    {
      using backup = source.backupTo(dest);
    }
    // No crash or leak after scope exit

    // Verify data was copied (backupTo auto-completes)
    expect(dest.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });

  it("dispose is idempotent", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    const backup = source.backupTo(dest);
    backup[Symbol.dispose]();
    backup[Symbol.dispose](); // second call is no-op
    backup[Symbol.dispose](); // third call is no-op

    // Databases should still be usable
    source.run("INSERT INTO t VALUES (1)");
    expect(source.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
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

    // Create a database file first so we can open it readonly
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

    // Create a database file first so we can open it readonly
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

    using backup = source.backupTo(dest);

    const count = dest.query("SELECT COUNT(*) as count FROM large").get() as { count: number };
    expect(count.count).toBe(500);

    const first = dest.query("SELECT * FROM large WHERE id = 0").get() as { id: number; data: string };
    expect(first.id).toBe(0);
    expect(first.data).toBe(data);
  });
});

describe("temp file management", () => {
  it("backup overwrites an existing destination file", () => {
    using dir = tempDir("sqlite-backup-overwrite", {});
    const destPath = path.join(String(dir), "dest.db");

    // Create a pre-existing database at destPath
    {
      using old = new Database(destPath);
      old.run("CREATE TABLE old_table (x INTEGER)");
      old.run("INSERT INTO old_table VALUES (999)");
    }

    // Backup a different source to the same path
    using source = new Database(":memory:");
    source.run("CREATE TABLE new_table (y TEXT)");
    source.run("INSERT INTO new_table VALUES ('fresh')");

    using backup = source.backupTo(destPath);

    using dest = new Database(destPath, { readonly: true });
    expect(dest.query("SELECT * FROM new_table").all()).toEqual([{ y: "fresh" }]);
    // Old table should be gone
    expect(() => dest.query("SELECT * FROM old_table").all()).toThrow("no such table: old_table");
  });

  it("backup destination is a valid SQLite file with correct header", () => {
    using dir = tempDir("sqlite-backup-header", {});
    const destPath = path.join(String(dir), "backup.db");

    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using backup = source.backupTo(destPath);

    const header = readFileSync(destPath);
    expect(header.subarray(0, 15).toString("ascii")).toBe("SQLite format 3");

    // Should be openable read-only
    using dest = new Database(destPath, { readonly: true });
    expect(dest.query("SELECT * FROM t").all()).toEqual([]);
  });

  it("backup to :memory: string creates ephemeral destination", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using backup = source.backupTo(":memory:");
    // Verify the backup completed successfully
    expect(backup.finish()).toBe(true);
  });

  it("backup to empty string succeeds (ephemeral database)", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    // Empty string opens an anonymous on-disk database, backup should succeed
    using backup = source.backupTo("");
    expect(backup.finish()).toBe(true);
  });
});

describe("resource lifecycle", () => {
  it("source database remains fully usable after backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    // Source should support reads, writes, and DDL after backup
    expect(source.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
    source.run("INSERT INTO t VALUES (2)");
    expect(source.query("SELECT COUNT(*) as c FROM t").get()).toEqual({ c: 2 });
    source.run("CREATE TABLE t2 (val TEXT)");
    source.run("INSERT INTO t2 VALUES ('hello')");
    expect(source.query("SELECT * FROM t2").get()).toEqual({ val: "hello" });
  });

  it("destination Database instance remains usable after backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    // Dest should be writable after backup
    dest.run("INSERT INTO t VALUES (2)");
    expect(dest.query("SELECT * FROM t ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
    dest.run("CREATE TABLE t2 (val TEXT)");
    dest.run("INSERT INTO t2 VALUES ('world')");
    expect(dest.query("SELECT * FROM t2").get()).toEqual({ val: "world" });
  });

  it("multiple sequential backups from same source", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    // First backup
    using dest1 = new Database(":memory:");
    {
      using backup = source.backupTo(dest1);
    }

    source.run("INSERT INTO t VALUES (2)");

    // Second backup (has more data)
    using dest2 = new Database(":memory:");
    {
      using backup = source.backupTo(dest2);
    }

    source.run("INSERT INTO t VALUES (3)");

    // Third backup
    using dest3 = new Database(":memory:");
    {
      using backup = source.backupTo(dest3);
    }

    // Each dest should have the snapshot at backup time
    expect(dest1.query("SELECT COUNT(*) as c FROM t").get()).toEqual({ c: 1 });
    expect(dest2.query("SELECT COUNT(*) as c FROM t").get()).toEqual({ c: 2 });
    expect(dest3.query("SELECT COUNT(*) as c FROM t").get()).toEqual({ c: 3 });

    // Source still usable
    expect(source.query("SELECT COUNT(*) as c FROM t").get()).toEqual({ c: 3 });
  });

  it("multiple concurrent backups from same source", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");
    source.run("INSERT INTO t VALUES (2)");

    using dest1 = new Database(":memory:");
    using dest2 = new Database(":memory:");

    using backup1 = source.backupTo(dest1);
    using backup2 = source.backupTo(dest2);

    expect(dest1.query("SELECT * FROM t ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(dest2.query("SELECT * FROM t ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("GC cleans up abandoned backup without crash", async () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    // backupTo() auto-finishes, so this tests GC cleanup of a completed backup
    // and verifies the source database remains usable after the backup object
    // and destination database are collected.
    (() => {
      using dest = new Database(":memory:");
      source.backupTo(dest);
    })();

    Bun.gc(true);
    await gcTick();
    Bun.gc(true);

    // Source should still be usable after GC cleanup
    expect(source.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });
});

describe("data integrity", () => {
  it("preserves indices and enforces unique constraints", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE)");
    source.run("CREATE INDEX idx_name ON t(name)");
    source.run("INSERT INTO t VALUES (1, 'alice')");
    source.run("INSERT INTO t VALUES (2, 'bob')");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    // Index should exist in sqlite_master
    const indices = dest.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_name'").all();
    expect(indices).toEqual([{ name: "idx_name" }]);

    // UNIQUE constraint should be enforced
    expect(() => dest.run("INSERT INTO t VALUES (3, 'alice')")).toThrow("UNIQUE constraint failed");
  });

  it("preserves views", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER, category TEXT)");
    source.run("INSERT INTO t VALUES (1, 'A')");
    source.run("INSERT INTO t VALUES (2, 'B')");
    source.run("CREATE VIEW v_category_a AS SELECT * FROM t WHERE category = 'A'");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    // View should exist in sqlite_master
    const views = dest.query("SELECT name FROM sqlite_master WHERE type='view'").all();
    expect(views).toEqual([{ name: "v_category_a" }]);

    // View should be queryable
    expect(dest.query("SELECT * FROM v_category_a").all()).toEqual([{ id: 1, category: "A" }]);
  });

  it("preserves triggers", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    source.run("CREATE TABLE audit (action TEXT, item_id INTEGER)");
    source.run("CREATE TRIGGER t_insert AFTER INSERT ON t BEGIN INSERT INTO audit VALUES ('insert', NEW.id); END");
    source.run("INSERT INTO t VALUES (1, 'alice')");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    // Trigger should exist
    const triggers = dest.query("SELECT name FROM sqlite_master WHERE type='trigger'").all();
    expect(triggers).toEqual([{ name: "t_insert" }]);

    // Trigger should fire on new inserts in dest
    dest.run("INSERT INTO t VALUES (2, 'bob')");
    const audits = dest.query("SELECT * FROM audit ORDER BY item_id").all();
    expect(audits).toEqual([
      { action: "insert", item_id: 1 },
      { action: "insert", item_id: 2 },
    ]);
  });

  it("preserves empty tables (schema only)", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE empty1 (id INTEGER)");
    source.run("CREATE TABLE empty2 (name TEXT, value REAL)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    const tables = dest.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    expect(tables).toEqual([{ name: "empty1" }, { name: "empty2" }]);

    expect(dest.query("SELECT COUNT(*) as c FROM empty1").get()).toEqual({ c: 0 });
    expect(dest.query("SELECT COUNT(*) as c FROM empty2").get()).toEqual({ c: 0 });
  });

  it("preserves NULL values across all column types", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (i INTEGER, r REAL, t TEXT, b BLOB)");
    source.run("INSERT INTO t VALUES (NULL, NULL, NULL, NULL)");
    source.run("INSERT INTO t VALUES (0, 0.0, '', X'')");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    const rows = dest.query("SELECT * FROM t").all() as any[];
    // First row: all NULLs
    expect(rows[0]).toEqual({ i: null, r: null, t: null, b: null });
    // Second row: zero/empty values (not NULL)
    expect(rows[1].i).toBe(0);
    expect(rows[1].r).toBe(0.0);
    expect(rows[1].t).toBe("");
  });

  it("preserves large BLOBs spanning multiple overflow pages", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER, data BLOB)");

    const largeBlob = Buffer.alloc(1048576, 0xab); // 1MB
    source.run("INSERT INTO t VALUES (1, ?)", largeBlob);

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    const row = dest.query("SELECT id, length(data) as len FROM t").get() as { id: number; len: number };
    expect(row).toEqual({ id: 1, len: 1048576 });

    // Verify content matches
    const result = dest.query("SELECT data FROM t").get() as { data: Uint8Array };
    expect(Buffer.from(result.data).equals(largeBlob)).toBe(true);
  });

  it("preserves AUTOINCREMENT sequence counter", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
    source.run("INSERT INTO t (name) VALUES ('a')"); // id=1
    source.run("INSERT INTO t (name) VALUES ('b')"); // id=2
    source.run("INSERT INTO t (name) VALUES ('c')"); // id=3
    source.run("DELETE FROM t WHERE id = 3");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    // Next insert should get id=4 (not 3) because AUTOINCREMENT preserves the max
    dest.run("INSERT INTO t (name) VALUES ('d')");
    const row = dest.query("SELECT id FROM t WHERE name = 'd'").get() as { id: number };
    expect(row.id).toBe(4);
  });

  it("preserves a database with many tables", () => {
    using source = new Database(":memory:");
    for (let i = 0; i < 100; i++) {
      source.run(`CREATE TABLE t${i} (id INTEGER)`);
      source.run(`INSERT INTO t${i} VALUES (${i})`);
    }

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    const tables = dest.query("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as { c: number };
    expect(tables.c).toBe(100);

    // Spot-check a few tables
    expect(dest.query("SELECT * FROM t0").get()).toEqual({ id: 0 });
    expect(dest.query("SELECT * FROM t50").get()).toEqual({ id: 50 });
    expect(dest.query("SELECT * FROM t99").get()).toEqual({ id: 99 });
  });
});

describe("journal modes and concurrency", () => {
  it("backup works with WAL journal mode", () => {
    using dir = tempDir("sqlite-backup-wal", {});
    const sourcePath = path.join(String(dir), "source.db");

    using source = new Database(sourcePath);
    source.run("PRAGMA journal_mode = WAL");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");
    source.run("INSERT INTO t VALUES (2)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    expect(dest.query("SELECT * FROM t ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("backup from WAL database includes uncheckpointed data", () => {
    using dir = tempDir("sqlite-backup-wal-unchkpt", {});
    const sourcePath = path.join(String(dir), "source.db");

    using source = new Database(sourcePath);
    source.run("PRAGMA journal_mode = WAL");
    source.run("CREATE TABLE t (id INTEGER)");

    using insert = source.prepare("INSERT INTO t VALUES (?)");
    for (let i = 0; i < 200; i++) {
      insert.run(i);
    }
    // Don't checkpoint — data is in WAL

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);

    const count = dest.query("SELECT COUNT(*) as c FROM t").get() as { c: number };
    expect(count.c).toBe(200);
  });
});

describe("BUSY/LOCKED handling", () => {
  it("step() throws SQLITE_BUSY when destination is locked, with correct error message", () => {
    using dir = tempDir("backup-busy-step", {});
    const sourcePath = path.join(String(dir), "source.db");
    const destPath = path.join(String(dir), "dest.db");

    using source = new Database(sourcePath);
    source.run("PRAGMA journal_mode = DELETE");
    source.run("CREATE TABLE t (id INTEGER, data TEXT)");
    {
      using insert = source.prepare("INSERT INTO t VALUES (?, ?)");
      const bigData = Buffer.alloc(500, "x").toString();
      for (let i = 0; i < 200; i++) {
        insert.run(i, bigData);
      }
    }

    // Create dest file so another connection can lock it
    {
      using d = new Database(destPath);
      d.run("PRAGMA journal_mode = DELETE");
      d.run("CREATE TABLE dummy (x INTEGER)");
    }

    // Start incremental backup (creates internal connection to dest)
    const backup = source.backupTo(destPath, { incremental: true });

    // Lock dest from another connection — RESERVED lock prevents writes
    using locker = new Database(destPath);
    locker.run("BEGIN IMMEDIATE");

    // step() needs to write to dest → SQLITE_BUSY
    try {
      backup.step(100);
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toMatch(/locked|busy/i);
      expect(e.errno & 0xff).toBe(constants.SQLITE_BUSY);
      expect(e.code).toBe("SQLITE_BUSY");
    }

    locker.run("ROLLBACK");
    backup.abort();
  });

  it("step() is retryable after BUSY clears", () => {
    using dir = tempDir("backup-busy-retry", {});
    const sourcePath = path.join(String(dir), "source.db");
    const destPath = path.join(String(dir), "dest.db");

    using source = new Database(sourcePath);
    source.run("PRAGMA journal_mode = DELETE");
    source.run("CREATE TABLE t (id INTEGER, data TEXT)");
    {
      using insert = source.prepare("INSERT INTO t VALUES (?, ?)");
      const bigData = Buffer.alloc(500, "x").toString();
      for (let i = 0; i < 200; i++) {
        insert.run(i, bigData);
      }
    }

    {
      using d = new Database(destPath);
      d.run("PRAGMA journal_mode = DELETE");
      d.run("CREATE TABLE dummy (x INTEGER)");
    }

    const backup = source.backupTo(destPath, { incremental: true });

    // Lock dest → BUSY
    const locker = new Database(destPath);
    locker.run("BEGIN IMMEDIATE");
    expect(() => backup.step(100)).toThrow(/locked|busy/i);

    // Release lock → retry succeeds
    locker.run("ROLLBACK");
    locker.close();

    while (backup.step(100)) {}
    expect(backup.finish()).toBe(true);

    // Verify data arrived
    using dest = new Database(destPath, { readonly: true });
    const count = dest.query("SELECT COUNT(*) as c FROM t").get() as { c: number };
    expect(count.c).toBe(200);
  });

  it("finish() is retryable after BUSY clears", () => {
    using dir = tempDir("backup-busy-finish", {});
    const sourcePath = path.join(String(dir), "source.db");
    const destPath = path.join(String(dir), "dest.db");

    using source = new Database(sourcePath);
    source.run("PRAGMA journal_mode = DELETE");
    source.run("CREATE TABLE t (id INTEGER, data TEXT)");
    {
      using insert = source.prepare("INSERT INTO t VALUES (?, ?)");
      const bigData = Buffer.alloc(500, "x").toString();
      for (let i = 0; i < 200; i++) {
        insert.run(i, bigData);
      }
    }

    {
      using d = new Database(destPath);
      d.run("PRAGMA journal_mode = DELETE");
      d.run("CREATE TABLE dummy (x INTEGER)");
    }

    const backup = source.backupTo(destPath, { incremental: true });

    // Lock dest → finish() gets BUSY
    const locker = new Database(destPath);
    locker.run("BEGIN IMMEDIATE");
    expect(() => backup.finish()).toThrow(/locked|busy/i);

    // Release lock → retry succeeds
    locker.run("ROLLBACK");
    locker.close();

    expect(backup.finish()).toBe(true);

    // Verify data
    using dest = new Database(destPath, { readonly: true });
    const count = dest.query("SELECT COUNT(*) as c FROM t").get() as { c: number };
    expect(count.c).toBe(200);
  });

  it("source modifications during backup restart transparently, no BUSY", () => {
    using dir = tempDir("backup-source-mod", {});
    const sourcePath = path.join(String(dir), "source.db");
    const destPath = path.join(String(dir), "dest.db");

    using source = new Database(sourcePath);
    source.run("PRAGMA journal_mode = DELETE");
    source.run("CREATE TABLE t (id INTEGER, data TEXT)");
    {
      using insert = source.prepare("INSERT INTO t VALUES (?, ?)");
      const bigData = Buffer.alloc(500, "x").toString();
      for (let i = 0; i < 200; i++) {
        insert.run(i, bigData);
      }
    }

    const backup = source.backupTo(destPath, { incremental: true });
    expect(backup.step(5)).toBe(true);

    // Modify source while backup is in progress
    source.run("INSERT INTO t VALUES (9999, 'new data after backup started')");

    // Backup restarts transparently — no error
    while (backup.step(100)) {}
    expect(backup.finish()).toBe(true);

    // Backup includes the new data (captured after restart)
    using dest = new Database(destPath, { readonly: true });
    const row = dest.query("SELECT * FROM t WHERE id = 9999").get() as any;
    expect(row.data).toBe("new data after backup started");
  });
});

describe("cross-process verification", () => {
  it("backup file is readable by a separate Bun process", async () => {
    using dir = tempDir("sqlite-backup-cross-proc", {});
    const dbPath = path.join(String(dir), "backup.db");

    using source = new Database(":memory:");
    source.run("CREATE TABLE test (id INTEGER, name TEXT)");
    source.run("INSERT INTO test VALUES (1, 'hello')");
    source.run("INSERT INTO test VALUES (2, 'world')");

    using backup = source.backupTo(dbPath);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Database } = require("bun:sqlite");
         const db = new Database(process.env.DB_PATH);
         const rows = db.query("SELECT * FROM test ORDER BY id").all();
         console.log(JSON.stringify(rows));
         db.close();`,
      ],
      env: { ...bunEnv, DB_PATH: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe(
      JSON.stringify([
        { id: 1, name: "hello" },
        { id: 2, name: "world" },
      ]),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("WAL backup produces standalone file without -wal/-shm", async () => {
    using dir = tempDir("sqlite-backup-wal-standalone", {});
    const sourcePath = path.join(String(dir), "source.db");
    const destPath = path.join(String(dir), "backup.db");

    using source = new Database(sourcePath);
    source.run("PRAGMA journal_mode = WAL");
    source.run("CREATE TABLE data (val INTEGER)");

    using insert = source.prepare("INSERT INTO data VALUES (?)");
    for (let i = 0; i < 200; i++) {
      insert.run(i);
    }

    using backup = source.backupTo(destPath);

    // No -wal or -shm sidecar files for the backup
    expect(existsSync(destPath + "-wal")).toBe(false);
    expect(existsSync(destPath + "-shm")).toBe(false);

    // Verify data in a subprocess
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Database } = require("bun:sqlite");
         const db = new Database(process.env.DB_PATH);
         const count = db.query("SELECT COUNT(*) as c FROM data").get();
         console.log(JSON.stringify(count));
         db.close();`,
      ],
      env: { ...bunEnv, DB_PATH: destPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe(JSON.stringify({ c: 200 }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

describe("API contract", () => {
  it("backupTo returns a DatabaseBackup instance with expected methods", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);
    expect(typeof backup.finish).toBe("function");
    expect(typeof backup.step).toBe("function");
    expect(typeof backup.abort).toBe("function");
    expect(typeof backup[Symbol.dispose]).toBe("function");
  });

  it("toJSON() returns backup state", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);
    // backupTo auto-finishes, so finished=true and success=true
    expect(backup.toJSON()).toEqual({ finished: true, success: true, pageCount: 0, remaining: 0 });
  });

  it("toString() returns a descriptive string", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);
    expect(backup.toString()).toBe("[DatabaseBackup finished=true success=true]");
  });

  it("toJSON() and toString() are stable after redundant abort on completed backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    const backup = source.backupTo(dest);
    // backupTo auto-finishes, abort after is a no-op since already finished
    backup.abort();
    expect(backup.toJSON()).toEqual({ finished: true, success: true, pageCount: 0, remaining: 0 });
    expect(backup.toString()).toBe("[DatabaseBackup finished=true success=true]");
  });

  it("backupTo returns a DatabaseBackup with pageCount and remaining getters", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");

    using backup = source.backupTo(dest);
    expect(typeof backup.pageCount).toBe("number");
    expect(typeof backup.remaining).toBe("number");
  });
});

describe("incremental backup", () => {
  it("step loop completes and copies all data", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE large (id INTEGER, data TEXT)");

    using insert = source.prepare("INSERT INTO large VALUES (?, ?)");
    const data = Buffer.alloc(200, "x").toString();
    for (let i = 0; i < 500; i++) {
      insert.run(i, data);
    }

    using dest = new Database(":memory:");
    using backup = source.backupTo(dest, { incremental: true });

    let steps = 0;
    while (backup.step(10)) {
      steps++;
    }

    expect(steps).toBeGreaterThan(0);

    const count = dest.query("SELECT COUNT(*) as c FROM large").get() as { c: number };
    expect(count.c).toBe(500);
  });

  it("step returns true when more pages remain", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE large (id INTEGER, data TEXT)");

    using insert = source.prepare("INSERT INTO large VALUES (?, ?)");
    const data = Buffer.alloc(200, "x").toString();
    for (let i = 0; i < 500; i++) {
      insert.run(i, data);
    }

    using dest = new Database(":memory:");
    using backup = source.backupTo(dest, { incremental: true });

    const result = backup.step(5);
    expect(result).toBe(true);
    expect(backup.pageCount).toBeGreaterThan(0);
    expect(backup.remaining).toBeGreaterThan(0);
    expect(backup.remaining).toBeLessThanOrEqual(backup.pageCount);
  });

  it("getters track progress across steps", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE large (id INTEGER, data TEXT)");

    using insert = source.prepare("INSERT INTO large VALUES (?, ?)");
    const data = Buffer.alloc(200, "x").toString();
    for (let i = 0; i < 500; i++) {
      insert.run(i, data);
    }

    using dest = new Database(":memory:");
    using backup = source.backupTo(dest, { incremental: true });

    // Before first step, getters are 0
    expect(backup.pageCount).toBe(0);
    expect(backup.remaining).toBe(0);

    const result = backup.step(5);
    expect(result).toBe(true);
    expect(backup.pageCount).toBeGreaterThan(0);
    expect(backup.remaining).toBeGreaterThan(0);

    // Run to completion
    while (backup.step(100)) {}

    expect(backup.remaining).toBe(0);
  });

  it("incremental + finish() completes the remainder", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE large (id INTEGER, data TEXT)");

    using insert = source.prepare("INSERT INTO large VALUES (?, ?)");
    const data = Buffer.alloc(200, "x").toString();
    for (let i = 0; i < 500; i++) {
      insert.run(i, data);
    }

    using dest = new Database(":memory:");
    using backup = source.backupTo(dest, { incremental: true });

    // Do a few steps
    backup.step(5);
    backup.step(5);

    // Finish the rest
    const ok = backup.finish();
    expect(ok).toBe(true);

    const count = dest.query("SELECT COUNT(*) as c FROM large").get() as { c: number };
    expect(count.c).toBe(500);
  });

  it("incremental + abort() stops copying", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE large (id INTEGER, data TEXT)");

    using insert = source.prepare("INSERT INTO large VALUES (?, ?)");
    const data = Buffer.alloc(200, "x").toString();
    for (let i = 0; i < 500; i++) {
      insert.run(i, data);
    }

    using dest = new Database(":memory:");
    using backup = source.backupTo(dest, { incremental: true });

    // Do a few steps then abort
    backup.step(5);
    backup.abort();

    // After abort, step and finish are no-ops
    expect(backup.step()).toBe(false);
    expect(backup.finish()).toBe(false);
  });

  it("source remains usable after incremental backup is disposed", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");
    {
      using backup = source.backupTo(dest, { incremental: true });
      backup.step(5);
    }
    // Source still usable after backup scope exit
    expect(source.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });

  it("toJSON includes progress fields", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE large (id INTEGER, data TEXT)");

    using insert = source.prepare("INSERT INTO large VALUES (?, ?)");
    const data = Buffer.alloc(200, "x").toString();
    for (let i = 0; i < 500; i++) {
      insert.run(i, data);
    }

    using dest = new Database(":memory:");
    using backup = source.backupTo(dest, { incremental: true });

    backup.step(5);
    const json = backup.toJSON();
    expect(json).toHaveProperty("finished");
    expect(json).toHaveProperty("success");
    expect(json).toHaveProperty("pageCount");
    expect(json).toHaveProperty("remaining");
    expect(json.pageCount).toBeGreaterThan(0);
  });
});

describe("schema options", () => {
  it("explicit sourceSchema 'main' works same as default", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dest = new Database(":memory:");
    using backup = source.backupTo(dest, { sourceSchema: "main" });

    expect(dest.query("SELECT * FROM t").all()).toEqual([{ id: 1 }]);
  });

  it("backs up an attached database via sourceSchema", () => {
    using dir = tempDir("sqlite-backup-attach", {});
    const attachedPath = path.join(String(dir), "attached.db");
    const destPath = path.join(String(dir), "dest.db");

    // Create the attached database file
    {
      using attached = new Database(attachedPath);
      attached.run("CREATE TABLE aux_data (val TEXT)");
      attached.run("INSERT INTO aux_data VALUES ('from_aux')");
    }

    // Open a main database and attach
    using main = new Database(":memory:");
    main.run("CREATE TABLE main_data (val TEXT)");
    main.run("INSERT INTO main_data VALUES ('from_main')");
    main.run(`ATTACH '${attachedPath}' AS aux`);

    // Backup just the attached schema
    using backup = main.backupTo(destPath, { sourceSchema: "aux" });

    // The dest should have aux_data, not main_data
    using restored = new Database(destPath, { readonly: true });
    expect(restored.query("SELECT * FROM aux_data").all()).toEqual([{ val: "from_aux" }]);
    expect(() => restored.query("SELECT * FROM main_data").all()).toThrow("no such table: main_data");
  });

  it("backs up to a specific destSchema on the destination", () => {
    using dir = tempDir("sqlite-backup-destschema", {});
    const destPath = path.join(String(dir), "dest.db");
    const auxPath = path.join(String(dir), "aux_dest.db");

    // Create a source
    using source = new Database(":memory:");
    source.run("CREATE TABLE src_data (val INTEGER)");
    source.run("INSERT INTO src_data VALUES (42)");

    // Create a dest with an attached database
    using dest = new Database(destPath);
    dest.run(`ATTACH '${auxPath}' AS aux`);

    // Backup into the attached "aux" schema on the dest
    using backup = source.backupTo(dest, { destSchema: "aux" });

    // The data should be in the aux database, not main
    using auxDb = new Database(auxPath, { readonly: true });
    expect(auxDb.query("SELECT * FROM src_data").all()).toEqual([{ val: 42 }]);
  });

  it("invalid sourceSchema throws", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");
    expect(() => source.backupTo(dest, { sourceSchema: "nonexistent" })).toThrow("unknown database");
  });

  it("invalid destSchema throws", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");

    using dest = new Database(":memory:");
    expect(() => source.backupTo(dest, { destSchema: "nonexistent" })).toThrow("unknown database");
  });

  it("closing source database aborts active incremental backup", () => {
    const source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    for (let i = 0; i < 1000; i++) {
      source.run(`INSERT INTO t VALUES (${i})`);
    }

    using dir = tempDir("sqlite-backup-close-abort", {});
    const destPath = path.join(String(dir), "backup.db");

    const backup = source.backupTo(destPath, { incremental: true });
    // Take one step to start the backup
    backup.step(1);

    // Close the source database -- should abort the backup
    source.close();

    // Subsequent step() should throw because the backup was aborted
    expect(() => backup.step()).toThrow("Cannot use backup after the database was closed");
  });

  it("closing dest database aborts active incremental backup", () => {
    using source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    for (let i = 0; i < 1000; i++) {
      source.run(`INSERT INTO t VALUES (${i})`);
    }

    const dest = new Database(":memory:");
    const backup = source.backupTo(dest, { incremental: true });
    backup.step(1);

    // Close the destination database -- should abort the backup
    dest.close();

    // Subsequent step() should throw because the backup was aborted
    expect(() => backup.step()).toThrow("Cannot use backup after the database was closed");
  });

  it("finish() throws after database was closed during incremental backup", () => {
    const source = new Database(":memory:");
    source.run("CREATE TABLE t (id INTEGER)");
    source.run("INSERT INTO t VALUES (1)");

    using dir = tempDir("sqlite-backup-close-finish", {});
    const destPath = path.join(String(dir), "backup.db");

    const backup = source.backupTo(destPath, { incremental: true });
    backup.step(1);

    source.close();

    expect(() => backup.finish()).toThrow("Cannot use backup after the database was closed");
  });
});
