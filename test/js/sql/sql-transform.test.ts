import { describe, expect, test } from "bun:test";
import { SQL, postgres } from "bun";

describe("SQL Column Name Transforms", () => {
  describe("String case functions (Unicode-aware)", () => {
    test("toCamel", () => {
      expect(postgres.toCamel("user_id")).toBe("userId");
      expect(postgres.toCamel("USER_ID")).toBe("userId");
      expect(postgres.toCamel("first_name")).toBe("firstName");
      expect(postgres.toCamel("user_id_2024")).toBe("userId2024");
      expect(postgres.toCamel("créée_à")).toBe("crééeÀ");
      expect(postgres.toCamel("über_größe")).toBe("überGröße");
      expect(postgres.toCamel("имя_пользователя")).toBe("имяПользователя");
      expect(postgres.toCamel("FooBar")).toBe("fooBar");
      expect(postgres.toCamel("foo-bar")).toBe("fooBar");
    });

    test("toPascal", () => {
      expect(postgres.toPascal("user_id")).toBe("UserId");
      expect(postgres.toPascal("USER_ID")).toBe("UserId");
      expect(postgres.toPascal("first_name")).toBe("FirstName");
      expect(postgres.toPascal("créée_à")).toBe("CrééeÀ");
      expect(postgres.toPascal("foo-bar")).toBe("FooBar");
    });

    test("toKebab", () => {
      expect(postgres.toKebab("user_id")).toBe("user-id");
      expect(postgres.toKebab("userId")).toBe("user-id");
      expect(postgres.toKebab("First_Name")).toBe("first-name");
    });

    test("toSnake", () => {
      expect(postgres.toSnake("userId")).toBe("user_id");
      expect(postgres.toSnake("UserId")).toBe("user_id");
      expect(postgres.toSnake("first-name")).toBe("first_name");
      expect(postgres.toSnake("FOO_BAR")).toBe("foo_bar");
      expect(postgres.toSnake("crééeÀ")).toBe("créée_à");
    });
  });

  describe("SQL Client transform options", () => {
    test("snake_case to camelCase with postgres.camel", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: postgres.camel,
      });

      const [row] = await sql`SELECT 1 as user_id, 'Alice' as first_name, '2024-01-01' as created_at`;
      expect(row).toEqual({
        userId: 1,
        firstName: "Alice",
        createdAt: "2024-01-01",
      });
    });

    test("snake_case to camelCase with Unicode column names", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: { column: postgres.camel },
      });

      const [row] = await sql`SELECT 'oui' as créée_à, 'groß' as über_größe`;
      expect(row).toEqual({
        crééeÀ: "oui",
        überGröße: "groß",
      });
    });

    test("snake_case to PascalCase with postgres.pascal", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: postgres.pascal,
      });

      const [row] = await sql`SELECT 1 as user_id, 'Bob' as first_name`;
      expect(row).toEqual({
        UserId: 1,
        FirstName: "Bob",
      });
    });

    test("camelCase to snake_case with postgres.snake", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: postgres.snake,
      });

      const [row] = await sql`SELECT 1 as userId, 'Charlie' as firstName`;
      expect(row).toEqual({
        user_id: 1,
        first_name: "Charlie",
      });
    });

    test("Custom column transform function", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: {
          column: (col: string) => col.toUpperCase(),
        },
      });

      const [row] = await sql`SELECT 1 as user_id, 'Dave' as first_name`;
      expect(row).toEqual({
        USER_ID: 1,
        FIRST_NAME: "Dave",
      });
    });

    test("SQLHelper INSERT with column transform (from camelCase to snake_case)", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: postgres.camel,
      });

      await sql`CREATE TABLE users (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT)`;

      const newUser = { firstName: "Eve", lastName: "Adams" };
      await sql`INSERT INTO users ${sql(newUser)}`;

      const [retrieved] = await sql`SELECT first_name, last_name FROM users WHERE id = 1`;
      expect(retrieved).toEqual({
        firstName: "Eve",
        lastName: "Adams",
      });
    });

    test("SQLHelper UPDATE with column transform", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: postgres.camel,
      });

      await sql`CREATE TABLE users (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT)`;
      await sql`INSERT INTO users (id, first_name, last_name) VALUES (1, 'Frank', 'Smith')`;

      const updateData = { firstName: "Franklin", lastName: "Smith-Doe" };
      await sql`UPDATE users SET ${sql(updateData)} WHERE id = 1`;

      const [retrieved] = await sql`SELECT first_name, last_name FROM users WHERE id = 1`;
      expect(retrieved).toEqual({
        firstName: "Franklin",
        lastName: "Smith-Doe",
      });
    });

    test("Row transform function", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: {
          column: postgres.camel,
          row: (row: any) => ({ ...row, extraProp: true }),
        },
      });

      const [row] = await sql`SELECT 'Grace' as first_name`;
      expect(row).toEqual({
        firstName: "Grace",
        extraProp: true,
      });
    });

    test("Bidirectional value transform function (value.to and value.from)", async () => {
      await using sql = new SQL({
        adapter: "sqlite",
        filename: ":memory:",
        transform: {
          column: postgres.camel,
          value: {
            to: (val: any) => (typeof val === "string" ? val.toUpperCase() : val),
            from: (val: any) => (typeof val === "string" ? val.toLowerCase() : val),
          },
        },
      });

      await sql`CREATE TABLE notes (id INTEGER PRIMARY KEY, text_content TEXT)`;

      // Write path applies value.from (toLowerCase)
      await sql`INSERT INTO notes ${sql({ textContent: "HELLO WORLD" })}`;

      // Read path applies value.to (toUpperCase)
      const [row] = await sql`SELECT text_content FROM notes WHERE id = 1`;
      expect(row).toEqual({
        textContent: "HELLO WORLD",
      });
    });

    test("Throws error for invalid transform options type", () => {
      expect(() => {
        new SQL({
          adapter: "sqlite",
          filename: ":memory:",
          transform: "invalid" as any,
        });
      }).toThrow();
    });
  });
});
