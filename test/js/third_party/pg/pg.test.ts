import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";
import { Client, Pool } from "pg";
import { parse } from "pg-connection-string";

const databaseUrl = getSecret("TLS_POSTGRES_DATABASE_URL");

// Function to insert 1000 users
async function insertUsers(client: Client) {
  // Generate an array of users
  const users = Array.from({ length: 300 }, (_, i) => ({
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    age: Math.floor(Math.random() * 50) + 20, // Random age between 20 and 70
  }));

  // Prepare the query to insert multiple rows
  const insertQuery = `
    INSERT INTO pg_users (name, email, age)
    VALUES ${users.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(", ")};
  `;

  // Flatten the users array for parameterized query
  const values = users.flatMap(user => [user.name, user.email, user.age]);

  await client.query(insertQuery, values);
}

async function connect() {
  const client = new Client({
    connectionString: databaseUrl!,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect().then(() => {
    // Define the SQL query to create a table
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS pg_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        age INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Execute the query
    return client.query(createTableQuery);
  });
  // check if we need to populate the data
  const { rows } = await client.query("SELECT COUNT(*) AS count FROM pg_users");
  const userCount = Number.parseInt(rows[0].count, 10);
  if (userCount === 0) await insertUsers(client);
  return client;
}

describe.skipIf(!databaseUrl)("pg", () => {
  test("should connect using TLS", async () => {
    const pool = new Pool(parse(databaseUrl!));
    try {
      const { rows } = await pool.query("SELECT version()", []);
      const [{ version }] = rows;

      expect(version).toMatch(/PostgreSQL/);
    } finally {
      pool.end();
    }
  });

  test("should execute big query and end connection", async () => {
    const client = await connect();
    const res = await client.query(`SELECT * FROM pg_users LIMIT 300`);
    expect(res.rows.length).toBe(300);
    await client.end();
  }, 20_000);
});
