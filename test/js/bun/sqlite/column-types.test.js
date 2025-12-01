import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

describe("SQLite Statement column types", () => {
  it("reports correct column types for a variety of data types", () => {
    // Create a test database
    const db = new Database(":memory:");

    // Create a table with different column types
    db.run(`
      CREATE TABLE test_types (
        id INTEGER PRIMARY KEY,
        name TEXT,
        weight REAL,
        image BLOB,
        is_active INTEGER
      )
    `);

    // Insert a row
    db.run(`
      INSERT INTO test_types (id, name, weight, image, is_active)
      VALUES (1, 'test', 72.5, X'DEADBEEF', 1)
    `);

    // Prepare a statement that selects all columns
    const stmt = db.prepare("SELECT * FROM test_types");

    // Execute the statement to get column types
    const row = stmt.get();

    // Verify column metadata
    expect(stmt.native.columns).toEqual(["id", "name", "weight", "image", "is_active"]);
    expect(stmt.native.columnsCount).toBe(5);

    // Test the columnTypes property (uses actual data types from sqlite3_column_type)
    expect(stmt.columnTypes).toBeDefined();
    expect(Array.isArray(stmt.columnTypes)).toBe(true);
    expect(stmt.columnTypes.length).toBe(5);
    expect(stmt.columnTypes).toEqual(["INTEGER", "TEXT", "FLOAT", "BLOB", "INTEGER"]);

    // Test the declaredTypes property (uses declared types from sqlite3_column_decltype)
    expect(stmt.declaredTypes).toBeDefined();
    expect(Array.isArray(stmt.declaredTypes)).toBe(true);
    expect(stmt.declaredTypes.length).toBe(5);
    expect(stmt.declaredTypes).toEqual(["INTEGER", "TEXT", "REAL", "BLOB", "INTEGER"]);
  });

  it("handles NULL values correctly", () => {
    const db = new Database(":memory:");

    db.run(`
      CREATE TABLE nulls_test (
        id INTEGER PRIMARY KEY,
        nullable TEXT
      )
    `);

    db.run(`INSERT INTO nulls_test (id, nullable) VALUES (1, NULL)`);

    const stmt = db.prepare("SELECT * FROM nulls_test");

    // Execute the statement to get column types
    const row = stmt.get();

    // columnTypes now returns actual data types - NULL values are reported as 'NULL'
    expect(stmt.columnTypes).toEqual(["INTEGER", "NULL"]);

    // declaredTypes still shows the declared table schema
    expect(stmt.declaredTypes).toEqual(["INTEGER", "TEXT"]);
  });

  it("reports actual column types based on data values", () => {
    const db = new Database(":memory:");

    db.run(`
      CREATE TABLE dynamic_types (
        id INTEGER PRIMARY KEY,
        value ANY
      )
    `);

    // SQLite can store various types in the same column
    db.run(`INSERT INTO dynamic_types VALUES (1, 42)`);

    let stmt = db.prepare("SELECT * FROM dynamic_types");

    // Execute the statement to get column types
    let row = stmt.get();

    // We should get the actual type of the value (integer)
    expect(stmt.columnTypes).toEqual(["INTEGER", "INTEGER"]);

    // Update to a text value
    db.run(`UPDATE dynamic_types SET value = 'text' WHERE id = 1`);

    // Re-prepare to get fresh column type information
    stmt = db.prepare("SELECT * FROM dynamic_types");
    row = stmt.get();

    // We should get the actual type of the value (text)
    expect(stmt.columnTypes).toEqual(["INTEGER", "TEXT"]);

    // Update to a float value
    db.run(`UPDATE dynamic_types SET value = 3.14 WHERE id = 1`);

    // Re-prepare to get fresh column type information
    stmt = db.prepare("SELECT * FROM dynamic_types");
    row = stmt.get();

    // We should get the actual type of the value (float)
    expect(stmt.columnTypes).toEqual(["INTEGER", "FLOAT"]);
  });

  it("reports actual types for columns from expressions", () => {
    // Create a database
    const db = new Database(":memory:");

    // Test with an expression
    const stmt = db.prepare("SELECT length('bun') AS str_length, 42 AS magic_number, 'hello' AS greeting");
    const row = stmt.get();

    // Check the row data is as expected
    expect(row).toEqual({
      str_length: 3,
      magic_number: 42,
      greeting: "hello",
    });

    // Check columns are correctly identified
    expect(stmt.native.columns).toEqual(["str_length", "magic_number", "greeting"]);

    // For expressions, expect the actual data types
    expect(stmt.columnTypes).toEqual(["INTEGER", "INTEGER", "TEXT"]);
  });

  it("handles multiple different expressions and functions", () => {
    const db = new Database(":memory:");

    // Test with multiple different expressions
    const stmt = db.prepare(`
      SELECT 
        123 AS int_val, 
        3.14 AS float_val, 
        'text' AS text_val, 
        x'DEADBEEF' AS blob_val,
        NULL AS null_val,
        length('bun') AS func_result,
        CURRENT_TIMESTAMP AS timestamp
    `);

    const row = stmt.get();

    // Verify we have the expected columns
    expect(stmt.native.columns).toEqual([
      "int_val",
      "float_val",
      "text_val",
      "blob_val",
      "null_val",
      "func_result",
      "timestamp",
    ]);

    // Expression columns should be reported with their actual types
    expect(stmt.columnTypes).toEqual(["INTEGER", "FLOAT", "TEXT", "BLOB", "NULL", "INTEGER", "TEXT"]);

    // Verify data types were correctly identified at runtime
    expect(typeof row.int_val).toBe("number");
    expect(typeof row.float_val).toBe("number");
    expect(typeof row.text_val).toBe("string");
    expect(row.blob_val instanceof Uint8Array).toBe(true);
    expect(row.null_val).toBe(null);
    expect(typeof row.func_result).toBe("number");
    expect(typeof row.timestamp).toBe("string");
  });

  it("shows difference between columnTypes and declaredTypes for expressions", () => {
    const db = new Database(":memory:");

    // Test with expressions where declared types differ from actual types
    const stmt = db.prepare("SELECT length('bun') AS str_length, 42 AS magic_number, 'hello' AS greeting");
    const row = stmt.get();

    // columnTypes shows actual data types based on the values
    expect(stmt.columnTypes).toEqual(["INTEGER", "INTEGER", "TEXT"]);

    // declaredTypes shows declared types (which are null for expressions without explicit declarations)
    expect(stmt.declaredTypes).toEqual([null, null, null]);
  });

  it("shows difference for dynamic column types", () => {
    const db = new Database(":memory:");

    db.run(`
      CREATE TABLE dynamic_types (
        id INTEGER PRIMARY KEY,
        value ANY
      )
    `);

    // Insert an integer value
    db.run(`INSERT INTO dynamic_types VALUES (1, 42)`);

    let stmt = db.prepare("SELECT * FROM dynamic_types");
    let row = stmt.get();

    // columnTypes shows actual type (integer) for the current value
    expect(stmt.columnTypes).toEqual(["INTEGER", "INTEGER"]);

    // declaredTypes shows the declared table schema
    expect(stmt.declaredTypes).toEqual(["INTEGER", "ANY"]);

    // Update to a text value
    db.run(`UPDATE dynamic_types SET value = 'text' WHERE id = 1`);

    stmt = db.prepare("SELECT * FROM dynamic_types");
    row = stmt.get();

    // columnTypes now shows text for the current value
    expect(stmt.columnTypes).toEqual(["INTEGER", "TEXT"]);

    // declaredTypes still shows the declared table schema
    expect(stmt.declaredTypes).toEqual(["INTEGER", "ANY"]);
  });

  it("throws an error when accessing columnTypes before statement execution", () => {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE test (id INTEGER, name TEXT)`);

    // Prepare statement but don't execute it
    const stmt = db.prepare("SELECT * FROM test");

    // Accessing columnTypes before executing is fine (implicitly executes the statement)
    expect(stmt.columnTypes).toBeArray();

    // Accessing declaredTypes before executing should throw
    expect(() => {
      stmt.declaredTypes;
    }).toThrow("Statement must be executed before accessing declaredTypes");
  });

  it("throws an error when accessing columnTypes on non-read-only statements", () => {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE test (id INTEGER, name TEXT)`);

    // Test INSERT statement
    const insertStmt = db.prepare("INSERT INTO test (id, name) VALUES (?, ?)");
    insertStmt.run(1, "test");

    expect(() => {
      insertStmt.columnTypes;
    }).toThrow("columnTypes is not available for non-read-only statements");

    // Test UPDATE statement
    const updateStmt = db.prepare("UPDATE test SET name = ? WHERE id = ?");
    updateStmt.run("updated", 1);

    expect(() => {
      updateStmt.columnTypes;
    }).toThrow("columnTypes is not available for non-read-only statements");

    // Test DELETE statement
    const deleteStmt = db.prepare("DELETE FROM test WHERE id = ?");
    deleteStmt.run(1);

    expect(() => {
      deleteStmt.columnTypes;
    }).toThrow("columnTypes is not available for non-read-only statements");

    // declaredTypes should still work for these statements
    expect(() => {
      insertStmt.declaredTypes;
    }).not.toThrow();
  });
});
