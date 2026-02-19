// https://github.com/oven-sh/bun/issues/1332
// SQLite schema cache not invalidated for external changes
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("schema changes by external process are detected", async () => {
  using dir = tempDir("sqlite-schema-cache", {});
  const dbPath = join(String(dir), "test.sqlite");

  // Create database and initial schema
  const db = new Database(dbPath);
  db.run("pragma journal_mode = wal");
  db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)");
  db.run("INSERT INTO foo (greeting) VALUES (?)", "Hello");

  // Create a prepared statement and execute it - this caches the column names
  const query = db.query("SELECT * FROM foo");
  const result1 = query.get();
  expect(result1).toEqual({ id: 1, greeting: "Hello" });

  // Run another process to rename the column
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Database } = require("bun:sqlite");
      const db = new Database(${JSON.stringify(dbPath)});
      db.run("ALTER TABLE foo RENAME COLUMN greeting TO greeting2");
      db.close();
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.error("External process failed:", stderr);
  }
  expect(exitCode).toBe(0);

  // Execute the same prepared statement again - should detect schema change
  const result2 = query.get();

  // The result should now have the new column name "greeting2" instead of "greeting"
  expect(result2).toHaveProperty("greeting2");
  expect(result2).not.toHaveProperty("greeting");
  expect(result2).toEqual({ id: 1, greeting2: "Hello" });

  db.close();
});

test("schema changes by same connection are detected", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT)");
  db.run("INSERT INTO foo (name) VALUES (?)", "Alice");

  const query = db.query("SELECT * FROM foo");
  const result1 = query.get();
  expect(result1).toEqual({ id: 1, name: "Alice" });

  // Rename column in same connection
  db.run("ALTER TABLE foo RENAME COLUMN name TO username");

  // The query should pick up the new column name
  const result2 = query.get();
  expect(result2).toHaveProperty("username");
  expect(result2).not.toHaveProperty("name");
  expect(result2).toEqual({ id: 1, username: "Alice" });

  db.close();
});
