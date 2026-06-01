import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

// Native createInstance argument validation shared between the MySQL and
// Postgres drivers (src/sql_jsc/shared/connection_args.rs / query_args.rs).
// Every error here is thrown by the native parser before any socket is
// created, so no server (and no docker) is needed — the address below is
// never dialed. The Postgres-adapter twin of this suite lives in sql.test.ts.
describe("shared createInstance validation (no server)", () => {
  const base = { adapter: "mysql", hostname: "127.0.0.1", port: 1, max: 1 } as const;

  // Connection parameters are written into the NUL-delimited MySQL handshake,
  // so a NUL byte would inject extra fields; the native parser must refuse
  // them before connecting.
  test.concurrent.each(["username", "password", "database"] as const)(
    "rejects %s containing null bytes",
    async field => {
      await using sql = new SQL({ ...base, username: "u", [field]: "a\0b" });
      // `Query` is a lazy thenable, so collect the rejection explicitly.
      const err: any = await sql`select 1`.then(
        () => null,
        e => e,
      );
      expect(err?.message).toBe(`${field} must not contain null bytes`);
    },
  );

  test.concurrent("rejects tls that is neither a boolean nor an object", async () => {
    // A truthy non-boolean/non-object upgrades sslMode to `require` in JS and
    // reaches the native parser as-is.
    await using sql = new SQL({ ...base, username: "u", tls: 1 as any });
    const err: any = await sql`select 1`.then(
      () => null,
      e => e,
    );
    expect(err?.message).toBe("tls must be a boolean or an object");
  });

  test.concurrent("rejects simple queries with parameters", async () => {
    await using sql = new SQL({ ...base, username: "u" });
    // Query-handle creation fails before the pool ever connects.
    const err: any = await sql
      .unsafe("select ?", [1])
      .simple()
      .then(
        () => null,
        e => e,
      );
    expect(err?.message).toBe("simple query cannot have parameters");
  });
});
