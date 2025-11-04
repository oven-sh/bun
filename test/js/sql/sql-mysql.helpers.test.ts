import { SQL, randomUUIDv7 } from "bun";
import { beforeEach, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "mysql",
  {
    image: "mysql_plain",
    env: {},
    concurrent: true,
    args: [],
  },
  container => {
    // Use a getter to avoid reading port/host at define time
    const getOptions = () => ({
      url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      bigint: true,
    });

    beforeEach(async () => {
      await container.ready;
    });

    test("insert helper", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
      const result = await sql`SELECT * FROM ${sql(random_name)}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("John");
      expect(result[0].age).toBe(30);
    });

    test("insert into with select helper with IN", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      {
        await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
        const result = await sql`SELECT * FROM ${sql(random_name)}`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("John");
        expect(result[0].age).toBe(30);
      }
      await sql`CREATE TEMPORARY TABLE ${sql(random_name + "2")} (id int, name text, age int)`;
      {
        await sql`INSERT INTO ${sql(random_name + "2")} (id, name, age) SELECT id, name, age FROM ${sql(random_name)} WHERE id IN ${sql([1, 2])}`;
        const result = await sql`SELECT * FROM ${sql(random_name + "2")}`;
        expect(result[0].id).toBe(1);
        expect(result[0].name).toBe("John");
        expect(result[0].age).toBe(30);
      }
    });

    test("select helper with IN using fragment", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      await sql`INSERT INTO ${sql(random_name)} ${sql({ id: 1, name: "John", age: 30 })}`;
      const fragment = sql`id IN ${sql([1, 2])}`;
      const result = await sql`SELECT * FROM ${sql(random_name)} WHERE ${fragment}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("John");
      expect(result[0].age).toBe(30);
    });

    test("update helper", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
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
      await using sql = new SQL({ ...getOptions(), max: 1 });
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

    test("update helper with AND IN", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];
      await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

      await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: 18 })} WHERE 1=1 AND id IN ${sql([1, 2])}`;
      const result = await sql`SELECT * FROM ${sql(random_name)}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("Mary");
      expect(result[0].age).toBe(18);
      expect(result[1].id).toBe(2);
      expect(result[1].name).toBe("Mary");
      expect(result[1].age).toBe(18);
    });

    test("update helper with undefined values", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];
      await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

      await sql`UPDATE ${sql(random_name)} SET ${sql({ name: "Mary", age: undefined })} WHERE id IN ${sql([1, 2])}`;
      const result = await sql`SELECT * FROM ${sql(random_name)}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("Mary");
      expect(result[0].age).toBe(30);
      expect(result[1].id).toBe(2);
      expect(result[1].name).toBe("Mary");
      expect(result[1].age).toBe(25);
    });
    test("update helper that starts with undefined values", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];
      await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

      await sql`UPDATE ${sql(random_name)} SET ${sql({ name: undefined, age: 19 })} WHERE id IN ${sql([1, 2])}`;
      const result = await sql`SELECT * FROM ${sql(random_name)}`;
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("John");
      expect(result[0].age).toBe(19);
      expect(result[1].id).toBe(2);
      expect(result[1].name).toBe("Jane");
      expect(result[1].age).toBe(19);
    });

    test("update helper with undefined values and no columns", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`CREATE TEMPORARY TABLE ${sql(random_name)} (id int, name text, age int)`;
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];
      await sql`INSERT INTO ${sql(random_name)} ${sql(users)}`;

      try {
        await sql`UPDATE ${sql(random_name)} SET ${sql({ name: undefined, age: undefined })} WHERE id IN ${sql([1, 2])}`;
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(SyntaxError);
        expect(e.message).toBe("Update needs to have at least one column");
      }
    });

    test("upsert helper", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      await sql`
      CREATE TABLE IF NOT EXISTS ${sql(random_name)} (
          id int PRIMARY KEY,
          foo text NOT NULL,
          email VARCHAR(255) NOT NULL UNIQUE
      )
    `;

      const data = { id: 1, foo: "hello", email: "bunny@bun.com" };
      await sql`
      INSERT INTO ${sql(random_name)} ${sql(data)}
      ON DUPLICATE KEY UPDATE ${sql(data)}
    `;
      let id = 0;
      {
        const result = await sql`SELECT * FROM ${sql(random_name)}`;
        expect(result[0].id).toBeDefined();
        expect(result[0].foo).toBe("hello");
        expect(result[0].email).toBe("bunny@bun.com");
        id = result.lastInsertRowid;
      }

      {
        const data = { foo: "hello2", email: "bunny2@bun.com" };
        await sql`
      INSERT INTO ${sql(random_name)} ${sql({ id, ...data })}
      ON DUPLICATE KEY UPDATE ${sql(data)}
    `;
        const result = await sql`SELECT * FROM ${sql(random_name)}`;
        expect(result[0].id).toBeDefined();
        expect(result[0].foo).toBe("hello2");
        expect(result[0].email).toBe("bunny2@bun.com");
      }

      {
        const data = { foo: "hello3", email: "bunny2@bun.com" };
        await sql`
      INSERT INTO ${sql(random_name)} ${sql({ id, ...data })}
      ON DUPLICATE KEY UPDATE ${sql(data)}
    `;
        const result = await sql`SELECT * FROM ${sql(random_name)}`;
        expect(result[0].id).toBeDefined();
        expect(result[0].foo).toBe("hello3");
        expect(result[0].email).toBe("bunny2@bun.com");
      }
    });
    test("update helper with IN and column name", async () => {
      await using sql = new SQL({ ...getOptions(), max: 1 });
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
      await using sql = new SQL({ ...getOptions(), max: 1 });
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
      await using sql = new SQL({ ...getOptions(), max: 1 });
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
      await using sql = new SQL({ ...getOptions(), max: 1 });
      const random_name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
      const users = [
        { id: 1, name: "John", age: 30 },
        { id: 2, name: "Jane", age: 25 },
      ];

      expect(() => sql`DELETE FROM ${sql(random_name)} ${sql(users, "id")}`.execute()).toThrow(SyntaxError);
    });
  },
);
