import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

// This test file verifies that PostgresError maintains backward compatibility
// with the old error structure after the refactoring to support multiple adapters

describe("PostgresError compatibility", () => {
  // Mock connection that will fail - using invalid port
  const invalidOptions = {
    adapter: "postgres" as const,
    hostname: "localhost",
    port: 1, // Invalid port - will fail to connect
    connectionTimeout: 1, // 1 second timeout
  };

  test("PostgresError is exposed on SQL namespace", () => {
    expect(SQL.PostgresError).toBeDefined();
    expect(SQL.SQLError).toBeDefined();
    expect(SQL.SQLiteError).toBeDefined();
  });

  test("Connection errors are PostgresError instances", async () => {
    let error: Bun.SQL.PostgresError | null = null;

    try {
      const sql = new SQL(invalidOptions);
      await sql`SELECT 1`;
    } catch (e) {
      error = e as Bun.SQL.PostgresError;
    }

    expect(error).toBeDefined();
    expect(error).toBeInstanceOf(SQL.SQLError);
    expect(error).toBeInstanceOf(SQL.PostgresError);
    expect(error.name).toBe("PostgresError");
    expect(error.code).toMatch(/ERR_POSTGRES/);
  });

  test("PostgresError has expected properties structure", () => {
    // Create a PostgresError instance directly with all properties
    const error = new SQL.PostgresError("Test error", {
      code: "ERR_TEST",
      errno: "42P01",
      detail: "Table does not exist",
      hint: "Create the table first",
      severity: "ERROR",
      position: "15",
      schema: "public",
      table: "test_table",
      column: "test_column",
      dataType: "integer",
      constraint: "test_constraint",
    });

    // Check all properties exist
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("ERR_TEST");
    expect(error.errno).toBe("42P01");
    expect(error.detail).toBe("Table does not exist");
    expect(error.hint).toBe("Create the table first");
    expect(error.severity).toBe("ERROR");
    expect(error.position).toBe("15");
    expect(error.schema).toBe("public");
    expect(error.table).toBe("test_table");
    expect(error.column).toBe("test_column");
    expect(error.dataType).toBe("integer");
    expect(error.constraint).toBe("test_constraint");

    // Verify toJSON works
    const json = error.toJSON();
    expect(json.name).toBe("PostgresError");
    expect(json.message).toBe("Test error");
    expect(json.code).toBe("ERR_TEST");
  });

  test("PostgresError optional properties are handled correctly", () => {
    // Create error with minimal properties - only code is required
    const error = new SQL.PostgresError("Minimal error", {
      code: "ERR_MINIMAL",
    });

    expect(error.message).toBe("Minimal error");
    expect(error.code).toBe("ERR_MINIMAL");

    // All optional properties should be undefined
    expect(error.detail).toBeUndefined();
    expect(error.hint).toBeUndefined();
    expect(error.severity).toBeUndefined();
    expect(error.errno).toBeUndefined();
    expect(error.position).toBeUndefined();
    expect(error.schema).toBeUndefined();
    expect(error.table).toBeUndefined();
    expect(error.column).toBeUndefined();

    // toJSON should only include defined properties
    const json = error.toJSON();
    expect(json.name).toBe("PostgresError");
    expect(json.code).toBe("ERR_MINIMAL");
    expect("detail" in json).toBe(false);
    expect("hint" in json).toBe(false);
    expect("severity" in json).toBe(false);
    expect("position" in json).toBe(false);
    expect("schema" in json).toBe(false);
  });

  test("SQLError base class works correctly", () => {
    const error = new SQL.SQLError("Base SQL error");
    expect(error.message).toBe("Base SQL error");
    expect(error.name).toBe("SQLError");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SQL.SQLError);
  });

  if (process.env.DATABASE_URL) {
    describe("PostgresError with real database", () => {
      const sql = new SQL(process.env.DATABASE_URL);

      test("Syntax error returns PostgresError with properties", async () => {
        let error: any;
        try {
          await sql`SELCT 1`; // Intentional typo
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(SQL.PostgresError);
        expect(error.code).toBe("ERR_POSTGRES_SYNTAX_ERROR");
        expect(error.errno).toBe("42601"); // PostgreSQL syntax error code
        expect(error.severity).toBeTruthy();
        expect(error.position).toBeTruthy(); // Position of the error in the query
      });

      test("Table not found error has expected properties", async () => {
        let error: any;
        try {
          await sql`SELECT * FROM nonexistent_table_xyz123`;
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(SQL.PostgresError);
        expect(error.errno).toBe("42P01"); // undefined_table error code
        expect(error.message).toContain("nonexistent_table_xyz123");
      });

      test("Constraint violation error includes constraint details", async () => {
        // Create a table with a constraint
        await sql`DROP TABLE IF EXISTS test_constraints`;
        await sql`CREATE TABLE test_constraints (id INT PRIMARY KEY, value INT CHECK (value > 0))`;

        let error: any;
        try {
          await sql`INSERT INTO test_constraints (id, value) VALUES (1, -1)`;
        } catch (e) {
          error = e;
        } finally {
          await sql`DROP TABLE IF EXISTS test_constraints`;
        }

        expect(error).toBeInstanceOf(SQL.PostgresError);
        expect(error.errno).toBe("23514"); // check_violation
        expect(error.constraint).toContain("test_constraints_value_check");
        expect(error.table).toBe("test_constraints");
      });

      test("Type mismatch error includes column details", async () => {
        await sql`DROP TABLE IF EXISTS test_types`;
        await sql`CREATE TABLE test_types (id INT, name TEXT)`;

        let error: any;
        try {
          await sql`INSERT INTO test_types (id, name) VALUES ('not_a_number', 'test')`;
        } catch (e) {
          error = e;
        } finally {
          await sql`DROP TABLE IF EXISTS test_types`;
        }

        expect(error).toBeInstanceOf(SQL.PostgresError);
        expect(error.errno).toBe("22P02"); // invalid_text_representation
        expect(error.message).toContain("integer");
      });

      afterAll(() => sql.close());
    });
  }
});
