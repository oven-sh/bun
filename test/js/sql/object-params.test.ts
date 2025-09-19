import { expect, test, describe } from "bun:test";

describe("Bun.sql.unsafe with object parameters", () => {
  describe("SQLite", () => {
    test("should support object parameters with named placeholders", async () => {
      const sql = new Bun.SQL("sqlite::memory:");

      // Create test table
      await sql.unsafe(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT,
          age INTEGER
        )
      `);

      // Insert with object parameters (SQLite natively supports :name, @name, and $name syntax)
      await sql.unsafe(
        "INSERT INTO users (name, age) VALUES (:name, :age)",
        { name: "Alice", age: 25 }
      );

      await sql.unsafe(
        "INSERT INTO users (name, age) VALUES ($name, $age)",
        { $name: "Bob", $age: 30 }
      );

      await sql.unsafe(
        "INSERT INTO users (name, age) VALUES (@name, @age)",
        { "@name": "Charlie", "@age": 35 }
      );

      // Query with object parameters
      const result = await sql.unsafe(
        "SELECT * FROM users WHERE age > :minAge ORDER BY name",
        { minAge: 20 }
      );

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Alice");
      expect(result[1].name).toBe("Bob");
      expect(result[2].name).toBe("Charlie");

      // Query with multiple same parameter usage
      const singleResult = await sql.unsafe(
        "SELECT * FROM users WHERE name = :name OR age = :age",
        { name: "Alice", age: 30 }
      );

      expect(singleResult).toHaveLength(2);

      await sql.close();
    });


    test("should still work with array parameters", async () => {
      const sql = new Bun.SQL("sqlite::memory:");

      await sql.unsafe(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT
        )
      `);

      // Array parameters should still work
      await sql.unsafe(
        "INSERT INTO users (name) VALUES (?)",
        ["David"]
      );

      const result = await sql.unsafe("SELECT * FROM users WHERE name = ?", ["David"]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("David");

      await sql.close();
    });

    test("should work with sql.file and object parameters", async () => {
      const sql = new Bun.SQL("sqlite::memory:");

      await sql.unsafe(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          name TEXT,
          price REAL
        )
      `);

      await sql.unsafe(
        "INSERT INTO products (name, price) VALUES (:name, :price)",
        { name: "Widget", price: 9.99 }
      );

      // Create a temporary SQL file
      const testFile = await Bun.write("/tmp/test-query.sql", "SELECT * FROM products WHERE price > :minPrice");

      const result = await sql.file("/tmp/test-query.sql", { minPrice: 5.0 });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Widget");

      await sql.close();
    });

    test("should handle reserved connections with object parameters", async () => {
      const sql = new Bun.SQL("sqlite::memory:");

      await sql.unsafe("CREATE TABLE test (id INTEGER, value TEXT)");

      const reserved = await sql.reserve();

      await reserved.unsafe(
        "INSERT INTO test (id, value) VALUES (:id, :value)",
        { id: 1, value: "test" }
      );

      const result = await reserved.unsafe(
        "SELECT * FROM test WHERE id = :id",
        { id: 1 }
      );

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe("test");

      await reserved.release();
      await sql.close();
    });

    test("should handle transactions with object parameters", async () => {
      const sql = new Bun.SQL("sqlite::memory:");

      await sql.unsafe("CREATE TABLE accounts (id INTEGER, balance REAL)");
      await sql.unsafe("INSERT INTO accounts VALUES (1, 100.0), (2, 200.0)");

      await sql.begin(async (tx) => {
        await tx.unsafe(
          "UPDATE accounts SET balance = balance - $amount WHERE id = $id",
          { $amount: 50.0, $id: 1 }
        );

        await tx.unsafe(
          "UPDATE accounts SET balance = balance + $amount WHERE id = $id",
          { $amount: 50.0, $id: 2 }
        );
      });

      const result = await sql.unsafe("SELECT * FROM accounts ORDER BY id");
      expect(result[0].balance).toBe(50.0);
      expect(result[1].balance).toBe(250.0);

      await sql.close();
    });


    test("should handle empty object when no parameters needed", async () => {
      const sql = new Bun.SQL("sqlite::memory:");

      await sql.unsafe("CREATE TABLE test (id INTEGER DEFAULT 1)");
      await sql.unsafe("INSERT INTO test DEFAULT VALUES", {});

      const result = await sql.unsafe("SELECT * FROM test", {});
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);

      await sql.close();
    });
  });

  // Test that PostgreSQL doesn't support object parameters
  describe("PostgreSQL", () => {
    test.skip("should reject object parameters", async () => {
      // Skip this test unless we have a PostgreSQL instance running
      // This would need actual PostgreSQL connection details
      const sql = new Bun.SQL({
        adapter: "postgres",
        hostname: "localhost",
        port: 5432,
        username: "test",
        password: "test",
        database: "test"
      });

      try {
        await sql.unsafe("SELECT * WHERE id = $1", { id: 1 });
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error.code).toBe("ERR_POSTGRES_OBJECT_PARAMS_NOT_SUPPORTED");
        expect(error.message).toContain("PostgreSQL adapter only supports array parameters");
      }

      await sql.close();
    });
  });
});