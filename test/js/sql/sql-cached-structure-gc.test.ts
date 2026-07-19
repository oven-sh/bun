// Each prepared statement caches a JSC::Structure for shaping result rows. That
// Structure used to be held by a per-statement Strong handle, so N distinct
// prepared statements on one connection meant N permanent GC roots for the
// connection's lifetime. Now the Structure is traced from the Connection
// wrapper's visitChildren (via an internal JSArray slot) instead of a Strong,
// so preparing many statements does not grow the VM's protected-object set.
//
// Simple / prepare:false queries allocate a fresh statement per execution and
// so must NOT register with the connection's array (it would grow without
// bound); they keep the short-lived per-statement Strong instead.

import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

function protectedStructures(): number {
  return heapStats().protectedObjectTypeCounts.Structure || 0;
}

function liveStructures(): number {
  return heapStats().objectTypeCounts.Structure || 0;
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("named prepared statements: result-row Structures are traced from the connection, not Strong-held", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

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

  test("simple and prepare:false queries do not pin Structures on the connection", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });
    await using sqlNoPrepare = new SQL({ url: url(), max: 1, prepare: false });

    await sql`SELECT 1 AS warmup`.simple();
    await sqlNoPrepare`SELECT ${1} AS warmup`;

    Bun.gc(true);
    const before = liveStructures();

    const N = 30;
    for (let i = 0; i < N; i++) {
      const simple = await sql.unsafe(`SELECT 1 AS s${i}`);
      expect(simple).toEqual([{ [`s${i}`]: 1 }]);
      const unnamed = await sqlNoPrepare.unsafe(`SELECT $1::int AS u${i}`, [i]);
      expect(unnamed).toEqual([{ [`u${i}`]: i }]);
    }

    Bun.gc(true);
    Bun.gc(true);
    const after = liveStructures();

    // Per-query statements are dropped when each query completes, so the
    // Structures they built must be collectible. Registering them on the
    // connection's array would leak 2*N here; with the per-query Strong path
    // they are released on query drop and collected.
    expect(after - before).toBeLessThan(N);
  });
});

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  const url = () => `mysql://root@${container.host}:${container.port}/bun_sql_test`;

  test("named prepared statements: result-row Structures are traced from the connection, not Strong-held", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

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

  test("simple queries do not pin Structures on the connection", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    await sql`SELECT 1 AS warmup`.simple();

    Bun.gc(true);
    const before = liveStructures();

    const N = 30;
    for (let i = 0; i < N; i++) {
      const simple = await sql.unsafe(`SELECT 1 AS s${i}`);
      expect(simple).toEqual([{ [`s${i}`]: 1 }]);
    }

    Bun.gc(true);
    Bun.gc(true);
    const after = liveStructures();

    expect(after - before).toBeLessThan(N);
  });
});
