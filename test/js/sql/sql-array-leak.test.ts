// Regression test for the postgres array-column decode leak in
// src/sql/postgres/DataCell.zig:parseArray(). The returned .array
// SQLDataCell defaulted to free_value = 0, so SQLDataCell.deinit()
// early-returned and leaked the heap SQLDataCell[] buffer plus every
// cloned WTF::StringImpl child per row per array column.
//
// Kept separate from sql.test.ts so it can fall back to a local
// postgres when docker isn't available.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { isDockerEnabled } from "harness";

async function resolvePostgresURL(): Promise<string | undefined> {
  if (isDockerEnabled()) {
    const { ensure } = await import("../../docker/index.ts");
    const info = await ensure("postgres_plain");
    return `postgres://bun_sql_test@${info.host}:${info.ports[5432]}/bun_sql_test`;
  }
  // Fall back to a directly reachable postgres (e.g. the one started by
  // /opt/start-services.sh in environments without nested docker).
  for (const candidate of [process.env.DATABASE_URL, "postgres://postgres@localhost:5432/postgres"]) {
    if (!candidate) continue;
    const probe = new SQL(candidate, { max: 1, idleTimeout: 1, connectionTimeout: 2 });
    try {
      await probe`SELECT 1`;
      return candidate;
    } catch {
    } finally {
      await probe.end().catch(() => {});
    }
  }
  return undefined;
}

const url = await resolvePostgresURL();

if (!url) {
  describe.todo("postgres array column result does not leak decoded cells (no postgres available)");
} else {
  describe("postgres array column leak", () => {
    test("array column result does not leak decoded cells", async () => {
      await using sql = new SQL(url, { max: 1 });

      // warm up: prepared statement cache, connection buffers, JIT
      for (let i = 0; i < 32; i++) {
        await sql`SELECT array_agg(repeat('x', 1024)) AS tags FROM generate_series(1, 64)`;
      }
      Bun.gc(true);
      const rss = process.memoryUsage.rss();

      for (let i = 0; i < 3000; i++) {
        const rows = await sql`SELECT array_agg(repeat('x', 1024)) AS tags FROM generate_series(1, 64)`;
        expect(rows[0].tags.length).toBe(64);
      }

      Bun.gc(true);
      const after = process.memoryUsage.rss();
      const deltaMB = (after - rss) / 1024 / 1024;
      console.log({ after, rss, deltaMB });
      // Without the fix each row leaks ~64KB of cloned strings plus the
      // SQLDataCell[] buffer; 3000 rows leak well over 200MB. With the fix
      // the ASAN debug build settles around ~70MB of JSC/ASAN overhead.
      expect(deltaMB).toBeLessThan(150);
    }, 120_000);
  });
}
