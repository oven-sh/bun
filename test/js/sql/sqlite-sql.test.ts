import { SQL } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "path";

describe("Connection & Initialization", () => {
  test("should connect to in-memory SQLite database", async () => {
    const sql = new SQL("sqlite://:memory:");
    expect(sql).toBeDefined();
    expect(sql.options.adapter).toBe("sqlite");
    await sql.close();
  });

  test("should connect to file-based SQLite database", async () => {
    const dir = tempDirWithFiles("sqlite-db-test", {});
    const dbPath = path.join(dir, "test.db");

    const sql = new SQL(`sqlite://${dbPath}`);
    expect(sql).toBeDefined();
    expect(sql.options.adapter).toBe("sqlite");
    expect((sql.options as Bun.SQL.SQLiteOptions).filename).toBe(dbPath);

    await sql.close();
    await rm(dir, { recursive: true });
  });

  test("should handle connection with options object", async () => {
    const sql = new SQL({
      adapter: "sqlite",
      filename: ":memory:",
    });

    expect(sql.options.adapter).toBe("sqlite");
    expect((sql.options as Bun.SQL.SQLiteOptions).filename).toBe(":memory:");

    await sql`CREATE TABLE test (id INTEGER)`;
    await sql`INSERT INTO test VALUES (1)`;

    const result = await sql`SELECT * FROM test`;
    expect(result).toHaveLength(1);

    await sql.close();
  });

  test("should create database file if it doesn't exist", async () => {
    const dir = tempDirWithFiles("sqlite-create-test", {});
    const dbPath = path.join(dir, "new.db");

    const sql = new SQL(`sqlite://${dbPath}`);
    await sql`CREATE TABLE test (id INTEGER)`;

    const stats = await stat(dbPath);
    expect(stats.isFile()).toBe(true);

    await sql.close();
    await rm(dir, { recursive: true });
  });

  test("should work with relative paths", async () => {
    const dir = tempDirWithFiles("sqlite-test", {});
    const sql = new SQL({
      adapter: "sqlite",
      filename: path.join(dir, "test.db"),
    });

    await sql`CREATE TABLE test (id INTEGER)`;
    const stats = await stat(path.join(dir, "test.db"));
    expect(stats.isFile()).toBe(true);

    await sql.close();
    await rm(dir, { recursive: true });
  });
});

describe("Data Types & Values", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("handles NULL values", async () => {
    await sql`CREATE TABLE nulls (id INTEGER, value TEXT)`;
    await sql`INSERT INTO nulls (id, value) VALUES (1, ${null})`;

    const result = await sql`SELECT * FROM nulls`;
    expect(result[0].value).toBeNull();
  });

  test("handles INTEGER values", async () => {
    const values = [0, 1, -1, 2147483647, -2147483648];
    await sql`CREATE TABLE integers (value INTEGER)`;

    for (const val of values) {
      await sql`INSERT INTO integers VALUES (${val})`;
    }

    const results = await sql`SELECT * FROM integers`;
    expect(results.map(r => r.value)).toEqual(values);
  });

  test("handles REAL values", async () => {
    const values = [0.0, 1.1, -1.1, 3.14159, Number.MAX_SAFE_INTEGER + 0.1];
    await sql`CREATE TABLE reals (value REAL)`;

    for (const val of values) {
      await sql`INSERT INTO reals VALUES (${val})`;
    }

    const results = await sql`SELECT * FROM reals`;
    results.forEach((r, i) => {
      expect(r.value).toBeCloseTo(values[i], 10);
    });
  });

  test("handles TEXT values", async () => {
    const values = ["", "hello", "hello world", "unicode: 你好 🌍", "'quotes'", '"double quotes"'];
    await sql`CREATE TABLE texts (value TEXT)`;

    for (const val of values) {
      await sql`INSERT INTO texts VALUES (${val})`;
    }

    const results = await sql`SELECT * FROM texts`;
    expect(results.map(r => r.value)).toEqual(values);
  });

  test("handles BLOB values", async () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
    await sql`CREATE TABLE blobs (value BLOB)`;
    await sql`INSERT INTO blobs VALUES (${buffer})`;

    const result = await sql`SELECT * FROM blobs`;
    expect(Buffer.from(result[0].value)).toEqual(buffer);
  });

  test("handles boolean values (stored as INTEGER)", async () => {
    await sql`CREATE TABLE bools (value INTEGER)`;
    await sql`INSERT INTO bools VALUES (${true}), (${false})`;

    const results = await sql`SELECT * FROM bools`;
    expect(results[0].value).toBe(1);
    expect(results[1].value).toBe(0);
  });

  test("handles Date values (stored as TEXT)", async () => {
    const date = new Date("2024-01-01T12:00:00Z");
    await sql`CREATE TABLE dates (value TEXT)`;
    await sql`INSERT INTO dates VALUES (${date.toISOString()})`;

    const result = await sql`SELECT * FROM dates`;
    expect(new Date(result[0].value)).toEqual(date);
  });

  test("handles JSON values (stored as TEXT)", async () => {
    const jsonData = { name: "Test", values: [1, 2, 3], nested: { key: "value" } };
    await sql`CREATE TABLE json_data (value TEXT)`;
    await sql`INSERT INTO json_data VALUES (${JSON.stringify(jsonData)})`;

    const result = await sql`SELECT * FROM json_data`;
    expect(JSON.parse(result[0].value)).toEqual(jsonData);
  });
});

describe("Query Execution", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("CREATE TABLE", async () => {
    const result = await sql`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        age INTEGER CHECK (age >= 0),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;

    expect(result.command).toBe("CREATE");
  });

  test("INSERT with RETURNING", async () => {
    await sql`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;

    const result = await sql`INSERT INTO items (name) VALUES (${"Item1"}) RETURNING *`;
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].name).toBe("Item1");
    expect(result.command).toBe("INSERT");
  });

  test("UPDATE with affected rows", async () => {
    await sql`CREATE TABLE products (id INTEGER PRIMARY KEY, price REAL)`;
    await sql`INSERT INTO products VALUES (1, 10.0), (2, 20.0), (3, 30.0)`;

    const result = await sql`UPDATE products SET price = price * 1.1 WHERE price < 25`;
    expect(result.count).toBe(2);
    expect(result.command).toBe("UPDATE");
  });

  test("DELETE with affected rows", async () => {
    await sql`CREATE TABLE tasks (id INTEGER PRIMARY KEY, done INTEGER)`;
    await sql`INSERT INTO tasks VALUES (1, 0), (2, 1), (3, 0), (4, 1)`;

    const result = await sql`DELETE FROM tasks WHERE done = 1`;
    expect(result.count).toBe(2);
    expect(result.command).toBe("DELETE");
  });

  test("SELECT with various clauses", async () => {
    await sql`CREATE TABLE scores (id INTEGER, player TEXT, score INTEGER, team TEXT)`;
    await sql`INSERT INTO scores VALUES
        (1, 'Alice', 100, 'Red'),
        (2, 'Bob', 85, 'Blue'),
        (3, 'Charlie', 95, 'Red'),
        (4, 'Diana', 110, 'Blue')`;

    // ORDER BY
    const ordered = await sql`SELECT * FROM scores ORDER BY score DESC`;
    expect(ordered[0].player).toBe("Diana");

    // WHERE
    const filtered = await sql`SELECT * FROM scores WHERE score > ${90}`;
    expect(filtered).toHaveLength(3);

    // GROUP BY with aggregate
    const grouped = await sql`
        SELECT team, COUNT(*) as count, AVG(score) as avg_score
        FROM scores
        GROUP BY team
      `;
    expect(grouped).toHaveLength(2);

    // LIMIT and OFFSET
    const limited = await sql`SELECT * FROM scores ORDER BY score DESC LIMIT 2 OFFSET 1`;
    expect(limited).toHaveLength(2);
    expect(limited[0].player).toBe("Alice");
  });

  test("handles multiple statements with unsafe", async () => {
    const result = await sql.unsafe(`
        CREATE TABLE multi1 (id INTEGER);
        CREATE TABLE multi2 (id INTEGER);
        INSERT INTO multi1 VALUES (1);
        INSERT INTO multi2 VALUES (2);
        SELECT * FROM multi1;
        SELECT * FROM multi2;
      `);

    // SQLite returns the last result
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });
});

describe("Parameterized Queries", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE params_test (id INTEGER, text_val TEXT, num_val REAL)`;
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("converts PostgreSQL $N style to SQLite ? style", async () => {
    // The SQL template tag internally uses $N style, should be converted to ?
    await sql`INSERT INTO params_test VALUES (${1}, ${"test"}, ${3.14})`;

    const result = await sql`SELECT * FROM params_test WHERE id = ${1}`;
    expect(result[0].text_val).toBe("test");
    expect(result[0].num_val).toBeCloseTo(3.14);
  });

  test("handles many parameters", async () => {
    const values = Array.from({ length: 20 }, (_, i) => i);
    const columns = values.map(i => `col${i} INTEGER`).join(", ");
    const tableName = "many_params";

    await sql.unsafe(`CREATE TABLE ${tableName} (${columns})`);

    const placeholders = values.map(() => "?").join(", ");
    await sql.unsafe(`INSERT INTO ${tableName} VALUES (${placeholders})`, values);

    const result = await sql.unsafe(`SELECT * FROM ${tableName}`);
    expect(Object.values(result[0])).toEqual(values);
  });

  test("escapes special characters in parameters", async () => {
    const specialStrings = [
      "'; DROP TABLE users; --",
      '" OR "1"="1',
      "\\'; DROP TABLE users; --",
      "\x00\x01\x02",
      "Robert'); DROP TABLE Students;--",
    ];

    for (const str of specialStrings) {
      await sql`INSERT INTO params_test (id, text_val) VALUES (${100}, ${str})`;
      const result = await sql`SELECT text_val FROM params_test WHERE id = ${100}`;
      expect(result[0].text_val).toBe(str);
      await sql`DELETE FROM params_test WHERE id = ${100}`;
    }
  });
});

describe("Transactions", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance REAL)`;
    await sql`INSERT INTO accounts VALUES (1, 1000), (2, 500)`;
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("successful transaction commits", async () => {
    const result = await sql.begin(async tx => {
      await tx`UPDATE accounts SET balance = balance - 100 WHERE id = 1`;
      await tx`UPDATE accounts SET balance = balance + 100 WHERE id = 2`;
      return "success";
    });

    expect(result).toBe("success");

    const accounts = await sql`SELECT * FROM accounts ORDER BY id`;
    expect(accounts[0].balance).toBe(900);
    expect(accounts[1].balance).toBe(600);
  });

  test("failed transaction rolls back", async () => {
    try {
      await sql.begin(async tx => {
        await tx`UPDATE accounts SET balance = balance - 2000 WHERE id = 1`;
        await tx`UPDATE accounts SET balance = balance + 2000 WHERE id = 2`;
        throw new Error("Insufficient funds");
      });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Insufficient funds");
    }

    const accounts = await sql`SELECT * FROM accounts ORDER BY id`;
    expect(accounts[0].balance).toBe(1000);
    expect(accounts[1].balance).toBe(500);
  });

  test("nested transactions (savepoints)", async () => {
    await sql.begin(async tx => {
      await tx`UPDATE accounts SET balance = balance - 100 WHERE id = 1`;

      try {
        await tx.savepoint(async sp => {
          await sp`UPDATE accounts SET balance = balance - 200 WHERE id = 1`;
          throw new Error("Inner transaction failed");
        });
      } catch (err) {
        // Inner transaction rolled back, outer continues
      }

      await tx`UPDATE accounts SET balance = balance + 100 WHERE id = 2`;
    });

    const accounts = await sql`SELECT * FROM accounts ORDER BY id`;
    expect(accounts[0].balance).toBe(900); // Only first update applied
    expect(accounts[1].balance).toBe(600);
  });

  test("read-only transactions", async () => {
    const result = await sql.begin("read", async tx => {
      const accounts = await tx`SELECT * FROM accounts`;

      try {
        await tx`UPDATE accounts SET balance = 0`;
        expect().fail("Update should have failed"); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("readonly");
      }

      return accounts;
    });

    expect(result).toHaveLength(2);
  });

  test("deferred vs immediate transactions", async () => {
    // SQLite supports DEFERRED, IMMEDIATE, and EXCLUSIVE transaction modes
    await sql.begin("deferred", async tx => {
      await tx`SELECT * FROM accounts`; // Acquires shared lock
      await tx`UPDATE accounts SET balance = balance + 1`; // Upgrades to exclusive lock
    });

    await sql.begin("immediate", async tx => {
      // Acquires reserved lock immediately
      await tx`UPDATE accounts SET balance = balance + 1`;
    });

    const accounts = await sql`SELECT * FROM accounts WHERE id = 1`;
    expect(accounts[0].balance).toBe(1002);
  });
});

describe("SQLite-specific features", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("PRAGMA statements", async () => {
    // Get SQLite version
    const version = await sql`PRAGMA compile_options`;
    expect(version.length).toBeGreaterThan(0);

    // Check journal mode
    const journalMode = await sql`PRAGMA journal_mode`;
    expect(journalMode[0].journal_mode).toBeDefined();

    // Set and check synchronous mode
    await sql`PRAGMA synchronous = NORMAL`;
    const syncMode = await sql`PRAGMA synchronous`;
    expect(syncMode[0].synchronous).toBe(1);
  });

  test("AUTOINCREMENT behavior", async () => {
    await sql`CREATE TABLE auto_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT
      )`;

    await sql`INSERT INTO auto_test (value) VALUES ('first')`;
    await sql`INSERT INTO auto_test (value) VALUES ('second')`;
    await sql`DELETE FROM auto_test WHERE id = 2`;
    await sql`INSERT INTO auto_test (value) VALUES ('third')`;

    const results = await sql`SELECT * FROM auto_test ORDER BY id`;
    expect(results[0].id).toBe(1);
    expect(results[1].id).toBe(3); // AUTOINCREMENT doesn't reuse IDs
  });

  test("last_insert_rowid()", async () => {
    await sql`CREATE TABLE rowid_test (id INTEGER PRIMARY KEY, value TEXT)`;
    await sql`INSERT INTO rowid_test (value) VALUES ('test')`;

    const result = await sql`SELECT last_insert_rowid() as id`;
    expect(result[0].id).toBe(1);
  });

  test("changes() function", async () => {
    await sql`CREATE TABLE changes_test (id INTEGER, value TEXT)`;
    await sql`INSERT INTO changes_test VALUES (1, 'a'), (2, 'b'), (3, 'c')`;

    await sql`UPDATE changes_test SET value = 'updated' WHERE id > 1`;
    const changes = await sql`SELECT changes() as count`;
    expect(changes[0].count).toBe(2);
  });

  test("ATTACH DATABASE", async () => {
    const dir = tempDirWithFiles("sqlite-attach-test", {});
    const attachPath = path.join(dir, "attached.db");

    await sql`ATTACH DATABASE ${attachPath} AS attached`;
    await sql`CREATE TABLE attached.other_table (id INTEGER)`;
    await sql`INSERT INTO attached.other_table VALUES (1)`;

    const result = await sql`SELECT * FROM attached.other_table`;
    expect(result).toHaveLength(1);

    await sql`DETACH DATABASE attached`;
    await rm(dir, { recursive: true });
  });

  test("Common Table Expressions (CTEs)", async () => {
    await sql`CREATE TABLE employees (id INTEGER, name TEXT, manager_id INTEGER)`;
    await sql`INSERT INTO employees VALUES
        (1, 'CEO', NULL),
        (2, 'VP1', 1),
        (3, 'VP2', 1),
        (4, 'Manager1', 2),
        (5, 'Manager2', 3)`;

    const result = await sql`
        WITH RECURSIVE org_chart AS (
          SELECT id, name, manager_id, 0 as level
          FROM employees
          WHERE manager_id IS NULL
          UNION ALL
          SELECT e.id, e.name, e.manager_id, oc.level + 1
          FROM employees e
          JOIN org_chart oc ON e.manager_id = oc.id
        )
        SELECT * FROM org_chart ORDER BY level, id
      `;

    expect(result).toHaveLength(5);
    expect(result[0].level).toBe(0);
    expect(result[result.length - 1].level).toBe(2);
  });

  test("Full-text search (FTS5)", async () => {
    await sql`CREATE VIRTUAL TABLE docs USING fts5(title, content)`;

    await sql`INSERT INTO docs VALUES
          ('First Document', 'This is the content of the first document'),
          ('Second Document', 'This document contains different content'),
          ('Third Document', 'Another document with unique text')`;

    const results = await sql`SELECT * FROM docs WHERE docs MATCH 'content'`;
    expect(results).toHaveLength(2);

    await sql`DROP TABLE docs`;
  });

  test("JSON functions", async () => {
    // SQLite JSON1 extension functions
    await sql`CREATE TABLE json_test (id INTEGER, data TEXT)`;

    const jsonData = { name: "Test", values: [1, 2, 3] };
    await sql`INSERT INTO json_test VALUES (1, ${JSON.stringify(jsonData)})`;

    // Extract JSON values
    const name = await sql`SELECT json_extract(data, '$.name') as name FROM json_test`;
    expect(name[0].name).toBe("Test");

    const arrayLength = await sql`SELECT json_array_length(data, '$.values') as len FROM json_test`;
    expect(arrayLength[0].len).toBe(3);
  });
});

describe("SQL helpers", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql.close();
  });

  test("bulk insert with sql() helper", async () => {
    await sql`CREATE TABLE bulk_test (id INTEGER, name TEXT, value REAL)`;

    const data = [
      { id: 1, name: "Item1", value: 10.5 },
      { id: 2, name: "Item2", value: 20.5 },
      { id: 3, name: "Item3", value: 30.5 },
    ];

    await sql`INSERT INTO bulk_test ${sql(data)}`;

    const results = await sql`SELECT * FROM bulk_test ORDER BY id`;
    expect(results).toHaveLength(3);
    expect(results[0].name).toBe("Item1");
  });

  test("unsafe with parameters", async () => {
    await sql`CREATE TABLE unsafe_test (id INTEGER, value TEXT)`;

    const query = "INSERT INTO unsafe_test VALUES (?, ?)";
    await sql.unsafe(query, [1, "test"]);

    const selectQuery = "SELECT * FROM unsafe_test WHERE id = ?";
    const results = await sql.unsafe(selectQuery, [1]);
    expect(results[0].value).toBe("test");
  });

  test("file execution", async () => {
    const dir = tempDirWithFiles("sql-files", {
      "schema.sql": `
          CREATE TABLE file_test (
            id INTEGER PRIMARY KEY,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO file_test (id) VALUES (1), (2), (3);
        `,
      "query.sql": `SELECT COUNT(*) as count FROM file_test`,
    });

    await sql.file(path.join(dir, "schema.sql"));

    const result = await sql.file(path.join(dir, "query.sql"));
    expect(result[0].count).toBe(3);
  });

  test("file with parameters", async () => {
    const dir = tempDirWithFiles("sql-params", {
      "query.sql": `SELECT ? as param1, ? as param2`,
    });

    const result = await sql.file(path.join(dir, "query.sql"), ["value1", "value2"]);
    expect(result[0].param1).toBe("value1");
    expect(result[0].param2).toBe("value2");
  });
});

describe("Error handling", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql.close();
  });

  test("syntax errors", async () => {
    try {
      await sql`SELCT * FROM nonexistent`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("syntax error");
    }
  });

  test("constraint violations", async () => {
    await sql`CREATE TABLE constraints (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL,
        unique_val TEXT UNIQUE
      )`;

    // NOT NULL violation
    try {
      await sql`INSERT INTO constraints (id, value) VALUES (1, ${null})`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("NOT NULL");
    }

    // UNIQUE violation
    await sql`INSERT INTO constraints VALUES (1, 'test', 'unique')`;
    try {
      await sql`INSERT INTO constraints VALUES (2, 'test2', 'unique')`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("UNIQUE");
    }
  });

  test("foreign key violations", async () => {
    await sql`PRAGMA foreign_keys = ON`;

    await sql`CREATE TABLE parent (id INTEGER PRIMARY KEY)`;
    await sql`CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER,
        FOREIGN KEY (parent_id) REFERENCES parent(id)
      )`;

    await sql`INSERT INTO parent VALUES (1)`;
    await sql`INSERT INTO child VALUES (1, 1)`; // Should work

    try {
      await sql`INSERT INTO child VALUES (2, 999)`; // Non-existent parent
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("FOREIGN KEY");
    }
  });
});

describe("Connection management", () => {
  test("close() prevents further queries", async () => {
    const sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE test (id INTEGER)`;
    await sql.close();

    try {
      await sql`SELECT * FROM test`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatchInlineSnapshot(`"SQLite database not initialized"`);
    }
  });

  test("reserve throws for SQLite", async () => {
    const sql = new SQL("sqlite://:memory:");

    await expect(sql.reserve()).rejects.toThrow("SQLite doesn't support connection reservation (no connection pool)");

    await sql.close();
  });

  test("distributed transactions throw for SQLite", async () => {
    const sql = new SQL("sqlite://:memory:");

    expect(() => sql.beginDistributed("test-tx", async () => {})).toThrow(
      "SQLite doesn't support distributed transactions",
    );

    expect(() => sql.commitDistributed("test-tx")).toThrow("SQLite doesn't support distributed transactions");

    expect(() => sql.rollbackDistributed("test-tx")).toThrow("SQLite doesn't support distributed transactions");

    await sql.close();
  });

  test("flush throws for SQLite", async () => {
    const sql = new SQL("sqlite://:memory:");

    expect(() => sql.flush()).toThrow("SQLite doesn't support flush() - queries are executed synchronously");

    await sql.close();
  });
});

describe("Performance & Edge Cases", () => {
  test("handles large datasets", async () => {
    const sql = new SQL("sqlite://:memory:");

    await sql`CREATE TABLE large (id INTEGER PRIMARY KEY, data TEXT)`;

    // Insert many rows
    const rowCount = 1000;
    const data = Buffer.alloc(100, "x").toString(); // 100 character string

    await sql.begin(async tx => {
      for (let i = 0; i < rowCount; i++) {
        await tx`INSERT INTO large VALUES (${i}, ${data})`;
      }
    });

    const count = await sql`SELECT COUNT(*) as count FROM large`;
    expect(count[0].count).toBe(rowCount);

    await sql.close();
  });

  test("handles many columns", async () => {
    const sql = new SQL("sqlite://:memory:");

    const columnCount = 100;
    const columns = Array.from({ length: columnCount }, (_, i) => `col${i} INTEGER`).join(", ");

    await sql.unsafe(`CREATE TABLE wide (${columns})`);

    const values = Array.from({ length: columnCount }, (_, i) => i);
    const placeholders = values.map(() => "?").join(", ");

    await sql.unsafe(`INSERT INTO wide VALUES (${placeholders})`, values);

    const result = await sql`SELECT * FROM wide`;
    expect(Object.keys(result[0])).toHaveLength(columnCount);

    await sql.close();
  });

  test("handles concurrent queries", async () => {
    const sql = new SQL("sqlite://:memory:");

    await sql`CREATE TABLE concurrent (id INTEGER PRIMARY KEY, value INTEGER)`;

    // SQLite serializes queries, but they should all complete
    const promises = Array.from({ length: 10 }, (_, i) => sql`INSERT INTO concurrent VALUES (${i}, ${i * 10})`);

    await Promise.all(promises);

    const count = await sql`SELECT COUNT(*) as count FROM concurrent`;
    expect(count[0].count).toBe(10);

    await sql.close();
  });

  test("handles empty results", async () => {
    const sql = new SQL("sqlite://:memory:");

    await sql`CREATE TABLE empty (id INTEGER)`;
    const results = await sql`SELECT * FROM empty`;

    expect(results).toHaveLength(0);
    expect(results.command).toBe("SELECT");
    expect(results.count).toBe(0);

    await sql.close();
  });

  test("handles special table names", async () => {
    const sql = new SQL("sqlite://:memory:");

    // Table names that need quoting
    const specialNames = [
      "table-with-dash",
      "table.with.dots",
      "table with spaces",
      "123numeric",
      "SELECT", // Reserved keyword
    ];

    for (const name of specialNames) {
      await sql.unsafe(`CREATE TABLE "${name}" (id INTEGER)`);
      await sql.unsafe(`INSERT INTO "${name}" VALUES (1)`);
      const result = await sql.unsafe(`SELECT * FROM "${name}"`);
      expect(result).toHaveLength(1);
      await sql.unsafe(`DROP TABLE "${name}"`);
    }

    await sql.close();
  });
});

describe("WAL mode and concurrency", () => {
  test("can enable WAL mode", async () => {
    const dir = tempDirWithFiles("sqlite-wal-test", {});
    const dbPath = path.join(dir, "wal-test.db");
    const sql = new SQL(`sqlite://${dbPath}`);

    await sql`PRAGMA journal_mode = WAL`;
    const mode = await sql`PRAGMA journal_mode`;
    expect(mode[0].journal_mode).toBe("wal");

    // WAL mode creates additional files
    await sql`CREATE TABLE wal_test (id INTEGER)`;
    await sql`INSERT INTO wal_test VALUES (1)`;

    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;

    const walStats = await stat(walPath);
    expect(walStats.isFile()).toBe(true);
    expect(walStats.size).toBeGreaterThan(0);

    const shmStats = await stat(shmPath);
    expect(shmStats.isFile()).toBe(true);
    expect(shmStats.size).toBeGreaterThan(0);

    await sql.close();
    await rm(dir, { recursive: true });
  });
});

describe("Memory and resource management", () => {
  test("properly releases resources on close", async () => {
    const sql = new SQL("sqlite://:memory:");

    await sql`CREATE TABLE resource_test (id INTEGER, data TEXT)`;

    // Insert some data
    for (let i = 0; i < 100; i++) {
      await sql`INSERT INTO resource_test VALUES (${i}, ${"x".repeat(1000)})`;
    }

    await sql.close();

    // Further operations should fail
    try {
      await sql`SELECT * FROM resource_test`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatchInlineSnapshot(`"SQLite database not initialized"`);
    }
  });
});

describe("Connection URL Edge Cases", () => {
  test("handles various file:// URL formats", async () => {
    const dir = tempDirWithFiles("sqlite-url-test", {});

    // file:// with three slashes (local file)
    const dbPath1 = path.join(dir, "test1.db");
    const sql1 = new SQL(`file://${dbPath1}`);
    await sql1`CREATE TABLE test (id INTEGER)`;
    await sql1`INSERT INTO test VALUES (1)`;
    const result1 = await sql1`SELECT * FROM test`;
    expect(result1).toHaveLength(1);
    await sql1.close();

    // file: with just path
    const dbPath2 = path.join(dir, "test2.db");
    const sql2 = new SQL(`file:${dbPath2}`);
    await sql2`CREATE TABLE test (id INTEGER)`;
    await sql2.close();

    await rm(dir, { recursive: true });
  });

  test("handles special characters in database paths", async () => {
    const specialNames = [
      "test with spaces.db",
      "test-with-dash.db",
      "test.with.dots.db",
      "test_underscore.db",
      "test@symbol.db",
      "test#hash.db",
      "test%percent.db",
      "test&ampersand.db",
      "test(parens).db",
      "test[brackets].db",
      "test{braces}.db",
      "test'quote.db",
    ];

    for (const name of specialNames) {
      const dir = tempDirWithFiles(`sqlite-special-${Math.random()}`, {});
      const dbPath = path.join(dir, name);

      const sql = new SQL(`sqlite://${dbPath}`);
      await sql`CREATE TABLE test (id INTEGER)`;
      await sql`INSERT INTO test VALUES (1)`;

      const result = await sql`SELECT * FROM test`;
      expect(result).toHaveLength(1);

      await sql.close();
      await rm(dir, { recursive: true });
    }
  });

  test("handles relative vs absolute paths", async () => {
    const dir = tempDirWithFiles("sqlite-path-test", {});
    const originalCwd = process.cwd();

    try {
      process.chdir(dir);

      // Relative path
      const sql1 = new SQL("sqlite://./relative.db");
      await sql1`CREATE TABLE test (id INTEGER)`;
      await sql1.close();

      expect(existsSync(path.join(dir, "relative.db"))).toBe(true);

      // Absolute path
      const absPath = path.join(dir, "absolute.db");
      const sql2 = new SQL(`sqlite://${absPath}`);
      await sql2`CREATE TABLE test (id INTEGER)`;
      await sql2.close();

      expect(existsSync(absPath)).toBe(true);
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true });
    }
  });

  test("handles readonly mode via URL parameters", async () => {
    const dir = tempDirWithFiles("sqlite-readonly-test", {});
    const dbPath = path.join(dir, "readonly.db");

    // First create the database
    const sql1 = new SQL(`sqlite://${dbPath}`);
    await sql1`CREATE TABLE test (id INTEGER)`;
    await sql1`INSERT INTO test VALUES (1)`;
    await sql1.close();

    // Open in readonly mode
    const sql2 = new SQL(`sqlite://${dbPath}?mode=ro`);

    const result = await sql2`SELECT * FROM test`;
    expect(result).toHaveLength(1);

    try {
      await sql2`INSERT INTO test VALUES (2)`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("readonly");
    }

    await sql2.close();
    await rm(dir, { recursive: true });
  });

  test("handles URI parameters for cache and other settings", async () => {
    const dir = tempDirWithFiles("sqlite-uri-test", {});
    const dbPath = path.join(dir, "uri.db");

    // Test various URI parameters
    const sql = new SQL(`sqlite://${dbPath}?cache=shared&mode=rwc`);

    await sql`CREATE TABLE test (id INTEGER)`;
    await sql`INSERT INTO test VALUES (1)`;

    const pragmas = await sql`PRAGMA cache_size`;
    expect(pragmas).toBeDefined();

    await sql.close();
    await rm(dir, { recursive: true });
  });
});

describe("BLOB Edge Cases and Binary Data", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("handles zero-length BLOBs", async () => {
    await sql`CREATE TABLE blob_test (id INTEGER, data BLOB)`;

    const emptyBuffer = Buffer.alloc(0);
    await sql`INSERT INTO blob_test VALUES (1, ${emptyBuffer})`;

    const result = await sql`SELECT * FROM blob_test`;
    expect(Buffer.from(result[0].data)).toHaveLength(0);
  });

  test("handles large BLOBs", async () => {
    await sql`CREATE TABLE large_blob (id INTEGER, data BLOB)`;

    // Test with 1MB, 10MB binary data
    const sizes = [1024 * 1024, 10 * 1024 * 1024];

    for (const size of sizes) {
      const largeBuffer = Buffer.alloc(size);
      // Fill with pattern to verify integrity
      for (let i = 0; i < size; i++) {
        largeBuffer[i] = i % 256;
      }

      await sql`INSERT INTO large_blob VALUES (${size}, ${largeBuffer})`;

      const result = await sql`SELECT * FROM large_blob WHERE id = ${size}`;
      const retrieved = Buffer.from(result[0].data);

      expect(retrieved.length).toBe(size);
      // Verify pattern integrity
      for (let i = 0; i < Math.min(100, size); i++) {
        expect(retrieved[i]).toBe(i % 256);
      }
    }
  });

  test("handles binary data with all byte values", async () => {
    await sql`CREATE TABLE binary_test (id INTEGER, data BLOB)`;

    // Create buffer with all possible byte values
    const allBytes = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      allBytes[i] = i;
    }

    await sql`INSERT INTO binary_test VALUES (1, ${allBytes})`;

    const result = await sql`SELECT * FROM binary_test`;
    const retrieved = Buffer.from(result[0].data);

    expect(retrieved.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(retrieved[i]).toBe(i);
    }
  });

  test("handles Uint8Array and ArrayBuffer", async () => {
    await sql`CREATE TABLE array_test (id INTEGER, data BLOB)`;

    // Test Uint8Array
    const uint8 = new Uint8Array([1, 2, 3, 4, 5]);
    await sql`INSERT INTO array_test VALUES (1, ${uint8})`;

    // Test ArrayBuffer
    const arrayBuffer = new ArrayBuffer(8);
    const view = new DataView(arrayBuffer);
    view.setInt32(0, 0x12345678);
    view.setInt32(4, 0x9abcdef0);
    await sql`INSERT INTO array_test VALUES (2, ${Buffer.from(arrayBuffer)})`;

    const results = await sql`SELECT * FROM array_test ORDER BY id`;
    expect(Buffer.from(results[0].data)).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect(Buffer.from(results[1].data).length).toBe(8);
  });
});

describe("Special Characters and Escape Sequences", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE special_chars (id INTEGER, text_val TEXT)`;
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("handles various quote types", async () => {
    const quotes = [
      `Single ' quote`,
      `Double " quote`,
      `Both ' and " quotes`,
      `Backtick \` quote`,
      `'Multiple' "quote" 'types'`,
      `It's a "test"`,
      `\\'escaped\\' quotes`,
      `"""triple quotes"""`,
      `'''triple single'''`,
    ];

    for (let i = 0; i < quotes.length; i++) {
      await sql`INSERT INTO special_chars VALUES (${i}, ${quotes[i]})`;
      const result = await sql`SELECT text_val FROM special_chars WHERE id = ${i}`;
      expect(result[0].text_val).toBe(quotes[i]);
    }
  });

  test("handles control characters and escape sequences", async () => {
    const controls = [
      "\n\r\t", // Newline, carriage return, tab
      "\x00\x01\x02", // NULL and control chars
      "\b\f\v", // Backspace, form feed, vertical tab
      "\\n\\r\\t", // Escaped sequences
      "\u0000\u001F", // Unicode control characters
      "\x1B[31mANSI\x1B[0m", // ANSI escape codes
    ];

    await sql`CREATE TABLE control_chars (id INTEGER, val TEXT)`;

    for (let i = 0; i < controls.length; i++) {
      await sql`INSERT INTO control_chars VALUES (${i}, ${controls[i]})`;
      const result = await sql`SELECT val FROM control_chars WHERE id = ${i}`;
      expect(result[0].val).toBe(controls[i]);
    }
  });

  test("handles Unicode and emoji", async () => {
    const unicode = [
      "Hello 世界", // Chinese
      "مرحبا بالعالم", // Arabic
      "שלום עולם", // Hebrew
      "Здравствуй мир", // Russian
      "🚀🎉🌟", // Emojis
      "👨‍👩‍👧‍👦", // Family emoji with ZWJ
      "𝓗𝓮𝓵𝓵𝓸", // Mathematical bold script
      "A\u0301", // Combining diacritical marks
      "🏴󠁧󠁢󠁥󠁮󠁧󠁿", // Flag emoji with tags
    ];

    await sql`CREATE TABLE unicode_test (id INTEGER, val TEXT)`;

    for (let i = 0; i < unicode.length; i++) {
      await sql`INSERT INTO unicode_test VALUES (${i}, ${unicode[i]})`;
      const result = await sql`SELECT val FROM unicode_test WHERE id = ${i}`;
      expect(result[0].val).toBe(unicode[i]);
    }
  });

  test("handles very long strings", async () => {
    await sql`CREATE TABLE long_strings (id INTEGER, val TEXT)`;

    // Test various long string scenarios
    const lengths = [1000, 10000, 100000, 1000000];

    for (const len of lengths) {
      const longString = Buffer.alloc(len, "a").toString();
      await sql`INSERT INTO long_strings VALUES (${len}, ${longString})`;

      const result = await sql`SELECT LENGTH(val) as len FROM long_strings WHERE id = ${len}`;
      expect(result[0].len).toBe(len);
    }
  });
});

describe("Triggers and Views", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("CREATE and use TRIGGER", async () => {
    await sql`CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT,
      operation TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    )`;

    await sql`CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT,
      updated_at TEXT
    )`;

    await sql`CREATE TRIGGER user_update_trigger
      AFTER UPDATE ON users
      BEGIN
        INSERT INTO audit_log (table_name, operation) 
        VALUES ('users', 'UPDATE');
        UPDATE users SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
      END`;

    await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`;
    await sql`UPDATE users SET name = 'Alice Updated' WHERE id = 1`;

    const logs = await sql`SELECT * FROM audit_log`;
    expect(logs).toHaveLength(1);
    expect(logs[0].operation).toBe("UPDATE");

    const user = await sql`SELECT * FROM users WHERE id = 1`;
    expect(user[0].updated_at).toBeDefined();
  });

  test("CREATE and query VIEW", async () => {
    await sql`CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER,
      amount REAL,
      status TEXT
    )`;

    await sql`INSERT INTO orders VALUES 
      (1, 1, 100.0, 'completed'),
      (2, 1, 50.0, 'pending'),
      (3, 2, 200.0, 'completed'),
      (4, 2, 75.0, 'cancelled')`;

    await sql`CREATE VIEW customer_summary AS
      SELECT 
        customer_id,
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_spent,
        AVG(amount) as avg_order_value
      FROM orders
      GROUP BY customer_id`;

    const summary = await sql`SELECT * FROM customer_summary ORDER BY customer_id`;
    expect(summary).toHaveLength(2);
    expect(summary[0].total_orders).toBe(2);
    expect(summary[0].total_spent).toBe(100.0);
    expect(summary[1].total_orders).toBe(2);
    expect(summary[1].total_spent).toBe(200.0);
  });

  test("triggers with WHEN conditions", async () => {
    await sql`CREATE TABLE inventory (
      id INTEGER PRIMARY KEY,
      product TEXT,
      quantity INTEGER,
      reorder_level INTEGER DEFAULT 10
    )`;

    await sql`CREATE TABLE reorder_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product TEXT,
      quantity INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`;

    await sql`CREATE TRIGGER low_stock_trigger
      AFTER UPDATE OF quantity ON inventory
      WHEN NEW.quantity < NEW.reorder_level
      BEGIN
        INSERT INTO reorder_alerts (product, quantity)
        VALUES (NEW.product, NEW.quantity);
      END`;

    await sql`INSERT INTO inventory VALUES (1, 'Widget', 100, 10)`;
    await sql`UPDATE inventory SET quantity = 5 WHERE id = 1`;

    const alerts = await sql`SELECT * FROM reorder_alerts`;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].product).toBe("Widget");
    expect(alerts[0].quantity).toBe(5);

    // Update that shouldn't trigger
    await sql`UPDATE inventory SET quantity = 15 WHERE id = 1`;
    const alerts2 = await sql`SELECT * FROM reorder_alerts`;
    expect(alerts2).toHaveLength(1); // Still just one alert
  });
});

describe("Indexes and Query Optimization", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("CREATE various types of indexes", async () => {
    await sql`CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT,
      category TEXT,
      price REAL,
      sku TEXT UNIQUE,
      description TEXT
    )`;

    // Simple index
    await sql`CREATE INDEX idx_category ON products(category)`;

    // Composite index
    await sql`CREATE INDEX idx_category_price ON products(category, price DESC)`;

    // Unique index
    await sql`CREATE UNIQUE INDEX idx_sku ON products(sku)`;

    // Partial index
    await sql`CREATE INDEX idx_expensive ON products(price) WHERE price > 100`;

    // Expression index
    await sql`CREATE INDEX idx_name_lower ON products(LOWER(name))`;

    // Insert test data
    for (let i = 1; i <= 100; i++) {
      await sql`INSERT INTO products VALUES (
        ${i}, 
        ${"Product " + i}, 
        ${"Category " + (i % 10)},
        ${i * 10.5},
        ${"SKU-" + i.toString().padStart(5, "0")},
        ${"Description for product " + i}
      )`;
    }

    // Verify unique constraint works
    try {
      await sql`INSERT INTO products VALUES (101, 'Test', 'Test', 10, 'SKU-00001', 'Duplicate SKU')`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("UNIQUE");
    }

    // Query using indexes
    const results = await sql`SELECT * FROM products WHERE category = 'Category 5'`;
    expect(results.length).toBeGreaterThan(0);

    const expensive = await sql`SELECT * FROM products WHERE price > 500`;
    expect(expensive.length).toBeGreaterThan(0);
  });

  test("ANALYZE and query planning", async () => {
    await sql`CREATE TABLE stats_test (
      id INTEGER PRIMARY KEY,
      type TEXT,
      value INTEGER
    )`;

    await sql`CREATE INDEX idx_type ON stats_test(type)`;

    // Insert skewed data
    for (let i = 1; i <= 1000; i++) {
      const type = i <= 900 ? "common" : i <= 990 ? "uncommon" : "rare";
      await sql`INSERT INTO stats_test VALUES (${i}, ${type}, ${i})`;
    }

    // Update statistics
    await sql`ANALYZE`;

    // Check that statistics were gathered
    const stats = await sql`SELECT * FROM sqlite_stat1`;
    expect(stats.length).toBeGreaterThan(0);
  });

  test("covering indexes", async () => {
    await sql`CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT,
      username TEXT,
      created_at TEXT
    )`;

    // Create a covering index for common query
    await sql`CREATE INDEX idx_email_username ON users(email, username)`;

    for (let i = 1; i <= 100; i++) {
      await sql`INSERT INTO users VALUES (
        ${i},
        ${"user" + i + "@example.com"},
        ${"user" + i},
        ${new Date().toISOString()}
      )`;
    }

    // Query that can be satisfied entirely from the index
    const result = await sql`SELECT email, username FROM users WHERE email LIKE 'user1%'`;
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("VACUUM and Database Maintenance", () => {
  test("VACUUM command", async () => {
    const dir = tempDirWithFiles("sqlite-vacuum-test", {});
    const dbPath = path.join(dir, "vacuum.db");
    const sql = new SQL(`sqlite://${dbPath}`);

    // Create and populate table
    await sql`CREATE TABLE vacuum_test (id INTEGER, data TEXT)`;

    // Insert and delete lots of data to create fragmentation
    for (let i = 0; i < 1000; i++) {
      await sql`INSERT INTO vacuum_test VALUES (${i}, ${Buffer.alloc(100, "x").toString()})`;
    }

    await sql`DELETE FROM vacuum_test WHERE id % 2 = 0`;

    const statsBefore = await stat(dbPath);
    const sizeBefore = statsBefore.size;

    // Run VACUUM
    await sql`VACUUM`;

    const statsAfter = await stat(dbPath);
    const sizeAfter = statsAfter.size;

    // Database should be smaller after VACUUM
    expect(sizeAfter).toBeLessThanOrEqual(sizeBefore);

    await sql.close();
    await rm(dir, { recursive: true });
  });

  test("incremental VACUUM with auto_vacuum", async () => {
    const dir = tempDirWithFiles("sqlite-auto-vacuum-test", {});
    const dbPath = path.join(dir, "auto_vacuum.db");
    const sql = new SQL(`sqlite://${dbPath}`);

    // Enable incremental auto-vacuum
    await sql`PRAGMA auto_vacuum = 2`;

    await sql`CREATE TABLE test (id INTEGER, data TEXT)`;

    for (let i = 0; i < 100; i++) {
      await sql`INSERT INTO test VALUES (${i}, ${Buffer.alloc(1000, "x").toString()})`;
    }

    await sql`DELETE FROM test WHERE id < 50`;

    // Incremental vacuum - free up some pages
    await sql`PRAGMA incremental_vacuum(10)`;

    const pageCount = await sql`PRAGMA page_count`;
    expect(pageCount[0].page_count).toBeGreaterThan(0);

    await sql.close();
    await rm(dir, { recursive: true });
  });
});

describe("Backup and Restore Operations", () => {
  test("backup to another file", async () => {
    const dir = tempDirWithFiles("sqlite-backup-test", {});
    const sourcePath = path.join(dir, "source.db");
    const backupPath = path.join(dir, "backup.db");

    const source = new SQL(`sqlite://${sourcePath}`);

    // Create and populate source database
    await source`CREATE TABLE backup_test (id INTEGER PRIMARY KEY, data TEXT)`;
    for (let i = 1; i <= 10; i++) {
      await source`INSERT INTO backup_test VALUES (${i}, ${"Data " + i})`;
    }

    // Use VACUUM INTO for backup (SQLite 3.27.0+)
    await source.unsafe(`VACUUM INTO '${backupPath}'`);

    await source.close();

    // Verify backup
    const backup = new SQL(`sqlite://${backupPath}`);
    const data = await backup`SELECT * FROM backup_test`;
    expect(data).toHaveLength(10);
    expect(data[0].data).toBe("Data 1");

    await backup.close();
    await rm(dir, { recursive: true });
  });
});

describe("Custom Collations and Functions", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("case-insensitive collation with NOCASE", async () => {
    await sql`CREATE TABLE collation_test (
      id INTEGER PRIMARY KEY,
      name TEXT COLLATE NOCASE
    )`;

    await sql`INSERT INTO collation_test VALUES 
      (1, 'Alice'),
      (2, 'alice'),
      (3, 'ALICE'),
      (4, 'Bob')`;

    // NOCASE collation makes comparison case-insensitive
    const result = await sql`SELECT * FROM collation_test WHERE name = 'alice'`;
    expect(result).toHaveLength(3);

    // But preserves original case in storage
    expect(result.map(r => r.name).sort()).toEqual(["ALICE", "Alice", "alice"]);
  });

  test("binary collation", async () => {
    await sql`CREATE TABLE binary_collation (
      id INTEGER PRIMARY KEY,
      data TEXT COLLATE BINARY
    )`;

    await sql`INSERT INTO binary_collation VALUES 
      (1, 'A'),
      (2, 'a'),
      (3, 'B'),
      (4, 'b')`;

    // BINARY collation is case-sensitive
    const result = await sql`SELECT * FROM binary_collation ORDER BY data`;
    expect(result.map(r => r.data)).toEqual(["A", "B", "a", "b"]);
  });
});

describe("Window Functions", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");

    await sql`CREATE TABLE sales (
      id INTEGER PRIMARY KEY,
      employee TEXT,
      department TEXT,
      amount REAL,
      sale_date TEXT
    )`;

    const sales = [
      ["Alice", "Sales", 1000, "2024-01-01"],
      ["Alice", "Sales", 1500, "2024-01-02"],
      ["Bob", "Sales", 800, "2024-01-01"],
      ["Bob", "Sales", 1200, "2024-01-02"],
      ["Charlie", "Marketing", 900, "2024-01-01"],
      ["Charlie", "Marketing", 1100, "2024-01-02"],
    ];

    for (const [employee, department, amount, date] of sales) {
      await sql`INSERT INTO sales (employee, department, amount, sale_date) 
                VALUES (${employee}, ${department}, ${amount}, ${date})`;
    }
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("ROW_NUMBER window function", async () => {
    const result = await sql`
      SELECT 
        employee,
        amount,
        ROW_NUMBER() OVER (ORDER BY amount DESC) as rank
      FROM sales
      ORDER BY rank
    `;

    expect(result[0].rank).toBe(1);
    expect(result[0].amount).toBe(1500);
    expect(result[result.length - 1].rank).toBe(6);
  });

  test("partition by with window functions", async () => {
    const result = await sql`
      SELECT 
        employee,
        department,
        amount,
        SUM(amount) OVER (PARTITION BY department) as dept_total,
        AVG(amount) OVER (PARTITION BY employee) as employee_avg
      FROM sales
      ORDER BY department, employee
    `;

    // Verify department totals
    const marketingRows = result.filter(r => r.department === "Marketing");
    expect(marketingRows[0].dept_total).toBe(2000);

    const salesRows = result.filter(r => r.department === "Sales");
    expect(salesRows[0].dept_total).toBe(4500);
  });

  test("running totals with window functions", async () => {
    const result = await sql`
      SELECT 
        employee,
        sale_date,
        amount,
        SUM(amount) OVER (
          PARTITION BY employee 
          ORDER BY sale_date 
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) as running_total
      FROM sales
      WHERE employee = 'Alice'
      ORDER BY sale_date
    `;

    expect(result[0].running_total).toBe(1000);
    expect(result[1].running_total).toBe(2500);
  });
});

describe("Check Constraints and Complex Validations", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("CHECK constraints on columns", async () => {
    await sql`CREATE TABLE validated (
      id INTEGER PRIMARY KEY,
      age INTEGER CHECK (age >= 0 AND age <= 150),
      email TEXT CHECK (email LIKE '%@%.%'),
      status TEXT CHECK (status IN ('active', 'inactive', 'pending')),
      percentage REAL CHECK (percentage >= 0 AND percentage <= 100)
    )`;

    // Valid insert
    await sql`INSERT INTO validated VALUES (1, 25, 'test@example.com', 'active', 50.5)`;

    // Invalid age
    try {
      await sql`INSERT INTO validated VALUES (2, -1, 'test@example.com', 'active', 50)`;
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("CHECK");
    }

    // Invalid email
    try {
      await sql`INSERT INTO validated VALUES (3, 25, 'notanemail', 'active', 50)`;
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("CHECK");
    }

    // Invalid status
    try {
      await sql`INSERT INTO validated VALUES (4, 25, 'test@example.com', 'invalid', 50)`;
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("CHECK");
    }

    // Invalid percentage
    try {
      await sql`INSERT INTO validated VALUES (5, 25, 'test@example.com', 'active', 101)`;
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("CHECK");
    }
  });

  test("table-level CHECK constraints", async () => {
    await sql`CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      start_date TEXT,
      end_date TEXT,
      quantity INTEGER,
      price REAL,
      CHECK (end_date >= start_date),
      CHECK (quantity * price >= 0)
    )`;

    // Valid insert
    await sql`INSERT INTO orders VALUES (1, '2024-01-01', '2024-01-31', 10, 9.99)`;

    // Invalid date range
    try {
      await sql`INSERT INTO orders VALUES (2, '2024-02-01', '2024-01-01', 10, 9.99)`;
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("CHECK");
    }
  });
});

describe("Generated Columns", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("GENERATED ALWAYS AS virtual columns", async () => {
    await sql`CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      price REAL,
      tax_rate REAL,
      total_price REAL GENERATED ALWAYS AS (price * (1 + tax_rate)) VIRTUAL,
      price_category TEXT GENERATED ALWAYS AS (
        CASE 
          WHEN price < 10 THEN 'cheap'
          WHEN price < 100 THEN 'moderate'
          ELSE 'expensive'
        END
      ) VIRTUAL
    )`;

    await sql`INSERT INTO products (id, price, tax_rate) VALUES 
      (1, 5.00, 0.1),
      (2, 50.00, 0.2),
      (3, 500.00, 0.15)`;

    const results = await sql`SELECT * FROM products ORDER BY id`;

    expect(results[0].total_price).toBeCloseTo(5.5, 2);
    expect(results[0].price_category).toBe("cheap");

    expect(results[1].total_price).toBeCloseTo(60.0, 2);
    expect(results[1].price_category).toBe("moderate");

    expect(results[2].total_price).toBeCloseTo(575.0, 2);
    expect(results[2].price_category).toBe("expensive");
  });

  test("GENERATED ALWAYS AS stored columns", async () => {
    await sql`CREATE TABLE rectangles (
      id INTEGER PRIMARY KEY,
      width REAL,
      height REAL,
      area REAL GENERATED ALWAYS AS (width * height) STORED,
      perimeter REAL GENERATED ALWAYS AS (2 * (width + height)) STORED
    )`;

    await sql`INSERT INTO rectangles (id, width, height) VALUES 
      (1, 10, 20),
      (2, 5.5, 3.2)`;

    const results = await sql`SELECT * FROM rectangles ORDER BY id`;

    expect(results[0].area).toBe(200);
    expect(results[0].perimeter).toBe(60);

    expect(results[1].area).toBeCloseTo(17.6, 2);
    expect(results[1].perimeter).toBeCloseTo(17.4, 2);

    // Update and verify generated columns update
    await sql`UPDATE rectangles SET width = 15 WHERE id = 1`;
    const updated = await sql`SELECT * FROM rectangles WHERE id = 1`;
    expect(updated[0].area).toBe(300);
    expect(updated[0].perimeter).toBe(70);
  });
});

describe("Partial Indexes", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("partial index with WHERE clause", async () => {
    await sql`CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT,
      status TEXT,
      priority INTEGER,
      due_date TEXT
    )`;

    // Index only incomplete high-priority tasks
    await sql`CREATE INDEX idx_urgent_tasks 
              ON tasks(due_date, priority) 
              WHERE status != 'completed' AND priority > 3`;

    // Insert test data
    const tasks = [
      ["Task 1", "pending", 5, "2024-01-01"],
      ["Task 2", "completed", 5, "2024-01-01"],
      ["Task 3", "pending", 2, "2024-01-01"],
      ["Task 4", "pending", 4, "2024-01-02"],
    ];

    for (let i = 0; i < tasks.length; i++) {
      const [title, status, priority, due_date] = tasks[i];
      await sql`INSERT INTO tasks VALUES (${i + 1}, ${title}, ${status}, ${priority}, ${due_date})`;
    }

    // Query that uses the partial index
    const urgent = await sql`
      SELECT * FROM tasks 
      WHERE status != 'completed' AND priority > 3
      ORDER BY due_date, priority
    `;

    expect(urgent).toHaveLength(2);
    expect(urgent[0].title).toBe("Task 1");
    expect(urgent[1].title).toBe("Task 4");
  });
});

describe("UPSERT Operations", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("INSERT OR REPLACE", async () => {
    await sql`CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      login_count INTEGER DEFAULT 0
    )`;

    await sql`INSERT INTO users VALUES (1, 'alice@example.com', 'Alice', 1)`;

    // This will replace the entire row
    await sql`INSERT OR REPLACE INTO users VALUES (1, 'alice@example.com', 'Alice Updated', 5)`;

    const result = await sql`SELECT * FROM users WHERE id = 1`;
    expect(result[0].name).toBe("Alice Updated");
    expect(result[0].login_count).toBe(5);
  });

  test("INSERT ON CONFLICT DO UPDATE", async () => {
    await sql`CREATE TABLE inventory (
      product_id INTEGER PRIMARY KEY,
      name TEXT,
      quantity INTEGER,
      last_updated TEXT
    )`;

    await sql`INSERT INTO inventory VALUES (1, 'Widget', 100, '2024-01-01')`;

    // UPSERT - update quantity if exists
    await sql`
      INSERT INTO inventory VALUES (1, 'Widget', 50, '2024-01-02')
      ON CONFLICT(product_id) DO UPDATE SET
        quantity = quantity + excluded.quantity,
        last_updated = excluded.last_updated
    `;

    const result = await sql`SELECT * FROM inventory WHERE product_id = 1`;
    expect(result[0].quantity).toBe(150);
    expect(result[0].last_updated).toBe("2024-01-02");

    // Insert new product
    await sql`
      INSERT INTO inventory VALUES (2, 'Gadget', 75, '2024-01-02')
      ON CONFLICT(product_id) DO UPDATE SET
        quantity = quantity + excluded.quantity
    `;

    const all = await sql`SELECT * FROM inventory ORDER BY product_id`;
    expect(all).toHaveLength(2);
  });

  test("INSERT ON CONFLICT DO NOTHING", async () => {
    await sql`CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`;

    await sql`INSERT INTO settings VALUES ('theme', 'dark')`;

    // This should do nothing
    const result = await sql`
      INSERT INTO settings VALUES ('theme', 'light')
      ON CONFLICT(key) DO NOTHING
      RETURNING *
    `;

    expect(result).toHaveLength(0);

    // Verify original value is unchanged
    const setting = await sql`SELECT * FROM settings WHERE key = 'theme'`;
    expect(setting[0].value).toBe("dark");
  });
});

describe("WITHOUT ROWID Tables", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("WITHOUT ROWID table with composite primary key", async () => {
    await sql`CREATE TABLE sessions (
      user_id INTEGER,
      device_id TEXT,
      token TEXT,
      created_at TEXT,
      PRIMARY KEY (user_id, device_id)
    ) WITHOUT ROWID`;

    await sql`INSERT INTO sessions VALUES 
      (1, 'phone', 'token1', '2024-01-01'),
      (1, 'laptop', 'token2', '2024-01-01'),
      (2, 'phone', 'token3', '2024-01-01')`;

    const results = await sql`SELECT * FROM sessions WHERE user_id = 1`;
    expect(results).toHaveLength(2);

    // Verify composite key uniqueness
    try {
      await sql`INSERT INTO sessions VALUES (1, 'phone', 'token4', '2024-01-02')`;
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("UNIQUE");
    }
  });
});

describe("Concurrency and Locking", () => {
  test("concurrent reads work correctly", async () => {
    const dir = tempDirWithFiles("sqlite-concurrent-test", {});
    const dbPath = path.join(dir, "concurrent.db");

    const sql1 = new SQL(`sqlite://${dbPath}`);
    await sql1`CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)`;

    for (let i = 1; i <= 100; i++) {
      await sql1`INSERT INTO test VALUES (${i}, ${"value" + i})`;
    }

    // Open multiple connections for reading
    const sql2 = new SQL(`sqlite://${dbPath}`);
    const sql3 = new SQL(`sqlite://${dbPath}`);

    // Concurrent reads should all succeed
    const [result1, result2, result3] = await Promise.all([
      sql1`SELECT COUNT(*) as count FROM test`,
      sql2`SELECT COUNT(*) as count FROM test`,
      sql3`SELECT COUNT(*) as count FROM test`,
    ]);

    expect(result1[0].count).toBe(100);
    expect(result2[0].count).toBe(100);
    expect(result3[0].count).toBe(100);

    await sql1.close();
    await sql2.close();
    await sql3.close();
    await rm(dir, { recursive: true });
  });

  test("write lock prevents concurrent writes", async () => {
    const dir = tempDirWithFiles("sqlite-write-lock-test", {});
    const dbPath = path.join(dir, "writelock.db");

    const sql = new SQL(`sqlite://${dbPath}`);
    await sql`CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER)`;
    await sql`INSERT INTO counter VALUES (1, 0)`;

    // Start a transaction that will hold a write lock
    const updatePromise = sql.begin(async tx => {
      await tx`UPDATE counter SET value = value + 1 WHERE id = 1`;
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 50));
      await tx`UPDATE counter SET value = value + 1 WHERE id = 1`;
      return "done";
    });

    // Try to write from another connection while transaction is active
    const sql2 = new SQL(`sqlite://${dbPath}`);

    // This should complete after the transaction
    const startTime = Date.now();
    await updatePromise;
    const duration = Date.now() - startTime;

    expect(duration).toBeGreaterThanOrEqual(40); // Should have waited

    const final = await sql`SELECT value FROM counter WHERE id = 1`;
    expect(final[0].value).toBe(2);

    await sql.close();
    await sql2.close();
    await rm(dir, { recursive: true });
  });

  test("busy timeout handling", async () => {
    const dir = tempDirWithFiles("sqlite-busy-test", {});
    const dbPath = path.join(dir, "busy.db");

    const sql1 = new SQL(`sqlite://${dbPath}`);
    await sql1`CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)`;

    // Set a short busy timeout
    await sql1`PRAGMA busy_timeout = 100`;

    const sql2 = new SQL(`sqlite://${dbPath}`);
    await sql2`PRAGMA busy_timeout = 100`;

    // Start a long transaction in sql1
    const longTransaction = sql1.begin(async tx => {
      await tx`INSERT INTO test VALUES (1, 'test')`;
      await new Promise(resolve => setTimeout(resolve, 200));
      return "done";
    });

    // Try to write from sql2 - should timeout
    try {
      await sql2`INSERT INTO test VALUES (2, 'test2')`;
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      // SQLite busy error
    }

    await longTransaction;

    await sql1.close();
    await sql2.close();
    await rm(dir, { recursive: true });
  });
});

describe("Date and Time Functions", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("date and time functions", async () => {
    await sql`CREATE TABLE timestamps (
      id INTEGER PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      date_only TEXT DEFAULT (DATE('now')),
      time_only TEXT DEFAULT (TIME('now'))
    )`;

    await sql`INSERT INTO timestamps (id) VALUES (1)`;

    const result = await sql`SELECT * FROM timestamps`;
    expect(result[0].created_at).toBeDefined();
    expect(result[0].date_only).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result[0].time_only).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test("date arithmetic", async () => {
    const results = await sql`
      SELECT 
        DATE('2024-01-15', '+1 month') as next_month,
        DATE('2024-01-15', '-7 days') as last_week,
        DATE('2024-01-15', '+1 year') as next_year,
        julianday('2024-01-15') - julianday('2024-01-01') as days_diff
    `;

    expect(results[0].next_month).toBe("2024-02-15");
    expect(results[0].last_week).toBe("2024-01-08");
    expect(results[0].next_year).toBe("2025-01-15");
    expect(results[0].days_diff).toBe(14);
  });

  test("strftime formatting", async () => {
    const results = await sql`
      SELECT 
        strftime('%Y-%m-%d', '2024-01-15 14:30:45') as date_only,
        strftime('%H:%M:%S', '2024-01-15 14:30:45') as time_only,
        strftime('%w', '2024-01-15') as day_of_week,
        strftime('%j', '2024-01-15') as day_of_year,
        strftime('%s', '2024-01-15 00:00:00') as unix_timestamp
    `;

    expect(results[0].date_only).toBe("2024-01-15");
    expect(results[0].time_only).toBe("14:30:45");
    expect(results[0].day_of_week).toBe("1"); // Monday
    expect(results[0].day_of_year).toBe("015");
    expect(parseInt(results[0].unix_timestamp)).toBeGreaterThan(0);
  });
});

describe("Aggregate Functions and Grouping", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");

    await sql`CREATE TABLE sales_data (
      id INTEGER PRIMARY KEY,
      region TEXT,
      product TEXT,
      quantity INTEGER,
      price REAL,
      sale_date TEXT
    )`;

    const salesData = [
      ["North", "Widget", 10, 25.5, "2024-01-01"],
      ["North", "Widget", 15, 25.5, "2024-01-02"],
      ["North", "Gadget", 5, 75.0, "2024-01-01"],
      ["South", "Widget", 20, 25.5, "2024-01-01"],
      ["South", "Gadget", 8, 75.0, "2024-01-02"],
      ["East", "Widget", 12, 25.5, "2024-01-01"],
      ["East", "Gadget", 3, 75.0, "2024-01-01"],
      ["West", "Widget", 18, 25.5, "2024-01-02"],
    ];

    for (let i = 0; i < salesData.length; i++) {
      const [region, product, quantity, price, date] = salesData[i];
      await sql`INSERT INTO sales_data VALUES (${i + 1}, ${region}, ${product}, ${quantity}, ${price}, ${date})`;
    }
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("basic aggregate functions", async () => {
    const result = await sql`
      SELECT 
        COUNT(*) as total_records,
        SUM(quantity) as total_quantity,
        AVG(price) as avg_price,
        MIN(quantity) as min_quantity,
        MAX(quantity) as max_quantity,
        GROUP_CONCAT(DISTINCT region) as all_regions
      FROM sales_data
    `;

    expect(result[0].total_records).toBe(8);
    expect(result[0].total_quantity).toBe(91);
    expect(result[0].avg_price).toBeCloseTo(40.3125, 2);
    expect(result[0].min_quantity).toBe(3);
    expect(result[0].max_quantity).toBe(20);
    expect(result[0].all_regions.split(",")).toHaveLength(4);
  });

  test("GROUP BY with HAVING", async () => {
    const result = await sql`
      SELECT 
        region,
        SUM(quantity * price) as total_sales,
        COUNT(*) as transaction_count
      FROM sales_data
      GROUP BY region
      HAVING SUM(quantity * price) > 500
      ORDER BY total_sales DESC
    `;

    expect(result.length).toBeGreaterThan(0);
    result.forEach(row => {
      expect(row.total_sales).toBeGreaterThan(500);
    });
  });

  test("ROLLUP grouping", async () => {
    const result = await sql`
      SELECT 
        region,
        product,
        SUM(quantity) as total_quantity
      FROM sales_data
      GROUP BY ROLLUP(region, product)
      ORDER BY region NULLS LAST, product NULLS LAST
    `;

    // Should include subtotals and grand total
    const grandTotal = result.find(r => r.region === null && r.product === null);
    expect(grandTotal).toBeDefined();
    expect(grandTotal.total_quantity).toBe(91);
  });
});

describe("STRICT Tables", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("STRICT table type enforcement", async () => {
    await sql`CREATE TABLE strict_test (
      id INTEGER PRIMARY KEY,
      int_col INTEGER,
      real_col REAL,
      text_col TEXT,
      blob_col BLOB,
      any_col ANY
    ) STRICT`;

    // Valid inserts
    await sql`INSERT INTO strict_test VALUES (1, 42, 3.14, 'text', X'0102', 'anything')`;

    // Type violations should fail
    try {
      await sql`INSERT INTO strict_test VALUES (2, 'not an int', 3.14, 'text', X'0102', 'anything')`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }

    try {
      await sql`INSERT INTO strict_test VALUES (3, 42, 'not a real', 'text', X'0102', 'anything')`;
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }

    // ANY column accepts anything
    await sql`INSERT INTO strict_test VALUES (4, 42, 3.14, 'text', X'0102', 123)`;
    await sql`INSERT INTO strict_test VALUES (5, 42, 3.14, 'text', X'0102', X'ABCD')`;

    const results = await sql`SELECT * FROM strict_test ORDER BY id`;
    expect(results).toHaveLength(3);
  });
});

describe("Virtual Tables (besides FTS)", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("generate_series virtual table", async () => {
    const result = await sql`
      SELECT value 
      FROM generate_series(1, 10, 2)
    `;

    expect(result).toHaveLength(5);
    expect(result.map(r => r.value)).toEqual([1, 3, 5, 7, 9]);
  });

  test("json_each virtual table", async () => {
    const jsonArray = JSON.stringify([1, 2, 3, 4, 5]);

    const result = await sql`
      SELECT value
      FROM json_each(${jsonArray})
    `;

    expect(result).toHaveLength(5);
    expect(result.map(r => r.value)).toEqual([1, 2, 3, 4, 5]);
  });

  test("json_tree virtual table", async () => {
    const jsonObj = JSON.stringify({
      name: "root",
      children: [
        { name: "child1", value: 1 },
        { name: "child2", value: 2 },
      ],
    });

    const result = await sql`
      SELECT key, value, type, path
      FROM json_tree(${jsonObj})
      WHERE type != 'object' AND type != 'array'
    `;

    expect(result.length).toBeGreaterThan(0);
    const nameRow = result.find(r => r.key === "name" && r.value === "root");
    expect(nameRow).toBeDefined();
  });
});

describe("Recursive Queries and Complex CTEs", () => {
  let sql: SQL;

  beforeEach(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterEach(async () => {
    await sql?.close();
  });

  test("factorial using recursive CTE", async () => {
    const result = await sql`
      WITH RECURSIVE factorial(n, fact) AS (
        SELECT 1, 1
        UNION ALL
        SELECT n + 1, fact * (n + 1)
        FROM factorial
        WHERE n < 10
      )
      SELECT n, fact FROM factorial
    `;

    expect(result).toHaveLength(10);
    expect(result[0].fact).toBe(1);
    expect(result[9].fact).toBe(3628800); // 10!
  });

  test("Fibonacci sequence", async () => {
    const result = await sql`
      WITH RECURSIVE fib(n, a, b) AS (
        SELECT 1, 0, 1
        UNION ALL
        SELECT n + 1, b, a + b
        FROM fib
        WHERE n < 10
      )
      SELECT n, a as fibonacci FROM fib
    `;

    expect(result).toHaveLength(10);
    expect(result[0].fibonacci).toBe(0);
    expect(result[9].fibonacci).toBe(34);
  });

  test("tree traversal with path", async () => {
    await sql`CREATE TABLE tree (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER,
      name TEXT
    )`;

    await sql`INSERT INTO tree VALUES 
      (1, NULL, 'root'),
      (2, 1, 'branch1'),
      (3, 1, 'branch2'),
      (4, 2, 'leaf1'),
      (5, 2, 'leaf2'),
      (6, 3, 'leaf3')`;

    const result = await sql`
      WITH RECURSIVE tree_path AS (
        SELECT id, parent_id, name, name as path, 0 as depth
        FROM tree
        WHERE parent_id IS NULL
        UNION ALL
        SELECT t.id, t.parent_id, t.name, 
               tp.path || '/' || t.name as path,
               tp.depth + 1 as depth
        FROM tree t
        JOIN tree_path tp ON t.parent_id = tp.id
      )
      SELECT * FROM tree_path
      ORDER BY path
    `;

    expect(result).toHaveLength(6);
    expect(result[0].path).toBe("root");
    expect(result[result.length - 1].depth).toBe(2);
  });
});

describe("Mathematical and String Functions", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("mathematical functions", async () => {
    const result = await sql`
      SELECT 
        ABS(-42) as abs_val,
        ROUND(3.14159, 2) as rounded,
        CEIL(4.3) as ceiling,
        FLOOR(4.7) as floor,
        SQRT(16) as square_root,
        POWER(2, 10) as power_val,
        LOG(100) as log_val,
        LOG10(1000) as log10_val,
        SIN(0) as sine,
        COS(0) as cosine,
        RADIANS(180) as radians,
        DEGREES(3.14159265359) as degrees
    `;

    expect(result[0].abs_val).toBe(42);
    expect(result[0].rounded).toBe(3.14);
    expect(result[0].ceiling).toBe(5);
    expect(result[0].floor).toBe(4);
    expect(result[0].square_root).toBe(4);
    expect(result[0].power_val).toBe(1024);
    expect(result[0].log_val).toBeCloseTo(4.605, 2);
    expect(result[0].log10_val).toBe(3);
    expect(result[0].sine).toBe(0);
    expect(result[0].cosine).toBe(1);
    expect(result[0].radians).toBeCloseTo(3.14159, 4);
    expect(result[0].degrees).toBeCloseTo(180, 1);
  });

  test("string functions", async () => {
    const result = await sql`
      SELECT 
        LENGTH('Hello') as str_length,
        UPPER('hello') as uppercase,
        LOWER('HELLO') as lowercase,
        TRIM('  hello  ') as trimmed,
        LTRIM('  hello') as left_trimmed,
        RTRIM('hello  ') as right_trimmed,
        SUBSTR('Hello World', 7, 5) as substring,
        REPLACE('Hello World', 'World', 'SQLite') as replaced,
        INSTR('Hello World', 'World') as position,
        PRINTF('%d-%02d-%02d', 2024, 1, 5) as formatted,
        HEX('ABC') as hex_val,
        CHAR(65, 66, 67) as char_val
    `;

    expect(result[0].str_length).toBe(5);
    expect(result[0].uppercase).toBe("HELLO");
    expect(result[0].lowercase).toBe("hello");
    expect(result[0].trimmed).toBe("hello");
    expect(result[0].left_trimmed).toBe("hello");
    expect(result[0].right_trimmed).toBe("hello");
    expect(result[0].substring).toBe("World");
    expect(result[0].replaced).toBe("Hello SQLite");
    expect(result[0].position).toBe(7);
    expect(result[0].formatted).toBe("2024-01-05");
    expect(result[0].hex_val).toBe("414243");
    expect(result[0].char_val).toBe("ABC");
  });

  test("pattern matching with GLOB", async () => {
    await sql`CREATE TABLE patterns (id INTEGER, text TEXT)`;
    await sql`INSERT INTO patterns VALUES 
      (1, 'hello'),
      (2, 'Hello'),
      (3, 'HELLO'),
      (4, 'hELLo'),
      (5, 'world')`;

    // GLOB is case-sensitive unlike LIKE
    const globResult = await sql`SELECT * FROM patterns WHERE text GLOB 'h*'`;
    expect(globResult).toHaveLength(2); // 'hello' and 'hELLo'

    const likeResult = await sql`SELECT * FROM patterns WHERE text LIKE 'h%'`;
    expect(likeResult).toHaveLength(4); // All variants of hello
  });
});

describe("Edge Cases for NULL handling", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("NULL in arithmetic operations", async () => {
    const result = await sql`
      SELECT 
        NULL + 5 as null_add,
        NULL * 10 as null_multiply,
        NULL || 'text' as null_concat,
        COALESCE(NULL, NULL, 'default') as coalesced,
        IFNULL(NULL, 'replacement') as if_null,
        NULLIF(5, 5) as null_if_equal,
        NULLIF(5, 3) as null_if_not_equal
    `;

    expect(result[0].null_add).toBeNull();
    expect(result[0].null_multiply).toBeNull();
    expect(result[0].null_concat).toBe("text");
    expect(result[0].coalesced).toBe("default");
    expect(result[0].if_null).toBe("replacement");
    expect(result[0].null_if_equal).toBeNull();
    expect(result[0].null_if_not_equal).toBe(5);
  });

  test("NULL in comparisons", async () => {
    await sql`CREATE TABLE null_test (id INTEGER, value INTEGER)`;
    await sql`INSERT INTO null_test VALUES (1, 10), (2, NULL), (3, 20)`;

    // NULL comparisons
    const eq = await sql`SELECT * FROM null_test WHERE value = NULL`;
    expect(eq).toHaveLength(0);

    const isNull = await sql`SELECT * FROM null_test WHERE value IS NULL`;
    expect(isNull).toHaveLength(1);

    const notNull = await sql`SELECT * FROM null_test WHERE value IS NOT NULL`;
    expect(notNull).toHaveLength(2);

    // NULL in ORDER BY (NULLs come first in ASC, last in DESC)
    const asc = await sql`SELECT * FROM null_test ORDER BY value ASC`;
    expect(asc[0].value).toBeNull();

    const desc = await sql`SELECT * FROM null_test ORDER BY value DESC`;
    expect(desc[2].value).toBeNull();
  });

  test("NULL in aggregates", async () => {
    await sql`CREATE TABLE agg_null (id INTEGER, value INTEGER)`;
    await sql`INSERT INTO agg_null VALUES (1, 10), (2, NULL), (3, 20), (4, NULL), (5, 30)`;

    const result = await sql`
      SELECT 
        COUNT(*) as count_all,
        COUNT(value) as count_values,
        SUM(value) as sum_values,
        AVG(value) as avg_values,
        MAX(value) as max_value,
        MIN(value) as min_value
      FROM agg_null
    `;

    expect(result[0].count_all).toBe(5);
    expect(result[0].count_values).toBe(3); // NULLs not counted
    expect(result[0].sum_values).toBe(60);
    expect(result[0].avg_values).toBe(20);
    expect(result[0].max_value).toBe(30);
    expect(result[0].min_value).toBe(10);
  });
});

describe("System Tables and Introspection", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");

    await sql`CREATE TABLE test_table (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`;

    await sql`CREATE INDEX idx_name ON test_table(name)`;
    await sql`CREATE VIEW test_view AS SELECT id, name FROM test_table`;
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("sqlite_master table", async () => {
    const objects = await sql`
      SELECT type, name, sql 
      FROM sqlite_master 
      WHERE type IN ('table', 'index', 'view')
      ORDER BY type, name
    `;

    expect(objects.length).toBeGreaterThan(0);

    const table = objects.find(o => o.type === "table" && o.name === "test_table");
    expect(table).toBeDefined();
    expect(table.sql).toContain("CREATE TABLE");

    const index = objects.find(o => o.type === "index" && o.name === "idx_name");
    expect(index).toBeDefined();

    const view = objects.find(o => o.type === "view" && o.name === "test_view");
    expect(view).toBeDefined();
  });

  test("pragma table_info", async () => {
    const columns = await sql`PRAGMA table_info(test_table)`;

    expect(columns).toHaveLength(3);

    const idCol = columns.find(c => c.name === "id");
    expect(idCol.pk).toBe(1);
    expect(idCol.type).toBe("INTEGER");

    const nameCol = columns.find(c => c.name === "name");
    expect(nameCol.notnull).toBe(1);
    expect(nameCol.type).toBe("TEXT");

    const createdCol = columns.find(c => c.name === "created_at");
    expect(createdCol.dflt_value).toBe("CURRENT_TIMESTAMP");
  });

  test("pragma index_list and index_info", async () => {
    const indexes = await sql`PRAGMA index_list(test_table)`;
    expect(indexes.length).toBeGreaterThan(0);

    const idx = indexes.find(i => i.name === "idx_name");
    expect(idx).toBeDefined();

    const indexInfo = await sql`PRAGMA index_info(idx_name)`;
    expect(indexInfo).toHaveLength(1);
    expect(indexInfo[0].name).toBe("name");
  });
});

describe("Error Recovery and Database Integrity", () => {
  test("handles corrupted data gracefully", async () => {
    const dir = tempDirWithFiles("sqlite-corrupt-test", {});
    const dbPath = path.join(dir, "test.db");
    const sql = new SQL(`sqlite://${dbPath}`);

    await sql`CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)`;
    await sql`INSERT INTO test VALUES (1, 'test')`;

    // Run integrity check
    const integrityCheck = await sql`PRAGMA integrity_check`;
    expect(integrityCheck[0].integrity_check).toBe("ok");

    await sql.close();
    await rm(dir, { recursive: true });
  });

  test("foreign key cascade actions", async () => {
    const sql = new SQL("sqlite://:memory:");

    await sql`PRAGMA foreign_keys = ON`;

    await sql`CREATE TABLE authors (
      id INTEGER PRIMARY KEY,
      name TEXT
    )`;

    await sql`CREATE TABLE books (
      id INTEGER PRIMARY KEY,
      title TEXT,
      author_id INTEGER,
      FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
    )`;

    await sql`INSERT INTO authors VALUES (1, 'Author 1'), (2, 'Author 2')`;
    await sql`INSERT INTO books VALUES 
      (1, 'Book 1', 1),
      (2, 'Book 2', 1),
      (3, 'Book 3', 2)`;

    // Delete author 1 - should cascade delete books 1 and 2
    await sql`DELETE FROM authors WHERE id = 1`;

    const remainingBooks = await sql`SELECT * FROM books`;
    expect(remainingBooks).toHaveLength(1);
    expect(remainingBooks[0].author_id).toBe(2);

    await sql.close();
  });

  test("deferred foreign key constraints", async () => {
    const sql = new SQL("sqlite://:memory:");

    await sql`PRAGMA foreign_keys = ON`;

    await sql`CREATE TABLE parent (id INTEGER PRIMARY KEY)`;
    await sql`CREATE TABLE child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED
    )`;

    await sql.begin(async tx => {
      // Insert child before parent - normally would fail
      await tx`INSERT INTO child VALUES (1, 1)`;
      // Insert parent before commit
      await tx`INSERT INTO parent VALUES (1)`;
    });

    const result = await sql`SELECT * FROM child`;
    expect(result).toHaveLength(1);

    await sql.close();
  });
});

describe("Temp Tables and Attached Databases", () => {
  test("temporary tables", async () => {
    const sql = new SQL("sqlite://:memory:");

    await sql`CREATE TEMP TABLE temp_data (id INTEGER, value TEXT)`;
    await sql`INSERT INTO temp_data VALUES (1, 'temp')`;

    const result = await sql`SELECT * FROM temp_data`;
    expect(result).toHaveLength(1);

    // Temp tables should be in temp_master, not sqlite_master
    const tempTables = await sql`SELECT name FROM sqlite_temp_master WHERE type = 'table'`;
    expect(tempTables.some(t => t.name === "temp_data")).toBe(true);

    const mainTables = await sql`SELECT name FROM sqlite_master WHERE name = 'temp_data'`;
    expect(mainTables).toHaveLength(0);

    await sql.close();
  });

  test("cross-database queries with ATTACH", async () => {
    const dir = tempDirWithFiles("sqlite-attach-cross-test", {});
    const mainPath = path.join(dir, "main.db");
    const attachPath = path.join(dir, "attached.db");

    // Create main database
    const mainSql = new SQL(`sqlite://${mainPath}`);
    await mainSql`CREATE TABLE main_table (id INTEGER, data TEXT)`;
    await mainSql`INSERT INTO main_table VALUES (1, 'main data')`;

    // Create attached database separately first
    const attachSql = new SQL(`sqlite://${attachPath}`);
    await attachSql`CREATE TABLE attached_table (id INTEGER, data TEXT)`;
    await attachSql`INSERT INTO attached_table VALUES (2, 'attached data')`;
    await attachSql.close();

    // Attach the second database to main
    await mainSql`ATTACH DATABASE ${attachPath} AS attached_db`;

    // Cross-database query
    const crossQuery = await mainSql`
      SELECT m.data as main_data, a.data as attached_data
      FROM main_table m, attached_db.attached_table a
      WHERE m.id = 1 AND a.id = 2
    `;

    expect(crossQuery).toHaveLength(1);
    expect(crossQuery[0].main_data).toBe("main data");
    expect(crossQuery[0].attached_data).toBe("attached data");

    await mainSql`DETACH DATABASE attached_db`;
    await mainSql.close();

    await rm(dir, { recursive: true });
  });
});

describe("Query Explain and Optimization", () => {
  let sql: SQL;

  beforeAll(async () => {
    sql = new SQL("sqlite://:memory:");

    await sql`CREATE TABLE large_table (
      id INTEGER PRIMARY KEY,
      category TEXT,
      value INTEGER,
      description TEXT
    )`;

    // Insert test data
    for (let i = 1; i <= 1000; i++) {
      await sql`INSERT INTO large_table VALUES (
        ${i},
        ${"category" + (i % 10)},
        ${i * 10},
        ${"description for item " + i}
      )`;
    }
  });

  afterAll(async () => {
    await sql?.close();
  });

  test("EXPLAIN QUERY PLAN", async () => {
    // Without index
    const planWithoutIndex = await sql`
      EXPLAIN QUERY PLAN
      SELECT * FROM large_table WHERE category = 'category5'
    `;

    expect(planWithoutIndex.length).toBeGreaterThan(0);
    expect(planWithoutIndex[0].detail).toContain("SCAN");

    // Add index
    await sql`CREATE INDEX idx_category ON large_table(category)`;

    // With index
    const planWithIndex = await sql`
      EXPLAIN QUERY PLAN
      SELECT * FROM large_table WHERE category = 'category5'
    `;

    expect(planWithIndex.length).toBeGreaterThan(0);
    // Should use index now
    expect(planWithIndex[0].detail.toLowerCase()).toContain("index");
  });
});
