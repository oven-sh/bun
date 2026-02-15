import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

describe("Issue #26369 - SNI hostname not sent when using tls: true with individual connection options", () => {
  test("tls: true with host option should auto-populate serverName", () => {
    const sql = new SQL({
      host: "example-host.neon.tech",
      username: "user",
      password: "pass",
      database: "db",
      tls: true,
      adapter: "postgres",
    });

    // Verify serverName is automatically set from the hostname
    expect(sql.options.tls).toEqual({ serverName: "example-host.neon.tech" });

    sql.close();
  });

  test("tls: true with hostname option should auto-populate serverName", () => {
    const sql = new SQL({
      hostname: "example-host.neon.tech",
      username: "user",
      password: "pass",
      database: "db",
      tls: true,
      adapter: "postgres",
    });

    // Verify serverName is automatically set from the hostname
    expect(sql.options.tls).toEqual({ serverName: "example-host.neon.tech" });

    sql.close();
  });

  test("tls with explicit serverName should preserve it", () => {
    const sql = new SQL({
      host: "example-host.neon.tech",
      username: "user",
      password: "pass",
      database: "db",
      tls: { serverName: "custom-server-name.example.com" },
      adapter: "postgres",
    });

    // Verify explicit serverName is preserved
    expect(sql.options.tls).toEqual({ serverName: "custom-server-name.example.com" });

    sql.close();
  });

  test("URL with sslmode=require should auto-populate serverName", () => {
    const sql = new SQL("postgresql://user:pass@example-host.neon.tech/db?sslmode=require");

    // Verify serverName is automatically set from the URL hostname
    expect(sql.options.tls).toEqual({ serverName: "example-host.neon.tech" });

    sql.close();
  });

  test("URL without sslmode but with tls: true option should auto-populate serverName", () => {
    const sql = new SQL("postgresql://user:pass@example-host.neon.tech/db", {
      tls: true,
    });

    // Verify serverName is automatically set from the URL hostname
    expect(sql.options.tls).toEqual({ serverName: "example-host.neon.tech" });

    sql.close();
  });

  test("tls object with other properties should also get serverName", () => {
    const sql = new SQL({
      host: "example-host.neon.tech",
      username: "user",
      password: "pass",
      database: "db",
      tls: { rejectUnauthorized: false },
      adapter: "postgres",
    });

    // Verify serverName is added alongside existing tls properties
    expect(sql.options.tls).toEqual({
      rejectUnauthorized: false,
      serverName: "example-host.neon.tech",
    });

    sql.close();
  });

  test("no tls option should not set tls in options", () => {
    const sql = new SQL({
      host: "example-host.neon.tech",
      username: "user",
      password: "pass",
      database: "db",
      adapter: "postgres",
    });

    // Verify tls is not set when not explicitly enabled
    expect(sql.options.tls).toBeUndefined();

    sql.close();
  });
});
