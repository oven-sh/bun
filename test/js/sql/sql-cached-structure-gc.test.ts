// Each prepared statement caches a JSC::Structure for shaping result rows. That
// Structure used to be held by a per-statement Strong handle, so N distinct
// prepared statements on one connection meant N permanent GC roots for the
// connection's lifetime. Now the Structure is traced from the Connection
// wrapper's visitChildren (via an internal JSArray slot) instead of a Strong,
// so preparing many statements does not grow the VM's protected-object set.

import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

function protectedStructures(): number {
  return heapStats().protectedObjectTypeCounts.Structure || 0;
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test("result-row Structures are traced from the connection, not Strong-held", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

    // Warm up so any one-time Structures (e.g. for the pool's internal queries)
    // are already accounted for in the baseline.
    await sql`SELECT 1 AS warmup`;

    Bun.gc(true);
    const before = protectedStructures();

    // Each iteration has a distinct column name, so it produces a distinct
    // prepared statement and a distinct cached row Structure.
    const N = 30;
    for (let i = 0; i < N; i++) {
      const rows = await sql.unsafe(`SELECT $1::int AS c${i}`, [i]);
      expect(rows).toEqual([{ [`c${i}`]: i }]);
    }

    Bun.gc(true);
    const after = protectedStructures();

    // Previously: after - before == N (one Strong per statement).
    // Now: the Structures are owned by the Connection's cachedStructures array
    // and are reachable via visitChildren, not the HandleSet, so the protected
    // count is unchanged. Allow a small slack for unrelated Strongs.
    expect(after - before).toBeLessThan(10);

    // Re-running a query that hits the cache still shapes rows correctly after
    // a full GC, proving the cached Structure is still alive.
    const reused = await sql.unsafe(`SELECT $1::int AS c0`, [0]);
    expect(reused).toEqual([{ c0: 0 }]);
  });
});

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  test("result-row Structures are traced from the connection, not Strong-held", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

    await sql`SELECT 1 AS warmup`;

    Bun.gc(true);
    const before = protectedStructures();

    const N = 30;
    for (let i = 0; i < N; i++) {
      const rows = await sql.unsafe(`SELECT ? AS c${i}`, [i]);
      expect(rows).toEqual([{ [`c${i}`]: i }]);
    }

    Bun.gc(true);
    const after = protectedStructures();

    expect(after - before).toBeLessThan(10);

    const reused = await sql.unsafe(`SELECT ? AS c0`, [0]);
    expect(reused).toEqual([{ c0: 0 }]);
  });
});
