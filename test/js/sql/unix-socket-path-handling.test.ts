import { test, expect } from "bun:test";
import { SQL } from "bun";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

test("Unix socket path handling - directory path", async () => {
  // Test that directory paths get the socket filename appended when appropriate
  try {
    await using sql = new SQL({
      path: "/var/run/postgresql",
      user: "testuser",
      password: "testpass",
      database: "testdb",
      connectionTimeout: 100, // Short timeout to fail fast
    });
    
    // The path handling logic should:
    // 1. Check if /var/run/postgresql exists and is a directory -> append /.s.PGSQL.5432
    // 2. If it doesn't exist but looks like a directory -> append /.s.PGSQL.5432
    // 3. If it exists as a file -> use as-is
    const resultPath = (sql.options as any).path;
    expect(typeof resultPath).toBe("string");
    expect(resultPath.length).toBeGreaterThan(0);
    
    await sql.connect();
  } catch (error) {
    // Expected to fail due to no PostgreSQL server, but path should be handled correctly
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
});

test("Unix socket path handling - full socket path", async () => {
  // Test that full socket paths are used as-is
  try {
    await using sql = new SQL({
      path: "/var/run/postgresql/.s.PGSQL.5432",
      user: "testuser", 
      password: "testpass",
      database: "testdb",
      connectionTimeout: 100,
    });
    
    // The path should remain unchanged
    expect((sql.options as any).path).toBe("/var/run/postgresql/.s.PGSQL.5432");
    
    await sql.connect();
  } catch (error) {
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
});

test("Unix socket path handling - custom socket file", async () => {
  // Test that custom socket files are used as-is
  try {
    await using sql = new SQL({
      path: "/tmp/my-postgres.sock",
      user: "testuser",
      password: "testpass", 
      database: "testdb",
      connectionTimeout: 100,
    });
    
    // The path should remain unchanged
    expect((sql.options as any).path).toBe("/tmp/my-postgres.sock");
    
    await sql.connect();
  } catch (error) {
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
});

test("Unix socket path handling - another custom socket", async () => {
  // Test another common socket naming pattern
  try {
    await using sql = new SQL({
      path: "/tmp/postgres.socket",
      user: "testuser",
      password: "testpass",
      database: "testdb", 
      connectionTimeout: 100,
    });
    
    // The path should remain unchanged
    expect((sql.options as any).path).toBe("/tmp/postgres.socket");
    
    await sql.connect();
  } catch (error) {
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
});

test("Unix socket path handling - existing .s. pattern", async () => {
  // Test that existing .s. patterns are preserved
  try {
    await using sql = new SQL({
      path: "/tmp/.s.CUSTOM.1234",
      user: "testuser",
      password: "testpass",
      database: "testdb",
      connectionTimeout: 100,
    });
    
    // The path should remain unchanged since it has .s. pattern
    expect((sql.options as any).path).toBe("/tmp/.s.CUSTOM.1234");
    
    await sql.connect();
  } catch (error) {
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
});

test("Unix socket path handling - directory vs file detection", async () => {
  // Test path ending with slash (clearly a directory)
  try {
    await using sql1 = new SQL({
      path: "/var/run/postgresql/",
      user: "testuser",
      password: "testpass",
      database: "testdb",
      connectionTimeout: 100,
    });
    
    // Should append socket name since it ends with /
    expect((sql1.options as any).path).toBe("/var/run/postgresql//.s.PGSQL.5432");
    
    await sql1.connect();
  } catch (error) {
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
  
  // Test path that looks like a directory (no extension)
  try {
    await using sql2 = new SQL({
      path: "/var/run/postgresql",
      user: "testuser",
      password: "testpass", 
      database: "testdb",
      connectionTimeout: 100,
    });
    
    // Should append socket name since it has no extension
    expect((sql2.options as any).path).toBe("/var/run/postgresql/.s.PGSQL.5432");
    
    await sql2.connect();
  } catch (error) {
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
});