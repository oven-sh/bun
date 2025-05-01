import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";

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
    
    // Test the newly added columnTypes property
    expect(stmt.native.columnTypes).toBeDefined();
    expect(Array.isArray(stmt.native.columnTypes)).toBe(true);
    expect(stmt.native.columnTypes.length).toBe(5);
    
    // Verify each column type is correct
    expect(stmt.native.columnTypes).toEqual(['integer', 'text', 'float', 'blob', 'integer']);
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

    // Since we're now using sqlite3_column_decltype(), which returns the declared type,
    // TEXT columns will be reported as 'text' even when they contain NULL
    expect(stmt.native.columnTypes).toEqual(['integer', 'text']);
  });

  it("returns declared column types regardless of actual data values", () => {
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
    
    // The declared type of 'value' is ANY, so we should get 'ANY' regardless of content
    expect(stmt.native.columnTypes).toEqual(['integer', 'ANY']);
    
    // Update to a text value
    db.run(`UPDATE dynamic_types SET value = 'text' WHERE id = 1`);
    
    // Re-prepare to get fresh column type information
    stmt = db.prepare("SELECT * FROM dynamic_types");
    row = stmt.get();
    
    // Even though the value is now text, the column type remains the same
    // because we're reporting the declared type, not the actual data type
    expect(stmt.native.columnTypes).toEqual(['integer', 'ANY']);
  });

  it("reports 'any' for column types from expressions", () => {
    // Create a database
    const db = new Database(":memory:");

    // Test with an expression
    const stmt = db.prepare("SELECT length('bun') AS str_length, 42 AS magic_number, 'hello' AS greeting");
    const row = stmt.get();

    // Check the row data is as expected
    expect(row).toEqual({
      str_length: 3,
      magic_number: 42,
      greeting: "hello"
    });

    // Check columns are correctly identified
    expect(stmt.native.columns).toEqual(['str_length', 'magic_number', 'greeting']);
    
    // For expressions, we expect 'any' as the type since there's no declared type
    expect(stmt.native.columnTypes).toEqual(['any', 'any', 'any']);
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
      'int_val', 
      'float_val', 
      'text_val', 
      'blob_val', 
      'null_val', 
      'func_result', 
      'timestamp'
    ]);

    // All expression columns should be reported as 'any' type
    expect(stmt.native.columnTypes).toEqual([
      'any', 'any', 'any', 'any', 'any', 'any', 'any'
    ]);

    // Verify data types were correctly identified at runtime
    expect(typeof row.int_val).toBe('number');
    expect(typeof row.float_val).toBe('number');
    expect(typeof row.text_val).toBe('string');
    expect(row.blob_val instanceof Uint8Array).toBe(true);
    expect(row.null_val).toBe(null);
    expect(typeof row.func_result).toBe('number');
    expect(typeof row.timestamp).toBe('string');
  });
});