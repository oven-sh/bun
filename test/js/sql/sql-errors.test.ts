import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import path from "path";

describe("SQL Error Classes", () => {
  describe("SQLError base class", () => {
    test("SQLError should be a constructor", () => {
      expect(typeof SQL.SQLError).toBe("function");
      expect(SQL.SQLError.name).toBe("SQLError");
    });

    test("SQLError should extend Error", () => {
      const error = new SQL.SQLError("Test error");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("SQLError");
    });

    test("SQLError should have proper stack trace", () => {
      const error = new SQL.SQLError("Test error");
      expect(error.stack).toContain("SQLError");
      expect(error.stack).toContain("Test error");
    });

    test("SQLError should be catchable as base class", () => {
      try {
        throw new SQL.SQLError("Test error");
      } catch (e) {
        expect(e).toBeInstanceOf(SQL.SQLError);
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("PostgresError class", () => {
    test("PostgresError should be a constructor", () => {
      expect(typeof SQL.PostgresError).toBe("function");
      expect(SQL.PostgresError.name).toBe("PostgresError");
    });

    test("PostgresError should extend SQLError", () => {
      const error = new SQL.PostgresError("Postgres error", {
        code: "00000",
        detail: "",
        hint: "",
        severity: "ERROR",
      });
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.PostgresError);
      expect(error.message).toBe("Postgres error");
      expect(error.name).toBe("PostgresError");
    });

    test("PostgresError should have Postgres-specific properties", () => {
      // Test with common properties that we'll definitely have
      const error = new SQL.PostgresError("Postgres error", {
        code: "23505",
        detail: "Key (id)=(1) already exists.",
        hint: "Try using a different ID.",
        severity: "ERROR",
      });

      expect(error.code).toBe("23505");
      expect(error.detail).toBe("Key (id)=(1) already exists.");
      expect(error.hint).toBe("Try using a different ID.");
      expect(error.severity).toBe("ERROR");
    });

    test("PostgresError should support extended properties when available", () => {
      // Test that we can include additional properties when they're provided by Postgres
      const error = new SQL.PostgresError("Postgres error", {
        code: "23505",
        detail: "Duplicate key value",
        hint: "",
        severity: "ERROR",
        schema: "public",
        table: "users",
        constraint: "users_pkey",
      });

      expect(error.code).toBe("23505");
      expect(error.detail).toBe("Duplicate key value");
      expect(error.schema).toBe("public");
      expect(error.table).toBe("users");
      expect(error.constraint).toBe("users_pkey");
    });

    test("PostgresError should be catchable as SQLError", () => {
      try {
        throw new SQL.PostgresError("Postgres error", {
          code: "00000",
          detail: "",
          hint: "",
          severity: "ERROR",
        });
      } catch (e) {
        if (e instanceof SQL.SQLError) {
          expect(e).toBeInstanceOf(SQL.PostgresError);
        } else {
          throw new Error("Should be catchable as SQLError");
        }
      }
    });

    test("PostgresError with minimal properties", () => {
      const error = new SQL.PostgresError("Connection failed", {
        code: "",
        detail: "",
        hint: "",
        severity: "ERROR",
      });
      expect(error.message).toBe("Connection failed");
      expect(error.code).toBe("");
      expect(error.detail).toBe("");
    });
  });

  describe("SQLiteError class", () => {
    test("SQLiteError should be a constructor", () => {
      expect(typeof SQL.SQLiteError).toBe("function");
      expect(SQL.SQLiteError.name).toBe("SQLiteError");
    });

    test("SQLiteError should extend SQLError", () => {
      const error = new SQL.SQLiteError("SQLite error", {
        code: "SQLITE_ERROR",
        errno: 1,
      });
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(error).toBeInstanceOf(SQL.SQLiteError);
      expect(error.message).toBe("SQLite error");
      expect(error.name).toBe("SQLiteError");
    });

    test("SQLiteError should have SQLite-specific properties", () => {
      const error = new SQL.SQLiteError("UNIQUE constraint failed: users.email", {
        code: "SQLITE_CONSTRAINT_UNIQUE",
        errno: 2067,
      });

      expect(error.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
      expect(error.errno).toBe(2067);
      expect(error.message).toBe("UNIQUE constraint failed: users.email");
    });

    test("SQLiteError should be catchable as SQLError", () => {
      try {
        throw new SQL.SQLiteError("SQLite error", {
          code: "SQLITE_ERROR",
          errno: 1,
        });
      } catch (e) {
        if (e instanceof SQL.SQLError) {
          expect(e).toBeInstanceOf(SQL.SQLiteError);
        } else {
          throw new Error("Should be catchable as SQLError");
        }
      }
    });

    test("SQLiteError with minimal properties", () => {
      const error = new SQL.SQLiteError("Database locked", {
        code: "SQLITE_BUSY",
        errno: 5,
      });
      expect(error.message).toBe("Database locked");
      expect(error.code).toBe("SQLITE_BUSY");
      expect(error.errno).toBe(5);
    });
  });

  describe("Error hierarchy and instanceof checks", () => {
    test("can differentiate between PostgresError and SQLiteError", () => {
      const pgError = new SQL.PostgresError("pg error", {
        code: "00000",
        detail: "",
        hint: "",
        severity: "ERROR",
      });
      const sqliteError = new SQL.SQLiteError("sqlite error", {
        code: "SQLITE_ERROR",
        errno: 1,
      });

      expect(pgError instanceof SQL.PostgresError).toBe(true);
      expect(pgError instanceof SQL.SQLiteError).toBe(false);
      expect(pgError instanceof SQL.SQLError).toBe(true);

      expect(sqliteError instanceof SQL.SQLiteError).toBe(true);
      expect(sqliteError instanceof SQL.PostgresError).toBe(false);
      expect(sqliteError instanceof SQL.SQLError).toBe(true);
    });

    test("can catch all SQL errors with base class", () => {
      const errors = [
        new SQL.PostgresError("pg error", {
          code: "00000",
          detail: "",
          hint: "",
          severity: "ERROR",
        }),
        new SQL.SQLiteError("sqlite error", {
          code: "SQLITE_ERROR",
          errno: 1,
        }),
        new SQL.SQLError("generic sql error"),
      ];

      for (const error of errors) {
        try {
          throw error;
        } catch (e) {
          expect(e).toBeInstanceOf(SQL.SQLError);
        }
      }
    });

    test("error.toString() returns proper format", () => {
      const pgError = new SQL.PostgresError("connection failed", {
        code: "08001",
        detail: "",
        hint: "",
        severity: "ERROR",
      });
      const sqliteError = new SQL.SQLiteError("database locked", {
        code: "SQLITE_BUSY",
        errno: 5,
      });
      const sqlError = new SQL.SQLError("generic error");

      expect(pgError.toString()).toContain("PostgresError");
      expect(pgError.toString()).toContain("connection failed");

      expect(sqliteError.toString()).toContain("SQLiteError");
      expect(sqliteError.toString()).toContain("database locked");

      expect(sqlError.toString()).toContain("SQLError");
      expect(sqlError.toString()).toContain("generic error");
    });
  });

  describe("Integration with actual database operations", () => {
    describe("SQLite errors", () => {
      test("SQLite constraint violation throws SQLiteError", async () => {
        const dir = tempDirWithFiles("sqlite-error-test", {});
        const dbPath = path.join(dir, "test.db");

        const db = new SQL({ filename: dbPath, adapter: "sqlite" });

        await db`
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE NOT NULL
          )
        `;

        await db`INSERT INTO users (email) VALUES ('test@example.com')`;

        try {
          await db`INSERT INTO users (email) VALUES ('test@example.com')`;
          throw new Error("Should have thrown an error");
        } catch (e) {
          expect(e).toBeInstanceOf(SQL.SQLiteError);
          expect(e).toBeInstanceOf(SQL.SQLError);
          expect(e.message).toContain("UNIQUE constraint failed");
          expect(e.code).toContain("SQLITE_CONSTRAINT");
        }

        await db.close();
      });

      test("SQLite syntax error throws SQLiteError", async () => {
        const dir = tempDirWithFiles("sqlite-syntax-error-test", {});
        const dbPath = path.join(dir, "test.db");

        const db = new SQL({ filename: dbPath, adapter: "sqlite" });

        try {
          await db`SELCT * FROM nonexistent`;
          throw new Error("Should have thrown an error");
        } catch (e) {
          expect(e).toBeInstanceOf(SQL.SQLiteError);
          expect(e).toBeInstanceOf(SQL.SQLError);
          expect(e.message).toContain("syntax error");
          expect(e.code).toBe("SQLITE_ERROR");
        }

        await db.close();
      });

      test("SQLite database locked throws SQLiteError", async () => {
        const dir = tempDirWithFiles("sqlite-locked-test", {});
        const dbPath = path.join(dir, "test.db");

        await using db1 = new SQL({ filename: dbPath, adapter: "sqlite" });
        await using db2 = new SQL({ filename: dbPath, adapter: "sqlite" });

        await db1`CREATE TABLE test (id INTEGER PRIMARY KEY)`;

        await db1`BEGIN EXCLUSIVE TRANSACTION`;
        await db1`INSERT INTO test (id) VALUES (1)`;

        try {
          await db2`INSERT INTO test (id) VALUES (2)`;
          throw new Error("Should have thrown an error");
        } catch (e) {
          expect(e).toBeInstanceOf(SQL.SQLiteError);
          expect(e).toBeInstanceOf(SQL.SQLError);
          expect(e.code).toBe("SQLITE_BUSY");
        }

        await db1`COMMIT`;
      });
    });

    describe("PostgreSQL errors", () => {
      test.todo("PostgreSQL connection error throws PostgresError", async () => {
        try {
          const sql = new SQL("postgres://invalid:invalid@localhost:99999/invalid");
          await sql`SELECT 1`;
          throw new Error("Should have thrown an error");
        } catch (e) {
          expect(e).toBeInstanceOf(SQL.PostgresError);
          expect(e).toBeInstanceOf(SQL.SQLError);
          expect(e.code).toBeDefined();
        }
      });

      test.todo("PostgreSQL constraint violation throws PostgresError with details", async () => {
        // This would require a running PostgreSQL instance
        // Will be implemented when we have the actual error classes working
      });

      test.todo("PostgreSQL syntax error throws PostgresError", async () => {
        // This would require a running PostgreSQL instance
        // Will be implemented when we have the actual error classes working
      });
    });
  });

  describe("Error serialization", () => {
    test("errors can be JSON stringified", () => {
      const pgError = new SQL.PostgresError("test error", {
        code: "23505",
        detail: "Duplicate key",
        hint: "",
        severity: "ERROR",
      });

      const json = JSON.stringify(pgError);
      const parsed = JSON.parse(json);

      expect(parsed.name).toBe("PostgresError");
      expect(parsed.message).toBe("test error");
      expect(parsed.code).toBe("23505");
      expect(parsed.detail).toBe("Duplicate key");
      expect(parsed.severity).toBe("ERROR");
    });

    test("errors preserve stack trace in JSON", () => {
      const error = new SQL.SQLError("test");
      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(parsed.stack).toBeDefined();
      expect(parsed.stack).toContain("SQLError");
    });
  });

  describe("Type guards", () => {
    test("can use instanceof for type narrowing", () => {
      function handleError(e: unknown) {
        if (e instanceof SQL.PostgresError) {
          return `PG: ${e.code}`;
        } else if (e instanceof SQL.SQLiteError) {
          return `SQLite: ${e.errno}`;
        } else if (e instanceof SQL.SQLError) {
          return `SQL: ${e.message}`;
        }
        return "Unknown error";
      }

      expect(
        handleError(
          new SQL.PostgresError("test", {
            code: "23505",
            detail: "",
            hint: "",
            severity: "ERROR",
          }),
        ),
      ).toBe("PG: 23505");
      expect(
        handleError(
          new SQL.SQLiteError("test", {
            code: "SQLITE_BUSY",
            errno: 5,
          }),
        ),
      ).toBe("SQLite: 5");
      expect(handleError(new SQL.SQLError("test"))).toBe("SQL: test");
      expect(handleError(new Error("test"))).toBe("Unknown error");
    });
  });
});
