// https://github.com/oven-sh/bun/issues/28911
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { isASAN } from "harness";

const cacheCountSymbol = Symbol.for("Bun.Database.cache.count");

// Build a SELECT ... IN (...) large enough to exceed the per-entry cap.
// Each literal is 19 bytes; 10k literals ≈ 190 KB of SQL text.
const buildBigInClause = (n: number) =>
  Array.from({ length: n }, (_, i) => `'${i.toString(16).padStart(16, "0")}'`).join(",");

test("large dynamic queries do not fill the query cache (#28911)", () => {
  using db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, template_id TEXT)");

  const baseSql = `SELECT id FROM t WHERE template_id IN (${buildBigInClause(10_000)}) LIMIT 1`;
  expect(baseSql.length).toBeGreaterThan(Database.MAX_QUERY_CACHE_ENTRY_BYTES);

  // Each iteration differs only in a trailing comment, so the cache key never matches.
  for (let i = 0; i < 25; i++) {
    const stmt = db.query(`${baseSql} /*iter=${i}*/`);
    stmt.all();
    stmt.finalize();
  }

  expect(db[cacheCountSymbol]).toBe(0);
});

test("small queries still populate the query cache", () => {
  using db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("INSERT INTO t (name) VALUES ('a'), ('b'), ('c')");

  // Same SQL text reuses one slot, regardless of call count.
  for (let i = 0; i < 5; i++) {
    expect(db.query("SELECT * FROM t WHERE name = ?").all("a")).toEqual([{ id: 1, name: "a" }]);
  }
  expect(db[cacheCountSymbol]).toBe(1);

  for (let i = 0; i < 5; i++) {
    db.query(`SELECT ${i} AS x, id FROM t WHERE id = ?`).all(1);
  }
  expect(db[cacheCountSymbol]).toBe(6);
});

test("query cache FIFO-evicts the oldest entry once the count cap is reached (#28911)", () => {
  // Explicit db.close() (default lenient = sqlite3_close_v2) rather than
  // `using db`: the test intentionally holds a Statement reference past
  // cache eviction, which would trip strict close.
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.exec("INSERT INTO t (id) VALUES (0), (1), (2)");
    const max = Database.MAX_QUERY_CACHE_SIZE;

    // Fill the cache, keeping a reference to the oldest entry.
    const oldestStmt = db.query(`SELECT 0 AS x, id FROM t`);
    oldestStmt.all();
    for (let i = 1; i < max; i++) {
      db.query(`SELECT ${i} AS x, id FROM t`).all();
    }
    expect(db[cacheCountSymbol]).toBe(max);

    // Insert more distinct queries than the cap — FIFO evicts the oldest.
    for (let i = max; i < max + 10; i++) {
      db.query(`SELECT ${i} AS x, id FROM t`).all();
    }
    expect(db[cacheCountSymbol]).toBe(max);

    // Evicted Statement stays usable via the held caller reference.
    expect(oldestStmt.isFinalized).toBe(false);
    expect(oldestStmt.all()).toEqual([
      { x: 0, id: 0 },
      { x: 0, id: 1 },
      { x: 0, id: 2 },
    ]);

    // Re-querying the oldest SQL prepares a fresh Statement.
    const afterEviction = db.query(`SELECT 0 AS x, id FROM t`);
    expect(afterEviction).not.toBe(oldestStmt);
    expect(oldestStmt.isFinalized).toBe(false);
    expect(oldestStmt.all()).toHaveLength(3);
  } finally {
    db.close();
  }
});

test("synchronous loop of large dynamic queries does not pin memory (#28911)", async () => {
  // The exact repro from the issue: a synchronous loop that throws away
  // each Statement without finalize(). Inside one JS job, queries above
  // MAX_QUERY_CACHE_ENTRY_BYTES must NOT be retained by the database —
  // neither by the cache (excluded by the byte cap) nor by any weak-ref
  // book-keeping (WeakRef targets are KeptAlive until the next job
  // boundary, so tracking uncached Statements would pin them all for the
  // entire loop and re-create the OOM in a different shape).
  //
  // Explicit db.close() (lenient sqlite3_close_v2) rather than `using db`
  // (strict sqlite3_close): the loop creates 30 uncached sqlite3_stmt
  // handles whose finalization depends on GC collecting the JS wrappers,
  // and JSC's conservative stack scanning can keep one alive across the
  // GC boundary (more likely under ASAN/debug). Strict close would then
  // trip SQLITE_BUSY for a reason unrelated to the RSS assertion.
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, template_id TEXT)");
    // ~190 KB of SQL text per iteration, similar shape to the repro.
    const baseSql = `SELECT id FROM t WHERE template_id IN (${buildBigInClause(10_000)}) LIMIT 1`;
    expect(baseSql.length).toBeGreaterThan(Database.MAX_QUERY_CACHE_ENTRY_BYTES);

    Bun.gc(true);
    const startRss = process.memoryUsage.rss();
    for (let i = 0; i < 30; i++) {
      db.query(`${baseSql} /*iter=${i}*/`).all();
    }
    // Yield so JSC's WeakRef [[KeptAlive]] list (populated by internal
    // uses of WeakRef inside JSSQLStatement/etc) clears, then GC.
    await Promise.resolve();
    Bun.gc(true);
    const endRss = process.memoryUsage.rss();

    // Upper-bound: 30 iterations × 190 KB SQL × some headroom for
    // prepared-statement plan state = a few tens of MB. A regression
    // where transient statements are pinned for the full loop shows as
    // hundreds of MB or more.
    // ASAN's quarantine + shadow-map overhead inflates post-GC RSS
    // independent of logical liveness; scale the bound accordingly, per
    // the convention in test/regression/issue/28632.test.ts etc.
    const growthMB = (endRss - startRss) / 1024 / 1024;
    expect(growthMB).toBeLessThan(isASAN ? 400 : 200);
  } finally {
    db.close();
  }
});

test("FIFO-evicted cache entry that is re-queried moves to newest slot (#28911)", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    const max = Database.MAX_QUERY_CACHE_SIZE;

    for (let i = 0; i < max; i++) {
      db.query(`SELECT ${i} AS x FROM t`).all();
    }
    expect(db[cacheCountSymbol]).toBe(max);

    // Externally-finalize the oldest entry, then re-query. The hit path
    // must move the refreshed entry to the NEWEST slot; otherwise the next
    // distinct query would immediately evict it.
    const oldestSql = `SELECT 0 AS x FROM t`;
    db.query(oldestSql).finalize();
    const refreshed = db.query(oldestSql);
    expect(refreshed.isFinalized).toBe(false);

    for (let i = max; i < max + max - 1; i++) {
      db.query(`SELECT ${i} AS x FROM t`).all();
    }
    expect(db[cacheCountSymbol]).toBe(max);

    // If the slot move worked, this is a cache hit on the same instance.
    const stillCached = db.query(oldestSql);
    expect(stillCached).toBe(refreshed);
  } finally {
    db.close();
  }
});

test("disabling the cache at runtime evicts finalized cached entries (#28911)", () => {
  // Setting MAX_QUERY_CACHE_SIZE = 0 at runtime must fully disable caching
  // even on the hit path that replaces a finalized entry.
  const prevCount = Database.MAX_QUERY_CACHE_SIZE;
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    const sql = "SELECT 1 AS x FROM t";

    const first = db.query(sql);
    first.all();
    expect(db[cacheCountSymbol]).toBe(1);

    Database.MAX_QUERY_CACHE_SIZE = 0;
    first.finalize();

    const replacement = db.query(sql);
    expect(replacement).not.toBe(first);
    expect(replacement.isFinalized).toBe(false);
    expect(replacement.all()).toEqual([]);
    expect(db[cacheCountSymbol]).toBe(0);
  } finally {
    // Restore the static before close(): if close() ever throws, the
    // static must not leak as 0 into subsequent tests.
    Database.MAX_QUERY_CACHE_SIZE = prevCount;
    db.close();
  }
});

test("standalone clearQueryCache() preserves held uncached and evicted statements (#28911)", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.exec("INSERT INTO t (id) VALUES (1), (2), (3)");
    const max = Database.MAX_QUERY_CACHE_SIZE;

    // Grab one FIFO-evicted statement and one that was never cacheable
    // (SQL > per-entry cap).
    const evictable = db.query(`SELECT 0 AS x, id FROM t`);
    evictable.all();
    for (let i = 1; i < max + 5; i++) {
      db.query(`SELECT ${i} AS x, id FROM t`).all();
    }
    expect(evictable.isFinalized).toBe(false);

    const bigSql = `SELECT id FROM t WHERE id IN (${buildBigInClause(10_000)})`;
    expect(bigSql.length).toBeGreaterThan(Database.MAX_QUERY_CACHE_ENTRY_BYTES);
    const transient = db.query(bigSql);
    transient.all();
    expect(transient.isFinalized).toBe(false);

    // Standalone clearQueryCache() drops the cache but must NOT destroy
    // statements the caller still holds — that's only close()'s job.
    db.clearQueryCache();
    expect(db[cacheCountSymbol]).toBe(0);
    expect(evictable.isFinalized).toBe(false);
    expect(transient.isFinalized).toBe(false);
    expect(() => evictable.all()).not.toThrow();
    expect(() => transient.all()).not.toThrow();
    expect(evictable.all()).toHaveLength(3);
  } finally {
    db.close();
  }
});

test("query cache total SQL bytes are bounded (#28911)", () => {
  // Raise per-entry cap and count cap so the total byte cap is what binds.
  const prevCount = Database.MAX_QUERY_CACHE_SIZE;
  const prevEntryBytes = Database.MAX_QUERY_CACHE_ENTRY_BYTES;
  Database.MAX_QUERY_CACHE_SIZE = 1000;
  Database.MAX_QUERY_CACHE_ENTRY_BYTES = 512 * 1024;
  try {
    using db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");

    // ~120 KB each, under the raised per-entry cap but enough to exceed 2 MB total.
    const baseSql = `SELECT id FROM t WHERE id IN (${buildBigInClause(6_000)})`;
    expect(baseSql.length).toBeLessThan(Database.MAX_QUERY_CACHE_ENTRY_BYTES);

    for (let i = 0; i < 50; i++) {
      const stmt = db.query(`${baseSql} /*iter=${i}*/`);
      stmt.all();
      stmt.finalize();
    }

    const maxEntries = Math.floor(Database.MAX_QUERY_CACHE_BYTES / baseSql.length) + 1;
    const count = db[cacheCountSymbol] as number;
    expect(count).toBeLessThanOrEqual(maxEntries);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(50);
  } finally {
    Database.MAX_QUERY_CACHE_SIZE = prevCount;
    Database.MAX_QUERY_CACHE_ENTRY_BYTES = prevEntryBytes;
  }
});
