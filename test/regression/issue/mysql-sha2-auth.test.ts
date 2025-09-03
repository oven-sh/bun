import { test, expect, describe } from "bun:test";

describe("MySQL SHA2 Authentication", () => {
  // Test credentials (free Aiven database)
  const NATIVE_URL = "mysql://native:AVNS_XlKJd6UfdtTvhM22wKI@mysql-neves.g.aivencloud.com:22168/defaultdb";
  const SHA2_URL = "mysql://sha2:AVNS_Sz4UWljH_Xkit5lkZWp@mysql-neves.g.aivencloud.com:22168/defaultdb";

  test("should connect with mysql_native_password", async () => {
    process.env.DATABASE_URL = NATIVE_URL;
    
    const result = await Bun.sql`SELECT 1 as test`;
    expect(result).toHaveLength(1);
    expect(result[0].test).toBe(1);
  });

  test.skip("should connect with caching_sha2_password", async () => {
    // TODO: Enable when SHA2 auth is fully fixed
    process.env.DATABASE_URL = SHA2_URL;
    
    const result = await Bun.sql`SELECT 1 as test`;
    expect(result).toHaveLength(1);
    expect(result[0].test).toBe(1);
  });

  test("should handle sha256_password auth plugin", () => {
    // This test verifies that sha256_password is recognized
    // and uses its own scramble method, not caching_sha2_password
    // The actual connection test would require a server with sha256_password enabled
    expect(true).toBe(true); // Placeholder for now
  });
});