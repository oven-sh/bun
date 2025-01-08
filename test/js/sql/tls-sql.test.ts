import { test, expect } from "bun:test";
import { getSecret } from "harness";
import { sql as SQL } from "bun";

const TLS_POSTGRES_DATABASE_URL = getSecret("TLS_POSTGRES_DATABASE_URL");

if (TLS_POSTGRES_DATABASE_URL) {
  test("tls (explicit)", async () => {
    const sql = new SQL({
      url: TLS_POSTGRES_DATABASE_URL!,
      tls: true,
      adapter: "postgresql",
    });

    const [{ one, two }] = await sql`SELECT 1 as one, '2' as two`;
    expect(one).toBe(1);
    expect(two).toBe("2");
  });

  test("tls (implicit)", async () => {
    const [{ one, two }] = await SQL`SELECT 1 as one, '2' as two`;
    expect(one).toBe(1);
    expect(two).toBe("2");
  });
}
