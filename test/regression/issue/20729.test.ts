import { test, expect } from "bun:test";
import { SQL } from "bun";

test("SQL unix socket path handling", async () => {
  // This test reproduces the issue reported in #20729
  // The issue is that when providing a path like "/var/run/postgresql",
  // it gets transformed to "/var/run/postgresql/.s.PGSQL.5432" which may not exist
  
  try {
    // This should fail with a connection error, but not with ERR_POSTGRES_CONNECTION_CLOSED
    // which indicates a socket creation/handshake issue
    await using sql = new SQL({
      path: "/var/run/postgresql",
      user: "bun",
      password: "bun",
      database: "bun",
      connectionTimeout: 1, // 1 second timeout to fail fast
    });

    const res = await sql`SELECT 1`;
    // If this succeeds, the socket exists and works
    expect(res).toBeDefined();
  } catch (error) {
    // We expect this to fail because the socket probably doesn't exist
    // But the error should be about connection failure, not about a closed connection
    console.log("Error code:", error.code);
    console.log("Error message:", error.message);
    
    // The specific error from the issue report
    if (error.code === "ERR_POSTGRES_CONNECTION_CLOSED") {
      throw new Error("Got ERR_POSTGRES_CONNECTION_CLOSED - this indicates the socket connection issue is still present");
    }
    
    // Expected errors would be things like file not found, connection refused, etc.
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
});

test("SQL unix socket path handling with full socket path", async () => {
  // Test with the full socket path
  try {
    await using sql = new SQL({
      path: "/var/run/postgresql/.s.PGSQL.5432",
      user: "bun", 
      password: "bun",
      database: "bun",
      connectionTimeout: 1,
    });

    const res = await sql`SELECT 1`;
    expect(res).toBeDefined();
  } catch (error) {
    console.log("Full path error code:", error.code);
    console.log("Full path error message:", error.message);
    
    // Same expectation - should not get connection closed error
    expect(error.code).not.toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  }
});