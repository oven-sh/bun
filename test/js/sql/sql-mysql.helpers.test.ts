import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "mysql",
  {
    image: "mysql:8",
    env: {
      MYSQL_ROOT_PASSWORD: "bun",
    },
  },
  (port: number) => {
    const options = {
      url: `mysql://root:bun@localhost:${port}`,
      max: 1,
      bigint: true,
    };
    test("insert helper", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
      const result = await sql`SELECT * FROM ${sql(random_name)}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("John");
      expect(result[0].age).toBe(30);
    });
    test("update helper", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
      await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE id = 1`;
      const result = await sql`SELECT * FROM ${sql(random_name)}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("Mary");
      expect(result[0].age).toBe(18);
    });

    test("update helper with IN", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];
      await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

      await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE id IN ${sql([1, 2])}`;
      const result = await sql`SELECT * FROM ${sql(random_name)}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("Mary");
      expect(result[0].age).toBe(18);
      expect(result[1].id).toBe(2);
      expect(result[1].name).toBe("Mary");
      expect(result[1].age).toBe(18);
    });

    test("update helper with IN and column name", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];
      await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

      await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE id IN ${sql(users, "id")}`;
      const result = await sql`SELECT * FROM ${sql(random_name)}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("Mary");
      expect(result[0].age).toBe(18);
      expect(result[1].id).toBe(2);
      expect(result[1].name).toBe("Mary");
      expect(result[1].age).toBe(18);
    });

    test("update multiple values no helper", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
      await sql`UPDATE ${sql(random_name)} SET ${sql("name")} = ${"Mary"}, ${sql("age")} = ${18} WHERE id = 1`;
      const result = await sql`SELECT * FROM ${sql(random_name)} WHERE id = 1`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("Mary");
      expect(result[0].age).toBe(18);
    });

    test("SELECT with IN and NOT IN", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];
      await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

      const result =
        await sql`SELECT * FROM ${sql(random_name)} WHERE id IN ${sql(users, "id")} and id NOT IN ${sql([3, 4, 5])}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("John");
      expect(result[0].age).toBe(30);
      expect(result[1].id).toBe(2);
      expect(result[1].name).toBe("Jane");
      expect(result[1].age).toBe(25);
    });

    test("syntax error", async () => {
      await using sql = new SQL({ ...options, max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];

      expect(() => sql`DELETE FROM ${sql(random_name)} ${sql(users, "id")}`.execute()).toThrow(SyntaxError);
    });
  },
);
