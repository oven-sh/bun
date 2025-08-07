import { SQL } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
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
