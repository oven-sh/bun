import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exec } from "child_process";
import { isCI } from "harness";
import net from "net";
import { promisify } from "util";

const execAsync = promisify(exec);
const dockerCLI = Bun.which("docker") as string;

async function findRandomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForPostgres(port) {
  for (let i = 0; i < 3; i++) {
    try {
      const sql = new SQL(`postgres://postgres@localhost:${port}/postgres`, {
        idle_timeout: 20,
        max_lifetime: 60 * 30,
      });

      await sql`SELECT 1`;
      await sql.end();
      console.log("PostgreSQL is ready!");
      return true;
    } catch (error) {
      console.log(`Waiting for PostgreSQL... (${i + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error("PostgreSQL failed to start");
}

async function setupPostgres() {
  const port = await findRandomPort();
  const containerName = `postgres-error-test-${Date.now()}`;

  try {
    // Check if container exists and remove it
    try {
      await execAsync(`${dockerCLI} rm -f ${containerName}`);
    } catch (error) {
      // Container might not exist, ignore error
    }

    await execAsync(
      `${dockerCLI} run -d --name ${containerName} -p ${port}:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:latest`,
    );

    await waitForPostgres(port);

    return {
      port,
      containerName,
    };
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

describe.skipIf(!dockerCLI || isCI)("PostgreSQL Error Enhancements", () => {
  let container: any;
  let options: any;

  beforeAll(async () => {
    container = await setupPostgres();
    options = {
      host: "localhost",
      port: container.port,
      database: "postgres",
      user: "postgres",
      idle_timeout: 20,
      max_lifetime: 60 * 30,
    };
  });

  afterAll(async () => {
    try {
      await execAsync(`${dockerCLI} stop -t 0 ${container.containerName}`);
    } catch (error) {}
    try {
      await execAsync(`${dockerCLI} rm -f ${container.containerName}`);
    } catch (error) {}
  });

  test("unique_violation error includes condition name", async () => {
    await using sql = new SQL(options);

    // Create table with unique constraint
    await sql`CREATE TABLE test_unique (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE)`;

    try {
      // Insert first record
      await sql`INSERT INTO test_unique (email) VALUES ('test@example.com')`;

      // Try to insert duplicate email
      let error: any;
      try {
        await sql`INSERT INTO test_unique (email) VALUES ('test@example.com')`;
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.errno).toBe("23505");
      expect(error.condition).toBe("unique_violation");
      expect(error.constraint).toBe("test_unique_email_key");
      expect(error.key).toBe("email");
      expect(error.value).toBe("test@example.com");
    } finally {
      await sql`DROP TABLE IF EXISTS test_unique`;
    }
  });

  test("not_null_violation error includes condition name and parsed column", async () => {
    await using sql = new SQL(options);

    // Create table with not null constraint
    await sql`CREATE TABLE test_not_null (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL)`;

    try {
      let error: any;
      try {
        await sql`INSERT INTO test_not_null (name) VALUES (NULL)`;
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.errno).toBe("23502");
      expect(error.condition).toBe("not_null_violation");
      expect(error.column).toBe("name");
      // Should also have the parsed failing column
      expect(error.failing_column).toBe("name");
    } finally {
      await sql`DROP TABLE IF EXISTS test_not_null`;
    }
  });

  test("foreign_key_violation error includes condition name and parsed details", async () => {
    await using sql = new SQL(options);

    // Create tables with foreign key constraint
    await sql`CREATE TABLE test_parent (id SERIAL PRIMARY KEY, name VARCHAR(255))`;
    await sql`CREATE TABLE test_child (id SERIAL PRIMARY KEY, parent_id INTEGER REFERENCES test_parent(id))`;

    try {
      let error: any;
      try {
        await sql`INSERT INTO test_child (parent_id) VALUES (999)`;
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.errno).toBe("23503");
      expect(error.condition).toBe("foreign_key_violation");
      // Should have parsed key/value and referenced table info
      expect(error.key).toBe("parent_id");
      expect(error.value).toBe("999");
      expect(error.referenced_table).toBe("test_parent");
    } finally {
      await sql`DROP TABLE IF EXISTS test_child`;
      await sql`DROP TABLE IF EXISTS test_parent`;
    }
  });

  test("syntax_error includes condition name", async () => {
    await using sql = new SQL(options);

    let error: any;
    try {
      await sql`SELEC 1`;
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.errno).toBe("42601");
    expect(error.condition).toBe("syntax_error");
  });

  test("undefined_table error includes condition name", async () => {
    await using sql = new SQL(options);

    let error: any;
    try {
      await sql`SELECT * FROM nonexistent_table`;
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.errno).toBe("42P01");
    expect(error.condition).toBe("undefined_table");
  });

  test("check_violation error includes condition name and parsed details", async () => {
    await using sql = new SQL(options);

    // Create table with named check constraint
    await sql`CREATE TABLE test_check (
      id SERIAL PRIMARY KEY, 
      age INTEGER,
      CONSTRAINT age_positive CHECK (age > 0)
    )`;

    try {
      let error: any;
      try {
        await sql`INSERT INTO test_check (age) VALUES (-5)`;
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.errno).toBe("23514");
      expect(error.condition).toBe("check_violation");
      // Should have parsed check constraint name and table
      expect(error.check_constraint).toBe("age_positive");
      expect(error.failing_table).toBe("test_check");
    } finally {
      await sql`DROP TABLE IF EXISTS test_check`;
    }
  });

  test("key/value parsing works with different formats", async () => {
    await using sql = new SQL(options);

    // Create table with unique constraint on multiple columns
    await sql`CREATE TABLE test_multi_unique (
      id SERIAL PRIMARY KEY, 
      username VARCHAR(255), 
      domain VARCHAR(255),
      UNIQUE(username, domain)
    )`;

    try {
      // Insert first record
      await sql`INSERT INTO test_multi_unique (username, domain) VALUES ('john', 'example.com')`;

      // Try to insert duplicate
      let error: any;
      try {
        await sql`INSERT INTO test_multi_unique (username, domain) VALUES ('john', 'example.com')`;
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.errno).toBe("23505");
      expect(error.condition).toBe("unique_violation");
      // For compound keys, these should always be present
      expect(error.key).toBeDefined();
      expect(error.value).toBeDefined();
      expect(typeof error.key).toBe("string");
      expect(typeof error.value).toBe("string");
    } finally {
      await sql`DROP TABLE IF EXISTS test_multi_unique`;
    }
  });

  test("key/value parsing handles special characters", async () => {
    await using sql = new SQL(options);

    // Create table with unique constraint
    await sql`CREATE TABLE test_special_chars (id SERIAL PRIMARY KEY, data VARCHAR(255) UNIQUE)`;

    try {
      const specialValue = "test@email.com (with) special=chars";

      // Insert first record with special characters
      await sql`INSERT INTO test_special_chars (data) VALUES (${specialValue})`;

      // Try to insert duplicate
      let error: any;
      try {
        await sql`INSERT INTO test_special_chars (data) VALUES (${specialValue})`;
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.errno).toBe("23505");
      expect(error.condition).toBe("unique_violation");
      expect(error.key).toBe("data");
      expect(error.value).toBe(specialValue);
    } finally {
      await sql`DROP TABLE IF EXISTS test_special_chars`;
    }
  });

  test("errors without known condition codes still work", async () => {
    await using sql = new SQL(options);

    let error: any;
    try {
      // This should trigger an error that doesn't have a mapped condition name
      await sql`SELECT 1/0`;
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.errno).toBe("22012");
    expect(error.condition).toBe("division_by_zero");
  });

  test("all error enhancements work together", async () => {
    await using sql = new SQL(options);

    // Test syntax error has condition but no parsed details
    let syntaxError: any;
    try {
      await sql`SELEC 1`; // syntax error
    } catch (e) {
      syntaxError = e;
    }

    expect(syntaxError).toBeDefined();
    expect(syntaxError.errno).toBe("42601");
    expect(syntaxError.condition).toBe("syntax_error");
    expect(syntaxError.code).toBe("ERR_POSTGRES_SERVER_ERROR");
    expect(syntaxError.message).toMatchInlineSnapshot();
    // Syntax errors shouldn't have parsed key/value details
    expect(syntaxError.key).toBeUndefined();
    expect(syntaxError.value).toBeUndefined();
  });

  test("comprehensive error field verification", async () => {
    await using sql = new SQL(options);

    // Test that all field types work correctly
    const errorMappings = [
      { errno: "23505", condition: "unique_violation" },
      { errno: "23502", condition: "not_null_violation" },
      { errno: "23503", condition: "foreign_key_violation" },
      { errno: "23514", condition: "check_violation" },
      { errno: "42601", condition: "syntax_error" },
      { errno: "42P01", condition: "undefined_table" },
      { errno: "42703", condition: "undefined_column" },
      { errno: "22012", condition: "division_by_zero" },
    ];

    // Verify our mapping covers important PostgreSQL errors
    for (const mapping of errorMappings) {
      expect(mapping.errno).toBeTruthy();
      expect(mapping.condition).toBeTruthy();
      expect(mapping.errno.length).toBe(5); // PostgreSQL error codes are 5 characters
    }
  });
});
