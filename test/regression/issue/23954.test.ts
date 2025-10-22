import { SQL } from "bun";
import { expect, test } from "bun:test";

// Test for issue #23954: Unix socket connection for MySQL
// https://github.com/oven-sh/bun/issues/23954

test("MySQL connection via Unix socket using 'socket' query parameter with localhost", async () => {
  // Skip if socket doesn't exist
  const socketPath = "/var/run/mysqld/mysqld.sock";
  if (!require("fs").existsSync(socketPath)) {
    test.skip();
    return;
  }

  // This should work according to the docs
  // Using localhost as hostname - it will be ignored when socket is provided
  const mysql = new SQL(`mysql://testuser:testpass@localhost/testdb?socket=${socketPath}`);

  try {
    // Try a simple query
    const result = await mysql`SELECT 1 as value`;
    expect(result).toEqual([{ value: 1 }]);
  } finally {
    await mysql.close();
  }
});

test("MySQL connection via Unix socket using 'socket' query parameter without hostname (docs format)", async () => {
  // Skip if socket doesn't exist
  const socketPath = "/var/run/mysqld/mysqld.sock";
  if (!require("fs").existsSync(socketPath)) {
    test.skip();
    return;
  }

  // This is the exact format from the docs: mysql://user:pass@/database?socket=/path
  // The missing hostname should be handled gracefully
  const mysql = new SQL(`mysql://testuser:testpass@/testdb?socket=${socketPath}`);

  try {
    // Try a simple query
    const result = await mysql`SELECT 1 as value`;
    expect(result).toEqual([{ value: 1 }]);
  } finally {
    await mysql.close();
  }
});

test("MySQL connection via Unix socket using path in options object", async () => {
  // Skip if socket doesn't exist
  const socketPath = "/var/run/mysqld/mysqld.sock";
  if (!require("fs").existsSync(socketPath)) {
    test.skip();
    return;
  }

  // This should also work using the options object
  const mysql = new SQL({
    adapter: "mysql",
    username: "testuser",
    password: "testpass",
    database: "testdb",
    path: socketPath,
  });

  try {
    // Try a simple query
    const result = await mysql`SELECT 1 as value`;
    expect(result).toEqual([{ value: 1 }]);
  } finally {
    await mysql.close();
  }
});
